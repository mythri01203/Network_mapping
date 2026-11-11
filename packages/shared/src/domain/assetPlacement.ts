import type { ChangeSet } from '../model/api';
import type { AuditLog, Equipment, LatLng, Setting } from '../model/types';
import { hasRecordedLocation, isValidCoordinate } from './defaults';
import { distanceMeters } from './fieldCapture';
import { polylineLengthMeters } from './geo';
import { type OspSettings, resolveOspSettings } from './ospSettings';
import { hasPlacedPosition, sameKind } from './outsidePlant';

/**
 * Phase 3: the ways to place an item besides tapping the map (typed coordinates, at an existing
 * structure, a copy of another item, a row along a drawn line), copying settings between items,
 * an item's history, and the server's "possible duplicate" warning. Nothing here links two
 * records, fills in a fact nobody gave, or blocks a save because of a guess.
 */

export type MaintenanceEntry = NonNullable<Equipment['maintenance']>[number];

/* ------------------------------------------------------------------ */
/* Typed coordinates                                                   */
/* ------------------------------------------------------------------ */

/** India's mainland and islands, from the fibergis-osp-mapping skill. Latitude and longitude do not overlap. */
export const INDIA_BOUNDS = { minLat: 6, maxLat: 38, minLng: 68, maxLng: 98 } as const;

const inIndia = (lat: number, lng: number) =>
  lat >= INDIA_BOUNDS.minLat && lat <= INDIA_BOUNDS.maxLat && lng >= INDIA_BOUNDS.minLng && lng <= INDIA_BOUNDS.maxLng;

/** Plain decimal degrees: an optional sign, digits, an optional dot and more digits. */
const DECIMAL = /^[+-]?\d{1,3}(\.\d+)?$/;

/** Roughly how far one step in the last decimal place moves a point, in metres. */
const DECIMAL_STEP_METERS = [111_000, 11_000, 1_100, 110, 11, 1.1];

export interface TypedCoordinateCheck {
  ok: boolean;
  lat?: number;
  lng?: number;
  /** Why the numbers cannot be used at all. */
  error?: string;
  /** Things to check; the person may still use the numbers. */
  warnings: string[];
  /**
   * The two numbers the other way round, offered when that looks like what was meant (India's
   * latitude and longitude cannot overlap). Never applied automatically: the person chooses.
   */
  swapped?: { lat: number; lng: number };
}

const decimalsOf = (text: string) => (text.includes('.') ? text.split('.')[1].length : 0);

/**
 * Reads coordinates a person typed or pasted. `latText` may hold both numbers ("12.9716, 77.5946")
 * when `lngText` is empty. Only plain decimal degrees are read; anything else is refused with what to
 * type instead. Impossible values (out of range, 0,0 which means "not recorded") are errors. A swap,
 * a place outside India and too few decimals are warnings.
 */
export function checkTypedCoordinates(latText: string, lngText = ''): TypedCoordinateCheck {
  let latRaw = latText.trim();
  let lngRaw = lngText.trim();
  if (!lngRaw) {
    const parts = latRaw.split(/[\s,;]+/).filter(Boolean);
    if (parts.length === 2) [latRaw, lngRaw] = parts;
  }
  if (!latRaw || !lngRaw) {
    return { ok: false, error: 'Type both numbers: latitude first (like 12.971599), then longitude (like 77.594566).', warnings: [] };
  }
  if (!DECIMAL.test(latRaw) || !DECIMAL.test(lngRaw)) {
    return {
      ok: false,
      error: 'Type decimal degrees with a dot, like 12.971599. Degrees, minutes and seconds (12°58′17″) and letters such as N or E are not read.',
      warnings: [],
    };
  }
  const lat = Number(latRaw);
  const lng = Number(lngRaw);
  const swappedValid = isValidCoordinate(lng, lat);
  if (!isValidCoordinate(lat, lng)) {
    return {
      ok: false,
      error: 'Latitude must be between -90 and 90, and longitude between -180 and 180.',
      warnings: [],
      ...(swappedValid && Math.abs(lat) > 90 ? { swapped: { lat: lng, lng: lat } } : {}),
    };
  }
  if (!hasRecordedLocation({ lat, lng })) {
    return { ok: false, error: '0, 0 means "no place recorded". Type the real position.', warnings: [] };
  }

  const warnings: string[] = [];
  let swapped: TypedCoordinateCheck['swapped'];
  if (!inIndia(lat, lng) && inIndia(lng, lat)) {
    swapped = { lat: lng, lng: lat };
    warnings.push(
      `These look swapped. In India the latitude is ${INDIA_BOUNDS.minLat} to ${INDIA_BOUNDS.maxLat} and the longitude ${INDIA_BOUNDS.minLng} to ${INDIA_BOUNDS.maxLng}, so you may mean latitude ${lng}, longitude ${lat}.`,
    );
  } else if (!inIndia(lat, lng)) {
    warnings.push('This place is outside India. Check the numbers before saving.');
  }
  const decimals = Math.min(decimalsOf(latRaw), decimalsOf(lngRaw));
  if (decimals < 5) {
    warnings.push(
      `Only ${decimals} decimal place${decimals === 1 ? '' : 's'}: the pin can be about ${formatStep(DECIMAL_STEP_METERS[decimals])} off. Six decimals, like 12.971599, is about 10 cm.`,
    );
  }
  return { ok: true, lat, lng, warnings, ...(swapped ? { swapped } : {}) };
}

