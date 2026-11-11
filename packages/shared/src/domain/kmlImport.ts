import { type CableType, EQUIPMENT_TYPES_BY_CATEGORY, type EquipmentCategory } from '../model/enums';
import type { ImportedCollection, ImportFormat, ImportRecord } from '../model/importSchemas';
import type { Cable, Duct, Equipment, ImportInfo, LatLng } from '../model/types';
import { type CommandContext, type CommandResult, fail, type NetworkData, notice, succeed } from './command';
import { fingerprintRecord } from './dataImport';
import { buildCores, hasRecordedLocation } from './defaults';
import { distanceMeters, randomCode } from './fieldCapture';
import { boundsOf, polylineLengthMeters } from './geo';
import { DEFAULT_OSP_SETTINGS, type OspSettings } from './ospSettings';
import { findPossibleDuplicates, hasPlacedPosition, newOspId } from './outsidePlant';
import { routeOverlapRatio } from './routeGeometry';
import { DEFAULT_VALIDATION_SETTINGS } from './validationSettings';

/**
 * KML and KMZ import, after the file has been read into plain features (see the web app's
 * `lib/kmlImport.ts`). Nothing is assumed: the person says what each folder and style is, no
 * connection, span or attachment is ever worked out, names, descriptions and ExtendedData are kept
 * as written, altitude is dropped, KML lengths are ignored, and every skipped feature has a reason.
 */

export interface KmlGeometryInput {
  type: string;
  coordinates?: unknown;
  geometries?: unknown[];
}

/** One placemark as read from the file. */
export interface KmlFeatureInput {
  /** Order in the file, from 0. */
  index: number;
  /** Folder names from the top, joined with " / ". Empty at the top level. */
  folderPath: string;
  name?: string;
  description?: string;
  /** The placemark's style reference without "#". */
  styleId?: string;
  geometry: KmlGeometryInput | null;
  extendedData: Record<string, string>;
  /** Phase 21: a core count from a column the person chose (GeoJSON, CSV, Shapefile). Absent means not recorded. */
  coreCount?: number;
}

export type KmlGeometryKind = 'point' | 'line';

export interface KmlGroup {
  key: string;
  folderPath: string;
  styleId?: string;
  kind: KmlGeometryKind;
  count: number;
  sampleNames: string[];
  extendedKeys: string[];
}

export interface KmlSkipped {
  index: number;
  name?: string;
  folderPath: string;
  reason: string;
}

export interface KmlValidFeature {
  input: KmlFeatureInput;
  kind: KmlGeometryKind;
  groupKey: string;
  point?: LatLng;
  line?: LatLng[];
}

export interface KmlPreview {
  total: number;
  features: KmlValidFeature[];
  groups: KmlGroup[];
  skipped: KmlSkipped[];
}

/** India's latitude (6 to 38 N) and longitude (68 to 98 E) cannot overlap, so a swap shows. */
const looksSwappedInIndia = (lat: number, lng: number) => lat >= 68 && lat <= 98 && lng >= 6 && lng <= 38;

type PositionResult = { ok: true; point: LatLng } | { ok: false; reason: string };

/** GeoJSON order is longitude first. Altitude, if any, is dropped. */
function readPosition(raw: unknown): PositionResult {
  if (!Array.isArray(raw) || raw.length < 2) return { ok: false, reason: 'A position is incomplete.' };
  const [lng, lat] = raw as unknown[];
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { ok: false, reason: 'A position is not a number.' };
  }
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return { ok: false, reason: 'A position is outside the world (latitude or longitude out of range).' };
  if (lat === 0 && lng === 0) return { ok: false, reason: 'Position 0, 0 is not a real place: the file has no position for it.' };
  if (looksSwappedInIndia(lat, lng)) {
    return { ok: false, reason: 'Latitude and longitude look swapped. Fix the file and import it again; nothing is moved automatically.' };
  }
  return { ok: true, point: [lat, lng] };
}

const groupKeyOf = (kind: KmlGeometryKind, folderPath: string, styleId?: string) => `${kind}|${folderPath}|${styleId ?? ''}`;

