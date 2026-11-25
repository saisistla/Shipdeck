import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import {
  industryById,
  planSlot,
  type BriefMode,
  type IdeaBrief,
  type IndustryOffering,
} from "@shipdeck/shared";
import { store as appStore } from "../store.js";
import { delivery } from "../delivery/index.js";
import { DeliveryError } from "../delivery/service.js";
import { createJiraUserStory } from "../delivery/jira.js";
import { completeModel, extractJsonSafe } from "../delivery/modelClient.js";
import { extractDocumentText } from "../delivery/documentText.js";
import {
  composeReport,
  composeResearch,
  jiraStoryFromBrief,
  normalizeReport,
  normalizeResearch,
  practiceReply,
  sourceText,
  technicalBrief,
  ticketFromBrief,
} from "./compose.js";
import { buildTechnicalDeck } from "./pptx.js";
import { BriefStore } from "./store.js";

export class BriefError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
  }
}

function industryOf(brief: Pick<IdeaBrief, "applicationId" | "industry">): IndustryOffering {
  return (
    industryById(brief.applicationId) ?? {
      id: brief.applicationId || "custom",
      name: brief.industry || "General",
      audience: "The people you describe",
    }
  );
}

function planReady(): { endpoint: string; key: string; slot: ReturnType<typeof planSlot> } | null {
  const policy = delivery.store.getPolicy();
  const secrets = delivery.store.getSecrets();
  const slot = planSlot(policy);
  const key = (secrets.planApiKey || secrets.modelApiKey || "").trim();
  if (!key || !slot.endpoint.trim()) return null;
  return { endpoint: slot.endpoint, key, slot };
}

async function askModel(prompt: string): Promise<string> {
  const ready = planReady();
  if (!ready) {
    throw new BriefError("Real cloud needs a plan-model endpoint and API key under Logins. Practice still drafts this without a model.");
  }
  const result = await completeModel(ready.slot, ready.key, prompt, 90_000, 2500);
  return result.text;
}

