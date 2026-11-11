import { create } from 'zustand';

import {
  addCapturedEquipment,
  addCapturedFault,
  applyJobEvent,
  type CaptureKind,
  type CommandResult,
  type NetworkData,
  newCaptureId,
  recordFieldRxReading,
  removeCapturedRecord,
  type SyncConflict,
  undoFieldRxReading,
  undoJobEvent,
} from '@fibergis/shared';

import type { PendingIds } from '../../api/changeTracking';
import { type StorageErrorKind, toStorageError } from '../../lib/idb';
import type { CaptureDraft, CaptureStorage, OutboxEntry, PhotoEntry } from './captureStorage';

/** What the sync chip shows. Counts come from the phone's own storage, never from guesses. */
export interface CaptureStatus {
  ready: boolean;
  /** Set when the last write to phone storage failed: "Not saved on phone". */
  storageError: StorageErrorKind | null;
  /** Captures not yet fully at the office (record acknowledged and every photo uploaded). */
  waitingCount: number;
  uploading: boolean;
  /** Captures the office refused (record or photo). They stay on the phone. */
  refusedCount: number;
}

export const initialCaptureStatus: CaptureStatus = {
  ready: false,
  storageError: null,
  waitingCount: 0,
  uploading: false,
  refusedCount: 0,
};

export const useCaptureStatus = create<CaptureStatus>()(() => initialCaptureStatus);

export type UploadOutcome = { kind: 'stored' } | { kind: 'retry' } | { kind: 'refused'; reason: string };

export interface CaptureServiceDeps {
  storage: CaptureStorage;
  uploadPhoto: (photo: PhotoEntry) => Promise<UploadOutcome>;
  /** Applies a domain command to the network the rest of the app sees; null when it failed. */
  runCommand: <T>(command: (data: NetworkData) => CommandResult<T>) => { value: T } | null;
  getNetwork: () => NetworkData;
  /** Records someone else changed at the same time (Phase 8); a job event they hold is not re-applied. */
  getConflicts?: () => readonly Pick<SyncConflict, 'collection' | 'recordId' | 'detectedAt'>[];
  sync: {
    unsentIds: () => PendingIds;
    isConnected: () => boolean;
    refusedKeys: () => { collection: string; id: string }[];
    flush: () => void;
  };
  now?: () => number;
  status?: { setState: (partial: Partial<CaptureStatus>) => void };
  /** Phase 19: a line in this device's sync history for each photo the office took or refused. */
  history?: (line: { result: 'sent' | 'refused'; kind: 'photo'; count: number; labels: string[]; reason?: string }) => void;
}

/** Wait before the next upload try: 5 s, 10 s, 20 s ... up to 5 minutes. */
export const retryDelayMs = (attempts: number): number => Math.min(300_000, 5_000 * 2 ** Math.max(0, attempts - 1));

const SENT_KEEP_MS = 14 * 24 * 3600_000;
const UPLOADED_PHOTO_KEEP_MS = 7 * 24 * 3600_000;

export function stepsFor(kind: CaptureKind): CaptureDraft['step'][] {
  switch (kind) {
    case 'pole':
      return ['camera', 'gps', 'same', 'tag', 'owner', 'material', 'summary'];
    case 'box':
      return ['camera', 'gps', 'same', 'tag', 'boxKind', 'summary'];
    case 'drop':
      return ['camera', 'gps', 'same', 'customer', 'summary'];
    case 'light':
      return ['customer', 'camera', 'pad'];
    case 'danger':
      return ['camera', 'gps', 'summary'];
  }
}

