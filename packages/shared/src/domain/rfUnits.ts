import type { RfLevel, RfLevelUnit } from '../model/rfSchemas';

/**
 * RF level units (Phase 6). The only true constant in this area: dBµV = dBmV + 60. Indian meters
 * read dBµV and DOCSIS papers use dBmV, so a value is always stored with its unit and shown in both.
 * dBm on the RF side is the 75 Ω conversion: dBµV = dBm + 108.75 (calculated, not a convention).
 * Optical levels are dBm too, but they are never converted to dBµV: light is not a voltage.
 */

export const DBUV_PER_DBMV = 60;
export const DBUV_PER_DBM_75_OHM = 108.75;

export const RF_UNIT_LABELS: Record<RfLevelUnit, string> = { dBuV: 'dBµV', dBmV: 'dBmV', dBm: 'dBm' };

/** An RF voltage level in dBµV. `undefined` for an optical dBm level, which has no RF meaning. */
export function toDbuv(value: number, unit: RfLevelUnit, signal: 'rf' | 'optical' = 'rf'): number | undefined {
  if (!Number.isFinite(value)) return undefined;
  if (unit === 'dBuV') return value;
  if (unit === 'dBmV') return value + DBUV_PER_DBMV;
  return signal === 'rf' ? value + DBUV_PER_DBM_75_OHM : undefined;
}

export function fromDbuv(dbuv: number, unit: RfLevelUnit): number {
  if (unit === 'dBuV') return dbuv;
  if (unit === 'dBmV') return dbuv - DBUV_PER_DBMV;
  return dbuv - DBUV_PER_DBM_75_OHM;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/** "72.0 dBµV (12.0 dBmV)": both units, so the 60 dB mistake shows on the screen. */
export function formatRfBoth(dbuv: number | undefined): string {
  if (dbuv === undefined || !Number.isFinite(dbuv)) return 'Not recorded';
  return `${round1(dbuv).toFixed(1)} dBµV (${round1(dbuv - DBUV_PER_DBMV).toFixed(1)} dBmV)`;
}

/**
 * The real level at the port, in dBµV, from a recorded RF level: converted to dBµV and corrected for
 * a test point (a reading at a 20 dB test point is 20 dB below the port). `undefined` for optical.
 */
export function trueRfLevelDbuv(level: Pick<RfLevel, 'value' | 'unit' | 'testPointOffsetDb'>, signal: 'rf' | 'optical' = 'rf'): number | undefined {
  const base = toDbuv(level.value, level.unit, signal);
  return base === undefined ? undefined : base + (level.testPointOffsetDb ?? 0);
}

/** The optical level in dBm, or `undefined` when the record is not an optical dBm level. */
export function opticalLevelDbm(level: Pick<RfLevel, 'value' | 'unit'>): number | undefined {
  return level.unit === 'dBm' && Number.isFinite(level.value) ? level.value : undefined;
}

export const RF_ORIGIN_LABELS: Record<RfLevel['origin'], string> = {
  designed: 'Designed',
  calculated: 'Estimated',
  field_measured: 'Measured (meter)',
  device_reported: 'Reported by device',
};
