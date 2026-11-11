import { describe, expect, it } from 'vitest';

import { markSpliceEnteredByMistake, recordTermination, setTrayCapacity, takeTerminationOut } from '../src/domain/closureSplicing';
import { spliceDirectionMismatch, takenPositions, trayUsage } from '../src/domain/closureTrays';
import { applyPatch, type CommandResult, type NetworkData } from '../src/domain/command';
import { coreSpliceHistory } from '../src/domain/coreManagement';
import { recordSplice, retireSplice, saveClosureDetails } from '../src/domain/fiberCommands';
import { buildFiberIndex, coreKey } from '../src/domain/fiberIndex';
import { checkChangeSetFiber, findFiberProblems } from '../src/domain/fiberRules';
import { jointClosureSchema } from '../src/model/schemas';
import type { Cable, JointClosure } from '../src/model/types';
import { cable, closure, emptyNetwork, equipment, NOW } from './fixtures';

/** Phase 8: trays, positions, pigtails, direction and "entered by mistake". */

const ctx = { now: NOW, actor: 'Test Splicer' };

function ok<T>(result: CommandResult<T>) {
  if (!result.ok) throw new Error(`${result.error.title}: ${result.error.message}`);
  return result;
}

const fiber = (id: string, extra: Partial<Cable> = {}) =>
  cable({ id, name: id, fiberCount: 12, startEquipmentId: 'A', endEquipmentId: 'B', coordinates: [[17.4, 78.4], [17.41, 78.41]], cores: [], ...extra });

function network(closureExtra: Partial<JointClosure> = {}): NetworkData {
  return {
    ...emptyNetwork(),
    equipment: [equipment({ id: 'A', type: 'ODF' }), equipment({ id: 'B', type: 'Fiber Joint Closure' })],
    cables: [fiber('C-A'), fiber('C-B'), fiber('C-C')],
    closures: [
      closure({
        id: 'JC-1',
        name: 'Joint 1',
        equipmentId: 'B',
        trays: [{ id: 'T1', label: 'Tray 1', capacity: 2 }, { id: 'T2', label: 'Tray 2' }],
        cableEntries: [
          { cableId: 'C-A', role: 'in' },
          { cableId: 'C-B', role: 'out' },
          { cableId: 'C-C', role: 'out' },
        ],
        ...closureExtra,
      }),
    ],
  };
}

const step = <T>(data: NetworkData, result: CommandResult<T>) => applyPatch(data, ok(result).patch);
const joint = (data: NetworkData) => data.closures.find((c) => c.id === 'JC-1')!;

describe('tray capacity (a warning, never a block)', () => {
  it('warns when a tray holds more splices than its positions, and saves when accepted', () => {
    let data = network();
    data = step(data, recordSplice(data, 'JC-1', { trayId: 'T1', inputCableId: 'C-A', inputCore: 1, outputCableId: 'C-B', outputCore: 1 }, ctx));
    data = step(data, recordSplice(data, 'JC-1', { trayId: 'T1', inputCableId: 'C-A', inputCore: 2, outputCableId: 'C-B', outputCore: 2 }, ctx));
    const third = ok(recordSplice(data, 'JC-1', { trayId: 'T1', inputCableId: 'C-A', inputCore: 3, outputCableId: 'C-B', outputCore: 3 }, ctx));
    expect(third.confirm).toMatch(/Tray 1 holds 3 splices and pigtails, but is recorded with 2 positions/);
    expect(third.audit.map((a) => a.action)).toContain('WARNING_ACCEPTED');
    data = applyPatch(data, third.patch);
    // A fourth one beyond capacity is warned about again.
    const fourth = ok(recordSplice(data, 'JC-1', { trayId: 'T1', inputCableId: 'C-A', inputCore: 4, outputCableId: 'C-B', outputCore: 4 }, ctx));
    expect(fourth.confirm).toMatch(/holds 4/);
    // The server refuses only errors: over capacity is not one.
    expect(checkChangeSetFiber(network(), { upserts: { closures: [joint(applyPatch(data, fourth.patch))] } })).toEqual([]);
  });

  it('does not count splices out of service or entered by mistake, nor trays with no capacity', () => {
    let data = network();
    data = step(data, recordSplice(data, 'JC-1', { trayId: 'T1', inputCableId: 'C-A', inputCore: 1, outputCableId: 'C-B', outputCore: 1 }, ctx));
    const second = ok(recordSplice(data, 'JC-1', { trayId: 'T1', inputCableId: 'C-A', inputCore: 2, outputCableId: 'C-B', outputCore: 2 }, ctx));
    data = applyPatch(data, second.patch);
    data = step(data, retireSplice(data, 'JC-1', joint(data).splices[0].id, 'Cut', ctx));
    data = step(data, markSpliceEnteredByMistake(data, 'JC-1', second.value.id, 'Wrong tray', ctx));
    expect(trayUsage(joint(data))[0].used).toBe(0);
    for (let core = 5; core <= 9; core += 1) {
      const r = ok(recordSplice(data, 'JC-1', { trayId: 'T2', inputCableId: 'C-A', inputCore: core, outputCableId: 'C-C', outputCore: core }, ctx));
      expect(r.confirm).toBeUndefined();
      data = applyPatch(data, r.patch);
    }
  });

  it('sets and clears a tray capacity, warning when the tray already holds more', () => {
    let data = network();
    data = step(data, recordSplice(data, 'JC-1', { trayId: 'T2', inputCableId: 'C-A', inputCore: 1, outputCableId: 'C-B', outputCore: 1 }, ctx));
    data = step(data, recordSplice(data, 'JC-1', { trayId: 'T2', inputCableId: 'C-A', inputCore: 2, outputCableId: 'C-B', outputCore: 2 }, ctx));
    const low = ok(setTrayCapacity(data, 'JC-1', 'T2', 1, ctx));
    expect(low.confirm).toMatch(/Tray 2 holds 2/);
    data = applyPatch(data, low.patch);
    expect(joint(data).trays![1].capacity).toBe(1);
    data = step(data, setTrayCapacity(data, 'JC-1', 'T2', undefined, ctx));
    expect(joint(data).trays![1]).not.toHaveProperty('capacity');
    expect(setTrayCapacity(data, 'JC-1', 'T2', 0, ctx).ok).toBe(false);
  });
});

