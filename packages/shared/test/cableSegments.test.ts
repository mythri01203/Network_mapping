import { describe, expect, it } from 'vitest';

import { deleteCable } from '../src/domain/cables';
import {
  cablesAlongSpan,
  cablesInDuct,
  checkChangeSetSegments,
  deleteCableSegment,
  findSegmentErrors,
  saveCableSegment,
  segmentInstallMethods,
  segmentsForCable,
} from '../src/domain/cableSegments';
import { mergeCables, splitCable } from '../src/domain/cableSplitMerge';
import { applyPatch, type NetworkData } from '../src/domain/command';
import { buildCores } from '../src/domain/defaults';
import { deleteEquipment } from '../src/domain/equipment';
import { affectedByElement, buildImpactIndex } from '../src/domain/faultImpact';
import { polylineLengthMeters } from '../src/domain/geo';
import { checkChangeSetLinks, deleteDuct, deleteSpan, findBrokenLinks } from '../src/domain/outsidePlant';
import { checkRestoredNetwork } from '../src/domain/restoreCheck';
import { traceCable, traceCustomer } from '../src/domain/trace';
import { COLLECTION_NAMES } from '../src/model/collections';
import { cableSegmentSchema } from '../src/model/schemas';
import type { CableSegment, LatLng } from '../src/model/types';
import { createSampleNetwork } from '../src/sample';
import { cable, emptyNetwork, equipment, NOW, smallNetwork } from './fixtures';

const ctx = { now: NOW, actor: 'Tester' };

// A straight street running north: points about 111 m apart, 333 m in all.
const P: LatLng[] = [
  [17.4, 78.4],
  [17.401, 78.4],
  [17.402, 78.4],
  [17.403, 78.4],
];
const DRAWN = polylineLengthMeters(P);

type Ok<T> = { ok: true; value: T; patch: Partial<NetworkData>; confirm?: string; audit: { action: string; details: string }[] };
const ok = <T>(r: { ok: boolean }): Ok<T> => {
  if (!r.ok) throw new Error(`expected ok: ${JSON.stringify(r)}`);
  return r as Ok<T>;
};
const refused = (r: { ok: boolean; error?: { message: string } }) => {
  expect(r.ok).toBe(false);
  return (r as { error: { message: string } }).error.message;
};

/**
 * Poles P1 and P2 at the first two points (a span between them), chamber MH-1 at point 2 and
 * MH-2 at the end, with a duct between the two chambers. Cable CBL-X runs the whole street: on poles
 * for the first stretch and in the duct for the last.
 */
function network(): NetworkData {
  const data = emptyNetwork();
  data.equipment = [
    equipment({ id: 'P1', name: 'Pole 1', type: 'Telecom Pole', lat: P[0][0], lng: P[0][1] }),
    equipment({ id: 'P2', name: 'Pole 2', type: 'Telecom Pole', lat: P[1][0], lng: P[1][1] }),
    equipment({ id: 'MH-1', name: 'Chamber 1', type: 'Manhole', lat: P[2][0], lng: P[2][1] }),
    equipment({ id: 'MH-2', name: 'Chamber 2', type: 'Manhole', lat: P[3][0], lng: P[3][1] }),
    equipment({ id: 'FAR', name: 'Far pole', type: 'Telecom Pole', lat: 17.401, lng: 78.402 }),
  ];
  data.cables = [cable({ id: 'CBL-X', name: 'Main street', coordinates: P, lengthMeters: Math.round(DRAWN), cores: buildCores(12) })];
  data.spans = [{ id: 'SPN-1', name: 'P1 to P2', fromStructureId: 'P1', toStructureId: 'P2', status: 'built', basis: 'office_confirmed', createdAt: '2026-01-01' }];
  data.attachments = [{ id: 'ATT-1', cableId: 'CBL-X', spanId: 'SPN-1', status: 'built', basis: 'office_confirmed', createdAt: '2026-01-01' }];
  data.ducts = [
    {
      id: 'DCT-1',
      name: 'Chamber 1 to 2',
      coordinates: [P[2], P[3]],
      fromStructureId: 'MH-1',
      toStructureId: 'MH-2',
      status: 'built',
      basis: 'office_confirmed',
      cableIds: [],
      subducts: [{ id: 'SUB-1', label: '1', cableIds: ['CBL-X'] }],
      createdAt: '2026-01-01',
    },
  ];
  data.slackLoops = [];
  data.permissions = [];
  data.inspections = [];
  data.cableSegments = [];
  return data;
}

