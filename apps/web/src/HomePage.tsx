import { useState } from "react";
import { FlowScene } from "./icons";

type Destination = "brief" | "delivery" | "pipeline" | "sales" | "marketing";
type Scene = "plan" | "ticket" | "ship" | "sales" | "marketing";

const STEPS: { id: Destination; scene: Scene; title: string; hint: string; tone: string }[] = [
  { id: "brief", scene: "plan", title: "Idea", hint: "Describe the business", tone: "connect" },
  { id: "delivery", scene: "ticket", title: "Ticket", hint: "Approve the plan", tone: "build" },
  { id: "pipeline", scene: "ship", title: "Ship", hint: "Go live", tone: "deploy" },
  { id: "sales", scene: "sales", title: "Sales", hint: "Who to contact", tone: "connect" },
  { id: "marketing", scene: "marketing", title: "Marketing", hint: "Write the campaign", tone: "deploy" },
];

export function HomePage({
  onOpen,
  projects,
  projectId,
  onSelectProject,
  onCreateProject,
}: {
  onOpen: (tab: Destination) => void;
  projects: { id: string; name: string }[];
  projectId: string;
  onSelectProject: (id: string) => void;
  onCreateProject: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <section className="home">
      <header className="home-hero">
        <p className="home-kicker">What Shipdeck does</p>
        <h1 className="home-line">An idea becomes a live app. You approve each step.</h1>
        <p className="home-sub">Describe the business, approve the plan, then ship. After Sales has a list, Marketing writes the campaign for those people.</p>
      </header>

      <ol className="home-route" aria-label="What Shipdeck does">
        {STEPS.map((step, index) => (
          <li key={step.id} className={`tone-${step.tone}`}>
            <button type="button" onClick={() => onOpen(step.id)}>
              <span className="home-route-name">
                <span className="home-index">{index + 1}</span>
                {step.title}
              </span>
              <span className="home-plate">
                <FlowScene scene={step.scene} plain />
              </span>
              <strong>{step.hint}</strong>
            </button>
          </li>
        ))}
      </ol>

      <form
        className="home-project"
        onSubmit={async (event) => {
          event.preventDefault();
          const next = name.trim();
          if (!next) return;
          setBusy(true);
          setError(null);
          try {
            await onCreateProject(next);
            setName("");
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <section className="home-choice">
          <h2>Jump back in</h2>
          <p>Open a project you already started. Tickets and ship stay with it.</p>
          <label>
            Choose one
            <select value={projectId} onChange={(event) => onSelectProject(event.target.value)}>
              {projects.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        </section>
        <section className="home-choice is-new">
          <h2>Want to try one?</h2>
          <p>Name a new project. You can switch back here any time.</p>
          <label>
            Give it a name
            <span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Clinic desk, Plava site…"
              />
              <button type="submit" disabled={busy || !name.trim()}>
                {busy ? "Creating…" : "Let’s go"}
              </button>
            </span>
          </label>
        </section>
        {error ? <p className="home-project-error">{error}</p> : null}
      </form>
    </section>
  );
}
