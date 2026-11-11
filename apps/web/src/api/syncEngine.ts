import {
  type AreaResponse,
  type ChangeResult,
  type ChangeSet,
  type ChangesResponse,
  type CollectionName,
  isCollectionName,
  type NetworkSnapshot,
  type ParsedBackup,
  randomCode,
  type RecordsResponse,
  type RecordVersions,
  type SyncConflict,
  type VersionConflict,
} from '@fibergis/shared';
import { createSampleNetwork } from '@fibergis/shared/sample';

import { cacheRead, cacheWrite } from '../lib/officeCache';
import { initialAreaLoadState, useAreaLoadStore } from '../stores/areaLoadStore';
import { currentAccount, useAuthStore } from '../stores/authStore';
import { useMapStore } from '../stores/mapStore';
import { forgetCachedNetwork, getNetworkSnapshot, MAX_AUDIT_LOGS, SYNC_META_STORAGE_KEY, useNetworkStore, wasLoadedFromCache } from '../stores/networkStore';
import { useRestoreStore } from '../stores/restoreStore';
import { recordSyncHistory } from '../stores/syncHistoryStore';
import { initialSyncState, type RefusedRecord, type SyncPhase, useSyncStore } from '../stores/syncStore';
import { showToast } from '../stores/toastStore';
import { useUiStore } from '../stores/uiStore';
import {
  AREA_COLLECTIONS,
  AREA_MODE_MIN_RECORDS,
  AREA_WIDEST_ZOOM,
  type AreaBox,
  areaRecordCount,
  isCovered,
  type LoadPreference,
  mergeLoaded,
  missingReferences,
  readLoadPreference,
  viewBox,
  writeLoadPreference,
} from './areaLoading';
import {
  buildChangeSet,
  changedFields,
  changedIds,
  countPending,
  differingCollections,
  isEmptyPending,
  mergePending,
  omitCollections,
  type PendingIds,
  reconcile,
  recordKey,
  sameValue,
} from './changeTracking';
import { type ApiClient, apiClient, ApiError, ApiUnavailableError, describeApiError, isTransientError, type RestoreResult } from './client';

type RecordKey = { collection: CollectionName; id: string };

const flatten = (pending: PendingIds): RecordKey[] =>
  (Object.entries(pending) as [CollectionName, string[]][]).flatMap(([collection, ids]) =>
    ids.map((id) => ({ collection, id })),
  );

const toPending = (keys: readonly RecordKey[]): PendingIds => {
  const result: PendingIds = {};
  for (const { collection, id } of keys) (result[collection] ??= []).push(id);
  return result;
};

/** What a person calls a record, for messages about it. */
function recordLabel({ collection, id }: RecordKey, snapshot: NetworkSnapshot): string {
  const record = (snapshot[collection] as readonly { id: string; name?: string; title?: string }[]).find(
    (item) => item.id === id,
  );
  const name = record?.name ?? record?.title;
  return name && name !== id ? `${name} (${id})` : id;
}

interface SyncMeta {
  /** Server revision the cached collections were last reconciled with; null before first contact. */
  revision: number | null;
  /** Records edited locally that the server has not acknowledged yet. */
  pending: PendingIds;
  /**
   * The server version each unsent record was edited from (Phase 8), keyed `collection/id`. The
   * server refuses the record if someone else changed it since. Records with no base (new ones,
   * edits saved before Phase 8, or a server that sends no versions) are sent as before.
   */
  bases?: Record<string, number>;
  /** Records someone else changed at the same time. Kept here and not sent until a person chooses. */
  held?: PendingIds;
  /**
   * Who made the unsent changes (Phase 9), so they are sent only under that person's login. If
   * someone else logs in on this device, the changes wait for the person who made them.
   */
  owner?: { id: string; name: string };
  /** Phase 24b: the cached copy holds part of the network, loaded by map area. Absent: the whole network. */
  mode?: 'area';
}

const isPendingIds = (value: unknown): boolean =>
  typeof value === 'object' &&
  value !== null &&
  Object.values(value).every((ids) => Array.isArray(ids) && ids.every((id) => typeof id === 'string'));

const isSyncMeta = (value: unknown): boolean => {
  if (typeof value !== 'object' || value === null) return false;
  const { revision, pending, bases, held, owner, mode } = value as Partial<SyncMeta>;
  return (
    (mode === undefined || mode === 'area') &&
    (owner === undefined || (typeof owner === 'object' && owner !== null && typeof owner.id === 'string' && typeof owner.name === 'string')) &&
    (revision === null || typeof revision === 'number') &&
    isPendingIds(pending) &&
    (bases === undefined || (typeof bases === 'object' && bases !== null && Object.values(bases).every((v) => typeof v === 'number'))) &&
    (held === undefined || isPendingIds(held))
  );
};

const withoutKeys = (set: PendingIds, keys: readonly RecordKey[]): PendingIds => {
  const drop = new Set(keys.map((k) => recordKey(k.collection, k.id)));
  return toPending(flatten(set).filter((k) => !drop.has(recordKey(k.collection, k.id))));
};

/**
 * Phase 24: the server's state, as far as this device can tell, after a change list: the local copy
 * with the server's stored records put in place (new ones at the end, as the server orders them)
 * and its deleted ones taken out. Collections the list does not name stay the same arrays.
 */
export function applyServerChanges(local: NetworkSnapshot, changes: Pick<Extract<ChangesResponse, { reload?: false }>, 'upserts' | 'deletes'>): NetworkSnapshot {
  const result = { ...local } as Record<CollectionName, { id: string }[]>;
  const names = new Set([...Object.keys(changes.upserts ?? {}), ...Object.keys(changes.deletes ?? {})].filter(isCollectionName));
  for (const name of names) {
    const gone = new Set(changes.deletes?.[name] ?? []);
    const list = (local[name] as { id: string }[]).filter((r) => !gone.has(r.id));
    const at = new Map(list.map((r, i) => [r.id, i]));
    for (const record of (changes.upserts?.[name] ?? []) as { id: string }[]) {
      const i = at.get(record.id);
      if (i === undefined) {
        at.set(record.id, list.length);
        list.push(record);
      } else list[i] = record;
    }
    result[name] = list;
  }
  return result as unknown as NetworkSnapshot;
}

