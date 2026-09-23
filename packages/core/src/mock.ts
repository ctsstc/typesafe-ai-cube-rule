import type { ChoiceResponse, EntryType, NoulResponse } from "@typesafe-ai/sdk";
import {
  CATEGORIES,
  CATEGORY_IDS,
  type CategoryId,
  INPUT_KIND_IDS,
  type InputKindId,
  PERSON_KIND_IDS,
  type PersonKindId,
  STARCH_IDS,
  type StarchId,
} from "./categories";
import { findOfficialRuling } from "./official";
import { type CubeResponse, DEBATE_LEVELS } from "./questions";

// Keyless development only: deterministic answers shaped like a live response, never real rulings.
export const MOCK_DECLINE_TRIGGER = "slur";
export const MOCK_PRIVATE_PERSON_TRIGGER = "my boss";
const MOCK_PRIVATE_PERSON =
  /\bmy (boss|mom|dad|ex|coworker|neighbor|teacher)\b|\bfrom (accounting|homeroom|work)\b/;
const MOCK_PUBLIC_PERSON = /\b(gordon ramsay|taylor swift|elvis|oprah|shrek|santa claus)\b/;
const MOCK_NONSENSE = /[bcdfghjklmnpqrstvwxz]{5,}/;
const MOCK_NOT_FOOD =
  /\b(humans?|person|cat|car|moon|brick|stapler|chair|phone|sleeping bag|canoe|house|shoe|book)s?\b/;
const MOCK_TIERS = [
  { top: 0.9, second: 0.06, confidence: 0.88 },
  { top: 0.62, second: 0.25, confidence: 0.55 },
  { top: 0.4, second: 0.32, confidence: 0.3 },
] as const;

function hashItem(text: string): number {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ (ch.codePointAt(0) ?? 0), 16777619);
  return h >>> 0;
}

function mockChoice<K extends string>(
  ids: readonly K[],
  pick: K,
  seed: number,
  second?: K,
): ChoiceResponse<Record<K, EntryType>> {
  const tier = MOCK_TIERS[seed % MOCK_TIERS.length] ?? MOCK_TIERS[0];
  const runnerUp = second ?? ids.find((id) => id !== pick) ?? pick;
  const rest = ids.length > 2 ? (1 - tier.top - tier.second) / (ids.length - 2) : 0;
  const probabilities = Object.fromEntries(
    ids.map((id) => [id, id === pick ? tier.top : id === runnerUp ? tier.second : rest]),
  ) as Record<K, number>;
  return { type: "choice", choice: pick, confidence: tier.confidence, probabilities };
}

const mockNoul = (yes: boolean): NoulResponse => ({ type: "noul", noul: yes ? 0.92 : 0.06 });

function mockStarch(item: string, category: CategoryId): StarchId {
  if (/rice|sushi|nigiri|onigiri|maki/.test(item)) return "rice";
  if (/noodle|ramen|pasta|lasagn|spaghetti|ravioli/.test(item)) return "pasta_or_noodles";
  if (/potato|fries|poutine|tots/.test(item)) return "potato";
  if (/taco|burrito|quesadilla|enchilada|nacho|tortilla/.test(item)) return "tortilla";
  const byCategory: Record<CategoryId, StarchId> = {
    salad: "none",
    toast: "bread",
    sandwich: "bread",
    taco: "bread",
    sushi: "tortilla",
    quiche: "dough_or_pastry",
    calzone: "dough_or_pastry",
    cake: "batter_or_sponge",
    nachos: "grain_or_cereal",
  };
  return byCategory[category];
}

export function mockCubeResponse(item: string): CubeResponse {
  const seed = hashItem(item);
  const official = findOfficialRuling(item);
  const kind: InputKindId = official
    ? official.honorary
      ? "not_food"
      : "food"
    : /\p{L}/u.test(item) && (!/[aeiouy]/.test(item) || MOCK_NONSENSE.test(item))
      ? "nonsense"
      : MOCK_NOT_FOOD.test(item) || MOCK_PRIVATE_PERSON.test(item) || MOCK_PUBLIC_PERSON.test(item)
        ? "not_food"
        : "food";
  const person: PersonKindId = MOCK_PRIVATE_PERSON.test(item)
    ? "private"
    : MOCK_PUBLIC_PERSON.test(item)
      ? "public"
      : "none";
  const category = official?.category ?? CATEGORY_IDS[seed % CATEGORY_IDS.length] ?? "salad";
  const sibling = CATEGORY_IDS.find(
    (id) => id !== category && CATEGORIES[id].family === CATEGORIES[category].family,
  );
  const { faces, interior } = CATEGORIES[category].geometry;
  const starch = mockStarch(item, category);
  const level = (seed >>> 3) % 4;
  const p = (n: number) => (n === level ? 0.85 : 0.05);

  return {
    model: "mock",
    answers: {
      is_abusive: mockNoul(item.split(/\W+/).includes(MOCK_DECLINE_TRIGGER)),
      input_kind: mockChoice(INPUT_KIND_IDS, kind, 0),
      person_kind: mockChoice(PERSON_KIND_IDS, person, 0, person === "none" ? "public" : "none"),
      category: mockChoice(CATEGORY_IDS, category, seed, sibling),
      honorary_category: mockChoice(CATEGORY_IDS, category, seed, sibling),
      starch: mockChoice(STARCH_IDS, starch, 0),
      is_wet: mockNoul(
        /soup|ramen|latte|milk|broth|tea|coffee|juice|smoothie|cereal|pho/.test(item),
      ),
      starch_base: mockNoul(faces.bottom),
      starch_lid: mockNoul(faces.top),
      starch_side_wall: mockNoul(faces.left || faces.back),
      starch_opposite_walls: mockNoul(faces.left && faces.right),
      starch_all_walls: mockNoul(faces.front && faces.back),
      starch_middle_layer: mockNoul(interior === "layers"),
      starch_loose_pieces: mockNoul(interior === "core"),
      starch_block: mockNoul(
        category === "toast" && /muffin|bagel|roll|loaf|croissant|doughnut|donut/.test(item),
      ),
      varies_by_serving: mockNoul(/pie|pizza|quesadilla|\bsub\b/.test(item)),
      debate_heat: {
        type: "score",
        score: level,
        confidence: 0.8,
        legend: {
          "0": DEBATE_LEVELS[0],
          "1": DEBATE_LEVELS[1],
          "2": DEBATE_LEVELS[2],
          "3": DEBATE_LEVELS[3],
        },
        probabilities: { "0": p(0), "1": p(1), "2": p(2), "3": p(3) },
      },
    },
  };
}
