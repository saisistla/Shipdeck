import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { splitPublishPorts } from "@shipdeck/shared";

describe("splitPublishPorts", () => {
  it("opens API/UI ports and keeps database ports private", () => {
    const { publicPorts, privatePorts } = splitPublishPorts([5432, 6379, 8001], [8001]);
    assert.deepEqual(publicPorts, [8001]);
    assert.deepEqual(privatePorts, [5432, 6379]);
  });
});
