import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { solveChallenge, TURNSTILE_ACTION, TURNSTILE_SCRIPT, type TurnstileApi } from "./challenge";

type Options = Parameters<TurnstileApi["render"]>[1];

const SITE_KEY = "1x00000000000000000000AA";

function fakeTurnstile() {
  const rendered: { container: HTMLElement; options: Options }[] = [];
  const api = {
    render: vi.fn((container: HTMLElement, options: Options) => {
      rendered.push({ container, options });
      return `widget-${rendered.length}`;
    }),
    remove: vi.fn(),
  };
  return { api, rendered, last: () => rendered.at(-1) as (typeof rendered)[number] };
}

const host = () => document.querySelector<HTMLElement>(".challenge");

describe("solveChallenge", () => {
  let turnstile: ReturnType<typeof fakeTurnstile>;

  beforeEach(() => {
    turnstile = fakeTurnstile();
    window.turnstile = turnstile.api;
  });

  afterEach(() => {
    delete window.turnstile;
    for (const script of document.querySelectorAll("script")) script.remove();
    vi.useRealTimers();
  });

  it("renders an interaction-only widget for the session action and resolves its token", async () => {
    const pending = solveChallenge(SITE_KEY);
    await vi.waitFor(() => expect(turnstile.api.render).toHaveBeenCalledTimes(1));
    const { container, options } = turnstile.last();
    expect(options).toMatchObject({
      sitekey: SITE_KEY,
      action: TURNSTILE_ACTION,
      appearance: "interaction-only",
      execution: "render",
      "response-field": false,
      theme: "auto",
    });
    expect(host()?.contains(container)).toBe(true);
    expect(host()?.getAttribute("aria-hidden")).toBe("true");

    options.callback("XXXX.DUMMY.TOKEN.XXXX");
    await expect(pending).resolves.toBe("XXXX.DUMMY.TOKEN.XXXX");
    expect(turnstile.api.remove).toHaveBeenCalledWith("widget-1");
    expect(host()).toBeNull();
  });

  it("shows its copy and takes focus only when Cloudflare asks for a click", async () => {
    document.documentElement.dataset.theme = "dark";
    const pending = solveChallenge(SITE_KEY);
    await vi.waitFor(() => expect(turnstile.api.render).toHaveBeenCalled());
    expect(turnstile.last().options.theme).toBe("dark");
    expect(host()?.dataset.state).toBe("checking");

    turnstile.last().options["before-interactive-callback"]();
    const shown = host();
    expect(shown?.dataset.state).toBe("interactive");
    expect(shown?.hasAttribute("aria-hidden")).toBe(false);
    expect(document.activeElement).toBe(shown);
    expect(shown).toHaveAccessibleName("One quick check");
    expect(shown?.textContent).toContain("Cloudflare Turnstile");

    turnstile.last().options.callback("token");
    await pending;
  });

  it("rejects on a widget error and cleans up", async () => {
    const pending = solveChallenge(SITE_KEY);
    await vi.waitFor(() => expect(turnstile.api.render).toHaveBeenCalled());
    expect(turnstile.last().options["error-callback"]("600010")).toBe(true);
    await expect(pending).rejects.toThrow("error 600010");
    expect(host()).toBeNull();
  });

  it("lets the visitor back out", async () => {
    const pending = solveChallenge(SITE_KEY);
    await vi.waitFor(() => expect(turnstile.api.render).toHaveBeenCalled());
    turnstile.last().options["before-interactive-callback"]();
    host()?.querySelector("button")?.click();
    await expect(pending).rejects.toThrow("cancelled");
    expect(turnstile.api.remove).toHaveBeenCalled();
  });

  it("gives up after two minutes", async () => {
    vi.useFakeTimers();
    const pending = solveChallenge(SITE_KEY);
    const settled = expect(pending).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(120_000);
    await settled;
  });

  it("loads the explicit-render script only when asked, from Cloudflare's exact URL", async () => {
    delete window.turnstile;
    expect(document.querySelector("script")).toBeNull();

    const pending = solveChallenge(SITE_KEY);
    const script = document.querySelector<HTMLScriptElement>("script");
    expect(script?.src).toBe(TURNSTILE_SCRIPT);
    window.turnstile = turnstile.api;
    script?.dispatchEvent(new Event("load"));

    await vi.waitFor(() => expect(turnstile.api.render).toHaveBeenCalled());
    turnstile.last().options.callback("token");
    await expect(pending).resolves.toBe("token");
  });

  it("rejects when the script is blocked, and tries again next time", async () => {
    delete window.turnstile;
    const first = solveChallenge(SITE_KEY);
    document.querySelector("script")?.dispatchEvent(new Event("error"));
    await expect(first).rejects.toThrow("failed to load");
    expect(document.querySelector("script")).toBeNull();

    const second = solveChallenge(SITE_KEY);
    expect(document.querySelectorAll("script")).toHaveLength(1);
    document.querySelector("script")?.dispatchEvent(new Event("error"));
    await expect(second).rejects.toThrow();
  });
});
