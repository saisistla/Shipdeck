/** Agentic build path: Jira intake → architecture → code review → tests → Shipdeck deploy. */

export type DeliveryMode = "simulate" | "live";

export type DeliveryChangeKind = "new_app" | "existing_repo";

export type DeliveryExistingKind = "ssh" | "aws" | "azure" | "gcp";

/** Public deploy target for an existing app. Secrets stay on the server. */
export interface DeliveryExistingTarget {
  kind: DeliveryExistingKind;
  host?: string;
  port?: string;
  user?: string;
  region?: string;
  projectId?: string;
  subscriptionId?: string;
  tenantId?: string;
  serviceName?: string;
  serviceUrl?: string;
  hasAuth: boolean;
}

export interface DeliveryExistingTargetInput extends Omit<DeliveryExistingTarget, "hasAuth"> {
  password?: string;
  privateKey?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  credentialsJson?: string;
  clientId?: string;
  clientSecret?: string;
}

export interface DeliveryCreatedConnection {
  id: string;
  name: string;
  type: string;
  created: boolean;
}

export type DeliveryStatus =
  | "architecture_review"
  | "writing_code"
  | "code_review"
  | "deploy_approval"
  | "completed"
  | "rejected"
  | "killed"
  | "failed";

export type DeliveryGate = "architecture" | "code_review" | "deploy";

export type DeliveryDecisionAction = "approve" | "reject" | "skip";

export type { ModelProvider } from "./modelProviders.js";
import type { ModelProvider } from "./modelProviders.js";

export type JiraDeployment = "cloud" | "datacenter";

export type GitHost = "github" | "gitlab" | "azure-devops";

export type SandboxKind = "docker-local" | "dedicated-runner";

export type DeliveryTestCheck = "lint" | "unit" | "integration";

export const DELIVERY_TEST_BAR: DeliveryTestCheck[] = ["lint", "unit", "integration"];

export const DELIVERY_TERMINAL: DeliveryStatus[] = ["completed", "rejected", "killed", "failed"];

export function deliveryRunActive(status: DeliveryStatus): boolean {
  return !DELIVERY_TERMINAL.includes(status);
}

export type DeliveryAttachmentKind = "image" | "text" | "document" | "file";

export interface DeliveryTicketAttachment {
  filename: string;
  mimeType?: string;
  size?: number;
  id?: string;
  kind?: DeliveryAttachmentKind;
  storedName?: string;
  textExcerpt?: string;
  /** True only after judgment: this file helps the current ticket. */
  relevant?: boolean;
  relevanceReason?: string;
  contentSummary?: string;
}

export interface DeliveryTicket {
  key: string;
  summary: string;
  description: string;
  acceptance: string[];
  comments: string[];
  /** Comments that matter to this change. Empty means none were kept. */
  relevantComments?: string[];
  attachments: DeliveryTicketAttachment[];
}

export interface ModelSlot {
  provider: ModelProvider;
  endpoint: string;
  region: string;
  deploymentName: string;
  hasApiKey: boolean;
}

export interface DeliveryPolicyPublic {
  identity: "local";
  /** @deprecated Use planModel. Kept so older policy files still load. */
  model: ModelSlot;
  planModel: ModelSlot;
  codeModel: ModelSlot;
  /** Saved Connections → Build entries. Secrets stay on the connection. */
  jiraConnectionId?: string;
  planModelConnectionId?: string;
  codeModelConnectionId?: string;
  gitConnectionId?: string;
  jira: {
    deployment: JiraDeployment;
    siteUrl: string;
    projectKeys: string[];
    updateStatus: boolean;
    accountEmail: string;
    hasToken: boolean;
    webhookSecretSet: boolean;
  };
  git: {
    host: GitHost;
    botLogin: string;
    defaultBaseBranch: string;
    autoOpenPr: boolean;
    hasToken: boolean;
  };
  sandbox: SandboxKind;
  allowedLanguages: string[];
  allowedPackageSources: string[];
  allowedLicenses: string[];
  tokenCap: number;
  costCapUsd: number;
  rollbackOwner: string;
  architectureApprover: string;
  codeReviewer: string;
  deployApprover: string;
  devTargetLabel: string;
  /** Existing Shipdeck pipeline that live mode starts after deploy approval. */
  pipelineId: string;
  testBar: DeliveryTestCheck[];
}

export interface DeliveryPolicySecrets {
  modelApiKey?: string;
  planApiKey?: string;
  codeApiKey?: string;
  jiraToken?: string;
  webhookSecret?: string;
  gitToken?: string;
}

export interface DeliveryScope {
  inScope: string[];
  outOfScope: string[];
  ambiguities: string[];
  standardsApplied: string[];
}

export interface DeliveryComponent {
  name: string;
  responsibility: string;
  language: string;
}

export interface DeliveryArchitecture {
  markdown: string;
  /** Existing-repository tickets only. What the change will do, and where it lands. */
  impactAnalysis?: string;
  technologies: string[];
  components: DeliveryComponent[];
  assumptions: string[];
  revision: number;
}

export interface DeliveryEstimate {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  assumptions: string[];
}

export interface DeliveryUsage {
  tokens: number;
  costUsd: number;
  calls: number;
}

