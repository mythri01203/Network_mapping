import { type LatLng, polylineLengthMeters } from '@fibergis/shared';

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

const OSRM_BASE_URL = 'https://router.project-osrm.org';
const ROUTE_TIMEOUT_MS = 4000;
/** Typical ratio between road distance and straight-line distance in a street grid. */
const ROAD_DETOUR_FACTOR = 1.3;
const CITY_RIDING_SPEED_MPS = 30_000 / 3600;

interface OsrmStep {
  name?: string;
  maneuver?: { type?: string; modifier?: string };
}
interface OsrmPath {
  distance: number;
  duration: number;
  geometry?: { coordinates?: [number, number][] };
  legs?: { steps?: OsrmStep[] }[];
}

const describeStep = (step: OsrmStep): string | null => {
  const type = step.maneuver?.type;
  const road = step.name ? ` onto ${step.name}` : '';
  if (type === 'depart') return `Depart${road}`;
  if (type === 'arrive') return 'Arrive at stop';
  if (!type) return step.name ? `Continue on ${step.name}` : null;
  const modifier = step.maneuver?.modifier ? ` ${step.maneuver.modifier}` : '';
  return `${type.charAt(0).toUpperCase()}${type.slice(1)}${modifier}${road}`;
};

/**
 * Road route through `stops` (first = origin) from the public OSRM driving profile. With more than
 * one destination the stops are visited in the fastest order. Resolves to null on any failure.
 */
export async function fetchRoadRoute(stops: readonly RouteStop[]): Promise<RoadRoute | null> {
  if (stops.length < 2) return null;
  const coords = stops.map((s) => `${s.lng},${s.lat}`).join(';');
  const url =
    stops.length > 2
      ? `${OSRM_BASE_URL}/trip/v1/driving/${coords}?overview=full&geometries=geojson&steps=true&source=first&roundtrip=false`
      : `${OSRM_BASE_URL}/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=true`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(ROUTE_TIMEOUT_MS) });
    if (!res.ok) return null;
    const json = (await res.json()) as { routes?: OsrmPath[]; trips?: OsrmPath[] };
    const path = json.routes?.[0] ?? json.trips?.[0];
    const line = path?.geometry?.coordinates;
    if (!path || !line?.length) return null;
    return {
      coordinates: line.map(([lng, lat]) => [lat, lng]),
      distanceMeters: path.distance,
      durationSeconds: path.duration,
      steps: (path.legs ?? []).flatMap((leg) =>
        (leg.steps ?? []).map(describeStep).filter((s): s is string => s !== null),
      ),
      source: 'road',
    };
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
