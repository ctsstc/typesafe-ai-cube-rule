import { describe, expect, it } from "vitest";
import { CATEGORY_IDS, type CategoryId, INPUT_KIND_IDS, type InputKindId } from "./categories";
import { mockCubeResponse } from "./mock";
import {
  hasPersonalInfo,
  type ListingScores,
  listingBar,
  listingBars,
  listingScores,
  type PublicListingReason,
  parseBlocklist,
  publicListing,
  toListEntry,
} from "./public";
import { type CubeAnswers, type CubeResponse, THRESHOLDS } from "./questions";
import { toCubeResult } from "./result";

interface Reading {
  readonly kind?: InputKindId;
  readonly abusive?: number;
  readonly privateP?: number;
  readonly publicP?: number;
  readonly category?: CategoryId;
  readonly runnerUp?: CategoryId;
}

const spread = <K extends string>(ids: readonly K[], top: K, p: number, second?: K, q = 0) =>
  Object.fromEntries(
    ids.map((id) => [
      id,
      id === top ? p : id === second ? q : (1 - p - q) / (ids.length - (second ? 2 : 1)),
    ]),
  ) as Record<K, number>;

function jev(item: string, reading: Reading = {}): CubeResponse {
  const {
    kind = "food",
    abusive = 0.01,
    privateP = 0,
    publicP = 0,
    category = "taco",
    runnerUp,
  } = reading;
  return {
    model: "jev-1.13.0",
    answers: {
      ...mockCubeResponse(item).answers,
      is_abusive: { type: "noul", noul: abusive },
      input_kind: {
        type: "choice",
        choice: kind,
        confidence: 0.9,
        probabilities: spread(INPUT_KIND_IDS, kind, 0.95),
      },
      person_kind: {
        type: "choice",
        choice: privateP > 0.5 ? "private" : "none",
        confidence: 0.9,
        probabilities: { none: 1 - privateP - publicP, public: publicP, private: privateP },
      },
      category: {
        type: "choice",
        choice: category,
        confidence: 0.61234,
        probabilities: spread(CATEGORY_IDS, category, 0.7, runnerUp, runnerUp ? 0.25 : 0),
      },
    } as CubeAnswers,
  };
}

describe("publicListing", () => {
  it.each<[string, Reading, PublicListingReason]>([
    ["hot dog", {}, "listed"],
    ["a stapler", { kind: "not_food" }, "listed"],
    ["gordon ramsay", { kind: "not_food" }, "listed"],
    ["7 up", {}, "listed"],
    ["24 carrot cake", {}, "listed"],
    ["7-layer dip", {}, "listed"],
    ["my boss", { kind: "not_food", privateP: 1 }, "private_person"],
    ["dave from accounting", { kind: "not_food", privateP: 1, abusive: 0.08 }, "private_person"],
    ["my mom's lasagna", { privateP: 0.99 }, "private_person"],
    ["hot dog", { abusive: 0.9 }, "declined"],
    ["asdfgh", { kind: "nonsense" }, "nonsense"],
    ["call 555 123 4567", { abusive: 0.9 }, "declined"],
    ["call 555 123 4567", {}, "personal_info"],
    ["spotted dick", { abusive: THRESHOLDS.publicAbusive - 0.001 }, "listed"],
    ["slutty brownies", { abusive: THRESHOLDS.publicAbusive }, "abusive"],
    ["slippery nipple shot", { abusive: 0.31 }, "abusive"],
    ["humans", { kind: "not_food", abusive: 0.12 }, "listed"],
    ["humans", { kind: "not_food", abusive: 0.9 }, "declined"],
    [
      "tyler okonkwo",
      { kind: "not_food", privateP: THRESHOLDS.publicPrivatePerson },
      "private_person",
    ],
    [
      "sleeping bag",
      { kind: "not_food", privateP: THRESHOLDS.publicPrivatePerson - 0.001 },
      "listed",
    ],
    ["gyro", { abusive: Number.NaN }, "abusive"],
    ["tyler okonkwo's jollof rice", { privateP: 0.11, publicP: 0.86 }, "private_person"],
    ["sven lindqvist's grilled cheese", { privateP: 0.13, publicP: 0.75 }, "private_person"],
    ["tyler okonkwo sandwich", { privateP: 0.06, publicP: 0.63 }, "private_person"],
    ["shirley temple", { publicP: 0.6 }, "private_person"],
    ["arnold palmer", { publicP: 0.96 }, "listed"],
    ["gordon ramsay", { kind: "not_food", publicP: THRESHOLDS.publicPersonSure }, "listed"],
    [
      "a stapler",
      { kind: "not_food", publicP: 1.001 - THRESHOLDS.publicPersonSure },
      "private_person",
    ],
  ])("%s %j is %s", (item, reading, reason) => {
    expect(publicListing(item, jev(item, reading))).toEqual({
      listed: reason === "listed",
      reason,
    });
  });

  it("hides an item whose person answer is missing", () => {
    const { person_kind: _missing, ...answers } = jev("gyro").answers;
    const response = { model: "jev-1.13.0", answers: answers as CubeAnswers };
    expect(publicListing("gyro", response).reason).toBe("private_person");
  });

  it("hides blocklisted items after normalizing the list", () => {
    const blocklist = parseBlocklist(" Hot Dog?\n\npizza,,  Pad   Thai ");
    expect([...blocklist]).toEqual(["hot dog", "pizza", "pad thai"]);
    expect(publicListing("hot dog", jev("hot dog"), { blocklist }).reason).toBe("blocked");
    expect(publicListing("pad thai", jev("pad thai"), { blocklist }).reason).toBe("blocked");
    expect(publicListing("hot dogs", jev("hot dogs"), { blocklist }).reason).toBe("listed");
    expect(parseBlocklist(undefined).size).toBe(0);
  });
});

