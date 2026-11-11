import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type ChangeSet, type HealthResponse, type NetworkSnapshot } from '@fibergis/shared';
import { createSampleNetwork } from '@fibergis/shared/sample';

import { createCaptureService, type UploadOutcome } from '../features/capture/captureService';
import { createMemoryCaptureStorage, type PhotoEntry } from '../features/capture/captureStorage';
import { storageKey } from '../lib/storage';
import { useNetworkStore } from '../stores/networkStore';
import { resetSyncHistoryForTests, SYNC_HISTORY_KEY, useSyncHistory } from '../stores/syncHistoryStore';
import { type ApiClient, ApiError } from './client';
import { createSyncEngine, type SyncEngine } from './syncEngine';

/**
 * Phase 19: the per-device sync history. A tiny stand-in server: it takes every change except the
 * records it is told to refuse, or to report as changed by someone else.
 */
function fakeServer() {
  let revision = 1;
  const data = createSampleNetwork() as NetworkSnapshot;
  const refuse = new Set<string>();
  const conflict = new Set<string>();
  const client: ApiClient = {
    health: vi.fn(async () => ({ status: 'ok', version: 'test', uptimeSeconds: 1, revision, counts: {} }) as unknown as HealthResponse),
    getNetwork: vi.fn(async () => ({ revision, data: structuredClone(data) })),
    applyChanges: vi.fn(async (changes: ChangeSet) => {
      const ids = Object.values(changes.upserts ?? {}).flatMap((list) => (list as { id: string }[]).map((r) => r.id));
      const bad = ids.find((id) => refuse.has(id));
      if (bad) throw new ApiError(400, 'validation_error', `Record ${bad} is not valid.`);
      const clash = ids.find((id) => conflict.has(id));
      if (clash) {
        const theirs = { ...data.equipment.find((e) => e.id === clash)!, name: 'Changed at the office' };
        throw new ApiError(409, 'version_conflict', 'Someone else changed it.', [], [{ collection: 'equipment', id: clash, expected: 1, current: 2, record: theirs }] as never);
      }
      revision += 1;
      return { revision, upserted: ids.length, deleted: 0 };
    }),
    restore: vi.fn(),
    reset: vi.fn(),
    route: vi.fn(),
  };
  return { client, refuse, conflict };
}

const pristine = useNetworkStore.getState();
let engine: SyncEngine;

const rename = (index: number, name: string) => {
  const list = [...useNetworkStore.getState().equipment];
  list[index] = { ...list[index], name };
  useNetworkStore.setState({ equipment: list });
  return list[index].id;
};

const settle = async () => {
  await vi.advanceTimersByTimeAsync(200);
  await engine.flush();
};

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  useNetworkStore.setState(pristine, true);
  resetSyncHistoryForTests();
});

afterEach(() => {
  engine?.stop();
  vi.useRealTimers();
});

describe('sync history on this device', () => {
  it('records what was sent, what was refused with the reason, and what someone else changed', async () => {
    const server = fakeServer();
    engine = createSyncEngine({ client: server.client, debounceMs: 50, maxWaitMs: 100, pollIntervalMs: 60_000 });
    engine.start();
    await settle();

    rename(0, 'Renamed here');
    await settle();
    const [sent] = useSyncHistory.getState().entries;
    expect(sent).toMatchObject({ result: 'sent', kind: 'changes', count: 1 });
    expect(sent.labels[0]).toMatch(/Renamed here/);

    const refusedId = useNetworkStore.getState().equipment[1].id;
    server.refuse.add(refusedId);
    rename(1, 'Bad one');
    await settle();
    const refused = useSyncHistory.getState().entries.find((e) => e.result === 'refused');
    expect(refused).toMatchObject({ count: 1 });
    expect(refused?.reason).toMatch(/not valid/);

    const clashId = useNetworkStore.getState().equipment[2].id;
    server.conflict.add(clashId);
    rename(2, 'Mine');
    await settle();
    const held = useSyncHistory.getState().entries.find((e) => e.result === 'conflict');
    expect(held?.labels[0]).toMatch(/Mine/);
    expect(held?.reason).toMatch(/Both versions are kept/);

    // Newest first, and kept with the offline copy on this device.
    const entries = useSyncHistory.getState().entries;
    expect(entries.at(-1)).toEqual(sent);
    expect([...entries].sort((a, b) => b.at - a.at).map((e) => e.id)).toEqual(entries.map((e) => e.id));
    const stored = JSON.parse(localStorage.getItem(storageKey(SYNC_HISTORY_KEY)) ?? '[]') as { id: string }[];
    expect(stored.map((e) => e.id)).toEqual(entries.map((e) => e.id));
  });

  it('records each photo the office took or refused (phone capture)', async () => {
    vi.useRealTimers();
    const storage = createMemoryCaptureStorage();
    const lines: unknown[] = [];
    const outcomes: UploadOutcome[] = [{ kind: 'stored' }, { kind: 'refused', reason: 'Photo too large' }];
    const service = createCaptureService({
      storage,
      uploadPhoto: async (_p: PhotoEntry) => outcomes.shift() ?? { kind: 'retry' },
      runCommand: () => ({ value: undefined as never }),
      getNetwork: () => ({ ...createSampleNetwork(), workOrders: [] }) as never,
      sync: { unsentIds: () => ({}), isConnected: () => true, refusedKeys: () => [], flush: () => undefined },
      status: { setState: () => undefined },
      history: (line) => lines.push(line),
    });
    for (const [id, label] of [['CAP-1', 'Pole-01'], ['CAP-2', 'Box-01']] as const) {
      await storage.putPhoto({ id: `PH-${id}`, captureId: id, blob: new Blob(['x']), type: 'image/jpeg', bytes: 1, createdAt: id === 'CAP-1' ? 1 : 2, attempts: 0, nextAttemptAt: 0 });
      await storage.putOutbox({ id, kind: 'pole', collection: 'equipment', recordId: id, label, photoIds: [`PH-${id}`], status: 'saved', savedAt: 1 });
    }
    await service.processUploads(true);
    expect(lines).toEqual([
      { result: 'sent', kind: 'photo', count: 1, labels: ['Pole-01'] },
      { result: 'refused', kind: 'photo', count: 1, labels: ['Box-01'], reason: 'Photo too large' },
    ]);
  });
});
