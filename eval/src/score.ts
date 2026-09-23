import {
  CATEGORIES,
  type CategoryId,
  type CategoryOdds,
  type CubeResponse,
  type FoodResult,
  findOfficialRuling,
  type HonoraryResult,
  INPUT_KIND_IDS,
  type InputKindId,
  type ListingBars,
  mayNamePrivatePerson,
  PERSON_KIND_IDS,
  type PersonKindId,
  type PublicListingReason,
  publicListing,
  THRESHOLDS,
  toCubeResult,
  type Verdict,
} from "@cube/core";
import type { RawRecord } from "./cache";
import {
  acceptedLabels,
  expectedPerson,
  isCategoryId,
  LABELS,
  type Label,
  type LabelledItem,
  type Source,
  type Split,
  type Tag,
} from "./dataset";

export const PRICE_PER_MILLION_INPUT_USD = 0.042;
export const LABEL_QUESTIONS: readonly string[] = ["category", "input_kind", "honorary_category"];
export const VERDICTS: readonly Verdict[] = ["unanimous", "majority", "split"];

export type Prediction = Label;
export const PREDICTIONS: readonly Prediction[] = LABELS;
export const ABUSE_SWEEP: readonly number[] = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.85, 0.9];
export const ABUSE_BUCKETS: readonly number[] = [0.1, 0.3, 0.5, 0.7, 0.85];
export const PERSON_SWEEP: readonly number[] = [0.03, 0.05, 0.1, 0.15, 0.2, 0.3, 0.5];
export const PERSON_SURE_SWEEP: readonly number[] = [0.5, 0.7, 0.8, 0.85, 0.9, 0.95];
export const PUBLIC_ABUSE_SWEEP: readonly number[] = [0.02, 0.03, 0.05, 0.08, 0.1, 0.2, 0.3];
export const LISTING_REASONS: readonly PublicListingReason[] = [
  "listed",
  "declined",
  "nonsense",
  "blocked",
  "personal_info",
  "private_person",
  "abusive",
];

export interface ItemOutcome {
  readonly item: string;
  readonly split: Split;
  readonly source: Source;
  readonly tags: readonly Tag[];
  readonly note: string;
  readonly leaked: boolean;
  readonly expected: Label;
  readonly accepted: readonly Label[];
  readonly predicted: Prediction;
  readonly correct: boolean;
  readonly familyCorrect: boolean;
  readonly kind: {
    readonly expected: InputKindId | null;
    readonly jev: InputKindId;
    readonly correct: boolean | null;
    readonly probabilities: Readonly<Record<InputKindId, number>>;
  };
  readonly abusive: number;
  readonly declined: boolean;
  readonly ruling: {
    readonly category: CategoryId;
    readonly confidence: number;
    readonly verdict: Verdict;
    readonly top: readonly CategoryOdds[];
  };
  readonly categoryCorrect: boolean | null;
  readonly eyes: {
    readonly reading: CategoryId | null;
    readonly agrees: boolean | null;
    readonly correct: boolean | null;
  } | null;
  readonly wet: { readonly expected: boolean; readonly jev: boolean } | null;
  readonly honorary: {
    readonly expected: CategoryId | null;
    readonly jev: CategoryId;
    readonly confidence: number;
  } | null;
  readonly person: {
    readonly expected: PersonKindId | null;
    readonly labelled: boolean;
    readonly leaked: boolean;
    readonly jev: PersonKindId;
    readonly correct: boolean | null;
    readonly probabilities: Readonly<Record<PersonKindId, number>>;
  };
  readonly listing: { readonly reason: PublicListingReason; readonly canon: boolean };
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly latencyMs: number;
  readonly attempts: number;
}

function forceKind(response: CubeResponse, kind: InputKindId): CubeResponse {
  const { answers } = response;
  return {
    model: response.model,
    answers: {
      ...answers,
      is_abusive: { type: "noul", noul: 0 },
      input_kind: { ...answers.input_kind, choice: kind },
    },
  };
}

