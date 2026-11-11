import { describe, expect, it } from 'vitest';

import { applyPatch, type CommandResult, type NetworkData } from '../src/domain/command';
import { adoptCustomerOnt, disconnectCustomer, moveCustomer, saveService } from '../src/domain/connectionCommands';
import { addOdfPanel, createClosure, patchOdfPort, recordSplice, setCableLayout, setOdfPortFeeder, updatePonPort } from '../src/domain/fiberCommands';
import { findFiberProblems } from '../src/domain/fiberRules';
import { saveOltChassis } from '../src/domain/oltCommands';
import {
  buildOltPonPorts,
  chassisAsWritten,
  generateOltDescription,
  MAX_OLT_PON_PORTS,
  oltChassisProblems,
  ponPortPlace,
  ponPortsOnNoCard,
  validateOltConfig,
} from '../src/domain/oltConfig';
import { customersOnPonPort, oltPonUsage, ponCapacityText, ponPortUsage, recountPonCustomers } from '../src/domain/ponUsage';
import { createSplitter, provisionCustomer } from '../src/domain/provisioning';
import { buildReports } from '../src/domain/reports';
import { equipmentSchema, oltChassisSchema } from '../src/model/schemas';
import type { Cable, Equipment, OltChassis } from '../src/model/types';
import { cable, emptyNetwork, equipment, NOW } from './fixtures';

const ctx = { now: NOW, actor: 'Test Engineer' };

function ok<T>(result: CommandResult<T>): { value: T; patch: NetworkData; confirm?: string } {
  if (!result.ok) throw new Error(`${result.error.title}: ${result.error.message}`);
  return { value: result.value, patch: result.patch as NetworkData, confirm: result.confirm };
}
const refused = <T>(result: CommandResult<T>): string => {
  if (result.ok) throw new Error('expected a refusal');
  return result.error.message;
};

const fiberCable = (id: string, fiberCount: number, from: string, to: string, lengthMeters: number, extra: Partial<Cable> = {}) =>
  cable({ id, name: id, fiberCount, lengthMeters, startEquipmentId: from, endEquipmentId: to, coordinates: [[17.4, 78.4], [17.41, 78.41]], cores: [], ...extra });

