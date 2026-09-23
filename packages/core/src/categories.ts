export const CATEGORY_IDS = [
  "salad",
  "toast",
  "sandwich",
  "taco",
  "sushi",
  "quiche",
  "calzone",
  "cake",
  "nachos",
] as const;
export type CategoryId = (typeof CATEGORY_IDS)[number];

export const CUBE_FACES = ["top", "bottom", "left", "right", "front", "back"] as const;
export type CubeFace = (typeof CUBE_FACES)[number];
export type CubeInterior = "none" | "layers" | "core";
export type CategoryFamily = "layered" | "shell" | "loose";

export interface CubeGeometry {
  readonly faces: Readonly<Record<CubeFace, boolean>>;
  readonly interior: CubeInterior;
}

export interface CubeCategory {
  readonly id: CategoryId;
  readonly number: number;
  readonly glyph: string;
  readonly name: string;
  readonly article: "a" | "";
  readonly noun: string;
  readonly stem: string;
  readonly family: CategoryFamily;
  readonly summary: string;
  readonly geometry: CubeGeometry;
  readonly examples: readonly string[];
}

const solid = (...on: CubeFace[]): Readonly<Record<CubeFace, boolean>> =>
  Object.fromEntries(CUBE_FACES.map((face) => [face, on.includes(face)])) as Record<
    CubeFace,
    boolean
  >;

// `examples` holds only rulings published on cuberule.com. Extrapolated examples belong in questions.ts.
export const CATEGORIES: Readonly<Record<CategoryId, CubeCategory>> = {
  salad: {
    id: "salad",
    number: 0,
    glyph: "⓪",
    name: "Salad",
    article: "a",
    noun: "salad",
    stem: "salad",
    family: "loose",
    summary: "No structural starch",
    geometry: { faces: solid(), interior: "none" },
    examples: [
      "steak",
      "mashed potatoes (creamy and smooth)",
      "flan",
      "turducken (with sausage stuffing)",
      "chocolate",
      "soup (a wet salad)",
      "vanilla soy latte (a three-bean soup wet salad)",
    ],
  },
  toast: {
    id: "toast",
    number: 1,
    glyph: "①",
    name: "Toast",
    article: "",
    noun: "toast",
    stem: "toast",
    family: "layered",
    summary: "Starch on the bottom",
    geometry: { faces: solid("bottom"), interior: "none" },
    examples: [
      "pizza",
      "nigiri sushi",
      "pumpkin pie slice (bent toast)",
      "muffin (a block of starch)",
    ],
  },
  sandwich: {
    id: "sandwich",
    number: 2,
    glyph: "②",
    name: "Sandwich",
    article: "a",
    noun: "sandwich",
    stem: "sandwich",
    family: "layered",
    summary: "Starch on the top and bottom",
    geometry: { faces: solid("top", "bottom"), interior: "none" },
    examples: ["quesadilla (non-folded)", "toast sandwich", "Victoria sponge cake"],
  },
  taco: {
    id: "taco",
    number: 3,
    glyph: "③",
    name: "Taco",
    article: "a",
    noun: "taco",
    stem: "taco",
    family: "shell",
    summary: "Starch on the bottom and two sides",
    geometry: { faces: solid("bottom", "left", "right"), interior: "none" },
    examples: ["hot dog", "sub sandwich (uncut)", "slice of pie (taco on its side)"],
  },
  sushi: {
    id: "sushi",
    number: 4,
    glyph: "④",
    name: "Sushi",
    article: "",
    noun: "sushi",
    stem: "sushi",
    family: "shell",
    summary: "Starch on the top, bottom and two sides",
    geometry: { faces: solid("top", "bottom", "left", "right"), interior: "none" },
    examples: ["falafel wrap", "pigs in a blanket", "enchilada"],
  },
  quiche: {
    id: "quiche",
    number: 5,
    glyph: "⑤",
    name: "Quiche",
    article: "a",
    noun: "quiche",
    stem: "quiche",
    family: "shell",
    summary: "Starch on the bottom and all four sides",
    geometry: { faces: solid("bottom", "left", "right", "front", "back"), interior: "none" },
    examples: [
      "cheesecake",
      "soup (in a bread bowl)",
      "falafel pita",
      "deep-dish pizza",
      "salad (in a bread bowl)",
      "key lime pie",
    ],
  },
  calzone: {
    id: "calzone",
    number: 6,
    glyph: "⑥",
    name: "Calzone",
    article: "a",
    noun: "calzone",
    stem: "calzone",
    family: "shell",
    summary: "Starch on all six sides",
    geometry: { faces: solid(...CUBE_FACES), interior: "none" },
    examples: [
      "burrito",
      "corn dog",
      "pie (whole)",
      "dumplings",
      "Pop-Tarts",
      "Uncrustables (unbitten)",
    ],
  },
  cake: {
    id: "cake",
    number: 7,
    glyph: "⑦",
    name: "Cake",
    article: "",
    noun: "cake",
    stem: "cake",
    family: "layered",
    summary: "Stacked layers of starch",
    geometry: { faces: solid("top", "bottom"), interior: "layers" },
    examples: ["lasagna", "Big Mac", "flapjacks"],
  },
  nachos: {
    id: "nachos",
    number: 8,
    glyph: "⑧",
    name: "Nachos",
    article: "",
    noun: "nachos",
    stem: "nacho",
    family: "loose",
    summary: "A smaller cube of starch inside",
    geometry: { faces: solid(), interior: "core" },
    examples: [
      "poutine",
      "Lucky Charms",
      "salad with croutons",
      "fried noodles",
      "couscous",
      "ramen (wet nachos)",
    ],
  },
};

export const FAMILIES: Readonly<Record<CategoryFamily, { label: string; summary: string }>> = {
  layered: { label: "Layered", summary: "Flat layers of starch" },
  shell: { label: "Shell", summary: "Starch walls around the filling" },
  loose: { label: "Loose", summary: "No starch on the faces" },
};

export const STARCH_IDS = [
  "bread",
  "tortilla",
  "dough_or_pastry",
  "batter_or_sponge",
  "pasta_or_noodles",
  "rice",
  "potato",
  "grain_or_cereal",
  "other_starch",
  "none",
] as const;
export type StarchId = (typeof STARCH_IDS)[number];

export const STARCHES: Readonly<Record<StarchId, { label: string; color: string }>> = {
  bread: { label: "Bread", color: "#C68A4A" },
  tortilla: { label: "Tortilla", color: "#E8C872" },
  dough_or_pastry: { label: "Dough or pastry", color: "#D9A45B" },
  batter_or_sponge: { label: "Batter or sponge", color: "#F0C987" },
  pasta_or_noodles: { label: "Pasta or noodles", color: "#F3DFA2" },
  rice: { label: "Rice", color: "#F4F1E8" },
  potato: { label: "Potato", color: "#E6B94F" },
  grain_or_cereal: { label: "Grain or cereal", color: "#CFAE7A" },
  other_starch: { label: "Other starch", color: "#BFA88A" },
  none: { label: "No starch", color: "#9CA3AF" },
};

export const INPUT_KIND_IDS = ["food", "not_food", "nonsense"] as const;
export type InputKindId = (typeof INPUT_KIND_IDS)[number];

export const PERSON_KIND_IDS = ["none", "public", "private"] as const;
export type PersonKindId = (typeof PERSON_KIND_IDS)[number];

export const RICE_CLAUSE = "You are free to interpret the nature of rice however you wish.";
