import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractJson } from "./planner.js";

describe("extractJson", () => {
  it("reads a fenced object", () => {
    const parsed = extractJson('```json\n{"path":"src/app.js","contents":"ok"}\n```') as {
      path: string;
    };
    assert.equal(parsed.path, "src/app.js");
  });

  it("explains a cut-off string instead of throwing a raw SyntaxError", () => {
    assert.throws(
      () => extractJson('{"path":"src/app.js","contents":"unterminated'),
      /cut off or not valid JSON/
    );
  });
});
