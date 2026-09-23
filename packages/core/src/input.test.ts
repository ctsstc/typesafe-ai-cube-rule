import { describe, expect, it } from "vitest";
import {
  classifyQuery,
  classifyUrl,
  isStaleClassifyQuery,
  MAX_ITEM_LENGTH,
  normalizeItem,
  parseClassifyQuery,
  precheckItem,
} from "./input";
import { QUESTION_SET_VERSION } from "./questions";

const v = QUESTION_SET_VERSION;
const ALPHABET = [
  ..."aZ ?.!-&+%'1\":;",
  ...[0x9, 0x0, 0xa0, 0xdf, 0xe9, 0x130, 0x3a3, 0x2011, 0x2014, 0x2019, 0x201c, 0x201d, 0xfb01],
  ...[0x1f32d],
].map((c) => (typeof c === "number" ? String.fromCodePoint(c) : c));

function fuzzStrings(count: number): string[] {
  let seed = 7;
  const rnd = (n: number) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };
  return Array.from({ length: count }, () =>
    Array.from({ length: rnd(90) }, () => ALPHABET[rnd(ALPHABET.length)]).join(""),
  );
}

describe("normalizeItem", () => {
  const fuzzed = fuzzStrings(20000);

  it("is idempotent and capped at MAX_ITEM_LENGTH code points", () => {
    for (const raw of fuzzed) {
      const item = normalizeItem(raw);
      expect(normalizeItem(item), JSON.stringify(raw)).toBe(item);
      expect([...item].length).toBeLessThanOrEqual(MAX_ITEM_LENGTH);
    }
  });

  it("round trips through classifyUrl and parseClassifyQuery", () => {
    for (const raw of fuzzed) {
      const item = normalizeItem(raw);
      if (!item || precheckItem(item)) continue;
      const url = new URL(`https://example.test${classifyUrl(item)}`);
      expect(parseClassifyQuery(url.search), JSON.stringify(raw)).toBe(item);
    }
  });

  it("lowercases, collapses whitespace, trims punctuation and straightens quotes", () => {
    expect(normalizeItem("  Big\tMAC?! ")).toBe("big mac");
    expect(normalizeItem(`S${String.fromCodePoint(0x2019)}more`)).toBe("s'more");
  });
});

describe("parseClassifyQuery", () => {
  it("accepts the canonical query with or without a leading ?", () => {
    expect(parseClassifyQuery(`?food=hot+dog&v=${v}`)).toBe("hot dog");
    expect(parseClassifyQuery(classifyQuery("hot dog"))).toBe("hot dog");
  });

  it.each([
    ["reordered params", `v=${v}&food=taco`],
    ["%20 spelling", `food=hot%20dog&v=${v}`],
    ["stale version", "food=taco&v=0"],
    ["extra param", `food=taco&v=${v}&x=1`],
    ["un-normalized item", `food=Taco&v=${v}`],
    ["digits only", `food=123&v=${v}`],
    ["missing food", `v=${v}`],
    ["empty food", `food=&v=${v}`],
  ])("rejects %s", (_label, search) => {
    expect(parseClassifyQuery(search)).toBeNull();
  });

  it("tells a tab from another deploy apart from a malformed query", () => {
    expect(isStaleClassifyQuery("food=hot+dog&v=5")).toBe(true);
    expect(isStaleClassifyQuery(`?food=taco&v=${Number(v) + 1}`)).toBe(true);
    for (const search of [
      `food=taco&v=${v}`,
      "food=Taco&v=5",
      "v=5&food=taco",
      "food=taco&v=5&x=1",
      "food=123&v=5",
      "food=taco&v=five",
      "food=taco",
    ]) {
      expect(isStaleClassifyQuery(search), search).toBe(false);
    }
  });

  it("builds the wire URL", () => {
    expect(classifyUrl("hot dog")).toBe(`/api/classify?food=hot+dog&v=${v}`);
  });
});

describe("precheckItem", () => {
  it("rejects input with no letters or emoji without an API call", () => {
    expect(precheckItem("!!! 123")).toEqual({
      kind: "nonsense",
      item: "!!! 123",
      model: "precheck",
    });
    expect(precheckItem("")?.kind).toBe("nonsense");
  });

  it("lets letters and emoji through", () => {
    expect(precheckItem(String.fromCodePoint(0x1f32d))).toBeNull();
    expect(precheckItem("taco")).toBeNull();
  });
});
