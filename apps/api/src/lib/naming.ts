/**
 * Standardized resource naming for every cloud / Docker / systemd target.
 *
 * All Shipdeck-generated names go through here so they are valid on the
 * strictest target (GCP): lowercase letters, digits and hyphens only,
 * starting with a letter, never ending with a hyphen. AWS, Azure, Docker
 * and systemd all accept this form, so one rule works everywhere —
 * never build a resource name by interpolating a raw run ID again.
 */

/** Lowercase, hyphen-separated, cloud-safe name (max 63 chars by default). */
export function safeName(input: string, maxLength = 63): string {
  const cleaned = input
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+/, "")
    .slice(0, Math.max(1, maxLength))
    .replace(/-+$/, "");
  if (!cleaned) return "shipdeck";
  // Names must start with a letter on GCP/Azure.
  return /^[a-z]/.test(cleaned) ? cleaned : `s-${cleaned}`.slice(0, maxLength);
}

/** Alphanumeric-only variant (Azure storage, registries): no hyphens. */
export function safeAlphanumericName(input: string, maxLength = 63): string {
  const cleaned = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, Math.max(1, maxLength));
  if (!cleaned) return "shipdeck";
  return /^[a-z]/.test(cleaned) ? cleaned : `s${cleaned}`.slice(0, maxLength);
}

/** Short lowercase suffix derived from a run ID, e.g. "sioeoh". */
export function runSuffix(runId: string, length = 6): string {
  return safeName(runId.slice(0, length), length).replace(/^-+|-+$/g, "") || "run";
}

/** Terraform name_prefix for a run, e.g. "shipdeck-sioeoh". */
export function runNamePrefix(runId: string, infix?: string): string {
  return safeName(infix ? `shipdeck-${infix}-${runSuffix(runId)}` : `shipdeck-${runSuffix(runId)}`);
}

/** Docker/systemd-safe name derived from a run, e.g. "shipdeck-prev-sioeoh". */
export function runScopedName(base: string, runId: string, length = 6): string {
  return safeName(`${base}-${runSuffix(runId, length)}`);
}