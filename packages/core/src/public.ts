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
// Top-level domains that are not everyday English words, for "acme . com" and "acme dot ai".
const TLD =
  "(com|net|org|io|co|edu|gov|uk|ai|ca|de|app|dev|xyz|info|biz|ly|tv|gg|fm|sh|nz|au|fr|es|nl|se|ch|jp|kr|br|mx|ru|pl|eu|ie|club|site|online|store|shop|blog|email|link|live|tech|website|space)";
const PERSONAL_INFO: readonly RegExp[] = [
  /@/,
  /https?:|www\./i,
  // NFKC leaves the ideographic full stop alone.
  /[\p{L}\p{N}][.\u3002]\p{L}{2,}/u,
  new RegExp(`\\p{L}\\s*[.\\u3002]\\s*${TLD}\\b`, "u"),
  new RegExp(`\\bdot\\s*${TLD}\\b`),
  /[[({<]\s*(at|dot)\s*[\])}>]/,
  /[\p{L}\p{N}_]+\s+at\s+[\p{L}\p{N}_-]+\s+dot\s+\p{L}{2,}/u,
  /\b(gmail|yahoo|hotmail|outlook|icloud|aol|proton(mail)?)\b/i,
  /[\p{L}\p{N}]_|_[\p{L}\p{N}]/u,
  /\$\p{L}/u,
  /\b(ig|insta|instagram|snapchat|tiktok|venmo|cashapp|twitter|telegram|whatsapp|discord|onlyfans|facebook|linkedin|hmu)\b/,
];

const DIGIT_WORDS = new Set([
  "zero",
  "oh",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
]);
const MIN_SPELLED_RUN = 3;

// Digits plus digit words said in a row, so "eight six seven five three oh nine" counts as 7.
function phoneDigits(item: string): number {
  let digits = item.match(/\p{Nd}/gu)?.length ?? 0;
  let run = 0;
  let words = 0;
  const close = () => {
    if (run >= MIN_SPELLED_RUN) digits += words;
    run = 0;
    words = 0;
  };
  for (const token of item.split(/[\s,.-]+/)) {
    if (DIGIT_WORDS.has(token)) {
      run += 1;
      words += 1;
    } else if (/^\p{Nd}+$/u.test(token)) {
      run += 1;
    } else {
      close();
    }
  }
  close();
  return digits;
}

/** Phone numbers, emails, handles, URLs and domains, plain or spelled out. Matches the normalized item. */
export function hasPersonalInfo(item: string): boolean {
  return (
    phoneDigits(item) >= MIN_PHONE_DIGITS || PERSONAL_INFO.some((pattern) => pattern.test(item))
  );
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
