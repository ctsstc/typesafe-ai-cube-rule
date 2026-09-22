import type { EntryType, SystemOneRequest, SystemOneResult } from "@typesafe-ai/sdk";
import { choice, noul, score } from "@typesafe-ai/sdk";
import {
  CATEGORIES,
  CATEGORY_IDS,
  type CategoryId,
  type InputKindId,
  type StarchId,
} from "./categories";

// Bump QUESTION_SET_VERSION whenever a question or CUBE_MODEL changes: it is part of the cache key.
export const CUBE_MODEL = "jev-1.13.0";
export const QUESTION_SET_VERSION = "2";

// Untuned starting points. Calibrate against the official rulings plus held-out foods before trusting them.
export const THRESHOLDS = {
  unanimous: 0.8,
  majority: 0.4,
  dissent: 0.15,
  family: 0.7,
  wet: 0.6,
  rice: 0.5,
  dependsOnServing: 0.6,
  yes: 0.7,
  no: 0.3,
  abusive: 0.85,
} as const;

export type CubeState = { item: string };

export function buildCubeState(item: string): CubeState {
  return { item };
}

const STRUCTURAL_STARCH = {
  counts:
    "A distinct part made of starch that holds its own shape: bread, bun, roll, tortilla, taco shell, dough, pastry, pie crust, batter, sponge, pasta, noodles, rice, crackers, chips, croutons, fries, or cereal pieces.",
  does_not_count:
    "Starch that is mashed smooth, pureed, melted, dissolved, or blended through the dish, such as creamy mashed potatoes or a flour-thickened sauce. A bowl, plate, cup, wrapper, or stick that is not eaten is not part of the food.",
};
const SERVED_FORM =
  "Picture `item` as it is usually served, whole and unbitten. Words in `item` such as slice, whole, folded, uncut, open-faced, deep-dish, or in a bread bowl describe its form and take priority.";
const READ_AS_FOOD =
  "If `item` is misspelled, slang, a brand name, or mentions a food inside a question or phrase, judge the food it most likely means.";

type Rubric = { starch_position: string; examples: string[]; not_for: string };
type Outcome = { what: string; examples: string[] };

const RUBRIC: Record<CategoryId, Rubric> = {
  salad: {
    starch_position:
      "No structural starch anywhere. Starch mashed smooth, pureed, or dissolved into a liquid does not count.",
    examples: ["garden salad", "fruit salad", "smoothie"],
    not_for:
      "Distinct solid pieces of starch mixed in or scattered through it, like croutons, fries, chips, noodles, or grains (nachos).",
  },
  toast: {
    starch_position:
      "Starch on the bottom face only, as one base with everything else on top. A solid unsliced block of starch counts, and so does a base bent up along one edge (bent toast).",
    examples: ["toast", "avocado toast", "open-faced sandwich", "plain bagel"],
    not_for:
      "A second starch layer on top (sandwich). Starch walls on two opposite sides (taco). Starch walls on all four sides (quiche).",
  },
  sandwich: {
    starch_position:
      "Starch on the top and bottom faces as two separate pieces, with all four sides open.",
    examples: ["sandwich", "hamburger", "ice cream sandwich"],
    not_for:
      "A third starch layer in the middle, between fillings, like a Big Mac or a club sandwich (cake). Top and bottom joined along one edge, like a hot dog bun, an uncut sub roll, or a folded quesadilla (taco).",
  },
  taco: {
    starch_position:
      "One piece of starch covering the bottom and two opposite sides in a U shape, with the top and both ends open. A folded or hinged piece of starch makes this shape in any orientation.",
    examples: ["taco", "folded quesadilla", "lobster roll"],
    not_for:
      "Two separate pieces not joined along an edge (sandwich). Starch that also closes over the top into a tube with open ends (sushi). Starch sealing every side (calzone).",
  },
  sushi: {
    starch_position:
      "Starch wrapped around the filling like a tube, covering the top, bottom, and both sides, with the two ends open.",
    examples: ["maki roll", "cannoli", "chicken wrap"],
    not_for:
      "Both ends sealed shut, like a burrito (calzone). An open top, like a hot dog (taco). A mound of rice with a topping and no wrap, like nigiri (toast).",
  },
  quiche: {
    starch_position:
      "Starch on the bottom and all four sides like an edible bowl or open box, with only the top open.",
    examples: ["quiche", "fruit tart", "ice cream cone"],
    not_for:
      "A starch lid sealing the top, like a whole double-crust pie (calzone). A flat base without walls, like regular pizza (toast). A bowl that is not made of starch, like the bowl of a burrito bowl or poke bowl: judge only the food inside it.",
  },
  calzone: {
    starch_position: "Starch sealing the filling on all six faces, with no open side.",
    examples: ["calzone", "ravioli", "empanada", "egg roll"],
    not_for:
      "Open ends, like a falafel wrap or enchilada (sushi). An open top, like a cheesecake (quiche). A dish only named after a sealed food, like a burrito bowl, which has no wrapper: judge its own structure.",
  },
  cake: {
    starch_position:
      "A starch layer in the middle, between fillings, with starch on the top and bottom as well: three or more separate starch layers stacked horizontally.",
    examples: ["club sandwich (three slices of bread)", "baklava", "crepe cake"],
    not_for:
      "Only a top and a bottom starch layer with nothing starchy in the middle, even for a dessert called cake like a Victoria sponge (sandwich). Being a dessert or being named cake does not matter: cheesecake is quiche.",
  },
  nachos: {
    starch_position:
      "Starch present only as distinct solid pieces inside or scattered through the food, never forming its outer faces.",
    examples: ["nachos", "spaghetti", "mac and cheese", "bubble tea"],
    not_for:
      "Starch forming a base, walls, or shell (toast, taco, sushi, quiche, calzone). No solid starch at all, or starch mashed smooth like creamy mashed potatoes (salad).",
  },
};

