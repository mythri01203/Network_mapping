import type { DatabaseSync, StatementSync } from 'node:sqlite';

import {
  type AccountRole,
  type AuditActor,
  type AuditEvent,
  type CollectionName,
  diffRecords,
  type FieldDiff,
  isAccountRole,
  isCollectionName,
  type PermissionAction,
  permissionsForChange,
  type RecordRevision,
  type RecordRevisionSummary,
  type RevisionOp,
  type RevisionRetention,
  WRITE_SOURCES,
  type WriteSource,
} from '@fibergis/shared';

/**
 * Phase 23 (migration 2): the server's own history of every write, in tables of their own beside
 * `records`. `audit_events` is append-only (triggers refuse any change or delete); it says who
 * changed which record, when, how it reached the server, what kind of change it was and which fields
 * changed. `record_revisions` keeps the whole record after each change, so versions can be compared;
 * the oldest are removed by the retention setting. Neither table is sent with the network or put in
 * a backup file; nothing in the browser can write to them.
 */
export const HISTORY_SCHEMA = `
  CREATE TABLE IF NOT EXISTS record_revisions (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    collection TEXT NOT NULL,
    record_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    op TEXT NOT NULL,
    data TEXT NOT NULL CHECK (json_valid(data)),
    changed_at TEXT NOT NULL,
    actor_id TEXT,
    actor_name TEXT NOT NULL,
    source TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS record_revisions_by_record ON record_revisions (collection, record_id, seq);
  CREATE INDEX IF NOT EXISTS record_revisions_by_time ON record_revisions (changed_at);
  CREATE TABLE IF NOT EXISTS audit_events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    actor_id TEXT,
    actor_name TEXT NOT NULL,
    actor_role TEXT,
    source TEXT NOT NULL,
    collection TEXT NOT NULL,
    record_id TEXT NOT NULL,
    op TEXT NOT NULL,
    actions TEXT NOT NULL,
    revision INTEGER NOT NULL,
    diff TEXT NOT NULL CHECK (json_valid(diff)),
    note TEXT,
    change_request_id TEXT
  );
  CREATE INDEX IF NOT EXISTS audit_events_by_record ON audit_events (collection, record_id, seq);
  CREATE TRIGGER IF NOT EXISTS audit_events_append_only_update BEFORE UPDATE ON audit_events
    BEGIN SELECT RAISE(ABORT, 'audit events cannot be changed'); END;
  CREATE TRIGGER IF NOT EXISTS audit_events_append_only_delete BEFORE DELETE ON audit_events
    BEGIN SELECT RAISE(ABORT, 'audit events cannot be deleted'); END;
`;

/** The person behind writes the server makes itself (monitoring feed, start-up seed). */
export const SERVER_ACTOR: AuditActor = { id: null, name: 'Server (no person)', role: null };
export const SETUP_ACTOR: AuditActor = { id: null, name: 'Setup mode (login off)', role: null };

/**
 * High-volume rows kept by their own rules: no revision per row, one summary line per write.
 * Audit entries are the browser's own trail and are append-only already, so they are not repeated.
 */
const SUMMARY_ONLY: ReadonlySet<CollectionName> = new Set<CollectionName>(['onuReadings', 'onuStatuses', 'deviceStatuses']);
const NOT_TRACKED: ReadonlySet<CollectionName> = new Set<CollectionName>(['auditLogs']);

/** How often old revisions are looked for, at most. */
const AGE_PRUNE_EVERY_MS = 60 * 60 * 1000;

type Row = Record<string, unknown>;

export interface WriteRecord {
  collection: CollectionName;
  id: string;
  version: number;
  before: Record<string, unknown> | undefined;
  after: Record<string, unknown> | undefined;
}

export interface WriteContext {
  at: string;
  actor: AuditActor;
  source: WriteSource;
  revision: number;
  changeRequestId?: string;
}

const asSource = (value: unknown): WriteSource => ((WRITE_SOURCES as readonly string[]).includes(String(value)) ? (value as WriteSource) : 'server');
const asRole = (value: unknown): AccountRole | null => (value != null && isAccountRole(String(value)) ? (String(value) as AccountRole) : null);