const findRecord = (snapshot: NetworkSnapshot, { collection, id }: RecordKey) =>
  (snapshot[collection] as readonly { id: string }[]).find((r) => r.id === id) as Record<string, unknown> | undefined;

export type ConflictChoice = 'theirs' | 'mine' | 'office';

/** Who this device is working for, for conflict records: the logged-in person, or the older role choice. */
const deviceUser = () => currentAccount()?.displayName ?? useUiStore.getState().userRole;

/** One line for the sync status: which record, why, and what to do next. */
const describeRefusal = (records: readonly RefusedRecord[]): string => {
  const [first] = records;
  const more = records.length > 1 ? ` and ${records.length - 1} more` : '';
  return `${first.label}${more} was not sent. ${first.reason} Correct it, then tap Retry now.`;
};

/**
 * Phase 19: one line in this device's sync history (`syncHistoryStore`). Audit notes travel with
 * the records and are counted apart; a batch of audit notes alone is not listed.
 */
function logHistory(result: 'sent' | 'refused' | 'conflict', keys: readonly RecordKey[], reason?: string): void {
  const records = keys.filter((k) => k.collection !== 'auditLogs');
  if (records.length === 0) return;
  const snapshot = getNetworkSnapshot();
  recordSyncHistory({
    result,
    kind: 'changes',
    count: records.length,
    labels: records.slice(0, 5).map((k) => recordLabel(k, snapshot)),
    notes: keys.length - records.length,
    ...(reason ? { reason } : {}),
  });
}

/** Browsers cap `keepalive` request bodies at 64 KiB. */
const KEEPALIVE_BODY_LIMIT = 60_000;

export type SyncOutcome = 'server' | 'local' | 'failed';

export interface SyncEngine {
  /** Loads the network from the server and keeps it in sync until `stop()`. Safe to call twice. */
  start(): void;
  stop(): void;
  /** Sends pending local changes now instead of waiting for the debounce. */
  flush(): Promise<void>;
  /** Tries the server again, including records it refused earlier. */
  retry(): Promise<void>;
  /** Checks the server for changes made elsewhere now (such as rows a monitoring route stored). */
  refresh(): Promise<void>;
  /** Drops unsent local edits and reloads the network from the server. */
  discardLocalChanges(): Promise<void>;
  /** Reloads the demo network (keeping the catalog) on the server, or locally while offline. */
  reset(): Promise<SyncOutcome>;
  /**
   * Replaces the collections in a backup on the server. Since Phase 9 only the server does this
   * (it saves a safety copy first and checks the backup), so with no connection nothing happens.
   * A backup the checks refuse rejects with that `ApiError` (`restore_refused`) and its problem list.
   */
  restore(backup: ParsedBackup, options?: { acceptProblems?: boolean }): Promise<SyncOutcome>;
  /** The same for a `.zip` backup with photos. */
  restoreZip(zip: Blob, options?: { acceptProblems?: boolean }): Promise<SyncOutcome>;
  isConnected(): boolean;
  /** Records the server has not acknowledged yet: waiting, being sent, refused, or held in a conflict. */
  unsentIds(): PendingIds;
  /**
   * Settles a conflict this device found. `theirs` and `office` show the other version here (the
   * office decides the second later); `mine` sends this device's version over it. Both versions
   * stay in the conflict record either way.
   */
  resolveConflict(conflictId: string, choice: ConflictChoice): Promise<boolean>;
  /**
   * Phase 16 (bulk edit): sends one change set to the server as it is, all or nothing, with the
   * version each record was loaded at. Only after the server stored it is it put on this device, so
   * a refused set changes nothing here either. Rejects with the server's `ApiError` (or
   * `ApiUnavailableError` when there is no connection); nothing is queued for later.
   */
  sendAtomic(changes: ChangeSet): Promise<ChangeResult>;
  /**
   * Phase 24b: `whole` always loads the whole network on this device; `auto` loads a big network by
   * map area. Reloads from the server (unsent changes are kept and sent).
   */
  setLoadPreference(preference: LoadPreference): Promise<void>;
  /**
   * Phase 24b: while loaded by map area, asks the server's search (`GET /search`) for what this device
   * does not hold and loads those records, so the search box finds them. `null` when the whole network
   * is here, there is no connection, or the server cannot search.
   */
  searchServer(query: string): Promise<{ total: number; loaded: number } | null>;
  /** Phase 24b: while loaded by map area, loads the place around a point (where a field worker stands). */
  loadPlace(lat: number, lng: number): Promise<void>;
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
  /** Phase 24b: from this many records (equipment, cables, customers, spans, ...) the network is loaded by map area. */
  areaModeMinRecords?: number;
  /** Quiet period after the map stops moving before a new area is loaded. */
  areaDebounceMs?: number;
  /** The screen size the map fits in (the map is never larger). */
  viewSize?: () => { width: number; height: number };
}

