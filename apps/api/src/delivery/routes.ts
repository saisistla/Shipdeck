import { createHash, timingSafeEqual } from "node:crypto";
import type { Express } from "express";
import { z } from "zod";
import type { DeliveryPolicyPublic, DeliveryRun, DeliveryTicket } from "@shipdeck/shared";
import {
  CODE_PROVIDER_IDS,
  DELIVERY_TEST_BAR,
  PLAN_PROVIDER_IDS,
  defaultDeliveryPolicy,
  isFolderAgent,
  normalizeDeliveryPolicy,
} from "@shipdeck/shared";
import { audit } from "../audit.js";
import type { AuthedRequest } from "../auth.js";
import { requireRole } from "../auth.js";
import { hydrateArchitectureRun } from "./architectureDoc.js";
import { store } from "../store.js";
import { delivery } from "./index.js";
import { estimateFromArchitecture } from "./planner.js";
import { DeliveryError } from "./service.js";
import {
  applySelectedBuildConnections,
  ensurePolicyConnections,
  existingTargetFromConnection,
  resolveDeliverySecrets,
} from "./buildConnections.js";
import { pendingAttachmentDir, readStoredAttachment, runAttachmentDir } from "./ticketAttachments.js";
import { previewFor, proxyPreview, startPreview, stopPreview, stopStuckPreview } from "./preview.js";
import { readProjectRules } from "./projectRules.js";

function presentRun(run: DeliveryRun) {
  const policy = delivery.store.getPolicy();
  let changed = hydrateArchitectureRun(run, policy);
  if (!run.needsClarification && run.architecture.markdown.includes("```mermaid")) {
    const next = estimateFromArchitecture({
      ticket: run.ticket,
      policy,
      architecture: run.architecture,
      pending: false,
    });
    if (next.totalTokens !== run.estimate.totalTokens || next.assumptions[0] !== run.estimate.assumptions[0]) {
      run.estimate = next;
      changed = true;
    }
  }
  if (changed) delivery.store.saveRun(run);
  return run;
}

const ticketSchema = z.object({
  key: z.string().min(1),
  summary: z.string().min(1),
  description: z.string().default(""),
  acceptance: z.array(z.string()).default([]),
  comments: z.array(z.string()).default([]),
  relevantComments: z.array(z.string()).optional(),
  attachments: z
    .array(
      z.object({
        filename: z.string(),
        mimeType: z.string().optional(),
        size: z.number().optional(),
        id: z.string().optional(),
        kind: z.enum(["image", "text", "document", "file"]).optional(),
        storedName: z.string().optional(),
        textExcerpt: z.string().optional(),
        relevant: z.boolean().optional(),
        relevanceReason: z.string().optional(),
        contentSummary: z.string().optional(),
      })
    )
    .default([]),
});

const existingTargetSchema = z.object({
  kind: z.enum(["ssh", "aws", "azure", "gcp"]),
  host: z.string().optional(),
  port: z.string().optional(),
  user: z.string().optional(),
  region: z.string().optional(),
  projectId: z.string().optional(),
  subscriptionId: z.string().optional(),
  tenantId: z.string().optional(),
  serviceName: z.string().optional(),
  serviceUrl: z.string().optional(),
  password: z.string().optional(),
  privateKey: z.string().optional(),
  accessKeyId: z.string().optional(),
  secretAccessKey: z.string().optional(),
  credentialsJson: z.string().optional(),
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
});

const startSchema = z.object({
  source: z.enum(["sample", "ticket", "jira"]).default("sample"),
  mode: z.enum(["simulate", "live"]),
  changeKind: z.enum(["new_app", "existing_repo"]).default("new_app"),
  repoUrl: z.string().optional(),
  ticket: ticketSchema.optional(),
  existingTarget: existingTargetSchema.optional(),
  existingConnectionId: z.string().optional(),
  existingServiceUrl: z.string().optional(),
  projectId: z.string().optional(),
});

const slotSchema = z.object({
  provider: z.string(),
  endpoint: z.string(),
  region: z.string(),
  deploymentName: z.string(),
});

