import cors from "cors";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyComposeDetection,
  createDefaultBoxes,
  recommendVmSize,
  recommendServerlessSize,
  suggestServerlessKind,
  shouldAutofillHealthUrl,
  suggestedHealthUrl,
  vmSizeForProvider,
  approxRamGbForVmSize,
  listVmSizesForCloud,
  type CloudProviderId,
  type ComposeDetection,
  type PipelineBoxes,
} from "@shipdeck/shared";
import { nanoid } from "nanoid";
import { z } from "zod";
import { audit, readAudit, setAuditPgSink } from "./audit.js";
import { authMiddleware, requireRole, type AuthedRequest } from "./auth.js";
import { probeConnection } from "./connectionProbe.js";
import { initPostgres, pgInsertAudit, pgLoadAll, usingPostgres } from "./db.js";
import { detectStack, detectStackFromDir } from "./detection.js";
import { reviewTestsAgainstSource, writeShipdeckTests } from "./lib/testReview.js";
import { writeShipdeckCompose, reviewComposeAgainstSource } from "./lib/composeGenerate.js";
import { reviewDockerfilesAgainstSource, applyDockerfileChoice } from "./lib/dockerfileReview.js";
import { resolveSourceRoot } from "./lib/gitSource.js";
import { listStoredKeys, revealStoredKey } from "./lib/keyInventory.js";
import { recoverMissingRunsFromAudit } from "./lib/recoverRuns.js";
import { openPublicPorts, portsForPipeline } from "./lib/openPorts.js";
import { approveRun, cancelRun, reclaimOrphanedRuns, rejectRun, startRun } from "./orchestrator.js";
import {
  destroyRunEnvironment,
  ensureRunEnvironment,
} from "./lib/runEnvironment.js";
import { rateLimitMiddleware } from "./rateLimit.js";
import { persistSettings, settings } from "./settings.js";
import { store } from "./store.js";
import { applyBuildConnection, ensurePolicyConnections } from "./delivery/buildConnections.js";
import { registerDeliveryRoutes } from "./delivery/routes.js";
import { registerBriefRoutes } from "./brief/routes.js";
import { registerSalesRoutes } from "./sales/routes.js";
import { registerMarketingRoutes } from "./marketing/routes.js";
import { createUser, deleteUser, ensureBootstrapAdmin, listUsers } from "./users.js";

const app = express();
const PORT = Number(process.env.PORT ?? 4000);
const WEB_PORT = Number(process.env.WEB_PORT ?? 5173);

function idParam(req: { params: Record<string, string | string[]> }, name = "id"): string {
  const v = req.params[name];
  return Array.isArray(v) ? v[0] : v;
}

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(rateLimitMiddleware({ windowMs: 60_000, max: Number(process.env.SHIPDECK_RATE_LIMIT ?? 180) }));
app.use(authMiddleware);
registerDeliveryRoutes(app);
registerBriefRoutes(app);
registerSalesRoutes(app);
registerMarketingRoutes(app);

function attachAutoVerify(boxes: PipelineBoxes, detectionCompose?: ComposeDetection): PipelineBoxes {
  const ssh = boxes.infra.sshConnectionId ? store.connections.get(boxes.infra.sshConnectionId) : undefined;
  const host = ssh?.config.host?.trim();
  const deploy = detectionCompose ? applyComposeDetection(boxes.deploy, detectionCompose) : boxes.deploy;
  if (!host) return { ...boxes, deploy };
  const url = suggestedHealthUrl({
    host,
    port: deploy.port,
    healthPath: deploy.healthPath,
    primaryService: detectionCompose?.suggestedPrimaryService,
  });
  if (!shouldAutofillHealthUrl(boxes.verify.healthUrl, url, deploy.port, host)) {
    return { ...boxes, deploy };
  }
  return { ...boxes, deploy, verify: { ...boxes.verify, healthUrl: url } };
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "shipdeck-api",
    simulate: settings.simulate,
    storage: usingPostgres() ? "postgres" : "json",
  });
});

