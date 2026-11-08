import { describe, expect, it } from 'vitest';

import { applyPatch, type CommandResult, type NetworkData } from '../src/domain/command';
import {
  addBuildingUnit,
  addFloorBox,
  adoptCustomerOnt,
  attachCustomerToOnt,
  createBuilding,
  createOnt,
  disconnectCustomer,
  endService,
  moveCustomer,
  ontOfCustomer,
  placeCustomerInUnit,
  saveBuildingDetails,
  saveOntDetails,
  saveService,
  swapOnt,
} from '../src/domain/connectionCommands';
import { checkChangeSetConnections, findConnectionProblems } from '../src/domain/connectionRules';
import { deleteEquipment } from '../src/domain/equipment';
import {
  addOdfPanel,
  createClosure,
  patchOdfPort,
  recordSplice,
  retireSplice,
  setCableLayout,
  setOdfPortFeeder,
  updatePonPort,
} from '../src/domain/fiberCommands';
import { buildFiberIndex } from '../src/domain/fiberIndex';
import { findFiberProblems } from '../src/domain/fiberRules';
import { buildOltPonPorts } from '../src/domain/oltConfig';
import { createSplitter, provisionCustomer } from '../src/domain/provisioning';
import { reconcileCableLength, reconcileCustomerRx } from '../src/domain/reconciliation';
import { buildingUnitPaths, type LogicalNode, serviceTopology } from '../src/domain/serviceTopology';
import type { Cable, Customer } from '../src/model/types';
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

/** Example A built with the same commands people use, with two customers on one 1:8 splitter. */
function exampleA(tx: number | null = 3) {
  let data: NetworkData = {
    ...emptyNetwork(),
    equipment: [
      equipment({ id: 'OLT-1', type: 'OLT', category: 'Central Office', technology: 'GPON', totalPorts: 4 }),
      equipment({ id: 'ODF-1', type: 'ODF', category: 'Central Office' }),
      equipment({ id: 'JC-1', type: 'Fiber Joint Closure' }),
      equipment({ id: 'FAT-1', type: 'FAT', totalPorts: 8 }),
      equipment({ id: 'BEP-1', type: 'Building Entry Point', lat: 17.412, lng: 78.412 }),
    ],
    cables: [fiberCable('FDR-1', 24, 'ODF-1', 'JC-1', 3000, { type: 'Main Feeder Fiber' }), fiberCable('DST-1', 12, 'JC-1', 'FAT-1', 1500), fiberCable('RSR-1', 12, 'BEP-1', 'BEP-1', 30)],
  };
  const step = <T>(result: CommandResult<T>) => {
    const r = ok(result);
    data = applyPatch(data, r.patch);
    return r.value;
  };
  data = { ...data, equipment: data.equipment.map((e) => (e.id === 'OLT-1' ? { ...e, ponPorts: buildOltPonPorts(e) } : e)) };
  step(updatePonPort(data, 'OLT-1', 'PON-01', { opticsClass: 'GPON B+', vendorAddress: 'gpon 0/1/0', ...(tx !== null ? { txPowerDbm: tx } : {}) }, ctx));
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
  return { data, step: (fn: (d: NetworkData) => CommandResult<unknown>) => step(fn(data)), get: () => data, set: (d: NetworkData) => (data = d), closure, splice, splitter, asha, ravi };
}

const cust = (data: NetworkData, id: string) => data.customers.find((c) => c.id === id)!;
const activeOn = (data: NetworkData, cableId: string, core: number) => data.cables.find((c) => c.id === cableId)!.cores.find((k) => k.coreNumber === core)?.assignments?.find((a) => !a.releasedAt);

