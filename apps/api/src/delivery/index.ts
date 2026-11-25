import path from "node:path";
import { fileURLToPath } from "node:url";
import { store } from "../store.js";
import { ensureExistingTargetConnection } from "./existingTarget.js";
import { createDeliveryService } from "./service.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../data");

function normalizeGitUrl(url: string): string {
  return url.trim().replace(/\.git$/i, "").toLowerCase();
}

export function ensureGitConnection(input: { name: string; url: string; token?: string }) {
  const want = normalizeGitUrl(input.url);
  if (!want) throw new Error("A Git repository URL is required");
  for (const conn of store.connections.values()) {
    if (conn.type === "git" && normalizeGitUrl(conn.config.url ?? "") === want) {
      if (input.token?.trim()) {
        store.updateConnection(conn.id, { secrets: { token: input.token.trim() } });
      }
      return { id: conn.id, name: conn.name, type: "git" as const, created: false };
    }
  }
  const created = store.createConnection({
    name: input.name,
    type: "git",
    config: { url: input.url.trim().replace(/\.git$/i, "") + ".git", mode: "remote" },
    secrets: input.token?.trim() ? { token: input.token.trim() } : undefined,
  });
  return { id: created.id, name: created.name, type: "git" as const, created: true };
}

export { ensureExistingTargetConnection };

export const delivery = createDeliveryService(root, {
  ensureGitConnection,
  ensureExistingTargetConnection,
  handoff: async (pipelineId: string, workspace: string) => {
    const pipeline = store.pipelines.get(pipelineId);
    if (!pipeline) throw new Error(`Shipdeck pipeline ${pipelineId} was not found`);
    const copy = structuredClone(pipeline);
    if (workspace) {
      copy.boxes = {
        ...copy.boxes,
        source: { ...copy.boxes.source, mode: "local", localPath: workspace },
      };
    }
    const { startRun } = await import("../orchestrator.js");
    const run = await startRun(copy);
    return { id: run.id };
  },
});
