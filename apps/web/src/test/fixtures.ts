import {
  CATEGORY_IDS,
  type CategoryId,
  type ClassifyResponse,
  type CubeAnswers,
  type CubeResult,
  mockCubeResponse,
  toCubeResult,
} from "@cube/core";

type Patch = Partial<Record<keyof CubeAnswers, unknown>>;

export function categoryChoice(
  choice: CategoryId,
  odds: Partial<Record<CategoryId, number>>,
  confidence: number,
) {
  const named = Object.values(odds).reduce((sum, p) => sum + (p ?? 0), 0);
  const rest = (1 - named) / CATEGORY_IDS.filter((id) => !(id in odds)).length;
  return {
    type: "choice",
    choice,
    confidence,
    probabilities: Object.fromEntries(CATEGORY_IDS.map((id) => [id, odds[id] ?? rest])),
  };
}

export const noul = (p: number) => ({ type: "noul", noul: p });

export const inputKind = (choice: "food" | "not_food" | "nonsense") => ({
  type: "choice",
  choice,
  confidence: 0.95,
  probabilities: {
    food: choice === "food" ? 0.96 : 0.02,
    not_food: choice === "not_food" ? 0.96 : 0.02,
    nonsense: choice === "nonsense" ? 0.96 : 0.02,
  },
});

export function response(item: string, patch: Patch = {}, mock = false): ClassifyResponse {
  const base = mockCubeResponse(item);
  const answers = { ...base.answers, ...patch } as CubeAnswers;
  return mock ? { model: "mock", answers, mock: true } : { model: "jev-1.13.0", answers };
}

export function result(item: string, patch: Patch = {}): CubeResult {
  return toCubeResult(item, response(item, patch));
}

export const scenarios = {
  unanimous: () =>
    result("sloppy joe", {
      input_kind: inputKind("food"),
      category: categoryChoice("sandwich", { sandwich: 0.97, taco: 0.02 }, 0.96),
    }),
  splitFamily: () =>
    result("gyro", {
      input_kind: inputKind("food"),
      category: categoryChoice("taco", { taco: 0.38, sushi: 0.3, calzone: 0.14 }, 0.3),
    }),
  officialDissent: () =>
    result("cheesecake", {
      category: categoryChoice("cake", { cake: 0.62, quiche: 0.3 }, 0.55),
    }),
  honorary: () =>
    result("canoe", {
      input_kind: inputKind("not_food"),
      honorary_category: categoryChoice("taco", { taco: 0.7, sushi: 0.2 }, 0.62),
    }),
  nonsense: () => result("qwzx plorf", { input_kind: inputKind("nonsense") }),
  declined: () => result("awful slur text", { is_abusive: noul(0.97) }),
};
