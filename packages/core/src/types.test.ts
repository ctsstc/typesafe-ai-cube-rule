import type { SystemOneResult, TypeSafeClient } from "@typesafe-ai/sdk";
import { describe, expectTypeOf, it } from "vitest";
import type { CategoryId, InputKindId, StarchId } from "./categories";
import { mockCubeResponse } from "./mock";
import {
  buildCubeRequest,
  type CubeAnswers,
  type CubeQuestions,
  type CubeResponse,
} from "./questions";
import { type CubeResult, toCubeResult } from "./result";

// These assertions are checked by `pnpm --filter @cube/core typecheck`, not at runtime.
describe("answer types inferred from the questions", () => {
  it("narrows every Choice to its option ids", () => {
    expectTypeOf<CubeAnswers["category"]["choice"]>().toEqualTypeOf<CategoryId>();
    expectTypeOf<CubeAnswers["honorary_category"]["choice"]>().toEqualTypeOf<CategoryId>();
    expectTypeOf<CubeAnswers["starch"]["choice"]>().toEqualTypeOf<StarchId>();
    expectTypeOf<CubeAnswers["input_kind"]["choice"]>().toEqualTypeOf<InputKindId>();
    expectTypeOf<keyof CubeAnswers["category"]["probabilities"]>().toEqualTypeOf<CategoryId>();
  });

  it("types Nouls and the Score", () => {
    expectTypeOf<CubeAnswers["is_wet"]["noul"]>().toEqualTypeOf<number>();
    expectTypeOf<CubeAnswers["starch_side_wall"]["type"]>().toEqualTypeOf<"noul">();
    expectTypeOf<keyof CubeAnswers["debate_heat"]["probabilities"]>().toEqualTypeOf<
      "0" | "1" | "2" | "3"
    >();
  });

  it("rejects options that do not exist", () => {
    // @ts-expect-error pizza is not a category option
    expectTypeOf<CubeAnswers["category"]["probabilities"]["pizza"]>().toBeNumber();
  });

  it("accepts a live SDK result and the mock as a CubeResponse", () => {
    expectTypeOf<
      Pick<SystemOneResult<CubeQuestions>, "model" | "answers">
    >().toEqualTypeOf<CubeResponse>();
    expectTypeOf(mockCubeResponse).returns.toEqualTypeOf<CubeResponse>();
    const live = async (client: TypeSafeClient, item: string): Promise<CubeResult> => {
      const { model, answers } = await client.systemOne(buildCubeRequest(item));
      return toCubeResult(item, { model, answers });
    };
    expectTypeOf(live).returns.resolves.toEqualTypeOf<CubeResult>();
  });
});