export interface CaptureService {
  init(): Promise<void>;
  /** Makes the record ID and saves the draft before anything else happens. */
  startDraft(kind: CaptureKind, after?: { previousAssetId?: string; previousName?: string; runId?: string; order?: number }): Promise<CaptureDraft>;
  getDraft(): Promise<CaptureDraft | undefined>;
  saveDraft(draft: CaptureDraft): Promise<void>;
  /** Drops the draft and its photo. Nothing reaches the office. */
  discardDraft(draft: CaptureDraft): Promise<void>;
  /** Stores a photo for the draft, replacing an earlier one. Returns the photo ID. */
  addPhoto(draft: CaptureDraft, blob: Blob): Promise<string>;
  /** Stores a photo for a job event (Phase 8). It uploads once the event is saved with this id. */
  addEventPhoto(eventId: string, blob: Blob): Promise<string>;
  /** Drops a photo that was never saved with an event (the technician went back). */
  dropPhoto(photoId: string): Promise<void>;
  getPhoto(id: string): Promise<PhotoEntry | undefined>;
  /**
   * Saves a finished capture: first to phone storage (the only thing "Saved on phone" may claim),
   * then into the network the office syncs. Saving the same capture again changes nothing.
   */
  save(entry: OutboxEntry): Promise<void>;
  /** Takes one saved capture back out. After it was sent, the office sees it removed in its history. */
  undo(entryId: string): Promise<boolean>;
  /** Re-checks what has reached the office, and puts back any unsent capture the network lost. */
  refresh(): Promise<void>;
  processUploads(force?: boolean): Promise<void>;
  listOutbox(): Promise<OutboxEntry[]>;
}

