import type { Express, Response } from "express";
import { ZodError, z } from "zod";
import { audit } from "../audit.js";
import type { AuthedRequest } from "../auth.js";
import { requireRole } from "../auth.js";
import { sales } from "./index.js";
import { SalesError } from "./service.js";

function actor(req: AuthedRequest): string {
  return req.user?.name || "operator";
}

function sendError(res: Response, err: unknown) {
  if (err instanceof SalesError) return res.status(err.status).json({ error: err.message });
  if (err instanceof ZodError) return res.status(400).json({ error: "Check the fields and try again" });
  const message = err instanceof Error ? err.message : String(err);
  return res.status(500).json({ error: message });
}

export function registerSalesRoutes(app: Express) {
  app.get("/api/sales", requireRole("viewer"), (req, res) => {
    const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
    res.json(sales.queue(projectId));
  });

  app.get("/api/sales/by-brief/:briefId", requireRole("viewer"), (req, res) => {
    try {
      res.json(sales.get(String(req.params.briefId)));
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get("/api/sales/by-brief/:briefId/export", requireRole("viewer"), (req, res) => {
    try {
      const file = sales.spreadsheet(String(req.params.briefId));
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${file.filename}"`);
      res.send(file.csv);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/sales/by-brief/:briefId/status", requireRole("operator"), (req: AuthedRequest, res) => {
    try {
      const body = z
        .object({
          website: z.string().min(1),
          status: z.enum(["new", "working", "replied", "not a fit"]),
          repNote: z.string().optional(),
        })
        .parse(req.body);
      const view = sales.updateStatus(String(req.params.briefId), body.website, body.status, body.repNote);
      res.json(view);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/sales/by-brief/:briefId/find", requireRole("operator"), async (req: AuthedRequest, res) => {
    try {
      const body = z
        .object({
          mode: z.enum(["simulate", "live"]),
          search: z
            .object({
              country: z.string().optional(),
              place: z.string().optional(),
              organisation: z.string().optional(),
              buyer: z.string().optional(),
              note: z.string().optional(),
            })
            .optional(),
        })
        .parse(req.body);
      const view = await sales.find(String(req.params.briefId), body.mode, body.search);
      audit("sales.find", `${view.title} ${view.accounts.length}`, actor(req));
      res.json(view);
    } catch (err) {
      sendError(res, err);
    }
  });
}
