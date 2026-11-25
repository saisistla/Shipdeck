import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { createDefaultBoxes } from "@shipdeck/shared";
import { cloneUrlWithToken, forceRmDir, gitCloneErrorHint, resolveSourceRoot } from "./lib/gitSource.js";

describe("gitSource", () => {
  it("embeds a token only on https clone URLs", () => {
    assert.equal(
      cloneUrlWithToken("https://github.com/acme/app.git", "tok", "sai"),
      "https://sai:tok@github.com/acme/app.git"
    );
    assert.equal(
      cloneUrlWithToken("git@github.com:acme/app.git", "tok", "sai"),
      "git@github.com:acme/app.git"
    );
  });

  it("uses the local folder when Source mode is local", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shipdeck-src-"));
    const boxes = createDefaultBoxes();
    boxes.source.mode = "local";
    boxes.source.localPath = dir;
    const resolved = await resolveSourceRoot(boxes);
    assert.equal(resolved.ok, true);
    if (resolved.ok) assert.equal(resolved.root, dir);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("asks for a Git connection when Source is remote with no URL", async () => {
    const boxes = createDefaultBoxes();
    boxes.source.mode = "remote";
    boxes.source.gitConnectionId = "missing";
    const resolved = await resolveSourceRoot(boxes);
    assert.equal(resolved.ok, false);
    if (!resolved.ok) {
      assert.match(resolved.error, /Git repo/i);
      assert.doesNotMatch(resolved.error, /local Source path/i);
    }
  });

  it("deletes a folder even when files are read-only", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shipdeck-ro-"));
    const nested = path.join(dir, ".git");
    fs.mkdirSync(nested);
    const file = path.join(nested, "locked.bin");
    fs.writeFileSync(file, "x");
    fs.chmodSync(file, 0o444);
    forceRmDir(dir);
    assert.equal(fs.existsSync(dir), false);
  });

  it("turns git stderr into a short reason", () => {
    assert.match(gitCloneErrorHint("fatal: Authentication failed for 'https://github.com/x/y.git'"), /login failed/i);
    assert.match(gitCloneErrorHint("fatal: repository 'https://github.com/x/y.git' not found"), /could not find/i);
    assert.match(
      gitCloneErrorHint("fatal: destination path 'src' already exists and is not an empty directory"),
      /already exists/i
    );
  });
});
