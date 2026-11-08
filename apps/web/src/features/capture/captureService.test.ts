import { describe, expect, it } from 'vitest';

import {
  applyPatch,
  buildCapturedEquipment,
  type CommandResult,
  type Customer,
  isCaptureId,
  type NetworkData,
  rxFieldsOf,
} from '@fibergis/shared';

import type { PendingIds } from '../../api/changeTracking';
import { StorageError } from '../../lib/idb';
import { type CaptureStatus, createCaptureService, initialCaptureStatus, retryDelayMs, stepsFor, type UploadOutcome } from './captureService';
import { createMemoryCaptureStorage, type OutboxEntry } from './captureStorage';
import { fitWithin } from './photo';

const emptyData = (): NetworkData => ({
  equipment: [],
  cables: [],
  splitters: [],
  closures: [],
  customers: [],
  faults: [],
  workOrders: [],
  zones: [],
  documents: [],
});

function setup(options: { connected?: boolean } = {}) {
  let clock = 1_000_000;
  let data = emptyData();
  let pending: PendingIds = {};
  let connected = options.connected ?? true;
  const uploads: string[] = [];
  let nextUpload: UploadOutcome = { kind: 'stored' };
  const state: { current: CaptureStatus } = { current: { ...initialCaptureStatus } };
  const storage = createMemoryCaptureStorage();
  const conflicts: { collection: string; recordId: string; detectedAt: string }[] = [];
  const service = createCaptureService({
    getConflicts: () => conflicts,
    storage,
    uploadPhoto: async (photo) => {
      uploads.push(photo.id);
      return nextUpload;
    },
    runCommand: <T,>(command: (d: NetworkData) => CommandResult<T>) => {
      const result = command(data);
      if (!result.ok) return null;
      const before = data;
      data = applyPatch(data, result.patch);
      // Like the sync engine: anything changed waits until the server acknowledges it.
      for (const key of ['equipment', 'faults', 'customers', 'workOrders'] as const) {
        if (before[key] !== data[key]) {
          const ids = new Set([...before[key], ...data[key]].map((r) => r.id));
          pending[key] = [...new Set([...(pending[key] ?? []), ...ids])].filter((id) => {
            const a = before[key].find((r) => r.id === id);
            const b = data[key].find((r) => r.id === id);
            return a !== b;
          });
        }
      }
      return { value: result.value };
    },
    getNetwork: () => data,
    sync: {
      unsentIds: () => pending,
      isConnected: () => connected,
      refusedKeys: () => [],
      flush: () => {},
    },
    now: () => clock,
    status: { setState: (partial) => (state.current = { ...state.current, ...partial }) },
  });
  return {
    service,
    storage,
    uploads,
    status: () => state.current,
    data: () => data,
    setData: (next: NetworkData) => (data = next),
    serverAcknowledges: () => (pending = {}),
    setConnected: (value: boolean) => (connected = value),
    setUpload: (outcome: UploadOutcome) => (nextUpload = outcome),
    tick: (ms: number) => (clock += ms),
    addConflict: (recordId: string, at: number) => conflicts.push({ collection: 'workOrders', recordId, detectedAt: new Date(at).toISOString() }),
    now: () => clock,
  };
}

async function capturePole(t: ReturnType<typeof setup>) {
  const draft = await t.service.startDraft('pole');
  const photoId = await t.service.addPhoto(draft, new Blob(['jpeg'], { type: 'image/jpeg' }));
  const record = buildCapturedEquipment({
    kind: 'pole',
    id: draft.id,
    name: 'Pole-01',
    photoId,
    location: { lat: 12.93, lng: 77.62, method: 'gps_averaged', accuracyMeters: 4, sampleCount: 5, officeMustPlace: false },
    now: new Date(0),
    capturedBy: 'Field Technician',
    ownerType: 'telecom',
    material: 'concrete',
  });
  const entry: OutboxEntry = {
    id: draft.id,
    kind: 'pole',
    collection: 'equipment',
    recordId: draft.id,
    label: 'Pole-01',
    record,
    photoIds: [photoId],
    status: 'saved',
    savedAt: 0,
  };
  return { draft, photoId, entry };
}

