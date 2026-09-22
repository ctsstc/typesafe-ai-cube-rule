const memory = new Map<string, string>();

// Storage throws in some private modes and sandboxed iframes, so every access is guarded.
export const safeStorage = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key) ?? memory.get(key) ?? null;
    } catch {
      return memory.get(key) ?? null;
    }
  },
  set(key: string, value: string | null): void {
    if (value === null) memory.delete(key);
    else memory.set(key, value);
    try {
      if (value === null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, value);
    } catch {}
  },
};
