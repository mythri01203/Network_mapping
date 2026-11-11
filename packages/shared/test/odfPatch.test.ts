import { describe, expect, it } from 'vitest';

import { applyPatch, type CommandResult, type NetworkData } from '../src/domain/command';
import { deleteEquipment } from '../src/domain/equipment';
import {
  addOdfPanel,
  assignCore,
  markCoreFaulty,
  markOdfPort,
  odfPortCounts,
  patchOdfPort,
  releaseCore,
  saveOdfPortDetails,
  setOdfPortFeeder,
} from '../src/domain/fiberCommands';
import { checkChangeSetFiber, connectorClash, findFiberProblems } from '../src/domain/fiberRules';
import { buildOltPonPorts } from '../src/domain/oltConfig';
import { permissionsForChange } from '../src/domain/permissions';
import type { Cable, Equipment } from '../src/model/types';
import { cable, emptyNetwork, equipment, NOW } from './fixtures';

const ctx = { now: NOW, actor: 'Test Engineer' };
const later = { now: new Date(NOW.getTime() + 60_000), actor: 'Test Engineer' };

function ok<T>(result: CommandResult<T>): { value: T; patch: NetworkData; confirm?: string; audit: { action: string }[]; notice?: { message: string } } {
  if (!result.ok) throw new Error(`${result.error.title}: ${result.error.message}`);
  return { value: result.value, patch: result.patch as NetworkData, confirm: result.confirm, audit: result.audit, notice: result.notice };
}

function network() {
  let data: NetworkData = {
    ...emptyNetwork(),
    equipment: [
      equipment({ id: 'OLT-1', type: 'OLT', category: 'Central Office', technology: 'GPON', totalPorts: 4 }),
      equipment({ id: 'ODF-1', name: 'ODF-1', type: 'ODF', category: 'Central Office' }),
      equipment({ id: 'JC-1', name: 'Closure 1', type: 'Fiber Joint Closure' }),
    ],
    cables: [
      cable({
        id: 'FDR-1',
        fiberCount: 24,
        startEquipmentId: 'ODF-1',
        endEquipmentId: 'JC-1',
        coordinates: [
          [17.4, 78.4],
          [17.41, 78.41],
        ],
      }),
    ],
  };
  data = { ...data, equipment: data.equipment.map((e) => (e.id === 'OLT-1' ? { ...e, ponPorts: buildOltPonPorts(e) } : e)) };
  const step = <T>(result: CommandResult<T>) => {
    const r = ok(result);
    data = applyPatch(data, r.patch);
    return r;
  };
  const panel = step(addOdfPanel(data, 'ODF-1', { label: 'Panel A', portCount: 12, connectorType: 'SC/APC' }, ctx)).value;
  return { get data() { return data; }, set data(d: NetworkData) { data = d; }, panel, step };
}

const coreOf = (data: NetworkData, cableId: string, n: number) => (data.cables.find((c) => c.id === cableId) as Cable).cores.find((k) => k.coreNumber === n);
const active = (data: NetworkData, cableId: string, n: number) => coreOf(data, cableId, n)?.assignments?.find((a) => !a.releasedAt);
const portOf = (data: NetworkData, panelId: string, n: number) => (data.equipment.find((e) => e.id === 'ODF-1') as Equipment).odfPanels!.find((p) => p.id === panelId)!.ports.find((p) => p.number === n)!;

