import type { FastifyPluginAsync } from 'fastify';

import type { HealthResponse } from '@fibergis/shared';

import pkg from '../../package.json' with { type: 'json' };
import type { NetworkRepository } from '../db/repository';

export const systemRoutes =
  (repository: NetworkRepository): FastifyPluginAsync =>
  async (app) => {
    app.get('/health', async (): Promise<HealthResponse> => ({
      status: 'ok',
      version: pkg.version,
      uptimeSeconds: Math.round(process.uptime()),
      revision: await repository.getRevision(),
      counts: await repository.counts(),
    }));
  };
