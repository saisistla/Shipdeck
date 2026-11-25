import path from "node:path";
import {
  SALES_NOTE,
  businessSummary,
  planSlot,
  salesBlocked,
  salesReady,
  normalizeSalesAccount,
  salesHintsFromReport,
  salesSearchFrom,
  salesSearchLines,
  type IdeaBrief,
  type SalesAccount,
  type SalesQueueItem,
  type SalesSearch,
  type SalesView,
} from "@shipdeck/shared";
import { briefs } from "../brief/index.js";
import { completeModel, extractJsonSafe } from "../delivery/modelClient.js";
import { readyModel } from "../modelPick.js";
import { SalesStore } from "./store.js";
import { SALES_LIST_LIMIT, assembleAccounts, proposedCompanies, readPublicSite, type ProposedCompany } from "./research.js";
import { salesSpreadsheet } from "./sheet.js";

export class SalesError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
  }
}

function planModelName(): string {
  return readyModel("sales")?.name || "Saved model";
}

function planReady() {
  return readyModel("sales");
}

function viewOf(
  brief: IdeaBrief,
  saved?: { accounts: SalesView["accounts"]; modelName: string; updatedAt: string; search?: SalesSearch }
): SalesView {
  const report = brief.report;
  const hints = salesHintsFromReport(report);
  return {
    briefId: brief.id,
    ...(brief.projectId ? { projectId: brief.projectId } : {}),
    title: report?.title || brief.applicationName || "Untitled idea",
    customer: report?.customer || "",
    industry: brief.industry,
    problem: report?.problem || "",
    offer: report?.offer || "",
    summary: businessSummary(brief),
    ready: salesReady(brief),
    blocked: salesBlocked(brief),
    jiraKey: salesReady(brief) ? brief.ticketKey || "" : "",
    modelName: saved?.modelName || planModelName(),
    accounts: (saved?.accounts || []).map((item) => normalizeSalesAccount(item)),
    search: salesSearchFrom(saved?.search, hints.organisation, hints.buyer),
    note: SALES_NOTE,
    updatedAt: saved?.updatedAt || brief.updatedAt,
  };
}

