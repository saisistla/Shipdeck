import type { BusinessReport, IdeaBrief } from "./brief.js";

export type SalesStatus = "new" | "working" | "replied" | "not a fit";
export type SalesFit = "strong" | "maybe" | "skip";

/** One row a salesperson can work. A person and a contact stay blank until a public page names them. */
export interface SalesAccount {
  company: string;
  whatTheyDo: string;
  whyTheyFit: string;
  website: string;
  email: string;
  phone: string;
  linkedin: string;
  /** Public page that was read. Empty when the site could not be opened. */
  readFrom: string;
  confirmed: boolean;
  person: string;
  role: string;
  /** One sentence the salesperson can send. */
  opener: string;
  status: SalesStatus;
  /** strong when their public page shows the job in the report. skip when they are the wrong kind of organisation. */
  fit: SalesFit;
  repNote: string;
}

/** Where and who the sales search should look for. Country is required before a search. */
export interface SalesSearch {
  country: string;
  place: string;
  organisation: string;
  /** The job title of the person to reach, such as Principal or Owner. */
  buyer: string;
  note: string;
}

export const EMPTY_SALES_SEARCH: SalesSearch = {
  country: "",
  place: "",
  organisation: "",
  buyer: "",
  note: "",
};

const SALES_STATUSES: SalesStatus[] = ["new", "working", "replied", "not a fit"];

export function normalizeSalesAccount(raw: Partial<SalesAccount> | undefined): SalesAccount {
  const status = SALES_STATUSES.includes(raw?.status as SalesStatus) ? (raw?.status as SalesStatus) : "new";
  return {
    company: (raw?.company || "").trim(),
    whatTheyDo: raw?.whatTheyDo || "",
    whyTheyFit: raw?.whyTheyFit || "",
    website: raw?.website || "",
    email: raw?.email || "",
    phone: raw?.phone || "",
    linkedin: raw?.linkedin || "",
    readFrom: raw?.readFrom || "",
    confirmed: Boolean(raw?.confirmed),
    person: raw?.person || "",
    role: raw?.role || "",
    opener: raw?.opener || "",
    status,
    fit: raw?.fit === "strong" || raw?.fit === "skip" ? raw.fit : "maybe",
    repNote: raw?.repNote || "",
  };
}

const STAFF_ROLES: { pattern: RegExp; label: string }[] = [
  { pattern: /front office/i, label: "Front office" },
  { pattern: /head ?teacher/i, label: "Head teacher" },
  { pattern: /teacher/i, label: "Teacher" },
  { pattern: /principal/i, label: "Principal" },
  { pattern: /site supervisor/i, label: "Site supervisor" },
  { pattern: /supervisor/i, label: "Supervisor" },
  { pattern: /receptionist|reception/i, label: "Reception" },
  { pattern: /nurse/i, label: "Nurse" },
  { pattern: /owner/i, label: "Owner" },
  { pattern: /manager/i, label: "Manager" },
  { pattern: /operator/i, label: "Operator" },
];

/** Who to look for, and the person to reach, taken from the business report. */
export function salesHintsFromReport(report: Pick<BusinessReport, "customer" | "problem" | "offer" | "goals"> | undefined): {
  organisation: string;
  buyer: string;
} {
  if (!report) return { organisation: "", buyer: "" };
  const text = [report.problem, report.offer, ...(report.goals || [])].join("\n");
  const found: string[] = [];
  for (const role of STAFF_ROLES) {
    if (role.pattern.test(text) && !found.includes(role.label)) found.push(role.label);
  }
  return {
    organisation: report.customer.replace(/\s+/g, " ").trim(),
    buyer: found.slice(0, 3).join(", "),
  };
}

export function salesSearchFrom(
  input: Partial<SalesSearch> | undefined,
  organisation: string,
  buyer = ""
): SalesSearch {
  const clip = (value: string, max: number) => value.replace(/\s+/g, " ").trim().slice(0, max);
  return {
    country: clip(input?.country || "", 80),
    place: clip(input?.place || "", 80),
    organisation: clip(input?.organisation || organisation, 200),
    buyer: clip(input?.buyer || buyer, 80),
    note: clip(input?.note || "", 300),
  };
}

export function salesSearchLines(search: SalesSearch): string {
  return [
    `Search only in ${search.country}.`,
    search.place ? `Stay inside ${search.place}.` : "",
    search.organisation ? `The organisation to find is ${search.organisation}.` : "",
    search.buyer ? `The person to reach holds this role: ${search.buyer}.` : "Find the person who would buy, when the public site names them.",
    search.note ? `Also match: ${search.note}.` : "",
    "Do not name an organisation outside that country.",
  ]
    .filter(Boolean)
    .join("\n");
}

export interface SalesView {
  briefId: string;
  projectId?: string;
  title: string;
  customer: string;
  industry: string;
  problem: string;
  offer: string;
  summary: string;
  ready: boolean;
  blocked: string;
  jiraKey: string;
  modelName: string;
  accounts: SalesAccount[];
  search: SalesSearch;
  note: string;
  updatedAt: string;
}

export interface SalesQueueItem {
  briefId: string;
  title: string;
  industry: string;
  customer: string;
  ready: boolean;
  blocked: string;
  jiraKey: string;
  accountCount: number;
  updatedAt: string;
}

export const SALES_NOTE =
  "A person, email, phone, or LinkedIn is filled only when that organisation’s own public website prints it. A blank cell was not published there.";

export function jiraRaised(brief: Pick<IdeaBrief, "ticketKey">): boolean {
  const key = (brief.ticketKey || "").trim();
  return Boolean(key) && !key.startsWith("IDEA-");
}

export function salesReady(brief: Pick<IdeaBrief, "ticketKey" | "report">): boolean {
  const report = brief.report;
  return Boolean(report?.customer?.trim() && report.problem?.trim() && report.offer?.trim()) && jiraRaised(brief);
}

function clip(value: string, max: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trim()}…`;
}

/** Short input for Sales. It is the business report, not the market file or the technical brief. */
export function businessSummary(brief: Pick<IdeaBrief, "industry" | "applicationName" | "report">): string {
  const report = brief.report;
  if (!report) return "";
  return [
    clip(report.title || brief.applicationName, 160),
    `Customer: ${clip(report.customer, 400)}`,
    `Industry: ${clip(brief.industry, 120)}`,
    clip(report.problem, 500),
    clip(report.offer, 500),
  ]
    .filter(Boolean)
    .join("\n");
}

export function salesBlocked(brief: Pick<IdeaBrief, "ticketKey" | "report">): string {
  if (!brief.report?.customer?.trim()) return "Write the business report first.";
  if (!jiraRaised(brief)) return "Create the Jira story first. Sales opens after that.";
  return "";
}
