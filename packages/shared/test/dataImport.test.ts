import { describe, expect, it } from 'vitest';

import { applyPatch, type NetworkData } from '../src/domain/command';
import {
  checkChangeSetImports,
  checkPositions,
  describePrj,
  fingerprintRecord,
  geoJsonCrsProblem,
  importMappingProblem,
  parseWkt,
  planImportRollback,
  previewSourceRows,
  type SourceRow,
  sourceColumns,
  suggestMapping,
} from '../src/domain/dataImport';
import { endKeyOf, findDuplicateLine, importKml, planKmlImport, previewKml } from '../src/domain/kmlImport';
import { COLLECTION_NAMES } from '../src/model/collections';
import { importRecordSchema } from '../src/model/importSchemas';
import { cable, emptyNetwork, equipment, NOW } from './fixtures';

const csvRows = (rows: Record<string, string>[]): SourceRow[] => rows.map((properties, index) => ({ index, layer: 'poles', properties, geometry: null }));

describe('field mapping (CSV)', () => {
  const rows = csvRows([
    { ID: 'P-1', Latitude: '12.9716', Longitude: '77.5946', Kind: 'pole', cores: '' },
    { ID: 'P-2', Latitude: '12,9720', Longitude: '77,5950', Kind: 'pole', cores: '' },
    { ID: 'F-1', Latitude: '12.9730', Longitude: '77.5960', Kind: 'box', cores: '' },
    { ID: 'BAD', Latitude: '1449000', Longitude: '780000', Kind: 'pole', cores: '' },
    { ID: 'SWAP', Latitude: '77.59', Longitude: '12.97', Kind: 'pole', cores: '' },
    { ID: 'EMPTY', Latitude: '', Longitude: '', Kind: 'pole', cores: '' },
  ]);
  const columns = sourceColumns(rows);

  it('lists columns with examples and suggests only exact column names', () => {
    expect(columns.map((c) => c.key)).toEqual(['ID', 'Latitude', 'Longitude', 'Kind', 'cores']);
    expect(columns[0].samples).toEqual(['P-1', 'P-2', 'F-1']);
    expect(suggestMapping(columns, 'csv')).toEqual({ lat: 'Latitude', lng: 'Longitude' });
    // "ID" is not guessed to be the name, and a GeoJSON gets no position columns.
    expect(suggestMapping(columns, 'geojson')).toEqual({});
  });

  it('needs both position columns for a CSV, and names a column that is not there', () => {
    expect(importMappingProblem('csv', {}, columns)).toMatch(/Latitude and Longitude/);
    expect(importMappingProblem('csv', { lat: 'Latitude' }, columns)).toMatch(/both/);
    expect(importMappingProblem('csv', { lat: 'Latitude', lng: 'Latitude' }, columns)).toMatch(/different/);
    expect(importMappingProblem('csv', { lat: 'Latitude', lng: 'Longitude', name: 'Nope' }, columns)).toMatch(/"Nope"/);
    expect(importMappingProblem('csv', { lat: 'Latitude', lng: 'Longitude' }, columns)).toBeNull();
    expect(importMappingProblem('geojson', {}, columns)).toBeNull();
  });

  it('uses only the chosen columns, groups by the chosen kind column, and flags impossible numbers', () => {
    const preview = previewSourceRows(rows, { lat: 'Latitude', lng: 'Longitude', name: 'ID', groupBy: 'Kind' }, 'csv');
    expect(preview.total).toBe(6);
    expect(preview.groups.map((g) => [g.folderPath, g.count])).toEqual([
      ['poles / pole', 2],
      ['poles / box', 1],
    ]);
    // A decimal comma is read as written; every column is kept as written.
    expect(preview.features.find((f) => f.input.name === 'P-2')?.point).toEqual([12.972, 77.595]);
    expect(preview.features[0].input.extendedData).toMatchObject({ ID: 'P-1', Kind: 'pole' });
    const reasons = Object.fromEntries(preview.skipped.map((s) => [s.name, s.reason]));
    expect(reasons.BAD).toMatch(/outside the world/);
    expect(reasons.SWAP).toMatch(/swapped/);
    expect(reasons.EMPTY).toMatch(/no position/);
    expect(preview.positions.outsideRange).toBe(1);
    expect(preview.positions.swapped).toBe(1);
    expect(preview.positions.message).toMatch(/UTM in metres/);
    expect(preview.positions.message).toMatch(/wrong way round/);
  });

  it('reads a core count only from the chosen column, and leaves a bad one as not recorded', () => {
    const lines: SourceRow[] = [
      { index: 0, layer: 'routes', properties: { name: 'A', fibres: '24', WKT: 'LINESTRING (77.6 12.9, 77.601 12.9)' }, geometry: null },
      { index: 1, layer: 'routes', properties: { name: 'B', fibres: 'twelve', WKT: 'LINESTRING (77.6 12.91, 77.601 12.91)' }, geometry: null },
      { index: 2, layer: 'routes', properties: { name: 'C', fibres: '', WKT: 'SRID=32643;LINESTRING (780000 1449000, 780100 1449000)' }, geometry: null },
    ];
    const preview = previewSourceRows(lines, { name: 'name', coreCount: 'fibres', wkt: 'WKT' }, 'csv');
    expect(preview.features.map((f) => [f.input.name, f.input.coreCount])).toEqual([
      ['A', 24],
      ['B', undefined],
    ]);
    expect(preview.badCoreCounts).toBe(1);
    expect(preview.skipped[0].reason).toMatch(/32643/);
    const plan = planKmlImport(emptyNetwork(), preview, { [preview.groups[0].key]: { target: 'cable:Distribution Fiber', status: 'planned', coreCount: 12 } }, { fileName: 'r.csv', format: 'csv' });
    // The column wins over the group's choice; a row with no usable count takes the group's choice.
    expect(plan.cables.map((c) => c.fiberCount)).toEqual([24, 12]);
  });

  it('reads WKT shapes and treats a one-part multi shape as that part', () => {
    expect(parseWkt('POINT (77.5 12.9)').geometry).toEqual({ type: 'Point', coordinates: [77.5, 12.9] });
    expect(parseWkt('LINESTRING Z (1 2 0, 3 4 0)').geometry).toEqual({ type: 'LineString', coordinates: [[1, 2, 0], [3, 4, 0]] });
    expect(parseWkt('MULTILINESTRING ((1 2, 3 4), (5 6, 7 8))').geometry).toEqual({ type: 'MultiLineString', coordinates: [[[1, 2], [3, 4]], [[5, 6], [7, 8]]] });
    expect(parseWkt('nonsense').geometry).toBeNull();
    const rows: SourceRow[] = [{ index: 0, layer: 'shp', properties: {}, geometry: { type: 'MultiLineString', coordinates: [[[77.6, 12.9], [77.601, 12.9]]] } }];
    expect(previewSourceRows(rows, {}, 'shapefile').features[0].kind).toBe('line');
  });
});

