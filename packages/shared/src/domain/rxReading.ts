import type { Customer } from '../model/types';
import { DEFAULT_OPTICAL_SETTINGS, type OpticalSettings, RX_BAND_LABELS, type RxBand, rxBandFor } from './opticalSettings';
import type { BudgetStatus } from './trace';

export type RxOrigin = 'not_recorded' | 'sample' | 'estimated' | 'designed' | 'measured';

export const RX_ORIGIN_LABELS: Record<RxOrigin, string> = {
  not_recorded: 'Not recorded',
  sample: 'Sample data',
  estimated: 'Estimated',
  designed: 'Designed',
  measured: 'Measured',
};

export interface RxReading {
  valueDbm?: number;
  origin: RxOrigin;
  /** "Not recorded", "Estimated", "Designed", "Sample data" or "Measured". */
  originLabel: string;
  /** Ready to show: "-20.1 dBm (Estimated)" or "Not recorded". */
  text: string;
  measuredAt?: string;
  band: RxBand;
  bandLabel: string;
  /** True only for a real meter or device reading. */
  isMeasured: boolean;
}

type RxFields = Pick<Customer, 'rxOpticalPowerDbm' | 'rxSource' | 'rxMeasuredAt' | 'isSampleData'>;

const originOf = (customer: RxFields, value: number | undefined): RxOrigin => {
  if (value === undefined) return 'not_recorded';
  if (customer.isSampleData) return 'sample';
  switch (customer.rxSource) {
    case 'field_measured':
    case 'device_reported':
      return 'measured';
    case 'designed':
      return 'designed';
    default:
      // Calculated, or an older record whose origin nobody stored. Never relabelled Measured.
      return 'estimated';
  }
};

const usableValue = (customer: RxFields): number | undefined => {
  const value = customer.rxOpticalPowerDbm;
  if (value === undefined || value === null || !Number.isFinite(value)) return undefined;
  // Older activations saved exactly 0 when no OLT could be traced. It was never a reading.
  if (value === 0 && !customer.rxSource) return undefined;
  return value;
};

/** How to show a customer's optical reading: its value, where it came from, and which band it is in. */
export function rxReadingOf(customer: RxFields, settings: OpticalSettings = DEFAULT_OPTICAL_SETTINGS): RxReading {
  const valueDbm = usableValue(customer);
  const origin = originOf(customer, valueDbm);
  const originLabel = RX_ORIGIN_LABELS[origin];
  const band = rxBandFor(valueDbm, settings);
  return {
    valueDbm,
    origin,
    originLabel,
    text: valueDbm === undefined ? originLabel : `${valueDbm.toFixed(1)} dBm (${originLabel})`,
    measuredAt: origin === 'measured' ? customer.rxMeasuredAt : undefined,
    band,
    bandLabel: RX_BAND_LABELS[band],
    isMeasured: origin === 'measured',
  };
}

/** Pass, Warning or Fail for a receive level. Too much light is a fault, not a pass. */
export function budgetStatusForBand(band: RxBand): BudgetStatus {
  switch (band) {
    case 'good':
      return 'Pass';
    case 'low_margin':
      return 'Warning';
    case 'bad':
    case 'too_much_light':
      return 'Fail';
    default:
      return 'Unknown';
  }
}
