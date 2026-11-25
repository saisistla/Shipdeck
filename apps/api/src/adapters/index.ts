import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { PipelineBoxType, PipelineBoxes } from "@shipdeck/shared";
import { resolveVerifyHealthUrl, recommendVmSize, vmSizeForProvider, recommendManagedDbSku, composeVerifyTarget, splitPublishPorts, parseServerlessUrl, imageVersionForRegistry } from "@shipdeck/shared";
import { detectStackFromDir } from "../detection.js";
import { findComposeFile, containerNamesFromCompose } from "../lib/composeDetect.js";
import { prepareComposeForDeploy, stampComposeReleaseImages } from "../lib/composeDeployPrep.js";
import { originalComposeFile, SHIPDECK_COMPOSE_FILE, writeShipdeckCompose, writeShipdeckDockerfiles } from "../lib/composeGenerate.js";
import { resolveAppRuntimePlan } from "../lib/runtimePlan.js";
import { discoverTests, writeShipdeckTests, planGeneratedTests } from "../lib/testReview.js";
import { ensureNpmInstall } from "../lib/npmInstall.js";
import { discoverDockerfiles } from "../lib/dockerfileReview.js";
import { commandExists, runCommand } from "../lib/exec.js";
import { resolveCloudContext, resolveProvisionedSshTarget } from "../lib/cloud.js";
import { resolveSshTarget, getConnection, getSecrets } from "../lib/connections.js";
import { cloneGitRepo, shipdeckWorkRoot } from "../lib/gitSource.js";
import {
  deployServerlessCode,
  executeServerlessAppCreate,
  executeServerlessCreate,
} from "../lib/serverlessInfra.js";
import {
  bootstrapRemoteHost,
  ensureLocalRuntime,
  needsFromPipeline,
  waitForDockerOnNewVm,
  writeKubeconfigFile,
} from "../lib/bootstrap.js";
import { sshExec, sshUploadDir, remoteShipdeckDir, type SshTarget } from "../lib/ssh.js";
import { getRunOutputs } from "../runtime/context.js";
import { store } from "../store.js";
import { incrementDockerReleaseTag, registryImageName, resolveDockerReleaseTag } from "../lib/imageTag.js";
import { runNamePrefix, runScopedName, runSuffix, safeName } from "../lib/naming.js";
import { findActiveEnvironmentByServiceUrl } from "../lib/runEnvironment.js";
import { copyTerraformModule } from "../lib/tfModuleCopy.js";
import { buildVerifyCandidates, isRespondingStatus } from "../lib/verifyTargets.js";

export interface AdapterContext {
  boxes: PipelineBoxes;
  runId: string;
  log: (line: string) => void;
  simulate: boolean;
  /** Set when operator approved a terraform apply pause */
  terraformApplyApproved?: boolean;
}

export interface AdapterResult {
  ok: boolean;
  skipped?: boolean;
  message?: string;
  outputs?: Record<string, string>;
  needsApproval?: boolean;
  approvalKind?: string;
}

export interface BoxAdapter {
  box: PipelineBoxType;
  name: string;
  execute(ctx: AdapterContext): Promise<AdapterResult>;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const tfModulesRoot = path.join(repoRoot, "infra/terraform");
const workRoot = shipdeckWorkRoot;

function resolveDeploySsh(
  infra: AdapterContext["boxes"]["infra"],
  out: ReturnType<typeof getRunOutputs>
): SshTarget | null {
  const linked = resolveSshTarget(infra.sshConnectionId);
  if (linked) {
    return { ...linked, host: out.deployHost || linked.host };
  }
  if (out.deployHost && (out.sshPrivateKey || out.sshPrivateKeyPath)) {
    return {
      host: out.deployHost,
      port: Number(out.sshPort || 22),
      username: out.sshUser || "shipdeck",
      privateKey: out.sshPrivateKey,
      privateKeyPath: out.sshPrivateKeyPath,
    };
  }
  return null;
}

/** After SSH host is known, install Docker/Compose/Node/k3s based on pipeline. */
async function prepareHostForPipeline(
  ctx: AdapterContext,
  target: SshTarget
): Promise<AdapterResult> {
  const out = getRunOutputs(ctx.runId);
  const needs = needsFromPipeline(ctx.boxes, out.sourcePath);
  ctx.log(
    `Host bootstrap needs: docker=${needs.docker} compose=${needs.compose} node=${needs.node} python=${needs.python} java=${needs.java} go=${needs.go} k3s=${needs.k3s}`
  );
  const result = await bootstrapRemoteHost(target, needs, ctx.log);
  if (!result.ok) return { ok: false, message: result.message };
  if (result.kubeconfig) {
    out.kubeconfig = result.kubeconfig;
    out.kubeconfigPath = writeKubeconfigFile(workRoot, ctx.runId, result.kubeconfig);
    ctx.log(`Kubeconfig saved for this run: ${out.kubeconfigPath}`);
  }
  return { ok: true, message: result.message ?? "Host ready" };
}

async function sim(ctx: AdapterContext, lines: string[], delay = 350): Promise<AdapterResult> {
  for (const line of lines) {
    ctx.log(line);
    await sleep(delay);
  }
  return { ok: true, message: lines[lines.length - 1] };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function registryReady(connectionId: string, imageName?: string) {
  const reg = getConnection(connectionId);
  const secrets = getSecrets(connectionId);
  const registry = reg?.config.registry || reg?.config.endpoint || reg?.config.host || "";
  const repository = reg?.config.repository || imageName || "app";
  if (!registry) return { ok: false as const, message: "Registry connection needs a registry host" };
  const user = secrets.username || reg?.config.username || "";
  const pass = secrets.password || secrets.token || "";
  if (!user || !pass) return { ok: false as const, message: "Registry connection needs a username and an access token" };
  return { ok: true as const, registry, repository, user, pass };
}

function saveNextImageVersion(ctx: AdapterContext, pushedTag: string) {
  const next = incrementDockerReleaseTag(pushedTag);
  const id = ctx.boxes.build.registryConnectionId?.trim();
  ctx.boxes.build.imageVersion = next;
  if (id) ctx.boxes.build.imageVersions = { ...ctx.boxes.build.imageVersions, [id]: next };
  const run = store.runs.get(ctx.runId);
  const pipeline = run ? store.pipelines.get(run.pipelineId) : undefined;
  if (pipeline) {
    pipeline.boxes.build.imageVersion = next;
    if (id) pipeline.boxes.build.imageVersions = { ...pipeline.boxes.build.imageVersions, [id]: next };
    pipeline.updatedAt = new Date().toISOString();
    store.setPipeline(pipeline);
  }
  ctx.log(`Next ship pushes ${next}`);
}

async function loginDocker(
  ctx: AdapterContext,
  registry: string,
  user: string,
  pass: string,
  cwd?: string
): Promise<AdapterResult> {
  ctx.log(`docker login ${registry}`);
  const passFile = path.join(workRoot, ctx.runId, "reg.pass");
  fs.mkdirSync(path.dirname(passFile), { recursive: true });
  fs.writeFileSync(passFile, pass, { mode: 0o600 });
  try {
    const loginCmd =
      process.platform === "win32"
        ? await runCommand("cmd", ["/c", `type "${passFile}" | docker login ${registry} -u ${user} --password-stdin`], {
            cwd,
            onLine: ctx.log,
            timeoutMs: 60_000,
          })
        : await runCommand("bash", ["-lc", `docker login ${shellQuote(registry)} -u ${shellQuote(user)} --password-stdin < ${shellQuote(passFile)}`], {
            cwd,
            onLine: ctx.log,
            timeoutMs: 60_000,
          });
    if (loginCmd.code !== 0) return { ok: false, message: "docker login failed" };
    return { ok: true };
  } finally {
    try {
      fs.unlinkSync(passFile);
    } catch {
      /* ignore */
    }
  }
}

function stampRelease(ctx: AdapterContext, absComposeFile: string) {
  const id = ctx.boxes.build.registryConnectionId;
  if (!id) return null;
  const ready = registryReady(id, ctx.boxes.build.imageName);
  if (!ready.ok) return ready;
  const version = resolveDockerReleaseTag(
    getRunOutputs(ctx.runId).releaseTag || imageVersionForRegistry(ctx.boxes.build)
  );
  if (!version.ok) return version;
  const services = stampComposeReleaseImages(absComposeFile, (service, alone) =>
    registryImageName(ready.registry, ready.repository, version.tag, alone ? undefined : service)
  );
  return { ...ready, services, tag: version.tag };
}

function envPairs(envVars: Record<string, string>): string[] {
  const args: string[] = [];
  for (const [k, v] of Object.entries(envVars)) {
    args.push("-e", `${k}=${v}`);
  }
  return args;
}

export const sourceAdapter: BoxAdapter = {
  box: "source",
  name: "Source (Git)",
  async execute(ctx) {
    const { source } = ctx.boxes;
    const out = getRunOutputs(ctx.runId);

    if (ctx.simulate) {
      out.sourcePath = source.localPath || undefined;
      out.branch = source.branch;
      return sim(ctx, [
        `Resolving source mode=${source.mode}`,
        source.mode === "local"
          ? `Checking local path: ${source.localPath || "(empty)"}`
          : `Cloning via git connection ${source.gitConnectionId ?? "(none)"}`,
        `Checking out branch: ${source.branch}`,
        "Source snapshot ready (simulate)",
      ]);
    }

    if (source.mode === "local") {
      const localPath = source.localPath?.trim();
      if (!localPath) {
        return { ok: false, message: "Local path is required in live mode" };
      }
      if (!fs.existsSync(localPath) || !fs.statSync(localPath).isDirectory()) {
        return { ok: false, message: `Local path not found: ${localPath}` };
      }
      ctx.log(`Validated local workspace: ${localPath}`);
      if (source.gitConnectionId?.trim()) {
        ctx.log("Local folder is the source. The saved Git connection is not used.");
      }

      const detection = detectStackFromDir(localPath);
      detection.signals.forEach((s) => ctx.log(`detect: ${s}`));

      if (fs.existsSync(path.join(localPath, ".git"))) {
        const hasGit = await commandExists("git");
        if (hasGit) {
          const br = await runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
            cwd: localPath,
            onLine: ctx.log,
          });
          if (br.code === 0) {
            const current = br.stdout.trim();
            ctx.log(`Shipping this folder as it is (branch ${current}). The Branch box is not used for a local folder.`);
          }
        } else {
          ctx.log("git CLI not found — using folder as-is");
        }
      }

      out.sourcePath = localPath;
      out.branch = source.branch;
      return { ok: true, message: "Source ready", outputs: { sourcePath: localPath } };
    }

    const conn = getConnection(source.gitConnectionId);
    const secrets = getSecrets(source.gitConnectionId);
    const url = conn?.config.url?.trim();
    if (!url) {
    return {
      ok: false,
        message: "Remote git needs a Git connection with config.url (repo HTTPS/SSH URL)",
      };
    }

    const dest = path.join(workRoot, ctx.runId, "src");
    const cloned = await cloneGitRepo({
      dest,
      branch: source.branch,
      url,
      token: secrets.token || secrets.password || secrets.personalAccessToken,
      username: secrets.username,
      fresh: true,
      log: ctx.log,
    });
    if (!cloned.ok) return { ok: false, message: cloned.error };

    const sourcePath = cloned.dest;
    const detection = detectStackFromDir(sourcePath);
    detection.signals.forEach((s) => ctx.log(`detect: ${s}`));
    out.sourcePath = sourcePath;
    out.branch = source.branch;
    return { ok: true, message: "Remote source cloned", outputs: { sourcePath } };
  },
};

