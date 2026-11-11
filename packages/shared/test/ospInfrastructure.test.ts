import { describe, expect, it } from 'vitest';

import { checkChangeAccess } from '../src/domain/access';
import { deleteCable } from '../src/domain/cables';
import { applyPatch, type NetworkData } from '../src/domain/command';
import { deleteEquipment, moveEquipment } from '../src/domain/equipment';
import { ductCapacity, ductOccupancyIssues, ductPlaces, fillLimit, placeFill, undergroundTrace, withCableIn, withWayCondition } from '../src/domain/ospDucts';
import { applyMoveChoices, choicesFromOffers, footprintProblem, setBuildingFootprint, setSpanRoute, structureMovePreview } from '../src/domain/ospGeometry';
import { createInspection, deleteInspection, inspectionsFor, inspectionTargetOf } from '../src/domain/ospInspections';
import { DEFAULT_OSP_SETTINGS, OSP_SETTING_DEFS, resolveOspSettings } from '../src/domain/ospSettings';
import { checkChangeSetLinks, deleteDuct, deleteSpan, ductCableIds, ductsForCable, findBrokenLinks, spanDrawnMeters, spanLine, updateDuct, updateSpan } from '../src/domain/outsidePlant';
import { checkRestoredNetwork } from '../src/domain/restoreCheck';
import { COLLECTION_NAMES } from '../src/model/collections';
import { buildingSchema, ductSchema, inspectionSchema, spanSchema } from '../src/model/schemas';
import type { Building, Duct, Inspection, Span } from '../src/model/types';
import { createSampleNetwork } from '../src/sample';
import { cable, emptyNetwork, equipment, NOW } from './fixtures';

const ctx = { now: NOW, actor: 'Planner' };

const ok = <T>(result: { ok: true; value: T } | { ok: false; error?: { message: string } }) => {
  if (!result.ok) throw new Error(`expected success: ${(result as { error?: { message: string } }).error?.message}`);
  return result as { ok: true; value: T; patch: Partial<NetworkData>; confirm?: string; audit: { action: string; details: string }[] };
};

/** Two poles 50 m apart, two chambers joined by ducts, a cable along the poles. */
function plant(): NetworkData {
  const duct = (id: string, from: string | undefined, to: string | undefined, coords: [number, number][], extra: Partial<Duct> = {}): Duct => ({
    id,
    name: id,
    coordinates: coords,
    ...(from ? { fromStructureId: from } : {}),
    ...(to ? { toStructureId: to } : {}),
    status: 'built',
    basis: 'office_drawn',
    cableIds: [],
    subducts: [],
    createdAt: NOW.toISOString(),
    ...extra,
  });
  return {
    ...emptyNetwork(),
    equipment: [
      equipment({ id: 'P1', type: 'Telecom Pole', lat: 12.9, lng: 77.6 }),
      equipment({ id: 'P2', type: 'Telecom Pole', lat: 12.9, lng: 77.60046 }),
      equipment({ id: 'MH1', type: 'Manhole', lat: 12.901, lng: 77.6 }),
      equipment({ id: 'MH2', type: 'Manhole', lat: 12.901, lng: 77.601 }),
      equipment({ id: 'MH3', type: 'Handhole', lat: 12.901, lng: 77.602 }),
      equipment({ id: 'FAT1', type: 'FAT', lat: 12.9, lng: 77.6 }),
    ],
    cables: [
      cable({ id: 'C1', name: 'Feeder 1', outerDiameterMm: 12, coordinates: [[12.9, 77.6], [12.90001, 77.6002], [12.9, 77.60046]] }),
      cable({ id: 'C2', name: 'Drop 2', outerDiameterMm: 6 }),
      cable({ id: 'C3', name: 'Old cable', coordinates: [[12.9, 77.6], [12.8, 77.5]], startEquipmentId: 'P1' }),
    ],
    spans: [{ id: 'SP1', name: 'P1 – P2', fromStructureId: 'P1', toStructureId: 'P2', status: 'built', basis: 'office_drawn', createdAt: NOW.toISOString() }],
    attachments: [],
    ducts: [
      duct('D1', 'MH1', 'MH2', [[12.901, 77.6], [12.901, 77.601]], {
        innerDiameterMm: 40,
        subducts: [
          { id: 'S1', label: 'Blue', innerDiameterMm: 20, cableIds: [] },
          { id: 'S2', label: 'Red', cableIds: [], condition: 'blocked' },
          { id: 'S3', label: 'Green', cableIds: [], condition: 'damaged', microducts: [{ id: 'M1', label: '7', innerDiameterMm: 10, cableIds: [] }] },
        ],
      }),
      duct('D2', 'MH2', 'MH3', [[12.901, 77.601], [12.901, 77.602]]),
      // Its line starts on MH3, but no start is recorded: it must not be joined by nearness.
      duct('D3', undefined, 'P1', [[12.901, 77.602], [12.9, 77.6]]),
      duct('D4', 'MH9-GONE', undefined, [[12.902, 77.6], [12.903, 77.6]]),
    ],
    slackLoops: [{ id: 'L1', name: 'Slack 10 m', cableId: 'C1', structureId: 'P1', lat: 12.9, lng: 77.6, lengthMeters: 10, lengthSource: 'entered', createdAt: NOW.toISOString() }],
    permissions: [],
    inspections: [],
    buildings: [],
  };
}

