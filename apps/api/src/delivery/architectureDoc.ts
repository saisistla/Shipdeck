import type { DeliveryComponent, DeliveryPolicyPublic, DeliveryRun, DeliveryTicket } from "@shipdeck/shared";
import { attachmentMarkdown, commentMarkdown } from "./ticketAttachments.js";

export const ARCHITECTURE_FILE = "architecture.md";
export const IMPACT_ANALYSIS_FILE = "impact-analysis.md";

export interface ArchitectureDocInput {
  ticket: DeliveryTicket;
  policy: DeliveryPolicyPublic;
  components: DeliveryComponent[];
  technologies: string[];
  assumptions: string[];
  revisionNotes: string[];
  extraMarkdown?: string;
  impactPointer?: boolean;
}

export interface PlannedApi {
  method: string;
  path: string;
  purpose: string;
}

function mermaidId(value: string, fallback: string): string {
  const id = value.replace(/[^a-zA-Z0-9]/g, "").slice(0, 24);
  return id || fallback;
}

export function plannedApis(ticket: DeliveryTicket): PlannedApi[] {
  const apis: PlannedApi[] = [{ method: "GET", path: "/health", purpose: "Deploy verify — report ok" }];
  const lines = ticket.acceptance.length ? ticket.acceptance : [ticket.summary];
  for (const line of lines.slice(0, 8)) {
    const lower = line.toLowerCase();
    const slug =
      line
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 28) || "resource";
    if (/\b(cancel|delete|remove)\b/.test(lower)) {
      apis.push({ method: "DELETE", path: `/api/${slug}/:id`, purpose: line });
    } else if (/\b(book|create|add|record|post|submit)\b/.test(lower)) {
      apis.push({ method: "POST", path: `/api/${slug}`, purpose: line });
    } else {
      apis.push({ method: "GET", path: `/api/${slug}`, purpose: line });
    }
  }
  return apis;
}

/** Old approved runs stored a prose paragraph. Rebuild so View/Download get charts. */
export function hydrateArchitectureRun(run: DeliveryRun, policy: DeliveryPolicyPublic): boolean {
  if (run.needsClarification) return false;
  let changed = false;
  if (!run.architecture.markdown.includes("```mermaid")) {
    const previous = run.architecture.markdown.trim();
    run.architecture.markdown = buildArchitectureDoc({
      ticket: run.ticket,
      policy,
      components: run.architecture.components,
      technologies: run.architecture.technologies.length ? run.architecture.technologies : ["node", "HTTP"],
      assumptions: run.architecture.assumptions,
      revisionNotes: run.revisionNotes,
      extraMarkdown: previous && !previous.startsWith("#") ? previous : undefined,
      impactPointer: run.changeKind === "existing_repo",
    });
    changed = true;
  }
  if (run.changeKind === "existing_repo") {
    if (!run.architecture.impactAnalysis?.trim()) {
      run.architecture.impactAnalysis = buildImpactAnalysisDoc({
        ticket: run.ticket,
        policy,
        repoUrl: run.repoUrl,
        components: run.architecture.components,
        technologies: run.architecture.technologies,
        revisionNotes: run.revisionNotes,
      });
      changed = true;
    }
    if (!run.architecture.markdown.includes("## Impact analysis")) {
      run.architecture.markdown = `${run.architecture.markdown.trim()}\n${impactPointerBlock()}`;
      changed = true;
    }
  }
  return changed;
}

/** Shown until open questions are answered. No charts yet. */
export function pendingArchitectureDoc(ticket: DeliveryTicket, questions: string[]): string {
  return `# ${ticket.key} — ${ticket.summary}

architecture.md is written after the open questions are answered.

## Open questions
${questions.map((item, index) => `${index + 1}. ${item}`).join("\n")}
${attachmentMarkdown(ticket)}${commentMarkdown(ticket)}`;
}

