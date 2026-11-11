import { describe, expect, it } from 'vitest';

import {
  checkChangeSetCableBuild,
  createCableWithSetup,
  editCableRoute,
  editDuctRoute,
  findDuplicateRoutes,
  newDuplicateRouteWarnings,
  POSSIBLE_DUPLICATE_ROUTE_KEPT,
  reverseCable,
  reverseDuct,
  saveCableBuild,
} from '../src/domain/cableRouteEdit';
import { cableBuildProblem, createCable } from '../src/domain/cables';
import { mergeCables, mergeCandidates, splitCable, splitPoint } from '../src/domain/cableSplitMerge';
import { applyPatch, type NetworkData } from '../src/domain/command';
import { buildCores } from '../src/domain/defaults';
import { findFiberProblems } from '../src/domain/fiberRules';
import { polylineLengthMeters } from '../src/domain/geo';
import { applyRouteEdit, routeOverlapRatio } from '../src/domain/routeGeometry';
import { cableSchema } from '../src/model/schemas';
import type { Cable, LatLng } from '../src/model/types';
import { cable, closure, customer, emptyNetwork, equipment, NOW, splice, splitter } from './fixtures';

const ctx = { now: NOW, actor: 'Tester' };

// A straight street running north, about 111 m between points.
const P: LatLng[] = [
  [17.4, 78.4],
  [17.401, 78.4],
  [17.402, 78.4],
  [17.403, 78.4],
];

const ok = <T>(r: { ok: boolean } & ({ ok: true; value: T } | { ok: false })) => {
  if (!r.ok) throw new Error(`expected ok: ${JSON.stringify(r)}`);
  return r as { ok: true; value: T; patch: Partial<NetworkData>; confirm?: string; audit: { action: string }[] };
};

/** ODF at the start, a closure pin mid-way, a FAT with a splitter at the end, a pole near point 2. */
function network(): NetworkData {
  const data = emptyNetwork();
  const assignment = { id: 'CA-1', kind: 'in_use' as const, use: 'PON OLT-1 / PON-1', effectiveFrom: '2026-01-01', createdAt: '2026-01-01' };
  const cores = buildCores(12).map((c) => (c.coreNumber === 1 ? { ...c, status: 'In Use' as const, assignments: [assignment] } : c));
  data.equipment = [
    equipment({
      id: 'ODF-1',
      type: 'ODF',
      lat: P[0][0],
      lng: P[0][1],
      odfPanels: [{ id: 'PNL-1', label: 'Panel 1', ports: [{ id: 'ODP-1', number: 1, status: 'in_use', feederCableId: 'CBL-X', feederCore: 1 }] }],
    }),
    equipment({ id: 'POLE-1', type: 'Telecom Pole', lat: P[1][0], lng: P[1][1] }),
    equipment({ id: 'JC-1', type: 'Splice Closure', lat: P[2][0], lng: P[2][1] }),
    equipment({ id: 'FAT-1', type: 'FAT', lat: P[3][0], lng: P[3][1] }),
  ];
  data.cables = [
    cable({
      id: 'CBL-X',
      name: 'Main street',
      fiberCount: 12,
      coordinates: P,
      lengthMeters: Math.round(polylineLengthMeters(P)),
      startEquipmentId: 'ODF-1',
      endEquipmentId: 'FAT-1',
      cores,
      sheathMarkStart: 1000,
      sheathMarkEnd: 1340,
      sheathMarkUnit: 'm',
      opticalLengthMeters: 345,
      opticalMeasuredAt: '2026-02-01T10:00:00.000Z',
    }),
  ];
  data.splitters = [splitter({ id: 'SPL-1', terminalBoxId: 'FAT-1', inputPort: { id: 'SPL-1-IN', connectedCableId: 'CBL-X', connectedCore: 1 } })];
  data.customers = [customer({ id: 'CUST-1', terminalBoxId: 'FAT-1', splitterId: 'SPL-1', distributionCableId: 'CBL-X', lat: 17.4035, lng: 78.4 })];
  data.attachments = [{ id: 'ATT-1', cableId: 'CBL-X', structureId: 'POLE-1', status: 'built', basis: 'office_confirmed', createdAt: '2026-01-01' }];
  data.slackLoops = [];
  data.ducts = [];
  data.spans = [];
  data.permissions = [];
  return data;
}

