import type { NetworkSnapshot, ParsedBackup } from '@fibergis/shared';
import { createSampleNetwork } from '@fibergis/shared/sample';
import { readJson, writeJson } from '../lib/storage';
import { SYNC_META_STORAGE_KEY, getNetworkSnapshot, useNetworkStore, wasLoadedFromCache } from '../stores/networkStore';
import { type SyncPhase, initialSyncState, useSyncStore } from '../stores/syncStore';
import { showToast } from '../stores/toastStore';
import {
  type PendingIds,
  buildChangeSet,
  changedIds,
  countPending,
  differingCollections,
  isEmptyPending,
  mergePending,
  omitCollections,
  reconcile,
  sameValue,
} from './changeTracking';
import { type ApiClient, apiClient, describeApiError, isTransientError } from './client';

interface SyncMeta {
  /** Server revision the cached collections were last reconciled with; null before first contact. */
  revision: number | null;
  /** Records edited locally that the server has not acknowledged yet. */
  pending: PendingIds;
}

const isSyncMeta = (value: unknown): boolean => {
  if (typeof value !== 'object' || value === null) return false;
  const { revision, pending } = value as Partial<SyncMeta>;
  return (
    (revision === null || typeof revision === 'number') &&
    typeof pending === 'object' &&
    pending !== null &&
    Object.values(pending).every((ids) => Array.isArray(ids) && ids.every((id) => typeof id === 'string'))
  );
};

/** Browsers cap `keepalive` request bodies at 64 KiB. */
const KEEPALIVE_BODY_LIMIT = 60_000;

export type SyncOutcome = 'server' | 'local' | 'failed';

export interface SyncEngine {
  /** Loads the network from the server and keeps it in sync until `stop()`. Safe to call twice. */
  start(): void;
  stop(): void;
  /** Sends pending local changes now instead of waiting for the debounce. */
  flush(): Promise<void>;
  /** Clears a refused-change error and tries the server again. */
  retry(): Promise<void>;
  /** Drops unsent local edits and reloads the network from the server. */
  discardLocalChanges(): Promise<void>;
  /** Reloads the demo network (keeping the catalog) on the server, or locally while offline. */
  reset(): Promise<SyncOutcome>;
  /** Replaces the collections in a backup on the server, or locally while offline. */
  restore(backup: ParsedBackup): Promise<SyncOutcome>;
  isConnected(): boolean;
}

export interface SyncEngineOptions {
  client?: ApiClient;
  /** Quiet period after the last edit before changes are sent. */
  debounceMs?: number;
  /** Upper bound on how long continuous editing can delay a send. */
  maxWaitMs?: number;
  /** How often an idle client checks the server for changes made elsewhere. */
  pollIntervalMs?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
}

/**
 * Keeps the network store and the API server in step. Local edits are tracked per record, persisted
 * with the offline cache and sent in debounced batches; server state is merged back record by record
 * (last write wins). While the server is unreachable the app keeps working on the cached copy.
 */