/** Platform-owned architecture.md: text, APIs, and Mermaid. Used for review, download, and the feature branch. */
export function buildArchitectureDoc(input: ArchitectureDocInput): string {
  const { ticket, policy, components, technologies, assumptions, revisionNotes } = input;
  const apis = plannedApis(ticket);
  const ui = mermaidId("StaffUI", "UI");
  const api = mermaidId("AppAPI", "API");
  const store = mermaidId("FixtureStore", "Store");
  const flowNodes = components
    .slice(0, 6)
    .map((item, index) => `  ${mermaidId(item.name, `C${index}`)}["${item.name.replace(/"/g, "")}"]`)
    .join("\n");
  const flowEdges = components
    .slice(0, 6)
    .map((item, index) => `  ${api} --> ${mermaidId(item.name, `C${index}`)}`)
    .join("\n");
  const seqLines = apis
    .slice(0, 6)
    .map((item) => `  Staff->>API: ${item.method} ${item.path}`)
    .join("\n");
  const revisionBlock =
    revisionNotes.length === 0
      ? ""
      : `\n## Revisions applied\n${revisionNotes.map((note, i) => `${i + 1}. ${note}`).join("\n")}\n`;
  const extra = input.extraMarkdown?.trim()
    ? `\n## Planner notes\n${input.extraMarkdown.trim()}\n`
    : "";
  const impact = input.impactPointer ? impactPointerBlock() : "";

  return `# ${ticket.key} — ${ticket.summary}

## Intent
${ticket.description || ticket.summary}

This file is the approved architecture. Code is written from this document. Revise it until you approve.
${attachmentMarkdown(ticket)}${commentMarkdown(ticket)}
## System context

\`\`\`mermaid
flowchart LR
  Staff[Staff] --> ${ui}[Web UI]
  ${ui} --> ${api}[HTTP API]
  ${api} --> ${store}[Fixture JSON]
  ${api} --> Health[GET /health]
\`\`\`

## Components

\`\`\`mermaid
flowchart TB
  ${api}[HTTP API]
${flowNodes}
${flowEdges}
\`\`\`

${components.map((item) => `- **${item.name}** (${item.language}) — ${item.responsibility}`).join("\n")}
- **Fixture store** — JSON under \`fixtures/\`. No production database.

## APIs

| Method | Path | Purpose |
| --- | --- | --- |
${apis.map((item) => `| ${item.method} | \`${item.path}\` | ${item.purpose} |`).join("\n")}

## Request flow

\`\`\`mermaid
sequenceDiagram
  actor Staff
  participant UI as Web UI
  participant API as HTTP API
  participant Store as Fixtures
  Staff->>UI: Open the app
  UI->>API: GET /health
  API-->>UI: ok
${seqLines}
  API->>Store: read or write fixture JSON
  Store-->>API: records
  API-->>UI: JSON
\`\`\`

## Technologies
${technologies.map((item) => `- ${item}`).join("\n")}

After approval, the change stays inside this repository. Languages: ${policy.allowedLanguages.join(", ")}. Packages: ${policy.allowedPackageSources.join(", ")}. License: ${policy.allowedLicenses.join(", ") || "not declared"}.

## In scope
${(ticket.acceptance.length ? ticket.acceptance : [ticket.summary]).map((item) => `- ${item}`).join("\n")}

## Out of scope
- Production data access
- Work outside this ticket
- A pull request unless auto-open is enabled

## Assumptions
${(assumptions.length ? assumptions : ["Fixture data only", "GET /health for deploy verify"]).map((item) => `- ${item}`).join("\n")}

## Deploy
After lint, unit, and integration, and after deploy approval, pick Git and a cloud, then run the pipeline. Target **${policy.devTargetLabel}**. Rollback owner: **${policy.rollbackOwner}**.
${revisionBlock}${extra}${impact}
`;
}

function impactPointerBlock(): string {
  return `
## Impact analysis

This ticket changes an existing repository. Read \`impact-analysis.md\` before you approve. That file lists what will change, where it lands, and what stays.
`;
}

export interface ImpactAnalysisInput {
  ticket: DeliveryTicket;
  policy: DeliveryPolicyPublic;
  repoUrl: string;
  components: DeliveryComponent[];
  technologies: string[];
  revisionNotes: string[];
  existingArchitecture?: string;
}

