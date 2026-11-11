import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type ChangeSet, COLLECTION_NAMES, type HealthResponse, type NetworkSnapshot } from '@fibergis/shared';
import { createSampleNetwork } from '@fibergis/shared/sample';

import type * as NetworkStore from '../stores/networkStore';
import { getNetworkSnapshot, useNetworkStore } from '../stores/networkStore';
import { type ApiClient, ApiError, ApiUnavailableError } from './client';
import { createSyncEngine, type SyncEngine } from './syncEngine';

vi.mock('../stores/networkStore', async (importOriginal) => ({
  ...(await importOriginal<typeof NetworkStore>()),
  wasLoadedFromCache: vi.fn(() => false),
}));

/** Phase 16: `sendAtomic`, the all-or-nothing write bulk edit uses. */

const pristine = useNetworkStore.getState();
let engine: SyncEngine;
let revision = 1;
let refusal: Error | null = null;

const versions = () => {
  const out: Record<string, Record<string, number>> = {};
  const data = createSampleNetwork() as unknown as Record<string, { id: string }[]>;
  for (const name of COLLECTION_NAMES) for (const r of data[name]) (out[name] ??= {})[r.id] = 1;
  return out;
};

const applyChanges = vi.fn<ApiClient['applyChanges']>(async (changes: ChangeSet) => {
  if (refusal) throw refusal;
  revision += 1;
  const upserted = Object.values(changes.upserts ?? {}).reduce((n, list) => n + (list as unknown[]).length, 0);
  const written: Record<string, Record<string, number>> = {};
  for (const [name, list] of Object.entries(changes.upserts ?? {})) for (const r of list as { id: string }[]) (written[name] ??= {})[r.id] = revision;
  return { revision, upserted, deleted: 0, versions: written };
});

const client: ApiClient = {
  health: vi.fn(async () => ({ status: 'ok', version: 't', uptimeSeconds: 1, revision }) as HealthResponse),
  getNetwork: vi.fn(async () => ({ revision, data: createSampleNetwork() as NetworkSnapshot, versions: versions() })),
  getChanges: vi.fn(async (since: number) => ({ revision, since, upserts: {}, deletes: {}, versions: {} })),
  applyChanges,
  reset: vi.fn(),
  restore: vi.fn(),
  route: vi.fn(),
};

beforeEach(async () => {
  vi.useFakeTimers();
  localStorage.clear();
  useNetworkStore.setState(pristine, true);
  revision = 1;
  refusal = null;
  applyChanges.mockClear();
  engine = createSyncEngine({ client, debounceMs: 50, maxWaitMs: 200, pollIntervalMs: 60_000 });
  engine.start();
  await vi.advanceTimersByTimeAsync(0);
  await engine.flush();
});

afterEach(() => {
  engine.stop();
  vi.useRealTimers();
});

describe('sendAtomic', () => {
  it('sends with the loaded versions and puts the records here only after the server stored them', async () => {
    const cable = getNetworkSnapshot().cables[0];
    await engine.sendAtomic({ upserts: { cables: [{ ...cable, remarks: 'bulk' }] } });
    expect(applyChanges).toHaveBeenCalledTimes(1);
    expect(applyChanges.mock.calls[0][0].expect).toEqual({ cables: { [cable.id]: 1 } });
    expect(getNetworkSnapshot().cables[0].remarks).toBe('bulk');
    // Not queued again as this device's own unsent edit.
    expect(engine.unsentIds()).toEqual({});
    await vi.advanceTimersByTimeAsync(500);
    expect(applyChanges).toHaveBeenCalledTimes(1);
  });

  it('changes nothing here when the server refuses the set', async () => {
    const cable = getNetworkSnapshot().cables[0];
    refusal = new ApiError(400, 'validation_error', 'The request data is invalid.');
    await expect(engine.sendAtomic({ upserts: { cables: [{ ...cable, remarks: 'bulk' }] } })).rejects.toBeInstanceOf(ApiError);
    expect(getNetworkSnapshot().cables[0].remarks).toBe(cable.remarks);
    expect(engine.unsentIds()).toEqual({});
  });

  it('refuses at once with no connection, sending nothing', async () => {
    engine.stop();
    await expect(engine.sendAtomic({ upserts: {} })).rejects.toBeInstanceOf(ApiUnavailableError);
    expect(applyChanges).not.toHaveBeenCalled();
  });
});
