import { normalizeItem } from "./input";
import { findOfficialRuling } from "./official";
import { type CubeResponse, THRESHOLDS } from "./questions";
import { type CubeResult, toCubeResult } from "./result";
import type { ListEntry } from "./wire";

export type PublicListingReason =
  | "listed"
  | "declined"
  | "nonsense"
  | "blocked"
  | "personal_info"
  | "private_person"
  | "abusive";

export interface PublicListing {
  readonly listed: boolean;
  readonly reason: PublicListingReason;
}

export interface PublicListingOptions {
  /** Normalized items that never appear in a list. */
  readonly blocklist?: ReadonlySet<string>;
}

const MIN_PHONE_DIGITS = 7;
const PERSONAL_INFO: readonly RegExp[] = [
  /@/,
  /https?:|www\./i,
  /[\p{L}\p{N}]\.\p{L}{2,}/u,
  /\bdot\s*(com|net|org|io|co|edu|gov)\b/i,
  /\b(gmail|yahoo|hotmail|outlook|icloud|aol|proton(mail)?)\b/i,
];

/** Phone numbers, emails, @handles, URLs and domains. Matches the normalized item. */
export function hasPersonalInfo(item: string): boolean {
  const digits = item.match(/\p{Nd}/gu)?.length ?? 0;
  return digits >= MIN_PHONE_DIGITS || PERSONAL_INFO.some((pattern) => pattern.test(item));
}

/** One item per line or comma, normalized the way the app normalizes what people type. */
export function parseBlocklist(text: string | undefined): ReadonlySet<string> {
  return new Set(
    (text ?? "")
      .split(/[\n,]/)
      .map(normalizeItem)
      .filter((item) => item.length > 0),
  );
}

const listing = (reason: PublicListingReason): PublicListing => ({
  listed: reason === "listed",
  reason,
});

export function publicListing(
  item: string,
  response: CubeResponse,
  options: PublicListingOptions = {},
): PublicListing {
  const { kind } = toCubeResult(item, response);
  if (kind === "declined" || kind === "nonsense") return listing(kind);
  if (options.blocklist?.has(normalizeItem(item))) return listing("blocked");
  if (hasPersonalInfo(item)) return listing("personal_info");
  // Negated so a missing or NaN answer hides the item. Canon names skip the abusive bar because
  // they are cuberule.com's own rulings, and Jev scores "humans" 0.12.
  const { is_abusive, person_kind } = response.answers;
  if (!(person_kind?.probabilities.private < THRESHOLDS.publicPrivatePerson)) {
    return listing("private_person");
  }
  if (!findOfficialRuling(item) && !(is_abusive?.noul < THRESHOLDS.publicAbusive)) {
    return listing("abusive");
  }
  return listing("listed");
}

const round3 = (value: number): number => Math.round(value * 1000) / 1000;

/** A list row from `toCubeResult` output. Null for results that are never listed. */
export function toListEntry(item: string, result: CubeResult): ListEntry | null {
  if (result.kind !== "food" && result.kind !== "honorary") return null;
  const food = result.kind === "food" ? result : null;
  return {
    item,
    kind: result.kind,
    category: result.ruling.category,
    wet: food?.wet ?? false,
    confidence: round3(result.ruling.confidence),
    runnerUp: result.ruling.dissent?.id ?? null,
    official: result.official?.category ?? null,
    debateLevel: food?.debate.level ?? 0,
  };
}
