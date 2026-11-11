import { describe, expect, it } from 'vitest';

import { applyPatch, type CommandResult, type NetworkData } from '../src/domain/command';
import { adoptCustomerOnt, saveService } from '../src/domain/connectionCommands';
import { CUSTOMER_HIDDEN_TEXT, redactCustomer } from '../src/domain/customerPrivacy';
import { addOdfPanel, createClosure, patchOdfPort, recordSplice, retireSplice, setCableLayout, setOdfPortFeeder, updatePonPort } from '../src/domain/fiberCommands';
import {
  combinedTargets,
  combinedView,
  customerLabel,
  findLogicalProblems,
  resolveLogicalSettings,
  saveServiceBinding,
  serviceBindings,
  setOntRegistration,
  vlanText,
} from '../src/domain/logicalTopology';
import { buildOltPonPorts } from '../src/domain/oltConfig';
import { createSplitter, provisionCustomer } from '../src/domain/provisioning';
import { type LogicalNode, serviceTopology } from '../src/domain/serviceTopology';
import { serviceSchema } from '../src/model/schemas';
import type { Cable, Ont, Service } from '../src/model/types';
import { cable, emptyNetwork, equipment, NOW } from './fixtures';

/** Network mapping Phase 14: the logical layer (service bindings) next to the fibre links. */

const ctx = { now: NOW, actor: 'Test Engineer' };
const UNIQUE = resolveLogicalSettings([{ id: 'logical.vlanUniquePerPon', value: true }]);

function ok<T>(result: CommandResult<T>): { value: T; patch: NetworkData; confirm?: string; audit: { action: string }[] } {
  if (!result.ok) throw new Error(`${result.error.title}: ${result.error.message}`);
  return { value: result.value, patch: result.patch as NetworkData, confirm: result.confirm, audit: result.audit };
}
const refused = <T>(result: CommandResult<T>): string => {
  if (result.ok) throw new Error('expected a refusal');
  return result.error.message;
};

const fiberCable = (id: string, fiberCount: number, from: string, to: string, extra: Partial<Cable> = {}) =>
  cable({ id, name: id, fiberCount, lengthMeters: 1000, startEquipmentId: from, endEquipmentId: to, coordinates: [[17.4, 78.4], [17.41, 78.41]], cores: [], ...extra });