/** Checks every feature and groups the good ones by geometry, folder and style for the person to label. */
export function previewKml(inputs: readonly KmlFeatureInput[]): KmlPreview {
  const features: KmlValidFeature[] = [];
  const skipped: KmlSkipped[] = [];
  const skip = (input: KmlFeatureInput, reason: string) =>
    skipped.push({ index: input.index, ...(input.name ? { name: input.name } : {}), folderPath: input.folderPath, reason });

  for (const input of inputs) {
    const geometry = input.geometry;
    if (!geometry) {
      skip(input, 'It has no position.');
      continue;
    }
    switch (geometry.type) {
      case 'Point': {
        const position = readPosition(geometry.coordinates);
        if (!position.ok) skip(input, position.reason);
        else features.push({ input, kind: 'point', point: position.point, groupKey: groupKeyOf('point', input.folderPath, input.styleId) });
        break;
      }
      case 'LineString': {
        const raw = Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
        const points: LatLng[] = [];
        let problem: string | undefined;
        for (const item of raw) {
          const position = readPosition(item);
          if (!position.ok) {
            problem = position.reason;
            break;
          }
          const last = points.at(-1);
          if (!last || last[0] !== position.point[0] || last[1] !== position.point[1]) points.push(position.point);
        }
        if (problem) skip(input, `The line was not imported: ${problem.charAt(0).toLowerCase()}${problem.slice(1)}`);
        else if (points.length < 2) skip(input, 'A line needs at least two different points.');
        else features.push({ input, kind: 'line', line: points, groupKey: groupKeyOf('line', input.folderPath, input.styleId) });
        break;
      }
      case 'Polygon':
      case 'MultiPolygon':
        skip(input, 'Areas (shapes) are not imported. Only points and lines are.');
        break;
      case 'MultiPoint':
      case 'MultiLineString':
      case 'GeometryCollection':
        skip(input, 'It has several parts in one placemark. Split it into separate placemarks in Google Earth, then import again.');
        break;
      default:
        skip(input, `Its shape (${geometry.type}) is not supported.`);
    }
  }

  const groups = new Map<string, KmlGroup>();
  for (const feature of features) {
    const { folderPath, styleId, name, extendedData } = feature.input;
    let group = groups.get(feature.groupKey);
    if (!group) {
      group = { key: feature.groupKey, folderPath, ...(styleId ? { styleId } : {}), kind: feature.kind, count: 0, sampleNames: [], extendedKeys: [] };
      groups.set(feature.groupKey, group);
    }
    group.count += 1;
    if (name && group.sampleNames.length < 3) group.sampleNames.push(name);
    for (const key of Object.keys(extendedData)) if (!group.extendedKeys.includes(key) && group.extendedKeys.length < 8) group.extendedKeys.push(key);
  }
  return { total: inputs.length, features, groups: [...groups.values()], skipped };
}

/* ------------------------------------------------------------------ */
/* What the person chose                                               */
/* ------------------------------------------------------------------ */

export const KML_POINT_TARGETS = [
  { value: 'Telecom Pole', label: 'Telecom pole', prefix: 'POLE' },
  { value: 'Electric Pole', label: 'Electricity pole', prefix: 'POLE' },
  { value: 'Pole', label: 'Pole, owner not known', prefix: 'POLE' },
  { value: 'Manhole', label: 'Manhole', prefix: 'MH' },
  { value: 'Handhole', label: 'Handhole', prefix: 'HH' },
  { value: 'FAT', label: 'Street box (FAT)', prefix: 'BOX' },
  { value: 'Fiber Joint Closure', label: 'Joint box (closure)', prefix: 'JC' },
  { value: 'Building Entry Point', label: 'House or building entry', prefix: 'BEP' },
] as const;

export const KML_LINE_TARGETS = [
  { value: 'cable:Main Feeder Fiber', label: 'Main road line (feeder cable)' },
  { value: 'cable:Distribution Fiber', label: 'Street line (distribution cable)' },
  { value: 'cable:Drop Fiber', label: 'House wire (drop cable)' },
  { value: 'cable:Custom Cable', label: 'Cable, kind not known' },
  { value: 'duct', label: 'Duct (underground)' },
] as const;

