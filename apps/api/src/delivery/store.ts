import fs from "node:fs";
import path from "node:path";
import type { DeliveryPolicyPublic, DeliveryPolicySecrets, DeliveryRun } from "@shipdeck/shared";
import { defaultDeliveryPolicy, normalizeDeliveryPolicy } from "@shipdeck/shared";
import { decryptJson, encryptJson } from "../lib/crypto.js";

interface DeliveryFile {
  policy: DeliveryPolicyPublic;
  runs: DeliveryRun[];
  webhookIds: string[];
  webhookRuns?: Record<string, string>;
  version: 1;
}

interface DeliverySecretsBlob extends DeliveryPolicySecrets {
  existingTargets?: Record<string, Record<string, string>>;
}

const WEBHOOK_MEMORY = 5000;

export class DeliveryStore {
  private policy: DeliveryPolicyPublic;
  private runs = new Map<string, DeliveryRun>();
  private secrets: DeliveryPolicySecrets = {};
  private targetSecrets: Record<string, Record<string, string>> = {};
  private webhookIds: string[] = [];
  private webhookRuns: Record<string, string> = {};

  constructor(private readonly root: string) {
    this.policy = defaultDeliveryPolicy();
    this.load();
  }

  getRoot(): string {
    return this.root;
  }

  getPolicy(): DeliveryPolicyPublic {
    return structuredClone(this.policy);
  }

  getSecrets(): DeliveryPolicySecrets {
    return { ...this.secrets };
  }

