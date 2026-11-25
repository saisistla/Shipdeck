import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  hostPortsFromEntry,
  parseComposeContents,
} from "./lib/composeDetect.js";
import {
  applyComposeDetection,
  resolveVerifyHealthUrl,
  shouldAutofillHealthUrl,
  suggestedHealthUrl,
} from "@shipdeck/shared";

describe("composeDetect", () => {
  it("parses host ports from string forms", () => {
    assert.deepEqual(hostPortsFromEntry("8080:80"), [8080]);
    assert.deepEqual(hostPortsFromEntry("127.0.0.1:3000:3000"), [3000]);
    assert.deepEqual(hostPortsFromEntry("8080"), [8080]);
    assert.deepEqual(hostPortsFromEntry(4000), [4000]);
    assert.deepEqual(hostPortsFromEntry({ published: 8088, target: 80 }), [8088]);
  });

  it("detects services and prefers web over db ports", () => {
    const raw = `
services:
  db:
    image: postgres:16
    ports:
      - "5432:5432"
  api:
    build: .
    ports:
      - "4000:4000"
  web:
    ports:
      - "8088:80"
`;
    const d = parseComposeContents("docker-compose.yml", raw);
    assert.ok(d);
    assert.equal(d!.file, "docker-compose.yml");
    assert.equal(d!.services.length, 3);
    assert.equal(d!.suggestedPrimaryService, "web");
    assert.equal(d!.suggestedPort, 8088);
  });

  it("does not suggest postgres as the health port", () => {
    const raw = `
services:
  postgres:
    ports:
      - "5432:5432"
  redis:
    ports:
      - "6379:6379"
`;
    const d = parseComposeContents("docker-compose.yml", raw);
    assert.ok(d);
    assert.equal(d!.services.length, 2);
    assert.equal(d!.suggestedPort, 0);
    assert.equal(d!.suggestedPrimaryService, undefined);
  });

  it("applyComposeDetection switches docker → compose and sets port", () => {
    const next = applyComposeDetection(
      { runtime: "docker", port: 8080, healthPath: "/health", envVars: {} },
      {
        file: "docker-compose.yml",
        services: [{ name: "web", ports: [8088] }],
        suggestedPort: 8088,
        suggestedPrimaryService: "web",
      }
    );
    assert.equal(next.runtime, "compose");
    assert.equal(next.port, 8088);
  });
});

describe("verify health URL autofill", () => {
  it("builds host + port and uses / for web instead of /health", () => {
    assert.equal(
      suggestedHealthUrl({
        host: "20.15.200.181",
        port: 3002,
        healthPath: "/health",
        primaryService: "web",
      }),
      "http://20.15.200.181:3002/"
    );
  });

  it("replaces leftover :8080 and localhost URLs", () => {
    const suggested = "http://20.15.200.181:3002/";
    assert.equal(
      shouldAutofillHealthUrl("http://20.15.200.181:8080/health", suggested, 3002, "20.15.200.181"),
      true
    );
    assert.equal(
      shouldAutofillHealthUrl("http://127.0.0.1:8080/health", suggested, 3002, "20.15.200.181"),
      true
    );
    assert.equal(
      shouldAutofillHealthUrl("http://20.15.200.181:3002/v1/health", suggested, 3002, "20.15.200.181"),
      false
    );
  });

  it("ignores a stale override at runtime and uses deploy host + port", () => {
    assert.equal(
      resolveVerifyHealthUrl({
        override: "http://20.15.200.181:8080/health",
        host: "20.15.200.181",
        port: 3002,
        healthPath: "/health",
        primaryService: "web",
      }),
      "http://20.15.200.181:3002/"
    );
  });
});
