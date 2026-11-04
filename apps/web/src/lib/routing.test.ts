import type { RouteResponse } from '@fibergis/shared';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '../api/client';
import { estimateRoadRoute, fetchRoadRoute } from './routing';

const origin = { id: 'A', name: 'Hub', lat: 12.97, lng: 77.59 };
const stop = { id: 'B', name: 'FAT-1', lat: 12.98, lng: 77.6 };
const extra = { id: 'C', name: 'FAT-2', lat: 12.99, lng: 77.61 };

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
  const response: RouteResponse = {
    coordinates: [
      [12.97, 77.59],
      [12.98, 77.6],
    ],
    distanceMeters: 1234,
    durationSeconds: 200,
    steps: ['Depart onto MG Road', 'Arrive at stop'],
  };

  it('asks the server for a route and tags it as a road route', async () => {
    const route = vi.fn<ApiClient['route']>(async () => response);
    expect(await fetchRoadRoute([origin, stop], { route })).toEqual({ ...response, source: 'road' });
    expect(route).toHaveBeenCalledWith(
      {
        points: [
          [12.97, 77.59],
          [12.98, 77.6],
        ],
        optimize: false,
      },
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
    );
  });

  it('optimizes the visiting order when there are several destinations', async () => {
    const route = vi.fn<ApiClient['route']>(async () => response);
    await fetchRoadRoute([origin, stop, extra], { route });
    expect(route.mock.calls[0][0]).toMatchObject({ optimize: true });
  });

  it('resolves to null on failures, empty routes and single stops', async () => {
    const failing = vi.fn<ApiClient['route']>(async () => {
      throw new ApiError(502, 'routing_unavailable', 'down');
    });
    expect(await fetchRoadRoute([origin, stop], { route: failing })).toBeNull();
    const empty = vi.fn<ApiClient['route']>(async () => ({ ...response, coordinates: [] }));
    expect(await fetchRoadRoute([origin, stop], { route: empty })).toBeNull();
    expect(await fetchRoadRoute([origin], { route: failing })).toBeNull();
    expect(failing).toHaveBeenCalledTimes(1);
  });
});
