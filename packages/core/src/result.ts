import type { ChoiceResponse, EntryType } from "@typesafe-ai/sdk";
import {
  CATEGORIES,
  CATEGORY_IDS,
  type CategoryFamily,
  type CategoryId,
  type CubeFace,
  type InputKindId,
  type StarchId,
} from "./categories";
import { findOfficialRuling, type OfficialRuling } from "./official";
import { type CubeAnswers, type CubeResponse, THRESHOLDS } from "./questions";

export const DEBATE_LABELS = ["Settled", "Mild", "Spicy", "Friendship-ending"] as const;
export type DebateLevel = 0 | 1 | 2 | 3;

export type Verdict = "unanimous" | "majority" | "split";

export const VERDICT_ADVERBS: Readonly<Record<Verdict, string>> = {
  unanimous: "Definitely",
  majority: "Probably",
  split: "Arguably",
};

export type Tri = "yes" | "no" | "unsure";
export type WallCount = 0 | 1 | 2 | 4;

export interface CategoryOdds {
  readonly id: CategoryId;
  readonly probability: number;
}

export interface FamilyFallback {
  readonly family: CategoryFamily;
  readonly probability: number;
}

export interface CubeRuling {
  readonly category: CategoryId;
  readonly confidence: number;
  readonly verdict: Verdict;
  readonly odds: readonly CategoryOdds[];
  readonly dissent: CategoryOdds | null;
  readonly family: FamilyFallback | null;
}

export interface OfficialMatch {
  readonly category: CategoryId;
  readonly note: string | null;
  readonly jevAgrees: boolean;
}

export interface JevEyes {
  readonly faces: Readonly<Record<CubeFace, Tri>>;
  readonly walls: WallCount | null;
  readonly middleLayer: Tri;
  readonly loosePieces: Tri;
  readonly solidBlock: Tri;
  readonly reading: CategoryId | null;
  readonly agrees: boolean | null;
}

interface ResultBase {
  readonly item: string;
  readonly model: string;
}

export interface FoodResult extends ResultBase {
  readonly kind: "food";
  readonly category: CategoryId;
  readonly title: string;
  readonly headline: string;
  readonly ruling: CubeRuling;
  readonly official: OfficialMatch | null;
  readonly wet: boolean;
  readonly starch: StarchId | null;
  readonly riceClause: boolean;
  readonly muffinClause: boolean;
  readonly dependsOnServing: boolean;
  readonly debate: {
    readonly level: DebateLevel;
    readonly label: (typeof DEBATE_LABELS)[DebateLevel];
  };
  readonly nameTraps: readonly CategoryId[];
  readonly eyes: JevEyes;
}

export interface HonoraryResult extends ResultBase {
  readonly kind: "honorary";
  readonly category: CategoryId;
  readonly title: string;
  readonly headline: string;
  readonly ruling: CubeRuling;
  readonly official: OfficialMatch | null;
}

export interface NonsenseResult extends ResultBase {
  readonly kind: "nonsense";
}

export type CubeResult = FoodResult | HonoraryResult | NonsenseResult;

