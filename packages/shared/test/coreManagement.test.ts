import { describe, expect, it } from 'vitest';

import { applyPatch, type CommandResult, type NetworkData } from '../src/domain/command';
import { coreCrossSection, coreSpliceHistory, parseCoreQuery, searchCores } from '../src/domain/coreManagement';
import {
  assignCore,
  coreUtilization,
  effectiveCoreStatus,
  markCoreFaulty,
  markCoreRepaired,
  recordSplice,
  releaseCore,
  retireCore,
  retireSplice,
  returnCoreToService,
  setCableLayout,
} from '../src/domain/fiberCommands';
import { checkChangeSetFiber, findFiberProblems, newFiberProblems } from '../src/domain/fiberRules';
import { coreIdentity, tubeRecordsProblem, tubeSpans } from '../src/fiber/colors';
import { cableSchema } from '../src/model/schemas';
import type { Cable } from '../src/model/types';
import { cable, closure, emptyNetwork, equipment, NOW } from './fixtures';

const ctx = { now: NOW, actor: 'Test Engineer' };

function ok<T>(result: CommandResult<T>): { value: T; patch: NetworkData; confirm?: string; audit: { action: string; details: string }[] } {
  if (!result.ok) throw new Error(`${result.error.title}: ${result.error.message}`);
  return { value: result.value, patch: result.patch as NetworkData, confirm: result.confirm, audit: result.audit as { action: string; details: string }[] };
}

const fiber = (id: string, fiberCount: number, extra: Partial<Cable> = {}) =>
  cable({ id, name: id, fiberCount, startEquipmentId: 'A', endEquipmentId: 'B', coordinates: [[17.4, 78.4], [17.41, 78.41]], cores: [], ...extra });

const network = (...cables: Cable[]): NetworkData => ({
  ...emptyNetwork(),
  equipment: [equipment({ id: 'A', type: 'ODF' }), equipment({ id: 'B', type: 'Fiber Joint Closure' })],
  cables,
});

const coreOf = (data: NetworkData, cableId: string, n: number) => data.cables.find((c) => c.id === cableId)!.cores.find((c) => c.coreNumber === n)!;

