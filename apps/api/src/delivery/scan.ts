import fs from "node:fs";
import path from "node:path";
import { isScannableAttachment } from "./ticketAttachments.js";

const PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "aws-access-key", re: /AKIA[0-9A-Z]{16}/ },
  { name: "private-key", re: /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/ },
  { name: "assigned-secret", re: /(api[_-]?key|secret|password|token)\s*[:=]\s*['"][^'"]{8,}['"]/i },
];

export function scanText(relPath: string, text: string): string[] {
  const findings: string[] = [];
  for (const pattern of PATTERNS) {
    if (pattern.re.test(text)) findings.push(`${relPath}: ${pattern.name}`);
  }
  return findings;
}

export function listWorkspaceFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".next") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.isFile()) files.push(path.relative(root, full).replaceAll("\\", "/"));
    }
  };
  walk(root);
  return files.sort();
}

export function scanWorkspace(root: string): string[] {
  const findings: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".next") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile() || entry.name.endsWith(".enc")) continue;
      const rel = path.relative(root, full);
      if (!isScannableAttachment(rel)) continue;
      const text = fs.readFileSync(full, "utf8");
      findings.push(...scanText(rel, text));
    }
  };
  if (fs.existsSync(root)) walk(root);
  return findings;
}

/** Reject absolute paths and any segment that escapes the workspace. */
export function safeRelative(root: string, rel: string): string {
  if (!rel || rel.includes("\0")) throw new Error("Invalid workspace path");
  const resolvedRoot = path.resolve(root);
  const full = path.resolve(resolvedRoot, rel);
  const fromRoot = path.relative(resolvedRoot, full);
  if (fromRoot.startsWith("..") || path.isAbsolute(fromRoot)) {
    throw new Error("Workspace path escapes the sandbox");
  }
  return full;
}
