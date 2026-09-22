import { createHash } from "node:crypto";
import { buildCubeRequest, type CubeAnswers } from "@cube/core";

export interface RawRecord {
  readonly item: string;
  readonly version: string;
  readonly fingerprint: string;
  readonly model: string;
  readonly answers: CubeAnswers;
  readonly usage: { readonly input_tokens: number; readonly output_tokens: number };
  readonly latencyMs: number;
  readonly attempts: number;
  readonly requestId: string | null;
  readonly fetchedAt: string;
}

export function requestFingerprint(): string {
  return createHash("sha256")
    .update(JSON.stringify(buildCubeRequest("x")))
    .digest("hex");
}

export function resultsDir(version: string): URL {
  return new URL(`../results/v${version}/`, import.meta.url);
}

function isRawRecord(value: unknown): value is RawRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.item === "string" &&
    typeof record.version === "string" &&
    typeof record.fingerprint === "string" &&
    typeof record.answers === "object" &&
    record.answers !== null &&
    typeof record.usage === "object" &&
    typeof record.latencyMs === "number"
  );
}

// Later lines win, so an interrupted --fresh run still leaves the newest answer for each item.
export function parseRaw(text: string): Map<string, RawRecord> {
  const records = new Map<string, RawRecord>();
  text.split("\n").forEach((line, index) => {
    if (line.trim() === "") return;
    const value: unknown = JSON.parse(line);
    if (!isRawRecord(value)) throw new Error(`raw.jsonl line ${index + 1} is not a raw record`);
    records.set(value.item, value);
  });
  return records;
}

export function serializeRaw(records: Iterable<RawRecord>): string {
  const sorted = [...records].sort((a, b) => (a.item < b.item ? -1 : a.item > b.item ? 1 : 0));
  return sorted.map((record) => `${JSON.stringify(record)}\n`).join("");
}
