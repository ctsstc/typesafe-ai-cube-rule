import {
  CATEGORY_IDS,
  type CategoryId,
  type CubeAnswers,
  INPUT_KIND_IDS,
  type InputKindId,
  mockCubeResponse,
  QUESTION_SET_VERSION,
} from "@cube/core";
import { describe, expect, it } from "vitest";
import type { RawRecord } from "./cache";
import type { LabelledItem } from "./dataset";
import {
  abuseBuckets,
  abuseRates,
  confusion,
  confusionKey,
  jevFoodResult,
  percentile,
  rate,
  scoreItem,
  splitMetrics,
  summarize,
} from "./score";

function spread<K extends string>(ids: readonly K[], pick: K, top: number) {
  const rest = (1 - top) / (ids.length - 1);
  return Object.fromEntries(ids.map((id) => [id, id === pick ? top : rest])) as Record<K, number>;
}

const category = (pick: CategoryId, top = 0.9) => ({
  type: "choice" as const,
  choice: pick,
  confidence: top,
  probabilities: spread(CATEGORY_IDS, pick, top),
});

const kind = (pick: InputKindId, top = 0.9) => ({
  type: "choice" as const,
  choice: pick,
  confidence: top,
  probabilities: spread(INPUT_KIND_IDS, pick, top),
});

const noul = (p: number) => ({ type: "noul" as const, noul: p });

function record(
  item: string,
  patch: Partial<Record<keyof CubeAnswers, unknown>> = {},
  extra: Partial<RawRecord> = {},
): RawRecord {
  return {
    item,
    version: QUESTION_SET_VERSION,
    fingerprint: "f",
    model: "jev-1.13.0",
    answers: {
      ...mockCubeResponse(item).answers,
      is_abusive: noul(0.01),
      input_kind: kind("food"),
      ...patch,
    } as CubeAnswers,
    usage: { input_tokens: 8000, output_tokens: 500 },
    latencyMs: 400,
    attempts: 1,
    requestId: null,
    fetchedAt: "2026-09-22T00:00:00.000Z",
    ...extra,
  };
}

const labelled = (
  fields: Pick<LabelledItem, "item" | "expected"> & Partial<LabelledItem>,
): LabelledItem => ({
  key: fields.item,
  source: "consensus",
  note: "n",
  split: "tune",
  inPrompt: [],
  ...fields,
});