describe('ONT records apart from customers', () => {
  it('reads the serial still embedded in an older customer, and makes a record without guessing', () => {
    const ex = exampleA();
    const asha = cust(ex.get(), ex.asha.id);
    expect(ontOfCustomer(ex.get(), asha)).toMatchObject({ source: 'customer_record', serialNumber: 'ZTEG0000A001' });
    const ont = ex.step((d) => adoptCustomerOnt(d, asha.id, ctx)) as { id: string; serialNumber?: string; vendor?: string; statusSource: string; splitterId?: string; dropCore?: number };
    expect(ont).toMatchObject({ serialNumber: 'ZTEG0000A001', statusSource: 'customer_record', splitterId: ex.splitter.id, dropCore: 1 });
    expect(ont.vendor).toBeUndefined();
    expect(cust(ex.get(), asha.id).ontId).toBe(ont.id);
    expect(adoptCustomerOnt(ex.get(), asha.id, ctx).ok).toBe(false);
    expect(ontOfCustomer(ex.get(), cust(ex.get(), asha.id)).source).toBe('ont_record');
  });

  it('keeps a serial exactly as typed and refuses one already used', () => {
    const ex = exampleA();
    expect(refused(createOnt(ex.get(), { serialNumber: 'hwtc0000b002' }, ctx))).toMatch(/already recorded for Ravi/);
    const ont = ex.step((d) => createOnt(d, { serialNumber: '  ALCL 0000C003 ', vendor: 'Nokia' }, ctx)) as { serialNumber: string; status: string };
    expect(ont).toMatchObject({ serialNumber: 'ALCL 0000C003', status: 'in_stock' });
  });

  it('swaps an ONT, keeping the old one as removed history and moving its services', () => {
    const ex = exampleA();
    const id = ex.asha.id;
    const old = ex.step((d) => adoptCustomerOnt(d, id, ctx)) as { id: string };
    const svc = ex.step((d) => saveService(d, { customerId: id, kind: 'internet', planName: 'Home 100 (as written)', ontId: old.id }, ctx)) as { id: string };
    expect(refused(swapOnt(ex.get(), id, { serialNumber: 'ZTEG0000A009' }, '', ctx))).toMatch(/why/);
    expect(refused(swapOnt(ex.get(), id, { serialNumber: 'zteg0000a001' }, 'Dead', ctx))).toMatch(/same serial/i);
    const fresh = ex.step((d) => swapOnt(d, id, { serialNumber: 'ZTEG0000A009', vendor: 'ZTE' }, 'Power LED off', ctx)) as { id: string; dropCore?: number; status: string };
    const data = ex.get();
    const removed = data.onts!.find((o) => o.id === old.id)!;
    expect(removed).toMatchObject({ status: 'removed', removedReason: 'Power LED off', replacedByOntId: fresh.id });
    expect(fresh).toMatchObject({ status: 'installed', dropCore: 1 });
    expect(cust(data, id)).toMatchObject({ ontId: fresh.id, ontSerialNumber: 'ZTEG0000A009' });
    expect(data.services!.find((s) => s.id === svc.id)!.ontId).toBe(fresh.id);
  });

  it('refuses a second customer on a one-customer ONT, and allows it on a shared one', () => {
    const ex = exampleA();
    const ont = ex.step((d) => adoptCustomerOnt(d, ex.asha.id, ctx)) as { id: string };
    expect(refused(attachCustomerToOnt(ex.get(), ex.ravi.id, ont.id, 'MDU', ctx))).toMatch(/already serves Asha/);
    ex.step((d) => saveOntDetails(d, ont.id, { arrangement: 'shared' }, ctx));
    const r = attachCustomerToOnt(ex.get(), ex.ravi.id, ont.id, 'Both flats on one ONU', ctx);
    expect(r.ok).toBe(true);
  });

  it('keeps the customer serial in step when the ONT record changes', () => {
    const ex = exampleA();
    const ont = ex.step((d) => adoptCustomerOnt(d, ex.asha.id, ctx)) as { id: string };
    ex.step((d) => saveOntDetails(d, ont.id, { serialNumber: 'ZTEG0000A0X1', vendor: 'ZTE', model: 'F660' }, ctx));
    expect(cust(ex.get(), ex.asha.id).ontSerialNumber).toBe('ZTEG0000A0X1');
  });
});

