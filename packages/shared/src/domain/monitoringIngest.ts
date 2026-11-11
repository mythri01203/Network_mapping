import { z } from 'zod';

import { deviceIngestRowSchema, type MonitoringSource, type OnuReading, onuStateSchema, type OnuStatus, type ReadingDirection } from '../model/monitoringSchemas';
import type { Ont } from '../model/types';
import { isLiveOnt } from './connectionRules';
import { DEFAULT_MONITORING_SETTINGS, type MonitoringSettings } from './monitoringSettings';

/**
 * Turns rows from a file export, a push message or the TEST simulator into stored readings and
 * statuses. Pure, so the browser preview and the server store exactly the same thing. A row is tied
 * to an ONT only when its ONU address or serial is exactly the one written on one live ONT record
 * (spaces at the ends ignored, nothing else changed). Otherwise it is kept as "not matched", with
 * the reason. Rows with no time zone, a time in the future, a unit other than dBm or an impossible
 * value are skipped with the reason. The same row sent twice is stored once.
 */

const dbmValue = z.union([z.number(), z.string().trim().max(40)]);

/** One row as a script, a file mapping or the simulator gives it. */
export const ingestRowSchema = z.strictObject({
  onuAddress: z.string().trim().max(80).optional(),
  serial: z.string().trim().max(64).optional(),
  /** ISO 8601 with a time zone, such as 2026-11-09T10:15:00+05:30. */
  deviceTime: z.string().trim().max(40),
  ontRxDbm: dbmValue.optional(),
  oltRxDbm: dbmValue.optional(),
  /** Only "dBm" is accepted. Needed when a reading is sent. */
  unit: z.string().trim().max(12).optional(),
  state: onuStateSchema.optional(),
  /** The vendor's own status word, kept as written. */
  rawState: z.string().trim().max(40).optional(),
});
export type IngestRow = z.infer<typeof ingestRowSchema>;

export const MAX_INGEST_ROWS = 2000;
/**
 * A push: ONU rows, and (Phase 20) OLT, card, PON port and uplink rows in `devices`. At least one
 * row in all, at most `MAX_INGEST_ROWS` of each.
 */
export const ingestBodySchema = z
  .strictObject({
    rows: z.array(ingestRowSchema).max(MAX_INGEST_ROWS).optional(),
    devices: z.array(deviceIngestRowSchema).max(MAX_INGEST_ROWS).optional(),
  })
  .refine((b) => (b.rows?.length ?? 0) + (b.devices?.length ?? 0) > 0, { message: 'Send at least one row in "rows" or "devices".' });

export interface SkippedRow {
  /** 1-based position in what was sent. */
  row: number;
  reason: string;
}

export interface IngestPlan {
  readings: OnuReading[];
  statuses: OnuStatus[];
  skipped: SkippedRow[];
  /** Rows kept but tied to no ONT. */
  unmatched: { row: number; key: string; reason: string }[];
  /** Rows already stored (or repeated in this batch), so nothing new was made. */
  duplicates: number;
  matched: number;
}

const ZONE = /(?:[zZ]|[+-]\d{2}:?\d{2})$/;

/** Why a device time cannot be stored (no time zone, unreadable, ahead of the server clock), or null. */
export function deviceTimeProblem(deviceTime: string, now: Date, settings: MonitoringSettings = DEFAULT_MONITORING_SETTINGS): string | null {
  if (!ZONE.test(deviceTime) || !Number.isFinite(Date.parse(deviceTime))) return `Time "${deviceTime.slice(0, 30)}" is not a full date and time with a time zone`;
  const ahead = (Date.parse(deviceTime) - now.getTime()) / 60_000;
  if (ahead > settings.maxFutureMinutes) return `Device time is ${Math.round(ahead)} min ahead of the server clock; check the device clock`;
  return null;
}

/** A short stable id from the row's content, so the same row sent twice gets the same id. */
export function contentId(prefix: string, parts: readonly (string | number | undefined)[]): string {
  const text = parts.map((p) => (p === undefined ? '' : String(p))).join('|');
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ text.length;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
  }
  return `${prefix}-${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`.toUpperCase();
}

function parseDbm(value: number | string | undefined): { value?: number; raw?: string; problem?: string } {
  if (value === undefined || value === '') return {};
  const raw = String(value).trim();
  const n = typeof value === 'number' ? value : Number(raw.replace(/\s*dBm$/i, ''));
  if (!Number.isFinite(n)) return { raw, problem: `"${raw.slice(0, 20)}" is not a number` };
  if (n < -60 || n > 15) return { raw, problem: `${n} dBm is outside -60 to +15 dBm, so it cannot be a light level` };
  return { value: Math.round(n * 100) / 100, raw };
}

type Match = { ont?: Ont; by: 'onu_address' | 'serial' | 'none'; reason?: string };