/** The mixed cable: aerial on poles P1 to P2, then in the duct MH-1 to MH-2. */
function mixed(): NetworkData {
  let data = network();
  data = applyPatch(
    data,
    ok<CableSegment>(saveCableSegment(data, { cableId: 'CBL-X', from: { structureId: 'P1' }, to: { structureId: 'P2' }, installMethod: 'Aerial', spanIds: ['SPN-1'], status: 'built' }, ctx)).patch,
  );
  data = applyPatch(
    data,
    ok<CableSegment>(saveCableSegment(data, { cableId: 'CBL-X', from: { structureId: 'MH-1' }, to: { structureId: 'MH-2' }, installMethod: 'Duct', ductId: 'DCT-1', ductWayId: 'SUB-1', measuredLengthMeters: 115 }, ctx)).patch,
  );
  return data;
}

describe('the cableSegments collection', () => {
  it('is a collection, empty in the sample, and each end is one structure or one distance', () => {
    expect(COLLECTION_NAMES).toContain('cableSegments');
    expect(createSampleNetwork().cableSegments).toEqual([]);
    const base = { id: 'SEG-1', cableId: 'C', createdAt: '2026-01-01' };
    expect(cableSegmentSchema.safeParse({ ...base, fromStructureId: 'P1', toMeters: 40 }).success).toBe(true);
    expect(cableSegmentSchema.safeParse({ ...base, fromStructureId: 'P1', fromMeters: 3, toMeters: 40 }).success).toBe(false);
    expect(cableSegmentSchema.safeParse({ ...base, toMeters: 40 }).success).toBe(false);
    expect(cableSegmentSchema.safeParse({ ...base, fromMeters: 0, toMeters: 40, ductWayId: 'SUB-1' }).success).toBe(false);
  });
});

describe('a cable that is aerial for one stretch and in a duct for the next', () => {
  it('stays one cable record with two stretches, in order along it', () => {
    const data = mixed();
    expect(data.cables).toHaveLength(1);
    const rows = segmentsForCable(data, 'CBL-X');
    expect(rows.map((r) => r.segment.installMethod)).toEqual(['Aerial', 'Duct']);
    expect(rows[0].range!.from).toBeCloseTo(0, 0);
    expect(rows[1].range!.to).toBeCloseTo(DRAWN, 0);
    expect(rows.every((r) => !r.problem)).toBe(true);
    // Missing values stay missing: nothing is filled in.
    expect(rows[0].segment.measuredLengthMeters).toBeUndefined();
    expect(rows[1].segment.status).toBeUndefined();
    expect(findBrokenLinks(data)).toEqual([]);
    expect(findSegmentErrors(data)).toEqual([]);
  });

  it('keeps traces and fault impact exactly as they were (stretches are descriptive)', () => {
    const before = smallNetwork();
    const withStretches: NetworkData = {
      ...before,
      cableSegments: [
        { id: 'SEG-A', cableId: 'FEED-01', fromMeters: 0, toMeters: 500, installMethod: 'Aerial', createdAt: '2026-01-01' },
        { id: 'SEG-B', cableId: 'FEED-01', fromMeters: 500, toMeters: 1200, installMethod: 'Duct', createdAt: '2026-01-01' },
      ],
    };
    const customer = before.customers[0];
    expect(traceCustomer(customer, withStretches)).toEqual(traceCustomer(customer, before));
    expect(traceCable(before.cables[0], withStretches)).toEqual(traceCable(before.cables[0], before));
    const element = { type: 'cable' as const, id: 'FEED-01' };
    expect(affectedByElement(buildImpactIndex(withStretches), element)).toEqual(affectedByElement(buildImpactIndex(before), element));
  });

  it('shows in both install layers', () => {
    expect(segmentInstallMethods(mixed().cableSegments!).get('CBL-X')).toEqual(['Aerial', 'Duct']);
  });
});

