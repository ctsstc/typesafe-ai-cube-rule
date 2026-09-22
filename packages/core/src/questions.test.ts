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
  "2": "8510ae891b2cc7ebcf5cd58d4f590f73c05afd2a82de3cd5d472a53e1475e620",
  "3": "c42d0e7e0f00d3c24b07a10d2583f583e42a5cc6eb9c6efa1baeda1675dde90b",
  "4": "14fed537b0b04ec38f84e94ad339b4850c91966fd7d63137fd7578d39a5ff118",
  "5": "61d9417f49a8dbcf681c6de702b71251e5f7443b1eeae8aa66489dc486d2ce52",
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

  // The limits are in tokens. Characters always outnumber tokens, so this is a conservative proxy.
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
      "is_abusive:noul",
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
