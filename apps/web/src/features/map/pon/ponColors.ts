/**
 * PON colours on the map follow the TIA-598 fiber order (PON 1 blue, 2 orange, 3 green, …), the
 * sequence every splicer knows. This is only a map colour for the PON; it says nothing about which
 * fiber colour is inside the cable (that comes from the cable's own recorded scheme).
 */
import type { PonSummary } from '@fibergis/shared';

export interface PonColor {
  name: string;
  hex: string;
  /** Text colour that reads on the swatch. */
  ink: string;
}

const TIA_598: PonColor[] = [
  { name: 'Blue', hex: '#1d6fe0', ink: '#ffffff' },
  { name: 'Orange', hex: '#f97316', ink: '#ffffff' },
  { name: 'Green', hex: '#16a34a', ink: '#ffffff' },
  { name: 'Brown', hex: '#92400e', ink: '#ffffff' },
  { name: 'Slate', hex: '#64748b', ink: '#ffffff' },
  { name: 'White', hex: '#e2e8f0', ink: '#0f172a' },
  { name: 'Red', hex: '#dc2626', ink: '#ffffff' },
  { name: 'Black', hex: '#1e293b', ink: '#ffffff' },
  { name: 'Yellow', hex: '#eab308', ink: '#0f172a' },
  { name: 'Violet', hex: '#7c3aed', ink: '#ffffff' },
  { name: 'Rose', hex: '#ec4899', ink: '#ffffff' },
  { name: 'Aqua', hex: '#06b6d4', ink: '#0f172a' },
];

/** Colour of a PON port by its number (1-based), repeating after 12. */
export function ponColor(portNumber: number): PonColor {
  return TIA_598[(((portNumber - 1) % 12) + 12) % 12];
}

export const ponColorOf = (pon: Pick<PonSummary, 'portNumber'> | undefined): PonColor | undefined => (pon ? ponColor(pon.portNumber) : undefined);

/** A cable carrying several PONs (a feeder): drawn as a dark trunk with its PONs named on the label. */
export const TRUNK_COLOR = '#0f2a4a';

/** Colour for a level, using the ONT receive bands (good, little margin, too weak, too strong). */
export function levelTone(dbm: number | undefined, bands: { overloadDbm: number; goodFloorDbm: number; sensitivityDbm: number }): 'good' | 'low' | 'bad' | 'none' {
  if (dbm === undefined) return 'none';
  if (dbm > bands.overloadDbm || dbm < bands.sensitivityDbm) return 'bad';
  return dbm < bands.goodFloorDbm ? 'low' : 'good';
}

export const TONE_COLORS = { good: '#16a34a', low: '#d97706', bad: '#dc2626', none: '#64748b' } as const;

/** Free outputs: plenty, few, none. */
export function capacityTone(free: number, total: number): 'good' | 'low' | 'bad' {
  if (free <= 0) return 'bad';
  return free / Math.max(1, total) < 0.2 ? 'low' : 'good';
}

export const formatDbm = (dbm: number | undefined): string => (dbm === undefined ? 'not calculated' : `${dbm > 0 ? '+' : ''}${dbm.toFixed(1)} dBm`);