describe('stretch rules', () => {
  it('refuses a stretch that overlaps another, lies off the cable, or has no length', () => {
    const data = mixed();
    expect(refused(saveCableSegment(data, { cableId: 'CBL-X', from: { meters: 50 }, to: { meters: 150 } }, ctx))).toMatch(/overlaps stretch/);
    expect(refused(saveCableSegment(data, { cableId: 'CBL-X', from: { meters: 120 }, to: { meters: 400 } }, ctx))).toMatch(/beyond the end of the drawn line/);
    expect(refused(saveCableSegment(data, { cableId: 'CBL-X', from: { structureId: 'FAR' }, to: { meters: 200 } }, ctx))).toMatch(/from the cable's drawn line/);
    expect(refused(saveCableSegment(data, { cableId: 'CBL-X', from: { meters: 150 }, to: { meters: 150 } }, ctx))).toMatch(/same place/);
    // Touching ends are fine: a stretch from P2 to MH-1 fills the gap.
    expect(saveCableSegment(data, { cableId: 'CBL-X', from: { structureId: 'P2' }, to: { structureId: 'MH-1' }, installMethod: 'Underground' }, ctx).ok).toBe(true);
  });

  it('refuses a duct or span that is not on record, and a method that contradicts them', () => {
    const data = network();
    expect(refused(saveCableSegment(data, { cableId: 'CBL-X', from: { meters: 0 }, to: { meters: 100 }, ductId: 'DCT-GONE' }, ctx))).toMatch(/its duct "DCT-GONE" does not exist/);
    expect(refused(saveCableSegment(data, { cableId: 'CBL-X', from: { meters: 0 }, to: { meters: 100 }, spanIds: ['SPN-GONE'] }, ctx))).toMatch(/its span "SPN-GONE"/);
    expect(refused(saveCableSegment(data, { cableId: 'CBL-X', from: { meters: 0 }, to: { meters: 100 }, ductId: 'DCT-1', ductWayId: 'SUB-9' }, ctx))).toMatch(/its way in duct/);
    expect(refused(saveCableSegment(data, { cableId: 'CBL-X', from: { meters: 222 }, to: { meters: 333 }, ductId: 'DCT-1', installMethod: 'Aerial' }, ctx))).toMatch(/"Aerial" but runs in a duct/);
    expect(refused(saveCableSegment(data, { cableId: 'CBL-X', from: { meters: 0 }, to: { meters: 111 }, spanIds: ['SPN-1'], ductId: 'DCT-1' }, ctx))).toMatch(/both in a duct and on poles/);
    expect(refused(saveCableSegment(data, { cableId: 'CBL-NONE', from: { meters: 0 }, to: { meters: 10 } }, ctx))).toMatch(/not found/);
  });

  it('only warns when the measured lengths add up to more than the drawn length, and logs the override', () => {
    const data = mixed();
    const result = ok<CableSegment>(saveCableSegment(data, { cableId: 'CBL-X', from: { structureId: 'P2' }, to: { structureId: 'MH-1' }, measuredLengthMeters: 300 }, ctx));
    expect(result.confirm).toMatch(/add up to 415 m, more than the drawn line \(334 m\)/);
    expect(result.audit.map((a) => a.action)).toEqual(['CABLE_SEGMENT_ADDED', 'WARNING_ACCEPTED']);
    // Within the drawn length: no question.
    expect(ok(saveCableSegment(data, { cableId: 'CBL-X', from: { structureId: 'P2' }, to: { structureId: 'MH-1' }, measuredLengthMeters: 100 }, ctx)).confirm).toBeUndefined();
  });

  it('warns when the duct does not list the cable or no record puts it on the span', () => {
    const data = network();
    data.ducts = data.ducts!.map((d) => ({ ...d, subducts: d.subducts.map((s) => ({ ...s, cableIds: [] })) }));
    const inDuct = ok(saveCableSegment(data, { cableId: 'CBL-X', from: { structureId: 'MH-1' }, to: { structureId: 'MH-2' }, ductId: 'DCT-1', ductWayId: 'SUB-1' }, ctx));
    expect(inDuct.confirm).toMatch(/does not list Main street in way 1/);
    data.attachments = [];
    expect(ok(saveCableSegment(data, { cableId: 'CBL-X', from: { structureId: 'P1' }, to: { structureId: 'P2' }, spanIds: ['SPN-1'] }, ctx)).confirm).toMatch(/No record says Main street is on span/);
  });

  it('stores the ends in order along the cable, whichever was tapped first, and edits in place', () => {
    const data = network();
    const saved = ok<CableSegment>(saveCableSegment(data, { cableId: 'CBL-X', from: { meters: 200 }, to: { meters: 120 } }, ctx)).value;
    expect([saved.fromMeters, saved.toMeters]).toEqual([120, 200]);
    const next = applyPatch(data, { cableSegments: [saved] });
    const edited = ok<CableSegment>(saveCableSegment(next, { id: saved.id, cableId: 'CBL-X', from: { meters: 120 }, to: { meters: 220 }, installMethod: 'Direct Buried' }, ctx));
    expect(edited.patch.cableSegments).toHaveLength(1);
    expect(edited.value).toMatchObject({ id: saved.id, toMeters: 220, installMethod: 'Direct Buried', createdAt: saved.createdAt, updatedBy: 'Tester' });
    expect(edited.audit[0].action).toBe('CABLE_SEGMENT_UPDATED');
    const removed = ok(deleteCableSegment(next, saved.id));
    expect(removed.confirm).toMatch(/The cable stays as it is/);
    expect(removed.patch.cableSegments).toEqual([]);
  });

  it('is checked on the server too: errors refused, stored problems not blamed on a route edit', () => {
    const data = mixed();
    const overlapping: CableSegment = { id: 'SEG-NEW', cableId: 'CBL-X', fromMeters: 10, toMeters: 90, createdAt: '2026-01-01' };
    expect(checkChangeSetSegments(data, { upserts: { cableSegments: [overlapping] } }).map((i) => i.code)).toEqual(['overlap']);
    expect(checkChangeSetSegments(data, { upserts: { cableSegments: [{ ...overlapping, fromMeters: 120, toMeters: 200 }] } })).toEqual([]);
    // A route edit that leaves a stored stretch off the line is not refused for it.
    expect(checkChangeSetSegments(data, { upserts: { cables: [{ ...data.cables[0], coordinates: P.slice(0, 2) }] } })).toEqual([]);
    // The link check refuses a stretch naming a missing duct, and deleting a duct a stretch names.
    expect(checkChangeSetLinks(data, { upserts: { cableSegments: [{ ...overlapping, ductId: 'DCT-GONE' }] } })[0].message).toMatch(/its duct/);
    expect(checkChangeSetLinks(data, { deletes: { ducts: ['DCT-1'] } })[0].message).toMatch(/its duct "DCT-1"/);
    // A restore with overlapping stretches is reported.
    const broken = { ...createSampleNetwork(), ...data, cableSegments: [...data.cableSegments!, overlapping] } as never;
    expect(checkRestoredNetwork(broken).counts.segments).toBe(1);
  });
});

describe('deleting what a stretch names', () => {
  it('removes a cable\'s stretches with it, and a stretch ending at a deleted pole', () => {
    const data = mixed();
    const cableGone = ok(deleteCable(data, 'CBL-X'));
    expect(cableGone.patch.cableSegments).toEqual([]);
    expect(cableGone.confirm).toMatch(/2 stretch record\(s\)/);
    const poleGone = ok(deleteEquipment(data, 'P2'));
    expect(poleGone.patch.cableSegments?.map((s) => s.installMethod)).toEqual(['Duct']);
    expect(findBrokenLinks(applyPatch(data, poleGone.patch) as never).filter((p) => p.collection === 'cableSegments')).toEqual([]);
  });

  it('keeps a stretch when its duct or span goes, without naming it', () => {
    const data = mixed();
    const ductGone = ok(deleteDuct(data, 'DCT-1'));
    expect(ductGone.confirm).toMatch(/1 cable stretch\(es\) will stay/);
    expect(ductGone.patch.cableSegments?.find((s) => s.installMethod === 'Duct')).not.toHaveProperty('ductId');
    const spanGone = ok(deleteSpan(data, 'SPN-1'));
    expect(spanGone.patch.cableSegments?.find((s) => s.installMethod === 'Aerial')).not.toHaveProperty('spanIds');
    expect(findBrokenLinks(applyPatch(data, spanGone.patch) as never)).toEqual([]);
  });
});

describe('split and join carry stretches', () => {
  it('splitting at a chamber gives each part its own stretches, counted from its own start', () => {
    const data = mixed();
    const split = ok<{ first: { id: string }; second: { id: string } }>(splitCable(data, { cableId: 'CBL-X', index: 2, newCableId: 'CBL-Y', junctionEquipmentId: 'MH-1' }, ctx));
    const after = applyPatch(data, split.patch);
    expect(after.cables.map((c) => c.id)).toEqual(['CBL-X', 'CBL-Y']);
    expect(after.cableSegments!.map((s) => [s.cableId, s.installMethod])).toEqual([
      ['CBL-X', 'Aerial'],
      ['CBL-Y', 'Duct'],
    ]);
    expect(split.confirm).toMatch(/Stretch Chamber 1 to Chamber 2/);
    expect(findSegmentErrors(after)).toEqual([]);
    expect(findBrokenLinks(after)).toEqual([]);
  });

  it('moves distances to the second part and refuses a stretch across the split point', () => {
    const data = network();
    data.cableSegments = [
      { id: 'SEG-1', cableId: 'CBL-X', fromMeters: 0, toMeters: 100, installMethod: 'Aerial', createdAt: '2026-01-01' },
      { id: 'SEG-2', cableId: 'CBL-X', fromMeters: 250, toMeters: 330, installMethod: 'Duct', createdAt: '2026-01-01' },
    ];
    const split = ok(splitCable(data, { cableId: 'CBL-X', index: 2, newCableId: 'CBL-Y' }, ctx));
    const second = split.patch.cableSegments!.find((s) => s.id === 'SEG-2')!;
    expect(second.cableId).toBe('CBL-Y');
    expect(second.fromMeters).toBeCloseTo(250 - polylineLengthMeters(P.slice(0, 3)), 0);
    expect(findSegmentErrors(applyPatch(data, split.patch))).toEqual([]);

    const across = { ...data, cableSegments: [{ id: 'SEG-3', cableId: 'CBL-X', fromMeters: 150, toMeters: 300, createdAt: '2026-01-01' } as CableSegment] };
    const r = splitCable(across, { cableId: 'CBL-X', index: 2, newCableId: 'CBL-Y' }, ctx);
    expect(refused(r)).toMatch(/runs across the split point/);
  });

  it('split then join gives the stretches back where they were', () => {
    const data = mixed();
    const parted = applyPatch(data, ok(splitCable(data, { cableId: 'CBL-X', index: 2, newCableId: 'CBL-Y', junctionEquipmentId: 'MH-1' }, ctx)).patch);
    const joined = applyPatch(parted, ok(mergeCables(parted, 'CBL-X', 'CBL-Y', ctx)).patch);
    expect(joined.cables.map((c) => c.id)).toEqual(['CBL-X']);
    expect(segmentsForCable(joined, 'CBL-X').map((r) => r.segment.installMethod)).toEqual(['Aerial', 'Duct']);
    expect(findSegmentErrors(joined)).toEqual([]);
  });

  it('joining re-counts distances on the cable that comes second, turned round if needed', () => {
    const data = network();
    const B: LatLng[] = [P[3], [17.404, 78.4], [17.405, 78.4]];
    const lenA = polylineLengthMeters(P);
    data.cables = [
      { ...data.cables[0], id: 'A', endEquipmentId: undefined },
      cable({ id: 'B', name: 'North', coordinates: [...B].reverse(), cores: buildCores(12) }),
    ];
    data.cableSegments = [{ id: 'SEG-B', cableId: 'B', fromMeters: 0, toMeters: 50, installMethod: 'Aerial', createdAt: '2026-01-01' }];
    const joined = ok(mergeCables(data, 'A', 'B', ctx));
    const s = joined.patch.cableSegments![0];
    expect(s.cableId).toBe('A');
    // B was drawn from its far end, so its first 50 m are the last 50 m of the joined cable.
    const total = lenA + polylineLengthMeters(B);
    expect(s.fromMeters).toBeCloseTo(total - 50, 0);
    expect(s.toMeters).toBeCloseTo(total, 0);
  });
});

describe('corridor view', () => {
  it('lists every cable in a duct or on a span, saying which record puts it there', () => {
    const data = mixed();
    data.cables.push(cable({ id: 'CBL-Z', name: 'Spare', coordinates: [P[2], P[3]], cores: buildCores(2) }));
    data.cableSegments!.push({ id: 'SEG-Z', cableId: 'CBL-Z', fromMeters: 0, toMeters: 100, ductId: 'DCT-1', createdAt: '2026-01-01' });
    const duct = cablesInDuct(data, 'DCT-1');
    expect(duct.map((c) => c.cable.id)).toEqual(['CBL-X', 'CBL-Z']);
    expect(duct[0].sources).toEqual(['Listed in way 1', 'A stretch of the cable says it runs here (way 1)']);
    expect(duct[1].mismatch).toMatch(/does not name this cable/);
    const span = cablesAlongSpan(data, 'SPN-1');
    expect(span.map((c) => c.cable.id)).toEqual(['CBL-X']);
    expect(span[0].sources).toHaveLength(2);
    expect(cablesInDuct(data, 'DCT-NONE')).toEqual([]);
  });
});