export function createCaptureService(deps: CaptureServiceDeps): CaptureService {
  const now = deps.now ?? Date.now;
  const status = deps.status ?? useCaptureStatus;
  let uploading: Promise<void> | null = null;

  const failed = (error: unknown): never => {
    const storageError = toStorageError(error);
    status.setState({ storageError: storageError.kind });
    throw storageError;
  };
  const ok = () => status.setState({ storageError: null });
  const guard = async <T>(work: () => Promise<T>): Promise<T> => {
    try {
      const result = await work();
      ok();
      return result;
    } catch (error) {
      return failed(error);
    }
  };

  const isUnsent = (entry: OutboxEntry) => deps.sync.unsentIds()[entry.collection]?.includes(entry.recordId) ?? false;

  const isInNetwork = (entry: OutboxEntry, data: NetworkData) => {
    if (entry.collection === 'customers') {
      return data.customers.some((c) => c.id === entry.recordId && c.rxCaptureId === entry.id);
    }
    if (entry.collection === 'workOrders') {
      const order = data.workOrders.find((w) => w.id === entry.recordId);
      // A job the office removed, or one someone else changed at the same time, is not put back:
      // the conflict record keeps this phone's version for the person or the office to choose.
      if (!order || order.status === 'Closed' || order.status === 'Cancelled') return true;
      if ((deps.getConflicts?.() ?? []).some((c) => c.collection === 'workOrders' && c.recordId === entry.recordId && Date.parse(c.detectedAt) >= entry.savedAt)) return true;
      return (order.fieldEvents ?? []).some((e) => e.id === entry.id);
    }
    return (data[entry.collection] as { id: string }[]).some((r) => r.id === entry.recordId);
  };

  const apply = (entry: OutboxEntry): boolean => {
    if (entry.collection === 'workOrders' && entry.jobEvent) {
      const event = entry.jobEvent;
      return deps.runCommand((data) => applyJobEvent(data, entry.recordId, event)) !== null;
    }
    if (entry.collection === 'equipment' && entry.record) {
      return deps.runCommand((data) => addCapturedEquipment(data, entry.record as never)) !== null;
    }
    if (entry.collection === 'faults' && entry.record) {
      return deps.runCommand((data) => addCapturedFault(data, entry.record as never)) !== null;
    }
    if (entry.collection === 'customers' && entry.reading) {
      return deps.runCommand((data) => recordFieldRxReading(data, entry.reading!)) !== null;
    }
    return false;
  };

  async function refresh(): Promise<void> {
    let outbox: OutboxEntry[];
    let photos: PhotoEntry[];
    try {
      [outbox, photos] = await Promise.all([deps.storage.listOutbox(), deps.storage.listPhotos()]);
    } catch (error) {
      status.setState({ storageError: toStorageError(error).kind, ready: true });
      return;
    }
    const photoById = new Map(photos.map((p) => [p.id, p]));
    const refusedRecords = new Set(deps.sync.refusedKeys().map((k) => `${k.collection}/${k.id}`));
    const data = deps.getNetwork();
    let waiting = 0;
    let refused = 0;
    for (const entry of outbox) {
      if (entry.status !== 'saved') continue;
      // The network copy can be lost (browser storage full, a reload before it was cached): put it back.
      if (!isInNetwork(entry, data)) apply(entry);
      const photosDone = entry.photoIds.every((id) => {
        const photo = photoById.get(id);
        return !photo || photo.uploadedAt !== undefined;
      });
      const photoRefused = entry.photoIds.some((id) => photoById.get(id)?.refused);
      const recordRefused = refusedRecords.has(`${entry.collection}/${entry.recordId}`);
      if (photoRefused || recordRefused) refused += 1;
      if (photosDone && deps.sync.isConnected() && !isUnsent(entry) && !recordRefused) {
        try {
          await deps.storage.putOutbox({ ...entry, status: 'sent', sentAt: now() });
        } catch {
          waiting += 1;
        }
        continue;
      }
      waiting += 1;
    }
    status.setState({ waitingCount: waiting, refusedCount: refused, ready: true });
  }

  async function uploadOnce(force: boolean): Promise<void> {
    let photos: PhotoEntry[];
    try {
      photos = await deps.storage.listPhotos();
    } catch {
      return;
    }
    const outbox = await deps.storage.listOutbox().catch(() => [] as OutboxEntry[]);
    const committed = new Map(outbox.map((e) => [e.id, e.status]));
    const labelOf = new Map(outbox.map((e) => [e.id, e.label]));
    const due = photos
      .filter((p) => p.uploadedAt === undefined && !p.refused && committed.get(p.captureId) === 'saved')
      .filter((p) => force || p.nextAttemptAt <= now())
      .sort((a, b) => a.createdAt - b.createdAt);
    if (due.length === 0) return;
    status.setState({ uploading: true });
    try {
      for (const photo of due) {
        const outcome = await deps.uploadPhoto(photo);
        const attempts = photo.attempts + 1;
        // The capture's name, such as "Pole-08"; screens say "photo" in the person's language.
        const labels = [labelOf.get(photo.captureId) ?? photo.captureId];
        if (outcome.kind === 'stored') {
          await deps.storage.putPhoto({ ...photo, attempts, uploadedAt: now() });
          deps.history?.({ result: 'sent', kind: 'photo', count: 1, labels });
        } else if (outcome.kind === 'refused') {
          await deps.storage.putPhoto({ ...photo, attempts, refused: outcome.reason });
          deps.history?.({ result: 'refused', kind: 'photo', count: 1, labels, reason: outcome.reason });
        } else {
          await deps.storage.putPhoto({ ...photo, attempts, nextAttemptAt: now() + retryDelayMs(attempts) });
          // The server is not reachable: the rest would fail the same way.
          break;
        }
      }
    } catch {
      // Storage trouble is reported by the next save; the queue simply tries again later.
    } finally {
      status.setState({ uploading: false });
    }
    await refresh();
  }

  async function prune(): Promise<void> {
    const t = now();
    const [outbox, photos] = await Promise.all([deps.storage.listOutbox(), deps.storage.listPhotos()]);
    const live = new Set(outbox.filter((e) => e.status === 'saved').map((e) => e.id));
    for (const entry of outbox) {
      const done = entry.status === 'sent' ? entry.sentAt : entry.status === 'undone' ? entry.undoneAt : undefined;
      if (done !== undefined && t - done > SENT_KEEP_MS) await deps.storage.deleteOutbox(entry.id);
    }
    for (const photo of photos) {
      if (live.has(photo.captureId)) continue;
      if (photo.uploadedAt !== undefined && t - photo.uploadedAt > UPLOADED_PHOTO_KEEP_MS) await deps.storage.deletePhoto(photo.id);
    }
  }

  const service: CaptureService = {
    async init() {
      await refresh();
      await prune().catch(() => undefined);
      void service.processUploads();
    },

    startDraft: (kind, after = {}) =>
      guard(async () => {
        const draft: CaptureDraft = {
          id: newCaptureId(kind),
          kind,
          step: stepsFor(kind)[0],
          startedAt: new Date(now()).toISOString(),
          answers: {},
          runId: after.runId ?? newCaptureId('run'),
          order: after.order ?? 0,
          ...(after.previousAssetId ? { previousAssetId: after.previousAssetId, previousName: after.previousName } : {}),
        };
        await deps.storage.putDraft(draft);
        return draft;
      }),

    getDraft: () => deps.storage.getDraft(),

    saveDraft: (draft) => guard(() => deps.storage.putDraft(draft)),

    discardDraft: (draft) =>
      guard(async () => {
        if (draft.photoId) await deps.storage.deletePhoto(draft.photoId);
        await deps.storage.deleteDraft();
      }),

    addPhoto: (draft, blob) =>
      guard(async () => {
        const id = newCaptureId('photo');
        await deps.storage.putPhoto({
          id,
          captureId: draft.id,
          blob,
          type: blob.type || 'image/jpeg',
          bytes: blob.size,
          createdAt: now(),
          attempts: 0,
          nextAttemptAt: 0,
        });
        if (draft.photoId && draft.photoId !== id) await deps.storage.deletePhoto(draft.photoId).catch(() => undefined);
        return id;
      }),

    addEventPhoto: (eventId, blob) =>
      guard(async () => {
        const id = newCaptureId('photo');
        await deps.storage.putPhoto({ id, captureId: eventId, blob, type: blob.type || 'image/jpeg', bytes: blob.size, createdAt: now(), attempts: 0, nextAttemptAt: 0 });
        return id;
      }),

    dropPhoto: (photoId) => deps.storage.deletePhoto(photoId).catch(() => undefined),

    getPhoto: (id) => deps.storage.getPhoto(id),

    async save(entry) {
      const existing = (await deps.storage.listOutbox().catch(() => [] as OutboxEntry[])).find((e) => e.id === entry.id);
      // A job event has no capture draft: saving it must not drop an unfinished pole or box capture.
      if (!existing) await guard(() => (entry.kind === 'job' ? deps.storage.putOutbox(entry) : deps.storage.commitCapture(entry)));
      else if (entry.kind !== 'job') await deps.storage.deleteDraft().catch(() => undefined);
      // A second tap on Save finds the stored entry and adds nothing new.
      const stored = existing ?? entry;
      if (stored.status === 'saved' && !isInNetwork(stored, deps.getNetwork())) apply(stored);
      deps.sync.flush();
      void service.processUploads(true);
      await refresh();
    },

    async undo(entryId) {
      const entry = (await deps.storage.listOutbox()).find((e) => e.id === entryId);
      if (!entry || entry.status === 'undone') return false;
      // Marked first, so a status check running meanwhile never puts the record back.
      await guard(() => deps.storage.putOutbox({ ...entry, status: 'undone', undoneAt: now() }));
      if (entry.collection === 'customers') {
        if (entry.reading) {
          deps.runCommand((data) => undoFieldRxReading(data, entry.recordId, entry.id, entry.previousRx ?? {}));
        }
      } else if (entry.collection === 'workOrders') {
        deps.runCommand((data) => undoJobEvent(data, entry.recordId, entry.id));
      } else {
        const collection = entry.collection;
        deps.runCommand((data) => removeCapturedRecord(data, collection, entry.recordId));
      }
      for (const id of entry.photoIds) {
        const photo = await deps.storage.getPhoto(id).catch(() => undefined);
        // A photo not yet sent never needs to leave the phone now.
        if (photo && photo.uploadedAt === undefined) await deps.storage.deletePhoto(id).catch(() => undefined);
      }
      deps.sync.flush();
      await refresh();
      return true;
    },

    refresh,

    processUploads(force = false) {
      uploading ??= uploadOnce(force).finally(() => {
        uploading = null;
      });
      return uploading;
    },

    listOutbox: () => deps.storage.listOutbox(),
  };
  return service;
}