  listRuns(): DeliveryRun[] {
    return [...this.runs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getRun(id: string): DeliveryRun | undefined {
    const run = this.runs.get(id);
    return run ? structuredClone(run) : undefined;
  }

  findActiveByTicket(key: string): DeliveryRun | undefined {
    const normalized = key.trim().toUpperCase();
    for (const run of this.runs.values()) {
      if (run.ticket.key.toUpperCase() !== normalized) continue;
      if (run.status === "completed" || run.status === "rejected" || run.status === "killed" || run.status === "failed") {
        continue;
      }
      return structuredClone(run);
    }
    return undefined;
  }

  rememberWebhook(id: string, runId: string): boolean {
    if (this.webhookRuns[id]) return false;
    this.webhookRuns[id] = runId;
    this.webhookIds.push(id);
    while (this.webhookIds.length > WEBHOOK_MEMORY) {
      const dropped = this.webhookIds.shift();
      if (dropped) delete this.webhookRuns[dropped];
    }
    this.save();
    return true;
  }

  runIdForWebhook(id: string): string | undefined {
    return this.webhookRuns[id];
  }

  savePolicy(policy: DeliveryPolicyPublic): DeliveryPolicyPublic {
    this.policy = structuredClone(policy);
    this.save();
    return this.getPolicy();
  }

  saveSecrets(next: DeliveryPolicySecrets): void {
    this.secrets = { ...next };
    this.save();
  }

  saveExistingTargetSecrets(runId: string, secrets: Record<string, string>): void {
    const clean = Object.fromEntries(Object.entries(secrets).filter(([, value]) => value.trim()));
    if (Object.keys(clean).length) this.targetSecrets[runId] = clean;
    else delete this.targetSecrets[runId];
    this.save();
  }

  getExistingTargetSecrets(runId: string): Record<string, string> {
    return { ...(this.targetSecrets[runId] ?? {}) };
  }

  saveRun(run: DeliveryRun): DeliveryRun {
    const copy = structuredClone(run);
    copy.updatedAt = new Date().toISOString();
    this.runs.set(copy.id, copy);
    this.save();
    return structuredClone(copy);
  }

  private file(): string {
    return path.join(this.root, "delivery.json");
  }

  private secretsFile(): string {
    return path.join(this.root, "delivery-secrets.enc");
  }

  private load(): void {
    try {
      const file = this.file();
      if (fs.existsSync(file)) {
        const raw = JSON.parse(fs.readFileSync(file, "utf8")) as DeliveryFile;
        this.policy = normalizeDeliveryPolicy(raw.policy);
        this.runs.clear();
        for (const run of raw.runs ?? []) this.runs.set(run.id, run);
        this.webhookIds = Array.isArray(raw.webhookIds) ? raw.webhookIds.slice(-WEBHOOK_MEMORY) : [];
        this.webhookRuns = raw.webhookRuns && typeof raw.webhookRuns === "object" ? raw.webhookRuns : {};
      }
      const secretsPath = this.secretsFile();
      if (fs.existsSync(secretsPath)) {
        const blob = fs.readFileSync(secretsPath, "utf8").trim();
        if (blob) {
          const parsed = decryptJson(blob) as DeliverySecretsBlob;
          const { existingTargets, ...policySecrets } = parsed;
          this.secrets = policySecrets;
          this.targetSecrets = existingTargets && typeof existingTargets === "object" ? existingTargets : {};
        }
      }
    } catch (err) {
      console.warn("[delivery] load failed:", err);
    }
    this.policy = normalizeDeliveryPolicy(this.policy);
    const planKey = Boolean(this.secrets.planApiKey || this.secrets.modelApiKey);
    const sameModel = this.policy.planModel.provider === this.policy.codeModel.provider;
    const codeKey = Boolean(this.secrets.codeApiKey || (sameModel && planKey));
    this.policy.planModel.hasApiKey = planKey;
    this.policy.codeModel.hasApiKey = codeKey;
    this.policy.model.hasApiKey = planKey;
    this.policy.jira.hasToken = Boolean(this.secrets.jiraToken);
    this.policy.jira.webhookSecretSet = Boolean(this.secrets.webhookSecret);
    this.policy.git.hasToken = Boolean(this.secrets.gitToken);
  }

  private save(): void {
    fs.mkdirSync(this.root, { recursive: true });
    this.policy = normalizeDeliveryPolicy(this.policy);
    const planKey = Boolean(this.secrets.planApiKey || this.secrets.modelApiKey);
    const sameModel = this.policy.planModel.provider === this.policy.codeModel.provider;
    const codeKey = Boolean(this.secrets.codeApiKey || (sameModel && planKey));
    this.policy.planModel.hasApiKey = planKey;
    this.policy.codeModel.hasApiKey = codeKey;
    this.policy.model.hasApiKey = planKey;
    this.policy.jira.hasToken = Boolean(this.secrets.jiraToken);
    this.policy.jira.webhookSecretSet = Boolean(this.secrets.webhookSecret);
    this.policy.git.hasToken = Boolean(this.secrets.gitToken);
    this.policy.identity = "local";
    const body: DeliveryFile = {
      version: 1,
      policy: this.policy,
      runs: [...this.runs.values()],
      webhookIds: this.webhookIds,
      webhookRuns: this.webhookRuns,
    };
    fs.writeFileSync(this.file(), JSON.stringify(body, null, 2), "utf8");
    const secrets: DeliverySecretsBlob = {};
    if (this.secrets.modelApiKey) secrets.modelApiKey = this.secrets.modelApiKey;
    if (this.secrets.planApiKey) secrets.planApiKey = this.secrets.planApiKey;
    if (this.secrets.codeApiKey) secrets.codeApiKey = this.secrets.codeApiKey;
    if (this.secrets.jiraToken) secrets.jiraToken = this.secrets.jiraToken;
    if (this.secrets.webhookSecret) secrets.webhookSecret = this.secrets.webhookSecret;
    if (this.secrets.gitToken) secrets.gitToken = this.secrets.gitToken;
    if (Object.keys(this.targetSecrets).length) secrets.existingTargets = this.targetSecrets;
    if (Object.keys(secrets).length) {
      fs.writeFileSync(this.secretsFile(), encryptJson(secrets), "utf8");
    } else if (fs.existsSync(this.secretsFile())) {
      fs.unlinkSync(this.secretsFile());
    }
  }
}