export function createSalesService(root: string) {
  const store = new SalesStore(path.join(root, "sales.json"));

  function requireBrief(id: string): IdeaBrief {
    const brief = briefs.get(id);
    if (!brief) throw new SalesError("Idea not found", 404);
    return brief;
  }

  return {
    queue(projectId?: string): { items: SalesQueueItem[]; modelName: string } {
      const items = briefs.list(projectId).map((brief) => {
        const saved = store.get(brief.id);
        return {
          briefId: brief.id,
          title: brief.report?.title || brief.applicationName || "Untitled idea",
          industry: brief.industry,
          customer: brief.report?.customer || "",
          ready: salesReady(brief),
          blocked: salesBlocked(brief),
          jiraKey: salesReady(brief) ? brief.ticketKey || "" : "",
          accountCount: saved?.accounts.length || 0,
          updatedAt: saved?.updatedAt || brief.updatedAt,
        };
      });
      items.sort((left, right) => Number(right.ready) - Number(left.ready) || (left.updatedAt < right.updatedAt ? 1 : -1));
      return { items, modelName: planModelName() };
    },

    get(briefId: string): SalesView {
      const brief = requireBrief(briefId);
      return viewOf(brief, store.get(briefId));
    },

    async find(briefId: string, mode: "simulate" | "live", searchInput?: Partial<SalesSearch>): Promise<SalesView> {
      const brief = requireBrief(briefId);
      if (!salesReady(brief)) throw new SalesError(salesBlocked(brief) || "Write the business report and create the Jira story first.");
      const hints = salesHintsFromReport(brief.report);
      const search = salesSearchFrom(searchInput, hints.organisation, hints.buyer);
      if (search.country.length < 2) throw new SalesError("Name the country to search in.");
      if (mode !== "live") {
        throw new SalesError("Practice shows the report summary only. Choose Real cloud to read public websites.");
      }
      const ready = planReady();
      if (!ready) {
        throw new SalesError("Add a model under Logins and tick Sales.");
      }
      const summary = businessSummary(brief);
      const proposals = await collectProposals(ready, summary, search);
      if (!proposals.length) {
        throw new SalesError("The plan model did not name public websites that could be read. Try again.");
      }
      const accounts = await assembleAccounts(
        proposals,
        `${summary}\n\n${salesSearchLines(search)}`,
        (website) => readPublicSite(website, search.buyer),
        async (prompt) => {
          const result = await completeModel(ready.slot, ready.key, prompt, 120_000, 4500);
          return result.text;
        },
        extractJsonSafe
      );
      const modelName = planModelName();
      const previous = store.get(brief.id)?.accounts || [];
      const kept = accounts.map((account) => {
        const earlier = previous
          .map((item) => normalizeSalesAccount(item))
          .find((item) => hostOf(item.website) === hostOf(account.website));
        return earlier ? { ...account, status: earlier.status, repNote: earlier.repNote } : account;
      });
      const saved = store.save({
        briefId: brief.id,
        ...(brief.projectId ? { projectId: brief.projectId } : {}),
        summary,
        modelName,
        search,
        accounts: kept,
        updatedAt: new Date().toISOString(),
      });
      return viewOf(brief, saved);
    },

    updateStatus(briefId: string, website: string, status: SalesAccount["status"], repNote?: string): SalesView {
      const brief = requireBrief(briefId);
      const saved = store.get(briefId);
      if (!saved?.accounts.length) throw new SalesError("Search first. Then mark who you are working.");
      const host = hostOf(website);
      let found = false;
      const accounts = saved.accounts.map((item) => {
        const account = normalizeSalesAccount(item);
        if (hostOf(account.website) !== host) return account;
        found = true;
        return { ...account, status, repNote: repNote === undefined ? account.repNote : repNote.slice(0, 400) };
      });
      if (!found) throw new SalesError("That organisation is not on this list.");
      const next = store.save({ ...saved, accounts, updatedAt: new Date().toISOString() });
      return viewOf(brief, next);
    },

    spreadsheet(briefId: string) {
      const brief = requireBrief(briefId);
      const saved = store.get(briefId);
      if (!saved?.accounts.length) throw new SalesError("Search first. The spreadsheet is that list.");
      const current = viewOf(brief, saved);
      return salesSpreadsheet(current);
    },
  };
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

async function collectProposals(
  ready: { key: string; slot: ReturnType<typeof planSlot> },
  summary: string,
  search: SalesSearch
): Promise<ProposedCompany[]> {
  const found: ProposedCompany[] = [];
  const seen = new Set<string>();
  for (let round = 0; round < 2 && found.length < SALES_LIST_LIMIT; round += 1) {
    const avoid = found.map((item) => item.company).join(", ");
    const asked = await completeModel(
      ready.slot,
      ready.key,
      [
        "Find real organisations a salesperson could call this week.",
        "They must be the customer in the business report, not a neighbouring industry.",
        "If the customer is a school, name individual schools. Do not name universities, training companies, publishers, or ministries.",
        "If the customer is a hotel, name individual hotels. Do not name booking websites.",
        "Return JSON only.",
        '{"companies":[{"company":"","website":"https://","whatTheyDo":"","whyTheyFit":""}]}',
        `Name up to ${SALES_LIST_LIMIT} organisations. Spread them through the country or city that was named. Do not stop at the few most famous names.`,
        avoid ? `Do not repeat these organisations: ${avoid}.` : "",
        salesSearchLines(search),
        "website is that organisation’s own public site.",
        "Do not include an email, a phone number, or a LinkedIn address.",
        "Do not invent a website. Omit any organisation whose public site you are not sure of.",
        "Do not list software products unless the customer is a software buyer.",
        `Business report summary:\n${summary}`,
      ]
        .filter(Boolean)
        .join("\n"),
      120_000,
      4500
    );
    let batch: ProposedCompany[] = [];
    try {
      batch = proposedCompanies(extractJsonSafe(asked.text));
    } catch {
      batch = [];
    }
    for (const item of batch) {
      const host = new URL(item.website).hostname.replace(/^www\./, "");
      if (seen.has(host)) continue;
      seen.add(host);
      found.push(item);
      if (found.length >= SALES_LIST_LIMIT) break;
    }
    if (!batch.length) break;
  }
  return found;
}
