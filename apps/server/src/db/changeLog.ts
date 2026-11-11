import type { DatabaseSync, StatementSync } from 'node:sqlite';

import { type ChangesResponse, type CollectionName, isCollectionName, type NetworkSnapshot, type RecordVersions } from '@fibergis/shared';

/**
 * Phase 24 (migration 3): which records changed at which network revision, so a device that is up to
 * date at revision N can fetch only what changed since (`GET /changes?since=N`) instead of the whole
 * network. One row per record: the revision of the last write that stored or deleted it (`deleted`
 * = 1: a tombstone). Written in the same transaction as every write.
 *
 * The Phase 23 history tables cannot answer this on their own: audit events skip the browser's own
 * audit entries and summarise monitoring rows, revisions are pruned per record, and neither notes a
 * resend that left a record's data as it was though its version moved on.
 *
 * `meta.change_log_floor` is the oldest revision the log can answer from. A restore or reset raises it
 * to its own revision (every device then reloads the whole network once), and so does removing the
 * oldest tombstones beyond the limit.
 */
export const CHANGE_LOG_SCHEMA = `
  CREATE TABLE IF NOT EXISTS change_log (
    collection TEXT NOT NULL,
    id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (collection, id)
  ) WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS change_log_by_revision ON change_log (revision);
  CREATE INDEX IF NOT EXISTS change_log_tombstones ON change_log (revision) WHERE deleted = 1;
`;

/** The floor starts at the revision the database had when the log began: nothing older is known. */
export const CHANGE_LOG_FLOOR_SQL = `INSERT OR IGNORE INTO meta (key, value) SELECT 'change_log_floor', value FROM meta WHERE key = 'revision';`;

/** Most tombstones kept; beyond this the oldest go and the floor moves up. */
export const MAX_TOMBSTONES = 200_000;
/** How often the tombstones are counted, at most. */
const PRUNE_EVERY_MS = 60 * 60 * 1000;

type Row = Record<string, unknown>;

export class ChangeLog {
  private readonly q: Record<string, StatementSync>;
  private lastPrune = 0;

  constructor(
    db: DatabaseSync,
    private readonly maxTombstones = MAX_TOMBSTONES,
  ) {
    this.q = {
      mark: db.prepare('INSERT OR REPLACE INTO change_log (collection, id, revision, deleted) VALUES (?, ?, ?, ?)'),
      floor: db.prepare("SELECT CAST(value AS INTEGER) AS floor FROM meta WHERE key = 'change_log_floor'"),
      setFloor: db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('change_log_floor', ?)"),
      dropUpTo: db.prepare('DELETE FROM change_log WHERE revision <= ?'),
      tombstones: db.prepare('SELECT COUNT(*) AS n FROM change_log WHERE deleted = 1'),
      cutoff: db.prepare('SELECT revision FROM change_log WHERE deleted = 1 ORDER BY revision DESC LIMIT 1 OFFSET ?'),
      dropTombstones: db.prepare('DELETE FROM change_log WHERE deleted = 1 AND revision <= ?'),
      since: db.prepare(
        `SELECT c.collection AS collection, c.id AS id, c.deleted AS deleted, r.data AS data, r.version AS version
           FROM change_log c
           LEFT JOIN records r ON r.collection = c.collection AND r.id = c.id
          WHERE c.revision > ?
          ORDER BY c.collection, r.position`,
      ),
    };
  }

  mark(collection: CollectionName, id: string, revision: number, deleted: boolean) {
    this.q.mark.run(collection, id, revision, deleted ? 1 : 0);
  }

  floor(): number {
    const row = this.q.floor.get() as Row | undefined;
    return row ? Number(row.floor) : 0;
  }

  /** Nothing before `revision` can be answered any more (a restore or reset replaced whole lists). */
  raiseFloor(revision: number) {
    if (revision <= this.floor()) return;
    this.q.setFloor.run(String(revision));
    this.q.dropUpTo.run(revision);
  }

  /** Keeps the tombstones within the limit. Runs at most once an hour unless forced. */
  prune(now = Date.now(), force = false) {
    if (!force && now - this.lastPrune < PRUNE_EVERY_MS) return;
    this.lastPrune = now;
    const count = Number((this.q.tombstones.get() as Row).n);
    if (count <= this.maxTombstones) return;
    const cut = this.q.cutoff.get(this.maxTombstones) as Row | undefined;
    if (!cut) return;
    const revision = Number(cut.revision);
    this.q.dropTombstones.run(revision);
    if (revision > this.floor()) this.q.setFloor.run(String(revision));
  }

  /** What changed after `since`, read inside the caller's transaction. */
  changesSince(since: number, revision: number): ChangesResponse {
    const floor = this.floor();
    if (since > revision) return { revision, since, reload: true, reason: 'This device knows a newer revision than the server has (the server was restored from an older copy).' };
    if (since < floor) return { revision, since, reload: true, reason: 'The change history does not reach back that far (a restore, a reset, or a long time away).' };
    const upserts: Partial<Record<CollectionName, unknown[]>> = {};
    const deletes: Partial<Record<CollectionName, string[]>> = {};
    const versions: RecordVersions = {};
    for (const row of this.q.since.iterate(since) as Iterable<Row>) {
      const collection = String(row.collection);
      if (!isCollectionName(collection)) continue;
      const id = String(row.id);
      if (Number(row.deleted) === 1 || row.data == null) {
        (deletes[collection] ??= []).push(id);
        continue;
      }
      (upserts[collection] ??= []).push(JSON.parse(String(row.data)));
      (versions[collection] ??= {})[id] = Number(row.version);
    }
    return { revision, since, upserts: upserts as Partial<NetworkSnapshot>, deletes, versions };
  }
}
