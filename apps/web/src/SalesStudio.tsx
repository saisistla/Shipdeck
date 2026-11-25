import { useEffect, useState } from "react";
import type { SalesQueueItem, SalesStatus, SalesView } from "@shipdeck/shared";
import { api } from "./api";
import { IdeaPicker } from "./IdeaPicker";

function ReachValue({ value, href }: { value: string; href?: string }) {
  if (!value) return <span className="sales-missing">Not published on their site</span>;
  if (href) {
    return (
      <a href={href} target="_blank" rel="noreferrer">
        {value}
      </a>
    );
  }
  return <span>{value}</span>;
}

export function SalesStudio({
  projectId,
  mode,
  briefId,
  onOpenMarketing,
}: {
  projectId?: string;
  mode: "simulate" | "live";
  briefId?: string | null;
  onOpenMarketing?: (briefId: string) => void;
}) {
  const [items, setItems] = useState<SalesQueueItem[]>([]);
  const [modelName, setModelName] = useState("Plan model");
  const [selectedId, setSelectedId] = useState<string | null>(briefId || null);
  const [view, setView] = useState<SalesView | null>(null);
  const [country, setCountry] = useState("");
  const [place, setPlace] = useState("");
  const [organisation, setOrganisation] = useState("");
  const [buyer, setBuyer] = useState("");
  const [note, setNote] = useState("");
  const [filter, setFilter] = useState<"ready" | "all" | "needs" | "skip">("ready");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadQueue(preferId?: string | null) {
    const queue = await api.salesQueue(projectId);
    setItems(queue.items);
    setModelName(queue.modelName);
    const wanted = preferId || selectedId;
    const next = queue.items.find((item) => item.briefId === wanted)?.briefId || queue.items.find((item) => item.ready)?.briefId || queue.items[0]?.briefId || null;
    setSelectedId(next);
    return next;
  }

  useEffect(() => {
    setError(null);
    loadQueue(briefId)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [projectId, briefId]);

  useEffect(() => {
    if (!selectedId) {
      setView(null);
      return;
    }
    let cancelled = false;
    api
      .salesView(selectedId)
      .then((next) => {
        if (!cancelled) setView(next);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  useEffect(() => {
    if (!view) return;
    setCountry(view.search?.country || "");
    setPlace(view.search?.place || "");
    setOrganisation(view.search?.organisation || view.customer || "");
    setBuyer(view.search?.buyer || "");
    setNote(view.search?.note || "");
  }, [view]);

  async function findCompanies() {
    if (!selectedId || country.trim().length < 2) return;
    setBusy(true);
    setError(null);
    try {
      const next = await api.salesFind(selectedId, mode, {
        country: country.trim(),
        place: place.trim(),
        organisation: organisation.trim(),
        buyer: buyer.trim(),
        note: note.trim(),
      });
      setView(next);
      setItems((current) =>
        current.map((item) =>
          item.briefId === next.briefId ? { ...item, accountCount: next.accounts.length, updatedAt: next.updatedAt } : item
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const readyCount = items.filter((item) => item.ready).length;

  return (
    <div className="delivery">
      {error ? <p className="jira-status" data-state="failed">{error}</p> : null}
      <section className="delivery-command studio-command">
        <div className="delivery-command-head">
          <div>
            <h3>Ready ideas</h3>
          </div>
          <p className="delivery-loaded">
            {view
              ? `${view.accounts.length} companies${view.jiraKey ? ` · ${view.jiraKey}` : ""}`
              : items.length
                ? `${readyCount} ready for a company list.`
                : "An idea appears here after its business report and Jira story exist."}
          </p>
        </div>
        <IdeaPicker
          embedded
          label="Ready ideas"
          empty="No ideas in this project yet. Start under Idea."
          selectedId={selectedId}
          onSelect={setSelectedId}
          items={items.map((item) => ({
            id: item.briefId,
            title: item.title,
            detail: item.industry,
            status: item.ready ? (item.accountCount ? `${item.accountCount} companies` : item.jiraKey || "Ready") : item.blocked,
          }))}
        />
        {!view ? (
          <p className="muted">Write the business report, create the Jira story, then come back. The list starts from that report.</p>
        ) : (
          <>
            <div className="sales-summary">
              <p><strong>Customer.</strong> {view.customer || "Not in the report yet."}</p>
              <p><strong>Industry.</strong> {view.industry}</p>
              <p>{view.problem}</p>
              <p>{view.offer}</p>
            </div>
            <p className="delivery-kicker">Where to look</p>
            <p className="muted">
              Name the country. A city and the kind of organisation narrow the list.
              {view.accounts.length > 0 && !view.search?.country
                ? " The list below is in the United Kingdom because no country was set."
                : ""}
            </p>
            <div className="delivery-command-grid">
                <div className="field">
                  <label htmlFor="sales-country">Country</label>
                  <input
                    id="sales-country"
                    value={country}
                    placeholder="India, Kenya, United States…"
                    onChange={(event) => setCountry(event.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="sales-place">City or region</label>
                  <input
                    id="sales-place"
                    value={place}
                    placeholder="Optional"
                    onChange={(event) => setPlace(event.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="sales-who">Who to look for</label>
                  <input
                    id="sales-who"
                    value={organisation}
                    onChange={(event) => setOrganisation(event.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="sales-buyer">Person to reach</label>
                  <input
                    id="sales-buyer"
                    value={buyer}
                    placeholder=""
                    onChange={(event) => setBuyer(event.target.value)}
                  />
                </div>
                <div className="field field-span">
                  <label htmlFor="sales-note">Anything else</label>
                  <input
                    id="sales-note"
                    value={note}
                    placeholder="Public schools, hotel groups…"
                    onChange={(event) => setNote(event.target.value)}
                  />
                </div>
              </div>
              <p className="muted">
                Who to look for and the person to reach are filled from the business report. Change them if you want a different search. Then the list finds that person and a public email, phone, or LinkedIn. One search lists up to 25.
              </p>
              {view.blocked ? <p className="jira-status" data-state="missing">{view.blocked}</p> : null}
              {mode !== "live" ? (
                <p className="draft-banner">Practice shows this summary only. Choose Real cloud to read public websites with {modelName}.</p>
              ) : (
                <p className="muted">Looked up with {modelName}. No extra data service. {view.note}</p>
              )}
              <div className="delivery-command-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy || !view.ready || mode !== "live" || country.trim().length < 2}
                  onClick={() => void findCompanies()}
                >
                  {busy ? "Searching…" : "Search"}
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={busy || view.accounts.length === 0}
                  onClick={() => {
                    void api.downloadSales(view.briefId).catch((err) => {
                      setError(err instanceof Error ? err.message : String(err));
                    });
                  }}
                >
                  Download spreadsheet
                </button>
                {onOpenMarketing ? (
                  <button
                    type="button"
                    className="btn"
                    disabled={!view.ready || view.accounts.length === 0}
                    onClick={() => onOpenMarketing(view.briefId)}
                  >
                    Open marketing
                  </button>
                ) : null}
              </div>
          </>
        )}
      </section>
      {view && view.accounts.length > 0 ? (
              <section className="delivery-card sales-work">
                <div className="sales-filters" role="group" aria-label="Work the book">
                  {(
                    [
                      ["ready", `Ready to contact ${view.accounts.filter((item) => item.fit !== "skip" && (item.email || item.phone || item.linkedin)).length}`],
                      ["needs", `Needs a person ${view.accounts.filter((item) => !item.person && item.fit !== "skip").length}`],
                      ["all", `All ${view.accounts.length}`],
                      ["skip", `Not a fit ${view.accounts.filter((item) => item.fit === "skip" || item.status === "not a fit").length}`],
                    ] as const
                  ).map(([id, label]) => (
                    <button key={id} type="button" className="btn" data-on={filter === id} onClick={() => setFilter(id)}>
                      {label}
                    </button>
                  ))}
                </div>
                <table className="sales-table">
                  <thead>
                    <tr>
                      <th>Account</th>
                      <th>Person</th>
                      <th>Reach</th>
                      <th>Why this account</th>
                      <th>Stage</th>
                      <th>Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.accounts
                      .filter((account) => {
                        if (filter === "ready") return account.fit !== "skip" && Boolean(account.email || account.phone || account.linkedin);
                        if (filter === "needs") return !account.person && account.fit !== "skip";
                        if (filter === "skip") return account.fit === "skip" || account.status === "not a fit";
                        return true;
                      })
                      .map((account) => (
                        <tr key={`${account.company}-${account.website}`}>
                          <td>
                            <strong>{account.company}</strong>
                            <div>
                              <ReachValue value={account.website.replace(/^https:\/\//, "")} href={account.website} />
                            </div>
                            <span className="sales-fit" data-fit={account.fit || "maybe"}>
                              {account.fit === "strong" ? "Strong fit" : account.fit === "skip" ? "Wrong kind" : "Possible"}
                            </span>
                          </td>
                          <td>
                            {account.person ? (
                              <>
                                <div>{account.person}</div>
                                <div className="sales-missing">{account.role}</div>
                              </>
                            ) : (
                              <span className="sales-missing">Not named on their site</span>
                            )}
                          </td>
                          <td className="sales-reach-cell">
                            <div><ReachValue value={account.email} href={account.email ? `mailto:${account.email}` : undefined} /></div>
                            <div><ReachValue value={account.phone} href={account.phone ? `tel:${account.phone.replace(/\s/g, "")}` : undefined} /></div>
                            <div><ReachValue value={account.linkedin ? "LinkedIn" : ""} href={account.linkedin || undefined} /></div>
                          </td>
                          <td>
                            <div>{account.whyTheyFit}</div>
                            {account.whatTheyDo ? <div className="sales-opener">{account.whatTheyDo}</div> : null}
                            {account.opener ? <div className="sales-opener">{account.opener}</div> : null}
                          </td>
                          <td>
                            <select
                              aria-label={`Stage for ${account.company}`}
                              value={account.status || "new"}
                              onChange={(event) => {
                                const status = event.target.value as SalesStatus;
                                void api
                                  .salesStatus(view.briefId, account.website, status, account.repNote)
                                  .then(setView)
                                  .catch((err) => setError(err instanceof Error ? err.message : String(err)));
                              }}
                            >
                              <option value="new">New</option>
                              <option value="working">Contacted</option>
                              <option value="replied">Replied</option>
                              <option value="not a fit">Not a fit</option>
                            </select>
                          </td>
                          <td>
                            <textarea
                              aria-label={`Note for ${account.company}`}
                              defaultValue={account.repNote || ""}
                              placeholder="What you will do next"
                              onBlur={(event) => {
                                const repNote = event.target.value;
                                if (repNote === (account.repNote || "")) return;
                                void api
                                  .salesStatus(view.briefId, account.website, account.status || "new", repNote)
                                  .then(setView)
                                  .catch((err) => setError(err instanceof Error ? err.message : String(err)));
                              }}
                            />
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </section>
      ) : view && view.ready ? (
        <section className="delivery-card">
          <h3>No organisations yet</h3>
          <p className="muted">Set the country and the person you want to reach, then search. The table fills from their public websites.</p>
        </section>
      ) : null}
    </div>
  );
}
