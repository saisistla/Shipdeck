import assert from "node:assert/strict";
import { createPrivateKey } from "node:crypto";
import { describe, it } from "node:test";
import {
  generateDeployPrivateKey,
  hasDeployPem,
  withAutoDeployKey,
} from "./lib/deployKey.js";

describe("deployKey auto-generation (GCP)", () => {
  it("generates a valid RSA private key PEM", () => {
    const pem = generateDeployPrivateKey();
    assert.match(pem, /BEGIN RSA PRIVATE KEY/);
    assert.match(pem, /END RSA PRIVATE KEY/);
    const key = createPrivateKey(pem);
    assert.equal(key.type, "private");
    assert.equal(key.asymmetricKeyType, "rsa");
  });

  it("auto-generates for GCP when Deploy PEM is blank", () => {
    const { secrets, generated } = withAutoDeployKey("gcp", {
      credentialsJson: "{}",
    });
    assert.equal(generated, true);
    assert.ok(hasDeployPem(secrets));
    assert.equal(secrets.credentialsJson, "{}");
  });

  it("never overwrites an operator-provided PEM", () => {
    const mine = generateDeployPrivateKey();
    const { secrets, generated } = withAutoDeployKey("gcp", {
      credentialsJson: "{}",
      sshPrivateKey: mine,
    });
    assert.equal(generated, false);
    assert.equal(secrets.sshPrivateKey, mine);
  });

  it("does not generate for non-GCP connections", () => {
    const { secrets, generated } = withAutoDeployKey("aws", {});
    assert.equal(generated, false);
    assert.deepEqual(secrets, {});
  });
});
