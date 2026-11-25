import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { alignGeneratedProject } from "./projectAlign.js";
import { runSandboxChecks } from "./sandbox.js";

function tmpRoot(label: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `shipdeck-align-${label}-`));
}

describe("alignGeneratedProject", () => {
  it("repairs a CommonJS app that fails node --check and keeps the existing HTML", async () => {
    const root = tmpRoot("cjs");
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.mkdirSync(path.join(root, "public"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "src/app.js"),
      "const html = `<script>li.textContent = `${name}`;</script>`;\nmodule.exports = { health() { return { status: 'ok' }; } };\n"
    );
    fs.writeFileSync(path.join(root, "public/index.html"), "<html><body>Clinic Front Desk - Today's Appointments</body></html>");
    alignGeneratedProject(root);
    const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
    const app = fs.readFileSync(path.join(root, "src/app.js"), "utf8");
    assert.match(html, /Today's Appointments/);
    assert.doesNotMatch(html, /Clinic front desk/);
    assert.match(app, /index\.html/);
    assert.match(app, /text\/html/);
    assert.doesNotMatch(app, /\/health["']\s*\|\|\s*pathName/);
    const checks = await runSandboxChecks(root);
    assert.deepEqual(
      checks.map((check) => check.status),
      ["passed", "passed", "passed"]
    );
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("patches require.main and adds createServer without replacing the page", async () => {
    const root = tmpRoot("esm");
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.mkdirSync(path.join(root, "public"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "src/app.js"),
      `export function health() { return { status: "ok" }; }\nif (require.main === module) {}\n`
    );
    fs.writeFileSync(path.join(root, "public/index.html"), "<html><body>styled original</body></html>");
    alignGeneratedProject(root);
    const app = fs.readFileSync(path.join(root, "src/app.js"), "utf8");
    const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
    assert.match(app, /export function createServer/);
    assert.doesNotMatch(app, /require\.main/);
    assert.match(app, /index\.html/);
    assert.match(app, /text\/html/);
    assert.match(html, /styled original/);
    const checks = await runSandboxChecks(root);
    assert.deepEqual(
      checks.map((check) => check.status),
      ["passed", "passed", "passed"]
    );
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("rewrites a health-only root route so / serves the website", async () => {
    const root = tmpRoot("health-root");
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.mkdirSync(path.join(root, "public"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "src/app.js"),
      `import http from "node:http";
export function health() { return { status: "ok" }; }
export function handle(req, res) {
  const pathName = new URL(req.url || "/", "http://localhost").pathname;
  if (req.method === "GET" && (pathName === "/health" || pathName === "/")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(health()));
    return;
  }
  res.writeHead(404); res.end("{}");
}
export function createServer() { return http.createServer(handle); }
`
    );
    fs.writeFileSync(path.join(root, "public/index.html"), "<html><body>Plava Consulting Ltd</body></html>");
    alignGeneratedProject(root);
    const app = fs.readFileSync(path.join(root, "src/app.js"), "utf8");
    assert.match(app, /text\/html/);
    assert.match(app, /index\.html/);
    assert.doesNotMatch(app, /\/health["']\s*\|\|\s*pathName/);
    const checks = await runSandboxChecks(root);
    assert.deepEqual(
      checks.map((check) => check.status),
      ["passed", "passed", "passed"]
    );
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("leaves existing tests and HTML alone when they already parse", () => {
    const root = tmpRoot("keep");
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.mkdirSync(path.join(root, "public"), { recursive: true });
    fs.mkdirSync(path.join(root, "test"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "src/app.js"),
      `export function health() { return { status: "ok" }; }
export function handle(req, res) { res.writeHead(200); res.end(JSON.stringify(health())); }
export function createServer() { return {}; }
`
    );
    fs.writeFileSync(path.join(root, "public/index.html"), "<html><body>do not touch</body></html>");
    fs.writeFileSync(path.join(root, "test/unit.test.js"), `import test from "node:test";\ntest("kept", () => {});\n`);
    fs.writeFileSync(path.join(root, "test/integration.test.js"), `import test from "node:test";\ntest("kept too", () => {});\n`);
    alignGeneratedProject(root);
    const keptApp = fs.readFileSync(path.join(root, "src/app.js"), "utf8");
    assert.match(fs.readFileSync(path.join(root, "public/index.html"), "utf8"), /do not touch/);
    assert.match(fs.readFileSync(path.join(root, "test/unit.test.js"), "utf8"), /kept/);
    assert.match(fs.readFileSync(path.join(root, "test/integration.test.js"), "utf8"), /kept too/);
    assert.match(keptApp, /index\.html/);
    assert.match(keptApp, /text\/html/);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