describe('cassettes and positions', () => {
  it('refuses two active splices in one tray position (a physical impossibility)', () => {
    let data = network();
    data = step(data, recordSplice(data, 'JC-1', { trayId: 'T2', cassette: 'A', position: 4, inputCableId: 'C-A', inputCore: 1, outputCableId: 'C-B', outputCore: 1 }, ctx));
    const clash = recordSplice(data, 'JC-1', { trayId: 'T2', cassette: 'A', position: 4, inputCableId: 'C-A', inputCore: 2, outputCableId: 'C-B', outputCore: 2 }, ctx);
    expect(clash.ok).toBe(false);
    if (!clash.ok) expect(clash.error.message).toMatch(/Tray 2 cassette A position 4 holds 2/);
    // Another cassette, or the same place after the first is out of service, is fine.
    data = step(data, recordSplice(data, 'JC-1', { trayId: 'T2', cassette: 'B', position: 4, inputCableId: 'C-A', inputCore: 2, outputCableId: 'C-B', outputCore: 2 }, ctx));
    data = step(data, retireSplice(data, 'JC-1', joint(data).splices[0].id, 'Re-made', ctx));
    data = step(data, recordSplice(data, 'JC-1', { trayId: 'T2', cassette: 'A', position: 4, inputCableId: 'C-A', inputCore: 3, outputCableId: 'C-B', outputCore: 3 }, ctx));
    expect(joint(data).splices.filter((s) => !s.retiredAt).map((s) => [s.cassette, s.position])).toEqual([
      ['B', 4],
      ['A', 4],
    ]);
    expect(takenPositions(joint(data), 'T2', 'A')).toEqual([4]);
    expect(takenPositions(joint(data), 'T2')).toEqual([]);
  });

  it('refuses the same position on the server, and warns about a position beyond the capacity', () => {
    const base = network();
    const twoInOne = {
      ...joint(base),
      splices: [1, 2].map((n) => ({ id: `S${n}`, inputCableId: 'C-A', inputCableName: 'C-A', inputCore: n, outputCableId: 'C-B', outputCableName: 'C-B', outputCore: n, status: 'Spliced' as const, technician: '', date: '2026-11-01', trayId: 'T1', position: 1 })),
    };
    expect(checkChangeSetFiber(base, { upserts: { closures: [twoInOne] } }).map((p) => p.code)).toEqual(['tray_position_taken']);
    const beyond = ok(recordSplice(base, 'JC-1', { trayId: 'T1', position: 7, inputCableId: 'C-A', inputCore: 1, outputCableId: 'C-B', outputCore: 1 }, ctx));
    expect(beyond.confirm).toMatch(/position 7, but the tray is recorded with 2 positions/);
    expect(recordSplice(base, 'JC-1', { trayId: 'T1', position: 0, inputCableId: 'C-A', inputCore: 1, outputCableId: 'C-B', outputCore: 1 }, ctx).ok).toBe(false);
  });

  it('keeps the new fields and stores nothing that was not entered', () => {
    const data = network();
    const full = ok(recordSplice(data, 'JC-1', { trayId: 'T2', cassette: 'C1', position: 3, lossMeter: 'Fujikura 90S #4411', reportRef: 'JOB-77', notes: 'Re-sleeved', photoIds: ['PH-1'], spliceLossDb: 0.03, lossSource: 'device_reported', inputCableId: 'C-A', inputCore: 1, outputCableId: 'C-B', outputCore: 1 }, ctx));
    expect(full.value).toMatchObject({ cassette: 'C1', position: 3, lossMeter: 'Fujikura 90S #4411', reportRef: 'JOB-77', notes: 'Re-sleeved', photoIds: ['PH-1'] });
    expect(jointClosureSchema.parse(joint(applyPatch(data, full.patch))).splices[0]).toMatchObject({ cassette: 'C1', position: 3, reportRef: 'JOB-77' });
    const bare = ok(recordSplice(data, 'JC-1', { inputCableId: 'C-A', inputCore: 1, outputCableId: 'C-B', outputCore: 1 }, ctx)).value;
    for (const key of ['cassette', 'position', 'lossMeter', 'reportRef', 'notes', 'photoIds', 'spliceLossDb', 'trayId']) expect(bare).not.toHaveProperty(key);
  });
});

