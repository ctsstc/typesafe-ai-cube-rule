import { mockCubeResponse, QUESTION_SET_VERSION } from "@cube/core";
import { describe, expect, it } from "vitest";
import { parseRaw, type RawRecord, requestFingerprint, resultsDir, serializeRaw } from "./cache";

const record = (item: string, latencyMs = 100): RawRecord => ({
  item,
  version: QUESTION_SET_VERSION,
  fingerprint: requestFingerprint(),
  model: "jev-1.13.0",
  answers: mockCubeResponse(item).answers,
  usage: { input_tokens: 8000, output_tokens: 500 },
  latencyMs,
  attempts: 1,
  requestId: null,
  fetchedAt: "2026-09-22T00:00:00.000Z",
});

describe("raw cache", () => {
  it("round-trips records sorted by item, one per line", () => {
    const text = serializeRaw([record("taco"), record("burrito")]);
    expect(text.split("\n")).toHaveLength(3);
    expect([...parseRaw(text).keys()]).toEqual(["burrito", "taco"]);
    expect(parseRaw(text).get("taco")).toEqual(record("taco"));
  });

  it("lets a later line replace an earlier one for the same item", () => {
    const text = serializeRaw([record("taco", 100)]) + serializeRaw([record("taco", 200)]);
    expect(parseRaw(text).get("taco")?.latencyMs).toBe(200);
  });

  it("rejects lines that are not raw records", () => {
    expect(() => parseRaw('{"item":"taco"}\n')).toThrow(/line 1/);
    expect(() => parseRaw("not json\n")).toThrow();
  });

  it("fingerprints the request deterministically and versions the results folder", () => {
    expect(requestFingerprint()).toMatch(/^[0-9a-f]{64}$/);
    expect(requestFingerprint()).toBe(requestFingerprint());
    expect(resultsDir("7").pathname).toMatch(/\/eval\/results\/v7\/$/);
  });
});