describe('capture service', () => {
  it('saves the draft with its permanent ID before anything else', async () => {
    const t = setup();
    const draft = await t.service.startDraft('box');
    expect(isCaptureId(draft.id)).toBe(true);
    expect(draft.step).toBe('camera');
    expect(await t.storage.getDraft()).toEqual(draft);
  });

  it('saves once to the phone, then to the network; a second Save adds nothing', async () => {
    const t = setup();
    const { entry } = await capturePole(t);
    await t.service.save(entry);
    expect(await t.storage.getDraft()).toBeUndefined();
    expect(t.data().equipment).toHaveLength(1);
    await t.service.save(entry);
    expect(t.data().equipment).toHaveLength(1);
    expect(await t.storage.listOutbox()).toHaveLength(1);
  });

  it('reports "not saved" and changes nothing when phone storage fails', async () => {
    const t = setup();
    const { entry } = await capturePole(t);
    t.storage.failNext(Object.assign(new Error('full'), { name: 'QuotaExceededError' }));
    await expect(t.service.save(entry)).rejects.toBeInstanceOf(StorageError);
    expect(t.status().storageError).toBe('full');
    expect(t.data().equipment).toHaveLength(0);
    expect(await t.storage.getDraft()).toBeDefined();
    // The next good write clears the warning.
    await t.service.save(entry);
    expect(t.status().storageError).toBeNull();
  });

  it('says "sent" only when the server has the record and the photo', async () => {
    const t = setup();
    const { entry, photoId } = await capturePole(t);
    t.setUpload({ kind: 'retry' });
    await t.service.save(entry);
    await t.service.processUploads(); // the upload Save started in the background
    expect(t.status().waitingCount).toBe(1);

    t.serverAcknowledges();
    await t.service.refresh();
    expect(t.status().waitingCount).toBe(1); // photo still on the phone

    t.setUpload({ kind: 'stored' });
    t.tick(retryDelayMs(1));
    await t.service.processUploads();
    expect(t.uploads).toEqual([photoId, photoId]);
    expect(t.status().waitingCount).toBe(0);
    expect((await t.storage.listOutbox())[0].status).toBe('sent');
  });

  it('stays "saved on phone" while offline', async () => {
    const t = setup({ connected: false });
    const { entry } = await capturePole(t);
    await t.service.save(entry);
    t.serverAcknowledges();
    await t.service.refresh();
    expect(t.status().waitingCount).toBe(1);
  });

  it('retries uploads with growing waits and stops retrying a refused photo', async () => {
    const t = setup();
    const { entry } = await capturePole(t);
    t.setUpload({ kind: 'retry' });
    await t.service.save(entry);
    const tries = t.uploads.length;
    await t.service.processUploads();
    expect(t.uploads.length).toBe(tries); // not due yet
    t.setUpload({ kind: 'refused', reason: 'too big' });
    await t.service.processUploads(true);
    expect(t.status().refusedCount).toBe(1);
    await t.service.processUploads(true);
    expect(t.uploads.length).toBe(tries + 1);
    expect([1, 2, 3, 10].map(retryDelayMs)).toEqual([5_000, 10_000, 20_000, 300_000]);
  });

  it('undo removes that one item and its unsent photo', async () => {
    const t = setup();
    const { entry, photoId } = await capturePole(t);
    t.setUpload({ kind: 'retry' });
    await t.service.save(entry);
    expect(await t.service.undo(entry.id)).toBe(true);
    expect(t.data().equipment).toHaveLength(0);
    expect(await t.storage.getPhoto(photoId)).toBeUndefined();
    expect(t.status().waitingCount).toBe(0);
    expect(await t.service.undo(entry.id)).toBe(false);
  });

  it('puts an unsent capture back if the network copy was lost', async () => {
    const t = setup();
    const { entry } = await capturePole(t);
    await t.service.save(entry);
    t.setData(emptyData());
    await t.service.refresh();
    expect(t.data().equipment.map((e) => e.id)).toEqual([entry.recordId]);
  });

  it('records a light reading and undo restores the earlier one', async () => {
    const t = setup();
    const customer = { id: 'C1', name: 'Ravi', rxOpticalPowerDbm: -20, rxSource: 'calculated' } as Customer;
    t.setData({ ...emptyData(), customers: [customer] });
    const draft = await t.service.startDraft('light');
    expect(draft.step).toBe('customer');
    const photoId = await t.service.addPhoto(draft, new Blob(['x'], { type: 'image/jpeg' }));
    const entry: OutboxEntry = {
      id: draft.id,
      kind: 'light',
      collection: 'customers',
      recordId: 'C1',
      label: 'Ravi',
      reading: { customerId: 'C1', captureId: draft.id, valueDbm: -18.52, measuredAt: '2026-11-07T10:00:00Z', photoId },
      previousRx: rxFieldsOf(customer),
      photoIds: [photoId],
      status: 'saved',
      savedAt: 0,
    };
    await t.service.save(entry);
    expect(t.data().customers[0]).toMatchObject({ rxOpticalPowerDbm: -18.52, rxSource: 'field_measured' });
    await t.service.save(entry);
    expect(t.data().customers[0].rxCaptureId).toBe(draft.id);
    await t.service.undo(entry.id);
    expect(t.data().customers[0]).toMatchObject({ rxOpticalPowerDbm: -20, rxSource: 'calculated' });
  });
});

