import type {
  DeliveryArchitecture,
  DeliveryEstimate,
  DeliveryPolicyPublic,
  DeliveryScope,
  DeliveryTicket,
} from "@shipdeck/shared";
import { chatProtocolFor, codeSlot, planSlot } from "@shipdeck/shared";
import { buildArchitectureDoc, buildImpactAnalysisDoc, pendingArchitectureDoc, plannedApis } from "./architectureDoc.js";
import { attachmentPromptBlock, customerTicketLines, READ_THE_WHOLE_TICKET } from "./ticketAttachments.js";
import { missingTicketItems } from "./ticketCoverage.js";
import { addUsage, completeModel, EMPTY_USAGE, type ModelUsage } from "./modelClient.js";

/** List-price rates used only to show a range. They are not an invoice. */
const INPUT_USD_PER_TOKEN = 2.5 / 1_000_000;
const OUTPUT_USD_PER_TOKEN = 10 / 1_000_000;

export interface DeliveryPlan {
  scope: DeliveryScope;
  architecture: DeliveryArchitecture;
  estimate: DeliveryEstimate;
  needsClarification: boolean;
  usage: ModelUsage;
}

export interface PlannerInput {
  ticket: DeliveryTicket;
  policy: DeliveryPolicyPublic;
  revisionNotes: string[];
  changeKind: "new_app" | "existing_repo";
  repoUrl: string;
  mode: "simulate" | "live";
  architectureMarkdown?: string;
  existingArchitectureMarkdown?: string;
}

export type DeliveryPlanner = (input: PlannerInput) => Promise<DeliveryPlan>;

function capabilitySlug(value: string, index: number): string {
  const base = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);
  return `${base || "item"}-${index + 1}`;
}

export function ticketComponents(ticket: DeliveryTicket, language: string) {
  const lines = ticket.acceptance.length ? ticket.acceptance : [ticket.summary];
  return [
    { name: ticket.summary.slice(0, 48) || capabilitySlug(ticket.summary, 0), responsibility: ticket.summary, language },
    ...lines.slice(0, 8).map((line, index) => ({
      name: line.slice(0, 48) || capabilitySlug(line, index + 1),
      responsibility: line,
      language,
    })),
    { name: "Health", responsibility: "Report ok for deploy verify", language },
  ];
}

function money(tokensIn: number, tokensOut: number): number {
  return Number((tokensIn * INPUT_USD_PER_TOKEN + tokensOut * OUTPUT_USD_PER_TOKEN).toFixed(4));
}

export function costForUsage(usage: ModelUsage): number {
  if (usage.inputTokens || usage.outputTokens) return money(usage.inputTokens, usage.outputTokens);
  const input = Math.round(usage.totalTokens * 0.3);
  return money(input, Math.max(0, usage.totalTokens - input));
}

