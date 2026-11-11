import type { LossSource, SpliceRecord, SpliceStatus } from '@fibergis/shared';

/** Plain words for splice fields, shared by the splice screen and the printed report. */

export const NOT_RECORDED = 'Not recorded';

export const LOSS_SOURCE_LABELS: Record<LossSource, string> = {
  field_measured: 'Measured with a meter',
  device_reported: 'OTDR or splicer reading',
  designed: 'Design value',
  calculated: 'Worked out',
};

export const SPLICE_STATUS_WORDS: Record<SpliceStatus, string> = {
  Spliced: 'Done',
  Tested: 'Done and tested',
  Pending: 'Planned, not done',
  Failed: 'Failed',
  Damaged: 'Damaged',
  Unused: 'Not used',
};

/** "0.05 dB (Measured with a meter)", or "Not recorded". Never a default loss. */
export const lossWords = (s: Pick<SpliceRecord, 'spliceLossDb' | 'lossSource'>): string =>
  s.spliceLossDb === undefined ? `Loss ${NOT_RECORDED.toLowerCase()}` : `${s.spliceLossDb} dB (${s.lossSource ? LOSS_SOURCE_LABELS[s.lossSource] : 'origin not recorded'})`;

/** "Tray 1, cassette A, position 4", with "Not recorded" for what is missing. */
export const placeWords = (trayLabel: string | undefined, cassette?: string, position?: number): string =>
  [trayLabel ?? 'Tray not recorded', cassette ? `cassette ${cassette}` : undefined, position !== undefined ? `position ${position}` : undefined].filter(Boolean).join(', ');

/** When an item left service, and why: entered by mistake is said in words, not only by colour. */
export const historyWords = (item: { retiredAt?: string; retiredBy?: string; retiredReason?: string; enteredInError?: boolean }): string =>
  `${item.enteredInError ? 'Entered by mistake, struck out' : 'Out of service'} ${item.retiredAt?.slice(0, 10) ?? 'date not recorded'}${item.retiredBy ? ` by ${item.retiredBy}` : ''}${item.retiredReason ? `. Reason: ${item.retiredReason}` : ''}`;
