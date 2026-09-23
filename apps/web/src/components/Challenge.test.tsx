import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { clearClassifyCache } from "../lib/api";
import type { TurnstileApi } from "../lib/challenge";
import { STILL_THINKING, WAITING_FOR_CHECK } from "../lib/copy";

type Options = Parameters<TurnstileApi["render"]>[1];

describe("the human check inside the app", () => {
  let options: Options | undefined;

  beforeEach(() => {
    clearClassifyCache();
    history.replaceState(null, "", "/");
    vi.stubEnv("VITE_TURNSTILE_SITE_KEY", "3x00000000000000000000FF");
    options = undefined;
    window.turnstile = {
      render: vi.fn((_container: HTMLElement, next: Options) => {
        options = next;
        return "widget-1";
      }),
      remove: vi.fn(),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ error: { code: "challenge_required", message: "check" } }),
            {
              status: 401,
            },
          ),
      ),
    );
  });

  afterEach(() => {
    delete window.turnstile;
    vi.unstubAllEnvs();
    vi.useRealTimers();
    history.replaceState(null, "", "/");
  });

  async function showCheck() {
    render(<App />);
    fireEvent.change(screen.getByRole("textbox", { name: "Name a food" }), {
      target: { value: "kimchi taco" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cube it" }));
    await waitFor(() => expect(options).toBeDefined());
    act(() => options?.["before-interactive-callback"]());
    expect(document.activeElement).toHaveAccessibleName("One quick check");
  }

  it("waits for the check instead of blaming Jev for the wait", async () => {
    await showCheck();
    vi.useFakeTimers({ toFake: ["setInterval", "Date"] });
    act(() => vi.advanceTimersByTime(5_000));
    const card = document.querySelector(".ruling");
    expect(card).toHaveTextContent(WAITING_FOR_CHECK);
    expect(card).not.toHaveTextContent(STILL_THINKING);
  });

  it("brings focus back to the ruling and says the check was skipped after Not now", async () => {
    await showCheck();
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(await screen.findByText("Skipped the quick check.")).toBeVisible();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1 })),
    );
    expect(screen.queryByText("Couldn't confirm you're human.")).not.toBeInTheDocument();
  });

  it("drops the check when the visitor goes back home", async () => {
    await showCheck();
    act(() => {
      history.back();
    });
    await waitFor(() => expect(document.querySelector(".challenge")).toBeNull());
    expect(location.search).toBe("");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