/** Two PON ports, each through the ODF, a splice and its own 1:8 splitter in one box. Two customers on PON-01. */
function network() {
  let data: NetworkData = {
    ...emptyNetwork(),
    equipment: [
      equipment({ id: 'OLT-1', type: 'OLT', category: 'Central Office', technology: 'GPON', totalPorts: 12 }),
      equipment({ id: 'ODF-1', type: 'ODF', category: 'Central Office' }),
      equipment({ id: 'JC-1', type: 'Fiber Joint Closure' }),
      equipment({ id: 'FAT-1', type: 'FAT', totalPorts: 16 }),
    ],
    cables: [fiberCable('FDR-1', 24, 'ODF-1', 'JC-1', 3000, { type: 'Main Feeder Fiber' }), fiberCable('DST-1', 12, 'JC-1', 'FAT-1', 1500)],
  };
  const step = <T>(result: CommandResult<T>) => {
    const r = ok(result);
    data = applyPatch(data, r.patch);
    return r.value;
  };
  data = { ...data, equipment: data.equipment.map((e) => (e.id === 'OLT-1' ? { ...e, ponPorts: buildOltPonPorts(e) } : e)) };
  step(updatePonPort(data, 'OLT-1', 'PON-01', { opticsClass: 'GPON B+', maxOnu: 64 }, ctx));
  step(updatePonPort(data, 'OLT-1', 'PON-02', { opticsClass: 'GPON B+' }, ctx));
  step(setCableLayout(data, 'FDR-1', { colorScheme: 'tia-598', tubeColorScheme: 'tia-598', fibersPerTube: 12 }, ctx));
  step(setCableLayout(data, 'DST-1', { colorScheme: 'tia-598', fibersPerTube: 12 }, ctx));
  const panel = step(addOdfPanel(data, 'ODF-1', { label: 'Panel A', portCount: 24 }, ctx));
  const closure = step(createClosure(data, { equipmentId: 'JC-1', closureType: 'Dome Splice Closure', trayCount: 2 }, ctx));
  for (const [odfPort, pon, core] of [[3, 'PON-01', 3], [4, 'PON-02', 4]] as const) {
    step(setOdfPortFeeder(data, 'ODF-1', panel.id, odfPort, { cableId: 'FDR-1', core }, ctx));
    step(patchOdfPort(data, 'ODF-1', panel.id, odfPort, { oltId: 'OLT-1', ponPortId: pon }, ctx));
    step(recordSplice(data, closure.id, { trayId: closure.trays![0].id, inputCableId: 'FDR-1', inputCore: core, outputCableId: 'DST-1', outputCore: core }, ctx));
  }
  const sp1 = step(createSplitter(data, { terminalBoxId: 'FAT-1', ratio: '1:8', input: { cableId: 'DST-1', core: 3 } }, ctx));
  const sp2 = step(createSplitter(data, { terminalBoxId: 'FAT-1', ratio: '1:8', input: { cableId: 'DST-1', core: 4 } }, ctx));
  const asha = step(provisionCustomer(data, { terminalBoxId: 'FAT-1', splitterId: sp1.id, splitterOutputPort: 2, name: 'Asha', lat: 17.411, lng: 78.411, ontSerialNumber: 'ZTEG0000A001' }, ctx)).customer;
  const ravi = step(provisionCustomer(data, { terminalBoxId: 'FAT-1', splitterId: sp1.id, splitterOutputPort: 3, name: 'Ravi', lat: 17.4112, lng: 78.4112, ontSerialNumber: 'HWTC0000B002' }, ctx)).customer;
  return { get: () => data, set: (d: NetworkData) => (data = d), step: (fn: (d: NetworkData) => CommandResult<unknown>) => step(fn(data)), sp1, sp2, asha, ravi };
}

const olt = (data: NetworkData) => data.equipment.find((e) => e.id === 'OLT-1')!;
const cached = (data: NetworkData, pon: string) => olt(data).ponPorts!.find((p) => p.id === pon)!.connectedCustomersCount;
const counted = (data: NetworkData, pon: string) => customersOnPonPort(data.customers, 'OLT-1', pon).length;

describe('any PON port count', () => {
  it('records an OLT with 12 PON ports (the phase acceptance)', () => {
    expect(validateOltConfig({ technology: 'GPON', totalPorts: 12 }).valid).toBe(true);
    const ports = buildOltPonPorts({ technology: 'GPON', totalPorts: 12 });
    expect(ports.map((p) => p.id)).toEqual(Array.from({ length: 12 }, (_, i) => `PON-${String(i + 1).padStart(2, '0')}`));
    const olt12: Equipment = equipment({ id: 'OLT-12', type: 'OLT', technology: 'GPON', totalPorts: 12, ponPorts: ports });
    expect(equipmentSchema.safeParse(olt12).success).toBe(true);
    expect(generateOltDescription({ name: 'X', technology: 'GPON', totalPorts: 12 })).toContain('PON-01 to PON-12');
  });

  it('refuses no ports, part ports and impossible counts, in plain words', () => {
    expect(validateOltConfig({ technology: 'GPON', totalPorts: 0 }).errors[0]).toMatch(/how many PON ports/);
    expect(validateOltConfig({ technology: 'GPON', totalPorts: 2.5 }).valid).toBe(false);
    expect(validateOltConfig({ technology: 'GPON', totalPorts: MAX_OLT_PON_PORTS + 1 }).errors[0]).toMatch(/Check the number/);
    expect(validateOltConfig({ technology: 'GPON', totalPorts: 272 }).valid).toBe(true);
  });

  it('a card takes 1 to 128 ports', () => {
    const chassis = (portCount: number) => ({ shelves: [{ id: 'S0', label: '0', slots: [{ id: 'L1', label: '1', card: { portCount } }] }] });
    expect(oltChassisSchema.safeParse(chassis(16)).success).toBe(true);
    expect(oltChassisSchema.safeParse(chassis(128)).success).toBe(true);
    expect(oltChassisSchema.safeParse(chassis(129)).success).toBe(false);
    expect(oltChassisSchema.safeParse(chassis(0)).success).toBe(false);
  });

  it('describes splitters as a plan and invents no cable type or output count', () => {
    const text = generateOltDescription({ name: 'X', technology: 'GPON', totalPorts: 4, splitters: [{ id: 'P1', ratio: '1:8', inPort: 'IN-01' }], cables: [{ id: 'C1' }] });
    expect(text).toContain('Splitter Plan (proposed)');
    expect(text).toContain('Cable Type: Not recorded');
    expect(text).not.toContain('Single Mode Feeder Fiber');
  });
});