const toSummary = (row: Row): RecordRevisionSummary => ({
  seq: Number(row.seq),
  collection: String(row.collection) as CollectionName,
  recordId: String(row.record_id),
  version: Number(row.version),
  op: String(row.op) as RevisionOp,
  at: String(row.changed_at),
  actorId: row.actor_id == null ? null : String(row.actor_id),
  actorName: String(row.actor_name),
  source: asSource(row.source),
});

const toEvent = (row: Row): AuditEvent => ({
  seq: Number(row.seq),
  at: String(row.at),
  actorId: row.actor_id == null ? null : String(row.actor_id),
  actorName: String(row.actor_name),
  actorRole: asRole(row.actor_role),
  source: asSource(row.source),
  collection: String(row.collection) as CollectionName,
  recordId: String(row.record_id),
  op: String(row.op) as AuditEvent['op'],
  actions: String(row.actions ?? '')
    .split(',')
    .filter(Boolean) as PermissionAction[],
  revision: Number(row.revision),
  diff: JSON.parse(String(row.diff)) as FieldDiff[],
  ...(row.note ? { note: String(row.note) } : {}),
  ...(row.change_request_id ? { changeRequestId: String(row.change_request_id) } : {}),
});

export interface AuditQuery {
  collection?: CollectionName;
  recordId?: string;
  /** Only events older than this sequence number (for paging back). */
  beforeSeq?: number;
  limit?: number;
}

/**
 * Writes and reads the history tables. Every write method is synchronous and is called by the
 * repository inside the same transaction as the record change, so history and data never disagree.
 */
export class RecordHistoryStore {
  private readonly q: Record<string, StatementSync>;
  private retention: RevisionRetention = { keepDays: 365, keepPerRecord: 50 };
  private lastAgePrune = 0;

