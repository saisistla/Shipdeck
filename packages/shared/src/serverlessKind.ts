export type ServerlessKind = "function" | "app";

export interface ServerlessKindComposeHint {
  services?: Array<{ name: string; ports?: number[] }>;
}

/** Prefer full-app containers when compose has API + a web/UI service. */
export function suggestServerlessKind(compose?: ServerlessKindComposeHint | null): ServerlessKind {
  if (!compose?.services?.length) return "function";
  const names = compose.services.map((s) => s.name.toLowerCase());
  const hasApi = names.some((n) => /^(api|backend|server)$/.test(n) || n.includes("api"));
  const hasWeb = names.some(
    (n) =>
      /^(web|frontend|ui|admin|shipper|app)$/.test(n) ||
      n.includes("web") ||
      n.includes("admin") ||
      n.includes("frontend")
  );
  return hasApi && hasWeb ? "app" : "function";
}

export function composeHasShipperPath(compose?: ServerlessKindComposeHint | null): boolean {
  if (!compose?.services?.length) return false;
  return compose.services.some(
    (s) => /web|shipper/i.test(s.name) || (s.ports ?? []).includes(3002)
  );
}
