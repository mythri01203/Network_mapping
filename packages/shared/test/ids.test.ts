import { describe, expect, it } from 'vitest';
import { cableIdPrefix, equipmentIdPrefix, nextSequentialId, uniqueId } from '../src/domain/ids';

describe('nextSequentialId', () => {
  it('continues after the highest matching id', () => {
    expect(nextSequentialId('FAT-', ['FAT-01', 'FAT-07', 'FAT-03'])).toBe('FAT-08');
  });

  it('starts at 1 when nothing matches and ignores custom ids', () => {
    expect(nextSequentialId('FAT-', ['CUSTOM-FAT', 'OLT-04'])).toBe('FAT-01');
  });

  it('honours padding and escapes regex characters in the prefix', () => {
    expect(nextSequentialId('A.B-', ['A.B-9', 'AXB-50'], 3)).toBe('A.B-010');
  });
});

describe('uniqueId', () => {
  it('prefixes and upper-cases, and does not repeat', () => {
    const a = uniqueId('log');
    const b = uniqueId('log');
    expect(a).toMatch(/^LOG-[A-Z0-9]+-[A-Z0-9]+$/);
    expect(a).not.toBe(b);
  });
});

describe('id prefixes', () => {
  it('maps equipment types to prefixes', () => {
    expect(equipmentIdPrefix('OLT')).toBe('OLT-');
    expect(equipmentIdPrefix('Fiber Terminal Box')).toBe('FAT-');
    expect(equipmentIdPrefix('Telecom Pole')).toBe('POLE-');
    expect(equipmentIdPrefix('Manhole')).toBe('MH-');
    expect(equipmentIdPrefix('Wi-Fi Access Point')).toBe('WI-FI-ACCESS-POINT-');
  });

  it('maps cable types to prefixes', () => {
    expect(cableIdPrefix('Main Feeder Fiber')).toBe('CBL-FEEDER-');
    expect(cableIdPrefix('Drop Fiber')).toBe('DROP-');
    expect(cableIdPrefix('Something else')).toBe('CBL-CUSTOM-');
  });
});
