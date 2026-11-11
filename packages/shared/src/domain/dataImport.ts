import type { ChangeSet } from '../model/api';
import { COLLECTION_SCHEMAS, type CollectionName } from '../model/collections';
import {
  type ImportChangedRecord,
  type ImportedCollection,
  type ImportFormat,
  type ImportRecord,
  importRecordSchema,
} from '../model/importSchemas';
import { sameJson } from './access';
import type { CommandContext, NetworkData } from './command';
import type { KmlFeatureInput, KmlGeometryInput, KmlPreview, KmlSkipped } from './kmlImport';
import { previewKml } from './kmlImport';

/**
 * Network mapping Phase 21: GeoJSON, CSV and Shapefile import through the KML preview pipeline,
 * import history, and undo by import ("rollback").
 *
 * - The person maps the file's columns to the fields here and sees the mapping before anything is
 *   saved. Nothing is read from a column the person did not choose; a column name only suggests.
 * - Positions must be WGS 84 latitude and longitude. Numbers outside that range are flagged and
 *   not imported. A Shapefile's `.prj` is read in the web app: WGS 84 is used as it is, a known
 *   other system is converted, an unknown one is refused (see `describePrj`).
 * - Every import is kept as an `imports` record with the ids it made and a fingerprint of each.
 *   An undo removes exactly those records through the normal write path, and is refused in plain
 *   words when one was changed since or something else now uses it.
 */

/* ------------------------------------------------------------------ */
/* Rows from a file, and the person's column mapping                   */
/* ------------------------------------------------------------------ */

/** One row or feature as read from a GeoJSON, CSV or Shapefile, values as written. */
export interface SourceRow {
  /** Order in the file, from 0. */
  index: number;
  /** The layer: the file or Shapefile layer name. */
  layer: string;
  properties: Record<string, string>;
  /** Present for GeoJSON and Shapefile. A CSV's position comes from the mapped columns. */
  geometry: KmlGeometryInput | null;
}

export const IMPORT_FIELDS = ['name', 'description', 'groupBy', 'coreCount', 'lat', 'lng', 'wkt'] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export type FieldMapping = Partial<Record<ImportField, string>>;

export const IMPORT_FIELD_LABELS: Record<ImportField, string> = {
  name: 'Name of each item',
  description: 'Notes or description',
  groupBy: 'Kind of item (splits the file into groups)',
  coreCount: 'Core count (cables only)',
  lat: 'Latitude',
  lng: 'Longitude',
  wkt: 'Shape written as text (WKT)',
};

/** Fields a CSV can use for its position. Other formats carry their own shapes. */
export const POSITION_FIELDS: readonly ImportField[] = ['lat', 'lng', 'wkt'];

export interface SourceColumn {
  key: string;
  /** Up to three different values, as written. */
  samples: string[];
  /** Rows with a value in this column. */
  filled: number;
}

/** The columns in the file, in the order first seen, with example values. */
export function sourceColumns(rows: readonly SourceRow[], limit = 200): SourceColumn[] {
  const byKey = new Map<string, SourceColumn>();
  for (const row of rows) {
    for (const [key, value] of Object.entries(row.properties)) {
      let col = byKey.get(key);
      if (!col) {
        if (byKey.size >= limit) continue;
        col = { key, samples: [], filled: 0 };
        byKey.set(key, col);
      }
      if (value.trim() === '') continue;
      col.filled += 1;
      if (col.samples.length < 3 && !col.samples.includes(value)) col.samples.push(value.length > 60 ? `${value.slice(0, 57)}…` : value);
    }
  }
  return [...byKey.values()];
}

const SUGGESTED: Partial<Record<ImportField, readonly string[]>> = {
  name: ['name', 'title', 'label'],
  description: ['description', 'desc', 'notes', 'remarks'],
  lat: ['lat', 'latitude'],
  lng: ['lng', 'lon', 'long', 'longitude'],
  wkt: ['wkt', 'the_geom', 'geometry_wkt'],
};