describe('splice direction', () => {
  it('warns when the OLT-side fiber is on a cable recorded as going out, and stays quiet where nothing is recorded', () => {
    const data = network();
    const reversed = ok(recordSplice(data, 'JC-1', { inputCableId: 'C-B', inputCore: 1, outputCableId: 'C-A', outputCore: 1 }, ctx));
    expect(reversed.confirm).toMatch(/C-B is recorded here as going out towards customers/);
    expect(reversed.audit.map((a) => a.action)).toEqual(['SPLICE_ADDED', 'WARNING_ACCEPTED']);
    expect(ok(recordSplice(data, 'JC-1', { inputCableId: 'C-A', inputCore: 1, outputCableId: 'C-B', outputCore: 1 }, ctx)).confirm).toBeUndefined();
    // No entries recorded: direction is not known, so no warning (cable drawing direction is not used).
    const unknown = network({ cableEntries: [] });
    expect(ok(recordSplice(unknown, 'JC-1', { inputCableId: 'C-B', inputCore: 1, outputCableId: 'C-A', outputCore: 1 }, ctx)).confirm).toBeUndefined();
    expect(spliceDirectionMismatch({ cableEntries: [{ cableId: 'X', role: 'through' }, { cableId: 'Y', role: 'in' }] }, 'X', 'Y')).toBe('output');
    expect(spliceDirectionMismatch({ cableEntries: [{ cableId: 'X', role: 'through' }] }, 'X', 'Z')).toBeUndefined();
  });
});

describe('entered by mistake (soft delete)', () => {
  it('keeps the splice in history with reason, who and when; rules, index and history treat it as gone', () => {
    let data = network();
    const first = ok(recordSplice(data, 'JC-1', { trayId: 'T2', position: 1, inputCableId: 'C-A', inputCore: 2, outputCableId: 'C-B', outputCore: 2 }, ctx));
    data = applyPatch(data, first.patch);
    expect(markSpliceEnteredByMistake(data, 'JC-1', first.value.id, '  ', ctx).ok).toBe(false);
    const struck = ok(markSpliceEnteredByMistake(data, 'JC-1', first.value.id, 'Wrong fiber chosen', ctx));
    data = applyPatch(data, struck.patch);
    const kept = joint(data).splices.find((s) => s.id === first.value.id)!;
    expect(kept).toMatchObject({ enteredInError: true, retiredBy: 'Test Splicer', retiredReason: 'Wrong fiber chosen', retiredAt: NOW.toISOString() });
    expect(struck.audit[0].action).toBe('SPLICE_ENTERED_BY_MISTAKE');
    expect(jointClosureSchema.safeParse(joint(data)).success).toBe(true);

    // Not in the fiber index (so traces do not follow it), not counted on the tray.
    const index = buildFiberIndex(data);
    expect(index.sinks.get(coreKey('C-A', 2)) ?? []).toEqual([]);
    expect(trayUsage(joint(data))[1].used).toBe(0);
    // The same fiber and the same tray position can be used again, with no error.
    data = step(data, recordSplice(data, 'JC-1', { trayId: 'T2', position: 1, inputCableId: 'C-A', inputCore: 2, outputCableId: 'C-C', outputCore: 2 }, ctx));
    expect(findFiberProblems(data).filter((p) => p.severity === 'error')).toEqual([]);
    // The fiber's splice history still shows it, as not active.
    const history = coreSpliceHistory(data.closures, 'C-A', 2);
    expect(history.map((h) => [h.otherCableId, h.active, h.splice.enteredInError ?? false])).toEqual([
      ['C-B', false, true],
      ['C-C', true, false],
    ]);
    // Already history: cannot be struck out twice.
    expect(markSpliceEnteredByMistake(data, 'JC-1', first.value.id, 'again', ctx).ok).toBe(false);
  });
});

