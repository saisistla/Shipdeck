import { type ChildProcess, execFile, spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { Request, Response } from "express";

type Preview = { port: number; pid: number; proc: ChildProcess | null; workspace: string; title: string };
type SavedPreview = { pid: number; port: number; workspace: string };

const running = new Map<string, Preview>();
const registryPath = path.join(os.tmpdir(), "shipdeck-preview-registry.json");
const execFileAsync = promisify(execFile);

function readRegistry(): Record<string, SavedPreview> {
  try {
    return JSON.parse(fs.readFileSync(registryPath, "utf8")) as Record<string, SavedPreview>;
  } catch {
    return {};
  }
}

function writeRegistry(all: Record<string, SavedPreview>) {
  fs.writeFileSync(registryPath, JSON.stringify(all));
}

function remember(runId: string, preview: Preview) {
  running.set(runId, preview);
  const all = readRegistry();
  all[runId] = { pid: preview.pid, port: preview.port, workspace: preview.workspace };
  writeRegistry(all);
}

function forget(runId: string) {
  running.delete(runId);
  const all = readRegistry();
  if (!all[runId]) return;
  delete all[runId];
  writeRegistry(all);
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function commandLine(pid: number): Promise<string> {
  try {
    if (process.platform === "win32") {
      const { stdout } = await execFileAsync(
        "powershell.exe",
        ["-NoProfile", "-Command", `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`],
        { windowsHide: true, timeout: 4000 }
      );
      return String(stdout);
    }
    return fs.readFileSync(`/proc/${pid}/cmdline`, "utf8");
  } catch {
    return "";
  }
}

async function ownsWorkspace(pid: number, workspace: string): Promise<boolean> {
  const line = (await commandLine(pid)).toLowerCase();
  return line.includes(workspace.toLowerCase());
}

function tracked(runId: string): Preview | null {
  const current = running.get(runId);
  if (current) return current;
  const saved = readRegistry()[runId];
  if (!saved || !pidAlive(saved.pid)) {
    if (saved) forget(runId);
    return null;
  }
  const revived: Preview = { port: saved.port, pid: saved.pid, proc: null, workspace: saved.workspace, title: "" };
  running.set(runId, revived);
  return revived;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

export function previewFor(runId: string): { port: number; url: string; title: string } | null {
  const current = tracked(runId);
  if (!current || !pidAlive(current.pid)) {
    if (current) forget(runId);
    return null;
  }
  const url = `http://127.0.0.1:${current.port}/`;
  return { port: current.port, url, title: current.title || "" };
}

function killPid(pid: number): Promise<void> {
  return new Promise((resolve) => {
    if (!pidAlive(pid)) {
      resolve();
      return;
    }
    if (process.platform === "win32") {
      const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      const finish = () => resolve();
      killer.once("exit", finish);
      killer.once("error", finish);
      setTimeout(finish, 4000);
      return;
    }
    try {
      process.kill(pid);
    } catch {
      resolve();
      return;
    }
    const started = Date.now();
    const timer = setInterval(() => {
      if (!pidAlive(pid) || Date.now() - started > 4000) {
        clearInterval(timer);
        resolve();
      }
    }, 80);
  });
}

async function waitUntilClosed(port: number) {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    if (!(await portOpen(port))) return;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
}

function removeNextCache(workspace: string) {
  try {
    fs.rmSync(path.join(workspace, ".next"), { recursive: true, force: true });
  } catch {
    /* the server is already stopped; a locked cache file can be removed on the next stop */
  }
}

/** Drop Next's generated folder once nothing from this ticket is still running. */
async function removeNextCacheIfIdle(workspace: string) {
  const lock = readDevLock(workspace);
  if (lock && pidAlive(lock.pid)) return;
  removeNextCache(workspace);
}

export async function stopPreview(runId: string, workspace?: string): Promise<void> {
  const current = tracked(runId);
  const folder = current?.workspace || workspace;
  if (!current) {
    if (folder) await removeNextCacheIfIdle(folder);
    return;
  }
  const owned = current.proc != null || (await ownsWorkspace(current.pid, current.workspace));
  forget(runId);
  if (!owned) return;
  if (current.proc && current.proc.exitCode == null) {
    const exited = new Promise<void>((resolve) => {
      current.proc?.once("exit", () => resolve());
      setTimeout(resolve, 4000);
    });
    await killPid(current.pid);
    await exited;
  } else {
    await killPid(current.pid);
  }
  await waitUntilClosed(current.port);
  if (await portOpen(current.port)) {
    throw new Error("The app is still running. Stop it again.");
  }
  removeNextCache(folder || current.workspace);
}

function readDevLock(workspace: string): { pid: number; port: number } | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(workspace, ".next", "dev", "lock"), "utf8")) as {
      pid?: unknown;
      port?: unknown;
    };
    const pid = Number(parsed.pid);
    const port = Number(parsed.port);
    if (!Number.isInteger(pid) || pid <= 0) return null;
    return { pid, port: Number.isInteger(port) && port > 0 ? port : 0 };
  } catch {
    return null;
  }
}

