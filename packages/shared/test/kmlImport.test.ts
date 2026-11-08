import { describe, expect, it } from 'vitest';

import { applyPatch } from '../src/domain/command';
import { importKml, type KmlFeatureInput, planKmlImport, previewKml } from '../src/domain/kmlImport';
import { findBrokenLinks } from '../src/domain/outsidePlant';
import { cableSchema, ductSchema, equipmentSchema } from '../src/model/schemas';
import { emptyNetwork, equipment, NOW } from './fixtures';

const point = (index: number, lng: number, lat: number, extra: Partial<KmlFeatureInput> = {}): KmlFeatureInput => ({
  index,
  folderPath: 'Route A / Poles',
  name: `P${index}`,
  styleId: 'pole-style',
  geometry: { type: 'Point', coordinates: [lng, lat, 0] },
  extendedData: {},
  ...extra,
});

const features: KmlFeatureInput[] = [
  point(0, 77.6, 12.9, { description: 'Near the temple', extendedData: { owner: 'BESCOM', pole_no: '114' } }),
  point(1, 77.6005, 12.9),
  // Swapped: latitude 77 cannot be in India.
  point(2, 12.9, 77.6),
  point(3, 0, 0),
  {
    index: 4,
    folderPath: 'Route A / Cable',
    name: 'Main line',
    geometry: {
      type: 'LineString',
      coordinates: [
        [77.6, 12.9, 0],
        [77.6005, 12.9, 0],
        [77.601, 12.9001, 0],
      ],
    },
    extendedData: { cores: '24' },
  },
  { index: 5, folderPath: '', name: 'Ward', geometry: { type: 'Polygon', coordinates: [] }, extendedData: {} },
  { index: 6, folderPath: '', name: 'Two parts', geometry: { type: 'GeometryCollection', geometries: [] }, extendedData: {} },
  { index: 7, folderPath: '', name: 'Nothing', geometry: null, extendedData: {} },
  {
    index: 8,
    folderPath: 'Route A / Cable',
    name: 'Bad line',
    geometry: { type: 'LineString', coordinates: [[77.6, 12.9], ['x', 12.9]] },
    extendedData: {},
  },
];

describe('KML preview', () => {
  it('groups points and lines by folder and style, and gives a reason for every skipped one', () => {
    const preview = previewKml(features);
    expect(preview.total).toBe(9);
    expect(preview.groups.map((g) => [g.kind, g.folderPath, g.count])).toEqual([
      ['point', 'Route A / Poles', 2],
      ['line', 'Route A / Cable', 1],
    ]);
    expect(preview.groups[0].extendedKeys).toEqual(['owner', 'pole_no']);
    const reasons = Object.fromEntries(preview.skipped.map((s) => [s.index, s.reason]));
    expect(Object.keys(reasons).map(Number)).toEqual([2, 3, 5, 6, 7, 8]);
    expect(reasons[2]).toMatch(/swapped/);
    expect(reasons[3]).toMatch(/0, 0/);
    expect(reasons[5]).toMatch(/Areas/);
    expect(reasons[6]).toMatch(/several parts/);
    expect(reasons[7]).toMatch(/no position/);
    expect(reasons[8]).toMatch(/not a number/);
  });
});

