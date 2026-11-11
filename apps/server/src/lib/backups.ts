import { strFromU8, strToU8, unzipSync, type Zippable, zipSync } from 'fflate';
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { PHOTO_ID_PATTERN } from '@fibergis/shared';

/**
 * Phase 9 backups with photos: one `.zip` holding `backup.json` (the same JSON as before) and a
 * `photos/` folder with every field photo file. Photos are stored as they are (already compressed).
 * The same format is used for the automatic safety copy made before every reset and restore.
 */

export const BACKUP_JSON_NAME = 'backup.json';
const PHOTO_FILE = /^photos\/([A-Za-z0-9][A-Za-z0-9_-]{5,63})\.(jpg|png|webp)$/;

const MAGIC: Record<string, (b: Uint8Array) => boolean> = {
  jpg: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  png: (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  webp: (b) => b.length > 12 && strFromU8(b.subarray(0, 4), true) === 'RIFF' && strFromU8(b.subarray(8, 12), true) === 'WEBP',
};

export interface BackupPhoto {
  /** File name such as `PH-7K2M9XPQ4A.jpg`. */
  file: string;
  bytes: Uint8Array;
}

/** Photo files in the photos folder (name `<id>.<ext>`), skipping half-written uploads. */
export async function listPhotoFiles(dir: string): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  return names.filter((name) => {
    const match = /^(.+)\.(jpg|png|webp)$/.exec(name);
    return !!match && PHOTO_ID_PATTERN.test(match[1]);
  });
}

export async function buildBackupZip(json: string, photosDir: string): Promise<{ zip: Uint8Array; photos: number }> {
  const files: Zippable = { [BACKUP_JSON_NAME]: [strToU8(json), { level: 6 }] };
  const names = await listPhotoFiles(photosDir);
  for (const name of names) {
    files[`photos/${name}`] = [new Uint8Array(await readFile(join(photosDir, name))), { level: 0 }];
  }
  return { zip: zipSync(files), photos: names.length };
}

export type ZipReadResult = { ok: true; json: unknown; photos: BackupPhoto[]; skipped: string[] } | { ok: false; error: string };

/** Reads a backup zip. Unexpected files are skipped and named; a photo whose bytes are not a picture is skipped. */
export function readBackupZip(data: Uint8Array, maxUncompressedBytes: number): ZipReadResult {
  let total = 0;
  let tooBig = false;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(data, {
      filter: (file) => {
        total += file.originalSize;
        if (total > maxUncompressedBytes) tooBig = true;
        return !tooBig && (file.name === BACKUP_JSON_NAME || PHOTO_FILE.test(file.name));
      },
    });
  } catch {
    return { ok: false, error: 'The file is not a readable zip backup.' };
  }
  if (tooBig) return { ok: false, error: 'The backup is larger than this server accepts unpacked. Nothing was restored.' };
  const jsonBytes = entries[BACKUP_JSON_NAME];
  if (!jsonBytes) return { ok: false, error: `The zip has no ${BACKUP_JSON_NAME}, so it is not a FiberGIS backup.` };
  let json: unknown;
  try {
    json = JSON.parse(strFromU8(jsonBytes));
  } catch {
    return { ok: false, error: `${BACKUP_JSON_NAME} inside the zip is not valid JSON.` };
  }
  const photos: BackupPhoto[] = [];
  const skipped: string[] = [];
  for (const [name, bytes] of Object.entries(entries)) {
    const match = PHOTO_FILE.exec(name);
    if (!match) continue;
    if (!MAGIC[match[2]](bytes)) {
      skipped.push(name);
      continue;
    }
    photos.push({ file: `${match[1]}.${match[2]}`, bytes });
  }
  return { ok: true, json, photos, skipped };
}

/** Writes photos that are not already stored. A stored photo is never replaced. Returns how many were added. */
export async function restorePhotos(photos: readonly BackupPhoto[], photosDir: string): Promise<number> {
  if (photos.length === 0) return 0;
  await mkdir(photosDir, { recursive: true });
  const existing = new Set((await listPhotoFiles(photosDir)).map((name) => name.replace(/\.(jpg|png|webp)$/, '')));
  let added = 0;
  for (const photo of photos) {
    const id = photo.file.replace(/\.(jpg|png|webp)$/, '');
    if (existing.has(id)) continue;
    const target = join(photosDir, photo.file);
    const temp = `${target}.${process.pid}-${Date.now()}.part`;
    await writeFile(temp, photo.bytes, { flag: 'wx' });
    await rename(temp, target);
    existing.add(id);
    added += 1;
  }
  return added;
}

/**
 * Saves a safety copy in the backups folder before a reset or restore, then removes the oldest
 * copies beyond `keep`. The file name says when and why, never who.
 */
export async function writeSafetyCopy(dir: string, zip: Uint8Array, reason: 'before-reset' | 'before-restore' | 'scheduled', keep: number, now = new Date()): Promise<string> {
  await mkdir(dir, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const name = `fibergis-${reason}-${stamp}.zip`;
  const target = join(dir, name);
  await writeFile(`${target}.part`, zip, { flag: 'wx' });
  await rename(`${target}.part`, target);
  // Phase 24: scheduled copies are counted apart, so they never push out a copy made before a restore.
  const kind = reason === 'scheduled' ? /^fibergis-scheduled-.+\.zip$/ : /^fibergis-before-(reset|restore)-.+\.zip$/;
  const copies = (await readdir(dir)).filter((n) => kind.test(n));
  if (copies.length > keep) {
    const dated = await Promise.all(copies.map(async (n) => ({ n, t: (await stat(join(dir, n))).mtimeMs })));
    dated.sort((a, b) => a.t - b.t || a.n.localeCompare(b.n));
    for (const { n } of dated.slice(0, copies.length - keep)) await unlink(join(dir, n)).catch(() => undefined);
  }
  return name;
}
