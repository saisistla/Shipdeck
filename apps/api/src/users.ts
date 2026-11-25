import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { nanoid } from "nanoid";
import type { PlatformUser, UserRole } from "@shipdeck/shared";
import { store } from "./store.js";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createUser(input: {
  name: string;
  role: UserRole;
  token?: string;
}): { user: PlatformUser; token: string } {
  const token = input.token || `sdk_${randomBytes(24).toString("hex")}`;
  const id = nanoid(10);
  const user: PlatformUser = {
    id,
    name: input.name,
    role: input.role,
    tokenHint: `${token.slice(0, 6)}…${token.slice(-4)}`,
    createdAt: new Date().toISOString(),
  };
  store.users.set(id, user);
  store.userTokenHashes.set(id, hashToken(token));
  store.persistSoon();
  return { user, token };
}

export function listUsers(): PlatformUser[] {
  return [...store.users.values()];
}

export function deleteUser(id: string): boolean {
  const ok = store.users.delete(id);
  store.userTokenHashes.delete(id);
  if (ok) store.persistSoon();
  return ok;
}

export function resolveUserByToken(token: string): PlatformUser | null {
  if (!token) return null;
  const hashed = hashToken(token);
  for (const [id, h] of store.userTokenHashes) {
    try {
      const a = Buffer.from(h, "hex");
      const b = Buffer.from(hashed, "hex");
      if (a.length === b.length && timingSafeEqual(a, b)) {
        return store.users.get(id) ?? null;
      }
    } catch {
      /* continue */
    }
  }
  // Legacy single API token
  const env = process.env.SHIPDECK_API_TOKEN?.trim();
  if (env && token === env) {
    return {
      id: "env-admin",
      name: "API Token",
      role: "admin",
      tokenHint: "env",
      createdAt: "",
    };
  }
  return null;
}

export function roleAtLeast(role: UserRole, min: UserRole): boolean {
  const rank = { viewer: 1, operator: 2, admin: 3 };
  return rank[role] >= rank[min];
}

/** Seed a default admin when auth is required and no users exist. */
export function ensureBootstrapAdmin(): string | null {
  if (store.users.size > 0) return null;
  const wantAuth = Boolean(process.env.SHIPDECK_API_TOKEN?.trim()) || process.env.SHIPDECK_BOOTSTRAP_ADMIN === "true";
  if (!wantAuth && process.env.SHIPDECK_BOOTSTRAP_ADMIN !== "true") return null;
  const token = process.env.SHIPDECK_API_TOKEN?.trim() || `sdk_${randomBytes(24).toString("hex")}`;
  createUser({ name: "Admin", role: "admin", token });
  return token;
}
