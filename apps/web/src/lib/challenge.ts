import "./challenge.css";

// Must be loaded from this exact URL. Cloudflare warns that proxied or cached copies break.
export const TURNSTILE_SCRIPT =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
export const TURNSTILE_ACTION = "session";
const SOLVE_TIMEOUT_MS = 120_000;

interface RenderOptions {
  sitekey: string;
  action: string;
  appearance: "interaction-only";
  execution: "render";
  retry: "never";
  size: "flexible" | "compact";
  theme: "auto" | "light" | "dark";
  "response-field": false;
  callback: (token: string) => void;
  "error-callback": (code: string) => boolean;
  "unsupported-callback": () => void;
  "before-interactive-callback": () => void;
}

export interface TurnstileApi {
  render(container: HTMLElement, options: RenderOptions): string | null | undefined;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export class ChallengeError extends Error {
  override name = "ChallengeError";
}

let loading: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT;
    script.async = true;
    script.onload = () =>
      window.turnstile
        ? resolve(window.turnstile)
        : reject(new ChallengeError("Turnstile loaded without its API"));
    script.onerror = () => {
      script.remove();
      reject(new ChallengeError("Turnstile failed to load"));
    };
    document.head.append(script);
  }).finally(() => {
    loading = null;
  });
  return loading;
}

// The flexible widget needs 300px, which a 320px phone cannot spare inside the card.
function sizeFor(): RenderOptions["size"] {
  return window.matchMedia("(max-width: 379px)").matches ? "compact" : "flexible";
}

function themeFor(root: HTMLElement): RenderOptions["theme"] {
  const theme = root.dataset.theme;
  return theme === "light" || theme === "dark" ? theme : "auto";
}

interface Host {
  readonly slot: HTMLElement;
  readonly cancel: HTMLButtonElement;
  interactive(): void;
  remove(): void;
}

// Stays invisible while Cloudflare checks in the background. It only shows its copy and the
// widget when Cloudflare asks for a click.
function mountHost(): Host {
  const root = document.createElement("section");
  root.className = "challenge";
  root.dataset.state = "checking";
  root.setAttribute("aria-labelledby", "challenge-title");
  root.setAttribute("aria-hidden", "true");
  root.tabIndex = -1;

  const title = document.createElement("h2");
  title.id = "challenge-title";
  title.className = "challenge__title";
  title.textContent = "One quick check";

  const body = document.createElement("p");
  body.className = "challenge__body";
  body.textContent =
    "Each new food costs real money to ask Jev about, so Cloudflare Turnstile checks that a person is asking. Foods someone already asked about usually skip this.";

  const slot = document.createElement("div");
  slot.className = "challenge__widget";

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "button button--ghost challenge__cancel";
  cancel.textContent = "Not now";

  root.append(title, body, slot, cancel);
  document.body.append(root);

  return {
    slot,
    cancel,
    interactive() {
      root.dataset.state = "interactive";
      root.removeAttribute("aria-hidden");
      root.focus({ preventScroll: true });
    },
    remove: () => root.remove(),
  };
}

/** Runs one interaction-only Turnstile widget and resolves with its single-use token. */
export async function solveChallenge(sitekey: string): Promise<string> {
  const turnstile = await loadTurnstile();
  const host = mountHost();
  let widgetId: string | null | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const finish = (outcome: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (widgetId) turnstile.remove(widgetId);
      host.remove();
      outcome();
    };
    const fail = (reason: string) => finish(() => reject(new ChallengeError(reason)));

    timer = setTimeout(() => fail("timed out"), SOLVE_TIMEOUT_MS);
    host.cancel.addEventListener("click", () => fail("cancelled"));
    try {
      widgetId = turnstile.render(host.slot, {
        sitekey,
        action: TURNSTILE_ACTION,
        appearance: "interaction-only",
        execution: "render",
        retry: "never",
        size: sizeFor(),
        theme: themeFor(document.documentElement),
        "response-field": false,
        callback: (token) => finish(() => resolve(token)),
        "error-callback": (code) => {
          fail(`error ${code}`);
          return true;
        },
        "unsupported-callback": () => fail("unsupported browser"),
        "before-interactive-callback": () => host.interactive(),
      });
    } catch (error) {
      fail(error instanceof Error ? error.message : "render failed");
    }
  });
}