export function createSyncEngine({
  client = apiClient,
  debounceMs = 600,
  maxWaitMs = 4_000,
  pollIntervalMs = 30_000,
  retryBaseMs = 2_000,
  retryMaxMs = 30_000,
}: SyncEngineOptions = {}): SyncEngine {
  let started = false;
  let meta: SyncMeta = { revision: null, pending: {} };
  let sending: PendingIds | null = null;
  let link: 'connecting' | 'online' | 'offline' = 'connecting';
  let linkError: string | null = null;
  let rejection: string | null = null;
  let lastSyncedAt: number | null = null;
  let applyingRemote = false;
  let retryAttempt = 0;
  let unsubscribe: (() => void) | null = null;

  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let maxWaitTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let pollTimer: ReturnType<typeof setInterval> | undefined;

  // Server round-trips run one at a time so a reload never interleaves with a send.
  let queue: Promise<unknown> = Promise.resolve();
  let busy = 0;
  const exclusive = <T>(task: () => Promise<T>): Promise<T> => {
    busy += 1;
    const run = queue.then(task).finally(() => {
      busy -= 1;
    });
    queue = run.catch(() => undefined);
    return run;
  };

  const unsent = (): PendingIds => (sending ? mergePending(meta.pending, sending) : meta.pending);

  // Until the server acknowledges a batch, its ids stay in the persisted pending set.
  const persistMeta = () => writeJson(SYNC_META_STORAGE_KEY, { revision: meta.revision, pending: unsent() });

  const updateStatus = () => {
    const pendingCount = countPending(unsent());
    let phase: SyncPhase;
    if (rejection) phase = 'error';
    else if (link !== 'online') phase = link;
    else if (sending) phase = 'saving';
    else if (pendingCount > 0) phase = 'pending';
    else phase = 'synced';
    useSyncStore.setState({
      phase,
      revision: meta.revision,
      pendingCount,
      lastSyncedAt,
      error: rejection ?? (link === 'offline' ? linkError : null),
    });
  };

  const applyRemote = (collections: Partial<NetworkSnapshot>) => {
    applyingRemote = true;
    try {
      useNetworkStore.getState().replaceCollections(collections);
    } finally {
      applyingRemote = false;
    }
  };

  const clearFlushTimers = () => {
    clearTimeout(debounceTimer);
    clearTimeout(maxWaitTimer);
    debounceTimer = undefined;
    maxWaitTimer = undefined;
  };

  const scheduleFlush = () => {
    if (!started || link !== 'online' || rejection || isEmptyPending(meta.pending)) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => void flush(), debounceMs);
    maxWaitTimer ??= setTimeout(() => void flush(), maxWaitMs);
  };

  const stopPolling = () => {
    clearInterval(pollTimer);
    pollTimer = undefined;
  };

  const startPolling = () => {
    stopPolling();
    pollTimer = setInterval(() => void poll(), pollIntervalMs);
  };

  const scheduleReconnect = () => {
    clearTimeout(reconnectTimer);
    const delay = Math.min(retryMaxMs, retryBaseMs * 2 ** retryAttempt);
    retryAttempt += 1;
    reconnectTimer = setTimeout(() => void exclusive(connect), delay);
  };

  const goOffline = (error: unknown) => {
    link = 'offline';
    linkError = describeApiError(error);
    clearFlushTimers();
    stopPolling();
    updateStatus();
    if (started) scheduleReconnect();
  };

  const handleFailure = (error: unknown) => {
    if (isTransientError(error)) {
      goOffline(error);
      return;
    }
    const message = describeApiError(error);
    if (rejection !== message) {
      showToast('error', 'Server Rejected Changes', `${message} Your edits are kept in this browser.`);
    }
    rejection = message;
    updateStatus();
  };

  async function connect(): Promise<void> {
    clearTimeout(reconnectTimer);
    let response;
    try {
      response = await client.getNetwork();
    } catch (error) {
      goOffline(error);
      return;
    }
    if (!started) return;

    if (meta.revision === null && wasLoadedFromCache()) {
      // This browser edited the demo network before it had a server: upload those edits once.
      const legacyEdits = changedIds(createSampleNetwork(), getNetworkSnapshot(), sameValue);
      meta.pending = mergePending(meta.pending, legacyEdits);
    }

    const local = getNetworkSnapshot();
    const merged = reconcile(response.data, local, unsent());
    const changed = differingCollections(local, merged);
    if (Object.keys(changed).length > 0) applyRemote(changed);

    meta.revision = response.revision;
    link = 'online';
    linkError = null;
    retryAttempt = 0;
    lastSyncedAt = Date.now();
    persistMeta();
    updateStatus();
    startPolling();
    if (!rejection && !isEmptyPending(meta.pending)) await send();
  }

  async function send(): Promise<void> {
    clearFlushTimers();
    if (link !== 'online' || isEmptyPending(meta.pending)) return;
    const batch = meta.pending;
    sending = batch;
    meta.pending = {};
    updateStatus();

    const expected = meta.revision;
    let result;
    try {
      result = await client.applyChanges(buildChangeSet(batch, getNetworkSnapshot()));
    } catch (error) {
      meta.pending = mergePending(batch, meta.pending);
      sending = null;
      persistMeta();
      handleFailure(error);
      return;
    }

    sending = null;
    rejection = null;
    const wrote = result.upserted + result.deleted > 0;
    const someoneElseWrote = expected !== null && result.revision !== (wrote ? expected + 1 : expected);
    meta.revision = result.revision;
    lastSyncedAt = Date.now();
    persistMeta();
    updateStatus();
    if (someoneElseWrote) await connect();
    else scheduleFlush();
  }

  async function poll(): Promise<void> {
    if (busy > 0 || link !== 'online' || sending || !isEmptyPending(meta.pending)) return;
    await exclusive(async () => {
      try {
        const health = await client.health();
        if (health.revision !== meta.revision) await connect();
      } catch (error) {
        if (isTransientError(error)) goOffline(error);
      }
    });
  }

  const flush = () => exclusive(send);

  const onLocalChange = (state: NetworkSnapshot, prev: NetworkSnapshot) => {
    if (applyingRemote) return;
    const changed = changedIds(prev, state);
    if (isEmptyPending(changed)) return;
    meta.pending = mergePending(meta.pending, changed);
    // New edits may fix whatever the server refused, so give it another try.
    rejection = null;
    persistMeta();
    updateStatus();
    scheduleFlush();
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') void flush();
    else void poll();
  };

  const onOnline = () => {
    if (link === 'offline') {
      retryAttempt = 0;
      void exclusive(connect);
    }
  };

  // Last chance to save while the tab closes (an in-flight send may be cancelled with the page, so
  // it is repeated). Anything still unacknowledged is re-sent on the next visit.
  const onPageHide = () => {
    const ids = unsent();
    if (link !== 'online' || isEmptyPending(ids)) return;
    const changes = buildChangeSet(ids, getNetworkSnapshot());
    if (JSON.stringify(changes).length > KEEPALIVE_BODY_LIMIT) return;
    client.applyChanges(changes, { keepalive: true }).catch(() => undefined);
  };

  const localReset = () => {
    const sample = createSampleNetwork();
    useNetworkStore.getState().replaceCollections({ ...sample, catalog: useNetworkStore.getState().catalog });
  };

  return {
    start() {
      if (started) return;
      started = true;
      meta = readJson<SyncMeta>(SYNC_META_STORAGE_KEY, { revision: null, pending: {} }, isSyncMeta);
      link = 'connecting';
      updateStatus();
      unsubscribe = useNetworkStore.subscribe(onLocalChange);
      if (typeof window !== 'undefined') {
        window.addEventListener('online', onOnline);
        window.addEventListener('pagehide', onPageHide);
        document.addEventListener('visibilitychange', onVisibilityChange);
      }
      void exclusive(connect);
    },

    stop() {
      if (!started) return;
      started = false;
      unsubscribe?.();
      unsubscribe = null;
      clearFlushTimers();
      clearTimeout(reconnectTimer);
      stopPolling();
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', onOnline);
        window.removeEventListener('pagehide', onPageHide);
        document.removeEventListener('visibilitychange', onVisibilityChange);
      }
      useSyncStore.setState(initialSyncState);
    },

    flush,

    retry: () =>
      exclusive(async () => {
        rejection = null;
        retryAttempt = 0;
        updateStatus();
        if (link === 'online') await send();
        else await connect();
      }),

    discardLocalChanges: () =>
      exclusive(async () => {
        meta.pending = {};
        rejection = null;
        persistMeta();
        updateStatus();
        await connect();
      }),

    reset: () =>
      exclusive(async (): Promise<SyncOutcome> => {
        // Catalog edits survive a reset, so they are saved first.
        if (started && link === 'online') await send();
        if (started && link === 'online') {
          try {
            await client.reset();
            meta.pending = meta.pending.catalog ? { catalog: meta.pending.catalog } : {};
            rejection = null;
            persistMeta();
            await connect();
            return 'server';
          } catch (error) {
            if (!isTransientError(error)) {
              handleFailure(error);
              return 'failed';
            }
            goOffline(error);
          }
        }
        // Offline: reset this copy; the change tracker uploads the result once the server is back.
        localReset();
        return 'local';
      }),

    restore: (backup) =>
      exclusive(async (): Promise<SyncOutcome> => {
        if (started && link === 'online') await send();
        if (started && link === 'online') {
          try {
            const result = await client.restore(backup);
            meta.pending = omitCollections(meta.pending, result.restored);
            rejection = null;
            persistMeta();
            await connect();
            if (backup.projectStartPoint) useNetworkStore.getState().setProjectStartPoint(backup.projectStartPoint);
            return 'server';
          } catch (error) {
            if (!isTransientError(error)) {
              handleFailure(error);
              return 'failed';
            }
            goOffline(error);
          }
        }
        useNetworkStore.getState().replaceCollections(backup.collections, backup.projectStartPoint);
        return 'local';
      }),

    isConnected: () => started && link === 'online',
  };
}

export const syncEngine = createSyncEngine();
