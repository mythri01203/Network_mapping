import { type ChangeSet, COLLECTION_NAMES, type CollectionName, type NetworkSnapshot } from '@fibergis/shared';

/** Ids of records changed locally and not yet acknowledged by the server, per collection. */
export type PendingIds = Partial<Record<CollectionName, string[]>>;

type Identified = { id: string };
type Snapshot = Record<CollectionName, readonly Identified[]>;

/**
 * Ids whose record was added, replaced or removed between two snapshots. Store updates are
 * immutable, so reference equality finds edits cheaply; pass `sameValue` to compare by content.
 */
export function changedIds(
  prev: Snapshot,
  next: Snapshot,
  same: (a: unknown, b: unknown) => boolean = Object.is,
): PendingIds {
  const result: PendingIds = {};
  for (const name of COLLECTION_NAMES) {
    const before = prev[name];
    const after = next[name];
    if (before === after) continue;

    const previous = new Map(before.map((record) => [record.id, record]));
    const ids = new Set<string>();
    for (const record of after) {
      const old = previous.get(record.id);
      if (!old || !same(old, record)) ids.add(record.id);
      previous.delete(record.id);
    }
    for (const id of previous.keys()) ids.add(id);
    if (ids.size > 0) result[name] = [...ids];
  }
  return result;
}

export function mergePending(...sets: PendingIds[]): PendingIds {
  const result: PendingIds = {};
  for (const name of COLLECTION_NAMES) {
    const ids = new Set(sets.flatMap((set) => set[name] ?? []));
    if (ids.size > 0) result[name] = [...ids];
  }
  return result;
}

export const countPending = (pending: PendingIds): number =>
  COLLECTION_NAMES.reduce((total, name) => total + (pending[name]?.length ?? 0), 0);

export const isEmptyPending = (pending: PendingIds): boolean => countPending(pending) === 0;

export function omitCollections(pending: PendingIds, names: readonly CollectionName[]): PendingIds {
  const result: PendingIds = { ...pending };
  for (const name of names) delete result[name];
  return result;
}

/** Pending ids become upserts when the record still exists locally and deletes otherwise. */
export function buildChangeSet(pending: PendingIds, snapshot: NetworkSnapshot): ChangeSet {
  const upserts: Record<string, Identified[]> = {};
  const deletes: Record<string, string[]> = {};
  for (const name of COLLECTION_NAMES) {
    const ids = pending[name];
    if (!ids?.length) continue;
    const local = new Map((snapshot[name] as readonly Identified[]).map((record) => [record.id, record]));
    for (const id of ids) {
      const record = local.get(id);
      if (record) (upserts[name] ??= []).push(record);
      else (deletes[name] ??= []).push(id);
    }
  }
  return {
    ...(Object.keys(upserts).length > 0 ? { upserts: upserts as ChangeSet['upserts'] } : {}),
    ...(Object.keys(deletes).length > 0 ? { deletes } : {}),
  };
}

/**
 * Structural equality for JSON-like records. Key order and `undefined` properties are ignored,
 * because the server stores validated copies that drop unset optional fields.
 */
export function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => sameValue(item, b[index]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (!sameValue(left[key], right[key])) return false;
  }
  return true;
}

const byNewestFirst = (a: { timestamp: string }, b: { timestamp: string }) =>
  a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0;

/**
 * Merges a server snapshot with local state. The server wins for every record without unsent
 * local edits; pending records keep their local version (or stay deleted). Unchanged records and
 * collections keep their local object identity so React and the undo history are not disturbed.
 */
export function reconcile(server: NetworkSnapshot, local: NetworkSnapshot, pending: PendingIds): NetworkSnapshot {
  const result = {} as Record<CollectionName, Identified[]>;
  for (const name of COLLECTION_NAMES) {
    const serverRecords = server[name] as readonly Identified[];
    const localRecords = local[name] as readonly Identified[];
    const pendingIds = new Set(pending[name] ?? []);
    const localById = new Map(localRecords.map((record) => [record.id, record]));

    const merged: Identified[] = [];
    for (const record of serverRecords) {
      const mine = localById.get(record.id);
      if (pendingIds.has(record.id)) {
        if (mine) merged.push(mine);
        continue;
      }
      merged.push(mine && sameValue(mine, record) ? mine : record);
    }
    const serverIds = new Set(serverRecords.map((record) => record.id));
    for (const record of localRecords) {
      if (pendingIds.has(record.id) && !serverIds.has(record.id)) merged.push(record);
    }

    if (name === 'auditLogs') (merged as unknown as { timestamp: string }[]).sort(byNewestFirst);

    const unchanged = merged.length === localRecords.length && merged.every((record, i) => record === localRecords[i]);
    result[name] = unchanged ? (localRecords as Identified[]) : merged;
  }
  return result as unknown as NetworkSnapshot;
}

/** Collections whose array differs (by reference) between two snapshots. */
export const differingCollections = (a: NetworkSnapshot, b: NetworkSnapshot): Partial<NetworkSnapshot> =>
  Object.fromEntries(COLLECTION_NAMES.filter((name) => a[name] !== b[name]).map((name) => [name, b[name]]));