export type KmlPointTarget = (typeof KML_POINT_TARGETS)[number]['value'];
export type KmlLineTarget = (typeof KML_LINE_TARGETS)[number]['value'];
export type KmlTarget = 'skip' | KmlPointTarget | KmlLineTarget;

export interface KmlGroupChoice {
  target?: KmlTarget;
  /** Existing in the street, or only planned. Required unless skipped. */
  status?: 'existing' | 'planned';
  /** Cables only. Absent means "not recorded". */
  coreCount?: number;
}

export interface KmlImportOptions {
  fileName: string;
  importId?: string;
  now?: Date;
  /** Import points and lines that look like an existing item anyway, as new records. */
  includePossibleDuplicates?: boolean;
  settings?: OspSettings;
  /** Phase 21: the kind of file. Default KML. */
  format?: ImportFormat;
  /** Phase 21: what else the person chose (column mapping, coordinate system), in words, for the import record. */
  settingsUsed?: Readonly<Record<string, string>>;
  /** Phase 21: warnings the person accepted, written out, for the import record. */
  overrides?: readonly string[];
  /** Phase 21: line ends the person confirmed, `endKey` → the `ref` of one of that end's candidates. */
  confirmedEnds?: Readonly<Record<string, string>>;
  /** Phase 21: how far from a line end a box or chamber is offered. Default: the map check's cable end limit. */
  endSearchMeters?: number;
}

export interface KmlHeldBack {
  index: number;
  name: string;
  existing: Equipment;
  distanceMeters: number;
}

/** Phase 21: a line that runs along a cable or duct already on the map (or earlier in the file). */
export interface KmlHeldBackLine {
  index: number;
  name: string;
  collection: 'cables' | 'ducts';
  existingId: string;
  existingName: string;
  /** Share of the shorter line within the "same cable?" distance of the other, in percent. */
  overlapPercent: number;
}

/** Phase 21: one item a line end could be connected to. Offered only; never chosen for the person. */
export interface KmlEndCandidate {
  /** `id:<record id>` for an item on the map, `new:<placemark index>` for a point in this file. */
  ref: string;
  id: string;
  name: string;
  type: string;
  distanceMeters: number;
  inThisFile: boolean;
}

export interface KmlEndProposal {
  key: string;
  /** The line's placemark index. */
  index: number;
  lineName: string;
  collection: 'cables' | 'ducts';
  end: 'start' | 'end';
  candidates: KmlEndCandidate[];
  /** The candidate the person confirmed, if any. */
  chosenRef?: string;
}

export interface KmlImportPlan {
  importId: string;
  fileName: string;
  format: ImportFormat;
  equipment: Equipment[];
  cables: Cable[];
  ducts: Duct[];
  /** Feature problems from the preview, plus groups the person chose to skip. */
  skipped: KmlSkipped[];
  /** Points that look like an existing item of the same kind. Not imported unless asked. */
  possibleDuplicates: KmlHeldBack[];
  /** Phase 21: lines that run along an existing cable or duct. Not imported unless asked. */
  possibleDuplicateLines: KmlHeldBackLine[];
  /** Phase 21: line ends near a box or chamber, for the person to confirm one by one. */
  endProposals: KmlEndProposal[];
  /** Phase 21: ends connected because the person confirmed them. */
  endsConfirmed: number;
  /** Phase 21: the choices behind this plan, in words, kept in the import record. */
  settingsUsed: Record<string, string>;
  overrides: string[];
  /** Groups still waiting for a choice. Import is not allowed until this is empty. */
  unanswered: string[];
}

/** The key of one line end in `confirmedEnds`. */
export const endKeyOf = (index: number, end: 'start' | 'end') => `${index}:${end}`;

/** Poles, manholes and chambers carry cables; a cable does not end "at" a pole by being near it. */
const STRUCTURE_TYPE = /pole|manhole|handhole|chamber/i;
const CHAMBER_TYPE = /manhole|handhole|chamber/i;

const MAX_END_CANDIDATES = 3;

