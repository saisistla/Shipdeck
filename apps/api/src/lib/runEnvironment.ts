import fs from "node:fs";
import path from "node:path";
import type { Pipeline, PipelineRun, RunEnvironment } from "@shipdeck/shared";
import { sameServiceUrl } from "@shipdeck/shared";
import { getRunOutputs } from "../runtime/context.js";
import { store } from "../store.js";
import { shipdeckWorkRoot } from "./gitSource.js";
import { destroyProvisionedInfra, terraformStateHasResources } from "./infraDestroy.js";
import { runCommand } from "./exec.js";
import { resolveCloudContext } from "./cloud.js";

/** Find a still-active serverless environment that already serves this URL. */
export function findActiveEnvironmentByServiceUrl(serviceUrl: string): RunEnvironment | undefined {
  const matches = [...store.runs.values()]
    .map((run) => run.environment)
    .filter((env): env is RunEnvironment =>
      Boolean(env?.serviceUrl && env.status !== "destroyed" && sameServiceUrl(env.serviceUrl, serviceUrl))
    );
  return matches.find((env) => env.tfWorkDir && env.status === "active") ?? matches[0];
}

/** Snapshot in-memory provision outputs onto the persisted run (after Infra Create). */
export function attachEnvironmentFromOutputs(
  run: PipelineRun,
  pipeline: Pipeline
): void {
  const out = getRunOutputs(run.id);
  if (!out.infraProvisioned || !out.tfWorkDir) return;
  run.environment = {
    provisioned: true,
    status: "active",
    publicIp: out.publicIp,
    deployHost: out.deployHost || out.publicIp || out.serviceUrl,
    provider: pipeline.boxes.infra.cloudProvider,
    region: pipeline.boxes.infra.region,
    cloudConnectionId: out.cloudConnectionId || pipeline.boxes.infra.cloudConnectionId,
    sshConnectionId: out.sshConnectionIdCreated || pipeline.boxes.infra.sshConnectionId,
    tfWorkDir: out.tfWorkDir,
    computeMode: out.computeMode ?? pipeline.boxes.infra.computeMode ?? "vm",
    serverlessKind: out.serverlessKind ?? pipeline.boxes.infra.serverlessKind,
    serviceUrl: out.serviceUrl || out.deployUrl,
  };
}

/** Recover environment metadata for older successful runs that still have TF state on disk. */
export async function ensureRunEnvironment(run: PipelineRun): Promise<RunEnvironment | undefined> {
  if (run.environment?.status === "destroyed") {
    const workDir = run.environment.tfWorkDir;
    if (workDir && (await terraformStateHasResources(workDir))) {
      run.environment = {
        ...run.environment,
        status: "active",
        destroyedAt: undefined,
        destroyError: undefined,
      };
      store.setRun(run);
    }
    return run.environment;
  }
  if (run.environment?.provisioned && run.environment.tfWorkDir) {
    const has = await terraformStateHasResources(run.environment.tfWorkDir);
    // Timeout can leave destroy_failed even after AWS/state are already empty.
    if (!has && (run.environment.status === "active" || run.environment.status === "destroy_failed")) {
      run.environment = {
        ...run.environment,
        status: "destroyed",
        destroyedAt: run.environment.destroyedAt || new Date().toISOString(),
        destroyError: undefined,
      };
      store.setRun(run);
    }
    return run.environment;
  }

  const workDir = path.join(shipdeckWorkRoot, run.id, "tf");
  if (!(await terraformStateHasResources(workDir))) return run.environment;

  const pipeline = store.pipelines.get(run.pipelineId);
  let publicIp = run.environment?.publicIp;
  let serviceUrl = run.environment?.serviceUrl;
  try {
    const cloud = resolveCloudContext(pipeline?.boxes.infra.cloudConnectionId, workDir);
    if (!publicIp) {
      const out = await runCommand("terraform", ["output", "-raw", "public_ip"], {
        cwd: workDir,
        env: cloud.env,
        timeoutMs: 60_000,
      });
      if (out.code === 0 && out.stdout.trim()) publicIp = out.stdout.trim();
    }
    if (!serviceUrl) {
      const out = await runCommand("terraform", ["output", "-raw", "service_url"], {
        cwd: workDir,
        env: cloud.env,
        timeoutMs: 60_000,
      });
      if (out.code === 0 && out.stdout.trim()) serviceUrl = out.stdout.trim();
    }
  } catch {
    /* ignore */
  }

  // Prefer SSH connection whose host matches the public IP
  let sshConnectionId = run.environment?.sshConnectionId || pipeline?.boxes.infra.sshConnectionId;
  if (publicIp) {
    const match = [...store.connections.values()].find(
      (c) => c.type === "ssh" && c.config.host === publicIp
    );
    if (match) sshConnectionId = match.id;
  }

  const computeMode =
    run.environment?.computeMode ||
    pipeline?.boxes.infra.computeMode ||
    (serviceUrl && !publicIp ? "serverless" : "vm");

  run.environment = {
    provisioned: true,
    status: "active",
    publicIp,
    deployHost: publicIp || serviceUrl,
    provider: pipeline?.boxes.infra.cloudProvider,
    region: pipeline?.boxes.infra.region,
    cloudConnectionId: pipeline?.boxes.infra.cloudConnectionId,
    sshConnectionId,
    tfWorkDir: workDir,
    computeMode,
    serverlessKind:
      run.environment?.serverlessKind || pipeline?.boxes.infra.serverlessKind,
    serviceUrl,
  };
  store.setRun(run);
  return run.environment;
}

