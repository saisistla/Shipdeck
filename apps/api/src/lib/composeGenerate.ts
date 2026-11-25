import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { splitPublishPorts } from "@shipdeck/shared";
import { parseComposeContents } from "./composeDetect.js";

const SKIP_DIRS = new Set([
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

export const SHIPDECK_COMPOSE_FILE = "docker-compose.shipdeck.yml";

export interface GeneratedAppService {
  name: string;
  dir: string;
  port: number;
  kind: "node" | "python" | "static";
  dockerfileRel: string;
  startCommand?: string;
  needsBuild?: boolean;
}

export interface ComposeGenerateResult {
  ok: boolean;
  file: string;
  yaml: string;
  apps: GeneratedAppService[];
  dataServices: string[];
  written: string[];
  message: string;
}

function walkFiles(root: string, maxDepth = 4): string[] {
  const out: string[] = [];
  const visit = (dir: string, depth: number) => {
    if (depth > maxDepth) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".") && e.name !== ".env.example") continue;
      if (SKIP_DIRS.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) visit(full, depth + 1);
      else out.push(full);
    }
  };
  visit(root, 0);
  return out;
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function portFromScripts(scripts: Record<string, string>): number | null {
  for (const cmd of Object.values(scripts)) {
    const m = cmd.match(/--port[=\s]+(\d+)/i) || cmd.match(/-p[=\s]+(\d+)/);
    if (m) return Number(m[1]);
  }
  return null;
}

function slugName(dir: string, pkgName: string, used: Set<string>): string {
  let base = pkgName.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "") || path.basename(dir);
  base = base.toLowerCase() || "app";
  let name = base;
  let i = 2;
  while (used.has(name)) {
    name = `${base}-${i++}`;
  }
  used.add(name);
  return name;
}

export function dockerfileBodyForApp(app: GeneratedAppService): string {
  return app.kind === "python"
    ? pythonDockerfile(app.port)
    : nodeDockerfile(app.startCommand || "npm start", app.port, Boolean(app.needsBuild));
}

function nodeDockerfile(startCmd: string, port: number, needsBuild: boolean): string {
  // Full install (incl. devDependencies): Next/Tailwind builds need dev tools
  // such as @tailwindcss/turbopack. Never mask a failed build with "|| true" —
  // a broken build must fail the deploy instead of shipping an empty app.
  // Only run npm run build when package.json actually defines that script.
  const build = needsBuild ? "RUN npm run build\n" : "";
  return `FROM node:20-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci || npm install
COPY . .
${build}ENV PORT=${port}
EXPOSE ${port}
CMD ${JSON.stringify(["sh", "-c", startCmd])}
`;
}

function pythonDockerfile(port: number): string {
  return `FROM python:3.12-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends build-essential && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
ENV PORT=${port}
EXPOSE ${port}
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${port} || python -m flask run --host=0.0.0.0 --port ${port}"]
`;
}

function detectDataNeeds(root: string, files: string[]): { postgres: boolean; redis: boolean; mysql: boolean } {
  const blob = files
    .filter((f) => /\.(env|example|prisma|py|ts|js|yml|yaml)$/i.test(f) && !f.includes("node_modules"))
    .slice(0, 80)
    .map((f) => {
      try {
        return fs.readFileSync(f, "utf8").slice(0, 4000);
      } catch {
        return "";
      }
    })
    .join("\n")
    .toLowerCase();
  const compose = originalComposeFile(root);
  let postgres = /postgres|postgresql/.test(blob);
  let redis = /\bredis\b/.test(blob);
  let mysql = /\bmysql\b/.test(blob);
  if (compose) {
    const raw = fs.readFileSync(path.join(root, compose), "utf8").toLowerCase();
    if (raw.includes("postgres")) postgres = true;
    if (raw.includes("redis")) redis = true;
    if (raw.includes("mysql")) mysql = true;
  }
  return { postgres, redis, mysql };
}