describe('technician job events (Phase 8)', () => {
  const job = (): NetworkData['workOrders'][number] => ({
    id: 'WO-TEST1',
    title: 'Check box',
    type: 'Repair',
    priority: 'High',
    status: 'In Progress',
    technicianName: 'Ravi',
    technicianPhone: '',
    scheduledDate: '2026-11-07',
    notes: '',
    photos: [],
    fieldEvents: [],
    photoRefs: [],
  });

  async function photoEvent(t: ReturnType<typeof setup>, id = 'EVT-1') {
    const photoId = await t.service.addEventPhoto(id, new Blob(['jpeg'], { type: 'image/jpeg' }));
    const entry: OutboxEntry = {
      id,
      kind: 'job',
      collection: 'workOrders',
      recordId: 'WO-TEST1',
      label: 'Check box: Photo before',
      jobEvent: { id, kind: 'photo', at: new Date(0).toISOString(), by: 'Ravi', photoId, photoKind: 'before' },
      photoIds: [photoId],
      status: 'saved',
      savedAt: t.now(),
    };
    return { entry, photoId };
  }

  it('saves on the phone first, applies once, uploads the photo, and a second save adds nothing', async () => {
    const t = setup();
    t.setData({ ...emptyData(), workOrders: [job()] });
    const { entry, photoId } = await photoEvent(t);
    await t.service.save(entry);
    await t.service.save(entry);
    expect((await t.storage.listOutbox()).map((e) => e.id)).toEqual(['EVT-1']);
    expect(t.data().workOrders[0].photoRefs).toEqual([expect.objectContaining({ photoId, kind: 'before', eventId: 'EVT-1' })]);
    expect(t.data().workOrders[0].fieldEvents).toHaveLength(1);
    expect(t.uploads).toEqual([photoId]);
    expect(t.status().waitingCount).toBe(1);
    t.serverAcknowledges();
    await t.service.refresh();
    expect(t.status().waitingCount).toBe(0);
  });

  it('puts a lost event back, but not one a conflict holds or one for a closed job', async () => {
    const t = setup();
    t.setData({ ...emptyData(), workOrders: [job()] });
    const { entry } = await photoEvent(t);
    await t.service.save(entry);
    t.setData({ ...emptyData(), workOrders: [job()] });
    await t.service.refresh();
    expect(t.data().workOrders[0].photoRefs).toHaveLength(1);
    // Someone else changed the job meanwhile: the conflict record holds this phone's version.
    t.setData({ ...emptyData(), workOrders: [job()] });
    t.addConflict('WO-TEST1', t.now() + 1);
    await t.service.refresh();
    expect(t.data().workOrders[0].photoRefs).toHaveLength(0);
  });

  it('undo takes the event back and keeps a note of it in the job', async () => {
    const t = setup();
    t.setData({ ...emptyData(), workOrders: [job()] });
    const { entry } = await photoEvent(t);
    await t.service.save(entry);
    await t.service.undo('EVT-1');
    const order = t.data().workOrders[0];
    expect(order.photoRefs).toEqual([]);
    expect(order.fieldEvents?.[0].undoneAt).toBeDefined();
    expect((await t.storage.listOutbox())[0].status).toBe('undone');
  });

  it('saving a job event keeps an unfinished pole capture', async () => {
    const t = setup();
    t.setData({ ...emptyData(), workOrders: [job()] });
    const draft = await t.service.startDraft('pole');
    const { entry } = await photoEvent(t);
    await t.service.save(entry);
    expect((await t.service.getDraft())?.id).toBe(draft.id);
  });
});

describe('capture helpers', () => {
  it('orders steps camera first, light reading customer first', () => {
    expect(stepsFor('pole')[0]).toBe('camera');
    expect(stepsFor('danger')).toEqual(['camera', 'gps', 'summary']);
    expect(stepsFor('light')).toEqual(['customer', 'camera', 'pad']);
  });

  it('shrinks photos to 1280 px on the longest side, never enlarging', () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 1280, height: 960 });
    expect(fitWithin(1080, 1920)).toEqual({ width: 720, height: 1280 });
    expect(fitWithin(640, 480)).toEqual({ width: 640, height: 480 });
    expect(fitWithin(0, 480)).toEqual({ width: 0, height: 0 });
  });
});
