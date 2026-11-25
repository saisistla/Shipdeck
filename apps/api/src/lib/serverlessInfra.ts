import fs from "node:fs";
import path from "node:path";
import type { InfraBoxConfig } from "@shipdeck/shared";
import { commandExists, runCommand } from "./exec.js";
import { buildServerlessZip } from "./serverlessPackage.js";
import { resolveServerlessCloudContext } from "./serverlessCloud.js";
import { runNamePrefix } from "./naming.js";
import { copyTerraformModule } from "./tfModuleCopy.js";
import { getRunOutputs } from "../runtime/context.js";
import type { PipelineBoxes } from "@shipdeck/shared";
import {
  deployServerlessApp,
  executeServerlessAppCreate,
} from "./serverlessAppDeploy.js";

export { executeServerlessAppCreate, deployServerlessApp };

export interface ServerlessAdapterContext {
  boxes: PipelineBoxes;
  runId: string;
  log: (line: string) => void;
  simulate: boolean;
  terraformApplyApproved?: boolean;
}

export interface ServerlessAdapterResult {
  ok: boolean;
  skipped?: boolean;
  message?: string;
  outputs?: Record<string, string>;
  needsApproval?: boolean;
  approvalKind?: string;
}

function awsRuntime(rt: string | undefined): string {
  return rt === "python312" ? "python3.12" : "nodejs20.x";
}

/**
 * Create managed serverless HTTP compute (Lambda / Azure Functions / Cloud Functions).
 * Parallel to Create VM — does not use SSH or Deploy PEM.
 */
export async function executeServerlessCreate(
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
      message: "Serverless create needs a cloud connection (AWS / Azure / GCP credentials)",
    };
  }

  const hasTf = await commandExists("terraform");
  if (!hasTf) {
    return {
      ok: false,
      message: "terraform CLI not found on PATH — install Terraform for serverless create",
    };
  }

  if (!fs.existsSync(moduleDir)) {
    return { ok: false, message: `Terraform module missing: ${moduleDir}` };
  }

  const workDir = path.join(workRoot, ctx.runId, "tf");
  copyTerraformModule(moduleDir, workDir);

  out.tfWorkDir = workDir;
  out.cloudConnectionId = infra.cloudConnectionId;
  out.infraProvisioned = false;
  out.computeMode = "serverless";
  out.serverlessKind = "function";

  const runtime = infra.serverlessRuntime ?? "nodejs20";
  const memory = infra.serverlessMemoryMb && infra.serverlessMemoryMb > 0 ? infra.serverlessMemoryMb : 512;
  const timeout =
    infra.serverlessTimeoutSeconds && infra.serverlessTimeoutSeconds > 0
      ? infra.serverlessTimeoutSeconds
      : 30;

  ctx.log(
    `Serverless create → ${provider} · runtime=${runtime} · memory=${memory}MB · timeout=${timeout}s`
  );
  ctx.log("No VM / SSH / Deploy PEM required for this path");

  const packed = buildServerlessZip({
    workDir,
    sourcePath: out.sourcePath,
    runtime: provider === "azure" && runtime === "python312" ? "nodejs20" : runtime,
    provider,
    log: ctx.log,
  });
  if (provider === "azure" && runtime === "python312") {
    ctx.log("Azure serverless MVP uses Node 20 host — Python package mapped to Node health function");
  }

  const cloud = resolveServerlessCloudContext(infra.cloudConnectionId, workDir);
  if (provider === "gcp") {
    const hasProject = cloud.tfvarsExtra.some((l) => l.startsWith("project_id"));
    if (!hasProject) {
      return { ok: false, message: "GCP serverless needs cloud connection config.project_id" };
    }
  }

  const region =
    infra.region ??
    (provider === "aws" ? "us-east-1" : provider === "gcp" ? "us-central1" : "eastus");

  const tfvars = [
    `region = "${region}"`,
    `name_prefix = "${runNamePrefix(ctx.runId)}"`,
    `memory_mb = ${memory}`,
    `timeout_seconds = ${timeout}`,
    // Relative path avoids Windows absolute-path + filebase64sha256 inconsistency
    `source_zip = "${packed.zipRelPath}"`,
    `source_code_hash = "${packed.sourceCodeHash}"`,
    `content_md5 = "${provider === "azure" ? packed.contentMd5Base64 : packed.contentMd5Hex}"`,
    `runtime = "${provider === "aws" ? awsRuntime(runtime) : runtime}"`,
    ...cloud.tfvarsExtra,
  ].join("\n");
  fs.writeFileSync(path.join(workDir, "terraform.tfvars"), tfvars);
  ctx.log(`Terraform workspace: ${workDir}`);

  const init = await runCommand("terraform", ["init", "-input=false"], {
    cwd: workDir,
    env: cloud.env,
    onLine: ctx.log,
    timeoutMs: 180_000,
  });
  if (init.code !== 0) return { ok: false, message: "terraform init failed (serverless)" };

  const planPath = path.join(workDir, "tfplan");
  if (!ctx.terraformApplyApproved || !fs.existsSync(planPath)) {
    const plan = await runCommand("terraform", ["plan", "-input=false", "-out=tfplan"], {
      cwd: workDir,
      env: cloud.env,
      onLine: ctx.log,
      timeoutMs: 180_000,
    });
    if (plan.code !== 0) return { ok: false, message: "terraform plan failed (serverless)" };
  }

  const { settings } = await import("../settings.js");
  // Ops "TF apply" ON means apply is authorized — don't pause for a second Approve click.
  const canApply = settings.tfApply || ctx.terraformApplyApproved;
  const needsGate =
    settings.requireApprovalForTf && !settings.tfApply && !ctx.terraformApplyApproved;

  if (needsGate || !canApply) {
    ctx.log(
      canApply
        ? "Serverless plan ready — waiting for operator approval to apply"
        : "Serverless plan ready — enable tfApply in settings or approve apply"
    );
    return {
      ok: true,
      needsApproval: true,
      approvalKind: "terraform_apply",
      message: "Waiting for approval to run terraform apply (serverless)",
    };
  }

  const apply = await runCommand("terraform", ["apply", "-input=false", "tfplan"], {
    cwd: workDir,
    env: cloud.env,
    onLine: ctx.log,
    timeoutMs: 600_000,
  });
  if (apply.code !== 0) return { ok: false, message: "terraform apply failed (serverless)" };

  out.infraProvisioned = true;

  const urlOut = await runCommand("terraform", ["output", "-raw", "service_url"], {
    cwd: workDir,
    env: cloud.env,
  });
  if (urlOut.code !== 0 || !urlOut.stdout.trim()) {
    return { ok: false, message: "Serverless created but service_url output missing" };
  }

  const serviceUrl = urlOut.stdout.trim().replace(/\/$/, "");
  out.serviceUrl = serviceUrl;
  out.deployUrl = serviceUrl.includes("/api/health")
    ? serviceUrl
    : `${serviceUrl}${serviceUrl.endsWith("/") ? "" : "/"}`;
  // Verify uses deployHost+port OR deployUrl — set a host for logging
  try {
    out.deployHost = new URL(serviceUrl).host;
  } catch {
    out.deployHost = serviceUrl;
  }

  ctx.log(`service_url=${serviceUrl}`);
  ctx.log("Serverless HTTP endpoint is live — Deploy will refresh function code; Verify hits the URL");

  return {
    ok: true,
    message: `Serverless ready: ${serviceUrl}`,
    outputs: { serviceUrl, deployUrl: out.deployUrl ?? serviceUrl },
  };
}