const formatStep = (meters: number) => (meters >= 1000 ? `${Math.round(meters / 1000)} km` : `${Math.round(meters)} m`);

/* ------------------------------------------------------------------ */
/* Duplicate an item                                                   */
/* ------------------------------------------------------------------ */

/**
 * What a copy of an item takes from it: what the item is, not facts about the one unit. Never its
 * id, name, serial number, tag, photos, connections, ports in use, install date, place, owner,
 * readings, notes, warranty, condition or maintenance.
 */
export const DUPLICATE_COPIED_FIELDS = [
  'type',
  'category',
  'manufacturer',
  'model',
  'catalogModelId',
  'specOverrides',
  'status',
  'totalPorts',
  'technology',
  'splitterConfig',
] as const satisfies readonly (keyof Equipment)[];

/** The template a copy is placed from. The new item gets its own id and name when it is placed. */
export function duplicateTemplate(source: Equipment): Partial<Equipment> {
  const template: Partial<Equipment> = {};
  for (const key of DUPLICATE_COPIED_FIELDS) {
    const value = source[key];
    if (value === undefined) continue;
    (template as Record<string, unknown>)[key] = Array.isArray(value) ? value.map((v) => ({ ...v })) : typeof value === 'object' ? { ...value } : value;
  }
  if (template.totalPorts !== undefined) {
    // A copy starts with every port free: connections are never copied.
    template.usedPorts = 0;
    template.availablePorts = template.totalPorts;
  }
  return template;
}

/* ------------------------------------------------------------------ */
/* Copy settings from another item                                     */
/* ------------------------------------------------------------------ */

export const COPYABLE_SETTINGS = ['manufacturer', 'model', 'catalogModelId', 'specOverrides', 'status'] as const;
export type CopyableSetting = (typeof COPYABLE_SETTINGS)[number];

export const COPYABLE_SETTING_LABELS: Record<CopyableSetting, string> = {
  manufacturer: 'Manufacturer',
  model: 'Model',
  catalogModelId: 'Catalogue model',
  specOverrides: 'Specs changed for the item',
  status: 'Status',
};

export interface SettingsCopyLine {
  field: CopyableSetting;
  before?: string;
  after?: string;
  /** `set`: takes the other item's value. `same`: already equal. `kept`: the other item has nothing recorded, so this one keeps its own. `removed`: see `reason`. */
  change: 'set' | 'same' | 'kept' | 'removed';
  reason?: string;
}

const describeSetting = (e: Equipment, field: CopyableSetting): string | undefined => {
  const value = e[field];
  if (value === undefined || value === '') return undefined;
  if (Array.isArray(value)) return value.length ? value.map((s) => `${s.key}: ${s.value}${s.unit ? ` ${s.unit}` : ''}`).join('; ') : undefined;
  return String(value);
};

/**
 * Copies make, model, catalogue model, spec changes and status from `source` onto `target`, and
 * says what each one does. A setting the source has not recorded is left as the target has it,
 * never cleared, except the catalogue link: if the source has a make or model but no link, the
 * target's link is removed so it cannot contradict the copied make and model.
 */
export function copySettingsPlan(target: Equipment, source: Equipment): { next: Equipment; lines: SettingsCopyLine[]; changed: boolean } {
  const next: Record<string, unknown> = { ...target };
  const lines: SettingsCopyLine[] = [];
  for (const field of COPYABLE_SETTINGS) {
    const before = describeSetting(target, field);
    const after = describeSetting(source, field);
    if (after === undefined) {
      const unlink = field === 'catalogModelId' && target.catalogModelId && (source.manufacturer || source.model);
      if (unlink) {
        delete next.catalogModelId;
        lines.push({ field, before, change: 'removed', reason: `${source.name} is not linked to a catalogue model, so this link would not match the copied make and model.` });
      } else {
        lines.push({ field, before, after: before, change: 'kept', reason: `Not recorded on ${source.name}: left as it is.` });
      }
      continue;
    }
    const value = source[field];
    next[field] = Array.isArray(value) ? value.map((s) => ({ ...s })) : value;
    lines.push({ field, before, after, change: before === after ? 'same' : 'set' });
  }
  return { next: next as Equipment, lines, changed: lines.some((l) => l.change === 'set' || l.change === 'removed') };
}

