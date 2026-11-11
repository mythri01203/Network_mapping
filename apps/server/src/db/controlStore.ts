import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { OrganisationStatus, PlatformEvent } from '@fibergis/shared';

/**
 * Phase 23b: the control database (`control.db`), a small file of its own beside the
 * organisations' databases. It lists the organisations on this server and which organisation each
 * login name belongs to, and keeps a record of what the platform administrator did. It holds no
 * network data, no passwords and no sessions: those stay in each organisation's own database file,
 * whose tables are not changed at all.
 */
const CONTROL_SCHEMA_VERSION = 1;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS organisations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
    is_host INTEGER NOT NULL DEFAULT 0 CHECK (is_host IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) WITHOUT ROWID;
  CREATE UNIQUE INDEX IF NOT EXISTS organisations_one_host ON organisations (is_host) WHERE is_host = 1;
  CREATE TABLE IF NOT EXISTS organisation_logins (
    username TEXT PRIMARY KEY,
    organisation_id TEXT NOT NULL REFERENCES organisations (id),
    user_id TEXT NOT NULL
  ) WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS organisation_logins_by_org ON organisation_logins (organisation_id);
  CREATE TABLE IF NOT EXISTS platform_events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    actor_id TEXT,
    actor_name TEXT NOT NULL,
    action TEXT NOT NULL,
    organisation_id TEXT,
    details TEXT NOT NULL
  );
  CREATE TRIGGER IF NOT EXISTS platform_events_kept_update BEFORE UPDATE ON platform_events
    BEGIN SELECT RAISE(ABORT, 'platform events are kept as written'); END;
  CREATE TRIGGER IF NOT EXISTS platform_events_kept_delete BEFORE DELETE ON platform_events
    BEGIN SELECT RAISE(ABORT, 'platform events are kept as written'); END;
`;

type Row = Record<string, unknown>;

export interface OrganisationRow {
  id: string;
  name: string;
  status: OrganisationStatus;
  host: boolean;
  createdAt: string;
  updatedAt: string;
}

const toOrganisation = (row: Row): OrganisationRow => ({
  id: String(row.id),
  name: String(row.name),
  // Anything unexpected is read as switched off, so a damaged row never opens an organisation.
  status: row.status === 'active' ? 'active' : 'suspended',
  host: Number(row.is_host) === 1,
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
});

export class ControlStore {
  private readonly db: DatabaseSync;
  private readonly q;
  private closed = false;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
    const version = Number((this.db.prepare('PRAGMA user_version').get() as Row).user_version);
    if (version > CONTROL_SCHEMA_VERSION) {
      this.db.close();
      throw new Error(`The organisations database (control.db) schema v${version} is newer than this server supports (v${CONTROL_SCHEMA_VERSION}).`);
    }
    this.db.exec(SCHEMA);
    if (version < CONTROL_SCHEMA_VERSION) this.db.exec(`PRAGMA user_version = ${CONTROL_SCHEMA_VERSION}`);
    this.q = {
      all: this.db.prepare('SELECT * FROM organisations ORDER BY is_host DESC, created_at, id'),
      byId: this.db.prepare('SELECT * FROM organisations WHERE id = ?'),
      insert: this.db.prepare('INSERT INTO organisations (id, name, status, is_host, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'),
      update: this.db.prepare('UPDATE organisations SET name = ?, status = ?, updated_at = ? WHERE id = ?'),
      login: this.db.prepare('SELECT organisation_id, user_id FROM organisation_logins WHERE username = ?'),
      addLogin: this.db.prepare('INSERT INTO organisation_logins (username, organisation_id, user_id) VALUES (?, ?, ?)'),
      loginsOf: this.db.prepare('SELECT username, user_id FROM organisation_logins WHERE organisation_id = ?'),
      removeLogin: this.db.prepare('DELETE FROM organisation_logins WHERE username = ? AND organisation_id = ?'),
      addEvent: this.db.prepare('INSERT INTO platform_events (at, actor_id, actor_name, action, organisation_id, details) VALUES (?, ?, ?, ?, ?, ?)'),
      events: this.db.prepare('SELECT * FROM platform_events ORDER BY seq DESC LIMIT ?'),
    };
  }

  organisations(): OrganisationRow[] {
    return (this.q.all.all() as Row[]).map(toOrganisation);
  }

  organisation(id: string): OrganisationRow | undefined {
    const row = this.q.byId.get(id) as Row | undefined;
    return row ? toOrganisation(row) : undefined;
  }

  addOrganisation(org: OrganisationRow): void {
    this.q.insert.run(org.id, org.name, org.status, org.host ? 1 : 0, org.createdAt, org.updatedAt);
  }

  updateOrganisation(id: string, change: { name: string; status: OrganisationStatus }, now = new Date()): void {
    this.q.update.run(change.name, change.status, now.toISOString(), id);
  }

  /** Which organisation a login name belongs to. */
  login(username: string): { organisationId: string; userId: string } | undefined {
    const row = this.q.login.get(username) as Row | undefined;
    return row ? { organisationId: String(row.organisation_id), userId: String(row.user_id) } : undefined;
  }

  /** False when the name is already listed (for any organisation). */
  addLogin(username: string, organisationId: string, userId: string): boolean {
    if (this.login(username)) return false;
    this.q.addLogin.run(username, organisationId, userId);
    return true;
  }

  loginsOf(organisationId: string): { username: string; userId: string }[] {
    return (this.q.loginsOf.all(organisationId) as Row[]).map((r) => ({ username: String(r.username), userId: String(r.user_id) }));
  }

  removeLogin(username: string, organisationId: string): void {
    this.q.removeLogin.run(username, organisationId);
  }

  recordEvent(event: Omit<PlatformEvent, 'seq'>): void {
    this.q.addEvent.run(event.at, event.actorId, event.actorName, event.action, event.organisationId, event.details.slice(0, 1000));
  }

  events(limit = 50): PlatformEvent[] {
    return (this.q.events.all(Math.max(1, Math.min(500, limit))) as Row[]).map((r) => ({
      seq: Number(r.seq),
      at: String(r.at),
      actorId: r.actor_id == null ? null : String(r.actor_id),
      actorName: String(r.actor_name),
      action: String(r.action),
      organisationId: r.organisation_id == null ? null : String(r.organisation_id),
      details: String(r.details),
    }));
  }

  /** Runs `fn` in one transaction. */
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }
}