/** Exact match on the ONU address, then on the serial. Several ONTs with one key is not a match. */
export function matchOnt(onts: readonly Ont[], onuAddress?: string, serial?: string): Match {
  const live = onts.filter(isLiveOnt);
  const byAddress = onuAddress ? live.filter((o) => o.onuAddress?.trim() === onuAddress) : [];
  const bySerial = serial ? live.filter((o) => o.serialNumber?.trim() === serial) : [];
  if (byAddress.length > 1) return { by: 'none', reason: `ONU address "${onuAddress}" is written on ${byAddress.length} ONTs` };
  if (bySerial.length > 1) return { by: 'none', reason: `Serial "${serial}" is written on ${bySerial.length} ONTs` };
  if (byAddress[0] && bySerial[0] && byAddress[0].id !== bySerial[0].id) return { by: 'none', reason: 'The address and the serial are on two different ONTs' };
  if (byAddress[0]) return { ont: byAddress[0], by: 'onu_address' };
  if (bySerial[0]) return { ont: bySerial[0], by: 'serial' };
  const what = [onuAddress && `address "${onuAddress}"`, serial && `serial "${serial}"`].filter(Boolean).join(' or ');
  return { by: 'none', reason: `No ONT record has ${what}` };
}

export interface IngestContext {
  source: Pick<MonitoringSource, 'id' | 'isTest'>;
  onts: readonly Ont[];
  /** Ids already stored, so repeats are not stored again. */
  existingIds: ReadonlySet<string>;
  now: Date;
  settings?: MonitoringSettings;
}

export function planIngest(rows: readonly IngestRow[], ctx: IngestContext): IngestPlan {
  const settings = ctx.settings ?? DEFAULT_MONITORING_SETTINGS;
  const plan: IngestPlan = { readings: [], statuses: [], skipped: [], unmatched: [], duplicates: 0, matched: 0 };
  const seen = new Set(ctx.existingIds);
  const receivedAt = ctx.now.toISOString();
  rows.forEach((row, i) => {
    const n = i + 1;
    const skip = (reason: string) => plan.skipped.push({ row: n, reason });
    const onuAddress = row.onuAddress?.trim() || undefined;
    const serial = row.serial?.trim() || undefined;
    if (!onuAddress && !serial) return skip('No ONU address or serial');
    if (!ZONE.test(row.deviceTime) || !Number.isFinite(Date.parse(row.deviceTime))) {
      return skip(`Time "${row.deviceTime.slice(0, 30)}" is not a full date and time with a time zone`);
    }
    const at = new Date(Date.parse(row.deviceTime));
    const ahead = (at.getTime() - ctx.now.getTime()) / 60_000;
    if (ahead > settings.maxFutureMinutes) return skip(`Device time is ${Math.round(ahead)} min ahead of the server clock; check the device clock`);
    const ont = parseDbm(row.ontRxDbm);
    const olt = parseDbm(row.oltRxDbm);
    if (ont.problem || olt.problem) return skip(`Reading ${ont.problem ?? olt.problem}`);
    const hasReading = ont.value !== undefined || olt.value !== undefined;
    if (!hasReading && !row.state) return skip('No reading and no status');
    if (hasReading && row.unit?.toLowerCase() !== 'dbm') return skip(row.unit ? `Unit "${row.unit}" is not dBm` : 'No unit given for the reading (only dBm is accepted)');

    const match = matchOnt(ctx.onts, onuAddress, serial);
    const deviceTime = at.toISOString();
    const key = onuAddress ?? serial ?? '';
    const base = {
      ...(match.ont ? { ontId: match.ont.id } : {}),
      matchedBy: match.by,
      ...(onuAddress ? { onuAddress } : {}),
      ...(serial ? { serial } : {}),
      origin: 'device_reported' as const,
      sourceId: ctx.source.id,
      isTest: ctx.source.isTest,
      deviceTime,
      receivedAt,
      ...(match.reason ? { unmatchedReason: match.reason } : {}),
    };
    let made = 0;
    const reading = (direction: ReadingDirection, p: { value?: number; raw?: string }) => {
      if (p.value === undefined) return;
      const id = contentId('RD', [ctx.source.id, key, direction, deviceTime, p.value]);
      if (seen.has(id)) return void (plan.duplicates += 1);
      seen.add(id);
      made += 1;
      plan.readings.push({ id, ...base, direction, valueDbm: p.value, unit: 'dBm', ...(p.raw ? { rawValue: p.raw } : {}) });
    };
    reading('ont_rx', ont);
    reading('olt_upstream_rx', olt);
    if (row.state) {
      const id = contentId('ST', [ctx.source.id, key, deviceTime, row.state]);
      if (seen.has(id)) plan.duplicates += 1;
      else {
        seen.add(id);
        made += 1;
        plan.statuses.push({ id, ...base, state: row.state, ...(row.rawState ? { rawState: row.rawState } : {}) });
      }
    }
    if (made === 0) return;
    if (match.ont) plan.matched += 1;
    else plan.unmatched.push({ row: n, key, reason: match.reason ?? 'Not matched' });
  });
  return plan;
}
