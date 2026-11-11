import { describe, expect, it } from 'vitest';

import { applyPatch, type CommandResult, type NetworkData } from '../src/domain/command';
import {
  addOdfPanel,
  connectSplitterOutput,
  createClosure,
  linkSplitterInput,
  markSplitterOutput,
  patchOdfPort,
  recordSplice,
  recordSplitterArchitecture,
  setOdfPortFeeder,
  updatePonPort,
} from '../src/domain/fiberCommands';
import { checkChangeSetFiber } from '../src/domain/fiberRules';
import { buildOltPonPorts } from '../src/domain/oltConfig';
import { DEFAULT_OPTICAL_SETTINGS } from '../src/domain/opticalSettings';
import { createSplitter, provisionCustomer } from '../src/domain/provisioning';
import { buildReports } from '../src/domain/reports';
import { ponTreeSplits, splitProductText, splitterOutputUse, splitterPlace } from '../src/domain/splitterManagement';
import type { Cable, Splitter } from '../src/model/types';
import { cable, emptyNetwork, equipment, NOW } from './fixtures';

const ctx = { now: NOW, actor: 'Test Engineer' };
const later = { now: new Date(NOW.getTime() + 3_600_000), actor: 'Field Tech' };

function ok<T>(result: CommandResult<T>): { value: T; patch: NetworkData; confirm?: string; audit: { action: string; details: string }[] } {
  if (!result.ok) throw new Error(`${result.error.title}: ${result.error.message}`);
  return { value: result.value, patch: result.patch as NetworkData, confirm: result.confirm, audit: result.audit };
}

const fiberCable = (id: string, fiberCount: number, from: string, to: string, extra: Partial<Cable> = {}) =>
  cable({ id, name: id, fiberCount, lengthMeters: 500, startEquipmentId: from, endEquipmentId: to, coordinates: [[17.4, 78.4], [17.41, 78.41]], cores: [], ...extra });

/**
 * OLT-1 PON-01 → ODF patch → FDR-1 fiber 3 → splice in JC-1 → DST-1 fiber 3 → splitter A (1:4) in FAT-1.
 * Only the commands people use. `cascade` adds B (1:8) on A output 1 in the same box, and C (1:8) in
 * FAT-2 fed from A output 2 along LEAD-1 fiber 1.
 */
function network(cascade = false) {
  let data: NetworkData = {
    ...emptyNetwork(),
    equipment: [
      equipment({ id: 'OLT-1', type: 'OLT', category: 'Central Office', technology: 'GPON', totalPorts: 4 }),
      equipment({ id: 'ODF-1', type: 'ODF', category: 'Central Office' }),
      equipment({ id: 'JC-1', type: 'Fiber Joint Closure' }),
      equipment({ id: 'FAT-1', type: 'FAT', totalPorts: 8 }),
      equipment({ id: 'FAT-2', type: 'FAT', totalPorts: 8 }),
    ],
    cables: [fiberCable('FDR-1', 24, 'ODF-1', 'JC-1', { type: 'Main Feeder Fiber' }), fiberCable('DST-1', 12, 'JC-1', 'FAT-1'), fiberCable('LEAD-1', 2, 'FAT-1', 'FAT-2')],
  };
  const step = <T>(result: CommandResult<T>) => {
    const r = ok(result);
    data = applyPatch(data, r.patch);
    return r.value;
  };
  data = { ...data, equipment: data.equipment.map((e) => (e.id === 'OLT-1' ? { ...e, ponPorts: buildOltPonPorts(e) } : e)) };
  step(updatePonPort(data, 'OLT-1', 'PON-01', { opticsClass: 'GPON B+' }, ctx));
  const panel = step(addOdfPanel(data, 'ODF-1', { label: 'Panel A', portCount: 24 }, ctx));
  step(setOdfPortFeeder(data, 'ODF-1', panel.id, 3, { cableId: 'FDR-1', core: 3 }, ctx));
  step(patchOdfPort(data, 'ODF-1', panel.id, 3, { oltId: 'OLT-1', ponPortId: 'PON-01' }, ctx));
  const closure = step(createClosure(data, { equipmentId: 'JC-1', closureType: 'Dome Splice Closure', trayCount: 1 }, ctx));
  step(recordSplice(data, closure.id, { trayId: closure.trays![0].id, inputCableId: 'FDR-1', inputCore: 3, outputCableId: 'DST-1', outputCore: 3 }, ctx));
  const a = step(createSplitter(data, { id: 'SPL-A', terminalBoxId: 'FAT-1', ratio: '1:4', input: { cableId: 'DST-1', core: 3 } }, ctx));
  let b: Splitter | undefined;
  let c: Splitter | undefined;
  if (cascade) {
    b = step(createSplitter(data, { id: 'SPL-B', terminalBoxId: 'FAT-1', ratio: '1:8', input: { splitterId: 'SPL-A', port: 1 } }, ctx));
    step(connectSplitterOutput(data, 'SPL-A', 2, { cableId: 'LEAD-1', core: 1 }, ctx));
    c = step(createSplitter(data, { id: 'SPL-C', terminalBoxId: 'FAT-2', ratio: '1:8', input: { cableId: 'LEAD-1', core: 1 } }, ctx));
  }
  return {
    get: () => data,
    set: (next: NetworkData) => {
      data = next;
    },
    step,
    panel,
    a,
    b,
    c,
  };
}

