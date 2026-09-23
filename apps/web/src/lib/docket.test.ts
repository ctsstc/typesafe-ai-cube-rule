import {
  disabledListsResponse,
  LIST_NAMES,
  LISTS_ACTIVITY_CAP,
  type ListEntry,
  listsUrl,
} from "@cube/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { entry, FULL_LISTS, honorary, listsBody } from "../test/lists";
import {
  activityLine,
  clearDocketCache,
  entryDetail,
  loadDocket,
  MIN_LIST_ENTRIES,
  readDocket,
} from "./docket";

const names = (body: unknown) => readDocket(body)?.lists.map((list) => list.name) ?? null;
const items = (body: unknown, name: string) =>
  readDocket(body)
    ?.lists.find((list) => list.name === name)
    ?.entries.map((e) => e.item);

describe("readDocket", () => {
  it("keeps every list that has an entry, in the contract's order", () => {
    expect(names(listsBody())).toEqual([
      "latest",
      "mostDebated",
      "honoraryCourt",
      "friendshipEnding",
    ]);
    expect(readDocket(listsBody())?.newFoodsLastHour).toBe(14);
  });

  it.each(LIST_NAMES)("shows %s from a single entry", (name) => {
    expect(MIN_LIST_ENTRIES).toBe(1);
    const body = listsBody({ [name]: FULL_LISTS[name].slice(0, 1) }, null);
    expect(names(body)).toEqual([name]);
    expect(items(body, name)).toEqual([FULL_LISTS[name][0]?.item]);
  });

  it("hides an empty list and keeps the rest", () => {
    const body = listsBody({ ...FULL_LISTS, honoraryCourt: [], friendshipEnding: [] });
    expect(names(body)).toEqual(["latest", "mostDebated"]);
  });

  it("hides the whole section only when every list is empty, off or unreadable", () => {
    expect(readDocket(listsBody({}, { newFoodsLastHour: 40 }))).toBeNull();
    expect(readDocket(disabledListsResponse())).toBeNull();
    expect(readDocket({ ...(listsBody() as object), enabled: false })).toBeNull();
    expect(readDocket({ ...(listsBody() as object), questionSetVersion: "0" })).toBeNull();
    expect(readDocket("<!doctype html>")).toBeNull();
    expect(readDocket(null)).toBeNull();
  });

  it("drops declined, malformed, unnormalized and personal entries before counting", () => {
    const junk = [
      { ...entry("some slur"), kind: "declined" },
      { ...entry("flan"), confidence: 2 },
      entry("Hot Dog"),
      entry("call 555 123 4567"),
      entry("me at example.com"),
    ];
    expect(readDocket(listsBody({ latest: junk }))).toBeNull();
    const body = listsBody({ latest: [entry("gyro"), ...junk, entry("gyro"), entry("ramen")] });
    expect(items(body, "latest")).toEqual(["gyro", "ramen"]);
  });

  it("keeps each list true to its title", () => {
    const body = listsBody({
      honoraryCourt: [...FULL_LISTS.honoraryCourt, entry("hot dog", "taco")],
      friendshipEnding: [
        ...FULL_LISTS.friendshipEnding,
        entry("toast", "toast", { debateLevel: 0 }),
      ],
    });
    expect(items(body, "honoraryCourt")).not.toContain("hot dog");
    expect(items(body, "friendshipEnding")).not.toContain("toast");
    expect(names(listsBody({ honoraryCourt: [entry("hot dog", "taco")] }))).toBeNull();
  });

  it("includes honorary rulings", () => {
    expect(items(listsBody(), "mostDebated")).toContain("canoe");
  });

  it("shows at most six latest rulings and five of the rest", () => {
    const many = Array.from({ length: 12 }, (_, i) => entry(`food ${"abcdefghijkl"[i]}`));
    const docket = readDocket(listsBody({ latest: many, mostDebated: many }));
    expect(docket?.lists.map((list) => list.entries.length)).toEqual([6, 5]);
  });

  it("shows the activity line only for a positive count", () => {
    expect(readDocket(listsBody(FULL_LISTS, null))?.newFoodsLastHour).toBeNull();
    expect(readDocket(listsBody(FULL_LISTS, { newFoodsLastHour: 0 }))?.newFoodsLastHour).toBeNull();
    expect(activityLine(14)).toBe("14 new foods ruled in the last hour.");
    expect(activityLine(1)).toBe("1 new food ruled in the last hour.");
    expect(activityLine(LISTS_ACTIVITY_CAP - 1)).toBe("49 new foods ruled in the last hour.");
    expect(activityLine(LISTS_ACTIVITY_CAP)).toBe("50+ new foods ruled in the last hour.");
  });
});

describe("entryDetail", () => {
  it("names the ruling a card shows, the pair Jev was torn between and the heat", () => {
    expect(entryDetail("latest", entry("ramen", "salad", { official: "nachos", wet: true }))).toBe(
      "wet nachos",
    );
    expect(entryDetail("mostDebated", entry("gyro", "taco", { runnerUp: "sushi" }))).toBe(
      "taco or sushi",
    );
    expect(entryDetail("mostDebated", entry("flan", "quiche", { confidence: 0.3 }))).toBe(
      "arguably quiche",
    );
    expect(entryDetail("mostDebated", entry("flan", "salad", { confidence: 0.6 }))).toBe(
      "probably salad",
    );
    expect(entryDetail("friendshipEnding", entry("hot dog", "taco", { debateLevel: 3 }))).toBe(
      "Debate: Friendship-ending",
    );
    expect(entryDetail("latest", honorary("canoe", "taco"))).toBe("taco");
  });

  it("calls each honorary ruling with the verdict's own adverb", () => {
    const court = (confidence: number, more: Partial<ListEntry> = {}) =>
      entryDetail("honoraryCourt", { ...honorary("canoe", "taco"), confidence, ...more });
    expect(court(0.97)).toBe("definitely honorary taco");
    expect(court(0.65)).toBe("probably honorary taco");
    expect(court(0.44)).toBe("arguably honorary taco");
    expect(court(0.99, { category: "salad", official: "calzone" })).toBe(
      "officially honorary calzone",
    );
  });
});

describe("loadDocket", () => {
  beforeEach(() => clearDocketCache());
  afterEach(() => clearDocketCache());

  const reply = (body: unknown, init: ResponseInit = {}) =>
    vi.fn(async () => new Response(JSON.stringify(body), init));

  it("asks once per page load and lets the browser's HTTP cache decide freshness", async () => {
    const fetchMock = reply(listsBody());
    vi.stubGlobal("fetch", fetchMock);
    const [a, b] = await Promise.all([loadDocket(), loadDocket()]);
    expect(a).toBe(b);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(listsUrl());
    expect(init.cache).toBeUndefined();
  });

  it.each([
    ["an error status", reply({ error: { code: "internal", message: "no" } }, { status: 500 })],
    ["a stale client", reply({ error: { code: "stale_client", message: "no" } }, { status: 409 })],
    ["an HTML page", vi.fn(async () => new Response("<!doctype html><html></html>"))],
    ["a network failure", vi.fn(async () => Promise.reject(new TypeError("offline")))],
  ])("hides the section on %s", async (_name, fetchMock) => {
    vi.stubGlobal("fetch", fetchMock);
    expect(await loadDocket()).toBeNull();
  });
});