describe('route edits', () => {
  it('moves, adds, removes, extends and trims points, and refuses what would break the line', () => {
    const move = applyRouteEdit(P, { kind: 'move', index: 1, to: [17.401, 78.401] });
    expect(move.ok && move.points[1]).toEqual([17.401, 78.401]);
    const insert = applyRouteEdit(P, { kind: 'insert', point: [17.4005, 78.4001] });
    expect(insert.ok && insert.points).toHaveLength(5);
    expect(insert.ok && insert.points[1]).toEqual([17.4005, 78.4001]);
    const remove = applyRouteEdit(P, { kind: 'remove', index: 2 });
    expect(remove.ok && remove.points).toEqual([P[0], P[1], P[3]]);
    const extend = applyRouteEdit(P, { kind: 'extend', end: 'start', points: [[17.3995, 78.4], [17.399, 78.4]] });
    expect(extend.ok && extend.points.slice(0, 2)).toEqual([[17.399, 78.4], [17.3995, 78.4]]);
    const trim = applyRouteEdit(P, { kind: 'trim', index: 2, remove: 'end' });
    expect(trim.ok && trim.points).toEqual(P.slice(0, 3));

    expect(applyRouteEdit([P[0], P[1]], { kind: 'remove', index: 0 })).toMatchObject({ ok: false });
    expect(applyRouteEdit(P, { kind: 'trim', index: 0, remove: 'start' })).toMatchObject({ ok: false });
    expect(applyRouteEdit(P, { kind: 'move', index: 9, to: P[0] })).toMatchObject({ ok: false });
    expect(applyRouteEdit([], { kind: 'insert', point: P[0] })).toMatchObject({ ok: false });
  });

  it('works out the drawn length again and never touches sheath or OTDR lengths', () => {
    const data = network();
    const result = ok<Cable>(editCableRoute(data, 'CBL-X', { kind: 'trim', index: 2, remove: 'end' }));
    const updated = result.value;
    expect(updated.lengthMeters).toBe(Math.round(polylineLengthMeters(P.slice(0, 3))));
    expect(updated).toMatchObject({ sheathMarkStart: 1000, sheathMarkEnd: 1340, opticalLengthMeters: 345, endEquipmentId: 'FAT-1' });
    expect(result.audit[0].action).toBe('CABLE_ROUTE_EDITED');
  });

  it('asks before drawing a connected end away from its equipment, and disconnects nothing', () => {
    const data = network();
    const result = ok<Cable>(editCableRoute(data, 'CBL-X', { kind: 'move', index: 3, to: [17.4032, 78.4005] }));
    expect(result.confirm).toMatch(/no longer be drawn at FAT-1/);
    expect(result.value.endEquipmentId).toBe('FAT-1');
    // Moving an inner point does not ask.
    expect(ok<Cable>(editCableRoute(data, 'CBL-X', { kind: 'move', index: 1, to: [17.401, 78.4001] })).confirm).toBeUndefined();
  });

  it('turns a cable round: ends, ports and sheath marks swap, fibres stay', () => {
    const data = network();
    data.cables[0] = { ...data.cables[0], startPortName: 'PON-1' };
    const turned = ok<Cable>(reverseCable(data, 'CBL-X')).value;
    expect(turned.coordinates).toEqual([...P].reverse());
    expect(turned).toMatchObject({ startEquipmentId: 'FAT-1', endEquipmentId: 'ODF-1', endPortName: 'PON-1', sheathMarkStart: 1340, sheathMarkEnd: 1000, opticalLengthMeters: 345 });
    expect(turned.startPortName).toBeUndefined();
    expect(turned.cores).toEqual(data.cables[0].cores);
    expect(cableSchema.safeParse(turned).success).toBe(true);
  });

  it('edits and turns a duct line, keeping its cables and structures', () => {
    const data = network();
    data.ducts = [{ id: 'DCT-1', name: 'D1', coordinates: P, fromStructureId: 'ODF-1', toStructureId: 'FAT-1', startEntry: 'north wall', status: 'built', basis: 'office_drawn', cableIds: ['CBL-X'], subducts: [], createdAt: '2026-01-01' }];
    const edited = ok<{ coordinates: LatLng[] }>(editDuctRoute(data, 'DCT-1', { kind: 'remove', index: 1 }));
    expect(edited.value.coordinates).toHaveLength(3);
    const turned = ok<{ fromStructureId?: string; endEntry?: string; cableIds: string[] }>(reverseDuct(data, 'DCT-1')).value;
    expect(turned).toMatchObject({ fromStructureId: 'FAT-1', toStructureId: 'ODF-1', endEntry: 'north wall', cableIds: ['CBL-X'] });
  });
});