describe('disconnect and move', () => {
  it('disconnect releases the drop fiber, splitter output, box port and ONT link, with history and nothing deleted', () => {
    const ex = exampleA();
    const id = ex.asha.id;
    const before = cust(ex.get(), id);
    ex.step((d) => adoptCustomerOnt(d, id, ctx));
    ex.step((d) => saveService(d, { customerId: id, kind: 'internet' }, ctx));
    expect(refused(disconnectCustomer(ex.get(), id, '  ', ctx))).toMatch(/why/);
    const ponBefore = ex.get().equipment.find((e) => e.id === 'OLT-1')!.ponPorts!.find((p) => p.id === 'PON-01')!.connectedCustomersCount;
    ex.step((d) => disconnectCustomer(d, id, 'Moved away', ctx));
    const data = ex.get();
    const c = cust(data, id);
    expect(c).toMatchObject({ status: 'Disconnected', disconnectReason: 'Moved away', splitterId: '', dropCableId: '', fiberCore: 0 });
    expect(c.ontId).toBeUndefined();
    expect(c.connectionHistory?.[0]).toMatchObject({ kind: 'disconnected', reason: 'Moved away', splitterId: ex.splitter.id, splitterOutputPort: 2, dropCableId: before.dropCableId, fiberCore: 1, ontSerialNumber: 'ZTEG0000A001' });
    const drop = data.cables.find((x) => x.id === before.dropCableId)!;
    expect(drop).toBeDefined();
    const core1 = drop.cores.find((k) => k.coreNumber === 1)!;
    expect(core1.status).toBe('Available');
    expect(core1.assignments?.[0]).toMatchObject({ releaseReason: expect.stringContaining('Moved away') });
    const port = data.splitters[0].outputPorts.find((p) => p.portNumber === 2)!;
    expect(port.status).toBe('Available');
    expect(port.connectedCustomerId).toBeUndefined();
    expect(port.history?.at(-1)?.action).toBe('OUTPUT_FREED');
    expect(data.equipment.find((e) => e.id === 'FAT-1')!.logicalPorts!.some((p) => p.customerId === id)).toBe(false);
    expect(data.equipment.find((e) => e.id === 'OLT-1')!.ponPorts!.find((p) => p.id === 'PON-01')!.connectedCustomersCount).toBe(ponBefore - 1);
    expect(data.onts![0]).toMatchObject({ status: 'in_stock' });
    expect(data.onts![0].splitterId).toBeUndefined();
    expect(data.services![0]).toMatchObject({ status: 'ended', endReason: 'Customer disconnected: Moved away' });
    // The feeder and street fibers still serve Ravi; nothing else was touched.
    expect(activeOn(data, 'DST-1', 3)?.ponPortId).toBe('PON-01');
    expect(buildFiberIndex(data).sinks.get(`${before.dropCableId}#1`)).toBeUndefined();
    expect(refused(disconnectCustomer(data, id, 'again', ctx))).toMatch(/already disconnected/);
  });

  it('moves a customer to another output: old output and fiber freed with history, OLT link worked out from the fibers', () => {
    const ex = exampleA();
    const id = ex.asha.id;
    const drop = cust(ex.get(), id).dropCableId;
    ex.step((d) => adoptCustomerOnt(d, id, ctx));
    ex.step((d) => moveCustomer(d, id, { splitterId: ex.splitter.id, port: 5 }, 'Output 2 faulty', ctx));
    const data = ex.get();
    const c = cust(data, id);
    expect(c).toMatchObject({ splitterOutputPort: 5, dropCableId: drop, fiberCore: 1, oltId: 'OLT-1', ponPort: 'PON-01', feederCableId: 'FDR-1', distributionCableId: 'DST-1' });
    expect(c.connectionHistory?.[0]).toMatchObject({ kind: 'moved', splitterOutputPort: 2, reason: 'Output 2 faulty' });
    const ports = data.splitters[0].outputPorts;
    expect(ports.find((p) => p.portNumber === 2)).toMatchObject({ status: 'Available' });
    expect(ports.find((p) => p.portNumber === 5)).toMatchObject({ status: 'Occupied', connectedCustomerId: id, connectedDropCableId: drop, connectedCore: 1 });
    const core = data.cables.find((x) => x.id === drop)!.cores.find((k) => k.coreNumber === 1)!;
    expect(core.assignments!.filter((a) => a.releasedAt)).toHaveLength(1);
    expect(core.assignments!.filter((a) => !a.releasedAt)).toHaveLength(1);
    expect(data.onts![0]).toMatchObject({ splitterOutputPort: 5 });
    expect(findFiberProblems(data).filter((p) => p.severity === 'error')).toEqual([]);
  });

  it('refuses a move onto an output or a fiber someone else already has', () => {
    const ex = exampleA();
    const ravi = cust(ex.get(), ex.ravi.id);
    expect(refused(moveCustomer(ex.get(), ex.asha.id, { splitterId: ex.splitter.id, port: 3 }, 'test', ctx))).toMatch(/already serves Ravi/);
    expect(refused(moveCustomer(ex.get(), ex.asha.id, { splitterId: ex.splitter.id, port: 6, drop: { cableId: ravi.dropCableId, core: 1 } }, 'test', ctx))).toMatch(/already in use for Customer/);
    expect(refused(moveCustomer(ex.get(), ex.asha.id, { splitterId: ex.splitter.id, port: 9 }, 'test', ctx))).toMatch(/8 outputs/);
  });

  it('reconnects a disconnected customer on a free output', () => {
    const ex = exampleA();
    const id = ex.asha.id;
    ex.step((d) => disconnectCustomer(d, id, 'Not paid', ctx));
    ex.step((d) => moveCustomer(d, id, { splitterId: ex.splitter.id, port: 2 }, 'Paid again', ctx));
    const c = cust(ex.get(), id);
    expect(c).toMatchObject({ status: 'Active', splitterOutputPort: 2, oltId: 'OLT-1' });
    expect(c.disconnectedAt).toBeUndefined();
    expect(c.connectionHistory).toHaveLength(1);
  });
});

