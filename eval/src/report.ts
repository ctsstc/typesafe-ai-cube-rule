import { THRESHOLDS } from "@cube/core";
import type { Split } from "./dataset";
import {
  type Confusion,
  confusion,
  confusionKey,
  type ItemOutcome,
  type Rate,
  type Summary,
  VERDICTS,
} from "./score";

const cell = (text: string): string => text.replace(/\|/g, "\\|").replace(/\n/g, " ");
const row = (cells: readonly string[]): string => `| ${cells.map(cell).join(" | ")} |`;
const table = (head: readonly string[], rows: readonly (readonly string[])[]): string =>
  [row(head), row(head.map(() => "---")), ...rows.map(row)].join("\n");

const p2 = (value: number): string => value.toFixed(2);

export function pct(r: Rate): string {
  return r.rate === null ? "n/a" : `${(r.rate * 100).toFixed(1)}% (${r.hits}/${r.n})`;
}

export function predictionProbability(o: ItemOutcome): number {
  if (o.predicted === "declined") return o.abusive;
  if (o.predicted === "not_food" || o.predicted === "nonsense") {
    return o.kind.probabilities[o.predicted];
  }
  return o.ruling.top.find((odds) => odds.id === o.predicted)?.probability ?? 0;
}

const topThree = (o: ItemOutcome): string =>
  o.ruling.top.map((odds) => `${odds.id} ${p2(odds.probability)}`).join(", ");

const expectedText = (o: ItemOutcome): string =>
  o.accepted.length > 1 ? `${o.expected} (or ${o.accepted.slice(1).join(", ")})` : o.expected;

export function describeFailure(o: ItemOutcome): string {
  return `${o.item}: expected ${o.expected}, Jev ${o.predicted} (p=${p2(predictionProbability(o))})`;
}

function renderConfusion({ rows, cols, counts }: Confusion): string {
  return table(
    ["expected \\ Jev", ...cols],
    rows.map((expected) => [
      expected,
      ...cols.map((predicted) => {
        const count = counts.get(confusionKey(expected, predicted)) ?? 0;
        if (count === 0) return "";
        return expected === predicted ? `**${count}**` : String(count);
      }),
    ]),
  );
}

function renderFailures(outcomes: readonly ItemOutcome[]): string {
  const failures = outcomes.filter((o) => !o.correct);
  if (failures.length === 0) return "None.";
  return table(
    ["Item", "Expected", "Jev", "p", "Confidence", "Top 3 categories", "Input kind", "Note"],
    failures.map((o) => [
      o.leaked ? `${o.item} (in prompt)` : o.item,
      expectedText(o),
      o.predicted,
      p2(predictionProbability(o)),
      `${p2(o.ruling.confidence)} ${o.ruling.verdict}`,
      topThree(o),
      o.kind.correct !== false
        ? o.kind.jev
        : `${o.kind.jev} (food ${p2(o.kind.probabilities.food)}, not_food ${p2(o.kind.probabilities.not_food)}, nonsense ${p2(o.kind.probabilities.nonsense)})`,
      o.note,
    ]),
  );
}

function renderSplitTable(summary: Summary): string {
  const names: readonly (Split | "all")[] = ["tune", "holdout", "canon", "all"];
  return table(
    ["Split", "Items", "Accuracy", "Family", "Category only", "Input kind", "Not in prompt"],
    names.map((name) => {
      const m = summary.splits[name];
      return [
        name,
        String(m.n),
        pct(m.accuracy),
        pct(m.familyAccuracy),
        pct(m.categoryAccuracy),
        pct(m.inputKindAccuracy),
        pct(m.unleakedAccuracy),
      ];
    }),
  );
}

function renderVerdicts(summary: Summary): string {
  const bands = {
    unanimous: `>= ${THRESHOLDS.unanimous}`,
    majority: `${THRESHOLDS.majority} to ${THRESHOLDS.unanimous}`,
    split: `< ${THRESHOLDS.majority}`,
  };
  return table(
    ["Verdict", "Confidence", "Tune", "Canon"],
    VERDICTS.map((verdict) => [
      verdict,
      bands[verdict],
      pct(summary.splits.tune.verdicts[verdict]),
      pct(summary.splits.canon.verdicts[verdict]),
    ]),
  );
}

function renderProbes(outcomes: readonly ItemOutcome[]): string {
  const probes = outcomes.filter((o) => o.source === "probe" || o.tags.length > 0);
  return table(
    ["Item", "Split", "Tags", "Expected", "Jev", "p", "is_abusive", "OK"],
    probes.map((o) => [
      o.item,
      o.split,
      o.tags.join(", "),
      expectedText(o),
      o.predicted,
      p2(predictionProbability(o)),
      p2(o.abusive),
      o.correct ? "yes" : "**no**",
    ]),
  );
}

