import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { jestBinaryExists } from "./lib/npmInstall.js";

describe("npmInstall", () => {
  it("detects a local jest binary", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shipdeck-npm-"));
    assert.equal(jestBinaryExists(dir), false);
    fs.mkdirSync(path.join(dir, "node_modules", ".bin"), { recursive: true });
    fs.writeFileSync(path.join(dir, "node_modules", ".bin", "jest.cmd"), "@echo off");
    assert.equal(jestBinaryExists(dir), true);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
