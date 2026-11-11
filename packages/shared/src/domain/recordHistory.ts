import type { CollectionName } from '../model/collections';
import type { AccountRole } from './access';
import type { PermissionAction } from './permissions';

/**
 * Phase 23: the server's own record of every write, kept beside the network in two tables the
 * browser cannot write to. `audit_events` says who changed what and when, with a short list of the
 * fields that changed (kept for good). `record_revisions` keeps the whole record after each change,
 * so two versions can be compared (old ones are removed after the retention the owner set).
 */

/** How the write reached the server. */
export const WRITE_SOURCES = ['changes', 'record', 'change_request', 'restore', 'reset', 'monitoring', 'server'] as const;
export type WriteSource = (typeof WRITE_SOURCES)[number];

export const WRITE_SOURCE_LABELS: Record<WriteSource, string> = {
  changes: 'App (sent changes)',
  record: 'Direct API (one record)',
  change_request: 'Approved change request',
  restore: 'Backup restore',
  reset: 'Reset to sample',
  monitoring: 'Monitoring feed',
  server: 'Server',
};

export type RevisionOp = 'create' | 'update' | 'delete';

/** One field that changed: values are short JSON text, cut when long. */
export interface FieldDiff {
  field: string;
  before?: string;
  after?: string;
}

/** Who made a write, as the server knew them. `id` is null in setup mode or for the server itself. */
export interface AuditActor {
  id: string | null;
  name: string;
  role: AccountRole | null;
}

export interface AuditEvent {
  seq: number;
  at: string;
  actorId: string | null;
  actorName: string;
  actorRole: AccountRole | null;
  source: WriteSource;
  collection: CollectionName;
  /** Empty for a summary line (many records in one write, such as a restore or monitoring rows). */
  recordId: string;
  op: RevisionOp | 'summary';
  /** What the change did, such as edit + move. */
  actions: PermissionAction[];
  /** The network revision the write made. */
  revision: number;
  diff: FieldDiff[];
  /** For a summary line: what it covered, in plain words. */
  note?: string;
  /** The change request this write applied, when it came from one. */
  changeRequestId?: string;
}

export interface RecordRevisionSummary {
  seq: number;
  collection: CollectionName;
  recordId: string;
  version: number;
  op: RevisionOp;
  at: string;
  actorId: string | null;
  actorName: string;
  source: WriteSource;
}

export interface RecordRevision extends RecordRevisionSummary {
  /** The whole record as stored after this change (for a delete: as it was just before). */
  data: Record<string, unknown>;
}

export interface RevisionComparison {
  collection: CollectionName;
  recordId: string;
  /** `null`: the record did not exist on that side. */
  before: { seq: number | 'current'; data: Record<string, unknown> | null };
  after: { seq: number | 'current'; data: Record<string, unknown> | null };
  fields: FieldDiff[];
}

/** How many days of revisions and how many per record the server keeps. */
export interface RevisionRetention {
  keepDays: number;
  keepPerRecord: number;
}

const MAX_VALUE = 200;
const MAX_FIELDS = 40;

const shortJson = (value: unknown, max: number): string | undefined => {
  if (value === undefined) return undefined;
  const text = JSON.stringify(value) ?? 'null';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
};

/**
 * The top-level fields that differ between two versions of a record, with short before and after
 * values. A created record lists the fields it was made with; a deleted one, the fields it had.
 */
export function diffRecords(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
  options: { maxFields?: number; maxValueLength?: number } = {},
): FieldDiff[] {
  const maxFields = options.maxFields ?? MAX_FIELDS;
  const maxValue = options.maxValueLength ?? MAX_VALUE;
  const left = before ?? {};
  const right = after ?? {};
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  const diff: FieldDiff[] = [];
  for (const field of keys) {
    if (stable(left[field]) === stable(right[field])) continue;
    const entry: FieldDiff = { field };
    const b = shortJson(left[field], maxValue);
    const a = shortJson(right[field], maxValue);
    if (b !== undefined) entry.before = b;
    if (a !== undefined) entry.after = a;
    diff.push(entry);
  }
  if (diff.length <= maxFields) return diff;
  return [...diff.slice(0, maxFields), { field: '…', after: `${diff.length - maxFields} more field(s) changed, not listed` }];
}

/** True when two stored records hold the same data (key order and unset fields ignored). */
export const sameRecord = (a: unknown, b: unknown): boolean => stable(a) === stable(b);
