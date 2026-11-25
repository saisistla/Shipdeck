import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  Connection,
  ConnectionFolder,
  ConnectionType,
  CreateConnectionInput,
  DeliveryRun,
  Pipeline,
  PipelineBoxes,
  PipelineBoxType,
  PipelineRun,
  Project,
  StackDetection,
} from "@shipdeck/shared";
import {
  BOX_LABELS,
  PIPELINE_BOX_ORDER,
  PROVIDER_GROUPS,
  connectionFolder,
  DEFAULT_MODEL_JOBS,
  MODEL_JOB_OPTIONS,
  MODEL_JOBS,
  modelProviderById,
  modelUseLabel,
  modelUsesOf,
  modelUsesToRole,
  providersForJobs,
  type ModelJob,
  shouldAutofillHealthUrl,
  splitPublishPorts,
  suggestedHealthUrl,
  recommendVmSize,
  recommendServerlessSize,
  suggestServerlessKind,
  composeHasShipperPath,
  typesForFolder,
  vmSizeForProvider,
  approxRamGbForVmSize,
  listVmSizesForCloud,
  imageVersionForRegistry,
  type VmSizeRecommendation,
  type ServerlessSizingRecommendation,
  type ServerlessKind,
  type VmSizeOption,
} from "@shipdeck/shared";
import { api, getApiToken, setApiToken } from "./api";
import { CONNECTIONS_FOLDER_KEY, CONNECTIONS_TYPE_KEY, DeliveryStudio, OPEN_DELIVERY_RUN_KEY, PENDING_DEPLOY_KEY } from "./DeliveryStudio";
import { HomePage } from "./HomePage";
import { IdeaStudio } from "./IdeaStudio";
import { MarketingStudio } from "./MarketingStudio";
import { SalesStudio } from "./SalesStudio";
import { KeysPanel } from "./KeysPanel";
import { LogViewer, defaultLogStep, stripAnsi } from "./LogViewer";
import {
  CONN_LABELS,
  ConnectionBadge,
  IconChevron,
  IconCloud,
  IconHistory,
  IconKey,
  IconPipeline,
  IconBrief,
  IconMarketing,
  IconSales,
  IconPlay,
  IconPlug,
  STAGE_THEME,
  FlowScene,
  ShipdeckLogo,
  StageIcon,
} from "./icons";

type Tab = "home" | "brief" | "pipeline" | "delivery" | "sales" | "marketing" | "connections" | "keys" | "runs";
type Appearance = "light" | "dark";

const THEME_KEY = "shipdeck.theme";
const PROJECT_KEY = "shipdeck.projectId";

function readAppearance(): Appearance {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === "dark" || v === "light") return v;
  } catch {
    /* ignore */
  }
  return "light";
}

function applyAppearance(theme: Appearance) {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* ignore */
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "dark" ? "#0b1220" : "#0f172a");
}

function workspaceStatusSentence(opts: {
  run: PipelineRun | null;
  simulate: boolean;
  boxes: PipelineBoxes | null;
}): string {
  const { run, simulate, boxes } = opts;
  const provider = boxes?.infra.cloudProvider;
  const region = boxes?.infra.region;
  const place =
    provider && region ? `${provider} ${region}` : provider ? String(provider) : null;

  if (!run) {
    return simulate ? "Practice mode — nothing in the cloud will change" : "Real cloud — this will change live servers";
  }
  if (run.status === "waiting_approval") {
    return "Waiting for deploy approval";
  }
  if (run.status === "running" || run.status === "queued") {
    if (place && boxes?.infra.mode === "create") {
      return `Preparing host · ${place}`;
    }
    return run.status === "queued" ? "Queued — starting shortly" : "Pipeline running";
  }
  if (run.status === "succeeded") {
    const url = run.environment?.serviceUrl || run.environment?.publicIp;
    if (url) {
      const path =
        run.environment?.serverlessKind === "app" || run.environment?.computeMode === "serverless"
          ? `${String(url).replace(/\/$/, "")}/shipper`
          : String(url);
      return `Succeeded — open ${path}`;
    }
    return "Succeeded — delivery complete";
  }
  if (run.status === "failed") {
    return "Failed — open logs for the failed step";
  }
  if (run.status === "cancelled") {
    return "Cancelled";
  }
  return `Run ${run.status}`;
}

