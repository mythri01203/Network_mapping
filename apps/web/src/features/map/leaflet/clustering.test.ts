import { describe, expect, it } from 'vitest';

import { buildPointIndex, CLUSTER_MAX_ZOOM, CLUSTER_MIN_POINTS, lineTouchesBox, padBox, pointsInView } from './clustering';

/** A square of n×n pins about 10 m apart near Hyderabad. */
function grid(n: number) {
  const points = [];
  for (let i = 0; i < n; i += 1) for (let j = 0; j < n; j += 1) points.push({ id: `P${i}-${j}`, lat: 17.4 + i * 0.0001, lng: 78.4 + j * 0.0001 });
  return points;
}

const WIDE = [78, 17, 79, 18] as [number, number, number, number];

describe('map clustering (Phase 9)', () => {
  it('draws few pins one by one at any zoom', () => {
    const index = buildPointIndex(grid(5));
    const view = pointsInView(index, WIDE, 10);
    expect(view.groups).toEqual([]);
    expect(view.singles).toHaveLength(25);
  });

  it('groups many pins and the counts add up to every pin, none hidden', () => {
    const points = grid(40);
    expect(points.length).toBeGreaterThan(CLUSTER_MIN_POINTS);
    const view = pointsInView(buildPointIndex(points), WIDE, 12);
    expect(view.groups.length).toBeGreaterThan(0);
    const total = view.singles.length + view.groups.reduce((sum, g) => sum + g.count, 0);
    expect(total).toBe(points.length);
    expect(view.groups.every((g) => g.expansionZoom > 12 && g.expansionZoom <= CLUSTER_MAX_ZOOM)).toBe(true);
  });

  it('draws every pin at street zoom, and only those in view', () => {
    const points = [...grid(40), { id: 'FAR', lat: 12.9, lng: 77.6 }];
    const view = pointsInView(buildPointIndex(points), WIDE, CLUSTER_MAX_ZOOM);
    expect(view.groups).toEqual([]);
    expect(view.singles).toHaveLength(1600);
    expect(view.singles).not.toContain('FAR');
  });

  it('always draws the pin being worked on, even inside a group or out of view', () => {
    const points = [...grid(40), { id: 'FAR', lat: 12.9, lng: 77.6 }];
    const view = pointsInView(buildPointIndex(points), WIDE, 12, new Set(['P3-3', 'FAR', 'GONE']));
    expect(view.singles).toEqual(expect.arrayContaining(['P3-3', 'FAR']));
    expect(view.singles).not.toContain('GONE');
  });

  it('finds cables through the view and pads the view', () => {
    expect(lineTouchesBox([[17.5, 77], [17.5, 80]], WIDE)).toBe(true);
    expect(lineTouchesBox([[12, 77], [12.1, 77.1]], WIDE)).toBe(false);
    expect(padBox([0, 0, 2, 2])).toEqual([-1, -1, 3, 3]);
  });
});
