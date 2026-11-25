import { isFolderAgent, modelProviderById, type ModelSlot } from "@shipdeck/shared";
import { EMPTY_USAGE, readUsage, type ModelUsage } from "./modelClient.js";

function apiOrigin(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    return `${url.protocol}//${url.host}`;
  } catch {
    return "https://api.cursor.com";
  }
}

async function cursorGet(url: string, apiKey: string): Promise<Response> {
  const bearer = await fetch(url, { headers: { authorization: `Bearer ${apiKey}` } });
  if (bearer.ok || bearer.status === 404) return bearer;
  const basic = Buffer.from(`${apiKey}:`).toString("base64");
  return fetch(url, { headers: { authorization: `Basic ${basic}` } });
}

/** Cursor create has no tokens. Poll the usage endpoint the same as Claude/OpenAI replies. */
export async function fetchCursorUsage(opts: {
  endpoint: string;
  apiKey: string;
  agentId: string;
}): Promise<ModelUsage> {
  const id = opts.agentId.trim();
  if (!id || id.startsWith("http")) return { ...EMPTY_USAGE };
  const origin = apiOrigin(opts.endpoint);
  const urls = [`${origin}/v1/agents/${encodeURIComponent(id)}/usage`, `${origin}/v0/agents/${encodeURIComponent(id)}`];
  for (let attempt = 0; attempt < 6; attempt++) {
    for (const url of urls) {
      try {
        const res = await cursorGet(url, opts.apiKey);
        if (!res.ok) continue;
        const usage = readUsage(await res.json());
        if (usage.totalTokens || usage.inputTokens || usage.outputTokens) return usage;
      } catch {
        /* try the next URL */
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
  return { ...EMPTY_USAGE };
}

function explainAgentFailure(label: string, status: number, raw: string, repo: string): string {
  if (/Failed to verify existence of branch/i.test(raw)) {
    return (
      `${label} can see the API key, but it cannot see branch main on ${repo || "the GitHub repo"}. ` +
      `Shipdeck already created that branch with your Git token. ${label} checks GitHub with the GitHub login on this ${label} account, not with Shipdeck’s Git token. ` +
      `In the Cursor dashboard, connect GitHub and allow this repository, then click Approve architecture again. ` +
      `Or change Case 2 to Azure OpenAI, save policy, and approve.`
    );
  }
  return `${label} agent request failed (${status}). ${raw.slice(0, 400)}`;
}

function cursorAgentBody(endpoint: string, prompt: string, repoUrl: string, ref: string) {
  if (!repoUrl || !/github\.com[:/]/i.test(repoUrl)) {
    throw new Error("Cursor needs a GitHub repository URL. Fill Repository URL on the Build page.");
  }
  if (endpoint.includes("/v1/")) {
    return {
      prompt: { text: prompt },
      repos: [{ url: repoUrl, startingRef: ref }],
      autoCreatePR: false,
    };
  }
  return {
    prompt: { text: prompt },
    source: { repository: repoUrl, ref },
    target: { autoCreatePr: false },
  };
}

export async function runFolderAgent(opts: {
  slot: ModelSlot;
  apiKey: string;
  workspace: string;
  prompt: string;
  repoUrl?: string;
  baseBranch?: string;
}): Promise<{ detail: string; files?: Array<{ path: string; contents: string }>; usage: ModelUsage }> {
  const meta = modelProviderById(opts.slot.provider);
  if (!isFolderAgent(opts.slot.provider)) {
    throw new Error(`${meta.label} is a chat model, not a folder agent`);
  }
  const endpoint = opts.slot.endpoint.trim() || meta.endpointHint;
  if (!opts.apiKey.trim()) throw new Error(`${meta.label} needs an API key`);
  if (!endpoint) throw new Error(`${meta.label} needs an agent endpoint`);

  const repo = (opts.repoUrl ?? "").trim().replace(/\.git$/i, "");
  const body =
    opts.slot.provider === "cursor"
      ? cursorAgentBody(endpoint, opts.prompt, repo, opts.baseBranch || "main")
      : {
          prompt: opts.prompt,
          workspace: opts.workspace,
          source: { workspace: opts.workspace },
        };

  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${opts.apiKey}`,
  };
  const post = async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    try {
      return await fetch(endpoint, {
        method: "POST",
        signal: controller.signal,
        headers,
        body: JSON.stringify(body),
      });
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    let res = await post();
    let raw = await res.text();
    if (!res.ok && opts.slot.provider === "cursor" && /branch/i.test(raw)) {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      res = await post();
      raw = await res.text();
    }
    if (!res.ok) {
      throw new Error(explainAgentFailure(meta.label, res.status, raw, repo));
    }
    let parsed: {
      files?: Array<{ path?: string; contents?: string }>;
      id?: string;
      url?: string;
      agent?: { id?: string };
      run?: { id?: string };
    } = {};
    try {
      parsed = JSON.parse(raw) as typeof parsed;
    } catch {
      parsed = {};
    }
    const files = (parsed.files ?? []).filter((file) => file.path && typeof file.contents === "string") as Array<{
      path: string;
      contents: string;
    }>;
    const id = parsed.id || parsed.agent?.id || parsed.run?.id || "";
    let usage = readUsage(parsed);
    if (opts.slot.provider === "cursor" && id && !(usage.totalTokens || usage.inputTokens)) {
      usage = await fetchCursorUsage({ endpoint, apiKey: opts.apiKey, agentId: id });
    }
    return {
      files: files.length ? files : undefined,
      usage,
      detail: id
        ? `${meta.label} accepted the job (${id}). Project folder: ${opts.workspace}`
        : `${meta.label} accepted the job. Project folder: ${opts.workspace}`,
    };
  } catch (err) {
    if (err instanceof Error) throw err;
    throw new Error(String(err));
  }
}