/** Forecast from architecture.md: APIs, charts, components, and the files code will write. */
export function estimateFromArchitecture(input: {
  ticket: DeliveryTicket;
  policy: DeliveryPolicyPublic;
  architecture: Pick<DeliveryArchitecture, "markdown" | "components">;
  pending?: boolean;
}): DeliveryEstimate {
  if (input.pending) {
    const inputTokens = Math.max(400, Math.ceil(JSON.stringify(input.ticket).length / 4) + 200);
    const outputTokens = 800;
    return {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      costUsd: money(inputTokens, outputTokens),
      assumptions: [
        "Planning only — architecture.md is written after the open questions are answered",
        "List rates for display. Not a vendor invoice",
      ],
    };
  }
  const markdown = input.architecture.markdown || "";
  const apis = plannedApis(input.ticket).length;
  const charts = (markdown.match(/```mermaid/g) ?? []).length;
  const components = Math.max(input.architecture.components.length, 1);
  const fileCount = REQUIRED_PROJECT_FILES.length;
  const inputTokens = Math.max(
    1200,
    Math.ceil(markdown.length / 4) + Math.ceil(JSON.stringify(input.ticket).length / 4) + 350 * fileCount
  );
  const outputTokens = Math.max(3000, fileCount * 1100 + apis * 280 + components * 180 + charts * 120);
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    costUsd: money(inputTokens, outputTokens),
    assumptions: [
      `To implement architecture.md and write the code: ${apis} APIs, ${components} components, ${charts} charts, ${fileCount} files`,
      "This is the post-approve forecast for generating the project from that file",
      "List rates for display. Not a vendor invoice",
    ],
  };
}

export function simulatePlanner(input: PlannerInput): DeliveryPlan {
  const language =
    input.policy.allowedLanguages.find((item) =>
      ["node", "javascript", "typescript"].includes(item.toLowerCase())
    ) ||
    input.policy.allowedLanguages[0] ||
    "node";
  const revision = input.revisionNotes.length;
  const thin = input.ticket.description.trim().length < 80 || input.ticket.acceptance.length === 0;
  const ambiguities = thin
    ? ["The ticket is missing a description or acceptance criteria. Confirm scope before build."]
    : [];
  const standards =
    input.changeKind === "existing_repo"
      ? [
          `Read standards from ${input.repoUrl}`,
          `Branch from ${input.policy.git.defaultBaseBranch}`,
          "Leave unrelated modules unchanged",
          "Platform: fixture data only, GET /health for deploy verify, lint/unit/integration",
        ]
      : [
          "Greenfield service",
          "Stay inside the language, package, and license allow-lists",
          "Platform: fixture data only, GET /health for deploy verify, lint/unit/integration",
        ];

  const technologies = [language, "HTTP", "fixture store", input.policy.sandbox];
  const components = ticketComponents(input.ticket, language);

  const needsClarification = ambiguities.length > 0 && revision === 0;
  const existingRepo = input.changeKind === "existing_repo";
  const markdown = needsClarification
    ? pendingArchitectureDoc(input.ticket, ambiguities)
    : buildArchitectureDoc({
        ticket: input.ticket,
        policy: input.policy,
        components,
        technologies,
        assumptions: ["Fixture data only", "GET /health for deploy verify"],
        revisionNotes: input.revisionNotes,
        impactPointer: existingRepo,
      });
  const impactAnalysis =
    existingRepo && !needsClarification
      ? buildImpactAnalysisDoc({
          ticket: input.ticket,
          policy: input.policy,
          repoUrl: input.repoUrl,
          components,
          technologies,
          revisionNotes: input.revisionNotes,
          existingArchitecture: input.existingArchitectureMarkdown,
        })
      : undefined;
  const estimate = estimateFromArchitecture({
    ticket: input.ticket,
    policy: input.policy,
    architecture: { markdown, components },
    pending: needsClarification,
  });

  return {
    needsClarification,
    scope: {
      inScope: input.ticket.acceptance.length
        ? input.ticket.acceptance
        : ["Clarify the ticket before implementation"],
      outOfScope: ["Production data access", "Changes outside this ticket", "Opening a pull request unless auto-open is enabled"],
      ambiguities,
      standardsApplied: standards,
    },
    architecture: {
      markdown,
      ...(impactAnalysis ? { impactAnalysis } : {}),
      technologies,
      components,
      assumptions: [
        "Cap is checked against this forecast, not against a vendor invoice",
        "Tests run on fixtures",
        `Sandbox is ${input.policy.sandbox}`,
      ],
      revision,
    },
    estimate,
    usage: EMPTY_USAGE,
  };
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  let raw = (fenced ? fenced[1] : text).trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) raw = raw.slice(start, end + 1);
  try {
    return JSON.parse(raw);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`The model reply was cut off or not valid JSON (${detail})`);
  }
}

const REQUIRED_PROJECT_FILES = [
  "package.json",
  "src/app.js",
  "public/index.html",
  "fixtures/data.json",
  "README.md",
];

function ticketContext(input: PlannerInput): string {
  return [
    READ_THE_WHOLE_TICKET,
    customerTicketLines(input.ticket),
    attachmentPromptBlock(input.ticket),
    "Approved architecture:",
    input.architectureMarkdown ?? "",
    `License: ${input.policy.allowedLicenses[0] ?? "MIT"}.`,
  ]
    .filter(Boolean)
    .join("\n");
}

async function askFile(
  slot: ReturnType<typeof codeSlot>,
  apiKey: string,
  prompt: string
): Promise<{ path: string; contents: string; usage: ModelUsage }> {
  const completion = await completeModel(slot, apiKey, prompt.trim(), 180_000, null);
  const parsed = extractJson(completion.text) as {
    path?: string;
    contents?: string;
  };
  if (typeof parsed.contents !== "string") throw new Error("The model did not return file contents");
  return { path: parsed.path || "", contents: parsed.contents, usage: completion.usage };
}

export async function editProjectFiles(
  policy: DeliveryPolicyPublic,
  apiKey: string,
  instruction: string,
  files: Array<{ path: string; contents: string }>,
  images: Array<{ mimeType: string; base64: string }> = []
): Promise<{ files: Array<{ path: string; contents: string }>; usage: ModelUsage }> {
  const raw = codeSlot(policy);
  const aliased = chatProtocolFor(raw.provider);
  const slot = aliased ? { ...raw, provider: aliased } : raw;
  if (!apiKey.trim() || !slot.endpoint.trim()) {
    throw new Error("This edit needs a code-model endpoint and API key");
  }
  const bundle = files
    .filter((file) => file.contents.length <= 12_000)
    .map((file) => `### ${file.path}\n${file.contents}`)
    .join("\n\n");
  const prompt = [
    "Edit this project the way a developer edits files by hand.",
    READ_THE_WHOLE_TICKET,
    "Change only the files required by the request. Leave every other file out of the reply.",
    "When the file already exists, change only the part the request asks for. Leave the rest of that file's working behavior as it is.",
    "Do not change working code, labels, or actions the request did not mention.",
    "When the request names products or labels, update the file that already stores that data as well as the screen.",
    "Do not rewrite architecture.md.",
    'Return only JSON: {"files":[{"path":"public/index.html","contents":"the full new file text"}]}',
    "Each contents value must be the complete file, not a diff.",
    "The person asking may not be technical. A short question and a screenshot are enough.",
    "When the page looks empty, missing, or wrong, change the code that loads and shows the data already saved in this project.",
    "When the person says the page is cut off, too small, or not the full page, make it fill the screen. Remove max-height limits and inner scrolling. Do not cap any section at part of the screen.",
    "Do not change colors, spacing, or layout unless the person asked for the appearance.",
    "A tester's note is about the tests. Change the test files so they check the behavior the person described.",
    "Do not return a file whose text is unchanged.",
    images.length
      ? `Screenshots attached: ${images.length}. The screenshot is the problem. Do not restyle the page so it looks like that picture.`
      : "",
    `Request: ${instruction}`,
    "Current files:",
    bundle,
  ]
    .filter(Boolean)
    .join("\n");
  const once = async (extra: string) => {
    const completion = await completeModel(slot, apiKey, `${prompt}\n${extra}`.trim(), 120_000, 12_000, images);
    const parsed = extractJson(completion.text) as {
      path?: string;
      contents?: string;
      files?: Array<{ path?: string; contents?: string }>;
    };
    const listed = Array.isArray(parsed.files)
      ? parsed.files
      : typeof parsed.contents === "string"
        ? [{ path: parsed.path, contents: parsed.contents }]
        : [];
    const next = listed.filter(
      (file): file is { path: string; contents: string } =>
        typeof file.path === "string" && file.path.trim().length > 0 && typeof file.contents === "string"
    );
    if (!next.length) throw new Error("The code model did not return a file");
    return { files: next, usage: completion.usage };
  };
  try {
    return await once("");
  } catch {
    return await once("Return valid JSON only. Include the full text of each changed file.");
  }
}

export async function planWithModel(input: PlannerInput, apiKey: string): Promise<DeliveryPlan> {
  const slot = planSlot(input.policy);
  if (!apiKey.trim()) throw new Error("Live mode requires a plan-model API key");
  if (!slot.endpoint.trim()) throw new Error("Live mode requires a plan-model endpoint");
  const prompt = [
    "Return only JSON with keys summary, inScope, outOfScope, ambiguities, architectureMarkdown, technologies, components, assumptions.",
    "components is an array of {name, responsibility, language}.",
    READ_THE_WHOLE_TICKET,
    "inScope must list every item the ticket names, including products or labels listed under a new tab. outOfScope is only what the ticket did not ask for.",
    "The Jira ticket is a product request only. Do not treat missing health checks, tests, fixtures, or deploy steps as ambiguities.",
    "Always add those from platform policy: fixture data, GET /health, lint, unit, and integration.",
    "languages must be chosen from the allow-list. Do not include secrets.",
    `Allow-list: ${input.policy.allowedLanguages.join(", ")}`,
    `Licenses: ${input.policy.allowedLicenses.join(", ")}`,
    `Package sources: ${input.policy.allowedPackageSources.join(", ")}`,
    `Change: ${input.changeKind} ${input.repoUrl}`,
    input.changeKind === "existing_repo"
      ? "This changes an existing repository. Name the screen and the data store for every item the ticket asks for. Leave modules the ticket does not mention unchanged."
      : "",
    input.existingArchitectureMarkdown?.trim()
      ? `Existing architecture.md from the repository:\n${input.existingArchitectureMarkdown.trim().slice(0, 4000)}`
      : "",
    `Revision notes: ${input.revisionNotes.join(" | ") || "none"}`,
    customerTicketLines(input.ticket),
    attachmentPromptBlock(input.ticket),
  ]
    .filter(Boolean)
    .join("\n");
  const completion = await completeModel(slot, apiKey, prompt);
  const parsed = extractJson(completion.text) as {
    inScope?: string[];
    outOfScope?: string[];
    ambiguities?: string[];
    architectureMarkdown?: string;
    technologies?: string[];
    components?: Array<{ name?: string; responsibility?: string; language?: string }>;
    assumptions?: string[];
  };
  const base = simulatePlanner(input);
  const language = input.policy.allowedLanguages[0] || "node";
  const components = parsed.components?.length
    ? parsed.components.map((c) => ({
        name: c.name || "component",
        responsibility: c.responsibility || "",
        language: c.language || language,
      }))
    : base.architecture.components;
  const technologies = parsed.technologies?.length ? parsed.technologies : base.architecture.technologies;
  const assumptions = parsed.assumptions?.length ? parsed.assumptions : base.architecture.assumptions;
  const ambiguities = parsed.ambiguities ?? [];
  const needsClarification = ambiguities.length > 0 && input.revisionNotes.length === 0;
  const markdown = needsClarification
    ? pendingArchitectureDoc(input.ticket, ambiguities)
    : buildArchitectureDoc({
        ticket: input.ticket,
        policy: input.policy,
        components,
        technologies,
        assumptions,
        revisionNotes: input.revisionNotes,
        extraMarkdown: parsed.architectureMarkdown,
        impactPointer: input.changeKind === "existing_repo",
      });
  const impactAnalysis =
    input.changeKind === "existing_repo" && !needsClarification
      ? buildImpactAnalysisDoc({
          ticket: input.ticket,
          policy: input.policy,
          repoUrl: input.repoUrl,
          components,
          technologies,
          revisionNotes: input.revisionNotes,
          existingArchitecture: input.existingArchitectureMarkdown,
        })
      : undefined;
  return {
    needsClarification,
    scope: {
      inScope: parsed.inScope?.length ? parsed.inScope : base.scope.inScope,
      outOfScope: parsed.outOfScope?.length ? parsed.outOfScope : base.scope.outOfScope,
      ambiguities,
      standardsApplied: base.scope.standardsApplied,
    },
    architecture: {
      markdown,
      ...(impactAnalysis ? { impactAnalysis } : {}),
      technologies,
      components,
      assumptions,
      revision: input.revisionNotes.length,
    },
    estimate: estimateFromArchitecture({
      ticket: input.ticket,
      policy: input.policy,
      architecture: { markdown, components },
      pending: needsClarification,
    }),
    usage: completion.usage,
  };
}

export async function generateProjectFiles(
  input: PlannerInput,
  apiKey: string,
  onLiveUsage?: (usage: ModelUsage, label: string) => Promise<void> | void
): Promise<Array<{ path: string; contents: string }>> {
  const raw = codeSlot(input.policy);
  const aliased = chatProtocolFor(raw.provider);
  const slot = aliased ? { ...raw, provider: aliased } : raw;
  if (!apiKey.trim()) throw new Error("Live mode requires a code-model API key");
  if (!slot.endpoint.trim()) throw new Error("Live mode requires a code-model endpoint");
  const context = ticketContext(input);
  const files: Array<{ path: string; contents: string }> = [];
  for (const filePath of REQUIRED_PROJECT_FILES) {
    const hints = [
      filePath === "package.json" ? 'Set "type": "module" and start script "node src/app.js".' : "",
      filePath === "src/app.js"
        ? 'Export health() returning { status: "ok" }. GET /health is JSON only. GET / and /index.html must serve public/index.html as text/html. Add the ticket APIs. Listen when run as main.'
        : "",
      filePath === "public/index.html"
        ? "Usable website UI for this ticket (pages the user asked for). Not an empty page."
        : "",
      filePath.startsWith("test/") ? "Must pass with node --test. Fixture data only." : "",
    ]
      .filter(Boolean)
      .join(" ");
    const written = files.map((file) => file.path).join(", ") || "none";
    const file = await askFile(
      slot,
      apiKey,
      [
        "Implement this one file from the approved architecture.md. Match those APIs. Not a generic stub.",
        `Return only JSON: {"path":"${filePath}","contents":"file text"}`,
        `Write only ${filePath}. Write the complete file.`,
        hints,
        `Already written: ${written}`,
        context,
      ]
        .filter(Boolean)
        .join("\n")
    );
    files.push({ path: filePath, contents: file.contents });
    await onLiveUsage?.(file.usage, filePath);
  }
  if (!files.some((file) => file.path.replace(/\\/g, "/") === "src/app.js")) {
    throw new Error("The model did not return src/app.js for the project folder");
  }
  const missing = missingTicketItems(customerTicketLines(input.ticket), files);
  if (missing.length) {
    throw new Error(
      `The change was not accepted. The ticket names ${missing.join(", ")} and they are not in the data the screen reads.`
    );
  }
  return files;
}

export function capReason(estimate: DeliveryEstimate, policy: DeliveryPolicyPublic): "token_cap" | "cost_cap" | null {
  if (estimate.totalTokens > policy.tokenCap) return "token_cap";
  if (estimate.costUsd > policy.costCapUsd) return "cost_cap";
  return null;
}

export { extractJson, money };
