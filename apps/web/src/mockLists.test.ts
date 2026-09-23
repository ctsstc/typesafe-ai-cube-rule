// @vitest-environment node
import * as core from "@cube/core";
import { describe, expect, it } from "vitest";
import { listsReply, MOCK_LISTS_MODES } from "../plugins/mockApi";

const query = core.listsUrl().split("?")[1] ?? "";

describe("dev:mock /api/lists", () => {
  it.each(MOCK_LISTS_MODES.filter((mode) => mode !== "error"))(
    "answers %s with a valid lists body",
    (mode) => {
      const { status, body } = listsReply(core, "GET", query, mode);
      expect(status).toBe(200);
      expect(core.isListsResponse(body)).toBe(true);
    },
  );

  it("fills every list and the activity line by default", () => {
    const { body } = listsReply(core, "GET", query, undefined);
    if (!core.isListsResponse(body)) throw new Error("not a lists body");
    expect(body.enabled).toBe(true);
    expect(body.activity).toEqual({ newFoodsLastHour: 14 });
    for (const name of core.LIST_NAMES) expect(body.lists[name].length).toBeGreaterThanOrEqual(3);
    expect(body.lists.latest.some((entry) => entry.kind === "honorary")).toBe(true);
  });

  it("keeps canon entries in line with cuberule.com's rulings", () => {
    const { body } = listsReply(core, "GET", query, "full");
    if (!core.isListsResponse(body)) throw new Error("not a lists body");
    for (const entry of Object.values(body.lists).flat()) {
      expect(entry.official, entry.item).toBe(
        core.findOfficialRuling(entry.item)?.category ?? null,
      );
      expect(core.normalizeItem(entry.item)).toBe(entry.item);
    }
  });

  it("leaves some lists short in partial mode", () => {
    const { body } = listsReply(core, "GET", query, "partial");
    if (!core.isListsResponse(body)) throw new Error("not a lists body");
    expect(body.activity).toBeNull();
    expect(body.lists.jevDissents.length).toBeLessThan(3);
    expect(body.lists.friendshipEnding.length).toBeLessThan(3);
  });

  it("matches the server's disabled body and error codes", () => {
    expect(listsReply(core, "GET", query, "disabled").body).toEqual(core.disabledListsResponse());
    expect(listsReply(core, "GET", query, "error").status).toBe(500);
    expect(listsReply(core, "POST", query, "full").status).toBe(405);
    expect(listsReply(core, "GET", "v=0", "full").status).toBe(409);
    expect(listsReply(core, "GET", "", "full").status).toBe(400);
  });
});
