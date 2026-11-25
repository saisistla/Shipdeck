import fs from "node:fs";
import path from "node:path";
import type { DeliveryPolicyPublic, DeliveryTicket } from "@shipdeck/shared";
import { cloneGitRepo } from "../lib/gitSource.js";
import { editProjectFiles } from "./planner.js";
import { listWorkspaceFiles, safeRelative, scanWorkspace } from "./scan.js";
import { customerTicketLines, READ_THE_WHOLE_TICKET } from "./ticketAttachments.js";
import { missingTicketItems } from "./ticketCoverage.js";

const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", "coverage", "packaging"]);
const SOURCE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".css", ".json", ".md", ".html"]);

function sourceFiles(root: string): Array<{ path: string; contents: string }> {
  const picked: Array<{ path: string; contents: string }> = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      const rel = path.relative(root, full).replaceAll("\\", "/");
      const ext = path.extname(entry.name).toLowerCase();
      if (!SOURCE_EXT.has(ext) || entry.name === "package-lock.json") continue;
      const stat = fs.statSync(full);
      if (stat.size > 12_000) continue;
      picked.push({ path: rel, contents: fs.readFileSync(full, "utf8") });
    }
  };
  walk(root);
  return chooseSourceFiles(picked);
}

/** Data files stay in the set the code model sees, ahead of extra screen files. */
export function chooseSourceFiles(
  files: Array<{ path: string; contents: string }>
): Array<{ path: string; contents: string }> {
  const data = (rel: string) => /(^|\/)(seed|fixtures?|catalog)\.[^/]+$/i.test(rel) || /(^|\/)data\.json$/i.test(rel);
  const screen = (rel: string) => /^(components|app|lib|public|src)\//.test(rel);
  return [...files]
    .sort((a, b) => Number(data(b.path)) - Number(data(a.path)) || Number(screen(b.path)) - Number(screen(a.path)) || a.path.localeCompare(b.path))
    .slice(0, 40);
}

function writeFile(root: string, rel: string, contents: string): void {
  const full = safeRelative(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents, "utf8");
}

export async function placeExistingRepository(opts: {
  workspace: string;
  repoUrl: string;
  token: string;
  branch: string;
  ticket: DeliveryTicket;
  architectureMarkdown: string;
  impactAnalysis?: string;
  policy: DeliveryPolicyPublic;
  apiKey: string;
}): Promise<{ workspace: string; files: string[]; changed: string[]; license: string; findings: string[] }> {
  const cloned = await cloneGitRepo({
    dest: opts.workspace,
    branch: opts.branch || "main",
    url: opts.repoUrl,
    token: opts.token,
    fresh: true,
  });
  if (!cloned.ok) throw new Error(cloned.error);
  fs.rmSync(path.join(cloned.dest, ".git"), { recursive: true, force: true });
  const present = sourceFiles(cloned.dest);
  if (!present.length) throw new Error("The existing repository has no source files to edit");
  const instruction = [
    "This folder is a copy of the existing application. Keep that application.",
    READ_THE_WHOLE_TICKET,
    "Do not invent a product, name, layout, or page the ticket did not ask for.",
    "Find the files that already draw the screen and the files that already store the data. Change them so every item in the ticket is present.",
    "When you change existing code, change only the part this ticket asks for. Leave every other working behavior as it is.",
    "Do not restyle, rename, reorder, or replace code the ticket did not ask to change.",
    "Leave every file the ticket does not need out of the reply.",
    customerTicketLines(opts.ticket),
  ]
    .filter(Boolean)
    .join("\n");
  const apply = (files: Array<{ path: string; contents: string }>) => {
    const changed: string[] = [];
    for (const file of files) {
      const rel = file.path.replaceAll("\\", "/").replace(/^\.\//, "");
      if (!rel || rel === "architecture.md" || rel === "impact-analysis.md") continue;
      writeFile(cloned.dest, rel, file.contents);
      changed.push(rel);
    }
    return changed;
  };
  const merged = (edits: Array<{ path: string; contents: string }>) => {
    const byPath = new Map(present.map((file) => [file.path, file.contents]));
    for (const file of edits) {
      const rel = file.path.replaceAll("\\", "/").replace(/^\.\//, "");
      if (rel) byPath.set(rel, file.contents);
    }
    return [...byPath].map(([path, contents]) => ({ path, contents }));
  };
  let edited = await editProjectFiles(opts.policy, opts.apiKey, instruction, present);
  let changed = apply(edited.files);
  let missing = missingTicketItems(customerTicketLines(opts.ticket), merged(edited.files));
  if (missing.length) {
    const retry = await editProjectFiles(
      opts.policy,
      opts.apiKey,
      `${instruction}\nThe last reply left these required items out of the data: ${missing.join(", ")}. Add each one to the data the screen reads, and show it. Return those files.`,
      present
    );
    edited = { files: [...edited.files, ...retry.files], usage: retry.usage };
    changed = [...new Set([...changed, ...apply(retry.files)])];
    missing = missingTicketItems(customerTicketLines(opts.ticket), merged(edited.files));
  }
  if (missing.length) {
    throw new Error(
      `The change was not accepted. The ticket names ${missing.join(", ")} and they are not in the data the screen reads.`
    );
  }
  if (!changed.length) throw new Error("The code model did not change the existing application");
  writeFile(cloned.dest, "architecture.md", opts.architectureMarkdown);
  if (opts.impactAnalysis?.trim()) writeFile(cloned.dest, "impact-analysis.md", opts.impactAnalysis);
  return {
    workspace: cloned.dest,
    files: listWorkspaceFiles(cloned.dest),
    changed,
    license: opts.policy.allowedLicenses[0] || "existing",
    findings: scanWorkspace(cloned.dest),
  };
}
