import { z } from 'zod';
import type { LatLng, RouteRequest, RouteResponse } from '@fibergis/shared';
import { HttpError } from './errors';

const stepSchema = z.object({
  name: z.string().optional(),
  distance: z.number().optional(),
  maneuver: z.object({ type: z.string(), modifier: z.string().optional() }).optional(),
});

const routeSchema = z.object({
  distance: z.number(),
  duration: z.number(),
  geometry: z.object({ coordinates: z.array(z.tuple([z.number(), z.number()])).min(2) }),
  legs: z.array(z.object({ steps: z.array(stepSchema).default([]) })).default([]),
});

const osrmResponseSchema = z.object({
  code: z.string(),
  message: z.string().optional(),
  routes: z.array(routeSchema).optional(),
  trips: z.array(routeSchema).optional(),
});

const MANEUVER_VERBS: Record<string, string> = {
  turn: 'Turn',
  'new name': 'Continue',
  continue: 'Continue',
  merge: 'Merge',
  'on ramp': 'Take the ramp',
  'off ramp': 'Take the exit',
  fork: 'Keep',
  'end of road': 'Turn',
  roundabout: 'Enter the roundabout',
  rotary: 'Enter the roundabout',
  'roundabout turn': 'Turn',
  notification: 'Continue',
};

/** OSRM's public server returns maneuvers, not prose; turn them into short readable instructions. */
export function describeStep(step: z.infer<typeof stepSchema>): string | undefined {
  const type = step.maneuver?.type ?? 'continue';
  const road = step.name ? step.name : undefined;
  if (type === 'depart') return road ? `Head out on ${road}` : 'Head out';
  if (type === 'arrive') return 'Arrive at the destination';
  const verb = MANEUVER_VERBS[type] ?? 'Continue';
  const modifier = step.maneuver?.modifier && step.maneuver.modifier !== 'straight' ? ` ${step.maneuver.modifier}` : '';
  if (!road && !modifier) return undefined;
  return `${verb}${modifier}${road ? ` onto ${road}` : ''}`;
}

export interface RoutingOptions {
  baseUrl: string;
  timeoutMs: number;
  fetch?: typeof fetch;
}

/**
 * Plans a driving route through the given stops via an OSRM server. With `optimize` and three or
 * more stops, OSRM's trip service reorders the intermediate stops (origin fixed, no return leg).
 */
export async function planRoute(request: RouteRequest, options: RoutingOptions): Promise<RouteResponse> {
  const coordinates = request.points.map(([lat, lng]) => `${lng},${lat}`).join(';');
  const useTrip = Boolean(request.optimize) && request.points.length > 2;
  const service = useTrip ? 'trip' : 'route';
  const url = new URL(`${options.baseUrl}/${service}/v1/driving/${coordinates}`);
  url.searchParams.set('overview', 'full');
  url.searchParams.set('geometries', 'geojson');
  url.searchParams.set('steps', 'true');
  if (useTrip) {
    url.searchParams.set('source', 'first');
    url.searchParams.set('roundtrip', 'false');
  }

  let body: unknown;
  try {
    const response = await (options.fetch ?? fetch)(url, { signal: AbortSignal.timeout(options.timeoutMs) });
    body = await response.json();
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new HttpError(504, 'routing_timeout', 'The routing service did not respond in time.');
    }
    throw new HttpError(502, 'routing_unavailable', 'The routing service could not be reached.');
  }

  const parsed = osrmResponseSchema.safeParse(body);
  if (!parsed.success)
    throw new HttpError(502, 'routing_unavailable', 'The routing service returned an invalid response.');
  const route = parsed.data.routes?.[0] ?? parsed.data.trips?.[0];
  if (parsed.data.code !== 'Ok' || !route) {
    throw new HttpError(422, 'no_route', parsed.data.message ?? 'No road route connects these points.');
  }

  return {
    coordinates: route.geometry.coordinates.map(([lng, lat]): LatLng => [lat, lng]),
    distanceMeters: Math.round(route.distance),
    durationSeconds: Math.round(route.duration),
    steps: route.legs.flatMap((leg) => leg.steps.map(describeStep)).filter((step): step is string => Boolean(step)),
  };
}
