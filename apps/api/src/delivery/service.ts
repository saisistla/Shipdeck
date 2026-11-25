import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import type {
  DeliveryChangeKind,
  DeliveryCreatedConnection,
  DeliveryDecisionAction,
  DeliveryExistingTargetInput,
  DeliveryGate,
  DeliveryMode,
  DeliveryPolicyPublic,
  DeliveryRun,
  DeliveryTicket,
  WorkbenchChatEntry,
  WorkbenchFileChange,
} from "@shipdeck/shared";
import {
  DELIVERY_TEST_BAR,
  SAMPLE_DELIVERY_TICKET,
  codeSlot,
  deliveryRunActive,
  codeImplementationKind,
  isFolderAgent,
  modelProviderById,
  planSlot,
  vendorContract,
} from "@shipdeck/shared";
import { runFolderAgent } from "./codeAgent.js";
import { ensureGithubBaseBranch, openGithubPullRequest, readGithubTextFile } from "./github.js";
import { commentOnJira, fetchJiraTicket } from "./jira.js";
import type { ModelUsage } from "./modelClient.js";
import { capReason, costForUsage, editProjectFiles, estimateFromArchitecture, generateProjectFiles, planWithModel, simulatePlanner, type DeliveryPlanner, type PlannerInput } from "./planner.js";
import { listWorkspaceFiles, safeRelative, scanText, scanWorkspace } from "./scan.js";
import { carryLatestEdits, latestEditPaths, removedEditPaths, upsertLatestEdit } from "./handEdit.js";
import { previewFor, stopPreview } from "./preview.js";
import { changeSummary, fileChange, followUpFor, reportWasAddressed } from "./workbenchDiff.js";
import { alignGeneratedProject } from "./projectAlign.js";
import { placeExistingRepository } from "./existingRepo.js";
import { customerTicketLines, READ_THE_WHOLE_TICKET } from "./ticketAttachments.js";
import { readProjectRules } from "./projectRules.js";
import { buildSandbox, runSandboxChecks } from "./sandbox.js";
import { judgeTicketEvidence } from "./evidenceJudge.js";
import {
  copyAttachmentsIntoWorkspace,
  pendingAttachmentDir,
  promoteTicketAttachments,
  runAttachmentDir,
} from "./ticketAttachments.js";
import { store as appStore } from "../store.js";
import { DeliveryStore } from "./store.js";
import {
  existingConnectionName,
  existingTargetError,
  existingTargetSecrets,
  publicExistingTarget,
} from "./existingTarget.js";

export class DeliveryError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string
  ) {
    super(message);
  }
}

