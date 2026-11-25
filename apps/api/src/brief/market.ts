import type {
  BusinessReport,
  CompetitorKind,
  IndustryOffering,
  MarketCompetitor,
  MarketResearch,
} from "@shipdeck/shared";

interface Playbook {
  category: string;
  job: string;
  competitors: Array<Omit<MarketCompetitor, "note">>;
}

const STATUS_QUO: Omit<MarketCompetitor, "note"> = {
  name: "Paper, spreadsheet, or chat",
  kind: "status-quo",
  offer: "The list the team already keeps.",
  wins: "Free, already in the room, no login.",
  gap: "It does not stay current for the whole team, and it disappears when the shift ends.",
  price: "No fee. The cost is lost time and missed work.",
};

const BOOKS: Record<string, Playbook> = {
  construction: {
    category: "Field reporting for construction",
    job: "Record who is on site and what slipped, the same day.",
    competitors: [
      { name: "Raken", kind: "direct", offer: "Daily reports, time cards, and photos for the field.", wins: "Teams that want the diary without a full project suite.", gap: "Broader than a single page. Confirm the current modules before you claim a gap.", price: "Public packaging is per user. Confirm the current list price." },
      { name: "Fieldwire", kind: "direct", offer: "Plans, tasks, and field issues on the phone.", wins: "Crews who live in the drawings.", gap: "The daily log is one feature beside plans, not the whole product.", price: "Per user, with a free tier that is limited. Confirm the current price." },
      { name: "Procore", kind: "indirect", offer: "A project suite: cost, drawings, quality, and daily logs.", wins: "General contractors who already run the job there.", gap: "A supervisor will not leave Procore for a log alone. You win where Procore was never bought.", price: "A platform contract, not a seat you expense on a card." },
      { name: "Autodesk Construction Cloud", kind: "indirect", offer: "Drawings, models, and field reports on Autodesk projects.", wins: "Firms already in Revit or BIM 360.", gap: "Same pattern as Procore: the log is a module inside a suite.", price: "Platform contract. Confirm the current packaging." },
    ],
  },
  healthcare: {
    category: "Clinic operations",
    job: "See today's list and mark the next step without opening the full record.",
    competitors: [
      { name: "Cliniko", kind: "direct", offer: "Appointments, notes, and billing for independent clinics.", wins: "Small clinics that want one system.", gap: "Heavier than a front-desk page. Billing and notes are the product.", price: "Per practitioner, monthly. Confirm the current list price." },
      { name: "Jane App", kind: "direct", offer: "Scheduling and charting for allied health.", wins: "Practices that book online.", gap: "The desk list is inside scheduling, not a standalone page.", price: "Monthly, tiered. Confirm the current price." },
      { name: "Epic", kind: "indirect", offer: "The health-system record: clinical, billing, and scheduling.", wins: "Hospitals that have already standardised on it.", gap: "A desk will not replace Epic. You only fit where Epic was never in scope.", price: "Enterprise contract." },
      { name: "Oracle Health", kind: "indirect", offer: "The former Cerner health-system record.", wins: "Systems already contracted there.", gap: "Same limit as Epic. Out of reach for a one-page desk.", price: "Enterprise contract." },
    ],
  },
  hospitality: {
    category: "Guest arrival and booking",
    job: "See who is due today and mark them served.",
    competitors: [
      { name: "OpenTable", kind: "direct", offer: "Reservations, floor, and guest notes for restaurants.", wins: "Rooms that already take bookings from the public.", gap: "Discovery and deposits, not only the day's list.", price: "Per cover or a monthly plan. Confirm the current price." },
      { name: "SevenRooms", kind: "direct", offer: "Reservations plus guest marketing for groups.", wins: "Hotel and restaurant groups.", gap: "A marketing suite around the book.", price: "Quote-led. Confirm with a current proposal." },
      { name: "Resy", kind: "indirect", offer: "Consumer booking into the restaurant's book.", wins: "Cities where guests already search Resy.", gap: "You do not own the guest. The channel does.", price: "A booking fee. Confirm the current schedule." },
      { name: "The reservation book", kind: "status-quo", offer: "A paper or simple book at the stand.", wins: "One host, one door, no outage.", gap: "The office cannot see the same book.", price: "No fee." },
    ],
  },
  education: {
    category: "Attendance and class operations",
    job: "Mark who is present today without opening grades or fees.",
    competitors: [
      { name: "PowerSchool", kind: "indirect", offer: "Student information: attendance, grades, and fees.", wins: "Districts that already standardised on it.", gap: "Attendance is one screen inside a district system.", price: "District contract." },
      { name: "Infinite Campus", kind: "indirect", offer: "Another full student-information system.", wins: "Districts already contracted.", gap: "Same pattern. A teacher will not switch the district system for a register.", price: "District contract." },
      { name: "Google Classroom", kind: "substitute", offer: "Classwork and a roster, not a formal register.", wins: "Teachers who already assign work there.", gap: "It does not produce the attendance record the office expects.", price: "Often already paid for with Google Workspace." },
      STATUS_QUO,
    ],
  },
  logistics: {
    category: "Dispatch and delivery status",
    job: "See today's runs and mark one as out.",
    competitors: [
      { name: "Samsara", kind: "indirect", offer: "Fleet telematics, cameras, and dispatch.", wins: "Operators who need the truck, not only the board.", gap: "The status board is a slice of a fleet product.", price: "Per vehicle. Confirm the current price." },
      { name: "Descartes", kind: "indirect", offer: "Routing and transport management.", wins: "Networks that already plan routes there.", gap: "Routing math, not a shift board.", price: "Enterprise contract." },
      { name: "project44", kind: "indirect", offer: "Visibility across carriers.", wins: "Shippers who need where the freight is.", gap: "A ping is not the dispatcher's morning board.", price: "Enterprise contract." },
      { name: "The whiteboard", kind: "status-quo", offer: "Today's runs written where the room can see them.", wins: "One depot, one shift.", gap: "Gone when the shift ends.", price: "No fee." },
    ],
  },
  retail: {
    category: "Stock hold and shop operations",
    job: "Hold a known item for an order and release it.",
    competitors: [
      { name: "Shopify", kind: "indirect", offer: "Storefront, checkout, and inventory.", wins: "Shops that sell online there.", gap: "A reservation desk is one inventory action, not a storefront.", price: "Monthly plan plus payment fees. Confirm the current plan." },
      { name: "Lightspeed", kind: "indirect", offer: "Point of sale and inventory for retailers.", wins: "Stores already on that till.", gap: "The hold lives inside the till.", price: "Monthly, plus payments. Confirm the current price." },
      { name: "Square", kind: "substitute", offer: "Payments and a simple item list.", wins: "Very small shops.", gap: "Weak once two people can sell the last unit.", price: "Free software, payment fees. Confirm the current schedule." },
      STATUS_QUO,
    ],
  },
  "food-service": {
    category: "Counter and order status",
    job: "See open orders and mark one ready.",
    competitors: [
      { name: "Toast", kind: "indirect", offer: "A restaurant till, kitchen tickets, and payments.", wins: "Rooms that run service on Toast.", gap: "You are not the till. You sit beside it.", price: "Hardware plus a monthly plan. Confirm the current price." },
      { name: "Square for Restaurants", kind: "indirect", offer: "Orders and payments.", wins: "Smaller rooms already taking cards there.", gap: "The ready-mark is inside the till.", price: "Software plus payment fees. Confirm the current price." },
      { name: "Lightspeed Restaurant", kind: "indirect", offer: "Point of sale for hospitality.", wins: "Groups already on Lightspeed.", gap: "Same limit: a status page does not replace the till.", price: "Monthly. Confirm the current price." },
      { name: "Paper tickets", kind: "status-quo", offer: "Tickets on the pass.", wins: "Visible, fast, no outage.", gap: "Easy to drop, and the counter cannot share one view.", price: "No fee." },
    ],
  },
  property: {
    category: "Agency diary",
    job: "See today's viewings and mark one done.",
    competitors: [
      { name: "Reapit", kind: "indirect", offer: "Agency desktop: listings, applicants, and diary.", wins: "UK-style agencies already on it.", gap: "The diary is one screen in the agency system.", price: "Per office or per user. Confirm the current price." },
      { name: "Alto", kind: "indirect", offer: "Another agency desktop.", wins: "Agencies already contracted.", gap: "Same pattern as Reapit.", price: "Subscription. Confirm the current price." },
      { name: "Salesforce", kind: "indirect", offer: "A CRM an agency has configured for listings.", wins: "Groups with an admin who maintains it.", gap: "Empty until someone builds the viewing object.", price: "Per user, plus the build." },
      { name: "The agent diary", kind: "status-quo", offer: "A personal calendar.", wins: "One agent.", gap: "The office cannot see it live.", price: "No fee." },
    ],
  },
  "professional-services": {
    category: "Client arrival",
    job: "See today's meetings and mark a client checked in.",
    competitors: [
      { name: "Clio", kind: "indirect", offer: "Practice management for law firms.", wins: "Firms that bill and store matters there.", gap: "Check-in is not why they bought it.", price: "Per user, monthly. Confirm the current price." },
      { name: "PracticePanther", kind: "indirect", offer: "Matters, time, and billing.", wins: "Small firms on that stack.", gap: "Same limit.", price: "Per user. Confirm the current price." },
      { name: "A shared calendar", kind: "substitute", offer: "The meeting, not the arrival.", wins: "Already on every desk.", gap: "It does not say the client is in reception.", price: "Usually already paid for." },
      STATUS_QUO,
    ],
  },
  manufacturing: {
    category: "Shop-floor status",
    job: "See today's jobs and mark one started.",
    competitors: [
      { name: "Plex", kind: "indirect", offer: "Manufacturing operations, quality, and inventory.", wins: "Plants already on a manufacturing cloud.", gap: "The job list is one screen in the plant system.", price: "Enterprise contract." },
      { name: "SAP", kind: "indirect", offer: "The plant's system of record.", wins: "Groups that already run SAP.", gap: "A supervisor will not leave SAP for a start-of-shift list.", price: "Enterprise contract." },
      { name: "Microsoft Dynamics 365", kind: "indirect", offer: "Operations and supply chain.", wins: "Firms already in that suite.", gap: "Same pattern.", price: "Per user plus the implementation." },
      STATUS_QUO,
    ],
  },
  finance: {
    category: "Branch operations",
    job: "See today's desk work and mark one item handled.",
    competitors: [
      { name: "The core banking suite", kind: "indirect", offer: "Accounts, payments, and the branch desktop.", wins: "Banks that already standardised on it.", gap: "A desk page does not replace the core.", price: "Enterprise contract." },
      { name: "Temenos", kind: "indirect", offer: "A core banking platform.", wins: "Banks contracted there.", gap: "Out of scope for a single desk list.", price: "Enterprise contract." },
      { name: "Finastra", kind: "indirect", offer: "Core and lending systems.", wins: "Banks contracted there.", gap: "Same limit.", price: "Enterprise contract." },
      STATUS_QUO,
    ],
  },
  agriculture: {
    category: "Farm operations",
    job: "Record today's work on the farm without a full farm-management suite.",
    competitors: [
      { name: "Granular", kind: "indirect", offer: "Farm management, fields, and profitability.", wins: "Growers who already plan the season there.", gap: "The daily note is one screen.", price: "Subscription. Confirm the current price." },
      { name: "Conservis", kind: "indirect", offer: "Farm accounting and operations.", wins: "Operations already on it.", gap: "Accounting depth, not a single daily page.", price: "Subscription. Confirm the current price." },
      { name: "Climate FieldView", kind: "substitute", offer: "Field data and imagery.", wins: "Growers who want the agronomy, not the desk list.", gap: "It does not replace the morning work list.", price: "Subscription. Confirm the current price." },
      STATUS_QUO,
    ],
  },
  energy: {
    category: "Field maintenance",
    job: "See today's jobs and mark one started.",
    competitors: [
      { name: "IBM Maximo", kind: "indirect", offer: "Asset and work management.", wins: "Utilities already running it.", gap: "The job list is one screen in the asset system.", price: "Enterprise contract." },
      { name: "SAP Plant Maintenance", kind: "indirect", offer: "Work orders on the SAP asset.", wins: "Groups already on SAP.", gap: "Same limit.", price: "Enterprise contract." },
      { name: "A field-service app", kind: "direct", offer: "Work orders on a phone.", wins: "Crews who need offline jobs.", gap: "Confirm which product the buyer already has before you name a gap.", price: "Per user. Confirm the current price." },
      STATUS_QUO,
    ],
  },
  government: {
    category: "Public service desk",
    job: "See today's cases and mark one handled.",
    competitors: [
      { name: "ServiceNow", kind: "indirect", offer: "Cases, workflows, and portals.", wins: "Agencies already standardised on it.", gap: "A desk list is one queue inside the platform.", price: "Enterprise contract." },
      { name: "Microsoft Dynamics", kind: "indirect", offer: "Case management on the Microsoft stack.", wins: "Offices already licensed.", gap: "Same pattern.", price: "Per user plus the build." },
      { name: "A shared mailbox", kind: "status-quo", offer: "Cases as email.", wins: "No procurement.", gap: "Easy to miss, and no shared status.", price: "No extra fee." },
      STATUS_QUO,
    ],
  },
  technology: {
    category: "Internal operations",
    job: "See today's work and mark one item moved.",
    competitors: [
      { name: "Jira", kind: "indirect", offer: "Issues, boards, and workflow.", wins: "Teams that already track work there.", gap: "A simple desk page loses to Jira if the buyer is a software team.", price: "Per user. Confirm the current plan." },
      { name: "Linear", kind: "indirect", offer: "A faster issue tracker.", wins: "Product teams who rejected Jira.", gap: "Same limit: they already have a board.", price: "Per user. Confirm the current price." },
      { name: "Notion", kind: "substitute", offer: "A page the team edits.", wins: "Small teams.", gap: "No real status, and no health check for a later deploy.", price: "Per user. Confirm the current price." },
      STATUS_QUO,
    ],
  },
};

