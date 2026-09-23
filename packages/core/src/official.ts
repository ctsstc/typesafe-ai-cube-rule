import type { CategoryId } from "./categories";
import { normalizeItem } from "./input";

export interface OfficialRuling {
  readonly category: CategoryId;
  readonly note: string | null;
  readonly honorary: boolean;
}

const OFFICIAL_TABLE: ReadonlyArray<readonly [CategoryId, string | null, readonly string[]]> = [
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

// A Map so that inputs such as "constructor" cannot resolve through Object.prototype.
export const OFFICIAL_RULINGS: ReadonlyMap<string, OfficialRuling> = new Map([
  ...OFFICIAL_TABLE.flatMap(([category, note, names]) =>
    names.map((name): [string, OfficialRuling] => [name, { category, note, honorary: false }]),
  ),
  ...["human", "humans"].map((name): [string, OfficialRuling] => [
    name,
    {
      category: "calzone",
      note: "humans are just ravioli, per food critic Soleil Ho",
      honorary: true,
    },
  ]),
]);

export function findOfficialRuling(item: string): OfficialRuling | null {
  const key = normalizeItem(item)
    .replace(/\p{Pd}/gu, " ")
    .replace(/'/g, "")
    .replace(/\s+/g, " ")
    .replace(/^(a|an|the|some|one) /, "");
  for (const candidate of [key, key.replace(/s$/, ""), key.replace(/es$/, "")]) {
    const hit = OFFICIAL_RULINGS.get(candidate);
    if (hit) return hit;
  }
  return null;
}