const policySchema = z.object({
  model: slotSchema.optional(),
  planModel: slotSchema,
  codeModel: slotSchema,
  jira: z.object({
    deployment: z.enum(["cloud", "datacenter"]),
    siteUrl: z.string(),
    projectKeys: z.array(z.string()),
    updateStatus: z.boolean(),
    accountEmail: z.string(),
  }),
  git: z.object({
    host: z.enum(["github", "gitlab", "azure-devops"]),
    botLogin: z.string(),
    defaultBaseBranch: z.string().min(1),
    autoOpenPr: z.boolean(),
  }),
  sandbox: z.enum(["docker-local", "dedicated-runner"]),
  allowedLanguages: z.array(z.string().min(1)).min(1),
  allowedPackageSources: z.array(z.string().min(1)).min(1),
  allowedLicenses: z.array(z.string().min(1)).min(1),
  tokenCap: z.number().positive(),
  costCapUsd: z.number().positive(),
  rollbackOwner: z.string().min(1),
  architectureApprover: z.string().min(1),
  codeReviewer: z.string().min(1),
  deployApprover: z.string().min(1),
  devTargetLabel: z.string().min(1),
  pipelineId: z.string(),
  jiraConnectionId: z.string().optional(),
  planModelConnectionId: z.string().optional(),
  codeModelConnectionId: z.string().optional(),
  gitConnectionId: z.string().optional(),
  testBar: z.array(z.enum(["lint", "unit", "integration"])).refine(
    (bar) => DELIVERY_TEST_BAR.every((check) => bar.includes(check)),
    "lint, unit, and integration are required"
  ),
});

function actor(req: AuthedRequest): string {
  return req.user?.name || "operator";
}

function sendError(res: { status: (code: number) => { json: (body: unknown) => void } }, err: unknown) {
  if (err instanceof DeliveryError) {
    res.status(err.status).json({ error: err.message, code: err.code });
    return;
  }
  if (err instanceof z.ZodError) {
    res.status(400).json({ error: err.issues.map((issue) => issue.message).join("; ") });
    return;
  }
  res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
}

function secretEquals(expected: string, presented: string): boolean {
  const a = createHash("sha256").update(expected).digest();
  const b = createHash("sha256").update(presented).digest();
  return timingSafeEqual(a, b);
}

function publicPolicy(): DeliveryPolicyPublic {
  const policy = normalizeDeliveryPolicy(delivery.store.getPolicy());
  const secrets = resolveDeliverySecrets();
  policy.planModel.hasApiKey = Boolean(secrets.planApiKey || secrets.modelApiKey);
  policy.codeModel.hasApiKey = Boolean(
    secrets.codeApiKey ||
      (policy.planModel.provider === policy.codeModel.provider && (secrets.planApiKey || secrets.modelApiKey))
  );
  policy.model = { ...policy.planModel };
  policy.jira.hasToken = Boolean(secrets.jiraToken);
  policy.jira.webhookSecretSet = Boolean(secrets.webhookSecret);
  policy.git.hasToken = Boolean(secrets.gitToken);
  policy.testBar = DELIVERY_TEST_BAR.filter((check) => policy.testBar.includes(check)).length
    ? policy.testBar
    : defaultDeliveryPolicy().testBar;
  return policy;
}

