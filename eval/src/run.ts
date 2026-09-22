import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildCubeRequest, CUBE_MODEL, QUESTION_SET_VERSION } from "@cube/core";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { parseRaw, type RawRecord, requestFingerprint, resultsDir, serializeRaw } from "./cache";
import { type LabelledItem, loadDataset } from "./dataset";
import { describeFailure, renderReport } from "./report";
import { scoreItem, summarize } from "./score";

const CONCURRENCY = 4;
const FLAGS = ["--fresh", "--offline"] as const;
type Flag = (typeof FLAGS)[number];

function parseFlags(argv: readonly string[]): ReadonlySet<Flag> {
  const flags = new Set<Flag>();
  for (const arg of argv) {
    if (arg === "--") continue;
    if (!(FLAGS as readonly string[]).includes(arg)) {
      throw new Error(`Unknown argument ${arg}. Accepted: ${FLAGS.join(", ")}`);
    }
    flags.add(arg as Flag);
  }
  if (flags.has("--fresh") && flags.has("--offline")) {
    throw new Error("--fresh refetches everything, so it cannot run --offline");
  }
  return flags;
}

async function eachWithLimit<T>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const worker = async () => {
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) await work(next);
  };
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, worker));
}

async function fetchRecord(item: string, fingerprint: string): Promise<RawRecord> {
  let attempts = 0;
  const client = new TypeSafeClient({
    fetch: (input, init) => {
      attempts += 1;
      return fetch(input, init);
    },
  });
  const started = performance.now();
  const { data, requestId } = await client.systemOne(buildCubeRequest(item)).withResponse();
  return {
    item,
    version: QUESTION_SET_VERSION,
    fingerprint,
    model: data.model,
    answers: data.answers,
    usage: { input_tokens: data.usage.input_tokens, output_tokens: data.usage.output_tokens },
    latencyMs: Math.round(performance.now() - started),
    attempts,
    requestId: requestId ?? null,
    fetchedAt: new Date().toISOString(),
  };
}

function errorSummary(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const status = "status" in error ? ` ${String(error.status)}` : "";
  return `${error.name}${status}: ${error.message}`;
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const items = loadDataset();
  const fingerprint = requestFingerprint();
  const dir = resultsDir(QUESTION_SET_VERSION);
  const rawPath = new URL("raw.jsonl", dir);
  mkdirSync(dir, { recursive: true });

  const cache = existsSync(rawPath)
    ? parseRaw(readFileSync(rawPath, "utf8"))
    : new Map<string, RawRecord>();
  const stale = [...cache.values()].filter(
    (r) => r.fingerprint !== fingerprint || r.version !== QUESTION_SET_VERSION,
  );
  if (stale.length > 0 && !flags.has("--fresh")) {
    throw new Error(
      `${stale.length} cached answers in ${fileURLToPath(dir)} came from a different request. The questions or model changed without a QUESTION_SET_VERSION bump. Bump the version, or rerun with --fresh to replace them.`,
    );
  }
  for (const record of stale) cache.delete(record.item);

  const todo: LabelledItem[] = flags.has("--fresh")
    ? items
    : items.filter((item) => !cache.has(item.item));
  const errors: string[] = [];

  if (todo.length > 0 && flags.has("--offline")) {
    console.log(
      `Offline: ${todo.length} items have no cached answer and will be reported missing.`,
    );
  } else if (todo.length > 0) {
    if (!process.env.TYPESAFE_API_KEY?.trim()) {
      throw new Error(
        `${todo.length} items need a live call but TYPESAFE_API_KEY is not set. Add it to the root .env, or run with --offline to score the cache.`,
      );
    }
    console.log(
      `Fetching ${todo.length} of ${items.length} items from ${CUBE_MODEL} (question set v${QUESTION_SET_VERSION}), ${CONCURRENCY} at a time.`,
    );
    let done = 0;
    await eachWithLimit(todo, CONCURRENCY, async ({ item }) => {
      try {
        const record = await fetchRecord(item, fingerprint);
        cache.set(item, record);
        appendFileSync(rawPath, serializeRaw([record]));
        done += 1;
        console.log(
          `[${done}/${todo.length}] ${item}: ${record.latencyMs} ms, ${record.usage.input_tokens} input tokens`,
        );
      } catch (error) {
        errors.push(`${item}: ${errorSummary(error)}`);
        console.error(`FAILED ${item}: ${errorSummary(error)}`);
      }
    });
  } else {
    console.log(`All ${items.length} items are cached for question set v${QUESTION_SET_VERSION}.`);
  }

  writeFileSync(rawPath, serializeRaw(cache.values()));

  const scored = items.flatMap((item) => {
    const record = cache.get(item.item);
    return record ? [{ record, outcome: scoreItem(item, record) }] : [];
  });
  const outcomes = scored.map((s) => s.outcome);
  const models = [...new Set(scored.map((s) => s.record.model))];
  const summary = summarize(outcomes, {
    questionSetVersion: QUESTION_SET_VERSION,
    model: models.length > 0 ? models.join(", ") : CUBE_MODEL,
    fingerprint,
    datasetSize: items.length,
  });
  const fetchedAt = scored.map((s) => s.record.fetchedAt).sort();
  const second = (iso: string | undefined) => (iso ? `${iso.slice(0, 19)}Z` : null);
  const report = renderReport(summary, outcomes, {
    first: second(fetchedAt[0]),
    last: second(fetchedAt.at(-1)),
  });

  writeFileSync(new URL("summary.json", dir), `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(new URL("report.md", dir), report);

  const h = summary.headline;
  console.log(
    [
      "",
      `Tune ${h.tuneAccuracy} (n=${h.tuneN}), holdout ${h.holdoutAccuracy} (n=${h.holdoutN}), canon agreement ${h.canonJevAgreement} (n=${h.canonN})`,
      `Input kind ${h.inputKindAccuracy}, abuse false positives ${h.abuseFalsePositives}, eyes agree ${h.eyesAgreeRate}, eyes null ${h.eyesNullRate}`,
      `Avg input tokens ${h.avgInputTokens}, p50 ${h.p50LatencyMs} ms, p95 ${h.p95LatencyMs} ms, one pass $${h.runCostUsd}`,
      "",
      "Tune failures:",
      ...outcomes
        .filter((o) => o.split === "tune" && !o.correct)
        .map((o) => `  ${describeFailure(o)}`),
      "",
      `Wrote ${fileURLToPath(new URL("report.md", dir))}`,
    ].join("\n"),
  );

  if (errors.length > 0 || summary.missing > 0) {
    console.error(
      `${errors.length} fetch errors, ${summary.missing} items missing from the report.`,
    );
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
