import crypto from "node:crypto";
import https from "node:https";

function hmac(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(data, "utf8").digest();
}

function sha256Hex(data: string): string {
  return crypto.createHash("sha256").update(data, "utf8").digest("hex");
}

function amzDate(d = new Date()): { amz: string; date: string } {
  const iso = d.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amz: iso, date: iso.slice(0, 8) };
}

/**
 * Signed AWS JSON-1.1 call (CodeBuild StartBuild / BatchGetBuilds).
 * Uses AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY from the cloud connection env.
 */
export async function awsJsonCall(opts: {
  env: NodeJS.ProcessEnv;
  region: string;
  service: string;
  target: string;
  body: Record<string, unknown>;
}): Promise<{ ok: boolean; status: number; json: Record<string, unknown>; text: string }> {
  const accessKey = opts.env.AWS_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID;
  const secret = opts.env.AWS_SECRET_ACCESS_KEY ?? process.env.AWS_SECRET_ACCESS_KEY;
  const token = opts.env.AWS_SESSION_TOKEN ?? process.env.AWS_SESSION_TOKEN;
  if (!accessKey || !secret) {
    return { ok: false, status: 0, json: {}, text: "Missing AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY" };
  }

  const payload = JSON.stringify(opts.body);
  const host = `${opts.service}.${opts.region}.amazonaws.com`;
  const { amz, date } = amzDate();
  const payloadHash = sha256Hex(payload);

  const canonicalHeaders = [
    `content-type:application/x-amz-json-1.1`,
    `host:${host}`,
    `x-amz-date:${amz}`,
    `x-amz-target:${opts.target}`,
    ...(token ? [`x-amz-security-token:${token}`] : []),
  ]
    .sort()
    .join("\n");
  const signedHeaders = [
    "content-type",
    "host",
    "x-amz-date",
    "x-amz-target",
    ...(token ? ["x-amz-security-token"] : []),
  ]
    .sort()
    .join(";");

  const canonical = ["POST", "/", "", canonicalHeaders, "", signedHeaders, payloadHash].join("\n");
  const scope = `${date}/${opts.region}/${opts.service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amz, scope, sha256Hex(canonical)].join("\n");
  const kDate = hmac(`AWS4${secret}`, date);
  const kRegion = hmac(kDate, opts.region);
  const kService = hmac(kRegion, opts.service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = crypto.createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");

  const headers: Record<string, string> = {
    "Content-Type": "application/x-amz-json-1.1",
    "X-Amz-Date": amz,
    "X-Amz-Target": opts.target,
    Authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    Host: host,
  };
  if (token) headers["X-Amz-Security-Token"] = token;

  const result = await new Promise<{ status: number; text: string }>((resolve, reject) => {
    const req = https.request(
      {
        hostname: host,
        method: "POST",
        path: "/",
        headers: { ...headers, "Content-Length": Buffer.byteLength(payload) },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c as Buffer));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") })
        );
      }
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });

  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(result.text) as Record<string, unknown>;
  } catch {
    json = {};
  }
  const ok = result.status >= 200 && result.status < 300 && !json.__type;
  return { ok, status: result.status, json, text: result.text };
}

export async function codeBuildStartAndWait(opts: {
  env: NodeJS.ProcessEnv;
  region: string;
  projectName: string;
  envVars: Record<string, string>;
  log: (line: string) => void;
  timeoutMs?: number;
}): Promise<{ ok: boolean; message: string }> {
  const start = await awsJsonCall({
    env: opts.env,
    region: opts.region,
    service: "codebuild",
    target: "CodeBuild_20161006.StartBuild",
    body: {
      projectName: opts.projectName,
      environmentVariablesOverride: Object.entries(opts.envVars).map(([name, value]) => ({
        name,
        value,
        type: "PLAINTEXT",
      })),
    },
  });
  const build = (start.json.build ?? start.json.Build) as Record<string, unknown> | undefined;
  const id = String(build?.id ?? "");
  if (!start.ok || !id) {
    opts.log(`CodeBuild StartBuild failed: ${start.text.slice(0, 800)}`);
    return { ok: false, message: "AWS CodeBuild StartBuild failed (check IAM: codebuild:StartBuild)" };
  }
  opts.log(`CodeBuild started ${id} — building images in AWS (no local Docker)`);

  const deadline = Date.now() + (opts.timeoutMs ?? 1_200_000);
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 12_000));
    const poll = await awsJsonCall({
      env: opts.env,
      region: opts.region,
      service: "codebuild",
      target: "CodeBuild_20161006.BatchGetBuilds",
      body: { ids: [id] },
    });
    const builds = (poll.json.builds ?? poll.json.Builds ?? []) as Array<Record<string, unknown>>;
    const b = builds[0];
    const status = String(b?.buildStatus ?? b?.BuildStatus ?? "UNKNOWN");
    const phase = String(
      (b?.currentPhase as string) ?? (b?.CurrentPhase as string) ?? ""
    );
    opts.log(`CodeBuild ${status}${phase ? ` · ${phase}` : ""}`);
    if (status === "SUCCEEDED") return { ok: true, message: id };
    if (["FAILED", "FAULT", "STOPPED", "TIMED_OUT"].includes(status)) {
      return { ok: false, message: `CodeBuild ${status} (${id})` };
    }
  }
  return { ok: false, message: "CodeBuild timed out waiting for image build" };
}
