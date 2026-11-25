import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectProjectRules } from "./projectRules.js";

describe("detectProjectRules", () => {
  it("reads languages, package sources, and license from the repository files", () => {
    const rules = detectProjectRules(
      [
        "package.json",
        "tsconfig.json",
        "app/page.tsx",
        "components/shop-home.tsx",
        "packaging/launcher/go.mod",
        "packaging/launcher/main.go",
      ],
      {
        "package.json": JSON.stringify({
          private: true,
          dependencies: { next: "16.4.0", react: "19.3.0" },
          devDependencies: { typescript: "^5" },
        }),
      }
    );
    assert.ok(rules);
    assert.deepEqual(rules?.allowedLanguages, ["typescript", "node", "go"]);
    assert.deepEqual(rules?.allowedPackageSources, ["https://registry.npmjs.org", "https://proxy.golang.org"]);
    assert.deepEqual(rules?.allowedLicenses, ["UNLICENSED"]);
  });

  it("keeps a license declared by the project and does not add languages that are absent", () => {
    const rules = detectProjectRules(
      ["package.json", "requirements.txt", "src/app.py", "LICENSE"],
      {
        "package.json": JSON.stringify({ license: "Apache-2.0", dependencies: { express: "4.0.0" } }),
        LICENSE: "Apache License Version 2.0",
      }
    );
    assert.deepEqual(rules?.allowedLanguages, ["node", "python"]);
    assert.deepEqual(rules?.allowedPackageSources, ["https://registry.npmjs.org", "https://pypi.org"]);
    assert.deepEqual(rules?.allowedLicenses, ["Apache-2.0"]);
  });
});
