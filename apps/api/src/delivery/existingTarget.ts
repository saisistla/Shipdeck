import type {
  DeliveryCreatedConnection,
  DeliveryExistingKind,
  DeliveryExistingTarget,
  DeliveryExistingTargetInput,
} from "@shipdeck/shared";
import { parseServerlessUrl, sameServiceUrl } from "@shipdeck/shared";
import { store } from "../store.js";

function stringConfig(value: object): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === "string") out[key] = raw;
  }
  return out;
}

function withParsedUrl(input: DeliveryExistingTargetInput): DeliveryExistingTargetInput {
  if (input.kind === "ssh" || !input.serviceUrl?.trim()) return input;
  const parsed = parseServerlessUrl(input.serviceUrl);
  if (!parsed || parsed.platform === "unknown") {
    return { ...input, serviceUrl: input.serviceUrl.trim() };
  }
  return {
    ...input,
    kind: parsed.kind,
    serviceUrl: parsed.serviceUrl,
    region: input.region?.trim() || parsed.region,
    serviceName: input.serviceName?.trim() || parsed.serviceId,
    host: input.host?.trim() || parsed.host,
  };
}

export function publicExistingTarget(input: DeliveryExistingTargetInput): DeliveryExistingTarget {
  const resolved = withParsedUrl(input);
  return {
    kind: resolved.kind,
    host: resolved.host?.trim() || undefined,
    port: resolved.port?.trim() || undefined,
    user: resolved.user?.trim() || undefined,
    region: resolved.region?.trim() || undefined,
    projectId: resolved.projectId?.trim() || undefined,
    subscriptionId: resolved.subscriptionId?.trim() || undefined,
    tenantId: resolved.tenantId?.trim() || undefined,
    serviceName: resolved.serviceName?.trim() || undefined,
    serviceUrl: resolved.serviceUrl?.trim() || undefined,
    hasAuth: Boolean(
      input.password?.trim() ||
        input.privateKey?.trim() ||
        input.secretAccessKey?.trim() ||
        input.credentialsJson?.trim() ||
        input.clientSecret?.trim()
    ),
  };
}

export function existingTargetSecrets(input: DeliveryExistingTargetInput): Record<string, string> {
  const secrets: Record<string, string> = {};
  if (input.password?.trim()) secrets.password = input.password.trim();
  if (input.privateKey?.trim()) secrets.privateKey = input.privateKey.trim();
  if (input.accessKeyId?.trim()) secrets.accessKeyId = input.accessKeyId.trim();
  if (input.secretAccessKey?.trim()) secrets.secretAccessKey = input.secretAccessKey.trim();
  if (input.credentialsJson?.trim()) secrets.credentialsJson = input.credentialsJson.trim();
  if (input.clientId?.trim()) secrets.clientId = input.clientId.trim();
  if (input.clientSecret?.trim()) secrets.clientSecret = input.clientSecret.trim();
  return secrets;
}

export function existingTargetError(input: DeliveryExistingTargetInput): string | undefined {
  if (input.kind === "ssh") {
    if (!input.host?.trim()) return "Existing VM needs a host or IP";
    if (!input.password?.trim() && !input.privateKey?.trim()) {
      return "Existing VM needs an SSH password or private key";
    }
    return undefined;
  }
  const resolved = withParsedUrl(input);
  if (!resolved.serviceUrl?.trim()) {
    return "Paste the live service URL (for example https://….ecs.eu-west-1.on.aws)";
  }
  if (resolved.kind === "aws") {
    if (!resolved.region?.trim()) {
      return "AWS serverless needs a region — paste an .ecs.<region>.on.aws URL or type the region";
    }
    if (!input.accessKeyId?.trim() || !input.secretAccessKey?.trim()) {
      return "AWS serverless needs access key and secret key so Shipdeck can update that service";
    }
    return undefined;
  }
  if (resolved.kind === "azure") {
    if (
      !input.subscriptionId?.trim() ||
      !input.tenantId?.trim() ||
      !input.clientId?.trim() ||
      !input.clientSecret?.trim()
    ) {
      return "Azure serverless needs subscription, tenant, client id, and client secret";
    }
    return undefined;
  }
  if (!input.projectId?.trim() || !input.credentialsJson?.trim()) {
    return "GCP serverless needs project id and service-account JSON";
  }
  return undefined;
}

