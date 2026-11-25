/**
 * One-shot: destroy Terraform workspace for an orphaned Create-VM run.
 * Usage: npx tsx src/scripts/destroyOrphanTf.ts <runId>
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { destroyProvisionedInfra } from "../lib/infraDestroy.js";
import { store } from "../store.js";

const runId = process.argv[2];
if (!runId) {
  console.error("Usage: npx tsx src/scripts/destroyOrphanTf.ts <runId>");
  process.exit(1);
}

store.loadFromJson();

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const workDir = path.join(repoRoot, ".shipdeck-work", runId, "tf");

const run = store.runs.get(runId);
const pipeline = run ? store.pipelines.get(run.pipelineId) : undefined;
let cloudConnectionId = pipeline?.boxes?.infra?.cloudConnectionId;
if (!cloudConnectionId) {
  cloudConnectionId = [...store.connections.values()].find((c) => c.type === "aws")?.id;
}

const secrets = cloudConnectionId ? store.connectionSecrets.get(cloudConnectionId) ?? {} : {};
const hasAws =
  Boolean(secrets.accessKeyId || secrets.AWS_ACCESS_KEY_ID) &&
  Boolean(secrets.secretAccessKey || secrets.AWS_SECRET_ACCESS_KEY);
if (!hasAws) {
  console.error(
    "FAILED: AWS credentials not found on the cloud connection. Edit AWSCreds and re-save Access Key + Secret, then retry destroy."
  );
  process.exit(1);
}

console.log(`Using cloud connection ${cloudConnectionId} (credentials present, values not logged)`);

const sshConn = [...store.connections.values()].find(
  (c) =>
    c.type === "ssh" &&
    (c.name.includes("52.210.180.115") || c.config.host === "52.210.180.115")
);

const result = await destroyProvisionedInfra({
  workDir,
  cloudConnectionId,
  sshConnectionIdCreated: sshConn?.id,
  publicIp: "52.210.180.115",
  log: (line) => console.log(line),
});

console.log(result.ok ? "DONE" : "FAILED", result.message);
process.exit(result.ok ? 0 : 1);
