import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import type { InfraBoxConfig, PipelineBoxes } from "@shipdeck/shared";
import { recommendServerlessAppSkus, serverlessAppTfvarLines } from "@shipdeck/shared";
import { commandExists, runCommand } from "./exec.js";
import { resolveServerlessCloudContext } from "./serverlessCloud.js";
import { findComposeFile } from "./composeDetect.js";
import { getRunOutputs } from "../runtime/context.js";
import { getConnection, getSecrets } from "./connections.js";
import { cloneUrlWithToken } from "./gitSource.js";
import { runNamePrefix, runSuffix } from "./naming.js";
import { copyTerraformModule } from "./tfModuleCopy.js";
import type { ServerlessAdapterContext, ServerlessAdapterResult } from "./serverlessInfra.js";
import { findActiveEnvironmentByServiceUrl } from "./runEnvironment.js";
import { pushLocalImagesToHub } from "./hubPush.js";
import {
  containerRuntimeTfvars,
  contextProxiesToService,
  resolveContainerRuntime,
  rewriteServiceOrigins,
  type ContainerRuntime,
} from "./containerRuntime.js";

export interface DockerBuildTarget extends ContainerRuntime {
  serviceName: string;
  contextDir: string;
  dockerfile: string;
  /** Compose `build.target`. Empty means Docker's last stage. */
  target: string;
  buildArgs: Record<string, string>;
}

function scoreService(name: string, kind: "api" | "web"): number {
  const n = name.toLowerCase();
  if (kind === "api") {
    if (n === "api" || n === "backend" || n === "server") return 100;
    if (n.includes("api")) return 80;
    return 0;
  }
  if (n === "web" || n === "frontend" || n === "ui") return 100;
  if (n.includes("shipper") || n.includes("admin") || n.includes("web")) return 70;
  if (n.includes("frontend") || n.includes("ui")) return 60;
  return 0;
}

