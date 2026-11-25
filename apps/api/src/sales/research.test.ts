import assert from "node:assert/strict";
import test from "node:test";
import { businessSummary, salesHintsFromReport, salesSearchFrom, salesSearchLines, salesReady, type IdeaBrief } from "@shipdeck/shared";
import {
  SALES_LIST_LIMIT,
  assembleAccounts,
  contactsFromHtml,
  isPrivateAddress,
  cleanBlurb,
  emailMatchesSite,
  personFromHtml,
  proposedCompanies,
  publicWebsite,
  withoutContacts,
} from "./research.js";
import { salesSpreadsheet } from "./sheet.js";

function brief(extra: Partial<IdeaBrief> = {}): IdeaBrief {
  return {
    id: "brief",
    applicationId: "education",
    industry: "Education",
    applicationName: "Gate Register",
    mode: "live",
    status: "sent",
    messages: [],
    report: {
      title: "Gate Register",
      problem: "Two teachers release children at once and the paper list is hard to share.",
      customer: "Primary school office staff",
      offer: "A desk list of today’s class with a collected mark.",
      goals: [],
      inScope: [],
      outOfScope: [],
      assumptions: [],
      markdown: "",
    },
    ticketKey: "GATEREGI-1",
    createdAt: "",
    updatedAt: "",
    ...extra,
  };
}

test("sales opens after the business report and a real Jira story", () => {
  assert.equal(salesReady(brief()), true);
  assert.equal(salesReady(brief({ ticketKey: "IDEA-ABC" })), false);
  assert.equal(salesReady(brief({ ticketKey: "" })), false);
  assert.equal(salesReady(brief({ report: undefined })), false);
});

test("a search keeps more than five organisations", () => {
  const companies = Array.from({ length: 8 }, (_, index) => ({
    company: `School ${index + 1}`,
    website: `https://school${index + 1}.example`,
    whatTheyDo: "A school",
    whyTheyFit: "They collect children",
  }));
  const parsed = proposedCompanies({ companies });
  assert.equal(parsed.length, 8);
  assert.ok(SALES_LIST_LIMIT > 5);
});

test("the spreadsheet contains every organisation on the list", () => {
  const file = salesSpreadsheet({
    title: "Gate Register",
    search: { country: "India", place: "Delhi", organisation: "Schools", note: "" },
    accounts: [
      {
        company: "Example, School",
        whatTheyDo: 'Says "hello"',
        whyTheyFit: "Fits",
        website: "https://school.example",
        email: "office@school.example",
        phone: "+91 11 26858570",
        linkedin: "",
        readFrom: "https://school.example",
        confirmed: true,
        person: "Anita Shah",
        role: "Principal",
        opener: "Your gate list is still on paper.",
        status: "new",
        fit: "strong",
        repNote: "",
      },
    ],
  });
  assert.equal(file.filename, "Gate-Register-sales.csv");
  assert.match(file.csv, /Example, School/);
  assert.match(file.csv, /India/);
  assert.match(file.csv, /office@school.example/);
  assert.match(file.csv, /"Example, School"/);
});

test("who to look for and the person to reach come from the business report", () => {
  const hints = salesHintsFromReport({
    customer: "Schools, colleges, and training teams",
    problem: "Parents at the school gate need a register.",
    offer: "The paper sheet is hard to read when two teachers are releasing children at once.",
    goals: ["Improve communication between teachers and front office at the gate."],
  });
  assert.equal(hints.organisation, "Schools, colleges, and training teams");
  assert.match(hints.buyer, /Front office/);
  assert.match(hints.buyer, /Teacher/);
  assert.doesNotMatch(hints.buyer, /Parent/);
  const search = salesSearchFrom({ country: "India", buyer: "" }, hints.organisation, hints.buyer);
  assert.equal(search.organisation, hints.organisation);
  assert.equal(search.buyer, hints.buyer);
});

test("a search stays inside the country that was named", () => {
  const search = salesSearchFrom(
    { country: " India ", place: "Mumbai", organisation: "", note: "Government schools" },
    "Primary schools"
  );
  assert.equal(search.country, "India");
  assert.equal(search.organisation, "Primary schools");
  const lines = salesSearchLines(search);
  assert.match(lines, /only in India/);
  assert.match(lines, /Mumbai/);
  assert.match(lines, /Government schools/);
  assert.match(lines, /outside that country/);
});

test("the sales input is a short summary of the business report", () => {
  const summary = businessSummary(brief());
  assert.match(summary, /Gate Register/);
  assert.match(summary, /Primary school office staff/);
  assert.match(summary, /Education/);
  assert.doesNotMatch(summary, /architecture/);
});

