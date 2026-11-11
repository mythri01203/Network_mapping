import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/** Resolves a path relative to the server package root (works from both `src/` and the bundled `dist/`). */
const fromPackageRoot = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url));

const DEFAULT_CORS_ORIGINS = [3000, 5173].flatMap((port) => [`http://localhost:${port}`, `http://127.0.0.1:${port}`]);

const booleanFlag = z.enum(['true', 'false', '1', '0']).transform((value) => value === 'true' || value === '1');

const envSchema = z.object({
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(0).max(65535).default(5000),
  DATABASE_PATH: z.string().min(1).default(fromPackageRoot('data/fibergis.db')),
  STATIC_DIR: z.string().min(1).default(fromPackageRoot('../web/dist')),
  /** Defaults to a photos folder next to the database file. */
  PHOTOS_DIR: z.string().min(1).optional(),
  CORS_ORIGINS: z.string().optional(),
  OSRM_URL: z.url().default('https://router.project-osrm.org'),
  ROUTING_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  SEED_SAMPLE_DATA: booleanFlag.default(true),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /* Phase 9: login, limits and https. See docs/DEPLOYMENT_GUIDE.md. */
  /** Login is on once the first admin account exists. `true` turns it on before that (no setup mode). */
  AUTH_REQUIRED: booleanFlag.default(false),
  /** When set, creating the first admin account also needs this code. */
  SETUP_TOKEN: z.string().min(8).optional(),
  SESSION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  /** A login ends this many days after it began, however much it is used. */
  SESSION_MAX_DAYS: z.coerce.number().int().min(1).max(365).default(90),
  /** Voice lessons: Sarvam AI key. Server only; never sent to a browser or written to a log. */
  SARVAM_API_KEY: z.string().trim().optional(),
  SARVAM_MODEL: z.enum(['bulbul:v3', 'bulbul:v4-flash']).default('bulbul:v4-flash'),
  /** Most characters sent to Sarvam in one day (a spending guard). */
  SARVAM_DAILY_CHAR_LIMIT: z.coerce.number().int().min(100).max(1_000_000).default(20_000),
  SARVAM_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(30_000),
  /** Where generated voice clips are kept. Default: a `voice` folder beside the database. */
  VOICE_DIR: z.string().min(1).optional(),
  /** Phase 7: device readings and status changes older than this are removed (newest per ONT kept). */
  MONITORING_KEEP_DAYS: z.coerce.number().int().min(1).max(3650).default(90),
  /** Phase 7: most device readings kept in all; the oldest go first. */
  MONITORING_MAX_ROWS: z.coerce.number().int().min(1000).max(5_000_000).default(200_000),
  /** Phase 23: whole-record revisions older than this are removed. The audit events are kept for good. */
  REVISION_KEEP_DAYS: z.coerce.number().int().min(1).max(36_500).default(365),
  /** Phase 23: most revisions kept for one record; the oldest go first. */
  REVISION_KEEP_PER_RECORD: z.coerce.number().int().min(1).max(10_000).default(50),
  PASSWORD_MIN_LENGTH: z.coerce.number().int().min(6).max(64).default(8),
  /** `auto`: secure cookies when the request came over https (directly or through a trusted proxy). */
  COOKIE_SECURE: z.enum(['auto', 'true', 'false']).default('auto'),
  /** Trust X-Forwarded-* from a reverse proxy: `true`, a hop count, or a list of proxy addresses. */
  TRUST_PROXY: z.string().optional(),
  HTTPS_CERT_FILE: z.string().min(1).optional(),
  HTTPS_KEY_FILE: z.string().min(1).optional(),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(10).max(100_000).default(1200),
  /** Phase 7: push requests per minute for one monitoring token. */
  INGEST_PER_MINUTE: z.coerce.number().int().min(1).max(10_000).default(60),
  LOGIN_MAX_FAILURES: z.coerce.number().int().min(3).max(100).default(5),
  LOGIN_LOCK_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
  RESTORE_MAX_MB: z.coerce.number().int().min(1).max(2048).default(200),
  /** Safety copies made before every reset and restore. Default: a `backups` folder beside the database. */
  BACKUPS_DIR: z.string().min(1).optional(),
  BACKUP_KEEP: z.coerce.number().int().min(1).max(1000).default(20),
  /** Phase 24: a scheduled backup every this many hours (0 = off, the default). Same zip as the safety copies. */
  BACKUP_EVERY_HOURS: z.coerce.number().min(0).max(168).default(0),
  /**
   * Phase 23b: the small database that lists the organisations on this server and which one each
   * login name belongs to. Default: `control.db` beside the database.
   */
  CONTROL_DATABASE_PATH: z.string().min(1).optional(),
  /** Phase 23b: each added organisation gets a folder here (its own database, photos, voice, backups). */
  ORGANISATIONS_DIR: z.string().min(1).optional(),
  /** Phase 23b: the name of the first organisation (the database at DATABASE_PATH), set when it is first registered. */
  ORGANISATION_NAME: z.string().trim().min(1).max(80).default('My organisation'),
  /** Content-Security-Policy header on the web app. `off` only to find a problem. */
  CSP: z.enum(['on', 'off']).default('on'),
  /** Extra image hosts for other map tiles, comma separated (e.g. `https://tiles.example.com`). */
  CSP_IMG_SOURCES: z.string().optional(),
});