export function planAppsFromSource(root: string): GeneratedAppService[] {
  const files = walkFiles(root);
  const used = new Set<string>();
  const apps: GeneratedAppService[] = [];
  const usedPorts = new Set<number>();

  const takePort = (preferred: number) => {
    let p = preferred;
    while (usedPorts.has(p) || p === 5432 || p === 6379) p += 1;
    usedPorts.add(p);
    return p;
  };

  for (const file of files) {
    if (path.basename(file) !== "package.json") continue;
    const relDir = path.relative(root, path.dirname(file)).replace(/\\/g, "/");
    if (relDir.split("/").includes("packages")) continue;
    const pkg = readJson(file);
    if (!pkg) continue;
    const scripts = (pkg.scripts ?? {}) as Record<string, string>;
    const deps = {
      ...((pkg.dependencies ?? {}) as Record<string, string>),
      ...((pkg.devDependencies ?? {}) as Record<string, string>),
    };
    const isNext = Boolean(deps.next);
    const isNest = Boolean(deps["@nestjs/core"]);
    const isVite = Boolean(deps.vite);
    const hasStart = Boolean(scripts["start:prod"] || scripts.start || scripts.dev);
    if (!isNext && !isNest && !isVite && !hasStart) continue;
    if (!scripts["start:prod"] && !scripts.start && !isNext && !isNest) continue;

    const name = slugName(relDir || ".", String(pkg.name || path.basename(relDir || "app")), used);
    const scriptPort = portFromScripts(scripts);
    const port = takePort(scriptPort || (isNext ? 3000 : isVite ? 5173 : 3000));
    const start =
      scripts["start:prod"]
        ? "npm run start:prod"
        : isNext
          ? `npx next start --port ${port} --hostname 0.0.0.0`
          : scripts.start
            ? "npm start"
            : "npm start";
    apps.push({
      name,
      dir: relDir || ".",
      port,
      kind: "node",
      dockerfileRel: path.posix.join(relDir || ".", "Dockerfile.shipdeck"),
      startCommand: start,
      needsBuild: Boolean(scripts.build),
    });
    if (apps.length >= 6) break;
  }

  if (apps.length === 0) {
    const req = files.find((f) => path.basename(f) === "requirements.txt");
    const pyMain = files.find((f) => /main\.py$/.test(f) || /app\.py$/.test(f));
    if (req || pyMain) {
      apps.push({
        name: "api",
        dir: ".",
        port: takePort(8000),
        kind: "python",
        dockerfileRel: "Dockerfile.shipdeck",
        startCommand: "uvicorn app.main:app --host 0.0.0.0 --port 8000",
      });
    }
  }

  return apps;
}

function existingDataFromCompose(root: string): Record<string, unknown> {
  const originals = ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"];
  const file = originals.find((f) => fs.existsSync(path.join(root, f)));
  if (!file) return {};
  try {
    const doc = YAML.parse(fs.readFileSync(path.join(root, file), "utf8")) as Record<string, unknown>;
    const services = (doc?.services ?? {}) as Record<string, unknown>;
    const keep: Record<string, unknown> = {};
    for (const [name, cfg] of Object.entries(services)) {
      const blob = JSON.stringify(cfg).toLowerCase();
      if (
        blob.includes("postgres") ||
        blob.includes("redis") ||
        blob.includes("mysql") ||
        blob.includes("mongo")
      ) {
        keep[name] = cfg;
      }
    }
    const volumes = doc.volumes;
    return { services: keep, ...(volumes ? { volumes } : {}) };
  } catch {
    return {};
  }
}

export function originalComposeFile(root: string): string | null {
  const originals = ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"];
  return originals.find((f) => fs.existsSync(path.join(root, f))) ?? null;
}

export interface ComposeDiscrepancy {
  id: string;
  message: string;
}

export interface ComposeReview {
  hasExisting: boolean;
  existingFile: string | null;
  matches: boolean;
  recommendation: "existing" | "generated";
  discrepancies: ComposeDiscrepancy[];
  generated: ComposeGenerateResult;
}

export function reviewComposeAgainstSource(root: string): ComposeReview {
  const existingFile = originalComposeFile(root);
  const generated = generateShipdeckCompose(root);
  const discrepancies: ComposeDiscrepancy[] = [];

  if (!existingFile) {
    discrepancies.push({
      id: "missing-file",
      message: "No docker-compose.yml in this folder. Shipdeck can create docker-compose.shipdeck.yml from the source.",
    });
    return {
      hasExisting: false,
      existingFile: null,
      matches: false,
      recommendation: "generated",
      discrepancies,
      generated,
    };
  }

  const raw = fs.readFileSync(path.join(root, existingFile), "utf8");
  const parsed = parseComposeContents(existingFile, raw);
  const existingPorts = parsed?.services.flatMap((s) => s.ports) ?? [];
  const names = new Set((parsed?.services ?? []).map((s) => s.name.toLowerCase()));
  const { publicPorts, privatePorts } = splitPublishPorts(existingPorts);

  for (const app of generated.apps) {
    const existingKey = app.name.toLowerCase().replace(/_/g, "-");
    const byName = [...names].some((n) => n.replace(/_/g, "-") === existingKey);
    const byPort = (parsed?.services ?? []).some((s) => s.ports.includes(app.port));
    if (!byName && !byPort) {
      discrepancies.push({
        id: `missing-${app.name}`,
        message: `Source has "${app.name}" (${app.dir || "."}) on port ${app.port}, but ${existingFile} does not start it.`,
      });
    }
  }

  if (generated.apps.length && publicPorts.length === 0) {
    discrepancies.push({
      id: "data-only",
      message: `${existingFile} only publishes database/cache ports (${privatePorts.join(", ") || "none"}). A browser will not reach the app from this file.`,
    });
  }

  const matches = discrepancies.length === 0;
  return {
    hasExisting: true,
    existingFile,
    matches,
    recommendation: matches ? "existing" : "generated",
    discrepancies,
    generated,
  };
}