export function createBriefService(root: string) {
  const store = new BriefStore(path.join(root, "briefs.json"));
  const deckDir = path.join(root, "brief-decks");

  function deckPath(id: string) {
    return path.join(deckDir, `${id}.pptx`);
  }

  function requireBrief(id: string): IdeaBrief {
    const brief = store.get(id);
    if (!brief) throw new BriefError("Idea not found", 404);
    return brief;
  }

  function rememberJiraProject(projectKey: string, connectionId: string) {
    try {
      const policy = delivery.store.getPolicy();
      const upper = projectKey.toUpperCase();
      if (policy.jiraConnectionId === connectionId && !policy.jira.projectKeys.map((key) => key.toUpperCase()).includes(upper)) {
        policy.jira.projectKeys = [...policy.jira.projectKeys, upper];
        delivery.store.savePolicy(policy);
      }
      const conn = appStore.connections.get(connectionId);
      if (!conn || conn.type !== "jira") return;
      const current = (conn.config.projectKeys ?? "")
        .split(/[^A-Za-z0-9]+/)
        .map((item) => item.trim().toUpperCase())
        .filter(Boolean);
      if (current.includes(upper)) return;
      appStore.updateConnection(connectionId, {
        config: { ...conn.config, projectKeys: [...current, upper].join(", ") },
      });
    } catch {
      // The story already exists. The project key can be added under Logins.
    }
  }

  function jiraTarget(connectionId?: string) {
    const policy = delivery.store.getPolicy();
    const id = (connectionId || policy.jiraConnectionId || "").trim();
    const conn = id ? appStore.connections.get(id) : undefined;
    if (conn?.type === "jira") {
      const saved = appStore.connectionSecrets.get(conn.id) ?? {};
      const token = (saved.token || saved.jiraToken || "").trim();
      const siteUrl = (conn.config.siteUrl || "").trim();
      const email = (conn.config.accountEmail || "").trim();
      if (!siteUrl || !token) {
        throw new BriefError(`Jira connection ${conn.name} needs a site URL and token under Logins.`, 400);
      }
      return {
        id: conn.id,
        name: conn.name,
        siteUrl,
        email,
        token,
        deployment: conn.config.deployment === "datacenter" ? ("datacenter" as const) : ("cloud" as const),
      };
    }
    const secrets = delivery.store.getSecrets();
    if (!policy.jira.siteUrl.trim() || !secrets.jiraToken) {
      throw new BriefError("Choose a Jira connection. Add one under Logins if the list is empty.", 400);
    }
    return {
      id: policy.jiraConnectionId || "",
      name: policy.jira.siteUrl,
      siteUrl: policy.jira.siteUrl.trim(),
      email: policy.jira.accountEmail,
      token: secrets.jiraToken,
      deployment: policy.jira.deployment,
    };
  }

  return {
    list: (projectId?: string) => store.list(projectId),
    get: (id: string) => requireBrief(id),
    byDelivery: (runId: string) => store.byDelivery(runId),

    create(input: { projectId?: string; industryId: string; name?: string; mode: BriefMode }): IdeaBrief {
      const industry = industryById(input.industryId);
      if (!industry) throw new BriefError("Choose an industry from the list");
      const name = (input.name ?? "").trim();
      const now = new Date().toISOString();
      const brief: IdeaBrief = {
        id: nanoid(12),
        ...(input.projectId ? { projectId: input.projectId } : {}),
        applicationId: industry.id,
        industry: industry.name,
        applicationName: name,
        mode: input.mode,
        status: "collecting",
        messages: [
          {
            role: "assistant",
            content: name
              ? `You are describing ${name} in ${industry.name}. Tell me who uses it and what they need to finish. You can also upload a report. I will not assume a fixed product.`
              : `You chose ${industry.name}. Tell me the application you want inside it — any one. Who uses it, and what should they be able to finish? You can also upload a report.`,
            at: now,
          },
        ],
        createdAt: now,
        updatedAt: now,
      };
      return store.save(brief);
    },

    async chat(id: string, message: string, mode: BriefMode): Promise<IdeaBrief> {
      const brief = requireBrief(id);
      const text = message.trim();
      if (!text) throw new BriefError("Write a message first");
      const industry = industryOf(brief);
      const now = new Date().toISOString();
      brief.mode = mode;
      brief.messages.push({ role: "user", content: text.slice(0, 4000), at: now });
      let reply: string;
      if (mode === "live") {
        const transcript = brief.messages
          .map((item) => `${item.role === "user" ? "Owner" : "Shipdeck"}: ${item.content}`)
          .join("\n");
        reply = await askModel(
          [
            `You are helping a non-technical owner describe their own application in ${industry.name}.`,
            brief.applicationName ? `They call it: ${brief.applicationName}.` : "They have not named a fixed product. Follow what they say.",
            "Reply in plain sentences. Ask one question, or confirm you can write the business report.",
            "Do not write code. Do not invent market sizes. Do not replace their idea with a different product.",
            transcript,
          ].join("\n\n")
        );
      } else {
        reply = practiceReply(industry, brief.applicationName, brief.messages, Boolean(brief.upload?.excerpt));
      }
      brief.messages.push({ role: "assistant", content: reply.slice(0, 4000), at: new Date().toISOString() });
      return store.save(brief);
    },

    upload(id: string, filename: string, bytes: Buffer): IdeaBrief {
      const brief = requireBrief(id);
      const name = filename.trim() || "report.txt";
      const text = extractDocumentText(name, bytes).trim() || bytes.toString("utf8").replace(/\0/g, "").trim();
      if (text.length < 20) throw new BriefError("That file did not contain enough text to draft a report");
      brief.upload = { filename: name, excerpt: text.slice(0, 12000) };
      brief.messages.push({
        role: "assistant",
        content: `Uploaded ${name}. I will use it when you write the business report.`,
        at: new Date().toISOString(),
      });
      return store.save(brief);
    },

    async report(id: string, mode: BriefMode): Promise<IdeaBrief> {
      const brief = requireBrief(id);
      const industry = industryOf(brief);
      const raw = sourceText(brief.messages, brief.upload);
      if (!raw) throw new BriefError("Describe the idea or upload a report first");
      const fallback = composeReport(industry, brief.applicationName, raw);
      let report = fallback;
      if (mode === "live") {
        try {
          const text = await askModel(
            [
              `Write a business project report as JSON for the owner's own application in ${industry.name}.`,
              brief.applicationName ? `Working name: ${brief.applicationName}.` : "Use their words for the title.",
              "Audience is a non-technical owner. No code. No invented revenue numbers. Do not swap in a different product.",
              `Owner material:\n${raw.slice(0, 6000)}`,
              `JSON keys: title, problem, customer, offer, goals, inScope, outOfScope, assumptions. Each list has at most 4 short strings.`,
            ].join("\n\n")
          );
          report = normalizeReport(extractJsonSafe(text), fallback);
        } catch (err) {
          if (err instanceof BriefError) throw err;
          report = {
            ...fallback,
            assumptions: [
              ...fallback.assumptions,
              "The plan model reply could not be read, so this report was drafted from your words.",
            ],
          };
          report.markdown = composeReport(industry, brief.applicationName, raw).markdown;
        }
      }
      brief.mode = mode;
      brief.report = report;
      if (report.title.trim()) brief.applicationName = report.title.trim();
      brief.status = brief.status === "sent" ? "sent" : "report";
      return store.save(brief);
    },

    async research(id: string, mode: BriefMode): Promise<IdeaBrief> {
      const brief = requireBrief(id);
      if (!brief.report) throw new BriefError("Write the business report before the market draft");
      const industry = industryOf(brief);
      const fallback = composeResearch(industry, brief.report);
      let research = fallback;
      if (mode === "live") {
        try {
          const text = await askModel(
            [
              `Draft a market read as JSON for the owner's application in ${industry.name}: ${brief.report.title}.`,
              "Cover definition, segments, size method, demand, named real competitors, position, SWOT, PESTLE, five forces, price, go-to-market, and what still must be validated.",
              "Name real products in this category. Do not invent a dollar TAM, revenue, or market share. Size stays a method.",
              `Report:\n${brief.report.markdown.slice(0, 4000)}`,
              `JSON keys: summary, swot {strengths, weaknesses, opportunities, threats}, competitors [{name, kind: direct|indirect|substitute|status-quo, offer, wins, gap, price, note}], pricing, risks [{name, level: low|medium|high, note}], demand [{label, score}].`,
            ].join("\n\n")
          );
          research = normalizeResearch(extractJsonSafe(text), fallback);
        } catch (err) {
          if (err instanceof BriefError) throw err;
          research = fallback;
        }
      }
      brief.mode = mode;
      brief.research = research;
      if (brief.status !== "sent") brief.status = "research";
      if (!brief.technicalEdited) brief.technicalMarkdown = technicalBrief(brief);
      return store.save(brief);
    },

    async send(id: string, mode: BriefMode, actor: string, jiraConnectionId?: string): Promise<IdeaBrief> {
      const brief = requireBrief(id);
      const target = jiraTarget(jiraConnectionId);
      const sameConnection = !brief.jiraConnectionId || brief.jiraConnectionId === target.id;
      const savedText = brief.technicalEdited ? (brief.technicalMarkdown || "").trim() : "";
      const storyChanged = Boolean(savedText && savedText !== (brief.jiraStoryMarkdown || "").trim());
      if (brief.status === "sent" && brief.deliveryRunId && brief.ticketKey && sameConnection && !storyChanged) return brief;
      if (!brief.report || !brief.research) {
        throw new BriefError("Finish the business report and the market draft before creating the Jira story");
      }
      const story = jiraStoryFromBrief(brief);
      const alreadyInJira =
        sameConnection &&
        !storyChanged &&
        Boolean(brief.jiraProjectKey && brief.ticketKey && !brief.ticketKey.startsWith("IDEA-"));
      let created = alreadyInJira
        ? {
            issueKey: brief.ticketKey!,
            projectKey: brief.jiraProjectKey!,
            projectName: brief.jiraProjectName || story.projectName,
            summary: story.summary,
          }
        : null;
      if (!created) {
        try {
          created = await createJiraUserStory({
            deployment: target.deployment,
            siteUrl: target.siteUrl,
            email: target.email,
            token: target.token,
            projectName: story.projectName,
            summary: story.summary,
            sections: story.sections,
            descriptionText: story.saved ? story.description : undefined,
          });
        } catch (err) {
          throw new BriefError(err instanceof Error ? err.message : String(err), 400);
        }
        brief.ticketKey = created.issueKey;
        brief.jiraProjectKey = created.projectKey;
        brief.jiraProjectName = created.projectName;
        brief.jiraConnectionId = target.id;
        brief.jiraSiteUrl = target.siteUrl;
        store.save(brief);
        if (target.id) rememberJiraProject(created.projectKey, target.id);
      }
      const ticket = ticketFromBrief(brief);
      ticket.key = created.issueKey;
      ticket.summary = created.summary;
      ticket.description = story.description;
      ticket.acceptance = story.acceptance;
      brief.mode = mode;
      try {
        const result = await delivery.start({
          mode,
          changeKind: "new_app",
          ticket,
          actor,
          projectId: brief.projectId,
          repoUrl: "",
        });
        brief.deliveryRunId = result.run.id;
        brief.ticketKey = result.run.ticket.key;
        brief.jiraProjectKey = created.projectKey;
        brief.jiraProjectName = created.projectName;
        brief.jiraConnectionId = target.id || brief.jiraConnectionId;
        brief.jiraSiteUrl = target.siteUrl;
        if (!brief.technicalEdited) brief.technicalMarkdown = technicalBrief(brief);
        if (brief.technicalEdited && brief.technicalMarkdown) brief.jiraStoryMarkdown = brief.technicalMarkdown.trim();
        brief.status = "sent";
        const previous = deckPath(brief.id);
        if (fs.existsSync(previous)) fs.unlinkSync(previous);
        return store.save(brief);
      } catch (err) {
        if (err instanceof DeliveryError) throw new BriefError(err.message, err.status);
        throw err;
      }
    },

    saveTechnical(id: string, markdown: string): IdeaBrief {
      const brief = requireBrief(id);
      const text = markdown.replace(/\r\n/g, "\n").trim();
      if (text.length < 20) throw new BriefError("Write a bit more before saving the brief");
      if (text.length > 20000) throw new BriefError("That brief is too long. Keep the part the story needs.");
      brief.technicalMarkdown = text;
      brief.technicalEdited = true;
      return store.save(brief);
    },

    presentation(id: string): { filename: string; bytes: Buffer } {
      const brief = requireBrief(id);
      const file = deckPath(id);
      if (!fs.existsSync(file)) {
        throw new BriefError("Approve architecture.md on the ticket, then build the slides there", 404);
      }
      return {
        filename: `${(brief.ticketKey || brief.applicationName).replace(/[^\w.-]+/g, "-")}-technical.pptx`,
        bytes: fs.readFileSync(file),
      };
    },

    presentationForDelivery(runId: string): { filename: string; bytes: Buffer } {
      const brief = store.byDelivery(runId);
      if (!brief) throw new BriefError("This ticket did not start from an idea", 404);
      const run = delivery.store.getRun(runId);
      if (!run) throw new BriefError("Ticket not found", 404);
      const approved = run.approvals.some((item) => item.gate === "architecture" && item.action === "approve");
      if (!approved) {
        throw new BriefError("Approve architecture.md on the ticket before building the slides", 409);
      }
      if (!run.architecture.markdown.trim()) throw new BriefError("architecture.md is empty", 409);
      const bytes = buildTechnicalDeck({
        title: run.ticket.summary || brief.applicationName,
        ticketKey: run.ticket.key,
        applicationName: brief.applicationName,
        industry: brief.industry,
        architectureMarkdown: run.architecture.markdown,
      });
      fs.mkdirSync(deckDir, { recursive: true });
      fs.writeFileSync(deckPath(brief.id), bytes);
      return {
        filename: `${run.ticket.key.replace(/[^\w.-]+/g, "-")}-technical.pptx`,
        bytes,
      };
    },
  };
}
