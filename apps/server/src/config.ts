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
  CORS_ORIGINS: z.string().optional(),
  OSRM_URL: z.url().default('https://router.project-osrm.org'),
  ROUTING_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  SEED_SAMPLE_DATA: booleanFlag.default(true),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export interface AppConfig {
  host: string;
  port: number;
  /** SQLite file path, or `:memory:` for a throwaway database. */
  databasePath: string;
  /** Built web app to serve; skipped when it has no `index.html`. */
  staticDir: string;
  corsOrigins: string[];
  osrmUrl: string;
  routingTimeoutMs: number;
  /** Load the demo network into a brand-new database. */
  seedSampleData: boolean;
  logLevel: z.infer<typeof envSchema>['LOG_LEVEL'];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Invalid server configuration (${details})`);
  }
  const value = parsed.data;
  return {
    host: value.HOST,
    port: value.PORT,
    databasePath: value.DATABASE_PATH,
    staticDir: value.STATIC_DIR,
    corsOrigins: value.CORS_ORIGINS
      ? value.CORS_ORIGINS.split(',')
          .map((origin) => origin.trim())
          .filter(Boolean)
      : DEFAULT_CORS_ORIGINS,
    osrmUrl: value.OSRM_URL.replace(/\/+$/, ''),
    routingTimeoutMs: value.ROUTING_TIMEOUT_MS,
    seedSampleData: value.SEED_SAMPLE_DATA,
    logLevel: value.LOG_LEVEL,
  };
}
