export interface RunOutputs {
  sourcePath?: string;
  branch?: string;
  imageTag?: string;
  previousImageTag?: string;
  containerName?: string;
  previousContainerName?: string;
  deployHost?: string;
  deployUrl?: string;
  /** Serverless HTTPS endpoint (Lambda URL / Functions / Cloud Functions / ECS Express web) */
  serviceUrl?: string;
  /** Serverless app API base URL (ECS Express / Container Apps / Cloud Run) */
  apiUrl?: string;
  publicIp?: string;
  /** vm (default) or serverless — set by Infra create */
  computeMode?: "vm" | "serverless";
  /** function (Lambda health) or app (managed containers + UI) */
  serverlessKind?: "function" | "app";
  databaseUrl?: string;
  registryImage?: string;
  /** Release tag this ship will push, for example v1.1.0 */
  releaseTag?: string;
  kubeconfig?: string;
  kubeconfigPath?: string;
  /** In-memory only for this run — SSH to a just-created VM */
  sshUser?: string;
  sshPrivateKey?: string;
  sshPrivateKeyPath?: string;
  sshPort?: string;
  /** Terraform workspace for this run (create mode) — used for failure rollback */
  tfWorkDir?: string;
  cloudConnectionId?: string;
  /** True after terraform apply created cloud resources this run */
  infraProvisioned?: boolean;
  /** Auto-saved SSH connection for the new IP — deleted on rollback */
  sshConnectionIdCreated?: string;
}

const contexts = new Map<string, RunOutputs>();

export function getRunOutputs(runId: string): RunOutputs {
  let ctx = contexts.get(runId);
  if (!ctx) {
    ctx = {};
    contexts.set(runId, ctx);
  }
  return ctx;
}

export function clearRunOutputs(runId: string) {
  contexts.delete(runId);
}
