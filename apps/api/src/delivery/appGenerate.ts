import type { DeliveryArchitecture, DeliveryPolicyPublic, DeliveryTicket } from "@shipdeck/shared";

const STOP = new Set([
  "a", "an", "and", "application", "app", "build", "create", "develop", "for", "the", "this",
  "that", "with", "from", "into", "using", "need", "needs", "should", "must", "will", "can",
  "our", "your", "their", "please", "task", "ticket", "project", "system", "platform",
]);

export interface ProductSpec {
  name: string;
  slug: string;
  summary: string;
  entities: Array<{ name: string; label: string; records: Record<string, string>[] }>;
  features: string[];
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOP.has(word));
}

function titleCase(value: string): string {
  return value.replace(/[-_]+/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase()).trim();
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "app";
}

function unique(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const key = slug(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/** Turn the ticket and approved plan into the product that will be written to disk. */
export function productFromPlan(ticket: DeliveryTicket, architecture: DeliveryArchitecture): ProductSpec {
  const corpus = [ticket.summary, ticket.description, ticket.acceptance.join(" "), architecture.markdown].join(" ");
  const tokens = words(corpus);
  const fromComponents = architecture.components
    .map((item) => item.name)
    .filter((name) => name && name !== "health");
  const fromAcceptance = ticket.acceptance.map((line) => words(line).slice(0, 3).join("-")).filter(Boolean);
  const nouns = unique([...fromComponents, ...fromAcceptance, ...tokens]).slice(0, 6);
  const entities = (nouns.length ? nouns : ["item"]).slice(0, 4).map((name, index) => ({
    name,
    label: titleCase(name),
    records: [
      { id: `${name}-1`, name: `${titleCase(name)} 1`, status: "active", source: "fixture" },
      { id: `${name}-2`, name: `${titleCase(name)} 2`, status: "planned", source: "fixture" },
    ].map((row) => ({ ...row, lot: String(index + 1) })),
  }));
  return {
    name: titleCase(ticket.summary.replace(/^(build|create|develop)\s+(an?\s+)?/i, "") || ticket.key),
    slug: slug(ticket.key + "-" + ticket.summary),
    summary: ticket.summary,
    entities,
    features: ticket.acceptance.length ? ticket.acceptance : [ticket.summary],
  };
}

export function applicationFiles(opts: {
  ticket: DeliveryTicket;
  policy: DeliveryPolicyPublic;
  architecture: DeliveryArchitecture;
}): Array<{ path: string; contents: string }> {
  const license = opts.policy.allowedLicenses[0] || "MIT";
  const product = productFromPlan(opts.ticket, opts.architecture);
  const store = Object.fromEntries(product.entities.map((entity) => [entity.name, entity.records]));
  const entityList = JSON.stringify(product.entities.map((entity) => ({ name: entity.name, label: entity.label })));

  const appJs = `/** License: ${license}. Built from ${opts.ticket.key}. Fixture data only. */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const store = ${JSON.stringify(store, null, 2)};

export const product = {
  key: ${JSON.stringify(opts.ticket.key)},
  name: ${JSON.stringify(product.name)},
  summary: ${JSON.stringify(product.summary)},
  features: ${JSON.stringify(product.features)},
  entities: ${entityList},
};

export function health() {
  return { status: "ok", ticket: product.key, product: product.name };
}

export function list(entity) {
  if (!store[entity]) throw new Error("unknown resource");
  return store[entity];
}

export function create(entity, body) {
  if (!store[entity]) throw new Error("unknown resource");
  const row = { id: entity + "-" + (store[entity].length + 1), source: "fixture", ...body };
  store[entity].push(row);
  return row;
}

function send(res, status, body, type = "application/json") {
  res.writeHead(status, { "content-type": type });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

export function handle(req, res) {
  const url = new URL(req.url || "/", "http://localhost");
  if (req.method === "GET" && url.pathname === "/health") return send(res, 200, health());
  if (req.method === "GET" && url.pathname === "/api/product") return send(res, 200, product);
  const match = url.pathname.match(/^\\/api\\/([a-z0-9-]+)$/);
  if (match && req.method === "GET") {
    try { return send(res, 200, list(match[1])); }
    catch { return send(res, 404, { error: "unknown resource" }); }
  }
  if (match && req.method === "POST") {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      try { return send(res, 201, create(match[1], raw ? JSON.parse(raw) : {})); }
      catch (err) { return send(res, 400, { error: err instanceof Error ? err.message : String(err) }); }
    });
    return;
  }
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    return send(res, 200, fs.readFileSync(path.join(root, "../public/index.html"), "utf8"), "text/html");
  }
  send(res, 404, { error: "not found" });
}

export function createServer() {
  return http.createServer(handle);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  createServer().listen(port, () => console.log(product.name + " listening on " + port));
}
`;

  const unit = `import test from "node:test";
import assert from "node:assert/strict";
import { create, health, list, product } from "../src/app.js";

test("product is the approved ticket", () => {
  assert.equal(health().status, "ok");
  assert.equal(product.key, ${JSON.stringify(opts.ticket.key)});
  assert.ok(product.entities.length > 0);
});

test("each product resource has fixture records", () => {
  for (const entity of product.entities) {
    const rows = list(entity.name);
    assert.ok(rows.length > 0);
    assert.equal(create(entity.name, { name: "sample" }).source, "fixture");
  }
});
`;

  const integration = `import test from "node:test";
import assert from "node:assert/strict";
import { handle, product } from "../src/app.js";

function get(path) {
  return new Promise((resolve) => {
    const chunks = [];
    handle({ method: "GET", url: path }, {
      writeHead() {},
      end(data) { resolve(JSON.parse(String(data ?? "{}"))); },
    });
  });
}

test("http health and first resource use fixture data", async () => {
  const health = await get("/health");
  assert.equal(health.status, "ok");
  const rows = await get("/api/" + product.entities[0].name);
  assert.ok(Array.isArray(rows));
  assert.equal(rows[0].source, "fixture");
});
`;

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${product.name}</title>
  <style>
    body { font-family: Segoe UI, sans-serif; margin: 32px; color: #123; }
    h1 { margin-bottom: 4px; }
    .muted { color: #567; }
    section { margin: 20px 0; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #cde; padding: 8px; text-align: left; }
  </style>
</head>
<body>
  <h1>${product.name}</h1>
  <p class="muted">${opts.ticket.key} · ${product.summary}</p>
  <section>
    <h2>Features</h2>
    <ul>${product.features.map((item) => `<li>${item}</li>`).join("")}</ul>
  </section>
  ${product.entities
    .map(
      (entity) => `<section>
    <h2>${entity.label}</h2>
    <table>
      <thead><tr><th>Id</th><th>Name</th><th>Status</th></tr></thead>
      <tbody>${entity.records
        .map((row) => `<tr><td>${row.id}</td><td>${row.name}</td><td>${row.status}</td></tr>`)
        .join("")}</tbody>
    </table>
  </section>`
    )
    .join("\n")}
</body>
</html>
`;

  return [
    {
      path: "package.json",
      contents: JSON.stringify(
        {
          name: product.slug,
          private: true,
          type: "module",
          scripts: { start: "node src/app.js", test: "node --test" },
        },
        null,
        2
      ),
    },
    { path: "src/app.js", contents: appJs },
    { path: "public/index.html", contents: html },
    { path: "fixtures/data.json", contents: JSON.stringify({ source: "fixture", product, store }, null, 2) },
    { path: "test/unit.test.js", contents: unit },
    { path: "test/integration.test.js", contents: integration },
    {
      path: "README.md",
      contents: `# ${product.name}

Built from Jira ticket **${opts.ticket.key}**.

${opts.ticket.description}

## Features
${product.features.map((item) => `- ${item}`).join("\n")}

## Run
\`\`\`
node src/app.js
\`\`\`

License: ${license}. Fixture data only. Rollback owner: ${opts.policy.rollbackOwner}.
`,
    },
  ];
}