// toCubeResult swaps in the official ruling for a known item name. An empty item never matches
// one, so these readings are Jev's own.
export function jevFoodResult(response: CubeResponse): FoodResult {
  const result = toCubeResult("", forceKind(response, "food"));
  if (result.kind !== "food") throw new Error(`expected a food result, got ${result.kind}`);
  return result;
}

export function jevHonoraryResult(response: CubeResponse): HonoraryResult {
  const result = toCubeResult("", forceKind(response, "not_food"));
  if (result.kind !== "honorary") {
    throw new Error(`expected an honorary result, got ${result.kind}`);
  }
  return result;
}

const expectedKind = (label: Label): InputKindId | null =>
  label === "declined" ? null : isCategoryId(label) ? "food" : label;

export function scoreItem(item: LabelledItem, record: RawRecord): ItemOutcome {
  const response: CubeResponse = { model: record.model, answers: record.answers };
  const { answers } = record;
  const food = jevFoodResult(response);
  const abusive = answers.is_abusive.noul;
  const declined = abusive >= THRESHOLDS.abusive;
  const jevKind = answers.input_kind.choice;
  const predicted: Prediction = declined
    ? "declined"
    : jevKind === "food"
      ? food.ruling.category
      : jevKind;

  const accepted = acceptedLabels(item);
  const correct = accepted.includes(predicted);
  const isFood = isCategoryId(item.expected);
  const acceptedFamilies = new Set(
    accepted.filter(isCategoryId).map((category) => CATEGORIES[category].family),
  );
  const familyCorrect =
    isFood && isCategoryId(predicted)
      ? acceptedFamilies.has(CATEGORIES[predicted].family)
      : correct;

  const kindProbabilities = Object.fromEntries(
    INPUT_KIND_IDS.map((id) => [id, answers.input_kind.probabilities[id]]),
  ) as Record<InputKindId, number>;
  const honorary = item.expected === "not_food" ? jevHonoraryResult(response).ruling : null;

  const kindExpected = expectedKind(item.expected);
  const personExpected = expectedPerson(item);
  const personJev = answers.person_kind.choice;
  return {
    item: item.key,
    split: item.split,
    source: item.source,
    tags: item.tags ?? [],
    note: item.note,
    leaked: item.inPrompt.some((id) => LABEL_QUESTIONS.includes(id)),
    expected: item.expected,
    accepted,
    predicted,
    correct,
    familyCorrect,
    kind: {
      expected: kindExpected,
      jev: jevKind,
      correct: kindExpected === null ? null : jevKind === kindExpected,
      probabilities: kindProbabilities,
    },
    abusive,
    declined,
    ruling: {
      category: food.ruling.category,
      confidence: food.ruling.confidence,
      verdict: food.ruling.verdict,
      top: food.ruling.odds.slice(0, 3),
    },
    categoryCorrect: isFood ? accepted.includes(food.ruling.category) : null,
    eyes: isFood
      ? {
          reading: food.eyes.reading,
          agrees: food.eyes.agrees,
          correct: food.eyes.reading === null ? null : accepted.includes(food.eyes.reading),
        }
      : null,
    wet: item.wet === undefined ? null : { expected: item.wet, jev: food.wet },
    honorary: honorary
      ? {
          expected: item.honorary ?? null,
          jev: honorary.category,
          confidence: honorary.confidence,
        }
      : null,
    person: {
      expected: personExpected,
      labelled: item.person !== undefined,
      leaked: item.inPrompt.includes("person_kind"),
      jev: personJev,
      correct: personExpected === null ? null : personJev === personExpected,
      probabilities: Object.fromEntries(
        PERSON_KIND_IDS.map((id) => [id, answers.person_kind.probabilities[id]]),
      ) as Record<PersonKindId, number>,
    },
    listing: {
      reason: publicListing(item.item, response).reason,
      canon: findOfficialRuling(item.item) !== null,
    },
    inputTokens: record.usage.input_tokens,
    outputTokens: record.usage.output_tokens,
    latencyMs: record.latencyMs,
    attempts: record.attempts,
  };
}

export interface Rate {
  readonly n: number;
  readonly hits: number;
  readonly rate: number | null;
}

