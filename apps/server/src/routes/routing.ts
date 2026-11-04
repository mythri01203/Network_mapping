import type { FastifyPluginAsync } from 'fastify';

import { routeRequestSchema } from '@fibergis/shared';

import { planRoute, type RoutingOptions } from '../lib/osrm';

/** Road routing for field crews, proxied so the browser never depends on a third-party origin. */
export const routingRoutes =
  (options: RoutingOptions): FastifyPluginAsync =>
  async (app) => {
    app.post('/routing/route', async (request) => planRoute(routeRequestSchema.parse(request.body), options));
  };
