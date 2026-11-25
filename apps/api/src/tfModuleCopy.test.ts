import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { copyTerraformModule, shouldCopyTerraformModuleEntry } from "./lib/tfModuleCopy.js";

describe("terraform module copy (EPERM regression)", () => {
  it("rejects .terraform, state, plan and tfvars entries", () => {
    assert.equal(shouldCopyTerraformModuleEntry(".terraform", false), false);
    assert.equal(shouldCopyTerraformModuleEntry(".terraform.lock.hcl", true), false);
    assert.equal(shouldCopyTerraformModuleEntry("terraform.tfstate", true), false);
    assert.equal(shouldCopyTerraformModuleEntry("terraform.tfstate.backup", true), false);
    assert.equal(shouldCopyTerraformModuleEntry("terraform.tfvars", true), false);
    assert.equal(shouldCopyTerraformModuleEntry("tfplan", true), false);
    assert.equal(shouldCopyTerraformModuleEntry("main.tf", false), false); // directories never copied
  });

  it("accepts real module files", () => {
    assert.equal(shouldCopyTerraformModuleEntry("main.tf", true), true);
    assert.equal(shouldCopyTerraformModuleEntry("cloud-init-docker.sh", true), true);
    assert.equal(shouldCopyTerraformModuleEntry("variables.tf", true), true);
  });

  it("copies module files but leaves .terraform behind", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "shipdeck-tfmod-"));
    const moduleDir = path.join(root, "module");
    const workDir = path.join(root, "work");
    fs.mkdirSync(path.join(moduleDir, ".terraform", "providers"), { recursive: true });
    fs.writeFileSync(path.join(moduleDir, "main.tf"), 'resource "null_resource" "x" {}\n');
    fs.writeFileSync(path.join(moduleDir, ".terraform.lock.hcl"), "# lock\n");
    fs.writeFileSync(path.join(moduleDir, "terraform.tfstate"), "{}\n");
    fs.writeFileSync(path.join(moduleDir, ".terraform", "providers", "provider.exe"), "binary");

    const copied = copyTerraformModule(moduleDir, workDir);
    assert.deepEqual(copied, ["main.tf"]);
    assert.equal(fs.existsSync(path.join(workDir, "main.tf")), true);
    assert.equal(fs.existsSync(path.join(workDir, ".terraform")), false);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