describe('ODF feeder marks its fiber (Phase 9)', () => {
  it('marks the feeder fiber in use with source and destination, and releases it with history', () => {
    const n = network();
    const set = n.step(setOdfPortFeeder(n.data, 'ODF-1', n.panel.id, 3, { cableId: 'FDR-1', core: 3 }, ctx));
    expect(set.audit.map((a) => a.action)).toEqual(['ODF_FEEDER_SET', 'CORE_ALLOCATED']);
    const a = active(n.data, 'FDR-1', 3)!;
    expect(a).toMatchObject({ kind: 'in_use', use: 'ODF ODF-1 Panel A port 3', source: 'ODF ODF-1 Panel A port 3', destination: 'Closure 1', equipmentId: 'ODF-1', odfPortId: portOf(n.data, n.panel.id, 3).id });
    expect(coreOf(n.data, 'FDR-1', 3)?.status).toBe('In Use');
    expect(findFiberProblems(n.data).filter((p) => p.code === 'odf_feeder_not_marked')).toEqual([]);

    n.step(setOdfPortFeeder(n.data, 'ODF-1', n.panel.id, 3, null, ctx));
    const core = coreOf(n.data, 'FDR-1', 3)!;
    expect(core.status).toBe('Available');
    expect(core.assignments).toHaveLength(1);
    expect(core.assignments![0]).toMatchObject({ releaseReason: 'Feeder removed from ODF ODF-1 Panel A port 3', releasedBy: 'Test Engineer' });
  });

  it('follows the patch: in use for the PON port while patched, back to the ODF alone after', () => {
    const n = network();
    n.step(setOdfPortFeeder(n.data, 'ODF-1', n.panel.id, 3, { cableId: 'FDR-1', core: 3 }, ctx));
    n.step(patchOdfPort(n.data, 'ODF-1', n.panel.id, 3, { oltId: 'OLT-1', ponPortId: 'PON-01', cordLabel: 'PC-7' }, ctx));
    expect(active(n.data, 'FDR-1', 3)).toMatchObject({ use: 'PON OLT-1 / PON-01', oltId: 'OLT-1', ponPortId: 'PON-01', destination: 'Closure 1' });
    n.step(patchOdfPort(n.data, 'ODF-1', n.panel.id, 3, null, ctx));
    expect(active(n.data, 'FDR-1', 3)).toMatchObject({ use: 'ODF ODF-1 Panel A port 3' });
    expect(active(n.data, 'FDR-1', 3)?.oltId).toBeUndefined();
    expect(coreOf(n.data, 'FDR-1', 3)!.assignments!.filter((x) => x.releasedAt)).toHaveLength(2);
  });

  it('refuses a fiber already held for something else, or marked held with no record', () => {
    const n = network();
    n.step(assignCore(n.data, { cableId: 'FDR-1', coreNumber: 5, kind: 'reserved', use: 'Tower link' }, ctx));
    const refused = setOdfPortFeeder(n.data, 'ODF-1', n.panel.id, 3, { cableId: 'FDR-1', core: 5 }, ctx);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.message).toMatch(/reserved for Tower link/);
    const held = { ...n.data, cables: n.data.cables.map((c) => ({ ...c, cores: [{ coreNumber: 6, status: 'In Use' as const }] })) };
    const legacy = setOdfPortFeeder(held, 'ODF-1', n.panel.id, 3, { cableId: 'FDR-1', core: 6 }, ctx);
    expect(legacy.ok).toBe(false);
    if (!legacy.ok) expect(legacy.error.message).toMatch(/no record of what for/);
    n.step(releaseCore(n.data, 'FDR-1', 5, 'Tower moved', ctx));
    expect(setOdfPortFeeder(n.data, 'ODF-1', n.panel.id, 3, { cableId: 'FDR-1', core: 5 }, ctx).ok).toBe(true);
  });

  it('a faulty fiber needs a reason, which is kept with the assignment', () => {
    const n = network();
    n.step(markCoreFaulty(n.data, 'FDR-1', 4, { reason: 'OTDR shows a break' }, ctx));
    expect(setOdfPortFeeder(n.data, 'ODF-1', n.panel.id, 3, { cableId: 'FDR-1', core: 4 }, ctx).ok).toBe(false);
    const r = n.step(setOdfPortFeeder(n.data, 'ODF-1', n.panel.id, 3, { cableId: 'FDR-1', core: 4, overrideReason: 'Only fiber left, break is past the closure' }, ctx));
    expect(r.audit.map((a) => a.action)).toContain('CORE_OVERRIDE');
    expect(active(n.data, 'FDR-1', 4)?.override).toMatchObject({ status: 'Faulty', reason: 'Only fiber left, break is past the closure', by: 'Test Engineer' });
    expect(coreOf(n.data, 'FDR-1', 4)?.status).toBe('Faulty');
  });

  it('deleting the OLT gives the fiber back to the ODF port alone', () => {
    const n = network();
    n.step(setOdfPortFeeder(n.data, 'ODF-1', n.panel.id, 3, { cableId: 'FDR-1', core: 3 }, ctx));
    n.step(patchOdfPort(n.data, 'ODF-1', n.panel.id, 3, { oltId: 'OLT-1', ponPortId: 'PON-01' }, ctx));
    const del = ok(deleteEquipment(n.data, 'OLT-1'));
    const after = applyPatch(n.data, del.patch);
    expect(active(after, 'FDR-1', 3)).toMatchObject({ use: 'ODF ODF-1 Panel A port 3' });
  });

  it('warns about an older port whose fiber was never marked', () => {
    const n = network();
    const old = n.data.equipment.map((e) =>
      e.id === 'ODF-1' ? { ...e, odfPanels: e.odfPanels!.map((p) => ({ ...p, ports: p.ports.map((x) => (x.number === 2 ? { ...x, feederCableId: 'FDR-1', feederCore: 2, status: 'in_use' as const } : x)) })) } : e,
    );
    const problems = findFiberProblems({ ...n.data, equipment: old });
    expect(problems.find((p) => p.code === 'odf_feeder_not_marked')?.severity).toBe('warning');
  });

  it('feeder assignment needs allocate, the link needs connect', () => {
    const n = network();
    const r = ok(setOdfPortFeeder(n.data, 'ODF-1', n.panel.id, 3, { cableId: 'FDR-1', core: 3 }, ctx));
    const before = n.data.cables[0] as unknown as Record<string, unknown>;
    const after = r.patch.cables![0] as unknown as Record<string, unknown>;
    expect(permissionsForChange('cables', before, after)).toContain('allocate');
    const odfBefore = n.data.equipment.find((e) => e.id === 'ODF-1') as unknown as Record<string, unknown>;
    const odfAfter = r.patch.equipment!.find((e) => e.id === 'ODF-1') as unknown as Record<string, unknown>;
    expect(permissionsForChange('equipment', odfBefore, odfAfter)).toContain('connect');
  });
});

