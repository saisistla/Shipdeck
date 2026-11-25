import crypto from "node:crypto";
import fs from "node:fs";
import https from "node:https";

function httpsJson(opts: {
  hostname: string;
  path: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
}): Promise<{ status: number; json: Record<string, unknown>; text: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: opts.hostname,
        path: opts.path,
        method: opts.method,
        headers: {
          ...(opts.headers ?? {}),
          ...(opts.body ? { "Content-Length": String(Buffer.byteLength(opts.body)) } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c as Buffer));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json: Record<string, unknown> = {};
          try {
            json = JSON.parse(text) as Record<string, unknown>;
          } catch {
            json = {};
          }
          resolve({ status: res.statusCode ?? 0, json, text });
        });
      }
    );
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function googleAccessToken(credentialsPath: string): Promise<string | null> {
  if (!fs.existsSync(credentialsPath)) return null;
  const sa = JSON.parse(fs.readFileSync(credentialsPath, "utf8")) as {
    client_email?: string;
    private_key?: string;
  };
  if (!sa.client_email || !sa.private_key) return null;
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })
  );
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(`${header}.${claim}`);
  const jwt = `${header}.${claim}.${b64url(sign.sign(sa.private_key))}`;
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: jwt,
  }).toString();
  const res = await httpsJson({
    hostname: "oauth2.googleapis.com",
    path: "/token",
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const token = String(res.json.access_token ?? "");
  return token || null;
}

/** Cloud Build: clone Git and docker-build/push to Artifact Registry (no local Docker). */
export async function gcpCloudBuildGitAndWait(opts: {
  env: NodeJS.ProcessEnv;
  region: string;
  gitCloneUrl: string;
  branch: string;
  apiContext: string;
  apiDockerfile: string;
  apiTarget?: string;
  apiBuildArgs?: Record<string, string>;
  webContext: string;
  webDockerfile: string;
  webTarget?: string;
  webBuildArgs?: Record<string, string>;
  apiImage: string;
  webImage: string;
  log: (line: string) => void;
  timeoutMs?: number;
}): Promise<{ ok: boolean; message: string }> {
  const project = opts.env.GOOGLE_CLOUD_PROJECT;
  const credPath = opts.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!project || !credPath) {
    return { ok: false, message: "GCP Cloud Build needs project_id and credentials JSON" };
  }
  const token = await googleAccessToken(credPath);
  if (!token) {
    return { ok: false, message: "Failed to mint Google access token from service account JSON" };
  }

  const dockerArgs = (
    image: string,
    context: string,
    dockerfile: string,
    target: string | undefined,
    buildArgs: Record<string, string> | undefined
  ) => {
    const ctxRel = (context || ".").replace(/^\.\//, "") || ".";
    const dfRel = dockerfile.replace(/^\.\//, "");
    const file = ctxRel === "." ? `src/${dfRel}` : `src/${ctxRel}/${dfRel}`;
    const dir = ctxRel === "." ? "src" : `src/${ctxRel}`;
    const args = ["build", "-t", image, "-f", file];
    if (target) args.push("--target", target);
    for (const [key, value] of Object.entries(buildArgs ?? {})) {
      args.push("--build-arg", `${key}=${value}`);
    }
    args.push(dir);
    return args;
  };
  const body = JSON.stringify({
    source: { storageSource: undefined },
    steps: [
      {
        name: "gcr.io/cloud-builders/git",
        args: ["clone", "--depth", "1", "--branch", opts.branch, opts.gitCloneUrl, "src"],
      },
      {
        name: "gcr.io/cloud-builders/docker",
        args: dockerArgs(opts.apiImage, opts.apiContext, opts.apiDockerfile, opts.apiTarget, opts.apiBuildArgs),
      },
      {
        name: "gcr.io/cloud-builders/docker",
        args: dockerArgs(opts.webImage, opts.webContext, opts.webDockerfile, opts.webTarget, opts.webBuildArgs),
      },
      { name: "gcr.io/cloud-builders/docker", args: ["push", opts.apiImage] },
      { name: "gcr.io/cloud-builders/docker", args: ["push", opts.webImage] },
    ],
    images: [opts.apiImage, opts.webImage],
    options: { logging: "CLOUD_LOGGING_ONLY" },
    timeout: "1200s",
  });
  // Cloud Build requires a source or empty; omit storageSource
  const parsed = JSON.parse(body) as Record<string, unknown>;
  delete parsed.source;

  opts.log(`Cloud Build will clone Git @ ${opts.branch} and push ${opts.apiImage} / ${opts.webImage}`);
  const start = await httpsJson({
    hostname: "cloudbuild.googleapis.com",
    path: `/v1/projects/${encodeURIComponent(project)}/builds`,
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(parsed),
  });

  const metadata = (start.json.metadata ?? {}) as Record<string, unknown>;
  const buildObj = (metadata.build ?? start.json) as Record<string, unknown>;
  const buildId = String(buildObj.id ?? "");
  if (start.status >= 400 || !buildId) {
    opts.log(`Cloud Build create failed: ${start.text.slice(0, 800)}`);
    return { ok: false, message: "GCP Cloud Build create failed (enable cloudbuild.googleapis.com + AR writer)" };
  }

  const deadline = Date.now() + (opts.timeoutMs ?? 1_200_000);
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 12_000));
    const poll = await httpsJson({
      hostname: "cloudbuild.googleapis.com",
      path: `/v1/projects/${encodeURIComponent(project)}/builds/${encodeURIComponent(buildId)}`,
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    const status = String(poll.json.status ?? "UNKNOWN");
    opts.log(`Cloud Build ${status}`);
    if (status === "SUCCESS") return { ok: true, message: buildId };
    if (["FAILURE", "INTERNAL_ERROR", "TIMEOUT", "CANCELLED", "EXPIRED"].includes(status)) {
      return { ok: false, message: `Cloud Build ${status} (${buildId})` };
    }
  }
  return { ok: false, message: "Cloud Build timed out waiting for image build" };
}