async function sourceRootOr400(boxes: PipelineBoxes, res: express.Response) {
  try {
    const resolved = await resolveSourceRoot(boxes);
    if (!resolved.ok) {
      res.status(400).json({ error: resolved.error });
      return null;
    }
    return resolved.root;
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

/** Detect stack from Source (local folder or cloned Git). Auto-fills Deploy when compose.yml is found. */
app.post("/api/detect", requireRole("operator"), async (req, res) => {
  const boxes = (req.body?.boxes ?? createDefaultBoxes()) as PipelineBoxes;
  let detection;
  if (boxes.source.mode === "remote") {
    const root = await sourceRootOr400(boxes, res);
    if (!root) return;
    detection = detectStackFromDir(root);
  } else {
    detection = detectStack(boxes);
  }
  const provider = boxes.infra.cloudProvider ?? "aws";
  const vmSizing = recommendVmSize({
    stack: detection.stack,
    signals: detection.signals,
    compose: detection.compose,
    cloudProvider: provider,
  });
  const suggestedKind =
    boxes.infra.serverlessKind ??
    (boxes.infra.computeMode === "serverless"
      ? suggestServerlessKind(detection.compose)
      : "function");
  const serverlessSizing = recommendServerlessSize({
    stack: detection.stack,
    signals: detection.signals,
    compose: detection.compose,
    kind: suggestedKind,
  });
  detection = { ...detection, vmSizing, serverlessSizing };

  let next = boxes;
  if (detection.compose) {
    next = attachAutoVerify(boxes, detection.compose);
  } else if (
    detection.suggestedRuntime !== boxes.deploy.runtime &&
    (boxes.deploy.runtime === "docker" || detection.suggestedRuntime === "compose")
  ) {
    next = attachAutoVerify({
      ...boxes,
      deploy: { ...boxes.deploy, runtime: detection.suggestedRuntime },
    });
  } else {
    next = attachAutoVerify(boxes);
  }

  // Suggest infra create size when current VM size looks too small (or empty on create).
  const currentRam = approxRamGbForVmSize(boxes.infra.vmSize);
  const sizeTooSmall = currentRam !== null && currentRam < vmSizing.minRamGb;
  const createNeedsSize =
    boxes.infra.mode === "create" && (!boxes.infra.vmSize?.trim() || sizeTooSmall);
  if ((boxes.infra.computeMode ?? "vm") === "vm" && (createNeedsSize || sizeTooSmall)) {
    next = {
      ...next,
      infra: {
        ...next.infra,
        vmSize: vmSizeForProvider(vmSizing, provider),
      },
    };
  }

  // Autofill serverless memory/timeout/runtime from project when creating serverless
  if (
    boxes.infra.mode === "create" &&
    (boxes.infra.computeMode ?? "vm") === "serverless"
  ) {
    const mem = boxes.infra.serverlessMemoryMb;
    const needsMem = !mem || mem === 512 || mem < serverlessSizing.memoryMb;
    next = {
      ...next,
      infra: {
        ...next.infra,
        serverlessKind: boxes.infra.serverlessKind ?? suggestedKind,
        serverlessMemoryMb: needsMem ? serverlessSizing.memoryMb : mem,
        serverlessTimeoutSeconds:
          serverlessSizing.kind === "app"
            ? boxes.infra.serverlessTimeoutSeconds
            : !boxes.infra.serverlessTimeoutSeconds ||
                boxes.infra.serverlessTimeoutSeconds === 30
              ? serverlessSizing.timeoutSeconds
              : boxes.infra.serverlessTimeoutSeconds,
        serverlessRuntime:
          boxes.infra.serverlessRuntime ?? serverlessSizing.runtimeHint,
      },
    };
  }

  const suggestedBoxes =
    next.deploy.port !== boxes.deploy.port ||
    next.deploy.runtime !== boxes.deploy.runtime ||
    next.verify.healthUrl !== boxes.verify.healthUrl ||
    next.infra.vmSize !== boxes.infra.vmSize ||
    next.infra.serverlessKind !== boxes.infra.serverlessKind ||
    next.infra.serverlessMemoryMb !== boxes.infra.serverlessMemoryMb ||
    next.infra.serverlessTimeoutSeconds !== boxes.infra.serverlessTimeoutSeconds
      ? next
      : undefined;
  res.json({ detection, suggestedBoxes, vmSizing, serverlessSizing });
});

/** VM size catalog for Infra → Create (AWS / Azure / GCP). */
app.get("/api/infra/vm-sizes", requireRole("operator"), (req, res) => {
  const provider = String(req.query.provider || "aws").toLowerCase() as CloudProviderId;
  if (provider !== "aws" && provider !== "azure" && provider !== "gcp") {
    return res.status(400).json({ error: "provider must be aws, azure, or gcp" });
  }
  const sizes = listVmSizesForCloud(provider);
  const boxes = createDefaultBoxes();
  boxes.infra.cloudProvider = provider;
  // Optional: if client sends no detection, still return catalog; recommendation needs detect.
  res.json({
    provider,
    source: "catalog",
    note:
      "Sizes from Shipdeck cloud catalog (common production types). Live cloud DescribeInstanceTypes can be added later.",
    sizes,
  });
});

app.post("/api/infra/vm-sizes", requireRole("operator"), (req, res) => {
  const provider = (String(req.body?.provider || req.body?.boxes?.infra?.cloudProvider || "aws").toLowerCase() ||
    "aws") as CloudProviderId;
  if (provider !== "aws" && provider !== "azure" && provider !== "gcp") {
    return res.status(400).json({ error: "provider must be aws, azure, or gcp" });
  }
  const boxes = (req.body?.boxes ?? createDefaultBoxes()) as PipelineBoxes;
  const detection = req.body?.detection;
  const sizing = recommendVmSize({
    stack: detection?.stack,
    signals: detection?.signals,
    compose: detection?.compose,
    cloudProvider: provider,
  });
  const recommendedId = vmSizeForProvider(sizing, provider);
  const sizes = listVmSizesForCloud(provider).map((s) => ({
    ...s,
    recommended: s.id === recommendedId,
  }));
  res.json({
    provider,
    source: "catalog",
    recommendedId,
    vmSizing: sizing,
    sizes,
    chosenId: boxes.infra.vmSize || recommendedId,
  });
});

app.post("/api/compose/review", requireRole("operator"), async (req, res) => {
  const boxes = (req.body?.boxes ?? createDefaultBoxes()) as PipelineBoxes;
  const root = await sourceRootOr400(boxes, res);
  if (!root) return;
  res.json(reviewComposeAgainstSource(root));
});

app.post("/api/compose/generate", requireRole("operator"), async (req, res) => {
  const boxes = (req.body?.boxes ?? createDefaultBoxes()) as PipelineBoxes;
  const root = await sourceRootOr400(boxes, res);
  if (!root) return;
  const result = writeShipdeckCompose(root);
  const detection = detectStackFromDir(root);
  const suggestedBoxes = {
    ...boxes,
    deploy: {
      ...applyComposeDetection(boxes.deploy, detection.compose ?? {
        file: result.file,
        services: result.apps.map((a) => ({ name: a.name, ports: [a.port] })),
        suggestedPort: result.apps[0]?.port ?? boxes.deploy.port,
        suggestedPrimaryService: result.apps[0]?.name,
      }),
      composeChoice: "generated" as const,
      runtime: "compose" as const,
    },
  };
  audit("compose.generate", result.message, req.user?.name);
  res.json({ ...result, detection, suggestedBoxes });
});

app.post("/api/tests/review", requireRole("operator"), async (req, res) => {
  const boxes = (req.body?.boxes ?? createDefaultBoxes()) as PipelineBoxes;
  const root = await sourceRootOr400(boxes, res);
  if (!root) return;
  res.json(reviewTestsAgainstSource(root, boxes.build));
});

app.post("/api/tests/generate", requireRole("operator"), async (req, res) => {
  const boxes = (req.body?.boxes ?? createDefaultBoxes()) as PipelineBoxes;
  const root = await sourceRootOr400(boxes, res);
  if (!root) return;
  const written = writeShipdeckTests(root);
  const suggestedBoxes = {
    ...boxes,
    build: {
      ...boxes.build,
      testChoice: "generated" as const,
      runTests: true,
    },
  };
  const review = reviewTestsAgainstSource(root, suggestedBoxes.build);
  audit("tests.generate", `Wrote ${written.written.join(", ") || "no new test files"}`, req.user?.name);
  res.json({
    ...review,
    written: written.written,
    suggestedBoxes,
    message: written.written.length
      ? `Wrote ${written.written.join(", ")}`
      : "No new test files needed",
  });
});

app.post("/api/dockerfiles/review", requireRole("operator"), async (req, res) => {
  const boxes = (req.body?.boxes ?? createDefaultBoxes()) as PipelineBoxes;
  const root = await sourceRootOr400(boxes, res);
  if (!root) return;
  res.json(reviewDockerfilesAgainstSource(root, boxes.build));
});

app.post("/api/dockerfiles/generate", requireRole("operator"), async (req, res) => {
  const boxes = (req.body?.boxes ?? createDefaultBoxes()) as PipelineBoxes;
  const root = await sourceRootOr400(boxes, res);
  if (!root) return;
  const applied = applyDockerfileChoice(root, "generated");
  const review = reviewDockerfilesAgainstSource(root, {
    ...boxes.build,
    dockerfilePath: applied.dockerfilePath,
    dockerfileChoice: "generated",
  });
  const suggestedBoxes = {
    ...boxes,
    build: {
      ...boxes.build,
      dockerfilePath: applied.dockerfilePath,
      dockerfileChoice: "generated" as const,
    },
  };
  audit("dockerfiles.generate", `Wrote ${applied.written.join(", ") || "Dockerfile.shipdeck"}`, req.user?.name);
  res.json({ ...review, written: applied.written, suggestedBoxes, message: `Wrote ${applied.written.join(", ") || "nothing new"}` });
});

app.post("/api/ports/preview", requireRole("operator"), (req, res) => {
  const boxes = (req.body?.boxes ?? createDefaultBoxes()) as PipelineBoxes;
  res.json(portsForPipeline(boxes));
});

app.post("/api/ports/open", requireRole("operator"), async (req, res) => {
  const boxes = (req.body?.boxes ?? createDefaultBoxes()) as PipelineBoxes;
  const result = await openPublicPorts(boxes);
  audit("ports.open", result.message, req.user?.name);
  res.json(result);
});

app.get("/api/settings", (_req, res) => {
  res.json({
    simulate: settings.simulate,
    tfApply: settings.tfApply,
    requireApproval: settings.requireApproval,
    requireApprovalForTf: settings.requireApprovalForTf,
    authRequired: Boolean(process.env.SHIPDECK_API_TOKEN?.trim()) || store.users.size > 0,
    storage: usingPostgres() ? "postgres" : "json",
  });
});

app.put("/api/settings", requireRole("admin"), (req: AuthedRequest, res) => {
  if (typeof req.body.simulate === "boolean") settings.simulate = req.body.simulate;
  if (typeof req.body.tfApply === "boolean") settings.tfApply = req.body.tfApply;
  if (typeof req.body.requireApproval === "boolean") settings.requireApproval = req.body.requireApproval;
  if (typeof req.body.requireApprovalForTf === "boolean") {
    settings.requireApprovalForTf = req.body.requireApprovalForTf;
  }
  persistSettings();
  audit("settings.update", JSON.stringify(req.body), req.user?.name);
  res.json({
    simulate: settings.simulate,
    tfApply: settings.tfApply,
    requireApproval: settings.requireApproval,
    requireApprovalForTf: settings.requireApprovalForTf,
    authRequired: Boolean(process.env.SHIPDECK_API_TOKEN?.trim()) || store.users.size > 0,
    storage: usingPostgres() ? "postgres" : "json",
  });
});

app.get("/api/audit", requireRole("operator"), (_req, res) => {
  res.json(readAudit(200));
});

app.get("/api/keys", requireRole("operator"), (_req, res) => {
  res.json(listStoredKeys());
});

app.post("/api/keys/reveal", requireRole("operator"), (req: AuthedRequest, res) => {
  const parsed = z
    .object({
      connectionId: z.string().min(1),
      secretName: z.string().min(1),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "connectionId and secretName are required" });
  const found = revealStoredKey(parsed.data.connectionId, parsed.data.secretName);
  if (!found) return res.status(404).json({ error: "Key not found" });
  audit(
    "keys.reveal",
    `${found.record.connectionName} · ${found.record.label}`,
    req.user?.name ?? "operator"
  );
  res.json({ ...found.record, plaintext: found.plaintext });
});

app.get("/api/users", requireRole("admin"), (_req, res) => {
  res.json(listUsers());
});

app.post("/api/users", requireRole("admin"), (req: AuthedRequest, res) => {
  const parsed = z
    .object({
      name: z.string().min(1),
      role: z.enum(["admin", "operator", "viewer"]),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "name and role required" });
  const created = createUser(parsed.data);
  audit("user.create", created.user.id, req.user?.name);
  res.status(201).json(created);
});

app.delete("/api/users/:id", requireRole("admin"), (req: AuthedRequest, res) => {
  if (!deleteUser(idParam(req))) return res.status(404).json({ error: "Not found" });
  audit("user.delete", idParam(req), req.user?.name);
  res.status(204).end();
});

app.get("/api/projects", (_req, res) => {
  res.json([...store.projects.values()]);
});

app.post("/api/projects", requireRole("operator"), (req: AuthedRequest, res) => {
  const parsed = z
    .object({ name: z.string().min(1), description: z.string().optional() })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "name required" });
  const project = store.createProject(parsed.data);
  audit("project.create", project.id, req.user?.name);
  res.status(201).json(project);
});

