import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeServerlessUrl, parseServerlessUrl, sameServiceUrl } from "./serverlessUrl.js";

describe("parseServerlessUrl", () => {
  it("reads AWS ECS Express from a live .on.aws URL", () => {
    const parsed = parseServerlessUrl(
      "https://sh-0f408754324f4df8b090bbd48a0d96dc.ecs.eu-west-1.on.aws"
    );
    assert.ok(parsed);
    assert.equal(parsed.kind, "aws");
    assert.equal(parsed.platform, "ecs");
    assert.equal(parsed.serverlessKind, "app");
    assert.equal(parsed.region, "eu-west-1");
    assert.equal(parsed.serviceId, "sh-0f408754324f4df8b090bbd48a0d96dc");
    assert.match(describeServerlessUrl(parsed), /AWS ECS · eu-west-1/);
  });

  it("reads AWS Lambda function URLs", () => {
    const parsed = parseServerlessUrl("https://abc123.lambda-url.eu-west-1.on.aws/");
    assert.equal(parsed?.platform, "lambda");
    assert.equal(parsed?.serverlessKind, "function");
    assert.equal(parsed?.region, "eu-west-1");
  });

  it("treats trailing slashes as the same service", () => {
    assert.equal(
      sameServiceUrl(
        "https://sh-0f408754324f4df8b090bbd48a0d96dc.ecs.eu-west-1.on.aws/",
        "https://sh-0f408754324f4df8b090bbd48a0d96dc.ecs.eu-west-1.on.aws"
      ),
      true
    );
  });
});
