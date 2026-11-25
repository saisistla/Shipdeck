import fs from "node:fs";
import path from "node:path";

/**
 * Whether an entry inside a Terraform module directory is safe to copy into a
 * per-run workspace.
 *
 * Module directories must never be copied wholesale: a local `terraform init`
 * leaves a `.terraform/` directory (provider binaries) plus state/plan files
 * behind, and `copyFileSync` on a directory or locked provider binary fails
 * with `EPERM` on Windows — killing Infra before Terraform even starts.
 */
export function shouldCopyTerraformModuleEntry(name: string, isFile: boolean): boolean {
  if (!isFile) return false;
  const lower = name.toLowerCase();
  if (lower.startsWith(".terraform")) return false; // .terraform/ dir + lock file
  if (lower === "terraform.tfvars" || lower === "terraform.tfvars.json") return false;
  if (lower === "tfplan" || lower === "plan.out") return false;
  if (lower.includes(".tfstate")) return false;
  if (lower === "crash.log" || lower.endsWith(".tfplan")) return false;
  return true;
}

/**
 * Copy only the real module files (main.tf, helper scripts, …) from a shared
 * Terraform module directory into a per-run workspace, skipping generated
 * artifacts (`.terraform`, state, plans, tfvars). Returns copied file names.
 */
export function copyTerraformModule(moduleDir: string, workDir: string): string[] {
  fs.mkdirSync(workDir, { recursive: true });
  const copied: string[] = [];
  for (const entry of fs.readdirSync(moduleDir, { withFileTypes: true })) {
    if (!shouldCopyTerraformModuleEntry(entry.name, entry.isFile())) continue;
    fs.copyFileSync(path.join(moduleDir, entry.name), path.join(workDir, entry.name));
    copied.push(entry.name);
  }
  return copied;
}
