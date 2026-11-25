/** Idea step in front of Tickets. The list is the industry. The owner names the application. */

export type BriefMode = "simulate" | "live";

export type BriefStatus = "collecting" | "report" | "research" | "sent";

export interface BriefChatMessage {
  role: "user" | "assistant";
  content: string;
  at: string;
}

export interface BriefUpload {
  filename: string;
  excerpt: string;
}

export interface BusinessReport {
  title: string;
  problem: string;
  customer: string;
  offer: string;
  goals: string[];
  inScope: string[];
  outOfScope: string[];
  assumptions: string[];
  markdown: string;
}

export type CompetitorKind = "direct" | "indirect" | "substitute" | "status-quo";

export interface MarketCompetitor {
  name: string;
  /** One line kept for the slides. */
  note: string;
  kind: CompetitorKind;
  offer: string;
  wins: string;
  gap: string;
  price: string;
}

export interface MarketSegment {
  name: string;
  who: string;
  job: string;
  pain: string;
  alternative: string;
  willingness: string;
}

export interface MarketSizeBand {
  name: "TAM" | "SAM" | "SOM";
  definition: string;
  method: string;
  range: string;
  confidence: "low" | "medium" | "high";
}

export interface MarketForce {
  name: string;
  /** 1 is weak pressure, 5 is strong pressure. */
  score: number;
  note: string;
}

export interface MarketPestle {
  name: "Political" | "Economic" | "Social" | "Technological" | "Legal" | "Environmental";
  note: string;
}

export interface MarketPoint {
  name: string;
  /** 0–100 along the horizontal axis. */
  x: number;
  /** 0–100 along the vertical axis. */
  y: number;
}

export interface MarketRisk {
  name: string;
  level: "low" | "medium" | "high";
  note: string;
}

export interface MarketDemand {
  label: string;
  /** Relative signal from 0 to 100. Not a market share. */
  score: number;
}

export interface MarketResearch {
  summary: string;
  definition: {
    category: string;
    geography: string;
    job: string;
    inMarket: string;
    outOfMarket: string;
  };
  segments: MarketSegment[];
  size: MarketSizeBand[];
  drivers: string[];
  barriers: string[];
  competitors: MarketCompetitor[];
  position: {
    xAxis: string;
    yAxis: string;
    points: MarketPoint[];
  };
  swot: {
    strengths: string[];
    weaknesses: string[];
    opportunities: string[];
    threats: string[];
  };
  pestle: MarketPestle[];
  forces: MarketForce[];
  pricing: string;
  packages: string[];
  goToMarket: {
    buyer: string;
    user: string;
    channel: string;
    cycle: string;
  };
  demand: MarketDemand[];
  risks: MarketRisk[];
  validate: string[];
  caveat: string;
}

export interface IndustryOffering {
  id: string;
  name: string;
  /** Who usually feels the problem. The owner still describes the actual application. */
  audience: string;
}

export const INDUSTRY_CATALOG: IndustryOffering[] = [
  { id: "agriculture", name: "Agriculture", audience: "Farm and packhouse teams" },
  { id: "construction", name: "Construction", audience: "Site and project teams" },
  { id: "education", name: "Education", audience: "Schools, colleges, and training teams" },
  { id: "energy", name: "Energy", audience: "Field and control-room teams" },
  { id: "finance", name: "Finance", audience: "Branch and operations teams" },
  { id: "food-service", name: "Food service", audience: "Kitchen and counter teams" },
  { id: "government", name: "Government", audience: "Public service desks" },
  { id: "healthcare", name: "Healthcare", audience: "Clinic and ward teams" },
  { id: "hospitality", name: "Hospitality", audience: "Hotel, venue, and front-of-house teams" },
  { id: "logistics", name: "Logistics", audience: "Warehouse and dispatch teams" },
  { id: "manufacturing", name: "Manufacturing", audience: "Plant and line teams" },
  { id: "professional-services", name: "Professional services", audience: "Firm and front-office teams" },
  { id: "property", name: "Property", audience: "Agency and building teams" },
  { id: "retail", name: "Retail", audience: "Shop and stock teams" },
  { id: "technology", name: "Technology", audience: "Product and operations teams" },
];

export function industryById(id: string): IndustryOffering | undefined {
  return INDUSTRY_CATALOG.find((item) => item.id === id);
}

export interface IdeaBrief {
  id: string;
  projectId?: string;
  /** Industry id from the catalog. Older ideas may still hold a retired application id. */
  applicationId: string;
  industry: string;
  /** The owner's own application. Empty until they name it. */
  applicationName: string;
  mode: BriefMode;
  status: BriefStatus;
  messages: BriefChatMessage[];
  upload?: BriefUpload;
  report?: BusinessReport;
  research?: MarketResearch;
  /** Short technical note. architecture.md and the slides live on the ticket. */
  technicalMarkdown?: string;
  /** True after the owner edits and saves the technical brief. */
  technicalEdited?: boolean;
  /** Brief text last written into a Jira story. */
  jiraStoryMarkdown?: string;
  deliveryRunId?: string;
  ticketKey?: string;
  /** Jira project created with the user story. */
  jiraProjectKey?: string;
  jiraProjectName?: string;
  /** Saved Logins connection the story was written to. */
  jiraConnectionId?: string;
  jiraSiteUrl?: string;
  createdAt: string;
  updatedAt: string;
}
