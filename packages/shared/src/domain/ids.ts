import type { CableType } from '../model/enums';

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Returns the next free sequential ID for a prefix, e.g. `nextSequentialId('FAT-', ['FAT-01', 'FAT-07'])` → `FAT-08`.
 * IDs that do not match `<prefix><digits>` are ignored so custom IDs never break numbering.
 */
export function nextSequentialId(prefix: string, existingIds: string[], pad = 2): string {
  const pattern = new RegExp(`^${escapeRegExp(prefix)}(\\d+)$`, 'i');
  const taken = new Set(existingIds.map((id) => id.toLowerCase()));
  let max = 0;
  existingIds.forEach((id) => {
    const match = pattern.exec(id);
    if (match) max = Math.max(max, parseInt(match[1], 10));
  });
  let next = max + 1;
  let candidate = `${prefix}${next.toString().padStart(pad, '0')}`;
  while (taken.has(candidate.toLowerCase())) {
    next += 1;
    candidate = `${prefix}${next.toString().padStart(pad, '0')}`;
  }
  return candidate;
}

/** Crockford base32, as field capture uses: no I, L, O or U. */
const RECORD_ID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const RECORD_ID_CODE_LENGTH = 10;

/**
 * Phase 9: the permanent ID of a record made on the engineer or office screens, such as
 * `POLE-7K2M9XPQ4A`. 50 random bits, so two people working offline cannot make the same ID, unlike
 * the older sequential `POLE-07`. People see the record's name (`nextNumberedName`), not this.
 * Existing records keep their IDs.
 */
export function newRecordId(prefix: string, random?: (bytes: Uint8Array) => Uint8Array): string {
  const crypto = (globalThis as unknown as { crypto?: { getRandomValues: (b: Uint8Array) => Uint8Array } }).crypto;
  const fill = random ?? ((b: Uint8Array) => {
    if (!crypto) throw new Error('Secure random numbers are not available on this device.');
    return crypto.getRandomValues(b);
  });
  const bytes = fill(new Uint8Array(RECORD_ID_CODE_LENGTH));
  let code = '';
  for (let i = 0; i < RECORD_ID_CODE_LENGTH; i += 1) code += RECORD_ID_ALPHABET[bytes[i] & 31];
  const head = prefix.endsWith('-') ? prefix : `${prefix}-`;
  return `${head}${code}`;
}

/**
 * The next human number for a kind of record, such as "FAT-08": one more than the highest number
 * used in any existing name or older sequential ID with that prefix. Two offline people may pick
 * the same number; that is only a name, and the random ID keeps the records apart.
 */
export function nextNumberedName(prefix: string, existing: readonly { id: string; name?: string }[], pad = 2): string {
  const pattern = new RegExp(`^${escapeRegExp(prefix)}(\\d+)$`, 'i');
  let highest = 0;
  for (const item of existing) {
    for (const value of [item.id, item.name ?? '']) {
      const match = pattern.exec(value.trim());
      if (match) highest = Math.max(highest, parseInt(match[1], 10));
    }
  }
  return `${prefix}${String(highest + 1).padStart(pad, '0')}`;
}

/** Collision-resistant ID for transient/log records (audit logs, toasts, photos). */
export function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}

export function equipmentIdPrefix(type: string): string {
  if (type === 'OLT' || type === 'ODF' || type === 'FDMS' || type === 'FDT' || type === 'ONT' || type === 'ONU')
    return `${type}-`;
  if (type === 'FAT' || type.includes('Terminal Box')) return 'FAT-';
  if (type.includes('Pole')) return 'POLE-';
  if (type === 'Manhole') return 'MH-';
  if (type === 'Handhole') return 'HH-';
  if (type === 'CATV Optical Node') return 'CATV-NODE-';
  if (type === 'CATV RF Amplifier') return 'CATV-AMP-';
  if (type.includes('Splitter')) return 'SPL-';
  if (type.includes('Closure')) return 'JC-';
  return `${type
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}-`;
}

export function cableIdPrefix(type: CableType | string): string {
  switch (type) {
    case 'Main Feeder Fiber':
      return 'CBL-FEEDER-';
    case 'Distribution Fiber':
      return 'CBL-DIST-';
    case 'Drop Fiber':
      return 'DROP-';
    case 'Coaxial Cable':
      return 'CBL-COAX-';
    case 'Aerial Fiber':
      return 'CBL-AERIAL-';
    case 'Underground Fiber':
      return 'CBL-UG-';
    default:
      return 'CBL-CUSTOM-';
  }
}
