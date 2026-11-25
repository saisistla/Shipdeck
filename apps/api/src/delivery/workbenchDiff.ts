import type { WorkbenchFileChange } from "@shipdeck/shared";

/** Every line that appears more often on one side than the other, in file order. */
export function lineDiff(before: string, after: string): { added: string[]; removed: string[] } {
  const oldLines = before.replace(/\r\n/g, "\n").split("\n");
  const newLines = after.replace(/\r\n/g, "\n").split("\n");
  const available = new Map<string, number>();
  for (const line of oldLines) available.set(line, (available.get(line) ?? 0) + 1);
  const kept = new Map<string, number>();
  const added: string[] = [];
  for (const line of newLines) {
    const seen = kept.get(line) ?? 0;
    if (seen < (available.get(line) ?? 0)) kept.set(line, seen + 1);
    else added.push(line);
  }
  const used = new Map<string, number>();
  const removed: string[] = [];
  for (const line of oldLines) {
    const seen = used.get(line) ?? 0;
    if (seen < (kept.get(line) ?? 0)) used.set(line, seen + 1);
    else removed.push(line);
  }
  return { added, removed };
}

export function fileChange(path: string, before: string, after: string): WorkbenchFileChange {
  const { added, removed } = lineDiff(before, after);
  return { path, added, removed };
}

/** A plain report that the data on the page is wrong. */
export function isProblemReport(message: string): boolean {
  return /\b(empty|missing|wrong|fix|issue|blank|broken|failing|failed)\b/i.test(message) || /not showing|why is this/i.test(message);
}

/** A plain report that the page is cut off or should fill the screen. */
export function asksForFullPage(message: string): boolean {
  return /full page|cut page|cut off|cropped|clipped|too small|half page|entire page|whole page|not the full/i.test(message);
}

/** True when a saved page still caps itself to part of the screen. */
export function pageStillClipped(source: string): boolean {
  const rules = source.match(/max-height\s*:\s*[^;]+/gi) ?? [];
  return rules.some((rule) => {
    const value = rule.split(":").slice(1).join(":").trim().toLowerCase();
    if (!value || value === "none" || value.startsWith("100")) return false;
    return /\d/.test(value);
  });
}

function showsOrLoadsData(line: string): boolean {
  return /\bfetch\s*\(|XMLHttpRequest|\.json\s*\(|\bchildren\b|readFile|pathname|sendJson|innerHTML|textContent|fixtures|classList|res\.end|writeHead/i.test(
    line
  );
}

/** True when a plain report was handled. `after` is the saved file text. */
export function reportWasAddressed(message: string, edits: WorkbenchFileChange[], after: string[] = []): boolean {
  const dataAsk = isProblemReport(message) && !asksForFullPage(message);
  const pageAsk = asksForFullPage(message);
  if (!dataAsk && !pageAsk) return true;
  if (dataAsk) {
    const lines = edits.flatMap((edit) => [...edit.added, ...edit.removed]);
    if (!lines.some(showsOrLoadsData)) return false;
  }
  if (pageAsk && after.some(pageStillClipped)) return false;
  return true;
}

/** What to tell the model when the first edit missed a plain report. */
export function followUpFor(message: string, edits: WorkbenchFileChange[], after: string[]): string {
  const lines = edits.flatMap((edit) => [...edit.added, ...edit.removed]);
  const parts: string[] = [];
  if (isProblemReport(message) && !asksForFullPage(message) && !lines.some(showsOrLoadsData)) {
    parts.push(
      "The previous edit did not change the code that loads or shows the data. Change that code, using the data already saved in the project."
    );
  }
  if (asksForFullPage(message) && after.some(pageStillClipped)) {
    parts.push(
      "The page is still cut off. Remove max-height limits and inner scrolling. Let the page use the full height. Do not cap any section at part of the screen."
    );
  }
  if (!parts.length) parts.push("The previous edit did not fix what the person asked. Change the code that causes the problem in the screenshot.");
  return parts.join(" ");
}

/** One plain sentence for the chat, so a spacing dump is not the only record. */
export function changeSummary(edit: WorkbenchFileChange, after: string): string {
  if (edit.added.length === 0 && edit.removed.length === 0) return `${edit.path} was saved with no line changes.`;
  if (/\.html?$/i.test(edit.path) && pageStillClipped(after)) return `${edit.path} was saved, and the page is still cut off.`;
  const lines = [...edit.added, ...edit.removed];
  if (lines.some(showsOrLoadsData)) return `${edit.path} was saved. The code that loads the page changed.`;
  return `${edit.path} was saved. The spacing changed.`;
}
