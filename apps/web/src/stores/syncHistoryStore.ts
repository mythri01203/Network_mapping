import { create } from 'zustand';

import { randomCode } from '@fibergis/shared';

import { cacheRead, cacheRemove, cacheWrite } from '../lib/officeCache';

/**
 * Phase 19: what this device sent to the office, when, and what came back: sent, refused with the
 * server's reason, or held because someone else changed the same record (a conflict). It is this
 * device's own log, kept with the offline copy (IndexedDB), never sent to the server. The office
 * screen and the phone capture screen both read it.
 */

export type SyncHistoryResult = 'sent' | 'refused' | 'conflict';
/** `changes`: records sent by the sync engine. `photo`: one photo sent by the phone capture flow. */
export type SyncHistoryKind = 'changes' | 'photo';

export interface SyncHistoryEntry {
  id: string;
  /** When this device got the answer (its own clock). */
  at: number;
  result: SyncHistoryResult;
  kind: SyncHistoryKind;
  /** How many records or photos. */
  count: number;
  /** What a person calls them, at most a few. */
  labels: string[];
  /** Audit notes sent with the records, counted apart. */
  notes?: number;
  /** The server's reason (refused), or what happens next (conflict). */
  reason?: string;
}

export const SYNC_HISTORY_KEY = 'sync_history';
export const SYNC_HISTORY_MAX = 300;
export const SYNC_HISTORY_KEEP_MS = 30 * 24 * 3600_000;
const MAX_LABELS = 5;

const RESULTS = new Set<SyncHistoryResult>(['sent', 'refused', 'conflict']);
const isEntry = (v: unknown): v is SyncHistoryEntry => {
  const e = v as Partial<SyncHistoryEntry> | null;
  return (
    typeof e === 'object' &&
    e !== null &&
    typeof e.id === 'string' &&
    typeof e.at === 'number' &&
    RESULTS.has(e.result as SyncHistoryResult) &&
    (e.kind === 'changes' || e.kind === 'photo') &&
    typeof e.count === 'number' &&
    Array.isArray(e.labels)
  );
};
const isEntries = (v: unknown) => Array.isArray(v) && v.every(isEntry);

export const useSyncHistory = create<{ entries: SyncHistoryEntry[] }>(() => ({ entries: [] }));

let loaded = false;

/** Reads the log from the device once (after the office cache has started). */
export function loadSyncHistory(): SyncHistoryEntry[] {
  if (!loaded) {
    loaded = true;
    useSyncHistory.setState({ entries: cacheRead<SyncHistoryEntry[]>(SYNC_HISTORY_KEY, [], isEntries) });
  }
  return useSyncHistory.getState().entries;
}

export interface SyncHistoryInput extends Omit<SyncHistoryEntry, 'id' | 'at' | 'labels'> {
  at?: number;
  labels: readonly string[];
}

/** Adds one line, newest first. Lines older than 30 days, and beyond the newest 300, are dropped. */
export function recordSyncHistory(input: SyncHistoryInput): void {
  const at = input.at ?? Date.now();
  const entry: SyncHistoryEntry = {
    id: `SH-${randomCode(10)}`,
    at,
    result: input.result,
    kind: input.kind,
    count: input.count,
    labels: input.labels.slice(0, MAX_LABELS).map((l) => l.slice(0, 120)),
    ...(input.notes ? { notes: input.notes } : {}),
    ...(input.reason ? { reason: input.reason.slice(0, 500) } : {}),
  };
  const kept = [entry, ...loadSyncHistory()].filter((e) => at - e.at <= SYNC_HISTORY_KEEP_MS).slice(0, SYNC_HISTORY_MAX);
  useSyncHistory.setState({ entries: kept });
  cacheWrite(SYNC_HISTORY_KEY, kept);
}

/**
 * After a logout on a shared device (with the stored network): the lines name records, such as
 * customers, so they go too.
 */
export function forgetSyncHistory(): void {
  loaded = true;
  useSyncHistory.setState({ entries: [] });
  cacheRemove([SYNC_HISTORY_KEY]);
}

/** Tests only: forget what was read, so the next read comes from the cache again. */
export function resetSyncHistoryForTests(): void {
  loaded = false;
  useSyncHistory.setState({ entries: [] });
}
