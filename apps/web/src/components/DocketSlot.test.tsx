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

  report(isIntersecting: boolean) {
    const entries = this.targets.map((target) => ({ target, isIntersecting }));
    act(() => this.callback(entries as IntersectionObserverEntry[], this as never));
  }
}

function serve() {
  const fetchMock = vi.fn(async (url: string) => {
    const parsed = new URL(url, location.origin);
    const body =
      parsed.pathname === LISTS_PATH
        ? listsBody()
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

  it("asks for the lists only once the reader scrolls near, below the viewport only", async () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    const fetchMock = serve();
    render(<App />);
    await screen.findByRole("region", { name: "How Jev rules" });
    const observer = FakeObserver.last;
    if (!observer) throw new Error("no observer");
    expect(observer.options.rootMargin).toBe("0px 0px 600px 0px");

    observer.report(false);
    expect(listCalls(fetchMock)).toEqual([]);

    observer.report(true);
    const docket = await screen.findByRole("region", { name: "The docket" });
    expect(listCalls(fetchMock)).toHaveLength(1);
    expect(observer.disconnected).toBe(true);

    const gallery = screen.getByRole("region", { name: "The nine cubes" });
    const jev = screen.getByRole("region", { name: "How Jev rules" });
    expect(gallery.compareDocumentPosition(docket) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(docket.compareDocumentPosition(jev) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("rules on a listed food through the normal flow", async () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    const fetchMock = serve();
    render(<App />);
    FakeObserver.last?.report(true);
    const docket = await screen.findByRole("region", { name: "The docket" });
    const list = within(docket).getByRole("list", { name: "Most debated" });
    fireEvent.click(within(list).getByRole("link", { name: /^Gyro/ }));
    expect(await screen.findByRole("heading", { level: 1, name: /^Gyro: / })).toBeVisible();
    expect(location.search).toBe("?food=gyro");
    expect(fetchMock).toHaveBeenCalledWith(classifyUrl("gyro"), expect.anything());
  });
});
