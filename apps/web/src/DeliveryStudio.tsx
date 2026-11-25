import { useCallback, useEffect, useRef, useState } from "react";
import {
  connectionFolder,
  deliveryRunActive,
  describeServerlessUrl,
  isTargetConnectionType,
  modelProviderById,
  parseServerlessUrl,
  vendorContract,
  type Connection,
  type ConnectionFolder,
  type ConnectionType,
  type CreateConnectionInput,
  type DeliveryExistingKind,
  type DeliveryExistingTargetInput,
  type DeliveryPolicyPublic,
  type DeliveryRun,
  type DeliveryTicketAttachment,
  type Pipeline,
} from "@shipdeck/shared";
import { api } from "./api";
import { FlowScene } from "./icons";
import { PolicyMark } from "./policyMarks";

const STEPS = [
  { label: "Plan", scene: "plan" },
  { label: "Code", scene: "code" },
  { label: "Tests", scene: "tests" },
  { label: "Approve", scene: "approve" },
  { label: "Live", scene: "live" },
] as const;

function latestTicketRuns(runs: DeliveryRun[]): DeliveryRun[] {
  const latest = new Map<string, DeliveryRun>();
  for (const run of runs) {
    const prev = latest.get(run.ticket.key);
    if (!prev || run.updatedAt > prev.updatedAt) latest.set(run.ticket.key, run);
  }
  return [...latest.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function statusTone(status: string): "ok" | "bad" | "run" {
  if (status === "completed") return "ok";
  if (status === "failed" || status === "killed" || status === "rejected") return "bad";
  return "run";
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    architecture_review: "Needs your plan approval",
    writing_code: "Writing the code",
    code_review: "Open the workbench",
    deploy_approval: "Ready to ship",
    completed: "Done",
    failed: "Failed",
    killed: "Stopped",
    rejected: "Sent back",
  };
  return labels[status] ?? status.replaceAll("_", " ");
}

function nextHint(run: DeliveryRun): string {
  if (run.status === "architecture_review") {
    return "Read the plan. Approve it once. You do not approve it again.";
  }
  if (run.status === "writing_code") {
    return "The plan is approved. The code is being written. Stay on this page. The workbench opens when the folder is ready.";
  }
  if (run.status === "failed" && run.failureCode === "codegen") {
    return "The plan is already approved. The code was not written. Press Write the code again. Do not start the plan over.";
  }
  if (run.status === "code_review") {
    return "Open the workbench to change the app. Open the test bench to run the tests.";
  }
  if (run.status === "deploy_approval") return "Tests passed. Approve shipping, then open Ship and choose Ship now.";
  if (run.status === "completed") {
    const url = run.implementation?.pullRequestUrl;
    if (url && !url.startsWith("simulate://")) return "This ticket is finished. The pull request is created.";
    return "This ticket is finished. Load another ticket, or open History to see the release.";
  }
  if (run.status === "failed") return "This ticket stopped. Read the message below before you try again.";
  if (run.status === "killed") return "This ticket was stopped. Load it again if you still want it.";
  if (run.status === "rejected") return "This plan was sent back. Revise it, or start the ticket again.";
  return "Follow the highlighted step.";
}

function stepState(run: DeliveryRun, index: number): "done" | "current" | "" {
  const current = stepIndex(run);
  if (run.status === "completed" || index < current) return "done";
  if (index === current) return "current";
  return "";
}

function stepIndex(run: DeliveryRun | null): number {
  if (!run) return -1;
  if (run.status === "architecture_review") return 0;
  if (run.status === "writing_code" || run.status === "code_review") return 1;
  if (run.status === "deploy_approval") return 3;
  if (run.status === "completed") return 4;
  if (run.checks.length) return 2;
  if (run.implementation) return 1;
  return 0;
}

function downloadMarkdown(filename: string, markdown: string) {
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function downloadArchitecture(run: DeliveryRun) {
  downloadMarkdown(`${run.ticket.key}-architecture.md`, run.architecture.markdown);
}

function downloadImpactAnalysis(run: DeliveryRun) {
  downloadMarkdown(`${run.ticket.key}-impact-analysis.md`, run.architecture.impactAnalysis || "");
}

async function architectureWithImages(run: DeliveryRun): Promise<string> {
  let markdown = run.architecture.markdown;
  for (const item of run.ticket.attachments) {
    const name = item.storedName || item.filename;
    if ((item.kind || "").toLowerCase() !== "image" && !/\.(png|jpe?g|gif|webp|svg)$/i.test(item.filename)) {
      continue;
    }
    try {
      const blob = await api.deliveryAttachment(run.id, name);
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("read failed"));
        reader.readAsDataURL(blob);
      });
      markdown = markdown.replaceAll(`](ticket-attachments/${name})`, `](${dataUrl})`);
    } catch {
      // Preview still opens; the image name stays in the document.
    }
  }
  return markdown;
}

