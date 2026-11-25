import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createDefaultBoxes, PIPELINE_BOX_ORDER } from "@shipdeck/shared";
import { roleAtLeast } from "./users.js";

describe("shared pipeline order", () => {
  it("runs data before deploy", () => {
    const dataIdx = PIPELINE_BOX_ORDER.indexOf("data");
    const deployIdx = PIPELINE_BOX_ORDER.indexOf("deploy");
    assert.ok(dataIdx >= 0 && deployIdx >= 0);
    assert.ok(dataIdx < deployIdx);
  });

  it("creates defaults with docker data mode", () => {
    const boxes = createDefaultBoxes();
    assert.equal(boxes.data.provisionMode, "docker");
    assert.equal(boxes.infra.mode, "existing");
  });
});

describe("rbac", () => {
  it("ranks roles correctly", () => {
    assert.equal(roleAtLeast("admin", "operator"), true);
    assert.equal(roleAtLeast("viewer", "operator"), false);
    assert.equal(roleAtLeast("operator", "operator"), true);
  });
});
