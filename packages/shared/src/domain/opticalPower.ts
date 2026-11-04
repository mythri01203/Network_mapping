import type { SignalLevel } from '../model/enums';
import type { Equipment, OpticalPowerInfo } from '../model/types';

/** Classifies a received optical power reading against warning/critical thresholds (dBm). */
export function classifyRxPower(rx: number, warn: number, critical: number): SignalLevel {
  if (rx <= critical) return 'Critical';
  if (rx <= warn) return 'Warning';
  return 'Normal';
}

/**
 * Returns the stored optical power reading, or a deterministic simulated sample for demo data.
 * Only OLTs get simulated Tx/Rx values; other equipment reports `Unavailable`.
 */
export function simulatedOpticalPower(eq: Equipment): OpticalPowerInfo {
  if (eq.opticalPower) return eq.opticalPower;

  const txMin = 1.5;
  const txMax = 5.0;
  const rxMin = -8;
  const rxWarn = -24;
  const rxCritical = -27;

  if (eq.type !== 'OLT') {
    return {
      dataSource: 'simulated_sample',
      lastUpdated: '2026-11-02 09:40 IST',
      signalLevel: 'Unavailable',
      txMinDbm: txMin,
      txMaxDbm: txMax,
      rxMinDbm: rxMin,
      rxWarnDbm: rxWarn,
      rxCriticalDbm: rxCritical,
      history: [],
    };
  }

  const tx = eq.ponPorts?.[0]?.txPowerDbm ?? 3.2;
  const rx = eq.ponPorts?.[0]?.rxPowerDbm ?? -18.6;
  const history: OpticalPowerInfo['history'] = Array.from({ length: 12 }, (_, i) => ({
    timestamp: `${String(8 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 === 0 ? '00' : '30'}`,
    txPowerDbm: +(tx + Math.sin(i / 2) * 0.15).toFixed(2),
    rxPowerDbm: +(rx + Math.cos(i / 3) * 0.4).toFixed(2),
  }));

  return {
    dataSource: 'simulated_sample',
    lastUpdated: '2026-11-02 09:40 IST',
    txPowerDbm: tx,
    rxPowerDbm: rx,
    signalLevel: classifyRxPower(rx, rxWarn, rxCritical),
    txMinDbm: txMin,
    txMaxDbm: txMax,
    rxMinDbm: rxMin,
    rxWarnDbm: rxWarn,
    rxCriticalDbm: rxCritical,
    history,
  };
}
