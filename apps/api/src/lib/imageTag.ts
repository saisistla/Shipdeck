const RELEASE = /^v(\d+)\.(\d+)\.(\d+)$/;

/** Docker tag in the form v1.1.0. A bare 1.1.0 gains the leading v. */
export function resolveDockerReleaseTag(
  input: string | undefined
): { ok: true; tag: string } | { ok: false; message: string } {
  const raw = (input ?? "").trim();
  if (!raw) return { ok: true, tag: "v1.0.0" };
  const withV = /^v/i.test(raw) ? `v${raw.slice(1)}` : `v${raw}`;
  if (!RELEASE.test(withV)) {
    return { ok: false, message: "Image version must look like v1.1.0" };
  }
  return { ok: true, tag: withV };
}

/** Next ship after a successful push. v1.1.0 becomes v1.1.1. */
export function incrementDockerReleaseTag(tag: string): string {
  const resolved = resolveDockerReleaseTag(tag);
  const current = resolved.ok ? resolved.tag : "v1.0.0";
  const match = RELEASE.exec(current);
  if (!match) return "v1.0.1";
  return `v${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

/**
 * Registry image reference. The repository stays as given.
 * One service: docker.io/acme/surabhee:v1.1.0
 * Several services share that repository and differ by tag: docker.io/acme/surabhee:web-v1.1.0
 */
export function registryImageName(registry: string, repository: string, tag: string, service?: string): string {
  const host = registry.replace(/\/$/, "").replace(/^https?:\/\//, "");
  const parts = repository
    .split("/")
    .map((part) => part.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "").replace(/^-+|-+$/g, ""))
    .filter(Boolean);
  const repo = parts.join("/") || "app";
  const version = tag.trim() || "v1.0.0";
  if (!service) return `${host}/${repo}:${version}`;
  const svc = service.toLowerCase().replace(/[^a-z0-9._-]+/g, "").replace(/^-+|-+$/g, "") || "app";
  return `${host}/${repo}:${svc}-${version}`;
}
