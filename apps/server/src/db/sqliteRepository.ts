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
  type RecordVersions,
  type VersionConflict,
} from '@fibergis/shared';

import { SqliteAuthStore } from '../auth/authStore';
import { versionConflict } from '../lib/errors';
import { MonitoringTokenStore } from '../monitoring/tokenStore';
import type { NetworkRepository, RecordLookup, WriteGuard, WriteOptions } from './repository';

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

/**
 * Phase 8: each record keeps the revision of the write that last stored it, so a client can say
 * which version it edited. Existing rows start at 0. The column is added without changing
 * `user_version`, so an older server can still open the database: it never names the column, and
 * its writes leave the version as it was (such a write is then not seen as a change by a version
 * check). A pre-release build numbered this as migration 2; such a database is set back to 1.
 */
const VERSION_COLUMN = 'ALTER TABLE records ADD COLUMN version INTEGER NOT NULL DEFAULT 0';

/**
 * Phase 9: the account that first stored each record, so a technician's "undo my own capture" can
 * be told apart from deleting somebody else's. Empty for older rows and in setup mode. Added the same
 * way as `version`: no schema number change, and an older server's writes simply leave it as it is.
 */
const CREATED_BY_COLUMN = 'ALTER TABLE records ADD COLUMN created_by TEXT';

type Row = Record<string, unknown>;

