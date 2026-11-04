import { describe, expect, it } from 'vitest';

import { classifyRxPower, opticalPowerFor } from '../src/domain/opticalPower';
import { RX_SENSITIVITY_DBM, RX_WARNING_DBM } from '../src/domain/trace';
import type { PonPort } from '../src/model/types';
import { equipment } from './fixtures';

const port = (id: string, changes: Partial<PonPort>): PonPort => ({
  id,
  portNumber: Number(id.replace(/\D/g, '')) || 1,
  status: 'Active',
  connectedCustomersCount: 0,
  ...changes,
});

describe('classifyRxPower', () => {
  it('classifies against warning and critical thresholds', () => {
    expect(classifyRxPower(-18, -24, -27)).toBe('Normal');
    expect(classifyRxPower(-24.5, -24, -27)).toBe('Warning');
    expect(classifyRxPower(-27.5, -24, -27)).toBe('Critical');
  });

  it('treats a reading exactly at a threshold as within it, like budgetStatusFor', () => {
    expect(classifyRxPower(RX_WARNING_DBM)).toBe('Normal');
    expect(classifyRxPower(RX_SENSITIVITY_DBM)).toBe('Warning');
  });

  it('reports Unavailable for non-numeric readings', () => {
    expect(classifyRxPower(Number.NaN)).toBe('Unavailable');
  });
});

describe('opticalPowerFor', () => {
  it('reports Unavailable without inventing readings for non-OLT equipment', () => {
    const info = opticalPowerFor(equipment({ id: 'FAT-01', type: 'FAT' }));
    expect(info.signalLevel).toBe('Unavailable');
    expect(info.txPowerDbm).toBeUndefined();
    expect(info.rxPowerDbm).toBeUndefined();
    expect(info.history).toEqual([]);
  });

  it('reports Unavailable for an OLT whose ports have no readings', () => {
    const info = opticalPowerFor(equipment({ id: 'OLT-01', type: 'OLT', ponPorts: [port('PON-1', {})] }));
    expect(info.signalLevel).toBe('Unavailable');
    expect(info.txPowerDbm).toBeUndefined();
    expect(info.lastUpdated).toBeUndefined();
  });

  it('summarises OLT port readings as average Tx and worst Rx', () => {
    const olt = equipment({
      id: 'OLT-01',
      type: 'OLT',
      ponPorts: [
        port('PON-1', { txPowerDbm: 3, rxPowerDbm: -18, lastUpdated: '2024-01-01T10:00:00Z' }),
        port('PON-2', { txPowerDbm: 4, rxPowerDbm: -26, lastUpdated: '2024-01-02T10:00:00Z' }),
        port('PON-3', {}),
      ],
    });
    const info = opticalPowerFor(olt);
    expect(info.txPowerDbm).toBe(3.5);
    expect(info.rxPowerDbm).toBe(-26);
    expect(info.signalLevel).toBe('Warning');
    expect(info.rxWarnDbm).toBe(RX_WARNING_DBM);
    expect(info.rxCriticalDbm).toBe(RX_SENSITIVITY_DBM);
    expect(info.lastUpdated).toBe('2024-01-02T10:00:00Z');
    expect(info.history).toEqual([]);
  });

  it('prefers a stored reading', () => {
    const stored = { ...opticalPowerFor(equipment({ id: 'OLT-02', type: 'OLT' })), txPowerDbm: 5 };
    expect(opticalPowerFor(equipment({ id: 'OLT-02', type: 'OLT', opticalPower: stored }))).toBe(stored);
  });
});
