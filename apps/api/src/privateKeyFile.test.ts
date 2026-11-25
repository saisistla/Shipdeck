import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { generateDeployPrivateKey } from "./lib/deployKey.js";
import { writePublicKeyFromPem } from "./lib/cloud.js";

function sshKeygen(): string {
  return process.platform === "win32" && fs.existsSync("C:\\Windows\\System32\\OpenSSH\\ssh-keygen.exe")
    ? "C:\\Windows\\System32\\OpenSSH\\ssh-keygen.exe"
    : "ssh-keygen";
}

describe("private key file for Deploy PEM", () => {
  it("reads the public half after the file is locked to the current account", () => {
    const root = path.resolve("..", "..", ".shipdeck-work");
    fs.mkdirSync(root, { recursive: true });
    const dir = fs.mkdtempSync(path.join(root, "pem-acl-"));
    const loose = path.join(dir, "loose.pem");
    fs.writeFileSync(loose, generateDeployPrivateKey(), { mode: 0o666 });
    let looseRejected = false;
    try {
      execFileSync(sshKeygen(), ["-y", "-f", loose], { encoding: "utf8", windowsHide: true, stdio: "pipe" });
    } catch {
      looseRejected = true;
    }
    const pubPath = writePublicKeyFromPem(dir, generateDeployPrivateKey());
    assert.ok(pubPath);
    const pub = fs.readFileSync(pubPath!, "utf8").trim();
    assert.match(pub, /^ssh-rsa /);
    if (process.platform === "win32") assert.equal(looseRejected, true);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
