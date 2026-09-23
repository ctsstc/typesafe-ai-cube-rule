import { classifyUrl, PREFETCH_HEADER } from "@cube/core";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearClassifyCache } from "../lib/api";
import { solveChallenge } from "../lib/challenge";
import { FoodLink } from "./FoodForm";

vi.mock("../lib/challenge", () => ({ solveChallenge: vi.fn() }));

describe("FoodLink", () => {
  beforeEach(() => {
    clearClassifyCache();
    vi.useFakeTimers();
    vi.stubEnv("VITE_TURNSTILE_SITE_KEY", "1x00000000000000000000AA");
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("prefetches on focus without starting the human check", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { code: "challenge_required", message: "check" } }), {
          status: 401,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const onPick = vi.fn();
    render(<FoodLink item="cheesecake" onPick={onPick} />);

    fireEvent.focus(screen.getByRole("link", { name: "cheesecake" }));
    await act(() => vi.advanceTimersByTimeAsync(200));

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      classifyUrl("cheesecake"),
      expect.objectContaining({ headers: expect.objectContaining({ [PREFETCH_HEADER]: "1" }) }),
    );
    expect(solveChallenge).not.toHaveBeenCalled();
    expect(document.querySelector(".challenge")).toBeNull();
    expect(onPick).not.toHaveBeenCalled();
  });
});