describe('Phase 4 settings', () => {
  it('has the fill limits and the pole-move distance, each with a source', () => {
    for (const id of ['osp.duct.fillOneCablePercent', 'osp.duct.fillTwoCablesPercent', 'osp.duct.fillManyCablesPercent', 'osp.poleMove.vertexMeters']) {
      const def = OSP_SETTING_DEFS.find((d) => d.id === id);
      expect(def?.source.length).toBeGreaterThan(20);
    }
    expect(DEFAULT_OSP_SETTINGS).toMatchObject({ ductFillOneCableRatio: 0.53, ductFillTwoCablesRatio: 0.31, ductFillManyCablesRatio: 0.4, poleMoveVertexMeters: 2 });
    const s = resolveOspSettings([{ id: 'osp.duct.fillManyCablesPercent', value: 35 }, { id: 'osp.duct.fillOneCablePercent', value: 140 }]);
    expect(s.ductFillManyCablesRatio).toBe(0.35);
    expect(s.ductFillOneCableRatio).toBe(0.53);
    expect([fillLimit(1), fillLimit(2), fillLimit(5)]).toEqual([0.53, 0.31, 0.4]);
  });
});

describe('inspections collection', () => {
  it('is registered and starts empty in the sample', () => {
    expect(COLLECTION_NAMES).toContain('inspections');
    expect(createSampleNetwork().inspections).toEqual([]);
  });
});

describe('span line and condition', () => {
  it('draws the bends between the poles and keeps the ends on the poles', () => {
    const data = plant();
    const straight = spanDrawnMeters(data.spans![0], data.equipment)!;
    const result = ok(setSpanRoute(data, 'SP1', [[12.9002, 77.6002]], ctx));
    const span = result.value;
    expect(span.routePoints).toEqual([[12.9002, 77.6002]]);
    expect(spanSchema.safeParse(span).success).toBe(true);
    expect(spanLine(span, data.equipment)).toEqual([[12.9, 77.6], [12.9002, 77.6002], [12.9, 77.60046]]);
    expect(spanDrawnMeters(span, data.equipment)!).toBeGreaterThan(straight);
    // Moving a pole moves the end of the line, because ends are never stored.
    const moved = applyPatch({ ...data, ...result.patch }, ok(moveEquipment({ ...data, ...result.patch }, 'P2', 12.9, 77.6006)).patch);
    expect(spanLine(moved.spans![0], moved.equipment)!.at(-1)).toEqual([12.9, 77.6006]);
    // Cleared: straight again.
    expect(ok(setSpanRoute(data, 'SP1', null, ctx)).value.routePoints).toBeUndefined();
  });

  it('refuses a point that is not a real place, and keeps condition only as set', () => {
    const data = plant();
    expect(setSpanRoute(data, 'SP1', [[95, 77]], ctx).ok).toBe(false);
    expect(updateSpan(data, { ...data.spans![0], routePoints: [[12.9, 200]] }).ok).toBe(false);
    const span: Span = { ...data.spans![0], condition: 'poor', conditionAt: NOW.toISOString() };
    expect(ok(updateSpan(data, span)).value.condition).toBe('poor');
    expect(data.spans![0].condition).toBeUndefined();
  });
});

