import { afterEach, describe, expect, it, vi } from 'vitest';
import { estimateRoadRoute, fetchRoadRoute } from './routing';

const origin = { id: 'A', name: 'Hub', lat: 12.97, lng: 77.59 };
const stop = { id: 'B', name: 'FAT-1', lat: 12.98, lng: 77.6 };
const extra = { id: 'C', name: 'FAT-2', lat: 12.99, lng: 77.61 };

afterEach(() => vi.unstubAllGlobals());

describe('estimateRoadRoute', () => {
  it('builds an L-shaped path through every stop', () => {
    const route = estimateRoadRoute([origin, stop, extra]);
    expect(route.source).toBe('estimate');
    expect(route.coordinates[0]).toEqual([origin.lat, origin.lng]);
    expect(route.coordinates[1]).toEqual([origin.lat, stop.lng]);
    expect(route.coordinates.at(-1)).toEqual([extra.lat, extra.lng]);
    expect(route.coordinates).toHaveLength(5);
    expect(route.steps[0]).toBe('Depart from Hub');
    expect(route.steps.at(-1)).toBe('Arrive at FAT-2');
  });

  it('inflates straight-line distance for roads and assumes city riding speed', () => {
    const route = estimateRoadRoute([origin, stop]);
    // ~1.53 km straight line between the two points.
    expect(route.distanceMeters).toBeGreaterThan(1900);
    expect(route.distanceMeters).toBeLessThan(2100);
    expect(route.durationSeconds).toBeCloseTo(route.distanceMeters / (30_000 / 3600), -1);
  });
});

describe('fetchRoadRoute', () => {
  it('maps an OSRM response to lat/lng and readable steps', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({
        routes: [
          {
            distance: 1234,
            duration: 200,
            geometry: {
              coordinates: [
                [77.59, 12.97],
                [77.6, 12.98],
              ],
            },
            legs: [
              {
                steps: [
                  { name: 'MG Road', maneuver: { type: 'depart' } },
                  { name: 'Brigade Road', maneuver: { type: 'turn', modifier: 'left' } },
                  { maneuver: { type: 'arrive' } },
                ],
              },
            ],
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const route = await fetchRoadRoute([origin, stop]);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/route/v1/driving/77.59,12.97;77.6,12.98');
    expect(route).toEqual({
      coordinates: [
        [12.97, 77.59],
        [12.98, 77.6],
      ],
      distanceMeters: 1234,
      durationSeconds: 200,
      steps: ['Depart onto MG Road', 'Turn left onto Brigade Road', 'Arrive at stop'],
      source: 'road',
    });
  });

  it('uses the trip service for multiple destinations', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ trips: [] }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchRoadRoute([origin, stop, extra])).toBeNull();
    expect(String(fetchMock.mock.calls[0][0])).toContain('/trip/v1/driving/');
  });

  it('resolves to null on network errors and bad responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new Error('offline'))),
    );
    expect(await fetchRoadRoute([origin, stop])).toBeNull();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 500 })),
    );
    expect(await fetchRoadRoute([origin, stop])).toBeNull();
    expect(await fetchRoadRoute([origin])).toBeNull();
  });
});
