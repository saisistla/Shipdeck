import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { reviewTestsAgainstSource, writeShipdeckTests } from "./lib/testReview.js";

describe("testReview", () => {
  it("keeps existing unit tests when they already match jest", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shipdeck-tests-"));
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "root", scripts: {} }));
    fs.mkdirSync(path.join(dir, "services", "api"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "services", "api", "package.json"),
      JSON.stringify({ name: "api", scripts: { test: "jest" } })
    );
    fs.writeFileSync(path.join(dir, "services", "api", "app.spec.ts"), "test('ok', () => {});");
    const review = reviewTestsAgainstSource(dir, { runTests: false });
    assert.ok(review.recommended.some((d) => d.dir.replace(/\\/g, "/") === "services/api"));
    assert.equal(review.recommendation, "existing");
    assert.equal(review.generated.length, 0);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("plans a generated smoke spec when jest has no unit files", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shipdeck-tests-gen-"));
    fs.mkdirSync(path.join(dir, "services", "api", "src", "modules", "health"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "services", "api", "package.json"),
      JSON.stringify({
        name: "api",
        scripts: { test: "jest", "test:e2e": "jest --config ./test/jest-e2e.json" },
        jest: { rootDir: "src", testRegex: ".*\\.spec\\.ts$" },
      })
    );
    fs.writeFileSync(
      path.join(dir, "services", "api", "src", "modules", "health", "health.controller.ts"),
      `import { Controller, Get } from '@nestjs/common';
@Controller('health')
export class HealthController {
  @Get()
  check() {
    return { status: 'ok' };
  }
}
`
    );
    fs.mkdirSync(path.join(dir, "services", "api", "test"), { recursive: true });
    fs.writeFileSync(path.join(dir, "services", "api", "test", "app.e2e-spec.ts"), "describe('e2e', () => {});");
    const review = reviewTestsAgainstSource(dir, { runTests: true });
    assert.equal(review.recommendation, "generated");
    assert.ok(review.generated.some((g) => g.path.replace(/\\/g, "/") === "services/api/src/shipdeck.smoke.spec.ts"));
    const wrote = writeShipdeckTests(dir);
    assert.ok(wrote.written.some((p) => p.replace(/\\/g, "/").endsWith("shipdeck.smoke.spec.ts")));
    const body = fs.readFileSync(path.join(dir, "services", "api", "src", "shipdeck.smoke.spec.ts"), "utf8");
    assert.match(body, /HealthController/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
