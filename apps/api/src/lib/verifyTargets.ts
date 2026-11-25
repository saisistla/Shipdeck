/**
 * Verify probe targets — built ONLY from the actual pipeline (configured
 * health URL, deploy/service URLs, and compose-detected service ports).
 *
 * Never invent hardcoded ports (the old 3000/3002/3001 guesses): probing
 * ports that were never deployed wastes the whole timeout, hides the real
 * error, and rolled back perfectly healthy apps.
 */

export interface VerifyCandidateInput {
  /** Primary health URL (configured or derived from deploy port + health path). */
  primary: string;
  deployUrl?: string;
  serviceUrl?: string;
  deployHost?: string;
  computeMode?: string;
  serverlessKind?: string;
  apiUrl?: string;
  /** Public ports of compose services detected in the source (actual pipeline ports). */
  servicePorts?: number[];
}

function rootOf(url: string): string | null {
  try {
    const u = new URL(url);
    return `${u.origin}/`;
  } catch {
    return null;
  }
}

export function buildVerifyCandidates(input: VerifyCandidateInput): string[] {
  const candidates: string[] = [];
  const push = (u?: string | null) => {
    if (u && !candidates.includes(u)) candidates.push(u);
  };

  push(input.primary);
  push(input.deployUrl);
  push(input.serviceUrl);

  const isServerless = input.computeMode === "serverless";

  if (!isServerless) {
    const host = input.deployHost;
    const looksLikeLambda = !!host && host.includes("lambda-url");
    if (host && !looksLikeLambda && !input.serviceUrl) {
      // Same actual port, app root — UI apps often have no /health endpoint.
      push(rootOf(input.primary));
      // Compose-detected service roots (these ports are really deployed).
      for (const port of (input.servicePorts ?? []).slice(0, 5)) {
        if (port > 0 && port < 65536) push(`http://${host}:${port}/`);
      }
    }
    return candidates;
  }

  // Serverless full-app UI — probe web root, /shipper, and API health.
  if ((input.serverlessKind === "app") && input.serviceUrl) {
    const base = input.serviceUrl.replace(/\/$/, "");
    push(`${base}/`);
    push(`${base}/shipper`);
    if (input.apiUrl) {
      const apiBase = input.apiUrl.replace(/\/$/, "");
      push(`${apiBase}/v1/health`);
      push(`${apiBase}/`);
    }
  }
  return candidates;
}

/**
 * An HTTP response below 500 means a server is listening and answering on
 * that port — the app is up even if the probed path does not exist (404 on
 * /health for a UI app). Only timeouts / connection-refused / 5xx mean
 * "not up yet or unhealthy".
 */
export function isRespondingStatus(status: number): boolean {
  return status >= 200 && status < 500;
}
