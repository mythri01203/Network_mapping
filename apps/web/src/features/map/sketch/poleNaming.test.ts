import { describe, expect, it } from 'vitest';

import { nextPoleName } from './poleNaming';

describe('nextPoleName', () => {
  it('starts at Pole-01', () => {
    expect(nextPoleName([])).toBe('Pole-01');
    expect(nextPoleName([{ name: 'OLT-Main' }])).toBe('Pole-01');
  });

  it('continues after the highest existing number, even with gaps', () => {
    expect(nextPoleName([{ name: 'Pole-01' }, { name: 'Pole-07' }, { name: 'Pole-03' }])).toBe('Pole-08');
  });

  it('ignores names that merely contain the word pole', () => {
    expect(nextPoleName([{ name: 'Pole-Mounted FAT' }, { name: 'Pole-02 spare' }])).toBe('Pole-01');
  });

  it('grows past two digits', () => {
    expect(nextPoleName([{ name: 'Pole-99' }])).toBe('Pole-100');
  });
});