/** Two image builds taken from the folder's compose file. Paths and stages come from that file. */
export function resolveAppDockerTargets(sourcePath: string): {
  api: DockerBuildTarget;
  web: DockerBuildTarget;
  composeFile: string;
} | null {
  const composeFile = findComposeFile(sourcePath);
  if (!composeFile) return null;
  const abs = path.join(sourcePath, composeFile);
  let doc: {
    services?: Record<
      string,
      {
        build?: string | {
          context?: string;
          dockerfile?: string;
          target?: string;
          args?: Record<string, string>;
        };
        ports?: unknown;
        environment?: unknown;
        healthcheck?: unknown;
      }
    >;
  };
  try {
    doc = YAML.parse(fs.readFileSync(abs, "utf8"));
  } catch {
    return null;
  }
  const services = doc.services ?? {};
  const serviceNames = Object.keys(services);
  const toTarget = (name: string): DockerBuildTarget | null => {
    const cfg = services[name];
    if (!cfg?.build) return null;
    let contextRel = ".";
    let dockerfile = "Dockerfile";
    let stage = "";
    let buildArgs: Record<string, string> = {};
    if (typeof cfg.build === "string") {
      contextRel = cfg.build;
    } else {
      contextRel = cfg.build.context ?? ".";
      dockerfile = cfg.build.dockerfile ?? "Dockerfile";
      stage = String(cfg.build.target ?? "").trim();
      buildArgs = { ...(cfg.build.args ?? {}) };
    }
    const contextDir = path.resolve(sourcePath, contextRel);
    if (!fs.existsSync(path.join(contextDir, dockerfile))) return null;
    const runtime = resolveContainerRuntime({
      contextDir,
      dockerfile,
      target: stage,
      ports: cfg.ports,
      environment: cfg.environment,
      healthcheck: cfg.healthcheck,
      serviceNames,
    });
    return {
      serviceName: name,
      contextDir,
      dockerfile,
      target: stage,
      buildArgs,
      ...runtime,
    };
  };

  const built = Object.keys(services)
    .map((name) => {
      const target = toTarget(name);
      if (!target) return null;
      return {
        name,
        target,
        apiScore: scoreService(name, "api"),
        webScore: scoreService(name, "web"),
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);
  const pair = chooseImagePair(built);
  if (!pair) return null;
  return { api: pair[0].target, web: pair[1].target, composeFile };
}

function chooseImagePair<T extends { name: string; apiScore: number; webScore: number }>(
  built: T[]
): [T, T] | null {
  if (built.length < 2) return null;
  const byApi = [...built].sort((a, b) => b.apiScore - a.apiScore || a.name.localeCompare(b.name));
  const byWeb = [...built].sort((a, b) => b.webScore - a.webScore || a.name.localeCompare(b.name));
  const namedApi = byApi[0].apiScore > 0 ? byApi[0] : undefined;
  const namedWeb = byWeb.find((row) => row.webScore > 0 && row.name !== namedApi?.name);
  if (namedApi && namedWeb) return [namedApi, namedWeb];
  if (built.length !== 2) return null;
  if (namedApi) return [namedApi, built.find((row) => row.name !== namedApi.name)!];
  if (namedWeb) return [built.find((row) => row.name !== namedWeb.name)!, namedWeb];
  return [built[0], built[1]];
}

async function tfOutputRaw(
  workDir: string,
  name: string,
  env: NodeJS.ProcessEnv
): Promise<string> {
  const r = await runCommand("terraform", ["output", "-raw", name], { cwd: workDir, env });
  return r.code === 0 ? r.stdout.trim() : "";
}

function writeTfvars(workDir: string, lines: string[]) {
  fs.writeFileSync(path.join(workDir, "terraform.tfvars"), lines.join("\n") + "\n");
}

function upsertTfvar(tfvars: string, key: string, value: string): string {
  const re = new RegExp(`${key}\\s*=\\s*"[^"]*"`);
  if (re.test(tfvars)) return tfvars.replace(re, `${key} = "${value}"`);
  return `${tfvars.trimEnd()}\n${key} = "${value}"\n`;
}

function safeServiceOrigin(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    return url.origin;
  } catch {
    return "";
  }
}

function upsertTfLine(tfvars: string, line: string): string {
  const key = line.split("=")[0]?.trim() ?? "";
  if (!key) return tfvars;
  const re = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=.*$`, "m");
  if (re.test(tfvars)) return tfvars.replace(re, line);
  return `${tfvars.trimEnd()}\n${line}\n`;
}

async function dockerLoginAws(
  region: string,
  registryHost: string,
  env: NodeJS.ProcessEnv,
  log: (l: string) => void
): Promise<boolean> {
  const pwd = await runCommand(
    "aws",
    ["ecr", "get-login-password", "--region", region],
    { env, timeoutMs: 60_000 }
  );
  if (pwd.code !== 0 || !pwd.stdout.trim()) {
    log("aws ecr get-login-password failed — is AWS CLI installed and credentials valid?");
    return false;
  }
  const login = await runCommand(
    "docker",
    ["login", "--username", "AWS", "--password-stdin", registryHost],
    { env, stdin: pwd.stdout.trim(), onLine: log, timeoutMs: 60_000 }
  );
  return login.code === 0;
}

async function dockerLoginAzure(
  workDir: string,
  env: NodeJS.ProcessEnv,
  log: (l: string) => void
): Promise<boolean> {
  const server = await tfOutputRaw(workDir, "registry_login_server", env);
  const user = await tfOutputRaw(workDir, "registry_username", env);
  const pass = await tfOutputRaw(workDir, "registry_password", env);
  if (!server || !user || !pass) {
    log("Azure ACR credentials missing from Terraform outputs");
    return false;
  }
  const login = await runCommand(
    "docker",
    ["login", "--username", user, "--password-stdin", server],
    { env, stdin: pass, onLine: log, timeoutMs: 60_000 }
  );
  return login.code === 0;
}

async function dockerLoginGcp(
  region: string,
  projectId: string,
  env: NodeJS.ProcessEnv,
  log: (l: string) => void
): Promise<boolean> {
  const host = `${region}-docker.pkg.dev`;
  // Prefer gcloud helper; fall back to access token
  const gcloud = await commandExists("gcloud");
  if (gcloud) {
    const auth = await runCommand(
      "gcloud",
      ["auth", "configure-docker", host, "--quiet"],
      { env, onLine: log, timeoutMs: 60_000 }
    );
    if (auth.code === 0) return true;
  }
  log(`Configure Docker for ${host} (gcloud auth configure-docker) — project=${projectId}`);
  return false;
}

async function buildAndPush(
  target: DockerBuildTarget,
  imageUri: string,
  buildArgs: Record<string, string>,
  env: NodeJS.ProcessEnv,
  log: (l: string) => void,
  serviceOrigins?: Record<string, string>
): Promise<boolean> {
  let contextDir = target.contextDir;
  let cleanup = "";
  if (serviceOrigins && Object.keys(serviceOrigins).length) {
    cleanup = fs.mkdtempSync(path.join(os.tmpdir(), "shipdeck-ctx-"));
    copyFilteredTree(target.contextDir, cleanup);
    rewriteServiceOrigins(cleanup, serviceOrigins);
    contextDir = cleanup;
  }
  const args = ["build", "-t", imageUri, "-f", path.join(contextDir, target.dockerfile)];
  if (target.target) args.push("--target", target.target);
  for (const [k, v] of Object.entries({ ...target.buildArgs, ...buildArgs })) {
    args.push("--build-arg", `${k}=${v}`);
  }
  args.push(contextDir);
  try {
    log(`docker build → ${imageUri}`);
    const build = await runCommand("docker", args, {
      env,
      onLine: log,
      timeoutMs: 1_200_000,
    });
    if (build.code !== 0) {
      log("docker build failed");
      return false;
    }
    log(`docker push → ${imageUri}`);
    const push = await runCommand("docker", ["push", imageUri], {
      env,
      onLine: log,
      timeoutMs: 600_000,
    });
    return push.code === 0;
  } finally {
    if (cleanup) fs.rmSync(cleanup, { recursive: true, force: true });
  }
}

const SKIP_COPY_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "coverage",
  "dist",
  ".turbo",
  ".shipdeck-work",
]);

export function posixRelFromSource(sourcePath: string, absDir: string): string {
  const rel = path.relative(sourcePath, absDir).split(path.sep).join("/");
  return rel || ".";
}

/** True when this image's compose args or its own Dockerfile stage declare this build argument. */
export function imageAcceptsBuildArg(target: DockerBuildTarget, name: string): boolean {
  if (Object.prototype.hasOwnProperty.call(target.buildArgs, name)) return true;
  let text = "";
  try {
    text = fs.readFileSync(path.join(target.contextDir, target.dockerfile), "utf8");
  } catch {
    return false;
  }
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const argRe = new RegExp(`^\\s*ARG\\s+${escaped}(?:\\s|=|$)`, "m");
  if (!target.target) return argRe.test(text);
  const stage = target.target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!new RegExp(`^\\s*FROM\\s+\\S+\\s+AS\\s+${stage}\\s*$`, "im").test(text)) return argRe.test(text);
  const lines = text.split(/\r?\n/);
  const fromRe = /^\s*FROM\s+\S+(?:\s+AS\s+(\S+))?\s*$/i;
  const preamble: string[] = [];
  const stageLines: string[] = [];
  let seenFrom = false;
  let inStage = false;
  for (const line of lines) {
    const from = line.match(fromRe);
    if (from) {
      seenFrom = true;
      inStage = (from[1] ?? "") === target.target;
      continue;
    }
    if (!seenFrom) preamble.push(line);
    else if (inStage) stageLines.push(line);
  }
  return argRe.test(preamble.join("\n")) || argRe.test(stageLines.join("\n"));
}

export function composeBuildTfvars(
  sourcePath: string,
  targets: { api: DockerBuildTarget; web: DockerBuildTarget }
): string[] {
  const line = (key: string, value: string) => `${key} = "${value.replace(/"/g, "")}"`;
  const one = (prefix: "api" | "web", target: DockerBuildTarget) => [
    line(`${prefix}_context`, posixRelFromSource(sourcePath, target.contextDir)),
    line(`${prefix}_dockerfile`, target.dockerfile.replace(/\\/g, "/")),
    line(`${prefix}_target`, target.target),
  ];
  return [...one("api", targets.api), ...one("web", targets.web)];
}