describe('tubes of different sizes', () => {
  it('numbers fibers through tubes of different sizes', () => {
    const layout = { fiberCount: 18, colorScheme: 'tia-598', tubes: [{ number: 1, fiberCount: 12 }, { number: 2, fiberCount: 6 }] };
    expect(tubeSpans(layout)).toEqual([
      { number: 1, fiberCount: 12, firstCore: 1, lastCore: 12 },
      { number: 2, fiberCount: 6, firstCore: 13, lastCore: 18 },
    ]);
    const id = coreIdentity(layout, 14);
    expect(id).toMatchObject({ tubeNumber: 2, fiberInTube: 2, layoutKnown: true });
    expect(id.fiberColor?.name).toBe('Orange');
    // Tube colour unknown: no scheme and nothing written on the tube.
    expect(id.tubeColor).toBeUndefined();
  });

  it('uses a tube colour written on the tube record, and otherwise none', () => {
    const layout = { fiberCount: 8, tubes: [{ number: 1, fiberCount: 4, colorName: 'Blue' }, { number: 2, fiberCount: 4 }] };
    expect(coreIdentity(layout, 1).tubeColor?.name).toBe('Blue');
    expect(coreIdentity(layout, 5).tubeColor).toBeUndefined();
    // No fiber scheme: never a fiber colour.
    expect(coreIdentity(layout, 1).fiberColor).toBeUndefined();
  });

  it('gives no tube at all when the recorded tubes do not add up', () => {
    const layout = { fiberCount: 24, tubes: [{ number: 1, fiberCount: 12 }, { number: 2, fiberCount: 6 }] };
    expect(tubeRecordsProblem(layout)).toMatch(/hold 18 fibers in all, but the cable has 24/);
    expect(tubeSpans(layout)).toBeUndefined();
    expect(coreIdentity(layout, 13)).toMatchObject({ tubeNumber: undefined, layoutKnown: false });
    expect(tubeRecordsProblem({ fiberCount: 12, tubes: [{ number: 1, fiberCount: 6 }, { number: 3, fiberCount: 6 }] })).toMatch(/tube 2 is missing/);
    expect(tubeRecordsProblem({ fiberCount: 12, tubes: [{ number: 1, fiberCount: 6 }, { number: 1, fiberCount: 6 }] })).toMatch(/listed twice/);
  });

  it('keeps older cables without tube records working from fibersPerTube', () => {
    expect(coreIdentity({ fiberCount: 24, fibersPerTube: 12 }, 13)).toMatchObject({ tubeNumber: 2, fiberInTube: 1 });
    expect(cableSchema.safeParse(fiber('OLD', 24, { fibersPerTube: 12, tubeCount: 2 })).success).toBe(true);
  });

  it('saves tubes of different sizes and refuses sizes that do not add up', () => {
    const data = network(fiber('C-1', 18));
    expect(setCableLayout(data, 'C-1', { tubes: [{ fiberCount: 12 }, { fiberCount: 4 }] }).ok).toBe(false);
    const saved = ok(setCableLayout(data, 'C-1', { colorScheme: 'tia-598', tubes: [{ fiberCount: 12, colorName: 'Blue' }, { fiberCount: 6 }] }, ctx)).value;
    expect(saved.tubes).toEqual([{ number: 1, fiberCount: 12, colorName: 'Blue' }, { number: 2, fiberCount: 6 }]);
    expect(saved.tubeCount).toBe(2);
    expect(saved.fibersPerTube).toBeUndefined();
    expect(saved.cores.find((c) => c.coreNumber === 13)).toMatchObject({ tubeNumber: 2, colorName: 'Blue' });
    // Going back to one size clears the tube records.
    const after = applyPatch(data, { cables: [saved] });
    const same = ok(setCableLayout(after, 'C-1', { fibersPerTube: 6 }, ctx)).value;
    expect(same.tubes).toBeUndefined();
    expect(same.tubeCount).toBe(3);
  });

  it('keeps fibersPerTube when all the listed tubes are the same size', () => {
    const saved = ok(setCableLayout(network(fiber('C-1', 24)), 'C-1', { tubes: [{ fiberCount: 12 }, { fiberCount: 12 }] }, ctx)).value;
    expect(saved).toMatchObject({ fibersPerTube: 12, tubeCount: 2 });
    expect(findFiberProblems(network(saved)).filter((p) => p.severity === 'error')).toEqual([]);
  });

  it('server refuses tube sizes that do not add up to the fiber count', () => {
    const current = network(fiber('C-1', 24));
    const bad = fiber('C-1', 24, { tubes: [{ number: 1, fiberCount: 12 }, { number: 2, fiberCount: 8 }] });
    const errors = checkChangeSetFiber(current, { upserts: { cables: [bad] } });
    expect(errors.map((e) => e.code)).toContain('tube_sizes');
    const good = fiber('C-1', 24, { tubes: [{ number: 1, fiberCount: 12 }, { number: 2, fiberCount: 8 }, { number: 3, fiberCount: 4 }] });
    expect(checkChangeSetFiber(current, { upserts: { cables: [good] } })).toEqual([]);
  });
});