function workspaceRel(rel: string): string {
  const normalized = rel.replaceAll("\\", "/").replace(/^\/+/, "").trim();
  if (!normalized || normalized.endsWith("/")) {
    throw new DeliveryError("Name the file, including the folder if it needs one", 400, "path");
  }
  if (normalized.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new DeliveryError("That file name is not allowed", 400, "path");
  }
  if (/[<>:"|?*\u0000]/.test(normalized)) {
    throw new DeliveryError("That file name is not allowed", 400, "path");
  }
  return normalized;
}

function workspaceFull(root: string, rel: string): string {
  try {
    return safeRelative(root, rel);
  } catch (err) {
    throw new DeliveryError(err instanceof Error ? err.message : String(err), 400, "path");
  }
}

function taggedFiles(message: string, known: string[]): string[] {
  const tags = [...message.matchAll(/@([^\s@]+)/g)].map((match) => match[1].replaceAll("\\", "/"));
  return known.filter((file) => tags.some((tag) => file === tag || file.endsWith(`/${tag}`)));
}

function isTestFile(path: string) {
  const rel = path.replaceAll("\\", "/");
  return rel.startsWith("test/") || /\.(test|spec)\.[cm]?[jt]sx?$/i.test(rel);
}

export type DeployHandoff = (pipelineId: string, workspace: string) => Promise<{ id: string }>;

export type EnsureGitConnection = (input: {
  name: string;
  url: string;
  token?: string;
}) =>
  | Promise<{ id: string; name: string; type?: string; created: boolean }>
  | { id: string; name: string; type?: string; created: boolean };

export type EnsureExistingTargetConnection = (input: {
  name: string;
  kind: DeliveryExistingTargetInput["kind"];
  target: NonNullable<DeliveryRun["existingTarget"]>;
  secrets: Record<string, string>;
}) => Promise<DeliveryCreatedConnection> | DeliveryCreatedConnection;

export interface StartInput {
  mode: DeliveryMode;
  changeKind: DeliveryChangeKind;
  repoUrl?: string;
  ticket?: DeliveryTicket;
  actor: string;
  projectId?: string;
  existingTarget?: DeliveryExistingTargetInput;
}

const GATES: Record<DeliveryGate, DeliveryRun["status"]> = {
  architecture: "architecture_review",
  code_review: "code_review",
  deploy: "deploy_approval",
};

function testBarPassed(run: DeliveryRun): boolean {
  return run.checks.length > 0 && run.checks.every((check) => check.status === "passed");
}

function log(run: DeliveryRun, line: string) {
  run.logs.push(line);
  if (run.logs.length > 500) run.logs.splice(0, run.logs.length - 500);
}

function applyLiveUsage(run: DeliveryRun, usage: ModelUsage): void {
  const tokens = usage.totalTokens || usage.inputTokens + usage.outputTokens;
  run.usage.calls += 1;
  if (!tokens) return;
  run.usage.tokens += tokens;
  run.usage.costUsd = Number((run.usage.costUsd + costForUsage(usage)).toFixed(4));
}

function planKey(secrets: { planApiKey?: string; modelApiKey?: string }): string {
  return (secrets.planApiKey || secrets.modelApiKey || "").trim();
}

function codeKey(
  policy: DeliveryPolicyPublic,
  secrets: { planApiKey?: string; codeApiKey?: string; modelApiKey?: string }
): string {
  const own = (secrets.codeApiKey || "").trim();
  if (own) return own;
  if (planSlot(policy).provider === codeSlot(policy).provider) return planKey(secrets);
  return "";
}

function assertPolicy(policy: DeliveryPolicyPublic, mode: DeliveryMode, changeKind: DeliveryChangeKind, repoUrl: string, secrets: {
  modelApiKey?: string;
  planApiKey?: string;
  codeApiKey?: string;
  gitToken?: string;
}) {
  if (!policy.rollbackOwner.trim()) throw new DeliveryError("Name a rollback owner before starting a ticket", 400, "rollback_owner");
  if (!policy.architectureApprover.trim() || !policy.codeReviewer.trim() || !policy.deployApprover.trim()) {
    throw new DeliveryError("Architecture, code review, and deploy each need an approver", 400, "approvers");
  }
  for (const check of DELIVERY_TEST_BAR) {
    if (!policy.testBar.includes(check)) {
      throw new DeliveryError("The test bar must include lint, unit, and integration", 400, "test_bar");
    }
  }
  if (!policy.allowedLanguages.length || !policy.allowedPackageSources.length || !policy.allowedLicenses.length) {
    throw new DeliveryError("Language, package source, and license allow-lists cannot be empty", 400, "allow_list");
  }
  if (changeKind === "existing_repo" && !repoUrl.trim()) {
    throw new DeliveryError("An existing repository needs a repo URL", 400, "repo_url");
  }
  if (mode === "live") {
    const plan = planSlot(policy);
    const code = codeSlot(policy);
    if (isFolderAgent(plan.provider)) {
      throw new DeliveryError("The plan model must be a chat API. Cursor and other folder agents are for code only.", 400, "plan_model");
    }
    if (!planKey(secrets) || !plan.endpoint.trim()) {
      throw new DeliveryError("Live mode needs a plan-model endpoint and API key", 400, "model");
    }
    if (!codeKey(policy, secrets)) {
      throw new DeliveryError("Live mode needs a code-model API key", 400, "code_model");
    }
    const contract = vendorContract(code.provider);
    if (!contract.liveSupported) {
      throw new DeliveryError(contract.help, 400, "code_model");
    }
    if (contract.needs.includes("endpoint") && !code.endpoint.trim() && codeImplementationKind(code.provider) !== "cursor-cloud") {
      throw new DeliveryError(`Live mode needs the ${contract.label} endpoint from the policy form`, 400, "code_model");
    }
    if (contract.needs.includes("githubRepo") && !repoUrl.trim()) {
      throw new DeliveryError(`${contract.label} needs a GitHub repository URL on the Build page`, 400, "repo_url");
    }
    if (contract.needs.includes("githubToken") && !secrets.gitToken) {
      throw new DeliveryError(`${contract.label} needs a Git token so Shipdeck can create branch main before the vendor is called`, 400, "git");
    }
    if (changeKind === "existing_repo" && !secrets.gitToken) {
      throw new DeliveryError("Changing an existing repository in live mode needs a Git token", 400, "git");
    }
    if (policy.git.autoOpenPr && !secrets.gitToken) {
      throw new DeliveryError("Opening a pull request needs a Git token", 400, "git");
    }
    if (policy.git.autoOpenPr && !repoUrl.trim() && changeKind !== "new_app") {
      throw new DeliveryError("Opening a pull request needs a GitHub repository URL", 400, "repo_url");
    }
    if (policy.git.autoOpenPr && policy.git.host !== "github") {
      throw new DeliveryError("Automatic pull requests are available for GitHub. Other hosts keep the prepared branch for the bot.", 400, "git_host");
    }
  }
}

function rememberChat(
  run: DeliveryRun,
  who: WorkbenchChatEntry["who"],
  text: string,
  files?: WorkbenchFileChange[]
): void {
  const entry: WorkbenchChatEntry = { who, text, at: new Date().toISOString() };
  if (files?.length) entry.files = files;
  run.workbenchChat = [...(run.workbenchChat ?? []), entry];
}

function readTextFile(full: string): string {
  return fs.existsSync(full) && fs.statSync(full).isFile() ? fs.readFileSync(full, "utf8") : "";
}

export function createDeliveryService(
  root: string,
  opts?: {
    handoff?: DeployHandoff;
    ensureGitConnection?: EnsureGitConnection;
    ensureExistingTargetConnection?: EnsureExistingTargetConnection;
    planner?: DeliveryPlanner;
    projectFiles?: (input: PlannerInput) => Promise<Array<{ path: string; contents: string }> | null>;
    editFiles?: (
      instruction: string,
      files: Array<{ path: string; contents: string }>
    ) => Promise<Array<{ path: string; contents: string }>>;
  }
) {
  const store = new DeliveryStore(root);
  const planner: DeliveryPlanner =
    opts?.planner ??
    (async (input) => {
      if (input.mode === "simulate") return simulatePlanner(input);
      return planWithModel(input, planKey(store.getSecrets()));
    });

  function gitLogin(): { name: string; token: string } {
    const policy = store.getPolicy();
    const conn = policy.gitConnectionId ? appStore.connections.get(policy.gitConnectionId) : undefined;
    const saved = conn ? appStore.connectionSecrets.get(conn.id) : undefined;
    const token = saved?.token || saved?.personalAccessToken || store.getSecrets().gitToken || "";
    return { name: conn?.name || "the saved Git login", token };
  }

  function workspaceFor(id: string): string {
    return path.join(root, "delivery-workspaces", id);
  }

  async function persist(run: DeliveryRun): Promise<DeliveryRun> {
    const policy = store.getPolicy();
    const previous = store.getRun(run.id);
    if (policy.jira.updateStatus && previous?.status !== run.status) {
      const token = store.getSecrets().jiraToken;
      if (run.mode !== "live") {
        log(run, "Jira write-back stays local in simulate mode");
      } else if (!policy.jira.siteUrl.trim() || !token) {
        log(run, "Jira write-back is enabled, but the site URL or token is missing");
      } else {
        try {
          await commentOnJira({
            deployment: policy.jira.deployment,
            siteUrl: policy.jira.siteUrl,
            email: policy.jira.accountEmail,
            token,
            issueKey: run.ticket.key,
            text: `${run.ticket.key} is ${run.status.replaceAll("_", " ")}. ${run.logs.at(-1) ?? ""}`.slice(0, 2000),
          });
          log(run, "Wrote the current status back to Jira");
        } catch (err) {
          log(run, `Jira write-back failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
    return store.saveRun(run);
  }

  async function planInto(run: DeliveryRun): Promise<DeliveryRun> {
    const policy = store.getPolicy();
    const judged = await judgeTicketEvidence({
      ticket: run.ticket,
      attachmentDir: runAttachmentDir(root, run.id),
      live: run.mode === "live",
      slot: planSlot(policy),
      apiKey: planKey(store.getSecrets()),
    });
    run.ticket = judged.ticket;
    if (judged.note) log(run, judged.note);
    if (run.mode === "live") applyLiveUsage(run, judged.usage);
    let existingArchitectureMarkdown: string | undefined;
    if (run.changeKind === "existing_repo" && run.repoUrl.trim() && run.mode === "live") {
      const token = store.getSecrets().gitToken ?? "";
      if (token) {
        const existing = await readGithubTextFile({
          repoUrl: run.repoUrl,
          token,
          path: "architecture.md",
          ref: policy.git.defaultBaseBranch,
        });
        if (existing?.trim()) {
          existingArchitectureMarkdown = existing;
          log(run, "Read architecture.md from the existing repository.");
        } else {
          log(run, "No architecture.md on the existing repository base branch. Impact analysis uses the ticket and the new plan.");
        }
      }
    }
    const plan = await planner({
      ticket: run.ticket,
      policy,
      revisionNotes: run.revisionNotes,
      changeKind: run.changeKind,
      repoUrl: run.repoUrl,
      mode: run.mode,
      existingArchitectureMarkdown,
    });
    run.scope = plan.scope;
    run.architecture = plan.architecture;
    run.estimate = plan.estimate;
    run.needsClarification = plan.needsClarification;
    if (run.mode === "live") applyLiveUsage(run, plan.usage);
    run.blockedReason = capReason(plan.estimate, policy);
    log(
      run,
      run.blockedReason
        ? `Estimate ${plan.estimate.totalTokens} tokens / $${plan.estimate.costUsd} is over the ${run.blockedReason} cap`
        : `Estimate ${plan.estimate.totalTokens} tokens / $${plan.estimate.costUsd} is inside the cap`
    );
    if (run.mode === "live") {
      log(
        run,
        plan.usage.totalTokens || plan.usage.inputTokens
          ? `Live usage this call: ${plan.usage.totalTokens || plan.usage.inputTokens + plan.usage.outputTokens} tokens`
          : "Live call finished. Vendor did not return token usage on this reply."
      );
    }
    if (run.needsClarification) log(run, "Ticket needs clarification before architecture approval");
    return run;
  }

  function noteArchitecture(run: DeliveryRun, actor: string, rel: string, contents: string, removed: boolean): void {
    if (!run.implementation) return;
    const archPath = workspaceFull(run.implementation.workspace, "architecture.md");
    const current = fs.existsSync(archPath) ? fs.readFileSync(archPath, "utf8") : run.architecture.markdown;
    const next = upsertLatestEdit(current, { actor, path: rel, contents, removed });
    fs.mkdirSync(path.dirname(archPath), { recursive: true });
    fs.writeFileSync(archPath, next, "utf8");
    run.architecture.markdown = next;
  }

  async function publishFileNote(
    run: DeliveryRun,
    comment: string,
    practice: string,
    live: string,
    plain: string
  ): Promise<string> {
    run.ticket.comments = [...(run.ticket.comments ?? []), comment];
    log(run, comment);
    const policy = store.getPolicy();
    const token = store.getSecrets().jiraToken;
    if (run.mode === "live" && policy.jira.siteUrl.trim() && token) {
      try {
        await commentOnJira({
          deployment: policy.jira.deployment,
          siteUrl: policy.jira.siteUrl,
          email: policy.jira.accountEmail,
          token,
          issueKey: run.ticket.key,
          text: comment,
        });
        return live;
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        return `${plain} Jira did not take the comment (${reason}).`;
      }
    }
    return run.mode === "live" ? plain : practice;
  }

  async function writeApprovedBranch(run: DeliveryRun): Promise<{ run: DeliveryRun; reply: string }> {
    const policy = store.getPolicy();
    const planInput: PlannerInput = {
      ticket: run.ticket,
      policy,
      revisionNotes: run.revisionNotes,
      changeKind: run.changeKind,
      repoUrl: run.repoUrl,
      mode: run.mode,
      architectureMarkdown: run.architecture.markdown,
    };
    const impl = codeImplementationKind(codeSlot(policy).provider);
    if (run.changeKind === "existing_repo" && run.mode === "live" && run.repoUrl.trim() && !opts?.projectFiles) {
      const git = gitLogin();
      if (!git.token.trim()) {
        throw new DeliveryError("Save a Git token so the existing repository can be copied before the change.", 400, "git");
      }
      await stopPreview(run.id);
      const placed = await placeExistingRepository({
        workspace: run.implementation?.workspace || workspaceFor(run.id),
        repoUrl: run.repoUrl,
        token: git.token,
        branch: policy.git.defaultBaseBranch || "main",
        ticket: run.ticket,
        architectureMarkdown: run.architecture.markdown,
        impactAnalysis: run.architecture.impactAnalysis,
        policy,
        apiKey: codeKey(policy, store.getSecrets()),
      });
      if (!run.implementation) throw new DeliveryError("This ticket has no project folder yet", 404, "not_found");
      run.implementation = {
        ...run.implementation,
        workspace: placed.workspace,
        files: placed.files,
        secretsScan: { clean: placed.findings.length === 0, findings: placed.findings },
        license: placed.license,
        pullRequestDetail: `Edited ${placed.changed.join(", ")} in the existing application. Everything else is unchanged.`,
      };
      run.checks = [];
      run.failureCode = undefined;
      run.failureMessage = undefined;
      run.status = placed.findings.length ? "failed" : "code_review";
      if (placed.findings.length) {
        run.failureCode = "secrets";
        run.failureMessage = "Secrets scan found material that cannot be committed";
      }
      log(run, `Existing repository copied. Edited ${placed.changed.join(", ")}.`);
      const reply = "The existing application is still here. Only the ticket change was applied. Stop the app, then start it again.";
      rememberChat(run, "shipdeck", reply);
      return { run: await persist(run), reply };
    }
    let modelFiles: Array<{ path: string; contents: string }> | undefined;
    if (opts?.projectFiles) {
      const custom = await opts.projectFiles(planInput);
      if (custom?.length) modelFiles = custom;
    } else if (run.mode === "live" && impl === "chat-files") {
      modelFiles = await generateProjectFiles(planInput, codeKey(policy, store.getSecrets()));
    }
    if (!run.implementation) throw new DeliveryError("This ticket has no project folder yet", 404, "not_found");
    const preserved = latestEditPaths(run.architecture.markdown)
      .filter((rel) => rel !== "architecture.md")
      .map((rel) => {
        const full = safeRelative(run.implementation!.workspace, rel);
        return fs.existsSync(full) && fs.statSync(full).isFile()
          ? { path: rel, contents: fs.readFileSync(full, "utf8") }
          : null;
      })
      .filter((file): file is { path: string; contents: string } => Boolean(file));
    await stopPreview(run.id);
    const built = await buildSandbox({
      root: run.implementation.workspace,
      ticket: run.ticket,
      policy,
      architecture: run.architecture,
      files: modelFiles,
    });
    const attached = copyAttachmentsIntoWorkspace(root, run.id, built.workspace, run.ticket.attachments);
    for (const file of preserved) {
      const full = safeRelative(built.workspace, file.path);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, file.contents, "utf8");
    }
    const removed = new Set(removedEditPaths(run.architecture.markdown).filter((rel) => rel !== "architecture.md"));
    for (const rel of removed) {
      const full = safeRelative(built.workspace, rel);
      if (fs.existsSync(full) && fs.statSync(full).isFile()) fs.rmSync(full);
    }
    run.implementation = {
      ...run.implementation,
      workspace: built.workspace,
      files: [...new Set([...built.files, ...attached, ...preserved.map((file) => file.path)])].filter(
        (file) => !removed.has(file)
      ),
      secretsScan: { clean: built.findings.length === 0, findings: built.findings },
      license: built.license,
      pullRequestDetail: "The branch was updated from the approved plan. Raise the pull request when the app looks right.",
    };
    run.checks = [];
    run.failureCode = undefined;
    run.failureMessage = undefined;
    run.status = built.findings.length ? "failed" : "code_review";
    if (built.findings.length) {
      run.failureCode = "secrets";
      run.failureMessage = "Secrets scan found material that cannot be committed";
    }
    log(run, "The approved plan is now on the same branch. No pull request yet.");
    const reply = "The code on this branch now follows the approved plan. Stop the app, then start it again.";
    rememberChat(run, "shipdeck", reply);
    return {
      run: await persist(run),
      reply,
    };
  }

  return {
    store,

    sampleTicket(): DeliveryTicket {
      return structuredClone(SAMPLE_DELIVERY_TICKET);
    },

    async loadJira(issueKey: string): Promise<DeliveryTicket> {
      const key = issueKey.trim();
      if (!key) throw new DeliveryError("A Jira key is required", 400, "ticket");
      const policy = store.getPolicy();
      const secrets = store.getSecrets();
      if (!policy.jira.siteUrl.trim() || !secrets.jiraToken) {
        throw new DeliveryError(
          "Save the Jira site URL and Jira token in Enterprise policy so Shipdeck can read the ticket",
          400,
          "jira"
        );
      }
      try {
        return await fetchJiraTicket({
          deployment: policy.jira.deployment,
          siteUrl: policy.jira.siteUrl,
          email: policy.jira.accountEmail,
          token: secrets.jiraToken,
          issueKey: key,
          attachmentDir: pendingAttachmentDir(root, key),
        });
      } catch (err) {
        throw new DeliveryError(err instanceof Error ? err.message : String(err), 400, "jira");
      }
    },

    async start(input: StartInput): Promise<{ run: DeliveryRun; duplicate: boolean }> {
      let policy = store.getPolicy();
      const ticket = input.ticket ?? structuredClone(SAMPLE_DELIVERY_TICKET);
      const repoUrl = (input.repoUrl ?? "").trim();
      if (input.changeKind === "existing_repo" && repoUrl && store.getSecrets().gitToken) {
        try {
          const detected = await readProjectRules({
            repoUrl,
            token: store.getSecrets().gitToken ?? "",
            ref: policy.git.defaultBaseBranch,
          });
          if (detected?.allowedLanguages.length && detected.allowedPackageSources.length) {
            policy = store.savePolicy({
              ...policy,
              allowedLanguages: detected.allowedLanguages,
              allowedPackageSources: detected.allowedPackageSources,
              allowedLicenses: detected.allowedLicenses.length ? detected.allowedLicenses : policy.allowedLicenses,
            });
          }
        } catch {
          policy = store.getPolicy();
        }
      }
      assertPolicy(policy, input.mode, input.changeKind, repoUrl, store.getSecrets());
      if (!ticket.key.trim() || !ticket.summary.trim()) {
        throw new DeliveryError("Ticket key and summary are required", 400, "ticket");
      }
      if (input.changeKind === "existing_repo" && input.mode === "live") {
        if (!input.existingTarget) {
          throw new DeliveryError(
            "Fill the existing VM or serverless target so Shipdeck can SSH or update the running service",
            400,
            "existing_target"
          );
        }
        const targetError = existingTargetError(input.existingTarget);
        if (targetError) throw new DeliveryError(targetError, 400, "existing_target");
      }
      const existing = store.findActiveByTicket(ticket.key);
      if (
        existing &&
        (!input.projectId || !existing.projectId || existing.projectId === input.projectId)
      ) {
        return { run: existing, duplicate: true };
      }

      const now = new Date().toISOString();
      const acceptedTarget =
        input.changeKind === "existing_repo" && input.existingTarget
          ? publicExistingTarget(input.existingTarget)
          : undefined;
      const run: DeliveryRun = {
        id: nanoid(12),
        ...(input.projectId ? { projectId: input.projectId } : {}),
        mode: input.mode,
        changeKind: input.changeKind,
        repoUrl,
        ...(acceptedTarget ? { existingTarget: acceptedTarget } : {}),
        status: "architecture_review",
        ticket: {
          key: ticket.key.trim(),
          summary: ticket.summary.trim(),
          description: ticket.description ?? "",
          acceptance: ticket.acceptance ?? [],
          comments: ticket.comments ?? [],
          attachments: ticket.attachments ?? [],
        },
        scope: { inScope: [], outOfScope: [], ambiguities: [], standardsApplied: [] },
        architecture: { markdown: "", technologies: [], components: [], assumptions: [], revision: 0 },
        estimate: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0, assumptions: [] },
        usage: { tokens: 0, costUsd: 0, calls: 0 },
        revisionNotes: [],
        approvals: [],
        checks: [],
        blockedReason: null,
        needsClarification: false,
        rollbackOwner: policy.rollbackOwner,
        logs: [`${input.actor} started ${ticket.key} in ${input.mode} mode`],
        createdAt: now,
        updatedAt: now,
      };
      run.ticket.attachments = promoteTicketAttachments(root, run.ticket.key, run.id, run.ticket.attachments);
      if (run.ticket.attachments.length) {
        log(run, `Ticket attachments: ${run.ticket.attachments.map((item) => item.filename).join(", ")}`);
      }
      if (acceptedTarget && input.existingTarget) {
        store.saveExistingTargetSecrets(run.id, existingTargetSecrets(input.existingTarget));
        log(
          run,
          acceptedTarget.kind === "ssh"
            ? `Existing VM recorded: ${acceptedTarget.user || "ubuntu"}@${acceptedTarget.host}`
            : `Existing ${acceptedTarget.kind.toUpperCase()} service recorded${acceptedTarget.serviceUrl ? `: ${acceptedTarget.serviceUrl}` : acceptedTarget.serviceName ? `: ${acceptedTarget.serviceName}` : ""}.`
        );
      }
      try {
        await planInto(run);
      } catch (err) {
        run.status = "failed";
        run.failureCode = "planner";
        run.failureMessage = err instanceof Error ? err.message : String(err);
        log(run, run.failureMessage);
      }
      return { run: await persist(run), duplicate: false };
    },

    async revise(id: string, note: string, actor: string): Promise<DeliveryRun> {
      const run = store.getRun(id);
      if (!run) throw new DeliveryError("Delivery run not found", 404, "not_found");
      if (run.status !== "architecture_review") {
        throw new DeliveryError("Architecture can only be revised while it is waiting for approval", 409, "phase");
      }
      const text = note.trim();
      if (!text) throw new DeliveryError("A revision note is required", 400, "note");
      run.revisionNotes.push(text);
      log(run, `${actor} requested changes: ${text}`);
      try {
        await planInto(run);
      } catch (err) {
        run.status = "failed";
        run.failureCode = "planner";
        run.failureMessage = err instanceof Error ? err.message : String(err);
        log(run, run.failureMessage);
      }
      return persist(run);
    },

    async setExistingTarget(id: string, input: DeliveryExistingTargetInput, actor: string): Promise<DeliveryRun> {
      const run = store.getRun(id);
      if (!run) throw new DeliveryError("Delivery run not found", 404, "not_found");
      if (run.changeKind !== "existing_repo") {
        throw new DeliveryError("Only an existing-repository ticket can store a live VM or serverless target", 400, "change_kind");
      }
      if (!deliveryRunActive(run.status)) {
        throw new DeliveryError("This run is already finished", 409, "terminal");
      }
      const targetError = existingTargetError(input);
      if (targetError) throw new DeliveryError(targetError, 400, "existing_target");
      run.existingTarget = publicExistingTarget(input);
      store.saveExistingTargetSecrets(run.id, existingTargetSecrets(input));
      log(
        run,
        `${actor} saved the existing ${run.existingTarget.kind === "ssh" ? `VM ${run.existingTarget.user || "ubuntu"}@${run.existingTarget.host}` : `${run.existingTarget.kind.toUpperCase()} service`}.`
      );
      return persist(run);
    },

    async decide(id: string, gate: DeliveryGate, action: DeliveryDecisionAction, actor: string, note?: string): Promise<DeliveryRun> {
      const run = store.getRun(id);
      if (!run) throw new DeliveryError("Delivery run not found", 404, "not_found");
      const retryTests = run.status === "failed" && run.failureCode === "tests" && gate === "code_review";
      const retryCode = run.status === "failed" && run.failureCode === "codegen" && gate === "architecture" && action === "approve";
      if (run.pendingRevision && gate === "code_review" && (action === "approve" || action === "skip")) {
        throw new DeliveryError(
          "Approve the revised plan in the workbench before raising the pull request",
          409,
          "pending_plan"
        );
      }
      if (!deliveryRunActive(run.status) && !retryTests && !retryCode) {
        throw new DeliveryError("This run is already finished", 409, "terminal");
      }
      if (run.status !== GATES[gate] && !retryTests && !retryCode) {
        throw new DeliveryError(`The ${gate} gate is not open`, 409, "phase");
      }
      if (action === "skip" && gate !== "code_review") {
        throw new DeliveryError("Skip is only available on the test bar", 400, "skip");
      }
      const policy = store.getPolicy();
      run.approvals.push({
        gate,
        action,
        actor,
        at: new Date().toISOString(),
        note: note?.trim() || undefined,
      });
      if (action === "reject") {
        run.status = "rejected";
        log(run, `${actor} rejected the ${gate} gate`);
        return persist(run);
      }

      if (gate === "architecture") {
        if (run.needsClarification) {
          throw new DeliveryError("Answer the open questions with a revision before approval", 409, "clarification");
        }
        run.estimate = estimateFromArchitecture({
          ticket: run.ticket,
          policy,
          architecture: run.architecture,
          pending: false,
        });
        log(
          run,
          `Architecture forecast ${run.estimate.totalTokens.toLocaleString()} tokens / $${run.estimate.costUsd.toFixed(2)} from the approved flow (${run.estimate.assumptions[0] ?? "architecture.md"}).`
        );
        const blocked = capReason(run.estimate, policy);
        run.blockedReason = blocked;
        if (blocked) {
          throw new DeliveryError(
            blocked === "token_cap"
              ? "Raise the token cap or narrow the ticket before approval"
              : "Raise the cost cap or narrow the ticket before approval",
            409,
            blocked
          );
        }
        const code = codeSlot(policy);
        const codeLabel = modelProviderById(code.provider).label;
        log(run, `${actor} approved the architecture. The plan does not need approving again.`);
        run.status = "writing_code";
        run.failureCode = undefined;
        run.failureMessage = undefined;
        const impl = codeImplementationKind(code.provider);
        if (run.mode === "live" && impl === "cursor-cloud") {
          log(run, `Now: calling ${codeLabel} to implement the ticket. This can take a minute.`);
        } else if (run.mode === "live" && impl === "chat-files") {
          log(run, `Now: calling ${codeLabel} to write the project files. This can take a minute.`);
        } else if (run.mode === "live") {
          throw new DeliveryError(
            `${codeLabel} is listed but Live code is not wired. Pick Azure OpenAI, OpenAI, Anthropic, Claude Code, Codex, or Cursor.`,
            400,
            "code_model"
          );
        } else {
          log(run, "Now: writing the project folder from the ticket (simulate, no model call).");
        }
        await persist(run);
        const planInput: PlannerInput = {
          ticket: run.ticket,
          policy,
          revisionNotes: run.revisionNotes,
          changeKind: run.changeKind,
          repoUrl: run.repoUrl,
          mode: run.mode,
          architectureMarkdown: run.architecture.markdown,
        };
        let agentDetail = "";
        let modelFiles: Array<{ path: string; contents: string }> | null = null;
        const keepExistingRepo =
          run.changeKind === "existing_repo" && run.mode === "live" && Boolean(run.repoUrl.trim()) && !opts?.projectFiles;
        try {
          if (keepExistingRepo) {
            const git = gitLogin();
            if (!git.token.trim()) {
              throw new DeliveryError(
                "Save a Git token so the existing repository can be copied before the change.",
                400,
                "git"
              );
            }
            log(
              run,
              `Now: copying ${run.repoUrl}. The application already in that repository stays. This ticket edits only the part it names.`
            );
            await persist(run);
            const placed = await placeExistingRepository({
              workspace: workspaceFor(run.id),
              repoUrl: run.repoUrl,
              token: git.token,
              branch: policy.git.defaultBaseBranch || "main",
              ticket: run.ticket,
              architectureMarkdown: run.architecture.markdown,
              impactAnalysis: run.architecture.impactAnalysis,
              policy,
              apiKey: codeKey(policy, store.getSecrets()),
            });
            log(
              run,
              `Existing repository copied (${placed.files.length} files). Edited ${placed.changed.join(", ")}. Everything else is unchanged.`
            );
            modelFiles = null;
          } else if (opts?.projectFiles) {
            modelFiles = await opts.projectFiles(planInput);
          } else if (run.mode === "live" && impl === "chat-files") {
            modelFiles = await generateProjectFiles(
              planInput,
              codeKey(policy, store.getSecrets()),
              async (usage, filePath) => {
                applyLiveUsage(run, usage);
                const tokens = usage.totalTokens || usage.inputTokens + usage.outputTokens;
                log(
                  run,
                  tokens
                    ? `Live: ${filePath} used ${tokens.toLocaleString()} tokens`
                    : `Live: ${filePath} written. Vendor did not return token usage.`
                );
                await persist(run);
              }
            );
            log(run, `${codeLabel} returned ${modelFiles.length} files.`);
            await persist(run);
          }
          let built: { workspace: string; files: string[]; license: string; findings: string[] };
          if (keepExistingRepo) {
            built = {
              workspace: workspaceFor(run.id),
              files: listWorkspaceFiles(workspaceFor(run.id)),
              license: policy.allowedLicenses[0] || "existing",
              findings: scanWorkspace(workspaceFor(run.id)),
            };
          } else {
          log(run, "Now: writing the project folder on this machine.");
          await persist(run);
          built = await buildSandbox({
            root: workspaceFor(run.id),
            ticket: run.ticket,
            policy,
            architecture: run.architecture,
            files: modelFiles ?? undefined,
          });
          }
          const attached = copyAttachmentsIntoWorkspace(root, run.id, built.workspace, run.ticket.attachments);
          if (attached.length) {
            built.files = [...new Set([...built.files, ...attached])];
            log(run, `Copied ${attached.length} ticket attachment(s) into the project folder.`);
          }
          if (!keepExistingRepo && run.mode === "live" && impl === "cursor-cloud" && !opts?.projectFiles) {
            log(run, "Now: ensuring the GitHub repo has a main branch (empty repos have none).");
            await persist(run);
            await ensureGithubBaseBranch({
              repoUrl: run.repoUrl,
              token: store.getSecrets().gitToken ?? "",
              base: policy.git.defaultBaseBranch,
            });
            log(run, `Now: waiting for ${codeLabel} (${code.endpoint || "agent endpoint"}).`);
            await persist(run);
            const launched = await runFolderAgent({
              slot: code,
              apiKey: codeKey(policy, store.getSecrets()),
              workspace: built.workspace,
              repoUrl: run.repoUrl,
              baseBranch: policy.git.defaultBaseBranch,
              prompt: [
                READ_THE_WHOLE_TICKET,
                customerTicketLines(run.ticket),
                run.architecture.markdown,
                run.ticket.attachments.length
                  ? "Ticket attachments are in ticket-attachments/. Use them when they show the current screen or the requested change."
                  : "",
                "Build what the ticket asks. Fixture data only. Include GET /health.",
              ]
                .filter(Boolean)
                .join("\n"),
            });
            agentDetail = launched.detail;
            applyLiveUsage(run, launched.usage);
            log(run, agentDetail || `${codeLabel} finished.`);
            await persist(run);
            if (launched.files?.length) {
              const rewritten = await buildSandbox({
                root: built.workspace,
                ticket: run.ticket,
                policy,
                architecture: run.architecture,
                files: launched.files,
              });
              const rewrittenAttached = copyAttachmentsIntoWorkspace(
                root,
                run.id,
                rewritten.workspace,
                run.ticket.attachments
              );
              built.files = [...new Set([...rewritten.files, ...rewrittenAttached])];
              built.findings = rewritten.findings;
              built.license = rewritten.license;
            } else {
              built.files = listWorkspaceFiles(built.workspace);
              built.findings = scanWorkspace(built.workspace);
            }
          }
          log(run, `Project folder ready (${built.files.length} files).`);
          await persist(run);
        const branch = `shipdeck/${run.ticket.key}`;
        let pullRequestUrl: string | undefined;
        let pullRequestDetail = "Pull request is prepared locally. Auto-open is off, so nothing was pushed.";
        if (run.mode === "simulate") {
          pullRequestUrl = `simulate://pull/${run.ticket.key}`;
          pullRequestDetail = `Project folder ${built.workspace} is ready. Simulate mode did not push it to Git.`;
        } else if (policy.git.autoOpenPr) {
          pullRequestDetail =
            "The branch is ready in the workbench. The pull request opens after you say the app looks right.";
          log(run, "Code is on the branch. Open the workbench before raising the pull request.");
        }
        run.implementation = {
          workspace: built.workspace,
          branch,
          files: built.files,
          secretsScan: { clean: built.findings.length === 0, findings: built.findings },
          license: built.license,
          packageSources: policy.allowedPackageSources,
          fixturesOnly: true,
          pullRequestUrl,
          pullRequestDetail,
        };
        if (built.findings.length) {
          run.status = "failed";
          run.failureCode = "secrets";
          run.failureMessage = "Secrets scan found material that cannot be committed";
          log(run, run.failureMessage);
          return persist(run);
        }
        run.status = "code_review";
        if (agentDetail) log(run, agentDetail);
        log(
          run,
          `Project folder written at ${built.workspace} using ${codeLabel}. Open the workbench, then proceed for testing.`
        );
        return persist(run);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          run.status = "failed";
          run.failureCode = "codegen";
          run.failureMessage = "The plan is already approved. The code was not written. Press Write the code again.";
          log(run, `The code was not written. The plan stays approved. ${message}`);
          await persist(run);
          throw new DeliveryError(run.failureMessage, 502, "codegen");
        }
      }

      if (gate === "code_review") {
        const implementation = run.implementation;
        if (!implementation || !implementation.secretsScan.clean) {
          throw new DeliveryError("Code review is blocked until the secrets scan is clean", 409, "secrets");
        }
        if (action === "approve" && !testBarPassed(run)) {
          throw new DeliveryError("Run the tests in the test bench before raising the pull request", 409, "tests_first");
        }
        if (action === "skip") {
          run.failureCode = undefined;
          run.failureMessage = undefined;
          run.checks = DELIVERY_TEST_BAR.map((name) => ({
            name,
            status: "skipped" as const,
            detail: "Skipped — use your own test automation if needed",
          }));
          run.status = "deploy_approval";
          log(run, `${actor} skipped the test bar. Waiting for deploy approval.`);
          return persist(run);
        }
        run.status = "code_review";
        run.failureCode = undefined;
        run.failureMessage = undefined;
        const aligned = alignGeneratedProject(implementation.workspace);
        implementation.files = aligned;
        if (run.mode === "live" && policy.git.autoOpenPr && run.repoUrl) {
          const git = gitLogin();
          if (!git.token) {
            throw new DeliveryError(`${git.name} has no GitHub token. Open logins, paste the token, then press Save.`, 400, "git");
          }
          log(run, `Now: updating the GitHub pull request using ${git.name}.`);
          await persist(run);
          const files = aligned.map((rel) => ({
            path: rel,
            contents: fs.readFileSync(path.join(implementation.workspace, rel), "utf8"),
          }));
          const opened = await openGithubPullRequest({
            repoUrl: run.repoUrl,
            token: git.token,
            base: policy.git.defaultBaseBranch,
            branch: implementation.branch,
            title: `${run.ticket.key} ${run.ticket.summary}`,
            body: run.architecture.markdown.slice(0, 4000),
            files,
          });
          implementation.pullRequestUrl = opened.url;
          implementation.pullRequestDetail = `Pull request created: ${opened.url}`;
          log(run, `GitHub pull request updated: ${opened.url}`);
        }
        log(run, `${actor} raised the pull request after the tests passed.`);
        run.status = "deploy_approval";
        log(run, "The pull request is ready. Waiting for deploy approval.");
        return persist(run);
      }

      log(run, `${actor} approved deploy to ${policy.devTargetLabel}`);
      const createdConnections: DeliveryCreatedConnection[] = [];
      if (run.mode === "live" && opts?.ensureGitConnection && run.repoUrl.trim()) {
        const git = await opts.ensureGitConnection({
          name: `${run.ticket.key} GitHub`,
          url: run.repoUrl,
          token: store.getSecrets().gitToken,
        });
        createdConnections.push({
          id: git.id,
          name: git.name,
          type: git.type ?? "git",
          created: git.created,
        });
        log(run, git.created ? `Created Git connection ${git.name}.` : `Git connection already saved: ${git.name}.`);
      } else if (run.mode === "live" && !run.repoUrl.trim()) {
        log(run, "No repository URL on this run, so no Git connection was added.");
      }
      if (run.existingTarget && opts?.ensureExistingTargetConnection) {
        const secrets = store.getExistingTargetSecrets(run.id);
        if (!run.existingTarget.hasAuth && !Object.keys(secrets).length) {
          log(run, "No VM key/password or serverless credentials were stored, so no deploy connection was added.");
        } else {
          const target = await opts.ensureExistingTargetConnection({
            name: existingConnectionName(run.ticket.key, run.existingTarget.kind, run.existingTarget),
            kind: run.existingTarget.kind,
            target: run.existingTarget,
            secrets,
          });
          createdConnections.push(target);
          log(
            run,
            target.created
              ? `Created ${target.type.toUpperCase()} connection “${target.name}” so the next version can use it.`
              : `Reused ${target.type.toUpperCase()} connection “${target.name}”.`
          );
        }
      }
      const connectionLabel = (type: string) => (type === "git" ? "Git" : type === "ssh" ? "SSH" : type.toUpperCase());
      const connectionNote = createdConnections
        .map((conn) =>
          conn.created
            ? `I created ${connectionLabel(conn.type)} connection “${conn.name}” so you can use it.`
            : `I reused ${connectionLabel(conn.type)} connection “${conn.name}”.`
        )
        .join(" ");
      run.handoff = {
        mode: run.mode,
        pipelineId: policy.pipelineId || null,
        deployRunId: null,
        devTargetLabel: policy.devTargetLabel,
        rollbackOwner: run.rollbackOwner,
        createdConnections,
        message:
          run.mode === "simulate" && !createdConnections.length
            ? "Simulate finished. No cloud was started. Open Connections if you want a later live deploy."
            : `Deploy is approved. ${connectionNote} Open Connections, then Pipeline — attach that connection, set Infra to Use existing, and Run pipeline. Shipdeck will not create a new cloud until you choose.`.replace(
                "  ",
                " "
              ),
      };
      run.status = "completed";
      log(run, run.handoff.message);
      return persist(run);
    },

    workspaceFiles(id: string): { branch: string; changeKind: DeliveryChangeKind; files: string[] } {
      const run = store.getRun(id);
      if (!run?.implementation) throw new DeliveryError("This ticket has no project folder yet", 404, "not_found");
      return {
        branch: run.implementation.branch,
        changeKind: run.changeKind,
        files: listWorkspaceFiles(run.implementation.workspace),
      };
    },

    workspaceFile(id: string, rel: string): { path: string; contents: string } {
      const run = store.getRun(id);
      if (!run?.implementation) throw new DeliveryError("This ticket has no project folder yet", 404, "not_found");
      const full = safeRelative(run.implementation.workspace, rel);
      if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
        throw new DeliveryError("That file is not in the project folder", 404, "not_found");
      }
      if (fs.statSync(full).size > 200_000) {
        throw new DeliveryError("This file is too large to show in the workbench", 413, "too_large");
      }
      return { path: rel.replaceAll("\\", "/"), contents: fs.readFileSync(full, "utf8") };
    },

    async saveWorkspaceFile(
      id: string,
      rel: string,
      contents: string,
      actor: string
    ): Promise<{ run: DeliveryRun; path: string; contents: string; reply: string }> {
      const run = store.getRun(id);
      if (!run?.implementation) throw new DeliveryError("This ticket has no project folder yet", 404, "not_found");
      if (run.pendingRevision) {
        throw new DeliveryError("Approve or reject the revised plan before editing a file", 409, "pending_plan");
      }
      const normalized = rel.replaceAll("\\", "/").replace(/^\/+/, "");
      if (!normalized || normalized.endsWith("/")) {
        throw new DeliveryError("Choose a file to save", 400, "path");
      }
      if (contents.length > 200_000) {
        throw new DeliveryError("This file is too large to save from the workbench", 413, "too_large");
      }
      const findings = scanText(normalized, contents);
      if (findings.length) {
        throw new DeliveryError("Remove the secret from this file before saving", 400, "secrets");
      }
      let full: string;
      try {
        full = safeRelative(run.implementation.workspace, normalized);
      } catch (err) {
        throw new DeliveryError(err instanceof Error ? err.message : String(err), 400, "path");
      }
      if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
        throw new DeliveryError("That file is not in the project folder", 404, "not_found");
      }
      const previous = readTextFile(full);
      fs.writeFileSync(full, contents, "utf8");
      if (normalized === "architecture.md") {
        run.architecture.markdown = contents;
      } else if (normalized === "impact-analysis.md") {
        run.architecture.impactAnalysis = contents;
      } else {
        const archPath = safeRelative(run.implementation.workspace, "architecture.md");
        const current = fs.existsSync(archPath) ? fs.readFileSync(archPath, "utf8") : run.architecture.markdown;
        const next = upsertLatestEdit(current, { actor, path: normalized, contents });
        fs.mkdirSync(path.dirname(archPath), { recursive: true });
        fs.writeFileSync(archPath, next, "utf8");
        run.architecture.markdown = next;
      }
      const comment = `${actor} edited ${normalized}. architecture.md matches this saved file.`;
      run.ticket.comments = [...(run.ticket.comments ?? []), comment];
      const note = `${actor} saved ${normalized}. Keep that saved file; the latest edits in architecture.md are current.`;
      if (!run.revisionNotes.includes(note)) run.revisionNotes.push(note);
      let reply = "Saved. architecture.md now matches this file. Stop the app, then start it, to see the change.";
      const policy = store.getPolicy();
      const token = store.getSecrets().jiraToken;
      if (run.mode === "live" && policy.jira.siteUrl.trim() && token) {
        try {
          await commentOnJira({
            deployment: policy.jira.deployment,
            siteUrl: policy.jira.siteUrl,
            email: policy.jira.accountEmail,
            token,
            issueKey: run.ticket.key,
            text: comment,
          });
          reply = "Saved. architecture.md matches this file, and the edit is on the Jira ticket. Stop the app, then start it, to see the change.";
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          reply = `Saved. architecture.md matches this file. Jira did not take the comment (${reason}).`;
        }
      } else if (run.mode !== "live") {
        reply = "Saved. architecture.md matches this file. Practice mode keeps the note in Shipdeck. Stop the app, then start it, to see the change.";
      }
      log(run, comment);
      rememberChat(run, "shipdeck", reply, [fileChange(normalized, previous, contents)]);
      return { run: await persist(run), path: normalized, contents, reply };
    },

    async createWorkspaceFile(
      id: string,
      rel: string,
      contents: string,
      actor: string
    ): Promise<{ run: DeliveryRun; path: string; contents: string; reply: string }> {
      const run = store.getRun(id);
      if (!run?.implementation) throw new DeliveryError("This ticket has no project folder yet", 404, "not_found");
      if (run.pendingRevision) {
        throw new DeliveryError("Approve or reject the revised plan before adding a file", 409, "pending_plan");
      }
      const normalized = workspaceRel(rel);
      if (contents.length > 200_000) {
        throw new DeliveryError("This file is too large to add from the workbench", 413, "too_large");
      }
      const findings = scanText(normalized, contents);
      if (findings.length) throw new DeliveryError("Remove the secret from this file before adding it", 400, "secrets");
      const full = workspaceFull(run.implementation.workspace, normalized);
      if (fs.existsSync(full)) throw new DeliveryError("That file is already in the project. Open it and save.", 409, "exists");
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, contents, "utf8");
      const noted = noteArchitecture(run, actor, normalized, contents, false);
      const comment = `${actor} added ${normalized}. architecture.md matches this new file.`;
      const reply = await publishFileNote(
        run,
        comment,
        "Added. architecture.md matches this file. Practice mode keeps the note in Shipdeck.",
        "Added. architecture.md matches this file, and the new file is on the Jira ticket.",
        "Added. architecture.md matches this file."
      );
      const savedNote = `${actor} added ${normalized}. Keep that file; the latest edits in architecture.md are current.`;
      if (!run.revisionNotes.includes(savedNote)) run.revisionNotes.push(savedNote);
      run.implementation.files = [...new Set([...(run.implementation.files ?? []), normalized, "architecture.md"])];
      void noted;
      rememberChat(run, "shipdeck", reply, [fileChange(normalized, "", contents)]);
      return { run: await persist(run), path: normalized, contents, reply };
    },

    async deleteWorkspaceFile(
      id: string,
      rel: string,
      actor: string
    ): Promise<{ run: DeliveryRun; path: string; reply: string }> {
      const run = store.getRun(id);
      if (!run?.implementation) throw new DeliveryError("This ticket has no project folder yet", 404, "not_found");
      if (run.pendingRevision) {
        throw new DeliveryError("Approve or reject the revised plan before deleting a file", 409, "pending_plan");
      }
      const normalized = workspaceRel(rel);
      if (normalized === "architecture.md" || normalized === "impact-analysis.md") {
        throw new DeliveryError(`${normalized} stays. It is the current plan.`, 400, "path");
      }
      const full = workspaceFull(run.implementation.workspace, normalized);
      if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
        throw new DeliveryError("That file is not in the project folder", 404, "not_found");
      }
      const previous = readTextFile(full);
      fs.rmSync(full);
      noteArchitecture(run, actor, normalized, "", true);
      const comment = `${actor} deleted ${normalized}. architecture.md no longer includes that file.`;
      const reply = await publishFileNote(
        run,
        comment,
        "Deleted. architecture.md matches the branch. Practice mode keeps the note in Shipdeck.",
        "Deleted. architecture.md matches the branch, and the removal is on the Jira ticket.",
        "Deleted. architecture.md matches the branch."
      );
      const savedNote = `${actor} deleted ${normalized}. Leave that file out; the latest edits in architecture.md are current.`;
      if (!run.revisionNotes.includes(savedNote)) run.revisionNotes.push(savedNote);
      run.implementation.files = (run.implementation.files ?? []).filter((file) => file !== normalized);
      rememberChat(run, "shipdeck", reply, [fileChange(normalized, previous, "")]);
      return { run: await persist(run), path: normalized, reply };
    },

    preview(id: string) {
      const run = store.getRun(id);
      if (!run?.implementation) throw new DeliveryError("This ticket has no project folder yet", 404, "not_found");
      return { workspace: run.implementation.workspace, current: previewFor(id) };
    },

    async runTests(id: string, actor: string): Promise<{ run: DeliveryRun; reply: string }> {
      const run = store.getRun(id);
      if (!run) throw new DeliveryError("Delivery run not found", 404, "not_found");
      if (!run.implementation) throw new DeliveryError("This ticket has no project folder yet", 404, "not_found");
      if (run.pendingRevision) {
        throw new DeliveryError("Approve or reject the revised plan before running the tests", 409, "pending_plan");
      }
      if (run.status !== "code_review" && !(run.status === "failed" && run.failureCode === "tests")) {
        throw new DeliveryError("Tests wait until the project folder is ready and before the pull request", 409, "phase");
      }
      await stopPreview(run.id).catch(() => undefined);
      log(run, `${actor} started the test bar.`);
      const checks = await runSandboxChecks(run.implementation.workspace);
      run.checks = checks;
      const failed = checks.filter((check) => check.status !== "passed");
      for (const check of checks) log(run, `${check.name}: ${check.status} — ${check.detail}`);
      if (failed.length) {
        run.status = "failed";
        run.failureCode = "tests";
        run.failureMessage = failed.map((check) => check.name).join(", ") + " failed";
        return {
          run: await persist(run),
          reply: `${run.failureMessage}. Open the test bench, fix the test cases, then run the tests again.`,
        };
      }
      run.status = "code_review";
      run.failureCode = undefined;
      run.failureMessage = undefined;
      log(run, "Lint, unit, and integration passed. The pull request can be raised.");
      return {
        run: await persist(run),
        reply: "Tests passed. You can raise the pull request.",
      };
    },

    async workbench(
      id: string,
      kind: "fix" | "new_ask" | "code_edit" | "approve_plan" | "reject_plan",
      message: string,
      actor: string,
      images: Array<{ mimeType: string; base64: string }> = [],
      role: "code" | "test" = "code"
    ): Promise<{ run: DeliveryRun; reply: string }> {
      const run = store.getRun(id);
      if (!run) throw new DeliveryError("Delivery run not found", 404, "not_found");
      if (role === "test" && kind === "fix") {
        throw new DeliveryError("Testers change test files. Use the test bench edit, not a new architecture plan.", 409, "tester_scope");
      }
      if (kind === "approve_plan" || kind === "reject_plan") {
        if (!run.pendingRevision) throw new DeliveryError("There is no revised plan waiting", 409, "pending_plan");
        if (kind === "reject_plan") {
          const note = run.pendingRevision.note;
          run.pendingRevision = undefined;
          const index = run.revisionNotes.lastIndexOf(note);
          if (index >= 0) run.revisionNotes.splice(index, 1);
          log(run, `${actor} rejected the revised plan. The current page stays.`);
          const reply = "Rejected. The current page and the code stay as they are.";
          rememberChat(run, "shipdeck", reply);
          return { run: await persist(run), reply };
        }
        run.scope = run.pendingRevision.scope;
        run.architecture = run.pendingRevision.architecture;
        run.estimate = run.pendingRevision.estimate;
        run.needsClarification = false;
        run.blockedReason = null;
        run.pendingRevision = undefined;
        log(run, `${actor} approved the revised plan.`);
        return writeApprovedBranch(run);
      }
      const text = message.trim() || (images.length ? "See the attached screenshot." : "");
      if (!text) throw new DeliveryError("Say what should change", 400, "note");
      if (kind === "new_ask") {
        const comment = `Out of scope for ${run.ticket.key}. This is a new ask, not a change to the current ticket: ${text}${
          images.length ? ` ${images.length} screenshot${images.length === 1 ? "" : "s"} attached in the workbench.` : ""
        }`;
        run.ticket.comments = [...(run.ticket.comments ?? []), comment];
        let reply = "Saved on this ticket. It is not part of the current work, so the code was left as it is.";
        const policy = store.getPolicy();
        const token = store.getSecrets().jiraToken;
        if (run.mode !== "live") {
          reply = "Saved on this ticket. Practice mode keeps the comment in Shipdeck and leaves the code as it is.";
        } else if (policy.jira.siteUrl.trim() && token) {
          try {
            await commentOnJira({
              deployment: policy.jira.deployment,
              siteUrl: policy.jira.siteUrl,
              email: policy.jira.accountEmail,
              token,
              issueKey: run.ticket.key,
              text: comment,
            });
            reply = "Written on the Jira ticket as a new ask. The current branch was not changed.";
          } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            reply = `Saved on this ticket. Jira did not take the comment (${reason}).`;
          }
        } else {
          reply = "Saved on this ticket. Jira is not connected, so the comment stays in Shipdeck.";
        }
        log(run, `${actor} asked for something new: ${text}`);
        const shown = [text, images.length ? `${images.length} screenshot${images.length === 1 ? "" : "s"}` : ""]
          .filter(Boolean)
          .join("\n");
        rememberChat(run, "you", shown);
        rememberChat(run, "shipdeck", reply);
        return { run: await persist(run), reply };
      }

      if (!run.implementation) throw new DeliveryError("This ticket has no project folder yet", 404, "not_found");
      const implementation = run.implementation;
      if (
        kind !== "code_edit" &&
        run.status !== "code_review" &&
        !(run.status === "failed" && run.failureCode === "tests")
      ) {
        throw new DeliveryError("Changes wait until the project folder is ready and before the pull request", 409, "phase");
      }
      if (run.pendingRevision) {
        throw new DeliveryError("Approve or reject the revised plan before asking for another change", 409, "pending_plan");
      }
      if (kind === "code_edit") {
        const code = codeSlot(store.getPolicy());
        if (isFolderAgent(code.provider)) {
          throw new DeliveryError("Editing files needs a chat code model.", 400, "code_model");
        }
        const present = listWorkspaceFiles(run.implementation.workspace).filter((rel) => {
          if (rel === "architecture.md") return false;
          return role !== "test" || isTestFile(rel);
        });
        if (role === "test" && !present.length) {
          throw new DeliveryError("There are no test files for the tester to change", 404, "not_found");
        }
        const current = present
          .map((rel) => ({ path: rel, contents: fs.readFileSync(workspaceFull(run.implementation!.workspace, rel), "utf8") }))
          .filter((file) => file.contents.length <= 12_000);
        const tagged = taggedFiles(text, present);
        const ordered = [...current].sort((a, b) => Number(tagged.includes(b.path)) - Number(tagged.includes(a.path)));
        const scoped =
          role === "test"
            ? `${text}\nEdit only test files. Do not change application source, HTML, or architecture.md. When the person says a test is wrong, change the test so it checks that behavior.`
            : text;
        const instruction = tagged.length ? `${scoped}\nTagged files: ${tagged.join(", ")}. Change those files.` : scoped;
        const key = codeKey(store.getPolicy(), store.getSecrets());
        let edited: Array<{ path: string; contents: string }>;
        if (opts?.editFiles) {
          edited = await opts.editFiles(instruction, ordered);
        } else {
          const result = await editProjectFiles(store.getPolicy(), key, instruction, ordered, images);
          applyLiveUsage(run, result.usage);
          const tokens = result.usage.totalTokens || result.usage.inputTokens + result.usage.outputTokens;
          log(
            run,
            tokens
              ? `Code model edit used ${tokens.toLocaleString()} tokens.`
              : "Code model edit finished. The vendor did not report token usage on this call."
          );
          edited = result.files;
        }
        const beforeEdit = new Map<string, string>();
        const applyEdit = (files: Array<{ path: string; contents: string }>) => {
          const changed: string[] = [];
          const edits: WorkbenchFileChange[] = [];
          for (const file of files) {
            const normalized = workspaceRel(file.path);
            if (normalized === "architecture.md") continue;
            if (role === "test" && !isTestFile(normalized)) continue;
            if (file.contents.length > 200_000) {
              throw new DeliveryError("The code model returned a file that is too large to save", 413, "too_large");
            }
            if (scanText(normalized, file.contents).length) {
              throw new DeliveryError("The code model put a secret in a file. The edit was not saved.", 400, "secrets");
            }
            const full = workspaceFull(implementation.workspace, normalized);
            if (!beforeEdit.has(normalized)) beforeEdit.set(normalized, readTextFile(full));
            fs.mkdirSync(path.dirname(full), { recursive: true });
            fs.writeFileSync(full, file.contents, "utf8");
            noteArchitecture(run, actor, normalized, file.contents, false);
            changed.push(normalized);
            edits.push(fileChange(normalized, beforeEdit.get(normalized) ?? "", file.contents));
          }
          return { changed, edits };
        };
        let { changed, edits } = applyEdit(edited);
        if (!changed.length) {
          throw new DeliveryError(
            role === "test"
              ? "The code model did not change a test file. Say which test to change."
              : "The code model did not change a file. Say which text to change.",
            400,
            "edit"
          );
        }
        const savedText = () =>
          edits.map((edit) => readTextFile(workspaceFull(run.implementation!.workspace, edit.path)));
        if (!reportWasAddressed(text, edits, savedText())) {
          const again = present
            .map((rel) => ({ path: rel, contents: fs.readFileSync(workspaceFull(run.implementation!.workspace, rel), "utf8") }))
            .filter((file) => file.contents.length <= 12_000);
          const followUp = `${instruction}\n${followUpFor(text, edits, savedText())}`;
          try {
            let second: Array<{ path: string; contents: string }>;
            if (opts?.editFiles) {
              second = await opts.editFiles(followUp, again);
            } else {
              const result = await editProjectFiles(store.getPolicy(), key, followUp, again, images);
              applyLiveUsage(run, result.usage);
              second = result.files;
            }
            const next = applyEdit(second);
            if (next.changed.length) {
              changed = [...new Set([...changed, ...next.changed])];
              const merged = new Map(edits.map((edit) => [edit.path, edit]));
              for (const edit of next.edits) merged.set(edit.path, edit);
              edits = [...merged.values()];
            }
          } catch {
            // Keep the first edit. The reply says the data was not changed.
          }
        }
        run.implementation.files = [...new Set([...(run.implementation.files ?? []), ...changed, "architecture.md"])];
        const listed = changed.join(", ");
        const note = `${actor} edited ${listed} with the code model. Keep those files; the latest edits in architecture.md are current.`;
        if (!run.revisionNotes.includes(note)) run.revisionNotes.push(note);
        await stopPreview(run.id).catch(() => undefined);
        const reply = await publishFileNote(
          run,
          `${actor} used the code model to edit ${listed}. architecture.md matches these files.`,
          "Edited the files. architecture.md matches them. Practice mode keeps the note in Shipdeck. Stop the app, then start it, to see the change.",
          "Edited the files. architecture.md matches them, and the edit is on the Jira ticket. Stop the app, then start it, to see the change.",
          "Edited the files. architecture.md matches them. Stop the app, then start it, to see the change."
        );
        const tokens = run.usage.tokens;
        const recorded =
          tokens > 0 ? ` Recorded usage on this ticket is ${tokens.toLocaleString()} tokens.` : "";
        const nothing = edits.every((edit) => edit.added.length === 0 && edit.removed.length === 0);
        const after = savedText();
        const missed = !reportWasAddressed(text, edits, after);
        const summary = edits.map((edit, index) => changeSummary(edit, after[index] ?? "")).join(" ");
        const lead = nothing ? `No change in ${listed}.` : `Changed ${listed}.`;
        const outcome = missed
          ? `The page was not fixed. ${summary}`
          : `${reply} ${summary}`;
        const fullReply = `${lead}\n${outcome}${recorded}`;
        const shown = [text, images.length ? `${images.length} screenshot${images.length === 1 ? "" : "s"}` : ""]
          .filter(Boolean)
          .join("\n");
        rememberChat(run, "you", shown);
        rememberChat(run, "shipdeck", fullReply, edits);
        return { run: await persist(run), reply: fullReply };
      }
      const kept = {
        scope: structuredClone(run.scope),
        architecture: structuredClone(run.architecture),
        estimate: structuredClone(run.estimate),
        needsClarification: run.needsClarification,
        blockedReason: run.blockedReason,
      };
      run.revisionNotes.push(text);
      log(run, `${actor} asked to change this ticket: ${text}`);
      await planInto(run);
      run.architecture.markdown = carryLatestEdits(kept.architecture.markdown, run.architecture.markdown);
      if (run.needsClarification || run.blockedReason) {
        const reply = run.needsClarification
          ? "The plan needs a clearer note before it can be approved."
          : "The change is over the token or cost cap, so the current page was left as it is.";
        run.scope = kept.scope;
        run.architecture = kept.architecture;
        run.estimate = kept.estimate;
        run.needsClarification = kept.needsClarification;
        run.blockedReason = kept.blockedReason;
        run.revisionNotes.pop();
        rememberChat(run, "you", text);
        rememberChat(run, "shipdeck", reply);
        return { run: await persist(run), reply };
      }
      run.pendingRevision = {
        note: text,
        scope: run.scope,
        architecture: run.architecture,
        estimate: run.estimate,
      };
      run.scope = kept.scope;
      run.architecture = kept.architecture;
      run.estimate = kept.estimate;
      run.needsClarification = kept.needsClarification;
      run.blockedReason = kept.blockedReason;
      log(run, "Revised plan is waiting in the workbench. The current page is unchanged.");
      const reply = "The revised plan is ready. Approve it to change the code, or reject it to keep this page.";
      rememberChat(run, "you", text);
      rememberChat(run, "shipdeck", reply);
      return {
        run: await persist(run),
        reply,
      };
    },

    async kill(id: string, actor: string): Promise<DeliveryRun> {
      const run = store.getRun(id);
      if (!run) throw new DeliveryError("Delivery run not found", 404, "not_found");
      if (!deliveryRunActive(run.status)) {
        throw new DeliveryError("This run is already finished", 409, "terminal");
      }
      run.status = "killed";
      run.killedBy = actor;
      log(run, `${actor} used the kill switch`);
      return persist(run);
    },
  };
}

export type DeliveryService = ReturnType<typeof createDeliveryService>;
