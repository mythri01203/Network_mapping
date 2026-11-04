import {
  COLLECTION_NAMES,
  type ChangeSet,
  type CollectionName,
  type HealthResponse,
  type NetworkSnapshot,
  changeSetSchema,
} from '@fibergis/shared';
import { createSampleNetwork } from '@fibergis/shared/sample';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { storageKey } from '../lib/storage';
import { SYNC_META_STORAGE_KEY, getNetworkSnapshot, useNetworkStore, wasLoadedFromCache } from '../stores/networkStore';
import { useSyncStore } from '../stores/syncStore';
import type * as NetworkStore from '../stores/networkStore';
import { useToastStore } from '../stores/toastStore';
import { ApiError, type ApiClient, ApiUnavailableError } from './client';
import { type SyncEngine, createSyncEngine } from './syncEngine';

vi.mock('../stores/networkStore', async (importOriginal) => ({
  ...(await importOriginal<typeof NetworkStore>()),
  wasLoadedFromCache: vi.fn(() => false),
}));

const DEBOUNCE = 100;
const MAX_WAIT = 1_000;
const POLL = 5_000;
const RETRY = 1_000;

type Records = Record<CollectionName, { id: string }[]>;

/** In-memory stand-in for the API server with the same revision rules. */
function createFakeServer() {
  let revision = 1;
  let data = createSampleNetwork() as unknown as Records;
  let outage: Error | null = null;
  let refusal: ApiError | null = null;

  const available = async () => {
    if (outage) throw outage;
  };
  const snapshot = () => structuredClone(data) as unknown as NetworkSnapshot;

  const applyChanges = vi.fn<ApiClient['applyChanges']>(async (changes: ChangeSet) => {
    await available();
    if (refusal) throw refusal;
    expect(changeSetSchema.safeParse(changes).success).toBe(true);
    let upserted = 0;
    let deleted = 0;
    for (const [name, records] of Object.entries(changes.upserts ?? {}) as [CollectionName, { id: string }[]][]) {
      for (const record of records) {
        const index = data[name].findIndex((item) => item.id === record.id);
        if (index >= 0) data[name][index] = structuredClone(record);
        else data[name].push(structuredClone(record));
        upserted += 1;
      }
    }
    for (const [name, ids] of Object.entries(changes.deletes ?? {}) as [CollectionName, string[]][]) {
      const before = data[name].length;
      data[name] = data[name].filter((item) => !ids.includes(item.id));
      deleted += before - data[name].length;
    }
    if (upserted + deleted > 0) revision += 1;
    return { revision, upserted, deleted };
  });

  const client: ApiClient = {
    health: vi.fn(async () => {
      await available();
      const counts = Object.fromEntries(COLLECTION_NAMES.map((name) => [name, data[name].length]));
      return { status: 'ok', version: 'test', uptimeSeconds: 1, revision, counts } as HealthResponse;
    }),
    getNetwork: vi.fn(async () => {
      await available();
      return { revision, data: snapshot() };
    }),
    applyChanges,
    reset: vi.fn(async () => {
      await available();
      data = { ...(createSampleNetwork() as unknown as Records), catalog: data.catalog };
      revision += 1;
      return { revision };
    }),
    restore: vi.fn(async (backup) => {
      await available();
      const restored = Object.keys(backup.collections) as CollectionName[];
      for (const name of restored) data[name] = structuredClone(backup.collections[name] as { id: string }[]);
      revision += 1;
      return { revision, restored };
    }),
    route: vi.fn(),
  };

  return {
    client,
    applyChanges,
    get revision() {
      return revision;
    },
    records: (name: CollectionName) => data[name],
    goDown: () => {
      outage = new ApiUnavailableError('The FiberGIS server could not be reached.');
    },
    comeBack: () => {
      outage = null;
    },
    refuse: (error: ApiError | null) => {
      refusal = error;
    },
    /** Another client edits the network. */
    editElsewhere: (name: CollectionName, record: { id: string }) => {
      const index = data[name].findIndex((item) => item.id === record.id);
      if (index >= 0) data[name][index] = record;
      else data[name].push(record);
      revision += 1;
    },
  };
}

const pristine = useNetworkStore.getState();
let server: ReturnType<typeof createFakeServer>;
let engine: SyncEngine;

const startEngine = async () => {
  engine = createSyncEngine({
    client: server.client,
    debounceMs: DEBOUNCE,
    maxWaitMs: MAX_WAIT,
    pollIntervalMs: POLL,
    retryBaseMs: RETRY,
    retryMaxMs: RETRY * 4,
  });
  engine.start();
  await idle();
};