app.get("/api/projects/:id", (req, res) => {
  const project = store.projects.get(idParam(req));
  if (!project) return res.status(404).json({ error: "Project not found" });
  res.json(project);
});

app.get("/api/pipelines", (req, res) => {
  const projectId = req.query.projectId as string | undefined;
  let list = [...store.pipelines.values()];
  if (projectId) list = list.filter((p) => p.projectId === projectId);
  res.json(list);
});

app.get("/api/pipelines/:id", (req, res) => {
  const pipeline = store.pipelines.get(idParam(req));
  if (!pipeline) return res.status(404).json({ error: "Pipeline not found" });
  res.json(pipeline);
});

app.put("/api/pipelines/:id", requireRole("operator"), (req: AuthedRequest, res) => {
  const pipeline = store.pipelines.get(idParam(req));
  if (!pipeline) return res.status(404).json({ error: "Pipeline not found" });
  const boxes = req.body.boxes ?? pipeline.boxes;
  const name = req.body.name ?? pipeline.name;
  const updated = {
    ...pipeline,
    name,
    boxes,
    updatedAt: new Date().toISOString(),
  };
  store.setPipeline(updated);
  audit("pipeline.update", pipeline.id, req.user?.name);
  res.json(updated);
});

app.post("/api/pipelines", requireRole("operator"), (req, res) => {
  const projectId = req.body.projectId as string;
  if (!store.projects.has(projectId)) {
    return res.status(400).json({ error: "Invalid projectId" });
  }
  const now = new Date().toISOString();
  const pipeline = {
    id: nanoid(10),
    name: (req.body.name as string) || "New delivery",
    projectId,
    boxes: req.body.boxes ?? createDefaultBoxes(),
    createdAt: now,
    updatedAt: now,
  };
  store.setPipeline(pipeline);
  res.status(201).json(pipeline);
});

