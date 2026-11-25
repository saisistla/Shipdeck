import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { imageVersionForRegistry } from "@shipdeck/shared";
import { incrementDockerReleaseTag, registryImageName, resolveDockerReleaseTag } from "./lib/imageTag.js";

describe("docker release tag", () => {
  it("keeps a standard version", () => {
    assert.deepEqual(resolveDockerReleaseTag("v1.1.0"), { ok: true, tag: "v1.1.0" });
  });

  it("adds the leading v", () => {
    assert.deepEqual(resolveDockerReleaseTag("1.2.3"), { ok: true, tag: "v1.2.3" });
  });

  it("defaults when the field is empty", () => {
    assert.deepEqual(resolveDockerReleaseTag(""), { ok: true, tag: "v1.0.0" });
    assert.deepEqual(resolveDockerReleaseTag(undefined), { ok: true, tag: "v1.0.0" });
  });

  it("rejects a run id or a partial number", () => {
    assert.equal(resolveDockerReleaseTag("shipdeck-ab12cd34").ok, false);
    assert.equal(resolveDockerReleaseTag("v1.1").ok, false);
    assert.equal(resolveDockerReleaseTag("latest").ok, false);
  });

  it("raises the last number by one", () => {
    assert.equal(incrementDockerReleaseTag("v1.1.0"), "v1.1.1");
    assert.equal(incrementDockerReleaseTag("1.0.9"), "v1.0.10");
  });

  it("starts each Docker Hub login at v1.0.0", () => {
    const surabhee = "reg-surabhee";
    const shipdeck = "reg-shipdeck";
    const build = {
      registryConnectionId: surabhee,
      imageVersion: "v1.0.1",
      imageVersions: { [surabhee]: "v1.0.1" },
    };
    assert.equal(imageVersionForRegistry(build, surabhee), "v1.0.1");
    assert.equal(imageVersionForRegistry(build, shipdeck), "v1.0.0");
  });

  it("keeps every image in the given repository", () => {
    assert.equal(registryImageName("docker.io", "acme/surabhee", "v1.0.1"), "docker.io/acme/surabhee:v1.0.1");
    assert.equal(
      registryImageName("docker.io", "plavauk/shipdeck", "v1.0.0", "api"),
      "docker.io/plavauk/shipdeck:api-v1.0.0"
    );
    assert.equal(
      registryImageName("docker.io", "plavauk/shipdeck", "v1.0.0", "web"),
      "docker.io/plavauk/shipdeck:web-v1.0.0"
    );
  });
});
