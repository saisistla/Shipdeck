import { useEffect, useMemo, useRef, useState } from "react";
import type { PipelineBoxType, PipelineRun } from "@shipdeck/shared";
import { api } from "./api";
import { STAGE_THEME, StageIcon } from "./icons";

/** Terraform / Docker emit ANSI colour codes — strip them for a clean terminal view. */
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\[[0-9;]*[A-Za-z]|\[[0-9;]*m/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "").replace(/\r/g, "");
}

export function defaultLogStep(run: PipelineRun): PipelineBoxType {
  const failed = run.steps.find((s) => s.status === "failed");
  if (failed) return failed.box;
  const active = run.steps.find(
    (s) => s.status === "running" || s.status === "waiting_approval"
  );
  if (active) return active.box;
  const withLogs = [...run.steps].reverse().find((s) => s.logs.length > 0);
  return withLogs?.box ?? run.steps[0]?.box ?? "source";
}

function allLogsText(run: PipelineRun): string {
  return run.steps
    .map((s) => `===== ${s.name} (${s.box}) — ${s.status} =====\n${stripAnsi(s.logs.join("\n"))}`)
    .join("\n\n");
}

type ViewerProps = {
  run: PipelineRun;
  initialStep?: PipelineBoxType;
  variant?: "modal" | "page";
  onClose?: () => void;
};

