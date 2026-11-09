import type { DatabaseSync } from 'node:sqlite';

import { hashToken, newSessionToken } from '../auth/passwords';

/**
 * Push tokens for monitoring sources (Phase 7), one per source, in a table of its own beside
 * `records`. Only a SHA-256 hash of the token is stored; the token itself is shown to the
 * administrator once and never again. Created with `CREATE TABLE IF NOT EXISTS`, leaving
 * `PRAGMA user_version` as it is, like the login tables. Never sent with the network or a backup.
 */
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS monitoring_tokens (
    source_id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    created_by TEXT,
    last_used_at TEXT
  ) WITHOUT ROWID;
`;

/** Tokens start with this, so a leaked one is easy to recognise and search for. */
export const INGEST_TOKEN_PREFIX = 'fgm_';

type Row = Record<string, unknown>;

export class MonitoringTokenStore {
  private readonly statements;

  constructor(db: DatabaseSync) {
    db.exec(SCHEMA);
    this.statements = {
      upsert: db.prepare(
        `INSERT INTO monitoring_tokens (source_id, token_hash, created_at, created_by) VALUES (?, ?, ?, ?)
         ON CONFLICT (source_id) DO UPDATE SET token_hash = excluded.token_hash, created_at = excluded.created_at, created_by = excluded.created_by, last_used_at = NULL`,
      ),
      byHash: db.prepare('SELECT source_id FROM monitoring_tokens WHERE token_hash = ?'),
      touch: db.prepare('UPDATE monitoring_tokens SET last_used_at = ? WHERE source_id = ?'),
      remove: db.prepare('DELETE FROM monitoring_tokens WHERE source_id = ?'),
      has: db.prepare('SELECT created_at, last_used_at FROM monitoring_tokens WHERE source_id = ?'),
    };
  }

  /** Makes (or replaces) the token for a source. Returns the token: show it once, it is not kept. */
  issue(sourceId: string, createdBy: string | null, now = new Date()): string {
    const token = `${INGEST_TOKEN_PREFIX}${newSessionToken()}`;
    this.statements.upsert.run(sourceId, hashToken(token), now.toISOString(), createdBy);
    return token;
  }

  /** The source a token belongs to, or undefined. Marks it used. */
  sourceFor(token: string, now = new Date()): string | undefined {
    if (!token.startsWith(INGEST_TOKEN_PREFIX) || token.length > 200) return undefined;
    const row = this.statements.byHash.get(hashToken(token)) as Row | undefined;
    if (!row) return undefined;
    const sourceId = String(row.source_id);
    this.statements.touch.run(now.toISOString(), sourceId);
    return sourceId;
  }

  revoke(sourceId: string): boolean {
    return Number(this.statements.remove.run(sourceId).changes) > 0;
  }

  info(sourceId: string): { createdAt: string; lastUsedAt?: string } | undefined {
    const row = this.statements.has.get(sourceId) as Row | undefined;
    if (!row) return undefined;
    return { createdAt: String(row.created_at), ...(row.last_used_at ? { lastUsedAt: String(row.last_used_at) } : {}) };
  }
}
