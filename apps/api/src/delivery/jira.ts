import fs from "node:fs";
import path from "node:path";
import type { DeliveryTicket, DeliveryTicketAttachment } from "@shipdeck/shared";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  attachmentKind,
  excerptFromBytes,
  safeAttachmentName,
} from "./ticketAttachments.js";

function adfText(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(adfText).join("");
  const record = node as { type?: string; text?: string; content?: unknown[] };
  if (typeof record.text === "string") return record.text;
  const inner = (record.content ?? []).map(adfText).join("");
  if (record.type === "hardBreak") return "\n";
  if (record.type === "listItem") return `${inner.trim()}\n`;
  if (record.type === "paragraph" || record.type === "heading" || record.type === "blockquote") return `${inner}\n`;
  return inner;
}

function splitAcceptance(raw: string): { description: string; acceptance: string[] } {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const index = lines.findIndex((line) => /^acceptance\b/i.test(line.trim().replace(/[:*#]/g, "").trim()));
  if (index < 0) return { description: raw.trim(), acceptance: [] };
  const description = lines.slice(0, index).join("\n").trim();
  const acceptance = lines
    .slice(index + 1)
    .map((line) => line.replace(/^[-*•\d.)\s]+/, "").trim())
    .filter(Boolean);
  return { description, acceptance };
}

function jiraHeaders(opts: { deployment: "cloud" | "datacenter"; email: string; token: string }): Record<string, string> {
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
  };
  headers.authorization =
    opts.deployment === "cloud"
      ? `Basic ${Buffer.from(`${opts.email}:${opts.token}`).toString("base64")}`
      : `Bearer ${opts.token}`;
  return headers;
}

interface JiraAttachment {
  id?: string;
  filename?: string;
  mimeType?: string;
  size?: number;
  content?: string;
}

interface JiraComment {
  body?: unknown;
  author?: { displayName?: string };
}

async function downloadAttachments(
  opts: {
    deployment: "cloud" | "datacenter";
    email: string;
    token: string;
    issueKey: string;
    attachmentDir?: string;
  },
  raw: JiraAttachment[]
): Promise<DeliveryTicketAttachment[]> {
  const used = new Set<string>();
  const attachments: DeliveryTicketAttachment[] = [];
  if (opts.attachmentDir) fs.mkdirSync(opts.attachmentDir, { recursive: true });
  for (const item of raw.slice(0, MAX_ATTACHMENTS)) {
    const filename = (item.filename ?? "").trim();
    if (!filename) continue;
    const size = Number(item.size || 0);
    const mimeType = item.mimeType || "";
    const kind = attachmentKind(filename, mimeType);
    const storedName = safeAttachmentName(filename, used);
    const next: DeliveryTicketAttachment = {
      filename,
      mimeType,
      size: size || undefined,
      id: item.id,
      kind,
      storedName,
    };
    if (size > MAX_ATTACHMENT_BYTES || !item.content || !opts.attachmentDir) {
      attachments.push(next);
      continue;
    }
    try {
      const res = await fetch(item.content, {
        headers: jiraHeaders(opts),
        redirect: "follow",
      });
      if (!res.ok) {
        attachments.push(next);
        continue;
      }
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length > MAX_ATTACHMENT_BYTES) {
        attachments.push(next);
        continue;
      }
      fs.writeFileSync(path.join(opts.attachmentDir, storedName), bytes);
      const excerpt = excerptFromBytes(filename, bytes, mimeType);
      if (excerpt) next.textExcerpt = excerpt;
      next.size = bytes.length;
    } catch {
      // Ticket load still succeeds if one file cannot be downloaded.
    }
    attachments.push(next);
  }
  return attachments;
}

function commentLines(raw: JiraComment[]): string[] {
  return raw
    .slice(-8)
    .map((item) => {
      const author = item.author?.displayName?.trim();
      const text = (typeof item.body === "string" ? item.body : adfText(item.body)).replace(/\s+/g, " ").trim();
      if (!text) return "";
      const line = author ? `${author}: ${text}` : text;
      return line.slice(0, 400);
    })
    .filter(Boolean);
}

export async function fetchJiraTicket(opts: {
  deployment: "cloud" | "datacenter";
  siteUrl: string;
  email: string;
  token: string;
  issueKey: string;
  attachmentDir?: string;
}): Promise<DeliveryTicket> {
  const root = opts.siteUrl.replace(/\/$/, "");
  if (!root) throw new Error("Jira site URL is required to load a ticket");
  if (!opts.token.trim()) throw new Error("Jira token is required to load a ticket");
  const cloud = opts.deployment === "cloud";
  const url = `${root}/rest/api/${cloud ? "3" : "2"}/issue/${encodeURIComponent(opts.issueKey)}?fields=summary,description,attachment,comment`;
  const res = await fetch(url, { headers: jiraHeaders(opts) });
  if (res.status === 404) throw new Error(`Jira issue ${opts.issueKey} was not found`);
  if (!res.ok) throw new Error(`Jira read failed (${res.status})`);
  const body = (await res.json()) as {
    key?: string;
    fields?: {
      summary?: string;
      description?: unknown;
      attachment?: JiraAttachment[];
      comment?: { comments?: JiraComment[] };
    };
  };
  const raw =
    typeof body.fields?.description === "string"
      ? body.fields.description
      : adfText(body.fields?.description);
  const split = splitAcceptance(raw);
  const key = body.key || opts.issueKey;
  let attachments: DeliveryTicketAttachment[] = [];
  try {
    attachments = await downloadAttachments(
      { ...opts, issueKey: key, attachmentDir: opts.attachmentDir },
      body.fields?.attachment ?? []
    );
  } catch {
    attachments = (body.fields?.attachment ?? [])
      .map((item) => ({
        filename: item.filename ?? "",
        mimeType: item.mimeType,
        size: item.size,
        id: item.id,
        kind: attachmentKind(item.filename ?? "", item.mimeType),
      }))
      .filter((item) => item.filename);
  }
  return {
    key,
    summary: (body.fields?.summary ?? "").trim(),
    description: split.description,
    acceptance: split.acceptance,
    comments: commentLines(body.fields?.comment?.comments ?? []),
    attachments,
  };
}

export async function commentOnJira(opts: {
  deployment: "cloud" | "datacenter";
  siteUrl: string;
  email: string;
  token: string;
  issueKey: string;
  text: string;
}): Promise<void> {
  const root = opts.siteUrl.replace(/\/$/, "");
  const cloud = opts.deployment === "cloud";
  const url = `${root}/rest/api/${cloud ? "3" : "2"}/issue/${encodeURIComponent(opts.issueKey)}/comment`;
  const headers = jiraHeaders(opts);
  const body = cloud
    ? {
        body: {
          type: "doc",
          version: 1,
          content: [{ type: "paragraph", content: [{ type: "text", text: opts.text }] }],
        },
      }
    : { body: opts.text };
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Jira comment failed (${res.status})`);
}

export interface JiraStorySections {
  problem: string;
  customer: string;
  offer: string;
  inScope: string[];
  outOfScope: string[];
  acceptance: string[];
}

export interface JiraStoryResult {
  issueKey: string;
  projectKey: string;
  projectName: string;
  summary: string;
}

/** Jira project keys are 2–10 uppercase letters and digits, and must start with a letter. */
export function jiraProjectKey(name: string): string {
  let key = name.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^[A-Z]/.test(key)) key = `A${key}`;
  key = key.slice(0, 8);
  if (key.length < 2) key = `${key}APP`.slice(0, 4);
  return key;
}

function storyDocument(sections: JiraStorySections) {
  const paragraph = (text: string) => ({
    type: "paragraph",
    content: [{ type: "text", text: (text || " ").slice(0, 2000) }],
  });
  const heading = (text: string) => ({
    type: "heading",
    attrs: { level: 3 },
    content: [{ type: "text", text }],
  });
  const bullets = (items: string[]) => ({
    type: "bulletList",
    content: (items.length ? items : ["None stated"]).slice(0, 12).map((item) => ({
      type: "listItem",
      content: [paragraph(item)],
    })),
  });
  return {
    type: "doc",
    version: 1,
    content: [
      heading("Problem"),
      paragraph(sections.problem),
      heading("Who it is for"),
      paragraph(sections.customer),
      heading("What version one does"),
      paragraph(sections.offer),
      heading("In scope"),
      bullets(sections.inScope),
      heading("Out of scope"),
      bullets(sections.outOfScope),
      heading("Acceptance"),
      bullets(sections.acceptance),
    ],
  };
}

/** Turns the owner's saved brief into Jira's document format, including lines they added or removed. */
export function markdownToAdf(markdown: string) {
  const paragraph = (text: string) => ({
    type: "paragraph",
    content: [{ type: "text", text: text.slice(0, 2000) || " " }],
  });
  const heading = (text: string) => ({
    type: "heading",
    attrs: { level: 3 },
    content: [{ type: "text", text: text.slice(0, 240) || " " }],
  });
  const content: unknown[] = [];
  let bucket: string[] = [];
  const flush = () => {
    if (!bucket.length) return;
    content.push({
      type: "bulletList",
      content: bucket.splice(0, bucket.length).map((item) => ({
        type: "listItem",
        content: [paragraph(item)],
      })),
    });
  };
  for (const raw of markdown.split("\n")) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const head = /^(#{1,3})\s+(.+)$/.exec(line);
    if (head) {
      flush();
      content.push(heading(head[2]));
      continue;
    }
    const bullet = /^[-*]\s+(.+)$/.exec(line);
    if (bullet) {
      bucket.push(bullet[1]);
      continue;
    }
    flush();
    content.push(paragraph(line));
  }
  flush();
  if (!content.length) content.push(paragraph(markdown.slice(0, 2000)));
  return { type: "doc", version: 1, content: content.slice(0, 80) };
}

function storyPlain(sections: JiraStorySections): string {
  return [
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
}

async function jiraError(res: Response, action: string): Promise<Error> {
  let detail = "";
  try {
    const body = (await res.json()) as { errorMessages?: string[]; errors?: Record<string, string> };
    detail = [...(body.errorMessages ?? []), ...Object.values(body.errors ?? {})].filter(Boolean).join(" ");
  } catch {
    detail = "";
  }
  return new Error(detail ? `Jira ${action} failed (${res.status}): ${detail}` : `Jira ${action} failed (${res.status})`);
}

function sameName(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function pickIssueType(names: string[]): string {
  const story = names.find((name) => /story/i.test(name));
  if (story) return story;
  const task = names.find((name) => /^task$/i.test(name));
  if (task) return task;
  return names[0] || "Story";
}

/**
 * Creates a software project named after the application, then a user story
 * with problem, scope, and acceptance. Market research is not sent.
 */
export async function createJiraUserStory(opts: {
  deployment: "cloud" | "datacenter";
  siteUrl: string;
  email: string;
  token: string;
  projectName: string;
  summary: string;
  sections: JiraStorySections;
  /** Saved brief. When set, this is the story body instead of the generated sections. */
  descriptionText?: string;
}): Promise<JiraStoryResult> {
  const root = opts.siteUrl.replace(/\/$/, "");
  if (!root) throw new Error("Jira site URL is required to create the story");
  if (!opts.token.trim()) throw new Error("Jira token is required to create the story");
  if (opts.deployment === "cloud" && !opts.email.trim()) {
    throw new Error("Jira Cloud needs the account email saved with the token");
  }
  const cloud = opts.deployment === "cloud";
  const version = cloud ? "3" : "2";
  const headers = jiraHeaders(opts);
  const projectName = opts.projectName.trim().slice(0, 80) || "New application";
  const summary = opts.summary.trim().slice(0, 200) || projectName;

  const myselfRes = await fetch(`${root}/rest/api/${version}/myself`, { headers });
  if (!myselfRes.ok) throw await jiraError(myselfRes, "sign-in");
  const myself = (await myselfRes.json()) as { accountId?: string; name?: string; displayName?: string };

  async function readProject(key: string): Promise<{ key: string; name: string } | null> {
    const res = await fetch(`${root}/rest/api/${version}/project/${encodeURIComponent(key)}`, { headers });
    if (res.status === 404) return null;
    if (!res.ok) throw await jiraError(res, "project lookup");
    const body = (await res.json()) as { key?: string; name?: string };
    return { key: body.key || key, name: body.name || projectName };
  }

  async function createProject(key: string): Promise<{ key: string; name: string }> {
    const body = cloud
      ? {
          key,
          name: projectName,
          description: `${projectName}. Created from Shipdeck so the user story has a project.`,
          projectTypeKey: "software",
          projectTemplateKey: "com.pyxis.greenhopper.jira:gh-simplified-agility-scrum",
          leadAccountId: myself.accountId,
          assigneeType: "UNASSIGNED",
        }
      : {
          key,
          name: projectName,
          description: `${projectName}. Created from Shipdeck so the user story has a project.`,
          projectTypeKey: "software",
          lead: myself.name,
        };
    const res = await fetch(`${root}/rest/api/${version}/project`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await jiraError(res, "project create");
    const created = (await res.json()) as { key?: string; name?: string };
    return { key: created.key || key, name: created.name || projectName };
  }

  const base = jiraProjectKey(projectName);
  let project: { key: string; name: string } | null = null;
  let lastError = "Jira did not create a project for this application";
  for (let n = 0; n < 6 && !project; n += 1) {
    const candidate = (n === 0 ? base : `${base}${n}`).slice(0, 10);
    const existing = await readProject(candidate);
    if (existing && sameName(existing.name, projectName)) {
      project = existing;
      break;
    }
    if (existing) continue;
    try {
      project = await createProject(candidate);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/403|401|permission/i.test(message)) {
        throw new Error(
          "Jira refused to create the project. The token needs permission to create projects."
        );
      }
      if (/exist|taken|already/i.test(message)) {
        lastError = message;
        continue;
      }
      throw err;
    }
  }
  if (!project) throw new Error(lastError);

  let typeNames: string[] = [];
  if (cloud) {
    const typesRes = await fetch(
      `${root}/rest/api/3/issue/createmeta/${encodeURIComponent(project.key)}/issuetypes`,
      { headers }
    );
    if (typesRes.ok) {
      const typesBody = (await typesRes.json()) as { issueTypes?: Array<{ name?: string }>; values?: Array<{ name?: string }> };
      typeNames = (typesBody.issueTypes ?? typesBody.values ?? [])
        .map((item) => item.name ?? "")
        .filter(Boolean);
    }
  } else {
    const typesRes = await fetch(
      `${root}/rest/api/2/issue/createmeta?projectKeys=${encodeURIComponent(project.key)}`,
      { headers }
    );
    if (typesRes.ok) {
      const typesBody = (await typesRes.json()) as {
        projects?: Array<{ issuetypes?: Array<{ name?: string }> }>;
      };
      typeNames = (typesBody.projects?.[0]?.issuetypes ?? []).map((item) => item.name ?? "").filter(Boolean);
    }
  }
  const issueType = pickIssueType(typeNames);
  const issueRes = await fetch(`${root}/rest/api/${version}/issue`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      fields: {
        project: { key: project.key },
        summary,
        issuetype: { name: issueType },
        description: opts.descriptionText?.trim()
          ? cloud
            ? markdownToAdf(opts.descriptionText)
            : opts.descriptionText
          : cloud
            ? storyDocument(opts.sections)
            : storyPlain(opts.sections),
      },
    }),
  });
  if (!issueRes.ok) throw await jiraError(issueRes, "story create");
  const issue = (await issueRes.json()) as { key?: string };
  if (!issue.key) throw new Error("Jira created the story but did not return its key");
  return {
    issueKey: issue.key,
    projectKey: project.key,
    projectName: project.name,
    summary,
  };
}
