import { BOX_LABELS, PIPELINE_BOX_ORDER, type PipelineRun, type RunStatus, type RunStep } from "@shipdeck/shared";
import { nanoid } from "nanoid";
import { readAuditAll } from "../audit.js";
import { store } from "../store.js";

function stepsFor(status: RunStatus, at: string, finishedAt?: string): RunStep[] {
  const done = status === "succeeded";
  return PIPELINE_BOX_ORDER.map((box) => ({
    id: nanoid(8),
    box,
    name: BOX_LABELS[box],
    status: done ? "succeeded" : status === "cancelled" ? "skipped" : status === "failed" ? "skipped" : "pending",
    logs: ["Restored from audit history after the store was reset."],
    startedAt: at,
    finishedAt: finishedAt ?? (done ? at : undefined),
  }));
}

/**
 * Rebuild missing pipeline runs from audit.jsonl so the Runs page
 * still lists history after a store seed/reset.
 */
export function recoverMissingRunsFromAudit(): number {
  const events = readAuditAll();
  if (!events.length) return 0;

  const fallback = [...store.pipelines.values()][0];
  let lastPipelineId = fallback?.id;
  const byId = new Map<
    string,
    { pipelineId?: string; createdAt: string; status: RunStatus; finishedAt?: string }
  >();

  for (const ev of events) {
    if (ev.action === "pipeline.update" && ev.detail?.trim()) {
      lastPipelineId = ev.detail.trim();
      continue;
    }
    const runId = ev.detail?.trim();
    if (!runId) continue;
    if (ev.action === "run.start") {
      byId.set(runId, {
        pipelineId: lastPipelineId,
        createdAt: ev.at,
        status: "failed",
      });
      continue;
    }
    const existing = byId.get(runId);
    if (!existing) continue;
    if (ev.action === "run.succeeded") {
      existing.status = "succeeded";
      existing.finishedAt = ev.at;
    } else if (ev.action === "run.cancel") {
      existing.status = "cancelled";
      existing.finishedAt = ev.at;
    } else if (ev.action === "run.reject") {
      existing.status = "failed";
      existing.finishedAt = ev.at;
    }
  }

  let added = 0;
  for (const [id, rec] of byId) {
    if (store.runs.has(id)) continue;
    const pipeline =
      (rec.pipelineId ? store.pipelines.get(rec.pipelineId) : undefined) ?? fallback;
    if (!pipeline) continue;
    const run: PipelineRun = {
      id,
      pipelineId: pipeline.id,
      projectId: pipeline.projectId,
      status: rec.status,
      steps: stepsFor(rec.status, rec.createdAt, rec.finishedAt),
      createdAt: rec.createdAt,
      startedAt: rec.createdAt,
      finishedAt: rec.finishedAt,
    };
    store.runs.set(run.id, run);
    added += 1;
  }

  if (added > 0) void store.persistNow();
  return added;
}
