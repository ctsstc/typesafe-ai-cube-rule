import {
  CATEGORIES,
  type CategoryId,
  CLIENT_TIMEOUT_MS,
  DEBATE_LABELS,
  hasPersonalInfo,
  isListEntry,
  LIST_NAMES,
  type ListEntry,
  type ListName,
  listsUrl,
  normalizeItem,
  QUESTION_SET_VERSION,
  THRESHOLDS,
  VERDICT_ADVERBS,
} from "@cube/core";

/** A list with fewer entries than this is hidden, so a quiet day never looks empty. */
export const MIN_LIST_ENTRIES = 3;

const SHOWN: Readonly<Record<ListName, number>> = {
  latest: 6,
  mostDebated: 5,
  jevDissents: 5,
  friendshipEnding: 5,
};

// The Function filters too. Repeating it here keeps a list from ever contradicting its title.
const BELONGS: Readonly<Record<ListName, (entry: ListEntry) => boolean>> = {
  latest: () => true,
  mostDebated: () => true,
  jevDissents: (entry) => entry.official !== null && entry.official !== entry.category,
  friendshipEnding: (entry) => entry.debateLevel > 0,
};

export const LIST_TITLES: Readonly<Record<ListName, string>> = {
  latest: "Latest rulings",
  mostDebated: "Most debated",
  jevDissents: "Jev vs the canon",
  friendshipEnding: "Friendship-ending",
};

export const LIST_BLURBS: Readonly<Record<ListName, string>> = {
  latest: "Newest cases first.",
  mostDebated: "Jev couldn't settle on one cube.",
  jevDissents: "cuberule.com has ruled. Jev, on its own, disagrees.",
  friendshipEnding: "What people argue about most, by Jev's read.",
};

export interface DocketList {
  readonly name: ListName;
  readonly entries: readonly ListEntry[];
}

export interface Docket {
  readonly newFoodsLastHour: number | null;
  readonly lists: readonly DocketList[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// isListEntry also drops any kind but food and honorary, so a declined ruling never renders.
const isShowable = (value: unknown): value is ListEntry =>
  isListEntry(value) && normalizeItem(value.item) === value.item && !hasPersonalInfo(value.item);

function readList(name: ListName, raw: unknown): DocketList {
  const seen = new Set<string>();
  const entries = (Array.isArray(raw) ? raw : [])
    .filter(isShowable)
    .filter(BELONGS[name])
    .filter((entry) => {
      if (seen.has(entry.item)) return false;
      seen.add(entry.item);
      return true;
    })
    .slice(0, SHOWN[name]);
  return { name, entries };
}

function readActivity(activity: unknown): number | null {
  if (!isRecord(activity)) return null;
  const count = activity.newFoodsLastHour;
  return typeof count === "number" && Number.isSafeInteger(count) && count > 0 ? count : null;
}

/** The lists worth showing from a /api/lists body, or null when the section should stay hidden. */
export function readDocket(body: unknown): Docket | null {
  if (!isRecord(body) || body.enabled !== true) return null;
  if (body.questionSetVersion !== QUESTION_SET_VERSION) return null;
  const lists = isRecord(body.lists) ? body.lists : {};
  const shown = LIST_NAMES.map((name) => readList(name, lists[name])).filter(
    ({ entries }) => entries.length >= MIN_LIST_ENTRIES,
  );
  if (shown.length === 0) return null;
  return { newFoodsLastHour: readActivity(body.activity), lists: shown };
}

async function fetchDocket(): Promise<Docket | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
  try {
    const res = await fetch(listsUrl(), {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    return res.ok ? readDocket(await res.json()) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

let pending: Promise<Docket | null> | null = null;

/** One request per page load, cached by the browser for as long as the response allows. */
export function loadDocket(): Promise<Docket | null> {
  pending ??= fetchDocket();
  return pending;
}

export function clearDocketCache(): void {
  pending = null;
}

const noun = (id: CategoryId) => CATEGORIES[id].noun;

function adverb(confidence: number): string {
  const verdict =
    confidence >= THRESHOLDS.unanimous
      ? "unanimous"
      : confidence >= THRESHOLDS.majority
        ? "majority"
        : "split";
  return VERDICT_ADVERBS[verdict].toLowerCase();
}

/** The short line under a food. A card shows cuberule.com's ruling when there is one. */
export function entryDetail(name: ListName, entry: ListEntry): string {
  const ruling = entry.official ?? entry.category;
  switch (name) {
    case "latest":
      return entry.wet ? `wet ${noun(ruling)}` : noun(ruling);
    case "mostDebated":
      return entry.runnerUp
        ? `${noun(entry.category)} or ${noun(entry.runnerUp)}`
        : `${adverb(entry.confidence)} ${noun(entry.category)}`;
    case "jevDissents":
      return `Canon: ${noun(ruling)}, Jev: ${noun(entry.category)}`;
    case "friendshipEnding":
      return `Debate: ${DEBATE_LABELS[entry.debateLevel]}`;
  }
}

export function activityLine(count: number): string {
  return `${count} new ${count === 1 ? "food" : "foods"} ruled in the last hour.`;
}
