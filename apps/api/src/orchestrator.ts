import { nanoid } from "nanoid";
import type { Pipeline, PipelineRun, RunStep } from "@shipdeck/shared";
import {
  BOX_LABELS,
  PIPELINE_BOX_ORDER,
  recommendVmSize,
  recommendServerlessSize,
} from "@shipdeck/shared";
import { adapters } from "./adapters/index.js";
import { audit } from "./audit.js";
import { detectStack, detectStackFromDir } from "./detection.js";
import { captureContainerFailureLogs } from "./lib/containerFailureLogs.js";
import { destroyProvisionedInfra, terraformStateHasResources } from "./lib/infraDestroy.js";
import { attachEnvironmentFromOutputs } from "./lib/runEnvironment.js";
import { clearRunOutputs, getRunOutputs } from "./runtime/context.js";
import { settings } from "./settings.js";
import { store } from "./store.js";

const cancelled = new Set<string>();

interface PendingApproval {
  pipeline: Pipeline;
  stepIndex: number;
  kind: string;
}

const pendingApprovals = new Map<string, PendingApproval>();

/** If Create VM succeeded (or left partial TF state) and a later step fails, destroy the cloud resources. */
async function rollbackProvisionedInfraOnFailure(
  runId: string,
  step: RunStep,
  simulate: boolean
): Promise<void> {
  if (simulate) return;
  const out = getRunOutputs(runId);
  if (!out.tfWorkDir) return;
  const should =
    Boolean(out.infraProvisioned) || (await terraformStateHasResources(out.tfWorkDir));
  if (!should) return;
  step.logs.push(
    "[orchestrator] Pipeline failed after cloud create — rolling back provisioned infra so the next run is clean…"
  );
  store.persistSoon();
  const logLine = (line: string) => {
    step.logs.push(line);
    store.persistSoon();
  };
  await captureContainerFailureLogs({
    workDir: out.tfWorkDir,
    cloudConnectionId: out.cloudConnectionId,
    log: logLine,
  });
  await destroyProvisionedInfra({
    workDir: out.tfWorkDir,
    cloudConnectionId: out.cloudConnectionId,
    sshConnectionIdCreated: out.sshConnectionIdCreated,
    publicIp: out.publicIp,
    tag: "rollback",
    log: logLine,
  });
  const failed = store.runs.get(runId);
  if (failed?.environment?.provisioned) {
    failed.environment = {
      ...failed.environment,
      status: "destroyed",
      destroyedAt: new Date().toISOString(),
    };
    store.setRun(failed);
  }
}

/** After API restart, reclaim runs left status=running with no live orchestrator. */
export function reclaimOrphanedRuns(): number {
  let n = 0;
  const now = new Date().toISOString();
  for (const run of store.runs.values()) {
    if (
      run.status !== "running" &&
      run.status !== "queued" &&
      run.status !== "waiting_approval"
    )
      continue;
    // Orchestrator state (pending approvals, run outputs) is in-memory only,
    // so at boot no persisted active run has a live executor — all are orphans.
    // Preserve run.environment so the operator can still DESTROY a live VM.
    const envGone = run.environment?.status === "destroyed";
    const stepFailed = run.steps.some((s) => s.status === "failed");
    const interrupted = run.steps.find(
      (s) => s.status === "running" || s.status === "waiting_approval"
    );
    run.status = "failed";
    run.finishedAt = run.finishedAt ?? now;
    for (const step of run.steps) {
      if (step.status === "pending" || step.status === "running" || step.status === "waiting_approval") {
        step.status = "skipped";
        step.finishedAt = step.finishedAt ?? now;
        step.logs.push("[orchestrator] Reclaimed after restart (orphan running run)");
      }
    }
    if (!run.steps.some((s) => s.error)) {
      if (envGone) {
        const infra = run.steps.find((s) => s.box === "infra");
        if (infra && !infra.error) {
          infra.error = "Run interrupted during rollback (environment torn down)";
        }
      } else if (interrupted && !stepFailed) {
        interrupted.error =
          "Run interrupted (API restart) — no live orchestrator; check environment and DESTROY if needed";
      }
    }
    store.setRun(run);
    n += 1;
  }
  if (n > 0) {
    console.log(`Reclaimed ${n} orphaned running run(s)`);
  }
  return n;
}

