import type {
  Connection,
  ConnectionType,
  CreateConnectionInput,
  DeliveryPolicyPublic,
  DeliveryRun,
  DeliveryTicket,
  IdeaBrief,
  IndustryOffering,
  MarketingView,
  SalesQueueItem,
  SalesSearch,
  SalesView,
  Pipeline,
  PipelineBoxes,
  PipelineRun,
  PlatformSettings,
  PlatformUser,
  Project,
  AuditEvent,
  StackDetection,
  StoredKeyRecord,
} from "@shipdeck/shared";

const TOKEN_KEY = "shipdeck_api_token";

export function getApiToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? "";
}

export function setApiToken(token: string) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getApiToken();
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  projects: () => request<Project[]>("/api/projects"),
  createProject: (body: { name: string; description?: string }) =>
    request<Project>("/api/projects", { method: "POST", body: JSON.stringify(body) }),
  pipelines: (projectId?: string) =>
    request<Pipeline[]>(
      projectId ? `/api/pipelines?projectId=${projectId}` : "/api/pipelines"
    ),
  getPipeline: (id: string) => request<Pipeline>(`/api/pipelines/${id}`),
  savePipeline: (id: string, body: Partial<Pipeline>) =>
    request<Pipeline>(`/api/pipelines/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  connections: () => request<Connection[]>("/api/connections"),
  createConnection: (input: CreateConnectionInput) =>
    request<Connection>("/api/connections", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateConnection: (id: string, input: CreateConnectionInput) =>
    request<Connection>(`/api/connections/${id}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  updateSecrets: (id: string, secrets: Record<string, string>) =>
    request<Connection>(`/api/connections/${id}/secrets`, {
      method: "PATCH",
      body: JSON.stringify({ secrets }),
    }),
  testConnection: (id: string) =>
    request<{
      ok: boolean;
      message: string;
      summary?: string;
      technical?: string;
      hint?: string;
    }>(`/api/connections/${id}/test`, { method: "POST" }),
  testConnectionDraft: (input: CreateConnectionInput) =>
    request<{
      ok: boolean;
      message: string;
      summary?: string;
      technical?: string;
      hint?: string;
    }>("/api/connections/test", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  deleteConnection: (id: string) =>
    request<void>(`/api/connections/${id}`, { method: "DELETE" }),
  startRun: (pipelineId: string) =>
    request<PipelineRun>(`/api/pipelines/${pipelineId}/runs`, { method: "POST" }),
  detect: (boxes: PipelineBoxes) =>
    request<{
      detection: StackDetection;
      suggestedBoxes?: PipelineBoxes;
      vmSizing?: import("@shipdeck/shared").VmSizeRecommendation;
    }>("/api/detect", {
      method: "POST",
      body: JSON.stringify({ boxes }),
    }),
  vmSizes: (provider: "aws" | "azure" | "gcp", boxes?: PipelineBoxes, detection?: StackDetection) =>
    request<{
      provider: string;
      source: string;
      recommendedId?: string;
      chosenId?: string;
      vmSizing?: import("@shipdeck/shared").VmSizeRecommendation;
      sizes: Array<{
        id: string;
        label: string;
        vcpu: number;
        ramGb: number;
        tip?: string;
        recommended?: boolean;
      }>;
    }>("/api/infra/vm-sizes", {
      method: "POST",
      body: JSON.stringify({ provider, boxes, detection }),
    }),
  generateCompose: (boxes: PipelineBoxes) =>
    request<{
      ok: boolean;
      file: string;
      message: string;
      apps: Array<{ name: string; port: number; dir: string }>;
      written: string[];
      detection: StackDetection;
      suggestedBoxes?: PipelineBoxes;
    }>("/api/compose/generate", {
      method: "POST",
      body: JSON.stringify({ boxes }),
    }),
  reviewCompose: (boxes: PipelineBoxes) =>
    request<{
      hasExisting: boolean;
      existingFile: string | null;
      matches: boolean;
      recommendation: "existing" | "generated";
      discrepancies: Array<{ id: string; message: string }>;
      generated: { message: string; apps: Array<{ name: string; port: number; dir: string }> };
    }>("/api/compose/review", {
      method: "POST",
      body: JSON.stringify({ boxes }),
    }),
  reviewTests: (boxes: PipelineBoxes) =>
    request<{
      discovered: Array<{
        dir: string;
        kind: string;
        command: string;
        detail: string;
        placeholder: boolean;
        fileCount: number;
      }>;
      generated: Array<{ path: string; dir: string; reason: string }>;
      recommended: Array<{ dir: string; command: string; detail: string; fileCount: number }>;
      discrepancies: Array<{ id: string; message: string }>;
      matches: boolean;
      hasExisting: boolean;
      recommendation: "existing" | "generated" | "skip";
    }>("/api/tests/review", {
      method: "POST",
      body: JSON.stringify({ boxes }),
    }),
  generateTests: (boxes: PipelineBoxes) =>
    request<{
      written: string[];
      message: string;
      suggestedBoxes?: PipelineBoxes;
    }>("/api/tests/generate", {
      method: "POST",
      body: JSON.stringify({ boxes }),
    }),
  reviewDockerfiles: (boxes: PipelineBoxes) =>
    request<{
      discovered: Array<{
        path: string;
        dir: string;
        expose: number[];
        from: string | null;
        valid: boolean;
        generated: boolean;
      }>;
      plannedApps: Array<{ name: string; dir: string; port: number; existingPath?: string }>;
      hasExisting: boolean;
      matches: boolean;
      recommendation: "existing" | "generated";
      discrepancies: Array<{ id: string; message: string }>;
      configuredPath: string;
      configuredExists: boolean;
    }>("/api/dockerfiles/review", {
      method: "POST",
      body: JSON.stringify({ boxes }),
    }),
  generateDockerfiles: (boxes: PipelineBoxes) =>
    request<{
      written: string[];
      message: string;
      suggestedBoxes?: PipelineBoxes;
    }>("/api/dockerfiles/generate", {
      method: "POST",
      body: JSON.stringify({ boxes }),
    }),
  previewPorts: (boxes: PipelineBoxes) =>
    request<{ publicPorts: number[]; privatePorts: number[] }>("/api/ports/preview", {
      method: "POST",
      body: JSON.stringify({ boxes }),
    }),
  openPorts: (boxes: PipelineBoxes) =>
    request<{
      ok: boolean;
      publicPorts: number[];
      privatePorts: number[];
      message: string;
      logs: string[];
      nsg?: { ok: boolean; message: string };
      hostFirewall?: { ok: boolean; message: string };
    }>("/api/ports/open", {
      method: "POST",
      body: JSON.stringify({ boxes }),
    }),
  cancelRun: (id: string) =>
    request<PipelineRun>(`/api/runs/${id}/cancel`, { method: "POST" }),
  approveRun: (id: string) =>
    request<PipelineRun>(`/api/runs/${id}/approve`, { method: "POST" }),
  rejectRun: (id: string) =>
    request<PipelineRun>(`/api/runs/${id}/reject`, { method: "POST" }),
  destroyEnvironment: (id: string) =>
    request<PipelineRun>(`/api/runs/${id}/destroy-environment`, { method: "POST" }),
  getRun: (id: string) => request<PipelineRun>(`/api/runs/${id}`),
  runs: (pipelineId?: string) =>
    request<PipelineRun[]>(
      pipelineId ? `/api/runs?pipelineId=${pipelineId}` : "/api/runs"
    ),
  settings: () => request<PlatformSettings>("/api/settings"),
  setSettings: (body: Partial<PlatformSettings>) =>
    request<PlatformSettings>("/api/settings", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  audit: () => request<AuditEvent[]>("/api/audit"),
  storedKeys: () => request<StoredKeyRecord[]>("/api/keys"),
  revealStoredKey: (connectionId: string, secretName: string) =>
    request<StoredKeyRecord & { plaintext: string }>("/api/keys/reveal", {
      method: "POST",
      body: JSON.stringify({ connectionId, secretName }),
    }),
  users: () => request<PlatformUser[]>("/api/users"),
  deliveryProjectRules: (repoUrl: string) =>
    request<{ policy: DeliveryPolicyPublic } & Pick<DeliveryPolicyPublic, "allowedLanguages" | "allowedPackageSources" | "allowedLicenses">>("/api/delivery/project-rules", {
      method: "POST",
      body: JSON.stringify({ repoUrl }),
    }),
  deliveryPolicy: () => request<DeliveryPolicyPublic>("/api/delivery/policy"),
  saveDeliveryPolicy: (body: DeliveryPolicyPublic) =>
    request<DeliveryPolicyPublic>("/api/delivery/policy", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  saveDeliverySecrets: (body: {
    modelApiKey?: string;
    planApiKey?: string;
    codeApiKey?: string;
    jiraToken?: string;
    webhookSecret?: string;
    gitToken?: string;
  }) =>
    request<DeliveryPolicyPublic>("/api/delivery/secrets", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  deliverySample: () => request<DeliveryTicket>("/api/delivery/sample-ticket"),
  deliveryJiraIssue: (key: string) =>
    request<DeliveryTicket>(`/api/delivery/jira/issues/${encodeURIComponent(key)}`),
  deliveryRuns: (projectId?: string) =>
    request<DeliveryRun[]>(
      projectId ? `/api/delivery/runs?projectId=${encodeURIComponent(projectId)}` : "/api/delivery/runs"
    ),
  deliveryRun: (id: string) => request<DeliveryRun>(`/api/delivery/runs/${encodeURIComponent(id)}`),
  workspaceFiles: (id: string) =>
    request<{ branch: string; changeKind: "new_app" | "existing_repo"; files: string[] }>(
      `/api/delivery/runs/${encodeURIComponent(id)}/workspace`
    ),
  workspaceFile: (id: string, path: string) =>
    request<{ path: string; contents: string }>(
      `/api/delivery/runs/${encodeURIComponent(id)}/workspace/file?path=${encodeURIComponent(path)}`
    ),
  saveWorkspaceFile: (id: string, path: string, contents: string) =>
    request<{ run: DeliveryRun; path: string; contents: string; reply: string }>(
      `/api/delivery/runs/${encodeURIComponent(id)}/workspace/file`,
      { method: "PUT", body: JSON.stringify({ path, contents }) }
    ),
  createWorkspaceFile: (id: string, path: string, contents = "") =>
    request<{ run: DeliveryRun; path: string; contents: string; reply: string }>(
      `/api/delivery/runs/${encodeURIComponent(id)}/workspace/file`,
      { method: "POST", body: JSON.stringify({ path, contents }) }
    ),
  deleteWorkspaceFile: (id: string, path: string) =>
    request<{ run: DeliveryRun; path: string; reply: string }>(
      `/api/delivery/runs/${encodeURIComponent(id)}/workspace/file?path=${encodeURIComponent(path)}`,
      { method: "DELETE" }
    ),
  previewStatus: (id: string) =>
    request<{ running: boolean; page?: string; title?: string }>(`/api/delivery/runs/${encodeURIComponent(id)}/preview`),
  startPreview: (id: string) =>
    request<{ port: number; url: string; page: string; title?: string }>(`/api/delivery/runs/${encodeURIComponent(id)}/preview`, {
      method: "POST",
    }),
  stopPreview: (id: string) =>
    request<{ stopped: boolean }>(`/api/delivery/runs/${encodeURIComponent(id)}/preview`, { method: "DELETE" }),
  stopStuckPreview: (id: string) =>
    request<{ stopped: boolean }>(`/api/delivery/runs/${encodeURIComponent(id)}/preview/stop-stuck`, {
      method: "POST",
    }),
  workbench: (
    id: string,
    body: {
      kind: "fix" | "new_ask" | "code_edit" | "approve_plan" | "reject_plan";
      message?: string;
      role?: "code" | "test";
      images?: Array<{ mimeType: string; base64: string }>;
    }
  ) =>
    request<{ run: DeliveryRun; reply: string }>(`/api/delivery/runs/${encodeURIComponent(id)}/workbench`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  startDelivery: (body: {
    source: "sample" | "ticket" | "jira";
    mode: "simulate" | "live";
    changeKind: "new_app" | "existing_repo";
    repoUrl?: string;
    ticket?: DeliveryTicket;
    existingConnectionId?: string;
    existingServiceUrl?: string;
    projectId?: string;
    existingTarget?: {
      kind: "ssh" | "aws" | "azure" | "gcp";
      host?: string;
      port?: string;
      user?: string;
      region?: string;
      projectId?: string;
      subscriptionId?: string;
      tenantId?: string;
      serviceName?: string;
      serviceUrl?: string;
      password?: string;
      privateKey?: string;
      accessKeyId?: string;
      secretAccessKey?: string;
      credentialsJson?: string;
      clientId?: string;
      clientSecret?: string;
    };
  }) =>
    request<{ run: DeliveryRun; duplicate: boolean }>("/api/delivery/runs", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  saveDeliveryExistingTarget: (
    id: string,
    body: {
      existingConnectionId?: string;
      existingServiceUrl?: string;
      kind?: "ssh" | "aws" | "azure" | "gcp";
      host?: string;
      port?: string;
      user?: string;
      region?: string;
      projectId?: string;
      subscriptionId?: string;
      tenantId?: string;
      serviceName?: string;
      serviceUrl?: string;
      password?: string;
      privateKey?: string;
      accessKeyId?: string;
      secretAccessKey?: string;
      credentialsJson?: string;
      clientId?: string;
      clientSecret?: string;
    }
  ) =>
    request<DeliveryRun>(`/api/delivery/runs/${id}/existing-target`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  reviseDelivery: (id: string, note: string) =>
    request<DeliveryRun>(`/api/delivery/runs/${id}/revise`, {
      method: "POST",
      body: JSON.stringify({ note }),
    }),
  runDeliveryTests: (id: string) =>
    request<{ run: DeliveryRun; reply: string }>(`/api/delivery/runs/${encodeURIComponent(id)}/tests`, {
      method: "POST",
    }),
  decideDelivery: (
    id: string,
    body: { gate: "architecture" | "code_review" | "deploy"; action: "approve" | "reject" | "skip"; note?: string }
  ) =>
    request<DeliveryRun>(`/api/delivery/runs/${id}/decision`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  killDelivery: (id: string) =>
    request<DeliveryRun>(`/api/delivery/runs/${id}/kill`, { method: "POST" }),
  deliveryAttachment: async (runId: string, name: string) => {
    const token = getApiToken();
    const res = await fetch(`/api/delivery/runs/${encodeURIComponent(runId)}/attachments/${encodeURIComponent(name)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`Attachment ${name} was not found`);
    return res.blob();
  },
  jiraAttachment: async (key: string, name: string) => {
    const token = getApiToken();
    const res = await fetch(
      `/api/delivery/jira/issues/${encodeURIComponent(key)}/attachments/${encodeURIComponent(name)}`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} }
    );
    if (!res.ok) throw new Error(`Attachment ${name} was not found`);
    return res.blob();
  },
  briefCatalog: () => request<{ industries: IndustryOffering[] }>("/api/briefs/catalog"),
  briefs: (projectId?: string) =>
    request<IdeaBrief[]>(projectId ? `/api/briefs?projectId=${encodeURIComponent(projectId)}` : "/api/briefs"),
  createBrief: (body: { projectId?: string; industryId: string; name?: string; mode: "simulate" | "live" }) =>
    request<IdeaBrief>("/api/briefs", { method: "POST", body: JSON.stringify(body) }),
  briefChat: (id: string, message: string, mode: "simulate" | "live") =>
    request<IdeaBrief>(`/api/briefs/${id}/chat`, { method: "POST", body: JSON.stringify({ message, mode }) }),
  briefUpload: (id: string, body: { filename: string; text?: string; base64?: string }) =>
    request<IdeaBrief>(`/api/briefs/${id}/upload`, { method: "POST", body: JSON.stringify(body) }),
  briefReport: (id: string, mode: "simulate" | "live") =>
    request<IdeaBrief>(`/api/briefs/${id}/report`, { method: "POST", body: JSON.stringify({ mode }) }),
  briefResearch: (id: string, mode: "simulate" | "live") =>
    request<IdeaBrief>(`/api/briefs/${id}/research`, { method: "POST", body: JSON.stringify({ mode }) }),
  briefTechnical: (id: string, markdown: string) =>
    request<IdeaBrief>(`/api/briefs/${id}/technical`, { method: "POST", body: JSON.stringify({ markdown }) }),
  briefSend: (id: string, mode: "simulate" | "live", jiraConnectionId?: string) =>
    request<IdeaBrief>(`/api/briefs/${id}/send`, {
      method: "POST",
      body: JSON.stringify({ mode, jiraConnectionId }),
    }),
  downloadBriefSlides: (path: string) => downloadFile(path, "draft.pptx"),
  salesQueue: (projectId?: string) =>
    request<{ items: SalesQueueItem[]; modelName: string }>(
      projectId ? `/api/sales?projectId=${encodeURIComponent(projectId)}` : "/api/sales"
    ),
  salesView: (briefId: string) => request<SalesView>(`/api/sales/by-brief/${briefId}`),
  salesFind: (briefId: string, mode: "simulate" | "live", search: SalesSearch) =>
    request<SalesView>(`/api/sales/by-brief/${briefId}/find`, {
      method: "POST",
      body: JSON.stringify({ mode, search }),
    }),
  downloadSales: (briefId: string) => downloadFile(`/api/sales/by-brief/${briefId}/export`, "sales.csv"),
  marketingView: (briefId: string) => request<MarketingView>(`/api/marketing/by-brief/${briefId}`),
  marketingContent: (briefId: string, mode: "simulate" | "live", topic: string, platform: string, audience: string) =>
    request<MarketingView>(`/api/marketing/by-brief/${briefId}/content`, {
      method: "POST",
      body: JSON.stringify({ mode, topic, platform, audience }),
    }),
  marketingSeo: (briefId: string, mode: "simulate" | "live", topic: string, platform: string, audience: string) =>
    request<MarketingView>(`/api/marketing/by-brief/${briefId}/seo`, {
      method: "POST",
      body: JSON.stringify({ mode, topic, platform, audience }),
    }),
  marketingImage: (briefId: string, mode: "simulate" | "live", prompt: string) =>
    request<MarketingView>(`/api/marketing/by-brief/${briefId}/image`, {
      method: "POST",
      body: JSON.stringify({ mode, prompt }),
    }),
  marketingFilm: async (path: string) => {
    const token = getApiToken();
    const res = await fetch(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) throw new Error("The film is not ready.");
    return res.blob();
  },
  marketingVideo: (briefId: string, mode: "simulate" | "live", topic: string, platform: string, audience: string) =>
    request<MarketingView>(`/api/marketing/by-brief/${briefId}/video`, {
      method: "POST",
      body: JSON.stringify({ mode, topic, platform, audience }),
    }),
  marketingChat: (briefId: string, mode: "simulate" | "live", message: string, name: string, email: string, phone: string) =>
    request<MarketingView>(`/api/marketing/by-brief/${briefId}/chat`, {
      method: "POST",
      body: JSON.stringify({ mode, message, name, email, phone }),
    }),
  marketingLead: (briefId: string, name: string, email: string, phone: string, interest: string) =>
    request<MarketingView>(`/api/marketing/by-brief/${briefId}/lead`, {
      method: "POST",
      body: JSON.stringify({ name, email, phone, interest }),
    }),
  salesStatus: (
    briefId: string,
    website: string,
    status: SalesView["accounts"][number]["status"],
    repNote?: string
  ) =>
    request<SalesView>(`/api/sales/by-brief/${briefId}/status`, {
      method: "POST",
      body: JSON.stringify({ website, status, repNote }),
    }),
};

async function downloadFile(path: string, fallback: string) {
  const token = getApiToken();
  const res = await fetch(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || "The file is not ready");
  }
  const blob = await res.blob();
  const match = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "");
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = match?.[1] || fallback;
  link.click();
  URL.revokeObjectURL(url);
}

export const CONNECTION_TYPES: ConnectionType[] = [
  "jira",
  "git",
  "model",
  "ssh",
  "azure",
  "aws",
  "gcp",
  "docker",
  "registry",
  "kubernetes",
  "notify",
];