  constructor(private readonly db: DatabaseSync) {
    this.q = {
      revision: db.prepare(
        'INSERT INTO record_revisions (collection, record_id, version, op, data, changed_at, actor_id, actor_name, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ),
      event: db.prepare(
        `INSERT INTO audit_events (at, actor_id, actor_name, actor_role, source, collection, record_id, op, actions, revision, diff, note, change_request_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ),
      listRevisions: db.prepare(
        'SELECT seq, collection, record_id, version, op, changed_at, actor_id, actor_name, source FROM record_revisions WHERE collection = ? AND record_id = ? ORDER BY seq DESC LIMIT ?',
      ),
      getRevision: db.prepare('SELECT * FROM record_revisions WHERE collection = ? AND record_id = ? AND seq = ?'),
      pruneRecord: db.prepare(
        `DELETE FROM record_revisions WHERE collection = ? AND record_id = ? AND seq NOT IN
           (SELECT seq FROM record_revisions WHERE collection = ? AND record_id = ? ORDER BY seq DESC LIMIT ?)`,
      ),
      pruneAge: db.prepare('DELETE FROM record_revisions WHERE changed_at < ?'),
      countRevisions: db.prepare('SELECT COUNT(*) AS n FROM record_revisions'),
    };
  }

  setRetention(retention: RevisionRetention) {
    this.retention = { keepDays: Math.max(1, Math.floor(retention.keepDays)), keepPerRecord: Math.max(1, Math.floor(retention.keepPerRecord)) };
  }

  getRetention(): RevisionRetention {
    return { ...this.retention };
  }

  /**
   * Records one write: a revision and an audit event per changed record, one summary line per
   * collection for high-volume rows. Records whose data did not change are not recorded.
   */
  recordWrites(records: readonly WriteRecord[], context: WriteContext, options: { perRecordEvents?: boolean } = {}) {
    const perRecordEvents = options.perRecordEvents ?? true;
    const summaries = new Map<CollectionName, { created: number; updated: number; deleted: number }>();
    const touched = new Set<string>();
    for (const r of records) {
      if (NOT_TRACKED.has(r.collection)) continue;
      const op: RevisionOp = !r.before ? 'create' : r.after ? 'update' : 'delete';
      if (SUMMARY_ONLY.has(r.collection)) {
        const s = summaries.get(r.collection) ?? { created: 0, updated: 0, deleted: 0 };
        s[op === 'create' ? 'created' : op === 'update' ? 'updated' : 'deleted'] += 1;
        summaries.set(r.collection, s);
        continue;
      }
      const data = r.after ?? r.before ?? {};
      this.q.revision.run(r.collection, r.id, r.version, op, JSON.stringify(data), context.at, context.actor.id, context.actor.name, context.source);
      if (perRecordEvents) {
        const actions = permissionsForChange(r.collection, r.before, r.after);
        const diff = op === 'update' ? diffRecords(r.before, r.after) : [];
        this.insertEvent(context, r.collection, r.id, op, actions, diff, null);
      }
      touched.add(JSON.stringify([r.collection, r.id]));
    }
    for (const [collection, s] of perRecordEvents ? summaries : []) {
      const note = [s.created && `${s.created} added`, s.updated && `${s.updated} changed`, s.deleted && `${s.deleted} removed`].filter(Boolean).join(', ');
      this.insertEvent(context, collection, '', 'summary', [], [], note);
    }
    for (const key of touched) {
      const [collection, id] = JSON.parse(key) as [string, string];
      this.q.pruneRecord.run(collection, id, collection, id, this.retention.keepPerRecord);
    }
    this.pruneByAge(Date.parse(context.at));
  }

  /** A line for a write that replaced many records at once (restore, reset), per collection. */
  recordSummary(context: WriteContext, collection: CollectionName, note: string) {
    this.insertEvent(context, collection, '', 'summary', [], [], note);
  }

  private insertEvent(context: WriteContext, collection: CollectionName, recordId: string, op: string, actions: readonly PermissionAction[], diff: readonly FieldDiff[], note: string | null) {
    this.q.event.run(
      context.at,
      context.actor.id,
      context.actor.name,
      context.actor.role,
      context.source,
      collection,
      recordId,
      op,
      actions.join(','),
      context.revision,
      JSON.stringify(diff),
      note,
      context.changeRequestId ?? null,
    );
  }

  /** Removes revisions older than the retention. Runs at most once an hour (and at start). */
  pruneByAge(now = Date.now(), force = false) {
    if (!force && now - this.lastAgePrune < AGE_PRUNE_EVERY_MS) return 0;
    this.lastAgePrune = now;
    const cutoff = new Date(now - this.retention.keepDays * 86_400_000).toISOString();
    return Number(this.q.pruneAge.run(cutoff).changes);
  }

  listRevisions(collection: CollectionName, recordId: string, limit = 200): RecordRevisionSummary[] {
    return (this.q.listRevisions.all(collection, recordId, Math.min(Math.max(limit, 1), 1000)) as Row[]).map(toSummary);
  }

  getRevision(collection: CollectionName, recordId: string, seq: number): RecordRevision | undefined {
    const row = this.q.getRevision.get(collection, recordId, seq) as Row | undefined;
    return row ? { ...toSummary(row), data: JSON.parse(String(row.data)) as Record<string, unknown> } : undefined;
  }

  revisionCount(): number {
    return Number((this.q.countRevisions.get() as Row).n);
  }

  listEvents(query: AuditQuery = {}): AuditEvent[] {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (query.collection && isCollectionName(query.collection)) {
      where.push('collection = ?');
      params.push(query.collection);
    }
    if (query.recordId !== undefined) {
      where.push('record_id = ?');
      params.push(query.recordId);
    }
    if (query.beforeSeq !== undefined) {
      where.push('seq < ?');
      params.push(query.beforeSeq);
    }
    const limit = Math.min(Math.max(query.limit ?? 200, 1), 2000);
    const sql = `SELECT * FROM audit_events ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY seq DESC LIMIT ${limit}`;
    return (this.db.prepare(sql).all(...params) as Row[]).map(toEvent);
  }
}
