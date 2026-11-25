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

export async function armAccessToken(env: NodeJS.ProcessEnv): Promise<string | null> {
  const tenant = env.ARM_TENANT_ID;
  const clientId = env.ARM_CLIENT_ID;
  const secret = env.ARM_CLIENT_SECRET;
  if (!tenant || !clientId || !secret) return null;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: secret,
    grant_type: "client_credentials",
    scope: "https://management.azure.com/.default",
  }).toString();
  const res = await httpsJson({
    hostname: "login.microsoftonline.com",
    path: `/${encodeURIComponent(tenant)}/oauth2/v2.0/token`,
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const token = String(res.json.access_token ?? "");
  return token || null;
}

/** ACR Task quick run: clone Git and docker-build into ACR (no local Docker). */
export async function azureAcrGitBuildAndWait(opts: {
  env: NodeJS.ProcessEnv;
  resourceGroup: string;
  registryName: string;
  gitCloneUrl: string;
  branch: string;
  context: string;
  dockerfile: string;
  target?: string;
  imageName: string;
  buildArgs?: Record<string, string>;
  log: (line: string) => void;
  timeoutMs?: number;
}): Promise<{ ok: boolean; message: string }> {
  const token = await armAccessToken(opts.env);
  const sub = opts.env.ARM_SUBSCRIPTION_ID;
  if (!token || !sub) {
    return { ok: false, message: "Azure ARM credentials missing (tenant/client/secret/subscription)" };
  }

  const folder = opts.context.replace(/\\/g, "/").replace(/^\.\//, "");
  const sourceLocation = `${opts.gitCloneUrl}#${opts.branch}${folder && folder !== "." ? `:${folder}` : ""}`;
  const dockerFilePath = opts.dockerfile.replace(/\\/g, "/") || "Dockerfile";
  const payload = JSON.stringify({
    type: "DockerBuildRequest",
    isPushEnabled: true,
    sourceLocation,
    dockerFilePath,
    imageNames: [opts.imageName],
    ...(opts.target ? { target: opts.target } : {}),
    platform: { os: "Linux", architecture: "amd64" },
    arguments: Object.entries(opts.buildArgs ?? {}).map(([name, value]) => ({
      name,
      value,
      isSecret: false,
    })),
  });

  const path = `/subscriptions/${encodeURIComponent(sub)}/resourceGroups/${encodeURIComponent(
    opts.resourceGroup
  )}/providers/Microsoft.ContainerRegistry/registries/${encodeURIComponent(
    opts.registryName
  )}/scheduleRun?api-version=2019-06-01-preview`;

  opts.log(`ACR Task build ${opts.imageName} from Git @ ${opts.branch} (${folder}/${dockerFilePath})`);
  const start = await httpsJson({
    hostname: "management.azure.com",
    path,
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: payload,
  });
  const runId = String(start.json.runId ?? start.json.name ?? "");
  if (start.status >= 400 || !runId) {
    opts.log(`ACR scheduleRun failed: ${start.text.slice(0, 800)}`);
    return { ok: false, message: "Azure ACR Task scheduleRun failed (check ACR Tasks permission)" };
  }

  const runPath = `/subscriptions/${encodeURIComponent(sub)}/resourceGroups/${encodeURIComponent(
    opts.resourceGroup
  )}/providers/Microsoft.ContainerRegistry/registries/${encodeURIComponent(
    opts.registryName
  )}/runs/${encodeURIComponent(runId)}?api-version=2019-05-01`;

  const deadline = Date.now() + (opts.timeoutMs ?? 1_200_000);
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 10_000));
    const poll = await httpsJson({
      hostname: "management.azure.com",
      path: runPath,
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    const status = String(poll.json.status ?? "Unknown");
    opts.log(`ACR Task ${opts.imageName} ${status}`);
    if (status === "Succeeded") return { ok: true, message: runId };
    if (["Failed", "Canceled", "Error", "Timeout"].includes(status)) {
      return { ok: false, message: `ACR Task ${status} (${runId})` };
    }
  }
  return { ok: false, message: "ACR Task timed out waiting for image build" };
}