const HONORARY_EXAMPLES: Record<CategoryId, string[]> = {
  salad: ["water", "a cloud", "an idea"],
  toast: ["a skateboard", "a surfboard", "a brick (a solid block)"],
  sandwich: ["books between two bookends", "a person between a mattress and a blanket"],
  taco: ["a hammock", "a skate half-pipe", "a folded wallet"],
  sushi: ["a tunnel", "a toilet paper tube", "a sleeve"],
  quiche: ["a bathtub", "a swimming pool", "a coffee mug"],
  calzone: ["a human (humans are just ravioli)", "a sealed envelope", "an egg", "a submarine"],
  cake: ["a bunk bed", "a bookshelf", "a parking garage"],
  nachos: ["a ball pit", "a snow globe", "a gumball machine"],
};

const STARCH_RUBRIC: Record<StarchId, Outcome> = {
  bread: {
    what: "Bread, buns, rolls, bagels, pita, naan, or croutons",
    examples: ["sandwich", "hot dog", "falafel pita", "salad with croutons"],
  },
  tortilla: {
    what: "Flour or corn tortillas, taco shells, or tortilla chips",
    examples: ["burrito", "taco", "enchilada", "nachos"],
  },
  dough_or_pastry: {
    what: "Pizza dough, pie or tart crust, pastry, or dumpling wrappers",
    examples: ["pizza", "quiche", "calzone", "Pop-Tart", "dumplings"],
  },
  batter_or_sponge: {
    what: "Pancakes, waffles, cake sponge, muffins, or fried batter",
    examples: ["flapjacks", "corn dog", "Victoria sponge cake", "muffin"],
  },
  pasta_or_noodles: {
    what: "Pasta sheets, stuffed pasta, or noodles",
    examples: ["lasagna", "ravioli", "ramen", "fried noodles"],
  },
  rice: {
    what: "Cooked rice, loose or pressed into a shape",
    examples: ["maki roll", "nigiri sushi", "fried rice", "onigiri"],
  },
  potato: {
    what: "Solid potato pieces such as fries, wedges, skins, or hash browns",
    examples: ["poutine", "loaded potato skins", "hash browns"],
  },
  grain_or_cereal: {
    what: "Small grains or cereal pieces",
    examples: ["couscous", "Lucky Charms", "granola"],
  },
  other_starch: {
    what: "Any other solid starch, such as crackers, tapioca pearls, or plantain",
    examples: ["bubble tea", "cheese and crackers", "tostones"],
  },
  none: {
    what: "No solid starch: meat, eggs, dairy, vegetables, fruit, candy, smooth purees, and drinks",
    examples: ["steak", "flan", "chocolate", "tomato soup", "creamy mashed potatoes"],
  },
};