describe('splitter place: level and arrangement from the recorded cascade', () => {
  it('one splitter on the PON port is centralised, level 1, worked out from the links', () => {
    const n = network();
    const place = splitterPlace(n.get(), 'SPL-A')!;
    expect(place.root).toMatchObject({ oltId: 'OLT-1', ponPortId: 'PON-01' });
    expect(place.root?.through).toMatch(/ODF/);
    expect(place.level).toBe(1);
    expect(place.suggestion.architecture).toBe('centralised');
    expect(place.suggestion.how.join(' ')).toMatch(/Fed from OLT-1 PON-01/);
    expect(place.split).toMatchObject({ product: 4, complete: true });
    // A suggestion only: nothing is written onto the record.
    expect(n.get().splitters.find((s) => s.id === 'SPL-A')!.architecture).toBeUndefined();
  });

  it('a cascade in one box and along a fiber gives levels 1 and 2, distributed', () => {
    const n = network(true);
    const data = n.get();
    const a = splitterPlace(data, 'SPL-A')!;
    const b = splitterPlace(data, 'SPL-B')!;
    const c = splitterPlace(data, 'SPL-C')!;
    expect(a.level).toBe(1);
    expect(a.suggestion.architecture).toBe('distributed');
    expect(a.below.map((x) => [x.splitter.id, x.port, x.via])).toEqual([
      ['SPL-B', 1, 'in_box'],
      ['SPL-C', 2, 'fiber'],
    ]);
    expect(b.level).toBe(2);
    expect(b.above.map((x) => x.splitter.id)).toEqual(['SPL-A']);
    expect(c.level).toBe(2);
    expect(c.above[0]).toMatchObject({ port: 2, via: 'fiber' });
    expect(b.split).toMatchObject({ product: 32, factors: ['1:4', '1:8'], complete: true });
    expect(b.suggestion.text).toMatch(/level 2/);
  });

  it('never guesses a level when the fiber above is not recorded', () => {
    const n = network(true);
    // Unlink A's input: the walk up stops at A.
    n.step(linkSplitterInput(n.get(), 'SPL-A', null, ctx));
    const a = splitterPlace(n.get(), 'SPL-A')!;
    const b = splitterPlace(n.get(), 'SPL-B')!;
    expect(a.level).toBeUndefined();
    expect(a.gap).toMatch(/not linked/);
    expect(b.level).toBeUndefined();
    expect(b.levelAtLeast).toBe(2);
    expect(b.suggestion.architecture).toBe('distributed');
    expect(b.suggestion.text).toMatch(/level not known \(at least 2\)/);
    expect(splitProductText(b.split)).toBe('at least 1:32');
    // A lone splitter with nothing recorded above or below: not known.
    const lone = network();
    lone.step(linkSplitterInput(lone.get(), 'SPL-A', null, ctx));
    const place = splitterPlace(lone.get(), 'SPL-A')!;
    expect(place.suggestion.architecture).toBeUndefined();
    expect(place.suggestion.text).toMatch(/^Not known/);
  });

  it('the PON tree shows levels and the highest split product against the setting (warning only)', () => {
    const n = network(true);
    const tree = ponTreeSplits(n.get(), 'OLT-1', 'PON-01');
    expect(tree.splitterIds.sort()).toEqual(['SPL-A', 'SPL-B', 'SPL-C']);
    expect(tree).toMatchObject({ levels: 2, architecture: 'distributed', maxProduct: 32, overSplitLimit: false });
    const strict = { ...DEFAULT_OPTICAL_SETTINGS, limits: { ...DEFAULT_OPTICAL_SETTINGS.limits, splitProduct: 16 } };
    expect(ponTreeSplits(n.get(), 'OLT-1', 'PON-01', { settings: strict }).overSplitLimit).toBe(true);
    expect(splitterPlace(n.get(), 'SPL-B', { settings: strict })!.overSplitLimit).toBe(true);
    expect(ponTreeSplits(n.get(), 'OLT-1', 'PON-02')).toMatchObject({ splitterIds: [], maxProduct: 1 });
    expect(ponTreeSplits(n.get(), 'OLT-1', 'PON-02').levels).toBeUndefined();
  });
});