const categoryOf = (type: string): EquipmentCategory =>
  (Object.entries(EQUIPMENT_TYPES_BY_CATEGORY).find(([, types]) => (types as readonly string[]).includes(type))?.[0] as EquipmentCategory | undefined) ??
  'Supporting Infrastructure';

const shortLabel = (target: KmlTarget) =>
  KML_POINT_TARGETS.find((t) => t.value === target)?.label.toLowerCase() ??
  KML_LINE_TARGETS.find((t) => t.value === target)?.label.toLowerCase() ??
  'item';

/** Builds the records the import would create. Changes nothing; `importKml` applies it. */
export function planKmlImport(
  data: NetworkData,
  preview: KmlPreview,
  choices: Readonly<Record<string, KmlGroupChoice>>,
  options: KmlImportOptions,
): KmlImportPlan {
  const now = options.now ?? new Date();
  const importId = options.importId ?? newOspId('IMP');
  const settings = options.settings ?? DEFAULT_OSP_SETTINGS;
  const format = options.format ?? 'kml';
  const plan: KmlImportPlan = {
    importId,
    fileName: options.fileName,
    format,
    equipment: [],
    cables: [],
    ducts: [],
    skipped: [...preview.skipped],
    possibleDuplicates: [],
    possibleDuplicateLines: [],
    endProposals: [],
    endsConfirmed: 0,
    settingsUsed: { ...(options.settingsUsed ?? {}) },
    overrides: [...(options.overrides ?? [])],
    unanswered: [],
  };

  for (const group of preview.groups) {
    const choice = choices[group.key];
    if (!choice?.target || (choice.target !== 'skip' && !choice.status)) plan.unanswered.push(group.key);
  }
  if (plan.unanswered.length > 0) return plan;

  for (const group of preview.groups) {
    const choice = choices[group.key]!;
    const where = `${group.kind === 'point' ? 'Points' : 'Lines'} in ${group.folderPath || 'the top of the file'}${group.styleId ? ` (style ${group.styleId})` : ''}`.slice(0, 120);
    plan.settingsUsed[where] =
      choice.target === 'skip'
        ? 'not imported'
        : `${shortLabel(choice.target!)}, ${choice.status === 'existing' ? 'already in the street' : 'only planned'}${choice.coreCount ? `, ${choice.coreCount} cores` : ''}`;
  }
  /** Placemark index → the point made from it, for line ends at a point in the same file. */
  const pointByIndex = new Map<number, Equipment>();
  /** Record id → placemark index of the line it came from. */
  const lineIndex = new Map<string, number>();

  for (const feature of preview.features) {
    const choice = choices[feature.groupKey];
    const { input } = feature;
    if (!choice?.target || choice.target === 'skip') {
      plan.skipped.push({ index: input.index, ...(input.name ? { name: input.name } : {}), folderPath: input.folderPath, reason: 'You chose not to import this group.' });
      continue;
    }
    const existing = choice.status === 'existing';
    const name = input.name?.trim() || `Imported ${shortLabel(choice.target)} ${input.index + 1}`;
    const importInfo: ImportInfo = {
      importId,
      fileName: options.fileName,
      importedAt: now.toISOString(),
      ...(input.folderPath ? { folderPath: input.folderPath } : {}),
      ...(input.styleId ? { styleId: input.styleId } : {}),
      ...(input.name ? { originalName: input.name } : {}),
      ...(input.description ? { description: input.description } : {}),
      ...(Object.keys(input.extendedData).length ? { extendedData: input.extendedData } : {}),
    };
    const remark = `Imported from ${options.fileName}.`;

    if (feature.kind === 'point' && feature.point) {
      const target = KML_POINT_TARGETS.find((t) => t.value === choice.target);
      if (!target) {
        plan.skipped.push({ index: input.index, name, folderPath: input.folderPath, reason: 'A point cannot be imported as a line type.' });
        continue;
      }
      const [twin] = findPossibleDuplicates([...data.equipment, ...plan.equipment], target.value, feature.point, settings, 1);
      if (twin) {
        plan.possibleDuplicates.push({ index: input.index, name, existing: twin.equipment, distanceMeters: twin.distanceMeters });
        if (!options.includePossibleDuplicates) continue;
      }
      const made = {
        id: `${target.prefix}-${randomCode()}`,
        name,
        type: target.value as Equipment['type'],
        category: categoryOf(target.value),
        lat: feature.point[0],
        lng: feature.point[1],
        // Accuracy is not known, so none is stored; never a 0 that would look perfect.
        locationMethod: 'imported',
        area: '',
        street: '',
        status: existing ? 'Active' : 'Planned',
        images: [],
        installedDate: '',
        notes: remark,
        importInfo,
      } satisfies Equipment;
      plan.equipment.push(made);
      pointByIndex.set(input.index, made);
      continue;
    }

    if (feature.kind === 'line' && feature.line) {
      const collection = choice.target === 'duct' ? 'ducts' : 'cables';
      if (collection === 'cables' && !choice.target.startsWith('cable:')) {
        plan.skipped.push({ index: input.index, name, folderPath: input.folderPath, reason: 'A line cannot be imported as a point type.' });
        continue;
      }
      // Phase 21: a line along a cable or duct already on the map (or earlier in this file) is asked about, like a point.
      const twin = findDuplicateLine(feature.line, collection === 'ducts' ? [...(data.ducts ?? []), ...plan.ducts] : [...data.cables, ...plan.cables], settings);
      if (twin) {
        plan.possibleDuplicateLines.push({ index: input.index, name, collection, existingId: twin.id, existingName: twin.name, overlapPercent: twin.overlapPercent });
        if (!options.includePossibleDuplicates) continue;
      }
      if (collection === 'ducts') {
        const duct: Duct = {
          id: newOspId('DCT'),
          name,
          coordinates: feature.line,
          status: existing ? 'built' : 'planned',
          basis: 'imported',
          cableIds: [],
          subducts: [],
          importInfo,
          createdAt: now.toISOString(),
          notes: remark,
        };
        plan.ducts.push(duct);
        lineIndex.set(duct.id, input.index);
        continue;
      }
      const type = choice.target.slice('cable:'.length) as CableType;
      // A core count from a column the person chose comes first; else the group's choice; else not recorded.
      const chosen = input.coreCount ?? choice.coreCount;
      const cores = chosen && chosen > 0 ? chosen : 0;
      const cable: Cable = {
        id: `CBL-${randomCode()}`,
        name,
        type,
        fiberCount: cores,
        // From the drawn line, geodesically. A length written in the KML is never trusted.
        lengthMeters: Math.round(polylineLengthMeters(feature.line) * 10) / 10,
        owner: '',
        installationDate: '',
        status: existing ? 'Active' : 'Planned',
        coordinates: feature.line,
        cores: buildCores(cores).map((core) => ({ ...core, status: 'Unverified' as const, remarks: 'Imported: use of this core not recorded' })),
        cableCategory: 'Fiber',
        remarks: `${remark} Its ends are not connected to anything: connect them only where you know they join.`,
        importInfo,
      };
      plan.cables.push(cable);
      lineIndex.set(cable.id, input.index);
    }
  }

  // Phase 21: line ends near a box (cables) or a chamber (ducts) are offered, never set. Only an end
  // the person confirmed, naming one of its own candidates, is connected.
  const searchMeters = options.endSearchMeters ?? DEFAULT_VALIDATION_SETTINGS.cableEndGapMeters;
  const points = [
    ...data.equipment.filter((e) => hasPlacedPosition(e) && hasRecordedLocation(e)).map((e) => ({ e, ref: `id:${e.id}`, inThisFile: false })),
    ...[...pointByIndex].map(([index, e]) => ({ e, ref: `new:${index}`, inThisFile: true })),
  ];
  const confirmed = options.confirmedEnds ?? {};
  const proposeEnds = (collection: 'cables' | 'ducts', record: Cable | Duct): void => {
    const index = lineIndex.get(record.id);
    if (index === undefined) return;
    const fits = collection === 'cables' ? (type: string) => !STRUCTURE_TYPE.test(type) : (type: string) => CHAMBER_TYPE.test(type);
    for (const end of ['start', 'end'] as const) {
      const at = end === 'start' ? record.coordinates[0]! : record.coordinates[record.coordinates.length - 1]!;
      const candidates = points
        .filter(({ e }) => fits(e.type))
        .map(({ e, ref, inThisFile }) => ({ ref, id: e.id, name: e.name, type: e.type, inThisFile, distanceMeters: Math.round(distanceMeters(at, [e.lat, e.lng]) * 10) / 10 }))
        .filter((c) => c.distanceMeters <= searchMeters)
        .sort((a, b) => a.distanceMeters - b.distanceMeters)
        .slice(0, MAX_END_CANDIDATES);
      if (candidates.length === 0) continue;
      const key = endKeyOf(index, end);
      const pick = candidates.find((c) => c.ref === confirmed[key]);
      plan.endProposals.push({ key, index, lineName: record.name, collection, end, candidates, ...(pick ? { chosenRef: pick.ref } : {}) });
      if (!pick) continue;
      plan.endsConfirmed += 1;
      if (collection === 'cables') {
        const cable = record as Cable;
        if (end === 'start') cable.startEquipmentId = pick.id;
        else cable.endEquipmentId = pick.id;
      } else {
        const duct = record as Duct;
        if (end === 'start') duct.fromStructureId = pick.id;
        else duct.toStructureId = pick.id;
      }
    }
  };
  for (const cable of plan.cables) proposeEnds('cables', cable);
  for (const duct of plan.ducts) proposeEnds('ducts', duct);
  for (const cable of plan.cables) {
    if (!cable.startEquipmentId && !cable.endEquipmentId) continue;
    const ends = [cable.startEquipmentId && 'From', cable.endEquipmentId && 'To'].filter(Boolean).join(' and ');
    cable.remarks = `Imported from ${options.fileName}. ${ends} end connected because a person confirmed it at import; any other end is not connected.`;
  }

  const held = plan.possibleDuplicates.length + plan.possibleDuplicateLines.length;
  if (held > 0) {
    plan.settingsUsed['Items that look like ones already on the map'] = options.includePossibleDuplicates ? 'imported anyway' : 'left out';
    if (options.includePossibleDuplicates) plan.overrides.push(`${held} item(s) that looked like ones already on the map were imported anyway, as new items.`);
  }
  plan.settingsUsed['Line ends offered within'] = `${searchMeters} m (boxes for cables, chambers for ducts); ${plan.endsConfirmed} confirmed by the person`;
  return plan;
}

