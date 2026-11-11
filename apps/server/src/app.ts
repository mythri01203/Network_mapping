import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyError, type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

import { API_PREFIX, type ApiErrorBody } from '@fibergis/shared';

import { forbidden, isLocalRequest, loginRequired, passwordChangeRequired, SESSION_COOKIE } from './auth/access';
import type { SqliteAuthStore } from './auth/authStore';
import type { AppConfig } from './config';
import type { ChangeRequestStore } from './db/changeRequestStore';
import type { RecordHistoryStore } from './db/historyStore';
import { currentTenant, runInTenant, scoped, TenantRegistry, type TenantRepository, tenantTokenRouter } from './db/tenants';
import { HttpError } from './lib/errors';
import type { MonitoringTokenStore } from './monitoring/tokenStore';
import { authRoutes, PUBLIC_API_PATHS } from './routes/auth';
import { collectionRoutes } from './routes/collections';
import { connectionRoutes } from './routes/connections';
import { governanceRoutes } from './routes/governance';
import { monitoringRoutes } from './routes/monitoring';
import { networkRoutes } from './routes/network';
import { organisationRoutes } from './routes/organisations';
import { photoRoutes } from './routes/photos';
import { reportRoutes } from './routes/reports';
import { routingRoutes } from './routes/routing';
import { searchRoutes } from './routes/search';
import { systemRoutes } from './routes/system';
import { voiceRoutes } from './routes/voice';
import type { VoiceClipStore } from './voice/clipStore';

export interface AppOptions {
  config: AppConfig;
  /**
   * Phase 23b: the organisations on this server (`main.ts` opens them from `control.db`). When left
   * out, `repository` is the only organisation, with an organisations list kept in memory.
   */
  tenants?: TenantRegistry;
  /** One organisation's database: the server's audit events, revisions, change requests, accounts, tokens and clips with it. */
  repository?: TenantRepository;
  /** Injected for tests; defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Injected for tests of the Sarvam calls, so no test ever reaches the paid service. */
  voiceFetch?: typeof fetch;
}

/** Most requests are small; routes that need more (changes, restore, photos) set their own limit. */
const BODY_LIMIT_BYTES = 1024 * 1024;
const MAX_REPORTED_ISSUES = 20;
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
/** Phase 23b: one of the request's organisation's folders. */
const currentFolder = (key: 'photosDir' | 'backupsDir' | 'voiceDir'): string => currentTenant()[key];

/** Phase 23b: a monitoring push carries its own token instead of a session. */
const INGEST_PATH = '/monitoring/ingest';

/** What a session with a temporary password may still do. */
const PASSWORD_CHANGE_PATHS = new Set(['/health', '/auth/status', '/auth/logout', '/auth/password', '/auth/login']);

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

