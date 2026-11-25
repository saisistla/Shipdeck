import fs from "node:fs";
import path from "node:path";
import type { DeployRuntime, PipelineBoxes } from "@shipdeck/shared";
import { commandExists, runCommand } from "./exec.js";
import { resolveAppRuntimePlan } from "./runtimePlan.js";
import { sshExec, type SshTarget } from "./ssh.js";

export interface BootstrapNeed {
  docker: boolean;
  compose: boolean;
  node: boolean;
  python: boolean;
  java: boolean;
  go: boolean;
  /** Lightweight single-node Kubernetes (k3s) when deploy runtime is kubernetes */
  k3s: boolean;
}

export interface BootstrapResult {
  ok: boolean;
  message?: string;
  kubeconfig?: string;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Derive what the target host must have from pipeline + detected app files. */
export function needsFromPipeline(boxes: PipelineBoxes, sourcePath?: string): BootstrapNeed {
  const runtime = boxes.deploy.runtime;
  const dataDocker =
    boxes.data.enabled &&
    boxes.data.createWithTerraform &&
    (boxes.data.provisionMode ?? "docker") === "docker";

  const base: BootstrapNeed = {
    docker:
      runtime === "docker" ||
      runtime === "compose" ||
      dataDocker ||
      Boolean(boxes.build.registryConnectionId),
    compose: runtime === "compose",
    node: false,
    python: false,
    java: false,
    go: false,
    k3s: runtime === "kubernetes",
  };

  if (runtime === "systemd") {
    if (sourcePath) {
      const plan = resolveAppRuntimePlan(sourcePath, boxes.deploy.port);
      base.node = plan.bootstrap.node;
      base.python = plan.bootstrap.python;
      base.java = plan.bootstrap.java;
      base.go = plan.bootstrap.go;
    }
    // If source not available yet, deploy step will install based on detection
  }

  return base;
}

export async function ensureRemoteDocker(
  target: SshTarget,
  log: (line: string) => void
): Promise<BootstrapResult> {
  log(`Preparing Docker on ${target.username}@${target.host}…`);
  const probe = await sshExec(
    target,
    "uname -a && (command -v docker >/dev/null && docker --version || echo DOCKER_MISSING)",
    log
  );
  if (probe.code !== 0) {
    return { ok: false, message: "SSH probe failed while checking Docker" };
  }
  if (!probe.stdout.includes("DOCKER_MISSING")) {
    log("Docker is already available on the host");
    return { ok: true, message: "Docker ready" };
  }

  log("Docker missing — installing docker.io");
  const install = await sshExec(
    target,
    [
      "sudo DEBIAN_FRONTEND=noninteractive apt-get update -y",
      "sudo DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io",
      "sudo systemctl enable --now docker || true",
      "sudo usermod -aG docker $USER || true",
      "docker --version || sudo docker --version",
    ].join(" && "),
    log
  );
  if (install.code !== 0) {
    return {
      ok: false,
      message: "Failed to install Docker on remote host — check sudo/apt access",
    };
  }
  return { ok: true, message: "Docker installed" };
}

export async function ensureRemoteCompose(
  target: SshTarget,
  log: (line: string) => void
): Promise<BootstrapResult> {
  const probe = await sshExec(
    target,
    "(docker compose version >/dev/null 2>&1 && echo COMPOSE_OK) || (docker-compose version >/dev/null 2>&1 && echo COMPOSE_OK) || echo COMPOSE_MISSING",
    log
  );
  if (probe.stdout.includes("COMPOSE_OK")) {
    log("Docker Compose already available");
    return { ok: true, message: "Compose ready" };
  }
  log("Installing Docker Compose plugin…");
  const install = await sshExec(
    target,
    [
      "sudo DEBIAN_FRONTEND=noninteractive apt-get update -y",
      "sudo DEBIAN_FRONTEND=noninteractive apt-get install -y docker-compose-v2 docker-compose-plugin || sudo DEBIAN_FRONTEND=noninteractive apt-get install -y docker-compose",
      "docker compose version || docker-compose version",
    ].join(" && "),
    log
  );
  if (install.code !== 0) {
    return { ok: false, message: "Failed to install Docker Compose on remote host" };
  }
  return { ok: true, message: "Compose installed" };
}

export async function ensureRemoteNode(
  target: SshTarget,
  log: (line: string) => void
): Promise<BootstrapResult> {
  const probe = await sshExec(
    target,
    "(command -v node >/dev/null && node -v && command -v npm >/dev/null && echo NODE_OK) || echo NODE_MISSING",
    log
  );
  if (probe.stdout.includes("NODE_OK")) {
    log("Node.js already available");
    return { ok: true, message: "Node ready" };
  }
  log("Installing Node.js 20 (NodeSource)…");
  const install = await sshExec(
    target,
    [
      "sudo DEBIAN_FRONTEND=noninteractive apt-get update -y",
      "sudo DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl gnupg",
      "curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -",
      "sudo DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs",
      "node -v && npm -v",
    ].join(" && "),
    log
  );
  if (install.code !== 0) {
    return { ok: false, message: "Failed to install Node.js on remote host" };
  }
  return { ok: true, message: "Node installed" };
}

export async function ensureRemotePython(
  target: SshTarget,
  log: (line: string) => void
): Promise<BootstrapResult> {
  const probe = await sshExec(
    target,
    "(command -v python3 >/dev/null && python3 -V && echo PY_OK) || echo PY_MISSING",
    log
  );
  if (probe.stdout.includes("PY_OK")) {
    log("Python3 already available");
    return { ok: true, message: "Python ready" };
  }
  log("Installing Python3 + pip…");
  const install = await sshExec(
    target,
    [
      "sudo DEBIAN_FRONTEND=noninteractive apt-get update -y",
      "sudo DEBIAN_FRONTEND=noninteractive apt-get install -y python3 python3-pip python3-venv",
      "python3 -V",
    ].join(" && "),
    log
  );
  if (install.code !== 0) return { ok: false, message: "Failed to install Python on remote host" };
  return { ok: true, message: "Python installed" };
}

export async function ensureRemoteJava(
  target: SshTarget,
  log: (line: string) => void
): Promise<BootstrapResult> {
  const probe = await sshExec(
    target,
    "(command -v java >/dev/null && java -version 2>&1 | head -1 && echo JAVA_OK) || echo JAVA_MISSING",
    log
  );
  if (probe.stdout.includes("JAVA_OK")) {
    log("Java already available");
    return { ok: true, message: "Java ready" };
  }
  log("Installing OpenJDK…");
  const install = await sshExec(
    target,
    [
      "sudo DEBIAN_FRONTEND=noninteractive apt-get update -y",
      "sudo DEBIAN_FRONTEND=noninteractive apt-get install -y openjdk-17-jre-headless maven",
      "java -version",
    ].join(" && "),
    log
  );
  if (install.code !== 0) return { ok: false, message: "Failed to install Java on remote host" };
  return { ok: true, message: "Java installed" };
}

export async function ensureRemoteGo(
  target: SshTarget,
  log: (line: string) => void
): Promise<BootstrapResult> {
  const probe = await sshExec(
    target,
    "(command -v go >/dev/null && go version && echo GO_OK) || echo GO_MISSING",
    log
  );
  if (probe.stdout.includes("GO_OK")) {
    log("Go already available");
    return { ok: true, message: "Go ready" };
  }
  log("Installing Go…");
  const install = await sshExec(
    target,
    [
      "sudo DEBIAN_FRONTEND=noninteractive apt-get update -y",
      "sudo DEBIAN_FRONTEND=noninteractive apt-get install -y golang-go",
      "go version",
    ].join(" && "),
    log
  );
  if (install.code !== 0) return { ok: false, message: "Failed to install Go on remote host" };
  return { ok: true, message: "Go installed" };
}

export async function ensureRemoteK3s(
  target: SshTarget,
  log: (line: string) => void
): Promise<BootstrapResult> {
  const probe = await sshExec(
    target,
    "(command -v kubectl >/dev/null && sudo k3s kubectl get nodes >/dev/null 2>&1 && echo K3S_OK) || (command -v k3s >/dev/null && echo K3S_OK) || echo K3S_MISSING",
    log
  );
  if (!probe.stdout.includes("K3S_OK")) {
    log("Kubernetes not found — installing k3s (single-node cluster)…");
    const install = await sshExec(
      target,
      [
        "curl -sfL https://get.k3s.io | sh -",
        "sudo systemctl enable --now k3s || true",
        "sleep 5",
        "sudo k3s kubectl get nodes",
      ].join(" && "),
      log
    );
    if (install.code !== 0) {
      return {
        ok: false,
        message: "Failed to install k3s on remote host (needed for Kubernetes deploy)",
      };
    }
  } else {
    log("k3s / kubectl already available on host");
  }

  const kc = await sshExec(
    target,
    "sudo cat /etc/rancher/k3s/k3s.yaml",
    log
  );
  if (kc.code !== 0 || !kc.stdout.trim()) {
    return { ok: false, message: "k3s installed but could not read kubeconfig" };
  }

  // Replace loopback server with public host so API machine can talk to the cluster
  let kubeconfig = kc.stdout.replace(
    /server:\s*https?:\/\/127\.0\.0\.1:6443/g,
    `server: https://${target.host}:6443`
  );
  kubeconfig = kubeconfig.replace(
    /server:\s*https?:\/\/localhost:6443/g,
    `server: https://${target.host}:6443`
  );

  // Ensure API port open hint
  log("Fetched kubeconfig (server rewritten to public VM IP). Ensure port 6443 is allowed.");
  return { ok: true, message: "k3s ready", kubeconfig };
}

/** Install everything the pipeline needs on a remote SSH host. */
export async function bootstrapRemoteHost(
  target: SshTarget,
  needs: BootstrapNeed,
  log: (line: string) => void
): Promise<BootstrapResult> {
  if (needs.docker || needs.compose || needs.k3s) {
    // k3s bundles containerd; still install docker for docker/compose/data paths
    if (needs.docker || needs.compose) {
      const d = await ensureRemoteDocker(target, log);
      if (!d.ok) return d;
    }
  }
  if (needs.compose) {
    const c = await ensureRemoteCompose(target, log);
    if (!c.ok) return c;
  }
  if (needs.node) {
    const n = await ensureRemoteNode(target, log);
    if (!n.ok) return n;
  }
  if (needs.python) {
    const p = await ensureRemotePython(target, log);
    if (!p.ok) return p;
  }
  if (needs.java) {
    const j = await ensureRemoteJava(target, log);
    if (!j.ok) return j;
  }
  if (needs.go) {
    const g = await ensureRemoteGo(target, log);
    if (!g.ok) return g;
  }
  if (needs.k3s) {
    return ensureRemoteK3s(target, log);
  }
  return { ok: true, message: "Host capabilities ready" };
}

export async function waitForDockerOnNewVm(
  target: SshTarget,
  log: (line: string) => void,
  attempts = 24
): Promise<BootstrapResult> {
  for (let i = 1; i <= attempts; i++) {
    log(`Waiting for SSH/Docker on new VM (try ${i}/${attempts})…`);
    try {
      const ready = await sshExec(
        target,
        [
          "if command -v docker >/dev/null 2>&1; then docker --version; echo DOCKER_OK;",
          "elif [ -f /var/log/shipdeck-docker-ready ]; then echo DOCKER_OK;",
          "else echo DOCKER_MISSING; fi",
        ].join(" "),
        log
      );
      if (ready.code === 0 && ready.stdout.includes("DOCKER_OK")) {
        return { ok: true, message: "Docker ready on new VM (cloud-init)" };
      }
      if (ready.code === 0 && ready.stdout.includes("DOCKER_MISSING") && i >= 8) {
        return ensureRemoteDocker(target, log);
      }
    } catch (err) {
      log(`Not ready yet: ${err instanceof Error ? err.message : String(err)}`);
    }
    await sleep(10_000);
  }
  return ensureRemoteDocker(target, log);
}

/** Local preflight on the Shipdeck API machine for local deploys. */
export async function ensureLocalRuntime(
  runtime: DeployRuntime,
  log: (line: string) => void
): Promise<BootstrapResult> {
  if (runtime === "docker" || runtime === "compose") {
    if (!(await commandExists("docker"))) {
      return {
        ok: false,
        message:
          "Docker is not installed on this machine. Install Docker Desktop (or skip Infra and use a remote SSH host).",
      };
    }
    if (runtime === "compose") {
      const c = await runCommand("docker", ["compose", "version"], { onLine: log });
      if (c.code !== 0) {
        return {
          ok: false,
          message:
            "Docker Compose plugin missing locally. Update Docker Desktop or install docker-compose-plugin.",
        };
      }
    }
  }
  if (runtime === "kubernetes") {
    if (!(await commandExists("kubectl"))) {
      return {
        ok: false,
        message:
          "kubectl not found locally. Either install kubectl, or use Infra=SSH/Create so Shipdeck can install k3s on the VM.",
      };
    }
  }
  if (runtime === "systemd") {
    return {
      ok: false,
      message: "systemd deploy only works on a remote Linux SSH host (not local Windows/Mac).",
    };
  }
  return { ok: true };
}

export function writeKubeconfigFile(workRoot: string, runId: string, contents: string): string {
  const dir = path.join(workRoot, runId);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "kubeconfig.yaml");
  fs.writeFileSync(file, contents, { mode: 0o600 });
  return file;
}
