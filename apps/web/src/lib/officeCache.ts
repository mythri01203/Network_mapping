/**
 * Phase 19: the office's offline copy of the network, in IndexedDB instead of `localStorage`, so it
 * is not held to the browser's 5 MB `localStorage` limit.
 *
 * Callers stay synchronous: everything is read into memory once at start-up (`startOfficeCache`,
 * before the network store loads), reads come from memory, and writes go to memory at once and to
 * IndexedDB right after. All writes made in the same moment (a changed collection and the sync
 * engine's list of unsent records) are stored in one transaction: both land or neither does, so the
 * list of unsent changes always matches the stored records. Each write's outcome goes to the same
 * listeners as before (`onStorageWrite`), so "Phone storage is full" is shown when IndexedDB is full.
 *
 * Moving over from `localStorage` never loses anything: a key still in `localStorage` is read from
 * there (it is the newer copy, written by an older version of the app or while IndexedDB could not
 * open) and is removed from `localStorage` only after IndexedDB has stored it. If IndexedDB cannot be
 * opened at all, everything keeps working on `localStorage` exactly as before.
 */
import { type DatabaseDef, idbDelete, idbGetAll, idbPut, openDatabase, type StorageError, type StorageErrorKind, toStorageError, transact } from './idb';
import { readJson, readRawJson, removeKeys, reportStorageWrite, writeJson } from './storage';

export const OFFICE_DB: DatabaseDef = {
  name: 'fibergis-office',
  version: 1,
  stores: { cache: { keyPath: 'key' } },
};

/** Where the cache is kept. `local`: `localStorage`, as before Phase 19 (and in tests). */
export type OfficeCacheMode = 'local' | 'indexeddb';

export interface OfficeCacheBackend {
  loadAll(): Promise<Map<string, unknown>>;
  /** Stores every put and delete in one transaction: all of them or none. */
  write(puts: ReadonlyMap<string, unknown>, deletes: ReadonlySet<string>): Promise<void>;
}

export function createIdbOfficeBackend(factory?: IDBFactory): OfficeCacheBackend {
  let dbPromise: Promise<IDBDatabase> | null = null;
  const db = () => {
    dbPromise ??= openDatabase(OFFICE_DB, factory).catch((error: unknown) => {
      dbPromise = null;
      throw error;
    });
    return dbPromise;
  };
  return {
    async loadAll() {
      const rows = await transact(await db(), ['cache'], 'readonly', (tx) => idbGetAll<{ key: string; value: unknown }>(tx, 'cache'));
      return new Map(rows.map((row) => [row.key, row.value]));
    },
    async write(puts, deletes) {
      await transact(await db(), ['cache'], 'readwrite', async (tx) => {
        await Promise.all([
          ...[...puts].map(([key, value]) => idbPut(tx, 'cache', { key, value })),
          ...[...deletes].map((key) => idbDelete(tx, 'cache', key)),
        ]);
      });
    },
  };
}

/** The same in memory, for tests. `failNext` makes the next write throw (for example a full disk). */
export function createMemoryOfficeBackend(initial: Record<string, unknown> = {}): OfficeCacheBackend & {
  data: Map<string, unknown>;
  failNext: (error: unknown) => void;
  writes: number;
} {
  const data = new Map<string, unknown>(Object.entries(initial).map(([k, v]) => [k, structuredClone(v)]));
  let failure: unknown = null;
  const backend = {
    data,
    writes: 0,
    failNext: (error: unknown) => {
      failure = error;
    },
    loadAll: async () => new Map([...data].map(([k, v]) => [k, structuredClone(v)])),
    write: async (puts: ReadonlyMap<string, unknown>, deletes: ReadonlySet<string>) => {
      if (failure) {
        const error = failure;
        failure = null;
        throw error;
      }
      for (const [k, v] of puts) data.set(k, structuredClone(v));
      for (const k of deletes) data.delete(k);
      backend.writes += 1;
    },
  };
  return backend;
}

let mode: OfficeCacheMode = 'local';
let backend: OfficeCacheBackend | null = null;
let mirror = new Map<string, unknown>();
/** Waiting to be stored; `undefined` means "remove". */
const dirty = new Map<string, unknown>();
/** Keys whose `localStorage` copy has been taken over (or is older than a newer write). */
const adopted = new Set<string>();
let scheduled = false;
/** True after a failed write, until the retry timer or the next write. */
let held = false;
let chain: Promise<void> = Promise.resolve();
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let startError: StorageError | null = null;
let lastWriteError: StorageErrorKind | null = null;

/** Wait before storing again after a failed write (full disk): the data stays in memory meanwhile. */
const RETRY_MS = 15_000;

export const officeCacheMode = (): OfficeCacheMode => mode;
/** Why IndexedDB could not be used, when it could not. */
export const officeCacheStartError = (): StorageError | null => startError;
/** What went wrong with the last failed write, until a write succeeds again. */
export const officeCacheWriteError = (): StorageErrorKind | null => lastWriteError;

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('IndexedDB did not answer in time.')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });

/**
 * Opens the IndexedDB cache and reads it into memory. Call once, before the network store loads.
 * When IndexedDB is missing, blocked or too slow to answer, the cache stays on `localStorage`.
 */
export async function startOfficeCache(options: { backend?: OfficeCacheBackend; timeoutMs?: number } = {}): Promise<OfficeCacheMode> {
  if (mode === 'indexeddb') return mode;
  const chosen = options.backend ?? (typeof indexedDB !== 'undefined' ? createIdbOfficeBackend() : null);
  if (!chosen) return mode;
  try {
    mirror = await withTimeout(chosen.loadAll(), options.timeoutMs ?? 4_000);
    backend = chosen;
    mode = 'indexeddb';
    startError = null;
  } catch (error) {
    startError = toStorageError(error);
  }
  return mode;
}

function scheduleRetry(): void {
  if (retryTimer !== undefined) return;
  retryTimer = setTimeout(() => {
    retryTimer = undefined;
    held = false;
    schedule();
  }, RETRY_MS);
}

/** A new write arrived: it goes, and carries anything a failed write left waiting. */
function release(): void {
  held = false;
  schedule();
}

async function runFlush(): Promise<void> {
  // After a failed write, the values wait for the retry timer or the next write, not a tight loop.
  if (!backend || dirty.size === 0 || held) return;
  const batch = new Map(dirty);
  dirty.clear();
  const puts = new Map<string, unknown>();
  const deletes = new Set<string>();
  for (const [key, value] of batch) {
    if (value === undefined) deletes.add(key);
    else puts.set(key, value);
  }
  try {
    await backend.write(puts, deletes);
  } catch (error) {
    // Nothing is dropped: values not written again meanwhile wait for the next try.
    for (const [key, value] of batch) if (!dirty.has(key)) dirty.set(key, value);
    held = true;
    const kind = toStorageError(error).kind;
    lastWriteError = kind;
    for (const key of batch.keys()) reportStorageWrite(key, false, kind);
    scheduleRetry();
    return;
  }
  lastWriteError = null;
  // The `localStorage` copies are older than what IndexedDB holds now.
  removeKeys([...batch.keys()]);
  for (const key of batch.keys()) reportStorageWrite(key, true);
}

function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  // After the current moment, so a collection and the sync bookkeeping written together go together.
  queueMicrotask(() => {
    scheduled = false;
    chain = chain.then(runFlush, runFlush);
  });
}

/** Takes over a key's `localStorage` copy once: it is the newer one (see the file comment). */
function adoptLegacy(key: string): void {
  if (adopted.has(key)) return;
  adopted.add(key);
  const legacy = readRawJson(key);
  if (!legacy.found) return;
  mirror.set(key, legacy.value);
  dirty.set(key, legacy.value);
  release();
}

/** Like `readJson`: the stored value when it passes `isValid`, else `fallback`. */
export function cacheRead<T>(key: string, fallback: T, isValid: (value: unknown) => boolean): T {
  if (mode === 'local') return readJson(key, fallback, isValid);
  adoptLegacy(key);
  if (!mirror.has(key)) return fallback;
  const value = mirror.get(key);
  return isValid(value) ? (value as T) : fallback;
}

/** True when something is stored under the key. */
export function cacheHas(key: string): boolean {
  if (mode === 'local') return readRawJson(key).found;
  adoptLegacy(key);
  return mirror.has(key);
}

/**
 * Like `writeJson`: stores `value`, or removes the key for null or undefined. With IndexedDB the
 * outcome arrives later, through `onStorageWrite`, once the transaction has completed; until then
 * nothing may claim it is saved on this device.
 */
export function cacheWrite(key: string, value: unknown): boolean {
  if (mode === 'local') return writeJson(key, value);
  adopted.add(key);
  if (value === null || value === undefined) {
    mirror.delete(key);
    dirty.set(key, undefined);
  } else {
    mirror.set(key, value);
    dirty.set(key, value);
  }
  release();
  return true;
}

export function cacheRemove(keys: readonly string[]): void {
  if (mode === 'local') {
    removeKeys(keys);
    return;
  }
  for (const key of keys) {
    adopted.add(key);
    mirror.delete(key);
    dirty.set(key, undefined);
  }
  removeKeys(keys);
  release();
}

/** Resolves once everything written so far has been tried. For tests and before a reload. */
export async function flushOfficeCache(): Promise<void> {
  if (mode === 'local') return;
  await Promise.resolve();
  chain = chain.then(runFlush, runFlush);
  await chain;
}

/** Back to `localStorage` with an empty memory, as at page load. Tests only. */
export function resetOfficeCacheForTests(): void {
  mode = 'local';
  backend = null;
  mirror = new Map();
  dirty.clear();
  adopted.clear();
  scheduled = false;
  held = false;
  chain = Promise.resolve();
  clearTimeout(retryTimer);
  retryTimer = undefined;
  startError = null;
  lastWriteError = null;
}