function mentionedPaths(text: string): string[] {
  const found = [...text.matchAll(/(?:^|[\s`"'(])((?:src|public|test|fixtures|docs)\/[\w./-]+\.[A-Za-z0-9]+)/gm)].map(
    (match) => match[1]
  );
  return [...new Set(found)].slice(0, 12);
}

function existingApiRows(markdown: string): string[] {
  return markdown
    .split("\n")
    .filter((line) => /^\|\s*(GET|POST|PUT|PATCH|DELETE)\s*\|/i.test(line))
    .map((line) => line.replace(/^\||\|$/g, "").trim())
    .slice(0, 10);
}

/** Existing-repository tickets: what the change will do, and which parts of the current system it touches. */
export function buildImpactAnalysisDoc(input: ImpactAnalysisInput): string {
  const { ticket, policy, repoUrl, components, technologies, revisionNotes } = input;
  const apis = plannedApis(ticket);
  const repo = repoUrl.trim() || "the existing repository";
  const existing = input.existingArchitecture?.trim() ?? "";
  const existingApis = existing ? existingApiRows(existing) : [];
  const existingFiles = existing ? mentionedPaths(existing) : [];
  const existingTitle = existing.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const work = ticket.acceptance.length ? ticket.acceptance : [ticket.summary];
  const files = [
    "public/index.html — the page people see",
    "src/app.js — APIs and how the page is served",
    "fixtures/data.json — local sample data only",
    "test/unit.test.js and test/integration.test.js — the test bar",
    "architecture.md — the plan this ticket will follow",
    "impact-analysis.md — this document",
  ];
  return `# Impact analysis — ${ticket.key}

## What this is
This ticket changes **${repo}**. Read this before you approve the plan. It says what will happen after approval, which parts of the current system are touched, and what is left alone.

${
  existing
    ? `## What we read
Shipdeck read \`architecture.md\` from the existing repository${existingTitle ? ` (“${existingTitle}”)` : ""}. The impact below compares that current plan with this ticket.
${existingApis.length ? `\nCurrent APIs in that file:\n${existingApis.map((row) => `- ${row}`).join("\n")}\n` : ""}
${existingFiles.length ? `Files already named in that file: ${existingFiles.map((file) => `\`${file}\``).join(", ")}.\n` : ""}`
    : `## What we read
No \`architecture.md\` was found on the repository base branch, or it could not be read. This analysis uses the Jira ticket and the new plan. Unrelated modules are still left unchanged.
`
}

## What will happen after you approve
1. A feature branch \`shipdeck/${ticket.key}\` is written from the approved plan. The current production branch stays until testers raise the pull request.
2. The product change in this ticket is applied: ${work.join("; ")}.
3. Lint, unit, and integration must pass on fixtures before a pull request.
4. Deploy reuses the existing VM or cloud target you saved. Shipdeck does not invent a new service until you approve deploy.

## Where it will affect

| Area | What happens | Where |
| --- | --- | --- |
| Pages people see | The UI is updated for this ticket | \`public/index.html\` |
| Application code | New or changed APIs for this ticket | \`src/app.js\` |
| Data | Fixture JSON only. No production database | \`fixtures/data.json\` |
| Tests | Lint, unit, and integration must cover the change | \`test/\` |
| Current architecture | The branch plan is brought up to this ticket | \`architecture.md\` |
| Rest of the repository | Left unchanged unless this ticket names it | other folders |

This ticket’s APIs:

${apis.map((item) => `- \`${item.method} ${item.path}\` — ${item.purpose}`).join("\n")}

Components that carry the change:
${components.map((item) => `- **${item.name}** (${item.language}) — ${item.responsibility}`).join("\n")}

## What will not change
- Production data and live databases
- Modules this ticket does not name
- Opening a pull request until testers say the app looks right
- The running VM or cloud service until you approve deploy
- Secrets. A dirty secrets scan stops the branch

## Blast radius

\`\`\`mermaid
flowchart LR
  Ticket[${ticket.key}] --> Pages[public/index.html]
  Ticket --> Api[src/app.js]
  Ticket --> Tests[test/]
  Pages --> Users[People using the current site]
  Api --> Health[GET /health]
  Tests --> PR[Pull request after tests pass]
  PR --> Live[Existing deploy target]
\`\`\`

Risk is limited to the files above and the existing deploy target **${policy.devTargetLabel}**. Rollback owner: **${policy.rollbackOwner}**. Technologies in play: ${technologies.join(", ") || "as in the plan"}.

## Before you approve
- Confirm the files and APIs above are the ones this ticket should touch.
- If a page or module must stay as it is, revise the plan or reject it.
${revisionNotes.length ? `\n## Revisions already applied\n${revisionNotes.map((note, index) => `${index + 1}. ${note}`).join("\n")}\n` : ""}`;
}