export const infraAdapter: BoxAdapter = {
  box: "infra",
  name: "Infra (SSH / Terraform)",
  async execute(ctx) {
    const { infra } = ctx.boxes;
    const out = getRunOutputs(ctx.runId);
    const computeMode = infra.computeMode ?? "vm";

    if (infra.mode === "skip") {
      ctx.log("Infra box skipped");
      return { ok: true, skipped: true };
    }

    if (ctx.simulate) {
      if (infra.mode === "existing") {
        if ((infra.computeMode ?? "vm") === "serverless") {
          out.computeMode = "serverless";
          out.serverlessKind = infra.serverlessKind ?? "app";
          out.serviceUrl = "https://app.example.shipdeck";
          out.deployUrl = out.serviceUrl;
          out.deployHost = "app.example.shipdeck";
          return sim(ctx, [
            `Existing serverless → ${infra.cloudProvider ?? "aws"}`,
            "No SSH. Reusing the live service URL.",
            "Deploy will push the next revision to the same URL.",
          ]);
        }
        out.deployHost = "203.0.113.10";
        return sim(ctx, [
          `Connecting SSH ${infra.sshConnectionId ?? "(no connection)"}`,
          "Probing OS / Docker / firewall",
          "Ensuring Docker engine available",
          "Target server prepared",
        ]);
      }
      if (computeMode === "serverless") {
        out.computeMode = "serverless";
        const kind = infra.serverlessKind ?? "function";
        out.serverlessKind = kind;
        if (kind === "app") {
          out.serviceUrl = "https://app.example.shipdeck";
          out.apiUrl = "https://api.example.shipdeck";
          out.deployUrl = out.serviceUrl;
          out.deployHost = "app.example.shipdeck";
          return sim(
            ctx,
            [
              `Serverless Full app → ${infra.cloudProvider} ${infra.region}`,
              "Docker build/push api + web (simulate)",
              "terraform apply (ECS Express / Container Apps / Cloud Run + DB + Redis)",
              "Outputs: service_url=https://app.example.shipdeck",
              "Open /shipper on the web URL (simulate)",
            ],
            400
          );
        }
        out.serviceUrl = "https://serverless.example.shipdeck/health";
        out.deployUrl = out.serviceUrl;
        out.deployHost = "serverless.example.shipdeck";
        return sim(
          ctx,
          [
            `Serverless plan → ${infra.cloudProvider} ${infra.region} ${infra.serverlessRuntime ?? "nodejs20"}`,
            "Waiting approval gate (auto-approved in simulate)",
            "terraform apply (Lambda / Functions / Cloud Functions)",
            "Outputs: service_url=https://serverless.example.shipdeck/health",
            "Serverless ready (no VM)",
          ],
          400
        );
      }
      out.publicIp = "203.0.113.10";
      out.deployHost = "203.0.113.10";
      out.computeMode = "vm";
      return sim(
        ctx,
        [
        `Terraform plan → ${infra.cloudProvider} ${infra.region} ${infra.vmSize}`,
        "Waiting approval gate (auto-approved in simulate)",
          "terraform apply (VM + cloud-init installs Docker)",
        "Outputs: public_ip=203.0.113.10",
          "Waiting for Docker on new VM…",
          "Infra ready (Docker installed)",
        ],
        400
      );
    }

    if (infra.mode === "existing") {
      const cloudConn = infra.cloudConnectionId ? store.connections.get(infra.cloudConnectionId) : undefined;
      const serviceUrl = (cloudConn?.config.serviceUrl ?? "").trim();
      const existingServerless = (infra.computeMode ?? "vm") === "serverless" || Boolean(serviceUrl);
      if (existingServerless) {
        if (!serviceUrl) {
          return {
            ok: false,
            message:
              "Existing serverless needs the cloud connection that holds the live service URL (paste it on Build, then Approve deploy)",
          };
        }
        const parsed = parseServerlessUrl(serviceUrl);
        const prior = findActiveEnvironmentByServiceUrl(serviceUrl);
        out.computeMode = "serverless";
        out.serverlessKind = parsed?.serverlessKind ?? infra.serverlessKind ?? prior?.serverlessKind ?? "app";
        out.serviceUrl = parsed?.serviceUrl ?? serviceUrl.replace(/\/$/, "");
        out.deployUrl = out.serviceUrl;
        out.deployHost = parsed?.host ?? serviceUrl;
        out.cloudConnectionId = infra.cloudConnectionId || prior?.cloudConnectionId;
        if (prior?.tfWorkDir && fs.existsSync(prior.tfWorkDir)) {
          out.tfWorkDir = prior.tfWorkDir;
          out.infraProvisioned = true;
          ctx.log(`Reusing Terraform workspace for ${out.serviceUrl}`);
        } else {
          out.infraProvisioned = false;
          ctx.log(`No prior Terraform workspace for ${out.serviceUrl} — Deploy will still target this URL`);
        }
        return {
          ok: true,
          message: `Existing serverless ${out.serviceUrl}`,
          outputs: {
            serviceUrl: out.serviceUrl,
            deployUrl: out.deployUrl,
            deployHost: out.deployHost,
          },
        };
      }
      const target = resolveSshTarget(infra.sshConnectionId);
      if (!target?.host) {
        return { ok: false, message: "SSH connection required for existing server (live)" };
      }
      if (!target.privateKey && !target.password && !target.privateKeyPath) {
        return {
          ok: false,
          message: "SSH connection needs privateKey, privateKeyPath, or password in secrets",
        };
      }
      ctx.log(`SSH connect ${target.username}@${target.host}:${target.port ?? 22}`);
      try {
        const prepared = await prepareHostForPipeline(ctx, target);
        if (!prepared.ok) return prepared;
        out.deployHost = target.host;
        return {
          ok: true,
          message: prepared.message ?? "Remote server prepared",
          outputs: { deployHost: target.host },
        };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) };
      }
    }

    const provider = infra.cloudProvider ?? "azure";

    // ——— Serverless create (parallel path; VM logic below untouched) ———
    if (computeMode === "serverless") {
      const kind = infra.serverlessKind ?? "function";
      if (kind === "app") {
        const moduleDir = path.join(tfModulesRoot, `serverless-app-${provider}`);
        return executeServerlessAppCreate(ctx, { infra, moduleDir, workRoot });
      }
      const moduleDir = path.join(tfModulesRoot, `serverless-${provider}`);
      return executeServerlessCreate(ctx, { infra, moduleDir, workRoot });
    }

    out.computeMode = "vm";
    const moduleDir = path.join(tfModulesRoot, `vm-${provider}`);
    if (!fs.existsSync(moduleDir)) {
      return { ok: false, message: `Terraform module missing: ${moduleDir}` };
    }
    const hasTf = await commandExists("terraform");
    if (!hasTf) {
      return {
        ok: false,
        message: "terraform CLI not found on PATH — install Terraform for live infra create",
      };
    }

    const sourcePath = getRunOutputs(ctx.runId).sourcePath;
    if (sourcePath) {
      const det = detectStackFromDir(sourcePath);
      const sizing = recommendVmSize({
        stack: det.stack,
        signals: det.signals,
        compose: det.compose,
        cloudProvider: provider === "gcp" || provider === "aws" || provider === "azure" ? provider : "aws",
      });
      ctx.log(`VM sizing: ${sizing.summary}`);
      sizing.reasons.forEach((r) => ctx.log(`  · ${r}`));
      if (sizing.warning) ctx.log(`  ! ${sizing.warning}`);
    }

    const workDir = path.join(workRoot, ctx.runId, "tf");
    // Copy only real module files — never .terraform/state (Windows EPERM).
    copyTerraformModule(moduleDir, workDir);

    out.tfWorkDir = workDir;
    out.cloudConnectionId = infra.cloudConnectionId;
    out.infraProvisioned = false;

    // GCP: Deploy PEM is auto-generated per connection (no manual ssh-keygen step).
    if (provider === "gcp" && infra.cloudConnectionId) {
      if (store.ensureAutoDeployKey(infra.cloudConnectionId)) {
        ctx.log(
          "GCP SSH: auto-generated a Deploy key pair for this connection (stored encrypted, reused for future runs)"
        );
      }
    }

    const cloud = resolveCloudContext(infra.cloudConnectionId, workDir);
    if (provider === "aws") {
      const managesKey = cloud.tfvarsExtra.some((l) => l.includes("manage_key_pair = true"));
      const hasKeyName = cloud.tfvarsExtra.some((l) => l.startsWith("key_name"));
      if (!managesKey && !hasKeyName) {
        return {
          ok: false,
          message:
            "AWS Create VM needs Deploy PEM on the cloud connection (recommended) or an existing EC2 key_name in this region",
        };
      }
      if (!managesKey && cloud.sshAccess?.privateKey) {
        return {
          ok: false,
          message:
            "Deploy PEM is saved, but this computer could not read it to send the public half to AWS.",
        };
      }
      if (!managesKey && hasKeyName) {
        ctx.log(
          "AWS key_name only — key pair must already exist in this region. Paste Deploy PEM on the AWS connection to auto-import."
        );
      }
      if (managesKey) ctx.log("AWS key pair will be imported into this region from Deploy PEM");
    }
    if (provider === "gcp") {
      const hasProject = cloud.tfvarsExtra.some((l) => l.startsWith("project_id"));
      if (!hasProject) {
        return {
          ok: false,
          message: "GCP infra create needs cloud connection config.project_id",
        };
      }
    }
    if (provider === "azure" || provider === "gcp") {
      const hasPub = cloud.tfvarsExtra.some((l) => l.startsWith("ssh_public_key"));
      const hasPem = Boolean(cloud.sshAccess?.privateKey || cloud.sshAccess?.privateKeyPath);
      if (!hasPub || !hasPem) {
        return {
          ok: false,
          message:
            provider === "gcp"
              ? "GCP Create VM needs a Deploy PEM on the cloud connection — auto-generation failed; " +
                "edit the GCP connection and save again, or paste a .pem manually"
              : "Azure Create VM needs Deploy PEM on the cloud connection " +
                "(paste the .pem — Shipdeck puts the public key on the new VM and SSHes with it after create)",
        };
      }
      ctx.log(
        `${provider === "azure" ? "Azure" : "GCP"} SSH: public key from Deploy PEM will be injected on the new VM`
      );
    }

    let region = infra.region ?? (provider === "aws" ? "us-east-1" : provider === "gcp" ? "us-central1" : "eastus");
    if (provider === "gcp" && /^(eu|us|ap|sa|ca|me|af)-[a-z]+-\d+[a-z]?$/i.test(region.trim())) {
      // AWS-style leftover (e.g. eu-west-1 from an AWS pipeline) is invalid on GCP.
      const mapped: Record<string, string> = {
        "eu-west-1": "europe-west1",
        "eu-west-2": "europe-west2",
        "eu-west-3": "europe-west3",
        "eu-central-1": "europe-west3",
        "us-east-1": "us-east1",
        "us-west-1": "us-west1",
        "us-west-2": "us-west1",
        "ap-south-1": "asia-south1",
        "ap-southeast-1": "asia-southeast1",
        "ap-southeast-2": "australia-southeast1",
        "ap-northeast-1": "asia-east1",
      };
      const to = mapped[region.trim().toLowerCase()] ?? "us-central1";
      ctx.log(`GCP region: "${region}" is an AWS-style name — using GCP region "${to}" instead`);
      region = to;
    }
    // Default cloud images are ~8–30GB; ShareHaul-style compose+Next builds need more root disk.
    const diskGb = Number((infra as { diskGb?: number }).diskGb) > 0 ? Number((infra as { diskGb?: number }).diskGb) : 40;
    const vmSize =
      infra.vmSize?.trim() ||
      vmSizeForProvider(recommendVmSize({ cloudProvider: provider }), provider);
    // App ports are derived from the pipeline (deploy port + compose service
    // ports, private DB/cache ports excluded) — never a hardcoded list.
    const appPorts = (() => {
      let composePorts: number[] = [];
      const sourcePath = getRunOutputs(ctx.runId).sourcePath;
      if (sourcePath) {
        try {
          composePorts =
            detectStackFromDir(sourcePath).compose?.services.flatMap((s) => s.ports) ?? [];
        } catch {
          /* detection already logged during sizing */
        }
      }
      return splitPublishPorts(composePorts, [ctx.boxes.deploy.port]).publicPorts.slice(0, 20);
    })();
    ctx.log(
      `App ports for ${provider} firewall (from pipeline, not hardcoded): ${appPorts.join(", ") || "(none)"}`
    );
    const tfvars = [
      `region = "${region}"`,
      `vm_size = "${vmSize}"`,
      `disk_gb = ${diskGb}`,
      `app_ports = [${appPorts.join(", ")}]`,
      `name_prefix = "${runNamePrefix(ctx.runId)}"`,
      // GCP zone is NOT set here: vm-gcp discovers the region's first UP zone
      // dynamically (no hardcoded "-a"/"-b" — europe-west1 has no "-a").
      ...cloud.tfvarsExtra,
    ].join("\n");
    ctx.log(`Infra network: dedicated VPC/VNet for ${provider} (no default-network required)`);
    ctx.log(`VM root disk: ${diskGb} GB (needed for Docker image builds)`);
    fs.writeFileSync(path.join(workDir, "terraform.tfvars"), tfvars);
    ctx.log(`Terraform workspace: ${workDir}`);
    if (infra.cloudConnectionId) ctx.log(`Using cloud connection ${infra.cloudConnectionId}`);

    ctx.log("Running terraform init (provider download can take a few minutes on first run)…");
    const init = await runCommand("terraform", ["init", "-input=false"], {
      cwd: workDir,
      env: cloud.env,
      onLine: ctx.log,
      timeoutMs: 180_000,
    });
    if (init.code !== 0) return { ok: false, message: "terraform init failed" };

    // Skip re-plan when resuming after approval if plan already exists
    const planPath = path.join(workDir, "tfplan");
    if (!ctx.terraformApplyApproved || !fs.existsSync(planPath)) {
    ctx.log("Running terraform plan (AWS API calls — UI may look idle for 1–3 minutes)…");
    const plan = await runCommand("terraform", ["plan", "-input=false", "-out=tfplan"], {
      cwd: workDir,
        env: cloud.env,
      onLine: ctx.log,
      timeoutMs: 180_000,
    });
    if (plan.code !== 0) return { ok: false, message: "terraform plan failed" };
    }

    const { settings } = await import("../settings.js");
    // Ops "TF apply" ON means apply is authorized — don't pause for a second Approve click.
    const canApply = settings.tfApply || ctx.terraformApplyApproved;
    const needsGate =
      settings.requireApprovalForTf && !settings.tfApply && !ctx.terraformApplyApproved;

    if (needsGate || !canApply) {
      ctx.log(
        canApply
          ? "Terraform plan ready — waiting for operator approval to apply"
          : "Terraform plan ready — enable tfApply in settings or approve apply"
      );
      return {
        ok: true,
        needsApproval: true,
        approvalKind: "terraform_apply",
        message: "Waiting for approval to run terraform apply",
      };
    }

    const apply = await runCommand("terraform", ["apply", "-input=false", "tfplan"], {
      cwd: workDir,
      env: cloud.env,
      onLine: ctx.log,
      timeoutMs: 600_000,
    });
    if (apply.code !== 0) return { ok: false, message: "terraform apply failed" };

    out.infraProvisioned = true;

    const output = await runCommand("terraform", ["output", "-raw", "public_ip"], {
      cwd: workDir,
      env: cloud.env,
      onLine: ctx.log,
    });
    if (output.code !== 0 || !output.stdout.trim()) {
      return { ok: false, message: "Infra created but public_ip output missing" };
    }

      out.publicIp = output.stdout.trim();
      out.deployHost = out.publicIp;
      ctx.log(`public_ip=${out.publicIp}`);
    ctx.log("VM created with cloud-init that installs Docker — verifying…");

    const userOut = await runCommand("terraform", ["output", "-raw", "admin_username"], {
      cwd: workDir,
      env: cloud.env,
    });
    const adminUser =
      userOut.code === 0 && userOut.stdout.trim()
        ? userOut.stdout.trim()
        : provider === "aws"
          ? "ubuntu"
          : "shipdeck";

    const target = resolveProvisionedSshTarget({
      host: out.publicIp,
      sshConnectionId: infra.sshConnectionId,
      cloudSsh: cloud.sshAccess
        ? { ...cloud.sshAccess, username: cloud.sshAccess.username || adminUser }
        : undefined,
    });

    if (!target || (!target.privateKey && !target.password && !target.privateKeyPath)) {
      ctx.log(
        "WARNING: No SSH private key to enter the new VM. " +
          "Enterprise setup: add the Deploy PEM on the AWS/Azure/GCP cloud connection " +
          "(same key pair attached to the VM). You do not need an existing SSH server."
      );
      return {
        ok: true,
        message:
          "Infra created (Docker via cloud-init). Add Deploy PEM on the cloud connection to deploy automatically.",
      };
    }

    if (!infra.sshConnectionId) target.username = adminUser;

    out.sshUser = target.username;
    out.sshPrivateKey = target.privateKey;
    out.sshPrivateKeyPath = target.privateKeyPath;
    out.sshPort = String(target.port ?? 22);

    // Save a reusable SSH connection for this new public IP (enterprise handoff).
    try {
      const { store } = await import("../store.js");
      const saved = store.createConnection({
        name: `VM ${out.publicIp}`,
        type: "ssh",
        config: {
          host: out.publicIp,
          port: "22",
          user: target.username,
        },
        secrets: {
          ...(target.privateKey ? { privateKey: target.privateKey } : {}),
          ...(target.privateKeyPath ? { privateKeyPath: target.privateKeyPath } : {}),
        },
      });
      out.sshConnectionIdCreated = saved.id;
      const run = store.runs.get(ctx.runId);
      const pipeline = run ? store.pipelines.get(run.pipelineId) : undefined;
      if (pipeline) {
        pipeline.boxes = {
          ...pipeline.boxes,
          infra: {
            ...pipeline.boxes.infra,
            sshConnectionId: saved.id,
            // Keep mode as create for this run's intent; user can switch to existing later.
          },
        };
        pipeline.updatedAt = new Date().toISOString();
        store.setPipeline(pipeline);
      }
      ctx.log(
        `Saved SSH connection "${saved.name}" (${saved.id}) — use Infra → Existing SSH next time`
      );
    } catch (e) {
      ctx.log(`Could not auto-save SSH connection: ${e instanceof Error ? e.message : String(e)}`);
    }

    const dockerReady = await waitForDockerOnNewVm(target, ctx.log);
    if (!dockerReady.ok) return { ok: false, message: dockerReady.message };

    const prepared = await prepareHostForPipeline(ctx, target);
    if (!prepared.ok) return prepared;

    return {
      ok: true,
      message: prepared.message ?? "Infra created and host runtime is ready",
      outputs: { deployHost: out.publicIp, publicIp: out.publicIp },
    };
  },
};

