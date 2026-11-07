/**
 * A very small promise wrapper over IndexedDB. Writes resolve only when the transaction has
 * completed (with "strict" durability where the browser supports it), so a caller can honestly say
 * "Saved on phone" afterwards. Every failure becomes a `StorageError` the screen can explain.
 */

export type StorageErrorKind = 'unavailable' | 'full' | 'blocked' | 'failed';

export class StorageError extends Error {
  readonly kind: StorageErrorKind;

  constructor(kind: StorageErrorKind, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'StorageError';
    this.kind = kind;
  }
}

export function toStorageError(error: unknown): StorageError {
  if (error instanceof StorageError) return error;
  const name = (error as { name?: string } | null)?.name;
  if (name === 'QuotaExceededError') return new StorageError('full', 'Phone storage is full.', { cause: error });
  if (name === 'InvalidStateError' || name === 'SecurityError') {
    return new StorageError('unavailable', 'Phone storage is not available in this browser.', { cause: error });
  }
  return new StorageError('failed', 'Phone storage did not save.', { cause: error });
}

export interface StoreDef {
  keyPath: string;
  indexes?: Record<string, string>;
}

export interface DatabaseDef {
  name: string;
  version: number;
  stores: Record<string, StoreDef>;
}

export function openDatabase(def: DatabaseDef, factory: IDBFactory | undefined = globalThis.indexedDB): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!factory) {
      reject(new StorageError('unavailable', 'This browser has no phone storage (IndexedDB).'));
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(def.name, def.version);
    } catch (error) {
      reject(toStorageError(error));
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const [name, store] of Object.entries(def.stores)) {
        const objectStore = db.objectStoreNames.contains(name)
          ? request.transaction!.objectStore(name)
          : db.createObjectStore(name, { keyPath: store.keyPath });
        for (const [indexName, keyPath] of Object.entries(store.indexes ?? {})) {
          if (!objectStore.indexNames.contains(indexName)) objectStore.createIndex(indexName, keyPath);
        }
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // Another tab upgrading the database: close so it is not blocked; the next call reopens.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(toStorageError(request.error));
    request.onblocked = () => reject(new StorageError('blocked', 'Close other FiberGIS tabs and try again.'));
  });
}

const requestResult = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(toStorageError(request.error));
  });

/**
 * Runs `work` in one transaction and resolves with its result after the transaction completes.
 * If anything fails, nothing in the transaction is kept.
 */
export function transact<T>(
  db: IDBDatabase,
  stores: string[],
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction) => Promise<T> | T,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let tx: IDBTransaction;
    try {
      tx = mode === 'readwrite' ? db.transaction(stores, mode, { durability: 'strict' }) : db.transaction(stores, mode);
    } catch (error) {
      reject(toStorageError(error));
      return;
    }
    let result: T;
    let failed = false;
    tx.oncomplete = () => (failed ? undefined : resolve(result));
    tx.onerror = () => reject(toStorageError(tx.error));
    tx.onabort = () => reject(toStorageError(tx.error ?? new Error('aborted')));
    Promise.resolve()
      .then(() => work(tx))
      .then((value) => {
        result = value;
      })
      .catch((error) => {
        failed = true;
        try {
          tx.abort();
        } catch {
          // Already finished.
        }
        reject(toStorageError(error));
      });
  });
}

export const idbGet = <T>(tx: IDBTransaction, store: string, key: IDBValidKey): Promise<T | undefined> =>
  requestResult(tx.objectStore(store).get(key) as IDBRequest<T | undefined>);

export const idbGetAll = <T>(tx: IDBTransaction, store: string): Promise<T[]> =>
  requestResult(tx.objectStore(store).getAll() as IDBRequest<T[]>);

export const idbPut = (tx: IDBTransaction, store: string, value: unknown): Promise<IDBValidKey> =>
  requestResult(tx.objectStore(store).put(value));

export const idbDelete = (tx: IDBTransaction, store: string, key: IDBValidKey): Promise<undefined> =>
  requestResult(tx.objectStore(store).delete(key));

/** How much the browser lets this site store, when it says. */
export async function storageEstimate(): Promise<{ usage?: number; quota?: number }> {
  try {
    return (await navigator.storage?.estimate?.()) ?? {};
  } catch {
    return {};
  }
}

/** Asks the browser not to clear this site's storage when the phone runs low. It may say no. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