describe('services', () => {
  it('keeps a plan only as written, ends a service as history, and refuses one on a disconnected customer', () => {
    const ex = exampleA();
    const tv = ex.step((d) => saveService(d, { customerId: ex.asha.id, kind: 'rf_video', planName: 'Basic pack' }, ctx)) as { id: string; planName?: string };
    expect(tv.planName).toBe('Basic pack');
    const net = ex.step((d) => saveService(d, { customerId: ex.asha.id, kind: 'internet' }, ctx)) as { planName?: string };
    expect(net.planName).toBeUndefined();
    ex.step((d) => endService(d, tv.id, 'Customer asked', ctx));
    expect(ex.get().services!.find((s) => s.id === tv.id)).toMatchObject({ status: 'ended', endReason: 'Customer asked' });
    ex.step((d) => disconnectCustomer(d, ex.ravi.id, 'Moved', ctx));
    expect(refused(saveService(ex.get(), { customerId: ex.ravi.id, kind: 'internet' }, ctx))).toMatch(/disconnected/);
  });
});

describe('buildings and units', () => {
  it('sets up an MDU from its entry pin, adds floor boxes and units, and names each missing link per unit', () => {
    const ex = exampleA();
    const b = ex.step((d) => createBuilding(d, { name: 'Lake View', kind: 'apartment', entryEquipmentId: 'BEP-1' }, ctx)) as { id: string; lat: number };
    expect(b.lat).toBe(17.412);
    expect(createBuilding(ex.get(), { name: 'Again', kind: 'apartment', entryEquipmentId: 'BEP-1' }, ctx).ok).toBe(false);
    const withBox = ex.step((d) => addFloorBox(d, b.id, { label: 'Floor 3 box', floor: '3', splitterId: ex.splitter.id }, ctx)) as { floorBoxes: { id: string }[] };
    const boxId = withBox.floorBoxes[0].id;
    ex.step((d) => addBuildingUnit(d, b.id, { label: '302', floor: '3', floorBoxId: boxId }, ctx));
    ex.step((d) => addBuildingUnit(d, b.id, { label: '303', floor: '3' }, ctx));
    expect(refused(addBuildingUnit(ex.get(), b.id, { label: '302' }, ctx))).toMatch(/already has unit 302/);
    const building = () => ex.get().buildings!.find((x) => x.id === b.id)!;
    const [u302, u303] = building().units;
    ex.step((d) => placeCustomerInUnit(d, ex.asha.id, { buildingId: b.id, unitId: u302.id }, ctx));
    ex.step((d) => placeCustomerInUnit(d, ex.ravi.id, { buildingId: b.id, unitId: u303.id }, ctx));
    expect(cust(ex.get(), ex.asha.id)).toMatchObject({ building: 'Lake View', flatNumber: '302' });
    let paths = buildingUnitPaths(building(), ex.get());
    expect(paths).toHaveLength(2);
    expect(paths[0].gaps).toEqual(['Riser cable not recorded']);
    expect(paths[1].gaps).toEqual(['Riser cable not recorded', 'No floor box recorded for 303']);
    expect(paths[0].steps.map((s) => s.kind)).toEqual(['olt', 'entry', 'riser', 'floor_box', 'drop', 'ont', 'customer']);
    ex.step((d) => saveBuildingDetails(d, b.id, { riserCableId: 'RSR-1' }, ctx));
    paths = buildingUnitPaths(building(), ex.get());
    expect(paths[0].gaps).toEqual([]);
    // The entry pin cannot be deleted while the building names it.
    const del = deleteEquipment(ex.get(), 'BEP-1');
    expect(del.ok).toBe(false);
  });
});

