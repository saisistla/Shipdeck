import type {
  Connection,
  DeliveryExistingKind,
  DeliveryExistingTargetInput,
  DeliveryPolicyPublic,
  DeliveryPolicySecrets,
  GitHost,
  ModelProvider,
  ModelSlot,
} from "@shipdeck/shared";
import { isTargetConnectionType, modelProviderById, modelUsesOf } from "@shipdeck/shared";
import { store } from "../store.js";
import { delivery } from "./index.js";

function sameText(a?: string, b?: string): boolean {
  return (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
}

function hasValue(value?: string): boolean {
  return Boolean(value?.trim());
}

function slotFromModelConnection(conn: Connection): ModelSlot {
  const provider = (conn.config.provider || "private") as ModelProvider;
  const hint = modelProviderById(provider);
  return {
    provider,
    endpoint: conn.config.endpoint || hint.endpointHint,
    region: conn.config.region || "",
    deploymentName: conn.config.deploymentName || "",
    hasApiKey: Boolean(store.connectionSecrets.get(conn.id)?.apiKey),
  };
}

function applyJiraConnection(policy: DeliveryPolicyPublic, secrets: DeliveryPolicySecrets, conn: Connection) {
  const cfg = conn.config;
  policy.jiraConnectionId = conn.id;
  policy.jira = {
    ...policy.jira,
    deployment: cfg.deployment === "datacenter" ? "datacenter" : "cloud",
    siteUrl: cfg.siteUrl || policy.jira.siteUrl,
    projectKeys: cfg.projectKeys
      ? cfg.projectKeys
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      : policy.jira.projectKeys,
    accountEmail: cfg.accountEmail || policy.jira.accountEmail,
    updateStatus: cfg.updateStatus === "false" ? false : cfg.updateStatus === "true" ? true : policy.jira.updateStatus,
  };
  const connSecrets = store.connectionSecrets.get(conn.id) ?? {};
  if (connSecrets.token) secrets.jiraToken = connSecrets.token;
  if (connSecrets.webhookSecret) secrets.webhookSecret = connSecrets.webhookSecret;
}

function applyModelConnection(
  policy: DeliveryPolicyPublic,
  secrets: DeliveryPolicySecrets,
  conn: Connection,
  role: "plan" | "code"
) {
  const slot = slotFromModelConnection(conn);
  const apiKey = store.connectionSecrets.get(conn.id)?.apiKey;
  if (role === "plan") {
    policy.planModelConnectionId = conn.id;
    policy.planModel = slot;
    policy.model = { ...slot };
    if (apiKey) {
      secrets.planApiKey = apiKey;
      secrets.modelApiKey = apiKey;
    }
  } else {
    policy.codeModelConnectionId = conn.id;
    policy.codeModel = slot;
    if (apiKey) secrets.codeApiKey = apiKey;
  }
}

function applyGitConnection(policy: DeliveryPolicyPublic, secrets: DeliveryPolicySecrets, conn: Connection) {
  const host = (conn.config.gitHost || conn.config.host || policy.git.host) as GitHost;
  policy.gitConnectionId = conn.id;
  policy.git = {
    ...policy.git,
    host: host === "gitlab" || host === "azure-devops" ? host : "github",
    botLogin: conn.config.botLogin || policy.git.botLogin,
    defaultBaseBranch: conn.config.defaultBaseBranch || policy.git.defaultBaseBranch,
    autoOpenPr: conn.config.autoOpenPr === "true" ? true : conn.config.autoOpenPr === "false" ? false : policy.git.autoOpenPr,
  };
  const token = store.connectionSecrets.get(conn.id)?.token || store.connectionSecrets.get(conn.id)?.personalAccessToken;
  if (token) secrets.gitToken = token;
}

export function applyBuildConnection(conn: Connection): void {
  if (conn.type !== "jira" && conn.type !== "model" && conn.type !== "git") return;
  const policy = delivery.store.getPolicy();
  const secrets = delivery.store.getSecrets();
  if (conn.type === "jira") {
    if (policy.jiraConnectionId && policy.jiraConnectionId !== conn.id) return;
    applyJiraConnection(policy, secrets, conn);
  } else if (conn.type === "model") {
    const uses = modelUsesOf(conn.config.role);
    if (uses.includes("plan")) {
      if (!policy.planModelConnectionId || policy.planModelConnectionId === conn.id) {
        applyModelConnection(policy, secrets, conn, "plan");
      }
    }
    if (uses.includes("code")) {
      if (!policy.codeModelConnectionId || policy.codeModelConnectionId === conn.id) {
        applyModelConnection(policy, secrets, conn, "code");
      }
    }
  } else if (conn.type === "git") {
    if (policy.gitConnectionId && policy.gitConnectionId !== conn.id) return;
    applyGitConnection(policy, secrets, conn);
  }
  delivery.store.savePolicy(policy);
  delivery.store.saveSecrets(secrets);
}

export function applySelectedBuildConnections(ids: {
  jiraConnectionId?: string;
  planModelConnectionId?: string;
  codeModelConnectionId?: string;
  gitConnectionId?: string;
}): DeliveryPolicyPublic {
  const policy = delivery.store.getPolicy();
  const secrets = delivery.store.getSecrets();
  if (ids.jiraConnectionId !== undefined) policy.jiraConnectionId = ids.jiraConnectionId;
  if (ids.planModelConnectionId !== undefined) policy.planModelConnectionId = ids.planModelConnectionId;
  if (ids.codeModelConnectionId !== undefined) policy.codeModelConnectionId = ids.codeModelConnectionId;
  if (ids.gitConnectionId !== undefined) policy.gitConnectionId = ids.gitConnectionId;

  const jira = ids.jiraConnectionId ? store.connections.get(ids.jiraConnectionId) : undefined;
  if (jira?.type === "jira") applyJiraConnection(policy, secrets, jira);

  const plan = ids.planModelConnectionId ? store.connections.get(ids.planModelConnectionId) : undefined;
  if (plan?.type === "model") applyModelConnection(policy, secrets, plan, "plan");

  const code = ids.codeModelConnectionId ? store.connections.get(ids.codeModelConnectionId) : undefined;
  if (code?.type === "model") applyModelConnection(policy, secrets, code, "code");

  const git = ids.gitConnectionId ? store.connections.get(ids.gitConnectionId) : undefined;
  if (git?.type === "git") applyGitConnection(policy, secrets, git);

  delivery.store.savePolicy(policy);
  delivery.store.saveSecrets(secrets);
  return delivery.store.getPolicy();
}

function findExisting(type: Connection["type"], match: (conn: Connection) => boolean): Connection | undefined {
  return [...store.connections.values()].find((conn) => conn.type === type && match(conn));
}

function createIfMissing(input: {
  name: string;
  type: Connection["type"];
  config: Record<string, string>;
  secrets?: Record<string, string>;
}): Connection {
  const created = store.createConnection(input);
  return created;
}

/**
 * Represent already-saved Build policy credentials as Connections.
 * Never deletes or overwrites an existing connection's secrets.
 */
export function ensurePolicyConnections(): void {
  const policy = delivery.store.getPolicy();
  const secrets = delivery.store.getSecrets();
  let changed = false;

  const jiraReady = hasValue(policy.jira.siteUrl) || hasValue(secrets.jiraToken) || hasValue(policy.jira.accountEmail);
  if (jiraReady) {
    const current = policy.jiraConnectionId ? store.connections.get(policy.jiraConnectionId) : undefined;
    const found =
      current?.type === "jira"
        ? current
        : findExisting(
            "jira",
            (conn) => !policy.jira.siteUrl || sameText(conn.config.siteUrl, policy.jira.siteUrl)
          );
    if (found) {
      if (policy.jiraConnectionId !== found.id) {
        policy.jiraConnectionId = found.id;
        changed = true;
      }
      const existingSecrets = store.connectionSecrets.get(found.id) ?? {};
      const add: Record<string, string> = {};
      if (!existingSecrets.token && secrets.jiraToken) add.token = secrets.jiraToken;
      if (!existingSecrets.webhookSecret && secrets.webhookSecret) add.webhookSecret = secrets.webhookSecret;
      if (Object.keys(add).length) store.updateConnection(found.id, { secrets: add });
    } else {
      const created = createIfMissing({
        name: policy.jira.siteUrl ? `Jira ${policy.jira.siteUrl.replace(/^https?:\/\//, "").split("/")[0]}` : "Jira",
        type: "jira",
        config: {
          deployment: policy.jira.deployment,
          siteUrl: policy.jira.siteUrl,
          projectKeys: policy.jira.projectKeys.join(", "),
          accountEmail: policy.jira.accountEmail,
          updateStatus: policy.jira.updateStatus ? "true" : "false",
        },
        secrets: {
          ...(secrets.jiraToken ? { token: secrets.jiraToken } : {}),
          ...(secrets.webhookSecret ? { webhookSecret: secrets.webhookSecret } : {}),
        },
      });
      policy.jiraConnectionId = created.id;
      changed = true;
    }
  }

  const ensureModel = (role: "plan" | "code", slot: ModelSlot, key: string | undefined, idKey: "planModelConnectionId" | "codeModelConnectionId") => {
    const ready = hasValue(slot.endpoint) || hasValue(key) || slot.hasApiKey;
    if (!ready) return;
    const current = policy[idKey] ? store.connections.get(policy[idKey]!) : undefined;
    const found =
      current?.type === "model"
        ? current
        : findExisting(
            "model",
            (conn) =>
              sameText(conn.config.provider, slot.provider) &&
              (!slot.endpoint || sameText(conn.config.endpoint, slot.endpoint)) &&
              modelUsesOf(conn.config.role).includes(role)
          );
    if (found) {
      if (policy[idKey] !== found.id) {
        policy[idKey] = found.id;
        changed = true;
      }
      const existingSecrets = store.connectionSecrets.get(found.id) ?? {};
      if (!existingSecrets.apiKey && key) store.updateConnection(found.id, { secrets: { apiKey: key } });
      return;
    }
    const created = createIfMissing({
      name: `${role === "plan" ? "Plan" : "Code"} · ${modelProviderById(slot.provider).label}`,
      type: "model",
      config: {
        provider: slot.provider,
        role,
        endpoint: slot.endpoint,
        region: slot.region,
        deploymentName: slot.deploymentName,
      },
      secrets: key ? { apiKey: key } : undefined,
    });
    policy[idKey] = created.id;
    changed = true;
  };

  ensureModel("plan", policy.planModel ?? policy.model, secrets.planApiKey || secrets.modelApiKey, "planModelConnectionId");
  ensureModel("code", policy.codeModel ?? policy.model, secrets.codeApiKey, "codeModelConnectionId");

  const gitReady = hasValue(secrets.gitToken) || hasValue(policy.git.botLogin);
  if (gitReady) {
    const current = policy.gitConnectionId ? store.connections.get(policy.gitConnectionId) : undefined;
    const found =
      current?.type === "git"
        ? current
        : findExisting(
            "git",
            (conn) =>
              conn.config.mode !== "local" &&
              (sameText(conn.config.gitHost, policy.git.host) || sameText(conn.config.botLogin, policy.git.botLogin))
          );
    if (found) {
      if (policy.gitConnectionId !== found.id) {
        policy.gitConnectionId = found.id;
        changed = true;
      }
      const existingSecrets = store.connectionSecrets.get(found.id) ?? {};
      if (!existingSecrets.token && secrets.gitToken) store.updateConnection(found.id, { secrets: { token: secrets.gitToken } });
    } else {
      const created = createIfMissing({
        name: `${policy.git.host === "gitlab" ? "GitLab" : policy.git.host === "azure-devops" ? "Azure DevOps" : "GitHub"}`,
        type: "git",
        config: {
          gitHost: policy.git.host,
          botLogin: policy.git.botLogin,
          defaultBaseBranch: policy.git.defaultBaseBranch,
          autoOpenPr: policy.git.autoOpenPr ? "true" : "false",
        },
        secrets: secrets.gitToken ? { token: secrets.gitToken } : undefined,
      });
      policy.gitConnectionId = created.id;
      changed = true;
    }
  }

  if (changed) delivery.store.savePolicy(policy);
}

export function existingTargetFromConnection(
  connectionId: string,
  override: { serviceUrl?: string } = {}
): DeliveryExistingTargetInput {
  const conn = store.connections.get(connectionId);
  if (!conn || !isTargetConnectionType(conn.type)) {
    throw new Error("Pick an SSH, AWS, Azure, or GCP connection from Connections → Deploy");
  }
  const secrets = store.connectionSecrets.get(conn.id) ?? {};
  const kind = conn.type as DeliveryExistingKind;
  const serviceUrl = override.serviceUrl?.trim() || conn.config.serviceUrl || "";
  if (kind === "ssh") {
    return {
      kind: "ssh",
      host: conn.config.host,
      port: conn.config.port || "22",
      user: conn.config.user || "ubuntu",
      password: secrets.password,
      privateKey: secrets.privateKey,
    };
  }
  if (kind === "aws") {
    return {
      kind: "aws",
      region: conn.config.region || conn.config.location,
      serviceName: conn.config.serviceName,
      serviceUrl,
      accessKeyId: secrets.accessKeyId,
      secretAccessKey: secrets.secretAccessKey,
    };
  }
  if (kind === "azure") {
    return {
      kind: "azure",
      subscriptionId: conn.config.subscriptionId,
      tenantId: conn.config.tenantId,
      serviceName: conn.config.serviceName,
      serviceUrl,
      clientId: secrets.clientId,
      clientSecret: secrets.clientSecret,
    };
  }
  return {
    kind: "gcp",
    projectId: conn.config.project_id || conn.config.projectId,
    serviceName: conn.config.serviceName,
    serviceUrl,
    credentialsJson: secrets.credentialsJson || secrets.GOOGLE_CREDENTIALS,
  };
}

export function resolveDeliverySecrets(): DeliveryPolicySecrets {
  const secrets: DeliveryPolicySecrets = { ...delivery.store.getSecrets() };
  const policy = delivery.store.getPolicy();
  const jira = policy.jiraConnectionId ? store.connections.get(policy.jiraConnectionId) : undefined;
  if (jira?.type === "jira") {
    const connSecrets = store.connectionSecrets.get(jira.id) ?? {};
    if (!secrets.jiraToken && connSecrets.token) secrets.jiraToken = connSecrets.token;
    if (!secrets.webhookSecret && connSecrets.webhookSecret) secrets.webhookSecret = connSecrets.webhookSecret;
  }
  const plan = policy.planModelConnectionId ? store.connections.get(policy.planModelConnectionId) : undefined;
  if (plan?.type === "model") {
    const apiKey = store.connectionSecrets.get(plan.id)?.apiKey;
    if (apiKey && !secrets.planApiKey) {
      secrets.planApiKey = apiKey;
      secrets.modelApiKey = secrets.modelApiKey || apiKey;
    }
  }
  const code = policy.codeModelConnectionId ? store.connections.get(policy.codeModelConnectionId) : undefined;
  if (code?.type === "model") {
    const apiKey = store.connectionSecrets.get(code.id)?.apiKey;
    if (apiKey && !secrets.codeApiKey) secrets.codeApiKey = apiKey;
  }
  const git = policy.gitConnectionId ? store.connections.get(policy.gitConnectionId) : undefined;
  if (git?.type === "git") {
    const token = store.connectionSecrets.get(git.id)?.token || store.connectionSecrets.get(git.id)?.personalAccessToken;
    if (token && !secrets.gitToken) secrets.gitToken = token;
  }
  return secrets;
}

export function modelRoleFor(conn: Connection): "plan" | "code" | "both" {
  const uses = modelUsesOf(conn.config.role);
  const plan = uses.includes("plan");
  const code = uses.includes("code");
  if (plan && code) return "both";
  if (code) return "code";
  if (plan) return "plan";
  return "both";
}