describe('coordinate systems', () => {
  it('knows plain WGS 84 from a .prj and names anything else', () => {
    expect(describePrj('GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["Degree",0.017453292519943295]]')).toEqual({ wgs84: true, name: 'GCS_WGS_1984' });
    expect(describePrj('PROJCS["WGS_1984_UTM_Zone_43N",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984"]],PROJECTION["Transverse_Mercator"]]')).toEqual({ wgs84: false, name: 'WGS_1984_UTM_Zone_43N' });
    expect(describePrj('GEOGCS["GCS_Everest_1830",DATUM["D_Everest_1830"]]').wgs84).toBe(false);
  });

  it('refuses a GeoJSON that names another coordinate system', () => {
    expect(geoJsonCrsProblem({ type: 'FeatureCollection', features: [] })).toBeNull();
    expect(geoJsonCrsProblem({ crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' } } })).toBeNull();
    expect(geoJsonCrsProblem({ crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::32643' } } })).toMatch(/32643.*WGS 84/);
  });

  it('counts nothing for good positions', () => {
    const check = checkPositions([{ index: 0, folderPath: '', geometry: { type: 'LineString', coordinates: [[77.6, 12.9], [77.7, 13]] }, extendedData: {} }]);
    expect(check).toEqual({ checked: 2, outsideRange: 0, swapped: 0, message: null });
  });
});

const lineFeature = (index: number, coords: [number, number][], name = `L${index}`) => ({
  index,
  folderPath: 'Route',
  name,
  geometry: { type: 'LineString', coordinates: coords },
  extendedData: {},
});

describe('line duplicates and proposed ends', () => {
  const route: [number, number][] = [
    [77.6, 12.9],
    [77.601, 12.9],
    [77.602, 12.9002],
  ];
  const existing = cable({ id: 'CBL-OLD', name: 'Old feeder', coordinates: route.map(([lng, lat]) => [lat, lng] as [number, number]) });

  it('holds back a line that runs along an existing cable, unless the person asks', () => {
    const preview = previewKml([lineFeature(0, route), lineFeature(1, [[77.6, 12.95], [77.61, 12.95]])]);
    const data = { ...emptyNetwork(), cables: [existing] };
    const choices = { [preview.groups[0].key]: { target: 'cable:Main Feeder Fiber' as const, status: 'existing' as const } };
    const held = planKmlImport(data, preview, choices, { fileName: 'r.kml' });
    expect(held.cables.map((c) => c.name)).toEqual(['L1']);
    expect(held.possibleDuplicateLines).toEqual([expect.objectContaining({ name: 'L0', existingId: 'CBL-OLD', collection: 'cables' })]);
    const all = planKmlImport(data, preview, choices, { fileName: 'r.kml', includePossibleDuplicates: true });
    expect(all.cables).toHaveLength(2);
    expect(all.overrides[0]).toMatch(/imported anyway/);
    // A short line along a long one is not "the same line".
    expect(findDuplicateLine([[12.9, 77.6], [12.9, 77.6003]], [existing])).toBeUndefined();
  });

  it('offers ends near a box, never a pole, and connects only an end the person confirmed', () => {
    const fat = equipment({ id: 'FAT-1', name: 'Box 1', type: 'FAT', lat: 12.9, lng: 77.60001 });
    const pole = equipment({ id: 'POLE-1', name: 'Pole 1', type: 'Telecom Pole', lat: 12.9, lng: 77.6 });
    const data: NetworkData = { ...emptyNetwork(), equipment: [fat, pole] };
    const preview = previewKml([lineFeature(0, route)]);
    const choices = { [preview.groups[0].key]: { target: 'cable:Distribution Fiber' as const, status: 'existing' as const } };
    const offered = planKmlImport(data, preview, choices, { fileName: 'r.kml' });
    expect(offered.endProposals).toHaveLength(1);
    expect(offered.endProposals[0]).toMatchObject({ key: endKeyOf(0, 'start'), end: 'start' });
    expect(offered.endProposals[0].candidates.map((c) => c.id)).toEqual(['FAT-1']);
    // Offered is not set.
    expect(offered.cables[0].startEquipmentId).toBeUndefined();
    expect(offered.endsConfirmed).toBe(0);

    const chosen = planKmlImport(data, preview, choices, { fileName: 'r.kml', confirmedEnds: { [endKeyOf(0, 'start')]: 'id:FAT-1' } });
    expect(chosen.cables[0].startEquipmentId).toBe('FAT-1');
    expect(chosen.cables[0].endEquipmentId).toBeUndefined();
    expect(chosen.endsConfirmed).toBe(1);
    // A ref that was not offered for that end is ignored.
    const wrong = planKmlImport(data, preview, choices, { fileName: 'r.kml', confirmedEnds: { [endKeyOf(0, 'start')]: 'id:POLE-1' } });
    expect(wrong.cables[0].startEquipmentId).toBeUndefined();
  });

  it('offers a point from the same file as a line end', () => {
    const preview = previewKml([
      { index: 0, folderPath: 'Boxes', name: 'New box', geometry: { type: 'Point', coordinates: [77.602, 12.9002] }, extendedData: {} },
      lineFeature(1, route),
    ]);
    const [boxes, lines] = preview.groups;
    const choices = { [boxes.key]: { target: 'FAT' as const, status: 'planned' as const }, [lines.key]: { target: 'cable:Drop Fiber' as const, status: 'planned' as const } };
    const plan = planKmlImport(emptyNetwork(), preview, choices, { fileName: 'r.kml', confirmedEnds: { [endKeyOf(1, 'end')]: 'new:0' } });
    expect(plan.cables[0].endEquipmentId).toBe(plan.equipment[0].id);
  });
});

describe('import history and undo by import', () => {
  const preview = previewKml([
    { index: 0, folderPath: 'Poles', name: 'P0', geometry: { type: 'Point', coordinates: [77.6, 12.9] }, extendedData: {} },
    lineFeature(1, [[77.7, 12.9], [77.701, 12.9]]),
  ]);
  const [poles, lines] = preview.groups;
  const choices = { [poles.key]: { target: 'Telecom Pole' as const, status: 'existing' as const }, [lines.key]: { target: 'duct' as const, status: 'planned' as const } };
  const imported = () => {
    const plan = planKmlImport(emptyNetwork(), preview, choices, { fileName: 'route.csv', format: 'csv', importId: 'IMP-1', settingsUsed: { 'Column for name of each item': '"ID"' } });
    const result = importKml(emptyNetwork(), plan, { actor: 'Office One', now: NOW });
    if (!result.ok) throw new Error('import failed');
    return { plan, data: applyPatch(emptyNetwork(), result.patch) };
  };

  it('writes one import record with who, when, the file, the choices and what it made', () => {
    expect(COLLECTION_NAMES).toContain('imports');
    const { plan, data } = imported();
    const [record] = data.imports!;
    expect(importRecordSchema.safeParse(record).success).toBe(true);
    expect(record).toMatchObject({ id: 'IMP-1', fileName: 'route.csv', format: 'csv', importedBy: 'Office One', importedAt: NOW.toISOString(), counts: { points: 1, cables: 0, ducts: 1 } });
    expect(record.settingsUsed['Column for name of each item']).toBe('"ID"');
    expect(record.settingsUsed['Points in Poles']).toMatch(/telecom pole, already in the street/);
    expect(record.created.map((c) => c.collection)).toEqual(['equipment', 'ducts']);
    expect(record.created[0].fingerprint).toBe(fingerprintRecord('equipment', plan.equipment[0]));
    // The same import cannot be added twice.
    expect(importKml(data, plan).ok).toBe(false);
  });

  it('undoes exactly what the import made, and marks the record undone', () => {
    const { data } = imported();
    const other = equipment({ id: 'POLE-KEEP', type: 'Telecom Pole' });
    const before = { ...data, equipment: [...data.equipment, other] };
    const rollback = planImportRollback(before, 'IMP-1', { actor: 'Engineer', now: NOW, note: 'Wrong file' });
    expect(rollback.ok).toBe(true);
    if (!rollback.ok) return;
    expect(rollback.removed).toBe(2);
    expect(rollback.changes.deletes).toEqual({ equipment: [data.equipment[0].id], ducts: [data.ducts![0].id] });
    expect(rollback.updated).toMatchObject({ rolledBackBy: 'Engineer', rollbackNote: 'Wrong file', rolledBackAt: NOW.toISOString() });
    expect(importRecordSchema.safeParse(rollback.updated).success).toBe(true);
    // Once undone, it cannot be undone again.
    expect(planImportRollback({ ...before, imports: [rollback.updated] }, 'IMP-1').ok).toBe(false);
  });

  it('refuses when an imported item was changed since, or something else uses it', () => {
    const { data } = imported();
    const pole = data.equipment[0];
    const edited = planImportRollback({ ...data, equipment: [{ ...pole, name: 'Renamed' }] }, 'IMP-1');
    expect(edited.ok).toBe(false);
    if (!edited.ok) expect(edited.message).toMatch(/"Renamed".*changed after the import.*Nothing was changed/);

    const span = { id: 'SPN-1', name: 'Span', fromStructureId: pole.id, toStructureId: 'POLE-OTHER', status: 'built' as const, basis: 'field_sequence' as const };
    const used = planImportRollback({ ...data, spans: [span as never] }, 'IMP-1');
    expect(used.ok).toBe(false);
    if (!used.ok) {
      expect(used.blockers).toEqual([expect.objectContaining({ collection: 'spans', id: 'SPN-1' })]);
      expect(used.message).toMatch(/Span "Span" \(SPN-1\) uses "P0"/);
    }
  });

  it('counts records someone already deleted, and puts back a record the import changed', () => {
    const { data } = imported();
    const gone = planImportRollback({ ...data, ducts: [] }, 'IMP-1');
    expect(gone.ok && gone.alreadyGone).toBe(1);

    const box = equipment({ id: 'FAT-9', type: 'FAT', name: 'After' });
    const record = { ...data.imports![0], changed: [{ collection: 'equipment' as const, id: 'FAT-9', fingerprint: fingerprintRecord('equipment', box), before: { ...box, name: 'Before' } }] };
    const back = planImportRollback({ ...data, equipment: [...data.equipment, box], imports: [record] }, 'IMP-1');
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(back.restored).toBe(1);
      expect((back.changes.upserts?.equipment as { name: string }[])[0].name).toBe('Before');
    }
  });

  it('server rule: history is never rewritten, an undo is added once, an undone import is kept', () => {
    const { data } = imported();
    const stored = data.imports![0];
    const lookup = (id: string) => (id === stored.id ? stored : undefined);
    expect(checkChangeSetImports({ upserts: { imports: [stored] } }, lookup)).toEqual([]);
    expect(checkChangeSetImports({ upserts: { imports: [{ ...stored, fileName: 'other.kml' }] } }, lookup)[0].message).toMatch(/history/);
    expect(checkChangeSetImports({ upserts: { imports: [{ ...stored, rolledBackAt: NOW.toISOString() }] } }, lookup)[0].message).toMatch(/who undid it/);
    const undone = { ...stored, rolledBackAt: NOW.toISOString(), rolledBackBy: 'Engineer' };
    expect(checkChangeSetImports({ upserts: { imports: [undone] } }, lookup)).toEqual([]);
    const undoneLookup = () => undone;
    expect(checkChangeSetImports({ upserts: { imports: [stored] } }, undoneLookup)[0].message).toMatch(/already undone/);
    expect(checkChangeSetImports({ deletes: { imports: [stored.id] } }, undoneLookup)[0].message).toMatch(/kept as history/);
    // The app's own Undo of the import step removes a record that was not undone.
    expect(checkChangeSetImports({ deletes: { imports: [stored.id] } }, lookup)).toEqual([]);
  });
});