export interface AppConfig {
  host: string;
  port: number;
  /** SQLite file path, or `:memory:` for a throwaway database. */
  databasePath: string;
  /** Field photos, one file per photo id. */
  photosDir: string;
  /** Built web app to serve; skipped when it has no `index.html`. */
  staticDir: string;
  corsOrigins: string[];
  osrmUrl: string;
  routingTimeoutMs: number;
  /** Load the demo network into a brand-new database. */
  seedSampleData: boolean;
  logLevel: z.infer<typeof envSchema>['LOG_LEVEL'];
  authRequired: boolean;
  setupToken?: string;
  sessionDays: number;
  sessionMaxDays: number;
  /** Voice lessons (Sarvam AI). `sarvamApiKey` is absent when not configured. */
  sarvamApiKey?: string;
  sarvamModel: 'bulbul:v3' | 'bulbul:v4-flash';
  sarvamDailyCharLimit: number;
  sarvamTimeoutMs: number;
  voiceDir: string;
  monitoringKeepDays: number;
  monitoringMaxRows: number;
  revisionKeepDays: number;
  revisionKeepPerRecord: number;
  passwordMinLength: number;
  cookieSecure: 'auto' | 'true' | 'false';
  /** Passed to Fastify's `trustProxy`. */
  trustProxy: boolean | number | string;
  https?: { certFile: string; keyFile: string };
  rateLimitPerMinute: number;
  ingestPerMinute: number;
  loginMaxFailures: number;
  loginLockMinutes: number;
  restoreMaxBytes: number;
  backupsDir: string;
  backupKeep: number;
  /** Phase 24: hours between scheduled backups; 0 = off. */
  backupEveryHours: number;
  /** Phase 23b: the organisations list (`:memory:` with a throwaway database). */
  controlDatabasePath: string;
  /** Phase 23b: one folder per added organisation. The first organisation keeps the paths above. */
  organisationsDir: string;
  /** Phase 23b: name given to the first organisation when it is registered. */
  organisationName: string;
  csp: boolean;
  cspImgSources: string[];
}

const parseTrustProxy = (value: string | undefined): boolean | number | string => {
  if (!value) return false;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
};

const list = (value: string | undefined) =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

/** Photos live beside the database, so a test or temporary database never writes into the real data folder. */
const defaultPhotosDir = (databasePath: string) =>
  databasePath === ':memory:' ? join(tmpdir(), 'fibergis-memory-photos') : join(dirname(databasePath), 'photos');

const defaultVoiceDir = (databasePath: string) =>
  databasePath === ':memory:' ? join(tmpdir(), 'fibergis-memory-voice') : join(dirname(databasePath), 'voice');

const defaultBackupsDir = (databasePath: string) =>
  databasePath === ':memory:' ? join(tmpdir(), 'fibergis-memory-backups') : join(dirname(databasePath), 'backups');

