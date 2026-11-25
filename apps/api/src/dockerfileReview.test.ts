import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { parseDockerfileMeta, reviewDockerfilesAgainstSource } from "./lib/dockerfileReview.js";

describe("dockerfileReview", () => {
  it("parses EXPOSE and treats a real Dockerfile as valid", () => {
    const meta = parseDockerfileMeta(`FROM node:22-alpine
EXPOSE 3002
CMD ["node", "server.js"]
`);
    assert.equal(meta.from, "node:22-alpine");
    assert.deepEqual(meta.expose, [3002]);
    assert.equal(meta.valid, true);
  });

  it("finds subfolder Dockerfiles and does not require a root file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shipdeck-df-"));
    fs.mkdirSync(path.join(dir, "apps", "web"), { recursive: true });
    fs.mkdirSync(path.join(dir, "services", "api"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "apps", "web", "package.json"),
      JSON.stringify({
        name: "web",
        scripts: { start: "next start --port 3002" },
        dependencies: { next: "15.0.0" },
      })
    );
    fs.writeFileSync(
      path.join(dir, "services", "api", "package.json"),
      JSON.stringify({
        name: "api",
        scripts: { start: "node dist/main.js" },
        dependencies: { "@nestjs/core": "10.0.0" },
      })
    );
    fs.writeFileSync(
      path.join(dir, "apps", "web", "Dockerfile"),
      "FROM node:22-alpine\nEXPOSE 3002\nCMD [\"node\",\"server.js\"]\n"
    );
    fs.writeFileSync(
      path.join(dir, "services", "api", "Dockerfile"),
      "FROM node:22-bookworm-slim\nEXPOSE 3000\nCMD [\"node\",\"dist/main.js\"]\n"
    );
    const review = reviewDockerfilesAgainstSource(dir, { dockerfilePath: "Dockerfile" });
    assert.equal(review.hasExisting, true);
    assert.equal(review.configuredExists, false);
    assert.equal(review.recommendation, "existing");
    assert.ok(review.discrepancies.some((d) => d.id === "root-missing"));
    assert.ok(review.discovered.some((d) => d.path.replace(/\\/g, "/") === "apps/web/Dockerfile"));
    assert.ok(review.discovered.some((d) => d.path.replace(/\\/g, "/") === "services/api/Dockerfile"));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("recommends generate when source apps have no Dockerfile", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shipdeck-df-miss-"));
    fs.mkdirSync(path.join(dir, "apps", "web"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "apps", "web", "package.json"),
      JSON.stringify({
        name: "web",
        scripts: { start: "next start --port 3002" },
        dependencies: { next: "15.0.0" },
      })
    );
    const review = reviewDockerfilesAgainstSource(dir, { dockerfilePath: "Dockerfile" });
    assert.equal(review.hasExisting, false);
    assert.equal(review.recommendation, "generated");
    assert.ok(review.discrepancies.some((d) => d.id === "missing-file" || d.id.startsWith("missing-")));
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
