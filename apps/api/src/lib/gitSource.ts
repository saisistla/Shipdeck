import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PipelineBoxes } from "@shipdeck/shared";
import { getConnection, getSecrets } from "./connections.js";
import { commandExists, runCommand } from "./exec.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
export const shipdeckWorkRoot = path.join(repoRoot, ".shipdeck-work");

export type SourceRootResult =
  | { ok: true; root: string; mode: "local" | "remote" }
  | { ok: false; error: string };

const destLocks = new Map<string, Promise<void>>();

function serialize<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = destLocks.get(key) ?? Promise.resolve();
  const curr = prev.then(fn, fn);
  destLocks.set(
    key,
    curr.then(
      () => undefined,
      () => undefined
    )
  );
  return curr;
}

function redact(line: string, token?: string) {
  return token ? line.split(token).join("***") : line;
}

function stripReadonly(dir: string) {
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    try {
      fs.chmodSync(full, e.isDirectory() ? 0o777 : 0o666);
    } catch {
      /* Windows may still lock the file */
    }
    if (e.isDirectory()) stripReadonly(full);
  }
  try {
    fs.chmodSync(dir, 0o777);
  } catch {
    /* ignore */
  }
}

/** Delete a folder even when Git marked files read-only (Windows EPERM). */
export function forceRmDir(dir: string) {
  if (!fs.existsSync(dir)) return;
  stripReadonly(dir);
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

export function cloneUrlWithToken(url: string, token?: string, username?: string): string {
  if (token && url.startsWith("https://")) {
    const stripped = url.replace(/^https:\/\//, "");
    const user = username || "git";
    return `https://${encodeURIComponent(user)}:${encodeURIComponent(token)}@${stripped}`;
  }
  return url;
}

function hasGitCheckout(dir: string) {
  return fs.existsSync(path.join(dir, ".git"));
}

function looksLikeSource(dir: string) {
  if (!fs.existsSync(dir)) return false;
  try {
    if (!fs.statSync(dir).isDirectory()) return false;
  } catch {
    return false;
  }
  return (
    hasGitCheckout(dir) ||
    fs.existsSync(path.join(dir, "docker-compose.yml")) ||
    fs.existsSync(path.join(dir, "docker-compose.yaml")) ||
    fs.existsSync(path.join(dir, "package.json"))
  );
}

export function gitCloneErrorHint(stderr: string): string {
  const text = stderr.replace(/\r/g, "\n");
  if (/Authentication failed|could not read Username|Invalid username or password|401|403 Forbidden/i.test(text)) {
    return "Git login failed. Open Connections → ProdGit and check the token.";
  }
  if (/repository ['"].*['"] not found|Repository not found/i.test(text)) {
    return "GitHub could not find that repo. Check the URL, or the token cannot see a private repo.";
  }
  if (/already exists and is not an empty directory/i.test(text)) {
    return "Clone folder already exists.";
  }
  if (/Could not resolve host/i.test(text)) {
    return "Could not reach GitHub (network/DNS).";
  }
  const fatal = text
    .split("\n")
    .map((s) => s.trim())
    .find((s) => /^fatal:/i.test(s));
  return fatal || "git clone failed (check URL, branch, and credentials)";
}

function gitAuthArgs(token?: string, username?: string): string[] {
  if (!token) return ["-c", "credential.helper="];
  const user = username || "x-access-token";
  const basic = Buffer.from(`${user}:${token}`).toString("base64");
  return [
    "-c",
    "credential.helper=",
    "-c",
    `http.extraHeader=Authorization: Basic ${basic}`,
  ];
}

const gitEnv: NodeJS.ProcessEnv = {
  GIT_TERMINAL_PROMPT: "0",
  GCM_INTERACTIVE: "Never",
};

async function git(args: string[], opts: { cwd?: string; timeoutMs?: number; onLine?: (line: string) => void }) {
  return runCommand("git", args, {
    ...opts,
    env: gitEnv,
    shell: false,
  });
}

export async function cloneGitRepo(opts: {
  dest: string;
  branch: string;
  url: string;
  token?: string;
  username?: string;
  fresh?: boolean;
  log?: (line: string) => void;
}): Promise<{ ok: true; dest: string } | { ok: false; error: string }> {
  return serialize(opts.dest, async () => {
    const hasGit = await commandExists("git");
    if (!hasGit) return { ok: false, error: "git CLI is required for remote Git" };

    const branch = opts.branch?.trim() || "main";
    const log = (line: string) => opts.log?.(redact(line, opts.token));
    const auth = gitAuthArgs(opts.token, opts.username);

    try {
      if (opts.fresh) {
        try {
          forceRmDir(opts.dest);
        } catch {
          log(`Could not replace ${opts.dest} — cloning next to it`);
        }
      }

      fs.mkdirSync(path.dirname(opts.dest), { recursive: true });

      if (!opts.fresh && looksLikeSource(opts.dest)) {
        if (hasGitCheckout(opts.dest)) {
          log(`git fetch origin ${branch} (reuse clone)`);
          await git([...auth, "fetch", "--depth", "1", "origin", branch], {
            cwd: opts.dest,
            timeoutMs: 180_000,
            onLine: log,
          });
        } else {
          log(`Reusing existing source at ${opts.dest}`);
        }
        return { ok: true, dest: opts.dest };
      }

      let dest = opts.dest;
      if (fs.existsSync(dest)) {
        try {
          forceRmDir(dest);
        } catch {
          dest = `${opts.dest}-${Date.now()}`;
        }
      }

      log(`git clone --depth 1 --branch ${branch} <repo> ${dest}`);
      const clone = await git(
        [...auth, "clone", "--depth", "1", "--branch", branch, opts.url, dest],
        { timeoutMs: 300_000, onLine: log }
      );
      if (clone.code !== 0) {
        if (looksLikeSource(opts.dest)) {
          log("Clone reported an error; using the folder already on disk");
          return { ok: true, dest: opts.dest };
        }
        if (looksLikeSource(dest)) {
          return { ok: true, dest };
        }
        return { ok: false, error: gitCloneErrorHint(redact(`${clone.stderr}\n${clone.stdout}`, opts.token)) };
      }
      return { ok: true, dest };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/EPERM|EACCES|permission denied/i.test(msg)) {
        return {
          ok: false,
          error:
            "Windows locked the Git clone folder. Wait a few seconds and click Review again (do not need a local path).",
        };
      }
      return { ok: false, error: msg };
    }
  });
}

/** Local folder, or a clone of the Git connection — same tree a run uses. */
export async function resolveSourceRoot(boxes: PipelineBoxes): Promise<SourceRootResult> {
  if (boxes.source.mode === "local") {
    const root = boxes.source.localPath?.trim();
    if (!root) return { ok: false, error: "Set a local Source path first" };
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      return { ok: false, error: `Path not found: ${root}` };
    }
    return { ok: true, root, mode: "local" };
  }

  const conn = getConnection(boxes.source.gitConnectionId);
  const secrets = getSecrets(boxes.source.gitConnectionId);
  const url = conn?.config.url?.trim();
  if (!url) {
    return {
      ok: false,
      error: "Connect a Git repo in Source first — review clones that repo (no local folder needed)",
    };
  }

  const branch = boxes.source.branch?.trim() || "main";
  const key = crypto
    .createHash("sha256")
    .update(`${url}|${branch}|${boxes.source.gitConnectionId ?? ""}`)
    .digest("hex")
    .slice(0, 16);
  const dest = path.join(shipdeckWorkRoot, "review", key, "src");
  const cloned = await cloneGitRepo({
    dest,
    branch,
    url,
    token: secrets.token || secrets.password || secrets.personalAccessToken,
    username: secrets.username,
  });
  if (!cloned.ok) return { ok: false, error: cloned.error };
  return { ok: true, root: cloned.dest, mode: "remote" };
}