describe('recording a different arrangement', () => {
  it('needs a reason, refuses the impossible, asks when it differs, and keeps both', () => {
    const n = network(true);
    expect(recordSplitterArchitecture(n.get(), 'SPL-B', { value: 'centralised', reason: '' }, ctx).ok).toBe(false);
    const impossible = recordSplitterArchitecture(n.get(), 'SPL-B', { value: 'centralised', level: 2, reason: 'Site' }, ctx);
    expect(impossible.ok).toBe(false);
    const r = ok(recordSplitterArchitecture(n.get(), 'SPL-B', { value: 'centralised', level: 1, reason: 'As-built drawing AB-7' }, ctx));
    expect(r.confirm).toMatch(/records show it as distributed/i);
    expect(r.confirm).toMatch(/level 2/);
    expect(r.audit.map((a) => a.action)).toContain('SPLITTER_ARCHITECTURE_RECORDED');
    n.set(applyPatch(n.get(), r.patch));
    const sp = n.get().splitters.find((s) => s.id === 'SPL-B')!;
    expect(sp.architecture).toMatchObject({ value: 'centralised', level: 1, reason: 'As-built drawing AB-7', by: 'Test Engineer' });
    expect(sp.history?.at(-1)?.action).toBe('ARCHITECTURE_RECORDED');
    const place = splitterPlace(n.get(), 'SPL-B')!;
    expect(place.differs).toBe(true);
    expect(place.suggestion.architecture).toBe('distributed');
    expect(ponTreeSplits(n.get(), 'OLT-1', 'PON-01').differs).toEqual(['SPL-B']);
    // Agreeing with the records does not ask.
    expect(ok(recordSplitterArchitecture(n.get(), 'SPL-C', { value: 'distributed', level: 2, reason: 'Seen on site' }, ctx)).confirm).toBeUndefined();
    // Removing it keeps the line in history.
    n.step(recordSplitterArchitecture(n.get(), 'SPL-B', null, ctx));
    const cleared = n.get().splitters.find((s) => s.id === 'SPL-B')!;
    expect(cleared.architecture).toBeUndefined();
    expect(cleared.history?.at(-1)?.details).toMatch(/removed/);
  });
});

describe('splitter output use from the records', () => {
  it('counts used, free, reserved, faulty and not recorded', () => {
    const n = network(true);
    n.step(provisionCustomer(n.get(), { terminalBoxId: 'FAT-1', splitterId: 'SPL-A', splitterOutputPort: 3, name: 'Asha', lat: 17.411, lng: 78.411 }, ctx));
    // Output 4 has no port record at all.
    n.set({ ...n.get(), splitters: n.get().splitters.map((s) => (s.id === 'SPL-A' ? { ...s, outputPorts: s.outputPorts.filter((p) => p.portNumber !== 4) } : s)) });
    const a = n.get().splitters.find((s) => s.id === 'SPL-A')!;
    const { outputs, counts } = splitterOutputUse(n.get(), a);
    expect(outputs.map((o) => o.state)).toEqual(['used', 'used', 'used', 'not_recorded']);
    expect(outputs[0].links).toEqual([{ kind: 'splitter', id: 'SPL-B', name: '1:8 PLC Splitter (FAT-1)' }]);
    expect(outputs[1].links).toEqual([{ kind: 'fiber', cableId: 'LEAD-1', core: 1 }]);
    expect(outputs[2].links.some((l) => l.kind === 'customer')).toBe(true);
    expect(counts).toMatchObject({ capacity: 4, used: 3, free: 0, notRecorded: 1, customers: 1, fibers: 2, splitters: 1 });

    const b = n.get().splitters.find((s) => s.id === 'SPL-B')!;
    n.step(markSplitterOutput(n.get(), 'SPL-B', 1, 'faulty', 'No light on test', ctx));
    n.step(markSplitterOutput(n.get(), 'SPL-B', 2, 'reserved', 'New building, block B', ctx));
    const after = splitterOutputUse(n.get(), n.get().splitters.find((s) => s.id === b.id)!);
    expect(after.counts).toMatchObject({ capacity: 8, used: 0, free: 6, reserved: 1, faulty: 1, notRecorded: 0 });
    expect(after.outputs[0].reason).toMatch(/^No light on test \(\d{4}-\d{2}-\d{2}, Test Engineer\)$/);
    expect(after.outputs[1].reason).toMatch(/New building/);
  });
});

