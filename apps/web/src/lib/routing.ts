import { type LatLng, polylineLengthMeters } from '@fibergis/shared';

import { type ApiClient, apiClient } from '../api/client';

export interface RouteStop {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

export interface RoadRoute {
  coordinates: LatLng[];
  distanceMeters: number;
  durationSeconds: number;
  steps: string[];
  /** `road` comes from a routing engine; `estimate` is a straight-line approximation. */
  source: 'road' | 'estimate';
}

/** Slightly longer than the server's own routing timeout so its 504 reaches us first. */
const ROUTE_TIMEOUT_MS = 8000;
/** Typical ratio between road distance and straight-line distance in a street grid. */
const ROAD_DETOUR_FACTOR = 1.3;
const CITY_RIDING_SPEED_MPS = 30_000 / 3600;

/**
 * Road route through `stops` (first = origin) from the server's routing endpoint. With more than
 * one destination the stops are visited in the fastest order. Resolves to null on any failure.
 */
export async function fetchRoadRoute(
  stops: readonly RouteStop[],
  client: Pick<ApiClient, 'route'> = apiClient,
): Promise<RoadRoute | null> {
  if (stops.length < 2) return null;
  try {
    const route = await client.route(
      { points: stops.map((s): LatLng => [s.lat, s.lng]), optimize: stops.length > 2 },
      { timeoutMs: ROUTE_TIMEOUT_MS },
    );
    if (route.coordinates.length === 0) return null;
    const { coordinates, distanceMeters, durationSeconds, steps } = route;
    return { coordinates, distanceMeters, durationSeconds, steps, source: 'road' };
  } catch {
    return null;
  }
}

/** Offline approximation: an L-shaped street-grid path between consecutive stops. */
export function estimateRoadRoute(stops: readonly RouteStop[]): RoadRoute {
  const coordinates: LatLng[] = [];
  const steps: string[] = stops[0] ? [`Depart from ${stops[0].name}`] : [];
  let distanceMeters = 0;

  for (let i = 0; i < stops.length - 1; i++) {
    const from = stops[i];
    const to = stops[i + 1];
    const leg: LatLng[] = [
      [from.lat, from.lng],
      [from.lat, to.lng],
      [to.lat, to.lng],
    ];
    coordinates.push(...(i === 0 ? leg : leg.slice(1)));
    const legMeters = polylineLengthMeters([leg[0], leg[2]]) * ROAD_DETOUR_FACTOR;
    distanceMeters += legMeters;
    steps.push(`Head toward ${to.name} (≈${Math.round(legMeters)} m)`, `Arrive at ${to.name}`);
  }

  return {
    coordinates,
    distanceMeters: Math.round(distanceMeters),
    durationSeconds: Math.max(60, Math.round(distanceMeters / CITY_RIDING_SPEED_MPS)),
    steps,
    source: 'estimate',
  };
}
