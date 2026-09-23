import { readdirSync, readFileSync } from "node:fs";
import type { Plugin } from "vite";
import type { EvalStats, Tally } from "../src/lib/evalStats.ts";

export const EVAL_STATS_ID = "virtual:eval-stats";
const RESOLVED_ID = `\0${EVAL_STATS_ID}`;
const CORE_QUESTIONS = new URL("../../../packages/core/src/questions.ts", import.meta.url);
const RESULTS = new URL("../../../eval/results/", import.meta.url);

// Read as text: importing @cube/core here would pull its extensionless imports into the config.
export function coreConstant(name: "QUESTION_SET_VERSION" | "CUBE_MODEL"): string {
  const source = readFileSync(CORE_QUESTIONS, "utf8");
  const value = new RegExp(`^export const ${name} = "([^"]+)";$`, "m").exec(source)?.[1];
  if (!value) throw new Error(`Could not read ${name} from ${CORE_QUESTIONS.pathname}`);
  return value;
}

export function summaryPath(version: string = coreConstant("QUESTION_SET_VERSION")): URL {
  return new URL(`v${version}/summary.json`, RESULTS);
}

function at(summary: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (node, key) =>
        node && typeof node === "object" ? (node as Record<string, unknown>)[key] : undefined,
      summary,
    );
}

function holdoutChecks(upTo: string): number {
  return readdirSync(RESULTS).filter((name) => {
    const version = /^v(\d+)$/.exec(name)?.[1];
    if (!version || Number(version) > Number(upTo)) return false;
    try {
      const n = at(
        JSON.parse(readFileSync(summaryPath(version), "utf8")),
        "splits.holdout.accuracy.n",
      );
      return typeof n === "number" && n > 0;
    } catch {
      return false;
    }
  }).length;
}

// Picks named numbers only: summary.json also names eval items, abusive probes included.
export function readEvalStats(version: string = coreConstant("QUESTION_SET_VERSION")): EvalStats {
  const file = summaryPath(version);
  let summary: unknown;
  try {
    summary = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(
      `No eval summary for question set ${version} at ${file.pathname}. Run \`pnpm eval\` first.`,
      { cause: error },
    );
  }
  const num = (path: string): number => {
    const value = at(summary, path);
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`${file.pathname} has no number at ${path}`);
    }
    return value;
  };
  const tally = (path: string): Tally => ({ hits: num(`${path}.hits`), n: num(`${path}.n`) });
  const str = (path: string): string => {
    const value = at(summary, path);
    if (typeof value !== "string") throw new Error(`${file.pathname} has no string at ${path}`);
    return value;
  };

  const stats: EvalStats = {
    questionSetVersion: str("questionSetVersion"),
    model: str("model"),
    items: num("scored"),
    holdout: {
      all: tally("splits.holdout.accuracy"),
      notInPrompt: tally("splits.holdout.unleakedAccuracy"),
      sure: tally("splits.holdout.verdicts.unanimous"),
    },
    holdoutChecks: holdoutChecks(version),
    tune: tally("splits.tune.accuracy"),
    canon: {
      all: tally("splits.canon.accuracy"),
      notInPrompt: tally("splits.canon.unleakedAccuracy"),
    },
    inputKind: tally("splits.all.inputKindAccuracy"),
    abuse: {
      declined: tally("abuse.bySplit.all.detected"),
      falseDeclines: tally("abuse.bySplit.all.falseDeclines"),
    },
    tokens: { avgInput: num("tokens.avgInput"), avgOutput: num("tokens.avgOutput") },
    latency: { p50Ms: num("latency.p50"), p95Ms: num("latency.p95") },
    cost: {
      perRulingUsd: num("cost.perCallUsd"),
      runUsd: num("cost.runUsd"),
      pricePerMillionInputUsd: num("cost.pricePerMillionInputUsd"),
    },
  };
  if (stats.questionSetVersion !== version) {
    throw new Error(`${file.pathname} is for question set ${stats.questionSetVersion}`);
  }
  const model = coreConstant("CUBE_MODEL");
  if (stats.model !== model) {
    throw new Error(`${file.pathname} scored ${stats.model}, but the app asks ${model}`);
  }
  if (num("missing") !== 0) {
    throw new Error(`${file.pathname} is missing items. Finish \`pnpm eval\` first.`);
  }
  return stats;
}

export function evalStats(): Plugin {
  return {
    name: "cube:eval-stats",
    resolveId(id) {
      return id === EVAL_STATS_ID ? RESOLVED_ID : undefined;
    },
    load(id) {
      if (id !== RESOLVED_ID) return undefined;
      this.addWatchFile(summaryPath().pathname);
      return `export default ${JSON.stringify(readEvalStats())};`;
    },
  };
}