describe('faulty and retired cores', () => {
  it('marks a core faulty only with a reason, and keeps the evidence in its history', () => {
    const data = network(fiber('C-1', 12));
    expect(markCoreFaulty(data, 'C-1', 3, { reason: '  ' }, ctx).ok).toBe(false);
    const result = ok(markCoreFaulty(data, 'C-1', 3, { reason: 'OTDR shows a break at 420 m', otdrRef: 'OTDR-0042', photoIds: ['PH-1'] }, ctx));
    const core = result.value.cores.find((c) => c.coreNumber === 3)!;
    expect(core.status).toBe('Faulty');
    expect(core.history).toEqual([
      { at: NOW.toISOString(), by: 'Test Engineer', action: 'marked_faulty', fromStatus: 'Available', toStatus: 'Faulty', reason: 'OTDR shows a break at 420 m', otdrRef: 'OTDR-0042', photoIds: ['PH-1'] },
    ]);
    expect(result.audit[0]).toMatchObject({ action: 'CORE_MARKED_FAULTY' });
    expect(cableSchema.safeParse(result.value).success).toBe(true);
  });

  it('refuses a faulty core without an override reason, and stores who, why and when with one', () => {
    let data = network(fiber('C-1', 12));
    data = applyPatch(data, ok(markCoreFaulty(data, 'C-1', 3, { reason: 'High loss' }, ctx)).patch);
    const refused = assignCore(data, { cableId: 'C-1', coreNumber: 3, kind: 'in_use', use: 'Tower link' }, ctx);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.message).toMatch(/marked faulty \(High loss\)/);
    const given = ok(assignCore(data, { cableId: 'C-1', coreNumber: 3, kind: 'in_use', use: 'Tower link', overrideReason: 'Re-tested OK, OTDR-0051' }, ctx));
    const core = given.value.cores.find((c) => c.coreNumber === 3)!;
    // Still marked faulty: nobody said it was repaired.
    expect(core.status).toBe('Faulty');
    expect(core.assignments?.[0].override).toEqual({ status: 'Faulty', reason: 'Re-tested OK, OTDR-0051', at: NOW.toISOString(), by: 'Test Engineer' });
    expect(given.audit.map((a) => a.action)).toEqual(['CORE_ALLOCATED', 'CORE_OVERRIDE']);
    expect(given.audit[1].details).toMatch(/given while marked Faulty, by Test Engineer .*Reason: Re-tested OK/);
    // No extra "Save anyway": the override is the acceptance.
    expect(given.confirm).toBeUndefined();
    expect(effectiveCoreStatus(core)).toBe('Faulty');
  });

  it('refuses a damaged core without an override too', () => {
    const data = network(fiber('C-1', 12, { cores: [{ coreNumber: 2, status: 'Damaged' }] }));
    expect(assignCore(data, { cableId: 'C-1', coreNumber: 2, kind: 'reserved', use: 'Spare' }, ctx).ok).toBe(false);
    expect(assignCore(data, { cableId: 'C-1', coreNumber: 2, kind: 'reserved', use: 'Spare', overrideReason: 'Only fiber left' }, ctx).ok).toBe(true);
  });

  it('keeps a service on a fiber found faulty while in use, with no warning, and release keeps the fault', () => {
    let data = network(fiber('C-1', 12));
    data = applyPatch(data, ok(assignCore(data, { cableId: 'C-1', coreNumber: 5, kind: 'in_use', use: 'Customer X' }, { ...ctx, now: new Date(2026, 10, 1) })).patch);
    const marked = ok(markCoreFaulty(data, 'C-1', 5, { reason: 'Customer down, LOS' }, ctx));
    expect(marked.confirm).toBeUndefined();
    data = applyPatch(data, marked.patch);
    expect(coreOf(data, 'C-1', 5).assignments?.[0].releasedAt).toBeUndefined();
    data = applyPatch(data, ok(releaseCore(data, 'C-1', 5, 'Moved to fiber 6', ctx)).patch);
    const core = coreOf(data, 'C-1', 5);
    expect(core.status).toBe('Faulty');
    // History kept after release.
    expect(core.assignments?.[0]).toMatchObject({ use: 'Customer X', releaseReason: 'Moved to fiber 6' });
    expect(core.history?.[0]).toMatchObject({ action: 'marked_faulty', fromStatus: 'In Use' });
  });

  it('marks repaired back to the state before the fault, or "not known"', () => {
    let data = network(fiber('C-1', 12, { cores: [{ coreNumber: 1, status: 'Spliced' }, { coreNumber: 2, status: 'Damaged' }] }));
    expect(markCoreRepaired(data, 'C-1', 1, { reason: 'x' }, ctx).ok).toBe(false);
    data = applyPatch(data, ok(markCoreFaulty(data, 'C-1', 1, { reason: 'Bad splice' }, ctx)).patch);
    data = applyPatch(data, ok(markCoreRepaired(data, 'C-1', 1, { reason: 'Re-spliced, 0.04 dB', otdrRef: 'OTDR-9' }, ctx)).patch);
    expect(coreOf(data, 'C-1', 1).status).toBe('Spliced');
    expect(coreOf(data, 'C-1', 1).history?.map((e) => e.action)).toEqual(['marked_faulty', 'marked_repaired']);
    // An older damaged mark with no history: nobody said whether it is free.
    data = applyPatch(data, ok(markCoreRepaired(data, 'C-1', 2, { reason: 'Re-terminated' }, ctx)).patch);
    expect(coreOf(data, 'C-1', 2).status).toBe('Unknown');
  });

  it('retires a free core only, refuses to give it out, and brings it back', () => {
    let data = network(fiber('C-1', 12));
    data = applyPatch(data, ok(assignCore(data, { cableId: 'C-1', coreNumber: 4, kind: 'reserved', use: 'Spare' }, ctx)).patch);
    expect(retireCore(data, 'C-1', 4, { reason: 'Broken in the duct' }, ctx).ok).toBe(false);
    data = applyPatch(data, ok(releaseCore(data, 'C-1', 4, 'Not needed', ctx)).patch);
    data = applyPatch(data, ok(retireCore(data, 'C-1', 4, { reason: 'Broken in the duct' }, ctx)).patch);
    expect(coreOf(data, 'C-1', 4).status).toBe('Retired');
    const refused = assignCore(data, { cableId: 'C-1', coreNumber: 4, kind: 'in_use', use: 'X', overrideReason: 'please' }, ctx);
    expect(refused.ok).toBe(false);
    expect(markCoreFaulty(data, 'C-1', 4, { reason: 'x' }, ctx).ok).toBe(false);
    data = applyPatch(data, ok(returnCoreToService(data, 'C-1', 4, { reason: 'Duct repaired, OTDR clean' }, ctx)).patch);
    expect(coreOf(data, 'C-1', 4).status).toBe('Available');
    expect(coreUtilization(data.cables[0])).toMatchObject({ retired: 0, available: 12 });
  });

  it('counts faulty with damaged and retired apart', () => {
    const c = fiber('C-1', 4, { cores: [{ coreNumber: 1, status: 'Faulty' }, { coreNumber: 2, status: 'Retired' }, { coreNumber: 3, status: 'Damaged' }] });
    expect(coreUtilization(c)).toMatchObject({ total: 4, damaged: 2, retired: 1, other: 1, available: 1 });
  });

  it('warns (never refuses) when a write gives a faulty core with no override reason', () => {
    const faultyCore = { coreNumber: 1, status: 'Faulty' as const, history: [{ at: '2026-11-01T00:00:00.000Z', action: 'marked_faulty' as const, fromStatus: 'Available' as const, toStatus: 'Faulty' as const, reason: 'LOS' }] };
    const before = network(fiber('C-1', 4, { cores: [faultyCore] }));
    const assignment = { id: 'CA-1', kind: 'in_use' as const, use: 'Customer Y', effectiveFrom: '2026-11-04', createdAt: '2026-11-04T00:00:00.000Z' };
    const plain = fiber('C-1', 4, { cores: [{ ...faultyCore, assignments: [assignment] }] });
    expect(checkChangeSetFiber(before, { upserts: { cables: [plain] } })).toEqual([]);
    const { warnings } = newFiberProblems(before, network(plain));
    expect(warnings.map((w) => w.code)).toEqual(['core_faulty_assigned']);
    const withOverride = fiber('C-1', 4, { cores: [{ ...faultyCore, assignments: [{ ...assignment, override: { status: 'Faulty' as const, reason: 'Checked', at: '2026-11-04T00:00:00.000Z' } }] }] });
    expect(newFiberProblems(before, network(withOverride)).warnings).toEqual([]);
    // An override with an empty reason is not a valid record.
    expect(cableSchema.safeParse(fiber('C-1', 4, { cores: [{ ...faultyCore, assignments: [{ ...assignment, override: { status: 'Faulty' as const, reason: ' ', at: '2026-11-04' } }] }] })).success).toBe(false);
  });

  it('keeps every older core status valid', () => {
    for (const status of ['Available', 'In Use', 'Reserved', 'Spliced', 'Damaged', 'Dark', 'Disconnected', 'Under Maintenance', 'Unverified', 'Unknown', 'Faulty', 'Retired'] as const) {
      expect(cableSchema.safeParse(fiber('C-1', 1, { cores: [{ coreNumber: 1, status }] })).success).toBe(true);
    }
  });
});