describe('pigtail termination', () => {
  it('records a fiber ending on a connector, never as a splice, and keeps it as history when taken out', () => {
    let data = network();
    const pig = ok(recordTermination(data, 'JC-1', { cableId: 'C-A', core: 7, connectorType: 'SC/APC', pigtailLabel: 'P7', connectsTo: 'Adapter 7, tray 2', trayId: 'T2', position: 2 }, ctx));
    expect(pig.confirm).toBeUndefined();
    data = applyPatch(data, pig.patch);
    expect(joint(data).splices).toEqual([]);
    expect(joint(data).terminations).toMatchObject([{ cableId: 'C-A', cableName: 'C-A', core: 7, connectorType: 'SC/APC', pigtailLabel: 'P7', trayId: 'T2', position: 2, technician: 'Test Splicer' }]);
    expect(jointClosureSchema.safeParse(joint(data)).success).toBe(true);
    // Takes its tray position: a splice cannot go there too.
    expect(recordSplice(data, 'JC-1', { trayId: 'T2', position: 2, inputCableId: 'C-A', inputCore: 1, outputCableId: 'C-B', outputCore: 1 }, ctx).ok).toBe(false);
    // Splicing the same fiber here as well is a warning, not a block.
    expect(ok(recordSplice(data, 'JC-1', { inputCableId: 'C-A', inputCore: 7, outputCableId: 'C-B', outputCore: 7 }, ctx)).confirm).toMatch(/both spliced and ended on a pigtail/);
    // The tray cannot be removed while the pigtail is on it.
    expect(saveClosureDetails(data, 'JC-1', { trays: [joint(data).trays![0]] }, ctx).ok).toBe(false);

    const out = ok(takeTerminationOut(data, 'JC-1', pig.value.id, 'Spliced straight through instead', {}, ctx));
    data = applyPatch(data, out.patch);
    expect(joint(data).terminations![0]).toMatchObject({ retiredReason: 'Spliced straight through instead', retiredBy: 'Test Splicer' });
    expect(joint(data).terminations![0]).not.toHaveProperty('enteredInError');
    expect(takeTerminationOut(data, 'JC-1', pig.value.id, 'x', {}, ctx).ok).toBe(false);
  });

  it('stores no connector type when none was given, refuses a fiber the cable does not have, and needs a reason for a mistake', () => {
    const data = network();
    const pig = ok(recordTermination(data, 'JC-1', { cableId: 'C-A', core: 3 }, ctx));
    expect(pig.value).not.toHaveProperty('connectorType');
    expect(pig.notice?.message ?? '').toMatch(/connector not recorded/);
    expect(recordTermination(data, 'JC-1', { cableId: 'C-A', core: 13 }, ctx).ok).toBe(false);
    const after = applyPatch(data, pig.patch);
    expect(takeTerminationOut(after, 'JC-1', pig.value.id, '', { mistake: true }, ctx).ok).toBe(false);
    const struck = ok(takeTerminationOut(after, 'JC-1', pig.value.id, 'Wrong closure', { mistake: true }, ctx));
    expect(struck.value).toMatchObject({ enteredInError: true, retiredReason: 'Wrong closure' });
    expect(struck.audit[0].action).toBe('PIGTAIL_ENTERED_BY_MISTAKE');
  });

  it('refuses on the server a pigtail on a fiber that does not exist', () => {
    const base = network();
    const bad = { ...joint(base), terminations: [{ id: 'PGT-1', cableId: 'C-A', cableName: 'C-A', core: 40, technician: '', date: '2026-11-01' }] };
    expect(checkChangeSetFiber(base, { upserts: { closures: [bad] } }).map((p) => p.code)).toEqual(['termination_missing_core']);
  });
});