const prepareStatements = (db: DatabaseSync) => ({
  list: db.prepare('SELECT data FROM records WHERE collection = ? ORDER BY position'),
  get: db.prepare('SELECT data FROM records WHERE collection = ? AND id = ?'),
  counts: db.prepare('SELECT collection, COUNT(*) AS total FROM records GROUP BY collection'),
  upsert: db.prepare(
    `INSERT INTO records (collection, id, position, data, updated_at, version, created_by)
       VALUES (?, ?, (SELECT COALESCE(MAX(position) + 1, 0) FROM records WHERE collection = ?), ?, ?, ?, ?)
       ON CONFLICT (collection, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, version = excluded.version`,
  ),
  version: db.prepare('SELECT version, data FROM records WHERE collection = ? AND id = ?'),
  lookup: db.prepare('SELECT data, created_by FROM records WHERE collection = ? AND id = ?'),
  versions: db.prepare('SELECT collection, id, version FROM records'),
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
  /** Accounts and sessions (Phase 9), in the same database file. */
  readonly auth: SqliteAuthStore;
  /** Push tokens for monitoring sources (Phase 7), hashed, in the same database file. */
  readonly monitoringTokens: MonitoringTokenStore;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;');
    this.migrate();

    this.statements = prepareStatements(this.db);
    this.auth = new SqliteAuthStore(this.db);
    this.monitoringTokens = new MonitoringTokenStore(this.db);
  }

  async getNetwork() {
    return this.transaction('DEFERRED', () => {
      const data = Object.fromEntries(COLLECTION_NAMES.map((name) => [name, this.readCollection(name)]));
      const versions: RecordVersions = {};
      for (const row of this.statements.versions.all() as Row[]) {
        const name = row.collection as CollectionName;
        if (!isCollectionName(name)) continue;
        (versions[name] ??= {})[String(row.id)] = Number(row.version);
      }
      return { revision: this.readRevision(), data: data as NetworkSnapshot, versions };
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

  async getVersion(collection: CollectionName, id: string) {
    const row = this.statements.version.get(collection, id) as Row | undefined;
    return row ? Number(row.version) : undefined;
  }

  private readonly lookup: RecordLookup = (collection, id) => {
    const row = this.statements.lookup.get(collection, id) as Row | undefined;
    if (!row) return undefined;
    return { record: JSON.parse(String(row.data)) as Record<string, unknown>, createdBy: row.created_by == null ? null : String(row.created_by) };
  };

  async applyChanges(changes: ChangeSet, guard?: WriteGuard, options: WriteOptions = {}): Promise<ChangeResult> {
    return this.transaction('IMMEDIATE', () => {
      // Who may write comes first, then versions: a stale edit is refused whole, before any other check or write.
      options.access?.(this.lookup);
      const conflicts = this.findConflicts(changes);
      if (conflicts.length > 0) throw versionConflict(conflicts);
      guard?.((collection) => this.readCollection(collection));
      const now = new Date().toISOString();
      const version = this.readRevision() + 1;
      const versions: RecordVersions = {};
      let upserted = 0;
      let deleted = 0;
      for (const [collection, records] of this.entries(changes.upserts)) {
        for (const record of records as { id: string }[]) {
          this.statements.upsert.run(collection, record.id, collection, JSON.stringify(record), now, version, options.actorId ?? null);
          (versions[collection] ??= {})[record.id] = version;
          upserted += 1;
        }
      }
      for (const [collection, ids] of this.entries(changes.deletes)) {
        for (const id of ids as string[]) {
          deleted += Number(this.statements.remove.run(collection, id).changes);
        }
      }
      const revision = upserted + deleted > 0 ? this.bumpRevision() : this.readRevision();
      return { revision, upserted, deleted, versions };
    });
  }

  /**
   * Records whose stored version is not the one the client said it edited. A delete of a record
   * that is already gone is not a conflict: both sides wanted it gone.
   */
  private findConflicts(changes: ChangeSet): VersionConflict[] {
    const conflicts: VersionConflict[] = [];
    const deleting = new Set(this.entries(changes.deletes).flatMap(([collection, ids]) => (ids as string[]).map((id) => `${collection}/${id}`)));
    for (const [collection, expected] of this.entries(changes.expect)) {
      for (const [id, version] of Object.entries(expected as unknown as Record<string, number>)) {
        const row = this.statements.version.get(collection, id) as Row | undefined;
        if (!row) {
          if (deleting.has(`${collection}/${id}`)) continue;
          conflicts.push({ collection, id, expected: version, current: null, record: null });
          continue;
        }
        const current = Number(row.version);
        if (current !== version) {
          conflicts.push({ collection, id, expected: version, current, record: JSON.parse(String(row.data)) as Record<string, unknown> });
        }
      }
    }
    return conflicts;
  }

  async replaceCollections(collections: Partial<NetworkSnapshot>, guard?: WriteGuard) {
    return this.transaction('IMMEDIATE', () => {
      guard?.((collection) => this.readCollection(collection));
      const now = new Date().toISOString();
      const version = this.readRevision() + 1;
      for (const [collection, records] of this.entries(collections)) {
        this.statements.clear.run(collection);
        for (const record of records as { id: string }[]) {
          this.statements.upsert.run(collection, record.id, collection, JSON.stringify(record), now, version, null);
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
    let { user_version: applied } = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
    if (applied === 2 && this.hasVersionColumn()) {
      // Only the pre-release "migration 2" (the version column) ever used this number.
      this.db.exec('PRAGMA user_version = 1');
      applied = 1;
    }
    if (applied > MIGRATIONS.length) {
      throw new Error(`Database schema v${applied} is newer than this server supports (v${MIGRATIONS.length}).`);
    }
    MIGRATIONS.slice(applied).forEach((sql, index) => {
      this.transaction('IMMEDIATE', () => {
        this.db.exec(sql);
        this.db.exec(`PRAGMA user_version = ${applied + index + 1}`);
      });
    });
    if (!this.hasColumn('version')) this.transaction('IMMEDIATE', () => this.db.exec(VERSION_COLUMN));
    if (!this.hasColumn('created_by')) this.transaction('IMMEDIATE', () => this.db.exec(CREATED_BY_COLUMN));
  }

  private hasColumn(name: string): boolean {
    return (this.db.prepare('PRAGMA table_info(records)').all() as Row[]).some((c) => c.name === name);
  }

  private hasVersionColumn(): boolean {
    return (this.db.prepare('PRAGMA table_info(records)').all() as Row[]).some((c) => c.name === 'version');
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
