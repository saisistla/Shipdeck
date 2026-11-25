import type { VmSizeRecommendation } from "./vmSizing.js";
import type { ServerlessSizingRecommendation } from "./serverlessSizing.js";
import type { ServerlessKind } from "./serverlessKind.js";
export {
  recommendVmSize,
  vmSizeForProvider,
  approxRamGbForVmSize,
  type VmSizeRecommendation,
  type VmSizeTier,
  type VmSizingInput,
} from "./vmSizing.js";
export {
  recommendServerlessSize,
  type ServerlessSizingRecommendation,
  type ServerlessSizingInput,
} from "./serverlessSizing.js";
export {
  recommendServerlessAppSkus,
  recommendManagedDbSku,
  serverlessAppTfvarLines,
  type ServerlessAppSkus,
} from "./serverlessAppSkus.js";
export {
  AWS_ECS_EXPRESS_SIZES,
  AWS_APP_RUNNER_SIZES,
  AZURE_CONTAINER_APP_SIZES,
  GCP_CLOUD_RUN_SIZES,
  pickServerlessCompute,
  listServerlessComputeForCloud,
  type ServerlessComputeOption,
} from "./serverlessComputeCatalog.js";
export {
  suggestServerlessKind,
  composeHasShipperPath,
  type ServerlessKind,
} from "./serverlessKind.js";
export {
  describeServerlessUrl,
  parseServerlessUrl,
  sameServiceUrl,
  type ParsedServerlessUrl,
  type ParsedServerlessPlatform,
} from "./serverlessUrl.js";
export {
  listVmSizesForCloud,
  findVmSizeOption,
  AWS_VM_SIZES,
  AZURE_VM_SIZES,
  GCP_VM_SIZES,
  type VmSizeOption,
  type CloudProviderId,
} from "./vmCatalog.js";

export type PipelineBoxType =
  | "source"
  | "infra"
  | "build"
  | "deploy"
  | "data"
  | "verify"
  | "notify";

export {
  BUILD_CONNECTION_TYPES,
  DEPLOY_CONNECTION_TYPES,
  TARGET_CONNECTION_TYPES,
  connectionFolder,
  isTargetConnectionType,
  typesForFolder,
  type ConnectionFolder,
  type ConnectionType,
} from "./connections.js";
import type { ConnectionType } from "./connections.js";

export type RunStatus =
  | "queued"
  | "running"
  | "waiting_approval"
  | "succeeded"
  | "failed"
  | "cancelled";

export type StepStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "skipped"
  | "waiting_approval";

export type DeployRuntime = "docker" | "compose" | "systemd" | "kubernetes";

export type InfraMode = "existing" | "create" | "skip";

/** Create path: classic VM vs managed serverless HTTP compute */
export type InfraComputeMode = "vm" | "serverless";

export type ServerlessRuntime = "nodejs20" | "python312";

