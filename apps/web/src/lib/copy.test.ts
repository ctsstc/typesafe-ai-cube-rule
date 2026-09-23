import { CATEGORIES, CATEGORY_IDS, type FoodResult, findOfficialRuling } from "@cube/core";
import { describe, expect, it, vi } from "vitest";
import { type result, scenarios } from "../test/fixtures";
import {
  bandOf,
  confidenceLine,
  errorCopy,
  HERO_QUESTIONS,
  heroQuestion,
  officialCopy,
  resultTitle,
  shareText,
  stampFor,
} from "./copy";
import { exampleQuery } from "./examples";
import { formatPercent, sentenceCase } from "./format";
import { pickVariant } from "./hash";

function food(r: ReturnType<typeof result>): FoodResult {
  if (r.kind !== "food") throw new Error(`expected food, got ${r.kind}`);
  return r;
}

describe("formatPercent", () => {
  it.each([
    [0, "0%"],
    [0.001, "<1%"],
    [0.0049, "<1%"],
    [0.005, "1%"],
    [0.404, "40%"],
    [0.994, "99%"],
    [0.995, "100%"],
    [1, "100%"],
  ])("formats %s as %s", (p, want) => {
    expect(formatPercent(p)).toBe(want);
  });
});

describe("sentenceCase", () => {
  it("capitalizes only the first letter", () => {
    expect(sentenceCase("hot dog")).toBe("Hot dog");
    expect(sentenceCase("éclair")).toBe("Éclair");
  });
});

describe("pickVariant", () => {
  it("is stable for the same food and slot", () => {
    const variants = ["a", "b", "c"] as const;
    expect(pickVariant("hot dog", "sure", variants)).toBe(pickVariant("hot dog", "sure", variants));
  });
});

describe("confidence copy", () => {
  it("reads a unanimous ruling as sure", () => {
    const r = food(scenarios.unanimous());
    expect(bandOf(r.ruling)).toBe("sure");
    expect(["Jev is sure.", "No notes. Case closed.", "Jev didn't even blink."]).toContain(
      confidenceLine(r.item, r.ruling),
    );
    expect(stampFor(r)).toEqual({ label: "Sandwich", ghost: null, variant: "normal" });
  });

  it("leads a split ruling with the family when the family is sure", () => {
    const r = food(scenarios.splitFamily());
    expect(bandOf(r.ruling)).toBe("torn");
    expect(r.ruling.family?.family).toBe("shell");
    const line = confidenceLine(r.item, r.ruling);
    expect(line).toMatch(/shell/i);
    expect(line).toMatch(/taco/);
    expect(line).toMatch(/sushi/);
    expect(stampFor(r)).toEqual({ label: "Taco?", ghost: "Sushi?", variant: "torn" });
  });

  it("names the dissent when Jev overrules the canon", () => {
    const r = food(scenarios.officialDissent());
    expect(r.category).toBe("quiche");
    expect(r.official?.jevAgrees).toBe(false);
    expect(officialCopy(r)?.text).toBe(
      "Jev dissents. cuberule.com rules it a quiche, but Jev on its own says cake (62%).",
    );
    expect(shareText(r)).toContain("But Jev dissents: cake (62%)");
  });

  it("stamps an honorary ruling with its category", () => {
    const r = scenarios.honorary();
    expect(stampFor(r)).toEqual({ label: "Taco", ghost: null, variant: "honorary" });
    expect(resultTitle(r)).toBe("Canoe: not food | Cube Rule Oracle");
  });
});

describe("declined results", () => {
  it("never carry the text into titles or share copy", () => {
    const r = scenarios.declined();
    expect(r.kind).toBe("declined");
    expect(resultTitle(r)).toBe("Declined | Cube Rule Oracle");
    expect(shareText(r)).toBeNull();
    expect(stampFor(r)).toBeNull();
  });
});

describe("errorCopy", () => {
  it("counts down from Retry-After on a 429", () => {
    expect(errorCopy("rate_limited", 7).body).toContain("7 seconds");
    expect(errorCopy("rate_limited", null).body).toContain("in a moment");
  });

  it.each([
    ["upstream_busy", "The oracle is overheated."],
    ["upstream_error", "Something broke on our side."],
    ["internal", "Something broke on our side."],
    ["timeout", "Jev is thinking unusually hard."],
    ["offline", "You're offline."],
    ["network", "Couldn't reach the oracle."],
    ["bad_request", "That doesn't look like a food name."],
    ["challenge_required", "Couldn't confirm you're human."],
    ["daily_limit", "The oracle is resting until tomorrow."],
    ["method_not_allowed", "Something broke on our side."],
    ["not_found", "Something broke on our side."],
  ] as const)("titles %s", (code, title) => {
    expect(errorCopy(code, null).title).toBe(title);
  });

  it("tells when new foods open again after the daily limit", () => {
    const now = Date.parse("2026-09-22T20:00:00Z");
    vi.spyOn(Date, "now").mockReturnValue(now);
    const reset = new Date(now + 4 * 3600 * 1000).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
    const copy = errorCopy("daily_limit", 4 * 3600);
    expect(copy.body).toContain(`open again at ${reset} your time`);
    expect(copy.body).toContain("already asked about still work");
    expect(copy.action).toBe("edit");
    expect(errorCopy("daily_limit", null).body).toContain("midnight UTC");
  });
});

describe("hero questions", () => {
  it("rotate by day and cover all nine cubes", () => {
    expect(new Set(HERO_QUESTIONS.map((q) => q.category))).toEqual(new Set(CATEGORY_IDS));
    const day = (d: number) => heroQuestion(new Date(2026, 0, d)).question;
    expect(day(1)).not.toBe(day(2));
    expect(day(1)).toBe(day(1 + HERO_QUESTIONS.length));
  });
});

describe("gallery examples", () => {
  it.each(CATEGORY_IDS)("%s examples open their canon ruling", (id) => {
    for (const example of CATEGORIES[id].examples) {
      expect(findOfficialRuling(exampleQuery(example))?.category, example).toBe(id);
    }
  });
});
