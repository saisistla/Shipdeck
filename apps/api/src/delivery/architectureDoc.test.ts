import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultDeliveryPolicy } from "@shipdeck/shared";
import {
  ARCHITECTURE_FILE,
  IMPACT_ANALYSIS_FILE,
  buildArchitectureDoc,
  buildImpactAnalysisDoc,
  hydrateArchitectureRun,
  plannedApis,
} from "./architectureDoc.js";
import { estimateFromArchitecture } from "./planner.js";
import { readUsage } from "./modelClient.js";

describe("architectureDoc", () => {
  it("writes mermaid charts, APIs, and health into architecture.md", () => {
    const markdown = buildArchitectureDoc({
      ticket: {
        key: "SCRUM-1",
        summary: "Build a clinic front-desk appointment app",
        description: "Staff should see today’s appointments, book a slot, and cancel a booking.",
        acceptance: [
          "Staff can see today’s appointments",
          "Staff can book an appointment for a patient",
          "Staff can cancel an appointment",
        ],
        comments: [],
        attachments: [],
      },
      policy: defaultDeliveryPolicy(),
      components: [{ name: "Booking API", responsibility: "Book and cancel slots", language: "node" }],
      technologies: ["node", "HTTP"],
      assumptions: ["Fixture data only"],
      revisionNotes: ["Staff only, no login."],
    });
    assert.match(markdown, /```mermaid/);
    assert.match(markdown, /GET \/health/);
    assert.match(markdown, /Staff can book an appointment/);
    assert.match(markdown, /Staff only, no login/);
    assert.equal(ARCHITECTURE_FILE, "architecture.md");
    assert.doesNotMatch(markdown, /impact-analysis\.md/);
    const apis = plannedApis({
      key: "SCRUM-1",
      summary: "clinic",
      description: "",
      acceptance: ["Staff can book an appointment", "Staff can cancel an appointment"],
      comments: [],
      attachments: [],
    });
    assert.ok(apis.some((item) => item.method === "POST"));
    assert.ok(apis.some((item) => item.method === "DELETE"));
  });

  it("rebuilds an old prose architecture into mermaid charts", () => {
    const run = {
      needsClarification: false,
      ticket: {
        key: "SCRUM-1",
        summary: "Clinic front desk",
        description: "Staff book and cancel appointments.",
        acceptance: ["Staff can book an appointment", "Staff can cancel an appointment"],
        comments: [],
        attachments: [],
      },
      architecture: {
        markdown: "The application will be a single-page web app served from a Node.js backend.",
        technologies: ["node"],
        components: [{ name: "Backend API", responsibility: "Appointments", language: "node" }],
        assumptions: ["Fixture data only"],
        revision: 1,
      },
      revisionNotes: ["Staff only, no login."],
    };
    const changed = hydrateArchitectureRun(run as never, defaultDeliveryPolicy());
    assert.equal(changed, true);
    assert.match(run.architecture.markdown, /```mermaid/);
    assert.match(run.architecture.markdown, /GET \/health/);
    assert.match(run.architecture.markdown, /Staff only, no login/);
  });

  it("writes an impact analysis for an existing repository", () => {
    const ticket = {
      key: "SHIP-1042",
      summary: "Reserve stock when an order is placed",
      description: "Warehouse staff need a small app to reserve stock for an order.",
      acceptance: ["Reserve stock for a known SKU", "Show the reservation status to the desk"],
      comments: [],
      attachments: [],
    };
    const doc = buildImpactAnalysisDoc({
      ticket,
      policy: defaultDeliveryPolicy(),
      repoUrl: "https://github.com/acme/clinic-desk.git",
      components: [{ name: "Stock API", responsibility: "Reserve SKUs", language: "node" }],
      technologies: ["node", "HTTP"],
      revisionNotes: [],
      existingArchitecture: `# Clinic desk\n\n| GET | \`/api/appointments\` | List today |\n\nSee \`src/app.js\` and \`public/index.html\`.`,
    });
    assert.equal(IMPACT_ANALYSIS_FILE, "impact-analysis.md");
    assert.match(doc, /Impact analysis — SHIP-1042/);
    assert.match(doc, /clinic-desk/);
    assert.match(doc, /What we read/);
    assert.match(doc, /src\/app\.js/);
    assert.match(doc, /public\/index\.html/);
    assert.match(doc, /What will not change/);
    assert.match(doc, /Blast radius/);
    assert.match(doc, /```mermaid/);
    const planned = buildArchitectureDoc({
      ticket,
      policy: defaultDeliveryPolicy(),
      components: [{ name: "Stock API", responsibility: "Reserve SKUs", language: "node" }],
      technologies: ["node"],
      assumptions: [],
      revisionNotes: [],
      impactPointer: true,
    });
    assert.match(planned, /## Impact analysis/);
    assert.match(planned, /impact-analysis\.md/);
  });

  it("forecasts implementation from architecture.md APIs and charts", () => {
    const markdown = buildArchitectureDoc({
      ticket: {
        key: "SCRUM-1",
        summary: "Clinic front desk",
        description: "Staff book and cancel appointments.",
        acceptance: ["Staff can book an appointment", "Staff can cancel an appointment"],
        comments: [],
        attachments: [],
      },
      policy: defaultDeliveryPolicy(),
      components: [{ name: "Booking API", responsibility: "Book slots", language: "node" }],
      technologies: ["node"],
      assumptions: [],
      revisionNotes: [],
    });
    const estimate = estimateFromArchitecture({
      ticket: {
        key: "SCRUM-1",
        summary: "Clinic front desk",
        description: "Staff book and cancel appointments.",
        acceptance: ["Staff can book an appointment", "Staff can cancel an appointment"],
        comments: [],
        attachments: [],
      },
      policy: defaultDeliveryPolicy(),
      architecture: { markdown, components: [{ name: "Booking API", responsibility: "Book slots", language: "node" }] },
    });
    assert.ok(estimate.totalTokens > 4000);
    assert.match(estimate.assumptions[0] ?? "", /implement architecture\.md/);
    assert.match(estimate.assumptions[0] ?? "", /APIs/);
    assert.match(estimate.assumptions[0] ?? "", /charts/);
  });

  it("adds Jira attachments to architecture.md and keeps them off tickets with none", () => {
    const withFiles = buildArchitectureDoc({
      ticket: {
        key: "SCRUM-2",
        summary: "Add surname",
        description: "Add the patient surname on the existing front-desk list.",
        acceptance: ["Show surname"],
        comments: ["Ada: see the screenshot"],
        relevantComments: ["Ada: see the screenshot"],
        attachments: [
          {
            filename: "desk.png",
            mimeType: "image/png",
            kind: "image",
            storedName: "desk.png",
            relevant: true,
            relevanceReason: "Current front-desk page",
          },
        ],
      },
      policy: defaultDeliveryPolicy(),
      components: [{ name: "Desk UI", responsibility: "List", language: "node" }],
      technologies: ["node"],
      assumptions: [],
      revisionNotes: [],
    });
    assert.match(withFiles, /Ticket attachments/);
    assert.match(withFiles, /desk\.png/);
    assert.match(withFiles, /ticket-attachments\/desk\.png/);
    assert.match(withFiles, /Ada: see the screenshot/);
    const without = buildArchitectureDoc({
      ticket: {
        key: "SCRUM-1",
        summary: "Clinic front desk",
        description: "Staff book and cancel appointments.",
        acceptance: ["Staff can book an appointment"],
        comments: [],
        attachments: [],
      },
      policy: defaultDeliveryPolicy(),
      components: [{ name: "Booking API", responsibility: "Book slots", language: "node" }],
      technologies: ["node"],
      assumptions: [],
      revisionNotes: [],
    });
    assert.doesNotMatch(without, /Ticket attachments/);
    assert.doesNotMatch(without, /Ticket comments/);
    const ignored = buildArchitectureDoc({
      ticket: {
        key: "SCRUM-2",
        summary: "Add surname",
        description: "Add the patient surname on the existing front-desk list.",
        acceptance: ["Show surname"],
        comments: ["QA: pipeline failed"],
        relevantComments: [],
        attachments: [
          { filename: "pipeline-fail.png", kind: "image", storedName: "pipeline-fail.png", relevant: false },
        ],
      },
      policy: defaultDeliveryPolicy(),
      components: [{ name: "Desk UI", responsibility: "List", language: "node" }],
      technologies: ["node"],
      assumptions: [],
      revisionNotes: [],
    });
    assert.doesNotMatch(ignored, /pipeline-fail/);
    assert.doesNotMatch(ignored, /Ticket attachments/);
  });

  it("reads vendor token usage from Azure and Anthropic bodies", () => {
    assert.deepEqual(
      readUsage({ usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } }),
      { inputTokens: 100, outputTokens: 50, totalTokens: 150 }
    );
    assert.deepEqual(
      readUsage({ usage: { input_tokens: 80, output_tokens: 20 } }),
      { inputTokens: 80, outputTokens: 20, totalTokens: 100 }
    );
    assert.deepEqual(
      readUsage({ totalUsage: { inputTokens: 200, outputTokens: 50, totalTokens: 250 } }),
      { inputTokens: 200, outputTokens: 50, totalTokens: 250 }
    );
    assert.deepEqual(readUsage({ usage: { inputTokens: 40, outputTokens: 10 } }), {
      inputTokens: 40,
      outputTokens: 10,
      totalTokens: 50,
    });
  });
});