interface LineLike {
  id: string;
  name: string;
  coordinates: readonly LatLng[];
}

/**
 * A cable or duct whose line runs along this one for most of its length, with about the same
 * length (both by the "same cable?" settings). Two real cables can share a route, so this only asks.
 */
export function findDuplicateLine(
  line: readonly LatLng[],
  others: readonly LineLike[],
  settings: Pick<OspSettings, 'duplicateRouteCorridorMeters' | 'duplicateRouteOverlapRatio'> = DEFAULT_OSP_SETTINGS,
): { id: string; name: string; overlapPercent: number } | undefined {
  const corridor = settings.duplicateRouteCorridorMeters;
  const ratio = settings.duplicateRouteOverlapRatio;
  const box = boundsOf([...line]);
  if (!box || !(corridor > 0)) return undefined;
  // A rough box test first (about 111 km per degree), so long files stay quick.
  const pad = corridor / 111_000;
  const length = polylineLengthMeters(line);
  let best: { id: string; name: string; overlapPercent: number } | undefined;
  for (const other of others) {
    if (other.coordinates.length < 2) continue;
    const b = boundsOf([...other.coordinates]);
    if (!b || b.south > box.north + pad || b.north < box.south - pad || b.west > box.east + pad * 2 || b.east < box.west - pad * 2) continue;
    const otherLength = polylineLengthMeters(other.coordinates);
    if (Math.min(length, otherLength) / Math.max(length, otherLength, 1e-9) < ratio) continue;
    const overlap = Math.min(routeOverlapRatio(line, other.coordinates, corridor), routeOverlapRatio(other.coordinates, line, corridor));
    if (overlap >= ratio && (!best || overlap * 100 > best.overlapPercent)) best = { id: other.id, name: other.name, overlapPercent: Math.round(overlap * 100) };
  }
  return best;
}

