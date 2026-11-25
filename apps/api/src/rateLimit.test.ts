import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Request, Response } from "express";
import { rateLimitMiddleware } from "./rateLimit.js";

function mockRes() {
  const headers: Record<string, string> = {};
  let statusCode = 200;
  let body: unknown;
  return {
    headers,
    setHeader(k: string, v: string) {
      headers[k] = v;
    },
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(payload: unknown) {
      body = payload;
      return this;
    },
    get statusCode() {
      return statusCode;
    },
    get body() {
      return body;
    },
  };
}

describe("rateLimitMiddleware", () => {
  it("allows under the limit and blocks after", () => {
    const mw = rateLimitMiddleware({ windowMs: 60_000, max: 3 });
    const res = mockRes();
    let nextCount = 0;
    const next = () => {
      nextCount += 1;
    };
    for (let i = 0; i < 3; i++) {
      mw({ ip: "1.2.3.4", path: "/api/projects" } as Request, res as unknown as Response, next);
    }
    assert.equal(nextCount, 3);
    mw({ ip: "1.2.3.4", path: "/api/projects" } as Request, res as unknown as Response, next);
    assert.equal(res.statusCode, 429);
    assert.equal(nextCount, 3);
  });
});
