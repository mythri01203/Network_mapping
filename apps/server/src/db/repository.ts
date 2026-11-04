import type {
  ChangeResult,
  ChangeSet,
  CollectionName,
  CollectionRecord,
  NetworkResponse,
  NetworkSnapshot,
} from '@fibergis/shared';

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
  applyChanges(changes: ChangeSet): Promise<ChangeResult>;
  /** Replaces the full contents of each given collection atomically; others are left untouched. */
  replaceCollections(collections: Partial<NetworkSnapshot>): Promise<number>;
  close(): Promise<void>;
}
