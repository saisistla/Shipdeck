import { useEffect, useRef, useState, type RefObject } from "react";
import type { MarketingPiece, MarketingView, SalesQueueItem } from "@shipdeck/shared";
import { api } from "./api";
import { IdeaPicker } from "./IdeaPicker";

const TOOLS = [
  { id: "chat", label: "Chat" },
  { id: "content", label: "Content" },
  { id: "image", label: "Picture" },
  { id: "video", label: "Video" },
  { id: "seo", label: "SEO" },
  { id: "leads", label: "Leads" },
] as const;

type Tool = (typeof TOOLS)[number]["id"];

const PLATFORMS = ["Instagram", "LinkedIn", "Blog", "Email"];
const CONTENT_LABELS = ["Caption", "Ad copy", "Email", "Blog outline"];
const SEO_LABELS = ["Search phrases", "Page title", "Page outline", "What to publish"];

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function readSections(text: string, labels: string[]): { title: string; body: string }[] | null {
  const names = labels.join("|");
  const parts = text.split(new RegExp(`^(?=(?:${names})\\b)`, "gim")).map((part) => part.trim()).filter(Boolean);
  const sections = parts.flatMap((part) => {
    const match = part.match(new RegExp(`^(${names})\\s*:?\\s*([\\s\\S]*)$`, "i"));
    if (!match?.[2]?.trim()) return [];
    const title = labels.find((label) => label.toLowerCase() === match[1].toLowerCase()) || match[1];
    return [{ title, body: match[2].trim() }];
  });
  return sections.length >= 2 ? sections : null;
}

