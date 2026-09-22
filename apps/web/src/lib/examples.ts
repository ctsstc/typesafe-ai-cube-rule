const QUALIFIERS_BEFORE = new Set(["non-folded", "uncut", "whole"]);

// Gallery examples carry cuberule.com's qualifiers, e.g. "sub sandwich (uncut)". This turns each into
// the name the official lookup knows, so tapping it shows the canon badge.
export function exampleQuery(example: string): string {
  const match = /^(.*?)\s*\((.+)\)$/.exec(example);
  if (!match) return example.toLowerCase();
  const [, base = "", qualifier = ""] = match;
  if (qualifier.startsWith("in ")) return `${base} ${qualifier}`.toLowerCase();
  if (QUALIFIERS_BEFORE.has(qualifier)) return `${qualifier} ${base}`.toLowerCase();
  return base.toLowerCase();
}
