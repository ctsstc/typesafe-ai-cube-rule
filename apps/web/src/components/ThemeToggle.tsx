import { useState } from "react";
import { applyThemePref, nextThemePref, readThemePref, type ThemePref } from "../lib/theme";
import { MoonIcon, SunIcon, SystemIcon } from "./Icons";

const ICONS = { system: SystemIcon, light: SunIcon, dark: MoonIcon } as const;

export function ThemeToggle() {
  const [pref, setPref] = useState<ThemePref>(readThemePref);
  const next = nextThemePref(pref);
  const Icon = ICONS[pref];
  return (
    <button
      type="button"
      className="icon-button"
      aria-label={`Theme: ${pref}. Switch to ${next}.`}
      title={`Theme: ${pref}`}
      onClick={() => {
        applyThemePref(next);
        setPref(next);
      }}
    >
      <Icon />
    </button>
  );
}
