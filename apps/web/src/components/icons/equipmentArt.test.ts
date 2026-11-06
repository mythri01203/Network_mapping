import { describe, expect, it } from 'vitest';

import { EQUIPMENT_TYPES } from '@fibergis/shared';

import { equipmentArtUrl, equipmentSvg, ILLUSTRATED_TYPES } from './equipmentArt';

describe('equipment illustrations', () => {
  it('covers every equipment type', () => {
    expect([...ILLUSTRATED_TYPES].sort()).toEqual([...EQUIPMENT_TYPES].sort());
  });

  it.each(EQUIPMENT_TYPES)('%s has complete artwork', (type) => {
    const svg = equipmentSvg(type);
    expect(svg).toMatch(/^<svg [^>]*viewBox="0 0 64 64">/);
    expect(svg).toMatch(/<\/svg>$/);
    expect(svg).not.toMatch(/undefined|NaN/);
  });

  it('falls back to a generic device for unknown types', () => {
    expect(equipmentArtUrl('Custom Thing')).toBe(equipmentArtUrl('FAT'));
  });
});
