import type { Express, Response } from "express";
import { ZodError, z } from "zod";
import { audit } from "../audit.js";
import type { AuthedRequest } from "../auth.js";
import { requireRole } from "../auth.js";
import { marketing, marketingFilmFile, marketingStillFile } from "./index.js";
import { MarketingError } from "./service.js";

function actor(req: AuthedRequest): string {
  return req.user?.name || "operator";
}

function sendError(res: Response, err: unknown) {
  if (err instanceof MarketingError) return res.status(err.status).json({ error: err.message });
  if (err instanceof ZodError) return res.status(400).json({ error: "Check the fields and try again" });
  const message = err instanceof Error ? err.message : String(err);
  return res.status(500).json({ error: message });
}

const brief = z.object({
  mode: z.enum(["simulate", "live"]),
  topic: z.string().optional(),
  platform: z.string().optional(),
  audience: z.string().optional(),
});

export function registerMarketingRoutes(app: Express) {
  app.get("/api/marketing/still/:id/:scene", requireRole("viewer"), (req, res) => {
    const file = marketingStillFile(String(req.params.id), String(req.params.scene));
    if (!file) return res.status(404).json({ error: "That picture is not ready." });
    res.setHeader("content-type", "image/jpeg");
    res.sendFile(file);
  });

  app.get("/api/marketing/film/:id", requireRole("viewer"), (req, res) => {
    const file = marketingFilmFile(String(req.params.id));
    if (!file) return res.status(404).json({ error: "That film is not ready." });
    res.setHeader("content-type", "video/mp4");
    res.sendFile(file);
  });

  app.get("/api/marketing/by-brief/:briefId", requireRole("viewer"), (req, res) => {
    try {
      res.json(marketing.get(String(req.params.briefId)));
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/marketing/by-brief/:briefId/content", requireRole("operator"), async (req: AuthedRequest, res) => {
    try {
      const body = brief.parse(req.body);
      const view = await marketing.content(String(req.params.briefId), body.mode, body.topic || "", body.platform || "", body.audience || "");
      audit("marketing.content", view.title, actor(req));
      res.json(view);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/marketing/by-brief/:briefId/seo", requireRole("operator"), async (req: AuthedRequest, res) => {
    try {
      const body = brief.parse(req.body);
      const view = await marketing.seo(String(req.params.briefId), body.mode, body.topic || "", body.platform || "", body.audience || "");
      audit("marketing.seo", view.title, actor(req));
      res.json(view);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/marketing/by-brief/:briefId/image", requireRole("operator"), async (req: AuthedRequest, res) => {
    try {
      const body = z.object({ mode: z.enum(["simulate", "live"]), prompt: z.string().optional() }).parse(req.body);
      const view = await marketing.image(String(req.params.briefId), body.mode, body.prompt || "");
      audit("marketing.image", view.title, actor(req));
      res.json(view);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/marketing/by-brief/:briefId/video", requireRole("operator"), async (req: AuthedRequest, res) => {
    try {
      const body = brief.parse(req.body);
      const view = await marketing.video(String(req.params.briefId), body.mode, body.topic || "", body.platform || "", body.audience || "");
      audit("marketing.video", view.title, actor(req));
      res.json(view);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/marketing/by-brief/:briefId/chat", requireRole("operator"), async (req: AuthedRequest, res) => {
    try {
      const body = z
        .object({
          mode: z.enum(["simulate", "live"]),
          message: z.string().optional(),
          name: z.string().optional(),
          email: z.string().optional(),
          phone: z.string().optional(),
        })
        .parse(req.body);
      const view = await marketing.chat(
        String(req.params.briefId),
        body.mode,
        body.message || "",
        body.name || "",
        body.email || "",
        body.phone || ""
      );
      audit("marketing.chat", view.title, actor(req));
      res.json(view);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/marketing/by-brief/:briefId/lead", requireRole("operator"), (req: AuthedRequest, res) => {
    try {
      const body = z
        .object({
          name: z.string().optional(),
          email: z.string().optional(),
          phone: z.string().optional(),
          interest: z.string().optional(),
        })
        .parse(req.body);
      const view = marketing.saveLead(
        String(req.params.briefId),
        body.name || "",
        body.email || "",
        body.phone || "",
        body.interest || ""
      );
      audit("marketing.lead", view.title, actor(req));
      res.json(view);
    } catch (err) {
      sendError(res, err);
    }
  });
}
