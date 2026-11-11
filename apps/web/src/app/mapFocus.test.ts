import { describe, expect, it } from 'vitest';

import { SAMPLE_CABLES, SAMPLE_CUSTOMERS, SAMPLE_EQUIPMENT, SAMPLE_FAULTS } from '@fibergis/shared/sample';

import { boundsFor, focusFor, POINT_FOCUS_ZOOM, ROUTE_FOCUS_ZOOM } from './mapFocus';

describe('boundsFor', () => {
  it('fits a whole route, and nothing for points or a route of under two points', () => {
    const cable = { ...SAMPLE_CABLES[0], coordinates: [[1, 5], [3, 2], [2, 4]] as [number, number][] };
    expect(boundsFor({ type: 'cable', data: cable })).toEqual({ south: 1, west: 2, north: 3, east: 5 });
    expect(boundsFor({ type: 'cable', data: { ...cable, coordinates: [[1, 1]] } })).toBeNull();
    expect(boundsFor({ type: 'equipment', data: SAMPLE_EQUIPMENT[0] })).toBeNull();
  });
});

describe('focusFor', () => {
  it('centres on equipment and customers at street zoom', () => {
    const eq = SAMPLE_EQUIPMENT[0];
    const cust = SAMPLE_CUSTOMERS[0];
    expect(focusFor({ type: 'equipment', data: eq })).toEqual({ lat: eq.lat, lng: eq.lng, zoom: POINT_FOCUS_ZOOM });
    expect(focusFor({ type: 'customer', data: cust })).toEqual({
      lat: cust.lat,
      lng: cust.lng,
      zoom: POINT_FOCUS_ZOOM,
    });
  });

  it('centres on the affected location of a fault', () => {
    const fault = SAMPLE_FAULTS[0];
    expect(focusFor({ type: 'fault', data: fault })).toEqual({ ...fault.affectedLocation, zoom: POINT_FOCUS_ZOOM });
  });

  it('centres on the middle vertex of a cable route', () => {
    const cable = {
      ...SAMPLE_CABLES[0],
      coordinates: [
        [1, 1],
        [2, 2],
        [3, 3],
      ] as [number, number][],
    };
    expect(focusFor({ type: 'cable', data: cable })).toEqual({ lat: 2, lng: 2, zoom: ROUTE_FOCUS_ZOOM });
  });

  it('returns null for a cable without a route', () => {
    expect(focusFor({ type: 'cable', data: { ...SAMPLE_CABLES[0], coordinates: [] } })).toBeNull();
  });
});
