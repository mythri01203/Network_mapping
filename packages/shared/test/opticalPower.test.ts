import { describe, expect, it } from 'vitest';

import { classifyRxPower, simulatedOpticalPower } from '../src/domain/opticalPower';
import { equipment } from './fixtures';

describe('classifyRxPower', () => {
  it('classifies against warning and critical thresholds', () => {
    expect(classifyRxPower(-18, -24, -27)).toBe('Normal');
    expect(classifyRxPower(-24, -24, -27)).toBe('Warning');
    expect(classifyRxPower(-27.5, -24, -27)).toBe('Critical');
  });
});

describe('simulatedOpticalPower', () => {
  it('reports Unavailable for non-OLT equipment', () => {
    expect(simulatedOpticalPower(equipment({ id: 'FAT-01', type: 'FAT' })).signalLevel).toBe('Unavailable');
  });

  it('is deterministic for OLTs', () => {
    const olt = equipment({ id: 'OLT-01', type: 'OLT' });
    const a = simulatedOpticalPower(olt);
    expect(a.history).toHaveLength(12);
    expect(simulatedOpticalPower(olt)).toEqual(a);
  });
});
