import fs from "node:fs";
import path from "node:path";
import { resolveCloudContext } from "./cloud.js";
import { runCommand } from "./exec.js";
import { store } from "../store.js";

/**
 * True when local Terraform state still lists managed resources.
 * A locked or unreadable state is treated as "still has resources" so a live
 * apply is not marked destroyed, and Destroy can still see the workspace.
 * This does not spawn Terraform. `terraform state list` waits on the lock and
 * piled up during apply.
 */
export async function terraformStateHasResources(workDir: string): Promise<boolean> {
  const stateFile = path.join(workDir, "terraform.tfstate");
  const lockFile = path.join(workDir, ".terraform.tfstate.lock.info");
  if (!fs.existsSync(stateFile)) return false;
  if (fs.existsSync(lockFile)) return true;
  try {
    const raw = JSON.parse(fs.readFileSync(stateFile, "utf8")) as {
      resources?: unknown;
    };
    if (Array.isArray(raw.resources)) return raw.resources.length > 0;
    return true;
  } catch {
    return true;
  }
}

export interface DestroyProvisionedInfraOpts {
  workDir: string;
  cloudConnectionId?: string;
  sshConnectionIdCreated?: string;
  publicIp?: string;
  /** Log tag: rollback (failure) vs teardown (operator) */
  tag?: "rollback" | "teardown";
  log: (line: string) => void;
}

/**
 * Destroy a Shipdeck-created VM (and its VPC/SG) using the run's Terraform workspace.
 * Safe to call when state is empty — no-ops.
 */
export async function destroyProvisionedInfra(
  opts: DestroyProvisionedInfraOpts
): Promise<{ ok: boolean; message: string }> {
  const {
    workDir,
    cloudConnectionId,
    sshConnectionIdCreated,
    publicIp,
    log,
    tag = "rollback",
  } = opts;
  if (!workDir || !fs.existsSync(workDir)) {
    return { ok: true, message: "No Terraform workspace to destroy" };
  }
  const has = await terraformStateHasResources(workDir);
  if (!has) {
    log(`[${tag}] Terraform state has no resources — nothing to destroy`);
    return { ok: true, message: "Nothing to destroy" };
  }

  log(
    `[${tag}] Destroying provisioned infra${publicIp ? ` (${publicIp})` : ""}…`
  );
  const cloud = resolveCloudContext(cloudConnectionId, workDir);
  let destroy;
  try {
    // Aurora + ElastiCache + App Runner/ECS often need >10m to tear down.
    destroy = await runCommand("terraform", ["destroy", "-auto-approve", "-input=false"], {
      cwd: workDir,
      env: cloud.env,
      onLine: log,
      timeoutMs: 1_800_000,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`[${tag}] terraform destroy error: ${msg}`);
    // Timeout may kill our wait after AWS already finished — treat empty state as success.
    if (!(await terraformStateHasResources(workDir))) {
      log(`[${tag}] State is empty after timeout — treating as destroyed`);
      return { ok: true, message: "Infra destroyed (confirmed empty state after timeout)" };
    }
    return { ok: false, message: msg };
  }

  if (destroy.code !== 0) {
    if (!(await terraformStateHasResources(workDir))) {
      log(`[${tag}] Destroy exited non-zero but state is empty — treating as destroyed`);
      return { ok: true, message: "Infra destroyed" };
    }
    log(
      `[${tag}] terraform destroy failed — remove leftover resources in the cloud console` +
        (publicIp ? ` (IP was ${publicIp})` : "")
    );
    return { ok: false, message: "terraform destroy failed" };
  }

  log(`[${tag}] Infra destroyed`);
  if (sshConnectionIdCreated && store.connections.has(sshConnectionIdCreated)) {
    store.deleteConnection(sshConnectionIdCreated);
    log(`[${tag}] Removed auto-saved SSH connection ${sshConnectionIdCreated}`);
  }
  return { ok: true, message: "Infra destroyed" };
}