describe('splitting a cable', () => {
  it('finds the split point, refusing an end', () => {
    expect(splitPoint({ coordinates: P }, { index: 0 })).toMatch(/between the two ends/);
    expect(splitPoint({ coordinates: P }, { index: 2 })).toMatchObject({ index: 2 });
    const at = splitPoint({ coordinates: P }, { at: [17.4015, 78.4] });
    expect(typeof at !== 'string' && at.index).toBe(2);
    expect(typeof at !== 'string' && at.points).toHaveLength(5);
  });

  it('keeps every fibre, carries each link to the part where it is, and passes the fibre checks', () => {
    const data = network();
    const result = ok<{ first: Cable; second: Cable }>(splitCable(data, { cableId: 'CBL-X', index: 2, newCableId: 'CBL-Y', newName: 'Main street north', junctionEquipmentId: 'JC-1' }, ctx));
    const { first, second } = result.value;
    const after = applyPatch(data, result.patch);

    expect(first).toMatchObject({ id: 'CBL-X', startEquipmentId: 'ODF-1', endEquipmentId: 'JC-1', coordinates: P.slice(0, 3) });
    expect(second).toMatchObject({ id: 'CBL-Y', name: 'Main street north', startEquipmentId: 'JC-1', endEquipmentId: 'FAT-1', coordinates: P.slice(2) });
    expect(first.lengthMeters).toBe(Math.round(polylineLengthMeters(P.slice(0, 3))));
    expect(second.lengthMeters).toBe(Math.round(polylineLengthMeters(P.slice(2))));
    // Each sheath mark stays with its end; the whole-cable OTDR length is noted, not carried.
    expect(first).toMatchObject({ sheathMarkStart: 1000, sheathMarkUnit: 'm' });
    expect(first.sheathMarkEnd).toBeUndefined();
    expect(second).toMatchObject({ sheathMarkEnd: 1340, sheathMarkUnit: 'm' });
    expect(second.sheathMarkStart).toBeUndefined();
    expect(first.opticalLengthMeters).toBeUndefined();
    expect(second.opticalLengthMeters).toBeUndefined();
    expect(first.remarks).toMatch(/345 m by OTDR/);
    expect(second.remarks).toMatch(/345 m by OTDR/);

    // Fibre identity on both parts; the use given to fibre 1 is kept on both with its own id.
    expect(first.cores.map((c) => c.coreNumber)).toEqual(second.cores.map((c) => c.coreNumber));
    expect(first.cores[0].assignments?.[0].id).toBe('CA-1');
    expect(second.cores[0].assignments?.[0]).toMatchObject({ use: 'PON OLT-1 / PON-1' });
    expect(second.cores[0].assignments?.[0].id).not.toBe('CA-1');

    // ODF at the start stays on the first part; the splitter and customer at the FAT move to the second.
    expect(after.equipment.find((e) => e.id === 'ODF-1')?.odfPanels?.[0].ports[0].feederCableId).toBe('CBL-X');
    expect(after.splitters[0].inputPort.connectedCableId).toBe('CBL-Y');
    expect(after.customers[0].distributionCableId).toBe('CBL-Y');
    expect(after.attachments?.[0]).toMatchObject({ cableId: 'CBL-X', structureId: 'POLE-1' });

    // Fibre records on both sides: the person is told the path will show a gap until the joint is recorded.
    expect(result.confirm).toMatch(/gap at JC-1/);
    expect(result.audit.map((a) => a.action)).toEqual(expect.arrayContaining(['CABLE_SPLIT', 'WARNING_ACCEPTED']));
    expect(findFiberProblems(after).filter((p) => p.severity === 'error')).toEqual([]);
    for (const c of after.cables) expect(cableSchema.safeParse(c).success).toBe(true);
  });

  it('puts a pole at the split point on both parts, and a duct across it holds both', () => {
    const data = network();
    data.equipment.push(equipment({ id: 'POLE-2', type: 'Telecom Pole', lat: P[2][0], lng: P[2][1] }));
    data.attachments!.push({ id: 'ATT-2', cableId: 'CBL-X', structureId: 'POLE-2', status: 'built', basis: 'office_confirmed', createdAt: '2026-01-01' });
    data.ducts = [{ id: 'DCT-1', name: 'D1', coordinates: [P[1], P[3]], fromStructureId: 'POLE-1', toStructureId: 'FAT-1', status: 'built', basis: 'office_drawn', cableIds: ['CBL-X'], subducts: [], createdAt: '2026-01-01' }];
    const result = ok<{ first: Cable; second: Cable }>(splitCable(data, { cableId: 'CBL-X', index: 2, newCableId: 'CBL-Y' }, ctx));
    const after = applyPatch(data, result.patch);
    const onPole2 = after.attachments!.filter((a) => a.structureId === 'POLE-2').map((a) => a.cableId).sort();
    expect(onPole2).toEqual(['CBL-X', 'CBL-Y']);
    expect(after.ducts![0].cableIds).toEqual(['CBL-X', 'CBL-Y']);
    // No closure chosen: the new ends are not connected.
    expect(result.value.first.endEquipmentId).toBeUndefined();
    expect(result.value.second.startEquipmentId).toBeUndefined();
  });

  it('refuses, with the reason, when a link cannot be placed on one part', () => {
    const atJoint = network();
    atJoint.closures = [closure({ id: 'CLO-1', equipmentId: 'JC-1', lat: P[2][0], lng: P[2][1], splices: [splice({ id: 'S1', inputCableId: 'CBL-X', outputCableId: 'CBL-Z' })] })];
    atJoint.cables.push(cable({ id: 'CBL-Z', coordinates: [P[2], [17.402, 78.401]], cores: buildCores(12) }));
    const refused = splitCable(atJoint, { cableId: 'CBL-X', index: 2, junctionEquipmentId: 'JC-1' }, ctx);
    expect(refused).toMatchObject({ ok: false, error: { title: 'Not split' } });
    expect(!refused.ok && refused.error.message).toMatch(/at the split point/);

    const loop = network();
    loop.slackLoops = [{ id: 'SLK-1', name: 'Slack 20 m', cableId: 'CBL-X', lat: P[2][0], lng: P[2][1], lengthMeters: 20, lengthSource: 'entered', createdAt: '2026-01-01' }];
    expect(splitCable(loop, { cableId: 'CBL-X', index: 2 }, ctx)).toMatchObject({ ok: false });

    const far = network();
    far.equipment.push(equipment({ id: 'ODF-FAR', type: 'ODF', lat: 17.5, lng: 78.5, odfPanels: [{ id: 'PNL-2', label: 'P', ports: [{ id: 'ODP-2', number: 1, status: 'in_use', feederCableId: 'CBL-X', feederCore: 2 }] }] }));
    const farResult = splitCable(far, { cableId: 'CBL-X', index: 2 }, ctx);
    expect(!farResult.ok && farResult.error.message).toMatch(/not on this cable’s line/);
    // Nothing was changed.
    expect(far.cables).toHaveLength(1);
  });

  it('refuses an id that is taken and an end as the split point', () => {
    const data = network();
    data.cables.push(cable({ id: 'CBL-Y' }));
    expect(splitCable(data, { cableId: 'CBL-X', index: 2, newCableId: 'CBL-Y' }, ctx)).toMatchObject({ ok: false });
    expect(splitCable(data, { cableId: 'CBL-X', index: 3 }, ctx)).toMatchObject({ ok: false });
  });
});

