import { strFromU8, unzipSync } from 'fflate';

import { describePrj, geoJsonCrsProblem, type KmlFeatureInput, type KmlGeometryInput, parseDelimited, type SourceRow } from '@fibergis/shared';

import { KML_MAX_BYTES, KmlReadError, parseKmlText, readKmlText } from './kmlImport';

/**
 * Network mapping Phase 21: reads a map file the office chose into rows for the import preview.
 * KML and KMZ go through the existing reader. GeoJSON, CSV and Shapefile (a .zip with .shp, .dbf
 * and .prj) become rows with every column as written; the person maps the columns next. Nothing
 * here decides what a row is. shpjs (with proj4) is loaded only when a Shapefile is opened.
 */

export class ImportReadError extends Error {}

/** What a Shapefile layer's coordinate system turned out to be. */
export interface ShapeLayerInfo {
  name: string;
  count: number;
  /**
   * `wgs84`: used as it is. `reprojected`: converted from `crsName` to WGS 84. `no_prj`: no .prj,
   * the numbers look like degrees, the person must say it is WGS 84. `refused`: not imported.
   */
  crs: 'wgs84' | 'reprojected' | 'no_prj' | 'refused';
  crsName?: string;
  message?: string;
}

export type LoadedMapFile =
  | { format: 'kml' | 'kmz'; fileName: string; features: KmlFeatureInput[] }
  | { format: 'geojson' | 'csv' | 'shapefile'; fileName: string; rows: SourceRow[]; layers: ShapeLayerInfo[] };

const extensionOf = (name: string) => name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
const baseName = (name: string) => (name.split(/[\\/]/).pop() ?? name).replace(/\.[^.]+$/, '') || 'file';
const isZip = (bytes: Uint8Array) => bytes[0] === 0x50 && bytes[1] === 0x4b;

/** A value as written, as text. Blank and missing values are left out. */
function asText(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') return value.trim() === '' ? undefined : value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value.toISOString().slice(0, 10);
  return JSON.stringify(value);
}

const propertiesOf = (raw: unknown): Record<string, string> => {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const text = asText(value);
    if (text !== undefined) out[key] = text;
  }
  return out;
};

/* ------------------------------------------------------------------ */
/* GeoJSON                                                             */
/* ------------------------------------------------------------------ */

/** Features of a GeoJSON text (a FeatureCollection, one Feature or one geometry). */
export function readGeoJsonText(text: string, layer: string): SourceRow[] {
  let json: unknown;
  try {
    json = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    throw new ImportReadError('This file is not readable GeoJSON. Check that it was saved as GeoJSON, then try again.');
  }
  const crs = geoJsonCrsProblem(json);
  if (crs) throw new ImportReadError(crs);
  const obj = json as { type?: unknown; features?: unknown; geometry?: unknown; properties?: unknown };
  let features: { geometry?: unknown; properties?: unknown }[];
  if (obj?.type === 'FeatureCollection' && Array.isArray(obj.features)) features = obj.features as { geometry?: unknown; properties?: unknown }[];
  else if (obj?.type === 'Feature') features = [obj];
  else if (typeof obj?.type === 'string' && 'coordinates' in (obj as object)) features = [{ geometry: obj, properties: {} }];
  else throw new ImportReadError('This JSON file is not GeoJSON (no FeatureCollection or Feature in it).');
  return features.map((f, index) => ({
    index,
    layer,
    properties: propertiesOf(f?.properties),
    geometry: f?.geometry && typeof f.geometry === 'object' ? (f.geometry as KmlGeometryInput) : null,
  }));
}

/* ------------------------------------------------------------------ */
/* CSV                                                                 */
/* ------------------------------------------------------------------ */

/** Rows of a CSV, TSV or semicolon file, with every column as written. Positions come from the mapping. */
export function readCsvText(text: string, layer: string): SourceRow[] {
  const table = parseDelimited(text);
  if ('error' in table) throw new ImportReadError(table.error);
  const seen = new Map<string, number>();
  const headers = table.headers.map((h, i) => {
    const base = h.trim() || `Column ${i + 1}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base} (${n})`;
  });
  return table.rows.map((cells, index) => ({
    index,
    layer,
    properties: Object.fromEntries(headers.map((h, i) => [h, (cells[i] ?? '').trim()]).filter(([, v]) => v !== '')),
    geometry: null,
  }));
}