function describeImageBuild(sourcePath: string, target: DockerBuildTarget): string {
  const ctx = posixRelFromSource(sourcePath, target.contextDir);
  const file = target.dockerfile.replace(/\\/g, "/");
  const stage = target.target ? ` stage ${target.target}` : "";
  return `${target.serviceName} ${ctx}/${file}${stage}`;
}

function extraBuildArgs(target: DockerBuildTarget, extras: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(extras)) {
    if (imageAcceptsBuildArg(target, key)) out[key] = value;
  }
  return out;
}

export function gitCloneForCodeBuild(boxes: PipelineBoxes): {
  repoUrl: string;
  cloneUrl: string;
  branch: string;
} | null {
  // A local folder is the source. A Git login left on the pipeline must not replace it.
  if (boxes.source.mode !== "remote") return null;
  const conn = getConnection(boxes.source.gitConnectionId);
  const secrets = getSecrets(boxes.source.gitConnectionId);
  const url = conn?.config.url?.trim() ?? "";
  if (!url.startsWith("https://")) return null;
  const token = secrets.token || secrets.password || secrets.personalAccessToken;
  return {
    repoUrl: url,
    cloneUrl: cloneUrlWithToken(url, token, secrets.username || "git"),
    branch: boxes.source.branch?.trim() || "main",
  };
}

function copyFilteredTree(src: string, dest: string) {
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    if (SKIP_COPY_DIRS.has(ent.name)) continue;
    const from = path.join(src, ent.name);
    const to = path.join(dest, ent.name);
    if (ent.isDirectory()) copyFilteredTree(from, to);
    else if (ent.isFile()) fs.copyFileSync(from, to);
  }
}

async function zipSourceForCodeBuild(
  sourcePath: string,
  zipPath: string,
  log: (l: string) => void,
  serviceOrigins?: Record<string, string>
): Promise<boolean> {
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  const stage = `${zipPath.replace(/\.zip$/i, "")}-stage`;
  fs.rmSync(stage, { recursive: true, force: true });
  copyFilteredTree(sourcePath, stage);
  if (serviceOrigins && Object.keys(serviceOrigins).length) {
    const changed = rewriteServiceOrigins(stage, serviceOrigins);
    if (changed > 0) log("Packed folder now points compose service names at the live API address");
  }
  log("Packing source for AWS CodeBuild (excludes node_modules / .git)");
  if (process.platform === "win32") {
    // Compress-Archive stores names with backslashes. Linux unzip then refuses the file.
    const tar = (await commandExists("tar")) ? "tar" : "";
    if (!tar) {
      log("tar was not found, so the folder could not be packed for AWS");
      return false;
    }
    let r: { code: number };
    try {
      r = await runCommand(tar, ["-a", "-cf", zipPath, "-C", stage, "."], {
        timeoutMs: 300_000,
        shell: false,
        onLine: log,
      });
    } catch (err) {
      log(err instanceof Error ? err.message : String(err));
      return false;
    }
    if (r.code !== 0 || !fs.existsSync(zipPath)) {
      log("The folder was not packed for AWS");
      return false;
    }
    return true;
  }
  const zipBin = (await commandExists("zip")) ? "zip" : "";
  if (!zipBin) {
    log("zip CLI not found — cannot pack source for CodeBuild");
    return false;
  }
  const r = await runCommand("zip", ["-r", zipPath, "."], {
    cwd: stage,
    timeoutMs: 180_000,
    onLine: log,
  });
  return r.code === 0 && fs.existsSync(zipPath);
}

