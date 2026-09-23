import { disabledListsResponse } from "@cube/core";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearDocketCache } from "../lib/docket";
import { entry, FULL_LISTS, listsBody } from "../test/lists";
import { Docket } from "./Docket";

function serve(body: unknown, status = 200) {
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function renderDocket(onPick = vi.fn()) {
  const view = render(<Docket onPick={onPick} />);
  return { ...view, onPick, region: await screen.findByRole("region", { name: "The docket" }) };
}

/** Renders and waits for the one request to settle, for states that should show nothing. */
async function renderHidden(fetchMock: ReturnType<typeof vi.fn>) {
  const { container } = render(<Docket onPick={vi.fn()} />);
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  await new Promise((resolve) => setTimeout(resolve, 20));
  return container;
}

const list = (region: HTMLElement, name: string) => within(region).getByRole("list", { name });

describe("The docket", () => {
  beforeEach(() => clearDocketCache());
  afterEach(() => clearDocketCache());

  it("shows all four lists and the activity line when the court is busy", async () => {
    serve(listsBody());
    const { region } = await renderDocket();
    expect(within(region).getByRole("heading", { level: 2 })).toHaveTextContent("The docket");
    expect(
      within(region)
        .getAllByRole("heading", { level: 3 })
        .map((h) => h.textContent),
    ).toEqual(["Latest rulings", "Most debated", "Jev vs the canon", "Friendship-ending"]);
    expect(region).toHaveTextContent("14 new foods ruled in the last hour.");

    expect(
      within(list(region, "Most debated")).getByRole("link", { name: "Gyro: taco or sushi" }),
    ).toHaveAttribute("href", "/?food=gyro");
    expect(
      within(list(region, "Jev vs the canon")).getByRole("link", {
        name: "Big mac: Canon: cake, Jev: sandwich",
      }),
    ).toHaveAttribute("href", "/?food=big+mac");
    expect(
      within(list(region, "Friendship-ending")).getByRole("link", {
        name: "Hot dog: Debate: Friendship-ending",
      }),
    ).toBeInTheDocument();
    expect(
      within(list(region, "Latest rulings")).getByRole("link", { name: "Ramen: wet nachos" }),
    ).toBeInTheDocument();
  });

  it("never shows a time", async () => {
    serve(listsBody());
    const { region } = await renderDocket();
    expect(region.textContent).not.toMatch(/\bago\b|\d{1,2}:\d{2}|yesterday|today|minutes?\b/i);
    expect(region.querySelector("time")).toBeNull();
  });

  it("rules on a food through the app on a plain click and leaves other clicks to the browser", async () => {
    serve(listsBody());
    const { region, onPick } = await renderDocket();
    const link = within(list(region, "Most debated")).getByRole("link", { name: /^Quesadilla/ });
    const handledByApp: boolean[] = [];
    const lastListener = (event: MouseEvent) => {
      handledByApp.push(event.defaultPrevented);
      event.preventDefault();
    };
    window.addEventListener("click", lastListener);
    fireEvent.click(link);
    fireEvent.click(link, { metaKey: true });
    window.removeEventListener("click", lastListener);
    expect(handledByApp).toEqual([true, false]);
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith("quesadilla");
  });

  it("marks honorary rulings, in words a screen reader reads too", async () => {
    serve(listsBody());
    const { region } = await renderDocket();
    const canoe = within(list(region, "Most debated")).getByRole("link", {
      name: "Canoe, Honorary: taco or sushi",
    });
    expect(within(canoe).getByText("Honorary")).toHaveClass("docket__honorary");
    const gyro = within(list(region, "Most debated")).getByRole("link", { name: /^Gyro/ });
    expect(within(gyro).queryByText("Honorary")).not.toBeInTheDocument();
    expect(region.querySelectorAll(".docket__honorary")).toHaveLength(2);
  });

  it("hides short lists and the activity line when there is little to show", async () => {
    serve(
      listsBody(
        {
          ...FULL_LISTS,
          jevDissents: FULL_LISTS.jevDissents.slice(0, 2),
          friendshipEnding: [],
        },
        null,
      ),
    );
    const { region } = await renderDocket();
    expect(
      within(region)
        .getAllByRole("heading", { level: 3 })
        .map((h) => h.textContent),
    ).toEqual(["Latest rulings", "Most debated"]);
    expect(region).not.toHaveTextContent(/in the last hour/);
  });

  it("never renders a declined ruling, even if the server sends one", async () => {
    serve(
      listsBody({
        latest: [
          entry("gyro"),
          { ...entry("some nasty words"), kind: "declined" },
          entry("ramen"),
          entry("flan"),
        ],
      }),
    );
    const { region } = await renderDocket();
    expect(within(region).getAllByRole("link")).toHaveLength(3);
    expect(document.body).not.toHaveTextContent(/nasty/);
  });

  it.each([
    ["every list is empty", () => serve(listsBody({}, { newFoodsLastHour: 30 }))],
    ["the lists are switched off", () => serve(disabledListsResponse())],
    ["the server fails", () => serve({ error: { code: "internal", message: "no" } }, 500)],
    [
      "the network fails",
      () => {
        const fetchMock = vi.fn(async () => Promise.reject(new TypeError("offline")));
        vi.stubGlobal("fetch", fetchMock);
        return fetchMock;
      },
    ],
  ])("renders nothing when %s", async (_state, stub) => {
    const container = await renderHidden(stub());
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("region", { name: "The docket" })).not.toBeInTheDocument();
  });

  it("has list semantics, named links and no axe violations", async () => {
    serve(listsBody());
    const { region } = await renderDocket();
    for (const ol of within(region).getAllByRole("list")) {
      expect(ol.tagName).toBe("OL");
      expect(ol).toHaveAccessibleName();
    }
    const results = await axe.run(document.body, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});