export async function destroyRunEnvironment(
  runId: string,
  actor?: string
): Promise<{ ok: boolean; run?: PipelineRun; message: string }> {
  const run = store.runs.get(runId);
  if (!run) return { ok: false, message: "Run not found" };

  const env = await ensureRunEnvironment(run);
  if (!env?.provisioned) {
    return { ok: false, message: "This run did not create a cloud environment (or it is already gone)" };
  }
  if (env.status === "destroyed") {
    return { ok: false, message: "Environment already destroyed" };
  }
  if (env.status === "destroying") {
    return { ok: false, message: "Destroy already in progress" };
  }
  if (!env.tfWorkDir || !fs.existsSync(env.tfWorkDir)) {
    return { ok: false, message: "Terraform workspace missing — destroy from cloud console if needed" };
  }

  run.environment = { ...env, status: "destroying", destroyError: undefined };
  const logLines: string[] = [];
  const log = (line: string) => {
    logLines.push(line);
    const infraStep = run.steps.find((s) => s.box === "infra");
    if (infraStep) {
      infraStep.logs.push(line);
    }
    store.persistSoon();
  };
  log(
    `[teardown] Operator ${actor ?? "operator"} requested environment destroy` +
      (env.publicIp ? ` for ${env.publicIp}` : "")
  );
  store.setRun(run);

  const result = await destroyProvisionedInfra({
    workDir: env.tfWorkDir,
    cloudConnectionId: env.cloudConnectionId,
    sshConnectionIdCreated: env.sshConnectionId,
    publicIp: env.publicIp,
    tag: "teardown",
    log,
  });

  const latest = store.runs.get(runId);
  if (!latest?.environment) return { ok: false, message: "Run lost during destroy" };

  if (result.ok) {
    latest.environment = {
      ...latest.environment,
      status: "destroyed",
      destroyedAt: new Date().toISOString(),
      destroyError: undefined,
    };
    // Clear pipeline pointer to destroyed SSH host so next Create is clean
    const pipeline = store.pipelines.get(latest.pipelineId);
    if (pipeline && env.sshConnectionId && pipeline.boxes.infra.sshConnectionId === env.sshConnectionId) {
      pipeline.boxes = {
        ...pipeline.boxes,
        infra: { ...pipeline.boxes.infra, sshConnectionId: undefined },
      };
      pipeline.updatedAt = new Date().toISOString();
      store.setPipeline(pipeline);
    }
    store.setRun(latest);
    return { ok: true, run: latest, message: result.message };
  }

  latest.environment = {
    ...latest.environment,
    status: "destroy_failed",
    destroyError: result.message,
  };
  store.setRun(latest);
  return { ok: false, run: latest, message: result.message };
}
