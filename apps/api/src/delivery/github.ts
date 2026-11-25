export interface GithubRepo {
  owner: string;
  repo: string;
}

export function parseGithubRepo(url: string): GithubRepo | null {
  const trimmed = url.trim().replace(/\.git$/, "");
  const match = trimmed.match(/github\.com[:/]([^/\s]+)\/([^/\s]+)$/i);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

async function putGithubFile(opts: {
  api: string;
  headers: Record<string, string>;
  path: string;
  contents: string;
  branch: string;
  message: string;
}): Promise<void> {
  const encoded = opts.path.split("/").map(encodeURIComponent).join("/");
  const url = `${opts.api}/contents/${encoded}`;
  const existing = await fetch(`${url}?ref=${encodeURIComponent(opts.branch)}`, { headers: opts.headers });
  let sha: string | undefined;
  if (existing.ok) {
    const body = (await existing.json()) as { sha?: string };
    sha = body.sha;
  }
  const put = await fetch(url, {
    method: "PUT",
    headers: opts.headers,
    body: JSON.stringify({
      message: opts.message,
      content: Buffer.from(opts.contents, "utf8").toString("base64"),
      branch: opts.branch,
      ...(sha ? { sha } : {}),
    }),
  });
  if (!put.ok) {
    const detail = await put.text();
    throw new Error(`GitHub file write failed for ${opts.path} (${put.status}). ${detail.slice(0, 220)}`);
  }
}

function githubHeaders(token: string) {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "user-agent": "shipdeck-delivery",
  };
}

/** Read a text file from the existing repository. Missing files return null. */
export async function readGithubTextFile(opts: {
  repoUrl: string;
  token: string;
  path: string;
  ref: string;
}): Promise<string | null> {
  const parsed = parseGithubRepo(opts.repoUrl);
  if (!parsed || !opts.token.trim()) return null;
  const encoded = opts.path.split("/").map(encodeURIComponent).join("/");
  const url = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/contents/${encoded}?ref=${encodeURIComponent(opts.ref)}`;
  try {
    const res = await fetch(url, { headers: githubHeaders(opts.token) });
    if (!res.ok) return null;
    const body = (await res.json()) as { content?: string };
    if (!body.content) return null;
    return Buffer.from(body.content.replace(/\n/g, ""), "base64").toString("utf8");
  } catch {
    return null;
  }
}

export async function githubDefaultBranch(opts: { repoUrl: string; token: string }): Promise<string | null> {
  const parsed = parseGithubRepo(opts.repoUrl);
  if (!parsed || !opts.token.trim()) return null;
  try {
    const res = await fetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}`, {
      headers: githubHeaders(opts.token),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { default_branch?: string };
    return body.default_branch?.trim() || null;
  } catch {
    return null;
  }
}

export async function listGithubPaths(opts: { repoUrl: string; token: string; ref: string }): Promise<string[] | null> {
  const parsed = parseGithubRepo(opts.repoUrl);
  if (!parsed || !opts.token.trim() || !opts.ref.trim()) return null;
  try {
    const res = await fetch(
      `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/git/trees/${encodeURIComponent(opts.ref)}?recursive=1`,
      { headers: githubHeaders(opts.token) }
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { tree?: Array<{ path?: string; type?: string }> };
    return (body.tree ?? [])
      .filter((item) => item.type === "blob" && item.path)
      .map((item) => item.path as string);
  } catch {
    return null;
  }
}

export async function ensureGithubBaseBranch(opts: {
  repoUrl: string;
  token: string;
  base: string;
}): Promise<void> {
  const parsed = parseGithubRepo(opts.repoUrl);
  if (!parsed) throw new Error("A github.com repository URL is required");
  const api = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}`;
  const headers = githubHeaders(opts.token);
  const refRes = await fetch(`${api}/git/ref/heads/${encodeURIComponent(opts.base)}`, { headers });
  if (refRes.ok) return;
  const seed = await fetch(`${api}/contents/README.md`, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      message: "Initial commit",
      content: Buffer.from(`# ${parsed.repo}\n`, "utf8").toString("base64"),
    }),
  });
  if (!seed.ok) {
    const detail = await seed.text();
    throw new Error(
      `GitHub repo has no '${opts.base}' branch yet (empty repo). Could not create it (${seed.status}). ${detail.slice(0, 180)}`
    );
  }
}

export async function openGithubPullRequest(opts: {
  repoUrl: string;
  token: string;
  base: string;
  branch: string;
  title: string;
  body: string;
  files: Array<{ path: string; contents: string }>;
}): Promise<{ url: string }> {
  const parsed = parseGithubRepo(opts.repoUrl);
  if (!parsed) throw new Error("Auto-open pull requests currently support github.com repositories");
  const api = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}`;
  const headers = githubHeaders(opts.token);
  await ensureGithubBaseBranch({ repoUrl: opts.repoUrl, token: opts.token, base: opts.base });
  const refRes = await fetch(`${api}/git/ref/heads/${encodeURIComponent(opts.base)}`, { headers });
  if (!refRes.ok) throw new Error(`GitHub base branch lookup failed (${refRes.status})`);
  const refBody = (await refRes.json()) as { object?: { sha?: string } };
  const sha = refBody.object?.sha;
  if (!sha) throw new Error("GitHub did not return a base commit");
  const branchRes = await fetch(`${api}/git/refs`, {
    method: "POST",
    headers,
    body: JSON.stringify({ ref: `refs/heads/${opts.branch}`, sha }),
  });
  if (!branchRes.ok && branchRes.status !== 422) {
    throw new Error(`GitHub branch create failed (${branchRes.status})`);
  }
  for (const file of opts.files) {
    await putGithubFile({
      api,
      headers,
      path: file.path,
      contents: file.contents,
      branch: opts.branch,
      message: `${opts.title}\n\n${file.path}`,
    });
  }
  const prRes = await fetch(`${api}/pulls`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      title: opts.title,
      head: opts.branch,
      base: opts.base,
      body: opts.body,
    }),
  });
  if (prRes.ok) {
    const pr = (await prRes.json()) as { html_url?: string };
    if (!pr.html_url) throw new Error("GitHub did not return a pull request URL");
    return { url: pr.html_url };
  }
  const listed = await fetch(
    `${api}/pulls?head=${encodeURIComponent(parsed.owner + ":" + opts.branch)}&base=${encodeURIComponent(opts.base)}&state=open`,
    { headers }
  );
  if (listed.ok) {
    const pulls = (await listed.json()) as Array<{ html_url?: string }>;
    if (pulls[0]?.html_url) return { url: pulls[0].html_url };
  }
  const detail = await prRes.text();
  throw new Error(`GitHub pull request create failed (${prRes.status}). ${detail.slice(0, 220)}`);
}