/** Re-package + terraform apply to push latest function code (Deploy step). */
export async function deployServerlessCode(
  ctx: ServerlessAdapterContext
): Promise<ServerlessAdapterResult> {
  const { infra } = ctx.boxes;
  const out = getRunOutputs(ctx.runId);
  const kind = infra.serverlessKind ?? out.serverlessKind ?? "function";
  if (kind === "app") {
    return deployServerlessApp(ctx);
  }

  const workDir = out.tfWorkDir;
  if (!workDir || !fs.existsSync(workDir)) {
    return {
      ok: false,
      message: "Serverless deploy needs Infra create in this run (missing Terraform workspace)",
    };
  }

  const provider = infra.cloudProvider ?? "aws";
  const runtime = infra.serverlessRuntime ?? "nodejs20";
  ctx.log("Serverless Deploy — rebuilding package and applying Terraform");

  const packed = buildServerlessZip({
    workDir,
    sourcePath: out.sourcePath,
    runtime: provider === "azure" && runtime === "python312" ? "nodejs20" : runtime,
    provider,
    log: ctx.log,
  });

  const cloud = resolveServerlessCloudContext(infra.cloudConnectionId, workDir);
  const tfvarsPath = path.join(workDir, "terraform.tfvars");
  let tfvars = fs.existsSync(tfvarsPath) ? fs.readFileSync(tfvarsPath, "utf8") : "";
  const upsert = (key: string, value: string) => {
    const re = new RegExp(`${key}\\s*=\\s*"[^"]*"`);
    if (re.test(tfvars)) tfvars = tfvars.replace(re, `${key} = "${value}"`);
    else tfvars += `\n${key} = "${value}"\n`;
  };
  upsert("source_zip", packed.zipRelPath);
  upsert("source_code_hash", packed.sourceCodeHash);
  upsert(
    "content_md5",
    provider === "azure" ? packed.contentMd5Base64 : packed.contentMd5Hex
  );
  fs.writeFileSync(tfvarsPath, tfvars);

  const apply = await runCommand(
    "terraform",
    ["apply", "-input=false", "-auto-approve"],
    {
      cwd: workDir,
      env: cloud.env,
      onLine: ctx.log,
      timeoutMs: 600_000,
    }
  );
  if (apply.code !== 0) return { ok: false, message: "Serverless code deploy (terraform apply) failed" };

  const urlOut = await runCommand("terraform", ["output", "-raw", "service_url"], {
    cwd: workDir,
    env: cloud.env,
  });
  if (urlOut.code === 0 && urlOut.stdout.trim()) {
    const serviceUrl = urlOut.stdout.trim().replace(/\/$/, "");
    out.serviceUrl = serviceUrl;
    out.deployUrl = serviceUrl.includes("/api/health")
      ? serviceUrl
      : `${serviceUrl}${serviceUrl.endsWith("/") ? "" : "/"}`;
    try {
      out.deployHost = new URL(serviceUrl).host;
    } catch {
      out.deployHost = serviceUrl;
    }
  }

  return {
    ok: true,
    message: `Serverless function updated → ${out.deployUrl ?? out.serviceUrl}`,
    outputs: {
      deployUrl: out.deployUrl ?? "",
      serviceUrl: out.serviceUrl ?? "",
    },
  };
}