export function cancelRun(runId: string): boolean {
  const run = store.runs.get(runId);
  if (!run) return false;
  if (
    run.status !== "queued" &&
    run.status !== "running" &&
    run.status !== "waiting_approval"
  ) {
    return false;
  }
  cancelled.add(runId);
  pendingApprovals.delete(runId);
  run.status = "cancelled";
  run.finishedAt = new Date().toISOString();
  for (const step of run.steps) {
    if (step.status === "pending" || step.status === "running" || step.status === "waiting_approval") {
      step.status = "skipped";
      step.logs.push("[orchestrator] Cancelled");
      step.finishedAt = new Date().toISOString();
    }
  }
  // Best-effort: destroy Create-VM resources if cancel happens after apply.
  const out = getRunOutputs(runId);
  if (!settings.simulate && out.tfWorkDir && out.infraProvisioned) {
    const logStep = run.steps.find((s) => s.box === "infra") ?? run.steps[run.steps.length - 1];
    void destroyProvisionedInfra({
      workDir: out.tfWorkDir,
      cloudConnectionId: out.cloudConnectionId,
      sshConnectionIdCreated: out.sshConnectionIdCreated,
      publicIp: out.publicIp,
      log: (line) => {
        logStep.logs.push(line);
        store.persistSoon();
      },
    }).finally(() => {
      clearRunOutputs(runId);
      store.setRun(run);
    });
  } else {
    clearRunOutputs(runId);
  }
  store.setRun(run);
  audit("run.cancel", runId);
  return true;
}

export function approveRun(runId: string, actor?: string): boolean {
  const pending = pendingApprovals.get(runId);
  const run = store.runs.get(runId);
  if (!pending || !run || run.status !== "waiting_approval") return false;
  pendingApprovals.delete(runId);
  const step = run.steps[pending.stepIndex];
  step.logs.push(`[orchestrator] Approved by ${actor ?? "operator"} (${pending.kind})`);
  run.status = "running";
  store.setRun(run);
  audit("run.approve", `${runId} ${pending.kind}`, actor);

  if (pending.kind === "terraform_apply") {
    step.status = "running";
    void continueRun(runId, pending.pipeline, pending.stepIndex, {
      terraformApplyApproved: true,
    });
  } else if (pending.kind === "pre_deploy") {
    step.status = "pending";
    void continueRun(runId, pending.pipeline, pending.stepIndex, {
      preDeployApproved: true,
    });
  } else {
    step.status = "succeeded";
    step.finishedAt = new Date().toISOString();
    void continueRun(runId, pending.pipeline, pending.stepIndex + 1, {});
  }
  return true;
}

export function rejectRun(runId: string, actor?: string): boolean {
  const pending = pendingApprovals.get(runId);
  const run = store.runs.get(runId);
  if (!pending || !run || run.status !== "waiting_approval") return false;
  pendingApprovals.delete(runId);
  const step = run.steps[pending.stepIndex];
  step.status = "failed";
  step.error = "Rejected by operator";
  step.logs.push(`[orchestrator] Rejected by ${actor ?? "operator"}`);
  step.finishedAt = new Date().toISOString();
  run.status = "failed";
  run.finishedAt = new Date().toISOString();
  clearRunOutputs(runId);
  store.setRun(run);
  audit("run.reject", runId, actor);
  return true;
}

export async function startRun(pipeline: Pipeline): Promise<PipelineRun> {
  const detection = detectStack(pipeline.boxes);
  const steps: RunStep[] = PIPELINE_BOX_ORDER.map((box) => ({
    id: nanoid(8),
    box,
    name: BOX_LABELS[box],
    status: "pending",
    logs: [],
  }));

  const run: PipelineRun = {
    id: nanoid(12),
    pipelineId: pipeline.id,
    projectId: pipeline.projectId,
    status: "queued",
    steps,
    createdAt: new Date().toISOString(),
    detection,
  };

  store.setRun(run);
  audit("run.start", run.id);
  void continueRun(run.id, pipeline, 0, {});
  return run;
}

export interface RunFlags {
  terraformApplyApproved?: boolean;
  preDeployApproved?: boolean;
}

