import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "./api";
import type { DeliveryRun, WorkbenchChatEntry, WorkbenchFileChange } from "@shipdeck/shared";

type Shot = { name: string; mimeType: string; base64: string };

function freshPage(page: string) {
  const join = page.includes("?") ? "&" : "?";
  return `${page}${join}t=${Date.now()}`;
}

function isTestFile(path: string) {
  const rel = path.replaceAll("\\", "/");
  return rel.startsWith("test/") || /\.(test|spec)\.[cm]?[jt]sx?$/i.test(rel);
}

function testsPassed(run: { checks: Array<{ status: string }> } | null) {
  return Boolean(run?.checks.length && run.checks.every((check) => check.status === "passed"));
}

function spacingLine(line: string) {
  const text = line.trim();
  if (!text || text === "}" || text.endsWith("{")) return true;
  return /^(html|body|header|main|footer|h\d|p\.|ul\.|li\.|button|span|\.|#)/.test(text) ||
    /^(margin|padding|flex|width|height|max-|min-|overflow|box-sizing|display|align|justify|font|color|background|border|text-align|position|top|left|right|bottom|gap|cursor|transition|opacity|box-shadow)/i.test(text);
}

function spacingOnly(file: WorkbenchFileChange) {
  const lines = [...file.added, ...file.removed].map((line) => line.trim()).filter(Boolean);
  return lines.length > 0 && lines.every(spacingLine);
}

function limitsHeight(file: WorkbenchFileChange) {
  return file.added.some((line) => /max-height\s*:/i.test(line) && !/max-height\s*:\s*(none|100%)/i.test(line));
}

function plainChat(line: WorkbenchChatEntry) {
  if (line.who !== "shipdeck" || !line.files?.length) return line.text;
  const names = line.files.map((file) => file.path).join(", ");
  if (line.files.every((file) => file.added.length === 0 && file.removed.length === 0)) {
    return `Nothing changed in ${names}. The page will look the same.`;
  }
  if (line.files.every(spacingOnly)) {
    return line.files.some(limitsHeight)
      ? `The page was not fixed. ${names} only changed spacing, and it still limits the height.`
      : `The page was not fixed. ${names} only changed spacing.`;
  }
  return line.text;
}

function FileChange({ file }: { file: WorkbenchFileChange }) {
  const same = file.added.length === 0 && file.removed.length === 0;
  const count = file.added.length + file.removed.length;
  return (
    <div className="workbench-file-change">
      <strong>{file.path}</strong>
      {same ? <p>No lines were added or removed.</p> : null}
      {count ? (
        <details open={count <= 8}>
          <summary>{count} line{count === 1 ? "" : "s"} changed</summary>
          {file.removed.length ? (
            <div>
              <span>Removed</span>
              {file.removed.map((line, index) => (
                <code key={`r-${index}`} className="removed">
                  {line.length ? line : " "}
                </code>
              ))}
            </div>
          ) : null}
          {file.added.length ? (
            <div>
              <span>Added</span>
              {file.added.map((line, index) => (
                <code key={`a-${index}`} className="added">
                  {line.length ? line : " "}
                </code>
              ))}
            </div>
          ) : null}
        </details>
      ) : null}
    </div>
  );
}

export function WorkbenchPage({ runId, role = "code" }: { runId: string; role?: "code" | "test" }) {
  const [run, setRun] = useState<DeliveryRun | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [changeKind, setChangeKind] = useState<"new_app" | "existing_repo">("new_app");
  const [branch, setBranch] = useState("");
  const [selected, setSelected] = useState("");
  const [contents, setContents] = useState("");
  const [baseline, setBaseline] = useState("");
  const [newName, setNewName] = useState("");
  const [message, setMessage] = useState("");
  const [shots, setShots] = useState<Shot[]>([]);
  const [mention, setMention] = useState<string | null>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const [chat, setChat] = useState<WorkbenchChatEntry[]>([]);
  const logRef = useRef<HTMLDivElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [pageTitle, setPageTitle] = useState("");
  const [pane, setPane] = useState<"app" | "code">(role === "test" ? "code" : "app");
  const [filesOpen, setFilesOpen] = useState(true);
  const [notesOpen, setNotesOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [next, folder] = await Promise.all([api.deliveryRun(runId), api.workspaceFiles(runId)]);
    setRun(next);
    setChat(next.workbenchChat ?? []);
    const listed = role === "test" ? folder.files.filter(isTestFile) : folder.files;
    setFiles(listed);
    setBranch(folder.branch);
    setChangeKind(folder.changeKind);
    const first =
      role === "test"
        ? listed[0] ?? ""
        : folder.files.find((file) => file === "public/index.html") ?? folder.files[0] ?? "";
    setSelected((current) => (role === "test" && current && !isTestFile(current) ? first : current || first));
    const preview = await api.previewStatus(runId).catch(() => null);
    if (preview?.running && preview.page) {
      setPreviewUrl(freshPage(preview.page));
      if (preview.title) setPageTitle(preview.title);
      setPane("app");
    }
  }

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [runId, role]);

  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [chat]);

  useEffect(() => {
    if (!selected) return;
    api
      .workspaceFile(runId, selected)
      .then((file) => {
        setContents(file.contents);
        setBaseline(file.contents);
      })
      .catch((err) => setContents(err instanceof Error ? err.message : String(err)));
  }, [runId, selected]);

  async function send(kind: "fix" | "new_ask" | "code_edit") {
    const text = message.trim();
    if (!text && shots.length === 0) return;
    setBusy(true);
    setError(null);
    const note = [text, shots.length ? `${shots.length} screenshot${shots.length === 1 ? "" : "s"}` : ""]
      .filter(Boolean)
      .join("\n");
    setChat((lines) => [...lines, { who: "you", text: note, at: new Date().toISOString() }]);
    setMessage("");
    const images = shots.map(({ mimeType, base64 }) => ({ mimeType, base64 }));
    setShots([]);
    setMention(null);
    try {
      const result = await api.workbench(runId, { kind, message: text, images, role });
      setRun(result.run);
      setChat(result.run.workbenchChat ?? []);
      if (kind === "fix" || kind === "code_edit") {
        if (kind === "code_edit") {
          setPreviewUrl(null);
          setPageTitle("");
        }
        const folder = await api.workspaceFiles(runId);
        setFiles(role === "test" ? folder.files.filter(isTestFile) : folder.files);
        if (selected) {
          const file = await api.workspaceFile(runId, selected);
          setContents(file.contents);
          setBaseline(file.contents);
        }
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      setError(reason);
      setChat((lines) => [...lines, { who: "shipdeck", text: reason, at: new Date().toISOString() }]);
    } finally {
      setBusy(false);
    }
  }

  async function addFile(event: FormEvent) {
    event.preventDefault();
    const path = role === "test" && !isTestFile(newName.trim()) ? `test/${newName.trim()}` : newName.trim();
    if (!path) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api.createWorkspaceFile(runId, path);
      setRun(created.run);
      setNewName("");
      setFiles((current) => [...new Set([...current, created.path])].sort());
      setSelected(created.path);
      setContents(created.contents);
      setBaseline(created.contents);
      setPane("code");
      setPreviewUrl(null);
      setChat(created.run.workbenchChat ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function deleteFile() {
    if (!selected || selected === "architecture.md" || selected === "impact-analysis.md") return;
    if (!window.confirm(`Delete ${selected}?`)) return;
    setBusy(true);
    setError(null);
    try {
      const removed = await api.deleteWorkspaceFile(runId, selected);
      setRun(removed.run);
      const nextFiles = files.filter((file) => file !== removed.path);
      setFiles(nextFiles);
      const next = nextFiles[0] ?? "";
      setSelected(next);
      setPane(next ? "code" : "app");
      setPreviewUrl(null);
      setChat(removed.run.workbenchChat ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveFile() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await api.saveWorkspaceFile(runId, selected, contents);
      setRun(saved.run);
      setContents(saved.contents);
      setBaseline(saved.contents);
      setPreviewUrl(null);
      setChat(saved.run.workbenchChat ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function decidePlan(kind: "approve_plan" | "reject_plan") {
    setBusy(true);
    setError(null);
    try {
      const result = await api.workbench(runId, { kind });
      setRun(result.run);
      setChat(result.run.workbenchChat ?? []);
      if (kind === "approve_plan") {
        setPreviewUrl(null);
        const folder = await api.workspaceFiles(runId);
        setFiles(role === "test" ? folder.files.filter(isTestFile) : folder.files);
        if (selected) {
          const file = await api.workspaceFile(runId, selected);
          setContents(file.contents);
          setBaseline(file.contents);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function readShots(list: FileList | File[]) {
    const incoming = [...list].filter((file) => file.type.startsWith("image/"));
    for (const file of incoming) {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = String(reader.result || "").replace(/^data:[^;]+;base64,/, "");
        if (!base64 || base64.length > 1_500_000) return;
        setShots((current) =>
          current.length >= 4 ? current : [...current, { name: file.name || "screenshot", mimeType: file.type, base64 }]
        );
      };
      reader.readAsDataURL(file);
    }
  }

  function onNoteChange(value: string, caret: number) {
    setMessage(value);
    const before = value.slice(0, caret);
    const at = before.lastIndexOf("@");
    if (at >= 0 && !/\s/.test(before.slice(at + 1))) setMention(before.slice(at + 1));
    else setMention(null);
  }

  function tagFile(path: string) {
    const caret = noteRef.current?.selectionStart ?? message.length;
    const before = message.slice(0, caret);
    const at = before.lastIndexOf("@");
    setMessage(`${message.slice(0, at)}@${path} ${message.slice(caret)}`);
    setMention(null);
    noteRef.current?.focus();
  }

  return (
    <div className="workbench">
      <header className="workbench-bar">
        <div className="workbench-bar-row">
        <div>
          <p className="workspace-kicker">{role === "test" ? "Test bench" : "Workbench"}</p>
          <h1>{run ? `${run.ticket.key} · ${run.ticket.summary}` : "Loading the branch"}</h1>
          <p>
            Branch <code>{branch || "—"}</code>
            {role === "test"
              ? " · test cases only"
              : changeKind === "existing_repo"
                ? " · showing what this ticket changed"
                : " · new application on this branch"}
          </p>
          {run?.implementation?.pullRequestUrl && !run.implementation.pullRequestUrl.startsWith("simulate://") ? (
            <p className="delivery-notice">
              Pull request created.{" "}
              <a href={run.implementation.pullRequestUrl} target="_blank" rel="noreferrer">
                {run.implementation.pullRequestUrl}
              </a>
            </p>
          ) : null}
        </div>
        <div className="row-actions">
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setError(null);
              setPreviewUrl(null);
              setPageTitle("");
              api
                .startPreview(runId)
                .then((preview) => {
                  setPreviewUrl(freshPage(preview.page));
                  if (preview.title) setPageTitle(preview.title);
                  setPane("app");
                })
                .catch((err) => setError(err instanceof Error ? err.message : String(err)))
                .finally(() => setBusy(false));
            }}
          >
            Start the app
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy || !previewUrl}
            onClick={() => {
              setBusy(true);
              setError(null);
              api
                .stopPreview(runId)
                .then(async () => {
                  setPreviewUrl(null);
                  setPageTitle("");
                  const folder = await api.workspaceFiles(runId);
                  setFiles(role === "test" ? folder.files.filter(isTestFile) : folder.files);
                })
                .catch((err) => setError(err instanceof Error ? err.message : String(err)))
                .finally(() => setBusy(false));
            }}
          >
            Stop
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setError(null);
              api
                .stopStuckPreview(runId)
                .then(async () => {
                  setPreviewUrl(null);
                  setPageTitle("");
                  const folder = await api.workspaceFiles(runId);
                  setFiles(role === "test" ? folder.files.filter(isTestFile) : folder.files);
                })
                .catch((err) => setError(err instanceof Error ? err.message : String(err)))
                .finally(() => setBusy(false));
            }}
          >
            Stop stuck app
          </button>
          {role === "code" ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !run || Boolean(run.pendingRevision)}
              onClick={() => {
                const opened = window.open(
                  `/?view=workbench&run=${encodeURIComponent(runId)}&role=test`,
                  `shipdeck-testbench-${runId}`,
                  "noopener,width=1280,height=860"
                );
                opened?.focus();
              }}
            >
              Proceed for testing
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || Boolean(run?.pendingRevision) || !(run?.status === "code_review" || (run?.status === "failed" && run.failureCode === "tests"))}
              onClick={() => {
                setBusy(true);
                setError(null);
                api
                  .runDeliveryTests(runId)
                  .then((result) => {
                    setRun(result.run);
                    setChat((lines) => [...lines, { who: "shipdeck", text: result.reply, at: new Date().toISOString() }]);
                  })
                  .catch((err) => setError(err instanceof Error ? err.message : String(err)))
                  .finally(() => setBusy(false));
              }}
            >
              {run?.status === "failed" ? "Run the tests again" : "Run the tests"}
            </button>
          )}
          {role === "test" && testsPassed(run) && !run?.implementation?.pullRequestUrl ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || run?.status !== "code_review" || Boolean(run?.pendingRevision)}
              onClick={() => {
                setBusy(true);
                api
                  .decideDelivery(runId, { gate: "code_review", action: "approve" })
                  .then(async (next) => {
                    setRun(next);
                    setChat((lines) => [
                      ...lines,
                      { who: "shipdeck", text: next.implementation?.pullRequestDetail || "Pull request raised.", at: new Date().toISOString() },
                    ]);
                  })
                  .catch((err) => setError(err instanceof Error ? err.message : String(err)))
                  .finally(() => setBusy(false));
              }}
            >
              Looks right — raise the pull request
            </button>
          ) : null}
        </div>
        </div>
        {error ? <p className="delivery-notice">{error}</p> : null}
      </header>
      <div className={`workbench-body${filesOpen ? "" : " files-closed"}${notesOpen ? "" : " notes-closed"}`}>
        <aside className="workbench-files">
          <p className="workbench-rail-label">{role === "test" ? "Test cases" : "Files"}</p>
          <div className="workbench-file-list">
            {files.map((file) => (
              <button
                key={file}
                type="button"
                className={pane === "code" && file === selected ? "active" : ""}
                onClick={() => {
                  setSelected(file);
                  setPane("code");
                }}
              >
                {file}
              </button>
            ))}
          </div>
          <form className="workbench-new-file" onSubmit={(event) => void addFile(event)}>
            <input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder={role === "test" ? "test/extra.test.js" : "src/helper.js"}
              aria-label="New file name"
            />
            <button type="submit" className="btn" disabled={busy || !newName.trim()}>
              Add
            </button>
          </form>
        </aside>
        <section className="workbench-stage">
          <button
            type="button"
            className="workbench-edge workbench-edge-left"
            aria-expanded={filesOpen}
            aria-label={filesOpen ? "Hide files" : "Show files"}
            onClick={() => setFilesOpen((open) => !open)}
          >
            {filesOpen ? "‹" : "›"}
          </button>
          <button
            type="button"
            className="workbench-edge workbench-edge-right"
            aria-expanded={notesOpen}
            aria-label={notesOpen ? "Hide notes" : "Show notes"}
            onClick={() => setNotesOpen((open) => !open)}
          >
            {notesOpen ? "›" : "‹"}
          </button>
          <div className="workbench-stage-bar">
            <button type="button" className={pane === "app" ? "active" : ""} onClick={() => setPane("app")}>
              Live app
            </button>
            <button type="button" className={pane === "code" ? "active" : ""} onClick={() => setPane("code")}>
              Code
            </button>
            <span className={pane === "code" ? "workbench-file-name" : "workbench-stage-note"}>
              {pane === "app" ? "The page users will see" : selected || "Pick a file"}
            </span>
            {previewUrl ? <span className="workbench-live">Live</span> : null}
          </div>
          {pane === "app" ? (
            <div className="workbench-preview">
              {previewUrl ? (
                <>
                  <p className="workbench-page-title">
                    <span>Page title</span>
                    {pageTitle || "Loading the saved page"}
                  </p>
                  <iframe
                    key={previewUrl}
                    title="Live app"
                    src={previewUrl}
                    onLoad={(event) => {
                      try {
                        const title = event.currentTarget.contentDocument?.title?.trim() ?? "";
                        if (title) setPageTitle(title);
                      } catch {
                        // The app is on its own address, so this page cannot read the frame. The title came back with Start.
                      }
                    }}
                  />
                </>
              ) : (
                <p className="workbench-empty">Start the app. The page your users will see shows here, full size.</p>
              )}
            </div>
          ) : (
            <div className="workbench-editor">
              <textarea
                className="workbench-code-edit"
                value={contents}
                spellCheck={false}
                onChange={(event) => setContents(event.target.value)}
              />
              <div className="row-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy || !selected || contents === baseline}
                  onClick={() => void saveFile()}
                >
                  Save
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={busy || !selected || selected === "architecture.md" || selected === "impact-analysis.md"}
                  onClick={() => void deleteFile()}
                >
                  Delete
                </button>
              </div>
            </div>
          )}
        </section>
        <section className="workbench-chat">
            <p className="workspace-kicker">On this ticket</p>
            <div className="workbench-chat-log" ref={logRef}>
              {chat.length === 0 ? (
                <p className="workbench-chat-empty">
                  {role === "test"
                    ? "Say what should change in the test cases, or record a new ask."
                    : "Say what should change on this ticket, or record a new ask."}
                </p>
              ) : (
                chat.map((line, index) => (
                  <div key={`${line.at}-${index}`} className="workbench-chat-line" data-who={line.who}>
                    <p>{plainChat(line)}</p>
                    {line.files?.map((file) => (
                      <FileChange key={file.path} file={file} />
                    ))}
                  </div>
                ))
              )}
            </div>
            {run?.pendingRevision ? (
              <div className="workbench-plan">
                <p>Revised plan</p>
                <strong>{run.pendingRevision.note}</strong>
                <pre>{run.pendingRevision.architecture.markdown}</pre>
                <div className="row-actions">
                  <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void decidePlan("approve_plan")}>
                    Approve the plan
                  </button>
                  <button type="button" className="btn" disabled={busy} onClick={() => void decidePlan("reject_plan")}>
                    Reject
                  </button>
                </div>
              </div>
            ) : null}
            <div className="workbench-compose">
              {mention !== null && files.some((file) => file.toLowerCase().includes(mention.toLowerCase())) ? (
                <div className="workbench-mention" role="listbox" aria-label="Files">
                  {files
                    .filter((file) => (role === "test" ? isTestFile(file) : true))
                    .filter((file) => file.toLowerCase().includes(mention.toLowerCase()))
                    .slice(0, 8)
                    .map((file) => (
                      <button key={file} type="button" onClick={() => tagFile(file)}>
                        {file}
                      </button>
                    ))}
                </div>
              ) : null}
              {shots.length ? (
                <div className="workbench-shots">
                  {shots.map((shot, index) => (
                    <button
                      key={`${shot.name}-${index}`}
                      type="button"
                      onClick={() => setShots((current) => current.filter((_, item) => item !== index))}
                      aria-label={`Remove ${shot.name}`}
                    >
                      <img src={`data:${shot.mimeType};base64,${shot.base64}`} alt="" />
                    </button>
                  ))}
                </div>
              ) : null}
              <textarea
                ref={noteRef}
                value={message}
                onChange={(event) => onNoteChange(event.target.value, event.target.selectionStart)}
                onPaste={(event) => {
                  if ([...event.clipboardData.files].some((file) => file.type.startsWith("image/"))) {
                    event.preventDefault();
                    readShots(event.clipboardData.files);
                  }
                }}
                placeholder={
                  role === "test"
                    ? "Say what to change. Type @ to tag a test file."
                    : "Say what to change. Type @ to tag a file."
                }
              />
              <label className="workbench-attach">
                Add a screenshot
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  multiple
                  onChange={(event) => {
                    if (event.target.files) readShots(event.target.files);
                    event.target.value = "";
                  }}
                />
              </label>
            </div>
            <div className="row-actions workbench-ask">
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || (!message.trim() && shots.length === 0) || Boolean(run?.pendingRevision)}
                onClick={() => void send("code_edit")}
              >
                {role === "test" ? "Change these tests" : "Change this ticket"}
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy || (!message.trim() && shots.length === 0)}
                onClick={() => void send("new_ask")}
              >
                This is a new ask
              </button>
            </div>
        </section>
      </div>
    </div>
  );
}