async function ensureAppImages(opts: {
  hasDocker: boolean;
  provider: string;
  region: string;
  workDir: string;
  sourcePath: string;
  targets: { api: DockerBuildTarget; web: DockerBuildTarget };
  apiImage: string;
  webImage: string;
  imageTag: string;
  nextPublicApi: string;
  env: NodeJS.ProcessEnv;
  extraTfvarLines: string[];
  git?: { repoUrl: string; cloneUrl: string; branch: string } | null;
  serviceOrigins?: Record<string, string>;
  log: (l: string) => void;
}): Promise<{ ok: boolean; message?: string }> {
  const {
    hasDocker,
    provider,
    region,
    workDir,
    sourcePath,
    targets,
    apiImage,
    webImage,
    imageTag,
    nextPublicApi,
    env,
    extraTfvarLines,
    git,
    serviceOrigins,
    log,
  } = opts;

  const apiCtx = posixRelFromSource(sourcePath, targets.api.contextDir);
  const webCtx = posixRelFromSource(sourcePath, targets.web.contextDir);
  const apiBuildArgs = { ...targets.api.buildArgs };
  const webBuildArgs = {
    ...targets.web.buildArgs,
    ...extraBuildArgs(targets.web, { NEXT_PUBLIC_API_URL: nextPublicApi }),
  };
  log(
    `Image build from the folder's compose: ${describeImageBuild(sourcePath, targets.api)}; ${describeImageBuild(sourcePath, targets.web)}`
  );

  if (hasDocker) {
    let loggedIn = false;
    if (provider === "aws") {
      loggedIn = await dockerLoginAws(region, apiImage.split("/")[0], env, log);
    } else if (provider === "azure") {
      loggedIn = await dockerLoginAzure(workDir, env, log);
    } else {
      loggedIn = await dockerLoginGcp(region, env.GOOGLE_CLOUD_PROJECT ?? "", env, log);
    }
    if (!loggedIn) {
      return { ok: false, message: "Docker registry login failed — check cloud credentials / CLI tools" };
    }
    if (
      !(await buildAndPush(targets.api, apiImage, apiBuildArgs, env, log, serviceOrigins)) ||
      !(await buildAndPush(targets.web, webImage, webBuildArgs, env, log, serviceOrigins))
    ) {
      return { ok: false, message: "docker build/push failed for serverless app images" };
    }
    return { ok: true };
  }

  const baseTf = [
    ...extraTfvarLines.filter(
      (l) =>
        !/^(api_image|web_image|source_zip|api_context|api_dockerfile|api_target|web_context|web_dockerfile|web_target)\s*=/.test(
          l
        )
    ),
    `api_image = "${apiImage}"`,
    `web_image = "${webImage}"`,
    ...composeBuildTfvars(sourcePath, targets),
  ];
  writeTfvars(workDir, baseTf);

  if (!git?.cloneUrl) {
    if (provider === "aws") {
      const zipPath = path.join(workDir, "source.zip");
      if (!(await zipSourceForCodeBuild(sourcePath, zipPath, log, serviceOrigins))) {
        return {
          ok: false,
          message: "The local folder could not be packed for the cloud build.",
        };
      }
      writeTfvars(workDir, [...baseTf, `source_zip = "${zipPath.replace(/\\/g, "/")}"`]);
      log("Uploading the local folder to AWS");
      const upload = await runCommand(
        "terraform",
        ["apply", "-input=false", "-auto-approve", "-target=aws_s3_object.source"],
        { cwd: workDir, env, onLine: log, timeoutMs: 180_000 }
      );
      if (upload.code !== 0) {
        return { ok: false, message: "Failed to upload source zip to S3 (CodeBuild)" };
      }
    } else {
      return {
        ok: false,
        message:
          "This PC has no Docker. Azure and Google can build a local folder only when Docker is installed here. AWS can pack the folder without local Docker.",
      };
    }
  }

  if (provider === "azure") {
    if (!git?.cloneUrl) {
      return { ok: false, message: "Remote Git is required for Azure ACR Tasks (no local Docker)" };
    }
    const { azureAcrGitBuildAndWait } = await import("./azureAcrBuild.js");
    const rg = await tfOutputRaw(workDir, "resource_group_name", env);
    const acr = await tfOutputRaw(workDir, "registry_name", env);
    if (!rg || !acr) {
      return { ok: false, message: "Azure resource_group_name / registry_name outputs missing" };
    }
    log(`ACR Tasks will clone ${git.repoUrl} @ ${git.branch} (no local Docker)`);
    const apiRef = apiImage.includes("/") ? apiImage.slice(apiImage.indexOf("/") + 1) : apiImage;
    const webRef = webImage.includes("/") ? webImage.slice(webImage.indexOf("/") + 1) : webImage;
    const apiRun = await azureAcrGitBuildAndWait({
      env,
      resourceGroup: rg,
      registryName: acr,
      gitCloneUrl: git.cloneUrl,
      branch: git.branch,
      context: apiCtx,
      dockerfile: targets.api.dockerfile.replace(/\\/g, "/"),
      target: targets.api.target,
      imageName: apiRef,
      buildArgs: apiBuildArgs,
      log,
    });
    if (!apiRun.ok) return { ok: false, message: apiRun.message };
    const webRun = await azureAcrGitBuildAndWait({
      env,
      resourceGroup: rg,
      registryName: acr,
      gitCloneUrl: git.cloneUrl,
      branch: git.branch,
      context: webCtx,
      dockerfile: targets.web.dockerfile.replace(/\\/g, "/"),
      target: targets.web.target,
      imageName: webRef,
      buildArgs: webBuildArgs,
      log,
    });
    if (!webRun.ok) return { ok: false, message: webRun.message };
    log(`Images ready in ACR: ${apiImage} / ${webImage}`);
    return { ok: true };
  }

  if (provider === "gcp") {
    if (!git?.cloneUrl) {
      return { ok: false, message: "Remote Git is required for GCP Cloud Build (no local Docker)" };
    }
    const { gcpCloudBuildGitAndWait } = await import("./gcpCloudBuild.js");
    log(`Cloud Build will clone ${git.repoUrl} @ ${git.branch} (no local Docker)`);
    const built = await gcpCloudBuildGitAndWait({
      env,
      region,
      gitCloneUrl: git.cloneUrl,
      branch: git.branch,
      apiContext: apiCtx,
      apiDockerfile: targets.api.dockerfile.replace(/\\/g, "/"),
      apiTarget: targets.api.target,
      apiBuildArgs,
      webContext: webCtx,
      webDockerfile: targets.web.dockerfile.replace(/\\/g, "/"),
      webTarget: targets.web.target,
      webBuildArgs,
      apiImage,
      webImage,
      log,
    });
    if (!built.ok) return { ok: false, message: built.message };
    log(`Images ready in Artifact Registry: ${apiImage} / ${webImage}`);
    return { ok: true };
  }

  const { codeBuildStartAndWait } = await import("./awsJson.js");
  const repoOf = (image: string) => {
    const cut = image.lastIndexOf(":");
    return cut > 0 ? image.slice(0, cut) : image;
  };
  const envVars: Record<string, string> = {
    IMAGE_TAG: imageTag,
    API_CONTEXT: apiCtx,
    API_DOCKERFILE: targets.api.dockerfile.replace(/\\/g, "/"),
    API_BUILD_ARGS: JSON.stringify(apiBuildArgs),
    WEB_CONTEXT: webCtx,
    WEB_DOCKERFILE: targets.web.dockerfile.replace(/\\/g, "/"),
    WEB_BUILD_ARGS: JSON.stringify(webBuildArgs),
    API_REPO: repoOf(apiImage),
    WEB_REPO: repoOf(webImage),
  };
  if (targets.api.target) envVars.API_TARGET = targets.api.target;
  if (targets.web.target) envVars.WEB_TARGET = targets.web.target;
  const sourceBucket = await tfOutputRaw(workDir, "source_bucket", env);
  if (sourceBucket) envVars.SOURCE_BUCKET = sourceBucket;
  if (git?.cloneUrl) {
    envVars.GIT_CLONE_URL = git.cloneUrl;
    envVars.GIT_REPO_URL = git.repoUrl;
    envVars.GIT_BRANCH = git.branch;
    log(`CodeBuild will clone ${git.repoUrl} @ ${git.branch} (no local Docker / no source zip)`);
  } else {
    log("CodeBuild will build the packed local folder");
  }

  const project = await tfOutputRaw(workDir, "codebuild_project", env);
  if (!project) {
    return { ok: false, message: "codebuild_project Terraform output missing" };
  }

  const built = await codeBuildStartAndWait({
    env,
    region,
    projectName: project,
    envVars,
    log,
    timeoutMs: 1_200_000,
  });
  if (!built.ok) return { ok: false, message: built.message };
  log(`Images ready in ECR via CodeBuild: ${apiImage} / ${webImage}`);
  return { ok: true };
}

