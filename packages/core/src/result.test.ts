import type { NoulResponse } from "@typesafe-ai/sdk";
import { describe, expect, it } from "vitest";
import { CATEGORY_IDS, type CategoryId, STARCH_IDS } from "./categories";
import { mockCubeResponse } from "./mock";
import type { CubeAnswers, CubeResponse } from "./questions";
import {
  type CubeResult,
  describeCategory,
  type FoodResult,
  shapeCategory,
  toCubeResult,
  type WallCount,
} from "./result";

const withAnswers = (
  item: string,
  patch: Partial<Record<keyof CubeAnswers, unknown>>,
): CubeResponse => ({
  model: "jev-1.13.0",
  answers: { ...mockCubeResponse(item).answers, ...patch } as CubeAnswers,
});

const noul = (p: number): NoulResponse => ({ type: "noul", noul: p });

const categoryChoice = (
  choice: CategoryId,
  probs: Partial<Record<CategoryId, number>>,
  confidence: number,
) => {
  const rest = 1 - Object.values(probs).reduce((sum, p) => sum + (p ?? 0), 0);
  const others = CATEGORY_IDS.filter((id) => !(id in probs)).length;
  return {
    type: "choice",
    choice,
    confidence,
    probabilities: Object.fromEntries(CATEGORY_IDS.map((id) => [id, probs[id] ?? rest / others])),
  };
};

const foodInput = {
  type: "choice",
  choice: "food",
  confidence: 0.95,
  probabilities: { food: 0.97, not_food: 0.02, nonsense: 0.01 },
};

function asFood(result: CubeResult): FoodResult {
  if (result.kind !== "food") throw new Error(`expected food, got ${result.kind}`);
  return result;
}

describe("shapeCategory", () => {
  it.each<[string, boolean, boolean, WallCount, CategoryId]>([
    ["pizza", true, false, 0, "toast"],
    ["pumpkin pie slice (bent)", true, false, 1, "toast"],
    ["sandwich", true, true, 0, "sandwich"],
    ["hot dog", true, false, 2, "taco"],
    ["slice of cherry pie", true, true, 1, "taco"],
    ["folded quesadilla", true, true, 1, "taco"],
    ["falafel wrap", true, true, 2, "sushi"],
    ["standing tube", false, false, 4, "sushi"],
    ["quiche", true, false, 4, "quiche"],
    ["burrito", true, true, 4, "calzone"],
    ["steak", false, false, 0, "salad"],
  ])("reads %s as %s up to rotation", (_name, base, lid, walls, want) => {
    expect(shapeCategory(base, lid, walls)).toBe(want);
  });
});

describe("toCubeResult", () => {
  it("splits on an apple pie slice with a sandwich dissent while the eyes read taco", () => {
    const pie = asFood(
      toCubeResult(
        "slice of apple pie",
        withAnswers("slice of apple pie", {
          input_kind: foodInput,
          category: categoryChoice("taco", { taco: 0.46, sandwich: 0.3, toast: 0.12 }, 0.33),
          starch_base: noul(0.95),
          starch_lid: noul(0.9),
          starch_side_wall: noul(0.85),
          starch_opposite_walls: noul(0.2),
          starch_all_walls: noul(0.1),
          starch_middle_layer: noul(0.05),
          starch_loose_pieces: noul(0.03),
          starch_block: noul(0.04),
          varies_by_serving: noul(0.9),
          is_wet: noul(0.02),
        }),
      ),
    );
    expect(pie.ruling.verdict).toBe("split");
    expect(pie.ruling.dissent?.id).toBe("sandwich");
    expect(pie.eyes.reading).toBe("taco");
    expect(pie.eyes.agrees).toBe(true);
    expect(pie.dependsOnServing).toBe(true);
    expect(pie.headline).toBe("Arguably a taco.");
    expect(pie.ruling.family).toBeNull();
    expect(pie.eyes.faces).toEqual({
      bottom: "yes",
      top: "yes",
      left: "no",
      right: "no",
      front: "no",
      back: "yes",
    });
  });

  it("lets the official ruling override Jev on cheesecake and keeps Jev's dissent", () => {
    const cheesecake = asFood(
      toCubeResult(
        "cheesecake",
        withAnswers("cheesecake", {
          input_kind: foodInput,
          category: categoryChoice("cake", { cake: 0.55, quiche: 0.35 }, 0.45),
          starch_base: noul(0.9),
          starch_lid: noul(0.05),
          starch_side_wall: noul(0.5),
          starch_opposite_walls: noul(0.4),
          starch_all_walls: noul(0.35),
          starch_middle_layer: noul(0.1),
          starch_loose_pieces: noul(0.02),
          starch_block: noul(0.05),
          is_wet: noul(0.01),
        }),
      ),
    );
    expect(cheesecake.category).toBe("quiche");
    expect(cheesecake.official?.jevAgrees).toBe(false);
    expect(cheesecake.headline).toBe("Officially a quiche.");
    expect(cheesecake.nameTraps).toContain("cake");
    expect(cheesecake.eyes.reading).toBeNull();
    expect(cheesecake.eyes.agrees).toBeNull();
  });

  it("calls ramen officially wet nachos", () => {
    const ramen = asFood(
      toCubeResult(
        "ramen",
        withAnswers("ramen", {
          category: categoryChoice("nachos", { nachos: 0.8 }, 0.75),
          is_wet: noul(0.95),
          starch_loose_pieces: noul(0.9),
          starch: {
            type: "choice",
            choice: "pasta_or_noodles",
            confidence: 0.9,
            probabilities: Object.fromEntries(
              STARCH_IDS.map((s) => [s, s === "pasta_or_noodles" ? 0.91 : 0.01]),
            ),
          },
        }),
      ),
    );
    expect(ramen.title).toBe("Wet Nachos");
    expect(ramen.headline).toBe("Officially wet nachos.");
    expect(ramen.starch).toBe("pasta_or_noodles");
    expect(ramen.riceClause).toBe(false);
  });

  it("calls tomato soup a wet salad and hides its starch", () => {
    const soup = asFood(
      toCubeResult("tomato soup", withAnswers("tomato soup", { is_wet: noul(0.97) })),
    );
    expect(soup.title).toBe("Wet Salad");
    expect(soup.headline).toBe("Officially a wet salad.");
    expect(soup.starch).toBeNull();
  });

  it("makes humans an honorary calzone", () => {
    const humans = toCubeResult("humans", mockCubeResponse("humans"));
    expect(humans.kind).toBe("honorary");
    if (humans.kind !== "honorary") return;
    expect(humans.category).toBe("calzone");
    expect(humans.title).toBe("Honorary Calzone");
    expect(humans.headline).toMatch(/^If it were food, it would officially be a calzone/);
  });

  it("rounds the debate score to a level label", () => {
    const base = mockCubeResponse("hot dog").answers.debate_heat;
    const debate = asFood(
      toCubeResult("hot dog", withAnswers("hot dog", { debate_heat: { ...base, score: 2.6 } })),
    );
    expect(debate.debate).toEqual({ level: 3, label: "Friendship-ending" });
  });
});

describe("describeCategory", () => {
  it("uses each category's article and noun", () => {
    expect(describeCategory("taco")).toBe("a taco");
    expect(describeCategory("nachos", true)).toBe("wet nachos");
    expect(describeCategory("toast")).toBe("toast");
  });
});
