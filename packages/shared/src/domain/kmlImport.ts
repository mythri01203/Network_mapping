import { type CableType, EQUIPMENT_TYPES_BY_CATEGORY, type EquipmentCategory } from '../model/enums';
import type { Cable, Duct, Equipment, ImportInfo, LatLng } from '../model/types';
import { type CommandContext, type CommandResult, fail, type NetworkData, notice, succeed } from './command';
import { buildCores } from './defaults';
import { randomCode } from './fieldCapture';
import { polylineLengthMeters } from './geo';
import { DEFAULT_OSP_SETTINGS, type OspSettings } from './ospSettings';
import { findPossibleDuplicates, newOspId } from './outsidePlant';

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
  /** Import points that look like an existing item anyway, as new records. */
  includePossibleDuplicates?: boolean;
  settings?: OspSettings;
}

export interface KmlHeldBack {
  index: number;
  name: string;
  existing: Equipment;
  distanceMeters: number;
}

export interface KmlImportPlan {
  importId: string;
  fileName: string;
  equipment: Equipment[];
  cables: Cable[];
  ducts: Duct[];
  /** Feature problems from the preview, plus groups the person chose to skip. */
  skipped: KmlSkipped[];
  /** Points that look like an existing item of the same kind. Not imported unless asked. */
  possibleDuplicates: KmlHeldBack[];
  /** Groups still waiting for a choice. Import is not allowed until this is empty. */
  unanswered: string[];
}

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
  const plan: KmlImportPlan = {
    importId,
    fileName: options.fileName,
    equipment: [],
    cables: [],
    ducts: [],
    skipped: [...preview.skipped],
    possibleDuplicates: [],
    unanswered: [],
  };

  for (const group of preview.groups) {
    const choice = choices[group.key];
    if (!choice?.target || (choice.target !== 'skip' && !choice.status)) plan.unanswered.push(group.key);
  }
  if (plan.unanswered.length > 0) return plan;

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
      plan.equipment.push({
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
      });
      continue;
    }

    if (feature.kind === 'line' && feature.line) {
      if (choice.target === 'duct') {
        plan.ducts.push({
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
        });
        continue;
      }
      if (!choice.target.startsWith('cable:')) {
        plan.skipped.push({ index: input.index, name, folderPath: input.folderPath, reason: 'A line cannot be imported as a point type.' });
        continue;
      }
      const type = choice.target.slice('cable:'.length) as CableType;
      const cores = choice.coreCount && choice.coreCount > 0 ? choice.coreCount : 0;
      plan.cables.push({
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
      });
    }
  }
  return plan;
}

/** Adds what the plan holds, as one step that can be undone. */
export function importKml(
  data: NetworkData,
  plan: KmlImportPlan,
  ctx: CommandContext = {},
): CommandResult<{ equipment: number; cables: number; ducts: number }> {
  if (plan.unanswered.length > 0) return fail('Choose first', 'Say what each group is, or choose "Do not import".', 'warning');
  const count = plan.equipment.length + plan.cables.length + plan.ducts.length;
  if (count === 0) return fail('Nothing to import', 'Every feature was skipped. See the list of reasons.', 'warning');
  const taken = new Set([...data.equipment.map((e) => e.id), ...data.cables.map((c) => c.id), ...(data.ducts ?? []).map((d) => d.id)]);
  if ([...plan.equipment, ...plan.cables, ...plan.ducts].some((r) => taken.has(r.id))) {
    return fail('ID clash', 'This import was already added. Nothing was changed.', 'info');
  }
  const value = { equipment: plan.equipment.length, cables: plan.cables.length, ducts: plan.ducts.length };
  return succeed(
    value,
    {
      ...(plan.equipment.length ? { equipment: [...data.equipment, ...plan.equipment] } : {}),
      ...(plan.cables.length ? { cables: [...data.cables, ...plan.cables] } : {}),
      ...(plan.ducts.length ? { ducts: [...(data.ducts ?? []), ...plan.ducts] } : {}),
    },
    {
      notice: notice(
        'success',
        'File imported',
        `${value.equipment} point(s), ${value.cables} cable(s) and ${value.ducts} duct(s) from ${plan.fileName}. ${plan.skipped.length} skipped. Nothing was connected.`,
      ),
      audit: [
        {
          action: 'KML_IMPORTED',
          details: `${plan.fileName} (${plan.importId}) by ${ctx.actor ?? 'unknown'}: ${value.equipment} points, ${value.cables} cables, ${value.ducts} ducts; ${plan.skipped.length} skipped; ${plan.possibleDuplicates.length} looked like existing items`,
          assetId: plan.importId,
          assetType: 'System',
        },
      ],
    },
  );
}
