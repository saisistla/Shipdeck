const STOP = new Set([
  "a",
  "the",
  "and",
  "add",
  "new",
  "tab",
  "tabs",
  "product",
  "products",
  "please",
  "following",
  "below",
  "are",
  "detailed",
  "to",
  "modify",
  "application",
  "existing",
  "source",
  "code",
  "based",
  "miscellaneous",
]);

function cleanItem(raw: string): string {
  return raw.trim().replace(/^[("']+|[)"'.,]+$/g, "").replace(/\s+/g, " ");
}

function keepItem(item: string): boolean {
  if (item.length < 2 || item.length > 40) return false;
  if (/\d{1,3}\.\d/.test(item)) return false;
  const words = item.toLowerCase().split(" ");
  if (words.length > 4) return false;
  return words.some((word) => word.length > 1 && !STOP.has(word));
}

/** Names the ticket lists outright, such as "a) Milk" or "jonnalu, ragulu". */
export function requiredTicketItems(text: string): string[] {
  const found = new Map<string, string>();
  const add = (raw: string) => {
    const item = cleanItem(raw).split(/\s+(?=[A-Z])/)[0] ?? "";
    if (!keepItem(item)) return;
    const key = item.toLowerCase();
    if (!found.has(key)) found.set(key, item);
  };
  for (const part of text.split(/\b[a-z]\)\s*/i).slice(1)) {
    add(part.split(/\s+(?=[A-Z])|[.,]/)[0] ?? "");
  }
  for (const match of text.matchAll(/(?:-|:)\s*([A-Za-z][A-Za-z'-]*(?:\s*,\s*[A-Za-z][A-Za-z'-]*)+)/g)) {
    for (const part of (match[1] ?? "").split(",")) add(part);
  }
  return [...found.values()];
}

export function isTicketDataPath(rel: string): boolean {
  return /(^|\/)(seed|fixtures?|catalog)\.[^/]+$/i.test(rel) || /(^|\/)data\.json$/i.test(rel);
}

/** An item counts only when the data the screen reads contains it, not only a button label. */
export function missingTicketItems(ticketText: string, files: Array<{ path: string; contents: string }>): string[] {
  const data = files.filter((file) => isTicketDataPath(file.path));
  const haystack = (data.length ? data : files).map((file) => file.contents).join("\n");
  return requiredTicketItems(ticketText).filter(
    (item) => !new RegExp(`\\b${item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(haystack)
  );
}