describe('chassis, shelves, slots and cards', () => {
  const base = () => {
    const o = equipment({ id: 'OLT-C', name: 'Core OLT', type: 'OLT', technology: 'GPON', totalPorts: 12, rackNumber: 'R-3', shelfNumber: '0', slotNumber: '5-6' });
    return { ...o, ponPorts: buildOltPonPorts(o) };
  };
  const twoCards = (first: string[], second: string[]): OltChassis => ({
    model: 'MA5800-X7 (as printed)',
    shelves: [
      {
        id: 'SH-0',
        label: '0',
        slots: [
          { id: 'SL-5', label: '5', card: { model: 'GPHF', kind: 'pon', portCount: 8, ponPortIds: first } },
          { id: 'SL-6', label: '6', card: { model: 'GPSF', kind: 'pon', portCount: 4, ponPortIds: second } },
          { id: 'SL-8', label: '8' },
        ],
      },
    ],
  });
  const ids = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `PON-${String(from + i).padStart(2, '0')}`);

  it('shows the older fields as written when no chassis is recorded, and finds a port on its card when one is', () => {
    const o = base();
    expect(chassisAsWritten(o)).toEqual([
      { label: 'Rack', value: 'R-3' },
      { label: 'Shelf', value: '0' },
      { label: 'Slot', value: '5-6' },
    ]);
    expect(oltChassisProblems(o)).toEqual([]);
    const withChassis = { ...o, chassis: twoCards(ids(1, 8), ids(9, 12)) };
    expect(oltChassisProblems(withChassis)).toEqual([]);
    expect(ponPortPlace(withChassis, 'PON-10')?.text).toBe('Shelf 0 · Slot 6 · GPSF');
    expect(ponPortPlace(o, 'PON-10')).toBeUndefined();
    expect(ponPortsOnNoCard({ ...o, chassis: twoCards(ids(1, 3), []) })).toEqual(ids(4, 12));
  });

  it('broken chassis data is an error; a port on no card is only a warning', () => {
    const o = base();
    const codes = (chassis: OltChassis) => oltChassisProblems({ ...o, chassis }).map((p) => `${p.severity}:${p.code}`);
    expect(codes(twoCards(ids(1, 8), ['PON-08', 'PON-09']))).toContain('error:olt_pon_two_cards');
    expect(codes(twoCards(ids(1, 8), ['PON-13']))).toContain('error:olt_card_pon_missing');
    expect(codes(twoCards(ids(1, 8), ids(9, 12).concat('PON-01').slice(0, 5)))).toContain('error:olt_card_ports_over');
    const dupSlot = twoCards(ids(1, 8), ids(9, 12));
    dupSlot.shelves[0].slots[2].label = '5';
    expect(codes(dupSlot)).toContain('error:olt_slot_twice');
    const uplink = twoCards(ids(1, 8), ids(9, 12));
    uplink.shelves[0].slots[1].card!.kind = 'uplink';
    expect(codes(uplink)).toContain('error:olt_card_kind_ports');
    expect(codes(twoCards(ids(1, 8), []))).toEqual(['warning:olt_pon_no_card']);
  });

  it('saves a chassis through the fiber rules: errors refused, a loose port asks first, the old fields untouched', () => {
    const data: NetworkData = { ...emptyNetwork(), equipment: [base()] };
    expect(refused(saveOltChassis(data, 'OLT-C', twoCards(ids(1, 8), ['PON-08']), ctx))).toMatch(/PON-08 is listed on shelf 0 slot 5 and on shelf 0 slot 6/);
    const partial = ok(saveOltChassis(data, 'OLT-C', twoCards(ids(1, 8), []), ctx));
    expect(partial.confirm).toMatch(/on no card yet/);
    const full = ok(saveOltChassis(data, 'OLT-C', twoCards(ids(1, 8), ids(9, 12)), ctx));
    expect(full.confirm).toBeUndefined();
    const saved = applyPatch(data, full.patch).equipment[0];
    expect(saved.chassis?.shelves[0].slots).toHaveLength(3);
    expect(saved).toMatchObject({ rackNumber: 'R-3', shelfNumber: '0', slotNumber: '5-6' });
    // Removing the chassis keeps the older fields.
    const removed = applyPatch(applyPatch(data, full.patch), ok(saveOltChassis(applyPatch(data, full.patch), 'OLT-C', null, ctx)).patch).equipment[0];
    expect(removed.chassis).toBeUndefined();
    expect(removed.slotNumber).toBe('5-6');
    expect(refused(saveOltChassis(data, 'NOPE', null, ctx))).toMatch(/not found/);
  });

  it('the server rules see the same chassis errors', () => {
    const bad = { ...base(), chassis: twoCards(ids(1, 8), ['PON-01']) };
    expect(findFiberProblems({ equipment: [bad], cables: [], splitters: [], closures: [], customers: [] }).some((p) => p.code === 'olt_pon_two_cards' && p.severity === 'error')).toBe(true);
  });
});

