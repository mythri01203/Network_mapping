import type { DatabaseSync, StatementSync } from 'node:sqlite';

import { type ChangeRequest, type ChangeRequestEvent, type ChangeRequestPerson, type ChangeRequestStatus, type ChangeSet, randomCode, type RecordVersions } from '@fibergis/shared';

/**
 * Phase 23 (migration 2): change requests, in a table of their own. A request holds the proposed
 * change set exactly as sent (validated), the version of each record when it was asked for, who asked,
 * who reviewed, who made and who checked it, and every step and comment in order.
 */
export const CHANGE_REQUEST_SCHEMA = `
  CREATE TABLE IF NOT EXISTS change_requests (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    changes TEXT NOT NULL CHECK (json_valid(changes)),
    base_versions TEXT NOT NULL CHECK (json_valid(base_versions)),
    requested_by TEXT,
    requested_by_name TEXT NOT NULL,
    requested_at TEXT NOT NULL,
    reviewed_by TEXT,
    reviewed_by_name TEXT,
    reviewed_at TEXT,
    review_note TEXT,
    applied_by TEXT,
    applied_by_name TEXT,
    applied_at TEXT,
    applied_revision INTEGER,
    verified_by TEXT,
    verified_by_name TEXT,
    verified_at TEXT,
    closed_at TEXT,
    events TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(events)),
    updated_at TEXT NOT NULL
  ) WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS change_requests_by_status ON change_requests (status, requested_at);
`;

type Row = Record<string, unknown>;

const person = (id: unknown, name: unknown): ChangeRequestPerson | undefined => (name == null ? undefined : { id: id == null ? null : String(id), name: String(name) });

const toRequest = (row: Row): ChangeRequest => {
  const reviewedBy = person(row.reviewed_by, row.reviewed_by_name);
  const appliedBy = person(row.applied_by, row.applied_by_name);
  const verifiedBy = person(row.verified_by, row.verified_by_name);
  return {
    id: String(row.id),
    title: String(row.title),
    reason: String(row.reason ?? ''),
    status: String(row.status) as ChangeRequestStatus,
    changes: JSON.parse(String(row.changes)) as ChangeSet,
    baseVersions: JSON.parse(String(row.base_versions)) as RecordVersions,
    requestedBy: person(row.requested_by, row.requested_by_name)!,
    requestedAt: String(row.requested_at),
    ...(reviewedBy ? { reviewedBy } : {}),
    ...(row.reviewed_at ? { reviewedAt: String(row.reviewed_at) } : {}),
    ...(row.review_note ? { reviewNote: String(row.review_note) } : {}),
    ...(appliedBy ? { appliedBy } : {}),
    ...(row.applied_at ? { appliedAt: String(row.applied_at) } : {}),
    ...(row.applied_revision != null ? { appliedRevision: Number(row.applied_revision) } : {}),
    ...(verifiedBy ? { verifiedBy } : {}),
    ...(row.verified_at ? { verifiedAt: String(row.verified_at) } : {}),
    ...(row.closed_at ? { closedAt: String(row.closed_at) } : {}),
    events: JSON.parse(String(row.events)) as ChangeRequestEvent[],
  };
};

export interface NewChangeRequest {
  title: string;
  reason: string;
  changes: ChangeSet;
  baseVersions: RecordVersions;
  requestedBy: ChangeRequestPerson;
}

export class ChangeRequestStore {
  private readonly q: Record<string, StatementSync>;

  constructor(db: DatabaseSync) {
    this.q = {
      insert: db.prepare(
        `INSERT INTO change_requests (id, title, reason, status, changes, base_versions, requested_by, requested_by_name, requested_at, events, updated_at)
         VALUES (?, ?, ?, 'requested', ?, ?, ?, ?, ?, ?, ?)`,
      ),
      get: db.prepare('SELECT * FROM change_requests WHERE id = ?'),
      all: db.prepare('SELECT * FROM change_requests ORDER BY requested_at DESC, id LIMIT ?'),
      byStatus: db.prepare('SELECT * FROM change_requests WHERE status = ? ORDER BY requested_at DESC, id LIMIT ?'),
      save: db.prepare(
        `UPDATE change_requests SET status = ?, reviewed_by = ?, reviewed_by_name = ?, reviewed_at = ?, review_note = ?, applied_by = ?, applied_by_name = ?,
           applied_at = ?, applied_revision = ?, verified_by = ?, verified_by_name = ?, verified_at = ?, closed_at = ?, events = ?, updated_at = ? WHERE id = ?`,
      ),
    };
  }

  create(input: NewChangeRequest, now = new Date()): ChangeRequest {
    const id = `CR-${randomCode(10)}`;
    const at = now.toISOString();
    const events: ChangeRequestEvent[] = [{ at, byId: input.requestedBy.id, byName: input.requestedBy.name, kind: 'created', ...(input.reason ? { text: input.reason } : {}) }];
    this.q.insert.run(id, input.title, input.reason, JSON.stringify(input.changes), JSON.stringify(input.baseVersions), input.requestedBy.id, input.requestedBy.name, at, JSON.stringify(events), at);
    return this.get(id)!;
  }

  get(id: string): ChangeRequest | undefined {
    const row = this.q.get.get(id) as Row | undefined;
    return row ? toRequest(row) : undefined;
  }

  list(status?: ChangeRequestStatus, limit = 200): ChangeRequest[] {
    const rows = (status ? this.q.byStatus.all(status, limit) : this.q.all.all(limit)) as Row[];
    return rows.map(toRequest);
  }

  /** Saves the status, the people and times, and the steps of a request. The change set itself never changes. */
  save(request: ChangeRequest, now = new Date()): ChangeRequest {
    this.q.save.run(
      request.status,
      request.reviewedBy?.id ?? null,
      request.reviewedBy?.name ?? null,
      request.reviewedAt ?? null,
      request.reviewNote ?? null,
      request.appliedBy?.id ?? null,
      request.appliedBy?.name ?? null,
      request.appliedAt ?? null,
      request.appliedRevision ?? null,
      request.verifiedBy?.id ?? null,
      request.verifiedBy?.name ?? null,
      request.verifiedAt ?? null,
      request.closedAt ?? null,
      JSON.stringify(request.events),
      now.toISOString(),
      request.id,
    );
    return this.get(request.id)!;
  }
}
