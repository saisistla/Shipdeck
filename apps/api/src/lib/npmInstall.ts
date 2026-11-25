import fs from "node:fs";
import path from "node:path";
import { runCommand } from "./exec.js";

export function jestBinaryExists(cwd: string): boolean {
  return (
    fs.existsSync(path.join(cwd, "node_modules", ".bin", "jest.cmd")) ||
    fs.existsSync(path.join(cwd, "node_modules", ".bin", "jest")) ||
    fs.existsSync(path.join(cwd, "node_modules", "jest"))
  );
}

/** Install package deps so `npm test` / jest can run on a fresh Git clone. */
export async function ensureNpmInstall(
  cwd: string,
  log: (line: string) => void
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (jestBinaryExists(cwd) || fs.existsSync(path.join(cwd, "node_modules"))) {
    if (jestBinaryExists(cwd)) return { ok: true };
  }
  const label = path.basename(cwd);
  const lock = fs.existsSync(path.join(cwd, "package-lock.json"));
  const args = lock ? ["ci"] : ["install"];
  log(`${lock ? "npm ci" : "npm install"} [${label}] — needed so Jest can run`);
  const r = await runCommand("npm", args, {
    cwd,
    onLine: log,
    timeoutMs: 600_000,
  });
  if (r.code !== 0) {
    return { ok: false, message: `Could not install test dependencies in ${label}` };
  }
  return { ok: true };
}
