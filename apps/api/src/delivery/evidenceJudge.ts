import type { DeliveryTicket, DeliveryTicketAttachment, ModelSlot } from "@shipdeck/shared";
import { completeModel, EMPTY_USAGE, extractJsonSafe, type ModelUsage } from "./modelClient.js";
import { attachmentKind, readStoredAttachment } from "./ticketAttachments.js";

const STOP = new Set([
  "this",
  "that",
  "with",
  "from",
  "have",
  "should",
  "they",
  "them",
  "only",
  "when",
  "your",
  "into",
  "will",
  "the",
  "and",
  "for",
  "are",
  "was",
  "were",
  "been",
  "can",
  "need",
  "needs",
  "please",
  "also",
  "just",
  "then",
  "than",
  "over",
  "after",
  "before",
  "see",
  "look",
]);

const DROP =
  /\b(test|tests|testing|failed?|failure|error|stack|traceback|pipeline|jenkins|cypress|selenium|qa|regression|passed|green build|ci\/cd|retest|build log)\b/i;
const KEEP =
  /\b(mockup|wireframe|current (page|screen|ui|list|form)|as-is|to-be|design spec|annotated|mark-?up|enhancement|add (a |the )?(column|field|surname)|screenshot of the current)\b/i;
const POINTS_AT_FILE =
  /\b(see (the )?(attached|attachment|screenshot|image)|attached (screenshot|image|file|png)|current (page|screen|ui) .*(attached|screenshot)|mockup|wireframe)\b/i;

function tokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 3 && !STOP.has(word) && !/^\d+$/.test(word))
  );
}

export function ticketTerms(ticket: DeliveryTicket): Set<string> {
  return tokens(
    [ticket.key, ticket.summary, ticket.description, ...(ticket.acceptance ?? [])].join(" ")
  );
}

function overlap(left: Set<string>, right: Set<string>): string[] {
  return [...left].filter((word) => right.has(word));
}

function mentionsFile(comment: string, filename: string): boolean {
  const base = filename.toLowerCase().replace(/\.[a-z0-9]+$/, "");
  const line = comment.toLowerCase();
  return line.includes(filename.toLowerCase()) || (base.length > 3 && line.includes(base));
}

export function judgeAttachmentHeuristic(
  item: DeliveryTicketAttachment,
  ticket: DeliveryTicket,
  extras: { soleNonTestImage?: boolean }
): DeliveryTicketAttachment {
  const kind = item.kind || attachmentKind(item.filename, item.mimeType);
  const blob = `${item.filename} ${item.textExcerpt ?? ""} ${item.contentSummary ?? ""}`;
  const fileTerms = tokens(blob);
  const shared = overlap(fileTerms, ticketTerms(ticket));
  const comments = ticket.comments ?? [];
  const pointed = comments.some((comment) => mentionsFile(comment, item.filename) && !DROP.test(comment));
  const ticketPointsAtFiles = POINTS_AT_FILE.test(`${ticket.description} ${ticket.summary}`);

  if (DROP.test(item.filename) && shared.length === 0) {
    return {
      ...item,
      kind,
      relevant: false,
      relevanceReason: "Looks like test or pipeline evidence, not the change itself",
    };
  }
  if (shared.length > 0 || KEEP.test(blob) || pointed) {
    return {
      ...item,
      kind,
      relevant: true,
      relevanceReason:
        shared.length > 0
          ? `Matches this ticket (${shared.slice(0, 4).join(", ")})`
          : pointed
            ? "A ticket comment points at this file for the current change"
            : "Shows the current screen or the requested change",
      contentSummary: item.contentSummary || (kind === "text" ? item.textExcerpt?.slice(0, 180) : undefined),
    };
  }
  if (kind === "image" && extras.soleNonTestImage && ticketPointsAtFiles && !DROP.test(blob)) {
    return {
      ...item,
      kind,
      relevant: true,
      relevanceReason: "The ticket asks to use the attached screenshot, and this is the only non-test image",
    };
  }
  return {
    ...item,
    kind,
    relevant: false,
    relevanceReason: "No clear link to this ticket — likely old comment history",
  };
}

export function judgeCommentHeuristic(comment: string, ticket: DeliveryTicket, keptFiles: string[]): boolean {
  if (!comment.trim()) return false;
  if (DROP.test(comment) && overlap(tokens(comment), ticketTerms(ticket)).length === 0) return false;
  if (keptFiles.some((name) => mentionsFile(comment, name))) return true;
  if (KEEP.test(comment) || POINTS_AT_FILE.test(comment)) return true;
  return overlap(tokens(comment), ticketTerms(ticket)).length > 0;
}

export function applyHeuristicJudgement(ticket: DeliveryTicket): DeliveryTicket {
  const candidates = ticket.attachments ?? [];
  const nonTestImages = candidates.filter((item) => {
    const kind = item.kind || attachmentKind(item.filename, item.mimeType);
    return kind === "image" && !DROP.test(item.filename);
  });
  const attachments = candidates.map((item) =>
    judgeAttachmentHeuristic(item, ticket, { soleNonTestImage: nonTestImages.length === 1 })
  );
  const keptFiles = attachments.filter((item) => item.relevant).map((item) => item.filename);
  const relevantComments = (ticket.comments ?? []).filter((comment) =>
    judgeCommentHeuristic(comment, ticket, keptFiles)
  );
  return { ...ticket, attachments, relevantComments };
}

