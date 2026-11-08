import type {
  BoxKind,
  CaptureKind,
  CaptureLocation,
  Equipment,
  Fault,
  FieldRxReading,
  JobEventInput,
  PoleMaterial,
  PoleOwnerType,
  RxFields,
} from '@fibergis/shared';

import { type DatabaseDef, idbDelete, idbGet, idbGetAll, idbPut, openDatabase, transact } from '../../lib/idb';

export type CaptureStep = 'camera' | 'gps' | 'same' | 'tag' | 'owner' | 'material' | 'boxKind' | 'customer' | 'pad' | 'summary';

/** One capture in progress. Saved after every step, so a reload or a killed tab resumes it. */
export interface CaptureDraft {
  /** The record's permanent ID, made when the tile was tapped. */
  id: string;
  kind: CaptureKind;
  step: CaptureStep;
  startedAt: string;
  photoId?: string;
  location?: CaptureLocation;
  /** The "same one?" question was answered or not needed. */
  sameChecked?: boolean;
  /** Undefined: not asked yet. Null: the worker tapped "No tag". */
  tagCode?: string | null;
  answers: { ownerType?: PoleOwnerType; material?: PoleMaterial; boxKind?: BoxKind };
  /** Undefined: not asked. Null: "Not in the list". */
  customerId?: string | null;
  rxDigits?: string;
  /** The item saved just before in this walk. Order only, never a claim that a cable joins them. */
  previousAssetId?: string;
  previousName?: string;
  runId: string;
  order: number;
}

/** A compressed photo waiting on the phone until the server has it. */
export interface PhotoEntry {
  id: string;
  captureId: string;
  blob: Blob;
  type: string;
  bytes: number;
  createdAt: number;
  uploadedAt?: number;
  attempts: number;
  nextAttemptAt: number;
  /** The server refused it for good, with its reason. */
  refused?: string;
}

export type OutboxStatus = 'saved' | 'sent' | 'undone';

/** A finished capture. Kept until the office has both the record and its photos. */
export interface OutboxEntry {
  id: string;
  /** `job`: one thing a technician did on a work order (Phase 8). Its id is the event's id. */
  kind: CaptureKind | 'job';
  collection: 'equipment' | 'faults' | 'customers' | 'workOrders';
  recordId: string;
  /** What the worker calls it, such as "Pole-08". */
  label: string;
  record?: Equipment | Fault;
  reading?: FieldRxReading;
  previousRx?: RxFields;
  jobEvent?: JobEventInput;
  photoIds: string[];
  status: OutboxStatus;
  savedAt: number;
  sentAt?: number;
  undoneAt?: number;
}

export interface CaptureStorage {
  getDraft(): Promise<CaptureDraft | undefined>;
  putDraft(draft: CaptureDraft): Promise<void>;
  deleteDraft(): Promise<void>;
  putPhoto(photo: PhotoEntry): Promise<void>;
  getPhoto(id: string): Promise<PhotoEntry | undefined>;
  listPhotos(): Promise<PhotoEntry[]>;
  deletePhoto(id: string): Promise<void>;
  listOutbox(): Promise<OutboxEntry[]>;
  putOutbox(entry: OutboxEntry): Promise<void>;
  deleteOutbox(id: string): Promise<void>;
  /** Stores the finished capture and clears the draft in one step: both happen or neither. */
  commitCapture(entry: OutboxEntry): Promise<void>;
}

const DRAFT_SLOT = 'current';

export const CAPTURE_DB: DatabaseDef = {
  name: 'fibergis-field',
  version: 1,
  stores: {
    drafts: { keyPath: 'slot' },
    photos: { keyPath: 'id' },
    outbox: { keyPath: 'id' },
  },
};

/** The phone's real storage. Opening is retried on the next call if it failed once. */
export function createIdbCaptureStorage(factory?: IDBFactory): CaptureStorage {
  let dbPromise: Promise<IDBDatabase> | null = null;
  const db = () => {
    dbPromise ??= openDatabase(CAPTURE_DB, factory).catch((error) => {
      dbPromise = null;
      throw error;
    });
    return dbPromise;
  };
  const read = async <T>(store: string, work: (tx: IDBTransaction) => Promise<T>) =>
    transact(await db(), [store], 'readonly', work);
  const write = async (stores: string[], work: (tx: IDBTransaction) => Promise<unknown>) => {
    await transact(await db(), stores, 'readwrite', work);
  };

  return {
    getDraft: () =>
      read('drafts', async (tx) => (await idbGet<{ slot: string; draft: CaptureDraft }>(tx, 'drafts', DRAFT_SLOT))?.draft),
    putDraft: (draft) => write(['drafts'], (tx) => idbPut(tx, 'drafts', { slot: DRAFT_SLOT, draft })),
    deleteDraft: () => write(['drafts'], (tx) => idbDelete(tx, 'drafts', DRAFT_SLOT)),
    putPhoto: (photo) => write(['photos'], (tx) => idbPut(tx, 'photos', photo)),
    getPhoto: (id) => read('photos', (tx) => idbGet<PhotoEntry>(tx, 'photos', id)),
    listPhotos: () => read('photos', (tx) => idbGetAll<PhotoEntry>(tx, 'photos')),
    deletePhoto: (id) => write(['photos'], (tx) => idbDelete(tx, 'photos', id)),
    listOutbox: () => read('outbox', (tx) => idbGetAll<OutboxEntry>(tx, 'outbox')),
    putOutbox: (entry) => write(['outbox'], (tx) => idbPut(tx, 'outbox', entry)),
    deleteOutbox: (id) => write(['outbox'], (tx) => idbDelete(tx, 'outbox', id)),
    commitCapture: (entry) =>
      write(['outbox', 'drafts'], async (tx) => {
        await idbPut(tx, 'outbox', entry);
        await idbDelete(tx, 'drafts', DRAFT_SLOT);
      }),
  };
}

/** Same behaviour in memory, for tests. `failNext` makes the next write throw like a full phone. */
export function createMemoryCaptureStorage(): CaptureStorage & { failNext: (error: Error) => void } {
  let draft: CaptureDraft | undefined;
  const photos = new Map<string, PhotoEntry>();
  const outbox = new Map<string, OutboxEntry>();
  let failure: Error | null = null;
  const write = async (work: () => void) => {
    if (failure) {
      const error = failure;
      failure = null;
      throw error;
    }
    work();
  };
  const clone = <T>(value: T): T => structuredClone(value);
  return {
    failNext: (error) => {
      failure = error;
    },
    getDraft: async () => (draft ? clone(draft) : undefined),
    putDraft: (d) => write(() => (draft = clone(d))),
    deleteDraft: () => write(() => (draft = undefined)),
    putPhoto: (p) => write(() => photos.set(p.id, { ...p })),
    getPhoto: async (id) => (photos.has(id) ? { ...photos.get(id)! } : undefined),
    listPhotos: async () => [...photos.values()].map((p) => ({ ...p })),
    deletePhoto: (id) => write(() => photos.delete(id)),
    listOutbox: async () => [...outbox.values()].map(clone),
    putOutbox: (e) => write(() => outbox.set(e.id, clone(e))),
    deleteOutbox: (id) => write(() => outbox.delete(id)),
    commitCapture: (e) =>
      write(() => {
        outbox.set(e.id, clone(e));
        draft = undefined;
      }),
  };
}
