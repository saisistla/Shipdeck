import type { NextFunction, Request, Response } from "express";

const hits = new Map<string, { count: number; resetAt: number }>();

/** Simple in-memory rate limit (per IP). */
export function rateLimitMiddleware(opts: { windowMs?: number; max?: number } = {}) {
  const windowMs = opts.windowMs ?? 60_000;
  const max = opts.max ?? 180;
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.path === "/api/health") return next();
    const key = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    let bucket = hits.get(key);
    if (!bucket || bucket.resetAt < now) {
      bucket = { count: 0, resetAt: now + windowMs };
      hits.set(key, bucket);
    }
    bucket.count += 1;
    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, max - bucket.count)));
    if (bucket.count > max) {
      return res.status(429).json({ error: "Too many requests" });
    }
    return next();
  };
}