describe('find a fiber', () => {
  const build = () => {
    let data = network(
      fiber('FDR-01', 24, { name: 'Feeder North', colorScheme: 'tia-598', fibersPerTube: 12 }),
      fiber('DST-02', 12, { name: 'Street line' }),
    );
    data = applyPatch(data, ok(assignCore(data, { cableId: 'FDR-01', coreNumber: 14, kind: 'in_use', use: 'Tower link 7', destination: 'Tower 7' }, ctx)).patch);
    data = applyPatch(data, ok(assignCore(data, { cableId: 'DST-02', coreNumber: 3, kind: 'reserved', use: 'School' }, ctx)).patch);
    data = applyPatch(data, ok(releaseCore(data, 'DST-02', 3, 'Not needed', ctx)).patch);
    data = applyPatch(data, ok(markCoreFaulty(data, 'DST-02', 9, { reason: 'LOS' }, ctx)).patch);
    return data;
  };

  it('reads fiber, tube and tube/fiber terms', () => {
    expect(parseCoreQuery('T2/3 fiber 4 tube 1 F13 feeder').map((t) => t.kind)).toEqual(['tubeFiber', 'fiber', 'tube', 'fiber', 'text']);
  });

  it('finds by number, tube, use and state, on one cable or all', () => {
    const { cables } = build();
    expect(searchCores(cables, 'F14').hits.map((h) => `${h.cableId}#${h.coreNumber}`)).toEqual(['FDR-01#14']);
    expect(searchCores(cables, 'T2/2').hits.map((h) => h.coreNumber)).toEqual([14]);
    // DST-02 has no tube layout, so tube searches never match it.
    expect(searchCores(cables, 'tube 1').hits.every((h) => h.cableId === 'FDR-01')).toBe(true);
    expect(searchCores(cables, 'tower').hits).toMatchObject([{ cableId: 'FDR-01', coreNumber: 14, use: 'Tower link 7' }]);
    expect(searchCores(cables, 'school').hits[0]).toMatchObject({ cableId: 'DST-02', coreNumber: 3, matched: ['use: School (released)'] });
    expect(searchCores(cables, 'faulty').hits.map((h) => `${h.cableId}#${h.coreNumber}`)).toEqual(['DST-02#9']);
    expect(searchCores(cables, '3', { cableId: 'FDR-01' }).hits.map((h) => h.coreNumber)).toEqual([3]);
    expect(searchCores(cables, 'street 9').hits.map((h) => h.coreNumber)).toEqual([9]);
    expect(searchCores(cables, '   ').total).toBe(0);
  });

  it('matches a colour only where the scheme is known', () => {
    const { cables } = build();
    const blue = searchCores(cables, 'blue');
    expect(blue.hits.every((h) => h.cableId === 'FDR-01')).toBe(true);
    expect(blue.hits.map((h) => h.coreNumber)).toEqual([1, 13]);
  });

  it('caps the list but counts every match', () => {
    const { cables } = build();
    const all = searchCores(cables, 'feeder', { limit: 5 });
    expect(all.hits).toHaveLength(5);
    expect(all.total).toBe(24);
  });
});