export function LogViewer({ run, initialStep, variant = "modal", onClose }: ViewerProps) {
  const [selectedBox, setSelectedBox] = useState<PipelineBoxType>(
    initialStep ?? defaultLogStep(run)
  );
  const [query, setQuery] = useState("");
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [wrap, setWrap] = useState(false);
  const [follow, setFollow] = useState(true);
  const [copied, setCopied] = useState(false);
  const manualRef = useRef(false);
  const preRef = useRef<HTMLPreElement>(null);

  const step = run.steps.find((s) => s.box === selectedBox) ?? run.steps[0];

  // Follow the active step until the operator picks one manually.
  useEffect(() => {
    if (manualRef.current) return;
    const active = run.steps.find(
      (s) => s.status === "running" || s.status === "waiting_approval" || s.status === "failed"
    );
    if (active && active.box !== selectedBox) setSelectedBox(active.box);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);

  useEffect(() => {
    if (initialStep) {
      manualRef.current = true;
      setSelectedBox(initialStep);
    }
  }, [initialStep]);

  // Esc closes the modal; lock page scroll behind it.
  useEffect(() => {
    if (variant !== "modal") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [variant, onClose]);

  const rawLines = useMemo(
    () => (step ? stripAnsi(step.logs.join("\n")).split("\n") : []),
    [step]
  );

  const visibleLines = useMemo(() => {
    let lines = rawLines;
    if (errorsOnly) lines = lines.filter((l) => /error|fail|denied|timeout|exception/i.test(l));
    const q = query.trim().toLowerCase();
    if (q) lines = lines.filter((l) => l.toLowerCase().includes(q));
    return lines;
  }, [rawLines, query, errorsOnly]);

  useEffect(() => {
    if (!follow) return;
    const el = preRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [visibleLines, follow]);

  if (!step) return null;

  const isLive =
    run.status === "running" || run.status === "queued" || run.status === "waiting_approval";

  function openInNewWindow() {
    const url = `${window.location.pathname}?view=logs&run=${encodeURIComponent(run.id)}&step=${encodeURIComponent(selectedBox)}`;
    window.open(url, "_blank", "width=1280,height=860,menubar=no,toolbar=no");
  }

  async function copyLogs() {
    try {
      await navigator.clipboard.writeText(visibleLines.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

  function downloadLogs() {
    const blob = new Blob([allLogsText(run)], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `shipdeck-run-${run.id}.log`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const body = (
    <div
      className={`log-viewer ${variant === "page" ? "log-viewer-page" : ""}`}
      role="dialog"
      aria-modal={variant === "modal"}
      aria-label={`Logs for run ${run.id}`}
    >
      <div className="log-viewer-head">
        <div className="log-viewer-title">
          <span className="log-viewer-kicker">Run logs</span>
          <strong>#{run.id}</strong>
          <span className="pill" data-status={run.status}>
            {run.status}
          </span>
          {isLive && <span className="log-live-dot" title="Live — updating automatically" />}
          <span className="muted log-viewer-meta">
            {[run.environment?.provider, run.environment?.region, run.environment?.publicIp]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>
        <div className="log-viewer-actions">
          {variant === "modal" && (
            <button type="button" className="btn" onClick={openInNewWindow}>
              Open in new window ↗
            </button>
          )}
          <button type="button" className="btn" onClick={copyLogs}>
            {copied ? "Copied ✓" : "Copy"}
          </button>
          <button type="button" className="btn" onClick={downloadLogs}>
            Download .log
          </button>
          {variant === "modal" && (
            <button type="button" className="btn" onClick={onClose} aria-label="Close logs">
              ✕ Close
            </button>
          )}
        </div>
      </div>

      <div className="log-viewer-body">
        <nav className="log-steps" aria-label="Pipeline steps">
          {run.steps.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`log-step-item ${s.box === selectedBox ? "active" : ""}`}
              onClick={() => {
                manualRef.current = true;
                setSelectedBox(s.box);
              }}
            >
              <span className="run-step-icon">
                <StageIcon box={s.box} size={14} />
              </span>
              <span className="log-step-name">
                {STAGE_THEME[s.box]?.label ?? s.name}
                <small>{s.logs.length} lines</small>
              </span>
              <span className={`status-dot ${s.status}`} />
            </button>
          ))}
          <div className="log-steps-foot muted">
            {isLive ? "Updating live…" : `Created ${new Date(run.createdAt).toLocaleString()}`}
          </div>
        </nav>

        <div className="log-main">
          <div className="log-toolbar">
            <input
              className="log-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search in ${step.name} logs…`}
              aria-label="Search logs"
            />
            <label className="log-toggle">
              <input
                type="checkbox"
                checked={errorsOnly}
                onChange={(e) => setErrorsOnly(e.target.checked)}
              />
              Errors only
            </label>
            <label className="log-toggle">
              <input type="checkbox" checked={wrap} onChange={(e) => setWrap(e.target.checked)} />
              Wrap
            </label>
            <label className="log-toggle">
              <input
                type="checkbox"
                checked={follow}
                onChange={(e) => setFollow(e.target.checked)}
              />
              Follow tail
            </label>
            <span className="muted log-count">
              {visibleLines.length} / {rawLines.length} lines
              {step.error ? ` · ${step.error}` : ""}
            </span>
          </div>
          <pre
            ref={preRef}
            className={`log-terminal ${wrap ? "wrap" : ""}`}
            onScroll={(e) => {
              const el = e.currentTarget;
              const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
              if (!atBottom && follow) setFollow(false);
            }}
          >
            {visibleLines.length ? visibleLines.join("\n") : "(no logs match)"}
          </pre>
        </div>
      </div>
    </div>
  );

  if (variant === "page") return body;

  return (
    <div className="log-viewer-overlay" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ display: "contents" }}>
        {body}
      </div>
    </div>
  );
}

/** Standalone log window — opened via ?view=logs&run=<id>. Polls on its own. */
export function StandaloneLogPage({
  runId,
  initialStep,
}: {
  runId: string;
  initialStep?: PipelineBoxType;
}) {
  const [run, setRun] = useState<PipelineRun | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const fetchRun = () =>
      api
        .getRun(runId)
        .then((r) => {
          if (alive) setRun(r);
        })
        .catch((e) => {
          if (alive) setError(e instanceof Error ? e.message : String(e));
        });
    void fetchRun();
    const t = setInterval(fetchRun, 1000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [runId]);

  if (error) {
    return (
      <div className="log-standalone-state">
        <h2>Could not load run logs</h2>
        <p className="muted">{error}</p>
      </div>
    );
  }
  if (!run) {
    return (
      <div className="log-standalone-state">
        <h2>Loading logs…</h2>
        <p className="muted">Run #{runId}</p>
      </div>
    );
  }
  return <LogViewer run={run} initialStep={initialStep} variant="page" />;
}