/** Waits for queued server round-trips (flush runs after everything already queued). */
const idle = async () => {
  await vi.advanceTimersByTimeAsync(0);
  await engine.flush();
};

const renameFirstEquipment = (name: string) => {
  const [first, ...rest] = useNetworkStore.getState().equipment;
  useNetworkStore.setState({ equipment: [{ ...first, name }, ...rest] });
  return first.id;
};

const serverEquipment = (id: string) => server.records('equipment').find((item) => item.id === id) as { name?: string };
const phase = () => useSyncStore.getState().phase;
const storedMeta = () => JSON.parse(localStorage.getItem(storageKey(SYNC_META_STORAGE_KEY)) ?? 'null');

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  useNetworkStore.setState(pristine, true);
  useToastStore.setState({ toasts: [] });
  vi.mocked(wasLoadedFromCache).mockReturnValue(false);
  server = createFakeServer();
});

afterEach(() => {
  engine?.stop();
  vi.useRealTimers();
});

describe('connecting', () => {
  it('loads the server network and records its revision', async () => {
    const [first] = server.records('equipment');
    server.editElsewhere('equipment', { ...first, name: 'Renamed on server' } as { id: string });
    await startEngine();

    expect(useNetworkStore.getState().equipment[0].name).toBe('Renamed on server');
    expect(useSyncStore.getState()).toMatchObject({ phase: 'synced', revision: server.revision, pendingCount: 0 });
    expect(storedMeta()).toEqual({ revision: server.revision, pending: {} });
    expect(server.applyChanges).not.toHaveBeenCalled();
  });

  it('keeps unchanged collections untouched', async () => {
    const before = useNetworkStore.getState();
    await startEngine();
    const after = useNetworkStore.getState();
    expect(after.equipment).toBe(before.equipment);
    expect(after.history).toBe(before.history);
  });

  it('uploads edits a browser made before it had a server', async () => {
    const id = renameFirstEquipment('Edited offline long ago');
    vi.mocked(wasLoadedFromCache).mockReturnValue(true);
    await startEngine();

    expect(serverEquipment(id).name).toBe('Edited offline long ago');
    expect(phase()).toBe('synced');
  });
});

describe('saving local edits', () => {
  it('sends an edit after a quiet period', async () => {
    await startEngine();
    const id = renameFirstEquipment('Local rename');
    expect(useSyncStore.getState()).toMatchObject({ phase: 'pending', pendingCount: 1 });

    await vi.advanceTimersByTimeAsync(DEBOUNCE - 1);
    expect(server.applyChanges).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await idle();

    expect(server.applyChanges).toHaveBeenCalledTimes(1);
    expect(serverEquipment(id).name).toBe('Local rename');
    expect(useSyncStore.getState()).toMatchObject({ phase: 'synced', pendingCount: 0, revision: server.revision });
  });

  it('sends deletions', async () => {
    await startEngine();
    const [removed, ...rest] = useNetworkStore.getState().equipment;
    useNetworkStore.setState({ equipment: rest });
    await idle();
    expect(serverEquipment(removed.id)).toBeUndefined();
  });

  it('does not let continuous editing postpone saving forever', async () => {
    await startEngine();
    for (let elapsed = 0; elapsed < MAX_WAIT; elapsed += DEBOUNCE / 2) {
      renameFirstEquipment(`Typing ${elapsed}`);
      await vi.advanceTimersByTimeAsync(DEBOUNCE / 2);
    }
    await idle();
    expect(server.applyChanges).toHaveBeenCalledTimes(1);
  });

  it('picks up changes another client made while saving', async () => {
    await startEngine();
    const other = server.records('cables')[0];
    server.editElsewhere('cables', { ...other, name: 'Changed by a colleague' } as { id: string });
    renameFirstEquipment('Mine');
    await idle();

    expect(useNetworkStore.getState().equipment[0].name).toBe('Mine');
    expect(useNetworkStore.getState().cables[0].name).toBe('Changed by a colleague');
    expect(useSyncStore.getState().revision).toBe(server.revision);
  });

  it('polls for changes made elsewhere while idle', async () => {
    await startEngine();
    const other = server.records('cables')[0];
    server.editElsewhere('cables', { ...other, name: 'Polled' } as { id: string });
    await vi.advanceTimersByTimeAsync(POLL);
    await idle();
    expect(useNetworkStore.getState().cables[0].name).toBe('Polled');
  });
});