/** The import record the import writes: who, when, what file, what was chosen, and what it made. */
export function importRecordFor(plan: KmlImportPlan, ctx: CommandContext = {}): ImportRecord {
  const created = (['equipment', 'cables', 'ducts'] as const satisfies readonly ImportedCollection[]).flatMap((collection) =>
    (plan[collection] as readonly { id: string }[]).map((r) => ({ collection, id: r.id, fingerprint: fingerprintRecord(collection, r) })),
  );
  return {
    id: plan.importId,
    fileName: plan.fileName.trim().slice(0, 260) || 'file with no name',
    format: plan.format,
    importedAt: (ctx.now ?? new Date()).toISOString(),
    importedBy: ctx.actor?.trim().slice(0, 120) || 'Not recorded',
    counts: {
      points: plan.equipment.length,
      cables: plan.cables.length,
      ducts: plan.ducts.length,
      skipped: plan.skipped.length,
      heldBack: plan.possibleDuplicates.length + plan.possibleDuplicateLines.length,
      endsConfirmed: plan.endsConfirmed,
    },
    settingsUsed: Object.fromEntries(Object.entries(plan.settingsUsed).map(([k, v]) => [k.slice(0, 120), v.slice(0, 500)])),
    overrides: plan.overrides.slice(0, 50).map((o) => o.slice(0, 500)),
    created,
    changed: [],
  };
}