describe('duct ways, microducts and fill', () => {
  it('passes a blocked duct on to every way inside it', () => {
    const data = plant();
    const places = ductPlaces({ ...data.ducts![0], condition: 'blocked' });
    expect(places.every((p) => p.effectiveCondition === 'blocked')).toBe(true);
    const own = ductPlaces(data.ducts![0]);
    expect(own.find((p) => p.key === 'S1')?.effectiveCondition).toBeUndefined();
    expect(own.find((p) => p.key === 'M1')).toMatchObject({ effectiveCondition: 'damaged', conditionFrom: 'sub-duct Green' });
  });

  it('works out fill only from recorded diameters and says what is missing', () => {
    const data = plant();
    const duct = withCableIn(withCableIn(data.ducts![0], 'S1', 'C1')!, 'S1', 'C2')!;
    const s1 = ductPlaces(duct).find((p) => p.key === 'S1')!;
    const fill = placeFill(s1, data.cables);
    expect(fill.ratio).toBeCloseTo((12 ** 2 + 6 ** 2) / 20 ** 2);
    expect(fill.over).toBe(true); // 45% with two cables, above 31%
    // No inside diameter: no number.
    const red = placeFill({ ...ductPlaces(data.ducts![0]).find((p) => p.key === 'S2')!, cableIds: ['C1'] }, data.cables);
    expect(red.ratio).toBeUndefined();
    expect(red.missing).toMatch(/Inside diameter not recorded/);
    // A cable with no outside diameter: no number, and it is named.
    const old = placeFill({ ...s1, cableIds: ['C3'] }, data.cables);
    expect(old.ratio).toBeUndefined();
    expect(old.missing).toMatch(/Old cable/);
    // The duct itself holds sub-ducts, so its own fill is not worked out.
    expect(placeFill({ ...ductPlaces(duct)[0], cableIds: ['C2'] }, data.cables).missing).toMatch(/smaller way/);
  });

  it('counts microduct cables everywhere a duct cable is counted', () => {
    const data = plant();
    const duct = withCableIn(data.ducts![0], 'M1', 'C2')!;
    expect(ductCableIds(duct)).toEqual(['C2']);
    const after = { ...data, ducts: [duct, ...data.ducts!.slice(1)] };
    expect(ductsForCable(after, 'C2')[0]).toMatchObject({ subduct: { id: 'S3' }, microduct: { id: 'M1' } });
    const removed = applyPatch(after, ok(deleteCable(after, 'C2')).patch);
    expect(ductCableIds(removed.ducts![0])).toEqual([]);
    expect(ductSchema.safeParse(duct).success).toBe(true);
  });

  it('reports capacity from the record only', () => {
    const data = plant();
    const duct = { ...withCableIn(data.ducts![0], 'S1', 'C1')!, wayCount: 4 };
    expect(ductCapacity(duct)).toMatchObject({ wayCount: 4, described: 3, undescribed: 1, inUse: 1, free: 1, blocked: 1, damaged: 1, notChecked: 1 });
    expect(ductCapacity(duct).microducts).toEqual({ total: 1, inUse: 0, free: 1, blocked: 0 });
  });
});

describe('a blocked way is refused for a new cable', () => {
  it('refuses in the command and on the server, and says how to clear it', () => {
    const data = plant();
    const next = withCableIn(data.ducts![0], 'S2', 'C1')!;
    const result = updateDuct(data, next);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/Sub-duct Red .* blocked.*mark it "Clear" first/);
    const problems = checkChangeSetLinks(data, { upserts: { ducts: [next] } });
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toMatch(/blocked/);
  });

  it('refuses a microduct inside a blocked way, and a way in a blocked duct', () => {
    const data = plant();
    const blockedSub = withWayCondition(data.ducts![0], 'S3', 'blocked', NOW.toISOString())!;
    expect(updateDuct({ ...data, ducts: [blockedSub] }, withCableIn(blockedSub, 'M1', 'C2')!).ok).toBe(false);
    const blockedDuct = withWayCondition(data.ducts![0], 'duct', 'blocked', NOW.toISOString(), 'Crushed at km 2')!;
    expect(blockedDuct).toMatchObject({ condition: 'blocked', conditionNote: 'Crushed at km 2' });
    expect(updateDuct({ ...data, ducts: [blockedDuct] }, withCableIn(blockedDuct, 'S1', 'C1')!).ok).toBe(false);
  });

  it('does not blame a cable already recorded before the way was found blocked', () => {
    const data = plant();
    const withCable = withCableIn(data.ducts![0], 'S1', 'C1')!;
    const stored = { ...data, ducts: [withCable, ...data.ducts!.slice(1)] };
    const nowBlocked = withWayCondition(withCable, 'S1', 'blocked', NOW.toISOString())!;
    expect(ok(updateDuct(stored, nowBlocked)).confirm).toBeUndefined();
    expect(checkChangeSetLinks(stored, { upserts: { ducts: [nowBlocked] } })).toEqual([]);
  });

  it('only warns for a damaged way or a fill above the setting, and logs the override', () => {
    const data = plant();
    const damaged = ok(updateDuct(data, withCableIn(data.ducts![0], 'S3', 'C2')!));
    expect(damaged.confirm).toMatch(/damaged/);
    expect(damaged.audit.map((a) => a.action)).toContain('WARNING_ACCEPTED');
    const full = ok(updateDuct(data, withCableIn(withCableIn(data.ducts![0], 'S1', 'C1')!, 'S1', 'C2')!));
    expect(full.confirm).toMatch(/45% full with 2 cable/);
    // Warnings never block on the server.
    expect(checkChangeSetLinks(data, { upserts: { ducts: [withCableIn(data.ducts![0], 'S3', 'C2')!] } })).toEqual([]);
    expect(ductOccupancyIssues(undefined, withCableIn(data.ducts![0], 'S1', 'C2')!, data.cables)).toEqual([]);
  });
});

