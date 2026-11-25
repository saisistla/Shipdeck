const HEADING = "## Latest edits";
const MAX_EMBED = 12_000;

export type HandEdit = { actor: string; path: string; contents: string; removed?: boolean };

function sectionBody(markdown: string): string | null {
  const start = markdown.indexOf(`\n${HEADING}\n`);
  const at = start >= 0 ? start + 1 : markdown.startsWith(`${HEADING}\n`) ? 0 : -1;
  if (at < 0) return null;
  return markdown.slice(at + HEADING.length).replace(/^\n/, "");
}

function withoutSection(markdown: string): string {
  const start = markdown.indexOf(`\n${HEADING}\n`);
  const at = start >= 0 ? start : markdown.startsWith(`${HEADING}\n`) ? 0 : -1;
  if (at < 0) return markdown.trimEnd();
  return markdown.slice(0, at).trimEnd();
}

function entryBlock(edit: HandEdit): string {
  if (edit.removed) {
    return `### ${edit.path}\n${edit.actor} removed this file. It is no longer on the branch.`;
  }
  const full = edit.contents.length <= MAX_EMBED;
  const shown = full ? edit.contents : `${edit.contents.slice(0, MAX_EMBED)}\n…`;
  const tail = full ? "" : "\nThe file on the branch has the full text.";
  return `### ${edit.path}\n${edit.actor} saved this file. This is the current version.${tail}\n\n\`\`\`\n${shown.replace(/\s*$/, "")}\n\`\`\``;
}

function parseEntries(body: string): HandEdit[] {
  const parts = body.split(/^### /m).slice(1);
  return parts.map((part) => {
    const lineEnd = part.indexOf("\n");
    const path = (lineEnd >= 0 ? part.slice(0, lineEnd) : part).trim();
    const removed = /removed this file/.test(part);
    const actor = part.match(/\n([^\n]+) (?:saved|removed) this file/)?.[1] ?? "";
    const fenced = part.match(/```\n([\s\S]*?)\n```/);
    const contents = removed || !fenced ? "" : fenced[1].replace(/\n…$/, "");
    return { actor, path, contents, removed };
  });
}

export function latestEditPaths(markdown: string): string[] {
  const body = sectionBody(markdown);
  if (!body) return [];
  return parseEntries(body)
    .filter((entry) => entry.path && !entry.removed)
    .map((entry) => entry.path);
}

export function removedEditPaths(markdown: string): string[] {
  const body = sectionBody(markdown);
  if (!body) return [];
  return parseEntries(body)
    .filter((entry) => entry.path && entry.removed)
    .map((entry) => entry.path);
}

export function upsertLatestEdit(markdown: string, edit: HandEdit): string {
  const body = sectionBody(markdown);
  const entries = body ? parseEntries(body).filter((entry) => entry.path !== edit.path) : [];
  entries.push(edit);
  const section = `${HEADING}\n\nThe files below were saved in the workbench. They are the current version.\n\n${entries
    .map(entryBlock)
    .join("\n\n")}\n`;
  return `${withoutSection(markdown)}\n\n${section}`;
}

export function carryLatestEdits(previous: string, next: string): string {
  const body = sectionBody(previous);
  if (!body) return next;
  const entries = parseEntries(body).filter((entry) => entry.path);
  return entries.reduce((markdown, entry) => upsertLatestEdit(markdown, entry), withoutSection(next));
}
