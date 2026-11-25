import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function write(root: string, rel: string, contents: string) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents, "utf8");
}

function syntaxOk(root: string, rel: string): boolean {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) return false;
  const result = spawnSync(process.execPath, ["--check", full], { encoding: "utf8" });
  return result.status === 0;
}

function isEsm(source: string): boolean {
  return /^\s*import\s/m.test(source) || /^\s*export\s/m.test(source);
}

function servesWebsite(source: string): boolean {
  return /index\.html/.test(source) && /text\/html/.test(source);
}

function treatsRootAsHealth(source: string): boolean {
  return (
    /\/health["']\s*\|\|\s*pathName\s*===\s*["']\/["']/.test(source) ||
    /pathName\s*===\s*["']\/["']\s*\|\|\s*pathName\s*===\s*["']\/health["']/.test(source)
  );
}

function needsAppPatch(source: string): boolean {
  if (!source.trim()) return true;
  if (!isEsm(source)) return true;
  if (!source.includes("export function health")) return true;
  if (!source.includes("export function handle")) return true;
  if (!source.includes("export function createServer")) return true;
  if (/\brequire\s*[\.(]/.test(source) || /\bmodule\.exports\b/.test(source)) return true;
  if (treatsRootAsHealth(source) && !servesWebsite(source)) return true;
  return false;
}

function stripBrokenCommonJs(source: string): string {
  return source
    .replace(/\s*if\s*\(\s*require\.main\s*===\s*module\s*\)\s*\{[\s\S]*?\}/g, "\n")
    .replace(/\s*if\s*\(\s*require\.main\s*===\s*module\s*\)\s*[^\n;{]+;?/g, "\n")
    .replace(/\bmodule\.exports\s*=\s*[^;]+;?/g, "")
    .replace(/\b(?:const|let|var)\s+\w+\s*=\s*require\([^)]+\);?/g, "");
}

function ensureHttpImport(source: string): string {
  if (/from\s+["']node:http["']/.test(source) || /from\s+["']http["']/.test(source)) return source;
  return `import http from "node:http";\n${source}`;
}

function ensureFsImports(source: string): string {
  let next = source;
  if (!/from\s+["']node:fs["']/.test(next) && !/from\s+["']fs["']/.test(next)) {
    next = `import fs from "node:fs";\n${next}`;
  }
  if (!/from\s+["']node:path["']/.test(next) && !/from\s+["']path["']/.test(next)) {
    next = `import path from "node:path";\n${next}`;
  }
  if (!/from\s+["']node:url["']/.test(next)) {
    next = `import { fileURLToPath } from "node:url";\n${next}`;
  }
  return next;
}

function handleWithWebsite(): string {
  return `
export function handle(req, res) {
  const pathName = new URL(req.url || "/", "http://localhost").pathname;
  if (req.method === "GET" && pathName === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(health()));
    return;
  }
  if (req.method === "GET" && (pathName === "/" || pathName === "/index.html")) {
    const page = path.join(path.dirname(fileURLToPath(import.meta.url)), "../public/index.html");
    const html = fs.existsSync(page) ? fs.readFileSync(page, "utf8") : "<!doctype html><html><body></body></html>";
    res.writeHead(200, { "content-type": "text/html" });
    res.end(html);
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
}
`;
}

function ensureExports(source: string): string {
  let next = source;
  if (!/export\s+function\s+health/.test(next)) {
    next += `\nexport function health() { return { status: "ok" }; }\n`;
  }
  if (!/export\s+function\s+handle/.test(next) || (treatsRootAsHealth(next) && !servesWebsite(next))) {
    next = ensureFsImports(next);
    if (/export\s+function\s+handle/.test(next) && treatsRootAsHealth(next)) {
      next = websiteAppSource();
      return next;
    }
    next += handleWithWebsite();
  }
  if (!/export\s+function\s+createServer/.test(next)) {
    next = ensureHttpImport(next);
    next += `\nexport function createServer() { return http.createServer(handle); }\n`;
  }
  return next;
}

function listenGuard(): string {
  return `
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createServer().listen(Number(process.env.PORT || 3000));
}
`;
}

function ensureListen(source: string): string {
  if (/\.listen\s*\(/.test(source)) return source;
  let next = source;
  if (!/from\s+["']node:url["']/.test(next)) next = `import { fileURLToPath } from "node:url";\n${next}`;
  if (!/from\s+["']node:path["']/.test(next) && !/from\s+["']path["']/.test(next)) {
    next = `import path from "node:path";\n${next}`;
  }
  return `${next}\n${listenGuard()}`;
}

function websiteAppSource(): string {
  return `import http from "node:http";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const page = path.join(path.dirname(fileURLToPath(import.meta.url)), "../public/index.html");

export function health() {
  return { status: "ok" };
}

export function handle(req, res) {
  const pathName = new URL(req.url || "/", "http://localhost").pathname;
  if (req.method === "GET" && pathName === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(health()));
    return;
  }
  if (req.method === "GET" && (pathName === "/" || pathName === "/index.html")) {
    const html = fs.existsSync(page) ? fs.readFileSync(page, "utf8") : "<!doctype html><html><body></body></html>";
    res.writeHead(200, { "content-type": "text/html" });
    res.end(html);
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
}

export function createServer() {
  return http.createServer(handle);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createServer().listen(Number(process.env.PORT || 3000));
}
`;
}

function repairApp(root: string, source: string): void {
  if (!source.trim() || !syntaxOk(root, "src/app.js") || (treatsRootAsHealth(source) && !servesWebsite(source))) {
    write(root, "src/app.js", websiteAppSource());
    return;
  }
  const patched = ensureListen(ensureExports(stripBrokenCommonJs(source)));
  write(root, "src/app.js", patched);
  if (!syntaxOk(root, "src/app.js") || !servesWebsite(fs.readFileSync(path.join(root, "src/app.js"), "utf8"))) {
    write(root, "src/app.js", websiteAppSource());
  }
}

function unitTestSource(): string {
  return `import test from "node:test";
import assert from "node:assert/strict";
import { health } from "../src/app.js";

test("health reports ok", () => {
  assert.equal(health().status, "ok");
});
`;
}

function integrationTestSource(): string {
  return `import test from "node:test";
import assert from "node:assert/strict";
import { createServer, handle, health } from "../src/app.js";

function invoke(method, url) {
  return new Promise((resolve) => {
    let status = 200;
    const req = { method, url, on(_event, cb) { if (_event === "end") cb(); return req; } };
    handle(req, {
      setHeader() {},
      writeHead(code) { status = code; },
      end(data) {
        let body = data;
        try { body = data ? JSON.parse(String(data)) : null; } catch { body = String(data ?? ""); }
        resolve({ status, body });
      },
    });
  });
}

test("health export and http health match", async () => {
  assert.equal(health().status, "ok");
  const res = await invoke("GET", "/health");
  assert.equal(res.status, 200);
  assert.equal(res.body.status, "ok");
  assert.ok(createServer());
});

test("root serves the website page", async () => {
  const res = await invoke("GET", "/");
  assert.equal(res.status, 200);
  assert.match(String(res.body), /<html/i);
  assert.doesNotMatch(String(res.body), /^\\{"status":"ok"\\}$/);
});
`;
}

export function isExistingApplication(root: string): boolean {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      scripts?: { dev?: string };
    };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps.next || deps.react || deps.vue) return true;
    return typeof pkg.scripts?.dev === "string" && /next|vite|react-scripts/.test(pkg.scripts.dev);
  } catch {
    return false;
  }
}

export function alignGeneratedProject(root: string): string[] {
  if (isExistingApplication(root)) return ["package.json"];
  const pkgPath = path.join(root, "package.json");
  const existingName = (() => {
    try {
      return JSON.parse(fs.existsSync(pkgPath) ? fs.readFileSync(pkgPath, "utf8") : "{}").name;
    } catch {
      return "";
    }
  })();
  write(
    root,
    "package.json",
    JSON.stringify(
      {
        name: existingName || "delivery-app",
        private: true,
        type: "module",
        scripts: { start: "node src/app.js", test: "node --test" },
      },
      null,
      2
    )
  );

  const htmlPath = path.join(root, "public/index.html");
  if (!fs.existsSync(htmlPath)) {
    write(root, "public/index.html", "<!doctype html><html><body></body></html>\n");
  }

  const appPath = path.join(root, "src/app.js");
  const source = fs.existsSync(appPath) ? fs.readFileSync(appPath, "utf8") : "";
  if (!source.trim() || !syntaxOk(root, "src/app.js") || needsAppPatch(source) || !servesWebsite(source)) {
    repairApp(root, source);
  }

  if (!syntaxOk(root, "test/unit.test.js")) write(root, "test/unit.test.js", unitTestSource());
  if (!syntaxOk(root, "test/integration.test.js")) write(root, "test/integration.test.js", integrationTestSource());

  const extras = (() => {
    const dir = path.join(root, "ticket-attachments");
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((name) => fs.statSync(path.join(dir, name)).isFile())
      .map((name) => `ticket-attachments/${name}`);
  })();
  return [
    "package.json",
    "src/app.js",
    "public/index.html",
    "fixtures/data.json",
    "test/unit.test.js",
    "test/integration.test.js",
    "README.md",
    "architecture.md",
    "impact-analysis.md",
    ...extras,
  ].filter((rel) => fs.existsSync(path.join(root, rel)));
}