describe('faulty and reserved ODF ports (Phase 9)', () => {
  it('refuses a new patch on a faulty port unless a reason is given, and keeps the reason', () => {
    const n = network();
    expect(markOdfPort(n.data, 'ODF-1', n.panel.id, 4, 'faulty', '', ctx).ok).toBe(false);
    n.step(markOdfPort(n.data, 'ODF-1', n.panel.id, 4, 'faulty', 'Adapter cracked', ctx));
    expect(portOf(n.data, n.panel.id, 4).status).toBe('damaged');
    const refused = patchOdfPort(n.data, 'ODF-1', n.panel.id, 4, { oltId: 'OLT-1', ponPortId: 'PON-02' }, later);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.message).toMatch(/marked faulty \(Adapter cracked\)/);
    const r = n.step(patchOdfPort(n.data, 'ODF-1', n.panel.id, 4, { oltId: 'OLT-1', ponPortId: 'PON-02', overrideReason: 'Temporary until new adapter' }, later));
    expect(r.audit.map((a) => a.action)).toContain('PATCH_OVERRIDE');
    const port = portOf(n.data, n.panel.id, 4);
    expect(port.status).toBe('damaged');
    expect(port.patch?.override).toMatchObject({ status: 'damaged', reason: 'Temporary until new adapter', by: 'Test Engineer' });
    expect(port.history!.map((h) => h.action)).toEqual(['MARKED_FAULTY', 'PATCHED']);
  });

  it('the server refuses a patch written straight onto a faulty port with no reason', () => {
    const n = network();
    n.step(markOdfPort(n.data, 'ODF-1', n.panel.id, 4, 'faulty', 'Adapter cracked', ctx));
    const odf = n.data.equipment.find((e) => e.id === 'ODF-1')!;
    const bad: Equipment = {
      ...odf,
      odfPanels: odf.odfPanels!.map((p) => ({ ...p, ports: p.ports.map((x) => (x.number === 4 ? { ...x, patch: { oltId: 'OLT-1', ponPortId: 'PON-02', patchedAt: later.now.toISOString() } } : x)) })),
    };
    expect(checkChangeSetFiber(n.data, { upserts: { equipment: [bad] } }).map((p) => p.code)).toContain('odf_patch_faulty_port');
    // A patch made before the port went faulty is not blamed.
    const n2 = network();
    n2.step(patchOdfPort(n2.data, 'ODF-1', n2.panel.id, 4, { oltId: 'OLT-1', ponPortId: 'PON-02' }, ctx));
    const marked = ok(markOdfPort(n2.data, 'ODF-1', n2.panel.id, 4, 'faulty', 'High loss on test', later));
    expect(checkChangeSetFiber(n2.data, { upserts: { equipment: marked.patch.equipment } })).toEqual([]);
  });

  it('reserves only a free port, asks before patching it, and keeps every step in history', () => {
    const n = network();
    n.step(patchOdfPort(n.data, 'ODF-1', n.panel.id, 1, { oltId: 'OLT-1', ponPortId: 'PON-01' }, ctx));
    expect(markOdfPort(n.data, 'ODF-1', n.panel.id, 1, 'reserved', 'Spare', ctx).ok).toBe(false);
    n.step(markOdfPort(n.data, 'ODF-1', n.panel.id, 5, 'reserved', 'OLT-1 PON-03 next week', ctx));
    const r = ok(patchOdfPort(n.data, 'ODF-1', n.panel.id, 5, { oltId: 'OLT-1', ponPortId: 'PON-03' }, ctx));
    expect(r.confirm).toMatch(/reserved \(OLT-1 PON-03 next week\)\. Patching it ends the reservation/);
    n.data = applyPatch(n.data, r.patch);
    const port = portOf(n.data, n.panel.id, 5);
    expect(port.status).toBe('in_use');
    expect(port.history!.map((h) => h.action)).toEqual(['MARKED_RESERVED', 'RESERVATION_ENDED', 'PATCHED']);
    expect(odfPortCounts(n.data.equipment.find((e) => e.id === 'ODF-1')!)).toMatchObject({ total: 12, patched: 2, reserved: 0, free: 10 });
  });

  it('marks a faulty port repaired with a reason', () => {
    const n = network();
    n.step(markOdfPort(n.data, 'ODF-1', n.panel.id, 6, 'faulty', 'Dust', ctx));
    expect(markOdfPort(n.data, 'ODF-1', n.panel.id, 6, 'repaired', ' ', ctx).ok).toBe(false);
    n.step(markOdfPort(n.data, 'ODF-1', n.panel.id, 6, 'repaired', 'Cleaned and tested', ctx));
    expect(portOf(n.data, n.panel.id, 6)).toMatchObject({ status: 'available' });
  });
});