/**
 * Create managed container app (ECS Express / Container Apps / Cloud Run)
 * with managed Postgres + Redis. Local Docker optional — cloud clones Git and builds images.
 */
export async function executeServerlessAppCreate(
  ctx: ServerlessAdapterContext,
  opts: {
    infra: InfraBoxConfig;
    moduleDir: string;
    workRoot: string;
  }
): Promise<ServerlessAdapterResult> {
  const { infra, moduleDir, workRoot } = opts;
  const out = getRunOutputs(ctx.runId);
  const provider = infra.cloudProvider ?? "aws";

  if (!infra.cloudConnectionId) {
    return {
      ok: false,
      message: "Serverless app create needs a cloud connection (AWS / Azure / GCP credentials)",
    };
  }

  const hasTf = await commandExists("terraform");
  if (!hasTf) {
    return { ok: false, message: "terraform CLI not found on PATH" };
  }
  const hasDocker = await commandExists("docker");
  if (!fs.existsSync(moduleDir)) {
    return { ok: false, message: `Terraform module missing: ${moduleDir}` };
  }
  if (!out.sourcePath) {
    return { ok: false, message: "No sourcePath — run Source before serverless app create" };
  }

  const targets = resolveAppDockerTargets(out.sourcePath);
  if (!targets) {
    return {
      ok: false,
      message:
        "The folder's docker-compose.yml needs two services that build an image. Each one needs build: with its own folder, Dockerfile, and stage.",
    };
  }

  const workDir = path.join(workRoot, ctx.runId, "tf");
  copyTerraformModule(moduleDir, workDir);

  out.tfWorkDir = workDir;
  out.cloudConnectionId = infra.cloudConnectionId;
  out.infraProvisioned = false;
  out.computeMode = "serverless";
  out.serverlessKind = "app";

  const memory =
    infra.serverlessMemoryMb && infra.serverlessMemoryMb > 0 ? infra.serverlessMemoryMb : 1024;
  const skus = recommendServerlessAppSkus({ provider, memoryMb: memory });
  const region =
    infra.region ??
    (provider === "aws" ? "us-east-1" : provider === "gcp" ? "us-central1" : "eastus");
  const namePrefix = runNamePrefix(ctx.runId);
  const imageTag = `r${runSuffix(ctx.runId, 8)}`;

  ctx.log(
    `Serverless Full app UI → ${provider} · compose=${targets.composeFile} · api=${targets.api.serviceName} · web=${targets.web.serviceName}`
  );
  ctx.log(
    `Sized from catalog ${skus.computeOptionId} (scan/UI ≥ ${memory} MB) → cpu=${skus.cpu} memory=${skus.memory} db=${provider === "aws" ? skus.dbInstanceClass : provider === "azure" ? skus.azurePostgresSku : skus.gcpDbTier}`
  );
  const git = gitCloneForCodeBuild(ctx.boxes);
  ctx.log(
    hasDocker
      ? "Building images with local Docker, then provisioning registry + DB + Redis + containers"
      : git
        ? `No local Docker — ${provider === "azure" ? "ACR Tasks" : provider === "gcp" ? "Cloud Build" : "CodeBuild"} will clone ${git.repoUrl} and build images`
        : "No local Docker — packing the local folder and building it from its compose file"
  );

  const cloud = resolveServerlessCloudContext(infra.cloudConnectionId, workDir);
  if (provider === "gcp") {
    const hasProject = cloud.tfvarsExtra.some((l) => l.startsWith("project_id"));
    if (!hasProject) {
      return { ok: false, message: "GCP serverless app needs cloud connection config.project_id" };
    }
  }

  // Placeholder images for registry-only first apply (services created after push)
  const placeholder = "public.ecr.aws/docker/library/nginx:alpine";
  const sizeLines = serverlessAppTfvarLines(skus);

  const runtimeLines = containerRuntimeTfvars(targets);
  ctx.log(
    `${targets.api.serviceName} listens on ${targets.api.containerPort}, health ${targets.api.healthPath}. ${targets.web.serviceName} listens on ${targets.web.containerPort}, health ${targets.web.healthPath}.`
  );
  writeTfvars(workDir, [
    `region = "${region}"`,
    `name_prefix = "${namePrefix}"`,
    `api_image = "${placeholder}"`,
    `web_image = "${placeholder}"`,
    ...composeBuildTfvars(out.sourcePath, targets),
    ...runtimeLines,
    ...sizeLines,
    ...cloud.tfvarsExtra,
  ]);

  const init = await runCommand("terraform", ["init", "-input=false"], {
    cwd: workDir,
    env: cloud.env,
    onLine: ctx.log,
    timeoutMs: 180_000,
  });
  if (init.code !== 0) return { ok: false, message: "terraform init failed (serverless app)" };

  const registryTargets =
    provider === "aws"
      ? [
          "-target=aws_ecr_repository.api",
          "-target=aws_ecr_repository.web",
          "-target=aws_s3_bucket.src",
          "-target=aws_iam_role.codebuild",
          "-target=aws_iam_role_policy.codebuild",
          "-target=aws_codebuild_project.app",
        ]
      : provider === "azure"
        ? ["-target=azurerm_resource_group.app", "-target=azurerm_container_registry.app"]
        : [
            "-target=google_project_service.services",
            "-target=google_artifact_registry_repository.app",
            "-target=google_project_iam_member.cloudbuild_ar",
          ];

  const { settings } = await import("../settings.js");
  // Ops "TF apply" ON means apply is authorized — don't pause for a second Approve click.
  const canApply = settings.tfApply || ctx.terraformApplyApproved;
  const needsGate =
    settings.requireApprovalForTf && !settings.tfApply && !ctx.terraformApplyApproved;

  if (needsGate || !canApply) {
    const plan = await runCommand(
      "terraform",
      ["plan", "-input=false", "-out=tfplan", ...registryTargets],
      { cwd: workDir, env: cloud.env, onLine: ctx.log, timeoutMs: 300_000 }
    );
    if (plan.code !== 0) return { ok: false, message: "terraform plan failed (serverless app registry)" };
    ctx.log(
      canApply
        ? "Serverless app plan ready — waiting for operator approval (registry → Docker push → full stack)"
        : "Serverless app plan ready — enable tfApply in settings or approve apply"
    );
    return {
      ok: true,
      needsApproval: true,
      approvalKind: "terraform_apply",
      message: "Waiting for approval to run terraform apply (serverless app)",
    };
  }

  ctx.log("Phase 1 — create container registry (and AWS CodeBuild if no local Docker)");
  const regApply = await runCommand(
    "terraform",
    ["apply", "-input=false", "-auto-approve", ...registryTargets],
    { cwd: workDir, env: cloud.env, onLine: ctx.log, timeoutMs: 600_000 }
  );
  if (regApply.code !== 0) {
    return { ok: false, message: "terraform apply failed creating registry (serverless app)" };
  }

  const ecrApi = await tfOutputRaw(workDir, "ecr_api_url", cloud.env);
  const ecrWeb = await tfOutputRaw(workDir, "ecr_web_url", cloud.env);
  if (!ecrApi || !ecrWeb) {
    return { ok: false, message: "Registry URLs missing after phase 1 apply" };
  }

  const apiImage = `${ecrApi}:${imageTag}`;
  const webImage = `${ecrWeb}:${imageTag}`;
  const nextPublicApi = "http://localhost:3000/v1";
  const extraTfvarLines = [
    `region = "${region}"`,
    `name_prefix = "${namePrefix}"`,
    `api_image = "${apiImage}"`,
    `web_image = "${webImage}"`,
    ...composeBuildTfvars(out.sourcePath, targets),
    ...runtimeLines,
    ...sizeLines,
    ...cloud.tfvarsExtra,
  ];

  const images = await ensureAppImages({
    hasDocker,
    provider,
    region,
    workDir,
    sourcePath: out.sourcePath,
    targets,
    apiImage,
    webImage,
    imageTag,
    nextPublicApi,
    env: cloud.env,
    extraTfvarLines,
    git: gitCloneForCodeBuild(ctx.boxes),
    log: ctx.log,
  });
  if (!images.ok) return { ok: false, message: images.message };

  writeTfvars(workDir, extraTfvarLines);

  ctx.log("Phase 2 — provision DB, Redis, and container services (may take several minutes)");
  const apply = await runCommand("terraform", ["apply", "-input=false", "-auto-approve"], {
    cwd: workDir,
    env: cloud.env,
    onLine: ctx.log,
    timeoutMs: 2_400_000,
  });
  if (apply.code !== 0) return { ok: false, message: "terraform apply failed (serverless app)" };

  out.infraProvisioned = true;

  const serviceUrl = (await tfOutputRaw(workDir, "service_url", cloud.env)).replace(/\/$/, "");
  const apiUrl = (await tfOutputRaw(workDir, "api_url", cloud.env)).replace(/\/$/, "");
  if (!serviceUrl) {
    return { ok: false, message: "Serverless app created but service_url output missing" };
  }

  out.serviceUrl = serviceUrl;
  out.apiUrl = apiUrl || undefined;
  out.deployUrl = serviceUrl;
  out.imageTag = `${apiImage},${webImage}`;
  try {
    out.deployHost = new URL(serviceUrl).host;
  } catch {
    out.deployHost = serviceUrl;
  }

  // Rebuild when the site bakes in an API address, or when it proxies to a compose service name.
  const liveOrigin = apiUrl ? safeServiceOrigin(apiUrl) : "";
  const proxiesToApi = Boolean(liveOrigin && contextProxiesToService(targets.web.contextDir, targets.api.serviceName));
  const declaresApiArg = imageAcceptsBuildArg(targets.web, "NEXT_PUBLIC_API_URL");
  if (liveOrigin && (proxiesToApi || declaresApiArg)) {
    const apiForBuild = declaresApiArg ? (apiUrl.includes("/v1") ? apiUrl : `${apiUrl}/v1`) : nextPublicApi;
    ctx.log(
      proxiesToApi
        ? `Rebuilding the website image so it calls the live API instead of the compose service "${targets.api.serviceName}"`
        : "Rebuilding the website image with the live API address"
    );
    const tag2 = `${imageTag}-api`;
    const apiImage2 = `${ecrApi}:${tag2}`;
    const webImage2 = `${ecrWeb}:${tag2}`;
    const extra2 = extraTfvarLines.map((l) =>
      l.startsWith("api_image")
        ? `api_image = "${apiImage2}"`
        : l.startsWith("web_image")
          ? `web_image = "${webImage2}"`
          : l
    );
    const refresh = await ensureAppImages({
      hasDocker,
      provider,
      region,
      workDir,
      sourcePath: out.sourcePath,
      targets,
      apiImage: apiImage2,
      webImage: webImage2,
      imageTag: tag2,
      nextPublicApi: apiForBuild,
      env: cloud.env,
      extraTfvarLines: extra2,
      git: gitCloneForCodeBuild(ctx.boxes),
      serviceOrigins: proxiesToApi ? { [targets.api.serviceName]: liveOrigin } : undefined,
      log: ctx.log,
    });
    if (refresh.ok) {
      writeTfvars(workDir, extra2);
      const upd = await runCommand("terraform", ["apply", "-input=false", "-auto-approve"], {
        cwd: workDir,
        env: cloud.env,
        onLine: ctx.log,
        timeoutMs: 1_200_000,
      });
      if (upd.code === 0) {
        out.imageTag = `${apiImage2},${webImage2}`;
        ctx.log("Services updated with live API URL");
      } else {
        ctx.log("Warning: image refresh apply failed — UI may still point at localhost API URL");
      }
    } else {
      ctx.log(`Warning: image refresh skipped — ${refresh.message}`);
    }
  }

  ctx.log(`service_url=${serviceUrl}`);
  if (apiUrl) ctx.log(`api_url=${apiUrl}`);
  const hub = await pushLocalImagesToHub({
    boxes: ctx.boxes,
    runId: ctx.runId,
    images: [
      { ref: out.imageTag?.split(",")[0] || apiImage, service: "api" },
      { ref: out.imageTag?.split(",")[1] || webImage, service: "web" },
    ],
    log: ctx.log,
  });
  if (!hub.ok) return { ok: false, message: hub.message };
  ctx.log("Open the web URL. Tear down uses the same Terraform workspace.");

  return {
    ok: true,
    message: `Serverless app ready: ${serviceUrl}`,
    outputs: {
      serviceUrl,
      deployUrl: serviceUrl,
      apiUrl: apiUrl ?? "",
    },
  };
}

