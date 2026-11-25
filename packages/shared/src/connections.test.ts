import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BUILD_CONNECTION_TYPES,
  DEPLOY_CONNECTION_TYPES,
  connectionFolder,
  isTargetConnectionType,
  typesForFolder,
} from "./connections.js";

describe("connection folders", () => {
  it("puts Jira, Git, and models in Build", () => {
    assert.deepEqual(typesForFolder("build"), BUILD_CONNECTION_TYPES);
    assert.equal(connectionFolder("jira"), "build");
    assert.equal(connectionFolder("git"), "build");
    assert.equal(connectionFolder("model"), "build");
  });

  it("puts hosts and clouds in Deploy without dropping them", () => {
    assert.deepEqual(typesForFolder("deploy"), DEPLOY_CONNECTION_TYPES);
    for (const type of ["ssh", "aws", "azure", "gcp", "docker", "registry", "kubernetes", "notify"] as const) {
      assert.equal(connectionFolder(type), "deploy");
    }
    assert.equal(isTargetConnectionType("ssh"), true);
    assert.equal(isTargetConnectionType("jira"), false);
  });
});
