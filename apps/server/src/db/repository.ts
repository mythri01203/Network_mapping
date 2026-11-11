import type {
  AreaResponse,
  AuditActor,
  ChangesResponse,
  ChangeResult,
  ChangeSet,
  CollectionName,
  CollectionRecord,
  NetworkResponse,
  NetworkSnapshot,
  RecordsResponse,
  WriteSource,
} from '@fibergis/shared';

/**
 * Phase 24: targeted reads inside a write guard, so a check can read the few records a change can
 * affect instead of whole collections. Both answer from the same transaction as `CollectionReader`.
 */
export interface RecordFinder {
  /** The stored records of one collection with these ids, in stored order (missing ids are skipped). */
  byIds<C extends CollectionName>(collection: C, ids: Iterable<string>): CollectionRecord<C>[];
  /**
   * Every stored record of these collections whose stored JSON contains one of these strings as a
   * whole JSON string (a value or a key, at any depth), in stored order. This is a superset of the
   * records that name one of them in any field, whatever the field is called.
   */
  mentioning(collections: readonly CollectionName[], values: Iterable<string>): { collection: CollectionName; record: Record<string, unknown> }[];
}

/**
 * Reads one stored collection. Handed to a write guard so it sees the state the write will change.
 * Since Phase 24 the repository also attaches `find` (targeted reads); a guard must work without it.
 */
export type CollectionReader = (<C extends CollectionName>(collection: C) => CollectionRecord<C>[]) & { find?: RecordFinder };

/** One stored record and the account that first stored it (`null`: not recorded, such as setup mode or older rows). */
export type RecordLookup = (collection: CollectionName, id: string) => { record: Record<string, unknown>; createdBy: string | null } | undefined;

export interface WriteOptions {
  /** Runs first, inside the transaction, before the version check. Throwing refuses the whole write. */
  access?: (lookup: RecordLookup) => void;
  /** The account making the write. New records remember it (`created_by`), so "own" can be checked later. */
  actorId?: string;
  /** Phase 23: who the server's audit events and revisions name. Absent: the server itself. */
  actor?: AuditActor;
  /** Phase 23: how the write reached the server. Absent: `server`. */
  source?: WriteSource;
  /** Phase 23: the change request this write applies. */
  changeRequestId?: string;
}

/** Phase 24: a page of `GET /<collection>`. Every filter is optional; together they all apply. */
export interface PageQuery {
  /** Most records in the page. */
  limit: number;
  /** The `next` of the page before (the stored position of its last record). */
  after?: number;
  /** Only these ids. */
  ids?: readonly string[];
  /** Only records touching this box (`[south, west, north, east]`). */
  bbox?: readonly [number, number, number, number];
  /** Only records stored after this network revision (their version is larger). */
  changedSince?: number;
}

export interface RecordPage<C extends CollectionName> {
  revision: number;
  records: CollectionRecord<C>[];
  /** Pass as `cursor` for the next page; absent on the last page. */
  next?: number;
}

/** Phase 24: most records in one map-area answer, and the default. */
export const AREA_MAX_LIMIT = 100_000;
export const AREA_DEFAULT_LIMIT = 20_000;
/** Phase 24: most records in one page of `GET /<collection>`. */
export const PAGE_MAX_LIMIT = 10_000;

export interface AreaOptions {
  /** Only these collections. Default: every collection with a map position. */
  collections?: readonly CollectionName[];
  /** Most records in the answer, over all collections. */
  limit?: number;
}

/** Phase 23: who replaced whole collections (restore, reset), for the server's audit events. */
export interface ReplaceOptions {
  actor?: AuditActor;
  source?: WriteSource;
}

/**
 * Runs inside the write transaction, before anything is written. Throwing refuses the whole write.
 * Used for checks that need other records, such as a span pointing to two existing poles.
 */
export type WriteGuard = (read: CollectionReader) => void;

/**
 * Persistence boundary for the network. Routes depend only on this interface, so the SQLite
 * implementation can be swapped for Postgres (or anything else) without touching the HTTP layer.
 *
 * Every write bumps a single, monotonically increasing `revision` that clients use to detect change.
 * Records keep their insertion order within a collection; updating a record does not move it.
 */
export interface NetworkRepository {
  getNetwork(): Promise<NetworkResponse>;
  getRevision(): Promise<number>;
  counts(): Promise<Record<CollectionName, number>>;
  list<C extends CollectionName>(collection: C): Promise<CollectionRecord<C>[]>;
  get<C extends CollectionName>(collection: C, id: string): Promise<CollectionRecord<C> | undefined>;
  /** The stored version of one record (Phase 8), or undefined when it does not exist. */
  getVersion(collection: CollectionName, id: string): Promise<number | undefined>;
  /** Applies upserts then deletes atomically. Records must already be validated. */
  applyChanges(changes: ChangeSet, guard?: WriteGuard, options?: WriteOptions): Promise<ChangeResult>;
  /** Replaces the full contents of each given collection atomically; others are left untouched. */
  replaceCollections(collections: Partial<NetworkSnapshot>, guard?: WriteGuard, options?: ReplaceOptions): Promise<number>;
  /** Phase 24: one page of a collection, in stored order, optionally filtered. */
  listPage<C extends CollectionName>(collection: C, query: PageQuery): Promise<RecordPage<C>>;
  /** Phase 24: records whose point, line or area touches the box, from the spatial index. */
  getArea(box: readonly [number, number, number, number], options?: AreaOptions): Promise<AreaResponse>;
  /** Phase 24: what was stored or deleted after a revision, or `reload` when the history does not reach back. */
  getChangesSince(since: number): Promise<ChangesResponse>;
  /** Phase 24b: every collection except these, in full, with versions (one transaction). */
  getNetworkExcept?(except: readonly CollectionName[]): Promise<RecordsResponse>;
  /** Phase 24b: the stored records with these ids in these collections, with versions. */
  getRecordsByIds?(ids: readonly string[], collections: readonly CollectionName[]): Promise<RecordsResponse>;
  close(): Promise<void>;
}