describe('splice history of a fiber', () => {
  it('lists splices on either side, including retired ones', () => {
    let data = network(fiber('C-A', 12), fiber('C-B', 12), fiber('C-C', 12));
    data = { ...data, closures: [closure({ id: 'JC-1', name: 'Joint 1', equipmentId: 'B', cableEntries: [{ cableId: 'C-A', role: 'in' }, { cableId: 'C-B', role: 'out' }, { cableId: 'C-C', role: 'out' }] })] };
    const first = ok(recordSplice(data, 'JC-1', { inputCableId: 'C-A', inputCore: 2, outputCableId: 'C-B', outputCore: 2, date: '2026-10-01' }, ctx));
    data = applyPatch(data, first.patch);
    data = applyPatch(data, ok(retireSplice(data, 'JC-1', first.value.id, 'Cable B cut', ctx)).patch);
    data = applyPatch(data, ok(recordSplice(data, 'JC-1', { inputCableId: 'C-A', inputCore: 2, outputCableId: 'C-C', outputCore: 5, date: '2026-11-02' }, ctx)).patch);
    const history = coreSpliceHistory(data.closures, 'C-A', 2);
    expect(history.map((h) => [h.otherCableId, h.otherCore, h.side, h.active])).toEqual([
      ['C-B', 2, 'from', false],
      ['C-C', 5, 'from', true],
    ]);
    expect(history[0].splice.retiredReason).toBe('Cable B cut');
    expect(coreSpliceHistory(data.closures, 'C-C', 5)).toMatchObject([{ side: 'to', otherCableId: 'C-A', otherCore: 2 }]);
    expect(coreSpliceHistory(data.closures, 'C-A', 3)).toEqual([]);
  });
});

