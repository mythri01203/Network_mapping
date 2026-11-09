import { formatRfBoth, RF_UNIT_LABELS, type RfLevel, type RfPortEstimate, type RfSettings } from '@fibergis/shared';

/** "Estimated: 75.2 dBµV (15.2 dBmV) at 47 MHz · 64.7 dBµV (4.7 dBmV) at 862 MHz", or why not. */
export function estimateText(e: RfPortEstimate | undefined, rf: RfSettings): string {
  if (!e) return 'Not recorded';
  if (e.stop) return `Not estimated: ${e.stop}`;
  if (e.opticalDbm !== undefined) return `Estimated: ${e.opticalDbm.toFixed(1)} dBm light`;
  if (e.low === undefined || e.high === undefined) return 'Not recorded';
  return `Estimated: ${formatRfBoth(e.low)} at ${rf.lowMhz} MHz · ${formatRfBoth(e.high)} at ${rf.highMhz} MHz`;
}

/** The level as entered, in its own unit, then the conversion. Light is shown in dBm only. */
export function levelText(level: Pick<RfLevel, 'value' | 'unit' | 'testPointOffsetDb' | 'frequencyMhz'>, trueDbuv: number | undefined): string {
  const asRead = `${level.value} ${RF_UNIT_LABELS[level.unit]} as read`;
  const tp = level.testPointOffsetDb ? ` at a ${level.testPointOffsetDb} dB test point` : '';
  const at = level.frequencyMhz !== undefined ? ` at ${level.frequencyMhz} MHz` : '';
  if (trueDbuv === undefined) return `${asRead}${at}`;
  return `${asRead}${tp}${at} → ${formatRfBoth(trueDbuv)} at the port`;
}

/** Number from a text box: blank is "not entered", never zero. */
export const numberOrUndefined = (text: string): number | undefined => {
  const t = text.trim().replace(',', '.');
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
};
