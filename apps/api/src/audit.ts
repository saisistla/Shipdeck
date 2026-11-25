import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nanoid } from "nanoid";
import type { AuditEvent } from "@shipdeck/shared";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const auditFile = path.join(repoRoot, "data", "audit.jsonl");

type AuditSink = (event: AuditEvent) => void | Promise<void>;
let pgSink: AuditSink | null = null;

export function setAuditPgSink(sink: AuditSink | null) {
  pgSink = sink;
}

export function audit(action: string, detail?: string, actor?: string) {
  const event: AuditEvent = {
    id: nanoid(10),
    at: new Date().toISOString(),
    action,
    detail,
    actor,
  };
  try {
    fs.mkdirSync(path.dirname(auditFile), { recursive: true });
    fs.appendFileSync(auditFile, `${JSON.stringify(event)}\n`);
  } catch {
    /* ignore disk errors */
  }
  void pgSink?.(event);
  return event;
}

export function readAuditAll(): AuditEvent[] {
  try {
    if (!fs.existsSync(auditFile)) return [];
    return fs
      .readFileSync(auditFile, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as AuditEvent);
  } catch {
    return [];
  }
}

export function readAudit(limit = 100): AuditEvent[] {
  return readAuditAll().slice(-limit).reverse();
}
