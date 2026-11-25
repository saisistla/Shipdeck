import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { ComposeDetection, ComposeServiceInfo } from "@shipdeck/shared";

export const COMPOSE_FILENAMES = [
  "docker-compose.shipdeck.yml",
  "docker-compose.shipdeck.yaml",
  "docker-compose.yml",
  "docker-compose.yaml",
  "compose.yml",
  "compose.yaml",
] as const;

const PRIMARY_SERVICE_HINTS = [
  "web",
  "frontend",
  "app",
  "api",
  "server",
  "nginx",
  "gateway",
  "ui",
];

/** Host ports that look like app HTTP (not typical DB/cache). */
const DBISH_PORTS = new Set([5432, 3306, 27017, 6379, 9200, 11211]);

export function findComposeFile(root: string): string | null {
  for (const name of COMPOSE_FILENAMES) {
    if (fs.existsSync(path.join(root, name))) return name;
  }
  return null;
}

/** Fixed container_name values from a compose file (empty if names are auto). */
export function containerNamesFromCompose(absFile: string): string[] {
  try {
    const doc = YAML.parse(fs.readFileSync(absFile, "utf8")) as {
      services?: Record<string, { container_name?: string }>;
    };
    const names: string[] = [];
    for (const cfg of Object.values(doc?.services ?? {})) {
      const n = cfg?.container_name?.trim();
      if (n) names.push(n);
    }
    return [...new Set(names)];
  } catch {
    return [];
  }
}

/** Extract host-side published ports from a compose ports entry. */
export function hostPortsFromEntry(entry: unknown): number[] {
  if (typeof entry === "number" && Number.isFinite(entry)) {
    return [entry];
  }
  if (typeof entry === "string") {
    // "8080:80", "127.0.0.1:8080:80", "8080", "8080/tcp"
    const cleaned = entry.replace(/\/(tcp|udp)$/i, "").trim();
    const parts = cleaned.split(":");
    if (parts.length === 1) {
      const p = Number(parts[0]);
      return Number.isFinite(p) ? [p] : [];
    }
    if (parts.length === 2) {
      const p = Number(parts[0]);
      return Number.isFinite(p) ? [p] : [];
    }
    if (parts.length >= 3) {
      const p = Number(parts[parts.length - 2]);
      return Number.isFinite(p) ? [p] : [];
    }
  }
  if (entry && typeof entry === "object") {
    const obj = entry as Record<string, unknown>;
    const published = obj.published ?? obj.host_port ?? obj.hostPort;
    if (typeof published === "number" && Number.isFinite(published)) return [published];
    if (typeof published === "string") {
      const p = Number(published);
      return Number.isFinite(p) ? [p] : [];
    }
  }
  return [];
}

function pickPrimary(
  services: ComposeServiceInfo[]
): { service?: string; port: number } {
  if (services.length === 0) return { port: 8080 };

  const scored = services.map((svc) => {
    const name = svc.name.toLowerCase();
    const hintIdx = PRIMARY_SERVICE_HINTS.findIndex(
      (h) => name === h || name.startsWith(`${h}-`) || name.endsWith(`-${h}`)
    );
    const appPorts = svc.ports.filter((p) => !DBISH_PORTS.has(p));
    return {
      name: svc.name,
      ports: appPorts,
      score: (hintIdx >= 0 ? 100 - hintIdx : 0) + (appPorts.length ? 10 : 0),
    };
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored.find((s) => s.ports.length > 0);
  if (!best) {
    return { port: 0 };
  }
  return { service: best.name, port: best.ports[0] };
}

export function parseComposeContents(
  fileName: string,
  raw: string
): ComposeDetection | null {
  let doc: unknown;
  try {
    doc = YAML.parse(raw);
  } catch {
    return null;
  }
  if (!doc || typeof doc !== "object") return null;

  const servicesNode = (doc as Record<string, unknown>).services;
  if (!servicesNode || typeof servicesNode !== "object") {
    return {
      file: fileName,
      services: [],
      suggestedPort: 8080,
    };
  }

  const services: ComposeServiceInfo[] = [];
  for (const [name, cfg] of Object.entries(servicesNode as Record<string, unknown>)) {
    const ports: number[] = [];
    if (cfg && typeof cfg === "object") {
      const portsNode = (cfg as Record<string, unknown>).ports;
      if (Array.isArray(portsNode)) {
        for (const entry of portsNode) {
          for (const p of hostPortsFromEntry(entry)) {
            if (!ports.includes(p)) ports.push(p);
          }
        }
      }
    }
    services.push({ name, ports });
  }

  const primary = pickPrimary(services);
  return {
    file: fileName,
    services,
    suggestedPort: primary.port,
    suggestedPrimaryService: primary.service,
  };
}

/** Read and parse compose from a project directory. */
export function detectComposeFromDir(root: string): ComposeDetection | null {
  const file = findComposeFile(root);
  if (!file) return null;
  const raw = fs.readFileSync(path.join(root, file), "utf8");
  return parseComposeContents(file, raw);
}
