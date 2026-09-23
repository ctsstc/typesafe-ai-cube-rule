// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import stats from "virtual:eval-stats";
import { CUBE_MODEL, QUESTION_SET_VERSION } from "@cube/core";
import { describe, expect, it } from "vitest";
import { coreConstant, readEvalStats, summaryPath } from "../../plugins/evalStats";
import {
  type EvalStats,
  formatRate,
  formatTally,
  formatUsd,
  onePointOf,
  rulingsPerDollar,
} from "./evalStats";

describe("eval stats", () => {
  it(`has an eval summary for question set ${QUESTION_SET_VERSION}`, () => {
    expect(existsSync(summaryPath(QUESTION_SET_VERSION))).toBe(true);
  });

  it("reads the same version and model the app asks for", () => {
    expect(coreConstant("QUESTION_SET_VERSION")).toBe(QUESTION_SET_VERSION);
    expect(coreConstant("CUBE_MODEL")).toBe(CUBE_MODEL);
    expect(stats.questionSetVersion).toBe(QUESTION_SET_VERSION);
    expect(stats.model).toBe(CUBE_MODEL);
  });

  it("serves the headline numbers from the current summary", () => {
    const summary = JSON.parse(readFileSync(summaryPath(QUESTION_SET_VERSION), "utf8"));
    expect(stats).toEqual(readEvalStats());
    expect(stats.holdout.all).toEqual({
      hits: summary.splits.holdout.accuracy.hits,
      n: summary.splits.holdout.accuracy.n,
    });
    expect(stats.cost.perRulingUsd).toBe(summary.cost.perCallUsd);
    expect(stats.latency.p50Ms).toBe(summary.latency.p50);
  });

  it("carries no item names, only numbers plus the version and model", () => {
    const strings: string[] = [];
    JSON.stringify(stats, (_key, value) => {
      if (typeof value === "string") strings.push(value);
      return value;
    });
    expect(strings.sort()).toEqual([CUBE_MODEL, QUESTION_SET_VERSION].sort());
  });

  it("fails loudly when a question set has no summary", () => {
    expect(() => readEvalStats("999")).toThrow(/No eval summary for question set 999.*pnpm eval/);
  });
});

describe("formatting", () => {
  it.each([
    [{ hits: 60, n: 62 }, "96.8%"],
    [{ hits: 45, n: 45 }, "100%"],
    [{ hits: 1, n: 2 }, "50%"],
    [{ hits: 0, n: 0 }, "n/a"],
  ])("formats %o as %s", (tally, want) => {
    expect(formatRate(tally)).toBe(want);
  });

  it("formats tallies, dollars and point swings", () => {
    expect(formatTally({ hits: 31, n: 32 })).toBe("31 of 32");
    expect(formatUsd(0.00040495)).toBe("$0.000405");
    expect(formatUsd(0.082611)).toBe("$0.083");
    expect(formatUsd(0.042)).toBe("$0.042");
    expect(onePointOf({ hits: 60, n: 62 })).toBe("1.6 points");
  });

  it("rounds rulings per dollar to the nearest ten", () => {
    const cost = { perRulingUsd: 0.00040495, runUsd: 0, pricePerMillionInputUsd: 0 };
    expect(rulingsPerDollar({ ...stats, cost } satisfies EvalStats)).toBe(2470);
  });
});
