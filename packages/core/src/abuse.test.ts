import { describe, expect, expectTypeOf, it } from "vitest";
import { MOCK_DECLINE_TRIGGER, mockCubeResponse } from "./mock";
import { buildCubeQuestions, type CubeAnswers, type CubeResponse, THRESHOLDS } from "./questions";
import { type CubeResult, type DeclinedResult, toCubeResult } from "./result";

const withAbuse = (item: string, noul: number): CubeResponse => {
  const { answers } = mockCubeResponse(item);
  return {
    model: "jev-1.13.0",
    answers: { ...answers, is_abusive: { type: "noul", noul } } as CubeAnswers,
  };
};

describe("is_abusive question", () => {
  const question = buildCubeQuestions().is_abusive;

  it("is a single Noul with explicit yes and no criteria", () => {
    expect(question.type).toBe("noul");
    expect(question.criteria).toEqual({
      true: expect.objectContaining({ what: expect.any(String) }),
      false: expect.objectContaining({ what: expect.any(String) }),
    });
  });

  it("lists food names that only sound rude on the benign side", () => {
    const benign = JSON.stringify(question.criteria?.false);
    for (const name of ["spotted dick", "faggot (the British meatball)", "hot dog", "sloppy joe"]) {
      expect(benign).toContain(name);
    }
  });

  it("declines at a high bar", () => {
    expect(THRESHOLDS.abusive).toBe(0.85);
  });
});

describe("toCubeResult abuse guard", () => {
  it("declines at or above the threshold", () => {
    expect(toCubeResult("gyro", withAbuse("gyro", THRESHOLDS.abusive))).toEqual({
      kind: "declined",
      item: "gyro",
      model: "jev-1.13.0",
    });
  });

  it("rules normally just below the threshold", () => {
    expect(toCubeResult("gyro", withAbuse("gyro", THRESHOLDS.abusive - 0.01)).kind).toBe("food");
  });

  it("runs before the official lookup", () => {
    expect(toCubeResult("hot dog", withAbuse("hot dog", 0.99)).kind).toBe("declined");
    expect(toCubeResult("humans", withAbuse("humans", 0.99)).kind).toBe("declined");
  });

  it("runs before the nonsense gate", () => {
    expect(toCubeResult("asdfgh", withAbuse("asdfgh", 0.99)).kind).toBe("declined");
  });

  it("does not decline on a non-finite probability", () => {
    expect(toCubeResult("gyro", withAbuse("gyro", Number.NaN)).kind).toBe("food");
  });

  it("narrows to a result with no ruling to render", () => {
    expectTypeOf<Extract<CubeResult, { kind: "declined" }>>().toEqualTypeOf<DeclinedResult>();
    expectTypeOf<keyof DeclinedResult>().toEqualTypeOf<"kind" | "item" | "model">();
  });
});

describe("mock abuse trigger", () => {
  it("declines any item containing the trigger word", () => {
    for (const item of [MOCK_DECLINE_TRIGGER, `${MOCK_DECLINE_TRIGGER} sandwich`, "a slur"]) {
      expect(toCubeResult(item, mockCubeResponse(item)).kind, item).toBe("declined");
    }
  });

  it("never declines ordinary mock items", () => {
    for (const item of ["hot dog", "spotted dick", "sloppy joe", "slurpee", "asdfgh", "humans"]) {
      expect(toCubeResult(item, mockCubeResponse(item)).kind, item).not.toBe("declined");
    }
  });
});
