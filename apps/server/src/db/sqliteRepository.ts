import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  type ChangeResult,
  type ChangeSet,
  COLLECTION_NAMES,
  type CollectionName,
  type CollectionRecord,
  isCollectionName,
  type NetworkSnapshot,
} from '@fibergis/shared';

import type { NetworkRepository } from './repository';

/** Ordered schema migrations; `PRAGMA user_version` records how many have been applied. */
const MIGRATIONS = [
  `CREATE TABLE records (
     collection TEXT NOT NULL,
     id TEXT NOT NULL,
     position INTEGER NOT NULL,
     data TEXT NOT NULL CHECK (json_valid(data)),
     updated_at TEXT NOT NULL,
     PRIMARY KEY (collection, id)
   ) WITHOUT ROWID;
   CREATE INDEX records_by_position ON records (collection, position);
   CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
   INSERT INTO meta (key, value) VALUES ('revision', '0');`,
];

type Row = Record<string, unknown>;

const prepareStatements = (db: DatabaseSync) => ({
  list: db.prepare('SELECT data FROM records WHERE collection = ? ORDER BY position'),
  get: db.prepare('SELECT data FROM records WHERE collection = ? AND id = ?'),
  counts: db.prepare('SELECT collection, COUNT(*) AS total FROM records GROUP BY collection'),
  upsert: db.prepare(
    `INSERT INTO records (collection, id, position, data, updated_at)
       VALUES (?, ?, (SELECT COALESCE(MAX(position) + 1, 0) FROM records WHERE collection = ?), ?, ?)
       ON CONFLICT (collection, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
  ),
  remove: db.prepare('DELETE FROM records WHERE collection = ? AND id = ?'),
  clear: db.prepare('DELETE FROM records WHERE collection = ?'),
  revision: db.prepare("SELECT CAST(value AS INTEGER) AS revision FROM meta WHERE key = 'revision'"),
  bumpRevision: db.prepare(
    "UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision' RETURNING CAST(value AS INTEGER) AS revision",
  ),
});

/**
 * Stores each record as a JSON document keyed by `(collection, id)`. Records are validated by the
 * HTTP layer before they reach this class, so reads can trust what is stored.
 */
export class SqliteNetworkRepository implements NetworkRepository {
  private readonly db: DatabaseSync;
  private readonly statements: ReturnType<typeof prepareStatements>;
  private closed = false;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;');
    this.migrate();

    this.statements = prepareStatements(this.db);
  }

  async getNetwork() {
    return this.transaction('DEFERRED', () => {
      const data = Object.fromEntries(COLLECTION_NAMES.map((name) => [name, this.readCollection(name)]));
      return { revision: this.readRevision(), data: data as NetworkSnapshot };
    });
  }

  async getRevision() {
    return this.readRevision();
  }

  async counts() {
    const totals = Object.fromEntries(COLLECTION_NAMES.map((name) => [name, 0])) as Record<CollectionName, number>;
    for (const row of this.statements.counts.all() as Row[]) {
      totals[row.collection as CollectionName] = Number(row.total);
    }
    return totals;
  }

  async list<C extends CollectionName>(collection: C) {
    return this.readCollection(collection);
  }

  async get<C extends CollectionName>(collection: C, id: string) {
    const row = this.statements.get.get(collection, id) as Row | undefined;
    return row ? (JSON.parse(String(row.data)) as CollectionRecord<C>) : undefined;
  }

  async applyChanges(changes: ChangeSet): Promise<ChangeResult> {
    return this.transaction('IMMEDIATE', () => {
      const now = new Date().toISOString();
      let upserted = 0;
      let deleted = 0;
      for (const [collection, records] of this.entries(changes.upserts)) {
        for (const record of records as { id: string }[]) {
          this.statements.upsert.run(collection, record.id, collection, JSON.stringify(record), now);
          upserted += 1;
        }
      }
      for (const [collection, ids] of this.entries(changes.deletes)) {
        for (const id of ids as string[]) {
          deleted += Number(this.statements.remove.run(collection, id).changes);
        }
      }
      const revision = upserted + deleted > 0 ? this.bumpRevision() : this.readRevision();
      return { revision, upserted, deleted };
    });
  }

  async replaceCollections(collections: Partial<NetworkSnapshot>) {
    return this.transaction('IMMEDIATE', () => {
      const now = new Date().toISOString();
      for (const [collection, records] of this.entries(collections)) {
        this.statements.clear.run(collection);
        for (const record of records as { id: string }[]) {
          this.statements.upsert.run(collection, record.id, collection, JSON.stringify(record), now);
        }
      }
      return this.bumpRevision();
    });
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }

  private migrate() {
    const { user_version: applied } = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
    if (applied > MIGRATIONS.length) {
      throw new Error(`Database schema v${applied} is newer than this server supports (v${MIGRATIONS.length}).`);
    }
    MIGRATIONS.slice(applied).forEach((sql, index) => {
      this.transaction('IMMEDIATE', () => {
        this.db.exec(sql);
        this.db.exec(`PRAGMA user_version = ${applied + index + 1}`);
      });
    });
  }

  private readCollection<C extends CollectionName>(collection: C) {
    return (this.statements.list.all(collection) as Row[]).map(
      (row) => JSON.parse(String(row.data)) as CollectionRecord<C>,
    );
  }

  private readRevision() {
    return Number((this.statements.revision.get() as Row).revision);
  }

  private bumpRevision() {
    return Number((this.statements.bumpRevision.get() as Row).revision);
  }

  /** Known collections in a partial per-collection map, skipping anything unexpected. */
  private entries(map: object | undefined) {
    return Object.entries(map ?? {}).filter(([name]) => isCollectionName(name)) as [CollectionName, unknown[]][];
  }

  /** Runs synchronously inside one transaction; reads use DEFERRED so they never block writers. */
  private transaction<T>(mode: 'DEFERRED' | 'IMMEDIATE', work: () => T): T {
    this.db.exec(`BEGIN ${mode}`);
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}