function withNotes(rows: Array<Omit<MarketCompetitor, "note">>): MarketCompetitor[] {
  return rows.map((row) => ({
    ...row,
    note: `${labelKind(row.kind)}. ${row.gap}`,
  }));
}

function labelKind(kind: CompetitorKind): string {
  if (kind === "status-quo") return "What they use today";
  if (kind === "direct") return "Direct";
  if (kind === "indirect") return "Suite they may already pay for";
  return "Substitute";
}

function clipLine(value: string, max = 220): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length <= max ? text : `${text.slice(0, max - 1).trim()}…`;
}

export function buildMarketResearch(industry: IndustryOffering, report: BusinessReport): MarketResearch {
  const book = BOOKS[industry.id] ?? {
    category: `${industry.name} operations`,
    job: report.offer || report.title,
    competitors: [
      { name: "The industry suite", kind: "indirect" as const, offer: "The system this industry already buys.", wins: "Teams already contracted.", gap: "A single page does not replace it.", price: "Confirm the current contract." },
      { name: "A specialist tool", kind: "direct" as const, offer: "A product aimed at this one job.", wins: "Teams who refused the suite.", gap: "Name the actual product in an interview before you claim a difference.", price: "Confirm the current price." },
      STATUS_QUO,
    ],
  };
  const competitors = withNotes([...book.competitors, STATUS_QUO].filter((row, index, all) => all.findIndex((item) => item.name === row.name) === index).slice(0, 5));
  const job = clipLine(report.inScope[0] || book.job, 160);
  const title = report.title || industry.name;
  const direct = competitors.find((item) => item.kind === "direct") ?? competitors[0];
  const suite = competitors.find((item) => item.kind === "indirect") ?? competitors[0];
  return {
    summary: `${title} sits in ${book.category.toLowerCase()}, for ${report.customer.toLowerCase()}. The buyer already has a way to do this job. The read below is the desk-research pass a market researcher starts with: definition, segments, size method, demand, named competitors, position, SWOT, PESTLE, five forces, price, and the questions still to ask. It is not a set of interviews.`,
    definition: {
      category: book.category,
      geography: "Not chosen yet. Size is meaningless until you name the country or city you will sell into.",
      job: book.job,
      inMarket: `Teams whose daily job is: ${job}`,
      outOfMarket: report.outOfScope[0]
        ? `Buyers who need ${report.outOfScope[0].toLowerCase()} in the first contract. That is a different product.`
        : "Buyers who need the full industry suite in the first contract.",
    },
    segments: [
      {
        name: "The user",
        who: report.customer,
        job,
        pain: report.problem,
        alternative: "The list, book, or chat they use this morning.",
        willingness: "They feel the pain. They rarely hold the budget.",
      },
      {
        name: "The buyer",
        who: `The person who already pays for tools in ${industry.name.toLowerCase()}.`,
        job: "Reduce missed work without adding a second system of record.",
        pain: "Another login that staff ignore.",
        alternative: suite.name,
        willingness: "Pays if the page is used for a week. Will not rip out the suite for it.",
      },
      {
        name: "The ignore",
        who: "Organisations already deep in a suite that covers this screen.",
        job: "Stay on the system they standardised.",
        pain: "None they will admit for this one page.",
        alternative: suite.name,
        willingness: "Low. Do not spend the first year here.",
      },
    ],
    size: [
      {
        name: "TAM",
        definition: `Every organisation in the chosen geography whose people do this job in ${industry.name.toLowerCase()}.`,
        method: "Top-down only after you pick the geography. Count establishments from a public business census, then keep those that do this job.",
        range: "Not stated. A number here would be invented.",
        confidence: "low",
      },
      {
        name: "SAM",
        definition: "The slice that does not already run this job inside a suite, and would buy a single page.",
        method: `Bottom-up shape: sites × people on the page × price × the share not already on ${suite.name}. Replace each term with a counted figure.`,
        range: "Formula only, until the four terms are counted.",
        confidence: "low",
      },
      {
        name: "SOM",
        definition: "What you can reach in twelve months through one channel.",
        method: "Pipeline math: conversations per week × close rate × price. Start from a pilot list, not from the TAM.",
        range: "A pilot of 10 to 30 teams is a honest first year. Not a forecast.",
        confidence: "low",
      },
    ],
    drivers: [
      `The job is daily: ${job}`,
      "The current list fails when two people need it at once.",
      "Suites are bought for something else, so this screen stays clumsy.",
    ],
    barriers: [
      `${suite.name} may already be the system of record.`,
      "Staff abandon a page that is slower than paper.",
      report.outOfScope[0] ? `Buyers will ask for ${report.outOfScope[0].toLowerCase()} before they sign.` : "Buyers will ask for the rest of the suite.",
    ],
    competitors,
    position: {
      xAxis: "How much of the industry suite it covers",
      yAxis: "How well it does this one job",
      points: [
        { name: title, x: 16, y: 86 },
        { name: direct.name, x: 48, y: 74 },
        { name: suite.name, x: 88, y: 42 },
        { name: "Paper or chat", x: 8, y: 36 },
      ],
    },
    swot: {
      strengths: [
        `Narrow on purpose: ${job}`,
        "A buyer can see the page before they approve a build.",
        "Sample data keeps the first version off live records.",
      ],
      weaknesses: [
        `It loses a bake-off against ${suite.name} if the buyer wants the suite.`,
        "No interviews sit behind the size bands.",
        report.outOfScope[0] ? `${report.outOfScope[0]} is out, and some buyers will stop there.` : "Scope is tight.",
      ],
      opportunities: [
        `Teams still on paper or chat, who were never going to buy ${suite.name}.`,
        `A one-week pilot beside ${direct.name}, judged only on whether the page is opened.`,
      ],
      threats: [
        `${direct.name} can ship this screen if it is not already there.`,
        `${suite.name} can make the existing screen good enough that a second tool looks careless.`,
      ],
    },
    pestle: [
      { name: "Political", note: `Public-sector and regulated buyers in ${industry.name.toLowerCase()} procure slowly. A private team can pilot faster.` },
      { name: "Economic", note: "A single page is an extra line on a budget that may already pay for a suite. It sells when the suite was never bought." },
      { name: "Social", note: "The user adopts what is faster than the list they have. A slower page is refused in the first week." },
      { name: "Technological", note: "Version one is a browser page with sample records. Offline work, and a live system of record, are later decisions." },
      { name: "Legal", note: "Live customer, patient, student, or employee records change the product. Version one should stay on sample data until that decision is explicit." },
      { name: "Environmental", note: "No material environmental claim. Do not invent one for the deck." },
    ],
    forces: [
      { name: "Rivalry", score: 4, note: `${direct.name} and ${suite.name} already cover this job for someone.` },
      { name: "New entrants", score: 3, note: "A single page is easy to copy. Distribution is the hard part." },
      { name: "Substitutes", score: 4, note: "Paper, a spreadsheet, and a chat thread are free and already open." },
      { name: "Buyer power", score: 3, note: "A small team can say yes in a week. A standardised firm can say no in a sentence." },
      { name: "Supplier power", score: 2, note: "You are not dependent on a scarce supplier to ship the first page." },
    ],
    pricing: `Do not print a price as if it were researched. ${direct.name} is the price anchor: match a per-user tool, not a platform contract. Ask three buyers what they pay today before a number goes on a slide.`,
    packages: [
      "Pilot: one team, sample data, one week, no fee or a token fee.",
      "Desk: the page you described, priced per site or per user after the pilot.",
      "Not offered: the suite features you listed as out of version one.",
    ],
    goToMarket: {
      buyer: `The operator who pays for tools in ${industry.name.toLowerCase()}, and who does not already run this job in ${suite.name}.`,
      user: report.customer,
      channel: "A direct pilot. Not a marketplace, until ten teams have used the page.",
      cycle: "One conversation, one week of use, then a yes or no. Longer only if procurement is required.",
    },
    demand: [
      { label: "Daily job is painful", score: 78 },
      { label: "Would switch off paper", score: 64 },
      { label: "Would leave the suite", score: 22 },
    ],
    risks: [
      { name: "Suite already bought", level: "high", note: `${suite.name} makes a second tool look like clutter.` },
      { name: "Invented market size", level: "high", note: "A single revenue number on this page would be false. The bands stay qualitative until counted." },
      { name: "Scope ask", level: "medium", note: report.outOfScope[0] ? `Expect a request for ${report.outOfScope[0].toLowerCase()}.` : "Expect a request for the rest of the suite." },
    ],
    validate: [
      `Name the country. Then count establishments that do this job and do not already use ${suite.name}.`,
      `Watch five ${report.customer.toLowerCase()} do the job on paper. Time it.`,
      `Ask three buyers for the invoice they pay to ${direct.name} or the suite.`,
      "Run a one-week pilot. The only success measure is whether the page is opened every day.",
    ],
    caveat:
      "Desk research. Named products are the public category, not a scraped local survey. Size bands are methods, not measured markets. Confidence stays low until the validation list is done.",
  };
}