/** OLT-1 PON-01 → ODF → feeder → splice → distribution → 1:8 splitter in FAT-1 → Asha (output 2), Ravi (output 3). */
function network() {
  let data: NetworkData = {
    ...emptyNetwork(),
    equipment: [
      equipment({ id: 'OLT-1', name: 'OLT-1', type: 'OLT', category: 'Central Office', technology: 'GPON', totalPorts: 4 }),
      equipment({ id: 'ODF-1', type: 'ODF', category: 'Central Office' }),
      equipment({ id: 'JC-1', type: 'Fiber Joint Closure' }),
      equipment({ id: 'FAT-1', name: 'FAT-1', type: 'FAT', totalPorts: 8 }),
    ],
    cables: [fiberCable('FDR-1', 24, 'ODF-1', 'JC-1', { type: 'Main Feeder Fiber' }), fiberCable('DST-1', 12, 'JC-1', 'FAT-1')],
  };
  const step = <T>(result: CommandResult<T>) => {
    const r = ok(result);
    data = applyPatch(data, r.patch);
    return r.value;
  };
  data = { ...data, equipment: data.equipment.map((e) => (e.id === 'OLT-1' ? { ...e, ponPorts: buildOltPonPorts(e) } : e)) };
  step(updatePonPort(data, 'OLT-1', 'PON-01', { opticsClass: 'GPON B+' }, ctx));
  step(setCableLayout(data, 'FDR-1', { colorScheme: 'tia-598', tubeColorScheme: 'tia-598', fibersPerTube: 12 }, ctx));
  step(setCableLayout(data, 'DST-1', { colorScheme: 'tia-598', fibersPerTube: 12 }, ctx));
  const panel = step(addOdfPanel(data, 'ODF-1', { label: 'Panel A', portCount: 24 }, ctx));
  step(setOdfPortFeeder(data, 'ODF-1', panel.id, 3, { cableId: 'FDR-1', core: 3 }, ctx));
  step(patchOdfPort(data, 'ODF-1', panel.id, 3, { oltId: 'OLT-1', ponPortId: 'PON-01' }, ctx));
  const closure = step(createClosure(data, { equipmentId: 'JC-1', closureType: 'Dome Splice Closure', trayCount: 2 }, ctx));
  const splice = step(recordSplice(data, closure.id, { trayId: closure.trays![0].id, inputCableId: 'FDR-1', inputCore: 3, outputCableId: 'DST-1', outputCore: 3 }, ctx));
  const splitter = step(createSplitter(data, { terminalBoxId: 'FAT-1', ratio: '1:8', input: { cableId: 'DST-1', core: 3 } }, ctx));
  const asha = step(provisionCustomer(data, { terminalBoxId: 'FAT-1', splitterId: splitter.id, splitterOutputPort: 2, name: 'Asha', lat: 17.411, lng: 78.411, ontSerialNumber: 'ZTEG0000A001' }, ctx)).customer;
  const ravi = step(provisionCustomer(data, { terminalBoxId: 'FAT-1', splitterId: splitter.id, splitterOutputPort: 3, name: 'Ravi', lat: 17.4112, lng: 78.4112, ontSerialNumber: 'HWTC0000B002' }, ctx)).customer;
  const ashaOnt = step(adoptCustomerOnt(data, asha.id, ctx)) as Ont;
  const raviOnt = step(adoptCustomerOnt(data, ravi.id, ctx)) as Ont;
  const ashaNet = step(saveService(data, { customerId: asha.id, kind: 'internet', planName: 'Home 100' }, ctx)) as Service;
  const raviNet = step(saveService(data, { customerId: ravi.id, kind: 'internet' }, ctx)) as Service;
  return {
    get: () => data,
    set: (d: NetworkData) => (data = d),
    step: <T>(fn: (d: NetworkData) => CommandResult<T>) => step(fn(data)),
    closure,
    splice,
    splitter,
    asha,
    ravi,
    ashaOnt,
    raviOnt,
    ashaNet,
    raviNet,
  };
}

const flatten = (nodes: LogicalNode[]): LogicalNode[] => nodes.flatMap((n) => [n, ...flatten(n.children)]);
const svc = (data: NetworkData, id: string) => data.services!.find((s) => s.id === id)!;

describe('logical settings', () => {
  it('keeps the VLAN rule off by default and takes only a yes or no override', () => {
    expect(resolveLogicalSettings().vlanUniquePerPon).toBe(false);
    expect(UNIQUE.vlanUniquePerPon).toBe(true);
    expect(resolveLogicalSettings([{ id: 'logical.vlanUniquePerPon', value: 'yes' }]).vlanUniquePerPon).toBe(false);
  });
});

