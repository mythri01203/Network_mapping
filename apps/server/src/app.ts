import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyError, type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

import { API_PREFIX, type ApiErrorBody } from '@fibergis/shared';

import { forbidden, loginRequired, SESSION_COOKIE } from './auth/access';
import type { SqliteAuthStore } from './auth/authStore';
import type { AppConfig } from './config';
import type { NetworkRepository } from './db/repository';
import { HttpError } from './lib/errors';
import { authRoutes, PUBLIC_API_PATHS } from './routes/auth';
import { collectionRoutes } from './routes/collections';
import { networkRoutes } from './routes/network';
import { photoRoutes } from './routes/photos';
import { reportRoutes } from './routes/reports';
import { routingRoutes } from './routes/routing';
import { systemRoutes } from './routes/system';

export interface AppOptions {
  config: AppConfig;
  repository: NetworkRepository & { auth: SqliteAuthStore };
  /** Injected for tests; defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

/** Most requests are small; routes that need more (changes, restore, photos) set their own limit. */
const BODY_LIMIT_BYTES = 1024 * 1024;
const MAX_REPORTED_ISSUES = 20;
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Content-Security-Policy for the web app. Scripts only from this server (plus WebAssembly for the
 * QR reader); map tiles from the providers the app lists; the map stylesheet and fonts from their
 * CDNs. Extra tile hosts come from `CSP_IMG_SOURCES`.
 */
function cspDirectives(config: AppConfig) {
  return {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
    styleSrc: ["'self'", "'unsafe-inline'", 'https://unpkg.com', 'https://fonts.googleapis.com'],
    fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
    imgSrc: ["'self'", 'data:', 'blob:', 'https://*.google.com', 'https://tile.openstreetmap.org', 'https://unpkg.com', ...config.cspImgSources],
    connectSrc: ["'self'", 'https://unpkg.com', 'https://fonts.googleapis.com', 'https://fonts.gstatic.com'],
    mediaSrc: ["'self'", 'blob:'],
    workerSrc: ["'self'", 'blob:'],
    manifestSrc: ["'self'"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    frameAncestors: ["'none'"],
    upgradeInsecureRequests: null,
  };
}

export async function buildApp({ config, repository, fetch }: AppOptions): Promise<FastifyInstance> {
  const options: FastifyServerOptions & { https?: { cert: Buffer; key: Buffer } } = {
    logger: {
      level: config.logLevel,
      // Never log cookies, passwords or tokens: only method, path and the client address.
      serializers: {
        req: (request: { method: string; url: string; ip?: string }) => ({ method: request.method, url: request.url.split('?')[0], ip: request.ip }),
      },
    },
    bodyLimit: BODY_LIMIT_BYTES,
    // A hop count is accepted by Fastify (proxy-addr) though its types list only strings and booleans.
    trustProxy: config.trustProxy as FastifyServerOptions['trustProxy'],
  };
  if (config.https) options.https = { cert: readFileSync(config.https.certFile), key: readFileSync(config.https.keyFile) };
  const app = Fastify(options);
  const auth = repository.auth;
  const secure = !!config.https || config.cookieSecure === 'true';

  await app.register(helmet, {
    contentSecurityPolicy: config.csp ? { useDefaults: false, directives: cspDirectives(config) } : false,
    // Map tiles come from other sites without CORP headers; requiring them would blank the map.
    crossOriginEmbedderPolicy: false,
    // Only on https, so trying https once never locks a browser out of a plain-http server.
    strictTransportSecurity: secure ? { maxAge: 15_552_000, includeSubDomains: false } : false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    xFrameOptions: { action: 'deny' },
  });
  await app.register(cookie);
  await app.register(cors, { origin: config.corsOrigins, credentials: true, methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'] });

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
    if (error instanceof HttpError) return send(error.statusCode, { ...error.details, error: error.code, message: error.message });
    const status = 'statusCode' in error ? error.statusCode : undefined;
    if (status === 429) {
      return send(429, { error: 'too_many_requests', message: 'Too many requests from this device. Wait a minute; nothing is lost.' });
    }
    if (status === 413) {
      return send(413, { error: 'too_large', message: 'That is more data than this server accepts in one go. Nothing was saved.' });
    }
    if (status !== undefined && status >= 400 && status < 500) {
      return send(status, { error: ('code' in error && error.code) || 'bad_request', message: error.message });
    }
    request.log.error({ err: error }, 'Unhandled error');
    return send(500, { error: 'internal_error', message: 'Something went wrong on the server.' });
  });

  await app.register(
    async (api) => {
      api.decorateRequest('auth', null as never);

      // Who is asking: the session cookie, if any. Login is on once an account exists (or AUTH_REQUIRED).
      api.addHook('onRequest', async (request, reply) => {
        const mode = auth.hasAccounts() || config.authRequired ? 'enforced' : 'setup';
        const token = request.cookies[SESSION_COOKIE];
        const session = token ? auth.session(token, config.sessionDays) : undefined;
        if (token && !session) reply.clearCookie(SESSION_COOKIE, { path: '/' });
        request.auth = { mode, account: session?.account ?? null, ...(session ? { session } : {}) };

        // A change must come from this app's own pages (or a configured origin), never another site.
        if (UNSAFE_METHODS.has(request.method)) {
          const origin = request.headers.origin;
          if (origin && origin !== 'null' && !config.corsOrigins.includes(origin)) {
            const host = (() => {
              try {
                return new URL(origin).host;
              } catch {
                return '';
              }
            })();
            if (host !== request.host) throw forbidden('This request came from another website, so it was refused.');
          }
        }

        const path = request.url.split('?')[0].slice(API_PREFIX.length) || '/';
        if (mode === 'enforced' && !session && !PUBLIC_API_PATHS.has(path)) throw loginRequired();
      });

      await api.register(rateLimit, {
        max: config.rateLimitPerMinute,
        timeWindow: 60_000,
        // Per session when logged in, so a whole office behind one address is not counted as one phone.
        keyGenerator: (request) => request.auth?.session?.tokenHash ?? request.ip,
        allowList: (request) => request.url.endsWith('/health'),
      });

      await api.register(systemRoutes(repository));
      await api.register(authRoutes({ config, store: auth }));
      await api.register(
        networkRoutes(repository, { photosDir: config.photosDir, backupsDir: config.backupsDir, backupKeep: config.backupKeep, restoreMaxBytes: config.restoreMaxBytes }),
      );
      await api.register(reportRoutes(repository));
      await api.register(routingRoutes({ baseUrl: config.osrmUrl, timeoutMs: config.routingTimeoutMs, fetch }));
      await api.register(photoRoutes({ dir: config.photosDir }));
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
        // The service worker may control the whole site from /sw.js.
        if (/[\\/]sw\.js$/.test(filePath)) reply.header('service-worker-allowed', '/');
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
        photos: '/api/v1/photos/<id>',
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
