import { disabledListsResponse, LISTS_ACTIVITY_CAP, listsUrl } from "@cube/core";
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
  it("keeps every list that has enough entries, in the contract's order", () => {
    expect(names(listsBody())).toEqual([
      "latest",
      "mostDebated",
      "jevDissents",
      "friendshipEnding",
    ]);
    expect(readDocket(listsBody())?.newFoodsLastHour).toBe(14);
  });

  it(`hides a list with fewer than ${MIN_LIST_ENTRIES.friendshipEnding} entries`, () => {
    const body = listsBody({
      ...FULL_LISTS,
      friendshipEnding: FULL_LISTS.friendshipEnding.slice(0, 2),
    });
    expect(names(body)).toEqual(["latest", "mostDebated", "jevDissents"]);
  });

  // Jev agrees with every canon ruling in the eval, so one dissent is already news.
  it("shows Jev vs the canon from a single dissent", () => {
    const body = listsBody({ ...FULL_LISTS, jevDissents: FULL_LISTS.jevDissents.slice(0, 1) });
    expect(items(body, "jevDissents")).toEqual(["big mac"]);
    expect(names(listsBody({ ...FULL_LISTS, jevDissents: [] }))).not.toContain("jevDissents");
  });

  it("hides the whole section when every list is short, empty, off or unreadable", () => {
    const short = {
      ...Object.fromEntries(
        Object.entries(FULL_LISTS).map(([name, list]) => [name, list.slice(0, 2)]),
      ),
      jevDissents: [],
    };
    expect(readDocket(listsBody(short))).toBeNull();
    expect(readDocket(listsBody({}, { newFoodsLastHour: 40 }))).toBeNull();
    expect(readDocket(disabledListsResponse())).toBeNull();
    expect(readDocket({ ...(listsBody() as object), enabled: false })).toBeNull();
    expect(readDocket({ ...(listsBody() as object), questionSetVersion: "0" })).toBeNull();
    expect(readDocket("<!doctype html>")).toBeNull();
    expect(readDocket(null)).toBeNull();
  });

  it("drops declined, malformed, unnormalized and personal entries before counting", () => {
    const body = listsBody({
      latest: [
        entry("gyro"),
        { ...entry("some slur"), kind: "declined" },
        { ...entry("flan"), confidence: 2 },
        entry("Hot Dog"),
        entry("call 555 123 4567"),
        entry("me at example.com"),
        entry("gyro"),
        entry("ramen"),
      ],
    });
    expect(items(body, "latest")).toBeUndefined();
    const enough = listsBody({
      latest: [entry("gyro"), { ...entry("x"), kind: "declined" }, entry("ramen"), entry("flan")],
    });
    expect(items(enough, "latest")).toEqual(["gyro", "ramen", "flan"]);
  });

  it("keeps each list true to its title", () => {
    const body = listsBody({
      jevDissents: [...FULL_LISTS.jevDissents, entry("hot dog", "taco", { official: "taco" })],
      friendshipEnding: [
        ...FULL_LISTS.friendshipEnding,
        entry("toast", "toast", { debateLevel: 0 }),
      ],
    });
    expect(items(body, "jevDissents")).not.toContain("hot dog");
    expect(items(body, "friendshipEnding")).not.toContain("toast");
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
  it("names the ruling a card shows, the pair Jev was torn between, the dissent and the heat", () => {
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
    expect(entryDetail("jevDissents", entry("cheesecake", "cake", { official: "quiche" }))).toBe(
      "Canon: quiche, Jev: cake",
    );
    expect(entryDetail("friendshipEnding", entry("hot dog", "taco", { debateLevel: 3 }))).toBe(
      "Debate: Friendship-ending",
    );
    expect(entryDetail("latest", honorary("canoe", "taco"))).toBe("taco");
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