describe('service binding', () => {
  it('records VLAN, profile, IP and circuit id exactly as typed, with who and when', () => {
    const n = network();
    const saved = n.step((d) => saveServiceBinding(d, n.ashaNet.id, { vlan: 100, profileName: ' FTTH-100M ', ipAddress: 'PPPoE', circuitId: 'CKT/77' }, ctx));
    expect(saved).toMatchObject({ vlan: 100, profileName: 'FTTH-100M', ipAddress: 'PPPoE', circuitId: 'CKT/77', bindingRecordedBy: 'Test Engineer', bindingRecordedAt: NOW.toISOString() });
    expect(saved.sVlan).toBeUndefined();
    expect(saved.history!.at(-1)!.action).toBe('BINDING_RECORDED');
    // A field left out is taken off ("Not recorded"); nothing is kept from a guess.
    const again = n.step((d) => saveServiceBinding(d, n.ashaNet.id, { sVlan: 200, cVlan: 17 }, ctx));
    expect(again.vlan).toBeUndefined();
    expect(again.profileName).toBeUndefined();
    expect(vlanText(again)).toBe('S-VLAN 200, C-VLAN 17');
    expect(vlanText(svc(n.get(), n.raviNet.id))).toBe('VLAN not recorded');
  });

  it('refuses a VLAN no network can carry, in the command and in the record type', () => {
    const n = network();
    for (const bad of [0, 4095, 12.5]) expect(refused(saveServiceBinding(n.get(), n.ashaNet.id, { vlan: bad }, ctx))).toMatch(/1 to 4094/);
    expect(serviceSchema.safeParse({ ...n.ashaNet, vlan: 4095 }).success).toBe(false);
    expect(serviceSchema.safeParse({ ...n.ashaNet, vlan: 4094, sVlan: 1, cVlan: 2 }).success).toBe(true);
    expect(refused(saveServiceBinding(n.get(), 'SVC-NOPE', { vlan: 5 }, ctx))).toMatch(/not found/);
  });

  it('says the binding of an older service with nothing recorded is not recorded, never filled in', () => {
    const n = network();
    const view = combinedView(n.get(), { kind: 'customer', id: n.ravi.id });
    const steps = view.rows[0].services[0].steps;
    for (const label of ['VLAN', 'Profile, as written', 'IP, as written', 'Circuit id, as written', 'Who and when']) {
      expect(steps.find((s) => s.label === label)).toMatchObject({ value: 'Not recorded', status: 'missing' });
    }
  });
});

describe('VLAN used twice on one PON port', () => {
  it('is quiet with the setting off, and warns naming both services when it is on', () => {
    const n = network();
    n.step((d) => saveServiceBinding(d, n.ashaNet.id, { vlan: 100 }, ctx));
    const second = saveServiceBinding(n.get(), n.raviNet.id, { vlan: 100 }, ctx);
    expect(ok(second).confirm).toBeUndefined();
    n.set(applyPatch(n.get(), ok(second).patch));
    expect(findLogicalProblems(n.get()).filter((p) => p.code === 'vlan_twice_on_pon')).toEqual([]);
    const [warning] = findLogicalProblems(n.get(), UNIQUE).filter((p) => p.code === 'vlan_twice_on_pon');
    expect(warning.severity).toBe('warning');
    expect(warning.message).toContain('VLAN 100 is used by 2 services on OLT-1 PON-01');
    expect(warning.message).toContain('Asha');
    expect(warning.message).toContain('Ravi');
  });

  it('asks first when a save makes the second use, and writes the acceptance to the audit trail', () => {
    const n = network();
    n.step((d) => saveServiceBinding(d, n.ashaNet.id, { vlan: 100 }, ctx, UNIQUE));
    const r = ok(saveServiceBinding(n.get(), n.raviNet.id, { vlan: 100 }, ctx, UNIQUE));
    expect(r.confirm).toMatch(/VLAN 100 is used by 2 services.*Save anyway\?$/);
    expect(r.audit.map((a) => a.action)).toEqual(['SERVICE_BINDING_RECORDED', 'WARNING_ACCEPTED']);
    // A different tag on the same port is fine.
    expect(ok(saveServiceBinding(n.get(), n.raviNet.id, { vlan: 101 }, ctx, UNIQUE)).confirm).toBeUndefined();
  });
});