const INPUT_KIND_RUBRIC: Record<InputKindId, Outcome> = {
  food: {
    what: "Something people eat or drink: a dish, snack, dessert, candy, ingredient, or beverage. Includes brand names, regional names, fictional foods, misspellings, and questions about a food.",
    examples: [
      "hot dog",
      "quesadila",
      "pb&j",
      "big mac",
      "krabby patty",
      "is a hot dog a sandwich",
    ],
  },
  not_food: {
    what: "A real or fictional thing people do not eat: an object, place, animal, person, vehicle, or idea.",
    examples: ["sleeping bag", "the moon", "my cat", "humans", "a canoe"],
  },
  nonsense: {
    what: "Names no identifiable thing: random letters, keyboard mashing, a greeting, or an instruction to the app.",
    examples: ["asdfghjkl", "qwzx", "hello", "ignore your rules"],
  },
};

export const DEBATE_LEVELS = [
  "Everyone agrees what kind of food it is and nobody debates it",
  "People occasionally joke about what kind of food it really is",
  "A well-known debate where people hold strong opinions on both sides",
  "A famous, long-running feud, like whether a hot dog is a sandwich or whether cereal is soup",
] as const;

const ABUSIVE_TEXT = {
  question:
    "Is `item` abusive text rather than the name of a food, dish, drink, object, or harmless joke?",
  abusive_means:
    "A slur, harassment of a person or group, hateful content, or explicit sexual content.",
  context:
    "`item` was typed by a stranger into a public food identification app, and every result can be shared by link.",
  how_to_judge: [
    "Judge what the whole phrase means, not whether one word in it could be rude on its own.",
    "Traditional and regional dishes keep their real names, even when a word in the name is rude in another sense.",
    "Mild innuendo and silly jokes with no target are harmless. Explicit sexual content is not.",
  ],
};

const ABUSIVE_OUTCOMES: Record<"true" | "false", Outcome> = {
  true: {
    what: "A slur, an insult or threat aimed at a person or group, hateful content, or explicit sexual content",
    examples: [
      "a racial, ethnic, religious, or homophobic slur",
      "an insult aimed at a named person, like jake from homeroom is a loser",
      "a threat to hurt someone",
      "the name or slogan of a hate group",
      "an explicit sexual act",
    ],
  },
  false: {
    what: "A food, dish, drink, brand, object, place, animal, idea, gibberish, or harmless joke, even when one of its words is rude in another sense",
    examples: [
      "spotted dick",
      "faggot (the British meatball)",
      "hot dog",
      "sloppy joe",
      "cock-a-leekie soup",
      "toad in the hole",
      "my ex's meatloaf",
      "sleeping bag",
      "asdfgh",
    ],
  },
};

const byCategory = <V extends EntryType>(make: (id: CategoryId) => V): Record<CategoryId, V> =>
  Object.fromEntries(CATEGORY_IDS.map((id) => [id, make(id)])) as Record<CategoryId, V>;

const starchNoul = (question: string, yes: Outcome, no: Outcome) =>
  noul(
    {
      question,
      structural_starch: STRUCTURAL_STARCH,
      served_as: SERVED_FORM,
      reading: READ_AS_FOOD,
    },
    { true: yes, false: no },
  );