export interface Connection {
  id: string;
  name: string;
  type: ConnectionType;
  /** Non-secret config shown in UI */
  config: Record<string, string>;
  /** Secret fields are stored server-side only; UI sees hasSecrets */
  hasSecrets: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateConnectionInput {
  name: string;
  type: ConnectionType;
  config: Record<string, string>;
  secrets?: Record<string, string>;
}

/** Partial update; omit secrets or leave empty to keep existing secret values. */
export interface UpdateConnectionInput {
  name?: string;
  type?: ConnectionType;
  config?: Record<string, string>;
  secrets?: Record<string, string>;
}

export interface SourceBoxConfig {
  mode: "local" | "remote";
  localPath?: string;
  branch: string;
  gitConnectionId?: string;
}

export interface InfraBoxConfig {
  mode: InfraMode;
  /**
   * Only for mode=create. Default "vm" keeps classic Create VM behavior.
   * "serverless" = AWS Lambda / Azure Functions / GCP Cloud Functions (HTTP).
   */
  computeMode?: InfraComputeMode;
  sshConnectionId?: string;
  cloudConnectionId?: string;
  cloudProvider?: "azure" | "aws" | "gcp";
  region?: string;
  vmSize?: string;
  kubernetesConnectionId?: string;
  /** Serverless runtime (ignored for VM) */
  serverlessRuntime?: ServerlessRuntime;
  serverlessMemoryMb?: number;
  serverlessTimeoutSeconds?: number;
  /**
   * When computeMode=serverless:
   * - function = Lambda/Functions health JSON (default)
   * - app = managed containers + DB for real UI (e.g. /shipper)
   */
  serverlessKind?: ServerlessKind;
}

export interface BuildBoxConfig {
  runTests: boolean;
  dockerfilePath?: string;
  registryConnectionId?: string;
  imageName?: string;
  /** Docker tag pushed to the registry, for example v1.1.0 */
  imageVersion?: string;
  /** Next tag for each registry login. A login with no entry has not shipped yet and starts at v1.0.0. */
  imageVersions?: Record<string, string>;
  /** existing = repo tests as-is; generated = Shipdeck smoke specs from source; recommended = alias of generated */
  testChoice?: "existing" | "recommended" | "generated" | "skip";
  /** existing = repo Dockerfiles; generated = Dockerfile.shipdeck from source */
  dockerfileChoice?: "existing" | "generated";
}

/** Tag the selected registry login will push. A login that has never shipped starts at v1.0.0. */
export function imageVersionForRegistry(
  build: Pick<BuildBoxConfig, "imageVersion" | "imageVersions" | "registryConnectionId">,
  registryId?: string
): string {
  const id = (registryId ?? build.registryConnectionId ?? "").trim();
  const saved = id ? build.imageVersions?.[id]?.trim() : "";
  if (saved) return saved;
  if (!build.imageVersions && id && (build.registryConnectionId ?? "").trim() === id && build.imageVersion?.trim()) {
    return build.imageVersion.trim();
  }
  if (!id && build.imageVersion?.trim()) return build.imageVersion.trim();
  return "v1.0.0";
}

export interface DeployBoxConfig {
  runtime: DeployRuntime;
  port: number;
  domain?: string;
  healthPath: string;
  envVars: Record<string, string>;
  /** existing = repo compose file; generated = Shipdeck compose from source */
  composeChoice?: "existing" | "generated";
}

export interface DataBoxConfig {
  enabled: boolean;
  engine?: "postgres" | "mysql" | "redis" | "mongodb";
  /** docker = local/remote container; terraform = managed cloud DB module */
  provisionMode?: "docker" | "terraform";
  createWithTerraform: boolean;
  connectionStringEnv?: string;
  cloudConnectionId?: string;
}

export type UserRole = "admin" | "operator" | "viewer";

export interface PlatformUser {
  id: string;
  name: string;
  role: UserRole;
  tokenHint: string;
  createdAt: string;
}

export interface AuditEvent {
  id: string;
  at: string;
  actor?: string;
  action: string;
  detail?: string;
}

export interface StoredKeyRecord {
  id: string;
  connectionId: string;
  connectionName: string;
  connectionType: ConnectionType;
  secretName: string;
  label: string;
  source: "auto-generated" | "user-provided";
  createdAt: string;
  updatedAt: string;
  fingerprint: string;
  encrypted: string;
  masked: string;
  /** True when the connection exists but this secret has not been saved yet. */
  missing?: boolean;
}

export interface PlatformSettings {
  simulate: boolean;
  tfApply: boolean;
  requireApproval: boolean;
  requireApprovalForTf: boolean;
  authRequired: boolean;
  storage: "json" | "postgres";
}

export interface VerifyBoxConfig {
  healthUrl?: string;
  timeoutSeconds: number;
  autoRollback: boolean;
}

export interface NotifyBoxConfig {
  enabled: boolean;
  notifyConnectionId?: string;
}

export interface PipelineBoxes {
  source: SourceBoxConfig;
  infra: InfraBoxConfig;
  build: BuildBoxConfig;
  deploy: DeployBoxConfig;
  data: DataBoxConfig;
  verify: VerifyBoxConfig;
  notify: NotifyBoxConfig;
}

export interface Pipeline {
  id: string;
  name: string;
  projectId: string;
  boxes: PipelineBoxes;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  defaultPipelineId?: string;
  createdAt: string;
}

export interface RunStep {
  id: string;
  box: PipelineBoxType;
  name: string;
  status: StepStatus;
  logs: string[];
  startedAt?: string;
  finishedAt?: string;
  error?: string;
}

/** Cloud environment created by Infra → Create (survives after run finishes for tear-down). */
export type RunEnvironmentStatus = "active" | "destroying" | "destroyed" | "destroy_failed";

export interface RunEnvironment {
  provisioned: boolean;
  status: RunEnvironmentStatus;
  publicIp?: string;
  deployHost?: string;
  provider?: string;
  region?: string;
  cloudConnectionId?: string;
  /** Auto-saved SSH connection for the new VM (removed on tear-down) */
  sshConnectionId?: string;
  /** Local Terraform workspace path for this run */
  tfWorkDir?: string;
  destroyedAt?: string;
  destroyError?: string;
  computeMode?: InfraComputeMode;
  /** function = health JSON; app = managed container UI */
  serverlessKind?: ServerlessKind;
  /** Serverless HTTPS endpoint (function health or app web URL) */
  serviceUrl?: string;
}

export interface PipelineRun {
  id: string;
  pipelineId: string;
  projectId: string;
  status: RunStatus;
  steps: RunStep[];
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  detection?: StackDetection;
  /** Present when Infra Create provisioned cloud resources */
  environment?: RunEnvironment;
}

export interface ComposeServiceInfo {
  name: string;
  /** Host-side published ports from the compose file */
  ports: number[];
}

export interface ComposeDetection {
  file: string;
  services: ComposeServiceInfo[];
  suggestedPort: number;
  suggestedPrimaryService?: string;
}

export interface StackDetection {
  stack: string;
  confidence: number;
  suggestedRuntime: DeployRuntime;
  signals: string[];
  /** Present when a docker-compose / compose file was found and parsed */
  compose?: ComposeDetection;
  /** Suggested cloud VM size for Create infra */
  vmSizing?: VmSizeRecommendation;
  /** Suggested memory/timeout for serverless Create */
  serverlessSizing?: ServerlessSizingRecommendation;
}

/** Apply compose detection onto Deploy box settings (runtime + primary health port). */
export function applyComposeDetection(
  deploy: DeployBoxConfig,
  compose: ComposeDetection,
  opts?: { forceRuntime?: boolean }
): DeployBoxConfig {
  const force = opts?.forceRuntime ?? true;
  const next = { ...deploy };
  if (force && (deploy.runtime === "docker" || deploy.runtime === "compose")) {
    next.runtime = "compose";
  }
  if (compose.suggestedPort > 0 && !PRIVATE_HOST_PORTS.has(compose.suggestedPort)) {
    next.port = compose.suggestedPort;
  }
  return next;
}

/** Prefer API /v1/health when compose has an api service; else UI port with /. */
export function composeVerifyTarget(opts: {
  services?: { name: string; ports: number[] }[];
  suggestedPort?: number;
  suggestedPrimaryService?: string;
  fallbackPort: number;
  fallbackPath: string;
}): { port: number; path: string; primaryService: string; reason: string } {
  const services = opts.services ?? [];
  const api = services.find((s) => /^api$/i.test(s.name)) ?? services.find((s) => /(^|[-_])api([-_]|$)/i.test(s.name));
  const apiPort = api?.ports?.find((p) => p > 0 && p !== 5432 && p !== 6379);
  if (api && apiPort) {
    return {
      port: apiPort,
      path: "/v1/health",
      primaryService: api.name,
      reason: `compose api service ${api.name}:${apiPort}/v1/health`,
    };
  }
  const port =
    opts.suggestedPort && opts.suggestedPort !== 5432 && opts.suggestedPort !== 6379
      ? opts.suggestedPort
      : opts.fallbackPort;
  const primary = opts.suggestedPrimaryService || "app";
  const isWeb = /web|admin|ui|frontend|next/i.test(primary);
  const path =
    isWeb && (opts.fallbackPath === "/health" || opts.fallbackPath === "/healthz")
      ? "/"
      : opts.fallbackPath || "/";
  return {
    port,
    path,
    primaryService: primary,
    reason: `compose ${primary}:${port}${path}`,
  };
}

export function suggestedHealthUrl(opts: {
  host: string;
  port: number;
  healthPath: string;
  primaryService?: string;
}): string {
  const host = opts.host.replace(/^https?:\/\//, "").split("/")[0];
  const svc = (opts.primaryService || "").toLowerCase();
  const isWebUi = /web|admin|ui|frontend|next/.test(svc);
  let path = opts.healthPath || "/";
  if (isWebUi && (path === "/health" || path === "/healthz")) {
    path = "/";
  }
  if (!path.startsWith("/")) path = `/${path}`;
  if (path === "/") return `http://${host}:${opts.port}/`;
  return `http://${host}:${opts.port}${path}`;
}

/** Prefer a matching override; otherwise build from SSH host + Deploy port. */
export function resolveVerifyHealthUrl(opts: {
  override?: string;
  host?: string;
  port: number;
  healthPath: string;
  deployUrl?: string;
  primaryService?: string;
}): string {
  if (opts.override && !healthUrlLooksStale(opts.override, opts.port, opts.host)) {
    return opts.override;
  }
  if (opts.host) {
    return suggestedHealthUrl({
      host: opts.host,
      port: opts.port,
      healthPath: opts.healthPath,
      primaryService: opts.primaryService,
    });
  }
  if (opts.deployUrl && !healthUrlLooksStale(opts.deployUrl, opts.port)) {
    return opts.deployUrl;
  }
  return opts.override || opts.deployUrl || "";
}

export function healthUrlLooksStale(
  url: string | undefined,
  port: number,
  host?: string
): boolean {
  if (!url?.trim()) return true;
  try {
    const u = new URL(url);
    if (u.hostname === "127.0.0.1" || u.hostname === "localhost") return true;
    const urlPort = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
    if (urlPort !== port) return true;
    if (host && u.hostname !== host) return true;
  } catch {
    return true;
  }
  return false;
}

export function shouldAutofillHealthUrl(
  current: string | undefined,
  suggested: string,
  port: number,
  host?: string
): boolean {
  if (!current?.trim()) return true;
  if (current === suggested) return false;
  if (healthUrlLooksStale(current, port, host)) return true;
  try {
    const cur = new URL(current);
    const sug = new URL(suggested);
    const samePlace =
      cur.hostname === sug.hostname &&
      (cur.port || (cur.protocol === "https:" ? "443" : "80")) ===
        (sug.port || (sug.protocol === "https:" ? "443" : "80"));
    if (
      samePlace &&
      (cur.pathname === "/health" || cur.pathname === "/healthz") &&
      (sug.pathname === "/" || sug.pathname === "")
    ) {
      return true;
    }
  } catch {
    return true;
  }
  return false;
}

/** Ports that must not be opened to the public internet. */
export const PRIVATE_HOST_PORTS = new Set([
  22, 3306, 5432, 6379, 27017, 1433, 5984, 9200, 9300, 11211, 5672, 9092, 2181, 2375, 2376,
]);

export function splitPublishPorts(
  ports: number[],
  extraPublic: number[] = []
): { publicPorts: number[]; privatePorts: number[] } {
  const all = [...new Set([...ports, ...extraPublic].filter((p) => p > 0 && p < 65536))];
  return {
    publicPorts: all.filter((p) => !PRIVATE_HOST_PORTS.has(p)).sort((a, b) => a - b),
    privatePorts: all.filter((p) => PRIVATE_HOST_PORTS.has(p)).sort((a, b) => a - b),
  };
}

export const PIPELINE_BOX_ORDER: PipelineBoxType[] = [
  "source",
  "infra",
  "build",
  "data",
  "deploy",
  "verify",
  "notify",
];

export const BOX_LABELS: Record<PipelineBoxType, string> = {
  source: "Get code",
  infra: "Prepare host",
  build: "Package",
  data: "Database",
  deploy: "Go live",
  verify: "Health check",
  notify: "Alerts",
};

export {
  DELIVERY_TEST_BAR,
  DELIVERY_TERMINAL,
  SAMPLE_DELIVERY_TICKET,
  defaultDeliveryPolicy,
  deliveryRunActive,
  normalizeDeliveryPolicy,
  planSlot,
  codeSlot,
  type DeliveryApproval,
  type DeliveryArchitecture,
  type DeliveryChangeKind,
  type DeliveryCreatedConnection,
  type DeliveryExistingKind,
  type DeliveryExistingTarget,
  type DeliveryExistingTargetInput,
  type DeliveryCheckResult,
  type DeliveryComponent,
  type DeliveryDecisionAction,
  type DeliveryEstimate,
  type DeliveryGate,
  type DeliveryHandoff,
  type DeliveryImplementation,
  type DeliveryMode,
  type DeliveryPolicyPublic,
  type DeliveryPolicySecrets,
  type DeliveryRun,
  type WorkbenchChatEntry,
  type WorkbenchFileChange,
  type DeliveryScope,
  type DeliveryStatus,
  type DeliveryTestCheck,
  type DeliveryAttachmentKind,
  type DeliveryTicket,
  type DeliveryTicketAttachment,
  type DeliveryUsage,
  type GitHost,
  type JiraDeployment,
  type ModelProvider,
  type ModelSlot,
  type SandboxKind,
} from "./delivery.js";

export {
  INDUSTRY_CATALOG,
  industryById,
  type IndustryOffering,
  type BriefChatMessage,
  type BriefMode,
  type BriefStatus,
  type BriefUpload,
  type BusinessReport,
  type IdeaBrief,
  type CompetitorKind,
  type MarketCompetitor,
  type MarketDemand,
  type MarketForce,
  type MarketPestle,
  type MarketPoint,
  type MarketResearch,
  type MarketRisk,
  type MarketSegment,
  type MarketSizeBand,
} from "./brief.js";

export {
  EMPTY_SALES_SEARCH,
  SALES_NOTE,
  businessSummary,
  jiraRaised,
  salesBlocked,
  salesReady,
  normalizeSalesAccount,
  salesHintsFromReport,
  salesSearchFrom,
  salesSearchLines,
  type SalesAccount,
  type SalesFit,
  type SalesStatus,
  type SalesQueueItem,
  type SalesSearch,
  type SalesView,
} from "./sales.js";

export {
  MARKETING_PLATFORMS,
  readMarketingScenes,
  type MarketingKind,
  type MarketingLead,
  type MarketingPiece,
  type MarketingPlatform,
  type MarketingScene,
  type MarketingView,
} from "./marketing.js";

export {
  CODE_PROVIDER_IDS,
  DEFAULT_MODEL_JOBS,
  MODEL_JOB_OPTIONS,
  MODEL_JOBS,
  MODEL_USE_OPTIONS,
  MODEL_USES,
  modelUseLabel,
  modelUseOf,
  modelUsesOf,
  modelUsesToRole,
  providersForJobs,
  MODEL_PROVIDERS,
  MODEL_PROVIDER_IDS,
  PLAN_PROVIDER_IDS,
  PROVIDER_GROUPS,
  isFolderAgent,
  chatProtocolFor,
  codeImplementationKind,
  vendorContract,
  modelProviderById,
  providersFor,
  type ModelJob,
  type ModelUse,
} from "./modelProviders.js";

export function createDefaultBoxes(): PipelineBoxes {
  return {
    source: {
      mode: "local",
      localPath: "",
      branch: "main",
    },
    infra: {
      mode: "existing",
      computeMode: "vm",
      cloudProvider: "azure",
      region: "eastus",
      vmSize: "Standard_B2s",
      serverlessRuntime: "nodejs20",
      serverlessMemoryMb: 512,
      serverlessTimeoutSeconds: 30,
      serverlessKind: "function",
    },
    build: {
      runTests: true,
      dockerfilePath: "Dockerfile",
      imageName: "app",
      imageVersion: "v1.0.0",
    },
    deploy: {
      runtime: "docker",
      port: 8080,
      healthPath: "/health",
      envVars: {},
    },
    data: {
      enabled: false,
      createWithTerraform: false,
      provisionMode: "docker",
      connectionStringEnv: "DATABASE_URL",
    },
    verify: {
      timeoutSeconds: 60,
      autoRollback: true,
    },
    notify: {
      enabled: false,
    },
  };
}