describe('underground trace', () => {
  it('follows only recorded duct ends and names each gap', () => {
    const trace = undergroundTrace(plant(), 'D1')!;
    expect(trace.steps.map((s) => s.duct.id)).toEqual(['D1', 'D2']);
    expect(trace.steps[1]).toMatchObject({ viaStructureId: 'MH2', depth: 1 });
    expect(trace.structures.map((s) => s.id)).toEqual(['MH1', 'MH2', 'MH3']);
    // D3 starts on MH3 on the map, but no start is recorded: not joined.
    expect(trace.steps.some((s) => s.duct.id === 'D3')).toBe(false);
    const fromD3 = undergroundTrace(plant(), 'D3')!;
    expect(fromD3.gaps[0].message).toMatch(/start is, is not recorded/);
    expect(undergroundTrace(plant(), 'D4')!.gaps[0].message).toMatch(/MH9-GONE, which is not on record/);
    expect(undergroundTrace(plant(), 'NOPE')).toBeUndefined();
  });
});

describe('inspections', () => {
  const draft = { targetType: 'pole' as const, targetId: 'P1', inspectedOn: '2026-11-03', inspectedBy: 'Ravi', condition: 'fair' as const, findings: ' Leaning a little ', photoIds: ['INS-ABCDEF123456'] };

  it('saves what the person recorded and nothing more', () => {
    const data = plant();
    const result = ok(createInspection(data, draft, ctx));
    expect(result.value).toMatchObject({ targetType: 'pole', targetId: 'P1', inspectedOn: '2026-11-03', inspectedBy: 'Ravi', condition: 'fair', findings: 'Leaning a little', createdBy: 'Planner' });
    expect(inspectionSchema.safeParse(result.value).success).toBe(true);
    const none = ok(createInspection(data, { ...draft, findings: '  ', photoIds: [] }, ctx)).value;
    expect(none.findings).toBeUndefined();
    expect(none.photoIds).toBeUndefined();
  });

  it('refuses a missing target, the wrong kind, a future day, no person, no condition and a bad photo id', () => {
    const data = plant();
    const message = (d: Parameters<typeof createInspection>[1]) => {
      const r = createInspection(data, d, ctx);
      return r.ok ? '' : r.error.message;
    };
    expect(message({ ...draft, targetId: 'GONE' })).toMatch(/not on the map/);
    expect(message({ ...draft, targetType: 'chamber' })).toMatch(/not a manhole or handhole/);
    expect(message({ ...draft, targetType: 'span', targetId: 'SP-GONE' })).toMatch(/not on record/);
    expect(message({ ...draft, inspectedOn: '2026-12-25' })).toMatch(/future/);
    expect(message({ ...draft, inspectedOn: '3 Nov' })).toMatch(/Choose the day/);
    expect(message({ ...draft, inspectedBy: ' ' })).toMatch(/who did/);
    expect(message({ ...draft, condition: undefined })).toMatch(/good, fair or poor/);
    expect(message({ ...draft, photoIds: ['../x'] })).toMatch(/not a saved photo/);
  });

  it('knows poles from chambers and lists newest first', () => {
    const data = plant();
    expect(inspectionTargetOf(data.equipment[0])).toBe('pole');
    expect(inspectionTargetOf(data.equipment[4])).toBe('chamber');
    // Phase 19: a FAT (a box) has inspections too, with its own checklist.
    expect(inspectionTargetOf(data.equipment[5])).toBe('box');
    const a = ok(createInspection(data, draft, ctx)).value;
    const b = ok(createInspection(data, { ...draft, inspectedOn: '2026-11-04', condition: 'good' }, ctx)).value;
    expect(inspectionsFor({ inspections: [a, b] }, 'pole', 'P1').map((i) => i.id)).toEqual([b.id, a.id]);
    const removed = ok(deleteInspection({ ...data, inspections: [a, b] }, a.id));
    expect(removed.patch.inspections).toEqual([b]);
  });

  it('cannot point to a missing record, and goes with what it inspected', () => {
    const data = plant();
    const inspection: Inspection = { id: 'INS-1', targetType: 'span', targetId: 'SP1', inspectedOn: '2026-11-03', inspectedBy: 'Ravi', condition: 'good', createdAt: NOW.toISOString() };
    const broken = { ...inspection, id: 'INS-2', targetId: 'SP-GONE' };
    expect(checkChangeSetLinks(data, { upserts: { inspections: [broken] } })[0].message).toMatch(/what it inspected "SP-GONE"/);
    expect(checkChangeSetLinks(data, { upserts: { inspections: [inspection] } })).toEqual([]);
    const stored = { ...data, inspections: [inspection, { ...inspection, id: 'INS-3', targetType: 'pole' as const, targetId: 'P1' }, { ...inspection, id: 'INS-4', targetType: 'duct' as const, targetId: 'D2' }] };
    // Deleting the span alone would leave it pointing at nothing, so the server refuses that...
    expect(checkChangeSetLinks(stored, { deletes: { spans: ['SP1'] } })).toHaveLength(1);
    // ...and the delete commands take inspections with them, and say so.
    const span = ok(deleteSpan(stored, 'SP1'));
    expect(span.confirm).toMatch(/1 inspection/);
    expect(span.patch.inspections?.map((i) => i.id)).toEqual(['INS-3', 'INS-4']);
    expect(ok(deleteDuct(stored, 'D2')).patch.inspections?.map((i) => i.id)).toEqual(['INS-1', 'INS-3']);
    const onlyPole = { ...stored, cables: stored.cables.filter((c) => c.startEquipmentId !== 'P1') };
    const pole = ok(deleteEquipment(onlyPole, 'P1'));
    // The pole's own inspection and its span's go; the duct's stays.
    expect(pole.patch.inspections?.map((i) => i.id)).toEqual(['INS-4']);
    expect(findBrokenLinks(applyPatch(onlyPole, pole.patch) as never).filter((p) => p.collection === 'inspections')).toEqual([]);
    expect(checkRestoredNetwork({ ...createSampleNetwork(), inspections: [broken] }).counts.links).toBe(1);
  });

  it('lets a technician add one from the field and change only their own', () => {
    const tech = { id: 'u-tech', username: 'ravi', displayName: 'Ravi', role: 'technician' as const };
    const inspection: Inspection = { id: 'INS-9', targetType: 'pole', targetId: 'P1', inspectedOn: '2026-11-03', inspectedBy: 'Ravi', condition: 'good', createdAt: NOW.toISOString() };
    expect(checkChangeAccess(tech, { upserts: { inspections: [inspection] } }, () => undefined)).toEqual([]);
    const someoneElses = () => ({ record: inspection as unknown as Record<string, unknown>, createdBy: 'u-other' });
    expect(checkChangeAccess(tech, { deletes: { inspections: ['INS-9'] } }, someoneElses)).toHaveLength(1);
    const own = () => ({ record: inspection as unknown as Record<string, unknown>, createdBy: 'u-tech' });
    expect(checkChangeAccess(tech, { upserts: { inspections: [{ ...inspection, findings: 'Fixed typo' }] } }, own)).toEqual([]);
  });
});