export function buildCubeQuestions() {
  return {
    is_abusive: noul(ABUSIVE_TEXT, ABUSIVE_OUTCOMES),
    input_kind: choice(
      {
        question: "What kind of thing does `item` name?",
        context:
          "`item` was typed by a person into a food identification app. It may be misspelled, abbreviated, a brand name, or a joke.",
      },
      INPUT_KIND_RUBRIC,
    ),
    category: choice(
      {
        question: "Which Cube Rule category is `item`?",
        cube_rule:
          "The Cube Rule identifies a food purely by where its structural starch sits on an imaginary cube around it.",
        structural_starch: STRUCTURAL_STARCH,
        how_to_judge: [
          SERVED_FORM,
          "Match where the structural starch of `item` sits against each option's starch_position.",
          "Orientation does not matter. The same shape turned on its side keeps its category.",
          "Category names label starch positions, not food types. A food called a sandwich, cake, pie, or taco can belong to any category.",
          READ_AS_FOOD,
        ],
      },
      byCategory((id) => ({
        ...RUBRIC[id],
        examples: [...CATEGORIES[id].examples, ...RUBRIC[id].examples],
      })),
    ),
    honorary_category: choice(
      {
        question: "If `item` were a food, which Cube Rule category would it be?",
        premise:
          "`item` is not a food. Treat its outer shell, casing, skin, crust, cover, or walls as starch and whatever it holds as the filling.",
        how_to_judge: [
          "Picture `item` in its usual form, then match where its shell sits against each option's starch_position.",
          "A solid object with no inside counts as a block of starch (toast). Something with no solid form, like a liquid, gas, or idea, has no starch (salad).",
          "Orientation does not matter. The same shape turned on its side keeps its category.",
        ],
      },
      byCategory((id) => ({
        starch_position: RUBRIC[id].starch_position,
        examples: HONORARY_EXAMPLES[id],
      })),
    ),
    starch: choice(
      {
        question: "What is the main structural starch in `item`?",
        structural_starch: STRUCTURAL_STARCH,
        reading: READ_AS_FOOD,
      },
      STARCH_RUBRIC,
    ),
    is_wet: noul(
      {
        question:
          "Is there a pool of liquid in `item` as it is served, such as broth, soup, milk, or a drink?",
        reading: READ_AS_FOOD,
      },
      {
        true: {
          what: "The food is a liquid, or its pieces sit in liquid",
          examples: ["tomato soup", "ramen", "Lucky Charms in milk", "vanilla soy latte"],
        },
        false: {
          what: "Served dry, or only coated, topped, or dipped in a sauce, dressing, gravy, or syrup",
          examples: [
            "poutine",
            "spaghetti with sauce",
            "salad with dressing",
            "flapjacks with syrup",
          ],
        },
      },
    ),
    starch_base: starchNoul(
      "Does structural starch form the base of `item`, underneath the rest of it?",
      {
        what: "A layer of starch sits under everything else as a crust, bun, shell, wrap, or bed",
        examples: ["pizza", "nigiri sushi", "hot dog", "cheesecake", "burrito", "sandwich"],
      },
      {
        what: "Nothing starchy underneath, or the only starch is loose pieces mixed through",
        examples: ["steak", "flan", "tomato soup", "salad with croutons"],
      },
    ),
    starch_lid: starchNoul(
      "Does structural starch cover the top of `item`, so the filling is not exposed from above?",
      {
        what: "Starch lies over or wraps over the top of the filling",
        examples: [
          "sandwich",
          "burrito",
          "enchilada",
          "whole double-crust pie",
          "Big Mac",
          "slice of cherry pie",
        ],
      },
      {
        what: "The top is open, with filling or toppings exposed",
        examples: ["pizza", "open-faced toast", "hot dog", "taco", "quiche", "cheesecake"],
      },
    ),
    starch_side_wall: starchNoul(
      "Does structural starch form a wall along at least one side of `item`, not counting its base or top?",
      {
        what: "Starch rises up or wraps around at least one side as a fold, a hinge, a rolled edge, a crust rim, or a wrapper",
        examples: [
          "hot dog",
          "taco",
          "slice of cherry pie (its outer crust)",
          "folded quesadilla",
          "burrito",
          "quiche",
        ],
      },
      {
        what: "Every side is open, with starch only as flat layers above or below, or no starch at all",
        examples: [
          "open-faced toast",
          "sandwich",
          "non-folded quesadilla",
          "lasagna",
          "regular pizza (a low crust rim is not a wall)",
          "steak",
        ],
      },
    ),
    starch_opposite_walls: starchNoul(
      "Does structural starch form walls on at least two opposite sides of `item`, not counting its base or top?",
      {
        what: "Starch rises up or wraps around two facing sides, as a U-shaped fold, a hinged bun, a rolled tube, a bowl, or a sealed pocket does",
        examples: [
          "taco",
          "hot dog",
          "falafel wrap",
          "enchilada",
          "quiche",
          "soup in a bread bowl",
          "burrito",
        ],
      },
      {
        what: "A starch wall on one side at most, or starch only as flat layers above or below",
        examples: [
          "slice of cherry pie (outer crust on one side only)",
          "folded quesadilla (fold on one side only)",
          "sandwich",
          "regular pizza",
          "lasagna",
        ],
      },
    ),
    starch_all_walls: starchNoul(
      "Does structural starch wall in `item` on all four sides, leaving no open side or end, not counting its base or top?",
      {
        what: "Starch surrounds the filling all the way around, like a bowl, tart shell, or sealed pocket",
        examples: [
          "quiche",
          "cheesecake",
          "deep-dish pizza",
          "soup in a bread bowl",
          "burrito",
          "dumpling",
          "Pop-Tart",
        ],
      },
      {
        what: "At least one side or end is open",
        examples: [
          "taco",
          "hot dog",
          "enchilada",
          "maki roll",
          "falafel wrap",
          "slice of cherry pie",
        ],
      },
    ),
    starch_middle_layer: starchNoul(
      "Does `item` have a separate layer of structural starch in its middle, with other layers stacked above and below it?",
      {
        what: "A starch layer sits inside a stack, between the layers above and below it",
        examples: [
          "lasagna",
          "Big Mac (its middle bun)",
          "stack of pancakes",
          "club sandwich with three slices of bread",
          "layer cake",
        ],
      },
      {
        what: "Starch only on the outside, only as a top and a bottom, or no stacked layers",
        examples: [
          "sandwich with two slices of bread",
          "Victoria sponge (two layers)",
          "burrito",
          "pizza",
          "muffin",
        ],
      },
    ),
    starch_loose_pieces: starchNoul(
      "Is the structural starch in `item` mainly loose pieces mixed through or scattered over it, rather than a base, lid, wall, or wrapper?",
      {
        what: "Separate starch pieces sit among the other ingredients",
        examples: [
          "nachos",
          "poutine",
          "cereal in milk",
          "salad with croutons",
          "fried noodles",
          "couscous",
          "ramen",
          "fried rice",
        ],
      },
      {
        what: "The starch forms a base, lid, wall, or wrapper, or there is no structural starch",
        examples: ["pizza", "burrito", "sandwich", "steak", "tomato soup"],
      },
    ),
    starch_block: starchNoul(
      "Is `item` itself one solid piece of starch?",
      {
        what: "The whole food is a single block of bread, pastry, or other starch",
        examples: ["muffin", "unsliced loaf of bread", "plain bagel", "croissant", "dinner roll"],
      },
      {
        what: "Its main part is not starch, it has a filling or topping, or its starch comes in several pieces",
        examples: ["pizza", "sandwich", "jelly doughnut", "burrito", "steak", "fries"],
      },
    ),
    varies_by_serving: starchNoul(
      "Is `item` commonly served in physically different forms that put its structural starch in different places?",
      {
        what: "Common versions differ in where the bread, crust, tortilla, or wrapper sits",
        examples: [
          "pie (whole or a slice)",
          "quesadilla (flat or folded)",
          "pizza (flat, folded, or deep-dish)",
          "sub sandwich (whole or cut)",
        ],
      },
      {
        what: "Nearly always served with the same structure, or `item` already names one form",
        examples: ["hot dog", "burrito", "Pop-Tart", "steak", "whole pie", "folded quesadilla"],
      },
    ),
    debate_heat: score(
      {
        question: "How much do people argue about what kind of food `item` is?",
        reading: READ_AS_FOOD,
      },
      DEBATE_LEVELS,
    ),
  };
}

export type CubeQuestions = ReturnType<typeof buildCubeQuestions>;
export type CubeRequest = SystemOneRequest<CubeQuestions> & { model: string; state: CubeState };
export type CubeAnswers = SystemOneResult<CubeQuestions>["answers"];
export type CubeResponse = Pick<SystemOneResult<CubeQuestions>, "answers" | "model">;

export function buildCubeRequest(item: string): CubeRequest {
  return { model: CUBE_MODEL, state: buildCubeState(item), questions: buildCubeQuestions() };
}