describe("scoreItem", () => {
  it("scores Jev's own ruling, never the official override", () => {
    const item = labelled({
      item: "hot dog",
      expected: "taco",
      source: "cuberule",
      split: "canon",
    });
    const outcome = scoreItem(item, record("hot dog", { category: category("sushi") }));
    expect(outcome.predicted).toBe("sushi");
    expect(outcome.correct).toBe(false);
    expect(outcome.familyCorrect).toBe(true);
    expect(outcome.categoryCorrect).toBe(false);
    expect(outcome.ruling.top[0]).toEqual({ id: "sushi", probability: 0.9 });
  });

  it("accepts the listed alternatives", () => {
    const item = labelled({ item: "gyro", expected: "taco", accept: ["sushi"] });
    const outcome = scoreItem(item, record("gyro", { category: category("sushi") }));
    expect(outcome.correct).toBe(true);
    expect(outcome.accepted).toEqual(["taco", "sushi"]);
  });

  it("gives family credit only within the family", () => {
    const item = labelled({ item: "waffle", expected: "toast" });
    expect(scoreItem(item, record("waffle", { category: category("cake") })).familyCorrect).toBe(
      true,
    );
    expect(scoreItem(item, record("waffle", { category: category("taco") })).familyCorrect).toBe(
      false,
    );
  });

  it("applies the input kind gate before the category", () => {
    const item = labelled({ item: "gyro", expected: "taco" });
    const outcome = scoreItem(
      item,
      record("gyro", { input_kind: kind("not_food", 0.6), category: category("taco") }),
    );
    expect(outcome.predicted).toBe("not_food");
    expect(outcome.correct).toBe(false);
    expect(outcome.kind).toMatchObject({ expected: "food", jev: "not_food", correct: false });
    expect(outcome.categoryCorrect).toBe(true);
  });

  it("counts a decline as a failure", () => {
    const item = labelled({ item: "sloppy joe", expected: "sandwich" });
    const outcome = scoreItem(item, record("sloppy joe", { is_abusive: noul(0.9) }));
    expect(outcome.predicted).toBe("declined");
    expect(outcome.correct).toBe(false);
    expect(outcome.familyCorrect).toBe(false);
  });

  it("scores an abusive probe by the decline alone, under its encoded key", () => {
    const item = labelled({ key: "c2x1cg==", item: "slur", expected: "declined", source: "probe" });
    const caught = scoreItem(item, record("c2x1cg==", { is_abusive: noul(0.97) }));
    expect(caught).toMatchObject({ item: "c2x1cg==", predicted: "declined", correct: true });
    expect(caught.kind).toMatchObject({ expected: null, correct: null });
    const missed = scoreItem(item, record("c2x1cg==", { is_abusive: noul(0.2) }));
    expect(missed.correct).toBe(false);
    expect(splitMetrics([caught, missed]).inputKindAccuracy).toEqual({ n: 0, hits: 0, rate: null });
  });

  it("scores not-food and nonsense by input kind and reads the honorary ruling", () => {
    const cat = labelled({ item: "my cat", expected: "not_food", honorary: "calzone" });
    const outcome = scoreItem(
      cat,
      record("my cat", {
        input_kind: kind("not_food"),
        honorary_category: category("calzone", 0.7),
      }),
    );
    expect(outcome.correct).toBe(true);
    expect(outcome.categoryCorrect).toBeNull();
    expect(outcome.eyes).toBeNull();
    expect(outcome.honorary).toEqual({ expected: "calzone", jev: "calzone", confidence: 0.7 });

    const hello = labelled({ item: "hello", expected: "nonsense" });
    expect(scoreItem(hello, record("hello")).predicted).not.toBe("nonsense");
    expect(scoreItem(hello, record("hello", { input_kind: kind("nonsense") })).correct).toBe(true);
  });

  it("reads Jev's eyes against Jev's own ruling", () => {
    const item = labelled({ item: "burrito", expected: "calzone", wet: false });
    const outcome = scoreItem(item, record("burrito", { category: category("calzone") }));
    expect(outcome.eyes).toEqual({ reading: "calzone", agrees: true, correct: true });
    expect(outcome.wet).toEqual({ expected: false, jev: false });
  });

  it("marks items whose labels leak through the label questions", () => {
    const leaked = labelled({ item: "club sandwich", expected: "cake", inPrompt: ["category"] });
    const starchOnly = labelled({ item: "onigiri", expected: "calzone", inPrompt: ["starch"] });
    expect(scoreItem(leaked, record("club sandwich")).leaked).toBe(true);
    expect(scoreItem(starchOnly, record("onigiri")).leaked).toBe(false);
  });
});

describe("abuse guard metrics", () => {
  const abusive = (key: string, p: number) =>
    scoreItem(
      labelled({ key, item: key, expected: "declined", source: "probe" }),
      record(key, { is_abusive: noul(p) }),
    );
  const food = (item: string, p: number, tags: LabelledItem["tags"] = []) =>
    scoreItem(labelled({ item, expected: "toast", tags }), record(item, { is_abusive: noul(p) }));
  const outcomes = [
    abusive("a", 0.95),
    abusive("b", 0.55),
    food("spotted dick", 0.4, ["abuse_guard"]),
    food("gyro", 0.02),
  ];

  it("counts detections on abusive probes and false declines on everything else", () => {
    expect(abuseRates(outcomes, 0.5)).toEqual({
      detected: { n: 2, hits: 2, rate: 1 },
      falseDeclines: { n: 2, hits: 0, rate: 0 },
    });
    expect(abuseRates(outcomes, 0.3).falseDeclines.hits).toBe(1);
    expect(abuseRates(outcomes, 0.85).detected.hits).toBe(1);
  });

  it("buckets the distribution by group, with the top bucket closed at 1", () => {
    const buckets = abuseBuckets([...outcomes, abusive("c", 1)]);
    expect(buckets.map((b) => b.from)).toEqual([0, 0.1, 0.3, 0.5, 0.7, 0.85]);
    expect(buckets.at(0)).toMatchObject({ abusive: 0, rudeFoods: 0, other: 1 });
    expect(buckets.at(2)).toMatchObject({ rudeFoods: 1 });
    expect(buckets.at(3)).toMatchObject({ abusive: 1 });
    expect(buckets.at(-1)).toMatchObject({ abusive: 2 });
  });
});