describe('KML import plan', () => {
  const preview = previewKml(features);
  const [poles, lines] = preview.groups;

  it('imports nothing until every group has a choice', () => {
    const plan = planKmlImport(emptyNetwork(), preview, { [poles.key]: { target: 'Telecom Pole', status: 'existing' } }, { fileName: 'route.kml', now: NOW });
    expect(plan.unanswered).toEqual([lines.key]);
    expect(plan.equipment).toEqual([]);
    expect(importKml(emptyNetwork(), plan).ok).toBe(false);
    // A type without existing/planned is not an answer either.
    expect(planKmlImport(emptyNetwork(), preview, { [poles.key]: { target: 'Telecom Pole' }, [lines.key]: { target: 'skip' } }, { fileName: 'r.kml' }).unanswered).toEqual([poles.key]);
  });

  it('keeps names, descriptions and ExtendedData as written and connects nothing', () => {
    const plan = planKmlImport(
      emptyNetwork(),
      preview,
      { [poles.key]: { target: 'Electric Pole', status: 'existing' }, [lines.key]: { target: 'cable:Distribution Fiber', status: 'planned' } },
      { fileName: 'route.kml', now: NOW, importId: 'IMP-TEST' },
    );
    expect(plan.unanswered).toEqual([]);
    expect(plan.equipment).toHaveLength(2);
    const [first] = plan.equipment;
    expect(equipmentSchema.safeParse(first).success).toBe(true);
    expect(first).toMatchObject({
      name: 'P0',
      type: 'Electric Pole',
      category: 'Supporting Infrastructure',
      lat: 12.9,
      lng: 77.6,
      status: 'Active',
      locationMethod: 'imported',
      importInfo: { importId: 'IMP-TEST', fileName: 'route.kml', folderPath: 'Route A / Poles', styleId: 'pole-style', originalName: 'P0', description: 'Near the temple', extendedData: { owner: 'BESCOM', pole_no: '114' } },
    });
    // Accuracy is unknown, so none is stored, and the KML owner is not copied into a fact field.
    expect(first.locationAccuracyMeters).toBeUndefined();
    expect(first.ownerName).toBeUndefined();

    const [line] = plan.cables;
    expect(cableSchema.safeParse(line).success).toBe(true);
    expect(line).toMatchObject({ name: 'Main line', type: 'Distribution Fiber', status: 'Planned', fiberCount: 0, cores: [] });
    expect(line.startEquipmentId).toBeUndefined();
    expect(line.endEquipmentId).toBeUndefined();
    expect(line.lengthMeters).toBeGreaterThan(100);
    expect(line.coordinates[0]).toEqual([12.9, 77.6]);

    const result = importKml(emptyNetwork(), plan, { actor: 'Planner' });
    expect(result.ok).toBe(true);
    const after = applyPatch(emptyNetwork(), result.ok ? result.patch : {});
    expect(after.equipment).toHaveLength(2);
    expect(after.cables).toHaveLength(1);
    expect(after.spans).toBeUndefined();
    expect(after.attachments).toBeUndefined();
    expect(findBrokenLinks(after)).toEqual([]);
    // Importing the same plan twice adds nothing.
    expect(importKml(after, plan).ok).toBe(false);
  });

  it('imports lines as ducts, and skips a group the person chose not to import', () => {
    const plan = planKmlImport(
      emptyNetwork(),
      preview,
      { [poles.key]: { target: 'skip' }, [lines.key]: { target: 'duct', status: 'existing' } },
      { fileName: 'r.kml', now: NOW },
    );
    expect(plan.equipment).toEqual([]);
    expect(plan.ducts).toHaveLength(1);
    expect(ductSchema.safeParse(plan.ducts[0]).success).toBe(true);
    expect(plan.ducts[0]).toMatchObject({ status: 'built', basis: 'imported', cableIds: [], subducts: [] });
    expect(plan.skipped.filter((s) => /chose not to import/.test(s.reason))).toHaveLength(2);
  });

  it('holds back points that look like an existing item unless the person asks', () => {
    const data = { ...emptyNetwork(), equipment: [equipment({ id: 'POLE-OLD', type: 'Telecom Pole', lat: 12.90001, lng: 77.6 })] };
    const choices = { [poles.key]: { target: 'Telecom Pole' as const, status: 'existing' as const }, [lines.key]: { target: 'skip' as const } };
    const held = planKmlImport(data, preview, choices, { fileName: 'r.kml' });
    expect(held.equipment.map((e) => e.name)).toEqual(['P1']);
    expect(held.possibleDuplicates).toEqual([expect.objectContaining({ name: 'P0', existing: expect.objectContaining({ id: 'POLE-OLD' }) })]);
    const all = planKmlImport(data, preview, choices, { fileName: 'r.kml', includePossibleDuplicates: true });
    expect(all.equipment.map((e) => e.name)).toEqual(['P0', 'P1']);
  });

  it('gives a core count only when the person chose one, with cores marked not verified', () => {
    const plan = planKmlImport(
      emptyNetwork(),
      preview,
      { [poles.key]: { target: 'skip' }, [lines.key]: { target: 'cable:Main Feeder Fiber', status: 'existing', coreCount: 24 } },
      { fileName: 'r.kml' },
    );
    expect(plan.cables[0].fiberCount).toBe(24);
    expect(plan.cables[0].cores.every((c) => c.status === 'Unverified')).toBe(true);
  });
});
