// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_DAILY_CALL_LIMIT, dailyCallLimit } from "./usage";

// Free plan KV writes per day, account wide. Each billed ruling writes one.
const FREE_KV_WRITES_PER_DAY = 1000;

function wranglerVars(): Record<string, string> {
  const text = readFileSync(
    fileURLToPath(new URL("../../wrangler.jsonc", import.meta.url).href),
    "utf8",
  );
  const json = JSON.parse(text.replace(/^\s*\/\/.*$/gm, "")) as { vars: Record<string, string> };
  return json.vars;
}

describe("daily call limit", () => {
  it("ships a default that every stored ruling can fit under the KV write quota", () => {
    expect(wranglerVars().DAILY_CALL_LIMIT).toBe(String(DEFAULT_DAILY_CALL_LIMIT));
    expect(DEFAULT_DAILY_CALL_LIMIT).toBeLessThanOrEqual(FREE_KV_WRITES_PER_DAY);
  });

  it.each([
    [undefined, DEFAULT_DAILY_CALL_LIMIT],
    ["", DEFAULT_DAILY_CALL_LIMIT],
    ["abc", DEFAULT_DAILY_CALL_LIMIT],
    ["-1", DEFAULT_DAILY_CALL_LIMIT],
    ["0", 0],
    [" 250 ", 250],
  ])("reads DAILY_CALL_LIMIT=%j as %i", (value, expected) => {
    expect(dailyCallLimit({ DAILY_CALL_LIMIT: value })).toBe(expected);
  });
});
