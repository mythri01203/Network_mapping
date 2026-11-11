import { z } from 'zod';

import type { PlacementWarning } from '../domain/assetPlacement';
import type { RouteWarning } from '../domain/cableRouteEdit';
import {
  COLLECTION_NAMES,
  COLLECTION_SCHEMAS,
  type CollectionName,
  isCollectionName,
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
  /**
   * Optional per-record version checks (Phase 8): the version each upserted or deleted record had
   * when this client last read it. If the stored version differs, someone else changed it, and the
   * whole change set is refused with `version_conflict` and the current record. Records with no
   * entry here are written as before (last write wins), so older clients keep working.
   */
  expect?: Partial<Record<CollectionName, Record<string, number>>>;
}

/** Version of each record, per collection: the network revision of the write that last stored it. */
export type RecordVersions = Partial<Record<CollectionName, Record<string, number>>>;

const collectionMap = <T extends z.ZodType>(item: (name: CollectionName) => T) =>
  z.strictObject(Object.fromEntries(COLLECTION_NAMES.map((name) => [name, z.array(item(name)).optional()])));

export const changeSetSchema = z.strictObject({
  upserts: collectionMap((name) => COLLECTION_SCHEMAS[name]).optional(),
  deletes: collectionMap(() => z.string().min(1)).optional(),
  expect: z
    .strictObject(Object.fromEntries(COLLECTION_NAMES.map((name) => [name, z.record(z.string().min(1), z.number().int().nonnegative()).optional()])))
    .optional(),
}) as unknown as z.ZodType<ChangeSet>;

export interface NetworkResponse {
  revision: number;
  data: NetworkSnapshot;
  /** Present on servers since Phase 8. Clients that ignore it keep last-write-wins behaviour. */
  versions?: RecordVersions;
}

/**
 * Phase 24: `GET /changes?since=<revision>`. Either every record stored or deleted after `since`
 * (with its version), or `reload: true` when the server's change history does not reach back that
 * far (a restore, a reset, a long time away): the device then loads the whole network once.
 */
export type ChangesResponse =
  | {
      revision: number;
      since: number;
      reload?: false;
      upserts: Partial<NetworkSnapshot>;
      deletes: Partial<Record<CollectionName, string[]>>;
      versions: RecordVersions;
    }
  | { revision: number; since: number; reload: true; reason: string };

/** Phase 24: `GET /network/area?bbox=south,west,north,east`: only records whose point, line or area touches the box. */
export interface AreaResponse {
  revision: number;
  bbox: [number, number, number, number];
  data: Partial<NetworkSnapshot>;
  versions: RecordVersions;
  /** More records touch the box than `limit`; the rest were left out. */
  truncated: boolean;
  limit: number;
}

/**
 * Phase 24b: some records with their versions, read in one transaction: `GET /network?except=` (every
 * collection but the named ones, in full) and `GET /network/records?ids=` (records by id). `data`
 * holds only the collections asked for; one that is absent was not asked for, not empty.
 */
export interface RecordsResponse {
  revision: number;
  data: Partial<NetworkSnapshot>;
  versions: RecordVersions;
}

export interface ChangeResult {
  revision: number;
  upserted: number;
  deleted: number;
  /** The new version of every record this change wrote. */
  versions?: RecordVersions;
  /**
   * Phase 3: things worth checking that did not stop the save, such as a new point within the
   * duplicate radius of one of the same kind. Present only when there is something to say.
   * Phase 5 adds `possible_duplicate_route`: a cable with the same two ends along the same line.
   */
  warnings?: (PlacementWarning | RouteWarning)[];
}

/** One record that changed on the server since the client read it. `record` is null when it was deleted. */
export interface VersionConflict {
  collection: CollectionName;
  id: string;
  expected: number;
  current: number | null;
  record: Record<string, unknown> | null;
}

export interface HealthResponse {
  status: 'ok';
  version: string;
  uptimeSeconds: number;
  /** Only for a logged-in session (or the server computer in setup mode): they describe the network. */
  revision?: number;
  counts?: Record<CollectionName, number>;
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
  /** With `version_conflict`: each record someone else changed, with the version now stored. */
  conflicts?: VersionConflict[];
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
