import { useEffect, useRef, useState } from "react";
import { salesReady, type Connection, type IdeaBrief, type IndustryOffering, type MarketResearch } from "@shipdeck/shared";
import { api } from "./api";

const STEPS = ["Application", "Describe", "Business report", "Market", "Technical pack"] as const;

function focusIndex(brief: IdeaBrief | null): number {
  if (!brief) return 0;
  if (brief.status === "sent" || brief.research) return 4;
  if (brief.report) return 3;
  return 1;
}

function nextLine(brief: IdeaBrief): string {
  if (brief.status === "sent") return "The story is on Jira. Open the ticket when you want to build it.";
  if (brief.research) return "Read the market draft, then create the Jira story.";
  if (brief.report) return "The report is ready. Prepare the market draft next.";
  return "Say who it is for and what they should finish. Then write the report.";
}

function sectionState(brief: IdeaBrief, index: number): "done" | "current" | "later" {
  const current = focusIndex(brief);
  if (index < current) return "done";
  if (index === current) return "current";
  return "later";
}

function statusLabel(status: IdeaBrief["status"]): string {
  if (status === "collecting") return "Describing";
  if (status === "report") return "Report ready";
  if (status === "research") return "Market draft";
  return "With tickets";
}

export function IdeaStudio({
  projectId,
  mode,
  onOpenTicket,
  onOpenSales,
}: {
  projectId?: string;
  mode: "simulate" | "live";
  onOpenTicket: (runId: string) => void;
  onOpenSales: (briefId: string) => void;
}) {
  const [industries, setIndustries] = useState<IndustryOffering[]>([]);
  const [briefs, setBriefs] = useState<IdeaBrief[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [industryId, setIndustryId] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jiraError, setJiraError] = useState<string | null>(null);
  const [jiraConnections, setJiraConnections] = useState<Connection[]>([]);
  const [jiraConnectionId, setJiraConnectionId] = useState("");
  const [editingBrief, setEditingBrief] = useState(false);
  const [briefDraft, setBriefDraft] = useState("");

  const pickerRef = useRef<HTMLElement>(null);
  const [ideasOpen, setIdeasOpen] = useState(false);
  const selected = briefs.find((item) => item.id === selectedId) ?? null;
  const jiraStoryKey = selected?.ticketKey && !selected.ticketKey.startsWith("IDEA-") ? selected.ticketKey : "";
  const ticketOpened = Boolean(selected?.deliveryRunId);

  async function refresh(preferId?: string) {
    const [catalog, list] = await Promise.all([api.briefCatalog(), api.briefs(projectId)]);
    setIndustries(catalog.industries);
    setBriefs(list);
    setIndustryId((current) => current || catalog.industries[0]?.id || "");
    setSelectedId((current) => preferId || current || list[0]?.id || null);
  }

  useEffect(() => {
    refresh().catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [projectId]);

  useEffect(() => {
    setJiraError(null);
    setEditingBrief(false);
    setBriefDraft("");
  }, [selectedId]);

  useEffect(() => {
    if (!ideasOpen) return;
    function close(event: PointerEvent) {
      if (!pickerRef.current?.contains(event.target as Node)) setIdeasOpen(false);
    }
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [ideasOpen]);

  useEffect(() => {
    Promise.all([api.connections(), api.deliveryPolicy()])
      .then(([list, policy]) => {
        const jira = list.filter((item) => item.type === "jira");
        setJiraConnections(jira);
        setJiraConnectionId((current) => current || policy.jiraConnectionId || jira[0]?.id || "");
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    if (selected?.jiraConnectionId) setJiraConnectionId(selected.jiraConnectionId);
  }, [selected?.id, selected?.jiraConnectionId]);

  async function run(action: () => Promise<IdeaBrief>) {
    setBusy(true);
    setError(null);
    try {
      const next = await action();
      setBriefs((current) => [next, ...current.filter((item) => item.id !== next.id)]);
      setSelectedId(next.id);
      return next;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setBusy(false);
    }
  }

  const chosenJira = jiraConnections.find((item) => item.id === jiraConnectionId) ?? null;
  const writtenElsewhere = Boolean(
    jiraStoryKey && selected?.jiraConnectionId && jiraConnectionId && jiraConnectionId !== selected.jiraConnectionId
  );
  const storyChanged = Boolean(
    selected?.technicalEdited &&
      (selected.technicalMarkdown || "").trim() &&
      (selected.technicalMarkdown || "").trim() !== (selected.jiraStoryMarkdown || "").trim()
  );
  const needsStory = !ticketOpened || writtenElsewhere || storyChanged;

  function rememberBrief(next: IdeaBrief) {
    setBriefs((current) => [next, ...current.filter((item) => item.id !== next.id)]);
    setSelectedId(next.id);
  }

  async function saveBrief(id: string, markdown: string) {
    const text = markdown.trim();
    if (text.length < 20) throw new Error("Write a bit more before saving the brief");
    const next = await api.briefTechnical(id, text);
    rememberBrief(next);
    setEditingBrief(false);
    setBriefDraft(text);
    return next;
  }

  function createJiraStory() {
    if (!selected || !jiraConnectionId) return;
    const id = selected.id;
    const draft = editingBrief ? briefDraft : selected.technicalMarkdown || "";
    const dirty = editingBrief && draft.trim() !== (selected.technicalMarkdown || "").trim();
    setSending(true);
    setBusy(true);
    setError(null);
    setJiraError(null);
    void (async () => {
      if (dirty) await saveBrief(id, draft);
      return api.briefSend(id, mode, jiraConnectionId);
    })()
      .then((next) => rememberBrief(next))
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        setJiraError(message);
      })
      .finally(() => {
        setBusy(false);
        setSending(false);
      });
  }

  async function onUpload(file: File) {
    if (!selected) return;
    const textLike = /\.(txt|md|csv|json)$/i.test(file.name) || file.type.startsWith("text/");
    const body = textLike
      ? { filename: file.name, text: await file.text() }
      : { filename: file.name, base64: bufferToBase64(await file.arrayBuffer()) };
    await run(() => api.briefUpload(selected.id, body));
  }

  return (
    <div className="idea-page">
      <section className="idea-start" aria-label="Start an idea">
        <div className="idea-start-copy">
          <p className="delivery-kicker">New</p>
          <h3>Start an idea</h3>
          <p className="muted">Pick the industry. Add a name if you already have one.</p>
        </div>
        <div className="field">
          <label htmlFor="idea-industry">Industry</label>
          <select id="idea-industry" value={industryId} onChange={(event) => setIndustryId(event.target.value)}>
            {industries.map((industry) => (
              <option key={industry.id} value={industry.id}>
                {industry.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="idea-name">Application name</label>
          <input
            id="idea-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Optional"
          />
        </div>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !industryId}
          onClick={() =>
            void run(() => api.createBrief({ projectId, industryId, name, mode })).then(() => setName(""))
          }
        >
          Start this idea
        </button>
      </section>
      <section
        className="idea-picker"
        aria-label="Your ideas"
        ref={pickerRef}
        onKeyDown={(event) => {
          if (event.key === "Escape") setIdeasOpen(false);
        }}
      >
        <p className="delivery-kicker">Your ideas{briefs.length ? ` · ${briefs.length}` : ""}</p>
        {briefs.length === 0 ? (
          <p className="muted">None yet. Start one above.</p>
        ) : (
          <>
            <button
              type="button"
              className="idea-picker-current"
              aria-expanded={ideasOpen}
              aria-haspopup="listbox"
              onClick={() => setIdeasOpen((open) => !open)}
            >
              <strong>{selected?.applicationName || selected?.industry || "Choose an idea"}</strong>
              {selected ? <span>{selected.industry}</span> : null}
              {selected ? <em>{statusLabel(selected.status)}</em> : null}
            </button>
            {ideasOpen ? (
              <ul className="idea-picker-menu" role="listbox">
                {briefs.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={item.id === selectedId}
                      className={item.id === selectedId ? "active" : ""}
                      onClick={() => {
                        setSelectedId(item.id);
                        setIdeasOpen(false);
                      }}
                    >
                      <strong>{item.applicationName || item.industry}</strong>
                      <span>{item.industry}</span>
                      <em>{statusLabel(item.status)}</em>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </section>

      <div className="idea-main">
        {error ? <p className="home-project-error">{error}</p> : null}
        {!selected ? (
          <section className="delivery-card">
            <p className="delivery-kicker">Step 1</p>
            <h3>Start with the business, not a ticket</h3>
            <p className="muted">
              Choose an industry, then describe any application in that industry. Tickets begin only after you send it on.
            </p>
          </section>
        ) : (
          <>
            <ol className="idea-steps" aria-label="Idea steps">
              {STEPS.map((label, index) => {
                const focus = focusIndex(selected);
                return (
                  <li key={label} className={index === focus ? "active" : index < focus ? "done" : ""}>
                    <span>{index + 1}</span>
                    {label}
                  </li>
                );
              })}
            </ol>
            <div className="idea-now">
              <div>
                <p className="delivery-kicker">{selected.industry}</p>
                <h3>{selected.applicationName || "Name it in the chat"}</h3>
              </div>
              <p>{nextLine(selected)}</p>
            </div>

            <section className="delivery-card idea-section" data-state={sectionState(selected, 1)}>
              <div className="delivery-card-head">
                <div>
                  <p className="delivery-kicker">Describe</p>
                  <h3>Describe the application</h3>
                </div>
                <label className="btn">
                  Upload report
                  <input
                    type="file"
                    accept=".txt,.md,.pdf,.docx,.pptx,.rtf"
                    hidden
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (file) void onUpload(file);
                    }}
                  />
                </label>
              </div>
              {selected.upload ? <p className="muted">Using {selected.upload.filename}</p> : null}
              <div className="idea-chat" aria-live="polite">
                {selected.messages.map((item, index) => (
                  <p key={`${item.at}-${index}`} className={item.role === "user" ? "is-owner" : "is-ship"}>
                    <span>{item.role === "user" ? "You" : "Shipdeck"}</span>
                    {item.content}
                  </p>
                ))}
              </div>
              <form
                className="idea-compose"
                onSubmit={(event) => {
                  event.preventDefault();
                  const next = message.trim();
                  if (!next) return;
                  setMessage("");
                  void run(() => api.briefChat(selected.id, next, mode));
                }}
              >
                <textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder="Who is it for, and what should they finish on day one?"
                  rows={3}
                />
                <button type="submit" className="btn btn-primary" disabled={busy || !message.trim()}>
                  Send
                </button>
              </form>
            </section>

            <section className="delivery-card idea-section" data-state={sectionState(selected, 2)}>
              <div className="delivery-card-head">
                <div>
                  <p className="delivery-kicker">Business report</p>
                  <h3>{selected.report?.title ?? "Not written yet"}</h3>
                </div>
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => void run(() => api.briefReport(selected.id, mode))}
                >
                  {selected.report ? "Rewrite the report" : "Write the report"}
                </button>
              </div>
              {selected.report ? (
                <div className="idea-report">
                  <p>{selected.report.problem}</p>
                  <p><strong>Who it is for.</strong> {selected.report.customer}</p>
                  <p><strong>Offer.</strong> {selected.report.offer}</p>
                  <div className="idea-split">
                    <div>
                      <h4>Version one</h4>
                      <ul>{selected.report.inScope.map((item) => <li key={item}>{item}</li>)}</ul>
                    </div>
                    <div>
                      <h4>Not this time</h4>
                      <ul>{selected.report.outOfScope.map((item) => <li key={item}>{item}</li>)}</ul>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="muted">This is written from the chat and any file you uploaded.</p>
              )}
            </section>

            {selected.research ? (
              <div className="idea-section" data-state={sectionState(selected, 3)}>
                <MarketPicture research={selected.research} />
              </div>
            ) : null}

            <section className="delivery-card idea-section" data-state={sectionState(selected, 3)}>
              <div className="delivery-card-head">
                <div>
                  <p className="delivery-kicker">Market</p>
                  <h3>Market draft</h3>
                </div>
                <button
                  type="button"
                  className={focusIndex(selected) === 3 ? "btn btn-primary" : "btn"}
                  disabled={busy || !selected.report}
                  onClick={() => void run(() => api.briefResearch(selected.id, mode))}
                >
                  {selected.research ? "Refresh the draft" : "Prepare the market draft"}
                </button>
              </div>
              <p className="draft-banner">This is a first-pass read, not a commissioned study. Check it before you show it as fact.</p>
            </section>

            <section className="delivery-card idea-section" data-state={sectionState(selected, 4)}>
              <div className="delivery-card-head">
                <div>
                  <p className="delivery-kicker">Technical pack</p>
                  <h3>{selected.status === "sent" ? selected.ticketKey : "Create the Jira story"}</h3>
                </div>
                <div className="row-actions">
                  {needsStory ? (
                    <button
                      type="button"
                      className={selected.research ? "btn btn-primary" : "btn"}
                      disabled={busy || sending || !selected.research || !jiraConnectionId}
                      onClick={createJiraStory}
                    >
                      {sending
                        ? "Creating the Jira story…"
                        : writtenElsewhere
                          ? "Write the story to this Jira"
                          : "Create the Jira story"}
                    </button>
                  ) : null}
                  {selected.deliveryRunId && !writtenElsewhere ? (
                    <button
                      type="button"
                      className={needsStory ? "btn" : "btn btn-primary"}
                      onClick={() => onOpenTicket(selected.deliveryRunId!)}
                    >
                      Open the ticket
                    </button>
                  ) : null}
                  {salesReady(selected) ? (
                    <button type="button" className="btn" onClick={() => onOpenSales(selected.id)}>
                      Open Sales
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="field">
                <label htmlFor="idea-jira">Jira connection</label>
                <select
                  id="idea-jira"
                  value={jiraConnectionId}
                  onChange={(event) => setJiraConnectionId(event.target.value)}
                >
                  {jiraConnections.length === 0 ? <option value="">No Jira connection yet</option> : null}
                  {jiraConnections.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} · {item.config.siteUrl || "No site URL"}
                    </option>
                  ))}
                </select>
              </div>
              <p className="muted">
                Choose the Jira connection, edit the brief if you need to, then create the story. Sales opens from this report after the story exists. Slides are built after the plan is approved.
              </p>
              {jiraStoryKey && ticketOpened && !writtenElsewhere ? (
                <p className="jira-status" data-state="created">
                  <strong>Created</strong> on {chosenJira?.name || "Jira"} ({selected.jiraSiteUrl || chosenJira?.config.siteUrl}). Project {selected.jiraProjectName || selected.jiraProjectKey}. Story {jiraStoryKey}.
                </p>
              ) : writtenElsewhere ? (
                <p className="jira-status" data-state="missing">
                  <strong>Not on this Jira.</strong> Story {jiraStoryKey} is on {selected.jiraSiteUrl || "the other connection"}. Choose Write the story to this Jira to create it on {chosenJira?.config.siteUrl || "the selected site"}.
                  {jiraError ? ` ${jiraError}` : ""}
                </p>
              ) : jiraStoryKey ? (
                <p className="jira-status" data-state="missing">
                  <strong>{sending ? "Opening the ticket." : "Jira story created. Ticket not opened yet."}</strong> Project {selected?.jiraProjectName || selected?.jiraProjectKey}, story {jiraStoryKey}.
                  {jiraError ? ` ${jiraError}` : ""}
                </p>
              ) : sending ? (
                <p className="jira-status" data-state="missing">
                  <strong>Not created yet.</strong> Jira is being asked to create the project and the user story.
                </p>
              ) : jiraError ? (
                <p className="jira-status" data-state="failed">
                  <strong>Not created.</strong> {jiraError}
                </p>
              ) : (
                <p className="jira-status" data-state="missing">
                  <strong>Not created.</strong> No Jira project or user story exists for this idea yet.
                </p>
              )}
              {editingBrief ? (
                <textarea
                  className="delivery-arch technical-editor"
                  value={briefDraft}
                  onChange={(event) => setBriefDraft(event.target.value)}
                  aria-label="Technical brief"
                />
              ) : selected.technicalMarkdown ? (
                <pre className="delivery-arch">{selected.technicalMarkdown}</pre>
              ) : (
                <p className="muted">The technical brief appears after the market draft. You can edit it before the Jira story is created.</p>
              )}
              <div className="row-actions">
                {editingBrief ? (
                  <>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busy || !briefDraft.trim()}
                      onClick={() =>
                        void saveBrief(selected.id, briefDraft).catch((err) => {
                          const message = err instanceof Error ? err.message : String(err);
                          setError(message);
                          setJiraError(message);
                        })
                      }
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className="btn"
                      disabled={busy}
                      onClick={() => {
                        setEditingBrief(false);
                        setBriefDraft(selected.technicalMarkdown || "");
                      }}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() => {
                      setBriefDraft(selected.technicalMarkdown || "");
                      setEditingBrief(true);
                    }}
                  >
                    Edit
                  </button>
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

const RESEARCH_PARAMETERS = [
  "Market definition",
  "Customer segments",
  "Market size",
  "Demand and barriers",
  "Competitors",
  "Position",
  "SWOT",
  "PESTLE",
  "Five forces",
  "Price and package",
  "Go to market",
  "What to validate",
];

function MarketPicture({ research }: { research: MarketResearch }) {
  if (!research.definition || !research.size || !research.forces) {
    return (
      <section className="delivery-card">
        <p className="delivery-kicker">Market</p>
        <h3>This read is the short version</h3>
        <p className="muted">Refresh the draft to cover the full research set.</p>
      </section>
    );
  }
  const max = Math.max(...research.demand.map((item) => item.score), 1);
  return (
    <section className="delivery-card market-memo">
      <p className="delivery-kicker">Market research</p>
      <h3>What a researcher would put in the file</h3>
      <p>{research.summary}</p>
      <ol className="research-parameters">
        {RESEARCH_PARAMETERS.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ol>
      <p className="draft-banner">{research.caveat}</p>

      <h4>1. Market definition</h4>
      <dl className="research-definition">
        <div><dt>Category</dt><dd>{research.definition.category}</dd></div>
        <div><dt>Geography</dt><dd>{research.definition.geography}</dd></div>
        <div><dt>Job to be done</dt><dd>{research.definition.job}</dd></div>
        <div><dt>In the market</dt><dd>{research.definition.inMarket}</dd></div>
        <div><dt>Out of the market</dt><dd>{research.definition.outOfMarket}</dd></div>
      </dl>

      <h4>2. Customer segments</h4>
      <div className="segment-grid">
        {research.segments.map((item) => (
          <article key={item.name}>
            <h5>{item.name}</h5>
            <p><strong>Who.</strong> {item.who}</p>
            <p><strong>Job.</strong> {item.job}</p>
            <p><strong>Pain.</strong> {item.pain}</p>
            <p><strong>Uses today.</strong> {item.alternative}</p>
            <p><strong>Will they pay.</strong> {item.willingness}</p>
          </article>
        ))}
      </div>

      <h4>3. Market size</h4>
      <p className="muted">Three bands, each with a method. A single revenue number is not shown, because it has not been counted.</p>
      <div className="size-grid">
        {research.size.map((item) => (
          <article key={item.name} data-confidence={item.confidence}>
            <header>
              <strong>{item.name}</strong>
              <em>{item.confidence} confidence</em>
            </header>
            <p>{item.definition}</p>
            <p><strong>Method.</strong> {item.method}</p>
            <p><strong>Range.</strong> {item.range}</p>
          </article>
        ))}
      </div>

      <h4>4. Demand and barriers</h4>
      <div className="idea-split">
        <div>
          <h5>Why someone would move</h5>
          <ul>{research.drivers.map((item) => <li key={item}>{item}</li>)}</ul>
        </div>
        <div>
          <h5>Why they would stay</h5>
          <ul>{research.barriers.map((item) => <li key={item}>{item}</li>)}</ul>
        </div>
      </div>
      <div className="demand-chart">
        {research.demand.map((item) => (
          <div key={item.label}>
            <span>{item.label}</span>
            <div><i style={{ width: `${Math.round((item.score / max) * 100)}%` }} /></div>
            <strong>{item.score}</strong>
          </div>
        ))}
      </div>

      <h4>5. Competitors</h4>
      <table className="idea-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Kind</th>
            <th>What they sell</th>
            <th>Where they win</th>
            <th>Gap</th>
            <th>Price</th>
          </tr>
        </thead>
        <tbody>
          {research.competitors.map((item) => (
            <tr key={item.name}>
              <td>{item.name}</td>
              <td>{kindLabel(item.kind)}</td>
              <td>{item.offer}</td>
              <td>{item.wins}</td>
              <td>{item.gap}</td>
              <td>{item.price}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h4>6. Position</h4>
      <p className="muted">{research.position.xAxis} → · {research.position.yAxis} ↑</p>
      <div className="position-map" aria-hidden="true">
        {research.position.points.map((point) => (
          <span key={point.name} style={{ left: `${point.x}%`, bottom: `${point.y}%` }}>{point.name}</span>
        ))}
      </div>

      <h4>7. SWOT</h4>
      <div className="swot-grid">
        {(
          [
            ["Strengths", research.swot.strengths],
            ["Weaknesses", research.swot.weaknesses],
            ["Opportunities", research.swot.opportunities],
            ["Threats", research.swot.threats],
          ] as const
        ).map(([label, items]) => (
          <article key={label}>
            <h5>{label}</h5>
            <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>
          </article>
        ))}
      </div>

      <h4>8. PESTLE</h4>
      <div className="pestle-grid">
        {research.pestle.map((item) => (
          <article key={item.name}>
            <h5>{item.name}</h5>
            <p>{item.note}</p>
          </article>
        ))}
      </div>

      <h4>9. Five forces</h4>
      <ul className="force-list">
        {research.forces.map((item) => (
          <li key={item.name}>
            <span>{item.name}</span>
            <div><i style={{ width: `${item.score * 20}%` }} /></div>
            <strong>{item.score}/5</strong>
            <em>{item.note}</em>
          </li>
        ))}
      </ul>

      <h4>10. Price and package</h4>
      <p>{research.pricing}</p>
      <ul>{research.packages.map((item) => <li key={item}>{item}</li>)}</ul>

      <h4>11. Go to market</h4>
      <dl className="research-definition">
        <div><dt>Buyer</dt><dd>{research.goToMarket.buyer}</dd></div>
        <div><dt>User</dt><dd>{research.goToMarket.user}</dd></div>
        <div><dt>Channel</dt><dd>{research.goToMarket.channel}</dd></div>
        <div><dt>Cycle</dt><dd>{research.goToMarket.cycle}</dd></div>
      </dl>

      <h4>12. Risks</h4>
      <ul className="idea-risks">
        {research.risks.map((item) => (
          <li key={item.name} data-level={item.level}>
            <strong>{item.name}</strong>
            <em>{item.level}</em>
            <span>{item.note}</span>
          </li>
        ))}
      </ul>

      <h4>What still has to be asked</h4>
      <ol className="validate-list">
        {research.validate.map((item) => <li key={item}>{item}</li>)}
      </ol>
    </section>
  );
}

function kindLabel(kind: MarketResearch["competitors"][number]["kind"]): string {
  if (kind === "direct") return "Direct";
  if (kind === "indirect") return "Suite";
  if (kind === "substitute") return "Substitute";
  return "Today";
}

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
