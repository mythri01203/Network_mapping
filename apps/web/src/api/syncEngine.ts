import {
  type ChangeResult,
  type CollectionName,
  isCollectionName,
  type NetworkSnapshot,
  type ParsedBackup,
  randomCode,
  type RecordVersions,
  type SyncConflict,
  type VersionConflict,
} from '@fibergis/shared';
import { createSampleNetwork } from '@fibergis/shared/sample';

import { readJson, writeJson } from '../lib/storage';
import { currentAccount, useAuthStore } from '../stores/authStore';
import { forgetCachedNetwork, getNetworkSnapshot, MAX_AUDIT_LOGS, SYNC_META_STORAGE_KEY, useNetworkStore, wasLoadedFromCache } from '../stores/networkStore';
import { useRestoreStore } from '../stores/restoreStore';
import { initialSyncState, type RefusedRecord, type SyncPhase, useSyncStore } from '../stores/syncStore';
import { showToast } from '../stores/toastStore';
import { useUiStore } from '../stores/uiStore';
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
import { type ApiClient, apiClient, ApiError, describeApiError, isTransientError, type RestoreResult } from './client';

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
}

const isPendingIds = (value: unknown): boolean =>
  typeof value === 'object' &&
  value !== null &&
  Object.values(value).every((ids) => Array.isArray(ids) && ids.every((id) => typeof id === 'string'));

const isSyncMeta = (value: unknown): boolean => {
  if (typeof value !== 'object' || value === null) return false;
  const { revision, pending, bases, held, owner } = value as Partial<SyncMeta>;
  return (
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
    writeJson(SYNC_META_STORAGE_KEY, {
      revision: meta.revision,
      pending: mergePending(meta.pending, refusedIds(), sending ?? {}),
      ...(Object.keys(bases).length > 0 ? { bases } : {}),
      ...(!isEmptyPending(held()) ? { held: held() } : {}),
      ...(meta.owner && !isEmptyPending(unsent()) ? { owner: meta.owner } : {}),
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
    link = 'online';
    linkError = null;
    retryAttempt = 0;
    lastSyncedAt = Date.now();
    persistMeta();
    updateStatus();
    startPolling();
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
        // No revision: the server no longer sees a login here, and loading will ask for one.
        if (health.revision === undefined || health.revision !== meta.revision) await connect();
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
    start() {
      if (started) return;
      started = true;
      meta = readJson<SyncMeta>(SYNC_META_STORAGE_KEY, { revision: null, pending: {} }, isSyncMeta);
      meta.pending = withoutKeys(meta.pending, flatten(held()));
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
  };
}

export const syncEngine = createSyncEngine();
