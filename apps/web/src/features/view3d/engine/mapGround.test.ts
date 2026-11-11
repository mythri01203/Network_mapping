import { describe, expect, it } from 'vitest';

import { tilePlan, tileUrl } from './mapGround';

const ORIGIN = { lat: 12.9402, lng: 77.6307 };

describe('street map tiles under the 3D view', () => {
  it('covers the area around the network with the most detailed zoom that fits', () => {
    const plan = tilePlan(ORIGIN, { x: 0, z: 0 }, 200, 18)!;
    expect(plan.z).toBe(18);
    expect(plan.nx).toBeLessThanOrEqual(12);
    // The tile block contains the requested square (x east, z south).
    expect(plan.nw.x).toBeLessThanOrEqual(-200);
    expect(plan.nw.z).toBeLessThanOrEqual(-200);
    expect(plan.se.x).toBeGreaterThanOrEqual(200);
    expect(plan.se.z).toBeGreaterThanOrEqual(200);
    // One z18 tile is about 149 m across at 12.9° N.
    expect((plan.se.x - plan.nw.x) / plan.nx).toBeCloseTo(148.8, 0);
  });

  it('drops a zoom level for a bigger network instead of loading hundreds of tiles', () => {
    const plan = tilePlan(ORIGIN, { x: 0, z: 0 }, 2000, 18)!;
    expect(plan.z).toBeLessThan(18);
    expect(plan.nx * plan.ny).toBeLessThanOrEqual(144);
  });

  it('has no map for a network with no position', () => {
    expect(tilePlan({ lat: 0, lng: 0 }, { x: 0, z: 0 }, 100, 18)).toBeNull();
  });

  it('fills in the tile address', () => {
    const url = tileUrl(
      { url: 'https://{s}.t/{z}/{x}/{y}', subdomains: ['a', 'b'], maxZoom: 19, attribution: '' },
      3,
      4,
      5,
    );
    expect(url).toBe('https://b.t/5/3/4');
  });
});