describe('connection link checks (browser and server)', () => {
  it('refuses broken links and two ONTs with one serial, but not problems already stored', () => {
    const ex = exampleA();
    const data = ex.get();
    const ont = { id: 'ONT-X', arrangement: 'single' as const, status: 'installed' as const, statusSource: 'person' as const, createdAt: '2026-11-07', serialNumber: 'S1' };
    expect(checkChangeSetConnections(data, { upserts: { onts: [{ ...ont, splitterId: 'SPL-NONE' }] } }).map((p) => p.code)).toEqual(['ont_missing_splitter']);
    expect(checkChangeSetConnections(data, { upserts: { onts: [ont, { ...ont, id: 'ONT-Y', serialNumber: 's1' }] } }).map((p) => p.code)).toEqual(['ont_serial_twice']);
    const asha = cust(data, ex.asha.id);
    const ravi = cust(data, ex.ravi.id);
    expect(checkChangeSetConnections(data, { upserts: { customers: [{ ...asha, ontId: 'ONT-NONE' }] } }).map((p) => p.code)).toEqual(['customer_missing_ont']);
    expect(
      checkChangeSetConnections({ ...data, onts: [ont] }, { upserts: { customers: [{ ...asha, ontId: 'ONT-X' }, { ...ravi, ontId: 'ONT-X' }] } }).map((p) => p.code),
    ).toEqual(['ont_single_shared']);
    expect(checkChangeSetConnections(data, { upserts: { services: [{ id: 'SVC-1', customerId: 'NOBODY', kind: 'internet', status: 'active', createdAt: '2026-11-07' }] } }).map((p) => p.code)).toEqual(['service_missing_customer']);
    // A removed ONT is history: it may name things that are gone.
    expect(checkChangeSetConnections(data, { upserts: { onts: [{ ...ont, status: 'removed', splitterId: 'GONE' }] } })).toEqual([]);
    // Already broken before: not blamed on an unrelated change.
    const broken = { ...data, onts: [{ ...ont, splitterId: 'GONE' }] };
    expect(checkChangeSetConnections(broken, { upserts: { services: [{ id: 'SVC-2', customerId: asha.id, kind: 'internet', status: 'active', createdAt: '2026-11-07' }] } })).toEqual([]);
    // Deleting a pin a building names is refused.
    const withBuilding = { ...data, buildings: [{ id: 'B1', name: 'B', kind: 'apartment' as const, lat: 1, lng: 1, entryEquipmentId: 'BEP-1', floorBoxes: [], units: [], createdAt: '' }] };
    expect(checkChangeSetConnections(withBuilding, { deletes: { equipment: ['BEP-1'] } }).map((p) => p.code)).toEqual(['building_missing_entry']);
    expect(findConnectionProblems(data)).toEqual([]);
  });

  it('lets customers on one shared ONT use one drop fiber without a fiber error', () => {
    const ex = exampleA();
    const data = ex.get();
    const asha = cust(data, ex.asha.id);
    const ravi = cust(data, ex.ravi.id);
    const ont = { id: 'ONT-S', arrangement: 'shared' as const, status: 'installed' as const, statusSource: 'person' as const, createdAt: '' };
    const after: NetworkData = { ...data, onts: [ont], customers: data.customers.map((c) => (c.id === ravi.id ? { ...ravi, ontId: 'ONT-S', dropCableId: asha.dropCableId, fiberCore: 1 } : c.id === asha.id ? { ...asha, ontId: 'ONT-S' } : c)) };
    expect(findFiberProblems(after).some((p) => p.code === 'core_two_continuations')).toBe(false);
    const single = { ...after, onts: [{ ...ont, arrangement: 'single' as const }] };
    expect(findConnectionProblems(single).map((p) => p.code)).toContain('ont_single_shared');
  });
});

