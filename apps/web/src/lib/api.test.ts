import { mockCubeResponse } from "@cube/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLIENT_TIMEOUT_MS, classify, clearClassifyCache, parseRetryAfter, RulingError } from "./api";

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  });

async function failure(item: string): Promise<RulingError> {
  const error = await classify(item).catch((e: unknown) => e);
  if (!(error instanceof RulingError)) throw new Error("expected a RulingError");
  return error;
}

describe("classify", () => {
  beforeEach(() => clearClassifyCache());
  afterEach(() => vi.useRealTimers());

  it("calls only the canonical same-origin URL and caches the answer", async () => {
    const fetchMock = vi.fn(async () =>
      json({ ...mockCubeResponse("hot dog"), mock: true }, { headers: { "cf-cache-status": "HIT" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const first = await classify("hot dog");
    const second = await classify("hot dog");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/classify?food=hot+dog&v=2");
    expect(first.cache).toBe("HIT");
    expect(first.response.mock).toBe(true);
    expect(second).toBe(first);
  });

  it.each([
    [400, "bad_request"],
    [429, "rate_limited"],
    [502, "upstream_error"],
    [503, "upstream_busy"],
    [504, "timeout"],
    [500, "internal"],
  ] as const)("maps a %s error body to %s", async (status, code) => {
    vi.stubGlobal("fetch", async () =>
      json({ error: { code, message: "nope" } }, { status, headers: { "retry-after": "12" } }),
    );
    const error = await failure("taco");
    expect(error.code).toBe(code);
    expect(error.retryAfter).toBe(12);
  });

  it("falls back to the status when the body is not ours", async () => {
    vi.stubGlobal("fetch", async () => new Response("<html>bad gateway</html>", { status: 503 }));
    expect((await failure("taco")).code).toBe("upstream_busy");
  });

  it("rejects a success body that is not a ruling", async () => {
    vi.stubGlobal("fetch", async () => json({ hello: "world" }));
    expect((await failure("taco")).code).toBe("internal");
  });

  it("refetches after a failure", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(json(mockCubeResponse("taco")));
    vi.stubGlobal("fetch", fetchMock);
    expect((await failure("taco")).code).toBe("network");
    await expect(classify("taco")).resolves.toMatchObject({ response: { model: "mock" } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports offline when the browser says so", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    expect((await failure("taco")).code).toBe("offline");
  });

  it("aborts after the client timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new DOMException("", "AbortError")));
        }),
    );
    const pending = failure("taco");
    await vi.advanceTimersByTimeAsync(CLIENT_TIMEOUT_MS);
    expect((await pending).code).toBe("timeout");
  });
});

describe("parseRetryAfter", () => {
  it("reads seconds and HTTP dates", () => {
    expect(parseRetryAfter("7")).toBe(7);
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter("soon")).toBeNull();
    const now = Date.parse("2026-09-22T12:00:00Z");
    expect(parseRetryAfter("Tue, 22 Sep 2026 12:00:30 GMT", now)).toBe(30);
  });
});
