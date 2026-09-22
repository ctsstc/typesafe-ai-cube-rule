import { describe, expect, it } from "vitest";
import { findOfficialRuling, OFFICIAL_RULINGS } from "./official";

describe("findOfficialRuling", () => {
  it.each([
    ["hot dogs", "taco"],
    ["a hot dog", "taco"],
    ["Pop-Tarts", "calzone"],
    ["pop tart", "calzone"],
    ["dumplings", "calzone"],
    ["the cheesecake", "quiche"],
    ["deep-dish pizza", "quiche"],
    ["sandwiches", "sandwich"],
    ["enchiladas", "sushi"],
    ["ramen", "nachos"],
    ["soup", "salad"],
    ["soup in a bread bowl", "quiche"],
    ["Victoria sponge", "sandwich"],
    ["lasagne", "cake"],
    ["uncrustables", "calzone"],
    ["humans", "calzone"],
    ["salad with croutons", "nachos"],
    ["nachos", "nachos"],
    ["muffins", "toast"],
  ])("rules %s as %s", (item, category) => {
    expect(findOfficialRuling(item)?.category).toBe(category);
  });

  it.each(["pie", "quesadilla", "sub", "constructor", "toString", "__proto__", "hasOwnProperty"])(
    "has no ruling for %s",
    (item) => {
      expect(findOfficialRuling(item)).toBeNull();
    },
  );

  it("marks humans as an honorary calzone", () => {
    expect(findOfficialRuling("humans")).toEqual({
      category: "calzone",
      note: "humans are just ravioli",
      honorary: true,
    });
    expect(findOfficialRuling("hot dog")?.honorary).toBe(false);
  });

  it("keys every ruling by an already normalized name", () => {
    for (const name of OFFICIAL_RULINGS.keys()) {
      expect(findOfficialRuling(name), name).toBe(OFFICIAL_RULINGS.get(name));
    }
  });
});
