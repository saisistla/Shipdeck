import type { DeployRuntime, PipelineBoxes, StackDetection } from "@shipdeck/shared";
import fs from "node:fs";
import path from "node:path";
import { detectComposeFromDir } from "./lib/composeDetect.js";

function exists(root: string, rel: string) {
  return fs.existsSync(path.join(root, rel));
}

/** Detect stack from a real local workspace directory. */
export function detectStackFromDir(root: string): StackDetection {
  const signals: string[] = [];
  let stack = "unknown";
  let suggestedRuntime: DeployRuntime = "docker";
  let confidence = 0.35;

  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    return {
      stack: "missing-path",
      confidence: 0,
      suggestedRuntime: "docker",
      signals: [`Path not found or not a directory: ${root}`],
    };
  }

  const compose = detectComposeFromDir(root);
  if (compose) {
    signals.push(`Found ${compose.file}`);
    const svcSummary = compose.services
      .map((s) =>
        s.ports.length ? `${s.name} (:${s.ports.join(",:")})` : `${s.name} (no host ports)`
      )
      .join(", ");
    if (svcSummary) {
      signals.push(`Compose services: ${svcSummary}`);
    }
    if (compose.suggestedPrimaryService) {
      signals.push(
        `Suggested health target: ${compose.suggestedPrimaryService}:${compose.suggestedPort}`
      );
    }
    stack = "compose";
    suggestedRuntime = "compose";
    confidence = 0.92;
  } else if (exists(root, "Dockerfile")) {
    signals.push("Found Dockerfile");
    stack = "docker";
    suggestedRuntime = "docker";
    confidence = 0.9;
  }

  if (exists(root, "package.json")) {
    signals.push("Found package.json (Node)");
    stack = stack === "unknown" ? "node" : `${stack}+node`;
    confidence = Math.max(confidence, 0.75);
    if (stack.startsWith("node") && !compose && !exists(root, "Dockerfile")) {
      suggestedRuntime = "docker";
      signals.push("Will containerize Node app (Dockerfile recommended)");
    }
  }

  if (exists(root, "requirements.txt") || exists(root, "pyproject.toml")) {
    signals.push("Found Python project markers");
    stack = stack === "unknown" ? "python" : `${stack}+python`;
    confidence = Math.max(confidence, 0.75);
  }

  if (exists(root, "pom.xml") || exists(root, "build.gradle") || exists(root, "build.gradle.kts")) {
    signals.push("Found Java project markers");
    stack = stack === "unknown" ? "java" : `${stack}+java`;
    confidence = Math.max(confidence, 0.75);
  }

  if (exists(root, "go.mod")) {
    signals.push("Found Go module");
    stack = stack === "unknown" ? "go" : `${stack}+go`;
    confidence = Math.max(confidence, 0.75);
  }

  // Prefer Compose when a compose file exists; k8s only wins when there is no compose.
  if (
    !compose &&
    (exists(root, "charts") || exists(root, "k8s") || exists(root, "helm"))
  ) {
    signals.push("Found Kubernetes/Helm markers");
    suggestedRuntime = "kubernetes";
    confidence = Math.max(confidence, 0.8);
  } else if (
    compose &&
    (exists(root, "charts") || exists(root, "k8s") || exists(root, "helm"))
  ) {
    signals.push("Also found Kubernetes/Helm markers (Compose preferred while compose file exists)");
  }

  if (exists(root, "index.html") && !exists(root, "package.json")) {
    signals.push("Static site signals");
    stack = "static";
    confidence = Math.max(confidence, 0.65);
  }

  if (exists(root, ".git")) {
    signals.push("Git repository detected");
  }

  return { stack, confidence, suggestedRuntime, signals, ...(compose ? { compose } : {}) };
}

export function detectStack(boxes: PipelineBoxes): StackDetection {
  const local = boxes.source.localPath?.trim();
  if (boxes.source.mode === "local" && local) {
    return detectStackFromDir(local);
  }

  const signals: string[] = ["No local path — using config heuristics"];
  let suggestedRuntime: DeployRuntime = boxes.deploy.runtime;
  if (boxes.build.dockerfilePath) {
    signals.push(`Dockerfile configured: ${boxes.build.dockerfilePath}`);
  }
  if (boxes.deploy.runtime === "kubernetes") {
    signals.push("Deploy runtime set to Kubernetes");
  }
  if (boxes.deploy.runtime === "compose") {
    signals.push("Deploy runtime set to Compose — services/ports come from docker-compose.yml after Source");
  }
  return {
    stack: "config-only",
    confidence: 0.4,
    suggestedRuntime,
    signals,
  };
}
