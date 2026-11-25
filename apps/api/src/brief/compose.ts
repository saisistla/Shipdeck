import {
  type BriefChatMessage,
  type BusinessReport,
  type IdeaBrief,
  type IndustryOffering,
  type MarketResearch,
} from "@shipdeck/shared";
import type { DeliveryTicket } from "@shipdeck/shared";
import { buildMarketResearch } from "./market.js";

function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 12)
    .slice(0, 8);
}

function clip(value: string, max = 280): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trim()}…`;
}

export function sourceText(messages: BriefChatMessage[], upload?: { excerpt: string }): string {
  const said = messages
    .filter((item) => item.role === "user")
    .map((item) => item.content.trim())
    .filter(Boolean);
  return [upload?.excerpt ?? "", ...said].filter(Boolean).join("\n\n").trim();
}

export function practiceReply(industry: IndustryOffering, name: string, messages: BriefChatMessage[], hasUpload: boolean): string {
  const label = name.trim() || `your ${industry.name.toLowerCase()} application`;
  const turns = messages.filter((item) => item.role === "user").length;
  if (hasUpload && turns === 0) {
    return `I have the uploaded report for ${label}. Add anything it missed, or write the business report from it. I will mark the market read as a draft.`;
  }
  if (turns <= 1) {
    return `What should ${label} let someone finish on a normal day? Name the people who use it.`;
  }
  if (turns === 2) {
    return `What should version one leave out? Name one thing you will not build yet.`;
  }
  return `I have enough to draft the business report for ${label}. Write the report when you are ready. You can correct it before the market read.`;
}

export function composeReport(industry: IndustryOffering, name: string, raw: string): BusinessReport {
  const lines = sentences(raw);
  const title = name.trim() || lines[0]?.slice(0, 80) || `${industry.name} application`;
  const problem = lines[0] || `${industry.audience} need ${title}.`;
  const offer = lines[1] || lines[0] || title;
  const customer = industry.audience;
  const goals = (lines.length ? lines : [title]).slice(0, 4);
  const inScope = goals;
  const outOfScope = ["Anything you did not describe", "A full industry suite"];
  const assumptions = [
    "Version one is a small staff page with sample records, plus a health check for a later deploy.",
    "The words above are the brief. They are not a signed scope.",
    raw.trim()
      ? "Your notes were folded into this draft. Read them before you approve a plan."
      : "This draft uses the application description because no extra notes were added.",
  ];
  const markdown = [
    `# ${title}`,
    "",
    "## Problem",
    problem,
    "",
    "## Who it is for",
    customer,
    "",
    "## Offer",
    offer,
    "",
    "## Version one",
    ...inScope.map((item) => `- ${item}`),
    "",
    "## Not in version one",
    ...outOfScope.map((item) => `- ${item}`),
    "",
    "## Assumptions",
    ...assumptions.map((item) => `- ${item}`),
  ].join("\n");
  return {
    title,
    problem: clip(problem, 500),
    customer,
    offer: clip(offer, 500),
    goals,
    inScope,
    outOfScope,
    assumptions,
    markdown,
  };
}

export function composeResearch(industry: IndustryOffering, report: BusinessReport): MarketResearch {
  return buildMarketResearch(industry, report);
}

export function technicalBrief(brief: Pick<IdeaBrief, "applicationName" | "report" | "ticketKey">): string {
  const report = brief.report;
  if (!report) return "";
  return [
    `# Technical brief — ${brief.applicationName}`,
    "",
    brief.ticketKey
      ? `Jira story ${brief.ticketKey} is the ticket. Approve architecture.md there. The slides are built after that approval, from the technical plan only.`
      : "Create the Jira story to open the ticket. Slides are built after architecture.md is approved, and they stay technical.",
    "",
    "## What the first build is",
    report.offer,
    "",
    "## Page",
    ...report.inScope.map((item) => `- ${item}`),
    "",
    "## Stays out",
    ...report.outOfScope.map((item) => `- ${item}`),
    "",
    "## Shape",
    "Staff open one page. The page talks to a small HTTP API. The API reads and writes fixture JSON. GET /health is included so a later deploy can be checked.",
  ].join("\n");
}