export async function buildApp({ config, tenants: givenTenants, repository: givenRepository, fetch, voiceFetch }: AppOptions): Promise<FastifyInstance> {
  if (!givenTenants && !givenRepository) throw new Error('buildApp needs the organisations (tenants) or one repository.');
  // Phase 23b: one organisation's database alone (tests, older callers) gets an organisations list in memory.
  const tenants =
    givenTenants ??
    TenantRegistry.open({
      controlPath: ':memory:',
      // A throwaway database never adds organisation folders next to a real one.
      organisationsDir: config.databasePath === ':memory:' ? join(tmpdir(), 'fibergis-memory-organisations') : config.organisationsDir,
      host: { name: config.organisationName, databasePath: config.databasePath, photosDir: config.photosDir, voiceDir: config.voiceDir, backupsDir: config.backupsDir },
      hostRepository: givenRepository,
    });
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
  if (!givenTenants) app.addHook('onClose', () => tenants.close());
  // Phase 23: how long whole-record revisions are kept; old ones are removed now and then hourly.
  // Phase 23b: in every organisation, including ones added while the server runs.
  tenants.onOpen((tenant) => {
    tenant.repository.history.setRetention({ keepDays: config.revisionKeepDays, keepPerRecord: config.revisionKeepPerRecord });
    tenant.repository.history.pruneByAge(Date.now(), true);
  });
  // Phase 23b: the routes see only the request's organisation. These stand for its database, account
  // store and so on, looked up on every use; with no organisation they refuse (401).
  const repository = scoped((t) => t.repository);
  const auth: SqliteAuthStore = scoped((t) => t.repository.auth);
  const voiceClips: VoiceClipStore = scoped((t) => t.repository.voiceClips);
  const history: RecordHistoryStore = scoped((t) => t.repository.history);
  const changeRequests: ChangeRequestStore = scoped((t) => t.repository.changeRequests);
  // The routes call only these four methods; the class's private fields are not part of it.
  const monitoringTokens = tenantTokenRouter(tenants) as MonitoringTokenStore;
  /** Each organisation's own folders, read when a route uses them. */
  const folders = {
    get photosDir() {
      return currentFolder('photosDir');
    },
    get backupsDir() {
      return currentFolder('backupsDir');
    },
    get voiceDir() {
      return currentFolder('voiceDir');
    },
  };
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
      api.decorateRequest('tenant', null);

      // Phase 23b: every route handler runs with its request's organisation, so the scoped stores
      // above read that organisation's database and folders, and no other.
      api.addHook('onRoute', (route) => {
        const handler = route.handler;
        route.handler = function withTenant(this: FastifyInstance, request, reply) {
          return runInTenant(request.tenant ?? null, () => handler.call(this, request, reply));
        } as typeof handler;
      });

      // Who is asking: the session cookie, if any. Login is on once an account exists (or AUTH_REQUIRED).
      // Before that ("setup"), only the server computer itself may use the app: any other device is
      // treated as logged out, so it cannot read, change, reset or restore anything, and its unsent
      // work waits on the device until someone logs in.
      api.addHook('onRequest', async (request, reply) => {
        const setup = !(tenants.hasAccounts() || config.authRequired);
        const local = isLocalRequest(request);
        const mode = setup && local ? 'setup' : 'enforced';
        const token = request.cookies[SESSION_COOKIE];
        // Phase 23b: the cookie names the organisation; the session is looked up in its database only.
        // A switched-off organisation's sessions never count (they are also ended when it is switched off).
        const found = token ? tenants.parseSessionCookie(token) : undefined;
        const session = found && found.tenant.status === 'active' ? found.tenant.repository.auth.session(found.token, config.sessionDays, config.sessionMaxDays) : undefined;
        if (token && !session) reply.clearCookie(SESSION_COOKIE, { path: '/' });
        request.auth = { mode, account: session?.account ?? null, ...(session ? { session } : {}), ...(setup && !local ? { setupPending: true } : {}) };
        // Setup mode (no account anywhere, this computer): the first organisation, as before organisations.
        request.tenant = session && found ? found.tenant : mode === 'setup' ? tenants.host() : null;

        // A change must come from this app's own pages (or a configured origin), never another site.
        // A sandboxed page sends the origin "null": that is another site too.
        if (UNSAFE_METHODS.has(request.method)) {
          const origin = request.headers.origin;
          if (origin === 'null') throw forbidden('This request came from another website, so it was refused.');
          if (origin && !config.corsOrigins.includes(origin)) {
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
        // A push works on the organisation its token names (switched on only), whoever is logged in here.
        if (path === INGEST_PATH) {
          const header = request.headers.authorization;
          request.tenant = tenants.ingestTenant(header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined)?.tenant ?? null;
        }
        if (mode === 'enforced' && !session && !PUBLIC_API_PATHS.has(path)) throw loginRequired();
        // A temporary password from the office must be replaced before anything else is done.
        if (session?.mustChangePassword && !PASSWORD_CHANGE_PATHS.has(path)) throw passwordChangeRequired();
      });

      await api.register(rateLimit, {
        max: config.rateLimitPerMinute,
        timeWindow: 60_000,
        // Per session when logged in, so a whole office behind one address is not counted as one phone.
        keyGenerator: (request) => request.auth?.session?.tokenHash ?? request.ip,
        allowList: (request) => request.url.endsWith('/health'),
      });

      await api.register(systemRoutes(repository));
      await api.register(authRoutes({ config, store: auth, tenants }));
      await api.register(organisationRoutes({ config, tenants }));
      await api.register(
        networkRoutes(repository, {
          get photosDir() {
            return folders.photosDir;
          },
          get backupsDir() {
            return folders.backupsDir;
          },
          backupKeep: config.backupKeep,
          restoreMaxBytes: config.restoreMaxBytes,
        }),
      );
      await api.register(reportRoutes(repository));
      // Network mapping Phase 13: the connection index for one record or one fibre, read-only.
      await api.register(connectionRoutes(repository));
      // Phase 16: search over the organisation's network, redacted as GET /network is.
      await api.register(searchRoutes(repository));
      await api.register(
        monitoringRoutes({
          repository,
          tokens: monitoringTokens,
          ingestPerMinute: config.ingestPerMinute,
          retention: { keepDays: config.monitoringKeepDays, maxRows: config.monitoringMaxRows },
        }),
      );
      await api.register(
        voiceRoutes({
          repository,
          clips: voiceClips,
          get voiceDir() {
            return folders.voiceDir;
          },
          ...(config.sarvamApiKey ? { apiKey: config.sarvamApiKey } : {}),
          model: config.sarvamModel,
          dailyCharLimit: config.sarvamDailyCharLimit,
          timeoutMs: config.sarvamTimeoutMs,
          ...(voiceFetch ? { fetch: voiceFetch } : {}),
        }),
      );
      await api.register(routingRoutes({ baseUrl: config.osrmUrl, timeoutMs: config.routingTimeoutMs, fetch }));
      await api.register(photoRoutes({ dir: () => folders.photosDir }));
      await api.register(governanceRoutes({ repository, history, changeRequests }));
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