export interface DeliveryApproval {
  gate: DeliveryGate;
  action: DeliveryDecisionAction;
  actor: string;
  at: string;
  note?: string;
}

export interface DeliveryCheckResult {
  name: DeliveryTestCheck;
  status: "passed" | "failed" | "skipped";
  detail: string;
}

export interface DeliveryImplementation {
  workspace: string;
  branch: string;
  files: string[];
  secretsScan: { clean: boolean; findings: string[] };
  license: string;
  packageSources: string[];
  fixturesOnly: true;
  pullRequestUrl?: string;
  pullRequestDetail: string;
}

export interface DeliveryHandoff {
  mode: DeliveryMode;
  pipelineId: string | null;
  deployRunId: string | null;
  devTargetLabel: string;
  rollbackOwner: string;
  message: string;
  createdConnections?: DeliveryCreatedConnection[];
}

export interface DeliveryRun {
  id: string;
  /** Shipdeck project this ticket belongs to. Older runs may omit it. */
  projectId?: string;
  mode: DeliveryMode;
  changeKind: DeliveryChangeKind;
  repoUrl: string;
  existingTarget?: DeliveryExistingTarget;
  status: DeliveryStatus;
  ticket: DeliveryTicket;
  scope: DeliveryScope;
  architecture: DeliveryArchitecture;
  estimate: DeliveryEstimate;
  usage: DeliveryUsage;
  revisionNotes: string[];
  /** A workbench change waiting for approval. The current page stays until this is approved. */
  pendingRevision?: {
    note: string;
    scope: DeliveryScope;
    architecture: DeliveryArchitecture;
    estimate: DeliveryEstimate;
  };
  approvals: DeliveryApproval[];
  implementation?: DeliveryImplementation;
  checks: DeliveryCheckResult[];
  handoff?: DeliveryHandoff;
  blockedReason: "token_cap" | "cost_cap" | null;
  needsClarification: boolean;
  failureCode?: string;
  failureMessage?: string;
  killedBy?: string;
  rollbackOwner: string;
  logs: string[];
  /** Workbench conversation, including every added and removed line. Stays on the ticket. */
  workbenchChat?: WorkbenchChatEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface WorkbenchFileChange {
  path: string;
  added: string[];
  removed: string[];
}

export interface WorkbenchChatEntry {
  who: "you" | "shipdeck";
  text: string;
  at: string;
  files?: WorkbenchFileChange[];
}

export const SAMPLE_DELIVERY_TICKET: DeliveryTicket = {
  key: "SHIP-1042",
  summary: "Reserve stock when an order is placed",
  description:
    "Warehouse staff need a small app to reserve stock for an order and release it if the order is cancelled. " +
    "They should see whether a known SKU still has quantity left.",
  acceptance: [
    "Reserve stock for a known SKU",
    "Release a reservation and return that quantity",
    "Show the reservation status to the desk",
  ],
  comments: [],
  attachments: [],
};

function emptySlot(provider: ModelProvider): ModelSlot {
  return { provider, endpoint: "", region: "", deploymentName: "", hasApiKey: false };
}

export function planSlot(policy: DeliveryPolicyPublic): ModelSlot {
  return policy.planModel ?? policy.model;
}

export function codeSlot(policy: DeliveryPolicyPublic): ModelSlot {
  return policy.codeModel ?? policy.model;
}

export function normalizeDeliveryPolicy(policy: Partial<DeliveryPolicyPublic> | undefined): DeliveryPolicyPublic {
  const defaults = defaultDeliveryPolicy();
  const raw = policy ?? {};
  const merged = { ...defaults, ...raw };
  const planModel = { ...defaults.planModel, ...raw.model, ...raw.planModel };
  const codeModel = { ...defaults.codeModel, ...raw.codeModel };
  return {
    ...merged,
    identity: "local",
    planModel,
    codeModel,
    model: { ...planModel },
    jira: { ...defaults.jira, ...merged.jira },
    git: { ...defaults.git, ...merged.git },
  };
}

export function defaultDeliveryPolicy(): DeliveryPolicyPublic {
  const planModel = emptySlot("azure-openai");
  const codeModel = emptySlot("anthropic");
  return {
    identity: "local",
    model: { ...planModel },
    planModel,
    codeModel,
    jira: {
      deployment: "cloud",
      siteUrl: "",
      projectKeys: ["SHIP"],
      updateStatus: true,
      accountEmail: "",
      hasToken: false,
      webhookSecretSet: false,
    },
    git: {
      host: "github",
      botLogin: "",
      defaultBaseBranch: "main",
      autoOpenPr: false,
      hasToken: false,
    },
    jiraConnectionId: "",
    planModelConnectionId: "",
    codeModelConnectionId: "",
    gitConnectionId: "",
    sandbox: "docker-local",
    allowedLanguages: ["node", "python"],
    allowedPackageSources: ["https://registry.npmjs.org", "https://pypi.org"],
    allowedLicenses: ["MIT", "Apache-2.0", "BSD-3-Clause"],
    tokenCap: 200_000,
    costCapUsd: 25,
    rollbackOwner: "Platform on-call",
    architectureApprover: "Platform admin",
    codeReviewer: "Platform admin",
    deployApprover: "Platform admin",
    devTargetLabel: "dev",
    pipelineId: "",
    testBar: [...DELIVERY_TEST_BAR],
  };
}
