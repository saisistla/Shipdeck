import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { dockerfileBodyForApp, generateShipdeckCompose, planAppsFromSource, reviewComposeAgainstSource } from "./lib/composeGenerate.js";

describe("composeGenerate", () => {
  it("finds a Next app port from package.json scripts", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shipdeck-gen-"));
    fs.mkdirSync(path.join(dir, "apps", "web"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "apps", "web", "package.json"),
      JSON.stringify({
        name: "web",
        scripts: { start: "next start --port 3002" },
        dependencies: { next: "15.0.0" },
      })
    );
    fs.writeFileSync(
      path.join(dir, "docker-compose.yml"),
      `services:\n  postgres:\n    image: postgres:16\n    ports: ["5432:5432"]\n`
    );
    const plan = generateShipdeckCompose(dir);
    assert.match(plan.yaml, /3002:3002/);
    assert.match(plan.yaml, /postgres:/);
    assert.ok(plan.apps.some((a) => a.port === 3002));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("does not make an app depend on itself when merging existing compose apps", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shipdeck-gen-self-"));
    fs.mkdirSync(path.join(dir, "services", "api"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "services", "api", "package.json"),
      JSON.stringify({
        name: "api",
        scripts: { start: "node dist/index.js" },
        dependencies: { express: "4.0.0" },
      })
    );
    fs.writeFileSync(
      path.join(dir, "docker-compose.yml"),
      `services:
  postgres:
    image: postgres:16
    ports: ["5432:5432"]
  redis:
    image: redis:7
    ports: ["6379:6379"]
  api:
    build: ./services/api
    ports: ["3000:3000"]
    depends_on: [postgres, redis]
`
    );
    const plan = generateShipdeckCompose(dir);
    assert.doesNotMatch(plan.yaml, /depends_on:[\s\S]*-\s*api/);
    assert.match(plan.yaml, /postgres/);
    assert.match(plan.yaml, /redis/);
    // Each service gets its own depends_on list (no YAML anchor sharing that pulls in self)
    const apiBlock = plan.yaml.split(/\n(?=  [a-z])/).find((b) => b.startsWith("  api:"));
    assert.ok(apiBlock);
    assert.doesNotMatch(apiBlock!, /^\s+-\s*api\s*$/m);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("marks needsBuild only when the package has a build script", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shipdeck-gen-build-"));
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "clinic-frontdesk-app", scripts: { start: "node src/app.js" } })
    );
    const apps = planAppsFromSource(dir);
    assert.equal(apps[0]?.needsBuild, false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("skips npm run build when package.json has no build script", () => {
    const plain = dockerfileBodyForApp({
      name: "clinic",
      dir: ".",
      port: 3000,
      kind: "node",
      dockerfileRel: "Dockerfile.shipdeck",
      startCommand: "npm start",
      needsBuild: false,
    });
    assert.doesNotMatch(plain, /npm run build/);
    assert.match(plain, /npm start/);

    const nextApp = dockerfileBodyForApp({
      name: "web",
      dir: ".",
      port: 3000,
      kind: "node",
      dockerfileRel: "Dockerfile.shipdeck",
      startCommand: "npx next start",
      needsBuild: true,
    });
    assert.match(nextApp, /npm run build/);
  });

  it("reports discrepancies when compose is database-only", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shipdeck-rev-"));
    fs.mkdirSync(path.join(dir, "apps", "web"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "apps", "web", "package.json"),
      JSON.stringify({
        name: "web",
        scripts: { start: "next start --port 3002" },
        dependencies: { next: "15.0.0" },
      })
    );
    fs.writeFileSync(
      path.join(dir, "docker-compose.yml"),
      `services:\n  postgres:\n    image: postgres:16\n    ports: ["5432:5432"]\n`
    );
    const review = reviewComposeAgainstSource(dir);
    assert.equal(review.hasExisting, true);
    assert.equal(review.matches, false);
    assert.equal(review.recommendation, "generated");
    assert.ok(review.discrepancies.some((d) => d.id === "data-only"));
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
