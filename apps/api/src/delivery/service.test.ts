import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { parseGithubRepo } from "./github.js";
import { simulatePlanner } from "./planner.js";
import { safeRelative, scanText } from "./scan.js";
import { createDeliveryService } from "./service.js";
import { pendingAttachmentDir } from "./ticketAttachments.js";
import { defaultDeliveryPolicy } from "@shipdeck/shared";

const roots: string[] = [];

function tmpService(
  handoff?: (pipelineId: string) => Promise<{ id: string }>,
  editFiles?: (
    instruction: string,
    files: Array<{ path: string; contents: string }>
  ) => Promise<Array<{ path: string; contents: string }>>
) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "shipdeck-delivery-"));
  roots.push(root);
  return createDeliveryService(root, {
    handoff,
    planner: async (input) => simulatePlanner(input),
    projectFiles: async () => null,
    editFiles,
  });
}

after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

describe("delivery guards", () => {
  it("blocks a second active run for the same ticket", async () => {
    const svc = tmpService();
    const first = await svc.start({ mode: "simulate", changeKind: "new_app", actor: "ada" });
    const second = await svc.start({ mode: "simulate", changeKind: "new_app", actor: "ada" });
    assert.equal(first.duplicate, false);
    assert.equal(second.duplicate, true);
    assert.equal(second.run.id, first.run.id);
  });

  it("requires a repo URL when the ticket changes an existing repository", async () => {
    const svc = tmpService();
    await assert.rejects(
      () => svc.start({ mode: "simulate", changeKind: "existing_repo", actor: "ada" }),
      /repo URL/
    );
  });

  it("refuses a folder agent as the plan model", async () => {
    const svc = tmpService();
    const policy = svc.store.getPolicy();
    policy.planModel = { ...policy.planModel, provider: "cursor", endpoint: "https://api.cursor.com/v0/agents" };
    policy.model = policy.planModel;
    svc.store.savePolicy(policy);
    svc.store.saveSecrets({ planApiKey: "k", codeApiKey: "k" });
    await assert.rejects(
      () => svc.start({ mode: "live", changeKind: "new_app", actor: "ada" }),
      /plan model/
    );
  });

  it("lets live mode start when plan and code share a vendor and only the plan key is saved", async () => {
    const svc = tmpService();
    const policy = svc.store.getPolicy();
    policy.planModel = { ...policy.planModel, provider: "anthropic", endpoint: "https://api.anthropic.com/v1/messages" };
    policy.codeModel = { ...policy.codeModel, provider: "anthropic", endpoint: "https://api.anthropic.com/v1/messages" };
    policy.model = policy.planModel;
    svc.store.savePolicy(policy);
    svc.store.saveSecrets({ planApiKey: "shared-key" });
    const started = await svc.start({ mode: "live", changeKind: "new_app", actor: "ada" });
    assert.equal(started.duplicate, false);
    assert.equal(started.run.status, "architecture_review");
    assert.equal(svc.store.getPolicy().codeModel.hasApiKey, true);
  });

  it("keeps a stored code key when a later save omits it", () => {
    const svc = tmpService();
    svc.store.saveSecrets({ planApiKey: "plan-key", codeApiKey: "code-key" });
    svc.store.saveSecrets({ ...svc.store.getSecrets(), codeApiKey: svc.store.getSecrets().codeApiKey });
    assert.equal(svc.store.getSecrets().codeApiKey, "code-key");
    assert.equal(svc.store.getPolicy().codeModel.hasApiKey, true);
  });

  it("refuses live mode when plan and code vendors differ and only the plan key is saved", async () => {
    const svc = tmpService();
    const policy = svc.store.getPolicy();
    policy.planModel = { ...policy.planModel, provider: "anthropic", endpoint: "https://api.anthropic.com/v1/messages" };
    policy.codeModel = { ...policy.codeModel, provider: "openai", endpoint: "https://api.openai.com/v1/chat/completions" };
    policy.model = policy.planModel;
    svc.store.savePolicy(policy);
    svc.store.saveSecrets({ planApiKey: "plan-only" });
    await assert.rejects(
      () => svc.start({ mode: "live", changeKind: "new_app", actor: "ada" }),
      /code-model API key/
    );
  });

  it("refuses live mode without a model endpoint and key", async () => {
    const svc = tmpService();
    await assert.rejects(
      () => svc.start({ mode: "live", changeKind: "new_app", actor: "ada" }),
      /model endpoint/
    );
  });

  it("stops approval when the estimate is over the token cap", async () => {
    const svc = tmpService();
    const policy = svc.store.getPolicy();
    policy.tokenCap = 10;
    svc.store.savePolicy(policy);
    const { run } = await svc.start({ mode: "simulate", changeKind: "new_app", actor: "ada" });
    assert.equal(run.blockedReason, "token_cap");
    await assert.rejects(() => svc.decide(run.id, "architecture", "approve", "ada"), /token cap/);
  });

  it("asks for clarification before a thin ticket can be approved", async () => {
    const svc = tmpService();
    const { run } = await svc.start({
      mode: "simulate",
      changeKind: "new_app",
      actor: "ada",
      ticket: { key: "SHIP-9", summary: "Tiny", description: "too short", acceptance: [], comments: [], attachments: [] },
    });
    assert.equal(run.needsClarification, true);
    assert.doesNotMatch(run.architecture.markdown, /```mermaid/);
    await assert.rejects(() => svc.decide(run.id, "architecture", "approve", "ada"), /open questions/);
    const revised = await svc.revise(run.id, "Add health and a fixture reservation.", "ada");
    assert.equal(revised.needsClarification, false);
    assert.match(revised.architecture.markdown, /```mermaid/);
    assert.match(revised.architecture.markdown, /Add health and a fixture reservation/);
  });

  it("rejects a workspace path that escapes the sandbox", () => {
    assert.throws(() => safeRelative(os.tmpdir(), "../outside.txt"), /escapes/);
  });

  it("flags a committed access key", () => {
    assert.equal(scanText("src/app.js", "const key = 'AKIAIOSFODNN7EXAMPLE'").length > 0, true);
  });

  it("parses a GitHub repository URL", () => {
    assert.deepEqual(parseGithubRepo("https://github.com/acme/inventory.git"), { owner: "acme", repo: "inventory" });
    assert.equal(parseGithubRepo("https://gitlab.com/acme/inventory"), null);
  });

  it("remembers a webhook id once", () => {
    const svc = tmpService();
    assert.equal(svc.store.rememberWebhook("wh-1", "run-1"), true);
    assert.equal(svc.store.rememberWebhook("wh-1", "run-2"), false);
    assert.equal(svc.store.runIdForWebhook("wh-1"), "run-1");
  });
});