describe('joining cables', () => {
  it('joins the two parts of a split back into one, with every link back on it', () => {
    const data = network();
    const split = ok<{ first: Cable; second: Cable }>(splitCable(data, { cableId: 'CBL-X', index: 2, newCableId: 'CBL-Y', junctionEquipmentId: 'JC-1' }, ctx));
    const parted = applyPatch(data, split.patch);
    expect(mergeCandidates(parted, 'CBL-X').map((c) => [c.cable.id, c.problem])).toEqual([['CBL-Y', undefined]]);

    const merged = ok<Cable>(mergeCables(parted, 'CBL-X', 'CBL-Y', ctx));
    const after = applyPatch(parted, merged.patch);
    expect(after.cables.map((c) => c.id)).toEqual(['CBL-X']);
    expect(merged.value).toMatchObject({ startEquipmentId: 'ODF-1', endEquipmentId: 'FAT-1', sheathMarkStart: 1000, sheathMarkEnd: 1340, coordinates: P });
    expect(merged.value.lengthMeters).toBe(Math.round(polylineLengthMeters(P)));
    expect(after.splitters[0].inputPort.connectedCableId).toBe('CBL-X');
    expect(after.customers[0].distributionCableId).toBe('CBL-X');
    // The copied use is not doubled.
    expect(merged.value.cores[0].assignments).toHaveLength(1);
    expect(merged.confirm).toMatch(/CBL-Y is removed/);
    expect(findFiberProblems(after).filter((p) => p.severity === 'error')).toEqual([]);
  });

  it('turns the other cable to fit when it was drawn the other way', () => {
    const data = emptyNetwork();
    data.cables = [
      cable({ id: 'A', coordinates: [P[0], P[1]], cores: buildCores(12) }),
      cable({ id: 'B', coordinates: [P[3], P[2], P[1]], cores: buildCores(12) }),
    ];
    const merged = ok<Cable>(mergeCables(data, 'A', 'B', ctx));
    expect(merged.value.coordinates).toEqual(P);
  });

  it('refuses different fibre counts, layouts, kinds and cables joined by splices', () => {
    const base = () => {
      const d = emptyNetwork();
      d.cables = [cable({ id: 'A', coordinates: [P[0], P[1]], cores: buildCores(12) }), cable({ id: 'B', coordinates: [P[1], P[2]], cores: buildCores(12) })];
      return d;
    };
    const counts = base();
    counts.cables[1] = { ...counts.cables[1], fiberCount: 24, cores: buildCores(24) };
    expect(mergeCables(counts, 'A', 'B', ctx)).toMatchObject({ ok: false, error: { title: 'Not joined' } });

    const layout = base();
    layout.cables[1] = { ...layout.cables[1], fibersPerTube: 6, tubeCount: 2 };
    expect(!mergeCables(layout, 'A', 'B', ctx).ok).toBe(true);

    const kind = base();
    kind.cables[1] = { ...kind.cables[1], type: 'Drop Fiber' };
    expect(!mergeCables(kind, 'A', 'B', ctx).ok).toBe(true);

    const spliced = base();
    spliced.closures = [closure({ id: 'C1', splices: [splice({ id: 'S1', inputCableId: 'A', outputCableId: 'B' })] })];
    const r = mergeCables(spliced, 'A', 'B', ctx);
    expect(!r.ok && r.error.message).toMatch(/splice record/);

    const apart = base();
    apart.cables[1] = { ...apart.cables[1], coordinates: [[17.5, 78.5], [17.6, 78.6]] };
    expect(!mergeCables(apart, 'A', 'B', ctx).ok).toBe(true);

    const states = base();
    states.cables[1] = { ...states.cables[1], cores: buildCores(12).map((c) => (c.coreNumber === 3 ? { ...c, status: 'Damaged' as const } : c)) };
    const s = mergeCables(states, 'A', 'B', ctx);
    expect(!s.ok && s.error.message).toMatch(/fibre 3/);
  });
});

