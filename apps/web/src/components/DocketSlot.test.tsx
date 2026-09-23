import { classifyUrl, LISTS_PATH, listsUrl } from "@cube/core";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { clearClassifyCache } from "../lib/api";
import { clearDocketCache } from "../lib/docket";
import { response } from "../test/fixtures";
import { listsBody } from "../test/lists";

class FakeObserver {
  static last: FakeObserver | null = null;
  readonly targets: Element[] = [];
  disconnected = false;

  constructor(
    readonly callback: IntersectionObserverCallback,
    readonly options: IntersectionObserverInit = {},
  ) {
    FakeObserver.last = this;
  }

  observe(target: Element) {
    this.targets.push(target);
  }

  disconnect() {
    this.disconnected = true;
  }

  /** `top` is the slot's distance from the top of a 768px viewport. */
  report(top: number) {
    const [topMargin = "0px", , bottomMargin = "0px"] = (this.options.rootMargin ?? "").split(" ");
    const px = (margin: string) =>
      margin.endsWith("%")
        ? (Number.parseFloat(margin) / 100) * VIEWPORT
        : Number.parseFloat(margin);
    const rootBounds = { top: -px(topMargin), bottom: VIEWPORT + px(bottomMargin) };
    const entries = this.targets.map((target) => ({
      target,
      isIntersecting: top >= rootBounds.top && top <= rootBounds.bottom,
      boundingClientRect: { top },
      rootBounds,
    }));
    act(() => this.callback(entries as unknown as IntersectionObserverEntry[], this as never));
  }
}

const VIEWPORT = 768;
const ABOVE_BAND = 16;
const IN_BAND = 900;
const BELOW_BAND = 3000;

function serve(lists: Promise<unknown> = Promise.resolve(listsBody())) {
  const fetchMock = vi.fn(async (url: string) => {
    const parsed = new URL(url, location.origin);
    const body =
      parsed.pathname === LISTS_PATH
        ? await lists
        : response(parsed.searchParams.get("food") ?? "");
    return new Response(JSON.stringify(body), {
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const listCalls = (fetchMock: ReturnType<typeof serve>) =>
  fetchMock.mock.calls.filter(([url]) => url === listsUrl());

describe("the docket slot", () => {
  beforeEach(() => {
    clearClassifyCache();
    clearDocketCache();
    FakeObserver.last = null;
    history.replaceState(null, "", "/");
  });
  afterEach(() => {
    clearDocketCache();
    history.replaceState(null, "", "/");
  });

  it("never loads without IntersectionObserver", async () => {
    const fetchMock = serve();
    render(<App />);
    await screen.findByRole("region", { name: "How Jev rules" });
    expect(listCalls(fetchMock)).toEqual([]);
    expect(screen.queryByRole("region", { name: "The docket" })).not.toBeInTheDocument();
  });

  it("asks for the lists only once the slot nears the lower half of the viewport", async () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    const fetchMock = serve();
    render(<App />);
    await screen.findByRole("region", { name: "How Jev rules" });
    const observer = FakeObserver.last;
    if (!observer) throw new Error("no observer");
    expect(observer.options.rootMargin).toBe("-50% 0px 600px 0px");

    observer.report(BELOW_BAND);
    expect(listCalls(fetchMock)).toEqual([]);

    observer.report(IN_BAND);
    const docket = await screen.findByRole("region", { name: "The docket" });
    expect(listCalls(fetchMock)).toHaveLength(1);
    await vi.waitFor(() => expect(observer.disconnected).toBe(true));

    const gallery = screen.getByRole("region", { name: "The nine cubes" });
    const jev = screen.getByRole("region", { name: "How Jev rules" });
    expect(gallery.compareDocumentPosition(docket) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(docket.compareDocumentPosition(jev) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("never loads above a section a hash link scrolled to", async () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    const fetchMock = serve();
    render(<App />);
    await screen.findByRole("region", { name: "How Jev rules" });
    FakeObserver.last?.report(ABOVE_BAND);
    await act(() => new Promise((settled) => setTimeout(settled, 200)));
    expect(listCalls(fetchMock)).toEqual([]);
    expect(screen.queryByRole("region", { name: "The docket" })).not.toBeInTheDocument();
  });

  it("holds lists that arrive after the reader scrolled past, until the slot is below again", async () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    let answer: (body: unknown) => void = () => {};
    const fetchMock = serve(new Promise((resolve) => (answer = resolve)));
    render(<App />);
    await screen.findByRole("region", { name: "How Jev rules" });
    const observer = FakeObserver.last;
    if (!observer) throw new Error("no observer");

    observer.report(IN_BAND);
    await vi.waitFor(() => expect(listCalls(fetchMock)).toHaveLength(1));
    observer.report(ABOVE_BAND);
    await act(async () => answer(listsBody()));
    expect(screen.queryByRole("region", { name: "The docket" })).not.toBeInTheDocument();
    expect(observer.disconnected).toBe(false);

    observer.report(BELOW_BAND);
    expect(await screen.findByRole("region", { name: "The docket" })).toBeInTheDocument();
    expect(listCalls(fetchMock)).toHaveLength(1);
  });

  it("rules on a listed food through the normal flow", async () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    const fetchMock = serve();
    render(<App />);
    FakeObserver.last?.report(IN_BAND);
    const docket = await screen.findByRole("region", { name: "The docket" });
    const list = within(docket).getByRole("list", { name: "Most debated" });
    fireEvent.click(within(list).getByRole("link", { name: /^Gyro/ }));
    expect(await screen.findByRole("heading", { level: 1, name: /^Gyro: / })).toBeVisible();
    expect(location.search).toBe("?food=gyro");
    expect(fetchMock).toHaveBeenCalledWith(classifyUrl("gyro"), expect.anything());
  });
});