const screenSize = () => (typeof window === 'undefined' ? { width: 1280, height: 800 } : { width: window.innerWidth || 1280, height: window.innerHeight || 800 });

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
  areaModeMinRecords = AREA_MODE_MIN_RECORDS,
  areaDebounceMs = 400,
  viewSize = screenSize,
}: SyncEngineOptions = {}): SyncEngine {
  let started = false;
  let meta: SyncMeta = { revision: null, pending: {} };
  let sending: PendingIds | null = null;
  /** `signin`: login is on and this device has no session. Everything unsent is kept until someone logs in. */
  let link: 'connecting' | 'online' | 'offline' | 'signin' = 'connecting';
  let linkError: string | null = null;
  /** Records the server refused. They stay in this browser and do not hold up anything else. */
  let refused: RefusedRecord[] = [];
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

  /** The version of each record on the server, from the last load and every acknowledged write. */
  let serverVersions = new Map<string, number>();

  const refusedIds = (): PendingIds =>
    toPending(refused.map(({ collection, id }) => ({ collection: collection as CollectionName, id })));

  const held = (): PendingIds => meta.held ?? {};

  /** Not yet at the server; held conflicts count, so the local version is never overwritten. */
  const unsent = (): PendingIds => mergePending(meta.pending, refusedIds(), sending ?? {}, held());

  // Until the server acknowledges a batch, its ids stay in the persisted pending set. Held records
  // are saved apart, so a reload never sends them before a person chooses.
  const persistMeta = () => {
    const bases = meta.bases ?? {};
    // Phase 19: stored with the offline copy (IndexedDB), in the same transaction as the records it lists.
    cacheWrite(SYNC_META_STORAGE_KEY, {
      revision: meta.revision,
      pending: mergePending(meta.pending, refusedIds(), sending ?? {}),
      ...(Object.keys(bases).length > 0 ? { bases } : {}),
      ...(!isEmptyPending(held()) ? { held: held() } : {}),
      ...(meta.owner && !isEmptyPending(unsent()) ? { owner: meta.owner } : {}),
      ...(meta.mode === 'area' ? { mode: 'area' } : {}),
    });
  };

  /** The unsent changes were made by someone other than the person logged in now. */
  const otherOwner = (): SyncMeta['owner'] | null => {
    const account = useAuthStore.getState().account;
    return meta.owner && account && meta.owner.id !== account.id && !isEmptyPending(unsent()) ? meta.owner : null;
  };

  const updateStatus = () => {
    const pendingCount = countPending(unsent());
    let phase: SyncPhase;
    if (refused.length > 0) phase = 'error';
    else if (link !== 'online') phase = link;
    else if (sending) phase = 'saving';
    else if (pendingCount > 0) phase = 'pending';
    else phase = 'synced';
    useSyncStore.setState({
      phase,
      revision: meta.revision,
      pendingCount,
      lastSyncedAt,
      error: refused[0]
        ? describeRefusal(refused)
        : otherOwner()
          ? `${pendingCount} change(s) on this device were made by ${otherOwner()!.name}. They are kept and are sent only when ${otherOwner()!.name} logs in here.`
          : link === 'offline'
          ? linkError
          : link === 'signin'
            ? `Log in to send. ${pendingCount > 0 ? `${pendingCount} change(s) are kept on this device until then.` : 'Nothing is lost.'}`
            : null,
      refused,
      held: flatten(held()).map((k) => recordKey(k.collection, k.id)),
    });
  };

  const loadVersions = (versions: RecordVersions | undefined) => {
    serverVersions = new Map();
    for (const [collection, byId] of Object.entries(versions ?? {})) {
      for (const [id, version] of Object.entries(byId ?? {})) serverVersions.set(`${collection}/${id}`, version);
    }
  };

  /** After a write the server acknowledged: new versions known, bases kept only for records edited again meanwhile. */
  const recordWritten = (keys: readonly RecordKey[], result: ChangeResult) => {
    const bases = { ...(meta.bases ?? {}) };
    const editedAgain = new Set(flatten(meta.pending).map((k) => recordKey(k.collection, k.id)));
    for (const key of keys) {
      const k = recordKey(key.collection, key.id);
      const version = result.versions?.[key.collection]?.[key.id];
      if (version !== undefined) serverVersions.set(k, version);
      else serverVersions.delete(k);
      if (editedAgain.has(k) && version !== undefined) bases[k] = version;
      else delete bases[k];
    }
    meta.bases = bases;
  };

  /**
   * Someone else changed records this device edited. Each one is kept here as it is (held, not
   * sent) and both versions go into a conflict record the office can see, until a person chooses.
   * When both sides already hold the same thing (often this device's own earlier send), there is
   * nothing to choose. Returns the records of the batch that can still be sent.
   */
  function handleConflicts(keys: readonly RecordKey[], conflicts: readonly VersionConflict[]): RecordKey[] {
    const byKey = new Map(conflicts.map((c) => [recordKey(c.collection, c.id), c]));
    const snapshot = getNetworkSnapshot();
    const resend: RecordKey[] = [];
    const bases = { ...(meta.bases ?? {}) };
    let found = 0;
    const heldNow: RecordKey[] = [];
    for (const key of keys) {
      const k = recordKey(key.collection, key.id);
      const conflict = byKey.get(k);
      if (!conflict) {
        resend.push(key);
        continue;
      }
      if (conflict.current !== null) serverVersions.set(k, conflict.current);
      else serverVersions.delete(k);
      const mine = findRecord(snapshot, key) ?? null;
      if (sameValue(mine, conflict.record)) {
        delete bases[k];
        continue;
      }
      found += 1;
      heldNow.push(key);
      meta.held = mergePending(held(), toPending([key]));
      const record: SyncConflict = {
        id: `CNF-${randomCode(10)}`,
        collection: key.collection,
        recordId: key.id,
        label: recordLabel(key, snapshot).slice(0, 200),
        baseVersion: bases[k] ?? conflict.expected,
        theirVersion: conflict.current,
        mine,
        theirs: conflict.record,
        changedFields: changedFields(mine, conflict.record).slice(0, 300),
        detectedAt: new Date().toISOString(),
        detectedBy: `${deviceUser()} (this device)`,
        status: 'open',
      };
      useNetworkStore.getState().saveSyncConflict(record);
    }
    meta.bases = bases;
    if (found > 0) {
      logHistory('conflict', heldNow, 'Someone else changed it at the same time. Both versions are kept until a person chooses.');
      showToast('warning', 'Someone else changed this', `${found} item(s) were changed by someone else while you worked. Both versions are kept. Choose which one to keep.`);
    }
    return resend;
  }

  const applyRemote = (collections: Partial<NetworkSnapshot>) => {
    applyingRemote = true;
    try {
      // The server keeps the whole audit trail (Phase 9); this device keeps the newest entries only.
      const logs = collections.auditLogs;
      const trimmed = logs && logs.length > MAX_AUDIT_LOGS ? { ...collections, auditLogs: logs.slice(0, MAX_AUDIT_LOGS) } : collections;
      useNetworkStore.getState().replaceCollections(trimmed);
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
    if (!started || link !== 'online' || isEmptyPending(meta.pending)) return;
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

  /** The server wants a login. Nothing is refused or dropped: the work waits here until someone logs in. */
  const needLogin = () => {
    link = 'signin';
    linkError = null;
    clearFlushTimers();
    clearTimeout(reconnectTimer);
    stopPolling();
    updateStatus();
    // A temporary password: stay logged in and show the "choose your password" screen instead.
    if (passwordChangePending) useAuthStore.setState({ mustChangePassword: true });
    else useAuthStore.getState().markLoginNeeded();
    passwordChangePending = false;
  };

  let passwordChangePending = false;
  const isLoginError = (error: unknown) => {
    if (!(error instanceof ApiError)) return false;
    passwordChangePending = error.isPasswordChangeRequired;
    return error.isLoginRequired || error.isPasswordChangeRequired;
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
    showToast('error', 'Server Refused The Change', `${describeApiError(error)} Your edits are kept in this browser.`);
    updateStatus();
  };

  /**
   * Sends one group of records. When the server refuses the group, it is split in half until the
   * refused record stands alone, so one bad record cannot hold back the rest. Stops at a connection
   * failure, handing back what was not sent. Returns how many writes reached the server.
   */
  async function sendSplitting(keys: RecordKey[], notSent: RecordKey[]): Promise<number> {
    if (keys.length === 0) return 0;
    if (link !== 'online') {
      notSent.push(...keys);
      return 0;
    }
    try {
      const result = await client.applyChanges(buildChangeSet(toPending(keys), getNetworkSnapshot(), meta.bases));
      meta.revision = result.revision;
      recordWritten(keys, result);
      logHistory('sent', keys);
      return result.upserted + result.deleted;
    } catch (error) {
      if (isLoginError(error)) {
        notSent.push(...keys);
        needLogin();
        return 0;
      }
      if (isTransientError(error)) {
        notSent.push(...keys);
        goOffline(error);
        return 0;
      }
      if (error instanceof ApiError && error.isVersionConflict && error.conflicts.some((c) => keys.some((k) => k.collection === c.collection && k.id === c.id))) {
        return sendSplitting(handleConflicts(keys, error.conflicts), notSent);
      }
      return refuseOrSplit(keys, error, notSent);
    }
  }

  /** After a refusal: a lone record is refused by name; a group is split and each half tried again. */
  async function refuseOrSplit(keys: RecordKey[], error: unknown, notSent: RecordKey[]): Promise<number> {
    if (keys.length === 1) {
      const [key] = keys;
      logHistory('refused', keys, describeApiError(error));
      refused = [
        ...refused.filter((item) => !(item.collection === key.collection && item.id === key.id)),
        {
          ...key,
          label: recordLabel(key, getNetworkSnapshot()),
          reason: describeApiError(error),
        },
      ];
      return 0;
    }
    const middle = Math.ceil(keys.length / 2);
    const first = await sendSplitting(keys.slice(0, middle), notSent);
    const second = await sendSplitting(keys.slice(middle), notSent);
    return first + second;
  }

  async function connect(): Promise<void> {
    clearTimeout(reconnectTimer);
    // Phase 24b: a big network is loaded by map area (the whole load stays for small ones and as the fallback).
    if (await chooseAreaMode()) return connectByArea();
    let response;
    try {
      response = await client.getNetwork();
    } catch (error) {
      if (isLoginError(error)) needLogin();
      else goOffline(error);
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

    loadVersions(response.versions);
    // Bases are kept only for records still waiting; the rest now match the server.
    const waiting = new Set(flatten(unsent()).map((k) => recordKey(k.collection, k.id)));
    meta.bases = Object.fromEntries(Object.entries(meta.bases ?? {}).filter(([k]) => waiting.has(k)));
    meta.revision = response.revision;
    delete meta.mode;
    areaBoxes = [];
    areaTruncated = false;
    updateAreaStatus();
    link = 'online';
    linkError = null;
    retryAttempt = 0;
    lastSyncedAt = Date.now();
    persistMeta();
    updateStatus();
    startPolling();
    if (!isEmptyPending(meta.pending)) await send();
  }

  // ---------------------------------------------------------------------------------------------
  // Phase 24b: loading a big network by map area (see areaLoading.ts).

  /** The server cannot answer map-area or by-id reads (an older server): the whole load is used. */
  let areaUnsupported = false;
  /** Boxes loaded since the last full reload; a view inside one needs no new load. */
  let areaBoxes: AreaBox[] = [];
  let areaTruncated = false;
  let areaLoading = false;
  let serverAreaRecords: number | null = null;
  let areaTimer: ReturnType<typeof setTimeout> | undefined;
  let unsubscribeView: (() => void) | null = null;

  const viewport = () => useMapStore.getState().viewport;
  /** The view, or its middle when it is wider than what is loaded at once. */
  const currentBox = (): AreaBox => viewBox({ ...viewport(), zoom: Math.max(viewport().zoom, AREA_WIDEST_ZOOM) }, viewSize());

  function updateAreaStatus() {
    if (meta.mode !== 'area') {
      useAreaLoadStore.setState({ ...initialAreaLoadState, serverRecords: serverAreaRecords });
      return;
    }
    const snapshot = getNetworkSnapshot();
    const loadedRecords = AREA_COLLECTIONS.reduce((total, name) => total + (snapshot[name] as unknown[]).length, 0);
    useAreaLoadStore.setState({ mode: 'area', areas: areaBoxes.length, truncated: areaTruncated, wide: viewport().zoom < AREA_WIDEST_ZOOM, loading: areaLoading, serverRecords: serverAreaRecords, loadedRecords });
  }

  /** Whether to load by map area: a big network, a server that can, and this device not set to "whole". */
  async function chooseAreaMode(): Promise<boolean> {
    if (areaUnsupported || changesUnsupported || !client.getArea || !client.getNetworkExcept || !client.getRecords || !client.getChanges) return false;
    if (readLoadPreference() === 'whole') {
      serverAreaRecords = null;
      return false;
    }
    try {
      const health = await client.health();
      serverAreaRecords = health.counts ? areaRecordCount(health.counts) : null;
    } catch {
      // The whole load below reports the problem (offline, login) exactly as before.
      return false;
    }
    return serverAreaRecords !== null && serverAreaRecords >= areaModeMinRecords;
  }

  /** Puts loaded records on this device (never takes any away) and notes their server versions. */
  const applyLoaded = (data: Partial<NetworkSnapshot>, versions: RecordVersions | undefined) => {
    const changed = mergeLoaded(getNetworkSnapshot(), data, unsent());
    if (Object.keys(changed).length > 0) applyRemote(changed);
    for (const [collection, byId] of Object.entries(versions ?? {})) {
      for (const [id, version] of Object.entries(byId ?? {})) serverVersions.set(`${collection}/${id}`, version);
    }
  };

  /** Loads the records the loaded ones point to and this device does not hold (one step). Returns the oldest revision read. */
  async function loadReferences(loaded: Partial<NetworkSnapshot>): Promise<number | null> {
    const ids = missingReferences(loaded, getNetworkSnapshot()).slice(0, 3_000);
    let oldest: number | null = null;
    for (let i = 0; i < ids.length; i += 1_000) {
      const found = await client.getRecords!(ids.slice(i, i + 1_000), AREA_COLLECTIONS);
      if (!started) return oldest;
      applyLoaded(found.data, found.versions);
      oldest = oldest === null ? found.revision : Math.min(oldest, found.revision);
    }
    return oldest;
  }

  /**
   * A full load by map area: every collection not loaded by area, in full, and the area in view.
   * What this device held of the area collections is replaced by that, except records with unsent
   * edits (they stay as they are here). Then every record is brought to one revision with the
   * changes since the oldest read.
   */
  async function connectByArea(): Promise<void> {
    const box = currentBox();
    let rest: RecordsResponse;
    let area: AreaResponse;
    try {
      [rest, area] = await Promise.all([client.getNetworkExcept!(AREA_COLLECTIONS), client.getArea!(box, AREA_COLLECTIONS)]);
    } catch (error) {
      if (isLoginError(error)) needLogin();
      else if (error instanceof ApiError && error.status === 404) {
        // An older server: load the whole network, as before.
        areaUnsupported = true;
        return connect();
      } else goOffline(error);
      return;
    }
    if (!started) return;

    if (meta.revision === null && wasLoadedFromCache()) {
      // As in the whole load: edits of the demo network made before this browser had a server.
      const legacyEdits = changedIds(createSampleNetwork(), getNetworkSnapshot(), sameValue);
      meta.pending = mergePending(meta.pending, legacyEdits);
    }
    const local = getNetworkSnapshot();
    const byArea = new Set<string>(AREA_COLLECTIONS);
    const server = Object.fromEntries(
      Object.keys(local)
        .filter(isCollectionName)
        .map((name) => [name, byArea.has(name) ? (area.data[name] ?? []) : (rest.data[name] ?? [])]),
    ) as unknown as NetworkSnapshot;
    const merged = reconcile(server, local, unsent());
    const changed = differingCollections(local, merged);
    if (Object.keys(changed).length > 0) applyRemote(changed);

    loadVersions({ ...rest.versions, ...area.versions });
    const waiting = new Set(flatten(unsent()).map((k) => recordKey(k.collection, k.id)));
    meta.bases = Object.fromEntries(Object.entries(meta.bases ?? {}).filter(([k]) => waiting.has(k)));
    meta.revision = Math.min(rest.revision, area.revision);
    meta.mode = 'area';
    // A cut-short answer is not counted as loaded, so zooming in loads that place again.
    areaBoxes = area.truncated ? [] : [box];
    areaTruncated = area.truncated;
    link = 'online';
    linkError = null;
    retryAttempt = 0;
    lastSyncedAt = Date.now();
    persistMeta();
    updateStatus();
    updateAreaStatus();
    startPolling();
    let behind = Math.max(rest.revision, area.revision) !== meta.revision;
    try {
      const refs = await loadReferences(area.data);
      if (refs !== null && refs !== meta.revision) behind = true;
    } catch (error) {
      if (isLoginError(error)) return needLogin();
      if (isTransientError(error)) return goOffline(error);
    }
    if (!started) return;
    updateAreaStatus();
    if (behind) await catchUp(meta.revision);
    else if (!isEmptyPending(meta.pending)) await send();
  }

  /** Loads the area in view when it is not loaded yet. Adds records only; then catches up to one revision. */
  async function loadArea(box: AreaBox = currentBox()): Promise<void> {
    if (!started || link !== 'online' || meta.mode !== 'area' || !client.getArea) return;
    if (isCovered(areaBoxes, box)) {
      updateAreaStatus();
      return;
    }
    const before = meta.revision;
    areaLoading = true;
    updateAreaStatus();
    try {
      const area = await client.getArea(box, AREA_COLLECTIONS);
      if (!started || meta.mode !== 'area') return;
      applyLoaded(area.data, area.versions);
      areaTruncated = area.truncated;
      if (!area.truncated) areaBoxes = [...areaBoxes.slice(-49), box];
      const refs = await loadReferences(area.data);
      if (before !== null && (area.revision !== before || (refs !== null && refs !== before))) await catchUp(before);
    } catch (error) {
      if (isLoginError(error)) needLogin();
      else if (isTransientError(error)) goOffline(error);
    } finally {
      areaLoading = false;
      updateAreaStatus();
    }
  }

  const scheduleAreaLoad = () => {
    if (meta.mode !== 'area') return;
    clearTimeout(areaTimer);
    areaTimer = setTimeout(() => void exclusive(() => loadArea()), areaDebounceMs);
  };

  function searchServer(query: string): Promise<{ total: number; loaded: number } | null> {
    if (!started || link !== 'online' || meta.mode !== 'area' || !client.search || !client.getRecords || !query.trim()) return Promise.resolve(null);
    return exclusive(async () => {
      try {
        const result = await client.search!(query);
        const held = getNetworkSnapshot();
        const here = new Set<string>();
        for (const name of AREA_COLLECTIONS) for (const r of held[name] as unknown as { id: string }[]) here.add(r.id);
        const byArea = new Set<string>(AREA_COLLECTIONS);
        const missing = [...new Set(result.hits.filter((hit) => byArea.has(hit.collection) && !here.has(hit.id)).map((hit) => hit.id))];
        if (missing.length === 0) return { total: result.total, loaded: 0 };
        const before = meta.revision;
        const found = await client.getRecords!(missing.slice(0, 1_000), AREA_COLLECTIONS);
        if (!started) return null;
        applyLoaded(found.data, found.versions);
        const loaded = Object.values(found.data).reduce((n, list) => n + (list?.length ?? 0), 0);
        updateAreaStatus();
        if (before !== null && found.revision !== before) await catchUp(before);
        return { total: result.total, loaded };
      } catch (error) {
        if (isLoginError(error)) needLogin();
        else if (isTransientError(error)) goOffline(error);
        return null;
      }
    });
  }

  /** The server has no `GET /changes` (an older server): every check loads the whole network, as before. */
  let changesUnsupported = false;

  /**
   * Phase 24: brings this device up to date from `since` with only what changed on the server,
   * merged exactly as a full load is (unsent records keep their local version). Anything unusual
   * (no history that far back, an older server, an unreadable answer) loads the whole network.
   */
  async function catchUp(since: number | null): Promise<void> {
    if (since === null || !client.getChanges || changesUnsupported) return connect();
    let changes: ChangesResponse;
    try {
      changes = await client.getChanges(since);
    } catch (error) {
      if (isLoginError(error)) {
        needLogin();
        return;
      }
      if (error instanceof ApiError && error.status === 404) changesUnsupported = true;
      return connect();
    }
    if (!started) return;
    if (changes.reload) return connect();

    const local = getNetworkSnapshot();
    const merged = reconcile(applyServerChanges(local, changes), local, unsent());
    const changed = differingCollections(local, merged);
    if (Object.keys(changed).length > 0) applyRemote(changed);

    for (const [collection, ids] of Object.entries(changes.deletes)) for (const id of ids ?? []) serverVersions.delete(`${collection}/${id}`);
    for (const [collection, byId] of Object.entries(changes.versions)) {
      for (const [id, version] of Object.entries(byId ?? {})) serverVersions.set(`${collection}/${id}`, version);
    }
    const waiting = new Set(flatten(unsent()).map((k) => recordKey(k.collection, k.id)));
    meta.bases = Object.fromEntries(Object.entries(meta.bases ?? {}).filter(([k]) => waiting.has(k)));
    meta.revision = changes.revision;
    lastSyncedAt = Date.now();
    persistMeta();
    updateStatus();
    if (meta.mode === 'area') updateAreaStatus();
    if (!isEmptyPending(meta.pending)) await send();
  }

  async function send(): Promise<void> {
    clearFlushTimers();
    if (link !== 'online' || isEmptyPending(meta.pending)) return;
    // Never send one person's work under another person's login.
    if (otherOwner()) {
      updateStatus();
      return;
    }
    const batch = meta.pending;
    sending = batch;
    meta.pending = {};
    updateStatus();

    const expected = meta.revision;
    let result;
    try {
      result = await client.applyChanges(buildChangeSet(batch, getNetworkSnapshot(), meta.bases));
    } catch (error) {
      if (isLoginError(error) || isTransientError(error)) {
        meta.pending = mergePending(batch, meta.pending);
        sending = null;
        persistMeta();
        if (isLoginError(error)) needLogin();
        else handleFailure(error);
        return;
      }
      const keys = flatten(batch);
      const matches = error instanceof ApiError && error.isVersionConflict && error.conflicts.some((c) => keys.some((k) => k.collection === c.collection && k.id === c.id));
      if (error instanceof ApiError && matches) {
        // Hold what someone else changed; send the rest straight away.
        const rest = handleConflicts(keys, error.conflicts);
        meta.pending = mergePending(toPending(rest), meta.pending);
        sending = null;
        persistMeta();
        updateStatus();
        if (link === 'online') await send();
        return;
      }
      // The server refused this batch: send what it will take and report the rest by name.
      const known = new Set(refused.map((item) => `${item.collection}/${item.id}`));
      const notSent: RecordKey[] = [];
      await refuseOrSplit(flatten(batch), error, notSent);
      meta.pending = mergePending(toPending(notSent), meta.pending);
      sending = null;
      const fresh = refused.filter((item) => !known.has(`${item.collection}/${item.id}`));
      if (fresh.length > 0) {
        const [first] = fresh;
        const more = fresh.length > 1 ? ` and ${fresh.length - 1} more` : '';
        showToast(
          'error',
          'One Item Was Not Sent',
          `${first.label}${more} was refused. Everything else was sent. It stays in this browser: correct it, then tap Retry in the sync menu.`,
        );
      }
      lastSyncedAt = Date.now();
      persistMeta();
      updateStatus();
      if (link === 'online') await connect();
      return;
    }

    sending = null;
    recordWritten(flatten(batch), result);
    logHistory('sent', flatten(batch));
    const wrote = result.upserted + result.deleted > 0;
    const someoneElseWrote = expected !== null && result.revision !== (wrote ? expected + 1 : expected);
    meta.revision = result.revision;
    lastSyncedAt = Date.now();
    persistMeta();
    updateStatus();
    // Phase 24: only what changed since this device's last known revision (its own write included).
    if (someoneElseWrote) await catchUp(expected);
    else scheduleFlush();
  }

  async function poll(): Promise<void> {
    if (busy > 0 || link !== 'online' || sending || !isEmptyPending(meta.pending)) return;
    await exclusive(async () => {
      try {
        const health = await client.health();
        // No revision: the server no longer sees a login here, and loading will ask for one.
        if (health.revision === undefined) await connect();
        else if (health.revision !== meta.revision) await catchUp(meta.revision);
      } catch (error) {
        if (isLoginError(error)) needLogin();
        if (isTransientError(error)) goOffline(error);
      }
    });
  }

  const flush = () => exclusive(send);

  const onLocalChange = (state: NetworkSnapshot, prev: NetworkSnapshot) => {
    if (applyingRemote) return;
    const changedAll = changedIds(prev, state);
    // Audit entries this device drops to keep only its newest are not deleted on the server.
    const keptLogs = new Set(state.auditLogs.map((l) => l.id));
    const all = changedAll.auditLogs ? { ...changedAll, auditLogs: changedAll.auditLogs.filter((id) => keptLogs.has(id)) } : changedAll;
    if (all.auditLogs?.length === 0) delete all.auditLogs;
    if (isEmptyPending(all)) return;
    // A record in an open conflict stays held: further edits wait for the person's choice.
    const heldKeys = new Set(flatten(held()).map((k) => recordKey(k.collection, k.id)));
    const changed = withoutKeys(all, flatten(all).filter((k) => heldKeys.has(recordKey(k.collection, k.id))));
    // The version this edit starts from: the first edit since the server last had the record.
    const bases = { ...(meta.bases ?? {}) };
    for (const key of flatten(changed)) {
      const k = recordKey(key.collection, key.id);
      if (bases[k] === undefined && serverVersions.has(k)) bases[k] = serverVersions.get(k)!;
    }
    meta.bases = bases;
    // The first unsent change says whose work this is; nobody logged in (login off) leaves it open.
    if (isEmptyPending(unsent())) {
      const account = currentAccount();
      meta.owner = account ? { id: account.id, name: account.displayName } : undefined;
    }
    meta.pending = mergePending(meta.pending, changed);
    // An edit may fix what the server refused, so that record gets another try.
    const edited = new Set(flatten(changed).map((key) => `${key.collection}/${key.id}`));
    refused = refused.filter((item) => !edited.has(`${item.collection}/${item.id}`));
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
    const changes = buildChangeSet(withoutKeys(ids, flatten(held())), getNetworkSnapshot(), meta.bases);
    if (JSON.stringify(changes).length > KEEPALIVE_BODY_LIMIT) return;
    client.applyChanges(changes, { keepalive: true }).catch(() => undefined);
  };

  /** Reset and restore need the server (safety copy and checks), so offline they are refused plainly. */
  const needServer = (what: string): SyncOutcome => {
    showToast('warning', 'Needs the server', `${what} works only with a connection to the office server, which saves a safety copy first. Nothing was changed.`);
    return 'failed';
  };

  /** After the server replaced collections: drop what was waiting for them and reload. */
  const afterRestore = async (result: RestoreResult, projectStartPoint?: ParsedBackup['projectStartPoint']) => {
    useRestoreStore.getState().setLastResult({
      restored: result.restored,
      safetyCopy: result.safetyCopy,
      photosAdded: result.photosAdded,
      photosSkipped: result.photosSkipped,
      acceptedProblems: result.acceptedProblems,
    });
    meta.pending = omitCollections(meta.pending, result.restored);
    meta.held = omitCollections(held(), result.restored);
    meta.bases = Object.fromEntries(Object.entries(meta.bases ?? {}).filter(([k]) => !result.restored.includes(k.split('/')[0] as CollectionName)));
    refused = refused.filter((item) => !result.restored.includes(item.collection as CollectionName));
    persistMeta();
    await connect();
    const start = projectStartPoint ?? result.projectStartPoint;
    if (start) useNetworkStore.getState().setProjectStartPoint(start);
  };

  const runRestore = (send: () => Promise<RestoreResult>, projectStartPoint?: ParsedBackup['projectStartPoint']) =>
    exclusive(async (): Promise<SyncOutcome> => {
      if (started && link === 'online') await sendPending();
      if (!started || link !== 'online') return needServer('Restore');
      try {
        await afterRestore(await send(), projectStartPoint);
        return 'server';
      } catch (error) {
        if (error instanceof ApiError && error.code === 'restore_refused') throw error;
        if (isLoginError(error)) needLogin();
        else if (isTransientError(error)) goOffline(error);
        else handleFailure(error);
        return 'failed';
      }
    });

  const sendPending = () => send();

  // After a login, send what waited and load what changed meanwhile.
  useAuthStore.subscribe((state, prev) => {
    // A real logout (not an expired session) on a shared device, with nothing waiting to be sent:
    // the stored copy of the network goes too, so the next person does not find the customer list.
    if (prev.lastAccount && !state.lastAccount && !state.account && state.mode === 'enforced' && isEmptyPending(unsent())) forgetCachedNetwork();
    const ready = state.account && !state.mustChangePassword;
    const nowReady = state.account !== prev.account || (prev.mustChangePassword && !state.mustChangePassword);
    if (started && ready && nowReady && link === 'signin') {
      retryAttempt = 0;
      void exclusive(connect);
    }
  });

  return {
    setLoadPreference: (preference) =>
      exclusive(async () => {
        writeLoadPreference(preference);
        if (!started) return;
        if (link === 'online' && !isEmptyPending(meta.pending)) await send();
        await connect();
      }),

    searchServer,

    loadPlace: (lat, lng) => (meta.mode === 'area' ? exclusive(() => loadArea(viewBox({ lat, lng, zoom: 18 }, { width: 800, height: 800 }))) : Promise.resolve()),

    start() {
      if (started) return;
      started = true;
      meta = cacheRead<SyncMeta>(SYNC_META_STORAGE_KEY, { revision: null, pending: {} }, isSyncMeta);
      meta.pending = withoutKeys(meta.pending, flatten(held()));
      link = 'connecting';
      updateStatus();
      // Phase 24b: a copy loaded by map area says so at once, also while offline.
      updateAreaStatus();
      unsubscribe = useNetworkStore.subscribe(onLocalChange);
      unsubscribeView = useMapStore.subscribe((state, prev) => {
        if (state.viewport !== prev.viewport) scheduleAreaLoad();
      });
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
      unsubscribeView?.();
      unsubscribeView = null;
      clearTimeout(areaTimer);
      clearFlushTimers();
      clearTimeout(reconnectTimer);
      stopPolling();
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', onOnline);
        window.removeEventListener('pagehide', onPageHide);
        document.removeEventListener('visibilitychange', onVisibilityChange);
      }
      useSyncStore.setState(initialSyncState);
      useAreaLoadStore.setState(initialAreaLoadState);
    },

    flush,

    refresh: () => poll(),

    retry: () =>
      exclusive(async () => {
        meta.pending = mergePending(meta.pending, refusedIds());
        refused = [];
        retryAttempt = 0;
        updateStatus();
        if (link === 'online') await send();
        else await connect();
      }),

    discardLocalChanges: () =>
      exclusive(async () => {
        meta.pending = {};
        meta.held = {};
        meta.bases = {};
        refused = [];
        persistMeta();
        updateStatus();
        await connect();
      }),

    reset: () =>
      exclusive(async (): Promise<SyncOutcome> => {
        // Catalog edits survive a reset, so they are saved first.
        if (started && link === 'online') await send();
        if (!started || link !== 'online') return needServer('Reset');
        try {
          await client.reset();
          meta.pending = meta.pending.catalog ? { catalog: meta.pending.catalog } : {};
          meta.held = {};
          meta.bases = {};
          refused = [];
          persistMeta();
          await connect();
          return 'server';
        } catch (error) {
          if (isLoginError(error)) needLogin();
          else if (isTransientError(error)) goOffline(error);
          else handleFailure(error);
          return 'failed';
        }
      }),

    restore: (backup, options = {}) => runRestore(() => client.restore(backup, options), backup.projectStartPoint),

    restoreZip: (zip, options = {}) =>
      runRestore(() => {
        if (!client.restoreZip) throw new ApiError(400, 'not_supported', 'This client cannot send zip backups.');
        return client.restoreZip(zip, options);
      }),

    isConnected: () => started && link === 'online',

    unsentIds: () => unsent(),

    resolveConflict: (conflictId, choice) =>
      exclusive(async () => {
        const store = useNetworkStore.getState();
        const conflict = store.syncConflicts.find((c) => c.id === conflictId);
        if (!conflict || conflict.status !== 'open' || !isCollectionName(conflict.collection)) return false;
        const key: RecordKey = { collection: conflict.collection, id: conflict.recordId };
        const k = recordKey(key.collection, key.id);
        meta.held = withoutKeys(held(), [key]);
        const bases = { ...(meta.bases ?? {}) };
        if (choice === 'mine') {
          // Sent over theirs, checked against the version this device was shown.
          if (conflict.theirVersion !== null) bases[k] = conflict.theirVersion;
          else delete bases[k];
          meta.pending = mergePending(meta.pending, toPending([key]));
        } else {
          // Show the other version here. With "office decides", the office chooses later; this
          // device's version stays in the conflict record.
          const list = store[key.collection] as readonly { id: string }[];
          const theirs = conflict.theirs as { id: string } | null;
          const next = theirs ? (list.some((r) => r.id === key.id) ? list.map((r) => (r.id === key.id ? theirs : r)) : [...list, theirs]) : list.filter((r) => r.id !== key.id);
          applyRemote({ [key.collection]: next } as Partial<NetworkSnapshot>);
          if (conflict.theirVersion !== null) serverVersions.set(k, conflict.theirVersion);
          delete bases[k];
          meta.pending = withoutKeys(meta.pending, [key]);
        }
        meta.bases = bases;
        const status = choice === 'mine' ? 'kept_mine' : choice === 'theirs' ? 'kept_theirs' : 'office_decides';
        const who = `${deviceUser()} (this device)`;
        useNetworkStore.getState().saveSyncConflict({ ...conflict, status, decidedAt: new Date().toISOString(), decidedBy: who });
        useNetworkStore.getState().logAudit({
          action: 'SYNC_CONFLICT_CHOICE',
          details: `${conflict.label}: ${status.replace('_', ' ')} (conflict ${conflict.id}; both versions kept)`,
          assetId: conflict.id,
          assetType: 'SyncConflict',
        });
        persistMeta();
        updateStatus();
        if (link === 'online') await send();
        return true;
      }),

    // Phase 16: one checked write, all or nothing, put on this device only once the server stored it.
    sendAtomic: (changes) =>
      exclusive(async () => {
        if (!started || link !== 'online') {
          throw new ApiUnavailableError('Changing many items at once needs the connection to the office server, so every rule is checked at once. Nothing was changed.');
        }
        const keys: RecordKey[] = [];
        for (const [collection, list] of Object.entries(changes.upserts ?? {})) for (const r of (list ?? []) as { id: string }[]) keys.push({ collection: collection as CollectionName, id: r.id });
        for (const [collection, ids] of Object.entries(changes.deletes ?? {})) for (const id of (ids ?? []) as string[]) keys.push({ collection: collection as CollectionName, id });
        const expect: Partial<Record<CollectionName, Record<string, number>>> = {};
        for (const key of keys) {
          const version = serverVersions.get(recordKey(key.collection, key.id));
          if (version !== undefined) (expect[key.collection] ??= {})[key.id] = version;
        }
        const before = meta.revision;
        let result: ChangeResult;
        try {
          result = await client.applyChanges({ ...changes, ...(Object.keys(expect).length > 0 ? { expect } : {}) });
        } catch (error) {
          if (isLoginError(error)) needLogin();
          else if (isTransientError(error)) goOffline(error);
          throw error;
        }
        const local = getNetworkSnapshot();
        const merged = applyServerChanges(local, { upserts: (changes.upserts ?? {}) as never, deletes: (changes.deletes ?? {}) as never });
        const changed = differingCollections(local, merged);
        if (Object.keys(changed).length > 0) applyRemote(changed);
        recordWritten(keys, result);
        logHistory('sent', keys);
        const wrote = result.upserted + result.deleted > 0;
        const someoneElseWrote = before !== null && result.revision !== (wrote ? before + 1 : before);
        meta.revision = result.revision;
        lastSyncedAt = Date.now();
        persistMeta();
        updateStatus();
        if (someoneElseWrote) await catchUp(before);
        return result;
      }),
  };
}

export const syncEngine = createSyncEngine();
