export interface Tally {
  readonly hits: number;
  readonly n: number;
}

export interface EvalStats {
  readonly questionSetVersion: string;
  readonly model: string;
  readonly items: number;
  readonly holdout: { readonly all: Tally; readonly notInPrompt: Tally; readonly sure: Tally };
  readonly holdoutChecks: number;
  readonly tune: Tally;
  readonly canon: { readonly all: Tally; readonly notInPrompt: Tally };
  readonly inputKind: Tally;
  readonly abuse: { readonly declined: Tally; readonly falseDeclines: Tally };
  readonly tokens: { readonly avgInput: number; readonly avgOutput: number };
  readonly latency: { readonly p50Ms: number; readonly p95Ms: number };
  readonly cost: {
    readonly perRulingUsd: number;
    readonly runUsd: number;
    readonly pricePerMillionInputUsd: number;
  };
}

const count = new Intl.NumberFormat("en-US");

export function formatCount(value: number): string {
  return count.format(Math.round(value));
}

export function formatRate({ hits, n }: Tally): string {
  if (n === 0) return "n/a";
  const pct = (hits / n) * 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(1)}%`;
}

export function formatTally(tally: Tally): string {
  return `${tally.hits} of ${tally.n}`;
}

export function formatUsd(value: number): string {
  if (value >= 0.01) return `$${value.toFixed(3).replace(/0$/, "")}`;
  return `$${value.toPrecision(3)}`;
}

export function rulingsPerDollar(stats: EvalStats): number {
  return Math.round(1 / stats.cost.perRulingUsd / 10) * 10;
}

export function onePointOf({ n }: Tally): string {
  return `${(100 / n).toFixed(1)} points`;
}