describe('"same cable?" check', () => {
  const twins = () => {
    const data = emptyNetwork();
    data.equipment = [equipment({ id: 'E1', type: 'FDT', lat: P[0][0], lng: P[0][1] }), equipment({ id: 'E2', type: 'FAT', lat: P[3][0], lng: P[3][1] })];
    data.cables = [cable({ id: 'OLD', coordinates: P, startEquipmentId: 'E1', endEquipmentId: 'E2' })];
    return data;
  };

  it('finds another cable with the same two ends along the same line, either way round', () => {
    const data = twins();
    const along = { id: 'NEW', startEquipmentId: 'E2', endEquipmentId: 'E1', coordinates: [P[3], [17.4015, 78.40003] as LatLng, P[0]] };
    expect(findDuplicateRoutes(data.cables, along).map((d) => d.cable.id)).toEqual(['OLD']);
    // Same ends, another street: not a duplicate.
    const detour = { ...along, coordinates: [P[3], [17.4015, 78.41] as LatLng, P[0]] };
    expect(findDuplicateRoutes(data.cables, detour)).toEqual([]);
    // A blank end is never compared.
    expect(findDuplicateRoutes(data.cables, { ...along, endEquipmentId: undefined })).toEqual([]);
    expect(routeOverlapRatio(P, P, 10)).toBe(1);
  });

  it('warns on the server, never refuses, and records the person’s choice', () => {
    const data = twins();
    const incoming = cable({ id: 'NEW', coordinates: P, startEquipmentId: 'E1', endEquipmentId: 'E2' });
    const [warning] = newDuplicateRouteWarnings(data.cables, { upserts: { cables: [incoming] } }, []);
    expect(warning).toMatchObject({ rule: 'possible_duplicate_route', cableId: 'NEW', nearId: 'OLD', overlapPercent: 100, overridden: false });
    const kept = newDuplicateRouteWarnings(
      data.cables,
      { upserts: { cables: [incoming], auditLogs: [{ id: 'L1', timestamp: 'x', user: 'u', role: 'Network Engineer', action: POSSIBLE_DUPLICATE_ROUTE_KEPT, details: '', assetId: 'NEW', assetType: 'Cable' }] } },
      [],
    );
    expect(kept[0].overridden).toBe(true);
    // An unchanged cable saved again is not warned about.
    expect(newDuplicateRouteWarnings([...data.cables, incoming], { upserts: { cables: [incoming] } }, [])).toEqual([]);
    // The operator's setting is used.
    expect(newDuplicateRouteWarnings(data.cables, { upserts: { cables: [incoming] } }, [{ id: 'osp.duplicateRoute.overlapPercent', value: 99.99 }])).toHaveLength(1);
  });
});

