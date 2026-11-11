import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  type AreaResponse,
  type ChangeResult,
  type ChangeSet,
  type ChangesResponse,
  COLLECTION_NAMES,
  type CollectionName,
  type CollectionRecord,
  isCollectionName,
  type NetworkSnapshot,
  type RecordsResponse,
  type RecordVersions,
  sameRecord,
  type VersionConflict,
} from '@fibergis/shared';

import { SqliteAuthStore } from '../auth/authStore';
import { versionConflict } from '../lib/errors';
import { MonitoringTokenStore } from '../monitoring/tokenStore';
import { VoiceClipStore } from '../voice/clipStore';
import { CHANGE_LOG_FLOOR_SQL, CHANGE_LOG_SCHEMA, ChangeLog } from './changeLog';
import { CHANGE_REQUEST_SCHEMA, ChangeRequestStore } from './changeRequestStore';
import { HISTORY_SCHEMA, RecordHistoryStore, SERVER_ACTOR, type WriteRecord } from './historyStore';
import { type Box, shapesOf, shapeTouchesBox } from './recordGeometry';
import {
  AREA_DEFAULT_LIMIT,
  AREA_MAX_LIMIT,
  type AreaOptions,
  type CollectionReader,
  type NetworkRepository,
  type PageQuery,
  type RecordFinder,
  type RecordLookup,
  type RecordPage,
  type ReplaceOptions,
  type WriteGuard,
  type WriteOptions,
} from './repository';
import { SPATIAL_SCHEMA, SpatialIndex } from './spatialIndex';

/** Values per `instr` query when looking for records that name one of them. */
const MENTION_CHUNK = 50;

/**
 * Ordered schema migrations; `PRAGMA user_version` records how many have been applied. Each is
 * additive and safe to run twice (`IF NOT EXISTS`); none changes a table or column already there.
 */
