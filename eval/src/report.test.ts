import {
  CATEGORY_IDS,
  type CategoryId,
  type CubeAnswers,
  INPUT_KIND_IDS,
  mockCubeResponse,
} from "@cube/core";
import { describe, expect, it } from "vitest";
import type { RawRecord } from "./cache";
import type { LabelledItem } from "./dataset";
import { describeFailure, pct, predictionProbability, renderReport } from "./report";
import { scoreItem, summarize } from "./score";

const probabilities = <K extends string>(ids: readonly K[], pick: K, top: number) =>
  Object.fromEntries(ids.map((id) => [id, id === pick ? top : (1 - top) / (ids.length - 1)]));

function outcome(
  item: string,
  expected: CategoryId,
  jev: CategoryId,
  extra: Partial<LabelledItem>,
) {
  const answers = {
    ...mockCubeResponse(item).answers,
    is_abusive: { type: "noul", noul: 0.02 },
    input_kind: {
      type: "choice",
      choice: "food",
      confidence: 1,
      probabilities: probabilities(INPUT_KIND_IDS, "food", 1),
    },
    category: {
      type: "choice",
      choice: jev,
      confidence: 0.62,
      probabilities: probabilities(CATEGORY_IDS, jev, 0.7),
    },
  } as unknown as CubeAnswers;
  const record: RawRecord = {
    item,
    version: "2",
    fingerprint: "0123456789abcdef",
    model: "jev-1.13.0",
    answers,
    usage: { input_tokens: 8500, output_tokens: 550 },
    latencyMs: 480,
    attempts: 1,
    requestId: null,
    fetchedAt: "2026-09-22T00:00:00.000Z",
  };
  return scoreItem(
    {
      key: item,
      item,
      expected,
      source: "consensus",
      note: "a | note",
      split: "tune",
      inPrompt: [],
      ...extra,
    },
    record,
  );
}

const outcomes = [
  outcome("gyro", "taco", "calzone", {}),
  outcome("waffle", "toast", "toast", { tags: ["name_bias"] }),
  outcome("hot dog", "taco", "taco", { source: "cuberule", split: "canon" }),
  outcome("tamale", "calzone", "sushi", { split: "holdout" }),
];
const meta = {
  questionSetVersion: "2",
  model: "jev-1.13.0",
  fingerprint: "0123456789abcdef",
  datasetSize: 4,
};
const fetched = { first: "2026-09-22T00:00:00Z", last: "2026-09-22T00:01:00Z" };
const summary = summarize(outcomes, meta);
const report = renderReport(summary, outcomes, fetched);

describe("renderReport", () => {
  it("has every section", () => {
    for (const heading of [
      "# Eval report: question set v2",
      "## Headline",
      "## Confidence bands",
      "## Confusion matrix: tune",
      "## Confusion matrix: canon",
      "## Abuse guard",
      "## Public listing",
      "## Probes",
      "## Honorary rulings",
      "## Failures: tune",
      "## Failures: canon",
      "## Holdout",
      "## Every item",
    ]) {
      expect(report).toContain(heading);
    }
  });

  it("lists each failure with its top three probabilities and confidence", () => {
    expect(report).toMatch(
      /\| gyro \| taco \| calzone \| 0\.70 \| 0\.62 majority \| calzone 0\.70, /,
    );
    expect(report).toContain("a \\| note");
  });

  it("keeps holdout failures inside the collapsed details", () => {
    expect(report.indexOf("| tamale |")).toBeGreaterThan(report.indexOf("<details>"));
  });

  it("names an encoded probe only by its key", () => {
    const answers = { ...mockCubeResponse("x").answers, is_abusive: { type: "noul", noul: 0.4 } };
    const probe = scoreItem(
      {
        key: "cHJvYmUgdGV4dA==",
        item: "probe text",
        expected: "declined",
        source: "probe",
        note: "n",
        split: "tune",
        inPrompt: [],
        encoded: true,
      },
      {
        item: "cHJvYmUgdGV4dA==",
        version: "2",
        fingerprint: "f",
        model: "jev-1.13.0",
        answers: answers as CubeAnswers,
        usage: { input_tokens: 1, output_tokens: 1 },
        latencyMs: 1,
        attempts: 1,
        requestId: null,
        fetchedAt: "2026-09-22T00:00:00.000Z",
      },
    );
    const all = [...outcomes, probe];
    const text = renderReport(summarize(all, { ...meta, datasetSize: 5 }), all, fetched);
    expect(text).toContain("cHJvYmUgdGV4dA==");
    expect(text).not.toContain("probe text");
    expect(text).toContain("## Abuse guard");
  });

  it("uses no em or en dashes", () => {
    const dashes = [0x2013, 0x2014].map((code) => String.fromCodePoint(code));
    expect(dashes.filter((dash) => report.includes(dash))).toEqual([]);
  });
});

describe("failure lines", () => {
  it("formats the item, label, ruling and probability", () => {
    const [gyro] = outcomes;
    if (!gyro) throw new Error("missing fixture");
    expect(describeFailure(gyro)).toBe("gyro: expected taco, Jev calzone (p=0.70)");
    expect(predictionProbability(gyro)).toBe(0.7);
  });

  it("formats rates with counts", () => {
    expect(pct({ n: 3, hits: 2, rate: 2 / 3 })).toBe("66.7% (2/3)");
    expect(pct({ n: 0, hits: 0, rate: null })).toBe("n/a");
  });
});
