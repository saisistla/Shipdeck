import type { Connection } from "@shipdeck/shared";
import type { SshTarget } from "../lib/ssh.js";
import { store } from "../store.js";

export function resolveSshTarget(connectionId?: string): SshTarget | null {
  if (!connectionId) return null;
  const conn = store.connections.get(connectionId);
  if (!conn || conn.type !== "ssh") return null;
  const secrets = store.connectionSecrets.get(connectionId) ?? {};
  return {
    host: conn.config.host,
    port: Number(conn.config.port || 22),
    username: conn.config.user || "ubuntu",
    privateKey: secrets.privateKey,
    password: secrets.password,
    privateKeyPath: secrets.privateKeyPath || conn.config.privateKeyPath,
  };
}

export function getConnection(id?: string): Connection | undefined {
  if (!id) return undefined;
  return store.connections.get(id);
}

export function getSecrets(id?: string): Record<string, string> {
  if (!id) return {};
  return store.connectionSecrets.get(id) ?? {};
}
