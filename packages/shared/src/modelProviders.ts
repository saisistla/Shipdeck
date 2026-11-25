/** Customer-selectable vendors. Plan = Jira/architecture chat. Code = implement after approval. */

export type ModelKind = "chat" | "agent";
export type ModelRole = "plan" | "code";

export const MODEL_USES = ["plan", "code", "sales", "image", "video", "all"] as const;

export type ModelUse = (typeof MODEL_USES)[number];

/** Jobs a single model login can cover. Image is separate because it needs its own address. */
export const MODEL_JOBS = ["plan", "code", "sales", "image", "video"] as const;

export type ModelJob = (typeof MODEL_JOBS)[number];

export const MODEL_JOB_OPTIONS: { id: ModelJob; label: string; hint: string }[] = [
  { id: "plan", label: "Plan", hint: "Read the ticket and write the architecture" },
  { id: "code", label: "Code", hint: "Implement after approval" },
  { id: "sales", label: "Sales", hint: "Find who to contact" },
  { id: "image", label: "Image", hint: "Draw pictures" },
  { id: "video", label: "Video", hint: "Write the film" },
];

/** A new login covers every chat job. Image stays off until a picture address is saved. */
export const DEFAULT_MODEL_JOBS: ModelJob[] = ["plan", "code", "sales", "video"];

export const MODEL_USE_OPTIONS: { id: ModelUse; label: string }[] = [
  { id: "plan", label: "Plan (read Jira / write architecture)" },
  { id: "code", label: "Code (implement after approval)" },
  { id: "sales", label: "Sales (who to contact)" },
  { id: "image", label: "Image (draw pictures)" },
  { id: "video", label: "Video (write the film)" },
  { id: "all", label: "All in one (plan, code, sales, image, and video)" },
];

const JOB_SHORT: Record<ModelJob, string> = {
  plan: "Plan",
  code: "Code",
  sales: "Sales",
  image: "Image",
  video: "Video",
};

function isModelJob(value: string): value is ModelJob {
  return (MODEL_JOBS as readonly string[]).includes(value);
}

/** Older connections saved "both" for plan and code. That now means all in one. */
export function modelUseOf(role?: string): ModelUse {
  if (role === "code" || role === "sales" || role === "image" || role === "video" || role === "all") return role;
  if (role === "both") return "all";
  return "plan";
}

/** Jobs this login actually covers. "all" and the older "both" cover every job. */
export function modelUsesOf(role?: string): ModelJob[] {
  const raw = (role || "").trim();
  if (!raw) return ["plan"];
  if (raw === "all" || raw === "both") return [...MODEL_JOBS];
  if (isModelJob(raw)) return [raw];
  const picked = raw.split(",").map((item) => item.trim()).filter(isModelJob);
  const unique = MODEL_JOBS.filter((item) => picked.includes(item));
  return unique.length ? unique : ["plan"];
}

export function modelUsesToRole(uses: readonly ModelJob[]): string {
  const unique = MODEL_JOBS.filter((item) => uses.includes(item));
  if (unique.length === MODEL_JOBS.length) return "all";
  if (unique.length === 1) return unique[0];
  return unique.join(",");
}

export function modelUseLabel(role?: string): string {
  const uses = modelUsesOf(role);
  if (!uses.length) return "Choose a job";
  if (uses.length === MODEL_JOBS.length) return "All jobs";
  if (uses.length === MODEL_JOBS.length - 1) {
    const missing = MODEL_JOBS.find((item) => !uses.includes(item));
    return `All except ${JOB_SHORT[missing ?? "image"].toLowerCase()}`;
  }
  return uses.map((item) => JOB_SHORT[item]).join(", ");
}

type Entry = {
  id: string;
  label: string;
  group: string;
  protocol: "azure" | "openai" | "anthropic" | "gemini" | "bedrock" | "cohere" | "watsonx" | "agent";
  kind: ModelKind;
  roles: ModelRole[];
  endpointHint: string;
  note?: string;
};

