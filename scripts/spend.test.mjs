import { describe, expect, it } from "vitest";
import {
  accountIdFrom,
  averageInputTokens,
  daysBefore,
  FALLBACK_TOKENS_PER_CALL,
  formatReport,
  parseDailyCallLimit,
  summarize,
} from "./spend.mjs";

const TOKENS = FALLBACK_TOKENS_PER_CALL;
const PER_CALL = (TOKENS * 0.042) / 1e6;

describe("parseDailyCallLimit", () => {
  it("reads DAILY_CALL_LIMIT from wrangler.jsonc, comments and all", () => {
    const jsonc = `{
      "vars": {
        // Jev calls allowed per UTC day.
        "DAILY_CALL_LIMIT": "250"
      }
    }`;
    expect(parseDailyCallLimit(jsonc)).toBe(250);
  });

  it.each([
    ['{"vars":{"DAILY_CALL_LIMIT":"0"}}', 0],
    ['{"vars":{"DAILY_CALL_LIMIT":"abc"}}', 1000],
    ['{"vars":{}}', 1000],
  ])("reads %s as %i, like the Function", (jsonc, limit) => {
    expect(parseDailyCallLimit(jsonc)).toBe(limit);
  });
});

describe("averageInputTokens", () => {
  it("averages usage.input_tokens over eval rows", () => {
    const jsonl = [
      JSON.stringify({ usage: { input_tokens: 9640, output_tokens: 551 } }),
      JSON.stringify({ usage: { input_tokens: 9644 } }),
      JSON.stringify({ error: "no usage" }),
      "",
    ].join("\n");
    expect(averageInputTokens(jsonl)).toBe(9642);
  });

  it("returns null without usable rows", () => {
    expect(averageInputTokens("")).toBeNull();
  });
});

describe("summarize", () => {
  const today = "2026-10-05";
  const options = { today, limit: 1000, tokensPerCall: TOKENS };

  it("prices recorded tokens exactly and estimates days without them", () => {
    const summary = summarize(
      [
        { day: "2026-10-05", calls: 10, input_tokens: 100_000, token_calls: 10 },
        { day: "2026-10-04", calls: 500 },
        { day: "2026-10-03", calls: 3, input_tokens: 0, token_calls: 0 },
      ],
      options,
    );
    expect(summary.days.map((day) => day.day)).toEqual(["2026-10-03", "2026-10-04", "2026-10-05"]);
    const [estimated, before, exact] = summary.days;
    expect(exact).toMatchObject({ calls: 10, inputTokens: 100_000, share: 0.01, exact: true });
    expect(exact?.usd).toBeCloseTo(0.0042, 10);
    expect(before).toMatchObject({ calls: 500, inputTokens: null, share: 0.5, exact: false });
    expect(before?.usd).toBeCloseTo(500 * PER_CALL, 10);
    expect(estimated).toMatchObject({ inputTokens: null, exact: false });
  });

  it("adds an estimate for the calls that recorded no tokens and marks the day", () => {
    const [day] = summarize(
      [{ day: today, calls: 900, input_tokens: 964_200, token_calls: 100 }],
      options,
    ).days;
    expect(day).toMatchObject({ calls: 900, inputTokens: 964_200, exact: false });
    expect(day?.usd).toBeCloseTo(((964_200 + 800 * TOKENS) * 0.042) / 1e6, 10);
  });

  it("estimates every call when input_tokens has no token_calls to say which calls it covers", () => {
    const [day] = summarize([{ day: today, calls: 10, input_tokens: 50 }], options).days;
    expect(day).toMatchObject({ exact: false });
    expect(day?.usd).toBeCloseTo(10 * PER_CALL, 10);
  });

  it("totals today, 7 days, 30 days and the month to date", () => {
    const rows = [
      { day: today, calls: 1, input_tokens: TOKENS, token_calls: 1 },
      { day: daysBefore(today, 6), calls: 2 },
      { day: daysBefore(today, 7), calls: 4 },
      { day: daysBefore(today, 29), calls: 8 },
      { day: daysBefore(today, 30), calls: 16 },
    ];
    const totals = Object.fromEntries(summarize(rows, options).totals);
    expect(totals.Today).toMatchObject({ calls: 1, exact: true });
    expect(totals.Today.usd).toBeCloseTo(PER_CALL, 10);
    expect(totals["Last 7 days"]).toMatchObject({ calls: 3, exact: false });
    expect(totals["Last 30 days"].calls).toBe(15);
    expect(totals["Month to date"].calls).toBe(1);
    expect(summarize(rows, options).days).toHaveLength(4);
  });

  it("counts a month longer than the 30-day window", () => {
    const rows = [
      { day: "2026-10-31", calls: 1 },
      { day: "2026-10-01", calls: 2 },
    ];
    const totals = Object.fromEntries(summarize(rows, { ...options, today: "2026-10-31" }).totals);
    expect(totals["Last 30 days"].calls).toBe(1);
    expect(totals["Month to date"].calls).toBe(3);
  });

  it("prices the ceiling from the limit", () => {
    const { ceiling } = summarize([], options);
    expect(ceiling.calls).toBe(1000);
    expect(ceiling.usdPerDay).toBeCloseTo(1000 * PER_CALL, 10);
    expect(ceiling.usdPer30Days).toBeCloseTo(30 * 1000 * PER_CALL, 10);
  });
});