function imageParts(
  dir: string | undefined,
  attachments: DeliveryTicketAttachment[]
): Array<{ mimeType: string; base64: string }> {
  if (!dir) return [];
  const parts: Array<{ mimeType: string; base64: string }> = [];
  for (const item of attachments) {
    if (parts.length >= 4) break;
    const kind = item.kind || attachmentKind(item.filename, item.mimeType);
    if (kind !== "image") continue;
    const name = item.storedName || item.filename;
    const file = readStoredAttachment(dir, name, item.mimeType);
    if (!file || file.bytes.length > 1_500_000) continue;
    if (!file.mimeType.startsWith("image/") || file.mimeType.includes("svg")) continue;
    parts.push({ mimeType: file.mimeType, base64: file.bytes.toString("base64") });
  }
  return parts;
}

export async function judgeTicketEvidence(opts: {
  ticket: DeliveryTicket;
  attachmentDir?: string;
  live?: boolean;
  slot?: ModelSlot;
  apiKey?: string;
}): Promise<{ ticket: DeliveryTicket; usage: ModelUsage; note: string }> {
  const heuristic = applyHeuristicJudgement(opts.ticket);
  if (!heuristic.attachments.length && !heuristic.comments.length) {
    return { ticket: heuristic, usage: EMPTY_USAGE, note: "" };
  }
  if (!opts.live || !opts.slot || !opts.apiKey?.trim() || !opts.slot.endpoint.trim()) {
    const kept = heuristic.attachments.filter((item) => item.relevant).map((item) => item.filename);
    return {
      ticket: heuristic,
      usage: EMPTY_USAGE,
      note: kept.length
        ? `Used ${kept.join(", ")} from the ticket. Other attachments looked like history or tests.`
        : heuristic.attachments.length
          ? "Ticket files were reviewed. None were clearly about this change, so architecture.md does not include them."
          : "",
    };
  }

  try {
    const listing = heuristic.attachments
      .map((item, index) => {
        const kind = item.kind || attachmentKind(item.filename, item.mimeType);
        return `${index + 1}. ${item.filename} (${kind}) excerpt=${JSON.stringify(item.textExcerpt ?? "")} heuristic=${item.relevant ? "keep" : "drop"}`;
      })
      .join("\n");
    const comments = (heuristic.comments ?? []).map((item, index) => `${index + 1}. ${item}`).join("\n");
    const prompt = [
      "You are reviewing Jira evidence for one current ticket.",
      "Keep a file or comment only if it helps implement THIS ticket: current screen to change, mark-up of the change, mockup, or a sample of the requested work.",
      "Drop old test shots, failed pipeline pictures, 'it works now' screenshots, unrelated history, and duplicates.",
      "Do not keep a file only because it is attached.",
      "Return only JSON: {\"attachments\":[{\"filename\":\"\",\"keep\":true,\"reason\":\"\",\"summary\":\"\"}],\"comments\":[{\"text\":\"\",\"keep\":true,\"reason\":\"\"}]}",
      `Ticket ${heuristic.key}: ${heuristic.summary}`,
      heuristic.description,
      `Acceptance: ${heuristic.acceptance.join("; ")}`,
      `Files:\n${listing || "none"}`,
      `Comments:\n${comments || "none"}`,
    ].join("\n");
    const images = imageParts(opts.attachmentDir, heuristic.attachments);
    const completion = await completeModel(opts.slot, opts.apiKey, prompt, 60_000, 1200, images);
    const parsed = extractJsonSafe(completion.text) as {
      attachments?: Array<{ filename?: string; keep?: boolean; reason?: string; summary?: string }>;
      comments?: Array<{ text?: string; keep?: boolean; reason?: string }>;
    };
    const byName = new Map((parsed.attachments ?? []).map((item) => [item.filename?.toLowerCase(), item]));
    const attachments = heuristic.attachments.map((item) => {
      const model = byName.get(item.filename.toLowerCase());
      if (!model) return item;
      return {
        ...item,
        relevant: Boolean(model.keep),
        relevanceReason: model.reason || item.relevanceReason,
        contentSummary: model.summary || item.contentSummary,
      };
    });
    const commentKeep = new Set(
      (parsed.comments ?? []).filter((item) => item.keep && item.text?.trim()).map((item) => item.text!.trim())
    );
    const relevantComments =
      parsed.comments?.length
        ? (heuristic.comments ?? []).filter((item) => commentKeep.has(item) || [...commentKeep].some((kept) => item.includes(kept) || kept.includes(item)))
        : heuristic.relevantComments ?? [];
    const kept = attachments.filter((item) => item.relevant).map((item) => item.filename);
    return {
      ticket: { ...heuristic, attachments, relevantComments },
      usage: completion.usage,
      note: kept.length
        ? `The plan model kept ${kept.join(", ")} for this ticket and dropped the rest.`
        : "The plan model reviewed ticket files and kept none for architecture.md.",
    };
  } catch {
    const kept = heuristic.attachments.filter((item) => item.relevant).map((item) => item.filename);
    return {
      ticket: heuristic,
      usage: EMPTY_USAGE,
      note: kept.length
        ? `Used ${kept.join(", ")} from the ticket after a local review (model review was unavailable).`
        : "Ticket files were reviewed locally. None were clearly about this change.",
    };
  }
}
