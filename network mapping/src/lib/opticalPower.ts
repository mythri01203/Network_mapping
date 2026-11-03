import { Equipment, OpticalPowerInfo } from '../types/network';

function classifyRx(rx: number, warn: number, critical: number): OpticalPowerInfo['signalLevel'] {
  if (rx <= critical) return 'Critical';
  if (rx <= warn) return 'Warning';
  return 'Normal';
}

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
      history: []
    };
  }

  const tx = eq.ponPorts?.[0]?.txPowerDbm ?? 3.2;
  const rx = eq.ponPorts?.[0]?.rxPowerDbm ?? -18.6;
  const history: OpticalPowerInfo['history'] = Array.from({ length: 12 }, (_, i) => ({
    timestamp: `${String(8 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 === 0 ? '00' : '30'}`,
    txPowerDbm: +(tx + Math.sin(i / 2) * 0.15).toFixed(2),
    rxPowerDbm: +(rx + Math.cos(i / 3) * 0.4).toFixed(2)
  }));

  return {
    dataSource: 'simulated_sample',
    lastUpdated: '2026-11-02 09:40 IST',
    txPowerDbm: tx,
    rxPowerDbm: rx,
    signalLevel: classifyRx(rx, rxWarn, rxCritical),
    txMinDbm: txMin,
    txMaxDbm: txMax,
    rxMinDbm: rxMin,
    rxWarnDbm: rxWarn,
    rxCriticalDbm: rxCritical,
    history
  };
}

export function powerStatusColor(level: OpticalPowerInfo['signalLevel']) {
  if (level === 'Normal') return 'bg-emerald-500';
  if (level === 'Warning') return 'bg-amber-400';
  if (level === 'Critical') return 'bg-rose-500';
  return 'bg-slate-400';
}