/** Rebuild/push images and terraform apply to refresh ECS Express / Container Apps / Cloud Run. */
export async function deployServerlessApp(
  ctx: ServerlessAdapterContext
): Promise<ServerlessAdapterResult> {
  const { infra } = ctx.boxes;
  const out = getRunOutputs(ctx.runId);
  let workDir = out.tfWorkDir;
  if ((!workDir || !fs.existsSync(workDir)) && out.serviceUrl) {
    const prior = findActiveEnvironmentByServiceUrl(out.serviceUrl);
    if (prior?.tfWorkDir && fs.existsSync(prior.tfWorkDir)) {
      workDir = prior.tfWorkDir;
      out.tfWorkDir = workDir;
      ctx.log(`Reusing Terraform workspace from the run that created ${out.serviceUrl}`);
    }
  }
  if (!workDir || !fs.existsSync(workDir)) {
    return {
      ok: false,
      message:
        "Serverless app deploy needs the Terraform workspace of the original service. Paste the live URL on Build so Shipdeck can find that workspace, or re-run Infra create.",
    };
  }
  if (!out.sourcePath) {
    return { ok: false, message: "No sourcePath for serverless app deploy" };
  }
  const hasDocker = await commandExists("docker");

  const targets = resolveAppDockerTargets(out.sourcePath);
  if (!targets) {
    return { ok: false, message: "Could not find two image builds in the folder's docker-compose.yml" };
  }

  const provider = infra.cloudProvider ?? "aws";
  const region =
    infra.region ??
    (provider === "aws" ? "us-east-1" : provider === "gcp" ? "us-central1" : "eastus");
  const cloud = resolveServerlessCloudContext(infra.cloudConnectionId, workDir);
  const imageTag = `d${Date.now().toString(36)}`;

  ctx.log(
    hasDocker
      ? "Serverless app Deploy — rebuild images locally and apply Terraform"
      : `Serverless app Deploy — rebuild images in the cloud (${provider === "azure" ? "ACR Tasks" : provider === "gcp" ? "Cloud Build" : "CodeBuild"})`
  );

  const ecrApi = await tfOutputRaw(workDir, "ecr_api_url", cloud.env);
  const ecrWeb = await tfOutputRaw(workDir, "ecr_web_url", cloud.env);
  if (!ecrApi || !ecrWeb) {
    return { ok: false, message: "Registry URLs missing — re-run Infra create" };
  }

  // Refresh Terraform module from repo (health checks, SG, etc.) without losing state.
  const moduleDir = path.join(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../infra/terraform"),
    `serverless-app-${provider}`
  );
  if (fs.existsSync(moduleDir)) {
    copyTerraformModule(moduleDir, workDir);
    ctx.log(`Refreshed Terraform module from ${path.basename(moduleDir)}`);
  }

  const apiImage = `${ecrApi}:${imageTag}`;
  const webImage = `${ecrWeb}:${imageTag}`;
  const apiUrl = out.apiUrl || (await tfOutputRaw(workDir, "api_url", cloud.env)).replace(/\/$/, "");
  const apiV1 = apiUrl ? (apiUrl.includes("/v1") ? apiUrl : `${apiUrl}/v1`) : "http://localhost:3000/v1";
  const liveOrigin = apiUrl ? safeServiceOrigin(apiUrl) : "";
  const proxiesToApi = Boolean(liveOrigin && contextProxiesToService(targets.web.contextDir, targets.api.serviceName));
  if (proxiesToApi) {
    ctx.log(`Website files that call compose service "${targets.api.serviceName}" will use the live API address`);
  }

  const extraTfvarLines = fs.existsSync(path.join(workDir, "terraform.tfvars"))
    ? fs.readFileSync(path.join(workDir, "terraform.tfvars"), "utf8").trim().split(/\r?\n/)
    : [];
  const images = await ensureAppImages({
    hasDocker,
    provider,
    region,
    workDir,
    sourcePath: out.sourcePath,
    targets,
    apiImage,
    webImage,
    imageTag,
    nextPublicApi: apiV1,
    env: cloud.env,
    extraTfvarLines,
    git: gitCloneForCodeBuild(ctx.boxes),
    serviceOrigins: proxiesToApi ? { [targets.api.serviceName]: liveOrigin } : undefined,
    log: ctx.log,
  });
  if (!images.ok) return { ok: false, message: images.message };

  let tfvars = fs.readFileSync(path.join(workDir, "terraform.tfvars"), "utf8");
  tfvars = upsertTfvar(tfvars, "api_image", apiImage);
  tfvars = upsertTfvar(tfvars, "web_image", webImage);
  for (const line of [...composeBuildTfvars(out.sourcePath, targets), ...containerRuntimeTfvars(targets)]) {
    tfvars = upsertTfLine(tfvars, line);
  }
  fs.writeFileSync(path.join(workDir, "terraform.tfvars"), tfvars);

  const apply = await runCommand("terraform", ["apply", "-input=false", "-auto-approve"], {
    cwd: workDir,
    env: cloud.env,
    onLine: ctx.log,
    timeoutMs: 1_200_000,
  });
  if (apply.code !== 0) {
    return { ok: false, message: "Serverless app deploy (terraform apply) failed" };
  }

  const serviceUrl = (await tfOutputRaw(workDir, "service_url", cloud.env)).replace(/\/$/, "");
  if (serviceUrl) {
    out.serviceUrl = serviceUrl;
    out.deployUrl = serviceUrl;
    try {
      out.deployHost = new URL(serviceUrl).host;
    } catch {
      out.deployHost = serviceUrl;
    }
  }
  if (apiUrl) out.apiUrl = apiUrl;
  out.imageTag = `${apiImage},${webImage}`;
  const hub = await pushLocalImagesToHub({
    boxes: ctx.boxes,
    runId: ctx.runId,
    images: [
      { ref: apiImage, service: "api" },
      { ref: webImage, service: "web" },
    ],
    log: ctx.log,
  });
  if (!hub.ok) return { ok: false, message: hub.message };

  return {
    ok: true,
    message: `Serverless app updated → ${out.deployUrl ?? out.serviceUrl}`,
    outputs: {
      deployUrl: out.deployUrl ?? "",
      serviceUrl: out.serviceUrl ?? "",
      apiUrl: out.apiUrl ?? "",
    },
  };
}