const flatten = (nodes: LogicalNode[]): LogicalNode[] => nodes.flatMap((n) => [n, ...flatten(n.children)]);

describe('logical service topology', () => {
  it('builds OLT, PON, splitter, output, ONT, customer and service only from recorded links', () => {
    const ex = exampleA();
    ex.step((d) => saveService(d, { customerId: ex.asha.id, kind: 'internet' }, ctx));
    ex.step((d) => saveService(d, { customerId: ex.asha.id, kind: 'rf_video' }, ctx));
    const topo = serviceTopology(ex.get());
    const all = flatten(topo.roots);
    const olt = topo.roots.find((r) => r.label === 'OLT-1')!;
    const pon = olt.children.find((n) => n.label === 'PON-01')!;
    expect(pon.detail).toContain('gpon 0/1/0');
    const sp = pon.children.find((n) => n.kind === 'splitter')!;
    const out2 = sp.children.find((n) => n.label === 'Output 2')!;
    expect(out2.children[0]).toMatchObject({ kind: 'ont', label: 'ONT ZTEG0000A001' });
    expect(out2.children[0].children[0]).toMatchObject({ kind: 'customer', label: 'Asha' });
    expect(out2.children[0].children[0].children.map((s) => s.kind)).toEqual(['service', 'service']);
    expect(sp.children.some((n) => n.label === '6 outputs free')).toBe(true);
    expect(topo.counts.customersReached).toBe(2);
    expect(all.filter((n) => n.status === 'gap')).toEqual([]);
  });

  it('names the missing link when a splice is taken out, and lists the cut-off customers apart', () => {
    const ex = exampleA();
    ex.step((d) => retireSplice(d, ex.closure.id, ex.splice.id, 'Cut', ctx));
    const topo = serviceTopology(ex.get());
    const pon = topo.roots[0].children.find((n) => n.label === 'PON-01')!;
    expect(pon.children[0]).toMatchObject({ kind: 'gap', label: 'Fiber 3 (Green, in tube 1) of FDR-1 has no recorded link on its customer side.' });
    expect(topo.unreached.map((n) => n.label)).toEqual(['Asha', 'Ravi', `Splitter ${ex.splitter.name}`]);
    expect(topo.unreached[0].children[0].label).toMatch(/Fiber 3 \(Green, in tube 1\) of DST-1 has no recorded link on its OLT side/);
    expect(topo.counts.customersUnreached).toBe(2);
  });
});