/* ------------------------------------------------------------------ */
/* Shapefile                                                           */
/* ------------------------------------------------------------------ */

function flatPositions(raw: unknown, out: number[][]): void {
  if (!Array.isArray(raw)) return;
  if (raw.length >= 2 && typeof raw[0] === 'number' && typeof raw[1] === 'number') out.push(raw as number[]);
  else for (const item of raw) flatPositions(item, out);
}

const positionsOfAll = (geoms: readonly ({ coordinates?: unknown } | null)[]): number[][] => {
  const out: number[][] = [];
  for (const g of geoms) flatPositions(g?.coordinates, out);
  return out;
};

const looksLikeDegrees = (positions: readonly number[][]) => positions.every(([x, y]) => Math.abs(x!) <= 180 && Math.abs(y!) <= 90);

/**
 * The layers of a zipped Shapefile. Each layer's `.prj` decides: plain WGS 84 is used as it is; a
 * system proj4 knows is converted to WGS 84; a `.prj` it cannot read is refused with its name; no
 * `.prj` with numbers that look like degrees needs the person to say it is WGS 84; no `.prj` with
 * other numbers is refused. Nothing is placed on a guess.
 */
export async function readShapefileZip(bytes: Uint8Array, fileName: string): Promise<{ rows: SourceRow[]; layers: ShapeLayerInfo[] }> {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw new ImportReadError('This zip file could not be opened. It may be damaged.');
  }
  const byLower = new Map<string, Uint8Array>();
  for (const [name, data] of Object.entries(entries)) if (!name.includes('__MACOSX')) byLower.set(name.toLowerCase(), data);
  const shpNames = Object.keys(entries).filter((n) => !n.includes('__MACOSX') && n.toLowerCase().endsWith('.shp'));
  if (shpNames.length === 0) throw new ImportReadError('This zip has no .shp file inside. A Shapefile needs its .shp, .dbf and .prj files zipped together.');

  const { parseDbf, parseShp } = await import('shpjs');
  const rows: SourceRow[] = [];
  const layers: ShapeLayerInfo[] = [];
  for (const shpName of shpNames) {
    const stem = shpName.slice(0, -4).toLowerCase();
    const layer = baseName(shpName) || baseName(fileName);
    const shp = entries[shpName]!;
    const prjBytes = byLower.get(`${stem}.prj`);
    const dbf = byLower.get(`${stem}.dbf`);
    const cpg = byLower.get(`${stem}.cpg`);
    const prj = prjBytes ? strFromU8(prjBytes).trim() : '';
    let geoms: ({ type: string; coordinates?: unknown } | null)[];
    let info: ShapeLayerInfo;
    try {
      const raw = parseShp(shp);
      if (!prj) {
        geoms = raw;
        info = looksLikeDegrees(positionsOfAll(raw))
          ? { name: layer, count: raw.length, crs: 'no_prj', message: `"${layer}" has no .prj file, so its coordinate system is not written down. The numbers look like latitude and longitude, but positions would be wrong (by up to hundreds of metres) if it is not WGS 84.` }
          : { name: layer, count: raw.length, crs: 'refused', message: `"${layer}" has no .prj file and its numbers are not latitude and longitude, so its coordinate system is not known. Add the .prj file that came with it (zip it together with the .shp), or save it again as WGS 84. This layer was not imported.` };
      } else {
        const described = describePrj(prj);
        if (described.wgs84) {
          geoms = raw;
          info = { name: layer, count: raw.length, crs: 'wgs84', crsName: described.name };
        } else {
          const converted = parseShp(shp, prj);
          // shpjs keeps the raw numbers when proj4 cannot read the .prj, so same numbers means "not converted".
          const same = JSON.stringify(positionsOfAll(converted).slice(0, 50)) === JSON.stringify(positionsOfAll(raw).slice(0, 50));
          if (same || !looksLikeDegrees(positionsOfAll(converted))) {
            geoms = [];
            info = { name: layer, count: raw.length, crs: 'refused', crsName: described.name, message: `"${layer}" uses the coordinate system "${described.name}", which could not be converted to WGS 84 here. Save it again as WGS 84 (EPSG:4326), for example in QGIS, then import it again. This layer was not imported.` };
          } else {
            geoms = converted;
            info = { name: layer, count: raw.length, crs: 'reprojected', crsName: described.name };
          }
        }
      }
    } catch {
      layers.push({ name: layer, count: 0, crs: 'refused', message: `"${layer}" could not be read. The .shp file may be damaged. This layer was not imported.` });
      continue;
    }
    layers.push(info);
    if (info.crs === 'refused') continue;
    let props: Record<string, unknown>[] = [];
    if (dbf) {
      try {
        props = parseDbf(dbf, cpg ? strFromU8(cpg) : undefined);
      } catch {
        props = [];
      }
    }
    geoms.forEach((g, i) => rows.push({ index: rows.length, layer, properties: propertiesOf(props[i]), geometry: g ? ({ type: g.type, coordinates: g.coordinates } as KmlGeometryInput) : null }));
  }
  if (rows.length === 0 && layers.every((l) => l.crs === 'refused')) {
    throw new ImportReadError(layers.map((l) => l.message).filter(Boolean).join(' ') || 'Nothing in this Shapefile could be read.');
  }
  return { rows, layers };
}

