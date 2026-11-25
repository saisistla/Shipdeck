import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { reportWasAddressed } from "./workbenchDiff.js";

describe("problem reports", () => {
  it("treats a spacing-only edit as unfixed", () => {
    assert.equal(
      reportWasAddressed("Why is this empty?", [
        { path: "public/index.html", added: ["      margin: 1rem auto;"], removed: ["      margin: 0 auto;"] },
      ]),
      false
    );
  });

  it("treats a data edit as addressed", () => {
    assert.equal(
      reportWasAddressed("Why is this empty?", [
        { path: "public/index.html", added: ["        const data = await res.json();"], removed: [] },
      ]),
      true
    );
  });

  it("leaves an ordinary wording change alone", () => {
    assert.equal(
      reportWasAddressed("Make the page title longer", [{ path: "public/index.html", added: ["<h1>Hi</h1>"], removed: [] }]),
      true
    );
  });

  it("treats a capped page as still cut off", () => {
    assert.equal(
      reportWasAddressed(
        "This should be the full page. It is showing the cut page.",
        [{ path: "public/index.html", added: ["      max-height: 60vh;"], removed: [] }],
        ["main { max-height: 60vh; }"]
      ),
      false
    );
  });

  it("treats a page with no height cap as full", () => {
    assert.equal(
      reportWasAddressed(
        "This should be the full page.",
        [{ path: "public/index.html", added: ["      width: 100%;"], removed: ["      max-height: 60vh;"] }],
        ["main { width: 100%; }"]
      ),
      true
    );
  });
});
