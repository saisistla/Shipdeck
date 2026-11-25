import fs from "node:fs";
import path from "node:path";
import type { DeliveryAttachmentKind, DeliveryTicket, DeliveryTicketAttachment } from "@shipdeck/shared";
import { extractDocumentText, isOfficeDocument } from "./documentText.js";

export const TICKET_ATTACHMENT_DIR = "ticket-attachments";
export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const MAX_ATTACHMENTS = 12;
const EXCERPT_CHARS = 1500;

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".tif", ".tiff", ".ico"]);
const TEXT_EXT = new Set([".txt", ".md", ".csv", ".json", ".xml", ".html", ".log", ".yml", ".yaml", ".tsv"]);

export function attachmentKind(filename: string, mimeType = ""): DeliveryAttachmentKind {
  const ext = path.extname(filename).toLowerCase();
  const mime = mimeType.toLowerCase();
  if (mime.startsWith("image/") || IMAGE_EXT.has(ext)) return "image";
  if (mime.startsWith("text/") || TEXT_EXT.has(ext)) return "text";
  if (isOfficeDocument(filename, mimeType)) return "document";
  return "file";
}

export function excerptFromBytes(filename: string, bytes: Buffer, mimeType = ""): string {
  const kind = attachmentKind(filename, mimeType);
  if (kind === "text") return textExcerpt(bytes.toString("utf8"));
  if (kind === "document") return textExcerpt(extractDocumentText(filename, bytes, mimeType));
  return "";
}

export function safeTicketKey(key: string): string {
  return key.trim().toUpperCase().replace(/[^A-Z0-9._-]+/g, "-") || "ticket";
}

export function safeAttachmentName(filename: string, used: Set<string>): string {
  const base = path.basename(filename).replace(/[^\w.\-]+/g, "_").replace(/^\.+/, "") || "attachment";
  let name = base;
  let n = 2;
  while (used.has(name.toLowerCase())) {
    const ext = path.extname(base);
    name = `${path.basename(base, ext)}-${n}${ext}`;
    n += 1;
  }
  used.add(name.toLowerCase());
  return name;
}

export function pendingAttachmentDir(root: string, ticketKey: string): string {
  return path.join(root, "delivery-attachments", "pending", safeTicketKey(ticketKey));
}

export function runAttachmentDir(root: string, runId: string): string {
  return path.join(root, "delivery-attachments", runId);
}

export function textExcerpt(contents: string): string {
  const trimmed = contents.replace(/\u0000/g, "").trim();
  if (!trimmed) return "";
  return trimmed.length > EXCERPT_CHARS ? `${trimmed.slice(0, EXCERPT_CHARS)}\n…` : trimmed;
}

export function relevantAttachments(ticket: DeliveryTicket): DeliveryTicketAttachment[] {
  return ticket.attachments.filter((item) => item.relevant);
}

export function commentsForArchitecture(ticket: DeliveryTicket): string[] {
  return ticket.relevantComments ?? [];
}

