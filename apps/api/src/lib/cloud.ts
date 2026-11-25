import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { getConnection, getSecrets, resolveSshTarget } from "./connections.js";
import type { SshTarget } from "./ssh.js";

/**
 * Groups that make OpenSSH ignore a private key on Windows.
 * SIDs stay valid on any language and any PC: Everyone, Authenticated Users, Users.
 */
const WINDOWS_BROAD_KEY_SIDS = ["*S-1-1-0", "*S-1-5-11", "*S-1-5-32-545"];

/** OpenSSH reads a private key only when other accounts cannot. Unix mode 0600 is enough; Windows needs the ACL. */
export function restrictPrivateKeyFile(filePath: string): void {
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    /* mode bits are not the Windows ACL */
  }
  if (process.platform !== "win32") return;
  try {
    execFileSync("icacls", [filePath, "/inheritance:r"], { windowsHide: true, stdio: "ignore" });
    for (const sid of WINDOWS_BROAD_KEY_SIDS) {
      try {
        execFileSync("icacls", [filePath, "/remove", sid], { windowsHide: true, stdio: "ignore" });
      } catch {
        /* that group is not on the file */
      }
    }
    const account = execFileSync("whoami", { encoding: "utf8", windowsHide: true }).trim();
    if (account) {
      execFileSync("icacls", [filePath, "/grant:r", `${account}:(F)`], {
        windowsHide: true,
        stdio: "ignore",
      });
    }
  } catch {
    /* ssh-keygen reports a file that is still too open */
  }
}

/** Derive OpenSSH public key from a Deploy PEM (AWS key_pair import / Azure·GCP VM inject). */
export function writePublicKeyFromPem(workDir: string, pem: string): string | undefined {
  const pemPath = path.join(workDir, "deploy.pem");
  const pubPath = path.join(workDir, "deploy.pem.pub");
  fs.mkdirSync(workDir, { recursive: true });
  fs.writeFileSync(pemPath, pem.endsWith("\n") ? pem : `${pem}\n`, { mode: 0o600 });
  restrictPrivateKeyFile(pemPath);
  try {
    const sshKeygen =
      process.platform === "win32" && fs.existsSync("C:\\Windows\\System32\\OpenSSH\\ssh-keygen.exe")
        ? "C:\\Windows\\System32\\OpenSSH\\ssh-keygen.exe"
        : "ssh-keygen";
    const pub = execFileSync(sshKeygen, ["-y", "-f", pemPath], {
      encoding: "utf8",
      windowsHide: true,
    }).trim();
    if (!pub.startsWith("ssh-")) return undefined;
    fs.writeFileSync(pubPath, `${pub}\n`);
    return pubPath.replace(/\\/g, "/");
  } catch {
    return undefined;
  }
}

function deployPemFromSecrets(secrets: Record<string, string | undefined>): string | undefined {
  if (secrets.sshPrivateKey) return secrets.sshPrivateKey;
  if (secrets.privateKey) return secrets.privateKey;
  if (secrets.deployKey && /BEGIN[-\s].*PRIVATE KEY/i.test(secrets.deployKey)) {
    return secrets.deployKey;
  }
  return undefined;
}

function setSshPublicKeyTfvar(tfvarsExtra: string[], pubPath: string) {
  for (let i = tfvarsExtra.length - 1; i >= 0; i--) {
    if (tfvarsExtra[i].startsWith("ssh_public_key")) tfvarsExtra.splice(i, 1);
  }
  tfvarsExtra.push(`ssh_public_key = "${pubPath}"`);
}

/**
 * Azure / GCP: paste Deploy PEM on the cloud connection → derive pub → inject on VM → SSH after create.
 * (AWS keeps its own manage_key_pair path below — do not route AWS through this.)
 */
function applyDeployPemForAzureOrGcp(
  workDir: string,
  secrets: Record<string, string | undefined>,
  tfvarsExtra: string[],
  username: string,
  existingPub?: string
): CloudContext["sshAccess"] | undefined {
  const deployPem = deployPemFromSecrets(secrets);
  if (!deployPem) return undefined;
  const pubFromPem = writePublicKeyFromPem(workDir, deployPem);
  if (pubFromPem) setSshPublicKeyTfvar(tfvarsExtra, pubFromPem);
  return {
    username,
    privateKey: deployPem,
    privateKeyPath: path.join(workDir, "deploy.pem"),
    publicKey: existingPub || pubFromPem,
  };
}

const cloudInitPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../infra/terraform/cloud-init-docker.sh"
);

export function readDockerCloudInit(): string {
  if (!fs.existsSync(cloudInitPath)) {
    return `#!/bin/bash
set -eux
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y docker.io
systemctl enable --now docker || true
usermod -aG docker shipdeck 2>/dev/null || true
usermod -aG docker ubuntu 2>/dev/null || true
echo SHIPDECK_DOCKER_READY > /var/log/shipdeck-docker-ready
`;
  }
  return fs.readFileSync(cloudInitPath, "utf8");
}

/** Write cloud-init script into TF work dir and return path for tfvars. */
export function writeCloudInitFile(workDir: string): string {
  const dest = path.join(workDir, "cloud-init-docker.sh");
  fs.writeFileSync(dest, readDockerCloudInit(), { mode: 0o755 });
  return dest.replace(/\\/g, "/");
}

export interface CloudContext {
  env: NodeJS.ProcessEnv;
  tfvarsExtra: string[];
  projectId?: string;
  sshAccess?: {
    username: string;
    privateKey?: string;
    privateKeyPath?: string;
    publicKey?: string;
  };
}

/** Build env + tfvars extras from a cloud connection for Terraform. */
export function resolveCloudContext(
  connectionId: string | undefined,
  workDir: string
): CloudContext {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const tfvarsExtra: string[] = [];
  const cloudInit = writeCloudInitFile(workDir);
  tfvarsExtra.push(`cloud_init_path = "${cloudInit}"`);

  if (!connectionId) return { env, tfvarsExtra };

  const conn = getConnection(connectionId);
  const secrets = getSecrets(connectionId);
  if (!conn) return { env, tfvarsExtra };

  const pub = secrets.sshPublicKey || conn.config.sshPublicKey;
  const priv = secrets.sshPrivateKey || secrets.privateKey;
  const privPath = secrets.privateKeyPath || conn.config.privateKeyPath;

  let sshAccess: CloudContext["sshAccess"] | undefined;
  if (pub) {
    const keyPath = path.join(workDir, "shipdeck_id_rsa.pub");
    fs.writeFileSync(keyPath, pub.endsWith("\n") ? pub : `${pub}\n`);
    tfvarsExtra.push(`ssh_public_key = "${keyPath.replace(/\\/g, "/")}"`);
  }
  if (priv || privPath) {
    sshAccess = {
      username: "shipdeck",
      privateKey: priv,
      privateKeyPath: privPath,
      publicKey: pub,
    };
  }

  if (conn.type === "azure") {
    if (secrets.clientId || secrets.ARM_CLIENT_ID) {
      env.ARM_CLIENT_ID = secrets.clientId || secrets.ARM_CLIENT_ID;
    }
    if (secrets.clientSecret || secrets.ARM_CLIENT_SECRET) {
      env.ARM_CLIENT_SECRET = secrets.clientSecret || secrets.ARM_CLIENT_SECRET;
    }
    if (secrets.tenantId || secrets.ARM_TENANT_ID || conn.config.tenantId) {
      env.ARM_TENANT_ID = secrets.tenantId || secrets.ARM_TENANT_ID || conn.config.tenantId;
    }
    if (secrets.subscriptionId || secrets.ARM_SUBSCRIPTION_ID || conn.config.subscriptionId) {
      env.ARM_SUBSCRIPTION_ID =
        secrets.subscriptionId || secrets.ARM_SUBSCRIPTION_ID || conn.config.subscriptionId;
    }
    const azureUser = conn.config.admin_username || conn.config.sshUser || "shipdeck";
    const fromPem = applyDeployPemForAzureOrGcp(
      workDir,
      secrets,
      tfvarsExtra,
      azureUser,
      pub
    );
    if (fromPem) {
      sshAccess = fromPem;
    } else if (sshAccess) {
      sshAccess.username = azureUser;
    }
  }

  if (conn.type === "aws") {
    if (secrets.accessKeyId || secrets.AWS_ACCESS_KEY_ID) {
      env.AWS_ACCESS_KEY_ID = secrets.accessKeyId || secrets.AWS_ACCESS_KEY_ID;
    }
    if (secrets.secretAccessKey || secrets.AWS_SECRET_ACCESS_KEY) {
      env.AWS_SECRET_ACCESS_KEY = secrets.secretAccessKey || secrets.AWS_SECRET_ACCESS_KEY;
    }
    if (conn.config.region) env.AWS_DEFAULT_REGION = conn.config.region;
    const keyName = conn.config.key_name || conn.config.keyName || secrets.key_name;
    if (keyName) tfvarsExtra.push(`key_name = "${keyName}"`);
    // Deploy PEM may live on the cloud connection (enterprise: no pre-existing SSH VM needed).
    const deployPem =
      secrets.sshPrivateKey ||
      secrets.privateKey ||
      (secrets.deployKey && /BEGIN[-\s].*PRIVATE KEY/i.test(secrets.deployKey) ? secrets.deployKey : undefined);
    // Prefer importing the key into the target region from Deploy PEM (avoids InvalidKeyPair.NotFound).
    let pubFromPem: string | undefined;
    if (deployPem) {
      pubFromPem = writePublicKeyFromPem(workDir, deployPem);
      if (pubFromPem) {
        for (let i = tfvarsExtra.length - 1; i >= 0; i--) {
          if (tfvarsExtra[i].startsWith("ssh_public_key")) tfvarsExtra.splice(i, 1);
        }
        tfvarsExtra.push(`ssh_public_key = "${pubFromPem}"`);
        tfvarsExtra.push(`manage_key_pair = true`);
      }
    } else if (tfvarsExtra.some((l) => l.startsWith("ssh_public_key"))) {
      tfvarsExtra.push(`manage_key_pair = true`);
    }
    if (deployPem || privPath) {
      sshAccess = {
        username: conn.config.sshUser || conn.config.admin_username || "ubuntu",
        privateKey: deployPem || priv,
        privateKeyPath: privPath || (deployPem ? path.join(workDir, "deploy.pem") : undefined),
        publicKey: pub || pubFromPem,
      };
    } else if (sshAccess) {
      sshAccess.username = conn.config.sshUser || "ubuntu";
    }
  }

  if (conn.type === "gcp") {
    const projectId = conn.config.project_id || conn.config.projectId || secrets.project_id;
    if (projectId) {
      tfvarsExtra.push(`project_id = "${projectId}"`);
      env.GOOGLE_CLOUD_PROJECT = projectId;
    }
    const creds = secrets.credentialsJson || secrets.GOOGLE_CREDENTIALS;
    if (creds) {
      const credPath = path.join(workDir, "gcp-credentials.json");
      fs.writeFileSync(credPath, creds);
      env.GOOGLE_APPLICATION_CREDENTIALS = credPath;
    }
    // Must match metadata ssh-keys user in vm-gcp (shipdeck:…)
    const gcpUser = conn.config.sshUser || "shipdeck";
    const fromPem = applyDeployPemForAzureOrGcp(
      workDir,
      secrets,
      tfvarsExtra,
      gcpUser,
      pub
    );
    if (fromPem) {
      sshAccess = fromPem;
    } else if (sshAccess) {
      sshAccess.username = gcpUser;
    }
    return { env, tfvarsExtra, projectId, sshAccess };
  }

  return { env, tfvarsExtra, sshAccess };
}

/** Prefer explicit SSH connection; fall back to cloud-connection keys + new VM IP. */
export function resolveProvisionedSshTarget(opts: {
  host: string;
  sshConnectionId?: string;
  cloudSsh?: CloudContext["sshAccess"];
}): SshTarget | null {
  if (opts.sshConnectionId) {
    const linked = resolveSshTarget(opts.sshConnectionId);
    if (linked) {
      return { ...linked, host: opts.host || linked.host };
    }
  }
  if (!opts.cloudSsh?.privateKey && !opts.cloudSsh?.privateKeyPath) return null;
  return {
    host: opts.host,
    port: 22,
    username: opts.cloudSsh.username || "shipdeck",
    privateKey: opts.cloudSsh.privateKey,
    privateKeyPath: opts.cloudSsh.privateKeyPath,
  };
}