describe('pigtails and patch cords (Phase 9)', () => {
  it('records cord ends and length on the patch, and the pigtail at the back, only as written', () => {
    const n = network();
    n.step(patchOdfPort(n.data, 'ODF-1', n.panel.id, 2, { oltId: 'OLT-1', ponPortId: 'PON-01', cordLabel: 'PC-9', cordConnectorOdf: 'SC/APC', cordConnectorPon: 'SC/UPC', cordLengthMeters: 3 }, ctx));
    expect(portOf(n.data, n.panel.id, 2).patch).toMatchObject({ cordLabel: 'PC-9', cordConnectorOdf: 'SC/APC', cordConnectorPon: 'SC/UPC', cordLengthMeters: 3 });
    expect(portOf(n.data, n.panel.id, 2).history!.at(-1)!.details).toBe('Patched to OLT-1 PON-01 (cord PC-9, SC/APC to SC/UPC, 3 m)');
    n.step(saveOdfPortDetails(n.data, 'ODF-1', n.panel.id, 2, { pigtail: { connectorType: 'SC/APC', lengthMeters: 1.5 } }, ctx));
    expect(portOf(n.data, n.panel.id, 2).pigtail).toEqual({ connectorType: 'SC/APC', lengthMeters: 1.5 });
    n.step(saveOdfPortDetails(n.data, 'ODF-1', n.panel.id, 2, { pigtail: null }, ctx));
    expect(portOf(n.data, n.panel.id, 2).pigtail).toBeUndefined();
    expect(saveOdfPortDetails(n.data, 'ODF-1', n.panel.id, 7, { cord: { cordLabel: 'X' } }, ctx).ok).toBe(false);
  });

  it('warns, without refusing, when a cord end does not fit the adapter', () => {
    expect(connectorClash('SC/APC', 'SC/UPC')).toMatch(/do not mate/);
    expect(connectorClash('SC/APC', 'LC/APC')).toMatch(/does not fit/);
    expect(connectorClash('SC/APC', 'SC/APC')).toBeUndefined();
    expect(connectorClash(undefined, 'SC/UPC')).toBeUndefined();
    const n = network();
    const r = ok(patchOdfPort(n.data, 'ODF-1', n.panel.id, 2, { oltId: 'OLT-1', ponPortId: 'PON-01', cordConnectorOdf: 'SC/UPC' }, ctx));
    expect(r.confirm).toMatch(/APC .* and UPC .* do not mate/);
  });
});
