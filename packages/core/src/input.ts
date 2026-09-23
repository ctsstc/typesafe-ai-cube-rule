import { QUESTION_SET_VERSION } from "./questions";
import type { NonsenseResult } from "./result";

export const CLASSIFY_PATH = "/api/classify";
export const SESSION_PATH = "/api/session";
// The widget and siteverify must agree on it, or every real token is rejected.
export const TURNSTILE_ACTION = "session";
export const MAX_ITEM_LENGTH = 60;

export function normalizeItem(raw: string): string {
  const cleaned = raw
    .normalize("NFKC")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[\p{Pi}\p{Pf}]/gu, "'")
    .replace(/\p{Pd}/gu, "-")
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s'"]+/, "");
  // Cut by code point before stripping trailing punctuation, so the result is stable under re-normalizing.
  return Array.from(cleaned)
    .slice(0, MAX_ITEM_LENGTH)
    .join("")
    .replace(/[\s?!.,;:'"]+$/u, "");
}

const USABLE_TEXT = /[\p{L}\p{Extended_Pictographic}]/u;

export function precheckItem(item: string): NonsenseResult | null {
  return USABLE_TEXT.test(item) ? null : { kind: "nonsense", item, model: "precheck" };
}

export function classifyQuery(item: string): string {
  return new URLSearchParams({ food: item, v: QUESTION_SET_VERSION }).toString();
}

export function classifyUrl(item: string): string {
  return `${CLASSIFY_PATH}?${classifyQuery(item)}`;
}

function canonicalItem(item: string | null): item is string {
  return item !== null && item === normalizeItem(item) && !precheckItem(item);
}

// Server side: accept only the exact canonical query string, so every cache key maps to one billed request.
export function parseClassifyQuery(rawSearch: string): string | null {
  const search = rawSearch.replace(/^\?/, "");
  const item = new URLSearchParams(search).get("food");
  if (!canonicalItem(item)) return null;
  return search === classifyQuery(item) ? item : null;
}

/** True for a query that is canonical except that `v` is another question set: a tab from another deploy. */
export function isStaleClassifyQuery(rawSearch: string): boolean {
  const search = rawSearch.replace(/^\?/, "");
  const params = new URLSearchParams(search);
  const item = params.get("food");
  const version = params.get("v");
  if (!canonicalItem(item) || version === null || version === QUESTION_SET_VERSION) return false;
  return (
    /^\d{1,4}$/.test(version) &&
    search === new URLSearchParams({ food: item, v: version }).toString()
  );
}