describe('faulty and reserved outputs', () => {
  it('marks with a reason in history, and refuses to reserve an output in use', () => {
    const n = network(true);
    expect(markSplitterOutput(n.get(), 'SPL-A', 3, 'faulty', '  ', ctx).ok).toBe(false);
    const reserveUsed = markSplitterOutput(n.get(), 'SPL-A', 1, 'reserved', 'Later', ctx);
    expect(reserveUsed.ok).toBe(false);
    if (!reserveUsed.ok) expect(reserveUsed.error.message).toMatch(/in use \(splitter 1:8 PLC Splitter \(FAT-1\)\)/);
    // An output in service can go faulty: what is on it stays recorded.
    const marked = ok(markSplitterOutput(n.get(), 'SPL-A', 2, 'faulty', 'Connector broken', ctx));
    expect(marked.value).toMatchObject({ status: 'Faulty', connectedDropCableId: 'LEAD-1' });
    expect(marked.audit[0].action).toBe('SPLITTER_OUTPUT_FAULTY');
    n.set(applyPatch(n.get(), marked.patch));
    const repaired = ok(markSplitterOutput(n.get(), 'SPL-A', 2, 'repaired', 'Connector replaced', later));
    expect(repaired.value.status).toBe('Occupied');
    expect(repaired.value.history!.map((h) => h.action).slice(-2)).toEqual(['MARKED_FAULTY', 'MARKED_REPAIRED']);
  });

  it('refuses a new fiber on a faulty output unless a reason is given, kept and audited', () => {
    const n = network();
    n.step(markSplitterOutput(n.get(), 'SPL-A', 3, 'faulty', 'High loss on test', ctx));
    const refused = connectSplitterOutput(n.get(), 'SPL-A', 3, { cableId: 'LEAD-1', core: 2 }, later);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.message).toMatch(/marked faulty \(High loss on test/);
    const r = ok(connectSplitterOutput(n.get(), 'SPL-A', 3, { cableId: 'LEAD-1', core: 2, overrideReason: 'Only output left, customer waiting' }, later));
    const port = r.value.outputPorts.find((p) => p.portNumber === 3)!;
    expect(port.status).toBe('Faulty');
    expect(port.override).toMatchObject({ reason: 'Only output left, customer waiting', by: 'Field Tech', status: 'Faulty' });
    expect(r.audit.map((a) => a.action)).toContain('SPLITTER_OUTPUT_OVERRIDE');
    n.set(applyPatch(n.get(), r.patch));
    // Freeing it keeps the faulty mark and drops the reason with the connection.
    const freed = ok(connectSplitterOutput(n.get(), 'SPL-A', 3, null, later)).value.outputPorts.find((p) => p.portNumber === 3)!;
    expect(freed.status).toBe('Faulty');
    expect(freed.override).toBeUndefined();
  });

  it('asks before using a reserved output and ends the reservation in history', () => {
    const n = network();
    n.step(markSplitterOutput(n.get(), 'SPL-A', 4, 'reserved', 'Tower link', ctx));
    const r = ok(connectSplitterOutput(n.get(), 'SPL-A', 4, { cableId: 'LEAD-1', core: 2 }, later));
    expect(r.confirm).toMatch(/reserved \(Tower link/);
    const port = r.value.outputPorts.find((p) => p.portNumber === 4)!;
    expect(port.status).toBe('Occupied');
    expect(port.history!.map((h) => h.action)).toEqual(['MARKED_RESERVED', 'RESERVATION_ENDED', 'OUTPUT_CONNECTED']);
    expect(r.audit.map((a) => a.action)).toContain('SPLITTER_OUTPUT_RESERVATION_ENDED');
  });

  it('refuses a cascade onto a faulty output unless a reason is given', () => {
    const n = network();
    n.step(markSplitterOutput(n.get(), 'SPL-A', 1, 'faulty', 'Cracked leg', ctx));
    n.step(createSplitter(n.get(), { id: 'SPL-D', terminalBoxId: 'FAT-1', ratio: '1:8' }, ctx));
    expect(linkSplitterInput(n.get(), 'SPL-D', { splitterId: 'SPL-A', port: 1 }, later).ok).toBe(false);
    const r = ok(linkSplitterInput(n.get(), 'SPL-D', { splitterId: 'SPL-A', port: 1, overrideReason: 'Temporary until the new box' }, later));
    const parentPort = (r.patch.splitters as Splitter[]).find((s) => s.id === 'SPL-A')!.outputPorts.find((p) => p.portNumber === 1)!;
    expect(parentPort).toMatchObject({ status: 'Faulty', override: { reason: 'Temporary until the new box' } });
    expect(r.audit.map((a) => a.action)).toContain('SPLITTER_OUTPUT_OVERRIDE');
  });

  it('the server refuses a faulty output connected with no reason, but not one that failed in service', () => {
    const n = network();
    n.step(markSplitterOutput(n.get(), 'SPL-A', 3, 'faulty', 'No light', ctx));
    const a = n.get().splitters.find((s) => s.id === 'SPL-A')!;
    // A client that skips the command: connected after the fault, no reason.
    const sneaky: Splitter = {
      ...a,
      outputPorts: a.outputPorts.map((p) => (p.portNumber === 3 ? { ...p, connectedDropCableId: 'LEAD-1', connectedCore: 2, connectedAt: later.now.toISOString() } : p)),
    };
    const errors = checkChangeSetFiber(n.get(), { upserts: { splitters: [sneaky] } });
    expect(errors.map((e) => e.code)).toContain('splitter_output_faulty_connected');
    // Connected first, faulty later: not blamed.
    const m = network();
    m.step(connectSplitterOutput(m.get(), 'SPL-A', 3, { cableId: 'LEAD-1', core: 2 }, ctx));
    expect(markSplitterOutput(m.get(), 'SPL-A', 3, 'faulty', 'Went bad', later).ok).toBe(true);
  });
});

describe('splitter capacity report', () => {
  it('is in buildReports, counts from the records, and names no customers', () => {
    const n = network(true);
    n.step(provisionCustomer(n.get(), { terminalBoxId: 'FAT-1', splitterId: 'SPL-B', splitterOutputPort: 2, name: 'Asha', lat: 17.411, lng: 78.411 }, ctx));
    n.set({ ...n.get(), splitters: n.get().splitters.map((s) => (s.id === 'SPL-C' ? { ...s, outputPorts: s.outputPorts.slice(0, 6) } : s)) });
    const report = buildReports(n.get() as never).find((t) => t.id === 'splitter-capacity')!;
    expect(report).toBeDefined();
    const row = (id: string) => report.rows.find((r) => r.id === id)!;
    expect(row('SPL-A')).toMatchObject({ level: 1, outputs: 4, used: 2, cascade: 1, fibers: 1, free: 2, split: '1:4' });
    expect(row('SPL-B')).toMatchObject({ level: 2, used: 1, customers: 1, free: 7, split: '1:32' });
    expect(String(row('SPL-B').arrangement)).toMatch(/Distributed/);
    expect(row('SPL-C')).toMatchObject({ notRecorded: 2, free: 6 });
    expect(report.notes.join(' ')).toMatch(/2 output\(s\) have no port record/);
    expect(JSON.stringify(report.rows)).not.toContain('Asha');
    const strict = { ...DEFAULT_OPTICAL_SETTINGS, limits: { ...DEFAULT_OPTICAL_SETTINGS.limits, splitProduct: 16 } };
    const flagged = buildReports(n.get() as never, {}, undefined, { optical: strict }).find((t) => t.id === 'splitter-capacity')!;
    expect(flagged.rows.find((r) => r.id === 'SPL-B')!.split).toBe('1:32 (above limit)');
    // The older capacity table no longer counts an output with no record as free.
    const capacity = buildReports(n.get() as never).find((t) => t.id === 'capacity')!;
    expect(capacity.rows.find((r) => r.id === 'SPL-C')!.free).toBe('6 (2 not recorded)');
  });
});