/** Phase 23b: a throwaway database keeps a throwaway organisations list. */
const defaultControlPath = (databasePath: string) => (databasePath === ':memory:' ? ':memory:' : join(dirname(databasePath), 'control.db'));

const defaultOrganisationsDir = (databasePath: string) =>
  databasePath === ':memory:' ? join(tmpdir(), 'fibergis-memory-organisations') : join(dirname(databasePath), 'organisations');

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Invalid server configuration (${details})`);
  }
  const value = parsed.data;
  if (!!value.HTTPS_CERT_FILE !== !!value.HTTPS_KEY_FILE) {
    throw new Error('Invalid server configuration (HTTPS_CERT_FILE and HTTPS_KEY_FILE must be set together)');
  }
  return {
    host: value.HOST,
    port: value.PORT,
    databasePath: value.DATABASE_PATH,
    photosDir: value.PHOTOS_DIR ?? defaultPhotosDir(value.DATABASE_PATH),
    staticDir: value.STATIC_DIR,
    // The dev-server addresses are allowed only while developing, never on a production server.
    corsOrigins: value.CORS_ORIGINS ? list(value.CORS_ORIGINS) : env.NODE_ENV === 'production' ? [] : DEFAULT_CORS_ORIGINS,
    osrmUrl: value.OSRM_URL.replace(/\/+$/, ''),
    routingTimeoutMs: value.ROUTING_TIMEOUT_MS,
    seedSampleData: value.SEED_SAMPLE_DATA,
    logLevel: value.LOG_LEVEL,
    authRequired: value.AUTH_REQUIRED,
    ...(value.SETUP_TOKEN ? { setupToken: value.SETUP_TOKEN } : {}),
    sessionDays: value.SESSION_DAYS,
    sessionMaxDays: Math.max(value.SESSION_DAYS, value.SESSION_MAX_DAYS),
    ...(value.SARVAM_API_KEY ? { sarvamApiKey: value.SARVAM_API_KEY } : {}),
    sarvamModel: value.SARVAM_MODEL,
    sarvamDailyCharLimit: value.SARVAM_DAILY_CHAR_LIMIT,
    sarvamTimeoutMs: value.SARVAM_TIMEOUT_MS,
    voiceDir: value.VOICE_DIR ?? defaultVoiceDir(value.DATABASE_PATH),
    monitoringKeepDays: value.MONITORING_KEEP_DAYS,
    monitoringMaxRows: value.MONITORING_MAX_ROWS,
    revisionKeepDays: value.REVISION_KEEP_DAYS,
    revisionKeepPerRecord: value.REVISION_KEEP_PER_RECORD,
    passwordMinLength: value.PASSWORD_MIN_LENGTH,
    cookieSecure: value.COOKIE_SECURE,
    trustProxy: parseTrustProxy(value.TRUST_PROXY),
    ...(value.HTTPS_CERT_FILE && value.HTTPS_KEY_FILE ? { https: { certFile: value.HTTPS_CERT_FILE, keyFile: value.HTTPS_KEY_FILE } } : {}),
    rateLimitPerMinute: value.RATE_LIMIT_PER_MINUTE,
    ingestPerMinute: value.INGEST_PER_MINUTE,
    loginMaxFailures: value.LOGIN_MAX_FAILURES,
    loginLockMinutes: value.LOGIN_LOCK_MINUTES,
    restoreMaxBytes: value.RESTORE_MAX_MB * 1024 * 1024,
    backupsDir: value.BACKUPS_DIR ?? defaultBackupsDir(value.DATABASE_PATH),
    backupKeep: value.BACKUP_KEEP,
    backupEveryHours: value.BACKUP_EVERY_HOURS,
    controlDatabasePath: value.CONTROL_DATABASE_PATH ?? defaultControlPath(value.DATABASE_PATH),
    organisationsDir: value.ORGANISATIONS_DIR ?? defaultOrganisationsDir(value.DATABASE_PATH),
    organisationName: value.ORGANISATION_NAME,
    csp: value.CSP === 'on',
    cspImgSources: list(value.CSP_IMG_SOURCES),
  };
}