describe("jevFoodResult", () => {
  it("returns a food reading even when Jev chose another input kind or flagged abuse", () => {
    const { answers } = record("humans", {
      is_abusive: noul(0.99),
      input_kind: kind("not_food"),
      category: category("toast"),
    });
    expect(jevFoodResult({ model: "m", answers }).ruling.category).toBe("toast");
  });
});

describe("rate and percentile", () => {
  it("handles empty input", () => {
    expect(rate([])).toEqual({ n: 0, hits: 0, rate: null });
    expect(percentile([], 0.5)).toBeNull();
  });

  it("uses nearest-rank percentiles", () => {
    expect(rate([true, false, true, true]).rate).toBe(0.75);
    expect(percentile([40, 10, 30, 20], 0.5)).toBe(20);
    expect(percentile([40, 10, 30, 20], 0.95)).toBe(40);
    expect(percentile([7], 0.95)).toBe(7);
  });
});

describe("summarize", () => {
  const outcomes = [
    scoreItem(
      labelled({ item: "hot dog", expected: "taco", source: "cuberule", split: "canon" }),
      record("hot dog", { category: category("taco") }, { latencyMs: 300 }),
    ),
    scoreItem(
      labelled({ item: "gyro", expected: "taco" }),
      record("gyro", { category: category("sushi", 0.5) }, { latencyMs: 500, attempts: 2 }),
    ),
    scoreItem(
      labelled({ item: "waffle", expected: "toast" }),
      record("waffle", { category: category("toast") }, { latencyMs: 700 }),
    ),
    scoreItem(
      labelled({ item: "spotted dick", expected: "toast", split: "holdout" }),
      record(
        "spotted dick",
        { is_abusive: noul(0.95), category: category("toast") },
        { latencyMs: 900 },
      ),
    ),
  ];
  const summary = summarize(outcomes, {
    questionSetVersion: "2",
    model: "jev-1.13.0",
    fingerprint: "f",
    datasetSize: 5,
  });

  it("reports the headline metrics per split", () => {
    expect(summary.headline).toMatchObject({
      tuneN: 2,
      tuneAccuracy: 0.5,
      tuneFamilyAccuracy: 1,
      holdoutN: 1,
      holdoutAccuracy: 0,
      canonN: 1,
      canonJevAgreement: 1,
      inputKindAccuracy: 1,
      abuseFalsePositives: 1,
      avgInputTokens: 8000,
      p50LatencyMs: 500,
      p95LatencyMs: 900,
      runCostUsd: 0.001344,
    });
    expect(summary.missing).toBe(1);
    expect(summary.abuse.maxItem).toBe("spotted dick");
    expect(summary.latency.retried).toBe(1);
    expect(summary.cost.perCallUsd).toBe(0.000336);
  });

  it("buckets category accuracy by verdict", () => {
    expect(splitMetrics(outcomes).verdicts.unanimous).toEqual({ n: 3, hits: 3, rate: 1 });
    expect(splitMetrics(outcomes).verdicts.majority).toEqual({ n: 1, hits: 0, rate: 0 });
  });

  it("builds a confusion matrix of primary label against prediction", () => {
    const matrix = confusion(outcomes);
    expect(matrix.rows).toEqual(["toast", "taco"]);
    expect(matrix.cols).toEqual(["toast", "taco", "sushi", "declined"]);
    expect(matrix.counts.get(confusionKey("taco", "sushi"))).toBe(1);
    expect(matrix.counts.get(confusionKey("toast", "declined"))).toBe(1);
  });
});
