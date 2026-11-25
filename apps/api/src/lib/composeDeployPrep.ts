import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

export interface PrepareComposeResult {
  publicApiRewrites: number;
  restartAdded: number;
  projectName: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function rewriteApiUrlValue(value: unknown, publicApi: string): { value: unknown; changed: boolean } {
  if (typeof value !== "string") return { value, changed: false };
  if (!/localhost|127\.0\.0\.1/i.test(value)) return { value, changed: false };
  if (!/\/v1\b|:3000|API_URL|api/i.test(value) && !value.includes("${NEXT_PUBLIC_API_URL")) {
    return { value, changed: false };
  }
  // Prefer env substitution so compose build.args pick up NEXT_PUBLIC_API_URL from the shell.
  if (value.includes("${NEXT_PUBLIC_API_URL")) {
    return { value: `\${NEXT_PUBLIC_API_URL:-${publicApi}}`, changed: true };
  }
  return { value: publicApi, changed: true };
}

/**
 * Before upload/deploy: set public NEXT_PUBLIC_API_URL and restart policy on every service.
 * Patches the compose file on disk (Shipdeck work copy — not GitHub).
 */
export function prepareComposeForDeploy(
  absComposeFile: string,
  publicApi: string
): PrepareComposeResult {
  const raw = fs.readFileSync(absComposeFile, "utf8");
  const doc = YAML.parse(raw) as Record<string, unknown>;
  if (!isRecord(doc) || !isRecord(doc.services)) {
    return { publicApiRewrites: 0, restartAdded: 0, projectName: "shipdeck" };
  }

  let publicApiRewrites = 0;
  let restartAdded = 0;
  const names: string[] = [];

  for (const [svcName, svcRaw] of Object.entries(doc.services)) {
    if (!isRecord(svcRaw)) continue;
    names.push(svcName);

    // Strip self-dependencies and clone arrays so YAML.stringify does not emit shared anchors.
    if (Array.isArray(svcRaw.depends_on)) {
      svcRaw.depends_on = svcRaw.depends_on.filter((d) => String(d) !== svcName);
    } else if (isRecord(svcRaw.depends_on)) {
      delete svcRaw.depends_on[svcName];
    }

    if (!svcRaw.restart) {
      svcRaw.restart = "unless-stopped";
      restartAdded += 1;
    }

    if (typeof svcRaw.container_name === "string" && svcRaw.container_name.trim()) {
      // keep as-is
    }

    const build = svcRaw.build;
    if (isRecord(build) && isRecord(build.args)) {
      for (const [k, v] of Object.entries(build.args)) {
        if (/NEXT_PUBLIC_API_URL|API_URL/i.test(k) || /localhost|127\.0\.0\.1/i.test(String(v))) {
          const next = rewriteApiUrlValue(v, publicApi);
          if (next.changed || /NEXT_PUBLIC_API_URL/i.test(k)) {
            build.args[k] = publicApi;
            publicApiRewrites += 1;
          }
        }
      }
    } else if (typeof build === "string" && publicApi) {
      // no args block
    }

    if (isRecord(svcRaw.environment)) {
      for (const [k, v] of Object.entries(svcRaw.environment)) {
        if (/NEXT_PUBLIC_API_URL|API_URL/i.test(k)) {
          svcRaw.environment[k] = publicApi;
          publicApiRewrites += 1;
        } else {
          const next = rewriteApiUrlValue(v, publicApi);
          if (next.changed) {
            svcRaw.environment[k] = next.value;
            publicApiRewrites += 1;
          }
        }
      }
    } else if (Array.isArray(svcRaw.environment)) {
      svcRaw.environment = svcRaw.environment.map((entry) => {
        if (typeof entry !== "string") return entry;
        const eq = entry.indexOf("=");
        if (eq < 0) return entry;
        const key = entry.slice(0, eq);
        const val = entry.slice(eq + 1);
        if (/NEXT_PUBLIC_API_URL|API_URL/i.test(key) || /localhost|127\.0\.0\.1/i.test(val)) {
          publicApiRewrites += 1;
          return `${key}=${publicApi}`;
        }
        return entry;
      });
    }
  }

  const projectName = guessComposeProjectName(names, absComposeFile);
  fs.writeFileSync(
    absComposeFile,
    `# Patched by Shipdeck for this deploy (not pushed to Git).\n` + YAML.stringify(doc)
  );
  return { publicApiRewrites, restartAdded, projectName };
}

/** Set image: on every service that builds, so this ship can push that exact tag. */
export function stampComposeReleaseImages(
  absComposeFile: string,
  imageFor: (service: string, alone: boolean) => string
): string[] {
  const raw = fs.readFileSync(absComposeFile, "utf8");
  const doc = YAML.parse(raw) as Record<string, unknown>;
  if (!isRecord(doc) || !isRecord(doc.services)) return [];
  const buildable = Object.entries(doc.services).filter(([, svc]) => isRecord(svc) && svc.build != null);
  const alone = buildable.length === 1;
  const stamped: string[] = [];
  for (const [name, svc] of buildable) {
    if (!isRecord(svc)) continue;
    svc.image = imageFor(name, alone);
    stamped.push(name);
  }
  if (stamped.length) {
    fs.writeFileSync(absComposeFile, YAML.stringify(doc));
  }
  return stamped;
}

export function guessComposeProjectName(serviceNames: string[], absComposeFile: string): string {
  try {
    const raw = fs.readFileSync(absComposeFile, "utf8");
    const doc = YAML.parse(raw) as {
      name?: string;
      services?: Record<string, { container_name?: string }>;
    };
    if (doc?.name?.trim()) return doc.name.trim().replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();
    for (const cfg of Object.values(doc?.services ?? {})) {
      const n = cfg?.container_name?.trim();
      if (n?.includes("-")) {
        const prefix = n.split("-")[0];
        if (prefix && prefix.length >= 3) return prefix.toLowerCase();
      }
    }
  } catch {
    /* ignore */
  }
  const base = path.basename(path.dirname(absComposeFile)).toLowerCase().replace(/[^a-z0-9_-]/g, "");
  if (base && base !== "src" && base.length >= 3) return base.slice(0, 32);
  if (serviceNames.some((s) => /sharehaul|haul/i.test(s))) return "sharehaul";
  return "shipdeck";
}