test("only a public https website is accepted", () => {
  assert.equal(publicWebsite("https://school.example")?.hostname, "school.example");
  assert.equal(publicWebsite("http://school.example")?.protocol, "https:");
  assert.equal(publicWebsite("https://localhost/admin"), null);
  assert.equal(publicWebsite("https://127.0.0.1/"), null);
  assert.equal(publicWebsite("https://169.254.169.254/"), null);
  assert.equal(publicWebsite("https://10.1.1.1/"), null);
  assert.equal(publicWebsite("file:///etc/passwd"), null);
  assert.equal(isPrivateAddress("8.8.8.8"), false);
  assert.equal(isPrivateAddress("192.168.0.5"), true);
});

test("contact details come from the public page, not from the model text", () => {
  const html = `
    <title>Example School</title>
    <a href="mailto:office@school.example">Email</a>
    <a href="mailto:noreply@school.example">No</a>
    <a href="tel:+44 20 7946 0991">Call</a>
    <a href="https://www.linkedin.com/school/example-school">LinkedIn</a>
    <p>office@school.example</p>
  `;
  const contacts = contactsFromHtml(html);
  assert.equal(contacts.email, "office@school.example");
  assert.equal(contacts.phone, "+44 20 7946 0991");
  assert.match(contacts.linkedin, /linkedin.com\/school\/example-school/);
  const cleaned = withoutContacts("Email hidden@school.example and call +44 20 7946 0991. https://www.linkedin.com/school/example-school");
  assert.doesNotMatch(cleaned, /@/);
  assert.doesNotMatch(cleaned, /linkedin/i);
});

test("a model email is ignored, and a page email is kept", async () => {
  const proposals = proposedCompanies({
    companies: [
      {
        company: "Example School",
        website: "https://school.example",
        whatTheyDo: "A primary school. office@school.example",
        whyTheyFit: "Call 020 7946 0991",
        email: "hidden@school.example",
        phone: "02079460991",
        linkedin: "https://www.linkedin.com/school/from-model",
      },
      { company: "Local", website: "http://127.0.0.1" },
    ],
  });
  assert.equal(proposals.length, 1);
  assert.doesNotMatch(proposals[0].whatTheyDo, /@/);
  assert.equal(proposals[0].whyTheyFit.includes("7946"), false);

  const accounts = await assembleAccounts(
    proposals,
    "Customer: primary schools",
    async () => ({
      url: "https://school.example/",
      title: "Example School",
      text: "A primary school in the city. Anita Shah, Principal.",
      email: "office@school.example",
      phone: "+44 20 7946 0991",
      linkedin: "https://www.linkedin.com/school/example-school",
      person: "Anita Shah",
      role: "Principal",
    }),
    async () =>
      JSON.stringify({
        companies: [
          {
            company: "Example School",
            whatTheyDo: "They teach primary children.",
            whyTheyFit: "The office runs the gate list. secret@school.example",
            email: "secret@school.example",
            person: "Invented Person",
            role: "Owner",
            opener: "The paper gate list is hard to share.",
          },
        ],
      }),
    JSON.parse
  );
  assert.equal(accounts[0].email, "office@school.example");
  assert.equal(accounts[0].phone, "+44 20 7946 0991");
  assert.equal(accounts[0].linkedin, "https://www.linkedin.com/school/example-school");
  assert.doesNotMatch(accounts[0].whyTheyFit, /@/);
  assert.equal(accounts[0].confirmed, true);
  assert.equal(accounts[0].person, "Anita Shah");
  assert.equal(accounts[0].opener, "The paper gate list is hard to share.");
});

test("an email from another organisation is dropped, and menu text is not the description", () => {
  assert.equal(emailMatchesSite("office@srmschool.edu.in", "https://srmschool.edu.in/"), true);
  assert.equal(emailMatchesSite("srmpublicschool@sowdambikaa.edu.in", "https://srmschool.edu.in/"), false);
  const blurb = cleanBlurb("Skip to main content Gymkhana Donate. The school lists today's class at the gate and marks each child collected.");
  assert.match(blurb, /today's class/);
  assert.doesNotMatch(blurb, /Gymkhana/);
});

test("a named buyer is taken from the public page", () => {
  const html = "<p>Office team</p><p>Anita Shah, Principal</p><p>Ben Clerk, Coach</p>";
  const named = personFromHtml(html, "Principal");
  assert.equal(named.person, "Anita Shah");
  assert.match(named.role, /Principal/);
});

test("a site that cannot be read has no contact details", async () => {
  const accounts = await assembleAccounts(
    [
      {
        company: "Missing School",
        website: "https://missing.example",
        whatTheyDo: "A school.",
        whyTheyFit: "They collect children at the gate.",
      },
    ],
    "Customer: schools",
    async () => null,
    async () => {
      throw new Error("model down");
    },
    JSON.parse
  );
  assert.equal(accounts[0].confirmed, false);
  assert.equal(accounts[0].email, "");
  assert.equal(accounts[0].phone, "");
  assert.equal(accounts[0].linkedin, "");
  assert.equal(accounts[0].whatTheyDo, "A school.");
});