/* ------------------------------------------------------------------ */
/* Any map file                                                        */
/* ------------------------------------------------------------------ */

export const MAP_FILE_ACCEPT = '.kml,.kmz,.geojson,.json,.csv,.tsv,.txt,.zip';

/** Reads a map file the person chose, by its kind. Throws `ImportReadError` or `KmlReadError` with plain words. */
export async function readMapFile(file: File): Promise<LoadedMapFile> {
  if (file.size > KML_MAX_BYTES) throw new ImportReadError('This file is too large to import here (over 30 MB). Split it into smaller files.');
  const ext = extensionOf(file.name);
  const layer = baseName(file.name);
  if (ext === 'shp' || ext === 'dbf' || ext === 'prj' || ext === 'shx') {
    throw new ImportReadError('Choose the .zip that holds the .shp, .dbf and .prj files together. Zip them first if they are loose files.');
  }
  if (ext === 'kml' || ext === 'kmz') {
    const features = parseKmlText(await readKmlText(file));
    if (features.length === 0) throw new KmlReadError('No placemarks were found in this file.');
    return { format: ext as 'kml' | 'kmz', fileName: file.name, features };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (ext === 'zip' || isZip(bytes)) {
    // List the names only; nothing is unpacked yet.
    const listed: string[] = [];
    try {
      unzipSync(bytes, {
        filter: (entry) => {
          listed.push(entry.name);
          return false;
        },
      });
    } catch {
      throw new ImportReadError('This zip file could not be opened. It may be damaged.');
    }
    if (listed.some((n) => n.toLowerCase().endsWith('.shp'))) {
      const { rows, layers } = await readShapefileZip(bytes, file.name);
      return { format: 'shapefile', fileName: file.name, rows, layers };
    }
    if (listed.some((n) => n.toLowerCase().endsWith('.kml'))) {
      const features = parseKmlText(await readKmlText(file));
      if (features.length === 0) throw new KmlReadError('No placemarks were found in this file.');
      return { format: 'kmz', fileName: file.name, features };
    }
    throw new ImportReadError('This zip has no Shapefile (.shp) or KML inside.');
  }
  const text = new TextDecoder().decode(bytes);
  if (ext === 'geojson' || ext === 'json' || /^\s*\{/.test(text)) {
    const rows = readGeoJsonText(text, layer);
    if (rows.length === 0) throw new ImportReadError('No features were found in this file.');
    return { format: 'geojson', fileName: file.name, rows, layers: [] };
  }
  if (ext === 'csv' || ext === 'tsv' || ext === 'txt') {
    return { format: 'csv', fileName: file.name, rows: readCsvText(text, layer), layers: [] };
  }
  throw new ImportReadError('This kind of file cannot be imported. Choose a KML, KMZ, GeoJSON, CSV, or a zipped Shapefile.');
}