export function rate(flags: readonly boolean[]): Rate {
  const hits = flags.filter(Boolean).length;
  return { n: flags.length, hits, rate: flags.length === 0 ? null : hits / flags.length };
}

export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil(p * sorted.length)));
  return sorted[rank - 1] ?? null;
}

export interface SplitMetrics {
  readonly n: number;
  readonly accuracy: Rate;
  readonly familyAccuracy: Rate;
  readonly categoryAccuracy: Rate;
  readonly inputKindAccuracy: Rate;
  readonly unleakedAccuracy: Rate;
  readonly verdicts: Readonly<Record<Verdict, Rate>>;
}

export function splitMetrics(outcomes: readonly ItemOutcome[]): SplitMetrics {
  const food = outcomes.filter((o) => o.categoryCorrect !== null);
  const verdicts = Object.fromEntries(
    VERDICTS.map((verdict) => [
      verdict,
      rate(food.filter((o) => o.ruling.verdict === verdict).map((o) => o.categoryCorrect === true)),
    ]),
  ) as Record<Verdict, Rate>;
  return {
    n: outcomes.length,
    accuracy: rate(outcomes.map((o) => o.correct)),
    familyAccuracy: rate(outcomes.map((o) => o.familyCorrect)),
    categoryAccuracy: rate(food.map((o) => o.categoryCorrect === true)),
    inputKindAccuracy: rate(
      outcomes.flatMap((o) => (o.kind.correct === null ? [] : [o.kind.correct])),
    ),
    unleakedAccuracy: rate(outcomes.filter((o) => !o.leaked).map((o) => o.correct)),
    verdicts,
  };
}

export interface Confusion {
  readonly rows: readonly Label[];
  readonly cols: readonly Prediction[];
  readonly counts: ReadonlyMap<string, number>;
}

export const confusionKey = (expected: Label, predicted: Prediction): string =>
  `${expected}>${predicted}`;