function renderAbuse(summary: Summary): string {
  const { abuse } = summary;
  const splits: readonly (Split | "all")[] = ["tune", "holdout", "canon", "all"];
  const range = (from: number, to: number) => (to === 1 ? `${from} to 1` : `${from} to < ${to}`);
  return [
    `Abusive probes are stored base64-encoded and listed here by their encoded form. A probe counts as detected when \`is_abusive\` >= ${abuse.threshold}. A false decline is any other item at or above it.`,
    table(
      ["Split", "Detected", "False declines"],
      splits.map((name) => [
        name,
        pct(abuse.bySplit[name].detected),
        pct(abuse.bySplit[name].falseDeclines),
      ]),
    ),
    `Lowest on an abusive probe: ${abuse.minAbusiveItem ?? "n/a"} (${abuse.minAbusiveProbability ?? "n/a"}). Highest on an item that should get a ruling: ${abuse.maxItem ?? "n/a"} (${abuse.maxProbability ?? "n/a"}).`,
    "Threshold sweep on the tune split:",
    table(
      ["Threshold", "Detected", "False declines"],
      abuse.sweep.map((row) => [String(row.threshold), pct(row.detected), pct(row.falseDeclines)]),
    ),
    "`is_abusive` distribution over every split. Rude-sounding foods are the `abuse_guard` items:",
    table(
      ["is_abusive", "Abusive probes", "Rude-sounding foods", "Everything else"],
      abuse.buckets.map((b) => [
        range(b.from, b.to),
        String(b.abusive),
        String(b.rudeFoods),
        String(b.other),
      ]),
    ),
  ].join("\n\n");
}

function renderPublicListing(summary: Summary, outcomes: readonly ItemOutcome[]): string {
  const { person, listing } = summary;
  const splits: readonly (Split | "all")[] = ["tune", "holdout", "canon", "all"];
  const extreme = (e: { item: string; probability: number } | null) =>
    e ? `${e.item} (${p2(e.probability)})` : "n/a";
  const shown = outcomes.filter(
    (o) => o.person.labelled || (o.person.expected !== null && o.person.correct === false),
  );
  return [
    `\`person_kind\` is scored on every item except abusive probes. Items without a person label name no specific person. A public list hides an item when p(private) >= ${person.gate.threshold} or \`is_abusive\` >= ${listing.abusiveThreshold} (canon names skip the abusive bar), and never lists a declined or nonsense ruling.`,
    table(
      ["Split", "Person kind"],
      splits.map((name) => [name, pct(person.accuracy[name])]),
    ),
    [
      `- **Person probes:** ${pct(person.probes)}, not in prompt ${pct(person.probesNotInPrompt)}.`,
      `- **Private gate:** hides ${pct(person.gate.privateHidden)} of private people and ${pct(person.gate.othersHidden)} of everything else. Lowest p(private) on a private person: ${extreme(person.minPrivate)}. Highest on anything else: ${extreme(person.maxOther)}.`,
      `- **Leaks:** ${listing.privateListed} private people and ${listing.declinedListed} abusive probes would be listed.`,
      `- **Hidden by the abusive bar:** ${listing.hiddenByAbuse.length === 0 ? "none" : listing.hiddenByAbuse.join(", ")}.`,
    ].join("\n"),
    "Private gate sweep on the tune split:",
    table(
      ["p(private) >=", "Private people hidden", "Others hidden"],
      person.sweep.map((row) => [
        String(row.threshold),
        pct(row.privateHidden),
        pct(row.othersHidden),
      ]),
    ),
    "Public abusive bar sweep over every split. Counts the items that reach it: not canon, and not hidden by an earlier gate:",
    table(
      ["is_abusive >=", "Rude-sounding foods hidden", "Others hidden"],
      listing.abusiveSweep.map((row) => [
        String(row.threshold),
        String(row.rudeFoods),
        String(row.other),
      ]),
    ),
    "Why each item would or would not be listed:",
    table(
      ["Reason", "Items"],
      Object.entries(listing.reasons).map(([reason, n]) => [reason, String(n)]),
    ),
    "Person probes, and every other item where Jev read a person that is not there:",
    table(
      ["Item", "Split", "Expected", "Jev", "none", "public", "private", "Listing", "OK"],
      shown.map((o) => [
        o.person.leaked ? `${o.item} (in prompt)` : o.item,
        o.split,
        o.person.expected ?? "",
        o.person.jev,
        p2(o.person.probabilities.none),
        p2(o.person.probabilities.public),
        p2(o.person.probabilities.private),
        o.listing.reason,
        o.person.correct ? "yes" : "**no**",
      ]),
    ),
  ].join("\n\n");
}

function renderHonorary(outcomes: readonly ItemOutcome[]): string {
  const rows = outcomes.flatMap((o) =>
    o.honorary
      ? [
          [
            o.item,
            o.honorary.expected ?? "",
            o.honorary.jev,
            p2(o.honorary.confidence),
            o.honorary.expected === null
              ? ""
              : o.honorary.expected === o.honorary.jev
                ? "yes"
                : "no",
          ],
        ]
      : [],
  );
  return table(["Item", "Expected honorary", "Jev", "Confidence", "Match"], rows);
}

