import fs from "node:fs";
import path from "node:path";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "coverage",
  "dist",
  ".turbo",
  ".shipdeck-work",
  "build",
  "vendor",
  "target",
  ".venv",
  "venv",
  "__pycache__",
]);

const TEXT_EXT = new Set([
  ".conf",
  ".cfg",
  ".template",
  ".nginx",
  ".yml",
  ".yaml",
  ".env",
  ".toml",
  ".json",
  ".js",
  ".ts",
  ".mjs",
  ".cjs",
  ".jsx",
  ".tsx",
  ".py",
  ".go",
  ".rb",
  ".php",
  ".java",
  ".kt",
  ".xml",
  ".properties",
  ".ini",
  ".sh",
]);

const ROUTE_RES = [
  /\.(?:get|head|all|route)\s*\(\s*["'](\/[^"'\\\s]*health[^"'\\\s]*)["']/gi,
  /@(?:Get|GetMapping|RequestMapping)\s*\(\s*["'](\/[^"'\\\s]*health[^"'\\\s]*)["']/g,
  /Route::get\s*\(\s*["'](\/[^"'\\\s]*health[^"'\\\s]*)["']/gi,
  /HandleFunc\s*\(\s*["'](\/[^"'\\\s]*health[^"'\\\s]*)["']/g,
];

const DB_ENV_PREFERENCE = ["DATABASE_URL", "POSTGRES_URL", "POSTGRESQL_URL"];
const REDIS_ENV_PREFERENCE = ["REDIS_URL", "REDIS_HOST"];

export interface ContainerRuntime {
  containerPort: number;
  healthPath: string;
  environment: Record<string, string>;
  databaseEnv: string;
  redisEnv: string;
  dbName: string;
  dbUser: string;
}

export function hclQuote(value: string): string {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\$/g, "$$");
  return `"${escaped}"`;
}

export function sanitizeHealthPath(value: string): string {
  const pathOnly = value.startsWith("/") ? value : `/${value}`;
  return /^\/[A-Za-z0-9._~/-]*$/.test(pathOnly) ? pathOnly : "/";
}

function portNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > 65535) return null;
  return n;
}

/** Container port from a compose `ports` entry. The right-hand side is what the process listens on. */
export function containerPortFromSpec(spec: unknown): number | null {
  if (typeof spec === "number") return portNumber(spec);
  if (typeof spec === "string") {
    const last = spec.trim().split(":").pop()?.replace(/\/.*$/, "") ?? "";
    return portNumber(last);
  }
  if (spec && typeof spec === "object" && "target" in spec) {
    return portNumber((spec as { target: unknown }).target);
  }
  return null;
}

export function firstContainerPort(ports: unknown): number | null {
  if (!Array.isArray(ports)) return null;
  for (const item of ports) {
    const port = containerPortFromSpec(item);
    if (port) return port;
  }
  return null;
}

function resolveComposeValue(raw: string, env: NodeJS.ProcessEnv): string {
  return raw.replace(
    /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::(-)?([^}]*))?\}|\$([A-Za-z_][A-Za-z0-9_]*)/g,
    (_match, braced: string | undefined, _dash: string | undefined, fallback: string | undefined, bare: string | undefined) => {
      const key = braced || bare || "";
      const current = env[key];
      if (current != null && current !== "") return current;
      if (braced && fallback != null) return fallback;
      return "";
    }
  );
}

export function environmentFromCompose(environment: unknown, env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  const add = (key: string, value: string) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return;
    const resolved = resolveComposeValue(value, env).replace(/\r?\n/g, "");
    if (!resolved) return;
    out[key] = resolved;
  };
  if (Array.isArray(environment)) {
    for (const item of environment) {
      if (typeof item !== "string") continue;
      const eq = item.indexOf("=");
      if (eq <= 0) continue;
      add(item.slice(0, eq).trim(), item.slice(eq + 1));
    }
    return out;
  }
  if (environment && typeof environment === "object") {
    for (const [key, value] of Object.entries(environment as Record<string, unknown>)) {
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") add(key, String(value));
    }
  }
  return out;
}

