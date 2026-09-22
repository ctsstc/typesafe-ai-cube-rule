export type Theme = "light" | "dark";
export type Palette = Record<Theme, Record<string, string>>;

export function parseTokens(css: string): Palette {
  const palette: Palette = { light: {}, dark: {} };
  const pattern = /--([\w-]+):\s*light-dark\(\s*(#[0-9a-f]{6})\s*,\s*(#[0-9a-f]{6})\s*\)/gi;
  for (const [, name = "", light = "", dark = ""] of css.matchAll(pattern)) {
    palette.light[name] = light;
    palette.dark[name] = dark;
  }
  return palette;
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = (hex.slice(1).match(/../g) ?? []).map((x) =>
    channel(Number.parseInt(x, 16)),
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