async function viewArchitecture(run: DeliveryRun, opts?: { title?: string; markdown?: string }) {
  const title = opts?.title ?? `${run.ticket.key} architecture.md`;
  const source = (opts?.markdown ?? (await architectureWithImages(run)))
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/<\/textarea/gi, "&lt;/textarea");
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${title.replace(/</g, "")}</title>
  <script type="module">
    import { marked } from "https://cdn.jsdelivr.net/npm/marked@15.0.12/+esm";
    import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
    marked.setOptions({ gfm: true, breaks: false });
    const out = document.getElementById("out");
    out.innerHTML = marked.parse(document.getElementById("src").value);
    for (const block of out.querySelectorAll("pre code")) {
      if (![...block.classList].includes("language-mermaid")) continue;
      const chart = document.createElement("div");
      chart.className = "mermaid";
      chart.textContent = block.textContent || "";
      block.parentElement?.replaceWith(chart);
    }
    mermaid.initialize({
      startOnLoad: false,
      theme: "dark",
      securityLevel: "strict",
      flowchart: { curve: "basis", padding: 16 },
    });
    await mermaid.run({ querySelector: ".mermaid" });
  </script>
  <style>
    :root {
      --bg: #1e1e1e;
      --fg: #cccccc;
      --heading: #e8e8e8;
      --border: #3c3c3c;
      --code: #d7ba7d;
      --code-bg: #2d2d2d;
      --link: #3794ff;
    }
    html, body { margin: 0; background: var(--bg); color: var(--fg); }
    .bar {
      font: 12px/1.4 "Segoe UI", sans-serif;
      color: #9d9d9d;
      padding: 8px 28px;
      border-bottom: 1px solid #2b2b2b;
    }
    .markdown-body {
      box-sizing: border-box;
      max-width: 900px;
      margin: 0 auto;
      padding: 36px 40px 96px;
      font: 16px/1.7 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    }
    .markdown-body h1, .markdown-body h2, .markdown-body h3 {
      color: var(--heading);
      font-weight: 600;
      line-height: 1.25;
    }
    .markdown-body h1 {
      font-size: 2em;
      margin: 0 0 16px;
      padding-bottom: 0.3em;
      border-bottom: 1px solid var(--border);
    }
    .markdown-body h2 {
      font-size: 1.5em;
      margin: 28px 0 12px;
      padding-bottom: 0.3em;
      border-bottom: 1px solid var(--border);
    }
    .markdown-body h3 { font-size: 1.2em; margin: 22px 0 10px; }
    .markdown-body p { margin: 0 0 14px; }
    .markdown-body ul, .markdown-body ol { padding-left: 2em; margin: 0 0 14px; }
    .markdown-body li { margin: 4px 0; }
    .markdown-body strong { color: #fff; }
    .markdown-body a { color: var(--link); }
    .markdown-body code {
      font-family: Consolas, "Courier New", monospace;
      font-size: 0.9em;
      background: var(--code-bg);
      color: var(--code);
      padding: 0.15em 0.4em;
      border-radius: 4px;
    }
    .markdown-body pre {
      background: var(--code-bg);
      padding: 14px 16px;
      border-radius: 6px;
      overflow: auto;
    }
    .markdown-body pre code { background: none; padding: 0; color: var(--fg); }
    .markdown-body table { border-collapse: collapse; width: 100%; margin: 16px 0 24px; }
    .markdown-body th, .markdown-body td {
      border: 1px solid #454545;
      padding: 8px 13px;
      text-align: left;
    }
    .markdown-body th { background: #252526; color: var(--heading); }
    .markdown-body tr:nth-child(2n) { background: #252526; }
    .markdown-body img { max-width: 100%; border: 1px solid #454545; border-radius: 6px; margin: 8px 0 16px; }
    .mermaid { display: flex; justify-content: center; margin: 28px 0; overflow: auto; }
    .mermaid svg { max-width: 100%; height: auto; }
  </style>
</head>
<body>
  <div class="bar">Preview ${title.replace(/</g, "")} · revision ${run.architecture.revision}</div>
  <article id="out" class="markdown-body"></article>
  <textarea id="src" hidden>${source}</textarea>
</body>
</html>`;
  const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
  window.open(url, "_blank", "noopener,noreferrer");
}

type PolicyChoice = { id: string; name: string };

const LANGUAGE_CHOICES: PolicyChoice[] = [
  { id: "node", name: "Node.js" },
  { id: "javascript", name: "JavaScript" },
  { id: "typescript", name: "TypeScript" },
  { id: "python", name: "Python" },
  { id: "go", name: "Go" },
  { id: "java", name: "Java" },
  { id: "csharp", name: "C#" },
  { id: "ruby", name: "Ruby" },
  { id: "php", name: "PHP" },
  { id: "rust", name: "Rust" },
];

const PACKAGE_CHOICES: PolicyChoice[] = [
  { id: "https://registry.npmjs.org", name: "npm" },
  { id: "https://pypi.org", name: "PyPI" },
  { id: "https://repo.maven.apache.org/maven2", name: "Maven Central" },
  { id: "https://api.nuget.org/v3/index.json", name: "NuGet" },
  { id: "https://crates.io", name: "crates.io" },
  { id: "https://rubygems.org", name: "RubyGems" },
  { id: "https://repo.packagist.org", name: "Packagist" },
  { id: "https://proxy.golang.org", name: "Go modules" },
];

const LICENSE_CHOICES: PolicyChoice[] = [
  { id: "MIT", name: "MIT" },
  { id: "Apache-2.0", name: "Apache 2.0" },
  { id: "BSD-3-Clause", name: "BSD 3-Clause" },
  { id: "BSD-2-Clause", name: "BSD 2-Clause" },
  { id: "ISC", name: "ISC" },
  { id: "MPL-2.0", name: "Mozilla Public 2.0" },
  { id: "GPL-3.0", name: "GPL 3.0" },
  { id: "LGPL-3.0", name: "LGPL 3.0" },
  { id: "AGPL-3.0", name: "AGPL 3.0" },
  { id: "Unlicense", name: "Unlicense" },
];

function choiceFor(id: string, known: PolicyChoice[]): PolicyChoice {
  return known.find((item) => item.id === id) ?? { id, name: id };
}

function PolicyPickList({
  label,
  value,
  choices,
  onChange,
}: {
  label: string;
  value: string[];
  choices: PolicyChoice[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const extras = value.filter((id) => !choices.some((item) => item.id === id)).map((id) => choiceFor(id, []));
  const menu = [...choices, ...extras];
  const selected = value.map((id) => choiceFor(id, menu));

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  function toggle(id: string) {
    if (value.includes(id)) {
      if (value.length === 1) return;
      onChange(value.filter((item) => item !== id));
      return;
    }
    onChange([...value, id]);
  }

  return (
    <label className="field">
      <span>{label}</span>
      <div className={`policy-pick${open ? " is-open" : ""}`} ref={box}>
        <button
          type="button"
          className="policy-pick-toggle"
          aria-expanded={open}
          aria-haspopup="listbox"
          onClick={() => setOpen((current) => !current)}
        >
          <span className="policy-pick-chips">
            {selected.map((item) => (
              <span key={item.id} className="policy-pick-chip">
                <span className="policy-pick-mark" aria-hidden="true">
                  <PolicyMark id={item.id} />
                </span>
                {item.name}
              </span>
            ))}
          </span>
        </button>
        {open ? (
          <div className="policy-pick-menu" role="listbox" aria-multiselectable="true" aria-label={label}>
            {menu.map((item) => {
              const on = value.includes(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={on}
                  className={on ? "is-on" : ""}
                  onClick={() => toggle(item.id)}
                >
                  <span className="policy-pick-mark" aria-hidden="true">
                    <PolicyMark id={item.id} />
                  </span>
                  <span>{item.name}</span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </label>
  );
}

export const PENDING_DEPLOY_KEY = "shipdeck.pendingDeploy";
export const OPEN_DELIVERY_RUN_KEY = "shipdeck.openDeliveryRun";

function readOpenDeliveryRun(): string | null {
  try {
    return sessionStorage.getItem(OPEN_DELIVERY_RUN_KEY);
  } catch {
    return null;
  }
}
export const CONNECTIONS_FOLDER_KEY = "shipdeck.connectionsFolder";
export const CONNECTIONS_TYPE_KEY = "shipdeck.connectionsType";

function existingTargetPayload(
  changeKind: "new_app" | "existing_repo",
  fields: {
    kind: DeliveryExistingKind;
    host: string;
    port: string;
    user: string;
    password: string;
    privateKey: string;
    region: string;
    projectId: string;
    subscriptionId: string;
    tenantId: string;
    serviceName: string;
    serviceUrl: string;
    accessKeyId: string;
    secretAccessKey: string;
    clientId: string;
    clientSecret: string;
    credentialsJson: string;
  }
): DeliveryExistingTargetInput | undefined {
  if (changeKind !== "existing_repo") return undefined;
  return {
    kind: fields.kind,
    host: fields.host.trim() || undefined,
    port: fields.port.trim() || undefined,
    user: fields.user.trim() || undefined,
    password: fields.password.trim() || undefined,
    privateKey: fields.privateKey.trim() || undefined,
    region: fields.region.trim() || undefined,
    projectId: fields.projectId.trim() || undefined,
    subscriptionId: fields.subscriptionId.trim() || undefined,
    tenantId: fields.tenantId.trim() || undefined,
    serviceName: fields.serviceName.trim() || undefined,
    serviceUrl: fields.serviceUrl.trim() || undefined,
    accessKeyId: fields.accessKeyId.trim() || undefined,
    secretAccessKey: fields.secretAccessKey.trim() || undefined,
    clientId: fields.clientId.trim() || undefined,
    clientSecret: fields.clientSecret.trim() || undefined,
    credentialsJson: fields.credentialsJson.trim() || undefined,
  };
}

function existingTargetDraft(fields: {
  kind: DeliveryExistingKind;
  host: string;
  port: string;
  user: string;
  password: string;
  privateKey: string;
  region: string;
  projectId: string;
  subscriptionId: string;
  tenantId: string;
  serviceName: string;
  serviceUrl: string;
  accessKeyId: string;
  secretAccessKey: string;
  clientId: string;
  clientSecret: string;
  credentialsJson: string;
}): CreateConnectionInput {
  if (fields.kind === "ssh") {
    return {
      name: "Existing VM",
      type: "ssh",
      config: {
        host: fields.host.trim(),
        port: fields.port.trim() || "22",
        user: fields.user.trim() || "ubuntu",
      },
      secrets: {
        ...(fields.password.trim() ? { password: fields.password.trim() } : {}),
        ...(fields.privateKey.trim() ? { privateKey: fields.privateKey.trim() } : {}),
      },
    };
  }
  const parsed = fields.serviceUrl.trim() ? parseServerlessUrl(fields.serviceUrl) : undefined;
  if (fields.kind === "aws") {
    return {
      name: "Existing AWS",
      type: "aws",
      config: {
        region: fields.region.trim() || parsed?.region || "",
        serviceUrl: parsed?.serviceUrl || fields.serviceUrl.trim(),
        serviceName: fields.serviceName.trim() || parsed?.serviceId || "",
      },
      secrets: {
        accessKeyId: fields.accessKeyId.trim(),
        secretAccessKey: fields.secretAccessKey.trim(),
      },
    };
  }
  if (fields.kind === "azure") {
    return {
      name: "Existing Azure",
      type: "azure",
      config: {
        subscriptionId: fields.subscriptionId.trim(),
        tenantId: fields.tenantId.trim(),
        serviceUrl: parsed?.serviceUrl || fields.serviceUrl.trim(),
        serviceName: fields.serviceName.trim() || parsed?.serviceId || "",
      },
      secrets: {
        clientId: fields.clientId.trim(),
        clientSecret: fields.clientSecret.trim(),
      },
    };
  }
  return {
    name: "Existing GCP",
    type: "gcp",
    config: {
      project_id: fields.projectId.trim(),
      serviceUrl: parsed?.serviceUrl || fields.serviceUrl.trim(),
      serviceName: fields.serviceName.trim() || parsed?.serviceId || "",
    },
    secrets: {
      credentialsJson: fields.credentialsJson.trim(),
    },
  };
}

function existingTargetLabel(target: NonNullable<DeliveryRun["existingTarget"]>): string {
  if (target.kind === "ssh") return `SSH ${target.user || "ubuntu"}@${target.host}`;
  if (target.serviceUrl) {
    const parsed = parseServerlessUrl(target.serviceUrl);
    return parsed ? describeServerlessUrl(parsed) : target.serviceUrl;
  }
  if (target.kind === "aws") return `AWS ${target.serviceName || target.region || "serverless"}`;
  if (target.kind === "azure") return `Azure ${target.serviceName || target.subscriptionId || "serverless"}`;
  return `GCP ${target.serviceName || target.projectId || "serverless"}`;
}

export function DeliveryStudio(props: {
  onOpenConnections?: () => void;
  live?: boolean;
  projectId?: string;
  mode?: "simulate" | "live";
}) {
  const [policy, setPolicy] = useState<DeliveryPolicyPublic | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [runs, setRuns] = useState<DeliveryRun[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openedOnlyId, setOpenedOnlyId] = useState<string | null>(readOpenDeliveryRun);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [targetConnectionId, setTargetConnectionId] = useState("");
  const mode = props.mode ?? (props.live ? "live" : "simulate");
  const [changeKind, setChangeKind] = useState<"new_app" | "existing_repo">("new_app");
  const [repoUrl, setRepoUrl] = useState("");
  const [existingKind, setExistingKind] = useState<DeliveryExistingKind>("ssh");
  const [existingHost, setExistingHost] = useState("");
  const [existingPort, setExistingPort] = useState("22");
  const [existingUser, setExistingUser] = useState("ubuntu");
  const [existingPassword, setExistingPassword] = useState("");
  const [existingPrivateKey, setExistingPrivateKey] = useState("");
  const [existingRegion, setExistingRegion] = useState("");
  const [existingProjectId, setExistingProjectId] = useState("");
  const [existingSubscriptionId, setExistingSubscriptionId] = useState("");
  const [existingTenantId, setExistingTenantId] = useState("");
  const [existingServiceName, setExistingServiceName] = useState("");
  const [existingServiceUrl, setExistingServiceUrl] = useState("");
  const [existingAccessKeyId, setExistingAccessKeyId] = useState("");
  const [existingSecretAccessKey, setExistingSecretAccessKey] = useState("");
  const [existingClientId, setExistingClientId] = useState("");
  const [existingClientSecret, setExistingClientSecret] = useState("");
  const [existingCredentialsJson, setExistingCredentialsJson] = useState("");
  const [ticketKey, setTicketKey] = useState("");
  const [ticketSummary, setTicketSummary] = useState("");
  const [ticketDescription, setTicketDescription] = useState("");
  const [ticketAcceptance, setTicketAcceptance] = useState("");
  const [ticketComments, setTicketComments] = useState<string[]>([]);
  const [ticketAttachments, setTicketAttachments] = useState<DeliveryTicketAttachment[]>([]);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [rulesNote, setRulesNote] = useState<string | null>(null);
  const [pinLoadedTicket, setPinLoadedTicket] = useState(false);
  const [targetTesting, setTargetTesting] = useState(false);
  const [targetTest, setTargetTest] = useState<{
    ok: boolean;
    summary: string;
    technical?: string;
    hint?: string;
  } | null>(null);

  const selected = runs.find((run) => run.id === selectedId) ?? null;

  function currentExistingTarget() {
    return existingTargetPayload(changeKind, {
      kind: existingKind,
      host: existingHost,
      port: existingPort,
      user: existingUser,
      password: existingPassword,
      privateKey: existingPrivateKey,
      region: existingRegion,
      projectId: existingProjectId,
      subscriptionId: existingSubscriptionId,
      tenantId: existingTenantId,
      serviceName: existingServiceName,
      serviceUrl: existingServiceUrl,
      accessKeyId: existingAccessKeyId,
      secretAccessKey: existingSecretAccessKey,
      clientId: existingClientId,
      clientSecret: existingClientSecret,
      credentialsJson: existingCredentialsJson,
    });
  }

  function currentExistingDraft() {
    return existingTargetDraft({
      kind: existingKind,
      host: existingHost,
      port: existingPort,
      user: existingUser,
      password: existingPassword,
      privateKey: existingPrivateKey,
      region: existingRegion,
      projectId: existingProjectId,
      subscriptionId: existingSubscriptionId,
      tenantId: existingTenantId,
      serviceName: existingServiceName,
      serviceUrl: existingServiceUrl,
      accessKeyId: existingAccessKeyId,
      secretAccessKey: existingSecretAccessKey,
      clientId: existingClientId,
      clientSecret: existingClientSecret,
      credentialsJson: existingCredentialsJson,
    });
  }

  async function testExistingTarget() {
    setTargetTesting(true);
    setTargetTest(null);
    try {
      if (!targetConnectionId) {
        setTargetTest({
          ok: false,
          summary: "Pick a Deploy connection first.",
          hint: "Add SSH or cloud credentials in Connections → Deploy, then select it here.",
        });
        return;
      }
      const result = await api.testConnection(targetConnectionId);
      setTargetTest({
        ok: result.ok,
        summary: result.summary || result.message,
        technical: result.technical,
        hint: result.hint,
      });
    } catch (err) {
      setTargetTest({
        ok: false,
        summary: "Could not run the connection test.",
        technical: err instanceof Error ? err.message : String(err),
        hint: "Check that the API is running, then try again.",
      });
    } finally {
      setTargetTesting(false);
    }
  }

  const refresh = useCallback(async () => {
    const [nextPolicy, nextRuns, nextPipelines, nextConnections] = await Promise.all([
      api.deliveryPolicy(),
      api.deliveryRuns(props.projectId),
      api.pipelines(props.projectId).catch(() => [] as Pipeline[]),
      api.connections().catch(() => [] as Connection[]),
    ]);
    setPolicy(
      nextPolicy.pipelineId && !nextPipelines.some((pipeline) => pipeline.id === nextPolicy.pipelineId)
        ? { ...nextPolicy, pipelineId: "" }
        : nextPolicy
    );
    setRuns(nextRuns);
    setPipelines(nextPipelines);
    setConnections(nextConnections);
    setSelectedId((current) => {
      const opened = readOpenDeliveryRun();
      if (opened && nextRuns.some((run) => run.id === opened)) return opened;
      if (current && nextRuns.some((run) => run.id === current)) return current;
      return latestTicketRuns(nextRuns)[0]?.id ?? null;
    });
  }, [props.projectId]);

  const buildConnections = connections.filter((item) => connectionFolder(item.type) === "build");
  const jiraConnections = buildConnections.filter((item) => item.type === "jira");
  const modelConnections = buildConnections.filter((item) => item.type === "model");
  const gitConnections = connections.filter((item) => item.type === "git");
  const targetConnections = connections.filter((item) => isTargetConnectionType(item.type));
  const selectedTarget = targetConnections.find((item) => item.id === targetConnectionId);

  function openConnections(folder: ConnectionFolder, type?: ConnectionType) {
    sessionStorage.setItem(CONNECTIONS_FOLDER_KEY, folder);
    if (type) sessionStorage.setItem(CONNECTIONS_TYPE_KEY, type);
    props.onOpenConnections?.();
  }

  async function useBuildConnection(
    field: "jiraConnectionId" | "planModelConnectionId" | "codeModelConnectionId" | "gitConnectionId",
    id: string
  ) {
    if (!policy) return;
    const next = { ...policy, [field]: id };
    setPolicy(next);
    const saved = await api.saveDeliveryPolicy(next);
    setPolicy(saved);
  }

  useEffect(() => {
    refresh().catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [refresh]);

  useEffect(() => {
    if (changeKind !== "existing_repo") {
      setRulesNote(null);
      return;
    }
    const url = repoUrl.trim();
    if (!/github\.com[:/][^/\s]+\/[^/\s]+/i.test(url)) return;
    let cancel = false;
    const timer = window.setTimeout(() => {
      void api
        .deliveryProjectRules(url)
        .then((result) => {
          if (cancel) return;
          setPolicy(result.policy);
          const languages = result.allowedLanguages.map((id) => choiceFor(id, LANGUAGE_CHOICES).name).join(", ");
          const sources = result.allowedPackageSources.map((id) => choiceFor(id, PACKAGE_CHOICES).name).join(", ");
          const licenses = result.allowedLicenses.map((id) => choiceFor(id, LICENSE_CHOICES).name).join(", ");
          setRulesNote(`Taken from this repository: ${languages}. Packages: ${sources}. License: ${licenses}.`);
        })
        .catch((err) => {
          if (!cancel) setRulesNote(err instanceof Error ? err.message : String(err));
        });
    }, 400);
    return () => {
      cancel = true;
      window.clearTimeout(timer);
    };
  }, [changeKind, repoUrl]);

  useEffect(() => {
    const opened = readOpenDeliveryRun();
    if (!opened) return;
    setOpenedOnlyId(opened);
    setSelectedId(opened);
    const timer = window.setTimeout(() => {
      try {
        sessionStorage.removeItem(OPEN_DELIVERY_RUN_KEY);
      } catch {
        /* ignore */
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!busy || !selectedId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const next = await api.deliveryRuns(props.projectId);
        if (!cancelled) setRuns(next);
      } catch {
        /* keep the last known run while a long approve is in flight */
      }
    };
    void tick();
    const timer = window.setInterval(tick, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [busy, selectedId]);

  async function runAction(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await work();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function startThisTicket() {
    return runAction(async () => {
      const result = await api.startDelivery({
        source: "jira",
        mode,
        changeKind,
        projectId: props.projectId,
        repoUrl,
        existingConnectionId: changeKind === "existing_repo" ? targetConnectionId || undefined : undefined,
        existingServiceUrl: changeKind === "existing_repo" ? existingServiceUrl || undefined : undefined,
        ticket: {
          key: ticketKey.trim(),
          summary: ticketSummary.trim() || ticketKey.trim(),
          description: ticketDescription,
          acceptance: ticketAcceptance
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean),
          comments: ticketComments,
          attachments: ticketAttachments,
        },
      });
      setTicketSummary(result.run.ticket.summary);
      setTicketDescription(result.run.ticket.description);
      setTicketAcceptance(result.run.ticket.acceptance.join("\n"));
      setTicketComments(result.run.ticket.comments ?? []);
      setTicketAttachments(result.run.ticket.attachments ?? []);
      setNotice(
        result.duplicate
          ? `${result.run.ticket.key} already has an open run.`
          : `Started ${result.run.ticket.key} in ${result.run.mode} mode.`
      );
      setPinLoadedTicket(false);
      setOpenedOnlyId(null);
      setSelectedId(result.run.id);
      setRuns(await api.deliveryRuns(props.projectId));
    });
  }

  const active = selected ? deliveryRunActive(selected.status) : false;
  const currentTickets = openedOnlyId
    ? runs.filter((run) => run.id === openedOnlyId)
    : latestTicketRuns(runs);
  const showingEarlier =
    selected != null && !openedOnlyId && currentTickets.every((run) => run.id !== selected.id);
  const loadedKey = ticketKey.trim();
  const pickerTickets = [...currentTickets].sort((a, b) => a.ticket.key.localeCompare(b.ticket.key));
  const showLoadedDraft =
    pinLoadedTicket &&
    !openedOnlyId &&
    Boolean(loadedKey) &&
    !pickerTickets.some((run) => run.ticket.key === loadedKey);
  const pickerValue = showLoadedDraft ? `loaded:${loadedKey}` : (selected?.id ?? "");

  const vendorNames = policy
    ? [...new Set([modelProviderById(policy.planModel.provider).label, modelProviderById(policy.codeModel.provider).label])]
    : [];

  return (
    <div className="delivery">
      {error && <div className="error-banner">{error}</div>}
      {notice && <p className="delivery-notice">{notice}</p>}
      {busy && (
        <p className="delivery-notice" role="status">
          {selected?.logs.at(-1)?.startsWith("Now:") || selected?.logs.at(-1)?.includes("failed")
            ? selected.logs.at(-1)
            : "Working… the Activity log will show each step (model, folder, GitHub)."}
        </p>
      )}

      {policy && (
        <section className="delivery-use-connections">
          <div className="delivery-command-head">
            <div>
              <h3>Logins for this ticket</h3>
            </div>
            <div className="row-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() =>
                  runAction(async () => {
                    const saved = await api.saveDeliveryPolicy(policy);
                    setPolicy(saved);
                    const git = gitConnections.find((item) => item.id === saved.gitConnectionId);
                    setNotice(git ? `Saved. This ticket will use ${git.name}.` : "Saved.");
                  })
                }
              >
                Save
              </button>
              <button type="button" className="btn" onClick={() => openConnections("build")}>
                Open logins
              </button>
            </div>
          </div>
          <div className="delivery-command-grid">
            <label className="field">
              <span>Jira</span>
              <select
                value={policy.jiraConnectionId || ""}
                onChange={(e) => void useBuildConnection("jiraConnectionId", e.target.value)}
              >
                <option value="">{jiraConnections.length ? "Select a Jira connection" : "No Jira connection yet"}</option>
                {jiraConnections.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                    {item.config.siteUrl ? ` · ${item.config.siteUrl}` : ""}
                    {item.hasSecrets ? "" : " · no token"}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Plan model</span>
              <select
                value={policy.planModelConnectionId || ""}
                onChange={(e) => void useBuildConnection("planModelConnectionId", e.target.value)}
              >
                <option value="">{modelConnections.length ? "Select a plan model" : "No model connection yet"}</option>
                {modelConnections.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                    {item.config.provider ? ` · ${modelProviderById(item.config.provider).label}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Code model</span>
              <select
                value={policy.codeModelConnectionId || ""}
                onChange={(e) => void useBuildConnection("codeModelConnectionId", e.target.value)}
              >
                <option value="">{modelConnections.length ? "Select a code model" : "No model connection yet"}</option>
                {modelConnections.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                    {item.config.provider ? ` · ${modelProviderById(item.config.provider).label}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Git</span>
              <select
                value={policy.gitConnectionId || ""}
                onChange={(e) => void useBuildConnection("gitConnectionId", e.target.value)}
              >
                <option value="">{gitConnections.length ? "Select a Git connection" : "No Git connection yet"}</option>
                {gitConnections.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                    {item.config.url ? ` · ${item.config.url}` : item.config.gitHost ? ` · ${item.config.gitHost}` : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {(!policy.jiraConnectionId || !policy.planModelConnectionId) && (
            <p className="muted">
              Missing a connection?{" "}
              <button type="button" className="btn btn-ghost" onClick={() => openConnections("build", "jira")}>
                Add it in Connections
              </button>
            </p>
          )}
        </section>
      )}

      <details className="delivery-policy">
        <summary>
          <span className="delivery-policy-copy">
            <span>Rules for this project</span>
            <span className="delivery-policy-hint">Who approves, spending limit, where tests run</span>
          </span>
          <span className="delivery-policy-toggle">
            <span className="when-closed">Expand</span>
            <span className="when-open">Hide</span>
            <span className="chev" aria-hidden="true" />
          </span>
        </summary>
          {policy && (
            <div className="delivery-policy-grid">
              <label className="field">
                <span>Identity</span>
                <input value="Local login" readOnly />
              </label>
              <label className="field">
                <span>Sandbox</span>
                <select
                  value={policy.sandbox}
                  onChange={(e) => setPolicy({ ...policy, sandbox: e.target.value as DeliveryPolicyPublic["sandbox"] })}
                >
                  <option value="docker-local">Docker on this machine</option>
                  <option value="dedicated-runner">Dedicated runner</option>
                </select>
              </label>
              <PolicyPickList
                label="Allowed languages"
                value={policy.allowedLanguages}
                choices={LANGUAGE_CHOICES}
                onChange={(allowedLanguages) => setPolicy({ ...policy, allowedLanguages })}
              />
              <PolicyPickList
                label="Package sources"
                value={policy.allowedPackageSources}
                choices={PACKAGE_CHOICES}
                onChange={(allowedPackageSources) => setPolicy({ ...policy, allowedPackageSources })}
              />
              <PolicyPickList
                label="Licenses"
                value={policy.allowedLicenses}
                choices={LICENSE_CHOICES}
                onChange={(allowedLicenses) => setPolicy({ ...policy, allowedLicenses })}
              />
              {rulesNote ? <p className="muted delivery-field-wide">{rulesNote}</p> : null}
              <label className="field">
                <span>Token cap</span>
                <input
                  type="number"
                  value={policy.tokenCap}
                  onChange={(e) => setPolicy({ ...policy, tokenCap: Number(e.target.value) })}
                />
              </label>
              <label className="field">
                <span>Cost cap (USD)</span>
                <input
                  type="number"
                  value={policy.costCapUsd}
                  onChange={(e) => setPolicy({ ...policy, costCapUsd: Number(e.target.value) })}
                />
              </label>
              <label className="field">
                <span>Rollback owner</span>
                <input value={policy.rollbackOwner} onChange={(e) => setPolicy({ ...policy, rollbackOwner: e.target.value })} />
              </label>
              <label className="field">
                <span>Architecture approver</span>
                <input
                  value={policy.architectureApprover}
                  onChange={(e) => setPolicy({ ...policy, architectureApprover: e.target.value })}
                />
              </label>
              <label className="field">
                <span>Code reviewer</span>
                <input value={policy.codeReviewer} onChange={(e) => setPolicy({ ...policy, codeReviewer: e.target.value })} />
              </label>
              <label className="field">
                <span>Deploy approver</span>
                <input
                  value={policy.deployApprover}
                  onChange={(e) => setPolicy({ ...policy, deployApprover: e.target.value })}
                />
              </label>
              <label className="field">
                <span>Dev target</span>
                <input
                  value={policy.devTargetLabel}
                  onChange={(e) => setPolicy({ ...policy, devTargetLabel: e.target.value })}
                />
              </label>
              <label className="field">
                <span>Shipdeck pipeline</span>
                <select
                  value={policy.pipelineId}
                  onChange={(e) => setPolicy({ ...policy, pipelineId: e.target.value })}
                >
                  <option value="">Select for live handoff</option>
                  {pipelines.map((pipeline) => (
                    <option key={pipeline.id} value={pipeline.id}>
                      {pipeline.name}
                    </option>
                  ))}
                </select>
              </label>
              <p className="muted">Test bar required before deploy: lint, unit, integration. Fixtures only.</p>
              <div className="row-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() =>
                    runAction(async () => {
                      const saved = await api.saveDeliveryPolicy(policy);
                      setPolicy(saved);
                      setNotice("Policy saved. Credentials stay in Connections.");
                    })
                  }
                >
                  Save policy
                </button>
              </div>
            </div>
          )}
        </details>

      <section className="delivery-command">
        <div className="delivery-command-head">
          <div>
            <h3>Jira ticket</h3>
          </div>
          {ticketSummary ? (
            <p className="delivery-loaded">
              Loaded <strong>{ticketKey}</strong> — {ticketSummary}
              {ticketAcceptance
                ? ` · ${ticketAcceptance.split("\n").filter(Boolean).length} acceptance lines`
                : ""}
              {ticketAttachments.length ? ` · ${ticketAttachments.length} attachment${ticketAttachments.length === 1 ? "" : "s"}` : ""}
            </p>
          ) : (
            <p className="muted">Type a key such as KAN-1.</p>
          )}
        </div>
        {ticketAttachments.length > 0 && ticketKey.trim() && !showLoadedDraft && (
          <TicketAttachmentList items={ticketAttachments} source={{ kind: "jira", key: ticketKey.trim() }} />
        )}
        <div className="delivery-command-grid">
          <label className="field">
            <span>Change type</span>
            <select value={changeKind} onChange={(e) => setChangeKind(e.target.value as "new_app" | "existing_repo")}>
              <option value="new_app">New application</option>
              <option value="existing_repo">Change an existing repository</option>
            </select>
          </label>
          {(changeKind === "existing_repo" ||
            Boolean(policy?.git.autoOpenPr) ||
            vendorContract(policy?.codeModel.provider ?? "private").needs.includes("githubRepo")) && (
            <label className="field">
              <span>Repository URL</span>
              <input value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} placeholder="https://github.com/org/service" />
            </label>
          )}
          <label className="field">
            <span>Jira issue key</span>
            <input value={ticketKey} onChange={(e) => setTicketKey(e.target.value)} placeholder="SCRUM-1" />
          </label>
        </div>
        {changeKind === "existing_repo" && (
          <div className="delivery-target">
            <div className="delivery-target-head">
              <p className="delivery-kicker">Existing deploy target</p>
              <p className="muted">
                Pick an SSH or cloud connection from Connections → Deploy. Do not paste keys here.
                {selectedTarget?.type !== "ssh"
                  ? " If that connection has no live URL yet, paste only the running service URL."
                  : ""}
              </p>
            </div>
            <div className="delivery-command-grid">
              <label className="field">
                <span>Deploy connection</span>
                <select
                  value={targetConnectionId}
                  onChange={(e) => {
                    setTargetConnectionId(e.target.value);
                    setTargetTest(null);
                    const conn = targetConnections.find((item) => item.id === e.target.value);
                    if (conn?.config.serviceUrl) setExistingServiceUrl(conn.config.serviceUrl);
                  }}
                >
                  <option value="">{targetConnections.length ? "Select SSH, AWS, Azure, or GCP" : "No Deploy connection yet"}</option>
                  {targetConnections.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} · {item.type.toUpperCase()}
                      {item.config.host ? ` · ${item.config.host}` : item.config.serviceUrl ? ` · ${item.config.serviceUrl}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              {selectedTarget && selectedTarget.type !== "ssh" && (
                <label className="field delivery-field-wide">
                  <span>Live service URL {selectedTarget.config.serviceUrl ? "(saved on the connection)" : ""}</span>
                  <input
                    value={existingServiceUrl}
                    onChange={(e) => setExistingServiceUrl(e.target.value)}
                    placeholder="https://….ecs.eu-west-1.on.aws"
                  />
                </label>
              )}
            </div>
            {!targetConnections.length && (
              <button type="button" className="btn" onClick={() => openConnections("deploy", "ssh")}>
                Add a Deploy connection
              </button>
            )}
            <div className="delivery-target-actions">
              <button
                type="button"
                className="btn"
                disabled={targetTesting || busy}
                onClick={() => void testExistingTarget()}
              >
                {targetTesting ? "Testing…" : "Test connection"}
              </button>
              {targetTest && (
                <p className={targetTest.ok ? "delivery-notice" : "delivery-block"} role="status">
                  <strong>{targetTest.ok ? "Connected" : "Failed"}</strong> — {targetTest.summary}
                  {targetTest.hint ? ` ${targetTest.hint}` : ""}
                </p>
              )}
            </div>
          </div>
        )}
        <div className="delivery-command-actions">
          <button
            type="button"
            className="btn"
            disabled={busy || !ticketKey.trim()}
            onClick={() =>
              runAction(async () => {
                const ticket = await api.deliveryJiraIssue(ticketKey.trim());
                setTicketKey(ticket.key);
                setTicketSummary(ticket.summary);
                setTicketDescription(ticket.description);
                setTicketAcceptance(ticket.acceptance.join("\n"));
                setTicketComments(ticket.comments ?? []);
                setTicketAttachments(ticket.attachments ?? []);
                setNotice(
                  ticket.attachments?.length
                    ? `Loaded ${ticket.key} from Jira with ${ticket.attachments.length} attachment${ticket.attachments.length === 1 ? "" : "s"}.`
                    : `Loaded ${ticket.key} from Jira.`
                );
                const existing = latestTicketRuns(runs).find((run) => run.ticket.key === ticket.key);
                if (existing) {
                  setPinLoadedTicket(false);
                  setSelectedId(existing.id);
                } else {
                  setPinLoadedTicket(true);
                  setSelectedId(null);
                }
              })
            }
          >
            Load from Jira
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !ticketKey.trim()}
            onClick={() => void startThisTicket()}
          >
            Start this ticket
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() =>
              runAction(async () => {
                const result = await api.startDelivery({
                  source: "sample",
                  mode,
                  changeKind,
                  projectId: props.projectId,
                  repoUrl,
                  existingConnectionId: changeKind === "existing_repo" ? targetConnectionId || undefined : undefined,
                  existingServiceUrl: changeKind === "existing_repo" ? existingServiceUrl || undefined : undefined,
                });
                setNotice(result.duplicate ? `${result.run.ticket.key} already has an open run.` : `Started ${result.run.ticket.key}.`);
                setPinLoadedTicket(false);
                setOpenedOnlyId(null);
                setSelectedId(result.run.id);
                setRuns(await api.deliveryRuns(props.projectId));
              })
            }
          >
            Run sample ticket
          </button>
        </div>
      </section>

      <div className="delivery-body">
        <aside className="delivery-rail">
          <div className="delivery-rail-head">
            <p className="delivery-kicker">{openedOnlyId ? "Opened run" : "Your tickets"}</p>
            <h3>{openedOnlyId ? "This run" : "Current ticket"}</h3>
          </div>
          {!runs.length && !showLoadedDraft ? (
            <p className="muted">No tickets yet. Load a Jira key above, or try the sample.</p>
          ) : (
            <div className="delivery-picker">
              <label className="field">
                <span>All tickets</span>
                <select
                  value={pickerValue}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value.startsWith("loaded:")) {
                      setPinLoadedTicket(true);
                      setSelectedId(null);
                      return;
                    }
                    setPinLoadedTicket(false);
                    setSelectedId(value);
                  }}
                >
                  {showLoadedDraft ? (
                    <option value={`loaded:${loadedKey}`}>
                      {loadedKey} — {ticketSummary || "Loaded from Jira"}
                    </option>
                  ) : null}
                  {pickerTickets.map((run) => (
                    <option key={run.id} value={run.id}>
                      {run.ticket.key} — {run.ticket.summary}
                    </option>
                  ))}
                </select>
              </label>
              <p className="delivery-current" data-tone={showLoadedDraft ? "run" : selected ? statusTone(selected.status) : undefined}>
                <strong>{showLoadedDraft ? loadedKey : selected?.ticket.key}</strong>
                <em>{showLoadedDraft ? ticketSummary : selected?.ticket.summary}</em>
                <span>
                  {showLoadedDraft
                    ? "Loaded from Jira. Press Start this ticket."
                    : selected
                      ? `${statusLabel(selected.status)}${
                          selected.implementation?.pullRequestUrl &&
                          !selected.implementation.pullRequestUrl.startsWith("simulate://")
                            ? " · Pull request created"
                            : ""
                        }`
                      : ""}
                </span>
              </p>
            </div>
          )}
        </aside>

        <section className="delivery-work">
          {!selected || !policy ? (
            showLoadedDraft ? (
              <LoadedTicketPreview
                ticketKey={loadedKey}
                summary={ticketSummary}
                description={ticketDescription}
                acceptance={ticketAcceptance}
                comments={ticketComments}
                attachments={ticketAttachments}
                busy={busy}
                onStart={() => void startThisTicket()}
              />
            ) : (
              <div className="delivery-empty">
                <p className="delivery-kicker">Step 3</p>
                <h3>The plan will open here</h3>
                <p className="muted">After you load a ticket, read it here, then press Start this ticket.</p>
              </div>
            )
          ) : (
            <>
              <div className="delivery-work-head">
                <div>
                  <p className="delivery-kicker">{selected.ticket.key}</p>
                  <h3>{selected.ticket.summary}</h3>
                  {showingEarlier ? <p className="muted">This is an earlier run. It stays in History.</p> : null}
                </div>
                <div className="delivery-meta">
                  <span className={`meta-pill ${selected.mode === "simulate" ? "meta-safe" : "meta-live"}`}>{selected.mode === "simulate" ? "Practice" : "Real cloud"}</span>
                  <span className="meta-pill meta-neutral">{selected.changeKind === "new_app" ? "New app" : "Existing repo"}</span>
                  {selected.existingTarget ? (
                    <span className="meta-pill meta-neutral">{existingTargetLabel(selected.existingTarget)}</span>
                  ) : null}
                  <span className="meta-pill meta-neutral">Rollback · {selected.rollbackOwner}</span>
                  <span className={`delivery-status tone-${statusTone(selected.status)}`}>{statusLabel(selected.status)}</span>
                </div>
              </div>
              <ol className="delivery-stepper">
                {STEPS.map((step, index) => (
                  <li key={step.label} className={stepState(selected, index)}>
                    <FlowScene scene={step.scene} />
                    <span>{step.label}</span>
                  </li>
                ))}
              </ol>
              <p className="delivery-next">
                <strong>What to do</strong>
                {nextHint(selected)}
              </p>
              {selected.implementation?.pullRequestUrl && !selected.implementation.pullRequestUrl.startsWith("simulate://") ? (
                <p className="delivery-notice">
                  Pull request created.{" "}
                  <a href={selected.implementation.pullRequestUrl} target="_blank" rel="noreferrer">
                    {selected.implementation.pullRequestUrl}
                  </a>
                </p>
              ) : null}
              {selected.implementation ? (
                <div className="row-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      const opened = window.open(
                        `/?view=workbench&run=${encodeURIComponent(selected.id)}`,
                        `shipdeck-workbench-${selected.id}`,
                        "noopener,width=1280,height=860"
                      );
                      opened?.focus();
                    }}
                  >
                    Open workbench
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      const opened = window.open(
                        `/?view=workbench&run=${encodeURIComponent(selected.id)}&role=test`,
                        `shipdeck-testbench-${selected.id}`,
                        "noopener,width=1280,height=860"
                      );
                      opened?.focus();
                    }}
                  >
                    Open test bench
                  </button>
                </div>
              ) : null}
              {selected.status === "failed" && selected.failureCode === "codegen" ? (
                <div className="row-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy}
                    onClick={() =>
                      runAction(async () => {
                        await api.decideDelivery(selected.id, { gate: "architecture", action: "approve" });
                        setRuns(await api.deliveryRuns(props.projectId));
                      })
                    }
                  >
                    Write the code again
                  </button>
                </div>
              ) : null}
              {busy && (
                <p className="delivery-notice" role="status">
                  Now doing: {selected.logs.at(-1) || "starting the next step"}
                </p>
              )}
              {selected.ticket.attachments.length > 0 && (
                <div className="delivery-card">
                  <div className="delivery-card-head">
                    <p className="delivery-kicker">Jira</p>
                    <h3>Ticket attachments</h3>
                  </div>
                  <p className="muted">Only files marked used go into architecture.md. Old test shots stay out.</p>
                  <TicketAttachmentList items={selected.ticket.attachments} source={{ kind: "run", id: selected.id }} />
                </div>
              )}
              {selected.blockedReason && (
                <p className="delivery-block">
                  Latest estimate is over the {selected.blockedReason === "token_cap" ? "token" : "cost"} cap. Raise the cap or narrow the ticket.
                </p>
              )}
              {selected.needsClarification && (
                <p className="delivery-block">Open questions must be answered before architecture approval.</p>
              )}
              {selected.failureMessage && <p className="delivery-block">{selected.failureMessage}</p>}
              {selected.changeKind === "existing_repo" &&
                selected.status !== "completed" &&
                selected.status !== "killed" &&
                selected.status !== "rejected" &&
                (selected.existingTarget ? (
                  <p className="delivery-notice" role="status">
                    Next version target: {existingTargetLabel(selected.existingTarget)}
                    {selected.existingTarget.hasAuth ? " · credentials stored. Approve deploy will create this connection." : "."}
                  </p>
                ) : (
                  <p className="delivery-block">
                    This ticket changes an existing repository. Pick a Deploy connection above, then save it so
                    Approve deploy can reuse that SSH or cloud target.
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busy}
                      onClick={() =>
                        runAction(async () => {
                          if (!targetConnectionId) throw new Error("Pick a Deploy connection first");
                          const run = await api.saveDeliveryExistingTarget(selected.id, {
                            existingConnectionId: targetConnectionId,
                            existingServiceUrl: existingServiceUrl || undefined,
                          });
                          setNotice(
                            run.existingTarget
                              ? `Saved ${existingTargetLabel(run.existingTarget)} for ${run.ticket.key}.`
                              : "Saved the existing deploy target."
                          );
                          setRuns(await api.deliveryRuns(props.projectId));
                        })
                      }
                    >
                      Save deploy target
                    </button>
                  </p>
                ))}

              <div className="delivery-kpis">
                <div>
                  <span>To implement architecture.md</span>
                  <strong>{selected.estimate.totalTokens.toLocaleString()}</strong>
                  <em>tokens</em>
                </div>
                <div>
                  <span>Forecast to write the code</span>
                  <strong>${selected.estimate.costUsd.toFixed(2)}</strong>
                  <em>list-rate estimate</em>
                </div>
                <div>
                  <span>
                    {selected.usage.calls > 0
                      ? selected.mode === "live"
                        ? `Recorded usage · ${vendorNames.join(" / ")}`
                        : "Recorded usage"
                      : "Recorded usage · Live only"}
                  </span>
                  <strong>{selected.usage.tokens.toLocaleString()}</strong>
                  <em>
                    ${selected.usage.costUsd.toFixed(2)} · {selected.usage.calls} calls
                  </em>
                </div>
                <div>
                  <span>Policy cap</span>
                  <strong>{policy.tokenCap.toLocaleString()}</strong>
                  <em>${policy.costCapUsd} cost cap</em>
                </div>
              </div>
              <p className="muted delivery-kpi-note">
                {selected.estimate.assumptions[0] ??
                  "After you approve architecture.md, this is the rough tokens and money to implement that file and write the code."}
                {selected.mode === "live" || selected.usage.calls > 0
                  ? " Recorded usage is what the model reports on each call, including a file edit from the workbench."
                  : " Simulate does not call a vendor, so recorded usage stays at zero."}
              </p>

              {selected.needsClarification ? (
                <div className="delivery-card">
                  <div className="delivery-card-head">
                    <p className="delivery-kicker">Gate</p>
                    <h3>Open questions</h3>
                  </div>
                  <p className="muted">
                    Answer these first. After you revise, architecture.md is written with charts, APIs, and
                    text. Then you can View, Download, revise again, or approve.
                  </p>
                  <ul className="delivery-list-plain">{selected.scope.ambiguities.map((item) => <li key={item}>{item}</li>)}</ul>
                </div>
              ) : (
                <>
                  <div className="delivery-card">
                    <div className="delivery-card-head">
                      <div>
                        <p className="delivery-kicker">The plan</p>
                        <h3>architecture.md</h3>
                      </div>
                      <div className="row-actions">
                        <button type="button" className="btn btn-primary" onClick={() => viewArchitecture(selected)}>
                          View
                        </button>
                        <button type="button" className="btn" onClick={() => downloadArchitecture(selected)}>
                          Download
                        </button>
                        {selected.approvals.some((item) => item.gate === "architecture" && item.action === "approve") ? (
                          <button
                            type="button"
                            className="btn"
                            onClick={() =>
                              void api
                                .downloadBriefSlides(`/api/briefs/by-delivery/${selected.id}/presentation`)
                                .catch((err) => setError(err instanceof Error ? err.message : String(err)))
                            }
                          >
                            Build the slides
                          </button>
                        ) : null}
                      </div>
                    </div>
                    <p className="muted">
                      Charts, APIs, and text. Revise until this file is right, then approve. Code and the feature
                      branch use this file. After you approve, Build the slides writes a technical PowerPoint from
                      this plan. Market research stays on the idea.
                    </p>
                    <pre className="delivery-arch">{selected.architecture.markdown}</pre>
                    {selected.scope.ambiguities.length > 0 && (
                      <>
                        <h4>Open questions</h4>
                        <ul className="delivery-list-plain">{selected.scope.ambiguities.map((item) => <li key={item}>{item}</li>)}</ul>
                      </>
                    )}
                  </div>
                  {selected.changeKind === "existing_repo" && selected.architecture.impactAnalysis ? (
                    <div className="delivery-card">
                      <div className="delivery-card-head">
                        <div>
                          <p className="delivery-kicker">Existing repository</p>
                          <h3>impact-analysis.md</h3>
                        </div>
                        <div className="row-actions">
                          <button
                            type="button"
                            className="btn"
                            onClick={() =>
                              void viewArchitecture(selected, {
                                title: `${selected.ticket.key} impact-analysis.md`,
                                markdown: selected.architecture.impactAnalysis,
                              })
                            }
                          >
                            View
                          </button>
                          <button type="button" className="btn" onClick={() => downloadImpactAnalysis(selected)}>
                            Download
                          </button>
                        </div>
                      </div>
                      <p className="muted">
                        What this change will do to the current system, where it lands, and what stays. Read this
                        with architecture.md before you approve the plan.
                      </p>
                      <pre className="delivery-arch">{selected.architecture.impactAnalysis}</pre>
                    </div>
                  ) : null}
                </>
              )}
              <div className="delivery-card">
                <div className="delivery-card-head">
                  <p className="delivery-kicker">Policy</p>
                  <h3>Standards applied</h3>
                </div>
                <ul className="delivery-list-plain">{selected.scope.standardsApplied.map((item) => <li key={item}>{item}</li>)}</ul>
              </div>

              {selected.implementation && (
                <div className="delivery-card">
                  <div className="delivery-card-head">
                    <p className="delivery-kicker">Code</p>
                    <h3>Implementation</h3>
                  </div>
                  <p>
                    Project folder <code>{selected.implementation.workspace}</code> · branch{" "}
                    <code>{selected.implementation.branch}</code> · license {selected.implementation.license} · secrets scan{" "}
                    {selected.implementation.secretsScan.clean ? "clean" : "failed"} · fixtures only
                  </p>
                  <p>Files: {selected.implementation.files.join(", ")}</p>
                  {selected.implementation.pullRequestUrl && !selected.implementation.pullRequestUrl.startsWith("simulate://") ? (
                    <p>
                      Pull request created.{" "}
                      <a href={selected.implementation.pullRequestUrl} target="_blank" rel="noreferrer">
                        {selected.implementation.pullRequestUrl}
                      </a>
                    </p>
                  ) : (
                    <p>{selected.implementation.pullRequestDetail}</p>
                  )}
                  <div className="row-actions">
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => {
                        const opened = window.open(
                          `/?view=workbench&run=${encodeURIComponent(selected.id)}`,
                          `shipdeck-workbench-${selected.id}`,
                          "noopener,width=1280,height=860"
                        );
                        opened?.focus();
                      }}
                    >
                      Open workbench
                    </button>
                  </div>
                </div>
              )}

              {selected.implementation && (
                <div className="delivery-card">
                  <div className="delivery-card-head">
                    <p className="delivery-kicker">Quality</p>
                    <h3>Test bar</h3>
                  </div>
                  <p className="muted">Testers open the test bench here. They edit cases, run lint, unit, and integration, then raise the pull request.</p>
                  {selected.checks.length > 0 && (
                    <ul className="delivery-checks">
                      {selected.checks.map((check) => (
                        <li key={check.name} data-status={check.status}>
                          <strong>{check.name}</strong>
                          <span>{check.status}</span>
                          <em>{check.detail}</em>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="row-actions">
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => {
                        const opened = window.open(
                          `/?view=workbench&run=${encodeURIComponent(selected.id)}&role=test`,
                          `shipdeck-testbench-${selected.id}`,
                          "noopener,width=1280,height=860"
                        );
                        opened?.focus();
                      }}
                    >
                      Open test bench
                    </button>
                  </div>
                </div>
              )}

              {selected.handoff && (
                <div className="delivery-card">
                  <div className="delivery-card-head">
                    <p className="delivery-kicker">Release</p>
                    <h3>Deploy handoff</h3>
                  </div>
                  <p>{selected.handoff.message}</p>
                  <p>
                    Target {selected.handoff.devTargetLabel}
                    {selected.handoff.deployRunId ? ` · Shipdeck run ${selected.handoff.deployRunId}` : ""}
                    {" · "}rollback owner {selected.handoff.rollbackOwner}
                  </p>
                </div>
              )}

              <div className="delivery-card">
                <div className="delivery-card-head">
                  <p className="delivery-kicker">Audit</p>
                  <h3>Activity</h3>
                </div>
                <pre className="delivery-arch">{selected.logs.join("\n")}</pre>
              </div>

              {selected.status === "architecture_review" && (
                <div className="delivery-actions delivery-gate">
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="What should change in the plan?"
                  />
                  <div className="row-actions">
                    <button
                      type="button"
                      className="btn"
                      disabled={busy || !note.trim()}
                      onClick={() =>
                        runAction(async () => {
                          const run = await api.reviseDelivery(selected.id, note.trim());
                          setNote("");
                          setRuns(await api.deliveryRuns(props.projectId));
                          setSelectedId(run.id);
                        })
                      }
                    >
                      Revise plan
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busy || selected.needsClarification}
                      onClick={() =>
                        runAction(async () => {
                          await api.decideDelivery(selected.id, { gate: "architecture", action: "approve" });
                          setRuns(await api.deliveryRuns(props.projectId));
                        })
                      }
                    >
                      Approve this plan
                    </button>
                    <button
                      type="button"
                      className="btn"
                      disabled={busy}
                      onClick={() =>
                        runAction(async () => {
                          await api.decideDelivery(selected.id, { gate: "architecture", action: "reject" });
                          setRuns(await api.deliveryRuns(props.projectId));
                        })
                      }
                    >
                      Reject
                    </button>
                  </div>
                </div>
              )}

              {(selected.status === "code_review" ||
                (selected.status === "failed" && selected.failureCode === "tests")) && (
                <div className="row-actions delivery-gate">
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() =>
                      runAction(async () => {
                        await api.runDeliveryTests(selected.id);
                        setRuns(await api.deliveryRuns(props.projectId));
                      })
                    }
                  >
                    {selected.status === "failed" ? "Run the tests again" : "Run the tests"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={
                      busy ||
                      selected.status !== "code_review" ||
                      !selected.checks.length ||
                      selected.checks.some((check) => check.status !== "passed")
                    }
                    onClick={() =>
                      runAction(async () => {
                        await api.decideDelivery(selected.id, { gate: "code_review", action: "approve" });
                        setRuns(await api.deliveryRuns(props.projectId));
                      })
                    }
                  >
                    Looks right — raise the pull request
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() =>
                      runAction(async () => {
                        await api.decideDelivery(selected.id, { gate: "code_review", action: "skip" });
                        setRuns(await api.deliveryRuns(props.projectId));
                      })
                    }
                  >
                    Skip tests
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() =>
                      runAction(async () => {
                        await api.decideDelivery(selected.id, { gate: "code_review", action: "reject" });
                        setRuns(await api.deliveryRuns(props.projectId));
                      })
                    }
                  >
                    Reject
                  </button>
                </div>
              )}

              {selected.status === "deploy_approval" && (
                <div className="row-actions delivery-gate">
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busy}
                      onClick={() =>
                        runAction(async () => {
                          const run = await api.decideDelivery(selected.id, { gate: "deploy", action: "approve" });
                          setRuns(await api.deliveryRuns(props.projectId));
                          setNotice(run.handoff?.message ?? "Deploy approved.");
                          sessionStorage.setItem(
                            PENDING_DEPLOY_KEY,
                            JSON.stringify({
                              runId: run.id,
                              ticketKey: run.ticket.key,
                              workspace: run.implementation?.workspace ?? "",
                              createdConnections: run.handoff?.createdConnections ?? [],
                              message: run.handoff?.message ?? "",
                            })
                          );
                          props.onOpenConnections?.();
                        })
                      }
                    >
                      Approve shipping — then choose logins
                    </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() =>
                      runAction(async () => {
                        await api.decideDelivery(selected.id, { gate: "deploy", action: "reject" });
                        setRuns(await api.deliveryRuns(props.projectId));
                      })
                    }
                  >
                    Reject
                  </button>
                </div>
              )}

              {active && (
                <div className="row-actions delivery-gate">
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() =>
                      runAction(async () => {
                        await api.killDelivery(selected.id);
                        setRuns(await api.deliveryRuns(props.projectId));
                      })
                    }
                  >
                    Kill switch
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function LoadedTicketPreview(props: {
  ticketKey: string;
  summary: string;
  description: string;
  acceptance: string;
  comments: string[];
  attachments: DeliveryTicketAttachment[];
  busy: boolean;
  onStart: () => void;
}) {
  const acceptance = props.acceptance
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return (
    <div className="delivery-loaded-ticket">
      <p className="delivery-kicker">From Jira</p>
      <h3>{props.ticketKey}</h3>
      {props.summary ? <p className="delivery-loaded-summary">{props.summary}</p> : null}
      <p className="muted">Read this, then press Start this ticket. The plan opens here after it starts.</p>
      {props.description.trim() ? (
        <>
          <h4>Description</h4>
          <p className="delivery-ticket-text">{props.description}</p>
        </>
      ) : null}
      {acceptance.length ? (
        <>
          <h4>Acceptance</h4>
          <ul className="delivery-list-plain">
            {acceptance.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </>
      ) : null}
      {props.comments.length ? (
        <>
          <h4>Comments</h4>
          <ul className="delivery-ticket-comments">
            {props.comments.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </>
      ) : null}
      {props.attachments.length ? (
        <>
          <h4>Attachments</h4>
          <TicketAttachmentList items={props.attachments} source={{ kind: "jira", key: props.ticketKey }} />
        </>
      ) : null}
      <div className="row-actions">
        <button type="button" className="btn btn-primary" disabled={props.busy || !props.ticketKey.trim()} onClick={props.onStart}>
          Start this ticket
        </button>
      </div>
    </div>
  );
}

function TicketAttachmentList(props: {
  items: DeliveryTicketAttachment[];
  source: { kind: "run"; id: string } | { kind: "jira"; key: string };
}) {
  return (
    <ul className="delivery-attachments">
      {props.items.map((item) => (
        <li
          key={`${item.id || ""}-${item.storedName || item.filename}`}
          data-used={item.relevant === true ? "yes" : item.relevant === false ? "no" : undefined}
        >
          <strong>{item.filename}</strong>
          <span>
            {[
              item.relevant === true ? "Used in architecture" : item.relevant === false ? "Not used" : item.kind,
              item.kind,
              item.mimeType,
              item.size ? `${item.size} bytes` : "",
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
          {item.relevanceReason ? <em>{item.relevanceReason}</em> : null}
          {(item.kind === "image" || /\.(png|jpe?g|gif|webp|svg)$/i.test(item.filename)) && (
            <AttachmentThumb name={item.storedName || item.filename} source={props.source} alt={item.filename} />
          )}
          {item.textExcerpt ? <pre>{item.textExcerpt}</pre> : null}
        </li>
      ))}
    </ul>
  );
}

function AttachmentThumb(props: {
  name: string;
  alt: string;
  source: { kind: "run"; id: string } | { kind: "jira"; key: string };
}) {
  const [src, setSrc] = useState("");
  const sourceKey = props.source.kind === "run" ? props.source.id : props.source.key;
  useEffect(() => {
    let url = "";
    let cancelled = false;
    const request =
      props.source.kind === "run"
        ? api.deliveryAttachment(props.source.id, props.name)
        : api.jiraAttachment(props.source.key, props.name);
    request
      .then((blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setSrc(url);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [props.name, props.source.kind, sourceKey]);
  if (!src) return <em className="muted">Image from the ticket</em>;
  return <img src={src} alt={props.alt} />;
}

