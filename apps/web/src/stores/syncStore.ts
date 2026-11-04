import { create } from 'zustand';

/**
 * - `connecting`: loading the network from the server.
 * - `synced`: the server has every local change.
 * - `pending` / `saving`: local changes are waiting for / being sent to the server.
 * - `offline`: the server is unreachable; changes are kept in this browser and retried.
 * - `error`: the server refused a change; it stays local until retried or discarded.
 */
export type SyncPhase = 'connecting' | 'synced' | 'pending' | 'saving' | 'offline' | 'error';

export interface SyncState {
  phase: SyncPhase;
  /** Server revision the local network was last reconciled with. */
  revision: number | null;
  pendingCount: number;
  lastSyncedAt: number | null;
  error: string | null;
}

export const initialSyncState: SyncState = {
  phase: 'connecting',
  revision: null,
  pendingCount: 0,
  lastSyncedAt: null,
  error: null,
};

/** Read-only view of the sync engine for the UI; only the engine writes to it. */
export const useSyncStore = create<SyncState>()(() => initialSyncState);
