import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isTransientSshError } from "./lib/ssh.js";

describe("ssh transient error classification", () => {
  it("retries handshake timeouts and connection resets (busy VM)", () => {
    assert.equal(isTransientSshError(new Error("Timed out while waiting for handshake")), true);
    assert.equal(isTransientSshError(new Error("read ECONNRESET")), true);
    assert.equal(isTransientSshError(new Error("connect ECONNREFUSED 1.2.3.4:22")), true);
    assert.equal(isTransientSshError(new Error("connect ETIMEDOUT")), true);
  });

  it("does not retry auth failures (retrying cannot fix a bad key)", () => {
    assert.equal(isTransientSshError(new Error("All configured authentication methods failed")), false);
    assert.equal(isTransientSshError(new Error("Permission denied (publickey)")), false);
  });
});