/** Stop the preview Shipdeck remembers, and the leftover dev server still holding this folder. */
export async function stopStuckPreview(runId: string, workspace: string): Promise<void> {
  await stopPreview(runId).catch(() => undefined);
  const lock = readDevLock(workspace);
  if (lock && pidAlive(lock.pid)) {
    const owned = await ownsWorkspace(lock.pid, workspace);
    if (!owned) return;
    await killPid(lock.pid);
    if (lock.port) await waitUntilClosed(lock.port);
    if (pidAlive(lock.pid) || (lock.port > 0 && (await portOpen(lock.port)))) {
      throw new Error("The stuck app is still running. Stop it again.");
    }
  }
  removeNextCache(workspace);
}

function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    const done = (open: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(open);
    };
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

/** Next stops `next dev` when it sees an agent session. The preview is the customer's app, so those markers stay here. */
const PREVIEW_ENV_SKIP = [
  "AI_AGENT",
  "CURSOR_TRACE_ID",
  "CURSOR_AGENT",
  "CURSOR_EXTENSION_HOST_ROLE",
  "GEMINI_CLI",
  "CODEX_SANDBOX",
  "CODEX_CI",
  "CODEX_THREAD_ID",
  "ANTIGRAVITY_AGENT",
  "AUGMENT_AGENT",
  "OPENCODE_CLIENT",
  "CLAUDECODE",
  "CLAUDE_CODE",
  "CLAUDE_CODE_IS_COWORK",
  "REPL_ID",
  "COPILOT_MODEL",
  "COPILOT_ALLOW_ALL",
  "COPILOT_GITHUB_TOKEN",
  "__NEXT_AGENT_UPGRADE",
  "__NEXT_AGENT_UPGRADE_FORCE_TERMINAL_FOR_TESTING",
];

function previewProcessEnv(port: number): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, PORT: String(port) };
  for (const key of PREVIEW_ENV_SKIP) delete env[key];
  return env;
}

function pageReady(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get({ hostname: "127.0.0.1", port, path: "/", timeout: 20_000 }, (res) => {
      res.resume();
      const code = res.statusCode ?? 0;
      resolve(code >= 200 && code < 500);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

function readPreviewTitle(port: number): Promise<string> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (title: string) => {
      if (settled) return;
      settled = true;
      resolve(title.trim());
    };
    const req = http.get({ hostname: "127.0.0.1", port, path: "/", timeout: 20_000 }, (res) => {
      let html = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        html += chunk;
        const match = html.match(/<title>([^<]*)<\/title>/i);
        if (match || html.length > 100_000) {
          res.destroy();
          finish(match?.[1] ?? "");
        }
      });
      res.on("end", () => {
        const match = html.match(/<title>([^<]*)<\/title>/i);
        finish(match?.[1] ?? "");
      });
    });
    req.on("error", () => finish(""));
    req.on("timeout", () => {
      req.destroy();
      finish("");
    });
  });
}

function nextBin(workspace: string): string | null {
  const pkgPath = path.join(workspace, "package.json");
  if (!fs.existsSync(pkgPath)) return null;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    if (!pkg.dependencies?.next && !pkg.devDependencies?.next) return null;
  } catch {
    return null;
  }
  const bin = path.join(workspace, "node_modules", "next", "dist", "bin", "next");
  return fs.existsSync(bin) ? bin : null;
}

