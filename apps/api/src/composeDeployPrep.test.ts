import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { prepareComposeForDeploy, stampComposeReleaseImages } from "./lib/composeDeployPrep.js";

describe("composeDeployPrep", () => {
  it("rewrites localhost API URL and adds restart policy", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shipdeck-compose-prep-"));
    const file = path.join(dir, "docker-compose.yml");
    fs.writeFileSync(
      file,
      `services:
  web:
    build:
      context: ./apps/web
      args:
        NEXT_PUBLIC_API_URL: http://localhost:3000/v1
    container_name: sharehaul-web
    ports:
      - "3002:3002"
  api:
    image: api:latest
    container_name: sharehaul-api
`
    );
    const r = prepareComposeForDeploy(file, "http://20.15.200.181:3000/v1");
    assert.equal(r.projectName, "sharehaul");
    assert.ok(r.publicApiRewrites >= 1);
    assert.ok(r.restartAdded >= 2);
    const out = fs.readFileSync(file, "utf8");
    assert.match(out, /http:\/\/20\.15\.200\.181:3000\/v1/);
    assert.doesNotMatch(out, /localhost:3000/);
    assert.match(out, /restart:\s*unless-stopped/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("stamps only the services that build", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shipdeck-compose-stamp-"));
    const file = path.join(dir, "docker-compose.yml");
    fs.writeFileSync(
      file,
      `services:
  web:
    build: ./web
  db:
    image: postgres:16
`
    );
    const names = stampComposeReleaseImages(file, (service, alone) =>
      alone ? `docker.io/acme/app:v1.0.0` : `docker.io/acme/app-${service}:v1.0.0`
    );
    assert.deepEqual(names, ["web"]);
    const out = fs.readFileSync(file, "utf8");
    assert.match(out, /docker\.io\/acme\/app:v1\.0\.0/);
    assert.match(out, /postgres:16/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
