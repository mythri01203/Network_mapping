import type { DatabaseSync } from 'node:sqlite';

import { type Account, type AccountRole, type AccountSummary, normalizeAccountRole, randomCode } from '@fibergis/shared';

import { hashToken } from './passwords';

/**
 * Accounts and sessions (Phase 9), in two tables of their own beside `records`. They are created
 * when the server starts, with `CREATE TABLE IF NOT EXISTS`, and the schema number
 * (`PRAGMA user_version`) is left as it is, so an older server can still open the database: it
 * never reads these tables. Accounts are never sent with the network or put in a backup file.
 */
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    must_change_password INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_login_at TEXT,
    password_changed_at TEXT
  ) WITHOUT ROWID;
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
  ) WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS sessions_by_user ON sessions (user_id);
`;

type Row = Record<string, unknown>;

export interface StoredUser extends AccountSummary {
  passwordHash: string;
}

export interface SessionInfo {
  tokenHash: string;
  account: Account;
  mustChangePassword: boolean;
  expiresAt: string;
}

const toUser = (row: Row): StoredUser => ({
  id: String(row.id),
  username: String(row.username),
  displayName: String(row.display_name),
  // Phase 23: a role written under another name is read as the stored one; anything unknown gets the least rights.
  role: normalizeAccountRole(row.role) ?? 'viewer',
  active: Number(row.active) === 1,
  mustChangePassword: Number(row.must_change_password) === 1,
  createdAt: String(row.created_at),
  ...(row.last_login_at ? { lastLoginAt: String(row.last_login_at) } : {}),
  passwordHash: String(row.password_hash),
});

export const summaryOf = ({ passwordHash: _hash, ...summary }: StoredUser): AccountSummary => summary;
export const accountOf = (u: Pick<StoredUser, 'id' | 'username' | 'displayName' | 'role'>): Account => ({ id: u.id, username: u.username, displayName: u.displayName, role: u.role });

export interface NewUser {
  username: string;
  displayName: string;
  role: AccountRole;
  passwordHash: string;
  mustChangePassword: boolean;
}

export class SqliteAuthStore {
  private readonly q;
  /** Active accounts, kept in memory: every request asks whether login is on. */
  private activeCount: number;

  constructor(db: DatabaseSync) {
    db.exec(SCHEMA);
    this.q = {
      count: db.prepare('SELECT COUNT(*) AS n FROM users WHERE active = 1'),
      all: db.prepare('SELECT * FROM users ORDER BY created_at, username'),
      byId: db.prepare('SELECT * FROM users WHERE id = ?'),
      byName: db.prepare('SELECT * FROM users WHERE username = ?'),
      insert: db.prepare(
        `INSERT INTO users (id, username, display_name, role, password_hash, active, must_change_password, created_at, updated_at, password_changed_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
      ),
      update: db.prepare('UPDATE users SET display_name = ?, role = ?, active = ?, updated_at = ? WHERE id = ?'),
      setPassword: db.prepare('UPDATE users SET password_hash = ?, must_change_password = ?, password_changed_at = ?, updated_at = ? WHERE id = ?'),
      loggedIn: db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?'),
      adminsActive: db.prepare("SELECT COUNT(*) AS n FROM users WHERE active = 1 AND role = 'admin'"),
      createSession: db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)'),
      session: db.prepare(
        `SELECT s.token_hash, s.expires_at, s.last_seen_at, s.created_at AS session_created_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ?`,
      ),
      touch: db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?'),
      removeSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
      removeUserSessions: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
      removeOtherSessions: db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?'),
      removeAllSessions: db.prepare('DELETE FROM sessions'),
      expired: db.prepare('DELETE FROM sessions WHERE expires_at < ?'),
    };
    this.activeCount = this.readCount();
  }

  private readCount() {
    return Number((this.q.count.get() as Row).n);
  }

  /** True once any active account exists: from then on every request needs a session. */
  hasAccounts(): boolean {
    return this.activeCount > 0;
  }

  /** Any account at all, active or not. The first admin can be made only when there is none. */
  isEmpty(): boolean {
    return this.q.all.all().length === 0;
  }

  list(): StoredUser[] {
    return (this.q.all.all() as Row[]).map(toUser);
  }

  byId(id: string): StoredUser | undefined {
    const row = this.q.byId.get(id) as Row | undefined;
    return row ? toUser(row) : undefined;
  }

  byUsername(username: string): StoredUser | undefined {
    const row = this.q.byName.get(username.trim().toLowerCase()) as Row | undefined;
    return row ? toUser(row) : undefined;
  }

  create(user: NewUser, now = new Date()): StoredUser {
    const id = `USR-${randomCode(10)}`;
    const at = now.toISOString();
    this.q.insert.run(id, user.username, user.displayName, user.role, user.passwordHash, user.mustChangePassword ? 1 : 0, at, at, at);
    this.activeCount = this.readCount();
    return this.byId(id)!;
  }

  activeAdmins(): number {
    return Number((this.q.adminsActive.get() as Row).n);
  }

  update(id: string, change: { displayName: string; role: AccountRole; active: boolean }, now = new Date()): StoredUser | undefined {
    this.q.update.run(change.displayName, change.role, change.active ? 1 : 0, now.toISOString(), id);
    if (!change.active) this.q.removeUserSessions.run(id);
    this.activeCount = this.readCount();
    return this.byId(id);
  }

  setPassword(id: string, passwordHash: string, mustChange: boolean, keepSessionHash?: string, now = new Date()): void {
    const at = now.toISOString();
    this.q.setPassword.run(passwordHash, mustChange ? 1 : 0, at, at, id);
    // Everywhere else this account was logged in must log in again.
    if (keepSessionHash) this.q.removeOtherSessions.run(id, keepSessionHash);
    else this.q.removeUserSessions.run(id);
  }

  createSession(userId: string, token: string, days: number, now = new Date()): SessionInfo {
    const at = now.toISOString();
    const expires = new Date(now.getTime() + days * 86_400_000).toISOString();
    this.q.expired.run(at);
    this.q.createSession.run(hashToken(token), userId, at, expires, at);
    this.q.loggedIn.run(at, userId);
    return this.session(token, days, undefined, now)!;
  }

  /**
   * The session behind a cookie, or undefined when it does not exist, has expired, or its account
   * is switched off. A session in use is kept alive: its end moves forward at most once an hour,
   * but never past `maxDays` after the login, so a stolen cookie cannot last for ever.
   */
  session(token: string, days: number, maxDays = Math.max(days, 90), now = new Date()): SessionInfo | undefined {
    const tokenHash = hashToken(token);
    const row = this.q.session.get(tokenHash) as Row | undefined;
    if (!row) return undefined;
    const hardEnd = Date.parse(String(row.session_created_at)) + Math.max(days, maxDays) * 86_400_000;
    if (String(row.expires_at) < now.toISOString() || Number(row.active) !== 1 || !(hardEnd > now.getTime())) {
      this.q.removeSession.run(tokenHash);
      return undefined;
    }
    const user = toUser(row);
    let expiresAt = String(row.expires_at);
    if (now.getTime() - Date.parse(String(row.last_seen_at)) > 3_600_000) {
      expiresAt = new Date(Math.min(now.getTime() + days * 86_400_000, hardEnd)).toISOString();
      this.q.touch.run(now.toISOString(), expiresAt, tokenHash);
    }
    return { tokenHash, account: accountOf(user), mustChangePassword: user.mustChangePassword, expiresAt };
  }

  /** Phase 23b: everyone in this database is logged out (its organisation was switched off). Accounts stay. */
  endAllSessions(): void {
    this.q.removeAllSessions.run();
  }

  endSession(tokenHash: string): void {
    this.q.removeSession.run(tokenHash);
  }
}