const withReading = (c: Customer, rx: number, source: Customer['rxSource'] = 'field_measured'): Customer => ({ ...c, rxOpticalPowerDbm: rx, rxSource: source, rxMeasuredAt: '2026-11-07T10:00:00Z' });

describe('reconciliation', () => {
  it('flags a measured reading far below the prediction, with a plain next action', () => {
    const ex = exampleA(3);
    const data = ex.get();
    const asha = cust(data, ex.asha.id);
    const fine = reconcileCustomerRx(withReading(asha, -16), data);
    expect(fine.basis).toBe('port_tx');
    const expected = fine.expectedDbm!;
    const weak = reconcileCustomerRx(withReading(asha, expected - 6), data);
    expect(weak).toMatchObject({ status: 'weaker', flagged: true, gapDb: -6 });
    expect(weak.nextAction).toMatch(/connector at the box/);
    const strong = reconcileCustomerRx(withReading(asha, expected + 5), data);
    expect(strong.status).toBe('stronger');
    expect(reconcileCustomerRx(withReading(asha, expected - 1), data)).toMatchObject({ status: 'matches', flagged: false });
  });

  it('never treats a calculated value as measured, and gives only a range without the port launch power', () => {
    const ex = exampleA(null);
    const data = ex.get();
    const asha = cust(data, ex.asha.id);
    expect(reconcileCustomerRx(withReading(asha, -30, 'calculated'), data).status).toBe('not_measured');
    expect(reconcileCustomerRx({ ...asha, rxOpticalPowerDbm: undefined, rxSource: undefined }, data).status).toBe('no_reading');
    const unclear = reconcileCustomerRx(withReading(asha, -10), data);
    expect(unclear).toMatchObject({ status: 'unclear', basis: 'class_range', flagged: false });
    expect(unclear.nextAction).toMatch(/launch power \(Tx\) of OLT-1 PON-01/);
    expect(reconcileCustomerRx(withReading(asha, -40), data)).toMatchObject({ status: 'weaker', flagged: true });
  });

  it('says what is missing when the fiber path is not recorded', () => {
    const ex = exampleA();
    ex.step((d) => retireSplice(d, ex.closure.id, ex.splice.id, 'Cut', ctx));
    const r = reconcileCustomerRx(withReading(cust(ex.get(), ex.asha.id), -20), ex.get());
    expect(r.status).toBe('no_path');
    expect(r.nextAction).toMatch(/Record the missing link first: Fiber 3/);
  });

  it('compares drawn, sheath and optical lengths and turns a difference into a next action', () => {
    const c = cable({ id: 'L1', coordinates: [[12.9, 77.6], [12.9, 77.61]], sheathMarkStart: 1000, sheathMarkEnd: 2100, opticalLengthMeters: 1000 });
    const r = reconcileCableLength(c);
    expect(r.flagged).toBe(true);
    expect(r.flags.map((f) => f.code)).toContain('optical_short');
    expect(r.flags.find((f) => f.code === 'optical_short')!.nextAction).toMatch(/OTDR test was on this cable/);
    expect(reconcileCableLength(cable({ id: 'L2', coordinates: [[12.9, 77.6], [12.9, 77.61]] })).finding).toMatch(/Only the drawn length/);
  });
});
