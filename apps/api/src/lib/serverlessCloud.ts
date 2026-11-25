import fs from "node:fs";
import path from "node:path";
import { getConnection, getSecrets } from "./connections.js";

/**
 * Cloud credentials for serverless Terraform only.
 * Does NOT inject Deploy PEM / cloud-init / SSH — VM path stays on resolveCloudContext.
 */
export function resolveServerlessCloudContext(
  connectionId: string | undefined,
  workDir: string
): { env: NodeJS.ProcessEnv; tfvarsExtra: string[]; projectId?: string } {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const tfvarsExtra: string[] = [];
  if (!connectionId) return { env, tfvarsExtra };

  const conn = getConnection(connectionId);
  const secrets = getSecrets(connectionId);
  if (!conn) return { env, tfvarsExtra };

  if (conn.type === "aws") {
    if (secrets.accessKeyId || secrets.AWS_ACCESS_KEY_ID) {
      env.AWS_ACCESS_KEY_ID = secrets.accessKeyId || secrets.AWS_ACCESS_KEY_ID;
    }
    if (secrets.secretAccessKey || secrets.AWS_SECRET_ACCESS_KEY) {
      env.AWS_SECRET_ACCESS_KEY = secrets.secretAccessKey || secrets.AWS_SECRET_ACCESS_KEY;
    }
    if (conn.config.region) env.AWS_DEFAULT_REGION = conn.config.region;
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
    return { env, tfvarsExtra, projectId };
  }

  return { env, tfvarsExtra };
}
