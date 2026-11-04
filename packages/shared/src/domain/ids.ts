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
