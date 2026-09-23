import { CATEGORY_IDS, type CategoryId } from "./categories";
import { CUBE_ANSWER_TYPES, type CubeResponse, QUESTION_SET_VERSION } from "./questions";
import type { DebateLevel } from "./result";

export const CLASSIFY_ERROR_CODES = {
  bad_request: 400,
  challenge_required: 401,
  not_found: 404,
  method_not_allowed: 405,
  stale_client: 409,
  rate_limited: 429,
  client_limit: 429,
  daily_limit: 503,
  upstream_busy: 503,
  upstream_error: 502,
  timeout: 504,
  internal: 500,
} as const;
export type ClassifyErrorCode = keyof typeof CLASSIFY_ERROR_CODES;
export type ClassifyErrorStatus = (typeof CLASSIFY_ERROR_CODES)[ClassifyErrorCode];

export type ClassifyResponse = CubeResponse & { readonly mock?: true };

// A hover prefetch sends this header. The Function then serves only stored rulings and answers a
// miss with 204, so a prefetch never starts a human check or spends a Jev call.
export const PREFETCH_HEADER = "X-Cube-Prefetch";

// The SPA aborts any API request after this long. Every server-side deadline must stay under it,
// or the browser shows its own timeout instead of the Function's error.
export const CLIENT_TIMEOUT_MS = 10_000;

export interface ClassifyErrorBody {
  readonly error: { readonly code: ClassifyErrorCode; readonly message: string };
}

function isAnswer(value: unknown, type: "choice" | "noul" | "score"): boolean {
  if (typeof value !== "object" || value === null) return false;
  const answer = value as Record<string, unknown>;
  if (answer.type !== type) return false;
  if (type === "noul") return Number.isFinite(answer.noul);
  if (type === "score") return Number.isFinite(answer.score);
  const { probabilities } = answer;
  return (
    typeof answer.choice === "string" && typeof probabilities === "object" && probabilities !== null
  );
}

/** True when every question has an answer of the right type, so toCubeResult cannot throw on it. */
export function isClassifyResponse(value: unknown): value is ClassifyResponse {
  if (typeof value !== "object" || value === null) return false;
  const { model, answers } = value as { model?: unknown; answers?: unknown };
  if (typeof model !== "string" || typeof answers !== "object" || answers === null) return false;
  return Object.entries(CUBE_ANSWER_TYPES).every(([id, type]) =>
    isAnswer((answers as Record<string, unknown>)[id], type),
  );
}

export function isClassifyErrorCode(value: unknown): value is ClassifyErrorCode {
  return typeof value === "string" && Object.hasOwn(CLASSIFY_ERROR_CODES, value);
}

export function isClassifyErrorBody(value: unknown): value is ClassifyErrorBody {
  if (typeof value !== "object" || value === null || !("error" in value)) return false;
  const { error } = value;
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    isClassifyErrorCode(error.code) &&
    "message" in error &&
    typeof error.message === "string"
  );
}

export const LISTS_PATH = "/api/lists";

const listsQuery = (): string => new URLSearchParams({ v: QUESTION_SET_VERSION }).toString();

export function listsUrl(): string {
  return `${LISTS_PATH}?${listsQuery()}`;
}

/** True only for the exact query `listsUrl()` sends, so the edge cache holds one copy. */
export function isListsQuery(rawSearch: string): boolean {
  return rawSearch.replace(/^\?/, "") === listsQuery();
}

export const LIST_NAMES = ["latest", "mostDebated", "honoraryCourt", "friendshipEnding"] as const;
export type ListName = (typeof LIST_NAMES)[number];

export interface ListEntry {
  readonly item: string;
  readonly kind: "food" | "honorary";
  /** Jev's own pick. The ruling a card shows is `official ?? category`. */
  readonly category: CategoryId;
  readonly wet: boolean;
  readonly confidence: number;
  readonly runnerUp: CategoryId | null;
  readonly official: CategoryId | null;
  readonly debateLevel: DebateLevel;
}

export interface ListsResponse {
  readonly enabled: boolean;
  readonly questionSetVersion: string;
  readonly activity: { readonly newFoodsLastHour: number } | null;
  readonly lists: Readonly<Record<ListName, readonly ListEntry[]>>;
}

/** newFoodsLastHour stops counting here, so a count at the cap means at least that many. */
export const LISTS_ACTIVITY_CAP = 50;

export function disabledListsResponse(): ListsResponse {
  return {
    enabled: false,
    questionSetVersion: QUESTION_SET_VERSION,
    activity: null,
    lists: { latest: [], mostDebated: [], honoraryCourt: [], friendshipEnding: [] },
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isCategoryId = (value: unknown): value is CategoryId =>
  typeof value === "string" && (CATEGORY_IDS as readonly string[]).includes(value);

export function isListEntry(value: unknown): value is ListEntry {
  if (!isRecord(value)) return false;
  const { item, kind, category, wet, confidence, runnerUp, official, debateLevel } = value;
  return (
    typeof item === "string" &&
    item.length > 0 &&
    (kind === "food" || kind === "honorary") &&
    isCategoryId(category) &&
    typeof wet === "boolean" &&
    typeof confidence === "number" &&
    confidence >= 0 &&
    confidence <= 1 &&
    (runnerUp === null || isCategoryId(runnerUp)) &&
    (official === null || isCategoryId(official)) &&
    (debateLevel === 0 || debateLevel === 1 || debateLevel === 2 || debateLevel === 3)
  );
}

export function isListsResponse(value: unknown): value is ListsResponse {
  if (!isRecord(value)) return false;
  const { enabled, questionSetVersion, activity, lists } = value;
  if (typeof enabled !== "boolean" || typeof questionSetVersion !== "string") return false;
  if (activity !== null) {
    if (!isRecord(activity)) return false;
    const { newFoodsLastHour } = activity;
    if (!Number.isSafeInteger(newFoodsLastHour) || (newFoodsLastHour as number) < 0) return false;
  }
  return (
    isRecord(lists) &&
    LIST_NAMES.every((name) => {
      const entries = lists[name];
      return Array.isArray(entries) && entries.every(isListEntry);
    })
  );
}
