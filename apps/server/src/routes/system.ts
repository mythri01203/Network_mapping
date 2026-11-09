import type { FastifyPluginAsync } from 'fastify';

import type { HealthResponse } from '@fibergis/shared';

import pkg from '../../package.json' with { type: 'json' };
import type { NetworkRepository } from '../db/repository';

export const systemRoutes =
  (repository: NetworkRepository): FastifyPluginAsync =>
  async (app) => {
    /** Anyone may ask whether the server is up; how big the network is only someone logged in. */
    app.get('/health', async (request): Promise<HealthResponse> => {
      const base = { status: 'ok' as const, version: pkg.version, uptimeSeconds: Math.round(process.uptime()) };
      if (request.auth.mode === 'enforced' && !request.auth.session) return base;
      return { ...base, revision: await repository.getRevision(), counts: await repository.counts() };
    });
  };
