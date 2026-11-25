import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { recommendVmSize, approxRamGbForVmSize, vmSizeForProvider } from "@shipdeck/shared";

describe("vmSizing", () => {
  it("recommends at least medium for ShareHaul-like compose + Next", () => {
    const rec = recommendVmSize({
      stack: "compose+node",
      cloudProvider: "aws",
      signals: ["Found docker-compose.yml", "Found package.json (Node)"],
      compose: {
        services: [
          { name: "postgres", ports: [5432] },
          { name: "redis", ports: [6379] },
          { name: "api", ports: [3000] },
          { name: "admin_web", ports: [3001] },
          { name: "web", ports: [3002] },
        ],
      },
    });
    assert.ok(rec.tier === "medium" || rec.tier === "large");
    assert.ok(rec.minRamGb >= 4);
    assert.ok(rec.aws === "t3.medium" || rec.aws === "t3.large");
    assert.ok(rec.reasons.some((r) => /OOM|Multi-service|Next|Compose|Data|Frontend/i.test(r)));
  });

  it("maps sizes per cloud", () => {
    const rec = recommendVmSize({ stack: "node", cloudProvider: "azure" });
    assert.equal(vmSizeForProvider(rec, "aws"), rec.aws);
    assert.equal(vmSizeForProvider(rec, "azure"), rec.azure);
    assert.equal(approxRamGbForVmSize("t3.micro"), 1);
    assert.equal(approxRamGbForVmSize("t3.medium"), 4);
  });
});
