import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildVerifyCandidates, isRespondingStatus } from "./lib/verifyTargets.js";

describe("verify candidates (no hardcoded ports)", () => {
  it("probes only the actual deploy port for a single-service UI app", () => {
    const urls = buildVerifyCandidates({
      primary: "http://104.199.72.8:43123/health",
      deployHost: "104.199.72.8",
      computeMode: "vm",
      servicePorts: [43123],
    });
    assert.deepEqual(urls, [
      "http://104.199.72.8:43123/health",
      "http://104.199.72.8:43123/",
    ]);
    assert.ok(!urls.some((u) => /:3000|:3001|:3002/.test(u)));
  });

  it("uses compose-detected service ports when they are really deployed", () => {
    const urls = buildVerifyCandidates({
      primary: "http://10.0.0.5:8080/health",
      deployHost: "10.0.0.5",
      computeMode: "vm",
      servicePorts: [8080, 9000],
    });
    assert.ok(urls.includes("http://10.0.0.5:9000/"));
    assert.ok(urls.includes("http://10.0.0.5:8080/"));
  });

  it("does not add VM guesses for serverless endpoints", () => {
    const urls = buildVerifyCandidates({
      primary: "https://abc.lambda-url.eu-west-1.on.aws/health",
      deployHost: "abc.lambda-url.eu-west-1.on.aws",
      computeMode: "serverless",
      servicePorts: [3000],
    });
    assert.deepEqual(urls, ["https://abc.lambda-url.eu-west-1.on.aws/health"]);
  });

  it("keeps serverless full-app probes on the service URL", () => {
    const urls = buildVerifyCandidates({
      primary: "https://api.example.com/health",
      serviceUrl: "https://app.example.com",
      apiUrl: "https://api.example.com",
      computeMode: "serverless",
      serverlessKind: "app",
    });
    assert.ok(urls.includes("https://app.example.com/"));
    assert.ok(urls.includes("https://api.example.com/v1/health"));
  });
});

describe("isRespondingStatus", () => {
  it("treats any answered request below 500 as server-up", () => {
    assert.equal(isRespondingStatus(200), true);
    assert.equal(isRespondingStatus(301), true);
    assert.equal(isRespondingStatus(404), true);
    assert.equal(isRespondingStatus(401), true);
  });
  it("treats 5xx as not healthy", () => {
    assert.equal(isRespondingStatus(500), false);
    assert.equal(isRespondingStatus(503), false);
  });
});