function parseDatabaseUrl(value: string): { user: string; host: string; database: string } | null {
  if (!/^postgres(ql)?:\/\//i.test(value)) return null;
  try {
    const url = new URL(value.replace(/^postgres(ql)?:/i, "http:"));
    const database = decodeURIComponent(url.pathname.replace(/^\//, "").split("/")[0] ?? "");
    return { user: decodeURIComponent(url.username), host: url.hostname, database };
  } catch {
    return null;
  }
}

function parseRedisHost(value: string): string | null {
  if (!/^rediss?:\/\//i.test(value)) return null;
  try {
    return new URL(value).hostname || null;
  } catch {
    return null;
  }
}

function ident(value: string): string {
  return /^[A-Za-z][A-Za-z0-9_]{0,62}$/.test(value) ? value : "";
}

function pickManagedKey(env: Record<string, string>, preference: string[], accept: (value: string) => boolean): string {
  for (const key of preference) {
    if (env[key] && accept(env[key])) return key;
  }
  return Object.keys(env).find((key) => accept(env[key])) ?? "";
}

export function splitManagedDataEnv(
  environment: Record<string, string>,
  serviceNames: string[]
): { environment: Record<string, string>; databaseEnv: string; redisEnv: string; dbName: string; dbUser: string } {
  const names = new Set(serviceNames.map((name) => name.toLowerCase()));
  const next = { ...environment };
  const databaseEnv = pickManagedKey(next, DB_ENV_PREFERENCE, (value) => {
    const parsed = parseDatabaseUrl(value);
    return Boolean(parsed && names.has(parsed.host.toLowerCase()));
  });
  const redisEnv = pickManagedKey(next, REDIS_ENV_PREFERENCE, (value) => {
    const host = parseRedisHost(value);
    return Boolean(host && names.has(host.toLowerCase()));
  });
  let dbName = "";
  let dbUser = "";
  if (databaseEnv) {
    const parsed = parseDatabaseUrl(next[databaseEnv]);
    dbName = ident(parsed?.database ?? "");
    dbUser = ident(parsed?.user ?? "");
    delete next[databaseEnv];
  }
  if (redisEnv) delete next[redisEnv];
  return { environment: next, databaseEnv, redisEnv, dbName, dbUser };
}

interface DockerStage {
  name: string;
  image: string;
  body: string;
}

function parseDockerStages(text: string): DockerStage[] {
  const stages: { name: string; image: string; lines: string[] }[] = [];
  let current: { name: string; image: string; lines: string[] } | null = null;
  const fromRe = /^\s*FROM\s+(\S+)(?:\s+AS\s+(\S+))?\s*$/i;
  for (const line of text.split(/\r?\n/)) {
    const from = line.match(fromRe);
    if (from) {
      if (current) stages.push(current);
      current = { name: from[2] ?? "", image: from[1], lines: [] };
      continue;
    }
    if (current) current.lines.push(line);
  }
  if (current) stages.push(current);
  const byName = new Map(stages.filter((stage) => stage.name).map((stage) => [stage.name, stage]));
  const resolve = (image: string, seen = new Set<string>()): string => {
    const hit = byName.get(image);
    if (!hit || seen.has(image)) return image;
    seen.add(image);
    return resolve(hit.image, seen);
  };
  return stages.map((stage) => ({
    name: stage.name,
    image: resolve(stage.image),
    body: stage.lines.join("\n"),
  }));
}

function selectedStage(text: string, target: string): DockerStage | null {
  const stages = parseDockerStages(text);
  if (!stages.length) return null;
  if (!target) return stages[stages.length - 1];
  return [...stages].reverse().find((stage) => stage.name === target) ?? null;
}

function imageName(image: string): string {
  const noDigest = image.split("@")[0];
  const last = noDigest.split("/").pop() ?? noDigest;
  return last.split(":")[0];
}

export function isStaticWebServer(image: string): boolean {
  return /^(nginx|caddy|httpd|apache|traefik|haproxy)$/i.test(imageName(image));
}

function exposePort(body: string): number | null {
  let found: number | null = null;
  for (const match of body.matchAll(/^\s*EXPOSE\s+(\d+)/gim)) {
    found = portNumber(match[1]) ?? found;
  }
  return found;
}

function healthcheckPath(healthcheck: unknown): string | null {
  if (!healthcheck || typeof healthcheck !== "object") return null;
  const test = (healthcheck as { test?: unknown }).test;
  const text = Array.isArray(test) ? test.map(String).join(" ") : typeof test === "string" ? test : "";
  const url = text.match(/https?:\/\/[^\s"']+/i);
  if (!url) return null;
  try {
    return sanitizeHealthPath(new URL(url[0]).pathname || "/");
  } catch {
    return null;
  }
}

function walkTextFiles(root: string, onFile: (abs: string, text: string) => void, limit = 2000): void {
  let seen = 0;
  const walk = (dir: string) => {
    if (seen >= limit) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (seen >= limit) return;
      if (SKIP_DIRS.has(ent.name)) continue;
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!ent.isFile()) continue;
      if (/\.(test|spec)\.[^.]+$/i.test(ent.name)) continue;
      const ext = path.extname(ent.name).toLowerCase();
      if (ext && !TEXT_EXT.has(ext)) continue;
      let stat: fs.Stats;
      try {
        stat = fs.statSync(abs);
      } catch {
        continue;
      }
      if (stat.size > 200_000) continue;
      seen += 1;
      let text = "";
      try {
        text = fs.readFileSync(abs, "utf8");
      } catch {
        continue;
      }
      onFile(abs, text);
    }
  };
  walk(root);
}

/** Shortest registered route whose path contains "health". Comparisons and docs are ignored. */
export function findHealthRoute(root: string): string | null {
  const found = new Set<string>();
  walkTextFiles(root, (_abs, text) => {
    for (const re of ROUTE_RES) {
      re.lastIndex = 0;
      for (const match of text.matchAll(re)) {
        if (match[1]) found.add(sanitizeHealthPath(match[1]));
      }
    }
  });
  const paths = [...found].filter((item) => item !== "/");
  paths.sort((a, b) => a.length - b.length || a.localeCompare(b));
  return paths[0] ?? null;
}

export function resolveContainerRuntime(input: {
  contextDir: string;
  dockerfile: string;
  target: string;
  ports: unknown;
  environment: unknown;
  healthcheck: unknown;
  serviceNames: string[];
  env?: NodeJS.ProcessEnv;
}): ContainerRuntime {
  let dockerfileText = "";
  try {
    dockerfileText = fs.readFileSync(path.join(input.contextDir, input.dockerfile), "utf8");
  } catch {
    dockerfileText = "";
  }
  const stage = dockerfileText ? selectedStage(dockerfileText, input.target) : null;
  const composed = environmentFromCompose(input.environment, input.env ?? process.env);
  const managed = splitManagedDataEnv(composed, input.serviceNames);
  const fromEnv = portNumber(managed.environment.PORT);
  const containerPort =
    firstContainerPort(input.ports) ?? fromEnv ?? (stage ? exposePort(stage.body) : null) ?? 8080;
  managed.environment.PORT = String(containerPort);
  const probed = healthcheckPath(input.healthcheck);
  const healthPath =
    probed ??
    (stage && isStaticWebServer(stage.image) ? "/" : null) ??
    findHealthRoute(input.contextDir) ??
    "/";
  return { containerPort, healthPath, ...managed, environment: managed.environment };
}

export function containerRuntimeTfvars(targets: { api: ContainerRuntime; web: ContainerRuntime }): string[] {
  const line = (key: string, value: string | number) =>
    typeof value === "number" ? `${key} = ${value}` : `${key} = ${hclQuote(value)}`;
  const lines = [
    line("api_container_port", targets.api.containerPort),
    line("web_container_port", targets.web.containerPort),
    line("api_health_path", targets.api.healthPath),
    line("web_health_path", targets.web.healthPath),
    line("api_environment_json", JSON.stringify(targets.api.environment)),
    line("web_environment_json", JSON.stringify(targets.web.environment)),
    line("api_database_env", targets.api.databaseEnv),
    line("api_redis_env", targets.api.redisEnv),
    line("web_database_env", targets.web.databaseEnv),
    line("web_redis_env", targets.web.redisEnv),
  ];
  if (targets.api.dbName) lines.push(line("db_name", targets.api.dbName));
  if (targets.api.dbUser) lines.push(line("db_username", targets.api.dbUser));
  return lines;
}

function safeOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** True when a file in the build context proxies to this compose service by name. */
export function contextProxiesToService(root: string, serviceName: string): boolean {
  if (!/^[A-Za-z0-9_.-]+$/.test(serviceName)) return false;
  const re = new RegExp(`https?://(?:\\w+:\\w+@)?${serviceName}(?::\\d+)?(?![A-Za-z0-9.-])`, "i");
  let hit = false;
  walkTextFiles(root, (_abs, text) => {
    if (hit) return;
    if (re.test(text)) hit = true;
  });
  return hit;
}

/**
 * Rewrite compose-DNS upstreams in a copy of the source. Does not touch the original folder
 * unless `root` is already that copy.
 */
export function rewriteServiceOrigins(root: string, origins: Record<string, string>): number {
  const replacements: { name: string; origin: string; host: string; re: RegExp }[] = [];
  for (const [name, value] of Object.entries(origins)) {
    if (!/^[A-Za-z0-9_.-]+$/.test(name)) continue;
    const origin = safeOrigin(value);
    if (!origin) continue;
    replacements.push({
      name,
      origin,
      host: new URL(origin).host,
      re: new RegExp(`https?://(?:\\w+:\\w+@)?${name}(?::\\d+)?(?![A-Za-z0-9.-])`, "gi"),
    });
  }
  if (!replacements.length) return 0;
  let changed = 0;
  walkTextFiles(root, (abs, text) => {
    let next = text;
    let used: { origin: string; host: string } | null = null;
    let uses = 0;
    for (const item of replacements) {
      item.re.lastIndex = 0;
      if (!item.re.test(next)) continue;
      item.re.lastIndex = 0;
      uses += 1;
      used = item;
      next = next.replace(item.re, item.origin);
    }
    if (next === text || !used) return;
    if (uses === 1) {
      next = next.replace(/proxy_set_header\s+Host\s+\$host\s*;/g, `proxy_set_header Host ${used.host};`);
    }
    if (used.origin.startsWith("https://") && !/proxy_ssl_server_name\s+on\s*;/.test(next)) {
      next = next.replace(/proxy_pass\s+https:\/\/[^;]+;/i, (line) => `${line}\n    proxy_ssl_server_name on;`);
    }
    if (next !== text) {
      fs.writeFileSync(abs, next);
      changed += 1;
    }
  });
  return changed;
}
