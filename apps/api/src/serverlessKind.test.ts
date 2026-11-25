import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { composeHasShipperPath, createDefaultBoxes, recommendServerlessSize, recommendServerlessAppSkus, suggestServerlessKind } from "@shipdeck/shared";
import {
  resolveAppDockerTargets,
  posixRelFromSource,
  gitCloneForCodeBuild,
  imageAcceptsBuildArg,
  composeBuildTfvars,
} from "./lib/serverlessAppDeploy.js";
import { containerRuntimeTfvars, contextProxiesToService, rewriteServiceOrigins } from "./lib/containerRuntime.js";
import { terraformStateHasResources } from "./lib/infraDestroy.js";

describe("suggestServerlessKind", () => {
  it("defaults to function without compose", () => {
    assert.equal(suggestServerlessKind(null), "function");
    assert.equal(suggestServerlessKind({ services: [] }), "function");
  });

  it("suggests app when api + web present", () => {
    assert.equal(
      suggestServerlessKind({
        services: [
          { name: "api", ports: [3000] },
          { name: "web", ports: [3002] },
          { name: "postgres", ports: [5432] },
        ],
      }),
      "app"
    );
  });

  it("stays function for api-only", () => {
    assert.equal(
      suggestServerlessKind({
        services: [{ name: "api", ports: [3000] }],
      }),
      "function"
    );
  });
});

describe("recommendServerlessSize", () => {
  const sharehaul = {
    stack: "compose+node",
    signals: ["Found docker-compose.yml", "Found package.json (Node)"],
    compose: {
      services: [
        { name: "postgres", ports: [5432] },
        { name: "redis", ports: [6379] },
        { name: "api", ports: [3000] },
        { name: "admin_web", ports: [3001] },
        { name: "web", ports: [3002] },
      ],
    },
  };

  it("function kind warns that health is not ShareHaul UI", () => {
    const rec = recommendServerlessSize({ ...sharehaul, kind: "function" });
    assert.equal(rec.kind, "function");
    assert.match(rec.summary, /Health function/i);
    assert.match(String(rec.warning), /Full app UI|Create VM/i);
    assert.ok(!/use Create VM for full ShareHaul/i.test(String(rec.warning)));
  });

  it("app kind recommends containers + managed data, not Lambda", () => {
    const rec = recommendServerlessSize({ ...sharehaul, kind: "app" });
    assert.equal(rec.kind, "app");
    assert.ok(rec.memoryMb >= 1024);
    assert.match(rec.summary, /Full app UI/i);
    assert.match(String(rec.warning), /CodeBuild|ACR|Cloud Build|Docker/i);
    assert.ok(!/health function/i.test(rec.summary));
    assert.ok(rec.reasons.some((r) => /container|managed|api \+ web/i.test(r)));
  });

  it("app SKUs are sized from memory, not a fixed instance class in Terraform", () => {
    const rec = recommendServerlessSize({ ...sharehaul, kind: "app" });
    const skus = recommendServerlessAppSkus({ provider: "aws", memoryMb: rec.memoryMb });
    assert.equal(skus.dbInstanceClass, "db.serverless");
    assert.ok(skus.cpu);
    assert.ok(skus.memory);
    // ECS Express Mode catalog id
    assert.match(skus.computeOptionId, /^ecs-express-/);
  });
});

describe("gitCloneForCodeBuild", () => {
  it("needs an HTTPS git connection", () => {
    const boxes = createDefaultBoxes();
    assert.equal(gitCloneForCodeBuild(boxes), null);
  });

  it("does not use a saved git connection when the source is a local folder", () => {
    const boxes = createDefaultBoxes();
    boxes.source.mode = "local";
    boxes.source.localPath = "D:/any/app";
    boxes.source.gitConnectionId = "leftover-git";
    assert.equal(gitCloneForCodeBuild(boxes), null);
  });
});

describe("composeHasShipperPath", () => {
  it("detects web:3002", () => {
    assert.equal(
      composeHasShipperPath({
        services: [{ name: "web", ports: [3002] }],
      }),
      true
    );
  });
});

describe("serverless defaults", () => {
  it("keeps function as default kind (health path untouched)", () => {
    const boxes = createDefaultBoxes();
    assert.equal(boxes.infra.computeMode, "vm");
    assert.equal(boxes.infra.serverlessKind, "function");
  });
});

