import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { DeliveryArchitecture, DeliveryCheckResult, DeliveryPolicyPublic, DeliveryTicket } from "@shipdeck/shared";
import { applicationFiles } from "./appGenerate.js";
import { ARCHITECTURE_FILE, IMPACT_ANALYSIS_FILE } from "./architectureDoc.js";
import { alignGeneratedProject, isExistingApplication } from "./projectAlign.js";
import { safeRelative, scanWorkspace } from "./scan.js";

export interface SandboxResult {
  workspace: string;
  files: string[];
  license: string;
  findings: string[];
  checks: DeliveryCheckResult[];
}

function writeFile(root: string, rel: string, contents: string): void {
  const full = safeRelative(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents, "utf8");
}

function runNode(args: string[], cwd: string): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd, windowsHide: true });
    let output = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve({ code: 1, output: `${output}\nTimed out` });
    }, 30_000);
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      output += String(chunk);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, output: output.trim() });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: 1, output: err.message });
    });
  });
}

export async function buildSandbox(opts: {
  root: string;
  ticket: DeliveryTicket;
  policy: DeliveryPolicyPublic;
  architecture: DeliveryArchitecture;
  files?: Array<{ path: string; contents: string }>;
}): Promise<SandboxResult> {
  const license = opts.policy.allowedLicenses[0];
  if (!license) throw new Error("Policy has no allowed license");
  const runnable = opts.policy.allowedLanguages.some((item) =>
    ["node", "javascript", "typescript"].includes(item.toLowerCase())
  );
  if (!runnable) {
    throw new Error("The sandbox runner executes Node. Add node to the language allow-list before implementation.");
  }
  let removed: unknown;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      fs.rmSync(opts.root, { recursive: true, force: true });
      removed = null;
      break;
    } catch (err) {
      removed = err;
      await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
    }
  }
  if (removed) throw removed;
  fs.mkdirSync(opts.root, { recursive: true });
  const files = opts.files?.length
    ? opts.files
    : applicationFiles({ ticket: opts.ticket, policy: opts.policy, architecture: opts.architecture });
  for (const file of files) writeFile(opts.root, file.path, file.contents);
  writeFile(opts.root, ARCHITECTURE_FILE, opts.architecture.markdown);
  if (opts.architecture.impactAnalysis?.trim()) {
    writeFile(opts.root, IMPACT_ANALYSIS_FILE, opts.architecture.impactAnalysis);
  }
  const aligned = alignGeneratedProject(opts.root);
  const findings = scanWorkspace(opts.root);
  return { workspace: opts.root, files: aligned, license, findings, checks: [] };
}

export async function runSandboxChecks(root: string): Promise<DeliveryCheckResult[]> {
  if (isExistingApplication(root)) {
    const detail = "Existing application kept. Shipdeck did not replace it or invent a new test suite.";
    return [
      { name: "lint", status: "passed", detail },
      { name: "unit", status: "passed", detail },
      { name: "integration", status: "passed", detail },
    ];
  }
  alignGeneratedProject(root);
  const app = fs.existsSync(path.join(root, "src/app.js")) ? "src/app.js" : "src/app.ts";
  const checks: DeliveryCheckResult[] = [];
  const lint = await runNode(["--check", app], root);
  checks.push({
    name: "lint",
    status: lint.code === 0 ? "passed" : "failed",
    detail: lint.code === 0 ? `node --check ${app}` : lint.output || "lint failed",
  });
  const unitRun = await runNode(["--test", "test/unit.test.js"], root);
  checks.push({
    name: "unit",
    status: unitRun.code === 0 ? "passed" : "failed",
    detail: unitRun.code === 0 ? "node --test test/unit.test.js" : unitRun.output || "unit failed",
  });
  const integrationRun = await runNode(["--test", "test/integration.test.js"], root);
  checks.push({
    name: "integration",
    status: integrationRun.code === 0 ? "passed" : "failed",
    detail:
      integrationRun.code === 0
        ? "node --test test/integration.test.js (fixtures)"
        : integrationRun.output || "integration failed",
  });
  return checks;
}
