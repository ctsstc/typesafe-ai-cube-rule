import { CUBE_ANSWER_TYPES } from "@cube/core";
import { describe, expect, it } from "vitest";
import { QUESTION_COUNT, questionGroups } from "./jevQuestions";

describe("questionGroups", () => {
  it("covers every question Jev gets, grouped by answer type", () => {
    const groups = questionGroups();
    expect(groups.reduce((sum, group) => sum + group.count, 0)).toBe(QUESTION_COUNT);
    expect(QUESTION_COUNT).toBe(Object.keys(CUBE_ANSWER_TYPES).length);
  });

  // The asks are joined with commas and "and", so one with its own reads as two questions.
  it("phrases each ask without a comma or 'and' outside parentheses", () => {
    const asks = questionGroups().flatMap((group) => group.asks);
    const offenders = asks.filter((ask) => /,|\band\b/.test(ask.replace(/\([^)]*\)/g, "")));
    expect(offenders).toEqual([]);
  });
});
