import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Runtime settings — toggleable via API without restart; persisted under data/. */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const settingsFile = path.join(repoRoot, "data", "settings.json");

type SettingsShape = {
  simulate: boolean;
  tfApply: boolean;
  requireApproval: boolean;
  requireApprovalForTf: boolean;
};

function defaultsFromEnv(): SettingsShape {
  return {
    simulate: process.env.SHIPDECK_SIMULATE !== "false",
    tfApply: process.env.SHIPDECK_TF_APPLY === "true",
    requireApproval: process.env.SHIPDECK_REQUIRE_APPROVAL === "true",
    requireApprovalForTf: process.env.SHIPDECK_REQUIRE_APPROVAL_FOR_TF !== "false",
  };
}

function loadPersisted(): Partial<SettingsShape> {
  try {
    if (!fs.existsSync(settingsFile)) return {};
    const raw = JSON.parse(fs.readFileSync(settingsFile, "utf8")) as Partial<SettingsShape>;
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

const merged = { ...defaultsFromEnv(), ...loadPersisted() };

export const settings: SettingsShape = {
  simulate: Boolean(merged.simulate),
  tfApply: Boolean(merged.tfApply),
  requireApproval: Boolean(merged.requireApproval),
  requireApprovalForTf: Boolean(merged.requireApprovalForTf),
};

export function persistSettings(): void {
  try {
    fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
    fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2), "utf8");
  } catch (err) {
    console.warn("[settings] persist failed:", err);
  }
}
