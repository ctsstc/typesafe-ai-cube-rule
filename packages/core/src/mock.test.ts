import { describe, expect, it } from "vitest";
import { mockCubeResponse } from "./mock";
import { toCubeResult } from "./result";

const FOODS = [
  "hot dog",
  "pizza",
  "cereal",
  "gyro",
  "crunchwrap",
  "spring roll",
  "s'more",
  "bao",
  "tostada",
  "birthday cake",
  "fried rice",
  "burrito bowl",
  "bagel",
  "muffin",
  "pho",
  "quesadilla",
  "sub",
  "taco salad",
  "ice cream sandwich",
  "big mac",
];

describe("mockCubeResponse", () => {
  it("makes every choice the argmax of probabilities that sum to 1", () => {
    for (const item of [...FOODS, "asdfgh", "my cat", "humans"]) {
      const { answers } = mockCubeResponse(item);
      for (const key of ["input_kind", "category", "honorary_category", "starch"] as const) {
        const { choice, probabilities } = answers[key];
        const entries = Object.entries(probabilities as Record<string, number>);
        const best = entries.reduce((a, b) => (b[1] > a[1] ? b : a));
        const sum = entries.reduce((total, [, p]) => total + p, 0);
        expect(best[0], `${item} ${key}`).toBe(choice);
        expect(sum, `${item} ${key}`).toBeCloseTo(1, 9);
      }
    }
  });

  it("reaches every result card", () => {
    expect(toCubeResult("asdfgh", mockCubeResponse("asdfgh")).kind).toBe("nonsense");
    expect(toCubeResult("sleeping bag", mockCubeResponse("sleeping bag")).kind).toBe("honorary");
    const hotDogEmoji = String.fromCodePoint(0x1f32d);
    expect(toCubeResult(hotDogEmoji, mockCubeResponse(hotDogEmoji)).kind).toBe("food");
  });

  it("exercises every verdict tier", () => {
    const verdicts = new Set(
      FOODS.map((item) => {
        const result = toCubeResult(item, mockCubeResponse(item));
        return result.kind === "food" ? result.ruling.verdict : null;
      }),
    );
    expect([...verdicts]).toEqual(expect.arrayContaining(["unanimous", "majority", "split"]));
  });

  it("gives face answers whose eyes reading agrees with the mock category", () => {
    for (const item of FOODS) {
      const result = toCubeResult(item, mockCubeResponse(item));
      if (result.kind === "food") expect(result.eyes.agrees, item).toBe(true);
    }
  });

  it("is deterministic and labelled as a mock", () => {
    expect(mockCubeResponse("gyro")).toEqual(mockCubeResponse("gyro"));
    expect(mockCubeResponse("gyro").model).toBe("mock");
  });
});