describe('counts per PON port come from the records', () => {
  it('match the records after connect, disconnect and move, and the stored counter follows as a cache', () => {
    const ex = network();
    let data = ex.get();
    expect(counted(data, 'PON-01')).toBe(2);
    expect(cached(data, 'PON-01')).toBe(2);
    expect(counted(data, 'PON-02')).toBe(0);

    // Move Asha onto the PON-02 splitter in the same box: PON-01 loses her, PON-02 gains her.
    ex.step((d) => moveCustomer(d, ex.asha.id, { splitterId: ex.sp2.id, port: 1 }, 'Rebalancing ports', ctx));
    data = ex.get();
    expect(data.customers.find((c) => c.id === ex.asha.id)).toMatchObject({ oltId: 'OLT-1', ponPort: 'PON-02' });
    expect([counted(data, 'PON-01'), cached(data, 'PON-01')]).toEqual([1, 1]);
    expect([counted(data, 'PON-02'), cached(data, 'PON-02')]).toEqual([1, 1]);

    // Disconnect Ravi: PON-01 is empty.
    ex.step((d) => disconnectCustomer(d, ex.ravi.id, 'Moved away', ctx));
    data = ex.get();
    expect([counted(data, 'PON-01'), cached(data, 'PON-01')]).toEqual([0, 0]);
    expect(ponPortUsage(data, 'OLT-1', 'PON-01')!.customers).toEqual([]);

    // Reconnect Ravi on PON-01: back to one.
    ex.step((d) => moveCustomer(d, ex.ravi.id, { splitterId: ex.sp1.id, port: 3 }, 'Came back', ctx));
    data = ex.get();
    expect([counted(data, 'PON-01'), cached(data, 'PON-01')]).toEqual([1, 1]);
    expect(oltPonUsage(data, 'OLT-1').map((u) => u.customers.length).slice(0, 2)).toEqual([1, 1]);
  });

  it('a drifted stored counter is not shown: usage counts records, and the next change corrects the cache', () => {
    const ex = network();
    const drifted = ex.get();
    ex.set({ ...drifted, equipment: drifted.equipment.map((e) => (e.id === 'OLT-1' ? { ...e, ponPorts: e.ponPorts!.map((p) => (p.id === 'PON-01' ? { ...p, connectedCustomersCount: 16 } : p)) } : e)) });
    const usage = ponPortUsage(ex.get(), 'OLT-1', 'PON-01')!;
    expect(usage.customers).toHaveLength(2);
    expect(usage.storedCount).toBe(16);
    ex.step((d) => disconnectCustomer(d, ex.ravi.id, 'Not paid', ctx));
    expect(cached(ex.get(), 'PON-01')).toBe(1);
    // recountPonCustomers leaves other OLTs and unchanged records alone.
    const other = equipment({ id: 'OLT-2', type: 'OLT', ponPorts: [{ id: 'PON-01', portNumber: 1, status: 'Active', connectedCustomersCount: 7 }] });
    const list = recountPonCustomers([olt(ex.get()), other], ex.get().customers, ['OLT-1']);
    expect(list[1]).toBe(other);
    expect(list[0]).toBe(olt(ex.get()));
  });

  it('counts ONTs, services and capacity; the limit is "not recorded" when nobody wrote it', () => {
    const ex = network();
    ex.step((d) => adoptCustomerOnt(d, ex.asha.id, ctx));
    ex.step((d) => saveService(d, { customerId: ex.asha.id, kind: 'internet' }, ctx));
    ex.step((d) => saveService(d, { customerId: ex.asha.id, kind: 'iptv' }, ctx));
    const data = ex.get();
    const u = ponPortUsage(data, 'OLT-1', 'PON-01', { trace: true })!;
    expect(u.onts).toHaveLength(1);
    expect(u.customersWithoutOnt.map((c) => c.name)).toEqual(['Ravi']);
    expect(u.ontCount).toBe(2);
    expect(u.services).toHaveLength(2);
    expect(u).toMatchObject({ limit: 64, free: 62, overLimit: false });
    expect(ponCapacityText(u)).toBe('2 of 64 ONTs (62 free)');
    expect(u.reached?.customers.map((c) => c.name).sort()).toEqual(['Asha', 'Ravi']);
    expect(u.notes).toEqual([]);
    const empty = ponPortUsage(data, 'OLT-1', 'PON-02')!;
    expect(empty.limit).toBeUndefined();
    expect(ponCapacityText(empty)).toBe('0 ONT(s) · ONU limit not recorded');
    expect(ponPortUsage(data, 'OLT-1', 'PON-99')).toBeUndefined();
  });

  it('names a customer whose record and fibers disagree, without changing anything', () => {
    const ex = network();
    const d = ex.get();
    // Ravi's record says PON-02, but his fibers come from PON-01.
    const wrong = { ...d, customers: d.customers.map((c) => (c.id === ex.ravi.id ? { ...c, ponPort: 'PON-02' } : c)) };
    const p1 = ponPortUsage(wrong, 'OLT-1', 'PON-01', { trace: true })!;
    const p2 = ponPortUsage(wrong, 'OLT-1', 'PON-02', { trace: true })!;
    expect(p1.notes.join(' ')).toMatch(/reach 1 customer\(s\) whose record names another port/);
    expect(p2.notes.join(' ')).toMatch(/do not reach them yet: Ravi/);
  });

  it('the capacity report uses the counted ONTs, not the stored counter', () => {
    const ex = network();
    const d = ex.get();
    const drifted = { ...d, equipment: d.equipment.map((e) => (e.id === 'OLT-1' ? { ...e, ponPorts: e.ponPorts!.map((p) => ({ ...p, connectedCustomersCount: 30 })) } : e)) };
    const report = buildReports(drifted as never).find((t) => t.id === 'capacity')!;
    const row = report.rows.find((r) => r.kind === 'PON port' && String(r.id).endsWith('PON-01'))!;
    expect(row).toMatchObject({ used: 2, capacity: 64, free: 62 });
  });
});
