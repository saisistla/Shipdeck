import fs from "node:fs";
import path from "node:path";
import { planAppsFromSource, writeShipdeckDockerfiles } from "./composeGenerate.js";

const SKIP = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
  "vendor",
  ".venv",
  "venv",
  "__pycache__",
  ".shipdeck-work",
]);

export interface DiscoveredDockerfile {
  path: string;
  dir: string;
  expose: number[];
  from: string | null;
  valid: boolean;
  generated: boolean;
}

export interface DockerfileDiscrepancy {
  id: string;
  message: string;
}

export interface DockerfileReview {
  discovered: DiscoveredDockerfile[];
  plannedApps: Array<{
    name: string;
    dir: string;
    port: number;
    existingPath?: string;
  }>;
  hasExisting: boolean;
  matches: boolean;
  recommendation: "existing" | "generated";
  discrepancies: DockerfileDiscrepancy[];
  configuredPath: string;
  configuredExists: boolean;
  current: { dockerfilePath?: string; dockerfileChoice?: string };
}

function walkDirs(root: string, maxDepth = 5): string[] {
  const out: string[] = [root];
  const visit = (dir: string, depth: number) => {
    if (depth > maxDepth) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || SKIP.has(e.name) || e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      out.push(full);
      visit(full, depth + 1);
    }
  };
  visit(root, 0);
  return out;
}

export function parseDockerfileMeta(content: string): {
  expose: number[];
  from: string | null;
  valid: boolean;
} {
  const from = content.match(/^\s*FROM\s+(\S+)/im)?.[1] ?? null;
  const expose = [...content.matchAll(/^\s*EXPOSE\s+(\d+)/gim)].map((m) => Number(m[1]));
  const hasCmd = /^\s*(CMD|ENTRYPOINT)\b/im.test(content);
  return { expose, from, valid: Boolean(from && (hasCmd || expose.length > 0)) };
}

export function discoverDockerfiles(root: string): DiscoveredDockerfile[] {
  const found: DiscoveredDockerfile[] = [];
  for (const dir of walkDirs(root)) {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isFile()) continue;
      if (!/^Dockerfile(\.|$)/i.test(e.name)) continue;
      if (e.name.toLowerCase() === "dockerfile.dockerignore") continue;
      const full = path.join(dir, e.name);
      let content = "";
      try {
        content = fs.readFileSync(full, "utf8");
      } catch {
        continue;
      }
      const meta = parseDockerfileMeta(content);
      const relDir = path.relative(root, dir).replace(/\\/g, "/") || ".";
      const relPath = path.relative(root, full).replace(/\\/g, "/");
      found.push({
        path: relPath,
        dir: relDir,
        expose: meta.expose,
        from: meta.from,
        valid: meta.valid,
        generated: e.name.toLowerCase() === "dockerfile.shipdeck",
      });
    }
  }
  return found.sort((a, b) => a.path.localeCompare(b.path));
}

function dockerfileInAppDir(discovered: DiscoveredDockerfile[], appDir: string, generated: boolean) {
  return discovered.find((d) => d.dir === appDir && d.generated === generated && d.valid);
}

export function reviewDockerfilesAgainstSource(
  root: string,
  current: { dockerfilePath?: string; dockerfileChoice?: string }
): DockerfileReview {
  const discovered = discoverDockerfiles(root);
  const apps = planAppsFromSource(root);
  const configuredPath = current.dockerfilePath?.trim() || "Dockerfile";
  const configuredExists = fs.existsSync(path.join(root, configuredPath));
  const existing = discovered.filter((d) => !d.generated && d.valid);
  const discrepancies: DockerfileDiscrepancy[] = [];

  const plannedApps = apps.map((app) => {
    const hit =
      dockerfileInAppDir(discovered, app.dir, false) || dockerfileInAppDir(discovered, app.dir, true);
    return { name: app.name, dir: app.dir, port: app.port, existingPath: hit?.path };
  });

  if (!configuredExists) {
    if (existing.length > 0) {
      discrepancies.push({
        id: "root-missing",
        message: `Build points at ${configuredPath}, but that file is not in the repo. Found: ${existing
          .map((d) => d.path)
          .join(", ")}.`,
      });
    } else {
      discrepancies.push({
        id: "missing-file",
        message: `No ${configuredPath} in this folder. Shipdeck can create Dockerfile.shipdeck from the source.`,
      });
    }
  }

  for (const app of plannedApps) {
    if (!app.existingPath) {
      discrepancies.push({
        id: `missing-${app.name}`,
        message: `Source app "${app.name}" (${app.dir}) has no Dockerfile. Shipdeck can generate Dockerfile.shipdeck.`,
      });
    } else {
      const df = discovered.find((d) => d.path === app.existingPath);
      if (df && df.expose.length > 0 && !df.expose.includes(app.port)) {
        discrepancies.push({
          id: `port-${app.name}`,
          message: `${df.path} exposes ${df.expose.join(", ")}, source looks like port ${app.port}. Keep the repo file unless you know it is wrong.`,
        });
      }
    }
  }

  if (existing.length > 1) {
    discrepancies.push({
      id: "multi-service",
      message:
        "This repo has more than one Dockerfile. Compose should build each service from its own file, not a single root image.",
    });
  }

  const covered = plannedApps.filter((a) => a.existingPath).length;
  const hasExisting = existing.length > 0;
  const recommendation: DockerfileReview["recommendation"] =
    hasExisting && (plannedApps.length === 0 || covered === plannedApps.length)
      ? "existing"
      : "generated";

  const matches =
    current.dockerfileChoice === recommendation ||
    (recommendation === "existing" &&
      current.dockerfileChoice === "existing" &&
      (plannedApps.every((a) => a.existingPath) || existing.length > 0));

  return {
    discovered,
    plannedApps,
    hasExisting,
    matches,
    recommendation,
    discrepancies,
    configuredPath,
    configuredExists,
    current,
  };
}

export function applyDockerfileChoice(
  root: string,
  choice: "existing" | "generated"
): { dockerfilePath: string; dockerfileChoice: "existing" | "generated"; written: string[] } {
  if (choice === "generated") {
    const { written } = writeShipdeckDockerfiles(root, { forceGenerated: true });
    return { dockerfilePath: written[0] || "Dockerfile.shipdeck", dockerfileChoice: "generated", written };
  }
  const discovered = discoverDockerfiles(root).filter((d) => !d.generated && d.valid);
  return {
    dockerfilePath: discovered[0]?.path || "Dockerfile",
    dockerfileChoice: "existing",
    written: [],
  };
}
