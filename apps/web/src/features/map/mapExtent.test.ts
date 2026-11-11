import { describe, expect, it } from 'vitest';

import { SAMPLE_CABLES, SAMPLE_CUSTOMERS, SAMPLE_EQUIPMENT } from '@fibergis/shared/sample';

import { networkExtent } from './mapExtent';
import { niceScaleMeters } from './mapScale';

describe('networkExtent', () => {
  it('is null when nothing has a place yet', () => {
    expect(networkExtent({ equipment: [], cables: [], customers: [] })).toBeNull();
  });

  it('covers placed pins and routes, and leaves out 0,0 and pins the office must place', () => {
    const [a, b] = SAMPLE_EQUIPMENT;
    const unplaced = { ...b, id: 'CAP-1', lat: 40, lng: 10, officeMustPlace: true };
    const notRecorded = { ...b, id: 'CAP-2', lat: 0, lng: 0 };
    const extent = networkExtent({
      equipment: [a, unplaced, notRecorded],
      cables: [{ ...SAMPLE_CABLES[0], coordinates: [[a.lat + 0.01, a.lng + 0.02]] }],
      customers: [{ ...SAMPLE_CUSTOMERS[0], lat: 0, lng: 0 }],
    });
    expect(extent).toEqual({ south: a.lat, west: a.lng, north: a.lat + 0.01, east: a.lng + 0.02 });
  });
});

describe('scale bar', () => {
  it('picks a round length that fits', () => {
    expect(niceScaleMeters(137)).toBe(100);
    expect(niceScaleMeters(260)).toBe(200);
    expect(niceScaleMeters(5400)).toBe(5000);
    expect(niceScaleMeters(0)).toBe(0);
  });
});