describe("resolveAppDockerTargets", () => {
  it("resolves ShareHaul-like compose build contexts", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "shipdeck-app-"));
    fs.mkdirSync(path.join(root, "services", "api"), { recursive: true });
    fs.mkdirSync(path.join(root, "apps", "web"), { recursive: true });
    fs.writeFileSync(path.join(root, "services", "api", "Dockerfile"), "FROM node:20\n");
    fs.writeFileSync(path.join(root, "apps", "web", "Dockerfile"), "FROM node:20\n");
    fs.writeFileSync(
      path.join(root, "docker-compose.yml"),
      `
services:
  api:
    build:
      context: ./services/api
      dockerfile: Dockerfile
    ports: ["3000:3000"]
  web:
    build:
      context: ./apps/web
      dockerfile: Dockerfile
      args:
        NEXT_PUBLIC_API_URL: http://localhost:3000/v1
    ports: ["3002:3002"]
`
    );
    const targets = resolveAppDockerTargets(root);
    assert.ok(targets);
    assert.equal(targets.api.serviceName, "api");
    assert.equal(targets.web.serviceName, "web");
    assert.ok(targets.api.contextDir.includes("services"));
    assert.ok(String(targets.web.buildArgs.NEXT_PUBLIC_API_URL).includes("3000"));
    assert.equal(posixRelFromSource(root, targets.api.contextDir), "services/api");
    assert.equal(posixRelFromSource(root, targets.web.contextDir), "apps/web");
    assert.equal(targets.api.containerPort, 3000);
    assert.equal(targets.web.containerPort, 3002);
    assert.equal(targets.api.healthPath, "/");
    assert.equal(targets.web.healthPath, "/");
    assert.equal(targets.api.target, "");
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("uses one Dockerfile and the stages named in compose", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "shipdeck-stages-"));
    fs.writeFileSync(
      path.join(root, "Dockerfile"),
      "FROM node:22 AS api\nCMD [\"node\"]\nFROM nginx:alpine AS web\nARG NEXT_PUBLIC_API_URL\n"
    );
    fs.writeFileSync(
      path.join(root, "docker-compose.yml"),
      `
services:
  db:
    image: postgres:16
  api:
    build:
      context: .
      dockerfile: Dockerfile
      target: api
  web:
    build:
      context: .
      dockerfile: Dockerfile
      target: web
`
    );
    const targets = resolveAppDockerTargets(root);
    assert.ok(targets);
    assert.equal(posixRelFromSource(root, targets.api.contextDir), ".");
    assert.equal(posixRelFromSource(root, targets.web.contextDir), ".");
    assert.equal(targets.api.target, "api");
    assert.equal(targets.web.target, "web");
    assert.equal(imageAcceptsBuildArg(targets.web, "NEXT_PUBLIC_API_URL"), true);
    assert.equal(imageAcceptsBuildArg(targets.api, "NEXT_PUBLIC_API_URL"), false);
    const tf = composeBuildTfvars(root, targets);
    assert.ok(tf.includes('api_context = "."'));
    assert.ok(tf.includes('api_target = "api"'));
    assert.ok(tf.includes('web_target = "web"'));
    assert.equal(tf.some((line) => line.includes("services/api")), false);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("accepts two build services that are not named api and web", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "shipdeck-names-"));
    fs.mkdirSync(path.join(root, "backend"));
    fs.mkdirSync(path.join(root, "frontend"));
    fs.writeFileSync(path.join(root, "backend", "Dockerfile"), "FROM node:22\n");
    fs.writeFileSync(path.join(root, "frontend", "Dockerfile"), "FROM nginx:alpine\n");
    fs.writeFileSync(
      path.join(root, "docker-compose.yml"),
      `
services:
  backend:
    build: ./backend
  frontend:
    build: ./frontend
`
    );
    const targets = resolveAppDockerTargets(root);
    assert.ok(targets);
    assert.equal(targets.api.serviceName, "backend");
    assert.equal(targets.web.serviceName, "frontend");
    assert.equal(targets.web.healthPath, "/");
    assert.equal(targets.api.containerPort, 8080);
    assert.equal(targets.web.containerPort, 8080);
    assert.equal(posixRelFromSource(root, targets.api.contextDir), "backend");
    assert.equal(posixRelFromSource(root, targets.web.contextDir), "frontend");
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("takes port, health path, and env from the folder instead of a fixed app", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "shipdeck-runtime-"));
    const saved: Record<string, string | undefined> = {};
    for (const key of [
      "SHIPDECK_SIMULATE",
      "SHIPDECK_TF_APPLY",
      "SHIPDECK_API_TOKEN",
      "SHIPDECK_SECRETS_KEY",
      "SHIPDECK_REQUIRE_APPROVAL",
      "SHIPDECK_REQUIRE_APPROVAL_FOR_TF",
    ]) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    try {
      fs.mkdirSync(path.join(root, "src"));
      fs.writeFileSync(
        path.join(root, "Dockerfile"),
        "FROM node:22 AS api\nEXPOSE 4000\nFROM nginx:1.27-alpine AS web\nEXPOSE 80\n"
      );
      fs.writeFileSync(
        path.join(root, "src", "index.ts"),
        'if (pathName === "/health") {}\napp.get("/api/health", () => {});\n'
      );
      fs.writeFileSync(
        path.join(root, "nginx.conf"),
        "proxy_pass http://api:4000/api/;\nproxy_set_header Host $host;\n"
      );
      fs.writeFileSync(
        path.join(root, "docker-compose.yml"),
        `
services:
  db:
    image: postgres:16
  api:
    build:
      context: .
      target: api
    ports: ["4000:4000"]
    environment:
      PORT: "4000"
      DATABASE_URL: postgres://shipdeck:shipdeck@db:5432/shipdeck
      SHIPDECK_SIMULATE: \${SHIPDECK_SIMULATE:-true}
      SHIPDECK_API_TOKEN: \${SHIPDECK_API_TOKEN:-}
  web:
    build:
      context: .
      target: web
    ports: ["8088:80"]
`
      );
      const targets = resolveAppDockerTargets(root);
      assert.ok(targets);
      assert.equal(targets.api.containerPort, 4000);
      assert.equal(targets.api.healthPath, "/api/health");
      assert.equal(targets.api.environment.PORT, "4000");
      assert.equal(targets.api.environment.SHIPDECK_SIMULATE, "true");
      assert.equal(targets.api.environment.DATABASE_URL, undefined);
      assert.equal(targets.api.environment.SHIPDECK_API_TOKEN, undefined);
      assert.equal(targets.api.databaseEnv, "DATABASE_URL");
      assert.equal(targets.api.redisEnv, "");
      assert.equal(targets.api.dbName, "shipdeck");
      assert.equal(targets.api.dbUser, "shipdeck");
      assert.equal(targets.web.containerPort, 80);
      assert.equal(targets.web.healthPath, "/");
      assert.equal(targets.web.databaseEnv, "");
      const tf = containerRuntimeTfvars(targets).join("\n");
      assert.match(tf, /api_health_path = "\/api\/health"/);
      assert.match(tf, /web_health_path = "\/"/);
      assert.match(tf, /api_container_port = 4000/);
      assert.match(tf, /web_container_port = 80/);
      assert.match(tf, /db_name = "shipdeck"/);
      assert.equal(/OTP_|KYC_|JWT_/.test(tf), false);
      assert.equal(contextProxiesToService(root, "api"), true);
      const changed = rewriteServiceOrigins(root, { api: "https://live.example/v1" });
      assert.equal(changed, 1);
      const nginx = fs.readFileSync(path.join(root, "nginx.conf"), "utf8");
      assert.match(nginx, /proxy_pass https:\/\/live\.example\/api\//);
      assert.match(nginx, /proxy_set_header Host live\.example;/);
      assert.match(nginx, /proxy_ssl_server_name on;/);
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("terraformStateHasResources", () => {
  it("does not treat a locked or unreadable state as empty", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "shipdeck-tfstate-"));
    assert.equal(await terraformStateHasResources(root), false);
    const state = path.join(root, "terraform.tfstate");
    fs.writeFileSync(state, JSON.stringify({ resources: [] }));
    assert.equal(await terraformStateHasResources(root), false);
    fs.writeFileSync(state, JSON.stringify({ resources: [{ type: "aws_vpc" }] }));
    assert.equal(await terraformStateHasResources(root), true);
    fs.writeFileSync(path.join(root, ".terraform.tfstate.lock.info"), "{}");
    fs.writeFileSync(state, JSON.stringify({ resources: [] }));
    assert.equal(await terraformStateHasResources(root), true);
    fs.rmSync(path.join(root, ".terraform.tfstate.lock.info"));
    fs.writeFileSync(state, "{not-json");
    assert.equal(await terraformStateHasResources(root), true);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