/**
 * A first choice only where a column is called exactly that ("Latitude", "name"), shown to the
 * person before anything is saved. Anything else starts as "not used".
 */
export function suggestMapping(columns: readonly SourceColumn[], format: ImportFormat): FieldMapping {
  const mapping: FieldMapping = {};
  for (const field of IMPORT_FIELDS) {
    if (format !== 'csv' && POSITION_FIELDS.includes(field)) continue;
    const words = SUGGESTED[field];
    if (!words) continue;
    const hit = columns.find((c) => words.includes(c.key.trim().toLowerCase()));
    if (hit) mapping[field] = hit.key;
  }
  return mapping;
}

/** Why this mapping cannot be used yet, in plain words, or null. */
export function importMappingProblem(format: ImportFormat, mapping: FieldMapping, columns: readonly SourceColumn[]): string | null {
  const known = new Set(columns.map((c) => c.key));
  for (const field of IMPORT_FIELDS) {
    const col = mapping[field];
    if (col !== undefined && !known.has(col)) return `The column "${col}" chosen for ${IMPORT_FIELD_LABELS[field].toLowerCase()} is not in this file.`;
  }
  if (format === 'csv') {
    if ((mapping.lat && !mapping.lng) || (!mapping.lat && mapping.lng)) return 'Choose both Latitude and Longitude, or neither.';
    if (mapping.lat && mapping.lat === mapping.lng) return 'Latitude and Longitude must be two different columns.';
    if (!(mapping.lat && mapping.lng) && !mapping.wkt) return 'Choose the Latitude and Longitude columns (or a column with the shape as WKT text). Without them nothing can be placed.';
  }
  return null;
}

/** The mapping in words, for the screen before saving and for the import record. */
export function describeMapping(format: ImportFormat, mapping: FieldMapping): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of IMPORT_FIELDS) {
    if (format !== 'csv' && POSITION_FIELDS.includes(field)) continue;
    out[`Column for ${IMPORT_FIELD_LABELS[field].toLowerCase()}`] = mapping[field] ? `"${mapping[field]}"` : 'not used';
  }
  return out;
}

/** A number as written, also with a decimal comma ("12,97"). Blank is undefined. */
function readNumber(text: string | undefined): number | undefined {
  const t = (text ?? '').trim();
  if (t === '') return undefined;
  const normal = /^[+-]?\d+,\d+$/.test(t) ? t.replace(',', '.') : t;
  return /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(normal) ? Number(normal) : Number.NaN;
}

const WKT_SRID = /^\s*SRID\s*=\s*(\d+)\s*;/i;

const wktPositions = (body: string): number[][] =>
  body
    .split(',')
    .map((p) => p.trim().split(/\s+/).map(Number))
    .filter((p) => p.length >= 2);

/**
 * A shape written as WKT (POINT, LINESTRING, MULTI… and POLYGON, so it can be refused with a
 * reason), longitude first. `srid` is the number after "SRID=", when written.
 */
export function parseWkt(text: string): { geometry: KmlGeometryInput | null; srid?: number } {
  const sridMatch = WKT_SRID.exec(text);
  const srid = sridMatch ? Number(sridMatch[1]) : undefined;
  const body = text.replace(WKT_SRID, '').trim();
  const head = /^([A-Za-z]+)\s*(?:Z|M|ZM)?\s*\((.*)\)\s*$/s.exec(body);
  if (!head) return { geometry: null, ...(srid !== undefined ? { srid } : {}) };
  const kind = head[1]!.toUpperCase();
  const inner = head[2]!.trim();
  const parts = (s: string) => s.split(/\)\s*,\s*\(/).map((p) => p.replace(/[()]/g, ''));
  let geometry: KmlGeometryInput | null = null;
  if (kind === 'POINT') geometry = { type: 'Point', coordinates: wktPositions(inner)[0] };
  else if (kind === 'LINESTRING') geometry = { type: 'LineString', coordinates: wktPositions(inner) };
  else if (kind === 'MULTIPOINT') geometry = { type: 'MultiPoint', coordinates: parts(inner).flatMap(wktPositions) };
  else if (kind === 'MULTILINESTRING') geometry = { type: 'MultiLineString', coordinates: parts(inner).map(wktPositions) };
  else if (kind === 'POLYGON') geometry = { type: 'Polygon', coordinates: [] };
  else if (kind === 'MULTIPOLYGON') geometry = { type: 'MultiPolygon', coordinates: [] };
  else geometry = { type: kind };
  return { geometry, ...(srid !== undefined ? { srid } : {}) };
}