export function MarketingStudio({
  projectId,
  mode,
  briefId,
}: {
  projectId?: string;
  mode: "simulate" | "live";
  briefId?: string | null;
}) {
  const [items, setItems] = useState<SalesQueueItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(briefId || null);
  const [view, setView] = useState<MarketingView | null>(null);
  const [tool, setTool] = useState<Tool>("content");
  const [topic, setTopic] = useState("");
  const [platform, setPlatform] = useState("LinkedIn");
  const [audience, setAudience] = useState("");
  const [prompt, setPrompt] = useState("");
  const [message, setMessage] = useState("");
  const [chatName, setChatName] = useState("");
  const [chatEmail, setChatEmail] = useState("");
  const [chatPhone, setChatPhone] = useState("");
  const [leadName, setLeadName] = useState("");
  const [leadEmail, setLeadEmail] = useState("");
  const [leadPhone, setLeadPhone] = useState("");
  const [interest, setInterest] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (briefId) setSelectedId(briefId);
  }, [briefId]);

  useEffect(() => {
    let cancelled = false;
    api
      .salesQueue(projectId)
      .then((result) => {
        if (cancelled) return;
        setItems(result.items);
        setSelectedId((current) => current || briefId || result.items.find((item) => item.accountCount > 0)?.briefId || result.items[0]?.briefId || null);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, briefId]);

  useEffect(() => {
    if (!selectedId) {
      setView(null);
      return;
    }
    let cancelled = false;
    api
      .marketingView(selectedId)
      .then((next) => {
        if (cancelled) return;
        setView(next);
        setTopic(next.topic);
        setAudience(next.audience);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  async function run(work: () => Promise<MarketingView>) {
    setBusy(true);
    setError(null);
    try {
      setView(await work());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const latest = view?.pieces.find((piece) => piece.kind === tool);

  const showWork =
    view &&
    (tool === "leads" ||
      (tool === "chat" && view.pieces.some((piece) => piece.kind === "chat")) ||
      (tool !== "chat" && latest));

  return (
    <div className="delivery">
      {error ? <p className="jira-status" data-state="missing">{error}</p> : null}
      <section className="delivery-command studio-command">
        <div className="delivery-command-head">
          <div>
            <h3>Campaign</h3>
          </div>
          <p className="delivery-loaded">
            {view ? `${view.title}${view.modelName ? ` · ${view.modelName}` : ""}` : "Written from the sales list."}
          </p>
        </div>
        <IdeaPicker
          embedded
          label="Ideas"
          empty="No ideas in this project yet. Start under Idea."
          selectedId={selectedId}
          onSelect={setSelectedId}
          items={items.map((item) => ({
            id: item.briefId,
            title: item.title,
            detail: item.industry,
            status: item.accountCount > 0 ? `${item.accountCount} from sales` : item.blocked || "No sales list yet",
          }))}
        />
        {!view ? (
          <p className="muted">Marketing starts after Sales has a list for that idea.</p>
        ) : (
          <>
            <p className="muted">
              The topic and audience start from the business report. The people come from Sales. Change them if this campaign is for someone else.
            </p>
            {view.blocked ? <p className="jira-status" data-state="missing">{view.blocked}</p> : null}
            <div className="studio-track" role="tablist" aria-label="Marketing tools">
              {TOOLS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={tool === item.id}
                  data-on={tool === item.id}
                  onClick={() => {
                    setTool(item.id);
                    setError(null);
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {tool === "chat" ? (
              <>
                <div className="delivery-command-grid">
                  <label className="field field-span">
                    <span>Message</span>
                    <textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={3} />
                  </label>
                  <label className="field">
                    <span>Name</span>
                    <input value={chatName} onChange={(event) => setChatName(event.target.value)} />
                  </label>
                  <label className="field">
                    <span>Email</span>
                    <input value={chatEmail} onChange={(event) => setChatEmail(event.target.value)} />
                  </label>
                  <label className="field">
                    <span>Phone</span>
                    <input value={chatPhone} onChange={(event) => setChatPhone(event.target.value)} />
                  </label>
                </div>
                <p className="muted">Name and email are optional. If both are filled, the person is saved as a lead.</p>
                <div className="delivery-command-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy || !view.ready}
                    onClick={() =>
                      void run(async () => {
                        const next = await api.marketingChat(view.briefId, mode, message, chatName, chatEmail, chatPhone);
                        setMessage("");
                        return next;
                      })
                    }
                  >
                    {busy ? "Sending…" : "Send message"}
                  </button>
                </div>
              </>
            ) : null}

            {tool === "content" || tool === "seo" || tool === "video" ? (
              <>
                <div className="delivery-command-grid">
                  <label className="field">
                    <span>Topic</span>
                    <input value={topic} onChange={(event) => setTopic(event.target.value)} />
                  </label>
                  <label className="field">
                    <span>Platform</span>
                    <select value={platform} onChange={(event) => setPlatform(event.target.value)}>
                      {PLATFORMS.map((item) => (
                        <option key={item}>{item}</option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Audience</span>
                    <input value={audience} onChange={(event) => setAudience(event.target.value)} />
                  </label>
                </div>
                {tool === "video" ? (
                  <p className="muted">Four scenes. Click a scene to jump there. The line is on the picture and read aloud.</p>
                ) : null}
                <div className="delivery-command-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy || !view.ready}
                    onClick={() => {
                      const call =
                        tool === "seo"
                          ? api.marketingSeo(view.briefId, mode, topic, platform, audience)
                          : tool === "video"
                            ? api.marketingVideo(view.briefId, mode, topic, platform, audience)
                            : api.marketingContent(view.briefId, mode, topic, platform, audience);
                      void run(() => call);
                    }}
                  >
                    {busy ? "Working…" : tool === "seo" ? "Generate SEO plan" : tool === "video" ? "Generate video" : "Generate content"}
                  </button>
                </div>
              </>
            ) : null}

            {tool === "image" ? (
              <>
                <div className="delivery-command-grid">
                  <label className="field field-span">
                    <span>Picture prompt</span>
                    <input value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="A school gate at morning drop-off" />
                  </label>
                </div>
                <div className="delivery-command-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy || !view.ready}
                    onClick={() => void run(() => api.marketingImage(view.briefId, mode, prompt))}
                  >
                    {busy ? "Drawing…" : "Generate picture"}
                  </button>
                </div>
              </>
            ) : null}

            {tool === "leads" ? (
              <>
                <div className="delivery-command-grid">
                  <label className="field">
                    <span>Name</span>
                    <input value={leadName} onChange={(event) => setLeadName(event.target.value)} />
                  </label>
                  <label className="field">
                    <span>Email</span>
                    <input value={leadEmail} onChange={(event) => setLeadEmail(event.target.value)} />
                  </label>
                  <label className="field">
                    <span>Phone</span>
                    <input value={leadPhone} onChange={(event) => setLeadPhone(event.target.value)} />
                  </label>
                  <label className="field">
                    <span>Interest</span>
                    <input value={interest} onChange={(event) => setInterest(event.target.value)} />
                  </label>
                </div>
                <div className="delivery-command-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy || !view.ready}
                    onClick={() =>
                      void run(async () => {
                        const next = await api.marketingLead(view.briefId, leadName, leadEmail, leadPhone, interest);
                        setLeadName("");
                        setLeadEmail("");
                        setLeadPhone("");
                        setInterest("");
                        return next;
                      })
                    }
                  >
                    Save lead
                  </button>
                </div>
              </>
            ) : null}
          </>
        )}
      </section>
      {showWork && view ? (
        <section className="delivery-card">
          {tool === "leads" ? <LeadTable leads={view.leads} /> : null}
          {tool !== "leads" && tool !== "chat" && latest ? <PieceView piece={latest} /> : null}
          {tool === "chat" && view.pieces.some((piece) => piece.kind === "chat") ? (
            <ul className="marketing-thread">
              {view.pieces
                .filter((piece) => piece.kind === "chat")
                .slice(0, 12)
                .reverse()
                .map((piece) => (
                  <li key={piece.id}>
                    <strong>You.</strong> {piece.topic}
                    <p><strong>Reply.</strong> {piece.output}</p>
                  </li>
                ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function LeadTable({ leads }: { leads: MarketingView["leads"] }) {
  if (!leads.length) return <p className="muted">No leads yet. Search in Sales, or save one here.</p>;
  return (
    <ul className="marketing-leads">
      {leads.map((lead) => (
        <li key={lead.id}>
          <strong>{lead.name}</strong>
          <span>{lead.source === "sales" ? "From sales" : "Saved here"}</span>
          <p>{lead.email || "No email on their site"} · {lead.phone || "No phone on their site"}</p>
          {lead.interest ? <p>{lead.interest}</p> : null}
        </li>
      ))}
    </ul>
  );
}

function PieceView({ piece }: { piece: MarketingPiece }) {
  const labels = piece.kind === "seo" ? SEO_LABELS : CONTENT_LABELS;
  const sections = piece.scenes.length === 0 && piece.output ? readSections(piece.output, labels) : null;
  const file = piece.kind === "seo" ? "seo-plan.txt" : piece.kind === "video" ? "video-script.txt" : "marketing-content.txt";
  const videoRef = useRef<HTMLVideoElement>(null);
  const [at, setAt] = useState(0);
  const active = piece.scenes.reduce((found, scene) => ((scene.start ?? 0) <= at ? scene.scene : found), piece.scenes[0]?.scene ?? 0);
  return (
    <article className="marketing-piece">
      {piece.videoUrl ? <FilmPlayer url={piece.videoUrl} videoRef={videoRef} onTime={setAt} /> : null}
      {piece.note ? <p className="jira-status" data-state="missing">{piece.note}</p> : null}
      {piece.imageUrl && piece.scenes.length === 0 ? <img src={piece.imageUrl} alt="" /> : null}
      {sections ? (
        <div className="marketing-sections">
          {sections.map((section) => (
            <article key={section.title}>
              <h4>{section.title}</h4>
              <p>{section.body}</p>
            </article>
          ))}
        </div>
      ) : null}
      {piece.output && piece.scenes.length === 0 && !sections ? <pre>{piece.output}</pre> : null}
      {piece.scenes.length ? (
        <ol className="marketing-scenes">
          {piece.scenes.map((scene) => (
            <li key={scene.scene}>
              <button
                type="button"
                className={scene.scene === active && piece.videoUrl ? "is-live" : ""}
                onClick={() => {
                  const player = videoRef.current;
                  if (!player) return;
                  player.currentTime = scene.start ?? 0;
                  void player.play();
                }}
              >
                <p className="delivery-kicker">Scene {scene.scene}</p>
                {scene.imageUrl ? <img src={scene.imageUrl} alt="" /> : null}
                <p><strong>Picture.</strong> {scene.visual}</p>
                <p><strong>Say.</strong> {scene.voice}</p>
              </button>
            </li>
          ))}
        </ol>
      ) : null}
      {piece.videoUrl ? (
        <button type="button" className="btn" onClick={() => downloadFilm(piece.videoUrl)}>
          Download video
        </button>
      ) : null}
      {piece.output ? (
        <button type="button" className="btn" onClick={() => downloadText(file, piece.output)}>
          {piece.kind === "video" ? "Download script" : "Download"}
        </button>
      ) : null}
    </article>
  );
}

function FilmPlayer({
  url,
  videoRef,
  onTime,
}: {
  url: string;
  videoRef: RefObject<HTMLVideoElement | null>;
  onTime: (seconds: number) => void;
}) {
  const [src, setSrc] = useState("");
  const [failed, setFailed] = useState("");
  useEffect(() => {
    let dead = false;
    let object = "";
    api
      .marketingFilm(url)
      .then((blob) => {
        if (dead) return;
        object = URL.createObjectURL(blob);
        setSrc(object);
      })
      .catch((err: Error) => {
        if (!dead) setFailed(err.message);
      });
    return () => {
      dead = true;
      if (object) URL.revokeObjectURL(object);
    };
  }, [url]);
  if (failed) return <p className="jira-status" data-state="missing">{failed}</p>;
  if (!src) return <p className="muted">Preparing the film…</p>;
  return (
    <video
      ref={videoRef}
      className="marketing-film"
      src={src}
      controls
      playsInline
      onTimeUpdate={(event) => onTime(event.currentTarget.currentTime)}
    />
  );
}

async function downloadFilm(url: string) {
  const blob = await api.marketingFilm(url);
  const object = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = object;
  link.download = "marketing-video.mp4";
  link.click();
  URL.revokeObjectURL(object);
}
