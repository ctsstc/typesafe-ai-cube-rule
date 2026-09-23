import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";

const hasDom = typeof window !== "undefined";

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (!hasDom) return;
  const { cleanup } = await import("@testing-library/react");
  cleanup();
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
});

if (hasDom) {
  // Lazy sections (How Jev rules, About, the docket) can take over the default 1s to load while
  // the whole suite runs in parallel, which made findBy and waitFor calls fail at random.
  const { configure } = await import("@testing-library/react");
  configure({ asyncUtilTimeout: 5000 });
  window.matchMedia ??= (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
  Element.prototype.scrollIntoView ??= () => {};
}