/** One part in a "multi" shape is just that part. Two or more stay multi (and are refused with a reason). */
function singlePart(geometry: KmlGeometryInput | null): KmlGeometryInput | null {
  if (!geometry || !Array.isArray(geometry.coordinates) || geometry.coordinates.length !== 1) return geometry;
  if (geometry.type === 'MultiLineString') return { type: 'LineString', coordinates: geometry.coordinates[0] };
  if (geometry.type === 'MultiPoint') return { type: 'Point', coordinates: geometry.coordinates[0] };
  return geometry;
}

export interface SourcePreview extends KmlPreview {
  /** Rows whose core count cell was not a whole number from 1 to 1728; left as not recorded. */
  badCoreCounts: number;
  /** What the position numbers look like (outside the range, swapped). */
  positions: PositionCheck;
}

const MAX_CORES = 1728;

/**
 * Turns rows into the same features a KML gives, using only the columns the person chose, then
 * runs the KML preview on them. Every column is kept as written in the record's import details.
 */
export function previewSourceRows(rows: readonly SourceRow[], mapping: FieldMapping, format: ImportFormat): SourcePreview {
  const features: KmlFeatureInput[] = [];
  const early: KmlSkipped[] = [];
  let badCoreCounts = 0;
  for (const row of rows) {
    const p = row.properties;
    const cell = (field: ImportField) => (mapping[field] ? (p[mapping[field]!] ?? '').trim() : '');
    const name = cell('name');
    const kind = mapping.groupBy ? cell('groupBy') || '(blank)' : '';
    const folderPath = [row.layer, kind].filter(Boolean).join(' / ');
    let geometry = row.geometry;
    if (format === 'csv') {
      geometry = null;
      if (mapping.wkt && cell('wkt')) {
        const wkt = parseWkt(cell('wkt'));
        if (wkt.srid !== undefined && wkt.srid !== 4326) {
          early.push({ index: row.index, ...(name ? { name } : {}), folderPath, reason: `Its shape is written in coordinate system ${wkt.srid} (SRID). Only WGS 84 (4326) can be read here: save it again as WGS 84.` });
          continue;
        }
        if (!wkt.geometry) {
          early.push({ index: row.index, ...(name ? { name } : {}), folderPath, reason: 'Its shape text (WKT) could not be read.' });
          continue;
        }
        geometry = wkt.geometry;
      } else if (mapping.lat && mapping.lng) {
        const lat = readNumber(cell('lat'));
        const lng = readNumber(cell('lng'));
        if (lat !== undefined || lng !== undefined) geometry = { type: 'Point', coordinates: [lng ?? Number.NaN, lat ?? Number.NaN] };
      }
    }
    let coreCount: number | undefined;
    if (mapping.coreCount && cell('coreCount')) {
      const n = readNumber(cell('coreCount'));
      if (n !== undefined && Number.isInteger(n) && n >= 1 && n <= MAX_CORES) coreCount = n;
      else badCoreCounts += 1;
    }
    const description = cell('description');
    features.push({
      index: row.index,
      folderPath,
      ...(name ? { name } : {}),
      ...(description ? { description } : {}),
      geometry: singlePart(geometry),
      extendedData: Object.fromEntries(Object.entries(p).filter(([, v]) => v.trim() !== '')),
      ...(coreCount !== undefined ? { coreCount } : {}),
    });
  }
  const preview = previewKml(features);
  const skipped = [...early, ...preview.skipped].sort((a, b) => a.index - b.index);
  return { ...preview, total: rows.length, skipped, badCoreCounts, positions: checkPositions(features) };
}

