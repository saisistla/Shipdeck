/** Recommend cloud VM size from stack signals (compose, Next.js, databases). */

export type VmSizeTier = "small" | "medium" | "large";

export interface VmSizeRecommendation {
  tier: VmSizeTier;
  minRamGb: number;
  /** Instance type for AWS EC2 */
  aws: string;
  /** Size for Azure VM */
  azure: string;
  /** Machine type for GCP */
  gcp: string;
  reasons: string[];
  warning?: string;
  summary: string;
}

export interface VmSizingInput {
  stack?: string;
  signals?: string[];
  compose?: {
    services: Array<{ name: string; ports: number[] }>;
  };
  /** Current selected cloud (affects which size string is "primary") */
  cloudProvider?: "aws" | "azure" | "gcp";
}

const TIER: Record<
  VmSizeTier,
  { minRamGb: number; aws: string; azure: string; gcp: string }
> = {
  small: { minRamGb: 2, aws: "t3.small", azure: "Standard_B1ms", gcp: "e2-small" },
  medium: { minRamGb: 4, aws: "t3.medium", azure: "Standard_B2s", gcp: "e2-medium" },
  large: { minRamGb: 8, aws: "t3.large", azure: "Standard_B2ms", gcp: "e2-standard-2" },
};

function hasSignal(signals: string[], re: RegExp) {
  return signals.some((s) => re.test(s));
}

/**
 * Estimate RAM needed to build+run the project on a single VM (Docker Compose style).
 * Builds on-box (Next.js) need more RAM than runtime alone.
 */
export function recommendVmSize(input: VmSizingInput): VmSizeRecommendation {
  const signals = input.signals ?? [];
  const services = input.compose?.services ?? [];
  const reasons: string[] = [];
  let score = 1; // base ~1 GB

  if (services.length) {
    score += Math.min(services.length * 0.5, 3);
    reasons.push(`Compose has ${services.length} service(s)`);
  } else if (/compose/i.test(input.stack ?? "")) {
    score += 1.5;
    reasons.push("Compose-style app detected");
  }

  const dbish = services.filter((s) =>
    /postgres|postgis|mysql|mongo|redis|elastic|rabbit|kafka/i.test(s.name)
  );
  if (dbish.length) {
    score += dbish.length * 0.75;
    reasons.push(`Data services: ${dbish.map((s) => s.name).join(", ")}`);
  }

  const nextish =
    hasSignal(signals, /next|frontend|admin_web|\+node/i) ||
    services.some((s) => /web|admin|frontend|ui|next/i.test(s.name));
  if (nextish) {
    score += 2.5;
    reasons.push("Frontend/Next.js build on the VM needs extra RAM");
  }

  if (hasSignal(signals, /Found package\.json \(Node\)/i) || /\+node|node/i.test(input.stack ?? "")) {
    if (!nextish) {
      score += 0.5;
      reasons.push("Node.js app");
    }
  }

  // ShareHaul-class: 5 services with Next frontends → force medium+
  if (services.length >= 4 && nextish) {
    score = Math.max(score, 4.5);
    reasons.push("Multi-service stack with UI builds — avoid 1 GB instances (OOM risk)");
  }

  if (reasons.length === 0) {
    reasons.push("Small single-app footprint");
  }

  let tier: VmSizeTier = "small";
  if (score >= 6) tier = "large";
  else if (score >= 3) tier = "medium";

  const sizes = TIER[tier];
  const provider = input.cloudProvider ?? "aws";
  const primary =
    provider === "azure" ? sizes.azure : provider === "gcp" ? sizes.gcp : sizes.aws;

  const warning =
    tier === "small"
      ? "1–2 GB VMs often fail while building Next.js/Docker images. Prefer medium if builds run on the server."
      : tier === "medium"
        ? "First Docker build can still take 20–45 minutes; RAM should be enough to avoid OOM."
        : "Large size for heavy monorepos or parallel image builds.";

  return {
    tier,
    minRamGb: sizes.minRamGb,
    aws: sizes.aws,
    azure: sizes.azure,
    gcp: sizes.gcp,
    reasons,
    warning,
    summary: `Recommend ${primary} (~${sizes.minRamGb} GB RAM) for ${provider.toUpperCase()}`,
  };
}

export function vmSizeForProvider(
  rec: VmSizeRecommendation,
  provider: "aws" | "azure" | "gcp"
): string {
  if (provider === "azure") return rec.azure;
  if (provider === "gcp") return rec.gcp;
  return rec.aws;
}

/** Rough RAM GB known for common Shipdeck sizes (for “is current too small?”). */
export function approxRamGbForVmSize(vmSize: string | undefined): number | null {
  if (!vmSize?.trim()) return null;
  const s = vmSize.trim().toLowerCase();
  const map: Record<string, number> = {
    "t3.micro": 1,
    "t2.micro": 1,
    "t3.small": 2,
    "t2.small": 2,
    "t3.medium": 4,
    "t2.medium": 4,
    "t3.large": 8,
    "t2.large": 8,
    "standard_b1s": 1,
    "standard_b1ms": 2,
    "standard_b2s": 4,
    "standard_b2ms": 8,
    "e2-micro": 1,
    "e2-small": 2,
    "e2-medium": 4,
    "e2-standard-2": 8,
  };
  return map[s] ?? null;
}