/** Adds what the plan holds, and its import record, as one step that can be undone. */
export function importKml(
  data: NetworkData,
  plan: KmlImportPlan,
  ctx: CommandContext = {},
): CommandResult<{ equipment: number; cables: number; ducts: number }> {
  if (plan.unanswered.length > 0) return fail('Choose first', 'Say what each group is, or choose "Do not import".', 'warning');
  const count = plan.equipment.length + plan.cables.length + plan.ducts.length;
  if (count === 0) return fail('Nothing to import', 'Every feature was skipped. See the list of reasons.', 'warning');
  const taken = new Set([...data.equipment.map((e) => e.id), ...data.cables.map((c) => c.id), ...(data.ducts ?? []).map((d) => d.id)]);
  if ([...plan.equipment, ...plan.cables, ...plan.ducts].some((r) => taken.has(r.id)) || (data.imports ?? []).some((r) => r.id === plan.importId)) {
    return fail('ID clash', 'This import was already added. Nothing was changed.', 'info');
  }
  const value = { equipment: plan.equipment.length, cables: plan.cables.length, ducts: plan.ducts.length };
  const record = importRecordFor(plan, ctx);
  const connected = plan.endsConfirmed > 0 ? `${plan.endsConfirmed} line end(s) connected where you confirmed them; nothing else was connected.` : 'Nothing was connected.';
  return succeed(
    value,
    {
      ...(plan.equipment.length ? { equipment: [...data.equipment, ...plan.equipment] } : {}),
      ...(plan.cables.length ? { cables: [...data.cables, ...plan.cables] } : {}),
      ...(plan.ducts.length ? { ducts: [...(data.ducts ?? []), ...plan.ducts] } : {}),
      imports: [...(data.imports ?? []), record],
    },
    {
      notice: notice('success', 'File imported', `${value.equipment} point(s), ${value.cables} cable(s) and ${value.ducts} duct(s) from ${plan.fileName}. ${plan.skipped.length} skipped. ${connected}`),
      audit: [
        {
          action: plan.format === 'kml' || plan.format === 'kmz' ? 'KML_IMPORTED' : 'MAP_FILE_IMPORTED',
          details: `${plan.fileName} (${plan.importId}, ${plan.format}) by ${ctx.actor ?? 'unknown'}: ${value.equipment} points, ${value.cables} cables, ${value.ducts} ducts; ${plan.skipped.length} skipped; ${record.counts.heldBack} looked like existing items; ${plan.endsConfirmed} end(s) confirmed${plan.overrides.length ? `; accepted: ${plan.overrides.join(' ')}` : ''}`.slice(0, 1000),
          assetId: plan.importId,
          assetType: 'Import',
        },
      ],
    },
  );
}
