/**
 * Failure-tolerant access to `localStorage`. Storage can be missing (tests), disabled (private
 * browsing) or full (quota); every caller then simply keeps working with in-memory state.
 */
export const STORAGE_PREFIX = 'fiber_gis_';

export const storageKey = (key: string) => `${STORAGE_PREFIX}${key}`;

export function browserStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function' ? localStorage : null;
  } catch {
    return null;
  }
}

export function readJson<T>(key: string, fallback: T, isValid: (value: unknown) => boolean): T {
  try {
    const raw = browserStorage()?.getItem(storageKey(key));
    if (raw === null || raw === undefined) return fallback;
    const parsed: unknown = JSON.parse(raw);
    return isValid(parsed) ? (parsed as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Stores `value` as JSON, or removes the key when `value` is null/undefined. */
export function writeJson(key: string, value: unknown): void {
  try {
    const storage = browserStorage();
    if (!storage) return;
    if (value === null || value === undefined) storage.removeItem(storageKey(key));
    else storage.setItem(storageKey(key), JSON.stringify(value));
  } catch {
    // Quota exceeded: the in-memory state remains authoritative for this session.
  }
}

export function removeKeys(keys: readonly string[]): void {
  try {
    const storage = browserStorage();
    keys.forEach((key) => storage?.removeItem(storageKey(key)));
  } catch {
    // Nothing to clean up when storage is unavailable.
  }
}
