import { safeStorage } from "./storage";

export type ThemePref = "system" | "light" | "dark";

// index.html reads this key in its inline bootstrap script before first paint.
export const THEME_KEY = "cro.v1.theme";

const THEME_COLORS = { light: "#fbf6ec", dark: "#17120d" } as const;

export function readThemePref(): ThemePref {
  const stored = safeStorage.get(THEME_KEY);
  return stored === "light" || stored === "dark" ? stored : "system";
}

export function nextThemePref(pref: ThemePref): ThemePref {
  return pref === "system" ? "light" : pref === "light" ? "dark" : "system";
}

export function applyThemePref(pref: ThemePref): void {
  const root = document.documentElement;
  if (pref === "system") delete root.dataset.theme;
  else root.dataset.theme = pref;
  safeStorage.set(THEME_KEY, pref === "system" ? null : pref);
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const scheme = meta.media.includes("dark") ? "dark" : "light";
    meta.content = THEME_COLORS[pref === "system" ? scheme : pref];
  }
}
