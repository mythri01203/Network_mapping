import { describe, expect, it } from 'vitest';
import { polylineLengthMeters } from '../src/domain/geo';

describe('polylineLengthMeters', () => {
  it('returns 0 for fewer than two points', () => {
    expect(polylineLengthMeters([])).toBe(0);
    expect(polylineLengthMeters([[17.4, 78.4]])).toBe(0);
  });

  it('measures one degree of latitude as ~111.2 km', () => {
    expect(
      polylineLengthMeters([
        [0, 0],
        [1, 0],
      ]),
    ).toBeCloseTo(111_195, -1);
  });

  it('sums every segment', () => {
    const leg = polylineLengthMeters([
      [0, 0],
      [0, 1],
    ]);
    expect(
      polylineLengthMeters([
        [0, 0],
        [0, 1],
        [0, 2],
      ]),
    ).toBeCloseTo(leg * 2, 6);
  });
});