/* ------------------------------------------------------------------ */
/* A row of items along a drawn line                                   */
/* ------------------------------------------------------------------ */

/** The most items one line places, so a slip of the finger cannot add thousands. */
export const LINE_PLACEMENT_MAX = 200;

export interface LinePlacementPlan {
  ok: boolean;
  error?: string;
  points: LatLng[];
  lengthMeters: number;
  /** Distance from the last spaced item to the end of the line (before any item at the end). */
  lastGapMeters: number;
  /** True when an extra item was put at the end of the line. */
  endAdded: boolean;
}

/** The point `along` metres from the start of the line, on the drawn segments. */
function pointAt(line: readonly LatLng[], along: number): LatLng {
  let travelled = 0;
  for (let i = 0; i < line.length - 1; i += 1) {
    const segment = polylineLengthMeters([line[i], line[i + 1]]);
    if (segment > 0 && along <= travelled + segment + 1e-9) {
      const t = Math.max(0, Math.min(1, (along - travelled) / segment));
      return [line[i][0] + t * (line[i + 1][0] - line[i][0]), line[i][1] + t * (line[i + 1][1] - line[i][1])];
    }
    travelled += segment;
  }
  return line[line.length - 1];
}

/**
 * Places for items along a drawn line: one at the start, then one every `spacingMeters` measured
 * along the line, and, when `includeEnd`, one at the end if the last gap is more than half a metre.
 * The spacing is what the person typed; nothing is rounded to a "standard" span.
 */
export function pointsAlongLine(line: readonly LatLng[], spacingMeters: number, includeEnd: boolean): LinePlacementPlan {
  const lengthMeters = polylineLengthMeters([...line]);
  const empty = (error: string): LinePlacementPlan => ({ ok: false, error, points: [], lengthMeters, lastGapMeters: 0, endAdded: false });
  if (line.length < 2 || lengthMeters <= 0) return empty('Draw a line with at least two different points.');
  if (!Number.isFinite(spacingMeters) || spacingMeters < 1) return empty('Type the gap between items in metres: 1 or more.');
  const count = Math.floor(lengthMeters / spacingMeters + 1e-9) + 1;
  const lastSpaced = (count - 1) * spacingMeters;
  const lastGapMeters = Math.max(0, lengthMeters - lastSpaced);
  const endAdded = includeEnd && lastGapMeters > 0.5;
  const total = count + (endAdded ? 1 : 0);
  if (total > LINE_PLACEMENT_MAX) {
    return empty(`That would place ${total} items. One line places at most ${LINE_PLACEMENT_MAX}: use a bigger gap or a shorter line.`);
  }
  const points: LatLng[] = [];
  for (let i = 0; i < count; i += 1) points.push(pointAt(line, i * spacingMeters));
  if (endAdded) points.push(line[line.length - 1]);
  return { ok: true, points, lengthMeters, lastGapMeters, endAdded };
}

/* ------------------------------------------------------------------ */
/* History of one item                                                 */
/* ------------------------------------------------------------------ */

export interface AssetHistoryLine {
  at: string;
  by?: string;
  action: string;
  details: string;
  /** Where the line comes from: the audit trail, or a history list kept inside the record. */
  source: 'audit' | 'record';
  /** For a line from inside the record, which part of it, such as "Panel A, port 3". */
  part?: string;
}

const timeOf = (text: string) => {
  const t = Date.parse(text);
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
};

/**
 * Only what is on record for this item, newest first: audit entries whose asset is this item, and
 * the history lists kept inside it (ODF port history). Nothing is worked out or filled in, and an
 * item with no entries gives an empty list.
 */
export function assetHistory(equipment: Equipment, auditLogs: readonly AuditLog[]): AssetHistoryLine[] {
  const lines: AssetHistoryLine[] = auditLogs
    .filter((log) => log.assetId === equipment.id)
    .map((log) => ({ at: log.timestamp, by: log.user, action: log.action, details: log.details, source: 'audit' as const }));
  for (const panel of equipment.odfPanels ?? []) {
    for (const port of panel.ports) {
      for (const entry of port.history ?? []) {
        lines.push({ at: entry.at, by: entry.by, action: entry.action, details: entry.details, source: 'record', part: `${panel.label}, port ${port.number}` });
      }
    }
  }
  return lines.sort((a, b) => timeOf(b.at) - timeOf(a.at));
}