function renderAllItems(outcomes: readonly ItemOutcome[]): string {
  return table(
    ["Item", "Split", "Expected", "Jev", "p", "Verdict", "Eyes", "Tokens", "ms", "OK"],
    outcomes.map((o) => [
      o.item,
      o.split,
      expectedText(o),
      o.predicted,
      p2(predictionProbability(o)),
      o.ruling.verdict,
      o.eyes ? (o.eyes.reading ?? "null") : "",
      String(o.inputTokens),
      String(o.latencyMs),
      o.correct ? "yes" : "**no**",
    ]),
  );
}

export function renderReport(
  summary: Summary,
  outcomes: readonly ItemOutcome[],
  fetched: { readonly first: string | null; readonly last: string | null },
): string {
  const inSplit = (split: Split) => outcomes.filter((o) => o.split === split);
  const { eyes, abuse, tokens, latency, cost } = summary;
  const window =
    fetched.first && fetched.last ? `Answers fetched ${fetched.first} to ${fetched.last}.` : "";

  return `${[
    `# Eval report: question set v${summary.questionSetVersion}`,
    [
      `Model \`${summary.model}\`, request fingerprint \`${summary.fingerprint.slice(0, 12)}\`.`,
      `${summary.scored} of ${summary.datasetSize} items scored${summary.missing > 0 ? `, **${summary.missing} missing**` : ""}.`,
      window,
    ]
      .filter(Boolean)
      .join(" "),
    "Every number scores Jev's own ruling. The official cuberule.com override is not applied, so canon measures how often Jev agrees with the site. See `docs/eval.md` for how to read this report.",
    "## Headline",
    renderSplitTable(summary),
    [
      `- **Canon agreement:** ${pct(summary.splits.canon.accuracy)}`,
      `- **Person kind:** ${pct(summary.person.accuracy.all)}, with ${summary.listing.privateListed} private people listed.`,
      `- **Abuse guard:** detected ${pct(abuse.bySplit.all.detected)} of abusive probes at is_abusive >= ${abuse.threshold}, with ${abuse.falsePositives} false declines. Highest on an item that should get a ruling: ${abuse.maxItem ?? "n/a"} (${abuse.maxProbability ?? "n/a"}).`,
      `- **Jev's eyes** (food items): null on ${eyes.nullRate === null ? "n/a" : `${(eyes.nullRate * 100).toFixed(1)}%`} of ${eyes.n}. When not null, they agree with Jev's ruling ${pct(eyes.agree)} and match the label ${pct(eyes.accuracy)}.`,
      `- **Wet flag** (labelled items): ${pct(summary.wet)}`,
      `- **Honorary category** (labelled not-food items): ${pct(summary.honorary)}`,
      `- **Tokens:** ${tokens.avgInput ?? "n/a"} input and ${tokens.avgOutput ?? "n/a"} output per call on average, ${tokens.maxInput ?? "n/a"} input at most.`,
      `- **Latency:** p50 ${latency.p50 ?? "n/a"} ms, p95 ${latency.p95 ?? "n/a"} ms, max ${latency.max ?? "n/a"} ms. ${latency.retried} calls needed a retry.`,
      `- **Cost:** $${cost.perCallUsd ?? "n/a"} per call, $${cost.runUsd} for one pass over the set at $${cost.pricePerMillionInputUsd} per million input tokens.`,
    ].join("\n"),
    "## Confidence bands",
    "Category accuracy on food items, grouped by the verdict the current thresholds would print. Use it to place `THRESHOLDS.unanimous` and `THRESHOLDS.majority`.",
    renderVerdicts(summary),
    "## Confusion matrix: tune",
    "Rows are the primary label, columns are Jev's ruling after the abuse and input-kind gates. An accepted alternative counts as correct but sits off the diagonal.",
    renderConfusion(confusion(inSplit("tune"))),
    "## Confusion matrix: canon",
    renderConfusion(confusion(inSplit("canon"))),
    "## Abuse guard",
    renderAbuse(summary),
    "## Public listing",
    renderPublicListing(summary, outcomes),
    "## Probes",
    "Name-bias, abuse-guard, abusive, reading, not-food and nonsense probes from every split.",
    renderProbes(outcomes),
    "## Honorary rulings",
    renderHonorary(outcomes),
    "## Failures: tune",
    renderFailures(inSplit("tune")),
    "## Failures: canon",
    'Each of these renders as "Jev dissents" in the app, because the official ruling wins.',
    renderFailures(inSplit("canon")),
    "## Holdout",
    `Headline only while tuning: ${pct(summary.splits.holdout.accuracy)}, family ${pct(summary.splits.holdout.familyAccuracy)}. Open the details only to check a finished candidate.`,
    [
      "<details>",
      "<summary>Holdout confusion matrix and failures</summary>",
      "",
      renderConfusion(confusion(inSplit("holdout"))),
      "",
      renderFailures(inSplit("holdout")),
      "",
      "</details>",
    ].join("\n"),
    "## Every item",
    [
      "<details>",
      "<summary>All scored items</summary>",
      "",
      renderAllItems(outcomes),
      "",
      "</details>",
    ].join("\n"),
  ].join("\n\n")}\n`;
}
