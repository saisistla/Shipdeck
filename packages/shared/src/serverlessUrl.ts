export type ParsedServerlessPlatform = "ecs" | "lambda" | "containerapp" | "appservice" | "cloudrun" | "unknown";

export interface ParsedServerlessUrl {
  kind: "aws" | "azure" | "gcp";
  platform: ParsedServerlessPlatform;
  serverlessKind: "app" | "function";
  region?: string;
  serviceId?: string;
  serviceUrl: string;
  host: string;
}

function normalizeServiceUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    url.hash = "";
    url.search = "";
    const path = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
    return `${url.protocol}//${url.host}${path}`;
  } catch {
    return trimmed.replace(/\/$/, "");
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url.includes("://") ? url : `https://${url}`).host;
  } catch {
    return url.replace(/^https?:\/\//i, "").split("/")[0] ?? url;
  }
}

/** Read cloud, region, and service id from a live serverless URL. */
export function parseServerlessUrl(raw: string): ParsedServerlessUrl | undefined {
  const serviceUrl = normalizeServiceUrl(raw);
  if (!serviceUrl) return undefined;
  const host = hostOf(serviceUrl);

  const ecs = host.match(/^([a-z0-9-]+)\.ecs\.([a-z0-9-]+)\.on\.aws$/i);
  if (ecs) {
    return {
      kind: "aws",
      platform: "ecs",
      serverlessKind: "app",
      region: ecs[2],
      serviceId: ecs[1],
      serviceUrl,
      host,
    };
  }

  const lambda = host.match(/^([a-z0-9]+)\.lambda-url\.([a-z0-9-]+)\.on\.aws$/i);
  if (lambda) {
    return {
      kind: "aws",
      platform: "lambda",
      serverlessKind: "function",
      region: lambda[2],
      serviceId: lambda[1],
      serviceUrl,
      host,
    };
  }

  const containerApp = host.match(/^([a-z0-9-]+)\.([a-z0-9-]+)\.azurecontainerapps\.io$/i);
  if (containerApp) {
    return {
      kind: "azure",
      platform: "containerapp",
      serverlessKind: "app",
      region: containerApp[2],
      serviceId: containerApp[1],
      serviceUrl,
      host,
    };
  }

  if (/\.azurecontainerapps\.io$/i.test(host)) {
    return {
      kind: "azure",
      platform: "containerapp",
      serverlessKind: "app",
      serviceId: host.split(".")[0],
      serviceUrl,
      host,
    };
  }

  if (/\.azurewebsites\.net$/i.test(host)) {
    return {
      kind: "azure",
      platform: "appservice",
      serverlessKind: "app",
      serviceId: host.split(".")[0],
      serviceUrl,
      host,
    };
  }

  const runApp = host.match(/^([a-z0-9-]+(?:-[a-z0-9]+)*)\.([a-z0-9-]+)\.a\.run\.app$/i);
  if (runApp) {
    return {
      kind: "gcp",
      platform: "cloudrun",
      serverlessKind: "app",
      region: runApp[2],
      serviceId: runApp[1],
      serviceUrl,
      host,
    };
  }

  if (/\.a\.run\.app$/i.test(host) || /\.run\.app$/i.test(host)) {
    return {
      kind: "gcp",
      platform: "cloudrun",
      serverlessKind: "app",
      serviceId: host.split(".")[0],
      serviceUrl,
      host,
    };
  }

  return {
    kind: "aws",
    platform: "unknown",
    serverlessKind: "app",
    serviceUrl,
    host,
  };
}

export function describeServerlessUrl(parsed: ParsedServerlessUrl): string {
  const platform =
    parsed.platform === "ecs"
      ? "AWS ECS"
      : parsed.platform === "lambda"
        ? "AWS Lambda"
        : parsed.platform === "containerapp"
          ? "Azure Container Apps"
          : parsed.platform === "appservice"
            ? "Azure App Service"
            : parsed.platform === "cloudrun"
              ? "GCP Cloud Run"
              : parsed.kind.toUpperCase();
  const parts = [platform];
  if (parsed.region) parts.push(parsed.region);
  if (parsed.serviceId) parts.push(parsed.serviceId);
  return parts.join(" · ");
}

export function sameServiceUrl(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  return normalizeServiceUrl(a).toLowerCase() === normalizeServiceUrl(b).toLowerCase();
}