export const buildAdapter: BoxAdapter = {
  box: "build",
  name: "Build / CI",
  async execute(ctx) {
    const { build, infra } = ctx.boxes;
    const out = getRunOutputs(ctx.runId);
    const version = resolveDockerReleaseTag(imageVersionForRegistry(build));
    if (build.registryConnectionId && !version.ok) {
      return { ok: false, message: version.message };
    }
    const releaseTag = version.ok ? version.tag : "v1.0.0";
    const localTag = `${safeName(build.imageName || "app")}:shipdeck-${runSuffix(ctx.runId, 8)}`;

    // Serverless packages/images at Infra/Deploy — skip Build so VM compose builds stay unchanged
    if ((infra.computeMode ?? "vm") === "serverless" || out.computeMode === "serverless") {
      const kind = infra.serverlessKind ?? out.serverlessKind ?? "function";
      if (kind === "app") {
        ctx.log("Build skipped for serverless Full app (Docker images built in Infra / Deploy)");
        if (build.registryConnectionId) {
          out.releaseTag = releaseTag;
          ctx.log(`Docker Hub is selected. Those images are also pushed as ${releaseTag}.`);
        }
        return {
          ok: true,
          skipped: true,
          message: "Skipped — serverless app builds images in Infra / Deploy",
        };
      }
      ctx.log("Build skipped for serverless (function zip is built in Infra / Deploy)");
      if (build.registryConnectionId) {
        ctx.log("A health function has no Docker image, so nothing is pushed to Docker Hub.");
      }
      return { ok: true, skipped: true, message: "Skipped — serverless uses function package" };
    }

    if (ctx.simulate) {
      out.imageTag = localTag;
      const dfHint =
        ctx.boxes.deploy.runtime === "compose"
          ? "Compose: service Dockerfiles are built at Deploy (not a single root Dockerfile)"
          : `Using Dockerfile: ${build.dockerfilePath ?? "Dockerfile"}`;
      return sim(ctx, [
        dfHint,
        build.runTests ? "Running tests…" : "Tests skipped",
        `docker build -t ${localTag} .`,
        build.registryConnectionId
          ? `Pushing ${releaseTag}. Next ship is ${incrementDockerReleaseTag(releaseTag)}`
          : "No registry push",
        "Build artifact ready (simulate)",
      ]);
    }

    const sourcePath = out.sourcePath;
    if (!sourcePath) return { ok: false, message: "No sourcePath from Source step" };

    const composeMode = ctx.boxes.deploy.runtime === "compose";
    const testChoice = build.testChoice === "recommended" ? "generated" : build.testChoice;
    const shouldTest = testChoice === "generated" || testChoice === "existing" || (testChoice !== "skip" && build.runTests);
    // Compose deploys build/test inside Docker on the VM — local npm ci + Jest on Windows often hangs for 15+ min.
    if (shouldTest && composeMode && testChoice !== "existing") {
      ctx.log(
        "Compose runtime: skipping local npm ci / Jest (slow on Windows). Images build on the VM at Deploy."
      );
    } else if (shouldTest) {
      if (testChoice === "generated") {
        const wrote = writeShipdeckTests(sourcePath);
        if (wrote.written.length) ctx.log(`Wrote Shipdeck tests: ${wrote.written.join(", ")}`);
        else {
          const planned = planGeneratedTests(sourcePath);
          if (!planned.length) ctx.log("Generated tests already match source — nothing new to write");
        }
      }
      const discovered = discoverTests(sourcePath).filter((d) => !d.placeholder);
      if (testChoice === "generated" || testChoice === "existing") {
        ctx.log(
          testChoice === "generated"
            ? "Running tests (Shipdeck generated + repo runner)"
            : "Running existing repo tests"
        );
        let ran = 0;
        for (const d of discovered) {
          if (d.kind !== "npm") {
            ctx.log(`test: ${d.command}  [${d.dir}] — ${d.detail}`);
            const cwd = path.join(sourcePath, d.dir === "." ? "" : d.dir);
            const parts = d.command.split(" ");
            const test = await runCommand(parts[0], parts.slice(1), {
              cwd,
              onLine: ctx.log,
              timeoutMs: 300_000,
            });
            if (test.code !== 0) return { ok: false, message: `Tests failed in ${d.dir}` };
            ran += 1;
            continue;
          }
          const cwd = path.join(sourcePath, d.dir === "." ? "" : d.dir);
          const pkgPath = path.join(cwd, "package.json");
          let scripts: Record<string, string> = {};
          let jestRoot = ".";
          let jestRe = /.*\.(spec|test)\.(t|j)sx?$/;
          try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
              scripts?: Record<string, string>;
              jest?: { rootDir?: string; testRegex?: string };
            };
            scripts = pkg.scripts ?? {};
            if (pkg.jest?.rootDir) jestRoot = pkg.jest.rootDir;
            if (pkg.jest?.testRegex) jestRe = new RegExp(pkg.jest.testRegex);
          } catch {
            /* ignore */
          }
          const unitRoot = path.join(cwd, jestRoot === "." ? "" : jestRoot);
          let unitFiles: string[] = [];
          const walk = (p: string, depth: number) => {
            if (depth > 6 || unitFiles.length > 20) return;
            let entries: fs.Dirent[] = [];
            try {
              entries = fs.readdirSync(p, { withFileTypes: true });
            } catch {
              return;
            }
            for (const e of entries) {
              if (e.name === "node_modules" || e.name === "dist" || e.name.startsWith(".")) continue;
              const full = path.join(p, e.name);
              if (e.isDirectory()) walk(full, depth + 1);
              else if (jestRe.test(e.name)) unitFiles.push(full);
            }
          };
          if (fs.existsSync(unitRoot)) walk(unitRoot, 0);
          if (testChoice === "existing") {
            unitFiles = unitFiles.filter((f) => path.basename(f) !== "shipdeck.smoke.spec.ts");
          }
          if (unitFiles.length === 0 && scripts["test:e2e"] && testChoice === "existing") {
            ctx.log(`test: npm run test:e2e  [${d.dir}] — no unit specs, using existing e2e`);
            const test = await runCommand("npm", ["run", "test:e2e"], {
              cwd,
              onLine: ctx.log,
              timeoutMs: 300_000,
            });
            if (test.code !== 0) return { ok: false, message: `Tests failed in ${d.dir}` };
            ran += 1;
            continue;
          }
          if (unitFiles.length === 0) {
            ctx.log(`Skipping npm test in ${d.dir} — jest would find no unit tests`);
            continue;
          }
          if (!scripts.test || /no test specified/i.test(scripts.test)) {
            ctx.log(`Skipping npm test in ${d.dir} — no test script`);
            continue;
          }
          const inst = await ensureNpmInstall(cwd, ctx.log);
          if (!inst.ok) return inst;
          if (testChoice === "generated") {
            const smokeFile =
              unitFiles.find((f) => path.basename(f) === "shipdeck.smoke.spec.ts") ??
              path.join(cwd, "src", "shipdeck.smoke.spec.ts");
            const smokeRel = path.relative(cwd, smokeFile).replace(/\\/g, "/");
            ctx.log(`test: jest ${smokeRel}  [${d.dir}] — ${d.detail}`);
            const test = await runCommand("npm", ["exec", "--", "jest", "--runInBand", smokeRel], {
              cwd,
              onLine: ctx.log,
              timeoutMs: 300_000,
            });
            if (test.code !== 0) return { ok: false, message: `Tests failed in ${d.dir}` };
            ran += 1;
            continue;
          }
          ctx.log(`test: npm test --if-present  [${d.dir}] — ${d.detail}`);
          const test = await runCommand("npm", ["test", "--if-present"], {
            cwd,
            onLine: ctx.log,
            timeoutMs: 300_000,
          });
          if (test.code !== 0) return { ok: false, message: `Tests failed in ${d.dir}` };
          ran += 1;
        }
        if (!ran) ctx.log("No runnable tests for this choice");
      } else if (fs.existsSync(path.join(sourcePath, "package.json"))) {
        const pkgRaw = fs.readFileSync(path.join(sourcePath, "package.json"), "utf8");
        let testScript = "";
        try {
          testScript = String(JSON.parse(pkgRaw)?.scripts?.test ?? "");
        } catch {
          testScript = "";
        }
        const placeholder =
          /no test specified/i.test(testScript) || testScript.trim() === "";
        if (placeholder) {
          ctx.log("Skipping npm test — package.json has no real test script");
        } else {
          const inst = await ensureNpmInstall(sourcePath, ctx.log);
          if (!inst.ok) return inst;
      ctx.log("Running npm test (if defined)");
      const test = await runCommand("npm", ["test", "--if-present"], {
        cwd: sourcePath,
        onLine: ctx.log,
        timeoutMs: 300_000,
      });
      if (test.code !== 0) return { ok: false, message: "Tests failed" };
        }
      }
    }

    if (build.dockerfileChoice === "generated") {
      const wrote = writeShipdeckDockerfiles(sourcePath, { forceGenerated: true });
      if (wrote.written.length) ctx.log(`Wrote generated Dockerfiles: ${wrote.written.join(", ")}`);
    }
    const existingDockerfiles = discoverDockerfiles(sourcePath).filter((d) => d.valid);
    const repoDockerfiles = existingDockerfiles.filter((d) => !d.generated);
    const listed =
      (build.dockerfileChoice === "generated"
        ? existingDockerfiles.filter((d) => d.generated)
        : repoDockerfiles
      ).map((d) => d.path);

    if (composeMode) {
      if (listed.length) {
        ctx.log(`Using repo Dockerfiles (compose will build them at Deploy): ${listed.join(", ")}`);
      } else if (repoDockerfiles.length) {
        ctx.log(
          `Using repo Dockerfiles (compose will build them at Deploy): ${repoDockerfiles.map((d) => d.path).join(", ")}`
        );
      } else {
        ctx.log("No Dockerfile in source — Deploy/compose may still build from generated files");
      }
      if (build.registryConnectionId) {
        const ready = registryReady(build.registryConnectionId, build.imageName);
        if (!ready.ok) return { ok: false, message: ready.message };
        out.releaseTag = releaseTag;
        ctx.log(`This ship pushes ${releaseTag}. The next ship pushes ${incrementDockerReleaseTag(releaseTag)}.`);
      }
      out.imageTag = localTag;
      return { ok: true, message: "Build / CI complete — Compose builds images at Deploy" };
    }

    let dockerfile = build.dockerfilePath || "Dockerfile";
    if (build.dockerfileChoice === "generated") {
      const generated = existingDockerfiles.find((d) => d.generated);
      if (generated) dockerfile = generated.path;
    } else if (!fs.existsSync(path.join(sourcePath, dockerfile))) {
      if (repoDockerfiles.length === 1) {
        dockerfile = repoDockerfiles[0].path;
        ctx.log(`Using discovered Dockerfile: ${dockerfile}`);
      } else if (repoDockerfiles.length > 1) {
        return {
          ok: false,
          message: `No ${dockerfile}. Found ${repoDockerfiles
            .map((d) => d.path)
            .join(", ")}. Open Build → Review Dockerfiles vs source and choose which to use.`,
        };
      }
    }
    const dfPath = path.join(sourcePath, dockerfile);
    if (!fs.existsSync(dfPath)) {
      return {
        ok: false,
        message: `Dockerfile not found at ${dfPath}. Open Build → Review Dockerfiles vs source.`,
      };
    }

    const hasDocker = await commandExists("docker");
    if (!hasDocker) {
      ctx.log("Local Docker not found — will build on remote during Deploy if SSH available");
      out.imageTag = localTag;
      return { ok: true, message: "Build deferred to remote host" };
    }

    ctx.log(`docker build -t ${localTag} -f ${dockerfile} ${sourcePath}`);
    const built = await runCommand(
      "docker",
      ["build", "-t", localTag, "-f", dockerfile, sourcePath],
      { onLine: ctx.log, timeoutMs: 600_000 }
    );
    if (built.code !== 0) return { ok: false, message: "docker build failed" };

    out.imageTag = localTag;

    if (build.registryConnectionId) {
      const ready = registryReady(build.registryConnectionId, build.imageName);
      if (!ready.ok) return { ok: false, message: ready.message };
      const remoteTag = registryImageName(ready.registry, ready.repository, releaseTag);
      const logged = await loginDocker(ctx, ready.registry, ready.user, ready.pass);
      if (!logged.ok) return logged;
      ctx.log(`docker tag ${localTag} ${remoteTag}`);
      const tag = await runCommand("docker", ["tag", localTag, remoteTag], { onLine: ctx.log });
      if (tag.code !== 0) return { ok: false, message: "docker tag failed" };
      ctx.log(`docker push ${remoteTag}`);
      const push = await runCommand("docker", ["push", remoteTag], {
        onLine: ctx.log,
        timeoutMs: 600_000,
      });
      if (push.code !== 0) return { ok: false, message: "docker push failed" };
      out.registryImage = remoteTag;
      out.imageTag = remoteTag;
      out.releaseTag = releaseTag;
      saveNextImageVersion(ctx, releaseTag);
      return { ok: true, message: `Built and pushed ${remoteTag}` };
    }

    return { ok: true, message: `Built ${localTag}`, outputs: { imageTag: localTag } };
  },
};