export function existingConnectionName(
  ticketKey: string,
  kind: DeliveryExistingKind,
  target: DeliveryExistingTarget
): string {
  if (kind === "ssh") return `${ticketKey} ${target.host ?? "VM"}`;
  const label = target.serviceName || target.host || target.region || "serverless";
  if (kind === "aws") return `${ticketKey} AWS ${label}`;
  if (kind === "azure") return `${ticketKey} Azure ${label}`;
  return `${ticketKey} GCP ${target.projectId || label}`;
}

export function ensureExistingTargetConnection(input: {
  name: string;
  kind: DeliveryExistingKind;
  target: DeliveryExistingTarget;
  secrets: Record<string, string>;
}): DeliveryCreatedConnection {
  if (input.kind === "ssh") {
    const host = (input.target.host ?? "").trim();
    const user = (input.target.user ?? "ubuntu").trim() || "ubuntu";
    const port = (input.target.port ?? "22").trim() || "22";
    if (!host) throw new Error("Existing VM needs a host or IP");
    for (const conn of store.connections.values()) {
      if (
        conn.type === "ssh" &&
        (conn.config.host ?? "").toLowerCase() === host.toLowerCase() &&
        (conn.config.user ?? "") === user
      ) {
        if (Object.keys(input.secrets).length) store.updateConnection(conn.id, { secrets: input.secrets });
        return { id: conn.id, name: conn.name, type: "ssh", created: false };
      }
    }
    const created = store.createConnection({
      name: input.name,
      type: "ssh",
      config: { host, port, user },
      secrets: input.secrets,
    });
    return { id: created.id, name: created.name, type: "ssh", created: true };
  }

  const type = input.kind;
  const parsed = input.target.serviceUrl ? parseServerlessUrl(input.target.serviceUrl) : undefined;
  for (const conn of store.connections.values()) {
    if (conn.type !== type) continue;
    if (input.target.serviceUrl && sameServiceUrl(conn.config.serviceUrl, input.target.serviceUrl)) {
      if (Object.keys(input.secrets).length) store.updateConnection(conn.id, { secrets: input.secrets });
      return { id: conn.id, name: conn.name, type, created: false };
    }
  }
  const matchConfig =
    type === "aws"
      ? { region: input.target.region ?? parsed?.region ?? "" }
      : type === "azure"
        ? { subscriptionId: input.target.subscriptionId ?? "", tenantId: input.target.tenantId ?? "" }
        : { project_id: input.target.projectId ?? "" };
  for (const conn of store.connections.values()) {
    if (conn.type !== type) continue;
    if (conn.config.serviceUrl) continue;
    const same = Object.entries(matchConfig).every(([key, value]) => !value || (conn.config[key] ?? "") === value);
    if (!same) continue;
    const nextConfig = {
      ...conn.config,
      ...matchConfig,
      ...(input.target.serviceUrl ? { serviceUrl: input.target.serviceUrl } : {}),
      ...(input.target.serviceName ? { serviceName: input.target.serviceName } : {}),
      computeMode: "serverless",
      serverlessKind: parsed?.serverlessKind ?? "app",
    };
    store.updateConnection(conn.id, {
      config: stringConfig(nextConfig),
      ...(Object.keys(input.secrets).length ? { secrets: input.secrets } : {}),
    });
    return { id: conn.id, name: conn.name, type, created: false };
  }
  const created = store.createConnection({
    name: input.name,
    type,
    config: stringConfig({
      ...matchConfig,
      ...(input.target.serviceUrl ? { serviceUrl: input.target.serviceUrl } : {}),
      ...(input.target.serviceName || parsed?.serviceId
        ? { serviceName: input.target.serviceName || parsed?.serviceId || "" }
        : {}),
      computeMode: "serverless",
      serverlessKind: parsed?.serverlessKind ?? "app",
    }),
    secrets: input.secrets,
  });
  return { id: created.id, name: created.name, type, created: true };
}
