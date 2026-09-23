import { mockCubeResponse } from "@cube/core";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { clearClassifyCache } from "../lib/api";
import { useOracle } from "./useOracle";

vi.mock("@cube/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@cube/core")>()),
  toCubeResult: () => {
    throw new TypeError("Cannot read properties of undefined (reading 'score')");
  },
}));

beforeEach(() => clearClassifyCache());

it("shows an error instead of loading forever when a ruling cannot be read", async () => {
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify(mockCubeResponse("taco"))));
  const { result } = renderHook(() => useOracle());
  act(() => result.current.rule("taco", "typed"));
  await waitFor(() => expect(result.current.state.status).toBe("error"));

  act(() => result.current.rule("taco", "typed"));
  expect(result.current.state).toMatchObject({ status: "error", error: { code: "internal" } });
});
