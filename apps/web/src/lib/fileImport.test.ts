import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { previewSourceRows } from '@fibergis/shared';

import { ImportReadError, readCsvText, readGeoJsonText, readMapFile, readShapefileZip } from './fileImport';

/** A minimal point Shapefile (.shp), as a GIS program writes it. */
function pointShp(points: [number, number][]): Uint8Array {
  const length = 100 + points.length * 28;
  const view = new DataView(new ArrayBuffer(length));
  view.setInt32(0, 9994, false);
  view.setInt32(24, length / 2, false);
  view.setInt32(28, 1000, true);
  view.setInt32(32, 1, true);
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].forEach((v, i) => view.setFloat64(36 + i * 8, v, true));
  points.forEach(([x, y], i) => {
    const at = 100 + i * 28;
    view.setInt32(at, i + 1, false);
    view.setInt32(at + 4, 10, false);
    view.setInt32(at + 8, 1, true);
    view.setFloat64(at + 12, x, true);
    view.setFloat64(at + 20, y, true);
  });
  return new Uint8Array(view.buffer);
}

/** A dBase III table with one text column. */
function textDbf(column: string, values: string[], width = 12): Uint8Array {
  const headerSize = 32 + 32 + 1;
  const recordSize = 1 + width;
  const bytes = new Uint8Array(headerSize + values.length * recordSize + 1);
  const view = new DataView(bytes.buffer);
  bytes[0] = 0x03;
  bytes[1] = 126;
  bytes[2] = 11;
  bytes[3] = 11;
  view.setUint32(4, values.length, true);
  view.setUint16(8, headerSize, true);
  view.setUint16(10, recordSize, true);
  bytes.set(strToU8(column).slice(0, 10), 32);
  bytes[32 + 11] = 'C'.charCodeAt(0);
  bytes[32 + 16] = width;
  bytes[64] = 0x0d;
  values.forEach((v, i) => {
    const at = headerSize + i * recordSize;
    bytes[at] = 0x20;
    bytes.set(strToU8(v.padEnd(width, ' ').slice(0, width)), at + 1);
  });
  bytes[bytes.length - 1] = 0x1a;
  return bytes;
}

const WGS84 = 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';
const UTM43N =
  'PROJCS["WGS_1984_UTM_Zone_43N",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",75.0],PARAMETER["Scale_Factor",0.9996],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]';

const zipLayer = (points: [number, number][], prj?: string) =>
  zipSync({ 'poles.shp': pointShp(points), 'poles.dbf': textDbf('NAME', points.map((_, i) => `P-${i + 1}`)), ...(prj ? { 'poles.prj': strToU8(prj) } : {}) });

describe('Shapefile import', () => {
  it('uses a WGS 84 layer as it is, with its table columns as written', async () => {
    const { rows, layers } = await readShapefileZip(zipLayer([[77.5946, 12.9716]], WGS84), 'poles.zip');
    expect(layers).toEqual([expect.objectContaining({ name: 'poles', crs: 'wgs84', count: 1 })]);
    expect(rows[0]).toMatchObject({ layer: 'poles', properties: { NAME: 'P-1' }, geometry: { type: 'Point', coordinates: [77.5946, 12.9716] } });
  });

  it('converts a layer in a known projection (UTM 43N) to latitude and longitude', async () => {
    const { rows, layers } = await readShapefileZip(zipLayer([[780000, 1449000]], UTM43N), 'utm.zip');
    expect(layers[0]).toMatchObject({ crs: 'reprojected', crsName: 'WGS_1984_UTM_Zone_43N' });
    const [lng, lat] = rows[0]!.geometry!.coordinates as number[];
    expect(lng).toBeGreaterThan(77.5);
    expect(lng).toBeLessThan(77.7);
    expect(lat).toBeGreaterThan(13);
    expect(lat).toBeLessThan(13.2);
  });

  it('refuses a projection it cannot convert, and a layer with no .prj whose numbers are not degrees', async () => {
    await expect(readShapefileZip(zipLayer([[780000, 1449000]], 'PROJCS["Made_Up_Grid",GEOGCS["Nowhere"],PROJECTION["No_Such_Projection"]]'), 'x.zip')).rejects.toThrow(/Made_Up_Grid.*not imported/);
    await expect(readShapefileZip(zipLayer([[780000, 1449000]]), 'x.zip')).rejects.toThrow(/no \.prj file.*not latitude and longitude/);
  });

  it('asks the person about a layer with no .prj whose numbers look like degrees', async () => {
    const { rows, layers } = await readShapefileZip(zipLayer([[77.6, 12.9]]), 'x.zip');
    expect(layers[0]).toMatchObject({ crs: 'no_prj' });
    expect(layers[0]!.message).toMatch(/hundreds of metres/);
    expect(rows).toHaveLength(1);
  });

  it('sends a loose .shp back with what to do', async () => {
    await expect(readMapFile(new File([pointShp([[1, 2]]) as BlobPart], 'poles.shp'))).rejects.toThrow(/\.zip that holds/);
    const read = await readMapFile(new File([zipLayer([[77.6, 12.9]], WGS84) as BlobPart], 'poles.zip'));
    expect(read.format).toBe('shapefile');
  });
});

describe('GeoJSON and CSV import', () => {
  it('reads features with their properties as written, and refuses another coordinate system', () => {
    const rows = readGeoJsonText(
      JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: 'FAT 1', ports: 8, note: null }, geometry: { type: 'Point', coordinates: [77.6, 12.9] } }] }),
      'boxes',
    );
    expect(rows[0]).toMatchObject({ layer: 'boxes', properties: { name: 'FAT 1', ports: '8' } });
    expect(rows[0]!.properties).not.toHaveProperty('note');
    expect(() => readGeoJsonText(JSON.stringify({ type: 'FeatureCollection', crs: { type: 'name', properties: { name: 'EPSG:32643' } }, features: [] }), 'x')).toThrow(ImportReadError);
    expect(() => readGeoJsonText('{ not json', 'x')).toThrow(/not readable GeoJSON/);
  });

  it('keeps two columns with the same title apart, and flags numbers that are not latitude and longitude', () => {
    const rows = readCsvText('Name,Lat,Lng,Name\nP1,12.9,77.6,dup\nP2,1449000,780000,\n', 'poles');
    expect(Object.keys(rows[0]!.properties)).toEqual(['Name', 'Lat', 'Lng', 'Name (2)']);
    const preview = previewSourceRows(rows, { name: 'Name', lat: 'Lat', lng: 'Lng' }, 'csv');
    expect(preview.features).toHaveLength(1);
    expect(preview.positions.outsideRange).toBe(1);
  });
});