describe('ONT registered on a different PON port than its fibres reach', () => {
  it('warns with both ports when the ONT has a service, and asks before saving the registration', () => {
    const n = network();
    expect(serviceBindings(n.get()).map((b) => b.agreement)).toEqual(['agrees', 'agrees']);
    const r = ok(setOntRegistration(n.get(), n.ashaOnt.id, { oltId: 'OLT-1', ponPortId: 'PON-02' }, ctx));
    expect(r.confirm).toMatch(/registered on OLT-1 PON-02, but its fibres reach OLT-1 PON-01/);
    expect(r.audit.map((a) => a.action)).toContain('WARNING_ACCEPTED');
    n.set(applyPatch(n.get(), r.patch));
    const [p] = findLogicalProblems(n.get());
    expect(p).toMatchObject({ code: 'service_pon_mismatch', severity: 'warning' });
    expect(p.refs).toContain(n.ashaNet.id);
  });

  it('refuses an OLT or port that is not on record, and clears to "Not recorded"', () => {
    const n = network();
    expect(refused(setOntRegistration(n.get(), n.ashaOnt.id, { oltId: 'OLT-9', ponPortId: 'PON-01' }, ctx))).toMatch(/not on record/);
    expect(refused(setOntRegistration(n.get(), n.ashaOnt.id, { oltId: 'OLT-1', ponPortId: 'PON-77' }, ctx))).toMatch(/no port PON-77/);
    const cleared = n.step((d) => setOntRegistration(d, n.ashaOnt.id, null, ctx));
    expect(cleared.oltId).toBeUndefined();
    expect(combinedView(n.get(), { kind: 'customer', id: n.asha.id }).rows[0].pon).toBe('not_recorded');
  });

  it('says nothing when the links stop before a PON port: the port is not decided, not guessed', () => {
    const n = network();
    n.step((d) => setOntRegistration(d, n.ashaOnt.id, { oltId: 'OLT-1', ponPortId: 'PON-02' }, ctx));
    n.step((d) => retireSplice(d, n.closure.id, n.splice.id, 'Cut', ctx));
    expect(findLogicalProblems(n.get())).toEqual([]);
    const row = combinedView(n.get(), { kind: 'customer', id: n.asha.id }).rows[0];
    expect(row.pon).toBe('not_decided');
    expect(row.physical.find((s) => s.label === 'PON port')).toMatchObject({ value: 'Not recorded', status: 'missing' });
    expect(row.physicalGaps[0]).toMatch(/no recorded link on its OLT side/);
  });
});

describe('combined view', () => {
  it('shows the fibre path next to the binding and lists a customer from either side of a disagreement', () => {
    const n = network();
    n.step((d) => saveServiceBinding(d, n.ashaNet.id, { vlan: 100 }, ctx));
    n.step((d) => setOntRegistration(d, n.ashaOnt.id, { oltId: 'OLT-1', ponPortId: 'PON-02' }, ctx));
    const pon1 = combinedView(n.get(), { kind: 'pon', oltId: 'OLT-1', ponPortId: 'PON-01' });
    expect(pon1.rows.map((r) => r.customerLabel)).toEqual(['Asha', 'Ravi']);
    expect(pon1.counts).toMatchObject({ customers: 2, agree: 1, disagree: 1 });
    // Listed under PON-02 too, because the ONT record names it.
    const pon2 = combinedView(n.get(), { kind: 'pon', oltId: 'OLT-1', ponPortId: 'PON-02' });
    expect(pon2.rows.map((r) => r.customerLabel)).toEqual(['Asha']);
    const row = pon2.rows[0];
    expect(row.physical.find((s) => s.label === 'Splitter output')!.value).toMatch(/^Output 2 of /);
    expect(row.physical.find((s) => s.label === 'PON port')).toMatchObject({ value: 'PON-01', status: 'mismatch' });
    expect(row.logical.find((s) => s.label === 'Registered on (ONT record)')).toMatchObject({ value: 'OLT-1 PON-02', status: 'mismatch' });
    expect(row.disagreements[0]).toBe('PON port: the ONT record says OLT-1 PON-02; the fibre links reach OLT-1 PON-01.');
    expect(row.services[0].steps.find((s) => s.label === 'VLAN')!.value).toBe('100');
    expect(pon2.findings.map((f) => f.code)).toEqual(['service_pon_mismatch']);
    // The splitter and the OLT views list both customers.
    expect(combinedView(n.get(), { kind: 'splitter', id: n.splitter.id }).rows).toHaveLength(2);
    expect(combinedView(n.get(), { kind: 'olt', id: 'OLT-1' }).rows).toHaveLength(2);
  });

  it('marks a splitter output on the ONT record that the links contradict', () => {
    const n = network();
    n.set({ ...n.get(), onts: n.get().onts!.map((o) => (o.id === n.ashaOnt.id ? { ...o, splitterOutputPort: 5 } : o)) });
    const row = combinedView(n.get(), { kind: 'customer', id: n.asha.id }).rows[0];
    expect(row.logical.find((s) => s.label === 'Splitter output (ONT record)')!.status).toBe('mismatch');
    expect(row.disagreements.some((d) => d.startsWith('Splitter output: the ONT record says Output 5'))).toBe(true);
  });

  it('lists every OLT, PON port, splitter and fibre customer as a choice', () => {
    const n = network();
    const groups = combinedTargets(n.get()).map((t) => t.group);
    expect(groups.filter((g) => g === 'OLT')).toHaveLength(1);
    expect(groups.filter((g) => g === 'PON port')).toHaveLength(4);
    expect(groups.filter((g) => g === 'Splitter')).toHaveLength(1);
    expect(groups.filter((g) => g === 'Customer')).toHaveLength(2);
  });
});

