import type { Cable, Customer, SlackLoop } from '../model/types';
import { isActiveCustomer } from './connectionRules';
import { buildFiberIndex, type FiberData, type FiberIndex } from './fiberIndex';
import { traceCustomerCores } from './fiberPath';
import { DEFAULT_OPTICAL_SETTINGS, type OpticalSettings } from './opticalSettings';
import { DEFAULT_OSP_SETTINGS, type OspSettings } from './ospSettings';
import { type CableLengths, cableLengths, type LengthFlagCode } from './outsidePlant';
import { rxReadingOf } from './rxReading';

/**
 * Reconciliation: what the records predict against what was measured. Predicted Rx comes from the
 * recorded fiber path (`traceCustomerCores`) and is always a calculation; only a meter or device
 * reading counts as measured. The expected value needs the PON port's real launch power, otherwise
 * it is a range from the class. Lengths compare the drawn line, the sheath marks and the OTDR.
 * Every result ends in a plain next action. Limits are settings with their source.
 */

export type RxCheckStatus = 'no_reading' | 'not_measured' | 'no_path' | 'matches' | 'weaker' | 'stronger' | 'unclear';

export interface RxReconciliation {
  customerId: string;
  customerName: string;
  status: RxCheckStatus;
  /** Only a real meter or device reading. */
  measuredDbm?: number;
  measuredAt?: string;
  /** Calculated from the recorded path and the port's recorded launch power. */
  expectedDbm?: number;
  /** Calculated from the class launch range, when the port's launch power is not recorded. */
  expectedRangeDbm?: { min: number; max: number };
  basis?: 'port_tx' | 'class_range';
  /** Measured minus expected; with a range, the distance outside it. */
  gapDb?: number;
  /** One plain sentence about what was compared. */
  finding: string;
  nextAction: string;
  flagged: boolean;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function reconcileCustomerRx(customer: Customer, data: FiberData, settings: OpticalSettings = DEFAULT_OPTICAL_SETTINGS, index?: FiberIndex): RxReconciliation {
  const base = { customerId: customer.id, customerName: customer.name };
  const reading = rxReadingOf(customer, settings);
  if (reading.valueDbm === undefined) {
    return { ...base, status: 'no_reading', flagged: false, finding: 'No light reading is recorded.', nextAction: 'Take a reading at the ONT with the light meter.' };
  }
  if (!reading.isMeasured) {
    return {
      ...base,
      status: 'not_measured',
      flagged: false,
      finding: `Only a ${reading.originLabel.toLowerCase()} value is recorded (${reading.valueDbm.toFixed(1)} dBm); it is not a reading.`,
      nextAction: 'Take a reading at the ONT with the light meter.',
    };
  }
  const measured = reading.valueDbm;
  const withReading = { ...base, measuredDbm: measured, ...(reading.measuredAt ? { measuredAt: reading.measuredAt } : {}) };
  const path = traceCustomerCores(customer, data, { settings, index });
  const down = path.directions.find((d) => d.direction === 'downstream');
  if (!path.complete || !down) {
    return {
      ...withReading,
      status: 'no_path',
      flagged: false,
      finding: `Measured ${measured.toFixed(1)} dBm, but the fiber path is not recorded end to end, so nothing can be predicted.`,
      nextAction: `Record the missing link first: ${path.gaps[0] ?? 'the path does not reach a PON port'}`,
    };
  }
  const weaker = settings.measuredGapDb;
  const stronger = settings.measuredStrongGapDb;
  const box = path.steps.find((s) => s.kind === 'splitter');
  const atBox = box ? ` (${box.title})` : '';
  const weakAction = `Clean and check the connector at the box${atBox}, then look for a tight bend in the drop. If it stays low, check the fiber path is the one recorded.`;
  const strongAction = `Check the splitter in the box is the ratio recorded${atBox}, and that the drop is on the recorded output. A missing splitter gives far more light.`;

  if (down.budget.expectedRxDbm !== undefined) {
    const expected = down.budget.expectedRxDbm;
    const gap = round1(measured - expected);
    const common = { ...withReading, expectedDbm: expected, basis: 'port_tx' as const, gapDb: gap };
    if (gap < -weaker) return { ...common, status: 'weaker', flagged: true, finding: `Measured ${measured.toFixed(1)} dBm is ${Math.abs(gap).toFixed(1)} dB below the ${expected.toFixed(1)} dBm the records predict (limit ${weaker} dB).`, nextAction: weakAction };
    if (gap > stronger) return { ...common, status: 'stronger', flagged: true, finding: `Measured ${measured.toFixed(1)} dBm is ${gap.toFixed(1)} dB above the ${expected.toFixed(1)} dBm the records predict (limit ${stronger} dB).`, nextAction: strongAction };
    return { ...common, status: 'matches', flagged: false, finding: `Measured ${measured.toFixed(1)} dBm is within ${Math.max(weaker, stronger)} dB of the ${expected.toFixed(1)} dBm the records predict.`, nextAction: 'No action needed.' };
  }
  const range = down.budget.expectedRxRangeDbm;
  const ponName = path.pon ? `${path.olt?.name ?? ''} ${path.pon.id}`.trim() : 'the PON port';
  if (!range) {
    return {
      ...withReading,
      status: 'unclear',
      flagged: false,
      finding: `Measured ${measured.toFixed(1)} dBm. The port's launch power is not recorded and its class gives no launch range, so nothing can be predicted.`,
      nextAction: `Record the real launch power (Tx) of ${ponName} from the OLT.`,
    };
  }
  const common = { ...withReading, expectedRangeDbm: range, basis: 'class_range' as const };
  const rangeText = `${range.min.toFixed(1)} to ${range.max.toFixed(1)} dBm`;
  if (measured < range.min - weaker) {
    const gap = round1(measured - range.min);
    return { ...common, gapDb: gap, status: 'weaker', flagged: true, finding: `Measured ${measured.toFixed(1)} dBm is ${Math.abs(gap).toFixed(1)} dB below even the weakest launch allowed (${rangeText} expected).`, nextAction: weakAction };
  }
  if (measured > range.max + stronger) {
    const gap = round1(measured - range.max);
    return { ...common, gapDb: gap, status: 'stronger', flagged: true, finding: `Measured ${measured.toFixed(1)} dBm is ${gap.toFixed(1)} dB above even the strongest launch allowed (${rangeText} expected).`, nextAction: strongAction };
  }
  return {
    ...common,
    status: 'unclear',
    flagged: false,
    finding: `Measured ${measured.toFixed(1)} dBm. Without the port's real launch power the records only give ${rangeText}, which is too wide to judge a ${weaker} dB gap.`,
    nextAction: `Record the real launch power (Tx) of ${ponName} from the OLT to compare.`,
  };
}

export interface LengthReconciliation {
  cableId: string;
  cableName: string;
  lengths: CableLengths;
  /** What can be compared, in plain words. */
  finding: string;
  flags: { code: LengthFlagCode; message: string; nextAction: string }[];
  flagged: boolean;
}

const LENGTH_ACTIONS: Record<LengthFlagCode, string> = {
  optical_short: 'Check the OTDR test was on this cable and fiber, then look for a break or a splice that is not recorded.',
  optical_long: 'Record the slack loops on this route, or check for a detour the drawing does not show.',
  drawn_vs_sheath: 'Read the length marks at both ends again, and record slack, risers and corners on the route.',
};

export function reconcileCableLength(cable: Cable, slackLoops: readonly SlackLoop[] = [], settings: OspSettings = DEFAULT_OSP_SETTINGS): LengthReconciliation {
  const lengths = cableLengths(cable, slackLoops, settings);
  const have = [lengths.drawnMeters !== undefined && 'drawn', lengths.sheathMeters !== undefined && 'sheath', lengths.opticalMeters !== undefined && 'optical'].filter(Boolean) as string[];
  const finding =
    have.length < 2
      ? have.length === 0
        ? 'No length is recorded.'
        : `Only the ${have[0]} length is recorded, so there is nothing to compare.`
      : lengths.flags.length === 0
        ? `The ${have.join(', ')} lengths agree within the settings.`
        : `The ${have.join(', ')} lengths disagree.`;
  const flags = lengths.flags.map((f) => ({ ...f, nextAction: LENGTH_ACTIONS[f.code] }));
  return { cableId: cable.id, cableName: cable.name, lengths, finding, flags, flagged: flags.length > 0 };
}

export interface NetworkReconciliation {
  rx: RxReconciliation[];
  lengths: LengthReconciliation[];
}

/** Every active customer's reading check and every cable's length check. */
export function reconcileNetwork(
  data: FiberData & { slackLoops?: readonly SlackLoop[] },
  optical: OpticalSettings = DEFAULT_OPTICAL_SETTINGS,
  osp: OspSettings = DEFAULT_OSP_SETTINGS,
): NetworkReconciliation {
  const index = buildFiberIndex(data);
  return {
    rx: data.customers.filter(isActiveCustomer).map((c) => reconcileCustomerRx(c, data, optical, index)),
    lengths: data.cables.map((c) => reconcileCableLength(c, data.slackLoops ?? [], osp)),
  };
}