/** Every line the customer wrote. Status notes are used only when no judged lines were kept. */
export function customerTicketLines(ticket: DeliveryTicket): string {
  const comments = ticket.relevantComments?.length ? ticket.relevantComments : (ticket.comments ?? []);
  return [
    `Ticket ${ticket.key}: ${ticket.summary}`,
    ticket.description,
    ...comments,
    ...(ticket.acceptance ?? []),
  ]
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

/** Same rule for the plan model and the code model, on every ticket. */
export const READ_THE_WHOLE_TICKET = [
  "Read every line of the ticket before you plan or change code: the title, the description, every comment, and every acceptance line.",
  "Do every item those lines ask for. Do not stop after the title.",
  "When a line adds a tab, screen, or section and names the items under it, add the tab and add those items to the data that screen already reads.",
  "An item the ticket names is required. Do not treat it as a new product you should skip.",
  "Do not add anything the ticket did not name. Do not change working behavior the ticket did not mention.",
].join("\n");

export function attachmentMarkdown(ticket: DeliveryTicket): string {
  const items = relevantAttachments(ticket);
  if (!items.length) return "";
  const blocks = items.map((item) => {
    const name = item.storedName || item.filename;
    const why = item.relevanceReason || item.contentSummary || "Needed for this change";
    const lines = [`- \`${item.filename}\` — ${why}`];
    if ((item.kind || attachmentKind(item.filename, item.mimeType)) === "image") {
      lines.push("", `![${item.filename}](${TICKET_ATTACHMENT_DIR}/${name})`, "");
    }
    if (item.textExcerpt?.trim()) {
      lines.push("", "```", item.textExcerpt.trim(), "```", "");
    }
    return lines.join("\n");
  });
  return `
## Ticket attachments
Only files that help this ticket. Old test shots and unrelated comment images are left out.

${blocks.join("\n")}
`;
}

export function commentMarkdown(ticket: DeliveryTicket): string {
  const comments = commentsForArchitecture(ticket);
  if (!comments.length) return "";
  return `
## Ticket comments
${comments.map((item) => `- ${item}`).join("\n")}
`;
}

export function attachmentPromptBlock(ticket: DeliveryTicket): string {
  const items = relevantAttachments(ticket);
  if (!items.length) return "";
  const lines = [
    "Use only these Jira files. They were judged relevant to this ticket. Do not invent work from other attachments.",
    ...items.map((item) => {
      const kind = item.kind || attachmentKind(item.filename, item.mimeType);
      const where = item.storedName ? `${TICKET_ATTACHMENT_DIR}/${item.storedName}` : item.filename;
      const why = item.relevanceReason || item.contentSummary || "";
      const excerpt = item.textExcerpt?.trim() ? `\n${item.textExcerpt.trim()}` : "";
      return `- ${item.filename} (${kind}) at ${where}${why ? ` — ${why}` : ""}${excerpt}`;
    }),
  ];
  return lines.join("\n");
}

export function promoteTicketAttachments(
  root: string,
  ticketKey: string,
  runId: string,
  attachments: DeliveryTicketAttachment[]
): DeliveryTicketAttachment[] {
  const pending = pendingAttachmentDir(root, ticketKey);
  const dest = runAttachmentDir(root, runId);
  fs.mkdirSync(dest, { recursive: true });
  if (fs.existsSync(pending)) {
    for (const name of fs.readdirSync(pending)) {
      const from = path.join(pending, name);
      if (!fs.statSync(from).isFile()) continue;
      fs.copyFileSync(from, path.join(dest, name));
    }
  }
  return attachments.map((item) => ({
    ...item,
    kind: item.kind || attachmentKind(item.filename, item.mimeType),
    storedName: item.storedName || path.basename(item.filename),
  }));
}

export function copyAttachmentsIntoWorkspace(
  root: string,
  runId: string,
  workspace: string,
  attachments: DeliveryTicketAttachment[] = []
): string[] {
  const keep = new Set(
    attachments.filter((item) => item.relevant).map((item) => item.storedName || item.filename).filter(Boolean)
  );
  if (!keep.size) return [];
  const src = runAttachmentDir(root, runId);
  if (!fs.existsSync(src)) return [];
  const dest = path.join(workspace, TICKET_ATTACHMENT_DIR);
  fs.mkdirSync(dest, { recursive: true });
  const copied: string[] = [];
  for (const name of fs.readdirSync(src)) {
    if (!keep.has(name)) continue;
    const from = path.join(src, name);
    if (!fs.statSync(from).isFile()) continue;
    fs.copyFileSync(from, path.join(dest, name));
    copied.push(`${TICKET_ATTACHMENT_DIR}/${name}`);
  }
  return copied;
}

function guessMime(filename: string, fallback: string): string {
  switch (path.extname(filename).toLowerCase()) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".svg":
      return "image/svg+xml";
    case ".txt":
    case ".log":
      return "text/plain";
    case ".md":
      return "text/markdown";
    case ".json":
      return "application/json";
    case ".csv":
      return "text/csv";
    case ".pdf":
      return "application/pdf";
    case ".doc":
      return "application/msword";
    case ".docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case ".xls":
      return "application/vnd.ms-excel";
    case ".xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case ".ppt":
      return "application/vnd.ms-powerpoint";
    case ".pptx":
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case ".rtf":
      return "application/rtf";
    default:
      return fallback;
  }
}

export function readStoredAttachment(
  dir: string,
  filename: string,
  mimeType = "application/octet-stream"
): { bytes: Buffer; mimeType: string } | null {
  const name = path.basename(filename);
  if (!name || name !== filename.replace(/\\/g, "/")) return null;
  const full = path.resolve(dir, name);
  if (!full.startsWith(path.resolve(dir) + path.sep) && full !== path.resolve(dir)) return null;
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return null;
  return { bytes: fs.readFileSync(full), mimeType: mimeType && mimeType !== "application/octet-stream" ? mimeType : guessMime(name, mimeType) };
}

export function isScannableAttachment(rel: string): boolean {
  const norm = rel.replaceAll("\\", "/");
  if (!norm.startsWith(`${TICKET_ATTACHMENT_DIR}/`)) return true;
  return TEXT_EXT.has(path.extname(norm).toLowerCase());
}
