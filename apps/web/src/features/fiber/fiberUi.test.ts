import { describe, expect, it } from 'vitest';

import { fiberOf, hostsClosure, hostsSplitters, parsePartsText } from './fiberUi';

describe('fiber screen helpers', () => {
  it('keeps vendor address levels in the order and words typed', () => {
    expect(parsePartsText('Frame 0, Slot 5, Port 0')).toEqual([
      { label: 'Frame', value: '0' },
      { label: 'Slot', value: '5' },
      { label: 'Port', value: '0' },
    ]);
    expect(parsePartsText('7')).toEqual([{ label: 'Level', value: '7' }]);
    expect(parsePartsText('')).toEqual([]);
  });

  it('chooses no fiber until both cable and number are given', () => {
    expect(fiberOf({ cableId: '', core: '3' })).toBeNull();
    expect(fiberOf({ cableId: 'C', core: '' })).toBeNull();
    expect(fiberOf({ cableId: 'C', core: '3' })).toEqual({ cableId: 'C', core: 3 });
  });

  it('offers closures and splitters only where fibers are joined or split', () => {
    expect(hostsClosure('Fiber Joint Closure')).toBe(true);
    expect(hostsClosure('Telecom Pole')).toBe(false);
    expect(hostsSplitters('FAT')).toBe(true);
    expect(hostsSplitters('OLT')).toBe(false);
  });
});