describe('building outline', () => {
  const building: Building = { id: 'BLD-1', name: 'Sai Residency', kind: 'apartment', lat: 12.9, lng: 77.6, floorBoxes: [], units: [], createdAt: NOW.toISOString() };
  const corners: [number, number][] = [
    [12.9, 77.6],
    [12.9, 77.6003],
    [12.9002, 77.6003],
    [12.9002, 77.6],
  ];

  it('saves at least three real corners and keeps the point', () => {
    const data = { ...plant(), buildings: [building] };
    const saved = ok(setBuildingFootprint(data, 'BLD-1', [...corners, corners[0]], ctx)).value;
    expect(saved.footprint).toEqual(corners); // the repeated first corner is dropped
    expect([saved.lat, saved.lng]).toEqual([12.9, 77.6]);
    expect(saved.history?.at(-1)?.action).toBe('FOOTPRINT_DRAWN');
    expect(buildingSchema.safeParse(saved).success).toBe(true);
    const removed = ok(setBuildingFootprint({ ...data, buildings: [saved] }, 'BLD-1', null, ctx)).value;
    expect(removed.footprint).toBeUndefined();
    expect([removed.lat, removed.lng]).toEqual([12.9, 77.6]);
  });

  it('refuses fewer than three corners or corners in a line', () => {
    expect(footprintProblem(corners.slice(0, 2))).toMatch(/at least three/);
    expect(footprintProblem([[12.9, 77.6], [12.9, 77.6001], [12.9, 77.6002]])).toMatch(/in a line/);
    expect(buildingSchema.safeParse({ ...building, footprint: corners.slice(0, 2) }).success).toBe(false);
  });
});