/* ------------------------------------------------------------------ */
/* Coordinate checks                                                   */
/* ------------------------------------------------------------------ */

export interface PositionCheck {
  /** Positions looked at. */
  checked: number;
  /** Latitude beyond ±90 or longitude beyond ±180: not latitude and longitude at all. */
  outsideRange: number;
  /** Latitude and longitude that look the wrong way round for India. */
  swapped: number;
  /** Plain words for the person, or null when every position looks like WGS 84. */
  message: string | null;
}

/** Every [x, y] position in a geometry, at any depth. */
function positionsOf(raw: unknown, out: number[][]): void {
  if (!Array.isArray(raw)) return;
  if (raw.length >= 2 && typeof raw[0] === 'number' && typeof raw[1] === 'number') {
    out.push(raw as number[]);
    return;
  }
  for (const item of raw) positionsOf(item, out);
}

/** Flags numbers that cannot be WGS 84 latitude and longitude. Those features are not imported (the preview says why). */
export function checkPositions(features: readonly KmlFeatureInput[]): PositionCheck {
  let checked = 0;
  let outsideRange = 0;
  let swapped = 0;
  for (const f of features) {
    const list: number[][] = [];
    positionsOf(f.geometry?.coordinates, list);
    for (const g of f.geometry?.geometries ?? []) positionsOf((g as KmlGeometryInput | null)?.coordinates, list);
    for (const [lng, lat] of list) {
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      checked += 1;
      if (Math.abs(lat!) > 90 || Math.abs(lng!) > 180) outsideRange += 1;
      else if (lat! >= 68 && lat! <= 98 && lng! >= 6 && lng! <= 38) swapped += 1;
    }
  }
  const parts: string[] = [];
  if (outsideRange > 0) {
    parts.push(
      `${outsideRange} position(s) have numbers outside the latitude and longitude range. The file may use another coordinate system, such as UTM in metres. Only WGS 84 latitude and longitude can be imported: save the file again as WGS 84 (EPSG:4326) and import it again.`,
    );
  }
  if (swapped > 0) {
    parts.push(`${swapped} position(s) look like latitude and longitude the wrong way round. Check which column is Latitude and which is Longitude, or fix the file.`);
  }
  return { checked, outsideRange, swapped, message: parts.length ? `${parts.join(' ')} Those items are not imported; nothing is moved automatically.` : null };
}

