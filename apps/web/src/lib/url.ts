import { normalizeItem } from "@cube/core";

export const FOOD_PARAM = "food";

export function foodFromSearch(search: string): string | null {
  const raw = new URLSearchParams(search).get(FOOD_PARAM);
  if (raw === null) return null;
  const item = normalizeItem(raw);
  return item === "" ? null : item;
}

export function foodHref(item: string): string {
  return `/?${new URLSearchParams({ [FOOD_PARAM]: item }).toString()}`;
}

export function shareUrl(item: string, origin = window.location.origin): string {
  return `${origin}${foodHref(item)}`;
}