function ticketStatusLabel(status: string): string {
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

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const sec = Math.round((Date.now() - t) / 1000);
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h ago`;
  const days = Math.round(hr / 24);
  return `${days}d ago`;
}

function connectionSummary(c: Connection): string {
  const cfg = c.config ?? {};
  switch (c.type) {
    case "ssh":
      return `${cfg.user || "user"}@${cfg.host || "host"}${cfg.port && cfg.port !== "22" ? `:${cfg.port}` : ""}`;
    case "git":
      return cfg.url || [cfg.gitHost || cfg.host, cfg.botLogin].filter(Boolean).join(" · ") || "Git credentials";
    case "jira":
      return [cfg.siteUrl, cfg.projectKeys, cfg.accountEmail].filter(Boolean).join(" · ") || "Jira site";
    case "model":
      return [
        modelProviderById(cfg.provider || "private").label,
        modelUseLabel(cfg.role),
        cfg.deploymentName,
      ]
        .filter(Boolean)
        .join(" · ");
    case "registry":
      return [cfg.registry, cfg.repository].filter(Boolean).join(" / ") || "Container registry";
    case "aws":
      return [cfg.region || "us-east-1", cfg.key_name || cfg.keyName].filter(Boolean).join(" · ");
    case "gcp":
      return [
        cfg.project_id || cfg.projectId || "GCP project",
        cfg.deployKeySource === "auto-generated" ? "Deploy key: auto-generated" : null,
      ]
        .filter(Boolean)
        .join(" · ");
    case "azure":
      return cfg.subscriptionId
        ? `Sub ${String(cfg.subscriptionId).slice(0, 8)}…`
        : "Azure subscription";
    case "kubernetes":
      return cfg.kubeconfigPath || "In-cluster / kubeconfig";
    case "notify":
      return cfg.endpoint || "Notify endpoint";
    default:
      return cfg.endpoint || CONN_LABELS[c.type] || c.type;
  }
}

function boxSummary(boxes: PipelineBoxes, box: PipelineBoxType, detection?: StackDetection | null): string {
  switch (box) {
    case "source":
      return boxes.source.mode === "local"
        ? `Local · ${boxes.source.branch}`
        : `Remote · ${boxes.source.branch}`;
    case "infra":
      return boxes.infra.mode === "create"
        ? `Create · ${(boxes.infra.computeMode ?? "vm") === "serverless" ? `serverless/${boxes.infra.serverlessKind ?? "function"}` : "VM"} · ${boxes.infra.cloudProvider}`
        : boxes.infra.mode === "skip"
          ? "Skip"
          : "Existing SSH";
    case "build": {
      const base = boxes.build.runTests ? "Build + tests" : "Build only";
      const version = boxes.build.registryConnectionId
        ? imageVersionForRegistry(boxes.build)
        : boxes.build.imageVersion?.trim();
      return version ? `${base} · ${version}` : base;
    }
    case "deploy":
      if (boxes.deploy.runtime === "compose" || detection?.compose) {
        const n = detection?.compose?.services.length;
        return n
          ? `compose · ${n} svc · :${boxes.deploy.port}`
          : `compose :${boxes.deploy.port}`;
      }
      return `${boxes.deploy.runtime} :${boxes.deploy.port}`;
    case "data":
      return boxes.data.enabled ? boxes.data.engine ?? "enabled" : "Off";
    case "verify":
      return boxes.verify.autoRollback ? "Health + rollback" : "Health check";
    case "notify":
      return boxes.notify.enabled ? "On" : "Off";
  }
}

export function App() {
  const [tab, setTab] = useState<Tab>("home");
  const [salesBriefId, setSalesBriefId] = useState<string | null>(null);
  const [marketingBriefId, setMarketingBriefId] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const [boxes, setBoxes] = useState<PipelineBoxes | null>(null);
  const [selected, setSelected] = useState<PipelineBoxType>("source");
  const [connections, setConnections] = useState<Connection[]>([]);
  const [run, setRun] = useState<PipelineRun | null>(null);
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [deliveryHistory, setDeliveryHistory] = useState<DeliveryRun[]>([]);
  const [historyFolder, setHistoryFolder] = useState<"tickets" | "deploy">("tickets");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [simulate, setSimulate] = useState(true);
  const [ticketMode, setTicketMode] = useState<"simulate" | "live">("simulate");
  const [tfApply, setTfApply] = useState(false);
  const [requireApproval, setRequireApproval] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [tokenDraft, setTokenDraft] = useState(getApiToken());
  const [storage, setStorage] = useState("json");
  const [liveDetection, setLiveDetection] = useState<StackDetection | null>(null);
  const [detectMsg, setDetectMsg] = useState<string | null>(null);
  const [detectBusy, setDetectBusy] = useState(false);
  const [appearance, setAppearance] = useState<Appearance>(() => readAppearance());
  const [logViewerStep, setLogViewerStep] = useState<PipelineBoxType | null>(null);

  useEffect(() => {
    applyAppearance(appearance);
  }, [appearance]);

  const applyDetect = useCallback(async (current: PipelineBoxes, applySuggestions: boolean) => {
    setDetectBusy(true);
    setDetectMsg("Scanning project…");
    try {
      const res = await api.detect(current);
      // Always new object so Infra re-renders even when recommendations match
      setLiveDetection({ ...res.detection, signals: [...(res.detection.signals ?? [])] });
      const nextBoxes = applySuggestions && res.suggestedBoxes ? res.suggestedBoxes : current;
      if (applySuggestions && res.suggestedBoxes) {
        setBoxes(res.suggestedBoxes);
      }
      const kind =
        nextBoxes.infra.serverlessKind ??
        suggestServerlessKind(res.detection.compose);
      const sizeNote = res.detection.serverlessSizing?.summary
        ? ` — ${res.detection.serverlessSizing.summary}`
        : "";
      const when = new Date().toLocaleTimeString();
      if (res.detection.compose) {
        const fullApp =
          nextBoxes.infra.computeMode === "serverless" && kind === "app";
        setDetectMsg(
          fullApp
            ? `[${when}] Detected ${res.detection.compose.file}: Full app UI (api + web + managed DB)${sizeNote}`
            : `[${when}] Detected ${res.detection.compose.file}: ${res.detection.compose.services.length} services → Compose :${nextBoxes.deploy.port}${sizeNote}`
        );
      } else {
        setDetectMsg(`[${when}] Suggested runtime: ${res.detection.suggestedRuntime}${sizeNote}`);
      }
      return nextBoxes;
    } catch (e) {
      setDetectMsg(e instanceof Error ? e.message : "Detect failed");
      return current;
    } finally {
      setDetectBusy(false);
    }
  }, []);

  const loadProject = useCallback(async (p: Project) => {
    setProject(p);
    try {
      localStorage.setItem(PROJECT_KEY, p.id);
    } catch {
      /* ignore */
    }
    const pipes = await api.pipelines(p.id);
    const pipe = pipes.find((x) => x.id === p.defaultPipelineId) ?? pipes[0];
    if (!pipe) throw new Error("No pipeline for project");
    setPipeline(pipe);
    setBoxes(pipe.boxes);
    setLiveDetection(null);
    setRuns(await api.runs(pipe.id));
    try {
      const policy = await api.deliveryPolicy();
      if (policy.pipelineId !== pipe.id) {
        await api.saveDeliveryPolicy({ ...policy, pipelineId: pipe.id });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    if (pipe.boxes.source.mode === "local" && pipe.boxes.source.localPath?.trim()) {
      void applyDetect(pipe.boxes, true);
    }
  }, [applyDetect]);

  const load = useCallback(async () => {
    setError(null);
    const list = await api.projects();
    setProjects(list);
    let saved = "";
    try {
      saved = localStorage.getItem(PROJECT_KEY) ?? "";
    } catch {
      /* ignore */
    }
    const p = list.find((item) => item.id === saved) ?? list[0];
    if (!p) throw new Error("No project seeded");
    await loadProject(p);
    setConnections(await api.connections());
    const s = await api.settings();
    setSimulate(s.simulate);
    setTicketMode(s.simulate ? "simulate" : "live");
    setTfApply(s.tfApply);
    setRequireApproval(s.requireApproval);
    setAuthRequired(s.authRequired);
    setStorage(s.storage);
  }, [loadProject]);

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);

  useEffect(() => {
    if (tab !== "connections") return;
    api.connections().then(setConnections).catch((e) => setError(e.message));
  }, [tab]);

  useEffect(() => {
    if (tab !== "runs" || !project) return;
    api.deliveryRuns(project.id).then(setDeliveryHistory).catch((e) => setError(e.message));
    if (pipeline) api.runs(pipeline.id).then(setRuns).catch(() => undefined);
  }, [tab, pipeline, project]);

  // Auto-detect compose/Dockerfile when local Source path changes
  useEffect(() => {
    if (!boxes || boxes.source.mode !== "local") return;
    const path = boxes.source.localPath?.trim();
    if (!path) {
      setLiveDetection(null);
      return;
    }
    const t = setTimeout(() => {
      void applyDetect(boxes, true);
    }, 600);
    return () => clearTimeout(t);
    // Only re-run when path/mode changes — not on every boxes edit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boxes?.source.mode, boxes?.source.localPath, applyDetect]);

  // Keep Verify URL in sync with SSH host + Deploy port (replace leftover :8080 / localhost)
  useEffect(() => {
    if (!boxes) return;
    const ssh = connections.find((c) => c.id === boxes.infra.sshConnectionId);
    const host = ssh?.config.host?.trim();
    if (!host) return;
    const url = suggestedHealthUrl({
      host,
      port: boxes.deploy.port,
      healthPath: boxes.deploy.healthPath,
      primaryService: liveDetection?.compose?.suggestedPrimaryService,
    });
    if (boxes.verify.healthUrl === url) return;
    if (!shouldAutofillHealthUrl(boxes.verify.healthUrl, url, boxes.deploy.port, host)) return;
    setBoxes({ ...boxes, verify: { ...boxes.verify, healthUrl: url } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    pipeline?.id,
    boxes?.infra.sshConnectionId,
    boxes?.deploy.port,
    boxes?.deploy.healthPath,
    liveDetection?.compose?.suggestedPrimaryService,
    connections,
  ]);

  useEffect(() => {
    if (!run || run.status === "succeeded" || run.status === "failed" || run.status === "cancelled") {
      if (pipeline && (run?.status === "succeeded" || run?.status === "failed" || run?.status === "cancelled")) {
        api.runs(pipeline.id).then(setRuns).catch(() => undefined);
      }
      return;
    }
    const t = setInterval(() => {
      api
        .getRun(run.id)
        .then(setRun)
        .catch((e) => setError(e.message));
    }, 700);
    return () => clearInterval(t);
  }, [run, pipeline]);

  const stepStatus = useMemo(() => {
    const map: Partial<Record<PipelineBoxType, string>> = {};
    run?.steps.forEach((s) => {
      map[s.box] = s.status;
    });
    return map;
  }, [run]);

  async function savePipeline() {
    if (!pipeline || !boxes) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api.savePipeline(pipeline.id, { boxes });
      setPipeline(updated);
      setBoxes(updated.boxes);
      setSavedMsg("Pipeline saved");
      setTimeout(() => setSavedMsg(null), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onRun() {
    if (!pipeline || !boxes) return;
    setBusy(true);
    setError(null);
    try {
      await api.savePipeline(pipeline.id, { boxes });
      const started = await api.startRun(pipeline.id);
      setRun(started);
      setTab("pipeline");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onCancel() {
    if (!run) return;
    try {
      const updated = await api.cancelRun(run.id);
      setRun(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function openLogs(step?: PipelineBoxType, forRun?: PipelineRun) {
    const target = forRun ?? run;
    setLogViewerStep(step ?? (target ? defaultLogStep(target) : "source"));
  }

  async function onApprove() {
    if (!run) return;
    try {
      const updated = await api.approveRun(run.id);
      setRun(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onReject() {
    if (!run) return;
    try {
      const updated = await api.rejectRun(run.id);
      setRun(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const statusSentence = workspaceStatusSentence({ run, simulate, boxes });
  const runActive =
    !!run &&
    (run.status === "running" ||
      run.status === "queued" ||
      run.status === "waiting_approval" ||
      run.status === "failed");
  const appOpenUrl = (() => {
    const env = run?.environment;
    if (!env?.serviceUrl || env.status !== "active") return null;
    if (env.serverlessKind === "app" || env.computeMode === "serverless") {
      return `${env.serviceUrl.replace(/\/$/, "")}/shipper`;
    }
    return env.serviceUrl;
  })();

  if (!boxes || !pipeline || !project) {
    return (
      <div className="boot-shell">
        <div className="boot-card">
          <div className="brand-lockup">
            <div className="brand-mark-wrap">
              <ShipdeckLogo size={40} />
            </div>
            <div className="brand-copy">
              <h1>Shipdeck</h1>
              <p className="brand-tagline">Enterprise visual delivery control</p>
            </div>
          </div>
          <p className="muted">{error ?? "Loading workspace…"}</p>
          <div className="appearance-control" style={{ margin: "16px auto 0", width: "fit-content" }}>
            <span className="appearance-label">Appearance</span>
            <div className="appearance-seg" role="group" aria-label="Appearance">
              <button
                type="button"
                className={appearance === "light" ? "active" : ""}
                onClick={() => setAppearance("light")}
              >
                Light
              </button>
              <button
                type="button"
                data-mode="dark"
                className={appearance === "dark" ? "active" : ""}
                onClick={() => setAppearance("dark")}
              >
                Dark ops
              </button>
            </div>
          </div>
          {authRequired && (
            <div style={{ marginTop: 18, textAlign: "left" }}>
              <h2 style={{ margin: "0 0 8px", fontSize: "1.05rem", color: "var(--brand-deep)" }}>
                API token
              </h2>
              <p className="muted" style={{ marginBottom: 12 }}>
                Server requires SHIPDECK_API_TOKEN
              </p>
              <div className="field">
                <input
                  value={tokenDraft}
                  onChange={(e) => setTokenDraft(e.target.value)}
                  placeholder="Bearer token"
                />
              </div>
              <button
                className="btn btn-primary"
                onClick={() => {
                  setApiToken(tokenDraft);
                  load().catch((e) => setError(e.message));
                }}
              >
                Save token & retry
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  async function setSimulateMode(next: boolean) {
    setSimulate(next);
    setTicketMode(next ? "simulate" : "live");
    try {
      await api.setSettings({ simulate: next });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const page =
    tab === "home"
      ? { kicker: "", title: "Shipdeck", detail: "" }
      : tab === "brief"
      ? {
          kicker: "Step 1",
          title: "Start from an idea",
          detail:
            ticketMode === "live"
              ? "Live. The report uses your saved model, then the story is written to Jira."
              : "Practice. Walk the whole page without calling a model.",
        }
      : tab === "delivery"
      ? {
          kicker: "Step 2",
          title: "Start from a ticket",
          detail:
            ticketMode === "live"
              ? "Real cloud — this ticket can change live servers"
              : "Practice — this ticket will not change live servers",
        }
      : tab === "sales"
        ? {
            kicker: "Step 4",
            title: "Who to contact",
            detail:
              ticketMode === "live"
                ? "Live. Search reads public websites for the people you name."
                : "Practice. The report is shown. Companies are not looked up.",
          }
        : tab === "marketing"
          ? {
              kicker: "Step 5",
              title: "Write the campaign",
              detail:
                ticketMode === "live"
                  ? "Live. The campaign is written from the sales list."
                  : "Practice. A short draft, without calling the model.",
            }
          : tab === "connections"
        ? { kicker: "Setup", title: "Saved logins", detail: "Jira, Git, and AI models are for building. Cloud and server logins are for shipping. Add them here once, then pick them later." }
        : tab === "keys"
          ? { kicker: "Setup", title: "Saved secrets", detail: "Every login from Connections is listed here. Show a secret only when you need it. Each show is recorded." }
          : tab === "runs"
            ? { kicker: "Record", title: "What already shipped", detail: statusSentence }
            : { kicker: "Step 3", title: pipeline?.name || "How this ships", detail: statusSentence };

  return (
    <div className="app-frame">
      <aside className="app-sidebar">
            <div className="brand-lockup">
              <div className="brand-mark-wrap">
            <ShipdeckLogo size={40} />
              </div>
              <div className="brand-copy">
                <h1>Shipdeck</h1>
            <p className="brand-tagline">From an idea to a live app</p>
              </div>
            </div>
        <div className="brand-partners" aria-label="Jira, GitHub, AWS, Azure, Google Cloud">
          <ConnectionBadge type="jira" size={22} />
          <ConnectionBadge type="git" size={22} />
          <ConnectionBadge type="aws" size={22} />
          <ConnectionBadge type="azure" size={22} />
          <ConnectionBadge type="gcp" size={22} />
        </div>
        <nav className="app-nav" aria-label="Workspace">
          <button type="button" className={tab === "home" ? "active" : ""} onClick={() => setTab("home")}>
            <ShipdeckLogo size={18} />
            <span className="nav-copy"><span>Home</span><span className="nav-hint">What this is</span></span>
          </button>
          <button type="button" className={tab === "brief" ? "active" : ""} onClick={() => setTab("brief")}>
            <IconBrief size={18} />
            <span className="nav-copy"><span>Idea</span><span className="nav-hint">Describe the business</span></span>
          </button>
          <button type="button" className={tab === "delivery" ? "active" : ""} onClick={() => setTab("delivery")}>
            <IconPlay size={18} />
            <span className="nav-copy"><span>Tickets</span><span className="nav-hint">Plan and write</span></span>
          </button>
          <button type="button" className={tab === "pipeline" ? "active" : ""} onClick={() => setTab("pipeline")}>
            <IconPipeline size={18} />
            <span className="nav-copy"><span>Ship</span><span className="nav-hint">How it goes live</span></span>
          </button>
          <button type="button" className={tab === "sales" ? "active" : ""} onClick={() => setTab("sales")}>
            <IconSales size={18} />
            <span className="nav-copy"><span>Sales</span><span className="nav-hint">Who to contact</span></span>
          </button>
          <button type="button" className={tab === "marketing" ? "active" : ""} onClick={() => setTab("marketing")}>
            <IconMarketing size={18} />
            <span className="nav-copy"><span>Marketing</span><span className="nav-hint">Write the campaign</span></span>
          </button>
          <button type="button" className={tab === "runs" ? "active" : ""} onClick={() => setTab("runs")}>
            <IconHistory size={18} />
            <span className="nav-copy"><span>History</span><span className="nav-hint">What already ran</span></span>
          </button>
          <button type="button" className={tab === "connections" ? "active" : ""} onClick={() => setTab("connections")}>
            <IconPlug size={18} />
            <span className="nav-copy"><span>Logins</span><span className="nav-hint">Jira, Git, cloud</span></span>
            {connections.length > 0 && <span className="tab-count">{connections.length}</span>}
          </button>
          <button type="button" className={tab === "keys" ? "active" : ""} onClick={() => setTab("keys")}>
            <IconKey size={18} />
            <span className="nav-copy"><span>Secrets</span><span className="nav-hint">Show and audit</span></span>
          </button>
        </nav>
        <div className="app-sidebar-foot">
          <div className="appearance-seg" role="group" aria-label="Appearance">
            <button type="button" className={appearance === "light" ? "active" : ""} onClick={() => setAppearance("light")}>
              Light
            </button>
            <button
              type="button"
              data-mode="dark"
              className={appearance === "dark" ? "active" : ""}
              onClick={() => setAppearance("dark")}
            >
              Dark
            </button>
            </div>
          </div>
      </aside>

      <div className="app-main">
      <header className="app-chrome">
        <div className="app-chrome-inner">
          <div className="chrome-left">
            <div className="chrome-project">
              <span>Project</span>
              <strong>{project?.name ?? "—"}</strong>
            </div>
          </div>
        </div>
      </header>

      {!simulate && tab === "pipeline" && (
        <div className="live-rail" role="status">
          <span className="live-rail-msg">Real cloud is on. Shipping can change live servers.</span>
        </div>
      )}

      {tab !== "home" && <div className="workspace-band">
        <div className="workspace-band-inner">
          <div className="workspace-title-block">
            {page.kicker ? <span className="workspace-kicker">{page.kicker}</span> : null}
            <h2 className="workspace-title">{page.title}</h2>
            {page.detail ? (
              <p className="workspace-status-sentence">
                <span className="status-emph">{page.detail}</span>
              </p>
            ) : null}
          </div>
          {(tab === "delivery" || tab === "brief" || tab === "sales" || tab === "marketing") && (
          <div className="ticket-mode">
            <span>{tab === "brief" ? "How this idea is drafted" : tab === "sales" ? "How companies are looked up" : tab === "marketing" ? "How the campaign is written" : "What the next ticket may change"}</span>
            <div className="mode-seg" role="group" aria-label="What the next ticket may change">
              <button
                type="button"
                className={ticketMode === "simulate" ? "active safe" : ""}
                onClick={() => setTicketMode("simulate")}
              >
                Practice
              </button>
              <button
                type="button"
                className={ticketMode === "live" ? "active live" : ""}
                title="Can change servers"
                onClick={() => setTicketMode("live")}
              >
                Real cloud
              </button>
            </div>
          </div>
          )}
          {tab === "pipeline" && (
          <div className="workspace-deploy">
            <div className="mode-seg" role="group" aria-label="Execution mode">
              <button
                type="button"
                className={simulate ? "active safe" : ""}
                onClick={() => void setSimulateMode(true)}
              >
                Practice
              </button>
              <button
                type="button"
                className={!simulate ? "active live" : ""}
                title="Changes real cloud servers"
                onClick={() => void setSimulateMode(false)}
              >
                Real cloud
              </button>
            </div>
            <details className="ops-menu">
              <summary className="ops-menu-trigger">Settings</summary>
              <div className="ops-menu-panel">
                <label className={`mode-toggle ${tfApply ? "on" : ""}`}>
                  <input
                    type="checkbox"
                    checked={tfApply}
                    onChange={async (e) => {
                      const next = e.target.checked;
                      setTfApply(next);
                      try {
                        await api.setSettings({ tfApply: next });
                      } catch (err) {
                        setError(err instanceof Error ? err.message : String(err));
                      }
                    }}
                  />
                  Create real servers
                </label>
                <label className={`mode-toggle ${requireApproval ? "on" : ""}`}>
                  <input
                    type="checkbox"
                    checked={requireApproval}
                    onChange={async (e) => {
                      const next = e.target.checked;
                      setRequireApproval(next);
                      try {
                        await api.setSettings({ requireApproval: next });
                      } catch (err) {
                        setError(err instanceof Error ? err.message : String(err));
                      }
                    }}
                  />
                  Approve deploy
                </label>
                <span className="storage-chip">storage · {storage}</span>
              </div>
            </details>
            <div className="topbar-actions">
              {savedMsg && <span className="saved-toast">{savedMsg}</span>}
              <button className="btn" onClick={() => savePipeline()} disabled={busy}>
                Save
              </button>
              {run &&
                (run.status === "running" ||
                  run.status === "queued" ||
                  run.status === "waiting_approval") && (
                  <button className="btn" onClick={onCancel}>
                    Cancel
                  </button>
                )}
              {run && run.status === "waiting_approval" && (
                <>
                  <button className="btn btn-brand" onClick={onApprove}>
                    Approve
                  </button>
                  <button className="btn btn-reject" onClick={onReject}>
                    Reject
                  </button>
                </>
              )}
              <button className="btn btn-primary btn-run-cta" onClick={onRun} disabled={busy}>
                <IconPlay size={16} />
                {busy ? "Working…" : "Ship now"}
              </button>
            </div>
            {run ? (
              <span className="meta-pill meta-run" data-status={run.status}>
                {run.status.replaceAll("_", " ")}
              </span>
            ) : (
              <span className="meta-pill meta-neutral">No active run</span>
            )}
            </div>
          )}
          </div>
      </div>}

      <div className="app-shell">
      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button
            type="button"
            className="error-dismiss"
            aria-label="Dismiss error"
            onClick={() => setError(null)}
          >
            ×
          </button>
        </div>
      )}

      <div className="tab-surface" key={tab}>

      {runActive && tab === "pipeline" && run && (
        <div className="active-run-strip" data-status={run.status}>
          <div className="active-run-strip-main">
            <span className="pill" data-status={run.status}>
              {run.status}
            </span>
            <span className="muted">Run #{run.id}</span>
            {statusSentence && <span style={{ fontWeight: 700 }}>{statusSentence}</span>}
          </div>
          <div className="active-run-strip-actions">
            <button type="button" className="btn" onClick={() => openLogs()}>
              Open logs ↗
            </button>
            {(run.status === "running" ||
              run.status === "queued" ||
              run.status === "waiting_approval") && (
              <button type="button" className="btn" onClick={onCancel}>
                Cancel
              </button>
            )}
            {appOpenUrl && (
              <a className="btn btn-primary" href={appOpenUrl} target="_blank" rel="noreferrer">
                Open app
              </a>
            )}
          </div>
        </div>
      )}

      {tab === "home" ? (
        <HomePage
          onOpen={setTab}
          projects={projects}
          projectId={project?.id ?? ""}
          onSelectProject={async (id) => {
            const next = projects.find((item) => item.id === id);
            if (!next) return;
            try {
              await loadProject(next);
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            }
          }}
          onCreateProject={async (name) => {
            const created = await api.createProject({ name });
            setProjects(await api.projects());
            await loadProject(created);
          }}
        />
      ) : tab === "brief" ? (
        <IdeaStudio
          projectId={project?.id}
          mode={ticketMode}
          onOpenTicket={(runId) => {
            sessionStorage.setItem(OPEN_DELIVERY_RUN_KEY, runId);
            setTab("delivery");
          }}
          onOpenSales={(id) => {
            setSalesBriefId(id);
            setTab("sales");
          }}
        />
      ) : tab === "sales" ? (
        <SalesStudio
          projectId={project?.id}
          mode={ticketMode}
          briefId={salesBriefId}
          onOpenMarketing={(id) => {
            setMarketingBriefId(id);
            setTab("marketing");
          }}
        />
      ) : tab === "marketing" ? (
        <MarketingStudio projectId={project?.id} mode={ticketMode} briefId={marketingBriefId} />
      ) : tab === "delivery" ? (
        <>
          <section className="pipeline-board ticket-path">
            <div className="pipeline-board-head">
              <h2>Ticket steps — left to right</h2>
            </div>
            <div className="ticket-board">
            <ol className="ticket-steps" aria-label="Pick logins and load, develop and test, then approval to ship">
              <li>
                <FlowScene scene="logins" plain />
                <strong>Pick logins and load</strong>
              </li>
              <li className="ticket-step-join" aria-hidden="true">
                <IconChevron size={14} />
              </li>
              <li>
                <FlowScene scene="ticket" plain />
                <strong>Develop and test</strong>
              </li>
              <li className="ticket-step-join" aria-hidden="true">
                <IconChevron size={14} />
              </li>
              <li>
                <FlowScene scene="ship" plain />
                <strong>Approval to ship</strong>
              </li>
            </ol>
            <ul className="ticket-facts">
              <li>
                <FlowScene scene="plan" plain />
                <span>The ticket becomes a plan you approve.</span>
              </li>
              <li>
                <FlowScene scene="tests" plain />
                <span>Tests run before the work is done.</span>
              </li>
              <li>
                <FlowScene scene="live" plain />
                <span>Nothing ships until you say yes.</span>
              </li>
            </ul>
            </div>
          </section>
          <DeliveryStudio
          projectId={project?.id}
          live={!simulate}
          mode={ticketMode}
          onOpenConnections={() => {
            api.connections().then(setConnections).catch((e) => setError(e.message));
            setTab("connections");
          }}
        />
        </>
      ) : tab === "connections" ? (
        <ConnectionsPanel
          connections={connections}
          onChange={async () => setConnections(await api.connections())}
          onError={setError}
          onGoPipeline={() => setTab("pipeline")}
        />
      ) : tab === "keys" ? (
        <KeysPanel />
      ) : tab === "runs" ? (
        <div className="panel">
          <div className="panel-head">
            <div className="panel-icon">
              <IconHistory size={18} />
            </div>
            <h2>Recent runs</h2>
          </div>
          <div className="conn-folders" role="tablist" aria-label="Run history" style={{ marginBottom: 12 }}>
            <button
              type="button"
              role="tab"
              aria-selected={historyFolder === "tickets"}
              className={historyFolder === "tickets" ? "on" : ""}
              onClick={() => setHistoryFolder("tickets")}
            >
              Ticket history
              <span>{deliveryHistory.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={historyFolder === "deploy"}
              className={historyFolder === "deploy" ? "on" : ""}
              onClick={() => setHistoryFolder("deploy")}
            >
              Deploy
              <span>{runs.length}</span>
            </button>
          </div>
          <div className="row-actions" style={{ marginBottom: 12 }}>
            <button
              className="btn"
              onClick={async () => {
                try {
                  if (historyFolder === "tickets") {
                    setDeliveryHistory(await api.deliveryRuns(project?.id));
                  } else if (pipeline) {
                    setRuns(await api.runs(pipeline.id));
                  }
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                }
              }}
            >
              Refresh
            </button>
          </div>
          {historyFolder === "tickets" ? (
            !deliveryHistory.length ? (
              <div className="empty-state">
                <h3>No ticket history yet</h3>
                <button type="button" className="btn btn-primary" onClick={() => setTab("delivery")}>
                  Open tickets
                </button>
              </div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Ticket</th>
                    <th>Summary</th>
                    <th>Status</th>
                    <th>Updated</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {[...deliveryHistory]
                    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
                    .map((item) => (
                      <tr key={item.id}>
                        <td>{item.ticket.key}</td>
                        <td className="muted">{item.ticket.summary}</td>
                        <td>{ticketStatusLabel(item.status)}</td>
                        <td className="muted" title={new Date(item.updatedAt).toLocaleString()}>
                          {relativeTime(item.updatedAt)}
                        </td>
                        <td>
            <button
                            className="btn btn-ghost"
                            onClick={() => {
                              sessionStorage.setItem(OPEN_DELIVERY_RUN_KEY, item.id);
                              setTab("delivery");
                            }}
                          >
                            Open
            </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )
          ) : !runs.length ? (
            <div className="empty-state">
              <ol className="picture-flow">
                <li><FlowScene scene="ticket" /><strong>Ticket</strong></li>
                <li><FlowScene scene="ship" /><strong>Ship</strong></li>
                <li><FlowScene scene="live" /><strong>History</strong></li>
              </ol>
              <h3>No deploy runs yet</h3>
              <button type="button" className="btn btn-primary" onClick={() => setTab("pipeline")}>
                <IconPlay size={14} />
                Open ship steps
              </button>
            </div>
          ) : (
          <table className="table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Status</th>
                <th>Environment</th>
                <th>Created</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} data-row-status={r.status}>
                  <td className="muted">{r.id}</td>
                  <td>
                    <span className="pill" data-status={r.status}>{r.status}</span>
                  </td>
                  <td className="muted">
                    {r.environment?.status === "active"
                      ? r.environment.serviceUrl || r.environment.publicIp || "Active"
                      : r.environment?.status === "destroying"
                        ? "Destroying…"
                        : r.environment?.status === "destroyed"
                          ? "Torn down"
                          : r.environment?.status === "destroy_failed"
                            ? "Destroy failed"
                            : "—"}
                  </td>
                  <td className="muted" title={new Date(r.createdAt).toLocaleString()}>
                    {relativeTime(r.createdAt)}
                  </td>
                  <td>
                    <button
                      className="btn btn-ghost"
                      onClick={async () => {
                        try {
                          setRun(await api.getRun(r.id));
                          setTab("pipeline");
                        } catch (e) {
                          setError(e instanceof Error ? e.message : String(e));
                        }
                      }}
                    >
                      Open
                    </button>
                    <button
                      className="btn btn-ghost"
                      onClick={async () => {
                        try {
                          const full = await api.getRun(r.id);
                          setRun(full);
                          openLogs(undefined, full);
                        } catch (e) {
                          setError(e instanceof Error ? e.message : String(e));
                        }
                      }}
                    >
                      Logs ↗
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          )}
          <div className="field" style={{ marginTop: 16 }}>
            <label>API token (optional)</label>
            <input
              value={tokenDraft}
              onChange={(e) => setTokenDraft(e.target.value)}
              placeholder="If server set SHIPDECK_API_TOKEN"
            />
            <button
              className="btn"
              style={{ marginTop: 8 }}
              onClick={() => {
                setApiToken(tokenDraft);
                setSavedMsg("Token saved");
                setTimeout(() => setSavedMsg(null), 1500);
              }}
            >
              Save token
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="pipeline-board">
            <div className="pipeline-board-head">
              <h2>Release steps — left to right</h2>
              <span>Click a step to set it up. The software moves from Git to a live host.</span>
            </div>
            <div className="pipeline-row">
              {PIPELINE_BOX_ORDER.map((box, i) => (
                <div key={box} style={{ display: "contents" }}>
                  {i > 0 && (
                    <div className="stage-connector" aria-hidden>
                      <IconChevron size={14} />
                    </div>
                  )}
                  <button
                    type="button"
                    className={`box-card tone-${STAGE_THEME[box].tone} ${selected === box ? "selected" : ""}`}
                    onClick={() => setSelected(box)}
                  >
                    <div className="stage-icon-wrap">
                      <StageIcon box={box} size={20} />
                    </div>
                    <div className="label">
                      <span className={`status-dot ${stepStatus[box] ?? "pending"}`} />
                      {STAGE_THEME[box].label}
                    </div>
                    <div className="hint">{STAGE_THEME[box].hint}</div>
                    <div className="meta">{boxSummary(boxes, box, liveDetection)}</div>
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="layout-2">
            <div className="panel">
              <div className="panel-head">
                <div className="panel-icon" style={{ background: `color-mix(in srgb, var(--stage-${selected}) 18%, white)`, color: `var(--stage-${selected})` }}>
                  <StageIcon box={selected} size={18} />
                </div>
                <h2>{STAGE_THEME[selected].label} configuration</h2>
              </div>
              {detectMsg && (
                <div className={`detection${/fail|error|not found/i.test(detectMsg) ? " detection-error" : ""}`}>
                  {detectBusy ? <strong>Scanning… </strong> : null}
                  {detectMsg}
                </div>
              )}
              <BoxEditor
                box={selected}
                boxes={boxes}
                connections={connections}
                detection={liveDetection}
                detectBusy={detectBusy}
                detectMsg={detectMsg}
                onChange={setBoxes}
                onDetect={async () => {
                  if (!boxes) throw new Error("No pipeline boxes loaded");
                  await applyDetect(boxes, true);
                }}
              />
            </div>

            <div className="panel" id="run-console">
              <div className="panel-head">
                <div className="panel-icon">
                  <IconPlay size={18} />
                </div>
                <h2>Run console</h2>
                {run && (
                  <button
                    type="button"
                    className="btn"
                    style={{ marginLeft: "auto" }}
                    onClick={() => openLogs()}
                  >
                    Open logs ↗
                  </button>
                )}
              </div>
              {!run && (
                <div className="empty-state">
                  <ol className="picture-flow">
                    <li><FlowScene scene="code" /><strong>Code</strong></li>
                    <li><FlowScene scene="tests" /><strong>Check</strong></li>
                    <li><FlowScene scene="live" /><strong>Live</strong></li>
                  </ol>
                  <h3>Ready when you are</h3>
                  <button type="button" className="btn btn-primary" onClick={onRun} disabled={busy}>
                    <IconPlay size={14} />
                    {busy ? "Working…" : "Ship now"}
                  </button>
                </div>
              )}
              {run && (
                <>
                  <div className="run-hero" data-status={run.status}>
                    <div className="run-hero-status">{run.status}</div>
                    <div className="run-hero-meta">
                      <span className="run-hero-chip">#{run.id}</span>
                      {run.environment?.provider && (
                        <span className="run-hero-chip">{run.environment.provider}</span>
                      )}
                      {run.environment?.region && (
                        <span className="run-hero-chip">{run.environment.region}</span>
                      )}
                      {run.environment?.computeMode && (
                        <span className="run-hero-chip">{run.environment.computeMode}</span>
                      )}
                      {(run.environment?.serviceUrl || run.environment?.publicIp) && (
                        <span className="run-hero-chip">
                          {run.environment.serviceUrl ? (
                            <a
                              href={
                                run.environment.serverlessKind === "app"
                                  ? `${run.environment.serviceUrl.replace(/\/$/, "")}/shipper`
                                  : run.environment.serviceUrl
                              }
                              target="_blank"
                              rel="noreferrer"
                            >
                              {run.environment.serviceUrl}
                            </a>
                          ) : (
                            run.environment.publicIp
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                  {run.detection && (
                    <div className="detection">
                      Detected <strong>{run.detection.stack}</strong> (confidence{" "}
                      {Math.round(run.detection.confidence * 100)}%) → suggested{" "}
                      {run.detection.suggestedRuntime}
                      <br />
                      {run.detection.signals.join(" · ")}
                      {run.detection.compose && (
                        <>
                          <br />
                          <strong>{run.detection.compose.file}</strong>:{" "}
                          {run.detection.compose.services
                            .map((s) =>
                              s.ports.length
                                ? `${s.name} (:${s.ports.join(",:")})`
                                : s.name
                            )
                            .join(" · ")}
                        </>
                      )}
                    </div>
                  )}
                  <div className="step-timeline" style={{ marginTop: 12 }}>
                    {run.steps.map((s) => {
                      const clean = s.logs.map((l) => stripAnsi(l)).filter((l) => l.trim());
                      const preview = s.error
                        ? stripAnsi(s.error)
                        : clean[clean.length - 1] ?? "No logs yet";
                      return (
                        <div
                          key={s.id}
                          className={`run-step-row tone-${s.box}${s.status === "failed" ? " is-failed" : ""}${s.status === "running" ? " is-running" : ""}`}
                        >
                          <span className="run-step-icon">
                            <StageIcon box={s.box} size={14} />
                          </span>
                          <span className={`status-dot ${s.status}`} />
                          <span className="run-step-row-main">
                            <span className="run-step-row-name">{s.name}</span>
                            <span className="run-step-row-preview" title={preview}>
                              {preview}
                            </span>
                          </span>
                          <span className="muted run-step-row-lines">{s.logs.length} lines</span>
                          <span className="pill" data-status={s.status}>
                            {s.status}
                          </span>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => openLogs(s.box)}
                          >
                            View logs
                          </button>
                        </div>
                      );
                    })}
                    <p className="muted" style={{ margin: "8px 2px 0", fontSize: "0.82rem" }}>
                      Logs open in a dedicated viewer — search, filter errors, copy, download, or
                      pop out to a new window. This page stays undisturbed.
                    </p>
                  </div>
                  {(run.status === "succeeded" || Boolean(run.environment?.provisioned)) && (
                    <EnvironmentPanel
                      run={run}
                      onUpdated={(r) => {
                        setRun(r);
                        void api.runs(pipeline?.id).then(setRuns).catch(() => undefined);
                      }}
                      onError={setError}
                    />
                  )}
                  {run.status === "succeeded" && boxes && (
                    <PublicPortsPanel boxes={boxes} detection={liveDetection ?? run.detection ?? null} />
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}
      </div>
      </div>

      <footer className="app-footer">
        <div className="app-footer-inner">
          <span className="footer-brand">Shipdeck</span>
          <span className="footer-sep" />
          <span>Source to target with gated delivery</span>
        </div>
      </footer>
      </div>

      {logViewerStep && run && (
        <LogViewer
          run={run}
          initialStep={logViewerStep}
          onClose={() => setLogViewerStep(null)}
        />
      )}
    </div>
  );
}

function EnvironmentPanel({
  run,
  onUpdated,
  onError,
}: {
  run: PipelineRun;
  onUpdated: (r: PipelineRun) => void;
  onError: (msg: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const env = run.environment;

  useEffect(() => {
    if (env?.status !== "destroying") return;
    const t = window.setInterval(() => {
      void api
        .getRun(run.id)
        .then(onUpdated)
        .catch(() => undefined);
    }, 2500);
    return () => window.clearInterval(t);
  }, [env?.status, run.id, onUpdated]);

  if (!env?.provisioned && run.status !== "succeeded") return null;
  if (!env?.provisioned) {
    return (
      <div className="env-panel" style={{ marginTop: 12 }}>
        <strong>Cloud environment</strong>
        <p className="muted" style={{ margin: "6px 0 0" }}>
          No Create-VM resources recorded for this run (simulate mode, or Infra was skipped).
        </p>
      </div>
    );
  }

      const host = env.serviceUrl || env.deployHost || env.publicIp;
      const canDestroy = env.status === "active" || env.status === "destroy_failed";
  const statusLabel =
    env.status === "active"
      ? "Active"
      : env.status === "destroying"
        ? "Destroying…"
        : env.status === "destroyed"
          ? "Destroyed"
          : "Destroy failed";

  async function destroy() {
    setBusy(true);
    try {
      const updated = await api.destroyEnvironment(run.id);
      onUpdated(updated);
      setConfirmOpen(false);
      setTyped("");
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
      try {
        onUpdated(await api.getRun(run.id));
      } catch {
        /* ignore */
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`env-panel${confirmOpen || env.status === "destroying" || env.status === "destroy_failed" ? " danger-zone" : ""}`}
      style={{ marginTop: 12 }}
    >
      <div className="env-panel-head">
        <IconCloud size={20} />
        <strong>
          {env.computeMode === "serverless" ? "Serverless environment" : "Cloud environment"}
        </strong>
        <span className={`pill env-status-${env.status}`}>{statusLabel}</span>
      </div>
      <p className="muted" style={{ margin: "8px 0" }}>
        {host ? (
          <>
            {env.computeMode === "serverless" ? "Endpoint" : "Host"} <code>{host}</code>
            {env.provider ? ` · ${env.provider}` : ""}
            {env.region ? ` / ${env.region}` : ""}
            {env.computeMode === "serverless" ? " · serverless" : ""}
          </>
        ) : (
          <>Provisioned via Create (awaiting Terraform outputs).</>
        )}
        {env.destroyedAt && (
          <>
            <br />
            Torn down {new Date(env.destroyedAt).toLocaleString()}
          </>
        )}
        {env.destroyError && (
          <>
            <br />
            <span style={{ color: "var(--danger)" }}>{env.destroyError}</span>
          </>
        )}
      </p>

      {env.computeMode === "serverless" && env.serviceUrl && env.status === "active" && (
        <p style={{ margin: "0 0 10px", display: "flex", gap: 10, flexWrap: "wrap" }}>
          <a
            className="btn btn-primary"
            href={
              env.serverlessKind === "app"
                ? `${env.serviceUrl.replace(/\/$/, "")}/shipper`
                : env.serviceUrl
            }
            target="_blank"
            rel="noreferrer"
          >
            {env.serverlessKind === "app" ? "Open app" : "Open endpoint"}
          </a>
          {(env.serverlessKind === "app" ||
            composeHasShipperPath(run.detection?.compose)) && (
            <a
              className="btn"
              href={`${env.serviceUrl.replace(/\/$/, "")}/shipper`}
              target="_blank"
              rel="noreferrer"
            >
              Open /shipper
            </a>
          )}
        </p>
      )}

      {canDestroy && !confirmOpen && (
        <button
          type="button"
          className="btn btn-danger"
          disabled={busy}
          onClick={() => {
            setTyped("");
            setConfirmOpen(true);
          }}
        >
          Tear down environment
        </button>
      )}

      {env.status === "destroying" && (
        <p className="muted">Terraform destroy in progress — this panel refreshes automatically.</p>
      )}

      {confirmOpen && (
        <div className="env-confirm">
          <p style={{ marginTop: 0 }}>
            <strong style={{ color: "var(--danger)" }}>Danger zone · DESTROY</strong>
            <br />
            This permanently destroys the environment{host ? ` at ${host}` : ""}, its dedicated
            network, and related cloud resources. Running workloads will stop. Type{" "}
            <strong>DESTROY</strong> to confirm.
          </p>
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="DESTROY"
            autoComplete="off"
            spellCheck={false}
            style={{ width: "100%", maxWidth: 280, marginBottom: 10 }}
          />
          <div className="row-actions">
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy || typed.trim() !== "DESTROY"}
              onClick={() => void destroy()}
            >
              {busy ? "Destroying…" : "Confirm tear down"}
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => {
                setConfirmOpen(false);
                setTyped("");
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function PublicPortsPanel({
  boxes,
  detection,
}: {
  boxes: PipelineBoxes;
  detection: StackDetection | null;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const composePorts = detection?.compose?.services.flatMap((s) => s.ports) ?? [];
  const { publicPorts, privatePorts } = splitPublishPorts(composePorts, [boxes.deploy.port]);

  async function openPorts() {
    const keep = privatePorts.length ? `\nKeep closed: ${privatePorts.join(", ")}` : "";
    const ok = window.confirm(
      `Open these public app ports on the VM so a browser can reach them?\n\nOpen: ${publicPorts.join(", ") || "(none)"}${keep}\n\nDatabase / Redis / SSH ports stay closed.`
    );
    if (!ok) return;
    setBusy(true);
    setResult(null);
    try {
      const r = await api.openPorts(boxes);
      setResult(r.message);
    } catch (e) {
      setResult(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!publicPorts.length && !privatePorts.length) return null;

  return (
    <div className="detection" style={{ marginTop: 12 }}>
      <strong>Public access</strong>
      <p className="muted" style={{ margin: "6px 0" }}>
        Browser / UI ports: {publicPorts.length ? publicPorts.join(", ") : "none detected"}.
        {privatePorts.length ? ` Kept private: ${privatePorts.join(", ")}.` : ""}
      </p>
      <button type="button" className="btn btn-primary" onClick={openPorts} disabled={busy || !publicPorts.length}>
        {busy ? "Opening…" : "Open public ports"}
      </button>
      {result && <p style={{ marginTop: 8 }}>{result}</p>}
    </div>
  );
}

function ComposeReviewPanel({
  boxes,
  onChange,
}: {
  boxes: PipelineBoxes;
  onChange: (b: PipelineBoxes) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<{
    hasExisting: boolean;
    existingFile: string | null;
    matches: boolean;
    recommendation: "existing" | "generated";
    discrepancies: Array<{ id: string; message: string }>;
    generated: { message: string; apps: Array<{ name: string; port: number; dir: string }> };
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadReview() {
    setBusy(true);
    setError(null);
    try {
      setReview(await api.reviewCompose(boxes));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function choose(choice: "existing" | "generated") {
    if (choice === "generated") {
      const ok = window.confirm(
        boxes.source.mode === "remote"
          ? "Use the Shipdeck-generated compose file?\n\nThis writes docker-compose.shipdeck.yml into Shipdeck's Git clone (not pushed to GitHub). The next LIVE run will generate it again."
          : "Use the Shipdeck-generated compose file?\n\nThis writes docker-compose.shipdeck.yml (your original docker-compose.yml is not overwritten) and deploy will use the generated file."
      );
      if (!ok) return;
      setBusy(true);
      try {
        const r = await api.generateCompose(boxes);
        if (r.suggestedBoxes) onChange(r.suggestedBoxes);
        else {
          onChange({
            ...boxes,
            deploy: { ...boxes.deploy, composeChoice: "generated", runtime: "compose" },
          });
        }
        setReview(await api.reviewCompose(r.suggestedBoxes ?? boxes));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
      return;
    }
    const ok = window.confirm(
      "Keep the existing docker-compose.yml as-is?\n\nDeploy will use that file even if apps are missing from it."
    );
    if (!ok) return;
    onChange({
      ...boxes,
      deploy: { ...boxes.deploy, composeChoice: "existing" },
    });
  }

  const choice = boxes.deploy.composeChoice;

  return (
    <div className="detection" style={{ marginTop: 12 }}>
      <strong>Compose vs source</strong>
      {boxes.source.mode === "remote" && (
        <p className="muted" style={{ margin: "6px 0" }}>
          Uses your Git connection (cloned for review). No local folder needed.
        </p>
      )}
      <p className="muted" style={{ margin: "6px 0" }}>
        Current choice:{" "}
        {choice === "generated"
          ? "Shipdeck generated file"
          : choice === "existing"
            ? "repo docker-compose.yml"
            : "not chosen yet"}
      </p>
      <button type="button" className="btn" onClick={loadReview} disabled={busy}>
        {busy ? (boxes.source.mode === "remote" ? "Cloning Git…" : "Checking…") : "Review compose vs source"}
      </button>
      {error && <p className="muted">{error}</p>}
      {review && (
        <>
          <p style={{ marginTop: 10 }}>
            {review.hasExisting ? (
              review.matches ? (
                <>
                  Found <code>{review.existingFile}</code> — it already matches the
                  source (apps + ports). Use <strong>Keep existing compose</strong>.
                </>
              ) : (
                <>
                  Found <code>{review.existingFile}</code> — it does not fully match
                  the source. Review the gaps, then choose.
                </>
              )
            ) : (
              <>No docker-compose.yml — Shipdeck can create one from source.</>
            )}
          </p>
          {review.discrepancies.length > 0 && (
            <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
              {review.discrepancies.map((d) => (
                <li key={d.id}>{d.message}</li>
              ))}
            </ul>
          )}
          {!review.matches && review.generated.apps?.length > 0 && (
            <p className="muted" style={{ marginTop: 8 }}>
              Generated would include:{" "}
              {review.generated.apps.map((a) => `${a.name}:${a.port}`).join(", ")}
            </p>
          )}
          <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
            {review.hasExisting && (
              <button
                type="button"
                className={review.matches ? "btn btn-primary" : "btn"}
                onClick={() => choose("existing")}
                disabled={busy}
              >
                Keep existing compose
              </button>
            )}
            {(!review.matches || !review.hasExisting) && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => choose("generated")}
                disabled={busy}
              >
                {review.hasExisting ? "Use generated compose" : "Create compose from source"}
              </button>
            )}
            {review.matches && review.hasExisting && (
              <button type="button" className="btn" onClick={() => choose("generated")} disabled={busy}>
                Use generated copy anyway
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function TestReviewPanel({
  boxes,
  onChange,
}: {
  boxes: PipelineBoxes;
  onChange: (b: PipelineBoxes) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<{
    discovered: Array<{
      dir: string;
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
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadReview() {
    setBusy(true);
    setError(null);
    try {
      setReview(await api.reviewTests(boxes));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function choose(choice: "existing" | "generated" | "skip") {
    if (choice === "generated") {
      const ok = window.confirm(
        boxes.source.mode === "remote"
          ? "Use Shipdeck-generated tests?\n\nThis writes smoke tests into Shipdeck's Git clone (not pushed to GitHub). The next LIVE run will generate them again."
          : "Use Shipdeck-generated tests?\n\nThis writes shipdeck.smoke.spec.ts from the source (your original test files are not overwritten). Build will run those."
      );
      if (!ok) return;
      setBusy(true);
      try {
        const r = await api.generateTests(boxes);
        if (r.suggestedBoxes) onChange(r.suggestedBoxes);
        else {
          onChange({
            ...boxes,
            build: { ...boxes.build, testChoice: "generated", runTests: true },
          });
        }
        setReview(await api.reviewTests(r.suggestedBoxes ?? { ...boxes, build: { ...boxes.build, testChoice: "generated" } }));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
      return;
    }
    const labels = {
      existing: "Keep the tests already in the repo and run those?",
      skip: "Skip tests on Build / CI?",
    };
    if (!window.confirm(labels[choice])) return;
    onChange({
      ...boxes,
      build: {
        ...boxes.build,
        testChoice: choice,
        runTests: choice !== "skip",
      },
    });
  }

  const choice = boxes.build.testChoice === "recommended" ? "generated" : boxes.build.testChoice;

  return (
    <div className="detection" style={{ marginTop: 12 }}>
      <strong>Tests vs source</strong>
      {boxes.source.mode === "remote" && (
        <p className="muted" style={{ margin: "6px 0" }}>
          Uses your Git connection (cloned for review). No local folder needed.
        </p>
      )}
      <p className="muted" style={{ margin: "6px 0" }}>
        Current choice:{" "}
        {choice === "generated"
          ? "Shipdeck generated tests"
          : choice === "existing"
            ? "repo tests"
            : choice === "skip"
              ? "skip tests"
              : "not chosen yet"}
      </p>
      <button type="button" className="btn" onClick={loadReview} disabled={busy}>
        {busy ? (boxes.source.mode === "remote" ? "Cloning Git…" : "Checking…") : "Review tests vs source"}
      </button>
      {error && <p className="muted">{error}</p>}
      {review && (
        <>
          <p style={{ marginTop: 10 }}>
            {review.generated.length
              ? "Existing tests do not fully match what the source needs. Compare, then choose."
              : review.hasExisting
                ? "Existing tests already match the source. Keep existing tests."
                : "No tests in this folder. Shipdeck can create smoke tests from source."}
          </p>
          {review.generated.length > 0 && (
            <p className="muted" style={{ marginTop: 8 }}>
              Generated would add: {review.generated.map((g) => g.path).join(" · ")}
            </p>
          )}
          {review.discrepancies.length > 0 && (
            <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
              {review.discrepancies.map((d) => (
                <li key={d.id}>{d.message}</li>
              ))}
            </ul>
          )}
          <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
            {review.hasExisting && (
              <button
                type="button"
                className={review.recommendation === "existing" ? "btn btn-primary" : "btn"}
                onClick={() => choose("existing")}
                disabled={busy}
              >
                Keep existing tests
              </button>
            )}
            {(review.generated.length > 0 || review.recommendation === "generated") && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => choose("generated")}
                disabled={busy}
              >
                {review.hasExisting ? "Use generated tests" : "Create tests from source"}
              </button>
            )}
            <button type="button" className="btn" onClick={() => choose("skip")} disabled={busy}>
              Skip tests
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function DockerfileReviewPanel({
  boxes,
  onChange,
}: {
  boxes: PipelineBoxes;
  onChange: (b: PipelineBoxes) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<{
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
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadReview() {
    setBusy(true);
    setError(null);
    try {
      setReview(await api.reviewDockerfiles(boxes));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function choose(choice: "existing" | "generated") {
    if (choice === "generated") {
      const ok = window.confirm(
        boxes.source.mode === "remote"
          ? "Use Shipdeck-generated Dockerfiles?\n\nThis writes Dockerfile.shipdeck into Shipdeck's Git clone (not pushed to GitHub). The next LIVE run will generate them again."
          : "Use Shipdeck-generated Dockerfiles?\n\nThis writes Dockerfile.shipdeck next to each app. Your original Dockerfile files are not overwritten."
      );
      if (!ok) return;
      setBusy(true);
      try {
        const r = await api.generateDockerfiles(boxes);
        if (r.suggestedBoxes) onChange(r.suggestedBoxes);
        else {
          onChange({
            ...boxes,
            build: { ...boxes.build, dockerfileChoice: "generated" },
          });
        }
        setReview(await api.reviewDockerfiles(r.suggestedBoxes ?? boxes));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
      return;
    }
    const ok = window.confirm(
      "Keep the Dockerfiles already in the repo?\n\nCompose will build each service from its own Dockerfile. Shipdeck will not look for a single root Dockerfile."
    );
    if (!ok) return;
    const first = review?.discovered.find((d) => d.valid && !d.generated)?.path;
    onChange({
      ...boxes,
      build: {
        ...boxes.build,
        dockerfileChoice: "existing",
        dockerfilePath: first || boxes.build.dockerfilePath,
      },
    });
  }

  const choice = boxes.build.dockerfileChoice;

  return (
    <div className="detection" style={{ marginTop: 12 }}>
      <strong>Dockerfiles vs source</strong>
      {boxes.source.mode === "remote" && (
        <p className="muted" style={{ margin: "6px 0" }}>
          Uses your Git connection (cloned for review). No local folder needed.
        </p>
      )}
      <p className="muted" style={{ margin: "6px 0" }}>
        Current choice:{" "}
        {choice === "generated"
          ? "Shipdeck generated Dockerfile.shipdeck"
          : choice === "existing"
            ? "repo Dockerfiles"
            : "not chosen yet"}
      </p>
      <button type="button" className="btn" onClick={loadReview} disabled={busy}>
        {busy ? (boxes.source.mode === "remote" ? "Cloning Git…" : "Checking…") : "Review Dockerfiles vs source"}
      </button>
      {error && <p className="muted">{error}</p>}
      {review && (
        <>
          <p style={{ marginTop: 10 }}>
            {review.hasExisting ? (
              review.configuredExists && review.discrepancies.length === 0 ? (
                <>
                  Found <code>{review.configuredPath}</code> — it matches the source. Use{" "}
                  <strong>Keep existing Dockerfiles</strong>.
                </>
              ) : (
                <>
                  Found Dockerfiles in the repo. Build was looking for{" "}
                  <code>{review.configuredPath}</code>
                  {review.configuredExists ? "." : " (missing)."} Compare, then choose.
                </>
              )
            ) : (
              <>No Dockerfile in this folder. Shipdeck can create Dockerfile.shipdeck from source.</>
            )}
          </p>
          {review.discovered.filter((d) => d.valid).length > 0 && (
            <p className="muted" style={{ marginTop: 8 }}>
              In repo:{" "}
              {review.discovered
                .filter((d) => d.valid)
                .map((d) => `${d.path}${d.expose.length ? ` (EXPOSE ${d.expose.join(",")})` : ""}`)
                .join(" · ")}
            </p>
          )}
          {review.discrepancies.length > 0 && (
            <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
              {review.discrepancies.map((d) => (
                <li key={d.id}>{d.message}</li>
              ))}
            </ul>
          )}
          <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
            {review.hasExisting && (
              <button
                type="button"
                className={review.recommendation === "existing" ? "btn btn-primary" : "btn"}
                onClick={() => choose("existing")}
                disabled={busy}
              >
                Keep existing Dockerfiles
              </button>
            )}
            {(!review.hasExisting || review.recommendation === "generated") && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => choose("generated")}
                disabled={busy}
              >
                {review.hasExisting ? "Use generated Dockerfiles" : "Create Dockerfiles from source"}
              </button>
            )}
            {review.hasExisting && review.recommendation === "existing" && (
              <button type="button" className="btn" onClick={() => choose("generated")} disabled={busy}>
                Use generated copy anyway
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function VmSizePicker({
  provider,
  recommendedId,
  value,
  detection,
  boxes,
  onChange,
}: {
  provider: "aws" | "azure" | "gcp";
  recommendedId: string;
  value: string;
  detection: StackDetection | null;
  boxes: PipelineBoxes;
  onChange: (vmSize: string) => void;
}) {
  const [sizes, setSizes] = useState<Array<VmSizeOption & { recommended?: boolean }>>(() =>
    listVmSizesForCloud(provider)
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    void api
      .vmSizes(provider, boxes, detection ?? undefined)
      .then((r) => {
        if (cancelled) return;
        setSizes(r.sizes);
        if (!value && r.recommendedId) onChange(r.recommendedId);
      })
      .catch(() => {
        if (!cancelled) setSizes(listVmSizesForCloud(provider));
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, detection?.stack, detection?.compose?.services?.length]);

  const chosen = value || recommendedId;
  const differs = Boolean(recommendedId && chosen && recommendedId !== chosen);
  const chosenMeta = sizes.find((s) => s.id === chosen);
  const recMeta = sizes.find((s) => s.id === recommendedId);
  const [confirmMsg, setConfirmMsg] = useState<string | null>(null);

  function pick(which: "recommended" | "chosen") {
    if (which === "recommended" && recommendedId) {
      onChange(recommendedId);
      setConfirmMsg(`OK — using recommended size ${recommendedId}`);
    } else if (chosen) {
      onChange(chosen);
      setConfirmMsg(`OK — keeping your choice ${chosen}`);
    }
    window.setTimeout(() => setConfirmMsg(null), 4000);
  }

  return (
    <div className="field">
      <label>VM size {busy ? "(loading…)" : `(from ${provider.toUpperCase()} catalog)`}</label>
      <select
        value={chosen}
        onChange={(e) => {
          onChange(e.target.value);
          setConfirmMsg(null);
        }}
      >
        {!sizes.some((s) => s.id === chosen) && chosen && (
          <option value={chosen}>{chosen} (custom / current)</option>
        )}
        {sizes.map((s) => (
          <option key={s.id} value={s.id}>
            {s.recommended ? `★ ${s.label}` : s.label}
          </option>
        ))}
      </select>
      {chosenMeta?.tip && (
        <p className="muted" style={{ marginTop: 6 }}>
          {chosenMeta.tip}
        </p>
      )}
      {differs && (
        <div className="detection" style={{ marginTop: 10 }}>
          <strong>Which size should Shipdeck use?</strong>
          <p style={{ margin: "6px 0" }}>
            Recommended: <code>{recommendedId}</code>
            {recMeta ? ` (~${recMeta.ramGb} GB)` : ""}
            <br />
            You selected: <code>{chosen}</code>
            {chosenMeta ? ` (~${chosenMeta.ramGb} GB)` : ""}
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn btn-primary" onClick={() => pick("recommended")}>
              Use recommended ({recommendedId})
            </button>
            <button type="button" className="btn" onClick={() => pick("chosen")}>
              Keep my choice ({chosen})
            </button>
          </div>
        </div>
      )}
      {confirmMsg && (
        <div className="detection" style={{ marginTop: 10 }}>
          <strong>{confirmMsg}</strong>
        </div>
      )}
    </div>
  );
}

const GCP_REGIONS = [
  "us-central1",
  "us-east1",
  "us-west1",
  "europe-west1",
  "europe-west2",
  "europe-west3",
  "europe-west4",
  "europe-north1",
  "asia-south1",
  "asia-southeast1",
  "asia-east1",
  "australia-southeast1",
] as const;

/** AWS-style region e.g. eu-west-1 / us-east-1 (NOT a GCP or Azure name). */
function isAwsStyleRegion(region: string): boolean {
  return /^(eu|us|ap|sa|ca|me|af)-[a-z]+-\d+[a-z]?$/i.test(region.trim());
}

const AWS_TO_GCP_REGION: Record<string, string> = {
  "eu-west-1": "europe-west1",
  "eu-west-2": "europe-west2",
  "eu-west-3": "europe-west3",
  "eu-central-1": "europe-west3",
  "us-east-1": "us-east1",
  "us-west-1": "us-west1",
  "us-west-2": "us-west1",
  "ap-south-1": "asia-south1",
  "ap-southeast-1": "asia-southeast1",
  "ap-southeast-2": "australia-southeast1",
  "ap-northeast-1": "asia-east1",
};

function regionForProvider(
  provider: "aws" | "azure" | "gcp",
  current: string | undefined
): string {
  const cur = (current ?? "").trim();
  if (provider === "gcp") {
    if ((GCP_REGIONS as readonly string[]).includes(cur)) return cur;
    if (AWS_TO_GCP_REGION[cur]) return AWS_TO_GCP_REGION[cur];
    // Valid non-catalog GCP region (e.g. northamerica-northeast1) — keep it.
    if (cur && !isAwsStyleRegion(cur) && /^[a-z]+-[a-z]+\d+(-[a-z]+\d+)?$/.test(cur)) return cur;
    return "us-central1";
  }
  if (provider === "aws") {
    if (isAwsStyleRegion(cur)) return cur;
    if (cur === "europe-west1") return "eu-west-1";
    if (cur === "europe-west2") return "eu-west-2";
    return "eu-west-1";
  }
  // Azure region names have no hyphens (eastus, westeurope, …)
  if (/^[a-z]+$/.test(cur)) return cur;
  return "eastus";
}

function BoxEditor({
  box,
  boxes,
  connections,
  detection,
  detectBusy = false,
  detectMsg = null,
  onChange,
  onDetect,
}: {
  box: PipelineBoxType;
  boxes: PipelineBoxes;
  connections: Connection[];
  detection: StackDetection | null;
  detectBusy?: boolean;
  detectMsg?: string | null;
  onChange: (b: PipelineBoxes) => void;
  onDetect: () => void | Promise<void>;
}) {
  const patch = (partial: Partial<PipelineBoxes>) => onChange({ ...boxes, ...partial });
  const byType = (t: ConnectionType) => connections.filter((c) => c.type === t);

  // When Create + cloud connection has a region, use it as default (fix Azure leftovers on AWS).
  useEffect(() => {
    if (boxes.infra.mode !== "create" || !boxes.infra.cloudConnectionId) return;
    const conn = connections.find((c) => c.id === boxes.infra.cloudConnectionId);
    const fromConn = conn?.config.region?.trim() || conn?.config.location?.trim();
    if (!fromConn) return;
    const current = boxes.infra.region?.trim() || "";
    const provider = boxes.infra.cloudProvider ?? "aws";
    const azureLeftoverOnAws =
      provider === "aws" && /^(eastus|westus|centralus|northeurope)/i.test(current);
    if (!current || azureLeftoverOnAws) {
      if (current === fromConn) return;
      onChange({
        ...boxes,
        infra: { ...boxes.infra, region: fromConn },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boxes.infra.mode, boxes.infra.cloudConnectionId, boxes.infra.cloudProvider, connections]);

  // Fix cross-provider region leftovers (e.g. AWS eu-west-1 carried onto GCP,
  // where it is invalid — GCP uses europe-west1). Never auto-runs twice:
  // the corrected value is valid for the provider, so the effect settles.
  useEffect(() => {
    if (boxes.infra.mode !== "create") return;
    const provider = boxes.infra.cloudProvider ?? "aws";
    const current = boxes.infra.region?.trim() || "";
    if (!current) return;
    const fixed = regionForProvider(provider, current);
    if (fixed !== current) {
      onChange({ ...boxes, infra: { ...boxes.infra, region: fixed } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boxes.infra.mode, boxes.infra.cloudProvider, boxes.infra.region]);

  if (box === "source") {
    const s = boxes.source;
    return (
      <>
        <div className="field">
          <label>Mode</label>
          <select
            value={s.mode}
            onChange={(e) => {
              const mode = e.target.value as "local" | "remote";
              patch({
                source: {
                  ...s,
                  mode,
                  ...(mode === "local" ? { gitConnectionId: "" } : {}),
                },
              });
            }}
          >
            <option value="local">Local folder / branch</option>
            <option value="remote">Remote Git</option>
          </select>
        </div>
        {s.mode === "local" ? (
          <div className="field">
            <label>Local path</label>
            <input
              value={s.localPath ?? ""}
              onChange={(e) => patch({ source: { ...s, localPath: e.target.value } })}
              placeholder="C:/Users/you/my-app"
            />
            <p className="muted" style={{ marginTop: 8 }}>
              Shipdeck checks <code>docker-compose.yml</code> against the source. If it does not
              match, you choose: keep the file, or use a generated one.
            </p>
            <button
              type="button"
              className="btn"
              style={{ marginTop: 8 }}
              disabled={detectBusy}
              onClick={() => void onDetect()}
            >
              {detectBusy ? "Scanning…" : "Detect from folder"}
            </button>
            <ComposeReviewPanel boxes={boxes} onChange={onChange} />
          </div>
        ) : (
          <div className="field">
            <label>Git connection</label>
            <select
              value={s.gitConnectionId ?? ""}
              onChange={(e) => patch({ source: { ...s, gitConnectionId: e.target.value } })}
            >
              <option value="">Select…</option>
              {byType("git").map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <p className="muted" style={{ marginTop: 8 }}>
              Review and Detect clone this Git repo here. You do not need a local folder.
            </p>
            <button
              type="button"
              className="btn"
              style={{ marginTop: 8 }}
              disabled={detectBusy}
              onClick={() => void onDetect()}
            >
              {detectBusy ? "Scanning…" : "Detect from Git"}
            </button>
            <ComposeReviewPanel boxes={boxes} onChange={onChange} />
          </div>
        )}
        <div className="field">
          <label>Branch</label>
          <input
            value={s.branch}
            onChange={(e) => patch({ source: { ...s, branch: e.target.value } })}
          />
        </div>
      </>
    );
  }

  if (box === "infra") {
    const i = boxes.infra;
    const provider = (i.cloudProvider ?? "aws") as "aws" | "azure" | "gcp";
    const sizing: VmSizeRecommendation | null =
      detection?.vmSizing ??
      (detection
        ? recommendVmSize({
            stack: detection.stack,
            signals: detection.signals,
            compose: detection.compose,
            cloudProvider: provider,
          })
        : null);
    const suggestedKind: ServerlessKind = suggestServerlessKind(detection?.compose);
    const serverlessKind: ServerlessKind = i.serverlessKind ?? suggestedKind;
    const serverlessSizing: ServerlessSizingRecommendation | null = detection
      ? detection.serverlessSizing?.kind === serverlessKind
        ? detection.serverlessSizing
        : recommendServerlessSize({
            stack: detection.stack,
            signals: detection.signals,
            compose: detection.compose,
            kind: serverlessKind,
          })
      : null;
    const recommended = sizing ? vmSizeForProvider(sizing, provider) : "";
    const currentRam = approxRamGbForVmSize(i.vmSize);
    const tooSmall = sizing && currentRam !== null && currentRam < sizing.minRamGb;

    function applyRecommendedSize(alsoCreate: boolean) {
      if (!sizing) return;
      patch({
        infra: {
          ...i,
          mode: alsoCreate ? "create" : i.mode === "skip" ? "create" : i.mode,
          cloudProvider: provider,
          vmSize: recommended,
        },
      });
    }

    function applyServerlessRecommendation() {
      if (!serverlessSizing) return;
      patch({
        infra: {
          ...i,
          mode: "create",
          computeMode: "serverless",
          serverlessKind: i.serverlessKind ?? suggestedKind,
          serverlessMemoryMb: serverlessSizing.memoryMb,
          serverlessTimeoutSeconds: serverlessSizing.timeoutSeconds,
          serverlessRuntime: serverlessSizing.runtimeHint,
        },
      });
    }

    return (
      <>
        <div className="field">
          <label>Mode</label>
          <select
            value={i.mode}
            onChange={(e) =>
              patch({
                infra: { ...i, mode: e.target.value as typeof i.mode },
              })
            }
          >
            <option value="existing">Use existing (VM or serverless)</option>
            <option value="create">Create new (Terraform)</option>
            <option value="skip">Skip infra</option>
          </select>
        </div>
        {i.mode === "create" && (
          <div className="config-section">
            <h3 className="config-section-title">Deployment decisions</h3>
            <div className="field decision-field">
              <label>Compute target</label>
              <select
                value={i.computeMode ?? "vm"}
                onChange={(e) => {
                  const computeMode = e.target.value as "vm" | "serverless";
                  if (computeMode === "serverless") {
                    const kind = i.serverlessKind ?? suggestedKind;
                    patch({
                      infra: {
                        ...i,
                        computeMode,
                        serverlessKind: kind,
                        ...(serverlessSizing
                          ? {
                              serverlessMemoryMb: serverlessSizing.memoryMb,
                              serverlessTimeoutSeconds: serverlessSizing.timeoutSeconds,
                              serverlessRuntime: serverlessSizing.runtimeHint,
                            }
                          : {}),
                      },
                    });
                    return;
                  }
                  patch({ infra: { ...i, computeMode } });
                }}
              >
              <option value="vm">Virtual machine (Create VM)</option>
              <option value="serverless">Serverless (function or full app UI)</option>
              </select>
              <details className="field-help">
                <summary>How this target works</summary>
                <p className="muted">
                  {(i.computeMode ?? "vm") === "serverless"
                    ? "Not Create VM / EC2. Health function = Lambda (JSON). Full app = ECS Express Mode (containers) + serverless Aurora/Redis — still no SSH VM."
                    : "Classic path: Terraform VM + Docker via cloud-init + Deploy PEM SSH."}
                </p>
              </details>
            </div>
          </div>
        )}
        {(i.computeMode ?? "vm") === "serverless" && i.mode === "create" && (
          <div className="field decision-field">
            <label>Serverless kind</label>
            <select
              value={serverlessKind}
              onChange={(e) =>
                patch({
                  infra: {
                    ...i,
                    serverlessKind: e.target.value as ServerlessKind,
                  },
                })
              }
            >
              <option value="function">Health function (Lambda / Functions / Cloud Functions)</option>
              <option value="app">Full app UI (ECS Express / Container Apps / Cloud Run)</option>
            </select>
            <details className="field-help">
              <summary>Architecture notes</summary>
              <p className="muted">
                {serverlessKind === "app"
                  ? "Not Lambda: a /shipper UI cannot run as a zip function. Uses Amazon ECS Express Mode + Aurora Serverless + ElastiCache Serverless. CPU/memory/DB SKUs come from Re-scan sizing — not baked into Terraform."
                  : "This is the Lambda / Functions path: HTTPS health JSON only — not the Next.js /shipper UI."}
              </p>
            </details>
            {suggestedKind === "app" && serverlessKind === "function" ? (
              <div className="insight-banner recommend" style={{ marginTop: 10 }}>
                <strong>Detection recommends Full app</strong>
                This project looks like a UI/compose stack — switch to Full app UI for /shipper.
              </div>
            ) : null}
            {suggestedKind === "app" && serverlessKind === "app" ? (
              <div className="insight-banner" style={{ marginTop: 10 }}>
                <strong>Full app path</strong>
                ECS Express + Aurora/Redis Serverless — sized from Re-scan, not hardcoded Terraform.
              </div>
            ) : null}
          </div>
        )}
        {sizing && (i.computeMode ?? "vm") === "vm" && (
          <div className="insight-banner recommend" style={{ marginBottom: 12 }}>
            <strong>Recommended VM size</strong>
            <p style={{ margin: "6px 0" }}>{sizing.summary}</p>
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              {sizing.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            <p className="muted" style={{ marginTop: 8, color: "var(--text-muted)" }}>
              AWS <code>{sizing.aws}</code> · Azure <code>{sizing.azure}</code> · GCP{" "}
              <code>{sizing.gcp}</code>
              {sizing.warning ? ` — ${sizing.warning}` : ""}
            </p>
            {tooSmall && (
              <p style={{ marginTop: 8, color: "#c44" }}>
                Current size <code>{i.vmSize}</code> looks too small (~{currentRam} GB). Use at least ~
                {sizing.minRamGb} GB.
              </p>
            )}
            <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="btn btn-primary" onClick={() => applyRecommendedSize(true)}>
                Use recommendation &amp; Create VM
              </button>
              <button type="button" className="btn" onClick={() => applyRecommendedSize(false)}>
                Apply size only
              </button>
              <button
                type="button"
                className="btn"
                disabled={detectBusy}
                onClick={() => void onDetect()}
              >
                {detectBusy ? "Scanning…" : "Re-scan project size"}
              </button>
            </div>
            <p className="muted" style={{ marginTop: 8 }}>
              Then pick the cloud login, Save, switch to Real cloud, and choose Ship now. Terraform creates the
              VM, then Shipdeck deploys your Git/local source.
            </p>
          </div>
        )}
        {!sizing && (i.computeMode ?? "vm") === "vm" && i.mode === "create" && (
          <p className="muted" style={{ marginBottom: 12 }}>
            Run Detect from Source first so Shipdeck can recommend a VM size from your project.
            <button
              type="button"
              className="btn"
              style={{ marginLeft: 8 }}
              disabled={detectBusy}
              onClick={() => void onDetect()}
            >
              {detectBusy ? "Scanning…" : "Detect / size project"}
            </button>
          </p>
        )}
        {(i.computeMode ?? "vm") === "serverless" && i.mode === "create" && (
          <div className="insight-banner recommend" style={{ marginBottom: 12 }}>
            <strong>
              {serverlessKind === "app"
                ? "Serverless Full app UI"
                : "Serverless Health function"}
            </strong>
            <p style={{ margin: "6px 0" }}>
              {serverlessKind === "app"
                ? "AWS ECS Express Mode · Azure Container Apps · GCP Cloud Run, plus managed Postgres and Redis. Shipdeck builds Docker images from your compose contexts, pushes to the cloud registry, then applies Terraform."
                : "AWS Lambda · Azure Functions · GCP Cloud Functions (2nd gen). Shipdeck packages a health JSON endpoint, applies Terraform, then Deploy refreshes the function code."}
            </p>
            {serverlessKind === "app" && (
              <p style={{ margin: "6px 0", color: "var(--accent)" }}>
                Set Source to <strong>Remote Git</strong>. Images are built in the cloud: AWS
                CodeBuild, Azure ACR Tasks, or GCP Cloud Build. Docker on this PC is optional.
              </p>
            )}
            {serverlessSizing ? (
              <>
                <p style={{ margin: "8px 0 4px" }}>
                  <strong>From project:</strong> {serverlessSizing.summary}
                </p>
                <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                  {serverlessSizing.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
                {serverlessSizing.warning && (
                  <p style={{ marginTop: 8, color: "#a85720" }}>{serverlessSizing.warning}</p>
                )}
                <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={applyServerlessRecommendation}
                  >
                    {serverlessKind === "app"
                      ? "Use recommended container memory"
                      : "Use recommended memory & timeout"}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={detectBusy}
                    onClick={() => void onDetect()}
                  >
                    {detectBusy ? "Scanning…" : "Re-scan project"}
                  </button>
                </div>
                {detectMsg && (
                  <p
                    className="muted"
                    style={{
                      marginTop: 8,
                      color: /fail|error|not found/i.test(detectMsg)
                        ? "var(--danger, #c44)"
                        : undefined,
                    }}
                  >
                    {detectMsg}
                  </p>
                )}
              </>
            ) : (
              <p className="muted" style={{ marginTop: 8 }}>
                Run Detect from Source to auto-suggest memory / timeout — you can still edit the
                fields below.
                <button
                  type="button"
                  className="btn"
                  style={{ marginLeft: 8 }}
                  disabled={detectBusy}
                  onClick={() => void onDetect()}
                >
                  {detectBusy ? "Scanning…" : "Detect project"}
                </button>
              </p>
            )}
          </div>
        )}
        {i.mode === "existing" && (
          <>
            <div className="field decision-field">
              <label>Existing target</label>
              <select
                value={i.computeMode ?? "vm"}
                onChange={(e) =>
                  patch({ infra: { ...i, computeMode: e.target.value as "vm" | "serverless" } })
                }
              >
                <option value="vm">Virtual machine (SSH)</option>
                <option value="serverless">Serverless (update the live URL)</option>
              </select>
              <p className="muted">
                {(i.computeMode ?? "vm") === "serverless"
                  ? "No SSH. Pick the AWS / Azure / GCP connection that holds the live service URL. Deploy rebuilds and updates that same URL."
                  : "SSH into the existing VM and redeploy there."}
              </p>
            </div>
            {(i.computeMode ?? "vm") === "serverless" ? (
              <div className="field">
                <label>Cloud connection (live service URL)</label>
                <select
                  value={i.cloudConnectionId ?? ""}
                  onChange={(e) => {
                    const cloudConnectionId = e.target.value;
                    const conn = connections.find((c) => c.id === cloudConnectionId);
                    const provider =
                      conn?.type === "azure" || conn?.type === "gcp" || conn?.type === "aws"
                        ? conn.type
                        : i.cloudProvider;
                    patch({
                      infra: {
                        ...i,
                        cloudConnectionId,
                        cloudProvider: provider,
                        region: conn?.config.region || i.region,
                        serverlessKind:
                          conn?.config.serverlessKind === "function" ? "function" : "app",
                      },
                    });
                  }}
                >
                  <option value="">Select…</option>
                  {(["aws", "azure", "gcp"] as ConnectionType[]).flatMap((type) =>
                    byType(type).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {c.config.serviceUrl ? ` · ${c.config.serviceUrl}` : ""}
                      </option>
                    ))
                  )}
                </select>
                {(() => {
                  const conn = connections.find((c) => c.id === i.cloudConnectionId);
                  if (!conn?.config.serviceUrl) return null;
                  return (
                    <p className="muted" style={{ marginTop: 6 }}>
                      Next version updates <code>{conn.config.serviceUrl}</code>
                    </p>
                  );
                })()}
              </div>
            ) : (
          <>
            <div className="field">
              <label>SSH connection</label>
              <select
                value={i.sshConnectionId ?? ""}
                onChange={(e) => patch({ infra: { ...i, sshConnectionId: e.target.value } })}
              >
                <option value="">Select…</option>
                {byType("ssh").map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Azure connection (optional — to open public ports on the NSG)</label>
              <select
                value={i.cloudConnectionId ?? ""}
                onChange={(e) => patch({ infra: { ...i, cloudConnectionId: e.target.value } })}
              >
                <option value="">None — OS firewall only / Portal</option>
                {byType("azure").map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <PublicPortsPanel boxes={boxes} detection={detection} />
              </>
            )}
          </>
        )}
        {i.mode === "create" && (
          <>
            <div className="field decision-field">
              <label>Cloud provider</label>
              <select
                value={i.cloudProvider ?? "aws"}
                onChange={(e) => {
                  const cloudProvider = e.target.value as "azure" | "aws" | "gcp";
                  const nextSize = sizing
                    ? vmSizeForProvider(sizing, cloudProvider)
                    : i.vmSize;
                  patch({
                    infra: {
                      ...i,
                      cloudProvider,
                      vmSize: nextSize,
                      region: regionForProvider(cloudProvider, i.region),
                    },
                  });
                }}
              >
                <option value="aws">AWS</option>
                <option value="azure">Azure</option>
                <option value="gcp">GCP</option>
              </select>
            </div>
            <div className="field">
              <label>Cloud connection</label>
              <select
                value={i.cloudConnectionId ?? ""}
                onChange={(e) => {
                  const cloudConnectionId = e.target.value;
                  const conn = connections.find((c) => c.id === cloudConnectionId);
                  const fromConn = conn?.config.region?.trim() || conn?.config.location?.trim();
                  patch({
                    infra: {
                      ...i,
                      cloudConnectionId,
                      ...(fromConn ? { region: fromConn } : {}),
                    },
                  });
                }}
              >
                <option value="">Select…</option>
                {byType(i.cloudProvider ?? "aws").map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.config.region ? ` · ${c.config.region}` : ""}
                  </option>
                ))}
              </select>
            </div>
            {(i.computeMode ?? "vm") === "vm" && (
              <>
                <div className="field">
                  <label>SSH connection (optional)</label>
                  <select
                    value={i.sshConnectionId ?? ""}
                    onChange={(e) => patch({ infra: { ...i, sshConnectionId: e.target.value } })}
                  >
                    <option value="">None — use Deploy PEM on cloud connection</option>
                    {byType("ssh").map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="muted">
                  <strong>Enterprise VM create:</strong> paste <strong>Deploy PEM</strong> on the
                  cloud connection. After Terraform creates the server, Shipdeck SSHes with that PEM.
                  SSH connection here is only an override.
                </p>
              </>
            )}
            {(i.computeMode ?? "vm") === "serverless" && (
              <p className="muted">
                <strong>Enterprise serverless create:</strong> only cloud credentials are required
                (no Deploy PEM / SSH).
                {serverlessKind === "app"
                  ? " Full app: cloud clones Git and builds images (AWS CodeBuild, Azure ACR Tasks, GCP Cloud Build). Docker on this PC is optional. Registry/DB permissions required."
                  : " Health functions are public HTTPS endpoints for verify."}
              </p>
            )}
            <div className="field">
              <label>Region</label>
              {(i.cloudProvider ?? "aws") === "gcp" ? (
                <select
                  value={regionForProvider("gcp", i.region)}
                  onChange={(e) => patch({ infra: { ...i, region: e.target.value } })}
                >
                  {GCP_REGIONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={i.region ?? ""}
                  onChange={(e) => patch({ infra: { ...i, region: e.target.value } })}
                  placeholder={
                    connections.find((c) => c.id === i.cloudConnectionId)?.config.region ||
                    (i.cloudProvider === "aws" ? "eu-west-1" : "eastus")
                  }
                />
              )}
              {(() => {
                const conn = connections.find((c) => c.id === i.cloudConnectionId);
                const fromConn = conn?.config.region?.trim();
                if (!fromConn) {
                  return (
                    <p className="muted" style={{ marginTop: 6 }}>
                      Tip: set Region on the cloud connection — it becomes the default here.
                    </p>
                  );
                }
                return (
                  <p className="muted" style={{ marginTop: 6 }}>
                    From connection <strong>{conn?.name}</strong>: <code>{fromConn}</code>
                    {i.region?.trim() !== fromConn ? (
                      <button
                        type="button"
                        className="btn"
                        style={{ marginLeft: 8 }}
                        onClick={() => patch({ infra: { ...i, region: fromConn } })}
                      >
                        Use connection region
                      </button>
                    ) : (
                      " (default applied)"
                    )}
                  </p>
                );
              })()}
            </div>
            {(i.computeMode ?? "vm") === "serverless" ? (
              <>
                {serverlessKind === "function" && (
                  <div className="field">
                    <label>Runtime</label>
                    <select
                      value={i.serverlessRuntime ?? "nodejs20"}
                      onChange={(e) =>
                        patch({
                          infra: {
                            ...i,
                            serverlessRuntime: e.target.value as "nodejs20" | "python312",
                          },
                        })
                      }
                    >
                      <option value="nodejs20">Node.js 20</option>
                      <option value="python312">Python 3.12</option>
                    </select>
                    {serverlessSizing && (
                      <p className="muted" style={{ marginTop: 6 }}>
                        Suggested from project: <code>{serverlessSizing.runtimeHint}</code>
                      </p>
                    )}
                  </div>
                )}
                <div className="field">
                  <label>
                    {serverlessKind === "app" ? "Container memory (MB)" : "Memory (MB)"}
                  </label>
                  <input
                    type="number"
                    min={128}
                    max={10240}
                    step={64}
                    value={i.serverlessMemoryMb ?? serverlessSizing?.memoryMb ?? 512}
                    onChange={(e) =>
                      patch({
                        infra: { ...i, serverlessMemoryMb: Number(e.target.value) || 512 },
                      })
                    }
                  />
                  <p className="muted" style={{ marginTop: 6 }}>
                    {serverlessKind === "app"
                      ? "Mapped to ECS Express / Container Apps / Cloud Run CPU & memory."
                      : serverlessSizing
                        ? `Auto from project: ${serverlessSizing.memoryMb} MB`
                        : "Function memory allocation."}
                  </p>
                </div>
                {serverlessKind === "function" && (
                  <div className="field">
                    <label>Timeout (seconds)</label>
                    <input
                      type="number"
                      min={1}
                      max={900}
                      value={i.serverlessTimeoutSeconds ?? serverlessSizing?.timeoutSeconds ?? 30}
                      onChange={(e) =>
                        patch({
                          infra: {
                            ...i,
                            serverlessTimeoutSeconds: Number(e.target.value) || 30,
                          },
                        })
                      }
                    />
                    {serverlessSizing && (
                      <p className="muted" style={{ marginTop: 6 }}>
                        Auto from project: <strong>{serverlessSizing.timeoutSeconds}s</strong>
                      </p>
                    )}
                  </div>
                )}
              </>
            ) : (
              <VmSizePicker
                provider={provider}
                recommendedId={recommended}
                value={i.vmSize ?? ""}
                detection={detection}
                boxes={boxes}
                onChange={(vmSize) => patch({ infra: { ...i, vmSize } })}
              />
            )}
          </>
        )}
      </>
    );
  }

  if (box === "build") {
    const b = boxes.build;
    return (
      <>
        <div className="field">
          <label>Dockerfile path</label>
          <input
            value={b.dockerfilePath ?? ""}
            onChange={(e) => patch({ build: { ...b, dockerfilePath: e.target.value } })}
            placeholder="Dockerfile or services/api/Dockerfile"
          />
          <p className="muted" style={{ marginTop: 8 }}>
            For Compose apps, each service uses its own Dockerfile. Review below if the root file is
            missing.
          </p>
        </div>
        <div className="field">
          <label>Image name</label>
          <input
            value={b.imageName ?? ""}
            onChange={(e) => patch({ build: { ...b, imageName: e.target.value } })}
          />
        </div>
        <div className="field">
          <label>Image version</label>
          <input
            value={imageVersionForRegistry(b, b.registryConnectionId)}
            onChange={(e) => {
              const imageVersion = e.target.value;
              const id = b.registryConnectionId?.trim();
              patch({
                build: {
                  ...b,
                  imageVersion,
                  imageVersions: id ? { ...b.imageVersions, [id]: imageVersion } : b.imageVersions,
                },
              });
            }}
            placeholder="v1.1.0"
          />
          <p className="muted" style={{ marginTop: 8 }}>
            This number belongs to the Docker Hub login below. A new login starts at v1.0.0. After that login pushes successfully, the next ship uses v1.0.1.
          </p>
        </div>
        <div className="field">
          <label>Registry connection</label>
          <select
            value={b.registryConnectionId ?? ""}
            onChange={(e) => {
              const registryConnectionId = e.target.value;
              const imageVersions = { ...(b.imageVersions ?? {}) };
              const previous = b.registryConnectionId?.trim();
              if (previous) imageVersions[previous] = imageVersionForRegistry(b, previous);
              const imageVersion = registryConnectionId
                ? imageVersions[registryConnectionId]?.trim() || "v1.0.0"
                : b.imageVersion ?? "v1.0.0";
              patch({ build: { ...b, registryConnectionId, imageVersion, imageVersions } });
            }}
          >
            <option value="">None</option>
            {byType("registry").map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>
            <input
              type="checkbox"
              checked={b.runTests}
              onChange={(e) => patch({ build: { ...b, runTests: e.target.checked } })}
            />{" "}
            Run tests
          </label>
        </div>
        <DockerfileReviewPanel boxes={boxes} onChange={onChange} />
        <TestReviewPanel boxes={boxes} onChange={onChange} />
      </>
    );
  }

  if (box === "deploy") {
    const d = boxes.deploy;
    const compose = detection?.compose;
    const detectedPorts = compose
      ? [...new Set(compose.services.flatMap((s) => s.ports))]
      : [];
    const publicDetected = splitPublishPorts(detectedPorts).publicPorts;
    const envText = Object.entries(d.envVars || {})
      .map(([k, v]) => `${k}=${v}`)
      .join("\n");
    return (
      <>
        {compose && (
          <div className="detection" style={{ marginBottom: 12 }}>
            From <strong>{compose.file}</strong> — {compose.services.length} services detected.
            Runtime set to <strong>Compose</strong>; all services start together.
            <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
              {compose.services.map((s) => (
                <li key={s.name}>
                  <strong>{s.name}</strong>
                  {s.ports.length ? ` → host port(s) ${s.ports.join(", ")}` : " (no published ports)"}
                  {compose.suggestedPrimaryService === s.name ? " · health target" : ""}
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="btn"
              style={{ marginTop: 8 }}
              disabled={detectBusy}
              onClick={() => void onDetect()}
            >
              {detectBusy ? "Scanning…" : "Re-detect from source"}
            </button>
          </div>
        )}
        {!compose && (
          <p className="muted" style={{ marginBottom: 12 }}>
            No compose file detected yet. Click Detect — local folder or Git clone both work. Need{" "}
            <code>docker-compose.yml</code> in the repo.
            <button
              type="button"
              className="btn"
              style={{ marginLeft: 8 }}
              disabled={detectBusy}
              onClick={() => void onDetect()}
            >
              {detectBusy ? "Scanning…" : "Detect"}
            </button>
          </p>
        )}
        <div className="field">
          <label>Runtime</label>
          <select
            value={d.runtime}
            onChange={(e) =>
              patch({
                deploy: { ...d, runtime: e.target.value as typeof d.runtime },
              })
            }
          >
            <option value="docker">Docker</option>
            <option value="compose">Docker Compose</option>
            <option value="systemd">systemd</option>
            <option value="kubernetes">Kubernetes</option>
          </select>
        </div>
        <div className="field">
          <label>{compose ? "Health-check port (website/API, not database)" : "Port"}</label>
          {publicDetected.length > 0 && (
            <select
              value={publicDetected.includes(d.port) ? String(d.port) : "custom"}
              onChange={(e) => {
                if (e.target.value === "custom") return;
                patch({ deploy: { ...d, port: Number(e.target.value) } });
              }}
              style={{ marginBottom: 8 }}
            >
              {publicDetected.map((p) => (
                <option key={p} value={p}>
                  {p}
                  {compose?.suggestedPort === p ? " (suggested)" : ""}
                </option>
              ))}
              <option value="custom">Type a port…</option>
            </select>
          )}
          <input
            type="number"
            value={d.port}
            onChange={(e) => patch({ deploy: { ...d, port: Number(e.target.value) } })}
          />
          {compose && publicDetected.length === 0 && (
            <p className="muted" style={{ marginTop: 6 }}>
              This compose file may only list databases. Type the real website/API port.
            </p>
          )}
          {compose && publicDetected.length > 0 && (
            <p className="muted" style={{ marginTop: 6 }}>
              Verify should use the website/API port (not 5432/6379).
            </p>
          )}
        </div>
        <div className="field">
          <label>Domain (optional)</label>
          <input
            value={d.domain ?? ""}
            onChange={(e) => patch({ deploy: { ...d, domain: e.target.value } })}
            placeholder="app.example.com"
          />
        </div>
        <div className="field">
          <label>Health path</label>
          <input
            value={d.healthPath}
            onChange={(e) => patch({ deploy: { ...d, healthPath: e.target.value } })}
          />
        </div>
        <div className="field">
          <label>Env vars (KEY=value per line)</label>
          <textarea
            value={envText}
            onChange={(e) => {
              const envVars: Record<string, string> = {};
              for (const line of e.target.value.split(/\r?\n/)) {
                const i = line.indexOf("=");
                if (i <= 0) continue;
                envVars[line.slice(0, i).trim()] = line.slice(i + 1);
              }
              patch({ deploy: { ...d, envVars } });
            }}
            placeholder={"NODE_ENV=production\nLOG_LEVEL=info"}
          />
        </div>
        <PublicPortsPanel boxes={boxes} detection={detection} />
      </>
    );
  }

  if (box === "data") {
    const d = boxes.data;
    return (
      <>
        <div className="field">
          <label>
            <input
              type="checkbox"
              checked={d.enabled}
              onChange={(e) => patch({ data: { ...d, enabled: e.target.checked } })}
            />{" "}
            Enable data box
          </label>
        </div>
        {d.enabled && (
          <>
            <div className="field">
              <label>Engine</label>
              <select
                value={d.engine ?? "postgres"}
                onChange={(e) =>
                  patch({
                    data: { ...d, engine: e.target.value as typeof d.engine },
                  })
                }
              >
                <option value="postgres">PostgreSQL</option>
                <option value="mysql">MySQL</option>
                <option value="redis">Redis</option>
                <option value="mongodb">MongoDB</option>
              </select>
            </div>
            <div className="field">
              <label>
                <input
                  type="checkbox"
                  checked={d.createWithTerraform}
                  onChange={(e) =>
                    patch({ data: { ...d, createWithTerraform: e.target.checked } })
                  }
                />{" "}
                Provision database
              </label>
            </div>
            {d.createWithTerraform && (
              <div className="field">
                <label>Provision mode</label>
                <select
                  value={d.provisionMode ?? "docker"}
                  onChange={(e) =>
                    patch({
                      data: {
                        ...d,
                        provisionMode: e.target.value as "docker" | "terraform",
                      },
                    })
                  }
                >
                  <option value="docker">Docker container</option>
                  <option value="terraform">Managed cloud (Terraform)</option>
                </select>
              </div>
            )}
            <div className="field">
              <label>Env var name</label>
              <input
                value={d.connectionStringEnv ?? ""}
                onChange={(e) =>
                  patch({ data: { ...d, connectionStringEnv: e.target.value } })
                }
              />
            </div>
          </>
        )}
      </>
    );
  }

  if (box === "verify") {
    const v = boxes.verify;
    return (
      <>
        <div className="field">
          <label>Health URL</label>
          <input
            value={v.healthUrl ?? ""}
            onChange={(e) => patch({ verify: { ...v, healthUrl: e.target.value } })}
            placeholder="Auto from SSH host + Deploy port"
          />
          <p className="muted" style={{ marginTop: 8 }}>
            Fills in from your SSH host and Deploy health port. Old values like{" "}
            <code>:8080/health</code> are replaced. Save the pipeline after it updates.
          </p>
        </div>
        <div className="field">
          <label>Timeout (seconds)</label>
          <input
            type="number"
            value={v.timeoutSeconds}
            onChange={(e) =>
              patch({ verify: { ...v, timeoutSeconds: Number(e.target.value) } })
            }
          />
        </div>
        <div className="field">
          <label>
            <input
              type="checkbox"
              checked={v.autoRollback}
              onChange={(e) => patch({ verify: { ...v, autoRollback: e.target.checked } })}
            />{" "}
            Auto rollback on failure
          </label>
        </div>
        <PublicPortsPanel boxes={boxes} detection={detection} />
      </>
    );
  }

  const n = boxes.notify;
  return (
    <>
      <div className="field">
        <label>
          <input
            type="checkbox"
            checked={n.enabled}
            onChange={(e) => patch({ notify: { ...n, enabled: e.target.checked } })}
          />{" "}
          Enable notifications
        </label>
      </div>
      {n.enabled && (
        <div className="field">
          <label>Notify connection</label>
          <select
            value={n.notifyConnectionId ?? ""}
            onChange={(e) =>
              patch({ notify: { ...n, notifyConnectionId: e.target.value } })
            }
          >
            <option value="">Select…</option>
            {byType("notify").map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      )}
    </>
  );
}

function ConnectionsPanel({
  connections,
  onChange,
  onError,
  onGoPipeline,
}: {
  connections: Connection[];
  onChange: () => Promise<void>;
  onError: (msg: string) => void;
  onGoPipeline?: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [folder, setFolder] = useState<ConnectionFolder>(() => {
    const raw = sessionStorage.getItem(CONNECTIONS_FOLDER_KEY);
    return raw === "build" || raw === "deploy" ? raw : "build";
  });
  const [name, setName] = useState("");
  const [type, setType] = useState<ConnectionType>(() => {
    const raw = sessionStorage.getItem(CONNECTIONS_TYPE_KEY) as ConnectionType | null;
    return raw && typesForFolder(sessionStorage.getItem(CONNECTIONS_FOLDER_KEY) === "deploy" ? "deploy" : "build").includes(raw)
      ? raw
      : "jira";
  });
  const [host, setHost] = useState("");
  const [user, setUser] = useState("ubuntu");
  const [extra, setExtra] = useState("");
  const [secret, setSecret] = useState("");
  const [deployKey, setDeployKey] = useState("");
  const [jiraDeployment, setJiraDeployment] = useState<"cloud" | "datacenter">("cloud");
  const [jiraProjects, setJiraProjects] = useState("");
  const [jiraEmail, setJiraEmail] = useState("");
  const [jiraWebhook, setJiraWebhook] = useState("");
  const [jiraUpdate, setJiraUpdate] = useState(true);
  const [modelProvider, setModelProvider] = useState("azure-openai");
  const [modelUses, setModelUses] = useState<ModelJob[]>(DEFAULT_MODEL_JOBS);
  const [modelEndpoint, setModelEndpoint] = useState("");
  const [modelRegion, setModelRegion] = useState("");
  const [modelDeployment, setModelDeployment] = useState("");
  const [gitHost, setGitHost] = useState<"github" | "gitlab" | "azure-devops">("github");
  const [gitBot, setGitBot] = useState("");
  const [gitBranch, setGitBranch] = useState("main");
  const [gitAutoPr, setGitAutoPr] = useState(false);
  const [testing, setTesting] = useState(false);
  const folderTypes = typesForFolder(folder);
  const folderConnections = connections.filter((c) => connectionFolder(c.type) === folder);

  function selectFolder(next: ConnectionFolder) {
    setFolder(next);
    sessionStorage.setItem(CONNECTIONS_FOLDER_KEY, next);
    if (!editingId) {
      const nextType = typesForFolder(next)[0];
      setType(nextType);
      sessionStorage.setItem(CONNECTIONS_TYPE_KEY, nextType);
    }
  }
  const [pendingDeploy, setPendingDeploy] = useState<{
    ticketKey?: string;
    message?: string;
    createdConnections?: Array<{ id: string; name: string; type: string; created: boolean }>;
  } | null>(() => {
    try {
      const raw = sessionStorage.getItem(PENDING_DEPLOY_KEY);
      return raw
        ? (JSON.parse(raw) as {
            ticketKey?: string;
            message?: string;
            createdConnections?: Array<{ id: string; name: string; type: string; created: boolean }>;
          })
        : null;
    } catch {
      return null;
    }
  });
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    summary: string;
    technical?: string;
    hint?: string;
  } | null>(null);

  function resetForm() {
    setEditingId(null);
    setName("");
    setType(folderTypes[0]);
    setHost("");
    setUser("ubuntu");
    setExtra("");
    setSecret("");
    setDeployKey("");
    setJiraDeployment("cloud");
    setJiraProjects("");
    setJiraEmail("");
    setJiraWebhook("");
    setJiraUpdate(true);
    setModelProvider("azure-openai");
    setModelUses(DEFAULT_MODEL_JOBS);
    setModelEndpoint(modelProviderById("azure-openai").endpointHint);
    setModelRegion("");
    setModelDeployment("");
    setGitHost("github");
    setGitBot("");
    setGitBranch("main");
    setGitAutoPr(false);
    setTestResult(null);
  }

  function startEdit(c: Connection) {
    setEditingId(c.id);
    setName(c.name);
    setType(c.type);
    setFolder(connectionFolder(c.type));
    sessionStorage.setItem(CONNECTIONS_FOLDER_KEY, connectionFolder(c.type));
    setSecret("");
    setDeployKey("");
    setJiraWebhook("");
    setTestResult(null);
    const cfg = c.config ?? {};
    if (c.type === "ssh") {
      setHost(cfg.host ?? "");
      setUser(cfg.user ?? "ubuntu");
      setExtra(cfg.port ?? "22");
    } else if (c.type === "git") {
      setHost(cfg.url ?? "");
      setUser(cfg.username ?? "");
      setExtra("");
      const hostName = cfg.gitHost || cfg.host;
      setGitHost(hostName === "gitlab" || hostName === "azure-devops" ? hostName : "github");
      setGitBot(cfg.botLogin ?? "");
      setGitBranch(cfg.defaultBaseBranch || "main");
      setGitAutoPr(cfg.autoOpenPr === "true");
    } else if (c.type === "jira") {
      setHost(cfg.siteUrl ?? "");
      setJiraDeployment(cfg.deployment === "datacenter" ? "datacenter" : "cloud");
      setJiraProjects(cfg.projectKeys ?? "");
      setJiraEmail(cfg.accountEmail ?? "");
      setJiraUpdate(cfg.updateStatus !== "false");
    } else if (c.type === "model") {
      const provider = cfg.provider || "azure-openai";
      setModelProvider(provider);
      setModelUses(modelUsesOf(cfg.role));
      setModelEndpoint(cfg.endpoint || modelProviderById(provider).endpointHint);
      setModelRegion(cfg.region ?? "");
      setModelDeployment(cfg.deploymentName ?? "");
    } else if (c.type === "registry") {
      setHost(cfg.registry ?? "");
      setUser(cfg.username ?? "");
      setExtra(cfg.repository ?? "app");
    } else if (c.type === "aws") {
      setHost(cfg.key_name ?? cfg.keyName ?? "");
      setUser("");
      setExtra(cfg.region ?? "us-east-1");
    } else if (c.type === "gcp") {
      setHost(cfg.project_id ?? cfg.projectId ?? "");
      setUser("");
      setExtra("");
    } else if (c.type === "azure") {
      setHost(cfg.subscriptionId ?? "");
      setUser("");
      setExtra(cfg.tenantId ?? "");
    } else if (c.type === "kubernetes") {
      setHost(cfg.kubeconfigPath ?? "");
      setUser("");
      setExtra("");
    } else {
      setHost(cfg.endpoint ?? cfg.serviceUrl ?? "");
      setUser("");
      setExtra("");
    }
  }

  function buildDraft(): CreateConnectionInput {
    const config: Record<string, string> = {};
    const secrets: Record<string, string> = {};
    if (type === "ssh") {
      config.host = host;
      config.port = extra || "22";
      config.user = user;
      if (secret) {
        const looksLikeKey = /BEGIN[-\s].*PRIVATE KEY/i.test(secret);
        if (looksLikeKey) secrets.privateKey = secret;
        else secrets.password = secret;
      }
    } else if (type === "git") {
      if (host) config.url = host;
      config.gitHost = gitHost;
      config.botLogin = gitBot;
      config.defaultBaseBranch = gitBranch || "main";
      config.autoOpenPr = gitAutoPr ? "true" : "false";
      if (secret) secrets.token = secret;
      if (user) secrets.username = user;
    } else if (type === "jira") {
      config.deployment = jiraDeployment;
      config.siteUrl = host;
      config.projectKeys = jiraProjects;
      config.accountEmail = jiraEmail;
      config.updateStatus = jiraUpdate ? "true" : "false";
      if (secret) secrets.token = secret;
      if (jiraWebhook.trim()) secrets.webhookSecret = jiraWebhook.trim();
    } else if (type === "model") {
      config.provider = modelProvider;
      config.role = modelUsesToRole(modelUses);
      config.endpoint = modelEndpoint;
      config.region = modelRegion;
      config.deploymentName = modelDeployment;
      if (secret) secrets.apiKey = secret;
    } else if (type === "registry") {
      config.registry = host;
      config.repository = extra || "app";
      if (user) config.username = user;
      if (secret) secrets.password = secret;
    } else if (type === "aws") {
      config.region = extra || "us-east-1";
      config.key_name = host;
      config.sshUser = "ubuntu";
      if (secret) secrets.secretAccessKey = secret;
      if (user) secrets.accessKeyId = user;
      if (deployKey.trim()) secrets.sshPrivateKey = deployKey.trim();
    } else if (type === "gcp") {
      config.project_id = host;
      config.sshUser = "shipdeck";
      if (secret) secrets.credentialsJson = secret;
      if (deployKey.trim()) secrets.sshPrivateKey = deployKey.trim();
    } else if (type === "azure") {
      config.subscriptionId = host;
      config.tenantId = extra;
      config.sshUser = "shipdeck";
      if (user) secrets.clientId = user;
      if (secret) secrets.clientSecret = secret;
      if (deployKey.trim()) secrets.sshPrivateKey = deployKey.trim();
    } else if (type === "kubernetes") {
      if (host) config.kubeconfigPath = host;
      if (secret) secrets.kubeconfig = secret;
    } else {
      config.endpoint = host;
      if (secret) secrets.token = secret;
      if (type === "notify" && host) config.endpoint = host;
    }
    return { name: name || "draft", type, config, secrets };
  }

  function toggleModelUse(id: ModelJob) {
    const next = modelUses.includes(id) ? modelUses.filter((item) => item !== id) : [...modelUses, id];
    const ordered = MODEL_JOBS.filter((item) => next.includes(item));
    setModelUses(ordered);
    const allowed = providersForJobs(ordered);
    if (allowed.length && !allowed.some((item) => item.id === modelProvider)) {
      const fallback = allowed[0];
      const previous = modelProviderById(modelProvider);
      setModelProvider(fallback.id);
      if (!modelEndpoint.trim() || modelEndpoint === previous.endpointHint) {
        setModelEndpoint(fallback.endpointHint);
      }
    }
  }

  async function save() {
    try {
      setTestResult(null);
      if (type === "model" && modelUses.length === 0) {
        onError("Tick at least one job for this model.");
        return;
      }
      const draft = buildDraft();
      const saved = editingId
        ? await api.updateConnection(editingId, draft)
        : await api.createConnection(draft);
      const autoKey = saved.type === "gcp" && saved.config?.deployKeySource === "auto-generated";
      resetForm();
      await onChange();
      if (autoKey) {
        setTestResult({
          ok: true,
          summary:
            "Connection saved. Shipdeck auto-generated the Deploy SSH key pair for GCP " +
            "(private key stored encrypted, reused for future runs) — no manual PEM step needed.",
        });
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  async function testDraft() {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await api.testConnectionDraft(buildDraft());
      setTestResult({
        ok: r.ok,
        summary: r.summary || r.message,
        technical: r.technical,
        hint: r.hint,
      });
    } catch (e) {
      setTestResult({
        ok: false,
        summary: "Could not run the connection test.",
        technical: e instanceof Error ? e.message : String(e),
        hint: "Check that the API is running, then try again.",
      });
    } finally {
      setTesting(false);
    }
  }

  const hostLabel =
    type === "ssh"
      ? "Host"
      : type === "git"
        ? "Repo URL"
        : type === "registry"
          ? "Registry host"
          : type === "aws"
            ? "Key pair name"
            : type === "gcp"
              ? "Project ID"
              : type === "azure"
                ? "Subscription ID"
                : type === "kubernetes"
                  ? "Kubeconfig path (optional)"
                  : "Endpoint";

  return (
    <div className="conn-workspace">
      <div className="conn-folders" role="tablist" aria-label="Connection folders">
        <button
          type="button"
          role="tab"
          aria-selected={folder === "build"}
          className={folder === "build" ? "on" : ""}
          onClick={() => selectFolder("build")}
        >
          For tickets
          <span>{connections.filter((c) => connectionFolder(c.type) === "build").length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={folder === "deploy"}
          className={folder === "deploy" ? "on" : ""}
          onClick={() => selectFolder("deploy")}
        >
          For shipping
          <span>{connections.filter((c) => connectionFolder(c.type) === "deploy").length}</span>
        </button>
      </div>
      <p className="conn-folder-lead">
        {folder === "build"
          ? "Jira, Git, and the AI model. Tickets use these to read the request and write the code. Add the secret here, then pick the login on the ticket."
          : "Server, cloud, and registry logins used when you ship. The Ship page picks from this list."}
      </p>
    <div className="layout-2">
      <div className="panel">
        <div className="panel-head">
          <div className="panel-icon">
            <IconPlug size={18} />
          </div>
          <h2>{folder === "build" ? "Logins for tickets" : "Logins for shipping"}</h2>
        </div>
        {pendingDeploy && (
          <p className="delivery-notice" role="status">
            {pendingDeploy.message?.trim() ||
              `${pendingDeploy.ticketKey ?? "This ticket"} is ready to deploy. ${
                pendingDeploy.createdConnections?.length
                  ? pendingDeploy.createdConnections
                      .map((conn) =>
                        conn.created
                          ? `I created ${conn.type === "git" ? "Git" : conn.type === "ssh" ? "SSH" : conn.type.toUpperCase()} connection “${conn.name}” so you can use it.`
                          : `I reused ${conn.type === "git" ? "Git" : conn.type === "ssh" ? "SSH" : conn.type.toUpperCase()} connection “${conn.name}”.`
                      )
                      .join(" ")
                  : "The Git connection was added from the ticket repo. Pick the cloud or VM here."
              } Then open Ship, attach those logins, and choose Ship now.`}
            {onGoPipeline ? (
              <>
                {" "}
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    sessionStorage.removeItem(PENDING_DEPLOY_KEY);
                    setPendingDeploy(null);
                    onGoPipeline();
                  }}
                >
                  Open ship steps
                </button>
              </>
            ) : null}
          </p>
        )}
        <div className="legend-row" style={{ marginBottom: 14 }}>
          {folderTypes.map((t) => (
            <span key={t} className="legend-item">
              <ConnectionBadge type={t} size={18} />
              {CONN_LABELS[t]}
            </span>
          ))}
        </div>
        {!folderConnections.length ? (
          <div className="empty-state conn-empty-hero">
            <div className="empty-state-icon">
              <IconCloud size={28} />
            </div>
            <h3>{folder === "build" ? "Add a Build connection" : "Add a Deploy connection"}</h3>
            <p>
              {folder === "build"
                ? "Save Jira, Git, or a model vendor here. The Build tab will only let you pick from these."
                : "Save SSH, AWS, Azure, or GCP here. Existing apps and Release pick from these — they do not ask for keys again."}
            </p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                const next = folder === "build" ? "jira" : "aws";
                setType(next);
                setName(folder === "build" ? "Jira" : "Prod AWS");
                sessionStorage.setItem(CONNECTIONS_TYPE_KEY, next);
              }}
            >
              {folder === "build" ? "Add Jira connection" : "Add cloud connection"}
            </button>
          </div>
        ) : (
          <div className="conn-card-grid">
            {folderConnections.map((c) => (
              <article
                key={c.id}
                className={`conn-card conn-type-${c.type}${
                  editingId === c.id ||
                  pendingDeploy?.createdConnections?.some((created) => created.id === c.id || created.name === c.name) ||
                  (pendingDeploy?.ticketKey && c.name === `${pendingDeploy.ticketKey} GitHub`)
                    ? " selected"
                    : ""
                }`}
              >
                <div className="conn-card-top">
                  <ConnectionBadge type={c.type} size={32} />
                  <div className="conn-card-titles">
                    <strong>{c.name}</strong>
                    <span>{CONN_LABELS[c.type]}</span>
                  </div>
                </div>
                <p className="conn-card-summary">{connectionSummary(c)}</p>
                <div className="conn-card-actions">
                  <button type="button" className="btn btn-ghost" onClick={() => startEdit(c)}>
                    Edit
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={async () => {
                      try {
                        const r = await api.testConnection(c.id);
                        const lines = [
                          r.ok ? "SUCCESS" : "FAILED",
                          r.summary || r.message,
                          r.hint ? `What to do: ${r.hint}` : "",
                          r.technical ? `Technical: ${r.technical}` : "",
                        ].filter(Boolean);
                        alert(lines.join("\n\n"));
                      } catch (e) {
                        onError(e instanceof Error ? e.message : String(e));
                      }
                    }}
                  >
                    Test
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={async () => {
                      if (editingId === c.id) resetForm();
                      await api.deleteConnection(c.id);
                      await onChange();
                    }}
                  >
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
      <div className="panel">
        <div className="panel-head">
          <div className="panel-icon">
            <ConnectionBadge type={type} size={28} />
          </div>
          <h2>{editingId ? "Edit connection" : "Add connection"}</h2>
        </div>
        {editingId && (
          <p className="muted" style={{ marginTop: 0 }}>
            Secrets left blank stay unchanged. Paste new IAM keys / Deploy PEM only to replace them.
          </p>
        )}
        <div className="field">
          <label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={folder === "build" ? "Jira production" : "Prod SSH"} />
        </div>
        <div className="field">
          <label>Type</label>
          <div className="conn-type-grid">
            {folderTypes.map((t) => (
              <button
                key={t}
                type="button"
                className={`conn-type-btn ${type === t ? "active" : ""}`}
                disabled={Boolean(editingId)}
                onClick={() => {
                  setType(t);
                  sessionStorage.setItem(CONNECTIONS_TYPE_KEY, t);
                  setTestResult(null);
                  if (t === "model" && !modelEndpoint) {
                    setModelEndpoint(modelProviderById(modelProvider).endpointHint);
                  }
                }}
              >
                <ConnectionBadge type={t} size={28} />
                {CONN_LABELS[t]}
              </button>
            ))}
          </div>
        </div>
        {type === "jira" && (
          <>
            <div className="field">
              <label>Jira</label>
              <select value={jiraDeployment} onChange={(e) => setJiraDeployment(e.target.value as "cloud" | "datacenter")}>
                <option value="cloud">Cloud</option>
                <option value="datacenter">Data Center</option>
              </select>
            </div>
            <div className="field">
              <label>Jira site URL</label>
              <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="https://your-team.atlassian.net" />
            </div>
            <div className="field">
              <label>Project keys</label>
              <input value={jiraProjects} onChange={(e) => setJiraProjects(e.target.value)} placeholder="SCRUM, SHIP" />
            </div>
            <div className="field">
              <label>Account email</label>
              <input value={jiraEmail} onChange={(e) => setJiraEmail(e.target.value)} placeholder="you@company.com" />
            </div>
            <div className="field">
              <label>Jira API token {editingId ? "(leave blank to keep saved)" : ""}</label>
              <input type="password" value={secret} autoComplete="off" onChange={(e) => setSecret(e.target.value)} />
            </div>
            <div className="field">
              <label>Webhook secret {editingId ? "(optional — leave blank to keep)" : "(optional)"}</label>
              <input type="password" value={jiraWebhook} autoComplete="off" onChange={(e) => setJiraWebhook(e.target.value)} />
            </div>
            <label className="field delivery-check">
              <input type="checkbox" checked={jiraUpdate} onChange={(e) => setJiraUpdate(e.target.checked)} />
              <span>Record status back on the ticket</span>
            </label>
          </>
        )}
        {type === "model" && (
          <>
            <div className="field">
              <label>Use for</label>
              <details className="use-for">
                <summary>{modelUses.length ? modelUseLabel(modelUsesToRole(modelUses)) : "Choose a job"}</summary>
                <div className="use-for-menu">
                  {MODEL_JOB_OPTIONS.map((item) => (
                    <label key={item.id}>
                      <input
                        type="checkbox"
                        checked={modelUses.includes(item.id)}
                        onChange={() => toggleModelUse(item.id)}
                      />
                      <span>
                        <strong>{item.label}</strong>
                        <em>{item.hint}</em>
                      </span>
                    </label>
                  ))}
                </div>
              </details>
              <p className="muted">
                {modelUses.includes("image") && modelUses.some((item) => item !== "image")
                  ? "Pictures need their own address. Untick Image here, then add a second model and tick only Image."
                  : "Tick every job this model should do. Untick Image when pictures use a different model."}
              </p>
            </div>
            <div className="field">
              <label>Vendor</label>
              <select
                value={modelProvider}
                onChange={(e) => {
                  const provider = e.target.value;
                  const next = modelProviderById(provider);
                  const prev = modelProviderById(modelProvider);
                  setModelProvider(provider);
                  if (!modelEndpoint.trim() || modelEndpoint === prev.endpointHint) {
                    setModelEndpoint(next.endpointHint);
                  }
                }}
              >
                {PROVIDER_GROUPS.map((group) => {
                  const items = providersForJobs(modelUses).filter((item) => item.group === group);
                  if (!items.length) return null;
                  return (
                    <optgroup key={group} label={group}>
                      {items.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.label}
                        </option>
                      ))}
                    </optgroup>
                  );
                })}
              </select>
            </div>
            <div className="field">
              <label>{modelUses.length === 1 && modelUses[0] === "image" ? "Picture endpoint" : "Chat endpoint"}</label>
              <input value={modelEndpoint} onChange={(e) => setModelEndpoint(e.target.value)} />
            </div>
            <div className="field">
              <label>Region</label>
              <input value={modelRegion} onChange={(e) => setModelRegion(e.target.value)} />
            </div>
            <div className="field">
              <label>Deployment / model name</label>
              <input value={modelDeployment} onChange={(e) => setModelDeployment(e.target.value)} />
            </div>
            <div className="field">
              <label>API key {editingId ? "(leave blank to keep saved)" : ""}</label>
              <input type="password" value={secret} autoComplete="off" onChange={(e) => setSecret(e.target.value)} />
            </div>
          </>
        )}
        {type === "git" && (
          <>
            <div className="field">
              <label>Git host</label>
              <select value={gitHost} onChange={(e) => setGitHost(e.target.value as "github" | "gitlab" | "azure-devops")}>
                <option value="github">GitHub</option>
                <option value="gitlab">GitLab</option>
                <option value="azure-devops">Azure DevOps</option>
              </select>
            </div>
            <div className="field">
              <label>Repo URL (optional if this is only a token)</label>
              <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="https://github.com/org/service" />
            </div>
            <div className="field">
              <label>Bot login</label>
              <input value={gitBot} onChange={(e) => setGitBot(e.target.value)} />
            </div>
            <div className="field">
              <label>Base branch</label>
              <input value={gitBranch} onChange={(e) => setGitBranch(e.target.value)} />
            </div>
            <label className="field delivery-check">
              <input type="checkbox" checked={gitAutoPr} onChange={(e) => setGitAutoPr(e.target.checked)} />
              <span>Open the GitHub pull request in live mode</span>
            </label>
            <div className="field">
              <label>Git token {editingId ? "(leave blank to keep saved)" : ""}</label>
              <input type="password" value={secret} autoComplete="off" onChange={(e) => setSecret(e.target.value)} />
            </div>
          </>
        )}
        {type !== "jira" && type !== "model" && type !== "git" && (
          <>
        <div className="field">
          <label>{hostLabel}</label>
          <input value={host} onChange={(e) => setHost(e.target.value)} />
        </div>
        {(type === "ssh" || type === "registry" || type === "aws" || type === "azure") && (
          <div className="field">
            <label>
              {type === "aws" ? "Access key ID" : type === "azure" ? "Client ID" : "User / username"}
            </label>
            <input value={user} onChange={(e) => setUser(e.target.value)} />
          </div>
        )}
        {(type === "registry" || type === "azure" || type === "aws") && (
          <div className="field">
            <label>
              {type === "registry" ? "Repository" : type === "azure" ? "Tenant ID" : "Region"}
            </label>
            <input value={extra} onChange={(e) => setExtra(e.target.value)} />
          </div>
        )}
        <div className="field">
          <label>
            {type === "ssh"
              ? "Secret — private key OR password"
              : type === "aws"
                ? "IAM Secret Access Key"
                : "Secret (key / token / credentials JSON) — encrypted at rest"}
          </label>
          <textarea
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder={
              editingId
                ? type === "aws"
                  ? "Leave blank to keep existing IAM secret — or paste a new one"
                  : "Leave blank to keep existing secret — or paste a new one"
                : type === "ssh"
                  ? "Paste OpenSSH private key, or type the VM password"
                  : type === "aws"
                    ? "AWS IAM secret access key (not the .pem file)"
                    : undefined
            }
          />
        </div>
          </>
        )}
        {(type === "aws" || type === "azure" || type === "gcp") && (
          <div className="field">
            <label>
              {type === "gcp"
                ? "Deploy PEM (optional — Shipdeck auto-generates for GCP)"
                : "Deploy PEM (SSH private key for new VMs)"}
            </label>
            <textarea
              value={deployKey}
              onChange={(e) => setDeployKey(e.target.value)}
              placeholder={
                type === "gcp"
                  ? editingId
                    ? "Leave blank to keep the existing Deploy PEM (auto-generated keys stay as-is) — or paste your own .pem"
                    : "Leave blank — Shipdeck auto-generates a Deploy key pair on save and stores it encrypted. Or paste your own .pem."
                  : editingId
                    ? "Leave blank to keep existing Deploy PEM — or paste a new .pem"
                    : "Paste the .pem — used after Terraform creates the VM. No existing server needed."
              }
            />
            <p className="muted" style={{ marginTop: 6 }}>
              {type === "aws" ? (
                <>
                  Paste the <code>.pem</code> for SSH after create. Shipdeck imports the public key
                  into the selected AWS region (so the key pair does not need to exist there
                  already), then logs into the new VM with this PEM.
                </>
              ) : type === "azure" ? (
                <>
                  Paste the <code>.pem</code> for SSH after create. Shipdeck derives the public key
                  and sets it as the Azure VM <code>admin_ssh_key</code>, then logs in as{" "}
                  <code>shipdeck</code> with this PEM. No pre-existing VM required.
                </>
              ) : (
                <>
                  Optional for GCP. If you leave this blank, Shipdeck <strong>auto-generates</strong>{" "}
                  the Deploy key pair when you save, stores the private key encrypted, derives the
                  public key, and puts it in GCP instance metadata (<code>ssh-keys</code>), then logs
                  in as <code>shipdeck</code>. No manual <code>ssh-keygen</code> step and no
                  pre-existing VM required. Paste your own <code>.pem</code> only if you prefer to
                  bring your own key.
                </>
              )}
            </p>
          </div>
        )}
        <div className="row-actions" style={{ gap: 8 }}>
          <button className="btn" onClick={testDraft} disabled={testing}>
            {testing ? "Testing…" : "Test connection"}
          </button>
          <button className="btn btn-primary" onClick={save} disabled={!name}>
            {editingId ? "Save changes" : "Save connection"}
          </button>
          {editingId && (
            <button className="btn" onClick={resetForm}>
              Cancel
            </button>
          )}
        </div>
        {testResult && (
          <div
            className={testResult.ok ? "detection" : "error-banner"}
            style={{ marginTop: 12 }}
          >
            <strong>{testResult.ok ? "Success" : "Failed"}</strong>
            <div style={{ marginTop: 6 }}>{testResult.summary}</div>
            {testResult.hint && (
              <div style={{ marginTop: 8 }}>
                <strong>What to do:</strong> {testResult.hint}
              </div>
            )}
            {testResult.technical && (
              <div className="logs" style={{ marginTop: 8 }}>
                Technical detail:{"\n"}
                {testResult.technical}
              </div>
            )}
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
