import { CLIENT_TIMEOUT_MS, classifyUrl, mockCubeResponse, PREFETCH_HEADER } from "@cube/core";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import {
  cachedClassified,
  classify,
  clearClassifyCache,
  parseRetryAfter,
  prefetch,
  RulingError,
  SESSION_URL,
} from "./api";
import { solveChallenge } from "./challenge";

vi.mock("./challenge", () => ({ solveChallenge: vi.fn() }));

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
    const fetchMock = vi.fn(async (_url: string) =>
      json(
        { ...mockCubeResponse("hot dog"), mock: true },
        { headers: { "cf-cache-status": "HIT" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const first = await classify("hot dog");
    const second = await classify("hot dog");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(classifyUrl("hot dog"));
    expect(first.cache).toBe("HIT");
    expect(first.response.mock).toBe(true);
    expect(second).toBe(first);
  });

  it.each([
    [400, "bad_request"],
    [404, "not_found"],
    [405, "method_not_allowed"],
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

describe("classify behind the human check", () => {
  const SITE_KEY = "1x00000000000000000000AA";
  const solve = solveChallenge as Mock<typeof solveChallenge>;
  const challenge = () =>
    json({ error: { code: "challenge_required", message: "check first" } }, { status: 401 });
  const ruling = (item: string) =>
    json(mockCubeResponse(item), { headers: { "x-cube-cache": "MISS", "cf-cache-status": "HIT" } });
  const sessionOk = () => new Response(null, { status: 204 });

  type Call = [url: string, init?: RequestInit];
  let fetchMock: Mock<(...args: Call) => Promise<Response>>;
  const urls = () => fetchMock.mock.calls.map(([url, init]) => `${init?.method ?? "GET"} ${url}`);

  beforeEach(() => {
    clearClassifyCache();
    solve.mockReset();
    solve.mockResolvedValue("XXXX.DUMMY.TOKEN.XXXX");
    vi.stubEnv("VITE_TURNSTILE_SITE_KEY", SITE_KEY);
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllEnvs());

  it("runs one challenge, starts a session, then retries once", async () => {
    fetchMock
      .mockResolvedValueOnce(challenge())
      .mockResolvedValueOnce(sessionOk())
      .mockResolvedValueOnce(ruling("taco"));

    const result = await classify("taco");
    expect(result.response.model).toBe("mock");
    expect(result.cache).toBe("MISS");
    expect(solve).toHaveBeenCalledExactlyOnceWith(SITE_KEY);
    expect(urls()).toEqual([
      `GET ${classifyUrl("taco")}`,
      `POST ${SESSION_URL}`,
      `GET ${classifyUrl("taco")}`,
    ]);
    const init = fetchMock.mock.calls[1]?.[1];
    expect(JSON.parse(String(init?.body))).toEqual({ token: "XXXX.DUMMY.TOKEN.XXXX" });
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
  });

  it("does not loop when the retry is challenged again", async () => {
    fetchMock
      .mockResolvedValueOnce(challenge())
      .mockResolvedValueOnce(sessionOk())
      .mockResolvedValueOnce(challenge());
    const error = await failure("taco");
    expect(error.code).toBe("challenge_required");
    expect(solve).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("reports a failed widget as challenge_required without posting a session", async () => {
    fetchMock.mockResolvedValueOnce(challenge());
    solve.mockRejectedValueOnce(new Error("error 600010"));
    expect((await failure("taco")).code).toBe("challenge_required");
    expect(urls()).toEqual([`GET ${classifyUrl("taco")}`]);
  });

  it("surfaces a rejected session without retrying the ruling", async () => {
    fetchMock.mockResolvedValueOnce(challenge()).mockResolvedValueOnce(
      json(
        { error: { code: "rate_limited", message: "slow" } },
        {
          status: 429,
          headers: { "retry-after": "30" },
        },
      ),
    );
    const error = await failure("taco");
    expect(error.code).toBe("rate_limited");
    expect(error.retryAfter).toBe(30);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("cannot solve a challenge without a sitekey in the build", async () => {
    vi.stubEnv("VITE_TURNSTILE_SITE_KEY", "");
    fetchMock.mockResolvedValueOnce(challenge());
    expect((await failure("taco")).code).toBe("challenge_required");
    expect(solve).not.toHaveBeenCalled();
  });

  it("shares one challenge between rulings that miss together", async () => {
    let release = () => {};
    solve.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve("XXXX.DUMMY.TOKEN.XXXX");
        }),
    );
    fetchMock.mockImplementation(async (url) => {
      if (url === SESSION_URL) return sessionOk();
      const sessions = fetchMock.mock.calls.filter(([u]) => u === SESSION_URL).length;
      if (sessions === 0) return challenge();
      return ruling(url.includes("taco") ? "taco" : "pizza");
    });

    const both = Promise.all([classify("taco"), classify("pizza")]);
    await vi.waitFor(() => expect(solve).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    release();
    await both;
    expect(solve).toHaveBeenCalledTimes(1);
    expect(urls().filter((u) => u.startsWith("POST"))).toHaveLength(1);
  });

  it("never starts a human check for a prefetch", async () => {
    fetchMock.mockResolvedValueOnce(challenge());
    prefetch("taco");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(solve).not.toHaveBeenCalled();
    expect(urls()).toEqual([`GET ${classifyUrl("taco")}`]);
    expect(cachedClassified("taco")).toBeUndefined();
  });

  it("asks for stored rulings only when prefetching, and keeps a hit", async () => {
    fetchMock.mockResolvedValueOnce(ruling("taco"));
    prefetch("taco");
    await vi.waitFor(() => expect(cachedClassified("taco")).toBeDefined());
    const init = fetchMock.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).get(PREFETCH_HEADER)).toBe("1");
    prefetch("taco");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("runs the human check for a pick made while a prefetch misses", async () => {
    let release = () => {};
    fetchMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () => resolve(new Response(null, { status: 204 }));
          }),
      )
      .mockResolvedValueOnce(challenge())
      .mockResolvedValueOnce(sessionOk())
      .mockResolvedValueOnce(ruling("taco"));

    prefetch("taco");
    const picked = classify("taco");
    release();
    expect((await picked).response.model).toBe("mock");
    expect(solve).toHaveBeenCalledTimes(1);
    expect(urls()).toEqual([
      `GET ${classifyUrl("taco")}`,
      `GET ${classifyUrl("taco")}`,
      `POST ${SESSION_URL}`,
      `GET ${classifyUrl("taco")}`,
    ]);
    const headers = fetchMock.mock.calls.map(([, init]) =>
      new Headers(init?.headers).get(PREFETCH_HEADER),
    );
    expect(headers).toEqual(["1", null, null, null]);
  });

  it("keeps the reset time from a daily_limit refusal", async () => {
    fetchMock.mockResolvedValueOnce(
      json(
        { error: { code: "daily_limit", message: "resting" } },
        {
          status: 503,
          headers: { "retry-after": "5400" },
        },
      ),
    );
    const error = await failure("taco");
    expect(error.code).toBe("daily_limit");
    expect(error.retryAfter).toBe(5400);
    expect(solve).not.toHaveBeenCalled();
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
