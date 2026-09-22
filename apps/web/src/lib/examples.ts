const QUALIFIERS_BEFORE = new Set(["non-folded", "uncut", "whole"]);

// "sub sandwich (uncut)" must become "uncut sub sandwich" or the canon lookup misses it.
export function exampleQuery(example: string): string {
  const match = /^(.*?)\s*\((.+)\)$/.exec(example);
  if (!match) return example.toLowerCase();
  const [, base = "", qualifier = ""] = match;
  if (qualifier.startsWith("in ")) return `${base} ${qualifier}`.toLowerCase();
  if (QUALIFIERS_BEFORE.has(qualifier)) return `${qualifier} ${base}`.toLowerCase();
  return base.toLowerCase();
}
