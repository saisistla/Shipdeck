import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { createJiraUserStory, fetchJiraTicket, jiraProjectKey } from "./jira.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("fetchJiraTicket attachments", () => {
  it("downloads images and comments without failing the ticket", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shipdeck-jira-att-"));
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/issue/SCRUM-2") && url.includes("attachment")) {
        return new Response(
          JSON.stringify({
            key: "SCRUM-2",
            fields: {
              summary: "Add surname",
              description: "Add the patient surname on the front-desk list.",
              attachment: [
                {
                  id: "11",
                  filename: "desk.png",
                  mimeType: "image/png",
                  size: 5,
                  content: "https://example.atlassian.net/rest/api/3/attachment/content/11",
                },
              ],
              comment: { comments: [{ body: "Use the screenshot.", author: { displayName: "Ada" } }] },
            },
          }),
          { status: 200 }
        );
      }
      if (url.includes("/attachment/content/11")) {
        return new Response(Buffer.from("png!!"), { status: 200 });
      }
      return new Response("missing", { status: 404 });
    }) as typeof fetch;

    const ticket = await fetchJiraTicket({
      deployment: "cloud",
      siteUrl: "https://example.atlassian.net",
      email: "ada@example.com",
      token: "token",
      issueKey: "SCRUM-2",
      attachmentDir: dir,
    });
    assert.equal(ticket.key, "SCRUM-2");
    assert.equal(ticket.attachments[0]?.filename, "desk.png");
    assert.equal(ticket.attachments[0]?.kind, "image");
    assert.equal(fs.readFileSync(path.join(dir, "desk.png"), "utf8"), "png!!");
    assert.match(ticket.comments[0] ?? "", /Ada/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("still returns the ticket when an attachment download fails", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/issue/SCRUM-9")) {
        return new Response(
          JSON.stringify({
            key: "SCRUM-9",
            fields: {
              summary: "No file",
              description: "Text only ticket for a small change.",
              attachment: [
                {
                  id: "99",
                  filename: "missing.png",
                  mimeType: "image/png",
                  size: 10,
                  content: "https://example.atlassian.net/rest/api/3/attachment/content/99",
                },
              ],
            },
          }),
          { status: 200 }
        );
      }
      return new Response("gone", { status: 404 });
    }) as typeof fetch;

    const ticket = await fetchJiraTicket({
      deployment: "cloud",
      siteUrl: "https://example.atlassian.net",
      email: "ada@example.com",
      token: "token",
      issueKey: "SCRUM-9",
      attachmentDir: fs.mkdtempSync(path.join(os.tmpdir(), "shipdeck-jira-miss-")),
    });
    assert.equal(ticket.summary, "No file");
    assert.equal(ticket.attachments[0]?.filename, "missing.png");
  });

  it("reads text out of a Jira PDF attachment", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shipdeck-jira-pdf-"));
    const pdf = Buffer.from(
      `%PDF-1.4
4 0 obj<< /Length 48 >>stream
BT /F1 12 Tf 10 20 Td (Patient surname column) Tj ET
endstream
endobj
trailer<< /Root 1 0 R >>
%%EOF
`,
      "utf8"
    );
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/issue/SCRUM-4")) {
        return new Response(
          JSON.stringify({
            key: "SCRUM-4",
            fields: {
              summary: "Add surname",
              description: "Use the attached spec.",
              attachment: [
                {
                  id: "44",
                  filename: "spec.pdf",
                  mimeType: "application/pdf",
                  size: pdf.length,
                  content: "https://example.atlassian.net/rest/api/3/attachment/content/44",
                },
              ],
            },
          }),
          { status: 200 }
        );
      }
      if (url.includes("/attachment/content/44")) {
        return new Response(pdf, { status: 200, headers: { "content-type": "application/pdf" } });
      }
      return new Response("missing", { status: 404 });
    }) as typeof fetch;
    const ticket = await fetchJiraTicket({
      deployment: "cloud",
      siteUrl: "https://example.atlassian.net",
      email: "ada@example.com",
      token: "token",
      issueKey: "SCRUM-4",
      attachmentDir: dir,
    });
    assert.equal(ticket.attachments[0]?.kind, "document");
    assert.match(ticket.attachments[0]?.textExcerpt ?? "", /Patient surname column/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("createJiraUserStory", () => {
  it("creates a project from the application name and a technical story", async () => {
    assert.equal(jiraProjectKey("Gate Register"), "GATEREGI");
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? init.body : undefined;
      calls.push({ url, method, body });
      if (url.endsWith("/myself")) {
        return new Response(JSON.stringify({ accountId: "ada-1", displayName: "Ada" }), { status: 200 });
      }
      if (url.includes("/project/GATEREGI") && method === "GET") {
        return new Response("missing", { status: 404 });
      }
      if (url.endsWith("/project") && method === "POST") {
        return new Response(JSON.stringify({ key: "GATEREGI", name: "Gate Register" }), { status: 201 });
      }
      if (url.includes("/issuetypes")) {
        return new Response(JSON.stringify({ issueTypes: [{ name: "Task" }, { name: "Story" }] }), { status: 200 });
      }
      if (url.endsWith("/issue") && method === "POST") {
        return new Response(JSON.stringify({ key: "GATEREGI-1" }), { status: 201 });
      }
      return new Response("missing", { status: 404 });
    }) as typeof fetch;

    const created = await createJiraUserStory({
      deployment: "cloud",
      siteUrl: "https://example.atlassian.net",
      email: "ada@example.com",
      token: "token",
      projectName: "Gate Register",
      summary: "Gate Register",
      sections: {
        problem: "Parents at the school gate need a register.",
        customer: "Teachers at the gate",
        offer: "Mark one child collected.",
        inScope: ["Show today's class"],
        outOfScope: ["Live school roll"],
        acceptance: ["A teacher can mark one child collected"],
      },
    });
    assert.equal(created.issueKey, "GATEREGI-1");
    assert.equal(created.projectKey, "GATEREGI");
    const issue = calls.find((item) => item.url.endsWith("/issue"));
    assert.ok(issue?.body);
    assert.match(issue.body, /Story/);
    assert.match(issue.body, /school gate/);
    assert.match(issue.body, /Acceptance/);
    assert.doesNotMatch(issue.body, /market|SWOT|competitor/i);
    const project = calls.find((item) => item.method === "POST" && item.url.endsWith("/project"));
    assert.match(project?.body ?? "", /Gate Register/);
  });
});