async function deployCompose(
  ctx: AdapterContext,
  sourcePath: string,
  host: string | undefined,
  target: ReturnType<typeof resolveSshTarget>
): Promise<AdapterResult> {
  const out = getRunOutputs(ctx.runId);
  const detected = detectStackFromDir(sourcePath);
  const noAppPorts = !detected.compose?.suggestedPort;
  const choice = ctx.boxes.deploy.composeChoice;
  if (choice === "generated") {
    ctx.log("Operator chose Shipdeck-generated compose");
    const gen = writeShipdeckCompose(sourcePath);
    gen.written.forEach((f) => ctx.log(`wrote ${f}`));
    ctx.log(gen.message);
    if (gen.apps[0] && (noAppPorts || ctx.boxes.deploy.port === 5432 || ctx.boxes.deploy.port === 6379)) {
      ctx.boxes = {
        ...ctx.boxes,
        deploy: { ...ctx.boxes.deploy, port: gen.apps[0].port, runtime: "compose", composeChoice: "generated" },
      };
    }
  } else if (!detected.compose && choice !== "existing") {
    ctx.log("No compose file — generating docker-compose.shipdeck.yml from source");
    const gen = writeShipdeckCompose(sourcePath);
    gen.written.forEach((f) => ctx.log(`wrote ${f}`));
    ctx.log(gen.message);
  } else if (noAppPorts && choice !== "existing") {
    return {
      ok: false,
      message:
        "Existing docker-compose.yml does not match the source (likely databases only). Open Source → Review compose, then Keep existing or Use generated.",
    };
  }
  const composeFile =
    choice === "existing"
      ? originalComposeFile(sourcePath)
      : choice === "generated"
        ? (fs.existsSync(path.join(sourcePath, SHIPDECK_COMPOSE_FILE))
            ? SHIPDECK_COMPOSE_FILE
            : findComposeFile(sourcePath))
        : findComposeFile(sourcePath);
  if (!composeFile) {
    return { ok: false, message: "Compose runtime needs docker-compose.yml in source" };
  }
  ctx.log(`Using compose file: ${composeFile}`);

  const health = composeVerifyTarget({
    services: detected.compose?.services,
    suggestedPort: detected.compose?.suggestedPort,
    suggestedPrimaryService: detected.compose?.suggestedPrimaryService,
    fallbackPort: ctx.boxes.deploy.port,
    fallbackPath: ctx.boxes.deploy.healthPath,
  });
  ctx.boxes = {
    ...ctx.boxes,
    deploy: {
      ...ctx.boxes.deploy,
      port: health.port,
      healthPath: health.path,
      runtime: "compose",
    },
  };
  ctx.log(`Health target for Verify: ${health.reason}`);

  if (!target || !host) {
    const localCompose = path.join(sourcePath, composeFile);
    const stamped = stampRelease(ctx, localCompose);
    if (stamped && !stamped.ok) return stamped;
    const up = await runCommand("docker", ["compose", "-f", composeFile, "up", "-d", "--build"], {
      cwd: sourcePath,
      onLine: ctx.log,
      timeoutMs: 600_000,
    });
    if (up.code !== 0) return { ok: false, message: "docker compose up failed" };
    if (stamped?.ok && stamped.services.length) {
      const logged = await loginDocker(ctx, stamped.registry, stamped.user, stamped.pass, sourcePath);
      if (!logged.ok) {
        return { ok: false, message: `The app is running, but ${stamped.tag} was not pushed. The version was not increased.` };
      }
      ctx.log(`docker compose push ${stamped.services.join(" ")} (${stamped.tag})`);
      const pushed = await runCommand("docker", ["compose", "-f", composeFile, "push", ...stamped.services], {
        cwd: sourcePath,
        onLine: ctx.log,
        timeoutMs: 600_000,
      });
      if (pushed.code !== 0) {
        return { ok: false, message: `The app is running, but ${stamped.tag} was not pushed. The version was not increased.` };
      }
      out.registryImage = registryImageName(stamped.registry, stamped.repository, stamped.tag, stamped.services.length === 1 ? undefined : stamped.services[0]);
      out.imageTag = out.registryImage;
      saveNextImageVersion(ctx, stamped.tag);
    }
    out.deployHost = "127.0.0.1";
    out.deployUrl = `http://127.0.0.1:${health.port}${health.path}`;
    return { ok: true, message: "Deployed via docker compose (local)" };
  }

  const apiPort =
    detected.compose?.services.find((s) => /api/i.test(s.name))?.ports.find((p) => p !== 5432 && p !== 6379) ??
    3000;
  const publicApi = host ? `http://${host}:${apiPort}/v1` : "";
  const absCompose = path.join(sourcePath, composeFile);
  let projectName = "shipdeck";
  if (publicApi) {
    ctx.log(`Next.js public API URL for this host: ${publicApi}`);
    const prep = prepareComposeForDeploy(absCompose, publicApi);
    projectName = prep.projectName;
    if (prep.publicApiRewrites) {
      ctx.log(`Patched ${prep.publicApiRewrites} localhost API URL(s) in ${composeFile} → ${publicApi}`);
    }
    if (prep.restartAdded) {
      ctx.log(`Added restart: unless-stopped on ${prep.restartAdded} service(s)`);
    }
  } else {
    const prep = prepareComposeForDeploy(absCompose, "http://127.0.0.1:3000/v1");
    projectName = prep.projectName;
    if (prep.restartAdded) {
      ctx.log(`Added restart: unless-stopped on ${prep.restartAdded} service(s)`);
    }
  }
  const stamped = stampRelease(ctx, absCompose);
  if (stamped && !stamped.ok) return stamped;
  if (stamped?.ok && stamped.services.length) {
    ctx.log(`This ship tags ${stamped.services.join(", ")} as ${stamped.tag}`);
  }

  const remoteApp = remoteShipdeckDir(target, ctx.runId);
  ctx.log(`Uploading source to ${host}:${remoteApp}`);
  try {
    await sshUploadDir(target, sourcePath, remoteApp, ctx.log);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }

  const named = containerNamesFromCompose(absCompose);
  if (named.length) {
    ctx.log(`Removing existing containers so names can be reused: ${named.join(", ")}`);
  }
  const rmOld = named.length
    ? `(docker rm -f ${named.join(" ")} 2>/dev/null || sudo docker rm -f ${named.join(" ")} 2>/dev/null || true); `
    : "";
  const envExport = publicApi ? `export NEXT_PUBLIC_API_URL='${publicApi}'; ` : "";
  // Resolve compose binary first — bare `docker compose -p` fails with "unknown shorthand flag: 'p'"
  // when the compose plugin is missing (docker treats -p as its own flag).
  const resolveCompose =
    `if docker compose version >/dev/null 2>&1; then C='docker compose'; ` +
    `elif command -v docker-compose >/dev/null 2>&1; then C='docker-compose'; ` +
    `elif sudo docker compose version >/dev/null 2>&1; then C='sudo -E docker compose'; ` +
    `elif sudo command -v docker-compose >/dev/null 2>&1; then C='sudo -E docker-compose'; ` +
    `else echo 'Docker Compose not installed on this VM' >&2; exit 1; fi; `;
  // Stable -p so each new run folder does not leave orphan named containers from a different project.
  const composeBin = (extra: string) =>
    `${resolveCompose}$C -p ${projectName} -f ${composeFile} ${extra}`;
  const upCmd =
    `cd '${remoteApp}' && ${envExport}` +
    `(${composeBin("down --remove-orphans")}) || true; ` +
    `${rmOld}` +
    `${composeBin("up -d --build --force-recreate --remove-orphans")}`;
  ctx.log(`Starting compose on remote host (project=${projectName}, docker compose or docker-compose)`);
  ctx.log("First build on a new VM can take 45–90 minutes (api + Next.js images). Waiting…");
  let remote: { code: number; stdout: string; stderr: string };
  const composeTimeoutMs = 5_400_000; // 90 minutes — ShareHaul first build on small AWS VMs is slow
  try {
    remote = await sshExec(target, upCmd, ctx.log, composeTimeoutMs);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/timed out/i.test(msg)) {
      return {
        ok: false,
        message:
          "Remote Docker build timed out after 90 minutes. On the VM, check: docker ps -a && docker images. Next run is often faster (layer cache). Or use a larger AWS instance.",
      };
    }
    return { ok: false, message: msg };
  }
  if (remote.code !== 0) return { ok: false, message: "Remote docker compose failed" };
  if (stamped?.ok && stamped.services.length) {
    const b64 = Buffer.from(stamped.pass, "utf8").toString("base64");
    const feed = `printf '%s' ${shellQuote(b64)} | base64 -d`;
    const login =
      `(${feed} | docker login ${shellQuote(stamped.registry)} -u ${shellQuote(stamped.user)} --password-stdin) || ` +
      `(${feed} | sudo -E docker login ${shellQuote(stamped.registry)} -u ${shellQuote(stamped.user)} --password-stdin)`;
    ctx.log(`Pushing ${stamped.tag} to ${stamped.registry}`);
    const pushed = await sshExec(
      target,
      `cd '${remoteApp}' && ${login} && ${composeBin(`push ${stamped.services.join(" ")}`)}`,
      ctx.log,
      600_000
    );
    if (pushed.code !== 0) {
      return {
        ok: false,
        message: `The app is running, but ${stamped.tag} was not pushed. The version was not increased.`,
      };
    }
    out.registryImage = registryImageName(
      stamped.registry,
      stamped.repository,
      stamped.tag,
      stamped.services.length === 1 ? undefined : stamped.services[0]
    );
    out.imageTag = out.registryImage;
    saveNextImageVersion(ctx, stamped.tag);
  }
  // Show container status so Verify failures are easier to diagnose.
  // Best-effort only: a slow sshd right after a heavy build must not fail
  // the deploy — Verify (HTTP health) is the real gate.
  await sshExec(
    target,
    `cd '${remoteApp}' && (docker compose -f ${composeFile} ps || docker-compose -f ${composeFile} ps || sudo docker compose -f ${composeFile} ps || true)`,
    ctx.log
  ).catch((err) => {
    ctx.log(
      `Could not fetch container status over SSH (continuing to Verify): ${err instanceof Error ? err.message : String(err)}`
    );
  });
  out.deployHost = host;
  out.deployUrl = `http://${host}:${health.port}${health.path}`;
  ctx.log(`Deploy URL (Verify will use this): ${out.deployUrl}`);
  return { ok: true, message: "Deployed via docker compose (remote)" };
}

