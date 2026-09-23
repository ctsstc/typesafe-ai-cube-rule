import {
  type CategoryId,
  disabledListsResponse,
  type ListEntry,
  type ListName,
  type ListsResponse,
  QUESTION_SET_VERSION,
} from "@cube/core";

export function entry(
  item: string,
  category: CategoryId = "taco",
  more: Partial<ListEntry> = {},
): ListEntry {
  return {
    item,
    kind: "food",
    category,
    wet: false,
    confidence: 0.5,
    runnerUp: null,
    official: null,
    debateLevel: 1,
    ...more,
  };
}

export const honorary = (item: string, category: CategoryId, runnerUp: CategoryId | null = null) =>
  entry(item, category, { kind: "honorary", runnerUp, debateLevel: 0, confidence: 0.45 });

export const FULL_LISTS: Readonly<Record<ListName, readonly ListEntry[]>> = {
  latest: [
    entry("gyro", "taco", { runnerUp: "sushi", confidence: 0.28, debateLevel: 2 }),
    honorary("canoe", "taco", "sushi"),
    entry("ramen", "nachos", { official: "nachos", wet: true }),
    entry("hot dog", "taco", { official: "taco", confidence: 0.93, debateLevel: 3 }),
  ],
  mostDebated: [
    entry("gyro", "taco", { runnerUp: "sushi", confidence: 0.28, debateLevel: 2 }),
    entry("quesadilla", "sandwich", { runnerUp: "taco", confidence: 0.36 }),
    honorary("canoe", "taco", "sushi"),
    entry("flan", "salad", { confidence: 0.58 }),
  ],
  honoraryCourt: [
    { ...honorary("good vibes", "salad"), confidence: 1 },
    { ...honorary("humans", "calzone"), official: "calzone", confidence: 0.99 },
    { ...honorary("the moon", "toast", "calzone"), confidence: 0.65 },
    honorary("canoe", "taco", "sushi"),
  ],
  friendshipEnding: [
    entry("hot dog", "taco", { official: "taco", confidence: 0.93, debateLevel: 3 }),
    entry("big mac", "sandwich", { official: "cake", debateLevel: 3 }),
    entry("gyro", "taco", { runnerUp: "sushi", confidence: 0.28, debateLevel: 2 }),
  ],
};

export function listsBody(
  lists: Partial<Record<ListName, readonly unknown[]>> = FULL_LISTS,
  activity: ListsResponse["activity"] = { newFoodsLastHour: 14 },
): unknown {
  return {
    enabled: true,
    questionSetVersion: QUESTION_SET_VERSION,
    activity,
    lists: { ...disabledListsResponse().lists, ...lists },
  };
}