describe('personal data', () => {
  it('names a customer whose name is hidden by id, and leaves out a hidden unit', () => {
    const n = network();
    const hidden = redactCustomer({ ...n.get().customers.find((c) => c.id === n.asha.id)!, flatNumber: '3B' }, ['name', 'address']);
    n.set({ ...n.get(), customers: n.get().customers.map((c) => (c.id === hidden.id ? hidden : c)) });
    expect(customerLabel(hidden)).toBe(`Customer ${hidden.id} (name hidden for your role)`);
    const all = flatten(serviceTopology(n.get()).roots);
    const node = all.find((x) => x.kind === 'customer' && x.ref?.id === hidden.id)!;
    expect(node.label).toBe(customerLabel(hidden));
    expect(node.detail).not.toContain(CUSTOMER_HIDDEN_TEXT);
    expect(combinedView(n.get(), { kind: 'customer', id: hidden.id }).rows[0].customerLabel).toBe(customerLabel(hidden));
    expect(combinedTargets(n.get()).find((t) => t.key === `customer:${hidden.id}`)!.label).toBe(customerLabel(hidden));
  });
});

describe('topology tree from the links', () => {
  it('counts what is below each node, names the box, and puts services on the logical layer', () => {
    const n = network();
    n.step((d) => saveServiceBinding(d, n.ashaNet.id, { vlan: 100, profileName: 'FTTH' }, ctx));
    const topo = serviceTopology(n.get());
    const pon = topo.roots[0].children.find((x) => x.label === 'PON-01')!;
    expect(pon.counts).toMatchObject({ customers: 2, onts: 2, splitters: 1, gaps: 0, mismatches: 0 });
    const idle = topo.roots[0].children.find((x) => x.label === 'PON-02')!;
    expect(idle.counts!.customers).toBe(0);
    const sp = pon.children.find((x) => x.kind === 'splitter')!;
    expect(sp.box).toEqual({ id: 'FAT-1', name: 'FAT-1' });
    const services = flatten([pon]).filter((x) => x.kind === 'service');
    expect(services.every((s) => s.layer === 'logical')).toBe(true);
    expect(services.find((s) => s.key === n.ashaNet.id)!.logicalDetail).toContain('VLAN 100');
    const onts = flatten([pon]).filter((x) => x.kind === 'ont');
    expect(onts[0].logicalDetail).toBe('Registered on OLT-1 PON-01 (ONT record)');
  });

  it('marks an ONT registered on another port than the one the links come from', () => {
    const n = network();
    n.step((d) => setOntRegistration(d, n.ashaOnt.id, { oltId: 'OLT-1', ponPortId: 'PON-03' }, ctx));
    const topo = serviceTopology(n.get());
    const ont = flatten(topo.roots).find((x) => x.kind === 'ont' && x.label === 'ONT ZTEG0000A001')!;
    expect(ont.mismatch).toBe('The ONT record says OLT-1 PON-03, but the fibre links reach it from OLT-1 PON-01.');
    expect(topo.counts.mismatches).toBe(1);
    expect(topo.roots[0].counts!.mismatches).toBe(1);
  });
});
