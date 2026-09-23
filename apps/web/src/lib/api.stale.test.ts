import { classifyUrl } from "@cube/core";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { classify, clearClassifyCache, RulingError } from "./api";

vi.mock("./challenge", () => {
  throw new TypeError("Failed to fetch dynamically imported module");
});

beforeEach(() => {
  clearClassifyCache();
  vi.stubEnv("VITE_TURNSTILE_SITE_KEY", "1x00000000000000000000AA");
});
afterEach(() => vi.unstubAllEnvs());

it("asks for a reload when the check's chunk is gone after a deploy", async () => {
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify({ error: { code: "challenge_required", message: "check" } }), {
        status: 401,
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const error = await classify("taco").catch((e: unknown) => e);
  expect(error).toBeInstanceOf(RulingError);
  expect((error as RulingError).code).toBe("stale_client");
  expect(fetchMock).toHaveBeenCalledExactlyOnceWith(classifyUrl("taco"), expect.anything());
});
