import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { ServerlessRuntime } from "@shipdeck/shared";

export interface ServerlessZipResult {
  /** Absolute path (forward slashes) for Terraform filename */
  zipPath: string;
  /** Path relative to TF workdir — preferred for Windows Terraform */
  zipRelPath: string;
  handler: string;
  /** base64(sha256(zip)) — same as Terraform filebase64sha256 */
  sourceCodeHash: string;
  /** hex md5 — object naming (GCP) */
  contentMd5Hex: string;
  /** base64 md5 — Azure blob Content-MD5 */
  contentMd5Base64: string;
}

/**
 * Build a deployable zip for AWS Lambda / Azure Functions / GCP Cloud Functions.
 * Enterprise baseline: Shipdeck health handler + optional Node entry hint from source.
 */
export function buildServerlessZip(opts: {
  workDir: string;
  sourcePath?: string;
  runtime: ServerlessRuntime;
  provider: "aws" | "azure" | "gcp";
  log: (line: string) => void;
}): ServerlessZipResult {
  const { workDir, sourcePath, runtime, provider, log } = opts;
  const pkgDir = path.join(workDir, "serverless-pkg");
  fs.rmSync(pkgDir, { recursive: true, force: true });
  fs.mkdirSync(pkgDir, { recursive: true });

  if (runtime === "python312") {
    writePythonPackage(pkgDir, provider);
  } else {
    writeNodePackage(pkgDir, provider, sourcePath, log);
  }

  const zipPath = path.join(workDir, "shipdeck-serverless.zip");
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  zipDirectory(pkgDir, zipPath);
  // Stabilize mtime so plan/apply hash reads stay consistent on Windows
  const now = new Date();
  fs.utimesSync(zipPath, now, now);
  const buf = fs.readFileSync(zipPath);
  const sourceCodeHash = crypto.createHash("sha256").update(buf).digest("base64");
  const contentMd5Hex = crypto.createHash("md5").update(buf).digest("hex");
  const contentMd5Base64 = crypto.createHash("md5").update(buf).digest("base64");
  log(`Serverless package: ${zipPath} (${buf.length} bytes)`);
  return {
    zipPath: zipPath.replace(/\\/g, "/"),
    zipRelPath: "shipdeck-serverless.zip",
    sourceCodeHash,
    contentMd5Hex,
    contentMd5Base64,
    handler: runtime === "python312" ? "handler.handler" : provider === "aws" ? "index.handler" : "handler",
  };
}

function writeNodePackage(
  pkgDir: string,
  provider: "aws" | "azure" | "gcp",
  sourcePath: string | undefined,
  log: (line: string) => void
) {
  const appHint =
    sourcePath && fs.existsSync(path.join(sourcePath, "package.json"))
      ? "Node app detected — Shipdeck health endpoint deployed; wire custom handlers in a later iteration."
      : "Generic Shipdeck serverless health function.";
  log(appHint);

  if (provider === "azure") {
    // Azure Functions v4 programming model (Node)
    fs.writeFileSync(
      path.join(pkgDir, "host.json"),
      JSON.stringify(
        {
          version: "2.0",
          extensionBundle: {
            id: "Microsoft.Azure.Functions.ExtensionBundle",
            version: "[4.*, 5.0.0)",
          },
        },
        null,
        2
      )
    );
    fs.writeFileSync(
      path.join(pkgDir, "package.json"),
      JSON.stringify(
        {
          name: "shipdeck-serverless",
          version: "1.0.0",
          main: "src/functions/health.js",
          type: "module",
          dependencies: {
            "@azure/functions": "^4.5.0",
          },
        },
        null,
        2
      )
    );
    const fnDir = path.join(pkgDir, "src", "functions");
    fs.mkdirSync(fnDir, { recursive: true });
    fs.writeFileSync(
      path.join(fnDir, "health.js"),
      `import { app } from "@azure/functions";

app.http("health", {
  methods: ["GET", "POST"],
  authLevel: "anonymous",
  route: "health",
  handler: async () => ({
    status: 200,
    jsonBody: { ok: true, platform: "shipdeck-serverless", cloud: "azure" },
  }),
});
`
    );
    // Bundle a minimal @azure/functions stub isn't ideal — Azure zip often needs npm install.
    // For enterprise MVP without npm in cloud build: use classic function.json layout.
    fs.rmSync(path.join(pkgDir, "src"), { recursive: true, force: true });
    fs.writeFileSync(
      path.join(pkgDir, "package.json"),
      JSON.stringify({ name: "shipdeck-serverless", version: "1.0.0", main: "health/index.js" }, null, 2)
    );
    const healthDir = path.join(pkgDir, "health");
    fs.mkdirSync(healthDir, { recursive: true });
    fs.writeFileSync(
      path.join(healthDir, "function.json"),
      JSON.stringify(
        {
          bindings: [
            {
              authLevel: "anonymous",
              type: "httpTrigger",
              direction: "in",
              name: "req",
              methods: ["get", "post"],
              route: "health",
            },
            { type: "http", direction: "out", name: "res" },
          ],
        },
        null,
        2
      )
    );
    fs.writeFileSync(
      path.join(healthDir, "index.js"),
      `module.exports = async function (context) {
  context.res = {
    status: 200,
    headers: { "content-type": "application/json" },
    body: { ok: true, platform: "shipdeck-serverless", cloud: "azure" },
  };
};
`
    );
    return;
  }

  if (provider === "gcp") {
    fs.writeFileSync(
      path.join(pkgDir, "package.json"),
      JSON.stringify(
        {
          name: "shipdeck-serverless",
          version: "1.0.0",
          main: "index.js",
          engines: { node: ">=20" },
        },
        null,
        2
      )
    );
    fs.writeFileSync(
      path.join(pkgDir, "index.js"),
      `const functions = require("@google-cloud/functions-framework");
// Fallback without framework dependency for Cloud Functions gen2 HTTP:
exports.handler = async (req, res) => {
  res.status(200).json({ ok: true, platform: "shipdeck-serverless", cloud: "gcp" });
};
`
    );
    // Gen2 Node typically uses exports.handler matching entry_point
    fs.writeFileSync(
      path.join(pkgDir, "index.js"),
      `exports.handler = async (req, res) => {
  if (typeof res?.status === "function") {
    res.status(200).json({ ok: true, platform: "shipdeck-serverless", cloud: "gcp" });
    return;
  }
  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ok: true, platform: "shipdeck-serverless", cloud: "gcp" }),
  };
};
`
    );
    return;
  }

  // AWS Lambda (Node 20 ESM-compatible CJS handler name index.handler)
  fs.writeFileSync(
    path.join(pkgDir, "package.json"),
    JSON.stringify({ name: "shipdeck-serverless", version: "1.0.0", main: "index.js" }, null, 2)
  );
  fs.writeFileSync(
    path.join(pkgDir, "index.js"),
    `exports.handler = async (event) => {
  const rawPath = event.rawPath || event.path || "/";
  const pathOnly = String(rawPath).split("?")[0];
  const body = {
    ok: true,
    platform: "shipdeck-serverless",
    cloud: "aws",
    path: pathOnly,
  };
  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
};
`
  );
}

