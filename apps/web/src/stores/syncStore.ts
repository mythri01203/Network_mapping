import { create } from 'zustand';

import { onStorageWrite } from '../lib/storage';
import { showToast } from './toastStore';

/**
 * - `connecting`: loading the network from the server.
 * - `synced`: the server has every local change.
 * - `pending` / `saving`: local changes are waiting for / being sent to the server.
 * - `offline`: the server is unreachable; changes are kept in this browser and retried.
 * - `signin`: login is on and nobody is logged in here; changes are kept and sent after login (Phase 9).
 * - `error`: the server refused a record; it stays local until fixed, retried or discarded.
 */
export type SyncPhase = 'connecting' | 'synced' | 'pending' | 'saving' | 'offline' | 'signin' | 'error';

/** A record the server would not accept. Everything else is still sent. */
export interface RefusedRecord {
  collection: string;
  id: string;
  /** What a person calls it, such as "Pole-03". */
  label: string;
  /** What the server said. */
  reason: string;
}

export interface SyncState {
  phase: SyncPhase;
  /** Server revision the local network was last reconciled with. */
  revision: number | null;
  pendingCount: number;
  lastSyncedAt: number | null;
  error: string | null;
  refused: RefusedRecord[];
  /** The last write to this browser's storage failed, so "Saved" must not show. */
  cacheWriteFailed: boolean;
  /** Records (`collection/id`) someone else changed at the same time, waiting for a person's choice. */
  held: string[];
}

export const initialSyncState: SyncState = {
  phase: 'connecting',
  revision: null,
  pendingCount: 0,
  lastSyncedAt: null,
  error: null,
  refused: [],
  cacheWriteFailed: false,
  held: [],
};

/** Read-only view of the sync engine for the UI; only the engine and storage reports write to it. */
export const useSyncStore = create<SyncState>()(() => initialSyncState);

const failingKeys = new Set<string>();

/** Turns a failed cache write into a message once per episode, and clears it when writes succeed again. */
onStorageWrite((key, ok, kind) => {
  if (ok) failingKeys.delete(key);
  else failingKeys.add(key);
  const failed = failingKeys.size > 0;
  const was = useSyncStore.getState().cacheWriteFailed;
  if (failed === was) return;
  useSyncStore.setState({ cacheWriteFailed: failed });
  if (failed) {
    // Phase 19: "full" only when the browser said so; any other failure is named as what it is.
    showToast(
      'error',
      kind === undefined || kind === 'full' ? 'Phone storage is full' : 'Not saved on this device',
      kind === undefined || kind === 'full'
        ? 'Recent changes are not saved on this device. Stay connected until they reach the office, and do not close the app.'
        : 'This browser did not save recent changes on this device. Stay connected until they reach the office, and do not close the app.',
    );
  } else {
    showToast('success', 'Saved on this device again', 'Phone storage is working again.');
  }
});