describe("listingBar", () => {
  const scores: ListingScores = {
    personNone: 0.99,
    personPublic: 0,
    personPrivate: 0.01,
    abusive: 0.01,
  };

  it("reads the four scores from a response and drops anything not a number", () => {
    const response = jev("gyro", { privateP: 0.02, publicP: 0.03, abusive: 0.04 });
    expect(listingScores(response)).toEqual({
      personNone: 0.95,
      personPublic: 0.03,
      personPrivate: 0.02,
      abusive: 0.04,
    });
    const broken = jev("gyro", { abusive: Number.NaN });
    expect(listingScores(broken).abusive).toBeNull();
  });

  it("fails closed on a missing score", () => {
    expect(listingBar("gyro", scores)).toBeNull();
    expect(listingBar("gyro", { ...scores, personNone: null })).toBe("private_person");
    expect(listingBar("gyro", { ...scores, personPrivate: null })).toBe("private_person");
    expect(listingBar("gyro", { ...scores, abusive: null })).toBe("abusive");
    expect(listingBar("humans", { ...scores, abusive: null })).toBeNull();
  });

  it("applies the bars it is given", () => {
    const stricter = { ...listingBars(), privatePerson: 0.01 };
    expect(listingBar("gyro", scores, stricter)).toBe("private_person");
    expect(listingBar("gyro", scores, { ...listingBars(), abusive: 0.01 })).toBe("abusive");
  });
});

describe("hasPersonalInfo", () => {
  it.each([
    "call 555 123 4567",
    "8675309",
    "555-1234 pizza",
    "1234567 cake",
    "+44 20 7946 0958",
    "dave@example.com",
    "@davesmith",
    "tacos with @jess",
    "https://example.com",
    "example.com",
    "mcdonalds.com burger",
    "www.pizza",
    "dave.smith",
    "john dot smith at gmail",
    "dave at yahoo",
    "my email is dave dot com",
    "jsmith [at] acme [dot] org",
    "acme(dot)com",
    "jsmith {at} acme",
    "jsmith at acme dot uk",
    "acme dot ai",
    "acme . com",
    "acme .com",
    "acme\u3002com",
    "acme .io pizza",
    "call me 555 one two three four",
    "jenny eight six seven five three oh nine",
    "five five five one two one two pizza",
    "ig jsmith_99",
    "jsmith_99",
    "follow me on instagram",
    "cashapp $jsmith",
    "$jsmith",
    "venmo jsmith",
    "hmu on snapchat",
  ])("flags %s", (item) => {
    expect(hasPersonalInfo(item)).toBe(true);
  });

  it.each([
    "7 up",
    "24 carrot cake",
    "7-layer dip",
    "1000 island dressing",
    "123456 cake",
    "3.14 pie",
    "st. louis ribs",
    "p.f. chang's lettuce wraps",
    "mrs. patterson from third grade",
    "a.1. steak sauce",
    "pizza...yum",
    "dot's pretzels",
    "hot dog",
    "polka dot cake",
    "dr. pepper",
    "mr. t cereal",
    "sushi at dot's diner",
    "seven layer dip",
    "one two three pizza",
    "five guys burger",
    "three cheese pizza",
    "zero sugar cola",
    "oh no pizza",
    "$5 footlong",
    "ginger snap cookies",
    "snap pea salad",
    "instant pot chili",
    "st. louis ribs with 3 sides",
  ])("leaves %s alone", (item) => {
    expect(hasPersonalInfo(item)).toBe(false);
  });
});

describe("toListEntry", () => {
  it("keeps Jev's own pick next to the official ruling", () => {
    const result = toCubeResult("hot dog", jev("hot dog", { category: "sushi", runnerUp: "taco" }));
    if (result.kind !== "food") throw new Error(`expected food, got ${result.kind}`);
    expect(toListEntry("hot dog", result)).toEqual({
      item: "hot dog",
      kind: "food",
      category: "sushi",
      wet: false,
      confidence: 0.612,
      runnerUp: "taco",
      official: "taco",
      debateLevel: result.debate.level,
    });
  });

  it("leaves out a runner-up below the dissent bar and fills food extras", () => {
    const entry = toListEntry("tomato soup", toCubeResult("tomato soup", jev("tomato soup")));
    expect(entry).toMatchObject({ kind: "food", runnerUp: null, official: "salad" });
    expect(entry?.wet).toBe(true);
    expect([0, 1, 2, 3]).toContain(entry?.debateLevel);
  });

  it("builds an honorary row with no wet or debate level", () => {
    const response = jev("a stapler", { kind: "not_food" });
    expect(toListEntry("a stapler", toCubeResult("a stapler", response))).toMatchObject({
      item: "a stapler",
      kind: "honorary",
      wet: false,
      debateLevel: 0,
      official: null,
    });
  });

  it("returns null for results that are never listed", () => {
    const nonsense = toCubeResult("asdfgh", jev("asdfgh", { kind: "nonsense" }));
    const declined = toCubeResult("x", jev("x", { abusive: 0.9 }));
    expect(toListEntry("asdfgh", nonsense)).toBeNull();
    expect(toListEntry("x", declined)).toBeNull();
  });
});
