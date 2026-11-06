import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

import { API_PREFIX, type ApiErrorBody } from '@fibergis/shared';

import type { AppConfig } from './config';
import type { NetworkRepository } from './db/repository';
import { HttpError } from './lib/errors';
import { collectionRoutes } from './routes/collections';
import { networkRoutes } from './routes/network';
import { routingRoutes } from './routes/routing';
import { systemRoutes } from './routes/system';

export interface AppOptions {
  config: AppConfig;
  repository: NetworkRepository;
  /** Injected for tests; defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

/** Large enough for a full network backup with embedded photos. */
const BODY_LIMIT_BYTES = 10 * 1024 * 1024;
const MAX_REPORTED_ISSUES = 20;

export async function buildApp({ config, repository, fetch }: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: config.logLevel }, bodyLimit: BODY_LIMIT_BYTES });

  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'strict-origin-when-cross-origin');
    return payload;
  });

  await app.register(cors, { origin: config.corsOrigins, methods: ['GET', 'HEAD', 'POST', 'PUT', 'DELETE'] });

  app.setErrorHandler((error: FastifyError | Error, request, reply) => {
    const send = (status: number, body: ApiErrorBody) => reply.code(status).send(body);
    if (error instanceof z.ZodError) {
      return send(400, {
        error: 'validation_error',
        message: 'The request data is invalid.',
        issues: error.issues
          .slice(0, MAX_REPORTED_ISSUES)
          .map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      });
    }
    if (error instanceof HttpError) return send(error.statusCode, { error: error.code, message: error.message });
    const status = 'statusCode' in error ? error.statusCode : undefined;
    if (status !== undefined && status >= 400 && status < 500) {
      return send(status, { error: ('code' in error && error.code) || 'bad_request', message: error.message });
    }
    request.log.error({ err: error }, 'Unhandled error');
    return send(500, { error: 'internal_error', message: 'Something went wrong on the server.' });
  });

  await app.register(
    async (api) => {
      await api.register(systemRoutes(repository));
      await api.register(networkRoutes(repository));
      await api.register(routingRoutes({ baseUrl: config.osrmUrl, timeoutMs: config.routingTimeoutMs, fetch }));
      await api.register(collectionRoutes(repository));
    },
    { prefix: API_PREFIX },
  );

  // Serve the built web app (if present) with long-lived caching for hashed assets.
  const serveWeb = existsSync(join(config.staticDir, 'index.html'));
  if (serveWeb) {
    await app.register(fastifyStatic, {
      root: config.staticDir,
      cacheControl: false,
      setHeaders: (reply, filePath) => {
        const hashed = /[\\/]assets[\\/]/.test(filePath);
        reply.header('cache-control', hashed ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
  }

  // Root route: return API status and guide the user to the web UI
  app.get('/', async (_request, reply) => {
    if (serveWeb) {
      return reply.header('cache-control', 'no-cache').sendFile('index.html');
    }
    return reply.send({
      service: 'FiberOps Network Mapping Backend API',
      status: 'online',
      message: 'The Fastify REST API is running. The web frontend application is running at http://localhost:5173',
      endpoints: {
        health: '/api/v1/health',
        network: '/api/v1/network',
        gpsRoutes: '/api/v1/gpsRoutes',
        catalog: '/api/v1/catalog',
      },
      webApp: 'http://localhost:5173',
    });
  });

  app.setNotFoundHandler((request, reply) => {
    const path = request.url.split('?')[0];
    const wantsPage = request.method === 'GET' || request.method === 'HEAD';
    if (serveWeb && wantsPage && !path.startsWith('/api/')) {
      // Client-side routes: let the SPA render them.
      return reply.header('cache-control', 'no-cache').sendFile('index.html');
    }
    const body: ApiErrorBody = { error: 'not_found', message: `${request.method} ${path} does not exist.` };
    return reply.code(404).send(body);
  });

  return app;
}
