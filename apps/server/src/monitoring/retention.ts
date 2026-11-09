import type { OnuReading, OnuStatus } from '@fibergis/shared';

/**
 * How much device monitoring history the server keeps (Phase 7). Every push or import adds rows,
 * and the whole network is read for each request, so without a limit an OLT sending every few
 * minutes would slow the server within days. The newest row for each ONT (and direction) is always
 * kept, so "last known" never disappears; rows older than `keepDays` go, and beyond `maxRows` the
 * oldest go first. Ages use the time this server stored a row, never the device's own clock.
 */
export interface RetentionLimits {
  keepDays: number;
  maxRows: number;
}

type Row = Pick<OnuReading, 'id' | 'ontId' | 'onuAddress' | 'serial' | 'sourceId' | 'receivedAt'>;

const deviceKey = (row: Row) => `${row.sourceId}|${row.ontId ?? row.onuAddress ?? row.serial ?? row.id}`;
export const readingKey = (row: OnuReading) => `${deviceKey(row)}|${row.direction}`;
export const statusKey = (row: OnuStatus) => deviceKey(row);

/** Ids of rows to remove, oldest first. */
export function rowsToPrune<T extends Row>(rows: readonly T[], keyOf: (row: T) => string, limits: RetentionLimits, now: Date): string[] {
  const newest = new Map<string, T>();
  for (const row of rows) {
    const key = keyOf(row);
    const kept = newest.get(key);
    if (!kept || row.receivedAt > kept.receivedAt) newest.set(key, row);
  }
  const keep = new Set([...newest.values()].map((row) => row.id));
  const oldestFirst = [...rows].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  const cutoff = now.getTime() - limits.keepDays * 86_400_000;
  const drop = new Set<string>();
  for (const row of oldestFirst) {
    if (!keep.has(row.id) && !(Date.parse(row.receivedAt) >= cutoff)) drop.add(row.id);
  }
  let left = rows.length - drop.size;
  for (const row of oldestFirst) {
    if (left <= limits.maxRows) break;
    if (keep.has(row.id) || drop.has(row.id)) continue;
    drop.add(row.id);
    left -= 1;
  }
  return [...drop];
}
