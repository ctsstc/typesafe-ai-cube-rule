export function formatPercent(p: number): string {
  if (p > 0 && p < 0.005) return "<1%";
  return `${Math.round(p * 100)}%`;
}

export function sentenceCase(text: string): string {
  const [first = "", ...rest] = Array.from(text);
  return first.toLocaleUpperCase("en") + rest.join("");
}

export function lowerFirst(text: string): string {
  const [first = "", ...rest] = Array.from(text);
  return first.toLocaleLowerCase("en") + rest.join("");
}

export function joinList(items: readonly string[], conjunction = "and"): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} ${conjunction} ${items.at(-1)}`;
}