const MIGRATIONS: (string | ((db: DatabaseSync) => void))[] = [
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
  // 2 (Phase 23): the server's audit events, record revisions and change requests. New tables only.
  `${HISTORY_SCHEMA}\n${CHANGE_REQUEST_SCHEMA}`,
  // 3 (Phase 24): the spatial index (rebuilt from the records) and the change log. New tables only.
  (db) => {
    db.exec(`${SPATIAL_SCHEMA}\n${CHANGE_LOG_SCHEMA}\n${CHANGE_LOG_FLOOR_SQL}`);
    new SpatialIndex(db).rebuild();
  },
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
  // `+position`: sorting must not make SQLite walk the whole collection instead of looking the ids up.
  byIds: db.prepare('SELECT data FROM records WHERE collection = ? AND id IN (SELECT value FROM json_each(?)) ORDER BY +position'),
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
  /** Generated voice clips for the learning assistant, in the same database file. */
  readonly voiceClips: VoiceClipStore;
  /** Phase 23: the server's audit events and record revisions, written in the same transaction as each write. */
  readonly history: RecordHistoryStore;
  /** Phase 23: change requests waiting for review, approved, made and checked. */
  readonly changeRequests: ChangeRequestStore;
  /** Phase 24: map positions for area queries, kept in the same transaction as each write. */
  private readonly spatial: SpatialIndex;
  /** Phase 24: which records changed at which revision, for incremental sync. */
  private readonly changeLog: ChangeLog;
  private readonly mentionStatements = new Map<number, ReturnType<DatabaseSync['prepare']>>();

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;');
    this.migrate();

    this.statements = prepareStatements(this.db);
    this.auth = new SqliteAuthStore(this.db);
    this.monitoringTokens = new MonitoringTokenStore(this.db);
    this.voiceClips = new VoiceClipStore(this.db);
    this.history = new RecordHistoryStore(this.db);
    this.changeRequests = new ChangeRequestStore(this.db);
    this.spatial = new SpatialIndex(this.db);
    this.changeLog = new ChangeLog(this.db);
    this.transaction('IMMEDIATE', () => this.changeLog.prune(Date.now(), true));
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

  /** Phase 24b: every collection but these, in full, with their versions, in one read. */
  async getNetworkExcept(except: readonly CollectionName[]): Promise<RecordsResponse> {
    const skip = new Set<string>(except);
    return this.transaction('DEFERRED', () => {
      const data = Object.fromEntries(COLLECTION_NAMES.filter((name) => !skip.has(name)).map((name) => [name, this.readCollection(name)]));
      const versions: RecordVersions = {};
      for (const row of this.statements.versions.all() as Row[]) {
        const name = row.collection as CollectionName;
        if (!isCollectionName(name) || skip.has(name)) continue;
        (versions[name] ??= {})[String(row.id)] = Number(row.version);
      }
      return { revision: this.readRevision(), data: data as Partial<NetworkSnapshot>, versions };
    });
  }

  /** Phase 24b: the stored records with these ids in these collections, with their versions, in one read. */
  async getRecordsByIds(ids: readonly string[], collections: readonly CollectionName[]): Promise<RecordsResponse> {
    return this.transaction('DEFERRED', () => {
      const data: Partial<Record<CollectionName, unknown[]>> = {};
      const versions: RecordVersions = {};
      if (ids.length > 0) {
        // One key lookup per id and collection (`+position` keeps SQLite off the position index).
        const query = this.db.prepare('SELECT id, version, data FROM records WHERE collection = ? AND id IN (SELECT value FROM json_each(?)) ORDER BY +position');
        const list = JSON.stringify(ids);
        for (const name of new Set(collections)) {
          if (!isCollectionName(name)) continue;
          for (const row of query.all(name, list) as Row[]) {
            (data[name] ??= []).push(JSON.parse(String(row.data)));
            (versions[name] ??= {})[String(row.id)] = Number(row.version);
          }
        }
      }
      return { revision: this.readRevision(), data: data as Partial<NetworkSnapshot>, versions };
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

  async listPage<C extends CollectionName>(collection: C, query: PageQuery): Promise<RecordPage<C>> {
    return this.transaction('DEFERRED', () => {
      const where = ['r.collection = ?'];
      const params: (string | number)[] = [collection];
      let from = 'records r';
      if (query.after !== undefined) {
        where.push('r.position > ?');
        params.push(query.after);
      }
      if (query.ids) {
        where.push('r.id IN (SELECT value FROM json_each(?))');
        params.push(JSON.stringify(query.ids));
      }
      if (query.changedSince !== undefined) {
        where.push('r.version > ?');
        params.push(query.changedSince);
      }
      const box = query.bbox as Box | undefined;
      if (box) {
        from = 'records r JOIN record_bounds b ON b.collection = r.collection AND b.id = r.id JOIN record_bounds_rtree t ON t.rid = b.rid';
        where.push('t.max_lat >= ? AND t.min_lat <= ? AND t.max_lng >= ? AND t.min_lng <= ?');
        params.push(box[0], box[2], box[1], box[3]);
      }
      // Without a box every row matches, so SQLite stops one past the page; with one the exact test runs here.
      // With ids or a box, `+r.position` keeps SQLite on the id lookups or the R-tree instead of walking the collection.
      const order = query.ids || box ? '+r.position' : 'r.position';
      const sql = `SELECT r.position AS position, r.data AS data FROM ${from} WHERE ${where.join(' AND ')} ORDER BY ${order}${box ? '' : ` LIMIT ${query.limit + 1}`}`;
      const records: CollectionRecord<C>[] = [];
      let last: number | undefined;
      let more = false;
      for (const row of this.db.prepare(sql).iterate(...params) as Iterable<Row>) {
        const record = JSON.parse(String(row.data)) as Record<string, unknown>;
        if (box && !shapesOf(collection, record, this.spatial.pointOf).some((shape) => shapeTouchesBox(shape, box))) continue;
        if (records.length >= query.limit) {
          more = true;
          break;
        }
        records.push(record as CollectionRecord<C>);
        last = Number(row.position);
      }
      return { revision: this.readRevision(), records, ...(more && last !== undefined ? { next: last } : {}) };
    });
  }

  async getArea(box: readonly [number, number, number, number], options: AreaOptions = {}): Promise<AreaResponse> {
    const limit = Math.min(Math.max(1, Math.floor(options.limit ?? AREA_DEFAULT_LIMIT)), AREA_MAX_LIMIT);
    const only = options.collections ? new Set<string>(options.collections) : undefined;
    return this.transaction('DEFERRED', () => {
      const data: Partial<Record<CollectionName, unknown[]>> = {};
      const versions: RecordVersions = {};
      let count = 0;
      let truncated = false;
      for (const row of this.spatial.candidates(box as Box)) {
        const collection = String(row.collection);
        if (!isCollectionName(collection) || (only && !only.has(collection))) continue;
        const record = JSON.parse(String(row.data)) as Record<string, unknown>;
        if (!shapesOf(collection, record, this.spatial.pointOf).some((shape) => shapeTouchesBox(shape, box as Box))) continue;
        if (count >= limit) {
          truncated = true;
          break;
        }
        count += 1;
        (data[collection] ??= []).push(record);
        (versions[collection] ??= {})[String(row.id)] = Number(row.version);
      }
      return { revision: this.readRevision(), bbox: [box[0], box[1], box[2], box[3]], data: data as Partial<NetworkSnapshot>, versions, truncated, limit };
    });
  }

  async getChangesSince(since: number): Promise<ChangesResponse> {
    return this.transaction('DEFERRED', () => this.changeLog.changesSince(since, this.readRevision()));
  }

  /**
   * The reader a write guard gets. Each collection is read (and parsed) at most once per write and
   * handed out as a fresh array, so guards that each ask for `equipment` share one read. `find`
   * gives targeted reads by id and by the strings a record contains (Phase 24).
   */
  private guardReader(): CollectionReader {
    const cache = new Map<CollectionName, { id: string }[]>();
    const read = (<C extends CollectionName>(collection: C) => {
      let rows = cache.get(collection);
      if (!rows) {
        rows = this.readCollection(collection) as { id: string }[];
        cache.set(collection, rows);
      }
      return rows.slice() as unknown as CollectionRecord<C>[];
    }) as CollectionReader;
    const find: RecordFinder = {
      byIds: <C extends CollectionName>(collection: C, ids: Iterable<string>) => {
        const wanted = new Set(ids);
        if (wanted.size === 0) return [];
        const cached = cache.get(collection);
        if (cached) return cached.filter((record) => wanted.has(record.id)) as unknown as CollectionRecord<C>[];
        return (this.statements.byIds.all(collection, JSON.stringify([...wanted])) as Row[]).map((row) => JSON.parse(String(row.data)) as CollectionRecord<C>);
      },
      mentioning: (collections, values) => {
        const needles = [...new Set(values)].map((value) => JSON.stringify(value));
        const found: { collection: CollectionName; record: Record<string, unknown> }[] = [];
        if (needles.length === 0) return found;
        for (const collection of collections) {
          const seen = new Set<string>();
          const rows: { position: number; record: Record<string, unknown> }[] = [];
          for (let i = 0; i < needles.length; i += MENTION_CHUNK) {
            const chunk = needles.slice(i, i + MENTION_CHUNK);
            for (const row of this.mentionStatement(chunk.length).all(collection, ...chunk) as Row[]) {
              const record = JSON.parse(String(row.data)) as Record<string, unknown>;
              if (seen.has(String(record.id))) continue;
              seen.add(String(record.id));
              rows.push({ position: Number(row.position), record });
            }
          }
          rows.sort((a, b) => a.position - b.position);
          for (const { record } of rows) found.push({ collection, record });
        }
        return found;
      },
    };
    read.find = find;
    return read;
  }

  private mentionStatement(size: number) {
    let statement = this.mentionStatements.get(size);
    if (!statement) {
      const test = Array.from({ length: size }, () => 'instr(data, ?) > 0').join(' OR ');
      statement = this.db.prepare(`SELECT position, data FROM records WHERE collection = ? AND (${test}) ORDER BY position`);
      this.mentionStatements.set(size, statement);
    }
    return statement;
  }

  async applyChanges(changes: ChangeSet, guard?: WriteGuard, options: WriteOptions = {}): Promise<ChangeResult> {
    return this.transaction('IMMEDIATE', () => {
      // Who may write comes first, then versions: a stale edit is refused whole, before any other check or write.
      options.access?.(this.lookup);
      const conflicts = this.findConflicts(changes);
      if (conflicts.length > 0) throw versionConflict(conflicts);
      guard?.(this.guardReader());
      const now = new Date().toISOString();
      const version = this.readRevision() + 1;
      const versions: RecordVersions = {};
      const written: WriteRecord[] = [];
      // Phase 24: what the change log and the spatial index must follow.
      const stored: [CollectionName, Record<string, unknown>][] = [];
      const removedKeys: [CollectionName, string][] = [];
      const movedStructures = new Set<string>();
      let upserted = 0;
      let deleted = 0;
      for (const [collection, records] of this.entries(changes.upserts)) {
        for (const record of records as { id: string }[]) {
          const before = this.storedData(collection, record.id);
          this.statements.upsert.run(collection, record.id, collection, JSON.stringify(record), now, version, options.actorId ?? null);
          (versions[collection] ??= {})[record.id] = version;
          upserted += 1;
          stored.push([collection, record as unknown as Record<string, unknown>]);
          if (collection === 'equipment' && before && (before.lat !== (record as { lat?: unknown }).lat || before.lng !== (record as { lng?: unknown }).lng)) movedStructures.add(record.id);
          // Phase 23: a resend of the same record is not a change and leaves no history.
          if (!before || !sameRecord(before, record)) written.push({ collection, id: record.id, version, before, after: record as unknown as Record<string, unknown> });
        }
      }
      for (const [collection, ids] of this.entries(changes.deletes)) {
        for (const id of ids as string[]) {
          const before = this.storedData(collection, id);
          const removed = Number(this.statements.remove.run(collection, id).changes);
          deleted += removed;
          if (removed > 0) {
            removedKeys.push([collection, id]);
            if (collection === 'equipment') movedStructures.add(id);
          }
          if (removed > 0 && before) written.push({ collection, id, version, before, after: undefined });
        }
      }
      const revision = upserted + deleted > 0 ? this.bumpRevision() : this.readRevision();
      if (upserted + deleted > 0) {
        // After every row is written, so a span finds structures stored in the same change.
        for (const [collection, record] of stored) {
          this.changeLog.mark(collection, String(record.id), revision, false);
          this.spatial.update(collection, String(record.id), record);
        }
        for (const [collection, id] of removedKeys) {
          // A record stored and deleted in the same change ends deleted (deletes run last).
          this.changeLog.mark(collection, id, revision, true);
          this.spatial.update(collection, id, undefined);
        }
        if (movedStructures.size > 0) this.spatial.refreshSpansAt(movedStructures);
        if (deleted > 0) this.changeLog.prune(Date.parse(now));
      }
      if (written.length > 0) {
        this.history.recordWrites(written, {
          at: now,
          actor: options.actor ?? SERVER_ACTOR,
          source: options.source ?? 'server',
          revision,
          ...(options.changeRequestId ? { changeRequestId: options.changeRequestId } : {}),
        });
      }
      return { revision, upserted, deleted, versions };
    });
  }

  /** The stored record, or undefined. */
  private storedData(collection: CollectionName, id: string): Record<string, unknown> | undefined {
    const row = this.statements.get.get(collection, id) as Row | undefined;
    return row ? (JSON.parse(String(row.data)) as Record<string, unknown>) : undefined;
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

  async replaceCollections(collections: Partial<NetworkSnapshot>, guard?: WriteGuard, options: ReplaceOptions = {}) {
    return this.transaction('IMMEDIATE', () => {
      guard?.((collection) => this.readCollection(collection));
      const now = new Date().toISOString();
      const version = this.readRevision() + 1;
      const owners = this.db.prepare('SELECT id, created_by FROM records WHERE collection = ? AND created_by IS NOT NULL');
      const existing = this.db.prepare('SELECT id, data FROM records WHERE collection = ?');
      const written: WriteRecord[] = [];
      const summaries: [CollectionName, string][] = [];
      for (const [collection, records] of this.entries(collections)) {
        // Who made a record survives a restore, so a technician can still undo their own capture.
        const createdBy = new Map((owners.all(collection) as Row[]).map((row) => [String(row.id), String(row.created_by)]));
        // Phase 23: what each record was before, so the history shows what the replace changed.
        const before = new Map((existing.all(collection) as Row[]).map((row) => [String(row.id), JSON.parse(String(row.data)) as Record<string, unknown>]));
        const counts = { added: 0, changed: 0, removed: 0, same: 0 };
        this.statements.clear.run(collection);
        for (const record of records as { id: string }[]) {
          this.statements.upsert.run(collection, record.id, collection, JSON.stringify(record), now, version, createdBy.get(record.id) ?? null);
          const old = before.get(record.id);
          before.delete(record.id);
          if (old && sameRecord(old, record)) {
            counts.same += 1;
            continue;
          }
          counts[old ? 'changed' : 'added'] += 1;
          written.push({ collection, id: record.id, version, before: old, after: record as unknown as Record<string, unknown> });
        }
        for (const [id, old] of before) {
          counts.removed += 1;
          written.push({ collection, id, version, before: old, after: undefined });
        }
        summaries.push([collection, `Whole list replaced: ${counts.added} added, ${counts.changed} changed, ${counts.removed} removed, ${counts.same} unchanged.`]);
      }
      // Phase 24: the replaced lists get new map positions (spans last, so they find their ends).
      const replaced = this.entries(collections).sort(([a], [b]) => Number(a === 'spans') - Number(b === 'spans'));
      for (const [collection, records] of replaced) {
        this.spatial.clearCollection(collection);
        for (const record of records as Record<string, unknown>[]) this.spatial.update(collection, String(record.id), record);
      }
      if ('equipment' in collections && !('spans' in collections)) this.spatial.refreshAllSpans();
      const revision = this.bumpRevision();
      // Every device loads the whole network once after a restore or reset.
      this.changeLog.raiseFloor(revision);
      const context = { at: now, actor: options.actor ?? SERVER_ACTOR, source: options.source ?? 'server', revision } as const;
      for (const [collection, note] of summaries) if (collection !== 'auditLogs') this.history.recordSummary(context, collection, note);
      // One audit line per list (kept for good); a revision per changed record (kept by the retention).
      this.history.recordWrites(written, context, { perRecordEvents: false });
      return revision;
    });
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }

  private migrate() {
    let { user_version: applied } = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
    if (applied === 2 && this.hasVersionColumn() && !this.hasTable('audit_events')) {
      // Before Phase 23 only the pre-release "migration 2" (the version column) used this number.
      // A server older than Phase 23 also sets a Phase 23 database back to 1 here; its tables stay,
      // and migration 2 (all `IF NOT EXISTS`) simply marks it as 2 again on the next start.
      this.db.exec('PRAGMA user_version = 1');
      applied = 1;
    }
    if (applied > MIGRATIONS.length) {
      throw new Error(`Database schema v${applied} is newer than this server supports (v${MIGRATIONS.length}).`);
    }
    const addColumns = () => {
      if (!this.hasColumn('version')) this.transaction('IMMEDIATE', () => this.db.exec(VERSION_COLUMN));
      if (!this.hasColumn('created_by')) this.transaction('IMMEDIATE', () => this.db.exec(CREATED_BY_COLUMN));
    };
    MIGRATIONS.slice(applied).forEach((step, index) => {
      // Later migrations may read the records table with its added columns (Phase 24 rebuilds the spatial index).
      if (applied + index >= 1) addColumns();
      this.transaction('IMMEDIATE', () => {
        if (typeof step === 'string') this.db.exec(step);
        else step(this.db);
        this.db.exec(`PRAGMA user_version = ${applied + index + 1}`);
      });
    });
    addColumns();
  }

  private hasTable(name: string): boolean {
    return this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !== undefined;
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
