import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  runNamePrefix,
  runScopedName,
  runSuffix,
  safeAlphanumericName,
  safeName,
} from "./lib/naming.js";

const GCP_NAME_RE = /^[a-z](?:[-a-z0-9]{0,61}[a-z0-9])?$/;

describe("standardized naming (all clouds)", () => {
  it("lowercases the mixed-case run ID that broke GCP", () => {
    // Run siOeohrHKPSW produced "shipdeck-siOeoh-net" -> rejected by GCP.
    assert.equal(runNamePrefix("siOeohrHKPSW"), "shipdeck-sioeoh");
    assert.match(`${runNamePrefix("siOeohrHKPSW")}-net`, GCP_NAME_RE);
  });

  it("produces GCP-valid prefixes for random mixed-case IDs", () => {
    for (const id of ["HmD1Ce1ut0PA", "rGf5gmXMahUx", "ABCDEF123456", "a-uWoR6rpCDb", "123abcDEF"]) {
      assert.match(runNamePrefix(id), GCP_NAME_RE, id);
      assert.match(runNamePrefix(id, "db"), GCP_NAME_RE, id);
      assert.match(runScopedName("shipdeck-prev", id), GCP_NAME_RE, id);
    }
  });

  it("sanitizes arbitrary input to lowercase hyphen form", () => {
    assert.equal(safeName("My App_Server!! v2"), "my-app-server-v2");
    assert.equal(safeName("--Weird__Name--"), "weird-name");
    assert.equal(safeName(""), "shipdeck");
    assert.equal(safeName("9lives"), "s-9lives");
  });

  it("alphanumeric variant drops hyphens for storage/registry names", () => {
    assert.equal(safeAlphanumericName("Shipdeck-App_01"), "shipdeckapp01");
    assert.match(safeAlphanumericName("SiOeoh-Net"), /^[a-z][a-z0-9]*$/);
  });

  it("run suffix is lowercase and trimmed", () => {
    assert.equal(runSuffix("siOeohrHKPSW"), "sioeoh");
    assert.equal(runSuffix("HmD1Ce1ut0PA", 8), "hmd1ce1u");
  });
});
