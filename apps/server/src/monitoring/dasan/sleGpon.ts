/**
 * DASAN (DZS) SLE-GPON-MIB: turns SNMP values from a V5808 (or another DASAN NOS GPON OLT) into
 * FiberGIS push rows. Pure functions, no network, so they are tested without an OLT.
 *
 * OIDs and value meanings are from the published SLE-GPON-MIB (enterprise 1.3.6.1.4.1.6296,
 * base .101.23), as listed on oidref.com and mibs.observium.org. Not yet checked on a real device:
 *  - whether a negative receive level comes back signed (-185) or as 16-bit two's complement (65351).
 *    `rxEncoding` chooses; run the poller with --check and compare with `show onu info` first.
 *  - whether the SNMP OLT and ONU index numbers equal the CLI numbers (`gpon-olt N`, ONU id).
 *  - the PON port table (sleGponOltEntry) column numbers, taken from Observium's page order only.
 */
import { DASAN_V5808 } from '@fibergis/shared/sample';

const BASE = '1.3.6.1.4.1.6296.101.23';
export const SLE_GPON_OIDS = {
  /** sleGponOnuEntry columns, index <oltId>.<onuId>. */
  onuStatus: `${BASE}.3.1.1.2`,
  onuSerial: `${BASE}.3.1.1.4`,
  /** INTEGER, units 0.1 dBm: ONT receive (downstream). */
  onuRxPower: `${BASE}.3.1.1.16`,
  /** INTEGER, units 0.1 dBm: OLT receive from this ONU (upstream). */
  onuOltRxPower: `${BASE}.3.1.1.21`,
  onuDeactiveReason: `${BASE}.3.1.1.45`,
  /** sleGponOltEntry columns, index <oltId>. Less certain; see above. */
  oltStatus: `${BASE}.2.1.1.2`,
  oltActiveOnus: `${BASE}.2.1.1.21`,
  oltInactiveOnus: `${BASE}.2.1.1.22`,
} as const;

/** sleGponOnuStatus, as the MIB names them. */
export const ONU_STATUS_NAMES: Record<number, string> = {
  0: 'invalid',
  1: 'inactive',
  2: 'active',
  3: 'running',
  4: 'activePending',
  5: 'deactivePending',
  6: 'disablePending',
  7: 'disable',
  255: 'unknown',
};
/** sleGponOnuDeactiveReason values the mapping uses; others keep their number in rawState. */
export const DEACTIVE_REASON_NAMES: Record<number, string> = {
  1: 'none',
  2: 'dgi',
  3: 'losi',
  4: 'lofi',
  5: 'sfi',
  6: 'sufi',
  7: 'loai',
  8: 'loami',
  9: 'loki',
  100: 'los',
  255: 'unknown',
};
/** sleGponOltStatus. */
export const OLT_STATUS_NAMES: Record<number, string> = {
  0: 'disable',
  1: 'notReady',
  2: 'inactive',
  3: 'active',
  4: 'activePending',
  5: 'deactivePending',
  6: 'switchOverPending',
  255: 'unknown',
};

export type RxEncoding = 'signed16' | 'signed';
export type OnuState = 'online' | 'offline' | 'los' | 'dying_gasp' | 'unknown';

/** One ONU's values from a walk, by column. Missing columns stay undefined. */
export interface OnuValues {
  oltId: number;
  onuId: number;
  status?: number;
  serial?: Buffer | string;
  rx?: number | Buffer | string;
  oltRx?: number | Buffer | string;
  reason?: number;
}

export interface PushRow {
  onuAddress: string;
  serial?: string;
  deviceTime: string;
  state: OnuState;
  rawState: string;
  ontRxDbm?: number;
  oltRxDbm?: number;
  unit?: 'dBm';
}

export interface PushDeviceRow {
  target: 'pon_port';
  oltIp?: string;
  oltId?: string;
  portAddress: string;
  deviceTime: string;
  state: 'up' | 'down' | 'degraded' | 'unknown';
  rawState: string;
  onuOnline?: number;
  onuTotal?: number;
}

/** "1.3.6...3.1.1.16.1.5" under `column` → [1, 5]. */
export function indexOf(oid: string, column: string): number[] | undefined {
  if (!oid.startsWith(`${column}.`)) return undefined;
  const parts = oid
    .slice(column.length + 1)
    .split('.')
    .map(Number);
  return parts.every((n) => Number.isInteger(n) && n >= 0) ? parts : undefined;
}

/**
 * GPON serial as `show onu info` prints it: 4 vendor letters then 8 lower-case hex digits
 * (e.g. "CIGGb3190015"). An 8-byte value is converted; a printable string is kept as written.
 */
