import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { SalesAccount, SalesFit } from "@shipdeck/shared";

export interface ProposedCompany {
  company: string;
  website: string;
  whatTheyDo: string;
  whyTheyFit: string;
}

export interface SitePage {
  url: string;
  title: string;
  text: string;
  email: string;
  phone: string;
  linkedin: string;
  person: string;
  role: string;
}

const BLOCKED_HOSTS = new Set(["localhost", "metadata.google.internal", "metadata.internal"]);

/** How many organisations one search will list. A whole-country directory is not available. */
export const SALES_LIST_LIMIT = 25;

export function isPrivateAddress(ip: string): boolean {
  const value = ip.toLowerCase().replace(/^::ffff:/, "");
  if (value === "::1" || value === "0:0:0:0:0:0:0:1") return true;
  if (value.startsWith("fe80:") || value.startsWith("fc") || value.startsWith("fd")) return true;
  if (value.includes(":")) return false;
  const parts = value.split(".").map((item) => Number(item));
  if (parts.length !== 4 || parts.some((item) => !Number.isInteger(item) || item < 0 || item > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function blockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!host || BLOCKED_HOSTS.has(host) || host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (isIP(host)) return isPrivateAddress(host);
  return !host.includes(".");
}

/** Accepts a public https website. Rewrites http to https. Rejects local and private hosts. */
export function publicWebsite(raw: string): URL | null {
  let value = raw.trim();
  if (!value || /\s/.test(value)) return null;
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  value = value.replace(/^http:\/\//i, "https://");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (url.port && url.port !== "443") return null;
  if (blockedHost(url.hostname)) return null;
  url.hash = "";
  return url;
}

export function withoutContacts(text: string): string {
  return text
    .replace(/https?:\/\/(?:[\w.-]+\.)?linkedin\.com\/\S+/gi, "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "")
    .replace(/\+?\d[\d\s().-]{8,}\d/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function proposedCompanies(raw: unknown, limit = SALES_LIST_LIMIT): ProposedCompany[] {
  const record = raw && typeof raw === "object" ? (raw as { companies?: unknown }).companies : raw;
  if (!Array.isArray(record)) return [];
  const seen = new Set<string>();
  const companies: ProposedCompany[] = [];
  for (const item of record) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const company = typeof row.company === "string" ? row.company.trim() : "";
    const website = publicWebsite(typeof row.website === "string" ? row.website : "");
    if (!company || !website) continue;
    const host = website.hostname.replace(/^www\./, "");
    if (seen.has(host)) continue;
    seen.add(host);
    companies.push({
      company: company.slice(0, 160),
      website: website.toString(),
      whatTheyDo: withoutContacts(typeof row.whatTheyDo === "string" ? row.whatTheyDo : "").slice(0, 400),
      whyTheyFit: withoutContacts(typeof row.whyTheyFit === "string" ? row.whyTheyFit : "").slice(0, 400),
    });
    if (companies.length >= limit) break;
  }
  return companies;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&#64;|&#x40;/gi, "@")
    .replace(/&amp;/gi, "&")
    .replace(/&nbsp;/gi, " ");
}

function keepEmail(email: string): boolean {
  const value = email.toLowerCase().replace(/^mailto:/, "");
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(value)) return false;
  if (/^(noreply|no-reply|donotreply)/.test(value)) return false;
  const domain = value.split("@")[1] || "";
  if (/(example\.com|sentry\.|wixpress|schema\.org|cloudflare|godaddy|squarespace|googleapis|w3\.org)$/.test(domain)) {
    return false;
  }
  return true;
}

/** A mailbox on another organisation's domain is not this account's email. */
export function emailMatchesSite(email: string, website: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase().replace(/^www\./, "") || "";
  let host = "";
  try {
    host = new URL(website).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return false;
  }
  if (!domain || !host) return false;
  if (host === domain || host.endsWith(`.${domain}`) || domain.endsWith(`.${host}`)) return true;
  const ignore = new Set(["www", "co", "com", "org", "net", "edu", "ac", "gov", "in", "uk", "ai", "io"]);
  const brand = (value: string) => value.split(".").find((part) => part.length > 2 && !ignore.has(part)) || "";
  const left = brand(host);
  const right = brand(domain);
  return Boolean(left) && left === right;
}

const NAV_LINE = /skip to|main content|cookie|privacy policy|sign in|log in|gymkhana|donate now|^\s*menu\b/i;

/** Drops menu and cookie lines so the description is something a salesperson can read. */
export function cleanBlurb(text: string): string {
  const bits = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter((part) => part.length > 40 && !NAV_LINE.test(part));
  return bits.slice(0, 2).join(" ").slice(0, 320);
}

function preferEmail(emails: string[]): string {
  const unique = [...new Set(emails.map((item) => item.toLowerCase()))];
  unique.sort((left, right) => rankEmail(right) - rankEmail(left));
  return unique[0] || "";
}

function rankEmail(email: string): number {
  const local = email.split("@")[0] || "";
  if (/^(info|hello|contact|enquiries|enquiry|office|admin|sales|reception|admissions|registrar|school)/.test(local)) {
    return 2;
  }
  return 1;
}

function cleanPhone(value: string): string {
  const phone = decodeHtml(value).replace(/^tel:/i, "").split("?")[0].trim();
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return "";
  return phone.slice(0, 40);
}

export function contactsFromHtml(html: string): { email: string; phone: string; linkedin: string } {
  const source = decodeHtml(html);
  const emails: string[] = [];
  for (const match of source.matchAll(/mailto:([^"'?\s>]+)/gi)) {
    const email = decodeURIComponent(match[1] || "").trim();
    if (keepEmail(email)) emails.push(email);
  }
  for (const match of source.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)) {
    if (keepEmail(match[0])) emails.push(match[0]);
  }
  let phone = "";
  const tel = source.match(/tel:(\+?[\d][\d\s().-]{6,}\d)/i);
  if (tel) phone = cleanPhone(tel[1] || "");
  if (!phone) {
    const labeled = source.match(/(?:phone|telephone|tel|call us)[:\s]+(\+?[\d][\d\s().-]{7,}\d)/i);
    if (labeled) phone = cleanPhone(labeled[1] || "");
  }
  const linked = source.match(
    /https?:\/\/(?:[\w.-]+\.)?linkedin\.com\/(?:company|school|in|showcase)\/[A-Za-z0-9._%-]+/i
  );
  return {
    email: preferEmail(emails),
    phone,
    linkedin: linked ? linked[0].replace(/^http:\/\//i, "https://") : "",
  };
}

export function personFromHtml(html: string, buyer = ""): { person: string; role: string } {
  const text = decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<\/(p|div|li|h\d|tr|td)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  ).replace(/[ \t]+/g, " ");
  const buyerWords = buyer
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((word) => word.length > 3);
  const found: { person: string; role: string; score: number }[] = [];
  const name = "([A-Z][a-z]+(?:\\s[A-Z][a-z]+){1,2})";
  const add = (person: string, role: string) => {
    const cleanPerson = person.replace(/\s+/g, " ").trim();
    const cleanRole = role.replace(/\s+/g, " ").trim().slice(0, 60);
    if (!/^[A-Z][a-z]+(?:\s[A-Z][a-z]+){1,2}$/.test(cleanPerson)) return;
    if (/^(The|This|Our|Home|About|Contact|Skip|Read|Click|Menu)$/.test(cleanPerson.split(" ")[0] || "")) return;
    const blob = `${cleanPerson} ${cleanRole}`.toLowerCase();
    const score = (cleanRole ? 1 : 0) + (buyerWords.some((word) => blob.includes(word)) ? 3 : 0);
    found.push({ person: cleanPerson, role: cleanRole, score });
  };
  for (const match of text.matchAll(new RegExp(`${name}\\s*[,|–-]\\s*([A-Za-z][^\\n]{2,40})`, "g"))) {
    add(match[1] || "", (match[2] || "").split(/[.]/)[0] || "");
  }
  for (const match of text.matchAll(
    new RegExp(
      "(Principal|Headteacher|Head Teacher|Director|Founder|Owner|Dean|Admissions Officer|School Head|Managing Director|CEO)\\s*[:\\-]\\s*" +
        name,
      "gi"
    )
  )) {
    add(match[2] || "", match[1] || "");
  }
  found.sort((left, right) => right.score - left.score);
  return found[0] ? { person: found[0].person, role: found[0].role } : { person: "", role: "" };
}

export function pageTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return decodeHtml(match?.[1] || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

export function visibleText(html: string, max = 900): string {
  const text = decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, max);
}

async function resolvesPublic(url: URL): Promise<boolean> {
  if (isIP(url.hostname)) return !isPrivateAddress(url.hostname);
  try {
    const records = await lookup(url.hostname, { all: true });
    return records.length > 0 && records.every((item) => !isPrivateAddress(item.address));
  } catch {
    return false;
  }
}

async function fetchHtml(start: URL): Promise<{ url: URL; html: string } | null> {
  let current = start;
  for (let hop = 0; hop < 3; hop += 1) {
    if (!(await resolvesPublic(current))) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(current, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          accept: "text/html,text/plain;q=0.9",
          "user-agent": "Shipdeck/0.1 (public page read for a sales list)",
        },
      });
      if (res.status >= 300 && res.status < 400) {
        const next = publicWebsite(new URL(res.headers.get("location") || "", current).toString());
        if (!next) return null;
        current = next;
        continue;
      }
      if (!res.ok) return null;
      const type = (res.headers.get("content-type") || "").toLowerCase();
      if (type && !type.includes("html") && !type.includes("text/plain")) return null;
      const length = Number(res.headers.get("content-length") || 0);
      if (length > 500_000) return null;
      const html = (await res.text()).slice(0, 180_000);
      return { url: current, html };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

function sameHost(left: URL, right: URL): boolean {
  return left.hostname.replace(/^www\./, "") === right.hostname.replace(/^www\./, "");
}

export async function readPublicSite(website: string, buyer = ""): Promise<SitePage | null> {
  const home = publicWebsite(website);
  if (!home) return null;
  const first = await fetchHtml(home);
  if (!first) return null;
  let html = first.html;
  let contacts = contactsFromHtml(html);
  let person = personFromHtml(html, buyer);
  const paths = ["/contact", "/contact-us", "/about", "/about-us", "/team", "/our-team", "/leadership", "/people"];
  let extras = 0;
  for (const path of paths) {
    if (extras >= 3) break;
    if (contacts.email && contacts.phone && contacts.linkedin && person.person) break;
    const next = publicWebsite(new URL(path, first.url).toString());
    if (!next || !sameHost(first.url, next)) continue;
    const extra = await fetchHtml(next);
    extras += 1;
    if (!extra) continue;
    const found = contactsFromHtml(extra.html);
    const named = personFromHtml(extra.html, buyer);
    contacts = {
      email: contacts.email || found.email,
      phone: contacts.phone || found.phone,
      linkedin: contacts.linkedin || found.linkedin,
    };
    if (!person.person && named.person) person = named;
    html = `${html}\n${extra.html}`;
  }
  return {
    url: first.url.toString(),
    title: pageTitle(html),
    text: visibleText(html, 1400),
    email: contacts.email,
    phone: contacts.phone,
    linkedin: contacts.linkedin,
    person: person.person,
    role: person.role,
  };
}

async function mapPool<T, R>(items: T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await run(items[index]);
    }
  }
  const workers = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

function explainedRows(raw: unknown): Map<string, { whatTheyDo: string; whyTheyFit: string; person: string; role: string; opener: string; fit: SalesFit }> {
  const rows = new Map<string, { whatTheyDo: string; whyTheyFit: string; person: string; role: string; opener: string; fit: SalesFit }>();
  const list = raw && typeof raw === "object" ? (raw as { companies?: unknown }).companies : null;
  if (!Array.isArray(list)) return rows;
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const company = typeof row.company === "string" ? row.company.trim().toLowerCase() : "";
    if (!company) continue;
    const textOf = (key: string, max: number) =>
      withoutContacts(typeof row[key] === "string" ? (row[key] as string) : "").slice(0, max);
    rows.set(company, {
      whatTheyDo: textOf("whatTheyDo", 400),
      whyTheyFit: textOf("whyTheyFit", 400),
      person: textOf("person", 80),
      role: textOf("role", 60),
      opener: textOf("opener", 220),
      fit: row.fit === "strong" || row.fit === "skip" ? row.fit : "maybe",
    });
  }
  return rows;
}

function namedOnPage(name: string, page: SitePage | null): string {
  const clean = name.replace(/\s+/g, " ").trim();
  if (!page || clean.length < 5) return page?.person || "";
  const hay = `${page.text} ${page.person}`.toLowerCase();
  if (hay.includes(clean.toLowerCase())) return clean;
  return page.person || "";
}

export async function assembleAccounts(
  proposals: ProposedCompany[],
  summary: string,
  readSite: (website: string) => Promise<SitePage | null>,
  explain: (prompt: string) => Promise<string>,
  readJson: (text: string) => unknown
): Promise<SalesAccount[]> {
  const pages = await mapPool(proposals, 6, async (item) => ({ item, page: await readSite(item.website) }));
  let explained = new Map<string, { whatTheyDo: string; whyTheyFit: string; person: string; role: string; opener: string; fit: SalesFit }>();
  const prompt = [
    "You are reading short excerpts from public websites for a sales list.",
    "Rewrite whatTheyDo from the excerpt only. One or two sentences.",
    "whyTheyFit is one sentence on why this organisation matches the business report.",
    "person and role only when that exact name is written in the excerpt. Otherwise leave person empty.",
    "opener is one sentence a salesperson could send. Do not include an email, a phone number, or a LinkedIn address.",
    "fit is strong only when the excerpt shows they do the job in the business report. maybe when they are the right kind of organisation but the page does not show that job. skip when they are the wrong kind of organisation.",
    'Return JSON only: {"companies":[{"company":"","whatTheyDo":"","whyTheyFit":"","person":"","role":"","opener":"","fit":"strong"}]}',
    `Business report summary:\n${summary.slice(0, 1800)}`,
    ...pages.map(({ item, page }) =>
      [
        `Company: ${item.company}`,
        `Website: ${item.website}`,
        page ? `Page title: ${page.title}` : "Page title: not read",
        page?.text ? `Excerpt: ${page.text.slice(0, 280)}` : "Excerpt: the public site could not be read",
      ].join("\n")
    ),
  ].join("\n\n");
  try {
    explained = explainedRows(readJson(await explain(prompt)));
  } catch {
    explained = new Map();
  }
  const accounts = pages.map(({ item, page }) => {
    const extra = explained.get(item.company.toLowerCase());
    const fromPage = page ? cleanBlurb(withoutContacts(`${page.title}. ${page.text}`)) : "";
    const described =
      cleanBlurb(extra?.whatTheyDo || "") ||
      fromPage ||
      cleanBlurb(item.whatTheyDo) ||
      (extra?.whatTheyDo || item.whatTheyDo || "").slice(0, 320);
    const fit: SalesFit = !page ? "skip" : extra?.fit ?? "maybe";
    return {
      company: item.company,
      whatTheyDo: described,
      whyTheyFit: extra?.whyTheyFit || item.whyTheyFit,
      website: page?.url || item.website,
      email: page?.email && emailMatchesSite(page.email, page.url) ? page.email : "",
      phone: page?.phone || "",
      linkedin: page?.linkedin || "",
      readFrom: page?.url || "",
      confirmed: Boolean(page),
      person: namedOnPage(extra?.person || "", page),
      role: namedOnPage(extra?.person || "", page) ? extra?.role || page?.role || "" : "",
      opener: extra?.opener || "",
      status: "new" as const,
      fit,
      repNote: "",
    };
  });
  const rank: Record<SalesFit, number> = { strong: 0, maybe: 1, skip: 2 };
  accounts.sort(
    (left, right) =>
      rank[left.fit] - rank[right.fit] ||
      Number(Boolean(right.email)) - Number(Boolean(left.email)) ||
      Number(Boolean(right.person)) - Number(Boolean(left.person))
  );
  return accounts;
}