/** What a Shapefile's `.prj` says. `wgs84` only for plain WGS 84 latitude and longitude. */
export function describePrj(text: string): { wgs84: boolean; name: string } {
  const t = text.trim();
  const name = /^[A-Z_]+\s*\[\s*"([^"]+)"/i.exec(t)?.[1] ?? (t.slice(0, 60) || 'not named');
  const geographic = /^GEOGCS\s*\[/i.test(t) && !/PROJCS\s*\[/i.test(t);
  const wgs = /WGS[ _]?(19)?84/i.test(t) || /D_WGS_1984/i.test(t);
  return { wgs84: geographic && wgs, name };
}

const WGS84_CRS_NAMES = new Set(['urn:ogc:def:crs:ogc:1.3:crs84', 'urn:ogc:def:crs:ogc::crs84', 'epsg:4326', 'urn:ogc:def:crs:epsg::4326', 'urn:ogc:def:crs:epsg:6.6:4326', 'crs84']);

/**
 * GeoJSON is WGS 84 longitude and latitude (RFC 7946). An older file may name another system in a
 * `crs` member; it is refused with a plain message, since nothing here can convert it safely.
 */
export function geoJsonCrsProblem(json: unknown): string | null {
  const crs = (json as { crs?: { type?: unknown; properties?: { name?: unknown; href?: unknown } } } | null)?.crs;
  if (!crs || typeof crs !== 'object') return null;
  const name = typeof crs.properties?.name === 'string' ? crs.properties.name : typeof crs.properties?.href === 'string' ? crs.properties.href : 'not named';
  if (crs.type === 'name' && WGS84_CRS_NAMES.has(String(name).trim().toLowerCase())) return null;
  return `This GeoJSON says its coordinate system is "${name}". Only WGS 84 latitude and longitude can be read here. Save it again as WGS 84 (EPSG:4326), for example in QGIS, then import it again. Nothing was imported.`;
}

/* ------------------------------------------------------------------ */
/* Fingerprints                                                        */
/* ------------------------------------------------------------------ */

/** JSON with keys in order and unset values left out, so the same record always gives the same text. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? 'null' : stableJson(v))).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function fnv1a(text: string, seed: number): string {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * A short fingerprint of a record as stored: read through its schema first (as the server stores
 * it), so the same record always gives the same fingerprint and any change gives another.
 */
export function fingerprintRecord(collection: CollectionName, record: unknown): string {
  const parsed = COLLECTION_SCHEMAS[collection].safeParse(record);
  const text = stableJson(parsed.success ? parsed.data : record);
  return `${fnv1a(text, 0x811c9dc5)}${fnv1a(text, 0x01234567)}`;
}

/* ------------------------------------------------------------------ */
/* Import history                                                      */
/* ------------------------------------------------------------------ */

export const importsOf = (data: Partial<Pick<NetworkData, 'imports'>>): ImportRecord[] => data.imports ?? [];

/** Newest first. */
export const importsNewestFirst = (list: readonly ImportRecord[]): ImportRecord[] => [...list].sort((a, b) => (a.importedAt < b.importedAt ? 1 : a.importedAt > b.importedAt ? -1 : 0));

type RecordOf = { id: string; name?: string };
const recordsOf = (data: NetworkData, collection: ImportedCollection): readonly RecordOf[] => (data[collection] ?? []) as readonly RecordOf[];

/** Collections never looked at for "something else uses it": history, findings about records, import records. */
const NOT_DEPENDENTS = new Set(['imports', 'auditLogs', 'validationFindings']);

const COLLECTION_WORD: Record<string, string> = {
  equipment: 'Item',
  cables: 'Cable',
  ducts: 'Duct',
  spans: 'Span',
  attachments: 'Pole attachment',
  slackLoops: 'Slack loop',
  permissions: 'Permission',
  customers: 'Customer',
  splitters: 'Splitter',
  closures: 'Closure',
  buildings: 'Building',
  onts: 'ONT',
  faults: 'Fault',
  workOrders: 'Job',
  alarms: 'Alarm',
  inspections: 'Inspection',
  cableSegments: 'Cable stretch',
  linkVerifications: 'Link check',
  documents: 'Document',
  sites: 'Site',
  racks: 'Rack',
};

/** Every string anywhere inside a record that is one of these ids, except the record's own id. */
function idsUsed(record: unknown, ids: ReadonlySet<string>, found: Set<string>, top = true): void {
  if (typeof record === 'string') {
    if (ids.has(record)) found.add(record);
    return;
  }
  if (Array.isArray(record)) {
    for (const item of record) idsUsed(item, ids, found, false);
    return;
  }
  if (!record || typeof record !== 'object') return;
  for (const [key, value] of Object.entries(record as Record<string, unknown>)) {
    if (top && key === 'id') continue;
    idsUsed(value, ids, found, false);
  }
}

export interface RollbackBlocker {
  collection: string;
  id: string;
  message: string;
}

export type RollbackPlan =
  | {
      ok: true;
      record: ImportRecord;
      /** The import record as it will be stored: marked undone, with who and when. */
      updated: ImportRecord;
      /** One change set for `POST /changes`: deletes, restores and the updated import record. */
      changes: ChangeSet;
      removed: number;
      restored: number;
      /** Records of this import someone already deleted. Nothing to do for them. */
      alreadyGone: number;
      summary: string;
    }
  | { ok: false; title: string; message: string; blockers: RollbackBlocker[] };

const nameOf = (r: RecordOf | undefined, id: string) => (r?.name ? `"${r.name}" (${id})` : id);

/**
 * What undoing one import would do, or why it cannot yet. Removes the records it made and puts
 * back the ones it changed, exactly those. Refused when one of them was changed since the import,
 * or a record outside the import now uses one of them (a span on an imported pole, a customer on
 * an imported box): undoing would break that later work, so the person decides what to do first.
 */
export function planImportRollback(data: NetworkData, importId: string, ctx: CommandContext & { note?: string } = {}): RollbackPlan {
  const record = importsOf(data).find((r) => r.id === importId);
  if (!record) return { ok: false, title: 'Import not found', message: `There is no import ${importId} in the history. Nothing was changed.`, blockers: [] };
  if (record.rolledBackAt) {
    return { ok: false, title: 'Already undone', message: `This import was undone on ${record.rolledBackAt.slice(0, 10)} by ${record.rolledBackBy ?? 'someone'}. Nothing was changed.`, blockers: [] };
  }
  const blockers: RollbackBlocker[] = [];
  const deletes = new Map<ImportedCollection, string[]>();
  const restores = new Map<ImportedCollection, Record<string, unknown>[]>();
  const removing = new Set<string>();
  const removingNames = new Map<string, string>();
  let alreadyGone = 0;

  for (const ref of record.created) {
    const current = recordsOf(data, ref.collection).find((r) => r.id === ref.id);
    if (!current) {
      alreadyGone += 1;
      continue;
    }
    if (fingerprintRecord(ref.collection, current) !== ref.fingerprint) {
      blockers.push({ collection: ref.collection, id: ref.id, message: `${COLLECTION_WORD[ref.collection]} ${nameOf(current, ref.id)} was changed after the import. Undo would lose that change.` });
      continue;
    }
    deletes.set(ref.collection, [...(deletes.get(ref.collection) ?? []), ref.id]);
    removing.add(ref.id);
    removingNames.set(ref.id, nameOf(current, ref.id));
  }
  for (const ref of record.changed as ImportChangedRecord[]) {
    const current = recordsOf(data, ref.collection).find((r) => r.id === ref.id);
    if (!current) {
      blockers.push({ collection: ref.collection, id: ref.id, message: `${COLLECTION_WORD[ref.collection]} ${ref.id}, which the import changed, was deleted after it. It cannot be put back as it was.` });
      continue;
    }
    if (fingerprintRecord(ref.collection, current) !== ref.fingerprint) {
      blockers.push({ collection: ref.collection, id: ref.id, message: `${COLLECTION_WORD[ref.collection]} ${nameOf(current, ref.id)} was changed again after the import. Undo would lose that change.` });
      continue;
    }
    restores.set(ref.collection, [...(restores.get(ref.collection) ?? []), { ...ref.before, id: ref.id }]);
  }

  if (removing.size > 0) {
    // Records this undo deletes or puts back are not "something else".
    const handled = new Set([
      ...[...deletes].flatMap(([c, ids]) => ids.map((id) => `${c}:${id}`)),
      ...[...restores].flatMap(([c, list]) => list.map((r) => `${c}:${String(r.id)}`)),
    ]);
    for (const [collection, list] of Object.entries(data)) {
      if (NOT_DEPENDENTS.has(collection) || !Array.isArray(list)) continue;
      for (const item of list as RecordOf[]) {
        if (handled.has(`${collection}:${item.id}`)) continue;
        const found = new Set<string>();
        idsUsed(item, removing, found);
        for (const id of found) {
          blockers.push({
            collection,
            id: item.id,
            message: `${COLLECTION_WORD[collection] ?? collection} ${nameOf(item, item.id)} uses ${removingNames.get(id) ?? id} from this import. Remove that link first, or keep the import.`,
          });
        }
      }
    }
  }

  if (blockers.length > 0) {
    const shown = blockers.slice(0, 3).map((b) => b.message);
    return {
      ok: false,
      title: 'This import cannot be undone yet',
      message: `${shown.join(' ')}${blockers.length > 3 ? ` And ${blockers.length - 3} more.` : ''} Nothing was changed.`,
      blockers,
    };
  }

  const removed = [...deletes.values()].reduce((n, ids) => n + ids.length, 0);
  const restored = [...restores.values()].reduce((n, list) => n + list.length, 0);
  if (removed + restored === 0 && alreadyGone === 0) {
    return { ok: false, title: 'Nothing to undo', message: 'This import made no records. Nothing was changed.', blockers: [] };
  }
  const now = (ctx.now ?? new Date()).toISOString();
  const note = ctx.note?.trim();
  const updated: ImportRecord = { ...record, rolledBackAt: now, rolledBackBy: ctx.actor?.trim() || 'Not recorded', ...(note ? { rollbackNote: note.slice(0, 500) } : {}) };
  const upserts: Record<string, unknown[]> = { imports: [updated] };
  for (const [collection, list] of restores) upserts[collection] = list;
  const changes: ChangeSet = {
    upserts: upserts as ChangeSet['upserts'],
    ...(deletes.size > 0 ? { deletes: Object.fromEntries(deletes) as ChangeSet['deletes'] } : {}),
  };
  const summary = `${removed} item(s) removed${restored ? `, ${restored} put back as they were` : ''}${alreadyGone ? `; ${alreadyGone} had already been deleted` : ''}.`;
  return { ok: true, record, updated, changes, removed, restored, alreadyGone, summary };
}

/* ------------------------------------------------------------------ */
/* Server check                                                        */
/* ------------------------------------------------------------------ */

export const changeSetTouchesImports = (changes: ChangeSet): boolean =>
  (changes.upserts?.imports?.length ?? 0) > 0 || (changes.deletes?.imports?.length ?? 0) > 0;

export interface ImportRecordProblem {
  id: string;
  message: string;
}

const UNDO_FIELDS = new Set(['rolledBackAt', 'rolledBackBy', 'rollbackNote']);
const withoutUndo = (r: ImportRecord) => Object.fromEntries(Object.entries(r).filter(([k]) => !UNDO_FIELDS.has(k)));

/**
 * Import records are history. What an import made, who made it and what they chose is never
 * rewritten; only the undo (who, when, a note) may be added, once. An undone import is kept. A
 * record not undone may be deleted, which is what the app's own Undo of the import step does.
 */
export function checkChangeSetImports(changes: ChangeSet, stored: (id: string) => ImportRecord | undefined): ImportRecordProblem[] {
  const problems: ImportRecordProblem[] = [];
  for (const id of changes.deletes?.imports ?? []) {
    const before = stored(id);
    if (before?.rolledBackAt) problems.push({ id, message: `Import ${id} was undone and is kept as history. It cannot be deleted.` });
  }
  for (const r of changes.upserts?.imports ?? []) {
    const parsed = importRecordSchema.safeParse(r);
    if (!parsed.success) {
      problems.push({ id: r.id, message: `Import record ${r.id}: ${parsed.error.issues[0]?.message ?? 'not a valid import record'}.` });
      continue;
    }
    const before = stored(r.id);
    if (!before) continue;
    if (!sameJson(withoutUndo(before), withoutUndo(parsed.data))) {
      problems.push({ id: r.id, message: `Import record ${r.id}: what the import made, who made it and what they chose is history and cannot be changed.` });
      continue;
    }
    if (before.rolledBackAt && (before.rolledBackAt !== parsed.data.rolledBackAt || before.rolledBackBy !== parsed.data.rolledBackBy)) {
      problems.push({ id: r.id, message: `Import record ${r.id}: it was already undone on ${before.rolledBackAt.slice(0, 10)}. That cannot be changed.` });
    }
  }
  return problems;
}
