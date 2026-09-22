import { createHash } from "node:crypto";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { describe, expect, it } from "vitest";
import { mockCubeResponse } from "./mock";
import {
  buildCubeQuestions,
  buildCubeRequest,
  CUBE_MODEL,
  QUESTION_SET_VERSION,
} from "./questions";
import { toCubeResult } from "./result";

// One entry per QUESTION_SET_VERSION. Never edit a recorded hash: bump the version and add a line.
const REQUEST_FINGERPRINTS: Readonly<Record<string, string>> = {
  "1": "6ba7b6e0c52da7bf68379c83ef94ba33b88bd6b4c4b4ecdebf1a8de2cb9f6dda",
};

const sha256 = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

describe("question set fingerprint", () => {
  it("changes only together with QUESTION_SET_VERSION", () => {
    const actual = sha256(buildCubeRequest("x"));
    expect(
      actual,
      `The Jev request changed. Bump QUESTION_SET_VERSION and record "${actual}" for it.`,
    ).toBe(REQUEST_FINGERPRINTS[QUESTION_SET_VERSION]);
  });

  it("never reuses a fingerprint across versions", () => {
    const hashes = Object.values(REQUEST_FINGERPRINTS);
    expect(new Set(hashes).size).toBe(hashes.length);
  });
});

describe("buildCubeRequest", () => {
  it("pins the model and sends the item as the only state", () => {
    const request = buildCubeRequest("hot dog");
    expect(request.model).toBe(CUBE_MODEL);
    expect(request.state).toEqual({ item: "hot dog" });
  });

  it("stays well inside the API size budgets", () => {
    const request = buildCubeRequest("x".repeat(60));
    const longest = Math.max(
      ...Object.values(request.questions).map((q) => JSON.stringify(q).length),
    );
    expect(JSON.stringify(request.state).length + longest).toBeLessThan(32_000);
    expect(JSON.stringify(request).length).toBeLessThan(64_000);
  });

  it("builds identical questions on every call", () => {
    expect(buildCubeQuestions()).toEqual(buildCubeQuestions());
  });
});

describe("TypeSafeClient round trip with a fake fetch", () => {
  it("validates the request and maps the typed answers", async () => {
    let sent: { model?: string; state?: unknown; questions?: Record<string, { type: string }> } =
      {};
    const client = new TypeSafeClient({
      apiKey: "test-key-not-real",
      retry: { maxRetries: 0 },
      fetch: async (_url, init) => {
        sent = JSON.parse(String(init?.body));
        const body = {
          ...mockCubeResponse("hot dog"),
          model: CUBE_MODEL,
          usage: { input_tokens: 1, output_tokens: 1 },
        };
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });

    const live = await client.systemOne(buildCubeRequest("hot dog"));

    expect(sent.model).toBe(CUBE_MODEL);
    expect(sent.state).toEqual({ item: "hot dog" });
    expect(Object.entries(sent.questions ?? {}).map(([id, q]) => `${id}:${q.type}`)).toEqual([
      "input_kind:choice",
      "category:choice",
      "honorary_category:choice",
      "starch:choice",
      "is_wet:noul",
      "starch_base:noul",
      "starch_lid:noul",
      "starch_side_wall:noul",
      "starch_opposite_walls:noul",
      "starch_all_walls:noul",
      "starch_middle_layer:noul",
      "starch_loose_pieces:noul",
      "starch_block:noul",
      "varies_by_serving:noul",
      "debate_heat:score",
    ]);
    expect(toCubeResult("hot dog", live).kind).toBe("food");
  });
});
