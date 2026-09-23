import type { CubeResult } from "@cube/core";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActiveState, Origin } from "../hooks/useOracle";
import { type Classified, RulingError, type RulingErrorCode } from "../lib/api";
import { response, scenarios } from "../test/fixtures";
import { AnnouncerProvider } from "./Announcer";
import { REVEAL_MS, RulingCard } from "./RulingCard";

function done(result: CubeResult, origin: Origin = "typed", mock = false): ActiveState {
  const meta: Classified = {
    response: response(result.item, {}, mock),
    latencyMs: 42,
    cache: "HIT",
    fromBrowserCache: false,
  };
  return { id: 1, item: result.item, origin, status: "done", result, meta };
}

function failed(code: RulingErrorCode, retryAfter: number | null = null): ActiveState {
  return {
    id: 1,
    item: "hot dog",
    origin: "typed",
    status: "error",
    error: new RulingError(code, retryAfter),
  };
}

function renderCard(state: ActiveState, level?: 1 | 2) {
  const handlers = { onRetry: vi.fn(), onEdit: vi.fn(), onCubeAnother: vi.fn() };
  const view = render(
    <AnnouncerProvider>
      <RulingCard state={state} level={level} {...handlers} />
    </AnnouncerProvider>,
  );
  return { ...view, ...handlers };
}

async function expectNoAxeViolations(container: HTMLElement) {
  const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

const heading = () => screen.getByRole("heading", { level: 2 });

describe("RulingCard", () => {
  afterEach(() => vi.useRealTimers());

  it("rules a unanimous food with the cube, stamp, and all nine odds", async () => {
    const { container } = renderCard(done(scenarios.unanimous()));
    expect(heading()).toHaveAccessibleName("Sloppy joe: Definitely a sandwich.");
    expect(screen.getByRole("img")).toHaveAccessibleName(
      "Cube diagram, Sandwich: starch on the top and bottom. The left side, right side, front end and back end are open.",
    );
    const odds = screen.getByRole("list", { name: "Jev's probabilities, highest first" });
    const rows = within(odds).getAllByRole("listitem");
    expect(rows).toHaveLength(9);
    expect(rows[0]).toHaveTextContent("Sandwich97%");
    expect(screen.getByText(/Jev is sure|No notes|didn't even blink/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Share ruling" })).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it("leads the page as an h1 with its sections one level down", async () => {
    const { container } = renderCard(done(scenarios.honorary(), "link"), 1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveAccessibleName(
      "Canoe: Not food. Probably.",
    );
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      "If it were food: Jev's probabilities",
    );
    await expectNoAxeViolations(container);
  });

  it("falls back to the starch family on a split ruling", async () => {
    const { container } = renderCard(done(scenarios.splitFamily()));
    expect(heading()).toHaveAccessibleName("Gyro: Arguably a taco.");
    expect(screen.getByText(/shell/i)).toBeInTheDocument();
    expect(screen.getByText("Taco?")).toBeInTheDocument();
    expect(screen.getByText("Sushi?")).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it("shows the canon ruling with Jev's dissent", async () => {
    const { container } = renderCard(done(scenarios.officialDissent()));
    expect(heading()).toHaveAccessibleName("Cheesecake: Officially a quiche.");
    expect(screen.getByText(/Jev dissents/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "cuberule.com" })).toHaveAttribute(
      "href",
      "https://cuberule.com/",
    );
    expect(screen.getByText("Name trap: cake")).toBeInTheDocument();
    const odds = screen.getByRole("list", { name: "Jev's probabilities, highest first" });
    expect(within(odds).getByText(/canon/)).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it("gives things that are not food an honorary ruling", async () => {
    const { container } = renderCard(done(scenarios.honorary()));
    expect(heading()).toHaveAccessibleName("Canoe: Not food. Probably.");
    expect(screen.getByText("If it were food, it would probably be a taco.")).toBeInTheDocument();
    expect(
      screen.getByRole("list", { name: "If it were food: Jev's probabilities" }),
    ).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it("calls nonsense uncubeable without odds or sharing", async () => {
    const { container } = renderCard(done(scenarios.nonsense()));
    expect(heading()).toHaveAccessibleName("Qwzx plorf: Uncubeable.");
    expect(screen.queryByRole("list", { name: /probabilities/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Share ruling" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cube another" })).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it("declines abusive text without ever echoing it", async () => {
    const declined = scenarios.declined();
    const { container } = renderCard(done(declined, "link"));
    expect(heading()).toHaveAccessibleName("Jev declines to cube that.");
    expect(container).not.toHaveTextContent(/slur|awful/i);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /share|copy/i })).not.toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it("does not echo a deep-linked food while it is still loading", () => {
    const { container } = renderCard({
      id: 1,
      item: "awful words",
      origin: "link",
      status: "loading",
    });
    expect(heading()).toHaveAccessibleName("Consulting the cube");
    expect(container).not.toHaveTextContent("awful");
    expect(screen.getByRole("img")).toHaveAccessibleName("Empty cube with no starch marked yet.");
  });

  it("marks simulated rulings", () => {
    renderCard(done(scenarios.unanimous(), "typed", true));
    expect(screen.getAllByText("Simulated").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("mock")).toBeInTheDocument();
  });

  it("moves focus to a typed ruling once the reveal ends, but not to a deep link", () => {
    vi.useFakeTimers();
    const typed = renderCard(done(scenarios.unanimous(), "typed"));
    act(() => vi.advanceTimersByTime(REVEAL_MS));
    expect(heading()).toHaveFocus();
    typed.unmount();

    renderCard(done(scenarios.unanimous(), "link"));
    act(() => vi.advanceTimersByTime(REVEAL_MS));
    expect(heading()).not.toHaveFocus();
  });
});

describe("RulingCard errors", () => {
  afterEach(() => vi.useRealTimers());

  it("counts down a 429 and never retries on its own", () => {
    vi.useFakeTimers();
    const { onRetry } = renderCard(failed("rate_limited", 3));
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent(
      "Too many cubes in the oven.",
    );
    expect(screen.getByRole("button", { name: "Try again in 3s" })).toBeDisabled();
    act(() => vi.advanceTimersByTime(3500));
    const retry = screen.getByRole("button", { name: "Try again" });
    expect(retry).toBeEnabled();
    expect(onRetry).not.toHaveBeenCalled();
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["upstream_busy", "The oracle is overheated."],
    ["upstream_error", "Something broke on our side."],
    ["internal", "Something broke on our side."],
    ["timeout", "Jev is thinking unusually hard."],
    ["network", "Couldn't reach the oracle."],
  ] as const)("explains %s with a retry", async (code, title) => {
    const { container, onRetry } = renderCard(failed(code));
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent(title);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalled();
    await expectNoAxeViolations(container);
  });

  it("waits for the connection before offering a retry offline", () => {
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    renderCard(failed("offline"));
    expect(screen.getByRole("button", { name: "Waiting for a connection" })).toBeDisabled();
    online.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
  });

  it("sends a bad request back to the input", () => {
    const { onEdit } = renderCard(failed("bad_request"));
    fireEvent.click(screen.getByRole("button", { name: "Edit the food" }));
    expect(onEdit).toHaveBeenCalled();
  });
});
