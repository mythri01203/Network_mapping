import type {
  ChangeResult,
  ChangeSet,
  CollectionName,
  CollectionRecord,
  NetworkResponse,
  NetworkSnapshot,
} from '@fibergis/shared';

/** Reads one stored collection. Handed to a write guard so it sees the state the write will change. */
export type CollectionReader = <C extends CollectionName>(collection: C) => CollectionRecord<C>[];

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
  /** Applies upserts then deletes atomically. Records must already be validated. */
  applyChanges(changes: ChangeSet, guard?: WriteGuard): Promise<ChangeResult>;
  /** Replaces the full contents of each given collection atomically; others are left untouched. */
  replaceCollections(collections: Partial<NetworkSnapshot>, guard?: WriteGuard): Promise<number>;
  close(): Promise<void>;
}
