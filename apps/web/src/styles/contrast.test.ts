// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrastRatio, parseTokens, type Theme } from "../lib/contrast";
import { THEME_KEY } from "../lib/theme";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const css = read("./tokens.css");
const html = read("../../index.html");

const palette = parseTokens(css);

const TEXT = 4.5;
const GRAPHIC = 3;

// [foreground, background, minimum ratio]
const PAIRS: ReadonlyArray<readonly [string, string, number]> = [
  ["text", "bg", TEXT],
  ["text", "surface", TEXT],
  ["text", "surface-2", TEXT],
  ["text-muted", "bg", TEXT],
  ["text-muted", "surface", TEXT],
  ["text-muted", "surface-2", TEXT],
  ["accent", "bg", TEXT],
  ["accent", "surface", TEXT],
  ["accent", "surface-2", TEXT],
  ["accent-hover", "surface", TEXT],
  ["accent-ink", "accent", TEXT],
  ["accent-ink", "accent-hover", TEXT],
  ["danger", "surface", TEXT],
  ["success", "surface", TEXT],
  ["warn-text", "warn-bg", TEXT],
  ["text", "warn-bg", TEXT],
  ["bg", "text", TEXT],
  ["control", "bg", GRAPHIC],
  ["control", "surface", GRAPHIC],
  ["focus", "bg", GRAPHIC],
  ["focus", "surface", GRAPHIC],
  ["accent", "bar-track", GRAPHIC],
  ["bar", "bar-track", GRAPHIC],
];

// Starch faces are outlined by their crust in light mode and by the crumb itself in dark mode.
const FACE_EDGE: Record<Theme, string> = { light: "crust", dark: "crumb" };

describe("design tokens", () => {
  it("declares every color for both themes", () => {
    expect(Object.keys(palette.light).length).toBeGreaterThan(20);
    expect(Object.keys(palette.dark)).toEqual(Object.keys(palette.light));
  });

  describe.each<Theme>(["light", "dark"])("%s theme", (theme) => {
    const colors = palette[theme];

    it.each(PAIRS)("%s on %s meets %s:1", (fg, bg, min) => {
      const [a, b] = [colors[fg], colors[bg]];
      expect(a, fg).toBeDefined();
      expect(b, bg).toBeDefined();
      expect(contrastRatio(a ?? "", b ?? "")).toBeGreaterThanOrEqual(min);
    });

    it("separates starch faces from the card surface", () => {
      const edge = colors[FACE_EDGE[theme]] ?? "";
      expect(contrastRatio(edge, colors.surface ?? "")).toBeGreaterThanOrEqual(GRAPHIC);
      expect(contrastRatio(edge, colors.bg ?? "")).toBeGreaterThanOrEqual(GRAPHIC);
    });
  });
});

describe("theme bootstrap", () => {
  it("reads the same storage key as the toggle before first paint", () => {
    const head = html.slice(0, html.indexOf("</head>"));
    expect(head).toContain(`localStorage.getItem("${THEME_KEY}")`);
    expect(head.indexOf(THEME_KEY)).toBeLessThan(head.indexOf("<title>"));
  });
});
