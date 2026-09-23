import { describe, expect, it } from "vitest";
import type { CategoryId } from "./categories";
import { findOfficialRuling, OFFICIAL_RULINGS, type OfficialRuling } from "./official";

// Audited against https://cuberule.com/ on 2026-09-22 (docs/canon-audit.md). Re-audit before editing.
const AUDITED: ReadonlyArray<readonly [CategoryId, string | null, readonly string[]]> = [
  ["salad", null, ["salad", "steak", "flan", "chocolate"]],
  ["salad", "creamy and smooth", ["mashed potatoes", "mashed potato"]],
  ["salad", "with sausage stuffing", ["turducken"]],
  ["salad", "a wet salad", ["soup", "tomato soup"]],
  ["salad", "a three-bean wet salad", ["vanilla soy latte"]],
  ["toast", null, ["toast", "pizza", "nigiri", "nigiri sushi"]],
  ["toast", "bent toast", ["pumpkin pie slice", "slice of pumpkin pie"]],
  ["toast", "in raw, unsliced form", ["muffin"]],
  [
    "sandwich",
    null,
    ["sandwich", "toast sandwich", "victoria sponge", "victoria sponge cake", "victoria sandwich"],
  ],
  ["sandwich", "non-folded", ["non folded quesadilla", "unfolded quesadilla", "flat quesadilla"]],
  ["taco", null, ["taco", "hot dog", "hotdog"]],
  ["taco", "uncut", ["uncut sub", "uncut sub sandwich"]],
  [
    "taco",
    "taco on its side",
    ["slice of pie", "pie slice", "slice of cherry pie", "cherry pie slice"],
  ],
  [
    "sushi",
    null,
    ["falafel wrap", "pigs in a blanket", "pig in a blanket", "pigs in blankets", "enchilada"],
  ],
  ["quiche", null, ["quiche", "cheesecake", "falafel pita", "deep dish pizza", "key lime pie"]],
  [
    "quiche",
    "in a bread bowl",
    ["soup in a bread bowl", "bread bowl soup", "salad in a bread bowl"],
  ],
  [
    "calzone",
    null,
    ["calzone", "burrito", "corn dog", "corndog", "dumpling", "pop tart", "poptart"],
  ],
  ["calzone", "whole", ["whole pie"]],
  ["calzone", "unbitten", ["uncrustable"]],
  [
    "cake",
    null,
    ["lasagna", "lasagne", "big mac", "flapjacks", "stack of flapjacks", "stack of pancakes"],
  ],
  [
    "nachos",
    null,
    [
      "nachos",
      "poutine",
      "lucky charms",
      "salad with croutons",
      "caesar salad with croutons",
      "fried noodles",
      "couscous",
    ],
  ],
  ["nachos", "wet nachos", ["ramen"]],
];

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

  it.each([
    "pie",
    "quesadilla",
    "sub",
    "sub sandwich",
    "sushi",
    "cake",
    "constructor",
    "toString",
    "__proto__",
    "hasOwnProperty",
  ])("has no ruling for %s", (item) => {
    expect(findOfficialRuling(item)).toBeNull();
  });

  it("marks humans as an honorary calzone", () => {
    expect(findOfficialRuling("humans")).toEqual({
      category: "calzone",
      note: "humans are just ravioli, per food critic Soleil Ho",
      honorary: true,
    });
    expect(findOfficialRuling("hot dog")?.honorary).toBe(false);
  });

  it("holds exactly the audited canon and nothing else", () => {
    const expected = new Map<string, OfficialRuling>(
      AUDITED.flatMap(([category, note, names]) =>
        names.map((name) => [name, { category, note, honorary: false }] as const),
      ),
    );
    for (const name of ["human", "humans"]) {
      expected.set(name, {
        category: "calzone",
        note: "humans are just ravioli, per food critic Soleil Ho",
        honorary: true,
      });
    }
    expect(Object.fromEntries(OFFICIAL_RULINGS)).toEqual(Object.fromEntries(expected));
  });

  it("keys every ruling by an already normalized name", () => {
    for (const name of OFFICIAL_RULINGS.keys()) {
      expect(findOfficialRuling(name), name).toBe(OFFICIAL_RULINGS.get(name));
    }
  });
});
