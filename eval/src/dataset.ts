import { readFileSync } from "node:fs";
import {
  buildCubeQuestions,
  CATEGORY_IDS,
  type CategoryId,
  normalizeItem,
  precheckItem,
} from "@cube/core";

export const LABELS = [...CATEGORY_IDS, "not_food", "nonsense"] as const;
export type Label = (typeof LABELS)[number];

export const SOURCES = ["cuberule", "consensus", "probe"] as const;
export type Source = (typeof SOURCES)[number];

export const TAGS = ["name_bias", "abuse_guard", "reading", "rice", "injection"] as const;
export type Tag = (typeof TAGS)[number];

export const SPLITS = ["canon", "tune", "holdout"] as const;
export type Split = (typeof SPLITS)[number];

export const TUNE_PERCENT = 60;
export const DATASET_PATH = new URL("../data/foods.json", import.meta.url);

export interface EvalItem {
  readonly item: string;
  readonly expected: Label;
  readonly accept?: readonly CategoryId[];
  readonly source: Source;
  readonly note: string;
  readonly tags?: readonly Tag[];
  readonly wet?: boolean;
  readonly honorary?: CategoryId;
}

export interface LabelledItem extends EvalItem {
  readonly split: Split;
  readonly inPrompt: readonly string[];
}

const isOneOf = <T extends string>(values: readonly T[], value: unknown): value is T =>
  typeof value === "string" && (values as readonly string[]).includes(value);

export const isCategoryId = (value: unknown): value is CategoryId => isOneOf(CATEGORY_IDS, value);

export function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(text)) hash = Math.imul(hash ^ byte, 0x01000193);
  return hash >>> 0;
}

export function splitOf({ item, source }: Pick<EvalItem, "item" | "source">): Split {
  if (source === "cuberule") return "canon";
  return fnv1a(item) % 100 < TUNE_PERCENT ? "tune" : "holdout";
}

export function exampleKey(text: string): string {
  return normalizeItem(text)
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/^(a|an|the) /, "")
    .trim();
}

export function promptExamples(
  questions: Record<string, unknown> = buildCubeQuestions(),
): ReadonlyMap<string, readonly string[]> {
  const found = new Map<string, string[]>();
  const visit = (id: string, node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) visit(id, child);
      return;
    }
    if (typeof node !== "object" || node === null) return;
    for (const [key, value] of Object.entries(node)) {
      if (key === "examples" && Array.isArray(value)) {
        for (const example of value) {
          if (typeof example !== "string") continue;
          const ids = found.get(exampleKey(example)) ?? [];
          if (!ids.includes(id)) ids.push(id);
          found.set(exampleKey(example), ids);
        }
      } else {
        visit(id, value);
      }
    }
  };
  for (const [id, question] of Object.entries(questions)) visit(id, question);
  return found;
}

function fail(index: number, message: string): never {
  throw new Error(`foods.json item ${index}: ${message}`);
}

function parseItem(raw: unknown, index: number): EvalItem {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) fail(index, "not an object");
  const known = new Set([
    "item",
    "expected",
    "accept",
    "source",
    "note",
    "tags",
    "wet",
    "honorary",
  ]);
  const extra = Object.keys(raw).filter((key) => !known.has(key));
  if (extra.length > 0) fail(index, `unknown fields ${extra.join(", ")}`);
  const { item, expected, accept, source, note, tags, wet, honorary } = raw as Record<
    string,
    unknown
  >;

  if (typeof item !== "string" || item.length === 0) fail(index, "item must be a string");
  if (item !== normalizeItem(item)) fail(index, `"${item}" is not normalized`);
  if (precheckItem(item)) fail(index, `"${item}" never reaches Jev (precheck)`);
  if (!isOneOf(LABELS, expected)) fail(index, `bad expected ${String(expected)}`);
  if (!isOneOf(SOURCES, source)) fail(index, `bad source ${String(source)}`);
  if (typeof note !== "string" || note.length === 0) fail(index, "note is required");

  if (accept !== undefined) {
    if (!isCategoryId(expected)) fail(index, "accept only applies to food labels");
    if (!Array.isArray(accept) || accept.length === 0 || !accept.every(isCategoryId)) {
      fail(index, "accept must be a non-empty list of category ids");
    }
    if (accept.includes(expected) || new Set(accept).size !== accept.length) {
      fail(index, "accept repeats a label");
    }
  }
  if (tags !== undefined && (!Array.isArray(tags) || !tags.every((t) => isOneOf(TAGS, t)))) {
    fail(index, "bad tags");
  }
  if (wet !== undefined && typeof wet !== "boolean") fail(index, "wet must be a boolean");
  if (wet !== undefined && !isCategoryId(expected)) fail(index, "wet only applies to food");
  if (honorary !== undefined && (!isCategoryId(honorary) || expected !== "not_food")) {
    fail(index, "honorary must be a category id on a not_food item");
  }

  return {
    item,
    expected,
    source,
    note,
    ...(accept === undefined ? {} : { accept: accept as CategoryId[] }),
    ...(tags === undefined ? {} : { tags: tags as Tag[] }),
    ...(wet === undefined ? {} : { wet }),
    ...(honorary === undefined ? {} : { honorary }),
  };
}

export function parseDataset(json: unknown): EvalItem[] {
  if (!Array.isArray(json)) throw new Error("foods.json must be an array");
  const items = json.map(parseItem);
  const seen = new Set<string>();
  for (const { item } of items) {
    if (seen.has(item)) throw new Error(`foods.json lists "${item}" twice`);
    seen.add(item);
  }
  return items;
}

export function labelItems(
  items: readonly EvalItem[],
  examples: ReadonlyMap<string, readonly string[]> = promptExamples(),
): LabelledItem[] {
  return items.map((item) => ({
    ...item,
    split: splitOf(item),
    inPrompt: examples.get(exampleKey(item.item)) ?? [],
  }));
}

export function loadDataset(path: URL | string = DATASET_PATH): LabelledItem[] {
  return labelItems(parseDataset(JSON.parse(readFileSync(path, "utf8"))));
}

export function acceptedLabels(item: EvalItem): readonly Label[] {
  return [item.expected, ...(item.accept ?? [])];
}