export function decodeSerial(value: Buffer | string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const buf = typeof value === 'string' ? Buffer.from(value, 'latin1') : value;
  const printable = (b: Buffer) => b.length > 0 && [...b].every((c) => c >= 0x20 && c < 0x7f);
  if (buf.length === 8 && printable(buf.subarray(0, 4)) && !printable(buf)) {
    return buf.subarray(0, 4).toString('ascii') + buf.subarray(4).toString('hex');
  }
  const text = printable(buf) ? buf.toString('ascii').trim() : buf.toString('hex');
  return text || undefined;
}

/**
 * A receive level in dBm from an INTEGER in 0.1 dBm, or a text value such as "-18.5".
 * Undefined when the OLT gives no reading (0 and 65535 are "no value" placeholders on many OLTs).
 */
export function decodeTenthDbm(
  value: number | Buffer | string | undefined,
  encoding: RxEncoding = 'signed16',
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number') {
    const text = (typeof value === 'string' ? value : value.toString('ascii')).replace(/dbm/i, '').trim();
    const n = Number(text);
    return text && Number.isFinite(n) ? n : undefined;
  }
  if (!Number.isInteger(value) || value === 0 || value === 65535) return undefined;
  const signed = encoding === 'signed16' && value > 32767 ? value - 65536 : value;
  return Math.round(signed) / 10;
}

/** Our state from the MIB status and deactivation reason. Only what the OLT said; nothing inferred. */
export function onuState(status: number | undefined, reason: number | undefined): OnuState {
  if (status === 2 || status === 3) return 'online';
  if (reason === 2) return 'dying_gasp';
  if (reason === 3 || reason === 100) return 'los';
  if (status === 1 || status === 4 || status === 5 || status === 6 || status === 7) return 'offline';
  return 'unknown';
}

/** ISO 8601 with the local offset, e.g. 2026-11-11T18:30:00+05:30. */
export function isoWithOffset(date: Date): string {
  const off = -date.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  const local = new Date(date.getTime() + off * 60_000).toISOString().slice(0, 19);
  return `${local}${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/** Push rows for every ONU seen. Levels are sent only for a running ONU, with their unit. */
export function onuRows(onus: Iterable<OnuValues>, polledAt: Date, encoding: RxEncoding = 'signed16'): PushRow[] {
  const deviceTime = isoWithOffset(polledAt);
  const rows: PushRow[] = [];
  for (const o of onus) {
    const state = onuState(o.status, o.reason);
    const statusName = o.status === undefined ? 'no status' : (ONU_STATUS_NAMES[o.status] ?? `status ${o.status}`);
    const reasonName =
      o.reason === undefined || o.reason === 1 ? '' : ` (${DEACTIVE_REASON_NAMES[o.reason] ?? `reason ${o.reason}`})`;
    const serial = decodeSerial(o.serial);
    const ontRx = state === 'online' ? decodeTenthDbm(o.rx, encoding) : undefined;
    const oltRx = state === 'online' ? decodeTenthDbm(o.oltRx, encoding) : undefined;
    rows.push({
      onuAddress: DASAN_V5808.onuAddress(o.oltId, o.onuId),
      ...(serial ? { serial } : {}),
      deviceTime,
      state,
      rawState: `${statusName}${reasonName}`.slice(0, 40),
      ...(ontRx !== undefined ? { ontRxDbm: ontRx } : {}),
      ...(oltRx !== undefined ? { oltRxDbm: oltRx } : {}),
      ...(ontRx !== undefined || oltRx !== undefined ? { unit: 'dBm' as const } : {}),
    });
  }
  return rows;
}

/** PON port rows: the OLT's own port status and ONU counts. Never worked out from the ONUs. */
export function ponPortRows(
  ports: Iterable<{ oltId: number; status?: number; active?: number; inactive?: number }>,
  polledAt: Date,
  olt: { oltIp?: string; oltId?: string },
): PushDeviceRow[] {
  const deviceTime = isoWithOffset(polledAt);
  const rows: PushDeviceRow[] = [];
  for (const p of ports) {
    if (p.status === undefined) continue;
    const state = p.status === 3 ? 'up' : p.status === 0 || p.status === 2 ? 'down' : 'unknown';
    rows.push({
      target: 'pon_port',
      ...olt,
      portAddress: DASAN_V5808.ponAddress(p.oltId),
      deviceTime,
      state,
      rawState: OLT_STATUS_NAMES[p.status] ?? `status ${p.status}`,
      ...(p.active !== undefined ? { onuOnline: p.active } : {}),
      ...(p.active !== undefined && p.inactive !== undefined ? { onuTotal: p.active + p.inactive } : {}),
    });
  }
  return rows;
}
