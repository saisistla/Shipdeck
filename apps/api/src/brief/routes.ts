import type { Express, Response } from "express";
import { ZodError, z } from "zod";
import { INDUSTRY_CATALOG } from "@shipdeck/shared";
import { audit } from "../audit.js";
import type { AuthedRequest } from "../auth.js";
import { requireRole } from "../auth.js";
import { briefs, } from "./index.js";
import { BriefError } from "./service.js";

const modeSchema = z.enum(["simulate", "live"]);

function actor(req: AuthedRequest): string {
  return req.user?.name || "operator";
}

function sendError(res: Response, err: unknown) {
  if (err instanceof BriefError) return res.status(err.status).json({ error: err.message });
  if (err instanceof ZodError) return res.status(400).json({ error: "Check the fields and try again" });
  const message = err instanceof Error ? err.message : String(err);
  return res.status(500).json({ error: message });
}

function sendDeck(res: Response, file: { filename: string; bytes: Buffer }) {
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.presentationml.presentation");
  res.setHeader("Content-Disposition", `attachment; filename="${file.filename}"`);
  res.send(file.bytes);
}

export function registerBriefRoutes(app: Express) {
  app.get("/api/briefs/catalog", requireRole("viewer"), (_req, res) => {
    res.json({ industries: INDUSTRY_CATALOG });
  });

  app.get("/api/briefs", requireRole("viewer"), (req, res) => {
    const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
    res.json(briefs.list(projectId));
  });

  app.get("/api/briefs/by-delivery/:runId", requireRole("viewer"), (req, res) => {
    const runId = String(req.params.runId);
    const brief = briefs.byDelivery(runId);
    if (!brief) return res.status(404).json({ error: "This ticket did not start from an idea" });
    res.json(brief);
  });

  app.get("/api/briefs/by-delivery/:runId/presentation", requireRole("viewer"), (req, res) => {
    try {
      sendDeck(res, briefs.presentationForDelivery(String(req.params.runId)));
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/briefs", requireRole("operator"), (req: AuthedRequest, res) => {
    try {
      const body = z
        .object({
          projectId: z.string().optional(),
          industryId: z.string().min(1),
          name: z.string().optional(),
          mode: modeSchema,
        })
        .parse(req.body);
      const brief = briefs.create(body);
      audit("brief.created", `${brief.applicationName} ${brief.mode}`, actor(req));
      res.status(201).json(brief);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get("/api/briefs/:id", requireRole("viewer"), (req, res) => {
    try {
      res.json(briefs.get(String(req.params.id)));
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/briefs/:id/chat", requireRole("operator"), async (req: AuthedRequest, res) => {
    try {
      const body = z.object({ message: z.string().min(1), mode: modeSchema }).parse(req.body);
      const brief = await briefs.chat(String(req.params.id), body.message, body.mode);
      res.json(brief);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/briefs/:id/upload", requireRole("operator"), (req: AuthedRequest, res) => {
    try {
      const body = z
        .object({
          filename: z.string().min(1),
          text: z.string().optional(),
          base64: z.string().optional(),
        })
        .parse(req.body);
      const bytes = body.base64 ? Buffer.from(body.base64, "base64") : Buffer.from(body.text ?? "", "utf8");
      if (!bytes.length) return res.status(400).json({ error: "Upload a report or paste its text" });
      if (bytes.length > 1_500_000) return res.status(413).json({ error: "That file is too large. Paste the important pages instead." });
      const brief = briefs.upload(String(req.params.id), body.filename, bytes);
      audit("brief.uploaded", brief.upload?.filename ?? body.filename, actor(req));
      res.json(brief);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/briefs/:id/report", requireRole("operator"), async (req: AuthedRequest, res) => {
    try {
      const body = z.object({ mode: modeSchema }).parse(req.body);
      const brief = await briefs.report(String(req.params.id), body.mode);
      audit("brief.report", brief.id, actor(req));
      res.json(brief);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/briefs/:id/research", requireRole("operator"), async (req: AuthedRequest, res) => {
    try {
      const body = z.object({ mode: modeSchema }).parse(req.body);
      const brief = await briefs.research(String(req.params.id), body.mode);
      audit("brief.research", brief.id, actor(req));
      res.json(brief);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/briefs/:id/technical", requireRole("operator"), (req: AuthedRequest, res) => {
    try {
      const body = z.object({ markdown: z.string() }).parse(req.body);
      const brief = briefs.saveTechnical(String(req.params.id), body.markdown);
      audit("brief.technical", brief.id, actor(req));
      res.json(brief);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/briefs/:id/send", requireRole("operator"), async (req: AuthedRequest, res) => {
    try {
      const body = z.object({ mode: modeSchema, jiraConnectionId: z.string().optional() }).parse(req.body);
      const brief = await briefs.send(String(req.params.id), body.mode, actor(req), body.jiraConnectionId);
      audit("brief.sent", `${brief.ticketKey ?? brief.id} ${body.mode}`, actor(req));
      res.json(brief);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get("/api/briefs/:id/presentation", requireRole("viewer"), (req, res) => {
    try {
      sendDeck(res, briefs.presentation(String(req.params.id)));
    } catch (err) {
      sendError(res, err);
    }
  });
}