describe("delivery simulate path", () => {
  it("walks architecture, review, tests, and a simulated deploy handoff", async () => {
    let called = false;
    const svc = tmpService(async () => {
      called = true;
      return { id: "should-not-run" };
    });
    const { run } = await svc.start({ mode: "simulate", changeKind: "new_app", actor: "ada" });
    assert.equal(run.status, "architecture_review");
    assert.match(run.architecture.markdown, /Reserve stock when an order is placed/);
    assert.match(run.architecture.markdown, /```mermaid/);
    assert.match(run.architecture.markdown, /GET \/health/);
    assert.equal(run.blockedReason, null);
    await assert.rejects(() => svc.decide(run.id, "code_review", "approve", "ada"), /not open/);

    const coded = await svc.decide(run.id, "architecture", "approve", "ada");
    assert.equal(coded.status, "code_review");
    assert.ok(coded.implementation?.files.includes("src/app.js"));
    assert.ok(coded.implementation?.files.includes("public/index.html"));
    assert.ok(coded.implementation?.files.includes("architecture.md"));
    assert.equal(coded.implementation?.secretsScan.clean, true);
    assert.equal(coded.implementation?.fixturesOnly, true);
    assert.match(coded.implementation?.pullRequestUrl ?? "", /^simulate:\/\//);

    await assert.rejects(() => svc.decide(coded.id, "code_review", "approve", "ada"), /test bench/);
    const testedBar = await svc.runTests(coded.id, "ada");
    assert.deepEqual(
      testedBar.run.checks.map((check) => check.status),
      ["passed", "passed", "passed"]
    );
    const tested = await svc.decide(coded.id, "code_review", "approve", "ada");
    assert.equal(tested.status, "deploy_approval");
    assert.deepEqual(
      tested.checks.map((check) => check.status),
      ["passed", "passed", "passed"]
    );

    const done = await svc.decide(tested.id, "deploy", "approve", "ada");
    assert.equal(done.status, "completed");
    assert.equal(done.handoff?.mode, "simulate");
    assert.equal(done.handoff?.deployRunId, null);
    assert.equal(called, false);
    assert.equal(done.usage.tokens, 0);
    assert.equal(done.usage.calls, 0);
    assert.match(done.estimate.assumptions[0] ?? "", /architecture\.md/);
    await assert.rejects(async () => svc.kill(done.id, "ada"), /finished/);
  });

  it("puts Jira attachments into architecture.md and the project folder", async () => {
    const svc = tmpService();
    const root = roots.at(-1) ?? "";
    const pending = pendingAttachmentDir(root, "SHIP-300");
    fs.mkdirSync(pending, { recursive: true });
    fs.writeFileSync(path.join(pending, "desk.png"), "png-bytes");
    fs.writeFileSync(path.join(pending, "pipeline-fail.png"), "fail-bytes");
    const { run } = await svc.start({
      mode: "simulate",
      changeKind: "new_app",
      actor: "ada",
      ticket: {
        key: "SHIP-300",
        summary: "Add surname on the front desk",
        description:
          "Add the patient surname column on the existing front-desk list. The attached screenshot is the current page.",
        acceptance: ["Show surname on the list"],
        comments: ["Ada: look at desk.png", "QA: pipeline failed again, see pipeline-fail.png"],
        attachments: [
          { filename: "desk.png", mimeType: "image/png", kind: "image", storedName: "desk.png" },
          { filename: "pipeline-fail.png", mimeType: "image/png", kind: "image", storedName: "pipeline-fail.png" },
        ],
      },
    });
    assert.match(run.architecture.markdown, /Ticket attachments/);
    assert.match(run.architecture.markdown, /desk\.png/);
    assert.match(run.architecture.markdown, /Ada: look at desk\.png/);
    assert.doesNotMatch(run.architecture.markdown, /pipeline-fail/);
    assert.doesNotMatch(run.architecture.markdown, /pipeline failed/);
    const coded = await svc.decide(run.id, "architecture", "approve", "ada");
    assert.ok(coded.implementation?.files.includes("ticket-attachments/desk.png"));
    assert.ok(!coded.implementation?.files.includes("ticket-attachments/pipeline-fail.png"));
    assert.equal(
      fs.readFileSync(path.join(coded.implementation?.workspace ?? "", "ticket-attachments", "desk.png"), "utf8"),
      "png-bytes"
    );
  });

  it("lets the operator skip the test bar and continue to deploy", async () => {
    const svc = tmpService();
    const { run } = await svc.start({ mode: "simulate", changeKind: "new_app", actor: "ada" });
    await assert.rejects(() => svc.decide(run.id, "architecture", "skip", "ada"), /test bar/);
    await svc.decide(run.id, "architecture", "approve", "ada");
    const skipped = await svc.decide(run.id, "code_review", "skip", "ada");
    assert.equal(skipped.status, "deploy_approval");
    assert.deepEqual(
      skipped.checks.map((check) => check.status),
      ["skipped", "skipped", "skipped"]
    );
    assert.match(skipped.logs.join("\n"), /skipped the test bar/);
    await assert.rejects(() => svc.decide(skipped.id, "deploy", "skip", "ada"), /test bar/);
    const done = await svc.decide(skipped.id, "deploy", "approve", "ada");
    assert.equal(done.status, "completed");
  });

  it("builds the product described in the Jira ticket", async () => {
    const svc = tmpService();
    const { run } = await svc.start({
      mode: "simulate",
      changeKind: "new_app",
      actor: "ada",
      ticket: {
        key: "SHIP-200",
        summary: "Build an application for organic vegetable farming",
        description:
          "Farmers record plots, organic crops, and harvests. Non-production runs use fixture data only.",
        acceptance: ["List organic crops", "Record a harvest", "Show farm plots"],
        comments: [],
        attachments: [],
      },
    });
    const coded = await svc.decide(run.id, "architecture", "approve", "ada");
    const app = fs.readFileSync(path.join(coded.implementation?.workspace ?? "", "src/app.js"), "utf8");
    const html = fs.readFileSync(path.join(coded.implementation?.workspace ?? "", "public/index.html"), "utf8");
    assert.match(app, /organic|vegetable|farm|crop|harvest|plot/i);
    assert.match(html, /organic|vegetable|farm|crop|harvest|plot/i);
    await svc.runTests(coded.id, "ada");
    const tested = await svc.decide(coded.id, "code_review", "approve", "ada");
    assert.deepEqual(
      tested.checks.map((check) => check.status),
      ["passed", "passed", "passed"]
    );
  });

  it("kills an open run and records the actor", async () => {
    const svc = tmpService();
    const { run } = await svc.start({ mode: "simulate", changeKind: "new_app", actor: "ada" });
    const killed = await svc.kill(run.id, "oncall");
    assert.equal(killed.status, "killed");
    assert.equal(killed.killedBy, "oncall");
    await assert.rejects(() => svc.decide(run.id, "architecture", "approve", "ada"), /finished/);
  });

  it("does not start a cloud pipeline on deploy approval", async () => {
    let pipeline = "";
    let gitUrl = "";
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "shipdeck-delivery-"));
    roots.push(root);
    const svc = createDeliveryService(root, {
      handoff: async (pipelineId: string) => {
        pipeline = pipelineId;
        return { id: "dep-1" };
      },
      ensureGitConnection: async (input) => {
        gitUrl = input.url;
        return { id: "git-1", name: `${input.name}`, created: true };
      },
      planner: async (input) => simulatePlanner(input),
      projectFiles: async () => null,
    });
    const policy = { ...defaultDeliveryPolicy(), ...svc.store.getPolicy(), pipelineId: "pipe-1" };
    policy.planModel = { ...policy.planModel, endpoint: "https://example.openai.azure.com/chat" };
    policy.codeModel = { ...policy.codeModel, provider: "azure-openai", endpoint: "https://example.openai.azure.com/chat" };
    policy.model = policy.planModel;
    svc.store.savePolicy(policy);
    svc.store.saveSecrets({ planApiKey: "test-key", codeApiKey: "test-key", gitToken: "ghp-test" });
    const { run } = await svc.start({
      mode: "live",
      changeKind: "new_app",
      actor: "ada",
      repoUrl: "https://github.com/acme/clinic-desk.git",
    });
    await svc.decide(run.id, "architecture", "approve", "ada");
    await svc.runTests(run.id, "ada");
    await svc.decide(run.id, "code_review", "approve", "ada");
    const done = await svc.decide(run.id, "deploy", "approve", "ada");
    assert.equal(pipeline, "");
    assert.equal(done.handoff?.deployRunId, null);
    assert.equal(done.handoff?.mode, "live");
    assert.equal(gitUrl, "https://github.com/acme/clinic-desk.git");
    assert.match(done.handoff?.message ?? "", /Git connection/);
  });

  it("stores an existing VM target and creates an SSH connection on deploy approval", async () => {
    let ssh: { name: string; target: { host?: string }; secrets: Record<string, string> } | null = null;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "shipdeck-delivery-"));
    roots.push(root);
    const svc = createDeliveryService(root, {
      planner: async (input) => simulatePlanner(input),
      projectFiles: async () => null,
      ensureExistingTargetConnection: (input) => {
        ssh = { name: input.name, target: input.target, secrets: input.secrets };
        return { id: "ssh-1", name: input.name, type: "ssh", created: true };
      },
    });
    const { run } = await svc.start({
      mode: "simulate",
      changeKind: "existing_repo",
      actor: "ada",
      repoUrl: "https://github.com/acme/clinic-desk.git",
      existingTarget: {
        kind: "ssh",
        host: "34.140.138.176",
        user: "ubuntu",
        password: "vm-secret",
      },
    });
    assert.match(run.architecture.impactAnalysis ?? "", /Impact analysis/);
    assert.match(run.architecture.impactAnalysis ?? "", /clinic-desk/);
    assert.match(run.architecture.markdown, /impact-analysis\.md/);
    assert.equal(run.existingTarget?.host, "34.140.138.176");
    assert.equal(run.existingTarget?.hasAuth, true);
    assert.equal("password" in (run.existingTarget ?? {}), false);
    assert.equal(svc.store.getExistingTargetSecrets(run.id).password, "vm-secret");
    const coded = await svc.decide(run.id, "architecture", "approve", "ada");
    assert.match(
      fs.readFileSync(path.join(coded.implementation!.workspace, "impact-analysis.md"), "utf8"),
      /Where it will affect/
    );
    await svc.runTests(run.id, "ada");
    await svc.decide(run.id, "code_review", "approve", "ada");
    const done = await svc.decide(run.id, "deploy", "approve", "ada");
    assert.equal(ssh?.target.host, "34.140.138.176");
    assert.equal(ssh?.secrets.password, "vm-secret");
    assert.equal(done.handoff?.createdConnections?.[0]?.name, `${run.ticket.key} 34.140.138.176`);
    assert.match(done.handoff?.message ?? "", /I created SSH connection/);
  });

  it("requires a live existing-repo VM or serverless target", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "shipdeck-delivery-"));
    roots.push(root);
    const svc = createDeliveryService(root, {
      planner: async (input) => simulatePlanner(input),
      projectFiles: async () => null,
    });
    const policy = { ...defaultDeliveryPolicy(), ...svc.store.getPolicy() };
    policy.planModel = { ...policy.planModel, endpoint: "https://example.openai.azure.com/chat" };
    policy.codeModel = { ...policy.codeModel, provider: "azure-openai", endpoint: "https://example.openai.azure.com/chat" };
    policy.model = policy.planModel;
    svc.store.savePolicy(policy);
    svc.store.saveSecrets({ planApiKey: "test-key", codeApiKey: "test-key", gitToken: "ghp-test" });
    await assert.rejects(
      () =>
        svc.start({
          mode: "live",
          changeKind: "existing_repo",
          actor: "ada",
          repoUrl: "https://github.com/acme/clinic-desk.git",
        }),
      /existing VM or serverless/
    );
  });

  it("parses a live ECS URL as the existing serverless target", async () => {
    const svc = tmpService();
    const { run } = await svc.start({
      mode: "simulate",
      changeKind: "existing_repo",
      actor: "ada",
      repoUrl: "https://github.com/acme/clinic-desk.git",
      existingTarget: {
        kind: "aws",
        serviceUrl: "https://sh-0f408754324f4df8b090bbd48a0d96dc.ecs.eu-west-1.on.aws",
        accessKeyId: "AKIATEST",
        secretAccessKey: "secret",
      },
    });
    assert.equal(run.existingTarget?.kind, "aws");
    assert.equal(run.existingTarget?.region, "eu-west-1");
    assert.equal(run.existingTarget?.serviceName, "sh-0f408754324f4df8b090bbd48a0d96dc");
    assert.equal(
      run.existingTarget?.serviceUrl,
      "https://sh-0f408754324f4df8b090bbd48a0d96dc.ecs.eu-west-1.on.aws"
    );
  });

  it("lets an open existing-repo run attach a VM target later", async () => {
    const svc = tmpService();
    const { run } = await svc.start({
      mode: "simulate",
      changeKind: "existing_repo",
      actor: "ada",
      repoUrl: "https://github.com/acme/clinic-desk.git",
    });
    assert.equal(run.existingTarget, undefined);
    const updated = await svc.setExistingTarget(
      run.id,
      { kind: "ssh", host: "34.140.138.176", user: "ubuntu", privateKey: "-----BEGIN KEY-----" },
      "ada"
    );
    assert.equal(updated.existingTarget?.host, "34.140.138.176");
    assert.equal(updated.existingTarget?.hasAuth, true);
    assert.equal(svc.store.getExistingTargetSecrets(run.id).privateKey.startsWith("-----BEGIN"), true);
  });
});

describe("workbench before the pull request", () => {
  it("records a new ask without rewriting the project folder", async () => {
    const svc = tmpService();
    const { run } = await svc.start({ mode: "simulate", changeKind: "new_app", actor: "ada" });
    const coded = await svc.decide(run.id, "architecture", "approve", "ada");
    const before = fs.readFileSync(path.join(coded.implementation!.workspace, "src/app.js"), "utf8");
    const noted = await svc.workbench(coded.id, "new_ask", "Also add a billing page", "ada");
    const after = fs.readFileSync(path.join(coded.implementation!.workspace, "src/app.js"), "utf8");
    assert.equal(after, before);
    assert.match(noted.run.ticket.comments.join("\n"), /Out of scope/);
    assert.match(noted.reply, /not part of the current work|Jira is not connected|Practice mode|new ask/);
    assert.equal(noted.run.implementation?.pullRequestUrl, coded.implementation?.pullRequestUrl);
  });

  it("waits for approval before changing the branch", async () => {
    const svc = tmpService();
    const { run } = await svc.start({ mode: "simulate", changeKind: "new_app", actor: "ada" });
    const coded = await svc.decide(run.id, "architecture", "approve", "ada");
    const before = fs.readFileSync(path.join(coded.implementation!.workspace, "src/app.js"), "utf8");
    const proposed = await svc.workbench(coded.id, "fix", "Show only today's appointments", "ada");
    const during = fs.readFileSync(path.join(coded.implementation!.workspace, "src/app.js"), "utf8");
    assert.equal(during, before);
    assert.equal(proposed.run.status, "code_review");
    assert.match(proposed.run.pendingRevision?.architecture.markdown ?? "", /today's appointments|Revisions applied|Show only/);
    assert.equal(proposed.run.pendingRevision?.note, "Show only today's appointments");
    await assert.rejects(() => svc.decide(coded.id, "code_review", "approve", "ada"), /revised plan/);
    const changed = await svc.workbench(coded.id, "approve_plan", "", "ada");
    assert.equal(changed.run.pendingRevision, undefined);
    assert.equal(changed.run.status, "code_review");
    assert.ok(changed.run.revisionNotes.includes("Show only today's appointments"));
    assert.match(changed.run.architecture.markdown, /today's appointments|Revisions applied|Show only/);
    assert.ok(fs.existsSync(path.join(changed.run.implementation!.workspace, "src/app.js")));
    assert.match(changed.reply, /approved plan|Stop the app/i);
  });

  it("leaves the page unchanged when the revised plan is rejected", async () => {
    const svc = tmpService();
    const { run } = await svc.start({ mode: "simulate", changeKind: "new_app", actor: "ada" });
    const coded = await svc.decide(run.id, "architecture", "approve", "ada");
    const before = fs.readFileSync(path.join(coded.implementation!.workspace, "src/app.js"), "utf8");
    await svc.workbench(coded.id, "fix", "Show only today's appointments", "ada");
    const rejected = await svc.workbench(coded.id, "reject_plan", "", "ada");
    const after = fs.readFileSync(path.join(coded.implementation!.workspace, "src/app.js"), "utf8");
    assert.equal(after, before);
    assert.equal(rejected.run.pendingRevision, undefined);
    assert.equal(rejected.run.revisionNotes.includes("Show only today's appointments"), false);
  });

  it("saves a file and makes architecture.md match that save", async () => {
    const svc = tmpService();
    const { run } = await svc.start({ mode: "simulate", changeKind: "new_app", actor: "ada" });
    const coded = await svc.decide(run.id, "architecture", "approve", "ada");
    const saved = await svc.saveWorkspaceFile(
      coded.id,
      "fixtures/data.json",
      '{\n  "company": { "name": "Plava" }\n}\n',
      "Sai"
    );
    const data = fs.readFileSync(path.join(coded.implementation!.workspace, "fixtures/data.json"), "utf8");
    const architecture = fs.readFileSync(path.join(coded.implementation!.workspace, "architecture.md"), "utf8");
    assert.match(data, /Plava/);
    assert.match(architecture, /## Latest edits/);
    assert.match(architecture, /Sai saved this file/);
    assert.match(architecture, /"name": "Plava"/);
    assert.equal(saved.run.architecture.markdown, architecture);
    assert.match(saved.run.ticket.comments.join("\n"), /Sai edited fixtures\/data\.json/);
    assert.match(saved.reply, /Practice mode/);
    const proposed = await svc.workbench(coded.id, "fix", "Show only today's appointments", "ada");
    assert.match(proposed.run.pendingRevision?.architecture.markdown ?? "", /Latest edits/);
    assert.match(proposed.run.pendingRevision?.architecture.markdown ?? "", /Plava/);
    await svc.workbench(coded.id, "reject_plan", "", "ada");
  });

  it("adds a new file and can delete one that is not the plan", async () => {
    const svc = tmpService();
    const { run } = await svc.start({ mode: "simulate", changeKind: "new_app", actor: "ada" });
    const coded = await svc.decide(run.id, "architecture", "approve", "ada");
    const created = await svc.createWorkspaceFile(coded.id, "src/helper.ts", "export const extra = 1;\n", "Sai");
    assert.equal(fs.existsSync(path.join(coded.implementation!.workspace, "src/helper.ts")), true);
    assert.match(created.run.architecture.markdown, /src\/helper\.ts/);
    assert.match(created.run.ticket.comments.join("\n"), /Sai added src\/helper\.ts/);
    const removed = await svc.deleteWorkspaceFile(coded.id, "src/helper.ts", "Sai");
    assert.equal(fs.existsSync(path.join(coded.implementation!.workspace, "src/helper.ts")), false);
    assert.match(removed.run.architecture.markdown, /removed this file/);
    assert.equal(fs.existsSync(path.join(coded.implementation!.workspace, "architecture.md")), true);
    await assert.rejects(() => svc.deleteWorkspaceFile(coded.id, "architecture.md", "Sai"), /stays/);
  });

  it("lets the code model edit a file the way a person would save it", async () => {
    const svc = tmpService(undefined, async () => [
      { path: "public/index.html", contents: "<h1>Plava Consulting Ltd - IT & AI Consulting</h1>\n" },
    ]);
    const { run } = await svc.start({ mode: "simulate", changeKind: "new_app", actor: "ada" });
    const coded = await svc.decide(run.id, "architecture", "approve", "ada");
    const edited = await svc.workbench(
      coded.id,
      "code_edit",
      'Make the page title "Plava Consulting Ltd - IT & AI Consulting"',
      "Sai"
    );
    const page = fs.readFileSync(path.join(coded.implementation!.workspace, "public/index.html"), "utf8");
    const architecture = fs.readFileSync(path.join(coded.implementation!.workspace, "architecture.md"), "utf8");
    assert.match(page, /IT & AI Consulting/);
    assert.match(architecture, /## Latest edits/);
    assert.match(architecture, /public\/index\.html/);
    assert.match(edited.run.ticket.comments.join("\n"), /code model/);
    assert.match(edited.reply, /Practice mode/);
    assert.match(edited.reply, /public\/index\.html/);
    const editNote = edited.run.workbenchChat?.find((line) => line.files?.some((file) => file.path === "public/index.html"));
    assert.ok(editNote);
    const pageChange = editNote?.files?.find((file) => file.path === "public/index.html");
    assert.ok(pageChange?.added.some((line) => line.includes("IT & AI Consulting")));
    assert.ok(pageChange && pageChange.removed.length > 0);
    assert.equal(edited.run.pendingRevision, undefined);

    const finished = structuredClone(coded);
    finished.status = "completed";
    svc.store.saveRun(finished);
    const afterShip = await svc.workbench(
      coded.id,
      "code_edit",
      "Keep the consulting title",
      "Sai"
    );
    assert.match(afterShip.reply, /Edited the files/);
    assert.ok(afterShip.run.workbenchChat?.some((line) => line.text.includes("Keep the consulting title")));
    assert.ok(afterShip.run.workbenchChat?.some((line) => line.files?.some((file) => file.path === "public/index.html")));
  });

  it("lets testers change only test files with the code model", async () => {
    const svc = tmpService(undefined, async (_instruction, files) => {
      assert.ok(files.every((file) => file.path.startsWith("test/") || /\.(test|spec)\./i.test(file.path)));
      return [
        { path: "public/index.html", contents: "<h1>should not land</h1>\n" },
        { path: "test/unit.test.js", contents: "import test from \"node:test\";\ntest(\"hero\", () => {});\n" },
      ];
    });
    const { run } = await svc.start({ mode: "simulate", changeKind: "new_app", actor: "ada" });
    const coded = await svc.decide(run.id, "architecture", "approve", "ada");
    const before = fs.readFileSync(path.join(coded.implementation!.workspace, "public/index.html"), "utf8");
    const edited = await svc.workbench(coded.id, "code_edit", "Cover the hero heading", "Sai", [], "test");
    const page = fs.readFileSync(path.join(coded.implementation!.workspace, "public/index.html"), "utf8");
    const unit = fs.readFileSync(path.join(coded.implementation!.workspace, "test/unit.test.js"), "utf8");
    assert.equal(page, before);
    assert.match(unit, /hero/);
    assert.match(edited.run.revisionNotes.join("\n"), /test\/unit\.test\.js/);
    await assert.rejects(() => svc.workbench(coded.id, "fix", "Rebuild the site", "Sai", [], "test"), /test files/);
  });
});