describe('how the cable is made', () => {
  it('refuses only real contradictions, and leaves blanks as not recorded', () => {
    expect(cableBuildProblem({ fiberStandard: 'G.652D', fiberMode: 'multi_mode' })).toMatch(/single-mode/);
    expect(cableBuildProblem({ fiberStandard: 'OM3', fiberMode: 'single_mode' })).toMatch(/multimode/);
    expect(cableBuildProblem({ fiberStandard: 'G.657A2', fiberMode: 'single_mode' })).toBeNull();
    expect(cableBuildProblem({ fiberStandard: 'G.652D' })).toBeNull();
    expect(cableBuildProblem({ type: 'Coaxial Cable', fiberMode: 'single_mode' })).toMatch(/coaxial/);
    const refused = createCable(emptyNetwork(), { name: 'C', type: 'Distribution Fiber', coordinates: P, fiberStandard: 'G.652D', fiberMode: 'multi_mode' }, ctx);
    expect(refused).toMatchObject({ ok: false });
    expect(checkChangeSetCableBuild({ upserts: { cables: [cable({ id: 'Q', fiberStandard: 'OM4', fiberMode: 'single_mode' })] } })).toHaveLength(1);
  });

  it('saves standard, mode, sheath and diameter, and install method apart from the type', () => {
    const data = network();
    const saved = ok<Cable>(saveCableBuild(data, 'CBL-X', { fiberStandard: 'G.657A1', fiberMode: 'single_mode', sheath: 'LSZH', outerDiameterMm: 8.5, installationType: 'Duct' })).value;
    expect(saved).toMatchObject({ fiberStandard: 'G.657A1', fiberMode: 'single_mode', sheath: 'LSZH', outerDiameterMm: 8.5, installationType: 'Duct', type: 'Distribution Fiber' });
    expect(saved.manufacturer).toBeUndefined();
    expect(cableSchema.safeParse(saved).success).toBe(true);
    expect(saveCableBuild(data, 'CBL-X', { outerDiameterMm: 0 })).toMatchObject({ ok: false });
  });
});