async function installDependencies(workspace: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn("npm", ["install", "--ignore-scripts"], {
      cwd: workspace,
      shell: true,
      windowsHide: true,
      stdio: "ignore",
    });
    proc.once("error", reject);
    proc.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error("npm install failed for the existing application"));
    });
  });
}

export async function startPreview(runId: string, workspace: string): Promise<{ port: number; url: string; page: string; title: string }> {
  const app = fs.existsSync(path.join(workspace, "src/app.js")) ? "src/app.js" : "src/app.ts";
  const generated = fs.existsSync(path.join(workspace, app));
  let nextEntry = nextBin(workspace);
  if (!generated && !nextEntry && fs.existsSync(path.join(workspace, "package.json"))) {
    await installDependencies(workspace);
    nextEntry = nextBin(workspace);
  }
  if (!generated && !nextEntry) {
    throw new Error("This project has no src/app.js to start");
  }
  // The last preview must not be reused. Stop clears .next, then this start reads the files on disk.
  await stopStuckPreview(runId, workspace);
  const port = await freePort();
  const previewEnv = previewProcessEnv(port);
  const proc = generated
    ? spawn(process.execPath, [path.join(workspace, app)], {
        cwd: workspace,
        env: previewEnv,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      })
    : spawn(process.execPath, [nextEntry as string, "dev", "-H", "127.0.0.1", "-p", String(port)], {
        cwd: workspace,
        env: previewEnv,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
  proc.stdout?.on("data", () => undefined);
  proc.stderr?.on("data", () => undefined);
  if (!proc.pid) {
    proc.kill();
    throw new Error("The app did not start. Open src/app.js in the workbench.");
  }
  const preview: Preview = { port, pid: proc.pid, proc, workspace, title: "" };
  remember(runId, preview);
  proc.once("exit", () => {
    const current = running.get(runId);
    if (current?.pid === proc.pid) forget(runId);
  });
  const deadline = Date.now() + (generated ? 4000 : 90_000);
  while (Date.now() < deadline) {
    if (proc.exitCode != null) {
      forget(runId);
      throw new Error("The app stopped as soon as it started. Open src/app.js in the workbench.");
    }
    if ((await portOpen(port)) && (await pageReady(port))) {
      // The frame opens the app on its own address. A path under Shipdeck makes the app wait forever for its own list.
      const url = `http://127.0.0.1:${port}/`;
      preview.title = await readPreviewTitle(port);
      remember(runId, preview);
      return { port, url, page: url, title: preview.title };
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  await stopStuckPreview(runId, workspace);
  throw new Error("The app did not start. Open src/app.js in the workbench.");
}

export function previewPage(runId: string): string {
  return `/api/delivery/runs/${encodeURIComponent(runId)}/view/`;
}

function freshRequestHeaders(req: Request, port: number): http.OutgoingHttpHeaders {
  const headers: http.OutgoingHttpHeaders = { ...req.headers, host: `127.0.0.1:${port}`, "accept-encoding": "identity" };
  delete headers["if-none-match"];
  delete headers["if-modified-since"];
  return headers;
}

function freshResponseHeaders(headers: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
  const next: http.OutgoingHttpHeaders = { ...headers };
  delete next["x-frame-options"];
  delete next["content-security-policy"];
  delete next["content-length"];
  delete next["transfer-encoding"];
  delete next.etag;
  delete next["last-modified"];
  next["cache-control"] = "no-store";
  return next;
}

function prefixRootUrls(body: string, prefix: string): string {
  const root = prefix.endsWith("/") ? prefix : `${prefix}/`;
  return body
    .replace(/(\b(?:href|src|action|poster)\s*=\s*)(["'])\/(?!\/)/gi, `$1$2${root}`)
    .replace(/(\burl\(\s*)(["']?)\/(?!\/)/gi, `$1$2${root}`)
    .replace(/(\bfetch\s*\(\s*)(["'])\/(?!\/)/gi, `$1$2${root}`);
}

function previewFetchScript(prefix: string): string {
  const root = prefix.endsWith("/") ? prefix : `${prefix}/`;
  return `<script>(function(){var root=${JSON.stringify(root)};function fix(url){if(typeof url!=="string")return url;if(url.charAt(0)==="/"&&url.charAt(1)!=="/"&&url.indexOf(root)!==0)return root+url.slice(1);return url;}function sameApp(url){return typeof url==="string"&&url.charAt(0)==="/"&&url.charAt(1)!=="/"&&url.indexOf(root)!==0;}var orig=window.fetch;if(orig){window.fetch=function(input,init){if(typeof input==="string")input=fix(input);else if(input&&typeof input.url==="string"&&sameApp(input.url.replace(location.origin,"")))input=new Request(fix(input.url.replace(location.origin,"")),input);return orig.call(this,input,init);};}var open=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(method,url){if(sameApp(url))arguments[1]=fix(url);return open.apply(this,arguments);};function patch(proto,prop){var desc=Object.getOwnPropertyDescriptor(proto,prop);if(!desc||!desc.set||!desc.get)return;Object.defineProperty(proto,prop,{configurable:true,get:desc.get,set:function(value){desc.set.call(this,fix(value));}}); }patch(HTMLScriptElement.prototype,"src");patch(HTMLLinkElement.prototype,"href");patch(HTMLImageElement.prototype,"src");var setAttr=Element.prototype.setAttribute;Element.prototype.setAttribute=function(name,value){if((name==="src"||name==="href")&&typeof value==="string")value=fix(value);return setAttr.call(this,name,value);};})();</script>`;
}

function prefixAppPaths(body: string, root: string): string {
  const base = root.endsWith("/") ? root : `${root}/`;
  return body
    .replaceAll(`"/_next/`, `"${base}_next/`)
    .replaceAll(`'/_next/`, `'${base}_next/`)
    .replaceAll("`/_next/", `\`${base}_next/`);
}

/** Rewrite a preview response so the page's own requests stay on that app. */
export function preparePreviewBody(body: string, contentType: string, runId: string): string {
  if (!/text\/html|javascript|text\/css/.test(contentType)) return body;
  const root = previewPage(runId);
  const rewritten = prefixAppPaths(prefixRootUrls(body, root), root);
  if (!/text\/html/.test(contentType)) return rewritten;
  const hook = previewFetchScript(root);
  if (rewritten.includes("<head>")) return rewritten.replace("<head>", `<head>${hook}`);
  if (rewritten.includes("</head>")) return rewritten.replace("</head>", `${hook}</head>`);
  return `${hook}${rewritten}`;
}

export function proxyPreview(runId: string, req: Request, res: Response): void {
  const current = previewFor(runId);
  if (!current) {
    res.status(409).type("html").send("<p>Start the app to see it here.</p>");
    return;
  }
  const targetPath = req.url && req.url.startsWith("/") ? req.url : `/${req.url || ""}`;
  const proxyReq = http.request(
    {
      hostname: "127.0.0.1",
      port: current.port,
      path: targetPath,
      method: req.method,
      headers: freshRequestHeaders(req, current.port),
    },
    (proxyRes) => {
      const type = String(proxyRes.headers["content-type"] || "");
      const rewrite = /text\/html|javascript|text\/css/.test(type);
      const headers = freshResponseHeaders(proxyRes.headers);
      if (!rewrite) {
        res.writeHead(proxyRes.statusCode || 502, headers);
        proxyRes.pipe(res);
        return;
      }
      const chunks: Buffer[] = [];
      proxyRes.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      proxyRes.on("end", () => {
        const body = preparePreviewBody(Buffer.concat(chunks).toString("utf8"), type, runId);
        res.status(proxyRes.statusCode || 502).set(headers).send(body);
      });
    }
  );
  proxyReq.on("error", () => {
    if (!res.headersSent) res.status(502).type("html").send("<p>The app is not responding.</p>");
  });
  if (req.method === "GET" || req.method === "HEAD") proxyReq.end();
  else if (req.body !== undefined && req.is("json")) {
    const raw = JSON.stringify(req.body ?? {});
    proxyReq.setHeader("content-length", Buffer.byteLength(raw));
    proxyReq.end(raw);
  } else req.pipe(proxyReq);
}
