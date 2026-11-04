import { z } from 'zod';
import {
  COLLECTION_NAMES,
  COLLECTION_SCHEMAS,
  isCollectionName,
  type CollectionName,
  type NetworkSnapshot,
} from './collections';
import { latLngSchema } from './schemas';
import type { LatLng } from './types';

/** Every API route lives under this prefix; bump it for breaking contract changes. */
export const API_PREFIX = '/api/v1';

/**
 * A batch of record-level writes. Upserts replace whole records keyed by `id`; deletes are ids.
 * The server applies one change set atomically and bumps the network revision once.
 */
export interface ChangeSet {
  upserts?: Partial<NetworkSnapshot>;
  deletes?: Partial<Record<CollectionName, string[]>>;
}

const collectionMap = <T extends z.ZodType>(item: (name: CollectionName) => T) =>
  z.strictObject(Object.fromEntries(COLLECTION_NAMES.map((name) => [name, z.array(item(name)).optional()])));

export const changeSetSchema = z.strictObject({
  upserts: collectionMap((name) => COLLECTION_SCHEMAS[name]).optional(),
  deletes: collectionMap(() => z.string().min(1)).optional(),
}) as unknown as z.ZodType<ChangeSet>;

export interface NetworkResponse {
  revision: number;
  data: NetworkSnapshot;
}

export interface ChangeResult {
  revision: number;
  upserted: number;
  deleted: number;
}

export interface HealthResponse {
  status: 'ok';
  version: string;
  uptimeSeconds: number;
  revision: number;
  counts: Record<CollectionName, number>;
}

export interface RouteRequest {
  /** Ordered `[lat, lng]` stops; the first is the origin. */
  points: LatLng[];
  /** Visit intermediate stops in the fastest order instead of the given one. */
  optimize?: boolean;
}

export const routeRequestSchema = z.object({
  points: z.array(latLngSchema).min(2).max(25),
  optimize: z.boolean().optional(),
});

export interface RouteResponse {
  coordinates: LatLng[];
  distanceMeters: number;
  durationSeconds: number;
  steps: string[];
}

export interface ApiErrorBody {
  error: string;
  message: string;
  issues?: { path: string; message: string }[];
}

// --- Backups -------------------------------------------------------------------------------------

export const BACKUP_FORMAT = 'fibergis-backup';
export const BACKUP_VERSION = 4;

export interface NetworkBackup {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  projectStartPoint?: LatLng;
  data: NetworkSnapshot;
}

export interface ParsedBackup {
  collections: Partial<NetworkSnapshot>;
  projectStartPoint?: LatLng;
}

export type BackupParseResult = { ok: true; backup: ParsedBackup } | { ok: false; error: string };

/** Keys written by earlier FiberGIS backups, mapped to today's collection names. */
const LEGACY_BACKUP_KEYS: Record<string, CollectionName> = {
  equipments: 'equipment',
  customComponents: 'catalog',
};

export function createBackup(data: NetworkSnapshot, exportedAt: string, projectStartPoint?: LatLng): NetworkBackup {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt,
    ...(projectStartPoint ? { projectStartPoint } : {}),
    data,
  };
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const describeIssue = (error: z.ZodError) => {
  const issue = error.issues[0];
  if (!issue) return 'invalid data';
  return issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message;
};

/**
 * Reads a backup in the current envelope format or the flat legacy format (top-level arrays, with
 * `equipments`/`customComponents` keys). Every record is validated; unknown keys are ignored.
 */
export function parseBackup(raw: unknown): BackupParseResult {
  if (!isPlainObject(raw)) return { ok: false, error: 'A backup must be a JSON object.' };
  const source = isPlainObject(raw.data) ? raw.data : raw;

  const collections: Partial<Record<CollectionName, unknown[]>> = {};
  const problems: string[] = [];
  for (const [key, value] of Object.entries(source)) {
    const name = isCollectionName(key) ? key : LEGACY_BACKUP_KEYS[key];
    if (!name) continue;
    const parsed = z.array(COLLECTION_SCHEMAS[name]).safeParse(value);
    if (parsed.success) collections[name] = parsed.data;
    else problems.push(`${key}.${describeIssue(parsed.error)}`);
  }

  if (problems.length > 0) return { ok: false, error: `Invalid backup data (${problems.join('; ')}).` };
  if (Object.keys(collections).length === 0) {
    return { ok: false, error: 'The file does not contain any FiberGIS network data.' };
  }

  const start = latLngSchema.safeParse(raw.projectStartPoint ?? source.projectStartPoint);
  return {
    ok: true,
    backup: {
      collections: collections as Partial<NetworkSnapshot>,
      ...(start.success ? { projectStartPoint: start.data } : {}),
    },
  };
}