export function generateShipdeckCompose(root: string): ComposeGenerateResult {
  const apps = planAppsFromSource(root);
  const files = walkFiles(root);
  const needs = detectDataNeeds(root, files);
  const existing = existingDataFromCompose(root) as {
    services?: Record<string, unknown>;
    volumes?: unknown;
  };
  const dataServices: string[] = [];
  const services: Record<string, unknown> = { ...(existing.services ?? {}) };

  if (needs.postgres && !Object.keys(services).some((k) => /postgres|db/i.test(k))) {
    services.postgres = {
      image: "postgres:16-alpine",
      environment: {
        POSTGRES_USER: "app",
        POSTGRES_PASSWORD: "app",
        POSTGRES_DB: "app",
      },
      ports: ["5432:5432"],
      volumes: ["shipdeck_pg:/var/lib/postgresql/data"],
    };
    dataServices.push("postgres");
  } else {
    dataServices.push(...Object.keys(services).filter((k) => /postgres|db|redis|mysql|mongo/i.test(k)));
  }
  if (needs.redis && !Object.keys(services).some((k) => /redis/i.test(k))) {
    services.redis = {
      image: "redis:7-alpine",
      ports: ["6379:6379"],
    };
    dataServices.push("redis");
  }

  // Only depend on data services — never on app services (avoids "service cannot depend on itself").
  const isDataSvc = (k: string) => /postgres|db|redis|mysql|mongo|mariadb|elastic/i.test(k);
  const dataDepends = Object.keys(services).filter(isDataSvc);
  // Drop prior app services from an existing compose merge (names may differ: admin_web vs admin-web).
  for (const key of Object.keys(services)) {
    if (!isDataSvc(key)) delete services[key];
  }
  for (const app of apps) {
    const dependsOn = [...dataDepends];
    services[app.name] = {
      build: {
        context: app.dir,
        dockerfile: path.posix.basename(app.dockerfileRel),
      },
      ports: [`${app.port}:${app.port}`],
      environment: {
        PORT: String(app.port),
        ...(dataDepends.some((d) => /postgres|db/i.test(d))
          ? { DATABASE_URL: "postgresql://app:app@postgres:5432/app" }
          : {}),
        ...(dataDepends.some((d) => /redis/i.test(d)) ? { REDIS_URL: "redis://redis:6379/0" } : {}),
      },
      ...(dependsOn.length ? { depends_on: dependsOn } : {}),
    };
  }

  const volumes: Record<string, object> = {};
  if (existing.volumes && typeof existing.volumes === "object") {
    Object.assign(volumes, existing.volumes as object);
  }
  if (JSON.stringify(services).includes("shipdeck_pg") && !volumes.shipdeck_pg) {
    volumes.shipdeck_pg = {};
  }

  const doc: Record<string, unknown> = {
    services,
    ...(Object.keys(volumes).length ? { volumes } : {}),
  };
  const yaml =
    `# Generated by Shipdeck from source. Source of truth for Shipdeck deploy.\n` +
    `# Your original docker-compose.yml is not modified.\n` +
    YAML.stringify(doc);

  return {
    ok: apps.length > 0 || Object.keys(services).length > 0,
    file: SHIPDECK_COMPOSE_FILE,
    yaml,
    apps,
    dataServices: [...new Set(dataServices)],
    written: [],
    message:
      apps.length === 0
        ? "No app services detected — compose would only include databases."
        : `Detected ${apps.length} app(s): ${apps.map((a) => `${a.name}:${a.port}`).join(", ")}`,
  };
}

export function writeShipdeckDockerfiles(
  root: string,
  opts?: { forceGenerated?: boolean }
): { written: string[]; skippedExisting: string[] } {
  const apps = planAppsFromSource(root);
  const written: string[] = [];
  const skippedExisting: string[] = [];
  for (const app of apps) {
    const dir = path.join(root, app.dir === "." ? "" : app.dir);
    const existingDf = path.join(dir, "Dockerfile");
    const shipdeckDf = path.join(dir, "Dockerfile.shipdeck");
    const relExisting = path.posix.join(app.dir === "." ? "" : app.dir, "Dockerfile").replace(/^\.\//, "") || "Dockerfile";
    const relShipdeck = app.dockerfileRel;
    fs.mkdirSync(dir, { recursive: true });
    if (!opts?.forceGenerated && fs.existsSync(existingDf)) {
      skippedExisting.push(relExisting);
      continue;
    }
    if (!opts?.forceGenerated && fs.existsSync(shipdeckDf)) {
      skippedExisting.push(relShipdeck);
      continue;
    }
    fs.writeFileSync(shipdeckDf, dockerfileBodyForApp(app));
    written.push(relShipdeck);
  }
  return { written, skippedExisting };
}

export function writeShipdeckCompose(root: string): ComposeGenerateResult {
  const plan = generateShipdeckCompose(root);
  const df = writeShipdeckDockerfiles(root);
  const written: string[] = [...df.written];
  const composeAbs = path.join(root, SHIPDECK_COMPOSE_FILE);
  fs.writeFileSync(composeAbs, plan.yaml);
  written.push(SHIPDECK_COMPOSE_FILE);
  const parsed = parseComposeContents(SHIPDECK_COMPOSE_FILE, plan.yaml);
  return {
    ...plan,
    written,
    ok: true,
    message: `${plan.message}. Wrote ${written.join(", ")}.${
      parsed?.suggestedPort ? ` Health port ${parsed.suggestedPort}.` : ""
    }`,
  };
}