/* ------------------------------------------------------------------ */
/* Maintenance                                                         */
/* ------------------------------------------------------------------ */

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const isDay = (text: string) => DAY.test(text) && !Number.isNaN(Date.parse(`${text}T00:00:00Z`));

/** Problems with a maintenance entry before it is saved, in plain words. Empty: fine to save. */
export function maintenanceProblems(entry: { date: string; by: string; what: string; nextDue?: string }): string[] {
  const problems: string[] = [];
  if (!isDay(entry.date)) problems.push('Pick the day the work was done.');
  if (!entry.by.trim()) problems.push('Write who did the work.');
  if (!entry.what.trim()) problems.push('Write what was done.');
  if (entry.nextDue && !isDay(entry.nextDue)) problems.push('Pick the next check day, or leave it empty.');
  if (entry.nextDue && isDay(entry.date) && isDay(entry.nextDue) && entry.nextDue < entry.date) {
    problems.push('The next check is before the work was done. Check the dates.');
  }
  return problems;
}

/** The latest next-check day anyone recorded. Undefined: none recorded (never worked out from a rule). */
export function nextMaintenanceDue(entries: readonly MaintenanceEntry[] | undefined): string | undefined {
  const dues = (entries ?? []).map((e) => e.nextDue).filter((d): d is string => Boolean(d)).sort();
  return dues.length ? dues[dues.length - 1] : undefined;
}

/* ------------------------------------------------------------------ */
/* Server: possible duplicate points                                   */
/* ------------------------------------------------------------------ */

/** The audit action the browser writes when a person says "No, add a new one" to "same one?". */
export const POSSIBLE_DUPLICATE_KEPT = 'POSSIBLE_DUPLICATE_KEPT';

export interface PlacementWarning {
  rule: 'possible_duplicate';
  /** The new item. */
  equipmentId: string;
  name: string;
  /** The item of the same kind already this close. */
  nearId: string;
  nearName: string;
  distanceMeters: number;
  /** The same change carries the person's "add a new one" choice for this item. */
  overridden: boolean;
  message: string;
}

/**
 * Warnings, never refusals, for new points in a change set that land within the duplicate radius
 * of an item of the same kind: one already stored, or one earlier in the same change. Edits and
 * moves of stored items are not checked, nor items whose position is a placeholder. Uses the
 * operator's `osp.duplicate.radiusMeters` setting.
 */
export function newPointDuplicateWarnings(
  stored: readonly Equipment[],
  changes: ChangeSet,
  settings: Pick<OspSettings, 'duplicateRadiusMeters'> | readonly Pick<Setting, 'id' | 'value'>[],
): PlacementWarning[] {
  const radius = 'duplicateRadiusMeters' in settings ? settings.duplicateRadiusMeters : resolveOspSettings(settings as readonly Pick<Setting, 'id' | 'value'>[]).duplicateRadiusMeters;
  const incoming = changes.upserts?.equipment ?? [];
  if (incoming.length === 0) return [];
  const deleted = new Set(changes.deletes?.equipment ?? []);
  const storedIds = new Set(stored.map((e) => e.id));
  const overrides = new Set(
    (changes.upserts?.auditLogs ?? []).filter((log) => log.action === POSSIBLE_DUPLICATE_KEPT).map((log) => log.assetId),
  );
  const usable = (e: Equipment) => hasPlacedPosition(e) && hasRecordedLocation(e) && isValidCoordinate(e.lat, e.lng);
  const compareWith: Equipment[] = stored.filter((e) => !deleted.has(e.id) && usable(e));
  const warnings: PlacementWarning[] = [];
  for (const item of incoming) {
    if (storedIds.has(item.id) || deleted.has(item.id)) continue;
    if (!usable(item)) continue;
    let nearest: { e: Equipment; d: number } | undefined;
    for (const other of compareWith) {
      if (other.id === item.id || !sameKind(other.type, item.type)) continue;
      const d = distanceMeters([item.lat, item.lng], [other.lat, other.lng]);
      if (d <= radius && (!nearest || d < nearest.d)) nearest = { e: other, d };
    }
    compareWith.push(item);
    if (!nearest) continue;
    const meters = Math.max(1, Math.round(nearest.d));
    const overridden = overrides.has(item.id);
    warnings.push({
      rule: 'possible_duplicate',
      equipmentId: item.id,
      name: item.name,
      nearId: nearest.e.id,
      nearName: nearest.e.name,
      distanceMeters: Math.round(nearest.d * 10) / 10,
      overridden,
      message: `${item.name} (${item.type}) was saved about ${meters} m from ${nearest.e.name} (${nearest.e.type}). It may be the same one mapped twice.${
        overridden ? ' The person chose to keep both.' : ' Check it on the map.'
      }`,
    });
  }
  return warnings;
}