function writePythonPackage(pkgDir: string, provider: "aws" | "azure" | "gcp") {
  if (provider === "azure") {
    fs.writeFileSync(
      path.join(pkgDir, "host.json"),
      JSON.stringify({ version: "2.0", extensionBundle: { id: "Microsoft.Azure.Functions.ExtensionBundle", version: "[4.*, 5.0.0)" } }, null, 2)
    );
    const healthDir = path.join(pkgDir, "health");
    fs.mkdirSync(healthDir, { recursive: true });
    fs.writeFileSync(
      path.join(healthDir, "function.json"),
      JSON.stringify(
        {
          scriptFile: "__init__.py",
          bindings: [
            { authLevel: "anonymous", type: "httpTrigger", direction: "in", name: "req", methods: ["get", "post"], route: "health" },
            { type: "http", direction: "out", name: "$return" },
          ],
        },
        null,
        2
      )
    );
    fs.writeFileSync(
      path.join(healthDir, "__init__.py"),
      `import json
import azure.functions as func

def main(req: func.HttpRequest) -> func.HttpResponse:
    return func.HttpResponse(json.dumps({"ok": True, "platform": "shipdeck-serverless", "cloud": "azure"}), mimetype="application/json")
`
    );
    return;
  }

  fs.writeFileSync(
    path.join(pkgDir, "main.py" ),
    provider === "gcp"
      ? `import json

def handler(request):
    from flask import jsonify
    return jsonify({"ok": True, "platform": "shipdeck-serverless", "cloud": "gcp"})
`
      : `import json

def handler(event, context):
    return {
        "statusCode": 200,
        "headers": {"content-type": "application/json"},
        "body": json.dumps({"ok": True, "platform": "shipdeck-serverless", "cloud": "aws"}),
    }
`
  );
  if (provider === "aws") {
    fs.renameSync(path.join(pkgDir, "main.py"), path.join(pkgDir, "handler.py"));
  }
  if (provider === "gcp") {
    fs.writeFileSync(
      path.join(pkgDir, "requirements.txt"),
      "functions-framework==3.*\nflask==3.*\n"
    );
    fs.writeFileSync(
      path.join(pkgDir, "main.py"),
      `import functions_framework

@functions_framework.http
def handler(request):
    return {"ok": True, "platform": "shipdeck-serverless", "cloud": "gcp"}
`
    );
  }
}

function zipDirectory(dir: string, zipPath: string) {
  // Prefer PowerShell Compress-Archive on Windows; zip CLI elsewhere.
  if (process.platform === "win32") {
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `Compress-Archive -Path (Join-Path '${dir.replace(/'/g, "''")}' '*') -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`,
      ],
      { windowsHide: true, stdio: "pipe" }
    );
    return;
  }
  execFileSync("zip", ["-r", "-q", zipPath, "."], { cwd: dir, stdio: "pipe" });
}