export interface JiraStorySections {
  problem: string;
  customer: string;
  offer: string;
  inScope: string[];
  outOfScope: string[];
  acceptance: string[];
}

function savedStoryLines(text: string): string[] {
  const bullets = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, "").trim())
    .filter(Boolean);
  if (bullets.length) return bullets.slice(0, 12);
  return text
    .split("\n")
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .filter((line) => line.length > 12 && !/^jira story\b/i.test(line))
    .slice(0, 8);
}

/** Technical story only. Market research stays on the idea and is not copied into Jira. */
export function jiraStoryFromBrief(brief: IdeaBrief): {
  projectName: string;
  summary: string;
  description: string;
  acceptance: string[];
  sections: JiraStorySections;
  /** The owner saved this text. The Jira description is that text, not the generated report. */
  saved: boolean;
} {
  const report = brief.report;
  const projectName = (brief.applicationName || report?.title || brief.industry || "New application").trim().slice(0, 80);
  const summary = (report?.title || projectName).trim().slice(0, 200);
  const savedText = brief.technicalEdited ? (brief.technicalMarkdown || "").trim() : "";
  if (savedText) {
    const lines = savedStoryLines(savedText);
    const acceptance = (lines.length ? lines : [summary]).slice(0, 12);
    return {
      projectName,
      summary,
      description: savedText.slice(0, 12000),
      acceptance,
      saved: true,
      sections: {
        problem: savedText.slice(0, 1500),
        customer: (report?.customer || brief.industry || "The people named in the brief").slice(0, 400),
        offer: acceptance[0] || summary,
        inScope: acceptance.slice(0, 8),
        outOfScope: acceptance.slice(8, 12),
        acceptance,
      },
    };
  }
  const sections: JiraStorySections = {
    problem: (report?.problem || summary).slice(0, 1500),
    customer: (report?.customer || brief.industry || "The people named in the report").slice(0, 400),
    offer: (report?.offer || summary).slice(0, 1500),
    inScope: (report?.inScope.length ? report.inScope : [summary]).slice(0, 8),
    outOfScope: (report?.outOfScope.length ? report.outOfScope : ["Anything outside this story"]).slice(0, 8),
    acceptance: (report?.goals.length ? report.goals : [summary]).slice(0, 8),
  };
  const description = [
    sections.problem,
    "",
    `Who it is for: ${sections.customer}`,
    "",
    `What version one does: ${sections.offer}`,
    "",
    "In scope",
    ...sections.inScope.map((item) => `- ${item}`),
    "",
    "Out of scope",
    ...sections.outOfScope.map((item) => `- ${item}`),
    "",
    "Acceptance",
    ...sections.acceptance.map((item) => `- ${item}`),
  ].join("\n");
  return { projectName, summary, description, acceptance: sections.acceptance, sections, saved: false };
}

export function ticketFromBrief(brief: IdeaBrief): DeliveryTicket {
  const story = jiraStoryFromBrief(brief);
  const key = `IDEA-${brief.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 6).toUpperCase() || "APP"}`;
  return {
    key,
    summary: story.summary,
    description: story.description.slice(0, 8000),
    acceptance: story.acceptance,
    comments: ["Started from an idea in Shipdeck. The Jira story is the technical scope only."],
    attachments: [],
  };
}

function asStringList(value: unknown, max = 6): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .slice(0, max);
}

