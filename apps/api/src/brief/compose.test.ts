import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { industryById } from "@shipdeck/shared";
import { composeReport, composeResearch, jiraStoryFromBrief, practiceReply, ticketFromBrief } from "./compose.js";
import { buildTechnicalDeck } from "./pptx.js";
import { unzipEntries } from "../delivery/documentText.js";
import { createBriefService } from "./service.js";

test("practice report follows the owner's words inside the industry", () => {
  const industry = industryById("construction");
  assert.ok(industry);
  const report = composeReport(industry, "Pour checklist", "The supervisor needs today's names before the pour starts.");
  assert.equal(report.title, "Pour checklist");
  assert.match(report.problem, /supervisor/i);
  assert.equal(report.outOfScope.includes("Drawings"), false);
  const research = composeResearch(industry, report);
  assert.match(research.caveat, /Desk research/);
  assert.match(research.summary, /construction|field reporting/i);
  assert.ok(research.competitors.some((item) => item.name === "Procore"));
  assert.equal(research.pestle.length, 6);
  assert.equal(research.forces.length, 5);
  assert.equal(research.size.length, 3);
  assert.ok(research.demand.every((item) => item.score >= 0 && item.score <= 100));
});

test("slides are a technical plan and leave the market out", () => {
  const bytes = buildTechnicalDeck({
    title: "Gate Register",
    ticketKey: "GATE-1",
    applicationName: "Gate Register",
    industry: "Education",
    architectureMarkdown: `# GATE-1 — Gate Register

## Intent
Teachers mark one child collected at the gate.

## Components
- **Web UI** (html) — the register page
- **HTTP API** (javascript) — reads and writes the list

## APIs

| Method | Path | Purpose |
| --- | --- | --- |
| GET | \`/health\` | Deploy verify |
| POST | \`/api/collected\` | Mark one child collected |

## In scope
- Mark one child collected

## Out of scope
- Live school roll

## Technologies
- node

## Assumptions
- Fixture data only
`,
  });
  const entries = unzipEntries(bytes);
  const joined = [...entries.values()].map((item) => item.toString("utf8")).join("\n");
  assert.ok(entries.has("ppt/presentation.xml"));
  assert.ok(entries.has("ppt/slides/slide1.xml"));
  assert.ok(entries.has("ppt/slides/slide6.xml"));
  assert.equal(entries.has("ppt/slides/slide7.xml"), false);
  assert.match(joined, /GET/);
  assert.match(joined, /\/health/);
  assert.match(joined, /Gate Register/);
  assert.doesNotMatch(joined, /SWOT|Market draft|competitor|Desk research/i);
});

test("an idea stores the industry and the owner's application name", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "shipdeck-brief-"));
  const service = createBriefService(root);
  const created = service.create({ industryId: "hospitality", name: "Pool towel desk", mode: "simulate" });
  assert.equal(created.industry, "Hospitality");
  assert.equal(created.applicationName, "Pool towel desk");
  const chatted = await service.chat(created.id, "Guests need a towel without walking to reception.", "simulate");
  assert.equal(chatted.messages.filter((item) => item.role === "user").length, 1);
  assert.match(
    practiceReply(industryById("hospitality")!, "Pool towel desk", chatted.messages, false),
    /finish|leave out|business report/i
  );
  await assert.rejects(() => service.research(created.id, "simulate"), /business report/);
  const reported = await service.report(created.id, "simulate");
  assert.equal(reported.status, "report");
  const researched = await service.research(created.id, "simulate");
  assert.equal(researched.status, "research");
  const ticket = ticketFromBrief(researched);
  assert.match(ticket.key, /^IDEA-/);
  assert.ok(ticket.acceptance.length > 0);
  const story = jiraStoryFromBrief(researched);
  assert.equal(story.projectName, "Pool towel desk");
  assert.match(story.description, /Acceptance/);
  assert.doesNotMatch(story.description, /market|SWOT|competitor/i);
  const edited = jiraStoryFromBrief({
    ...researched,
    technicalEdited: true,
    technicalMarkdown: "# Pool towel desk\n\n## Page\n- Hand over one towel\n- Leave the booking system out\n",
  });
  assert.equal(edited.saved, true);
  assert.match(edited.description, /Hand over one towel/);
  assert.doesNotMatch(edited.description, /Acceptance/);
  assert.deepEqual(edited.acceptance, ["Hand over one towel", "Leave the booking system out"]);
});
