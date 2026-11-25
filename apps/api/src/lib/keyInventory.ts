import { createHash } from "node:crypto";
import type { Connection, ConnectionType, StoredKeyRecord } from "@shipdeck/shared";
import { store } from "../store.js";

const EXPECTED_SECRETS: Record<ConnectionType, string[]> = {
  ssh: ["privateKey"],
  aws: ["accessKeyId", "secretAccessKey", "sshPrivateKey"],
  azure: ["clientId", "clientSecret", "sshPrivateKey"],
  gcp: ["credentialsJson", "sshPrivateKey"],
  git: ["token"],
  jira: ["token", "webhookSecret"],
  model: ["apiKey"],
  docker: ["token"],
  registry: ["password"],
  kubernetes: ["kubeconfig"],
  notify: ["token"],
};

const LABELS: Record<string, string> = {
  privateKey: "SSH private key",
  sshPrivateKey: "Deploy PEM",
  password: "Password",
  token: "Token",
  apiKey: "API key",
  webhookSecret: "Webhook secret",
  personalAccessToken: "Personal access token",
  accessKeyId: "AWS access key",
  secretAccessKey: "AWS secret key",
  credentialsJson: "GCP service-account JSON",
  GOOGLE_CREDENTIALS: "GCP credentials",
  clientId: "Azure client ID",
  clientSecret: "Azure client secret",
};

function labelFor(name: string): string {
  return LABELS[name] ?? name;
}

function fingerprint(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function masked(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "(empty)";
  if (/BEGIN [A-Z ]*PRIVATE KEY/i.test(trimmed)) {
    const last = trimmed.replace(/\s+/g, "").slice(-4);
    return "-----BEGIN PRIVATE KEY----- · ••••• · END · …" + last;
  }
  if (/^\s*ssh-(rsa|ed25519|dss)/i.test(trimmed) || trimmed.startsWith("{")) {
    return `${trimmed.slice(0, 18)}…${trimmed.slice(-6)}`;
  }
  if (trimmed.length <= 8) return "••••";
  return `${trimmed.slice(0, 2)}••••${trimmed.slice(-4)}`;
}

function encryptedView(value: string): string {
  return `aes-256-gcm · sha256:${fingerprint(value)}`;
}

function expectedSecrets(type: ConnectionType): string[] {
  return EXPECTED_SECRETS[type] ?? ["token"];
}

function missingRecord(conn: Connection, secretName: string): StoredKeyRecord {
  return {
    id: `${conn.id}:${secretName}`,
    connectionId: conn.id,
    connectionName: conn.name,
    connectionType: conn.type,
    secretName,
    label: labelFor(secretName),
    source: "user-provided",
    createdAt: conn.createdAt,
    updatedAt: conn.updatedAt,
    fingerprint: "",
    encrypted: "Not saved",
    masked: "Add this secret in Connections",
    missing: true,
  };
}

export function listStoredKeys(): StoredKeyRecord[] {
  const rows: StoredKeyRecord[] = [];
  const connections = [...store.connections.values()].sort((a, b) => a.name.localeCompare(b.name));
  for (const conn of connections) {
    const secrets = store.connectionSecrets.get(conn.id) ?? {};
    const names = new Set([...expectedSecrets(conn.type), ...Object.keys(secrets)]);
    let any = false;
    for (const secretName of names) {
      const value = secrets[secretName];
      if (typeof value === "string" && value.trim()) {
        rows.push(toRecord(conn, secretName, value));
        any = true;
        continue;
      }
      if (expectedSecrets(conn.type).includes(secretName)) {
        rows.push(missingRecord(conn, secretName));
        any = true;
      }
    }
    if (!any) rows.push(missingRecord(conn, "secret"));
  }
  return rows;
}

export function revealStoredKey(
  connectionId: string,
  secretName: string
): { record: StoredKeyRecord; plaintext: string } | undefined {
  const conn = store.connections.get(connectionId);
  if (!conn) return undefined;
  const value = store.connectionSecrets.get(connectionId)?.[secretName];
  if (typeof value !== "string" || !value.trim()) return undefined;
  return { record: toRecord(conn, secretName, value), plaintext: value };
}

function toRecord(conn: Connection, secretName: string, value: string): StoredKeyRecord {
  const auto =
    (secretName === "privateKey" || secretName === "sshPrivateKey") &&
    conn.config.deployKeySource === "auto-generated";
  return {
    id: `${conn.id}:${secretName}`,
    connectionId: conn.id,
    connectionName: conn.name,
    connectionType: conn.type,
    secretName,
    label: labelFor(secretName),
    source: auto ? "auto-generated" : "user-provided",
    createdAt: conn.createdAt,
    updatedAt: conn.updatedAt,
    fingerprint: fingerprint(value).slice(0, 16),
    encrypted: encryptedView(value),
    masked: masked(value),
  };
}
