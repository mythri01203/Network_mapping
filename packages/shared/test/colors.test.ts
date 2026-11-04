import { describe, expect, it } from 'vitest';

import { getFiberColor, getTubeColor, getTubeNumber, STANDARD_12_COLORS } from '../src/fiber/colors';

describe('TIA-598 fiber colours', () => {
  it('defines 12 colours in standard order', () => {
    expect(STANDARD_12_COLORS).toHaveLength(12);
    expect(STANDARD_12_COLORS[0].name).toBe('Blue');
    expect(STANDARD_12_COLORS[11].name).toBe('Aqua');
  });

  it('cycles fibre colours every 12 cores', () => {
    expect(getFiberColor(1).name).toBe('Blue');
    expect(getFiberColor(12).name).toBe('Aqua');
    expect(getFiberColor(13).name).toBe('Blue');
    expect(getFiberColor(14).name).toBe('Orange');
  });

  it('groups cores into tubes of 12', () => {
    expect(getTubeNumber(1)).toBe(1);
    expect(getTubeNumber(12)).toBe(1);
    expect(getTubeNumber(13)).toBe(2);
    expect(getTubeColor(2).name).toBe('Orange');
  });
});