describe('when the server is unavailable', () => {
  it('keeps working offline and pushes edits once it is back', async () => {
    server.goDown();
    await startEngine();
    expect(phase()).toBe('offline');

    const id = renameFirstEquipment('Offline edit');
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(server.applyChanges).not.toHaveBeenCalled();
    expect(useSyncStore.getState()).toMatchObject({ phase: 'offline', pendingCount: 1 });
    expect(storedMeta().pending).toEqual({ equipment: [id] });

    server.comeBack();
    await vi.advanceTimersByTimeAsync(RETRY);
    await idle();
    expect(serverEquipment(id).name).toBe('Offline edit');
    expect(phase()).toBe('synced');
  });

  it('goes offline when a save fails and retries with backoff', async () => {
    await startEngine();
    server.goDown();
    const id = renameFirstEquipment('Unsent');
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    await idle();
    expect(phase()).toBe('offline');
    expect(useSyncStore.getState().error).toMatch(/could not be reached/);

    await vi.advanceTimersByTimeAsync(RETRY);
    expect(phase()).toBe('offline');
    server.comeBack();
    await vi.advanceTimersByTimeAsync(RETRY * 2);
    await idle();
    expect(serverEquipment(id).name).toBe('Unsent');
    expect(phase()).toBe('synced');
  });

  it('remembers unsent edits across reloads', async () => {
    server.goDown();
    await startEngine();
    const id = renameFirstEquipment('Before reload');
    engine.stop();

    server.comeBack();
    await startEngine();
    expect(serverEquipment(id).name).toBe('Before reload');
  });
});

describe('when the server refuses changes', () => {
  beforeEach(() => {
    server.refuse(new ApiError(400, 'validation_failed', 'Invalid change set.'));
  });

  it('keeps the edits, reports the error once and waits for the user', async () => {
    await startEngine();
    renameFirstEquipment('Refused');
    await idle();
    expect(useToastStore.getState().toasts.map((toast) => toast.title)).toEqual(['Server Rejected Changes']);

    await vi.advanceTimersByTimeAsync(POLL * 3);
    expect(useSyncStore.getState()).toMatchObject({ phase: 'error', pendingCount: 1, error: 'Invalid change set.' });
    expect(server.applyChanges).toHaveBeenCalledTimes(1);

    server.refuse(null);
    await engine.retry();
    expect(phase()).toBe('synced');
  });

  it('can discard the refused edits', async () => {
    await startEngine();
    const original = useNetworkStore.getState().equipment[0].name;
    renameFirstEquipment('Refused');
    await idle();

    await engine.discardLocalChanges();
    expect(useNetworkStore.getState().equipment[0].name).toBe(original);
    expect(useSyncStore.getState()).toMatchObject({ phase: 'synced', pendingCount: 0 });
  });
});

describe('reset and restore', () => {
  it('resets on the server while online', async () => {
    await startEngine();
    renameFirstEquipment('Soon gone');
    await expect(engine.reset()).resolves.toBe('server');

    expect(server.client.reset).toHaveBeenCalled();
    expect(getNetworkSnapshot().equipment).toEqual(createSampleNetwork().equipment);
    expect(phase()).toBe('synced');
  });

  it('resets locally while offline and uploads the result later', async () => {
    await startEngine();
    renameFirstEquipment('Saved first');
    await idle();
    server.goDown();

    await expect(engine.reset()).resolves.toBe('local');
    expect(getNetworkSnapshot().equipment).toEqual(createSampleNetwork().equipment);

    server.comeBack();
    await vi.advanceTimersByTimeAsync(RETRY);
    await idle();
    expect(server.records('equipment')).toEqual(createSampleNetwork().equipment);
  });

  it('restores on the server and applies the start point locally', async () => {
    await startEngine();
    await expect(engine.restore({ collections: { zones: [] }, projectStartPoint: [1, 2] })).resolves.toBe('server');

    expect(server.records('zones')).toEqual([]);
    expect(useNetworkStore.getState().zones).toEqual([]);
    expect(useNetworkStore.getState().projectStartPoint).toEqual([1, 2]);
  });

  it('reports a refused restore as failed', async () => {
    await startEngine();
    vi.mocked(server.client.restore).mockRejectedValueOnce(new ApiError(400, 'invalid_backup', 'Bad backup.'));
    await expect(engine.restore({ collections: { zones: [] } })).resolves.toBe('failed');
    expect(useNetworkStore.getState().zones).toEqual(createSampleNetwork().zones);
  });
});
