import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { spawn } from "node:child_process";
import { preparePreviewBody, startPreview, stopPreview, stopStuckPreview } from "./preview.js";

const roots: string[] = [];

function writeApp(root: string, html: string) {
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.mkdirSync(path.join(root, "public"), { recursive: true });
  fs.writeFileSync(path.join(root, "public/index.html"), html, "utf8");
  fs.writeFileSync(
    path.join(root, "src/app.js"),
    `import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const page = path.join(path.dirname(fileURLToPath(import.meta.url)), "../public/index.html");
http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end(fs.readFileSync(page, "utf8"));
}).listen(Number(process.env.PORT || 3000));
`,
    "utf8"
  );
}

function getText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    }).on("error", reject);
  });
}

const holdPids: number[] = [];

function holdProcess(scriptPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [scriptPath], { windowsHide: true, stdio: "ignore" });
    proc.once("error", reject);
    proc.once("spawn", () => {
      if (!proc.pid) {
        reject(new Error("no pid"));
        return;
      }
      holdPids.push(proc.pid);
      resolve(proc.pid);
    });
  });
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

after(async () => {
  await stopPreview("preview-reload");
  for (const pid of holdPids) {
    try {
      process.kill(pid);
    } catch {
      /* already stopped */
    }
  }
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

describe("preview reload", () => {
  it("serves the saved page after the app is started again", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "shipdeck-preview-"));
    roots.push(root);
    writeApp(root, "<h1>First heading</h1>");
    const first = await startPreview("preview-reload", root);
    assert.match(await getText(first.url), /First heading/);
    fs.writeFileSync(path.join(root, "public/index.html"), "<h1>Saved heading</h1>", "utf8");
    const second = await startPreview("preview-reload", root);
    assert.notEqual(second.port, first.port);
    assert.match(await getText(second.url), /Saved heading/);
    await assert.rejects(() => getText(first.url));
    await stopPreview("preview-reload");
    await assert.rejects(() => getText(second.url));
  });

  it("stops the leftover dev server recorded in the folder lock", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "shipdeck-stuck-"));
    roots.push(root);
    const script = path.join(root, "hold.js");
    fs.writeFileSync(script, "setInterval(() => {}, 1000);\n", "utf8");
    const pid = await holdProcess(script);
    fs.mkdirSync(path.join(root, ".next", "dev"), { recursive: true });
    fs.writeFileSync(path.join(root, ".next", "dev", "lock"), JSON.stringify({ pid, port: 0 }), "utf8");
    await stopStuckPreview("preview-stuck", root);
    assert.equal(pidAlive(pid), false);
    assert.equal(fs.existsSync(path.join(root, ".next")), false);
  });

  it("leaves a lock alone when that process is not this folder", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "shipdeck-stuck-"));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "shipdeck-other-"));
    roots.push(root, outside);
    const script = path.join(outside, "hold.js");
    fs.writeFileSync(script, "setInterval(() => {}, 1000);\n", "utf8");
    const pid = await holdProcess(script);
    fs.mkdirSync(path.join(root, ".next", "dev"), { recursive: true });
    fs.writeFileSync(path.join(root, ".next", "dev", "lock"), JSON.stringify({ pid, port: 0 }), "utf8");
    await stopStuckPreview("preview-stuck-other", root);
    assert.equal(pidAlive(pid), true);
    assert.equal(fs.existsSync(path.join(root, ".next", "dev", "lock")), true);
  });

  it("sends a request built from two pieces to the preview app", () => {
    const html = `<html><head></head><body><script>const apiBase = '/api'; fetch(apiBase + '/items');</script></body></html>`;
    const body = preparePreviewBody(html, "text/html; charset=utf-8", "run1");
    assert.match(body, /window\.fetch/);
    assert.match(body, /\/api\/delivery\/runs\/run1\/view\//);
    assert.match(body, /apiBase \+ '\/items'/);
  });
});
