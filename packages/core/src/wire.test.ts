import { describe, expect, expectTypeOf, it } from "vitest";
import { mockCubeResponse } from "./mock";
import type { CubeResponse } from "./questions";
import {
  CLASSIFY_ERROR_CODES,
  type ClassifyErrorBody,
  type ClassifyErrorCode,
  type ClassifyErrorStatus,
  type ClassifyResponse,
  isClassifyErrorBody,
  isClassifyErrorCode,
} from "./wire";

describe("CLASSIFY_ERROR_CODES", () => {
  it("maps each error code to its HTTP status", () => {
    expect(CLASSIFY_ERROR_CODES).toEqual({
      bad_request: 400,
      challenge_required: 401,
      not_found: 404,
      method_not_allowed: 405,
      stale_client: 409,
      rate_limited: 429,
      client_limit: 429,
      daily_limit: 503,
      upstream_busy: 503,
      upstream_error: 502,
      timeout: 504,
      internal: 500,
    });
  });

  it("types codes and statuses as literal unions", () => {
    expectTypeOf<ClassifyErrorCode>().toEqualTypeOf<
      | "bad_request"
      | "challenge_required"
      | "not_found"
      | "method_not_allowed"
      | "stale_client"
      | "rate_limited"
      | "client_limit"
      | "daily_limit"
      | "upstream_busy"
      | "upstream_error"
      | "timeout"
      | "internal"
    >();
    expectTypeOf<ClassifyErrorStatus>().toEqualTypeOf<
      400 | 401 | 404 | 405 | 409 | 429 | 503 | 502 | 504 | 500
    >();
    expectTypeOf<ClassifyErrorBody["error"]["code"]>().toEqualTypeOf<ClassifyErrorCode>();
  });
});

describe("ClassifyResponse", () => {
  it("is the raw Jev response with an optional mock flag", () => {
    expectTypeOf<ClassifyResponse>().toExtend<CubeResponse>();
    expectTypeOf<ClassifyResponse["mock"]>().toEqualTypeOf<true | undefined>();
    const mocked: ClassifyResponse = { ...mockCubeResponse("taco"), mock: true };
    expect(mocked.mock).toBe(true);
  });
});

describe("isClassifyErrorBody", () => {
  it("accepts every documented error body", () => {
    for (const code of Object.keys(CLASSIFY_ERROR_CODES)) {
      expect(isClassifyErrorBody({ error: { code, message: "nope" } })).toBe(true);
    }
  });

  it.each([
    ["null", null],
    ["a string", "error"],
    ["a success body", mockCubeResponse("taco")],
    ["an unknown code", { error: { code: "teapot", message: "no" } }],
    ["a prototype key as code", { error: { code: "toString", message: "no" } }],
    ["a missing message", { error: { code: "timeout" } }],
    ["a non-string message", { error: { code: "timeout", message: 504 } }],
  ])("rejects %s", (_label, value) => {
    expect(isClassifyErrorBody(value)).toBe(false);
  });

  it("accepts the guard codes the SPA reacts to", () => {
    for (const code of ["challenge_required", "daily_limit", "method_not_allowed", "not_found"]) {
      expect(isClassifyErrorCode(code), code).toBe(true);
    }
  });

  it("narrows unknown JSON", () => {
    const body: unknown = { error: { code: "rate_limited", message: "slow down" } };
    if (isClassifyErrorBody(body)) {
      expectTypeOf(body.error.code).toEqualTypeOf<ClassifyErrorCode>();
      expect(CLASSIFY_ERROR_CODES[body.error.code]).toBe(429);
    }
    expect(isClassifyErrorCode("internal")).toBe(true);
    expect(isClassifyErrorCode(500)).toBe(false);
  });
});
