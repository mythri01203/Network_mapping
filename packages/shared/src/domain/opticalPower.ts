import type { SignalLevel } from '../model/enums';
import type { Equipment, OpticalPowerInfo } from '../model/types';
import { DEFAULT_OPTICAL_SETTINGS } from './opticalSettings';
import { RX_SENSITIVITY_DBM, RX_WARNING_DBM } from './trace';

/** Class B+/C+ OLT transmitter launch power window (dBm). */
export const OLT_TX_MIN_DBM = DEFAULT_OPTICAL_SETTINGS.classes['GPON B+'].launchMinDbm ?? 1.5;
export const OLT_TX_MAX_DBM = DEFAULT_OPTICAL_SETTINGS.classes['GPON C+'].launchMaxDbm ?? 7;
/** Receiver overload point: anything hotter than this saturates a typical ONT/OLT receiver (dBm). */
export const RX_OVERLOAD_DBM = DEFAULT_OPTICAL_SETTINGS.rx.overloadDbm;

/**
 * Classifies a received optical power reading against warning/critical thresholds (dBm).
 * Matches `budgetStatusFor`: a reading exactly at a threshold is still within it.
 */
export function classifyRxPower(
  rx: number,
  warn: number = RX_WARNING_DBM,
  critical: number = RX_SENSITIVITY_DBM,
): SignalLevel {
  if (!Number.isFinite(rx)) return 'Unavailable';
  if (rx < critical) return 'Critical';
  if (rx < warn) return 'Warning';
  return 'Normal';
}

const isNumber = (value: number | undefined): value is number => typeof value === 'number' && Number.isFinite(value);
const round1 = (value: number) => Math.round(value * 10) / 10;

/**
 * Optical power summary for a piece of equipment. A stored reading wins; otherwise an OLT's summary
 * is derived from its PON port readings (average Tx, worst Rx). Nothing is invented: equipment
 * without readings reports `Unavailable` with no Tx/Rx values and no history.
 */
export function opticalPowerFor(eq: Equipment): OpticalPowerInfo {
  if (eq.opticalPower) return eq.opticalPower;

  const ports = eq.type === 'OLT' ? (eq.ponPorts ?? []) : [];
  const tx = ports.map((p) => p.txPowerDbm).filter(isNumber);
  const rx = ports.map((p) => p.rxPowerDbm).filter(isNumber);
  const updated = ports
    .map((p) => p.lastUpdated)
    .filter((value): value is string => Boolean(value))
    .sort();
  const worstRx = rx.length > 0 ? Math.min(...rx) : undefined;

  return {
    dataSource: 'simulated_sample',
    lastUpdated: updated[updated.length - 1],
    txPowerDbm: tx.length > 0 ? round1(tx.reduce((sum, v) => sum + v, 0) / tx.length) : undefined,
    rxPowerDbm: worstRx,
    signalLevel: worstRx === undefined ? 'Unavailable' : classifyRxPower(worstRx),
    txMinDbm: OLT_TX_MIN_DBM,
    txMaxDbm: OLT_TX_MAX_DBM,
    rxMinDbm: RX_OVERLOAD_DBM,
    rxWarnDbm: RX_WARNING_DBM,
    rxCriticalDbm: RX_SENSITIVITY_DBM,
    history: [],
  };
}