describe("formatReport", () => {
  const today = "2026-10-05";
  const format = (rows, detail = null) =>
    formatReport(summarize(rows, { today, limit: 1000, tokensPerCall: TOKENS }), {
      limit: 1000,
      tokensPerCall: TOKENS,
      tokensSource: "eval v6 average",
      detail,
    });

  it("prints a row per day, marks estimates and prices the ceiling", () => {
    const report = format([
      { day: "2026-10-04", calls: 1234 },
      { day: today, calls: 10, input_tokens: 96_420, token_calls: 10 },
    ]);
    expect(report).toContain("Daily limit 1,000 calls");
    expect(report).toContain("9,642 input tokens per call (eval v6 average) at $0.042 per million");
    expect(report).toMatch(/^2026-10-04\s+1,234\s+123\.4%\s+-\s+~\$0\.4997$/m);
    expect(report).toMatch(/^2026-10-05\s+10\s+1\.0%\s+96,420\s+\$0\.0040$/m);
    expect(report).toMatch(/^Today\s+10\s+\$0\.0040$/m);
    expect(report).toMatch(/^Last 7 days\s+1,244\s+~\$0\.5038$/m);
    expect(report).toContain(
      "Ceiling: 1,000 calls a day, about $0.4050 a day or $12.15 per 30 days.",
    );
    expect(report).toContain("https://console.typesafe.ai");
    expect(report).not.toContain("Clients today");
  });

  it("never prints a partly recorded day as exact", () => {
    const report = format([{ day: today, calls: 900, input_tokens: 964_200, token_calls: 100 }]);
    expect(report).toMatch(/^2026-10-05\s+900\s+90\.0%\s+964,200\s+~\$0\.3645$/m);
    expect(report).toMatch(/^Today\s+900\s+~\$0\.3645$/m);
  });

  it("says so when there were no calls", () => {
    expect(format([])).toContain("No Jev calls in the last 30 days.");
  });

  it("adds clients and sessions with --detail", () => {
    const detail = {
      clients: 12,
      activeClients: 9,
      clientCalls: 40,
      topClientCalls: 15,
      sessions: 3,
      sessionCalls: 7,
    };
    const report = format([], detail);
    expect(report).toContain(
      "Clients today: 12, 9 with calls kept, 40 calls, busiest client 15 calls.",
    );
    expect(report).toContain("Live sessions: 3, 7 calls.");
  });
});

describe("accountIdFrom", () => {
  const id = "0123456789abcdef0123456789abcdef";

  it("prefers the environment, then the root .env", () => {
    expect(accountIdFrom({ CLOUDFLARE_ACCOUNT_ID: id }, "CLOUDFLARE_ACCOUNT_ID=nope")).toBe(id);
    expect(accountIdFrom({}, `TYPESAFE_API_KEY=x\nCLOUDFLARE_ACCOUNT_ID=${id}\n`)).toBe(id);
  });

  it("refuses a missing or malformed id", () => {
    expect(accountIdFrom({}, "")).toBeNull();
    expect(accountIdFrom({}, "CLOUDFLARE_ACCOUNT_ID=")).toBeNull();
    expect(accountIdFrom({ CLOUDFLARE_ACCOUNT_ID: "not-an-account-id" }, "")).toBeNull();
  });
});
