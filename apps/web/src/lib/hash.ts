export function fnv1a(text: string): number {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ (ch.codePointAt(0) ?? 0), 16777619);
  return h >>> 0;
}

// The same food always gets the same variant, so a shared link reads like the sender's screenshot.
export function pickVariant<T>(seed: string, slot: string, variants: readonly [T, ...T[]]): T {
  return variants[fnv1a(`${seed}\u0000${slot}`) % variants.length] ?? variants[0];
}