describe('moving a pole offers, and moves only what is ticked', () => {
  it('lists cable points, slack loops and duct ends at the old place, with nothing ticked', () => {
    const data = plant();
    const preview = structureMovePreview(data, 'P1')!;
    // C3 starts at P1: its end moves anyway, so its first point is not offered.
    expect(preview.cableEndIds).toEqual(['C3']);
    expect(preview.offers.map((o) => o.key)).toEqual(['cable_point:C1:0', 'slack_loop:L1', 'duct_end:D3:end']);
    expect(preview.offers[0].detail).toMatch(/Not recorded as carried on it/);
    // A point 22 m along the line is beyond the 2 m setting.
    expect(preview.offers.some((o) => o.key === 'cable_point:C1:1')).toBe(false);
    expect(structureMovePreview(data, 'P1', { poleMoveVertexMeters: 50 })!.offers.some((o) => o.key === 'cable_point:C1:1')).toBe(true);
  });

  it('moves nothing else without a tick', () => {
    const data = plant();
    const after = applyPatch(data, ok(moveEquipment(data, 'P1', 12.9001, 77.6)).patch);
    expect(after.cables[0].coordinates[0]).toEqual([12.9, 77.6]);
    expect(after.slackLoops![0]).toMatchObject({ lat: 12.9, lng: 77.6 });
    expect(after.ducts![2].coordinates.at(-1)).toEqual([12.9, 77.6]);
    expect(after.cables[2].coordinates[0]).toEqual([12.9001, 77.6]); // the cable that ends there, as before
  });

  it('moves the ticked ones in the same step and says so', () => {
    const data = plant();
    const preview = structureMovePreview(data, 'P1')!;
    const choices = choicesFromOffers(preview.offers, new Set(['cable_point:C1:0', 'slack_loop:L1']));
    const result = ok(moveEquipment(data, 'P1', 12.9001, 77.6, choices));
    const after = applyPatch(data, result.patch);
    expect(after.cables[0].coordinates[0]).toEqual([12.9001, 77.6]);
    expect(after.cables[0].lengthMeters).not.toBe(data.cables[0].lengthMeters);
    expect(after.slackLoops![0]).toMatchObject({ lat: 12.9001, lng: 77.6 });
    expect(after.ducts![2].coordinates.at(-1)).toEqual([12.9, 77.6]); // not ticked
    expect(result.audit[0].details).toMatch(/also moved as ticked: 1 point\(s\) of Feeder 1, Slack 10 m/);
  });

  it('refuses the whole move when a choice no longer matches the records', () => {
    const data = plant();
    expect(moveEquipment(data, 'P1', 12.9001, 77.6, { slackLoopIds: ['L-GONE'] }).ok).toBe(false);
    expect(moveEquipment(data, 'P1', 12.9001, 77.6, { cablePoints: [{ cableId: 'C1', index: 9 }] }).ok).toBe(false);
    expect(moveEquipment(data, 'P2', 12.9001, 77.6, { ductEnds: [{ ductId: 'D3', end: 'end' }] }).ok).toBe(false);
    expect(typeof applyMoveChoices(data, data.cables, 'P1', [12.9, 77.6], {})).toBe('object');
  });
});