describe('cable wizard save', () => {
  it('saves the cable, its tubes, poles and slack loop as one change', () => {
    const data = network();
    const result = ok<Cable>(
      createCableWithSetup(
        data,
        {
          draft: { id: 'CBL-NEW', name: 'New', type: 'Distribution Fiber', fiberCount: 24, coordinates: [P[0], P[1], P[2]], startEquipmentId: 'ODF-1', endEquipmentId: 'JC-1' },
          layout: { colorScheme: 'tia-598', tubes: [{ fiberCount: 12 }, { fiberCount: 12 }] },
          poles: { ids: ['POLE-1'], status: 'planned' },
          slackLoops: [{ structureId: 'POLE-1', lengthMeters: 15 }],
        },
        ctx,
      ),
    );
    const after = applyPatch(data, result.patch);
    const saved = after.cables.find((c) => c.id === 'CBL-NEW')!;
    expect(saved.tubes).toHaveLength(2);
    expect(after.attachments!.filter((a) => a.cableId === 'CBL-NEW')).toMatchObject([{ structureId: 'POLE-1', status: 'planned', basis: 'route_proposal_confirmed' }]);
    expect(after.slackLoops!.filter((l) => l.cableId === 'CBL-NEW')).toHaveLength(1);
    expect(result.audit.map((a) => a.action)).toEqual(expect.arrayContaining(['CABLE_CREATED', 'CABLE_LAYOUT_SET', 'ATTACHMENT_CREATED', 'SLACK_LOOP_CREATED']));
  });

  it('saves nothing when one part is refused', () => {
    const data = network();
    const result = createCableWithSetup(data, { draft: { name: 'New', type: 'Distribution Fiber', fiberCount: 24, coordinates: [P[0], P[1]] }, layout: { tubes: [{ fiberCount: 12 }, { fiberCount: 6 }] } }, ctx);
    expect(result).toMatchObject({ ok: false, error: { title: 'Cable not saved' } });
  });
});