export function registerDeliveryRoutes(app: Express): void {
  app.get("/api/delivery/policy", requireRole("viewer"), (_req, res) => {
    ensurePolicyConnections();
    res.json(publicPolicy());
  });

  app.put("/api/delivery/policy", requireRole("admin"), (req: AuthedRequest, res) => {
    try {
      const parsed = policySchema.parse(req.body);
      if (!PLAN_PROVIDER_IDS.includes(parsed.planModel.provider as (typeof PLAN_PROVIDER_IDS)[number])) {
        throw new DeliveryError("That vendor cannot write the plan. Pick a chat model.", 400, "plan_model");
      }
      if (!CODE_PROVIDER_IDS.includes(parsed.codeModel.provider as (typeof CODE_PROVIDER_IDS)[number])) {
        throw new DeliveryError("That vendor cannot write the code.", 400, "code_model");
      }
      if (isFolderAgent(parsed.planModel.provider)) {
        throw new DeliveryError("Folder agents cannot be the plan model.", 400, "plan_model");
      }
      const current = delivery.store.getPolicy();
      const saved = delivery.store.savePolicy(
        normalizeDeliveryPolicy({
          ...current,
          ...parsed,
          identity: "local",
          planModel: { ...parsed.planModel, hasApiKey: current.planModel.hasApiKey },
          codeModel: { ...parsed.codeModel, hasApiKey: current.codeModel.hasApiKey },
          model: { ...parsed.planModel, hasApiKey: current.planModel.hasApiKey },
          jira: {
            ...parsed.jira,
            projectKeys: parsed.jira.projectKeys.map((key) => key.trim()).filter(Boolean),
            hasToken: current.jira.hasToken,
            webhookSecretSet: current.jira.webhookSecretSet,
          },
          git: { ...parsed.git, hasToken: current.git.hasToken },
          jiraConnectionId: parsed.jiraConnectionId ?? current.jiraConnectionId,
          planModelConnectionId: parsed.planModelConnectionId ?? current.planModelConnectionId,
          codeModelConnectionId: parsed.codeModelConnectionId ?? current.codeModelConnectionId,
          gitConnectionId: parsed.gitConnectionId ?? current.gitConnectionId,
          testBar: [...DELIVERY_TEST_BAR],
        })
      );
      applySelectedBuildConnections({
        jiraConnectionId: saved.jiraConnectionId,
        planModelConnectionId: saved.planModelConnectionId,
        codeModelConnectionId: saved.codeModelConnectionId,
        gitConnectionId: saved.gitConnectionId,
      });
      audit("delivery.policy_updated", saved.devTargetLabel, actor(req));
      res.json(publicPolicy());
    } catch (err) {
      sendError(res, err);
    }
  });

  app.put("/api/delivery/secrets", requireRole("admin"), (req: AuthedRequest, res) => {
    const body = z
      .object({
        modelApiKey: z.string().optional(),
        planApiKey: z.string().optional(),
        codeApiKey: z.string().optional(),
        jiraToken: z.string().optional(),
        webhookSecret: z.string().optional(),
        gitToken: z.string().optional(),
      })
      .parse(req.body);
    const current = delivery.store.getSecrets();
    const next = { ...current };
    for (const key of ["modelApiKey", "planApiKey", "codeApiKey", "jiraToken", "webhookSecret", "gitToken"] as const) {
      if (typeof body[key] !== "string") continue;
      const value = body[key].trim();
      if (!value) continue;
      next[key] = value;
    }
    delivery.store.saveSecrets(next);
    audit("delivery.secrets_updated", "credential material updated", actor(req));
    res.json(publicPolicy());
  });

  app.post("/api/delivery/project-rules", requireRole("operator"), async (req, res) => {
    try {
      const body = z.object({ repoUrl: z.string().min(1) }).parse(req.body);
      const policy = delivery.store.getPolicy();
      const token = delivery.store.getSecrets().gitToken ?? "";
      if (!token.trim()) {
        return res.status(400).json({ error: "Save a Git token before reading the existing repository." });
      }
      const detected = await readProjectRules({
        repoUrl: body.repoUrl,
        token,
        ref: policy.git.defaultBaseBranch,
      });
      if (!detected?.allowedLanguages.length) {
        return res.status(400).json({ error: "Could not read languages, packages, or a license from that repository." });
      }
      const licenses = detected.allowedLicenses.length ? detected.allowedLicenses : policy.allowedLicenses;
      delivery.store.savePolicy({
        ...policy,
        allowedLanguages: detected.allowedLanguages,
        allowedPackageSources: detected.allowedPackageSources,
        allowedLicenses: licenses,
      });
      audit("delivery.policy_updated", `rules from ${body.repoUrl}`, actor(req));
      res.json({
        policy: publicPolicy(),
        allowedLanguages: detected.allowedLanguages,
        allowedPackageSources: detected.allowedPackageSources,
        allowedLicenses: licenses,
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get("/api/delivery/sample-ticket", requireRole("viewer"), (_req, res) => {
    res.json(delivery.sampleTicket());
  });

  app.get("/api/delivery/jira/issues/:key", requireRole("viewer"), async (req, res) => {
    try {
      res.json(await delivery.loadJira(String(req.params.key)));
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get("/api/delivery/jira/issues/:key/attachments/:name", requireRole("viewer"), (req, res) => {
    const file = readStoredAttachment(
      pendingAttachmentDir(delivery.store.getRoot(), String(req.params.key)),
      String(req.params.name)
    );
    if (!file) return res.status(404).json({ error: "Attachment not found" });
    res.setHeader("Content-Type", file.mimeType);
    res.setHeader("Cache-Control", "private, max-age=120");
    res.send(file.bytes);
  });

  app.get("/api/delivery/runs", requireRole("viewer"), (req, res) => {
    const projectId = typeof req.query.projectId === "string" ? req.query.projectId : "";
    let runs = delivery.store.listRuns();
    if (projectId) {
      const oldest = [...store.projects.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
      runs = runs.filter(
        (run) => run.projectId === projectId || (!run.projectId && oldest?.id === projectId)
      );
    }
    res.json(runs.map(presentRun));
  });

  app.get("/api/delivery/runs/:id", requireRole("viewer"), (req, res) => {
    const run = delivery.store.getRun(String(req.params.id));
    if (!run) return res.status(404).json({ error: "Delivery run not found" });
    res.json(presentRun(run));
  });

  app.get("/api/delivery/runs/:id/attachments/:name", requireRole("viewer"), (req, res) => {
    const run = delivery.store.getRun(String(req.params.id));
    if (!run) return res.status(404).json({ error: "Delivery run not found" });
    const wanted = String(req.params.name);
    const meta = run.ticket.attachments.find((item) => (item.storedName || item.filename) === wanted);
    const file = readStoredAttachment(runAttachmentDir(delivery.store.getRoot(), run.id), wanted, meta?.mimeType);
    if (!file) return res.status(404).json({ error: "Attachment not found" });
    res.setHeader("Content-Type", file.mimeType);
    res.setHeader("Cache-Control", "private, max-age=300");
    res.send(file.bytes);
  });

  app.post("/api/delivery/runs", requireRole("operator"), async (req: AuthedRequest, res) => {
    try {
      const body = startSchema.parse(req.body);
      const ticket: DeliveryTicket | undefined =
        body.source === "sample"
          ? delivery.sampleTicket()
          : body.source === "jira"
            ? await delivery.loadJira(body.ticket?.key ?? "")
            : body.ticket;
      if (!ticket) return res.status(400).json({ error: "A ticket is required" });
      const existingTarget = body.existingConnectionId
        ? existingTargetFromConnection(body.existingConnectionId, { serviceUrl: body.existingServiceUrl })
        : body.existingTarget;
      const result = await delivery.start({
        mode: body.mode,
        changeKind: body.changeKind,
        repoUrl: body.repoUrl,
        ticket,
        actor: actor(req),
        existingTarget,
        projectId: body.projectId,
      });
      audit(
        result.duplicate ? "delivery.run_duplicate" : "delivery.run_started",
        `${result.run.ticket.key} ${result.run.mode}`,
        actor(req)
      );
      res.status(result.duplicate ? 200 : 201).json(result);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get("/api/delivery/runs/:id/workspace", requireRole("viewer"), (req, res) => {
    try {
      res.json(delivery.workspaceFiles(String(req.params.id)));
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get("/api/delivery/runs/:id/workspace/file", requireRole("viewer"), (req, res) => {
    try {
      const rel = z.object({ path: z.string().min(1) }).parse(req.query).path;
      res.json(delivery.workspaceFile(String(req.params.id), rel));
    } catch (err) {
      sendError(res, err);
    }
  });

  app.put("/api/delivery/runs/:id/workspace/file", requireRole("operator"), async (req: AuthedRequest, res) => {
    try {
      const body = z.object({ path: z.string().min(1), contents: z.string() }).parse(req.body);
      const saved = await delivery.saveWorkspaceFile(String(req.params.id), body.path, body.contents, actor(req));
      audit("delivery.file_saved", `${saved.run.ticket.key} ${saved.path}`, actor(req));
      res.json(saved);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/delivery/runs/:id/workspace/file", requireRole("operator"), async (req: AuthedRequest, res) => {
    try {
      const body = z.object({ path: z.string().min(1), contents: z.string().optional().default("") }).parse(req.body);
      const created = await delivery.createWorkspaceFile(String(req.params.id), body.path, body.contents, actor(req));
      audit("delivery.file_added", `${created.run.ticket.key} ${created.path}`, actor(req));
      res.status(201).json(created);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.delete("/api/delivery/runs/:id/workspace/file", requireRole("operator"), async (req: AuthedRequest, res) => {
    try {
      const rel = z.object({ path: z.string().min(1) }).parse(req.query).path;
      const removed = await delivery.deleteWorkspaceFile(String(req.params.id), rel, actor(req));
      audit("delivery.file_deleted", `${removed.run.ticket.key} ${removed.path}`, actor(req));
      res.json(removed);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get("/api/delivery/runs/:id/preview", requireRole("viewer"), (req, res) => {
    const current = previewFor(String(req.params.id));
    res.json(
      current
        ? { running: true, ...current, page: current.url }
        : { running: false }
    );
  });

  app.post("/api/delivery/runs/:id/preview", requireRole("operator"), async (req: AuthedRequest, res) => {
    try {
      const info = delivery.preview(String(req.params.id));
      const started = await startPreview(String(req.params.id), info.workspace);
      audit("delivery.preview_started", String(req.params.id), actor(req));
      res.json(started);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.delete("/api/delivery/runs/:id/preview", requireRole("operator"), async (req: AuthedRequest, res) => {
    const id = String(req.params.id);
    try {
      const info = delivery.preview(id);
      await stopStuckPreview(id, info.workspace);
    } catch {
      await stopPreview(id);
    }
    res.json({ stopped: true });
  });

  app.post("/api/delivery/runs/:id/preview/stop-stuck", requireRole("operator"), async (req: AuthedRequest, res) => {
    try {
      const info = delivery.preview(String(req.params.id));
      await stopStuckPreview(String(req.params.id), info.workspace);
      res.json({ stopped: true });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.use("/api/delivery/runs/:id/view", requireRole("viewer"), (req, res) => {
    proxyPreview(String(req.params.id), req, res);
  });

  app.post("/api/delivery/runs/:id/workbench", requireRole("operator"), async (req: AuthedRequest, res) => {
    try {
      const body = z
        .object({
          kind: z.enum(["fix", "new_ask", "code_edit", "approve_plan", "reject_plan"]),
          message: z.string().optional().default(""),
          role: z.enum(["code", "test"]).optional().default("code"),
          images: z
            .array(
              z.object({
                mimeType: z.string(),
                base64: z.string().max(1_500_000),
              })
            )
            .max(4)
            .optional()
            .default([]),
        })
        .parse(req.body);
      const images = body.images.flatMap((image) => {
        const mimeType = image.mimeType.toLowerCase();
        if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(mimeType)) return [];
        const base64 = image.base64.replace(/^data:[^;]+;base64,/, "").replace(/\s/g, "");
        return base64 ? [{ mimeType, base64 }] : [];
      });
      if ((body.kind === "fix" || body.kind === "new_ask" || body.kind === "code_edit") && !body.message.trim() && !images.length) {
        return res.status(400).json({ error: "Say what should change" });
      }
      const result = await delivery.workbench(String(req.params.id), body.kind, body.message, actor(req), images, body.role);
      audit(`delivery.workbench_${body.kind}`, result.run.ticket.key, actor(req));
      res.json(result);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/delivery/runs/:id/existing-target", requireRole("operator"), async (req: AuthedRequest, res) => {
    try {
      const raw = (req.body ?? {}) as { existingConnectionId?: string; existingServiceUrl?: string };
      const body = raw.existingConnectionId
        ? existingTargetFromConnection(String(raw.existingConnectionId), { serviceUrl: raw.existingServiceUrl })
        : existingTargetSchema.parse(req.body);
      const run = await delivery.setExistingTarget(String(req.params.id), body, actor(req));
      audit("delivery.existing_target_saved", run.ticket.key, actor(req));
      res.json(presentRun(run));
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/delivery/runs/:id/revise", requireRole("operator"), async (req: AuthedRequest, res) => {
    try {
      const note = z.object({ note: z.string().min(1) }).parse(req.body).note;
      const run = await delivery.revise(String(req.params.id), note, actor(req));
      audit("delivery.architecture_revised", run.ticket.key, actor(req));
      res.json(run);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/delivery/runs/:id/tests", requireRole("operator"), async (req: AuthedRequest, res) => {
    try {
      const result = await delivery.runTests(String(req.params.id), actor(req));
      audit("delivery.tests_run", result.run.ticket.key, actor(req));
      res.json(result);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/delivery/runs/:id/decision", requireRole("operator"), async (req: AuthedRequest, res) => {
    try {
      const body = z
        .object({
          gate: z.enum(["architecture", "code_review", "deploy"]),
          action: z.enum(["approve", "reject", "skip"]),
          note: z.string().optional(),
        })
        .parse(req.body);
      const run = await delivery.decide(String(req.params.id), body.gate, body.action, actor(req), body.note);
      audit(`delivery.${body.gate}_${body.action}`, run.ticket.key, actor(req));
      res.json(run);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/delivery/runs/:id/kill", requireRole("operator"), async (req: AuthedRequest, res) => {
    try {
      const run = await delivery.kill(String(req.params.id), actor(req));
      audit("delivery.killed", run.ticket.key, actor(req));
      res.json(run);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/delivery/jira/webhook", async (req, res) => {
    try {
      const expected = delivery.store.getSecrets().webhookSecret ?? "";
      if (!expected) return res.status(401).json({ error: "Webhook secret is not configured" });
      const presented = String(req.header("x-shipdeck-webhook-secret") ?? "");
      if (!secretEquals(expected, presented)) return res.status(401).json({ error: "Invalid webhook secret" });
      const body = z
        .object({
          webhookId: z.string().min(1),
          mode: z.enum(["simulate", "live"]).default("live"),
          changeKind: z.enum(["new_app", "existing_repo"]).default("new_app"),
          repoUrl: z.string().optional(),
          ticket: ticketSchema,
        })
        .parse(req.body);
      const policy = delivery.store.getPolicy();
      const project = body.ticket.key.split("-")[0]?.toUpperCase();
      if (policy.jira.projectKeys.length && project && !policy.jira.projectKeys.map((k) => k.toUpperCase()).includes(project)) {
        return res.status(403).json({ error: `Project ${project} is not allowed to start a run` });
      }
      const seen = delivery.store.runIdForWebhook(body.webhookId);
      if (seen) {
        const run = delivery.store.getRun(seen);
        audit("delivery.webhook_duplicate", body.webhookId, "jira");
        return res.json({ duplicate: true, run });
      }
      const result = await delivery.start({
        mode: body.mode,
        changeKind: body.changeKind,
        repoUrl: body.repoUrl,
        ticket: body.ticket,
        actor: "jira",
      });
      delivery.store.rememberWebhook(body.webhookId, result.run.id);
      audit(result.duplicate ? "delivery.webhook_duplicate" : "delivery.webhook_started", result.run.ticket.key, "jira");
      res.status(result.duplicate ? 200 : 202).json(result);
    } catch (err) {
      sendError(res, err);
    }
  });
}
