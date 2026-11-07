/**
 * Failure-tolerant access to `localStorage`. Storage can be missing (tests), disabled (private
 * browsing) or full (quota). Callers keep working with in-memory state, but a failed write is reported
 * so no screen can claim data is saved on this device when it is not.
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

type WriteListener = (key: string, ok: boolean) => void;
const writeListeners = new Set<WriteListener>();

/** Hears the outcome of every cache write. Returns a function that stops listening. */
export function onStorageWrite(listener: WriteListener): () => void {
  writeListeners.add(listener);
  return () => writeListeners.delete(listener);
}

/**
 * Stores `value` as JSON, or removes the key when `value` is null/undefined. Returns false when the
 * write failed, usually because storage is full; listeners hear about it either way.
 */
export function writeJson(key: string, value: unknown): boolean {
  let ok = true;
  try {
    const storage = browserStorage();
    if (storage) {
      if (value === null || value === undefined) storage.removeItem(storageKey(key));
      else storage.setItem(storageKey(key), JSON.stringify(value));
    }
  } catch {
    ok = false;
  }
  writeListeners.forEach((listener) => listener(key, ok));
  return ok;
}

export function removeKeys(keys: readonly string[]): void {
  try {
    const storage = browserStorage();
    keys.forEach((key) => storage?.removeItem(storageKey(key)));
  } catch {
    // Nothing to clean up when storage is unavailable.
  }
}
