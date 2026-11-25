/** Recommend serverless memory / timeout from stack signals. */

import type { ServerlessKind } from "./serverlessKind.js";

export interface ServerlessSizingRecommendation {
  memoryMb: number;
  timeoutSeconds: number;
  runtimeHint: "nodejs20" | "python312";
  reasons: string[];
  warning?: string;
  summary: string;
  kind: ServerlessKind;
}

export interface ServerlessSizingInput {
  stack?: string;
  signals?: string[];
  compose?: {
    services: Array<{ name: string; ports: number[] }>;
  };
  /** function = Lambda/Functions; app = managed containers + DB */
  kind?: ServerlessKind;
}

function hasSignal(signals: string[], re: RegExp) {
  return signals.some((s) => re.test(s));
}

function snapMemory(memoryMb: number): number {
  const steps = [128, 256, 512, 1024, 1536, 2048, 3008, 4096];
  return steps.find((s) => s >= memoryMb) ?? 4096;
}

/**
 * Estimate sizing for serverless create.
 * - function: Lambda / Functions / Cloud Functions HTTP handler
 * - app: ECS Express / Container Apps / Cloud Run + managed Postgres/Redis
 */
export function recommendServerlessSize(
  input: ServerlessSizingInput
): ServerlessSizingRecommendation {
  const kind: ServerlessKind = input.kind ?? "function";
  const signals = input.signals ?? [];
  const services = input.compose?.services ?? [];
  const reasons: string[] = [];

  const isPython =
    hasSignal(signals, /python|django|flask|fastapi|\.py\b/i) ||
    /python/i.test(input.stack ?? "");
  const isNode =
    hasSignal(signals, /package\.json|node|next|express/i) ||
    /node|next/i.test(input.stack ?? "");
  const runtimeHint: "nodejs20" | "python312" =
    isPython && !isNode ? "python312" : "nodejs20";

  if (kind === "app") {
    return recommendAppSize({ services, isNode, isPython, runtimeHint, reasons });
  }

  return recommendFunctionSize({
    services,
    signals,
    isNode,
    isPython,
    runtimeHint,
    reasons,
  });
}

function recommendAppSize(opts: {
  services: Array<{ name: string; ports: number[] }>;
  isNode: boolean;
  isPython: boolean;
  runtimeHint: "nodejs20" | "python312";
  reasons: string[];
}): ServerlessSizingRecommendation {
  const { services, isNode, isPython, runtimeHint, reasons } = opts;
  let memoryMb = 1024;
  const timeoutSeconds = 60;

  const names = services.map((s) => s.name.toLowerCase());
  const hasApi = names.some((n) => n === "api" || n.includes("api"));
  const hasWeb = names.some(
    (n) =>
      n === "web" ||
      n.includes("web") ||
      n.includes("admin") ||
      n.includes("frontend") ||
      n.includes("shipper")
  );
  const dbish = services.filter((s) =>
    /postgres|postgis|mysql|mongo|redis|elastic|rabbit|kafka/i.test(s.name)
  );

  if (hasApi && hasWeb) {
    memoryMb = Math.max(memoryMb, 1024);
    reasons.push("Compose has API + web — deploy both as managed containers");
  } else if (services.length) {
    reasons.push(`Compose has ${services.length} services — Full app UI uses api + web images`);
  } else {
    reasons.push("Full app UI — container CPU/memory for ECS Express / Container Apps / Cloud Run");
  }

  if (isNode) {
    memoryMb = Math.max(memoryMb, 1024);
    reasons.push("Node/Next images — 1024 MB is a solid container baseline");
  } else if (isPython) {
    memoryMb = Math.max(memoryMb, 1024);
    reasons.push("Python API image — 1024 MB container baseline");
  }

  if (hasWeb) {
    memoryMb = Math.max(memoryMb, 2048);
    reasons.push("Web/Next UI — raise container memory for production images");
  }

  if (dbish.length) {
    memoryMb = Math.max(memoryMb, 1024);
    reasons.push(
      `Managed data plane: ${dbish.map((s) => s.name).join(", ")} (sized from Re-scan, not a fixed Terraform instance class)`
    );
  }

  if (services.length >= 4) {
    memoryMb = Math.max(memoryMb, 2048);
    reasons.push(`Multi-service compose (${services.length}) — api + web containers, not a health zip`);
  }

  memoryMb = snapMemory(memoryMb);

  return {
    memoryMb,
    timeoutSeconds,
    runtimeHint,
    reasons,
    warning:
      "No Docker on this PC: AWS CodeBuild, Azure ACR Tasks, or GCP Cloud Build clone Remote Git and build images. First deploy is longer.",
    summary: `Full app UI · ${memoryMb} MB containers · ${runtimeHint}`,
    kind: "app",
  };
}

function recommendFunctionSize(opts: {
  services: Array<{ name: string; ports: number[] }>;
  signals: string[];
  isNode: boolean;
  isPython: boolean;
  runtimeHint: "nodejs20" | "python312";
  reasons: string[];
}): ServerlessSizingRecommendation {
  const { services, signals, isNode, isPython, runtimeHint, reasons } = opts;
  let memoryMb = 256;
  let timeoutSeconds = 15;

  if (isPython && !isNode) {
    memoryMb = 512;
    timeoutSeconds = 30;
    reasons.push("Python runtime — start with 512 MB");
  } else if (isNode) {
    memoryMb = 512;
    timeoutSeconds = 20;
    reasons.push("Node.js HTTP handler — 512 MB is a solid baseline");
  } else {
    reasons.push("Generic HTTP function — 256 MB baseline");
  }

  const nextish =
    hasSignal(signals, /next|frontend|admin_web/i) ||
    services.some((s) => /web|admin|frontend|ui|next/i.test(s.name));
  if (nextish) {
    memoryMb = Math.max(memoryMb, 1024);
    timeoutSeconds = Math.max(timeoutSeconds, 30);
    reasons.push("Frontend/Next-style signals — raise memory (prefer Full app UI or Create VM for Next)");
  }

  if (services.length >= 2) {
    memoryMb = Math.max(memoryMb, 1024);
    timeoutSeconds = Math.max(timeoutSeconds, 30);
    reasons.push(
      `Compose has ${services.length} services — Health function is a thin HTTP edge; switch to Full app UI for real UI`
    );
  }

  const dbish = services.filter((s) =>
    /postgres|postgis|mysql|mongo|redis|elastic|rabbit|kafka/i.test(s.name)
  );
  let warning: string | undefined;
  if (dbish.length || services.length >= 3) {
    warning =
      "This project looks compose/DB heavy. Health function only serves JSON — switch to Full app UI (containers) for ShareHaul-style /shipper, or Create VM.";
    memoryMb = Math.max(memoryMb, 1024);
    timeoutSeconds = Math.max(timeoutSeconds, 30);
    reasons.push(
      dbish.length
        ? `Data services detected (${dbish.map((s) => s.name).join(", ")})`
        : "Multi-service compose detected"
    );
  }

  if (hasSignal(signals, /heavy|ml|tensorflow|torch/i)) {
    memoryMb = Math.max(memoryMb, 2048);
    timeoutSeconds = Math.max(timeoutSeconds, 60);
    reasons.push("Heavy compute signals — bump memory & timeout");
  }

  memoryMb = snapMemory(memoryMb);
  timeoutSeconds = Math.min(900, Math.max(3, timeoutSeconds));

  return {
    memoryMb,
    timeoutSeconds,
    runtimeHint,
    reasons,
    warning,
    summary: `Health function · ${memoryMb} MB · ${timeoutSeconds}s · ${runtimeHint}`,
    kind: "function",
  };
}
