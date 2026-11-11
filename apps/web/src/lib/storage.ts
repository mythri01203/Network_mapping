/**
 * Failure-tolerant access to `localStorage`. Storage can be missing (tests), disabled (private
 * browsing) or full (quota). Callers keep working with in-memory state, but a failed write is reported
 * so no screen can claim data is saved on this device when it is not.
 */
import type { StorageErrorKind } from './idb';

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

/** `kind` says why a write failed, when known (Phase 19: IndexedDB tells "full" apart from other failures). */
type WriteListener = (key: string, ok: boolean, kind?: StorageErrorKind) => void;
const writeListeners = new Set<WriteListener>();

/** Hears the outcome of every cache write. Returns a function that stops listening. */
export function onStorageWrite(listener: WriteListener): () => void {
  writeListeners.add(listener);
  return () => writeListeners.delete(listener);
}

/** Phase 19: the IndexedDB office cache reports its writes here too, when each one completes. */
export function reportStorageWrite(key: string, ok: boolean, kind?: StorageErrorKind): void {
  writeListeners.forEach((listener) => listener(key, ok, kind));
}

/** The stored JSON for a key, or `found: false`. Unreadable JSON counts as not found. */
export function readRawJson(key: string): { found: true; value: unknown } | { found: false } {
  try {
    const raw = browserStorage()?.getItem(storageKey(key));
    if (raw === null || raw === undefined) return { found: false };
    return { found: true, value: JSON.parse(raw) as unknown };
  } catch {
    return { found: false };
  }
}

/**
 * Stores `value` as JSON, or removes the key when `value` is null/undefined. Returns false when the
 * write failed, usually because storage is full; listeners hear about it either way.
 */
export function writeJson(key: string, value: unknown): boolean {
  let ok = true;
  let kind: StorageErrorKind | undefined;
  try {
    const storage = browserStorage();
    if (storage) {
      if (value === null || value === undefined) storage.removeItem(storageKey(key));
      else storage.setItem(storageKey(key), JSON.stringify(value));
    }
  } catch (error) {
    ok = false;
    kind = (error as { name?: string } | null)?.name === 'QuotaExceededError' ? 'full' : 'failed';
  }
  reportStorageWrite(key, ok, kind);
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