const prob = (value: number | undefined, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;

const tri = (value: number): Tri =>
  value >= THRESHOLDS.yes ? "yes" : value <= THRESHOLDS.no ? "no" : "unsure";

const isCategoryId = (value: string): value is CategoryId =>
  (CATEGORY_IDS as readonly string[]).includes(value);

export function describeCategory(id: CategoryId, wet = false): string {
  const { article, noun } = CATEGORIES[id];
  return [article, wet ? "wet" : "", noun].filter(Boolean).join(" ");
}

function toRuling(answer: ChoiceResponse<Record<CategoryId, EntryType>>): CubeRuling {
  const odds = CATEGORY_IDS.map((id) => ({ id, probability: prob(answer.probabilities[id]) })).sort(
    (a, b) => b.probability - a.probability,
  );
  const category = isCategoryId(answer.choice) ? answer.choice : (odds[0]?.id ?? "salad");
  const confidence = prob(answer.confidence);
  const verdict: Verdict =
    confidence >= THRESHOLDS.unanimous
      ? "unanimous"
      : confidence >= THRESHOLDS.majority
        ? "majority"
        : "split";
  const runnerUp = odds.find((o) => o.id !== category);
  const family = CATEGORIES[category].family;
  const familyProbability = odds
    .filter((o) => CATEGORIES[o.id].family === family)
    .reduce((sum, o) => sum + o.probability, 0);
  return {
    category,
    confidence,
    verdict,
    odds,
    dissent: runnerUp && runnerUp.probability >= THRESHOLDS.dissent ? runnerUp : null,
    family:
      verdict === "split" && familyProbability >= THRESHOLDS.family
        ? { family, probability: familyProbability }
        : null,
  };
}

function toOfficialMatch(
  official: OfficialRuling | null,
  ruling: CubeRuling,
): OfficialMatch | null {
  return official
    ? {
        category: official.category,
        note: official.note,
        jevAgrees: official.category === ruling.category,
      }
    : null;
}

// Classifies the face set up to rotation, which is how "a slice of pie is a taco on its side" works.
export function shapeCategory(base: boolean, lid: boolean, walls: WallCount): CategoryId {
  const faces = Number(base) + Number(lid) + walls;
  const hasOppositePair = (base && lid) || walls >= 2;
  if (faces === 0) return "salad";
  if (faces === 1) return "toast";
  if (faces === 2) return hasOppositePair ? "sandwich" : "toast";
  if (faces === 3) return "taco";
  if (faces === 4) return "sushi";
  return faces === 5 ? "quiche" : "calzone";
}

export function readEyes(a: CubeAnswers, category: CategoryId): JevEyes {
  const all = prob(a.starch_all_walls.noul, 0.5);
  const opposite = Math.max(prob(a.starch_opposite_walls.noul, 0.5), all);
  const any = Math.max(prob(a.starch_side_wall.noul, 0.5), opposite);
  const [allT, oppositeT, anyT] = [tri(all), tri(opposite), tri(any)];
  const walls: WallCount | null =
    allT === "yes"
      ? 4
      : allT === "unsure"
        ? null
        : oppositeT === "yes"
          ? 2
          : oppositeT === "unsure"
            ? null
            : anyT === "yes"
              ? 1
              : anyT === "unsure"
                ? null
                : 0;
  const base = tri(prob(a.starch_base.noul, 0.5));
  const lid = tri(prob(a.starch_lid.noul, 0.5));
  const middleLayer = tri(prob(a.starch_middle_layer.noul, 0.5));
  const loosePieces = tri(prob(a.starch_loose_pieces.noul, 0.5));
  const solidBlock = tri(prob(a.starch_block.noul, 0.5));

  const interior = [solidBlock, middleLayer, loosePieces];
  const reading: CategoryId | null =
    solidBlock === "yes"
      ? "toast"
      : middleLayer === "yes"
        ? "cake"
        : loosePieces === "yes"
          ? "nachos"
          : interior.includes("unsure") || base === "unsure" || lid === "unsure" || walls === null
            ? null
            : shapeCategory(base === "yes", lid === "yes", walls);

  return {
    faces: {
      bottom: base,
      top: lid,
      left: oppositeT,
      right: oppositeT,
      front: allT,
      back: walls === null ? "unsure" : walls === 4 || walls === 1 ? "yes" : "no",
    },
    walls,
    middleLayer,
    loosePieces,
    solidBlock,
    reading,
    agrees: reading === null ? null : reading === category,
  };
}

export function toCubeResult(item: string, { answers, model }: CubeResponse): CubeResult {
  const official = findOfficialRuling(item);
  const kind: InputKindId = official
    ? official.honorary
      ? "not_food"
      : "food"
    : answers.input_kind.choice;
  if (kind === "nonsense") return { kind: "nonsense", item, model };

  if (kind === "not_food") {
    const ruling = toRuling(answers.honorary_category);
    const category = official?.category ?? ruling.category;
    const adverb = official ? "officially" : VERDICT_ADVERBS[ruling.verdict].toLowerCase();
    return {
      kind: "honorary",
      item,
      model,
      category,
      title: `Honorary ${CATEGORIES[category].name}`,
      headline: `If it were food, it would ${adverb} be ${describeCategory(category)}.`,
      ruling,
      official: toOfficialMatch(official, ruling),
    };
  }

  const ruling = toRuling(answers.category);
  const category = official?.category ?? ruling.category;
  const wet = prob(answers.is_wet.noul) >= THRESHOLDS.wet;
  const starch = answers.starch.choice;
  const eyes = readEyes(answers, category);
  const heat = answers.debate_heat.score;
  const level = (
    Number.isFinite(heat) ? Math.min(3, Math.max(0, Math.round(heat))) : 0
  ) as DebateLevel;
  const name = CATEGORIES[category].name;
  return {
    kind: "food",
    item,
    model,
    category,
    title: wet ? `Wet ${name}` : name,
    headline: `${official ? "Officially" : VERDICT_ADVERBS[ruling.verdict]} ${describeCategory(category, wet)}.`,
    ruling,
    official: toOfficialMatch(official, ruling),
    wet,
    starch: category === "salad" || starch === "none" ? null : starch,
    riceClause: prob(answers.starch.probabilities.rice) >= THRESHOLDS.rice,
    muffinClause: category === "toast" && eyes.solidBlock === "yes",
    dependsOnServing: prob(answers.varies_by_serving.noul) >= THRESHOLDS.dependsOnServing,
    debate: { level, label: DEBATE_LABELS[level] },
    nameTraps: CATEGORY_IDS.filter((id) => id !== category && item.includes(CATEGORIES[id].stem)),
    eyes,
  };
}
