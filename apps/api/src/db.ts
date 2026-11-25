import pg from "pg";
import type { AuditEvent, Connection, Pipeline, PipelineRun, PlatformUser, Project } from "@shipdeck/shared";
import { encryptJson, decryptJson } from "./lib/crypto.js";

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function usingPostgres(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function getPool(): pg.Pool | null {
  return pool;
}

function sslOption(url: string): { rejectUnauthorized: boolean } | undefined {
  return /[?&]sslmode=(require|verify-ca|verify-full)/i.test(url)
    ? { rejectUnauthorized: false }
    : undefined;
}

export async function initPostgres(): Promise<boolean> {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) return false;
  pool = new Pool({ connectionString: url, ssl: sslOption(url) });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS shipdeck_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pipelines (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS connections (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS connection_secrets (
      id TEXT PRIMARY KEY,
      blob TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL,
      data JSONB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      token_hash TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      at TIMESTAMPTZ NOT NULL,
      data JSONB NOT NULL
    );
  `);
  return true;
}

export async function pgLoadAll(): Promise<{
  projects: Project[];
  pipelines: Pipeline[];
  connections: Connection[];
  secrets: Record<string, Record<string, string>>;
  runs: PipelineRun[];
  users: { user: PlatformUser; tokenHash: string }[];
}> {
  if (!pool) throw new Error("Postgres not initialized");
  const [projects, pipelines, connections, secretsRows, runs, users] = await Promise.all([
    pool.query<{ data: Project }>("SELECT data FROM projects"),
    pool.query<{ data: Pipeline }>("SELECT data FROM pipelines"),
    pool.query<{ data: Connection }>("SELECT data FROM connections"),
    pool.query<{ id: string; blob: string }>("SELECT id, blob FROM connection_secrets"),
    pool.query<{ data: PipelineRun }>("SELECT data FROM runs ORDER BY created_at DESC LIMIT 100"),
    pool.query<{ data: PlatformUser; token_hash: string }>("SELECT data, token_hash FROM users"),
  ]);
  const secrets: Record<string, Record<string, string>> = {};
  for (const row of secretsRows.rows) {
    try {
      const wrapper = decryptJson(row.blob);
      secrets[row.id] = wrapper.__nested__
        ? (JSON.parse(wrapper.__nested__) as Record<string, string>)
        : wrapper;
    } catch {
      /* skip bad row */
    }
  }
  return {
    projects: projects.rows.map((r) => r.data),
    pipelines: pipelines.rows.map((r) => r.data),
    connections: connections.rows.map((r) => r.data),
    secrets,
    runs: runs.rows.map((r) => r.data),
    users: users.rows.map((r) => ({ user: r.data, tokenHash: r.token_hash })),
  };
}

export async function pgPersistSnapshot(input: {
  projects: Project[];
  pipelines: Pipeline[];
  connections: Connection[];
  secrets: Record<string, Record<string, string>>;
  runs: PipelineRun[];
  users: { user: PlatformUser; tokenHash: string }[];
}) {
  if (!pool) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM projects");
    await client.query("DELETE FROM pipelines");
    await client.query("DELETE FROM connections");
    await client.query("DELETE FROM connection_secrets");
    await client.query("DELETE FROM runs");
    await client.query("DELETE FROM users");
    for (const p of input.projects) {
      await client.query("INSERT INTO projects (id, data) VALUES ($1, $2)", [p.id, p]);
    }
    for (const p of input.pipelines) {
      await client.query("INSERT INTO pipelines (id, data) VALUES ($1, $2)", [p.id, p]);
    }
    for (const c of input.connections) {
      await client.query("INSERT INTO connections (id, data) VALUES ($1, $2)", [c.id, c]);
    }
    for (const [id, secrets] of Object.entries(input.secrets)) {
      const blob = encryptJson({ __nested__: JSON.stringify(secrets) });
      await client.query("INSERT INTO connection_secrets (id, blob) VALUES ($1, $2)", [id, blob]);
    }
    for (const r of input.runs.slice(0, 100)) {
      await client.query("INSERT INTO runs (id, created_at, data) VALUES ($1, $2, $3)", [
        r.id,
        r.createdAt,
        r,
      ]);
    }
    for (const u of input.users) {
      await client.query("INSERT INTO users (id, data, token_hash) VALUES ($1, $2, $3)", [
        u.user.id,
        u.user,
        u.tokenHash,
      ]);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function pgInsertAudit(event: AuditEvent) {
  if (!pool) return;
  await pool.query("INSERT INTO audit_events (id, at, data) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [
    event.id,
    event.at,
    event,
  ]);
}