async function deploySystemd(
  ctx: AdapterContext,
  sourcePath: string,
  host: string | undefined,
  target: ReturnType<typeof resolveSshTarget>
): Promise<AdapterResult> {
  const out = getRunOutputs(ctx.runId);
  if (!target || !host) {
    return { ok: false, message: "systemd deploy requires an SSH target (Infra existing)" };
  }

  const port = ctx.boxes.deploy.port;
  const plan = resolveAppRuntimePlan(sourcePath, port);
  plan.signals.forEach((s) => ctx.log(`runtime-detect: ${s}`));
  if (plan.language === "unknown") {
    return {
      ok: false,
      message:
        "systemd could not detect app language from files (need package.json, requirements.txt, pom.xml/gradle, go.mod, or index.html). Prefer Docker deploy instead.",
    };
  }

  // Ensure matching runtime on host (detected, not hardcoded)
  const prepared = await prepareHostForPipeline(ctx, target);
  if (!prepared.ok) return prepared;

  const remoteApp = remoteShipdeckDir(target, ctx.runId);
  try {
    await sshUploadDir(target, sourcePath, remoteApp, ctx.log);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
  const unit = runScopedName("shipdeck", ctx.runId, 8);
  const prepare = plan.prepareCommands.map((c) => c).join(" && ");
  const script = [
    `cd ${remoteApp}`,
    prepare ? prepare : "true",
    `cat > /tmp/${unit}.service <<'EOF'`,
    `[Unit]`,
    `Description=Shipdeck ${unit} (${plan.language})`,
    `After=network.target`,
    `[Service]`,
    `WorkingDirectory=${remoteApp}`,
    `Environment=PORT=${port}`,
    `ExecStart=${plan.execStart}`,
    `Restart=on-failure`,
    `[Install]`,
    `WantedBy=multi-user.target`,
    `EOF`,
    `sudo mv /tmp/${unit}.service /etc/systemd/system/${unit}.service`,
    `sudo systemctl daemon-reload`,
    `sudo systemctl enable --now ${unit}`,
  ].join("\n");
  const remote = await sshExec(target, script, ctx.log);
  if (remote.code !== 0) return { ok: false, message: "systemd unit deploy failed" };
  out.deployHost = host;
  out.deployUrl = `http://${host}:${port}${ctx.boxes.deploy.healthPath}`;
  out.containerName = unit;
  return {
    ok: true,
    message: `Deployed systemd unit ${unit} as ${plan.language}`,
  };
}

export const deployAdapter: BoxAdapter = {
  box: "deploy",
  name: "Deploy",
  async execute(ctx) {
    const { deploy, infra } = ctx.boxes;
    const out = getRunOutputs(ctx.runId);

    if (ctx.simulate) {
      if ((infra.computeMode ?? "vm") === "serverless" || out.computeMode === "serverless") {
        const kind = infra.serverlessKind ?? out.serverlessKind ?? "function";
        out.deployUrl =
          out.serviceUrl ??
          (kind === "app"
            ? "https://app.example.shipdeck"
            : "https://serverless.example.shipdeck/health");
        return sim(ctx, [
          `Runtime: serverless (${kind})`,
          kind === "app"
            ? "Refreshing container images (simulate)"
            : "Updating function package (simulate)",
          `Endpoint ${out.deployUrl}`,
        ]);
      }
      out.deployUrl = `http://203.0.113.10:${deploy.port}${deploy.healthPath}`;
      out.containerName = runScopedName("shipdeck", ctx.runId, 8);
      return sim(ctx, [
        `Runtime: ${deploy.runtime}`,
        `Deploying ${out.imageTag ?? "app:latest"}`,
        "Deploy complete (simulate)",
      ]);
    }

    if ((infra.computeMode ?? "vm") === "serverless" || out.computeMode === "serverless") {
      return deployServerlessCode(ctx);
    }

      const sourcePath = out.sourcePath;
    const target = resolveDeploySsh(infra, out);
    const host = out.deployHost || target?.host;

    if (!target || !host) {
      if (deploy.runtime === "systemd") {
        return {
          ok: false,
          message: "systemd deploy needs a remote Linux host (Infra = existing SSH or create VM)",
        };
      }
      if (deploy.runtime === "docker" || deploy.runtime === "compose") {
        const local = await ensureLocalRuntime(deploy.runtime, ctx.log);
        if (!local.ok) return { ok: false, message: local.message };
      }
      if (deploy.runtime === "kubernetes" && !out.kubeconfigPath) {
        const local = await ensureLocalRuntime("kubernetes", ctx.log);
        if (!local.ok) return { ok: false, message: local.message };
      }
    } else if (deploy.runtime === "kubernetes" && !out.kubeconfigPath) {
      const prepared = await prepareHostForPipeline(ctx, target);
      if (!prepared.ok) return prepared;
    }

    // Prefer Compose whenever a compose file exists — even if UI still says Docker.
    const composeFile =
      sourcePath &&
      ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"].find((f) =>
        fs.existsSync(path.join(sourcePath, f))
      );
    if (composeFile && (deploy.runtime === "docker" || deploy.runtime === "compose")) {
      if (deploy.runtime === "docker") {
        ctx.log(
          `Found ${composeFile} — auto-switching Deploy to Compose (all services from the file)`
        );
      }
      if (!sourcePath) return { ok: false, message: "No sourcePath for compose deploy" };
      if (!target || !host) {
        const local = await ensureLocalRuntime("compose", ctx.log);
        if (!local.ok) return { ok: false, message: local.message };
      }
      const fromFile = detectStackFromDir(sourcePath);
      let effectivePort = deploy.port;
      if (fromFile.compose) {
        fromFile.compose.services.forEach((s) => {
          const ports = s.ports.length ? ` ports ${s.ports.join(", ")}` : " (no host ports)";
          ctx.log(`compose service: ${s.name}${ports}`);
        });
        if (fromFile.compose.suggestedPort > 0) {
          effectivePort = fromFile.compose.suggestedPort;
          if (effectivePort !== deploy.port) {
            ctx.log(
              `Health URL port from compose (${fromFile.compose.suggestedPrimaryService ?? "service"}): ${effectivePort} (UI had ${deploy.port})`
            );
          }
        }
      }
      const composeCtx: AdapterContext = {
        ...ctx,
        boxes: {
          ...ctx.boxes,
          deploy: { ...ctx.boxes.deploy, runtime: "compose", port: effectivePort },
        },
      };
      return deployCompose(composeCtx, sourcePath, host, target);
    }

    if (deploy.runtime === "compose") {
      if (!sourcePath) return { ok: false, message: "No sourcePath for compose deploy" };
      return deployCompose(ctx, sourcePath, host, target);
    }

    if (deploy.runtime === "systemd") {
      if (!sourcePath) return { ok: false, message: "No sourcePath for systemd deploy" };
      return deploySystemd(ctx, sourcePath, host, target);
    }

    if (deploy.runtime === "kubernetes") {
      ctx.log("Kubernetes deploy expects manifests in ./k8s");
      if (!sourcePath || !fs.existsSync(path.join(sourcePath, "k8s"))) {
        return { ok: false, message: "No k8s/ directory in source for kubectl apply" };
      }
      const env = { ...process.env };
      if (out.kubeconfigPath) {
        env.KUBECONFIG = out.kubeconfigPath;
        ctx.log(`Using kubeconfig from infra bootstrap: ${out.kubeconfigPath}`);
      } else {
        const kube = getConnection(infra.kubernetesConnectionId);
        const kubeSecrets = getSecrets(infra.kubernetesConnectionId);
        if (kubeSecrets.kubeconfig) {
          const kc = writeKubeconfigFile(workRoot, ctx.runId, kubeSecrets.kubeconfig);
          env.KUBECONFIG = kc;
        } else if (kube?.config.kubeconfigPath) {
          env.KUBECONFIG = kube.config.kubeconfigPath;
        }
      }
      if (!(await commandExists("kubectl"))) {
        return {
          ok: false,
          message:
            "kubectl not found on the Shipdeck API machine. Install kubectl, or use Infra SSH/Create so k3s + kubeconfig are prepared.",
        };
      }
      const apply = await runCommand("kubectl", ["apply", "-f", path.join(sourcePath, "k8s")], {
        onLine: ctx.log,
        env,
      });
      if (apply.code !== 0) return { ok: false, message: "kubectl apply failed" };
      const rollout = await runCommand(
        "kubectl",
        ["rollout", "status", "deployment", "--all", "--timeout=120s"],
        { onLine: ctx.log, env, timeoutMs: 130_000 }
      );
      if (rollout.code !== 0) {
        ctx.log("kubectl rollout status incomplete — apply already done; check cluster");
      }
      if (host) {
        out.deployHost = host;
        out.deployUrl = `http://${host}:${deploy.port}${deploy.healthPath}`;
      }
      return { ok: true, message: "Kubernetes manifests applied" };
    }

    // docker runtime
    out.containerName = "shipdeck-app";
    out.previousContainerName = runScopedName("shipdeck-prev", ctx.runId);
    const image = out.imageTag || "app:latest";
    const envArgs = envPairs({
      ...deploy.envVars,
      ...(out.databaseUrl
        ? { [ctx.boxes.data.connectionStringEnv || "DATABASE_URL"]: out.databaseUrl }
        : {}),
      PORT: String(deploy.port),
    });

    if (!target || !host) {
      const hasDocker = await commandExists("docker");
      if (hasDocker && out.imageTag) {
        ctx.log(`Local docker run on port ${deploy.port}`);
        await runCommand(
          "docker",
          ["rename", "shipdeck-app", out.previousContainerName],
          { onLine: ctx.log }
        ).catch(() => undefined);
        await runCommand("docker", ["rm", "-f", "shipdeck-app"], { onLine: ctx.log });
        const run2 = await runCommand(
          "docker",
          [
            "run",
            "-d",
            "--name",
            "shipdeck-app",
            ...envArgs,
            "-p",
            `${deploy.port}:${deploy.port}`,
            image,
          ],
          { onLine: ctx.log }
        );
        if (run2.code !== 0) return { ok: false, message: "local docker run failed" };
        out.deployHost = "127.0.0.1";
        out.deployUrl = `http://127.0.0.1:${deploy.port}${deploy.healthPath}`;
        return { ok: true, message: "Deployed locally via Docker" };
      }

      if (sourcePath && fs.existsSync(path.join(sourcePath, "package.json"))) {
        ctx.log("Docker unavailable — starting local Node process fallback");
        const hasNpm = await commandExists("npm");
        if (!hasNpm) return { ok: false, message: "Neither Docker nor npm available for local deploy" };
        await runCommand("npm", ["install", "--omit=dev"], {
          cwd: sourcePath,
          onLine: ctx.log,
          timeoutMs: 180_000,
        });
        const child = spawn(process.execPath, ["server.js"], {
            cwd: sourcePath,
          env: {
            ...process.env,
            PORT: String(deploy.port),
            ...(out.databaseUrl
              ? { [ctx.boxes.data.connectionStringEnv || "DATABASE_URL"]: out.databaseUrl }
              : {}),
            ...deploy.envVars,
          },
            detached: true,
            stdio: "ignore",
        });
        child.unref();
        out.deployHost = "127.0.0.1";
        out.deployUrl = `http://127.0.0.1:${deploy.port}${deploy.healthPath}`;
        ctx.log(`Started node pid=${child.pid} → ${out.deployUrl}`);
        await sleep(800);
        return { ok: true, message: "Deployed locally via Node process" };
      }

      return { ok: false, message: "Need SSH target, Docker, or a Node package.json for deploy" };
    }

    try {
      const remoteApp = remoteShipdeckDir(target, ctx.runId);
      if (sourcePath) {
        ctx.log(`Uploading source to ${host}:${remoteApp}`);
        try {
          await sshUploadDir(target, sourcePath, remoteApp, ctx.log);
        } catch (err) {
          return { ok: false, message: err instanceof Error ? err.message : String(err) };
        }
      }

      const dockerfile = ctx.boxes.build.dockerfilePath || "Dockerfile";
      const envExport = Object.entries({
        ...deploy.envVars,
        ...(out.databaseUrl
          ? { [ctx.boxes.data.connectionStringEnv || "DATABASE_URL"]: out.databaseUrl }
          : {}),
      })
        .map(([k, v]) => `-e ${k}=${JSON.stringify(v)}`)
        .join(" ");

      ctx.log("Building/running on remote via Docker");
      const script = [
        `cd ${remoteApp}`,
        out.registryImage
          ? `docker pull ${out.registryImage}`
          : `docker build -t ${image} -f ${dockerfile} .`,
        `docker rename shipdeck-app shipdeck-prev || true`,
        `docker rm -f shipdeck-app || true`,
        `docker run -d --name shipdeck-app --restart unless-stopped ${envExport} -p ${deploy.port}:${deploy.port} ${out.registryImage || image}`,
      ].join(" && ");
      const remote = await sshExec(target, script, ctx.log);
      if (remote.code !== 0) return { ok: false, message: "Remote docker deploy failed" };

      out.containerName = "shipdeck-app";
      out.previousContainerName = "shipdeck-prev";
      out.deployHost = host;
      out.deployUrl = `http://${host}:${deploy.port}${deploy.healthPath}`;
      ctx.log(`Deploy URL: ${out.deployUrl}`);
      return { ok: true, message: "Deployed to remote Docker host" };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  },
};

const DB_IMAGES: Record<string, { image: string; port: number; env: string[]; url: (p: number) => string }> = {
  postgres: {
    image: "postgres:16-alpine",
    port: 5432,
    env: ["POSTGRES_PASSWORD=shipdeck", "POSTGRES_USER=shipdeck", "POSTGRES_DB=app"],
    url: (p) => `postgres://shipdeck:shipdeck@127.0.0.1:${p}/app`,
  },
  mysql: {
    image: "mysql:8",
    port: 3306,
    env: ["MYSQL_ROOT_PASSWORD=shipdeck", "MYSQL_DATABASE=app"],
    url: (p) => `mysql://root:shipdeck@127.0.0.1:${p}/app`,
  },
  redis: {
    image: "redis:7-alpine",
    port: 6379,
    env: [],
    url: (p) => `redis://127.0.0.1:${p}`,
  },
  mongodb: {
    image: "mongo:7",
    port: 27017,
    env: [],
    url: (p) => `mongodb://127.0.0.1:${p}/app`,
  },
};

export const dataAdapter: BoxAdapter = {
  box: "data",
  name: "Data",
  async execute(ctx) {
    const { data, infra } = ctx.boxes;
    if (!data.enabled) {
      ctx.log("Data box disabled — skip");
      return { ok: true, skipped: true };
    }
    if (ctx.simulate) {
      return sim(ctx, [
        data.createWithTerraform
          ? `Provision ${data.engine ?? "postgres"} via ${data.provisionMode ?? "docker"} (simulate)`
          : `Using existing ${data.engine ?? "database"}`,
        "Data ready (simulate)",
      ]);
    }

    const out = getRunOutputs(ctx.runId);
    const engine = data.engine ?? "postgres";
    const spec = DB_IMAGES[engine];
    if (!spec) return { ok: false, message: `Unknown engine ${engine}` };

    if (!data.createWithTerraform) {
      ctx.log(`Expecting env ${data.connectionStringEnv ?? "DATABASE_URL"} on deploy target`);
      return { ok: true, message: "Using external database configuration" };
    }

    const mode = data.provisionMode ?? "docker";
    if (mode === "terraform") {
      if (engine !== "postgres") {
    return {
      ok: false,
          message: "Managed Terraform DB modules currently support postgres only",
        };
      }
      const provider = infra.cloudProvider ?? "azure";
      const moduleName =
        provider === "aws" ? "db-aws-rds" : provider === "gcp" ? "db-gcp-sql" : "db-azure-postgres";
      const moduleDir = path.join(tfModulesRoot, moduleName);
      if (!fs.existsSync(moduleDir)) {
        return { ok: false, message: `Missing Terraform module ${moduleName}` };
      }
      const hasTf = await commandExists("terraform");
      if (!hasTf) return { ok: false, message: "terraform CLI required for managed DB" };

      const workDir = path.join(workRoot, ctx.runId, "tf-db");
      copyTerraformModule(moduleDir, workDir);
      const cloudId = data.cloudConnectionId || infra.cloudConnectionId;
      const cloud = resolveCloudContext(cloudId, workDir);
      if (provider === "gcp" && !cloud.tfvarsExtra.some((l) => l.startsWith("project_id"))) {
        return { ok: false, message: "GCP managed DB needs project_id on cloud connection" };
      }
      const dbSku = recommendManagedDbSku({
        provider,
        vmSize: infra.vmSize,
        memoryMb: infra.serverlessMemoryMb,
      });
      const skuLines =
        provider === "aws"
          ? [`instance_class = "${dbSku.instanceClass}"`]
          : provider === "gcp"
            ? [`tier = "${dbSku.gcpTier}"`]
            : [`sku_name = "${dbSku.azureSku}"`];
      const tfvars = [
        `region = "${infra.region ?? "eastus"}"`,
        `name_prefix = "${runNamePrefix(ctx.runId, "db")}"`,
        ...skuLines,
        ...cloud.tfvarsExtra,
      ].join("\n");
      fs.writeFileSync(path.join(workDir, "terraform.tfvars"), tfvars);

      const { settings } = await import("../settings.js");
      const init = await runCommand("terraform", ["init", "-input=false"], {
        cwd: workDir,
        env: cloud.env,
        onLine: ctx.log,
        timeoutMs: 180_000,
      });
      if (init.code !== 0) return { ok: false, message: "terraform init (db) failed" };
      const plan = await runCommand("terraform", ["plan", "-input=false", "-out=tfplan"], {
        cwd: workDir,
        env: cloud.env,
        onLine: ctx.log,
        timeoutMs: 180_000,
      });
      if (plan.code !== 0) return { ok: false, message: "terraform plan (db) failed" };

      if (!settings.tfApply && !ctx.terraformApplyApproved) {
        return {
          ok: true,
          needsApproval: true,
          approvalKind: "terraform_apply",
          message: "DB terraform plan ready — approve to apply managed database",
        };
      }

      const apply = await runCommand("terraform", ["apply", "-input=false", "tfplan"], {
        cwd: workDir,
        env: cloud.env,
        onLine: ctx.log,
        timeoutMs: 600_000,
      });
      if (apply.code !== 0) return { ok: false, message: "terraform apply (db) failed" };
      const urlOut = await runCommand("terraform", ["output", "-raw", "connection_url"], {
        cwd: workDir,
        env: cloud.env,
        onLine: ctx.log,
      });
      if (urlOut.code === 0 && urlOut.stdout.trim()) {
        out.databaseUrl = urlOut.stdout.trim();
        ctx.log(`DATABASE_URL set from terraform output`);
      }
      return { ok: true, message: `Managed ${engine} provisioned via Terraform` };
    }

    const hasDocker = await commandExists("docker");
    const name = `shipdeck-db-${engine}`;
    const hostPort = spec.port;
    const target = resolveDeploySsh(infra, out);
    const remoteHost = out.deployHost || target?.host;

    if (target && remoteHost && infra.mode !== "skip") {
      const envFlags = spec.env.map((e) => `-e ${e}`).join(" ");
      const script = [
        `docker rm -f ${name} || true`,
        `docker run -d --name ${name} --restart unless-stopped ${envFlags} -p ${hostPort}:${spec.port} ${spec.image}`,
      ].join(" && ");
      ctx.log(`Starting ${engine} on remote ${remoteHost}`);
      const r = await sshExec(target, script, ctx.log);
      if (r.code !== 0) return { ok: false, message: `Remote ${engine} start failed` };
      out.databaseUrl = spec.url(hostPort).replace("127.0.0.1", remoteHost);
      ctx.log(`DATABASE_URL=${out.databaseUrl}`);
      return { ok: true, message: `${engine} running on remote` };
    }

    if (!hasDocker) {
      return { ok: false, message: "Docker required to provision data engines locally" };
    }
    ctx.log(`Starting ${engine} via Docker (${spec.image})`);
    await runCommand("docker", ["rm", "-f", name], { onLine: ctx.log });
    const args = ["run", "-d", "--name", name, "--restart", "unless-stopped"];
    for (const e of spec.env) args.push("-e", e);
    args.push("-p", `${hostPort}:${spec.port}`, spec.image);
    const started = await runCommand("docker", args, { onLine: ctx.log, timeoutMs: 180_000 });
    if (started.code !== 0) return { ok: false, message: `Failed to start ${engine}` };
    out.databaseUrl = spec.url(hostPort);
    await sleep(2500);
    ctx.log(`DATABASE_URL=${out.databaseUrl}`);
    return { ok: true, message: `${engine} provisioned locally` };
  },
};

async function rollbackDeploy(ctx: AdapterContext): Promise<void> {
  const { deploy, infra } = ctx.boxes;
  const out = getRunOutputs(ctx.runId);

  // Compose + Create-VM: infra destroy (orchestrator) is the real rollback.
  // Do not attempt shipdeck-app rename — that only applies to single-container docker deploy.
  if (deploy.runtime === "compose") {
    ctx.log("Auto-rollback skipped for compose (VM/infra rollback handles Create VM)");
    return;
  }

  ctx.log("Auto-rollback: restoring previous release");

  if (deploy.runtime === "systemd" && out.containerName) {
    const target = resolveDeploySsh(infra, out);
    if (target) {
      await sshExec(target, `sudo systemctl stop ${out.containerName} || true`, ctx.log);
    }
    return;
  }

  const target = resolveDeploySsh(infra, out);
  const host = out.deployHost || target?.host;
  if (target && host) {
    await sshExec(
      target,
      [
        "docker rm -f shipdeck-app || true",
        "docker rename shipdeck-prev shipdeck-app || true",
        "docker start shipdeck-app || true",
      ].join(" && "),
      ctx.log
    );
    return;
  }

  if (await commandExists("docker")) {
    const prev = out.previousContainerName || runScopedName("shipdeck-prev", ctx.runId);
    await runCommand("docker", ["rm", "-f", "shipdeck-app"], { onLine: ctx.log });
    await runCommand("docker", ["rename", prev, "shipdeck-app"], {
      onLine: ctx.log,
    }).catch(() => undefined);
    await runCommand("docker", ["start", "shipdeck-app"], { onLine: ctx.log }).catch(() => undefined);
  }
}

export const verifyAdapter: BoxAdapter = {
  box: "verify",
  name: "Verify",
  async execute(ctx) {
    const { verify, deploy } = ctx.boxes;
    const out = getRunOutputs(ctx.runId);

    if (ctx.simulate) {
      return sim(ctx, [
        `GET ${out.deployUrl || `http://203.0.113.10:${deploy.port}${deploy.healthPath}`}`,
        "HTTP 200 OK",
        "Verify passed (simulate)",
      ]);
    }

    const sourcePath = out.sourcePath;
    const detected = sourcePath ? detectStackFromDir(sourcePath) : null;
    const health = composeVerifyTarget({
      services: detected?.compose?.services,
      suggestedPort: detected?.compose?.suggestedPort,
      suggestedPrimaryService: detected?.compose?.suggestedPrimaryService,
      fallbackPort: deploy.port,
      fallbackPath: deploy.healthPath,
    });

    const primary = resolveVerifyHealthUrl({
      override: verify.healthUrl?.trim(),
      host: out.deployHost,
      port: health.port,
      healthPath: health.path,
      deployUrl: out.deployUrl,
      primaryService: health.primaryService,
    });
    if (!primary) return { ok: false, message: "No health URL available" };

    // Candidates come ONLY from this pipeline: the configured health URL,
    // deploy/service URLs, and compose-detected service ports. No hardcoded
    // fallback ports — probing ports that were never deployed hides the
    // real error and burns the whole timeout.
    const servicePorts = splitPublishPorts(
      detected?.compose?.services.flatMap((s) => s.ports) ?? []
    ).publicPorts;
    const candidates = buildVerifyCandidates({
      primary,
      deployUrl: out.deployUrl,
      serviceUrl: out.serviceUrl,
      deployHost: out.deployHost,
      computeMode: out.computeMode,
      serverlessKind: out.serverlessKind ?? ctx.boxes.infra.serverlessKind,
      apiUrl: out.apiUrl,
      servicePorts,
    });

    ctx.log(`Probing ${candidates[0]} (timeout ${verify.timeoutSeconds}s); fallbacks: ${candidates.slice(1).join(", ") || "none"}`);
    const deadline =
      Date.now() +
      Math.max(
        verify.timeoutSeconds,
        out.computeMode === "serverless"
          ? out.serverlessKind === "app" || ctx.boxes.infra.serverlessKind === "app"
            ? 180
            : 90
          : 0
      ) * 1000;
    const isServerless = out.computeMode === "serverless";
    let lastErr = "";
    let candidateIdx = 0;
    // VM deploys: any HTTP response (<500) proves a server is listening on a
    // real pipeline port — e.g. 404 on /health just means the app has no
    // health endpoint. Remember the first such response; once every
    // candidate has been tried, the app counts as up.
    let respondedUrl = "";
    let respondedStatus = 0;
    const tried = new Set<string>();
    while (Date.now() < deadline) {
      const url = candidates[candidateIdx % candidates.length];
      tried.add(url);
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
        ctx.log(`HTTP ${res.status} ← ${url}`);
        if (res.ok) {
          out.deployUrl = url;
          return { ok: true, message: `Health check passed (${url})` };
        }
        lastErr = `HTTP ${res.status} from ${url}`;
        if (!isServerless && isRespondingStatus(res.status) && !respondedUrl) {
          respondedUrl = url;
          respondedStatus = res.status;
          ctx.log(
            `App is responding (HTTP ${res.status}) — server is up; continuing to check other URLs for a 2xx`
          );
        }
        if (res.status === 403 && isServerless) {
          ctx.log("HTTP 403 on serverless — waiting for IAM / API Gateway to become public…");
        }
        // Try next candidate on 404 (wrong path) or 403 (IAM lag / wrong URL)
        if (res.status === 404 || res.status === 403) candidateIdx += 1;
      } catch (err) {
        lastErr = err instanceof Error ? err.message : String(err);
        ctx.log(`Retry: ${lastErr} ← ${url}`);
        candidateIdx += 1;
      }
      // Every real URL tried and at least one answered: the app is up, it
      // just has no 2xx health endpoint. Don't roll back a working deploy.
      if (!isServerless && respondedUrl && tried.size >= candidates.length) {
        out.deployUrl = respondedUrl;
        return {
          ok: true,
          message: `App responding (${respondedUrl} → HTTP ${respondedStatus}; no 2xx health endpoint, server is up)`,
        };
      }
      await sleep(isServerless ? 3000 : 2000);
    }
    if (!isServerless && respondedUrl) {
      out.deployUrl = respondedUrl;
      return {
        ok: true,
        message: `App responding (${respondedUrl} → HTTP ${respondedStatus}; no 2xx health endpoint, server is up)`,
      };
    }
    if (verify.autoRollback) {
      try {
        await rollbackDeploy(ctx);
        ctx.log("Auto-rollback completed");
      } catch (err) {
        ctx.log(`Auto-rollback error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    const hint =
      out.computeMode === "serverless" && /HTTP 403/.test(lastErr)
        ? " Lambda Function URLs are often blocked at account level — Shipdeck now uses API Gateway HTTP API. Re-run after this fix."
        : "";
    return { ok: false, message: `Health check failed: ${lastErr}${hint}` };
  },
};

export const notifyAdapter: BoxAdapter = {
  box: "notify",
  name: "Notify",
  async execute(ctx) {
    const { notify } = ctx.boxes;
    if (!notify.enabled) {
      ctx.log("Notify disabled — skip");
      return { ok: true, skipped: true };
    }
    if (ctx.simulate) {
      return sim(ctx, ["Notification delivered (simulate)"]);
    }
    const conn = getConnection(notify.notifyConnectionId);
    const secrets = getSecrets(notify.notifyConnectionId);
    const webhook = conn?.config.endpoint || secrets.webhook;
    if (!webhook) return { ok: false, message: "Notify connection missing webhook/endpoint" };
    const out = getRunOutputs(ctx.runId);
    const body = {
      text: `Shipdeck run ${ctx.runId}: deploy ${out.deployUrl ?? out.deployHost ?? "n/a"}`,
    };
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    ctx.log(`Webhook status ${res.status}`);
    if (!res.ok) return { ok: false, message: `Notify webhook failed: ${res.status}` };
    return { ok: true, message: "Notification sent" };
  },
};

export const adapters: BoxAdapter[] = [
  sourceAdapter,
  infraAdapter,
  buildAdapter,
  deployAdapter,
  dataAdapter,
  verifyAdapter,
  notifyAdapter,
];