async function continueRun(runId: string, pipeline: Pipeline, fromIndex: number, flags: RunFlags) {
  const run = store.runs.get(runId);
  if (!run) return;

  if (run.status === "queued") {
    run.status = "running";
    run.startedAt = new Date().toISOString();
    store.setRun(run);
  }

  const simulate = settings.simulate;

  for (let i = fromIndex; i < run.steps.length; i++) {
    const step = run.steps[i];
    if (cancelled.has(runId)) {
      cancelled.delete(runId);
      const out = getRunOutputs(runId);
      if (!simulate && out.tfWorkDir && (out.infraProvisioned || (await terraformStateHasResources(out.tfWorkDir)))) {
        step.logs.push("[orchestrator] Cancelled — rolling back Create VM infra…");
        await destroyProvisionedInfra({
          workDir: out.tfWorkDir,
          cloudConnectionId: out.cloudConnectionId,
          sshConnectionIdCreated: out.sshConnectionIdCreated,
          publicIp: out.publicIp,
          log: (line) => {
            step.logs.push(line);
            store.persistSoon();
          },
        });
      }
      clearRunOutputs(runId);
      store.setRun(run);
      return;
    }

    // Optional gate before deploy
    if (
      !simulate &&
      settings.requireApproval &&
      step.box === "deploy" &&
      !flags.preDeployApproved
    ) {
      step.status = "waiting_approval";
      step.startedAt = new Date().toISOString();
      step.logs.push("[orchestrator] Paused — approval gate before deploy");
      run.status = "waiting_approval";
      pendingApprovals.set(runId, { pipeline, stepIndex: i, kind: "pre_deploy" });
      store.setRun(run);
      return;
    }

    const adapter = adapters.find((a) => a.box === step.box);
    if (!adapter) {
      step.status = "failed";
      step.error = "No adapter";
      run.status = "failed";
      run.finishedAt = new Date().toISOString();
      store.setRun(run);
      return;
    }

    step.status = "running";
    step.startedAt = step.startedAt ?? new Date().toISOString();
    step.logs.push(
      `[orchestrator] Starting ${adapter.name} (${simulate ? "simulate" : "LIVE"})`
    );
    store.setRun(run);

    try {
      const result = await adapter.execute({
        boxes: pipeline.boxes,
        runId,
        simulate,
        terraformApplyApproved: flags.terraformApplyApproved,
        log: (line) => {
          step.logs.push(line);
          store.persistSoon();
        },
      });

      if (cancelled.has(runId)) {
        step.status = "skipped";
        step.logs.push("[orchestrator] Cancelled after step");
        step.finishedAt = new Date().toISOString();
        cancelled.delete(runId);
        clearRunOutputs(runId);
        store.setRun(run);
        return;
      }

      if (result.needsApproval) {
        step.status = "waiting_approval";
        step.logs.push(result.message ?? "Waiting for approval");
        run.status = "waiting_approval";
        pendingApprovals.set(runId, {
          pipeline,
          stepIndex: i,
          kind: result.approvalKind ?? "manual",
        });
        store.setRun(run);
        return;
      }

      if (result.skipped) {
        step.status = "skipped";
        step.logs.push(result.message ?? "Skipped");
      } else if (result.ok) {
        step.status = "succeeded";
        if (result.message) step.logs.push(result.message);
        if (step.box === "infra" && !simulate) {
          attachEnvironmentFromOutputs(run, pipeline);
        }
        if (step.box === "source") {
          const sourcePath = getRunOutputs(runId).sourcePath;
          if (sourcePath) {
            const det = detectStackFromDir(sourcePath);
            const provider = pipeline.boxes?.infra?.cloudProvider ?? "aws";
            run.detection = {
              ...det,
              vmSizing: recommendVmSize({
                stack: det.stack,
                signals: det.signals,
                compose: det.compose,
                cloudProvider: provider,
              }),
              serverlessSizing: recommendServerlessSize({
                stack: det.stack,
                signals: det.signals,
                compose: det.compose,
                kind: pipeline.boxes?.infra?.serverlessKind ?? "function",
              }),
            };
            step.logs.push(
              `[orchestrator] Stack detection refreshed from source → ${run.detection.suggestedRuntime}` +
                (run.detection.compose
                  ? ` (${run.detection.compose.services.length} compose services)`
                  : "")
            );
            if (run.detection.vmSizing) {
              step.logs.push(`[orchestrator] ${run.detection.vmSizing.summary}`);
            }
            if (run.detection.serverlessSizing) {
              step.logs.push(`[orchestrator] Serverless: ${run.detection.serverlessSizing.summary}`);
            }
          }
        }
      } else {
        step.status = "failed";
        step.error = result.message ?? "Step failed";
        step.logs.push(`ERROR: ${step.error}`);
        // Mark failed before long rollback so a restart cannot leave status=running forever.
        run.status = "failed";
        run.finishedAt = new Date().toISOString();
        store.setRun(run);
        await rollbackProvisionedInfraOnFailure(runId, step, simulate);
        clearRunOutputs(runId);
        store.setRun(run);
        return;
      }
    } catch (err) {
      step.status = "failed";
      step.error = err instanceof Error ? err.message : String(err);
      step.logs.push(`ERROR: ${step.error}`);
      run.status = "failed";
      run.finishedAt = new Date().toISOString();
      store.setRun(run);
      await rollbackProvisionedInfraOnFailure(runId, step, simulate);
      clearRunOutputs(runId);
      store.setRun(run);
      return;
    }

    step.finishedAt = new Date().toISOString();
    store.setRun(run);
  }

  run.status = "succeeded";
  run.finishedAt = new Date().toISOString();
  // Keep environment metadata for operator tear-down after a green run
  attachEnvironmentFromOutputs(run, pipeline);
  clearRunOutputs(runId);
  store.setRun(run);
  audit("run.succeeded", runId);
}
