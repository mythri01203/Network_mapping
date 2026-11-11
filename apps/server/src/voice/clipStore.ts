import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import { randomCode, type VoiceClip, type VoiceLanguage } from '@fibergis/shared';

/**
 * Generated voice clips (learning assistant). One row per clip in a table of its own, created with
 * `CREATE TABLE IF NOT EXISTS` so `PRAGMA user_version` stays as it is. The audio itself is a file
 * in the voice folder named by the clip id only, so no path can be chosen from outside.
 */
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS voice_clips (
    id TEXT PRIMARY KEY,
    lesson_key TEXT NOT NULL,
    language TEXT NOT NULL,
    script_hash TEXT NOT NULL,
    model TEXT NOT NULL,
    voice TEXT NOT NULL,
    characters INTEGER NOT NULL,
    bytes INTEGER NOT NULL,
    format TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    created_at TEXT NOT NULL,
    created_by TEXT,
    reviewed_at TEXT,
    reviewed_by TEXT
  ) WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS voice_clips_by_lesson ON voice_clips (lesson_key, language);
`;

/** Clip ids look like this; anything else in a URL is refused before the file system is touched. */
export const CLIP_ID_PATTERN = /^VC-[A-Za-z0-9]{10}$/;

type Row = Record<string, unknown>;

/** Identifies the exact words, voice and model, so a changed script never reuses an old clip. */
export const scriptHashOf = (text: string, voice: string, model: string): string =>
  createHash('sha256').update(`${model}\n${voice}\n${text}`).digest('hex').slice(0, 32);

const toClip = (row: Row): VoiceClip => ({
  id: String(row.id),
  lessonKey: String(row.lesson_key),
  language: String(row.language) as VoiceLanguage,
  scriptHash: String(row.script_hash),
  model: String(row.model),
  voice: String(row.voice),
  characters: Number(row.characters),
  bytes: Number(row.bytes),
  format: String(row.format) === 'wav' ? 'wav' : 'mp3',
  status: (['draft', 'approved', 'rejected'].includes(String(row.status)) ? String(row.status) : 'draft') as VoiceClip['status'],
  createdAt: String(row.created_at),
  createdBy: row.created_by == null ? null : String(row.created_by),
  ...(row.reviewed_at ? { reviewedAt: String(row.reviewed_at) } : {}),
  ...(row.reviewed_by ? { reviewedBy: String(row.reviewed_by) } : {}),
});

export const newClipId = () => `VC-${randomCode(10)}`;

export interface NewClip {
  id: string;
  lessonKey: string;
  language: VoiceLanguage;
  scriptHash: string;
  model: string;
  voice: string;
  characters: number;
  bytes: number;
  format: 'mp3' | 'wav';
  createdBy: string | null;
}

export class VoiceClipStore {
  private readonly q;

  constructor(db: DatabaseSync) {
    db.exec(SCHEMA);
    this.q = {
      all: db.prepare('SELECT * FROM voice_clips ORDER BY lesson_key, language, created_at'),
      byId: db.prepare('SELECT * FROM voice_clips WHERE id = ?'),
      byHash: db.prepare("SELECT * FROM voice_clips WHERE script_hash = ? AND language = ? AND status <> 'rejected' ORDER BY created_at DESC LIMIT 1"),
      insert: db.prepare(
        `INSERT INTO voice_clips (id, lesson_key, language, script_hash, model, voice, characters, bytes, format, status, created_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
      ),
      review: db.prepare('UPDATE voice_clips SET status = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ?'),
      charsSince: db.prepare('SELECT COALESCE(SUM(characters), 0) AS n FROM voice_clips WHERE created_at >= ?'),
    };
  }

  list(): VoiceClip[] {
    return (this.q.all.all() as Row[]).map(toClip);
  }

  get(id: string): VoiceClip | undefined {
    const row = this.q.byId.get(id) as Row | undefined;
    return row ? toClip(row) : undefined;
  }

  /** A clip already made from exactly these words, voice and model (not rejected). */
  existing(scriptHash: string, language: VoiceLanguage): VoiceClip | undefined {
    const row = this.q.byHash.get(scriptHash, language) as Row | undefined;
    return row ? toClip(row) : undefined;
  }

  /** Characters sent to Sarvam since `since` (the spending guard counts a day). */
  charactersSince(since: Date): number {
    return Number((this.q.charsSince.get(since.toISOString()) as Row).n);
  }

  add(clip: NewClip, now = new Date()): VoiceClip {
    const { id } = clip;
    this.q.insert.run(id, clip.lessonKey, clip.language, clip.scriptHash, clip.model, clip.voice, clip.characters, clip.bytes, clip.format, now.toISOString(), clip.createdBy);
    return this.get(id)!;
  }

  review(id: string, status: VoiceClip['status'], by: string, now = new Date()): VoiceClip | undefined {
    this.q.review.run(status, now.toISOString(), by, id);
    return this.get(id);
  }
}