app.get("/api/connections", (_req, res) => {
  ensurePolicyConnections();
  res.json([...store.connections.values()]);
});

app.post("/api/connections", requireRole("operator"), (req: AuthedRequest, res) => {
  const parsed = z
    .object({
      name: z.string().min(1),
      type: z.string().min(1),
      config: z.record(z.string()).optional(),
      secrets: z.record(z.string()).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "name and type required" });
  const connection = store.createConnection({
    name: parsed.data.name,
    type: parsed.data.type as Parameters<typeof store.createConnection>[0]["type"],
    config: parsed.data.config ?? {},
    secrets: parsed.data.secrets,
  });
  applyBuildConnection(connection);
  audit("connection.create", connection.id, req.user?.name);
  res.status(201).json(connection);
});

app.put("/api/connections/:id", requireRole("operator"), (req: AuthedRequest, res) => {
  const parsed = z
    .object({
      name: z.string().min(1).optional(),
      type: z.string().min(1).optional(),
      config: z.record(z.string()).optional(),
      secrets: z.record(z.string()).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid connection update" });
  const updated = store.updateConnection(idParam(req), {
    name: parsed.data.name,
    type: parsed.data.type as Parameters<typeof store.updateConnection>[1]["type"],
    config: parsed.data.config,
    secrets: parsed.data.secrets,
  });
  if (!updated) return res.status(404).json({ error: "Not found" });
  applyBuildConnection(updated);
  audit("connection.update", updated.id, req.user?.name);
  res.json(updated);
});

app.patch("/api/connections/:id/secrets", requireRole("operator"), (req: AuthedRequest, res) => {
  const secrets = req.body.secrets as Record<string, string> | undefined;
  if (!secrets || typeof secrets !== "object") {
    return res.status(400).json({ error: "secrets object required" });
  }
  const updated = store.updateConnectionSecrets(idParam(req), secrets);
  if (!updated) return res.status(404).json({ error: "Not found" });
  audit("connection.secrets.rotate", updated.id, req.user?.name);
  res.json(updated);
});

app.post("/api/connections/test", requireRole("operator"), async (req, res) => {
  const parsed = z
    .object({
      name: z.string().optional(),
      type: z.string().min(1),
      config: z.record(z.string()).optional(),
      secrets: z.record(z.string()).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "type required" });
  const result = await probeConnection({
    name: parsed.data.name,
    type: parsed.data.type as Parameters<typeof probeConnection>[0]["type"],
    config: parsed.data.config ?? {},
    secrets: parsed.data.secrets,
  });
  res.json(result);
});

app.post("/api/connections/:id/test", requireRole("operator"), async (req, res) => {
  const connection = store.connections.get(idParam(req));
  if (!connection) return res.status(404).json({ error: "Not found" });
  const secrets = store.connectionSecrets.get(connection.id) ?? {};
  const result = await probeConnection({
    name: connection.name,
    type: connection.type,
    config: connection.config,
    secrets,
  });
  res.json(result);
});

app.delete("/api/connections/:id", requireRole("operator"), (req: AuthedRequest, res) => {
  if (!store.connections.has(idParam(req))) {
    return res.status(404).json({ error: "Not found" });
  }
  store.deleteConnection(idParam(req));
  audit("connection.delete", idParam(req), req.user?.name);
  res.status(204).end();
});

app.post("/api/pipelines/:id/runs", requireRole("operator"), async (req: AuthedRequest, res) => {
  const pipeline = store.pipelines.get(idParam(req));
  if (!pipeline) return res.status(404).json({ error: "Pipeline not found" });
  const run = await startRun(pipeline);
  res.status(201).json(run);
});

app.post("/api/runs/:id/cancel", requireRole("operator"), (req: AuthedRequest, res) => {
  const ok = cancelRun(idParam(req));
  if (!ok) return res.status(400).json({ error: "Run not cancellable" });
  res.json(store.runs.get(idParam(req)));
});

app.post("/api/runs/:id/approve", requireRole("operator"), (req: AuthedRequest, res) => {
  const ok = approveRun(idParam(req), req.user?.name);
  if (!ok) return res.status(400).json({ error: "Run not waiting for approval" });
  res.json(store.runs.get(idParam(req)));
});

app.post("/api/runs/:id/reject", requireRole("operator"), (req: AuthedRequest, res) => {
  const ok = rejectRun(idParam(req), req.user?.name);
  if (!ok) return res.status(400).json({ error: "Run not waiting for approval" });
  res.json(store.runs.get(idParam(req)));
});

app.post(
  "/api/runs/:id/destroy-environment",
  requireRole("operator"),
  async (req: AuthedRequest, res) => {
    const id = idParam(req);
    const result = await destroyRunEnvironment(id, req.user?.name);
    if (!result.ok && !result.run) {
      return res.status(400).json({ error: result.message });
    }
    audit(
      result.ok ? "run.destroy_environment" : "run.destroy_environment_failed",
      `${id} ${result.message}`,
      req.user?.name
    );
    if (!result.ok) {
      return res.status(500).json({ error: result.message, run: result.run });
    }
    res.json(result.run);
  }
);

app.get("/api/runs", async (req, res) => {
  const pipelineId = req.query.pipelineId as string | undefined;
  const pipeline = pipelineId ? store.pipelines.get(pipelineId) : undefined;
  const projectId = pipeline?.projectId;
  let list = [...store.runs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (projectId) list = list.filter((r) => r.projectId === projectId);
  else if (pipelineId) list = list.filter((r) => r.pipelineId === pipelineId);
  // Backfill env metadata for succeeded runs that still have TF state on disk
  await Promise.all(
    list.slice(0, 40).map(async (r) => {
      if (r.status === "succeeded" && !r.environment) {
        try {
          await ensureRunEnvironment(r);
        } catch {
          /* ignore */
        }
      }
    })
  );
  list = [...store.runs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (projectId) list = list.filter((r) => r.projectId === projectId);
  else if (pipelineId) list = list.filter((r) => r.pipelineId === pipelineId);
  res.json(list);
});

app.get("/api/runs/:id", async (req, res) => {
  const run = store.runs.get(idParam(req));
  if (!run) return res.status(404).json({ error: "Run not found" });
  try {
    await ensureRunEnvironment(run);
  } catch {
    /* ignore */
  }
  res.json(store.runs.get(idParam(req)) ?? run);
});

/** Serve the built web app when apps/web/dist exists. UI listens on 5173, same as Vite. */
function attachWebUi(): boolean {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const webDist = path.join(repoRoot, "apps", "web", "dist");
  if (!fs.existsSync(path.join(webDist, "index.html"))) return false;
  app.use(express.static(webDist));
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (req.path.startsWith("/api")) return next();
    if (path.extname(req.path)) return next();
    res.sendFile(path.join(webDist, "index.html"));
  });
  return true;
}

async function loadStore() {
  if (usingPostgres()) {
    await initPostgres();
    setAuditPgSink((e) => pgInsertAudit(e));
    const data = await pgLoadAll();
    store.hydrate(data);
    console.log("Storage: PostgreSQL");
    return;
  }
  store.loadFromJson();
  console.log("Storage: JSON files in ./data");
}

async function boot() {
  const hasWebUi = attachWebUi();

  process.on("SIGINT", () => {
    void store.persistNow().then(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    void store.persistNow().then(() => process.exit(0));
  });

  // Health must answer before the database is ready, or the cloud probe kills the task.
  await new Promise<void>((resolve, reject) => {
    const server = app.listen(PORT, () => {
      console.log(`Shipdeck API listening on http://localhost:${PORT}`);
      console.log(`Simulate mode: ${settings.simulate}`);
      console.log(`TF apply: ${settings.tfApply} · approval gates: deploy=${settings.requireApproval} tf=${settings.requireApprovalForTf}`);
      if (hasWebUi && WEB_PORT === PORT) console.log(`Web UI: http://localhost:${PORT}`);
      resolve();
    });
    server.on("error", reject);
  });

  if (hasWebUi && WEB_PORT !== PORT) {
    const web = app.listen(WEB_PORT, () => {
      console.log(`Web UI: http://localhost:${WEB_PORT}`);
    });
    web.on("error", (err) => {
      console.error(`Web UI failed to listen on http://localhost:${WEB_PORT}`, err);
    });
  }

  try {
    await loadStore();
  } catch (err) {
    console.error("PostgreSQL is not ready yet; using file storage", err);
    store.loadFromJson();
    console.log("Storage: JSON files in ./data");
  }

  const recovered = recoverMissingRunsFromAudit();
  if (recovered > 0) console.log(`Restored ${recovered} run(s) from audit history`);

  const bootToken = ensureBootstrapAdmin();
  if (bootToken && !process.env.SHIPDECK_API_TOKEN) {
    console.log(`Bootstrap admin token (save now): ${bootToken}`);
  }

  reclaimOrphanedRuns();
}

boot().catch((err) => {
  console.error("Failed to start API", err);
  process.exit(1);
});
