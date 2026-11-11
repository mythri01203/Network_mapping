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

describe('area, bounds and screen scale (Phase 1)', () => {
  it('works out the area of a closed ring, whichever way it is drawn', async () => {
    const { polygonAreaSqMeters } = await import('../src/domain/geo');
    // About 111 m x 111 m near the equator: close to 12 300 m².
    const square: [number, number][] = [
      [0, 0],
      [0, 0.001],
      [0.001, 0.001],
      [0.001, 0],
    ];
    const area = polygonAreaSqMeters(square);
    expect(area).toBeGreaterThan(12_000);
    expect(area).toBeLessThan(12_600);
    expect(polygonAreaSqMeters([...square].reverse())).toBeCloseTo(area, 6);
    expect(polygonAreaSqMeters(square.slice(0, 2))).toBe(0);
  });

  it('gives the box around points, or null for none', async () => {
    const { boundsOf } = await import('../src/domain/geo');
    expect(boundsOf([])).toBeNull();
    expect(
      boundsOf([
        [12.9, 77.6],
        [12.95, 77.5],
        [12.92, 77.7],
      ]),
    ).toEqual({ south: 12.9, west: 77.5, north: 12.95, east: 77.7 });
  });

  it('halves the ground per pixel with each zoom level', async () => {
    const { metersPerPixel } = await import('../src/domain/geo');
    expect(metersPerPixel(0, 0)).toBeCloseTo(156_543, 0);
    expect(metersPerPixel(12.97, 17) / metersPerPixel(12.97, 18)).toBeCloseTo(2, 9);
  });
});