describe('cross-section', () => {
  it('draws tubes with fibers, colours only when the scheme is known', () => {
    const known = coreCrossSection(fiber('C-1', 18, { colorScheme: 'tia-598', tubes: [{ number: 1, fiberCount: 12, colorName: 'Blue' }, { number: 2, fiberCount: 6 }], cores: [{ coreNumber: 13, status: 'Faulty' }] }));
    expect(known).toMatchObject({ tubesKnown: true, schemeKnown: true });
    expect(known.tubes.map((t) => [t.number, t.fibers.length, t.color?.name])).toEqual([
      [1, 12, 'Blue'],
      [2, 6, undefined],
    ]);
    expect(known.tubes[1].fibers[0]).toMatchObject({ coreNumber: 13, fiberInTube: 1, status: 'Faulty' });
    expect(known.tubes[1].fibers[0].color?.name).toBe('Blue');

    const unknown = coreCrossSection(fiber('C-2', 24, { fibersPerTube: 12 }));
    expect(unknown.schemeKnown).toBe(false);
    expect(unknown.tubes.flatMap((t) => t.fibers).every((f) => f.color === undefined)).toBe(true);
  });

  it('shows one numbered group when the tubes are not recorded', () => {
    const section = coreCrossSection(fiber('C-3', 12, { colorScheme: 'tia-598' }));
    expect(section.tubesKnown).toBe(false);
    expect(section.tubes).toHaveLength(1);
    expect(section.tubes[0].number).toBeUndefined();
    // No tube layout means no position in the colour sequence: no colours, even with a scheme.
    expect(section.tubes[0].fibers.every((f) => f.color === undefined && f.fiberInTube === undefined)).toBe(true);
  });
});