export function normalizeReport(value: unknown, fallback: BusinessReport): BusinessReport {
  if (!value || typeof value !== "object") return fallback;
  const raw = value as Record<string, unknown>;
  const title = typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : fallback.title;
  const problem = typeof raw.problem === "string" && raw.problem.trim() ? raw.problem.trim() : fallback.problem;
  const customer = typeof raw.customer === "string" && raw.customer.trim() ? raw.customer.trim() : fallback.customer;
  const offer = typeof raw.offer === "string" && raw.offer.trim() ? raw.offer.trim() : fallback.offer;
  const goals = asStringList(raw.goals);
  const inScope = asStringList(raw.inScope);
  const outOfScope = asStringList(raw.outOfScope);
  const assumptions = asStringList(raw.assumptions);
  const next: BusinessReport = {
    title: clip(title, 80),
    problem: clip(problem, 500),
    customer: clip(customer, 180),
    offer: clip(offer, 500),
    goals: goals.length ? goals : fallback.goals,
    inScope: inScope.length ? inScope : fallback.inScope,
    outOfScope: outOfScope.length ? outOfScope : fallback.outOfScope,
    assumptions: assumptions.length ? assumptions : fallback.assumptions,
    markdown: "",
  };
  next.markdown = [
    `# ${next.title}`,
    "",
    "## Problem",
    next.problem,
    "",
    "## Who it is for",
    next.customer,
    "",
    "## Offer",
    next.offer,
    "",
    "## Version one",
    ...next.inScope.map((item) => `- ${item}`),
    "",
    "## Not in version one",
    ...next.outOfScope.map((item) => `- ${item}`),
    "",
    "## Assumptions",
    ...next.assumptions.map((item) => `- ${item}`),
  ].join("\n");
  return next;
}

export function normalizeResearch(value: unknown, fallback: MarketResearch): MarketResearch {
  if (!value || typeof value !== "object") return fallback;
  const raw = value as Record<string, unknown>;
  const swotRaw = (raw.swot && typeof raw.swot === "object" ? raw.swot : {}) as Record<string, unknown>;
  const competitors = Array.isArray(raw.competitors)
    ? raw.competitors
        .map((item) => {
          const row = item as Partial<MarketResearch["competitors"][number]>;
          if (!row?.name?.trim()) return null;
          const kind =
            row.kind === "direct" || row.kind === "indirect" || row.kind === "substitute" || row.kind === "status-quo"
              ? row.kind
              : "direct";
          const gap = clip(row.gap || row.note || "", 240);
          return {
            name: clip(row.name, 80),
            kind,
            offer: clip(row.offer || "", 180),
            wins: clip(row.wins || "", 180),
            gap,
            price: clip(row.price || "Confirm the current price.", 160),
            note: clip(row.note || gap, 240),
          };
        })
        .filter((item): item is MarketResearch["competitors"][number] => Boolean(item))
        .slice(0, 6)
    : [];
  const risks = Array.isArray(raw.risks)
    ? raw.risks
        .map((item) => {
          const row = item as { name?: string; level?: string; note?: string };
          if (!row?.name?.trim()) return null;
          const level = row.level === "low" || row.level === "high" || row.level === "medium" ? row.level : "medium";
          return { name: clip(row.name, 80), level, note: clip(row.note || "", 220) };
        })
        .filter((item): item is MarketResearch["risks"][number] => Boolean(item))
        .slice(0, 5)
    : [];
  const demand = Array.isArray(raw.demand)
    ? raw.demand
        .map((item) => {
          const row = item as { label?: string; score?: number };
          if (!row?.label?.trim()) return null;
          const score = Math.max(0, Math.min(100, Math.round(Number(row.score) || 0)));
          return { label: clip(row.label, 60), score };
        })
        .filter((item): item is MarketResearch["demand"][number] => Boolean(item))
        .slice(0, 5)
    : [];
  const next: MarketResearch = structuredClone(fallback);
  if (typeof raw.summary === "string" && raw.summary.trim()) next.summary = clip(raw.summary, 700);
  if (typeof raw.pricing === "string" && raw.pricing.trim()) next.pricing = clip(raw.pricing, 500);
  const strengths = asStringList(swotRaw.strengths, 4);
  const weaknesses = asStringList(swotRaw.weaknesses, 4);
  const opportunities = asStringList(swotRaw.opportunities, 4);
  const threats = asStringList(swotRaw.threats, 4);
  if (strengths.length) next.swot.strengths = strengths;
  if (weaknesses.length) next.swot.weaknesses = weaknesses;
  if (opportunities.length) next.swot.opportunities = opportunities;
  if (threats.length) next.swot.threats = threats;
  if (competitors.length) next.competitors = competitors;
  if (risks.length) next.risks = risks;
  if (demand.length) next.demand = demand;
  next.caveat = fallback.caveat;
  return next;
}
