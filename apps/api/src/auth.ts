import type { NextFunction, Request, Response } from "express";
import type { PlatformUser, UserRole } from "@shipdeck/shared";

declare global {
  namespace Express {
    interface Request {
      user?: PlatformUser | null;
    }
  }
}
import { store } from "./store.js";
import { resolveUserByToken, roleAtLeast } from "./users.js";

export type AuthedRequest = Request & { user?: PlatformUser | null };

/** Optional API token / user token auth. */
export function authMiddleware(req: AuthedRequest, res: Response, next: NextFunction) {
  const envToken = process.env.SHIPDECK_API_TOKEN?.trim();
  const header = req.headers.authorization ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7).trim() : "";

  if (req.path === "/api/health" || req.path === "/health" || req.path === "/api/delivery/jira/webhook") {
    return next();
  }

  if (presented) {
    const user = resolveUserByToken(presented);
    if (user) {
      req.user = user;
      return next();
    }
    return res.status(401).json({ error: "Unauthorized — invalid token" });
  }

  if (envToken || store.users.size > 0) {
    return res.status(401).json({
      error: "Unauthorized — set Authorization: Bearer <token>",
    });
  }

  req.user = null;
  return next();
}

export function requireRole(min: UserRole) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!process.env.SHIPDECK_API_TOKEN?.trim() && store.users.size === 0) {
      return next();
    }
    if (!req.user || !roleAtLeast(req.user.role, min)) {
      return res.status(403).json({ error: `Requires role ${min} or higher` });
    }
    return next();
  };
}