const CHAT: Array<Omit<Entry, "kind" | "roles">> = [
  { id: "azure-openai", label: "Azure OpenAI", group: "Cloud platforms", protocol: "azure", endpointHint: "https://RESOURCE.openai.azure.com/openai/deployments/DEPLOYMENT/chat/completions?api-version=2024-10-21" },
  { id: "amazon-bedrock", label: "Amazon Bedrock", group: "Cloud platforms", protocol: "bedrock", endpointHint: "https://bedrock-runtime.REGION.amazonaws.com/model/MODEL_ID/converse" },
  { id: "google-vertex", label: "Google Vertex AI", group: "Cloud platforms", protocol: "gemini", endpointHint: "https://REGION-aiplatform.googleapis.com/v1/projects/PROJECT/locations/REGION/publishers/google/models/MODEL:generateContent" },
  { id: "databricks", label: "Databricks Mosaic AI", group: "Cloud platforms", protocol: "openai", endpointHint: "https://WORKSPACE.cloud.databricks.com/serving-endpoints/MODEL/invocations" },
  { id: "snowflake", label: "Snowflake Cortex", group: "Cloud platforms", protocol: "openai", endpointHint: "https://ACCOUNT.snowflakecomputing.com/api/v2/cortex/inference:complete" },
  { id: "ibm-watsonx", label: "IBM watsonx", group: "Cloud platforms", protocol: "watsonx", endpointHint: "https://REGION.ml.cloud.ibm.com/ml/v1/text/chat?version=2024-05-01", note: "Region is the watsonx project id. The key must be a bearer token." },
  { id: "cloudflare", label: "Cloudflare Workers AI", group: "Cloud platforms", protocol: "openai", endpointHint: "https://api.cloudflare.com/client/v4/accounts/ACCOUNT_ID/ai/v1/chat/completions" },
  { id: "openai", label: "OpenAI", group: "Model APIs", protocol: "openai", endpointHint: "https://api.openai.com/v1/chat/completions" },
  { id: "anthropic", label: "Anthropic", group: "Model APIs", protocol: "anthropic", endpointHint: "https://api.anthropic.com/v1/messages" },
  { id: "google-gemini", label: "Google Gemini", group: "Model APIs", protocol: "gemini", endpointHint: "https://generativelanguage.googleapis.com/v1beta/models/MODEL:generateContent" },
  { id: "mistral", label: "Mistral", group: "Model APIs", protocol: "openai", endpointHint: "https://api.mistral.ai/v1/chat/completions" },
  { id: "cohere", label: "Cohere", group: "Model APIs", protocol: "cohere", endpointHint: "https://api.cohere.com/v2/chat" },
  { id: "xai", label: "xAI", group: "Model APIs", protocol: "openai", endpointHint: "https://api.x.ai/v1/chat/completions" },
  { id: "deepseek", label: "DeepSeek", group: "Model APIs", protocol: "openai", endpointHint: "https://api.deepseek.com/chat/completions" },
  { id: "ai21", label: "AI21", group: "Model APIs", protocol: "openai", endpointHint: "https://api.ai21.com/studio/v1/chat/completions" },
  { id: "meta-llama", label: "Meta Llama API", group: "Model APIs", protocol: "openai", endpointHint: "https://api.llama.com/v1/chat/completions" },
  { id: "writer", label: "Writer", group: "Model APIs", protocol: "openai", endpointHint: "https://api.writer.com/v1/chat" },
  { id: "moonshot", label: "Moonshot (Kimi)", group: "Model APIs", protocol: "openai", endpointHint: "https://api.moonshot.cn/v1/chat/completions" },
  { id: "zhipu", label: "Zhipu GLM", group: "Model APIs", protocol: "openai", endpointHint: "https://open.bigmodel.cn/api/paas/v4/chat/completions" },
  { id: "dashscope", label: "Alibaba DashScope", group: "Model APIs", protocol: "openai", endpointHint: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions" },
  { id: "qianfan", label: "Baidu Qianfan", group: "Model APIs", protocol: "openai", endpointHint: "https://qianfan.baidubce.com/v2/chat/completions" },
  { id: "groq", label: "Groq", group: "OpenAI-compatible hosts", protocol: "openai", endpointHint: "https://api.groq.com/openai/v1/chat/completions" },
  { id: "together", label: "Together AI", group: "OpenAI-compatible hosts", protocol: "openai", endpointHint: "https://api.together.xyz/v1/chat/completions" },
  { id: "fireworks", label: "Fireworks AI", group: "OpenAI-compatible hosts", protocol: "openai", endpointHint: "https://api.fireworks.ai/inference/v1/chat/completions" },
  { id: "cerebras", label: "Cerebras", group: "OpenAI-compatible hosts", protocol: "openai", endpointHint: "https://api.cerebras.ai/v1/chat/completions" },
  { id: "sambanova", label: "SambaNova", group: "OpenAI-compatible hosts", protocol: "openai", endpointHint: "https://api.sambanova.ai/v1/chat/completions" },
  { id: "nvidia-nim", label: "NVIDIA NIM", group: "OpenAI-compatible hosts", protocol: "openai", endpointHint: "https://integrate.api.nvidia.com/v1/chat/completions" },
  { id: "huggingface", label: "Hugging Face", group: "OpenAI-compatible hosts", protocol: "openai", endpointHint: "https://router.huggingface.co/v1/chat/completions" },
  { id: "openrouter", label: "OpenRouter", group: "OpenAI-compatible hosts", protocol: "openai", endpointHint: "https://openrouter.ai/api/v1/chat/completions" },
  { id: "perplexity", label: "Perplexity", group: "OpenAI-compatible hosts", protocol: "openai", endpointHint: "https://api.perplexity.ai/chat/completions" },
  { id: "ollama", label: "Ollama", group: "Private and local", protocol: "openai", endpointHint: "http://localhost:11434/v1/chat/completions" },
  { id: "private", label: "Private endpoint", group: "Private and local", protocol: "openai", endpointHint: "https://your-model-host/v1/chat/completions" },
];

const AGENTS: Array<Omit<Entry, "kind" | "roles" | "protocol">> = [
  { id: "cursor", label: "Cursor", group: "Folder agents", endpointHint: "https://api.cursor.com/v0/agents" },
  { id: "github-copilot", label: "GitHub Copilot coding agent", group: "Folder agents", endpointHint: "https://api.github.com/copilot/coding-agent" },
  { id: "openai-codex", label: "OpenAI Codex", group: "Folder agents", endpointHint: "https://api.openai.com/v1/responses" },
  { id: "claude-code", label: "Claude Code", group: "Folder agents", endpointHint: "https://api.anthropic.com/v1/messages" },
  { id: "windsurf", label: "Windsurf Cascade", group: "Folder agents", endpointHint: "https://server.codeium.com/exa.seat_management_pb.SeatManagementService" },
  { id: "devin", label: "Devin", group: "Folder agents", endpointHint: "https://api.devin.ai/v1/sessions" },
  { id: "openhands", label: "OpenHands", group: "Folder agents", endpointHint: "http://localhost:3000/api/conversations" },
  { id: "aider", label: "Aider", group: "Folder agents", endpointHint: "http://localhost:8501" },
  { id: "cline", label: "Cline", group: "Folder agents", endpointHint: "http://localhost:3000" },
  { id: "continue", label: "Continue", group: "Folder agents", endpointHint: "http://localhost:65432" },
  { id: "amazon-q", label: "Amazon Q Developer", group: "Folder agents", endpointHint: "https://codewhisperer.us-east-1.amazonaws.com" },
  { id: "google-jules", label: "Google Jules", group: "Folder agents", endpointHint: "https://jules.googleapis.com/v1/sessions" },
  { id: "sourcegraph-amp", label: "Sourcegraph Amp", group: "Folder agents", endpointHint: "https://sourcegraph.com/.api/amp" },
  { id: "sourcegraph-cody", label: "Sourcegraph Cody", group: "Folder agents", endpointHint: "https://sourcegraph.com/.api/completions/stream" },
];

export const MODEL_PROVIDERS = [
  ...CHAT.map((item) => ({ ...item, kind: "chat" as const, roles: ["plan", "code"] as ModelRole[] })),
  ...AGENTS.map((item) => ({ ...item, protocol: "agent" as const, kind: "agent" as const, roles: ["code"] as ModelRole[] })),
] as const;

export type ModelProvider = (typeof MODEL_PROVIDERS)[number]["id"];

export const MODEL_PROVIDER_IDS = MODEL_PROVIDERS.map((item) => item.id) as unknown as [
  ModelProvider,
  ...ModelProvider[],
];

export const PLAN_PROVIDER_IDS = MODEL_PROVIDERS.filter((item) => item.roles.includes("plan")).map((item) => item.id) as unknown as [
  ModelProvider,
  ...ModelProvider[],
];

export const CODE_PROVIDER_IDS = MODEL_PROVIDERS.filter((item) => item.roles.includes("code")).map((item) => item.id) as unknown as [
  ModelProvider,
  ...ModelProvider[],
];

export function modelProviderById(id: string) {
  return MODEL_PROVIDERS.find((item) => item.id === id) ?? MODEL_PROVIDERS.find((item) => item.id === "private")!;
}

export function providersFor(role: ModelRole) {
  return MODEL_PROVIDERS.filter((item) => item.roles.includes(role));
}

/** Chat vendors for plan, sales, image, and video. Folder agents appear only when Code is ticked. */
export function providersForJobs(uses: readonly ModelJob[]) {
  const wantChat = uses.some((item) => item !== "code");
  const wantCode = uses.includes("code");
  if (wantCode && !wantChat) return providersFor("code");
  if (!wantCode) return providersFor("plan");
  return MODEL_PROVIDERS;
}

export function isFolderAgent(id: string): boolean {
  return modelProviderById(id).kind === "agent";
}

export type CodeImplementation = "chat-files" | "cursor-cloud" | "unsupported";

/** Protocol id completeModel understands. Folder-agent labels that are really chat APIs are aliased. */
export function chatProtocolFor(id: string): ModelProvider | null {
  if (id === "claude-code") return "anthropic";
  if (id === "openai-codex") return "openai";
  const meta = modelProviderById(id);
  return meta.kind === "chat" ? meta.id : null;
}

export function codeImplementationKind(id: string): CodeImplementation {
  if (id === "cursor") return "cursor-cloud";
  if (chatProtocolFor(id)) return "chat-files";
  return "unsupported";
}

export type VendorFieldId = "endpoint" | "region" | "deploymentName" | "apiKey";

export interface VendorField {
  id: VendorFieldId;
  label: string;
  hint?: string;
}

export type VendorNeed = VendorFieldId | "githubRepo" | "githubToken" | "githubBranch";

export interface VendorContract {
  id: string;
  label: string;
  implementation: CodeImplementation;
  liveSupported: boolean;
  fields: VendorField[];
  needs: VendorNeed[];
  help: string;
}

function regionField(id: string): VendorField | null {
  if (id === "ibm-watsonx") return { id: "region", label: "Project id", hint: "watsonx project id" };
  if (id === "amazon-bedrock") return { id: "region", label: "Region", hint: "us-east-1" };
  if (id === "google-vertex") return { id: "region", label: "Region", hint: "us-central1" };
  return null;
}

function needsDeployment(id: string, protocol: Entry["protocol"]): boolean {
  if (protocol === "agent" && id !== "claude-code" && id !== "openai-codex") return false;
  return true;
}

/** What this vendor needs from the UI, and how Live will call it. Derived from protocol — not a one-off per screen. */
export function vendorContract(id: string): VendorContract {
  const meta = modelProviderById(id);
  const implementation = codeImplementationKind(id);
  const liveSupported = implementation !== "unsupported";
  const fields: VendorField[] = [
    {
      id: "endpoint",
      label: meta.kind === "agent" ? "Agent endpoint" : "Chat endpoint",
      hint: meta.endpointHint,
    },
  ];
  const region = regionField(id);
  if (region) fields.push(region);
  if (needsDeployment(id, meta.protocol)) {
    fields.push({ id: "deploymentName", label: "Deployment / model name" });
  }
  fields.push({ id: "apiKey", label: `${meta.label} API key` });
  const needs: VendorNeed[] = fields.map((field) => field.id);
  if (implementation === "cursor-cloud") {
    needs.push("githubRepo", "githubToken", "githubBranch");
  }
  const help =
    implementation === "cursor-cloud"
      ? "Shipdeck will create main with your Git token, then call Cursor with that repo. The Cursor account on this key must already be able to open the same GitHub repo."
      : implementation === "chat-files"
        ? `${meta.label} writes the project over its chat API, one file per call, so small models such as gpt-35-turbo are not cut off mid-JSON.`
        : `${meta.label} is listed but Live file generation is not wired. Pick Azure OpenAI, OpenAI, Anthropic, Claude Code, Codex, or Cursor.`;
  return { id: meta.id, label: meta.label, implementation, liveSupported, fields, needs, help };
}

export const PROVIDER_GROUPS = [
  "Cloud platforms",
  "Model APIs",
  "OpenAI-compatible hosts",
  "Private and local",
  "Folder agents",
] as const;