export function confusion(outcomes: readonly ItemOutcome[]): Confusion {
  const counts = new Map<string, number>();
  for (const { expected, predicted } of outcomes) {
    const key = confusionKey(expected, predicted);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const rows = LABELS.filter((label) => outcomes.some((o) => o.expected === label));
  const cols = PREDICTIONS.filter((label) =>
    outcomes.some((o) => o.expected === label || o.predicted === label),
  );
  return { rows, cols, counts };
}

const shouldDecline = (o: ItemOutcome): boolean => o.expected === "declined";

export interface AbuseRates {
  readonly detected: Rate;
  readonly falseDeclines: Rate;
}

export function abuseRates(outcomes: readonly ItemOutcome[], threshold: number): AbuseRates {
  const declines = (o: ItemOutcome) => o.abusive >= threshold;
  return {
    detected: rate(outcomes.filter(shouldDecline).map(declines)),
    falseDeclines: rate(outcomes.filter((o) => !shouldDecline(o)).map(declines)),
  };
}

export interface AbuseBucket {
  readonly from: number;
  readonly to: number;
  readonly abusive: number;
  readonly rudeFoods: number;
  readonly other: number;
}

export function abuseBuckets(outcomes: readonly ItemOutcome[]): AbuseBucket[] {
  const edges = [0, ...ABUSE_BUCKETS, 1];
  return edges.slice(0, -1).map((from, index) => {
    const to = edges[index + 1] ?? 1;
    const inside = outcomes.filter((o) => o.abusive >= from && (o.abusive < to || to === 1));
    const rude = (o: ItemOutcome) => o.tags.includes("abuse_guard");
    return {
      from,
      to,
      abusive: inside.filter(shouldDecline).length,
      rudeFoods: inside.filter((o) => !shouldDecline(o) && rude(o)).length,
      other: inside.filter((o) => !shouldDecline(o) && !rude(o)).length,
    };
  });
}

export interface Extreme {
  readonly item: string;
  readonly probability: number;
}

export type PersonBars = Pick<ListingBars, "privatePerson" | "personSure">;

export interface PrivateGate extends PersonBars {
  readonly privateHidden: Rate;
  readonly othersHidden: Rate;
}

/** What the person gate hides at these bars. personSure 0 or privatePerson above 1 turns one off. */
export function privateGate(outcomes: readonly ItemOutcome[], bars: PersonBars): PrivateGate {
  const scored = outcomes.filter((o) => o.person.expected !== null);
  const hidden = ({ person: { probabilities: p } }: ItemOutcome) =>
    mayNamePrivatePerson(
      { personNone: p.none, personPublic: p.public, personPrivate: p.private, abusive: null },
      bars,
    );
  return {
    ...bars,
    privateHidden: rate(scored.filter((o) => o.person.expected === "private").map(hidden)),
    othersHidden: rate(scored.filter((o) => o.person.expected !== "private").map(hidden)),
  };
}

export interface PublicAbuseRow {
  readonly threshold: number;
  readonly rudeFoods: number;
  readonly other: number;
}

// The abusive bar is the last gate, and canon names skip it.
const reachesAbuseBar = (o: ItemOutcome): boolean =>
  !o.listing.canon && (o.listing.reason === "listed" || o.listing.reason === "abusive");

export function publicAbuseSweep(outcomes: readonly ItemOutcome[]): PublicAbuseRow[] {
  const open = outcomes.filter(reachesAbuseBar);
  return PUBLIC_ABUSE_SWEEP.map((threshold) => {
    const hidden = open.filter((o) => o.abusive >= threshold);
    const rude = hidden.filter((o) => o.tags.includes("abuse_guard")).length;
    return { threshold, rudeFoods: rude, other: hidden.length - rude };
  });
}

const extreme = (outcomes: readonly ItemOutcome[], pick: "min" | "max"): Extreme | null => {
  const sorted = [...outcomes].sort(
    (a, b) =>
      (pick === "min" ? 1 : -1) * (a.person.probabilities.private - b.person.probabilities.private),
  );
  const top = sorted[0];
  return top ? { item: top.item, probability: top.person.probabilities.private } : null;
};

export interface Summary {
  readonly questionSetVersion: string;
  readonly model: string;
  readonly fingerprint: string;
  readonly datasetSize: number;
  readonly scored: number;
  readonly missing: number;
  readonly headline: {
    readonly tuneN: number;
    readonly tuneAccuracy: number | null;
    readonly tuneFamilyAccuracy: number | null;
    readonly holdoutN: number;
    readonly holdoutAccuracy: number | null;
    readonly holdoutFamilyAccuracy: number | null;
    readonly canonN: number;
    readonly canonJevAgreement: number | null;
    readonly inputKindAccuracy: number | null;
    readonly personKindAccuracy: number | null;
    readonly abuseFalsePositives: number;
    readonly abuseDetection: number | null;
    readonly eyesAgreeRate: number | null;
    readonly eyesNullRate: number | null;
    readonly avgInputTokens: number | null;
    readonly p50LatencyMs: number | null;
    readonly p95LatencyMs: number | null;
    readonly runCostUsd: number;
  };
  readonly splits: Readonly<Record<Split | "all", SplitMetrics>>;
  readonly eyes: {
    readonly n: number;
    readonly nullRate: number | null;
    readonly agree: Rate;
    readonly accuracy: Rate;
  };
  readonly wet: Rate;
  readonly honorary: Rate;
  readonly abuse: {
    readonly threshold: number;
    readonly falsePositives: number;
    readonly maxProbability: number | null;
    readonly maxItem: string | null;
    readonly minAbusiveProbability: number | null;
    readonly minAbusiveItem: string | null;
    readonly bySplit: Readonly<Record<Split | "all", AbuseRates>>;
    readonly sweep: readonly (AbuseRates & { readonly threshold: number })[];
    readonly buckets: readonly AbuseBucket[];
  };
  readonly person: {
    readonly accuracy: Readonly<Record<Split | "all", Rate>>;
    readonly probes: Rate;
    readonly probesNotInPrompt: Rate;
    readonly gate: PrivateGate;
    readonly minPrivate: Extreme | null;
    readonly maxOther: Extreme | null;
    readonly sweep: readonly PrivateGate[];
    readonly sureSweep: readonly PrivateGate[];
  };
  readonly listing: {
    readonly abusiveThreshold: number;
    readonly reasons: Readonly<Record<PublicListingReason, number>>;
    readonly privateListed: number;
    readonly declinedListed: number;
    readonly hiddenByAbuse: readonly string[];
    readonly abusiveSweep: readonly PublicAbuseRow[];
  };
  readonly tokens: {
    readonly totalInput: number;
    readonly totalOutput: number;
    readonly avgInput: number | null;
    readonly avgOutput: number | null;
    readonly maxInput: number | null;
  };
  readonly latency: {
    readonly p50: number | null;
    readonly p95: number | null;
    readonly max: number | null;
    readonly retried: number;
  };
  readonly cost: {
    readonly pricePerMillionInputUsd: number;
    readonly perCallUsd: number | null;
    readonly runUsd: number;
  };
}

const round = (value: number | null, digits = 4): number | null =>
  value === null ? null : Number(value.toFixed(digits));

const average = (values: readonly number[]): number | null =>
  values.length === 0 ? null : values.reduce((sum, v) => sum + v, 0) / values.length;

export function summarize(
  outcomes: readonly ItemOutcome[],
  meta: {
    readonly questionSetVersion: string;
    readonly model: string;
    readonly fingerprint: string;
    readonly datasetSize: number;
  },
): Summary {
  const bySplit = (split: Split) => splitMetrics(outcomes.filter((o) => o.split === split));
  const splits = {
    canon: bySplit("canon"),
    tune: bySplit("tune"),
    holdout: bySplit("holdout"),
    all: splitMetrics(outcomes),
  };

  const eyed = outcomes.flatMap((o) => (o.eyes ? [o.eyes] : []));
  const seen = eyed.filter((e) => e.reading !== null);
  const eyes = {
    n: eyed.length,
    nullRate: round(eyed.length === 0 ? null : (eyed.length - seen.length) / eyed.length),
    agree: rate(seen.map((e) => e.agrees === true)),
    accuracy: rate(seen.map((e) => e.correct === true)),
  };

  const benign = outcomes.filter((o) => !shouldDecline(o));
  const worst = [...benign].sort((a, b) => b.abusive - a.abusive)[0];
  const weakest = [...outcomes.filter(shouldDecline)].sort((a, b) => a.abusive - b.abusive)[0];
  const falsePositives = benign.filter((o) => o.declined).length;
  const abuseBySplit = (split: Split) =>
    abuseRates(
      outcomes.filter((o) => o.split === split),
      THRESHOLDS.abusive,
    );
  const abuseAll = abuseRates(outcomes, THRESHOLDS.abusive);
  const inputs = outcomes.map((o) => o.inputTokens);
  const totalInput = inputs.reduce((sum, v) => sum + v, 0);
  const latencies = outcomes.map((o) => o.latencyMs);
  const runUsd = Number(((totalInput * PRICE_PER_MILLION_INPUT_USD) / 1e6).toFixed(6));
  const avgInput = average(inputs);

  const personScored = outcomes.filter((o) => o.person.correct !== null);
  const personRate = (list: readonly ItemOutcome[]) =>
    rate(list.flatMap((o) => (o.person.correct === null ? [] : [o.person.correct])));
  const personProbes = personScored.filter((o) => o.person.labelled);
  const listed = (o: ItemOutcome) => o.listing.reason === "listed";

  return {
    ...meta,
    scored: outcomes.length,
    missing: meta.datasetSize - outcomes.length,
    headline: {
      tuneN: splits.tune.n,
      tuneAccuracy: round(splits.tune.accuracy.rate),
      tuneFamilyAccuracy: round(splits.tune.familyAccuracy.rate),
      holdoutN: splits.holdout.n,
      holdoutAccuracy: round(splits.holdout.accuracy.rate),
      holdoutFamilyAccuracy: round(splits.holdout.familyAccuracy.rate),
      canonN: splits.canon.n,
      canonJevAgreement: round(splits.canon.accuracy.rate),
      inputKindAccuracy: round(splits.all.inputKindAccuracy.rate),
      personKindAccuracy: round(personRate(outcomes).rate),
      abuseFalsePositives: falsePositives,
      abuseDetection: round(abuseAll.detected.rate),
      eyesAgreeRate: round(eyes.agree.rate),
      eyesNullRate: eyes.nullRate,
      avgInputTokens: round(avgInput, 0),
      p50LatencyMs: percentile(latencies, 0.5),
      p95LatencyMs: percentile(latencies, 0.95),
      runCostUsd: runUsd,
    },
    splits,
    eyes,
    wet: rate(outcomes.flatMap((o) => (o.wet ? [o.wet.jev === o.wet.expected] : []))),
    honorary: rate(
      outcomes.flatMap((o) =>
        o.honorary?.expected ? [o.honorary.jev === o.honorary.expected] : [],
      ),
    ),
    abuse: {
      threshold: THRESHOLDS.abusive,
      falsePositives,
      maxProbability: round(worst?.abusive ?? null),
      maxItem: worst?.item ?? null,
      minAbusiveProbability: round(weakest?.abusive ?? null),
      minAbusiveItem: weakest?.item ?? null,
      bySplit: {
        canon: abuseBySplit("canon"),
        tune: abuseBySplit("tune"),
        holdout: abuseBySplit("holdout"),
        all: abuseAll,
      },
      sweep: ABUSE_SWEEP.map((threshold) => ({
        threshold,
        ...abuseRates(
          outcomes.filter((o) => o.split === "tune"),
          threshold,
        ),
      })),
      buckets: abuseBuckets(outcomes),
    },
    person: {
      accuracy: {
        canon: personRate(outcomes.filter((o) => o.split === "canon")),
        tune: personRate(outcomes.filter((o) => o.split === "tune")),
        holdout: personRate(outcomes.filter((o) => o.split === "holdout")),
        all: personRate(outcomes),
      },
      probes: personRate(personProbes),
      probesNotInPrompt: personRate(personProbes.filter((o) => !o.person.leaked)),
      gate: privateGate(outcomes, {
        privatePerson: THRESHOLDS.publicPrivatePerson,
        personSure: THRESHOLDS.publicPersonSure,
      }),
      minPrivate: extreme(
        personScored.filter((o) => o.person.expected === "private"),
        "min",
      ),
      maxOther: extreme(
        personScored.filter((o) => o.person.expected !== "private"),
        "max",
      ),
      sweep: PERSON_SWEEP.map((privatePerson) =>
        privateGate(
          outcomes.filter((o) => o.split === "tune"),
          { privatePerson, personSure: 0 },
        ),
      ),
      sureSweep: PERSON_SURE_SWEEP.map((personSure) =>
        privateGate(
          outcomes.filter((o) => o.split === "tune"),
          { privatePerson: Number.POSITIVE_INFINITY, personSure },
        ),
      ),
    },
    listing: {
      abusiveThreshold: THRESHOLDS.publicAbusive,
      reasons: Object.fromEntries(
        LISTING_REASONS.map((reason) => [
          reason,
          outcomes.filter((o) => o.listing.reason === reason).length,
        ]),
      ) as Record<PublicListingReason, number>,
      privateListed: outcomes.filter((o) => listed(o) && o.person.expected === "private").length,
      declinedListed: outcomes.filter((o) => listed(o) && shouldDecline(o)).length,
      hiddenByAbuse: outcomes.filter((o) => o.listing.reason === "abusive").map((o) => o.item),
      abusiveSweep: publicAbuseSweep(outcomes),
    },
    tokens: {
      totalInput,
      totalOutput: outcomes.reduce((sum, o) => sum + o.outputTokens, 0),
      avgInput: round(avgInput, 0),
      avgOutput: round(average(outcomes.map((o) => o.outputTokens)), 0),
      maxInput: inputs.length === 0 ? null : Math.max(...inputs),
    },
    latency: {
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      max: latencies.length === 0 ? null : Math.max(...latencies),
      retried: outcomes.filter((o) => o.attempts > 1).length,
    },
    cost: {
      pricePerMillionInputUsd: PRICE_PER_MILLION_INPUT_USD,
      perCallUsd:
        avgInput === null ? null : round((avgInput * PRICE_PER_MILLION_INPUT_USD) / 1e6, 8),
      runUsd,
    },
  };
}
