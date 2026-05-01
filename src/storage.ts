// Typed wrappers around localStorage so the app's persistence has a
// single chokepoint. Phase 1.2 of the refactor consolidates ~12
// ad-hoc `try { localStorage.getItem(...) } catch { ... }` blocks
// into these four helpers.
//
// Failure mode contract: every read returns the supplied fallback
// when storage is unavailable (Safari private mode quota exceeded,
// jsdom partial impl, etc.); every write silently swallows quota
// errors. Callers never see exceptions from this layer.

export function loadString(key: string, fallback = ""): string {
  try {
    const raw = localStorage.getItem(key);
    return raw ?? fallback;
  } catch {
    return fallback;
  }
}

export function saveString(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* quota / private mode — caller doesn't need to know */
  }
}

export function loadBool(key: string, fallback = false): boolean {
  const v = loadString(key, fallback ? "1" : "0");
  return v === "1";
}

export function saveBool(key: string, value: boolean): void {
  saveString(key, value ? "1" : "0");
}

export function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const parsed = JSON.parse(raw) as T;
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

export function saveJson<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / private mode */
  }
}

export function removeKey(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
