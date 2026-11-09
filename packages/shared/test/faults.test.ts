import { describe, expect, it } from 'vitest';

import { applyPatch, type CommandResult, type NetworkData } from '../src/domain/command';
import {
  acknowledgeAlarms,
  applyJobEvent,
  clearAlarms,
  createJob,
  faultTimeline,
  openFault,
  raiseAlarm,
  raiseTestEvent,
  recordFaultVerification,
  recordNoPhotoReason,
  setFaultStatus,
  setJobStatus,
  undoJobEvent,
} from '../src/domain/faultCommands';
import { correlateAlarms } from '../src/domain/faultCorrelation';
import { affectedByElement, buildImpactIndex } from '../src/domain/faultImpact';
import { checkChangeSetFaults, findFaultProblems, jobPhotoProblem, noPhotoReasonText, verificationProblem } from '../src/domain/faultRules';
import { resolveFaultSettings } from '../src/domain/faultSettings';
import { addOdfPanel, createClosure, patchOdfPort, recordSplice, setOdfPortFeeder } from '../src/domain/fiberCommands';
import { buildOltPonPorts } from '../src/domain/oltConfig';
import { resolveFault } from '../src/domain/operations';
import { createSplitter, provisionCustomer } from '../src/domain/provisioning';
import type { ChangeSet } from '../src/model/api';
import type { Alarm, Cable, Fault } from '../src/model/types';
import { cable, customer, emptyNetwork, equipment, NOW } from './fixtures';

const ctx = { now: NOW, actor: 'Office Tester' };

function ok<T>(result: CommandResult<T>): { value: T; patch: NetworkData } {
  if (!result.ok) throw new Error(`${result.error.title}: ${result.error.message}`);
  return { value: result.value, patch: result.patch as NetworkData };
}

const line = (id: string, fiberCount: number, from: string, to: string, extra: Partial<Cable> = {}) =>
  cable({ id, name: id, fiberCount, lengthMeters: 500, startEquipmentId: from, endEquipmentId: to, coordinates: [[17.4, 78.4], [17.41, 78.41]], cores: [], ...extra });

/** OLT → ODF patch → feeder → closure splice → street cable → splitter SPL with six customers. */
function network(customers = 6) {
  let data: NetworkData = {
    ...emptyNetwork(),
    equipment: [
      equipment({ id: 'OLT-1', type: 'OLT', category: 'Central Office', technology: 'GPON', totalPorts: 2 }),
      equipment({ id: 'ODF-1', type: 'ODF', category: 'Central Office' }),
      equipment({ id: 'JC-1', type: 'Fiber Joint Closure' }),
      equipment({ id: 'FAT-1', type: 'FAT', totalPorts: 8 }),
      equipment({ id: 'POLE-1', type: 'Telecom Pole', lat: 17.405, lng: 78.405 }),
      equipment({ id: 'POLE-2', type: 'Telecom Pole', lat: 17.405, lng: 78.406 }),
    ],
    cables: [line('FDR-1', 24, 'ODF-1', 'JC-1', { type: 'Main Feeder Fiber' }), line('DST-1', 12, 'JC-1', 'FAT-1')],
  };
  const step = <T>(result: CommandResult<T>) => {
    const r = ok(result);
    data = applyPatch(data, r.patch);
    return r.value;
  };
  data = { ...data, equipment: data.equipment.map((e) => (e.id === 'OLT-1' ? { ...e, ponPorts: buildOltPonPorts(e) } : e)) };
  const panel = step(addOdfPanel(data, 'ODF-1', { label: 'Panel A', portCount: 12 }, ctx));
  step(setOdfPortFeeder(data, 'ODF-1', panel.id, 3, { cableId: 'FDR-1', core: 3 }, ctx));
  step(patchOdfPort(data, 'ODF-1', panel.id, 3, { oltId: 'OLT-1', ponPortId: 'PON-01' }, ctx));
  const closure = step(createClosure(data, { equipmentId: 'JC-1', closureType: 'Dome Splice Closure', trayCount: 1 }, ctx));
  step(recordSplice(data, closure.id, { trayId: closure.trays![0].id, inputCableId: 'FDR-1', inputCore: 3, outputCableId: 'DST-1', outputCore: 3 }, ctx));
  const splitter = step(createSplitter(data, { terminalBoxId: 'FAT-1', ratio: '1:8', input: { cableId: 'DST-1', core: 3 } }, ctx));
  const ids: string[] = [];
  for (let n = 1; n <= customers; n += 1) {
    const made = step(provisionCustomer(data, { terminalBoxId: 'FAT-1', splitterId: splitter.id, splitterOutputPort: n, name: `Home ${n}`, lat: 17.411, lng: 78.411 + n / 10000 }, ctx));
    ids.push(made.customer.id);
  }
  return { data, splitter, closure, customers: ids };
}

const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

function testLos(data: NetworkData, customerIds: string[], minutes = 0) {
  const r = ok(raiseTestEvent(data, { kind: 'ont_los', elements: customerIds.map((id) => ({ type: 'customer' as const, id })) }, { ...ctx, now: at(minutes) }));
  return { data: applyPatch(data, r.patch), alarms: r.value };
}

describe('who is affected (recorded paths only)', () => {
  it('lists the customers whose recorded fibers pass through a splitter, closure, cable, core or PON port', () => {
    const { data, splitter, closure, customers } = network();
    const ix = buildImpactIndex(data);
    for (const el of [
      { type: 'splitter' as const, id: splitter.id },
      { type: 'closure' as const, id: closure.id },
      { type: 'cable' as const, id: 'DST-1' },
      { type: 'core' as const, id: 'FDR-1', fiberNumber: 3 },
      { type: 'pon_port' as const, id: 'OLT-1', ponPortId: 'PON-01' },
      { type: 'equipment' as const, id: 'FAT-1' },
    ]) {
      const impact = affectedByElement(ix, el);
      expect(impact.affected.map((a) => a.customerId).sort(), el.type).toEqual([...customers].sort());
      expect(impact.affected.every((a) => a.pathComplete)).toBe(true);
    }
    expect(affectedByElement(ix, { type: 'core', id: 'FDR-1', fiberNumber: 4 }).affected).toEqual([]);
    expect(affectedByElement(ix, { type: 'pon_port', id: 'OLT-1', ponPortId: 'PON-02' }).affected).toEqual([]);
  });

  it('lists a customer whose path is not fully recorded apart, as "may be affected", never as affected', () => {
    const { data, splitter } = network(2);
    const loose = customer({ id: 'C-LOOSE', name: 'Loose', splitterId: splitter.id, terminalBoxId: 'FAT-1', dropCableId: '', fiberCore: 0 });
    const ix = buildImpactIndex({ ...data, customers: [...data.customers, loose] });
    const impact = affectedByElement(ix, { type: 'splitter', id: splitter.id });
    expect(impact.affected.map((a) => a.customerId)).not.toContain('C-LOOSE');
    expect(impact.mayBeAffected).toEqual([expect.objectContaining({ customerId: 'C-LOOSE', reason: expect.stringContaining('names this splitter'), firstGap: expect.stringContaining('no drop cable') })]);
    // A customer near the box but with nothing on record naming it is not listed at all.
    const near = customer({ id: 'C-NEAR', name: 'Near', lat: 17.411, lng: 78.4111, dropCableId: '', splitterId: '', terminalBoxId: '' });
    const ix2 = buildImpactIndex({ ...data, customers: [...data.customers, near] });
    const again = affectedByElement(ix2, { type: 'splitter', id: splitter.id });
    expect([...again.affected, ...again.mayBeAffected].map((c) => c.customerId)).not.toContain('C-NEAR');
  });

  it('finds customers on a pole or span only through recorded attachments', () => {
    const { data, customers } = network(2);
    const ix = buildImpactIndex(data);
    const none = affectedByElement(ix, { type: 'equipment', id: 'POLE-1' });
    expect(none.affected).toEqual([]);
    expect(none.notes.join(' ')).toContain('No cable is recorded on it');
    const withAttachment = {
      ...data,
      spans: [{ id: 'SPN-1', name: 'Pole 1 to 2', fromStructureId: 'POLE-1', toStructureId: 'POLE-2', status: 'built' as const, basis: 'inspected' as const, createdAt: NOW.toISOString() }],
      attachments: [{ id: 'ATT-1', cableId: 'DST-1', spanId: 'SPN-1', status: 'built' as const, basis: 'inspected' as const, createdAt: NOW.toISOString() }],
    };
    const ix2 = buildImpactIndex(withAttachment);
    expect(affectedByElement(ix2, { type: 'span', id: 'SPN-1' }).affected.map((a) => a.customerId).sort()).toEqual([...customers].sort());
    expect(affectedByElement(ix2, { type: 'equipment', id: 'POLE-1' }).affected).toHaveLength(2);
  });
});

describe('correlation (suspected, with evidence)', () => {
  it('suspects the splitter when 5 of its 6 recorded customers report LOS, with high confidence and the evidence named', () => {
    const { data, splitter, customers } = network(6);
    const { data: withAlarms } = testLos(data, customers.slice(0, 5));
    const result = correlateAlarms(buildImpactIndex(withAlarms), withAlarms.alarms ?? []);
    const primary = result.suspicions.find((s) => s.primary)!;
    expect(primary.element).toEqual({ type: 'splitter', id: splitter.id });
    expect(primary.isTest).toBe(true);
    expect(primary.downCustomerIds).toHaveLength(5);
    expect(primary.behindCount).toBe(6);
    expect(primary.confidence).toBe('high');
    expect(primary.evidence[0]).toMatch(/^5 of 6 customers recorded on splitter .* are reported down \(1 have no alarm\)/);
    expect(primary.evidence.join(' ')).toContain('TEST events');
    expect(primary.evidence.join(' ')).toContain('not proven to be working');
    expect(result.notes.join(' ')).toContain('not proof of a physical cut');
    // Elements that carry exactly the same customers are named on it, not listed again.
    expect(primary.alsoOnPath?.join(' ')).toContain('PON port PON-01');
    expect(result.suspicions.filter((s) => s.isTest && s.element.type !== 'customer')).toHaveLength(1);
  });

  it('lowers the confidence and names the gap when an alarmed customer has a broken path', () => {
    const { data, splitter, customers } = network(6);
    // Customer 1 loses its splitter link: its path now stops at the drop fiber.
    const broken = { ...data, splitters: data.splitters.map((s) => (s.id === splitter.id ? { ...s, outputPorts: s.outputPorts.map((p) => (p.portNumber === 1 ? { ...p, connectedDropCableId: undefined, connectedCore: undefined } : p)) } : s)) };
    const { data: withAlarms } = testLos(broken, customers.slice(0, 5));
    const primary = correlateAlarms(buildImpactIndex(withAlarms), withAlarms.alarms ?? []).suspicions.find((s) => s.primary)!;
    expect(primary.element.type).toBe('splitter');
    expect(primary.downCustomerIds).toHaveLength(4);
    expect(primary.confidence).not.toBe('high');
    expect(primary.missing.join(' ')).toContain(customers[0]);
  });

  it('points at the house for one customer alone, and never mixes TEST with real alarms', () => {
    const { data, customers } = network(6);
    const real = applyPatch(data, ok(raiseAlarm(data, { kind: 'ont_los', source: 'manual', element: { type: 'customer', id: customers[0] } }, ctx)).patch);
    const { data: both } = testLos(real, [customers[1], customers[2]]);
    const result = correlateAlarms(buildImpactIndex(both), both.alarms ?? []);
    const realOnes = result.suspicions.filter((s) => !s.isTest);
    expect(realOnes[0].element).toEqual({ type: 'customer', id: customers[0] });
    expect(realOnes[0].evidence[0]).toContain('Only this customer is reported down');
    const testOnes = result.suspicions.filter((s) => s.isTest);
    expect(testOnes.every((s) => !s.downCustomerIds.includes(customers[0]))).toBe(true);
  });

  it('keeps alarms outside the window apart, and the window comes from settings', () => {
    const { data, customers } = network(6);
    let d = testLos(data, [customers[0], customers[1]], 0).data;
    d = testLos(d, [customers[2], customers[3]], 60).data;
    const narrow = correlateAlarms(buildImpactIndex(d), d.alarms ?? []);
    expect(narrow.suspicions.filter((s) => s.primary && s.element.type === 'splitter').map((s) => s.downCustomerIds.length)).toEqual([2, 2]);
    const wide = correlateAlarms(buildImpactIndex(d), d.alarms ?? [], resolveFaultSettings([{ id: 'fault.correlation.windowMinutes', value: 120 }]));
    expect(wide.suspicions.find((s) => s.primary)!.downCustomerIds).toHaveLength(4);
  });
});

describe('fault rules (browser and server)', () => {
  it('refuses a device alarm while no OLT is connected, and TEST labels that do not match', () => {
    const { data, customers } = network(1);
    const device = raiseAlarm(data, { kind: 'ont_los', source: 'device_adapter', element: { type: 'customer', id: customers[0] } }, ctx);
    expect(device).toMatchObject({ ok: false, error: { title: 'No live connection' } });
    const stored: Alarm = { id: 'A1', kind: 'ont_los', source: 'device_adapter', isTest: false, severity: 'High', state: 'active', element: { type: 'customer', id: customers[0] }, firstSeenAt: '', lastSeenAt: '', occurrences: 1 };
    const changes: ChangeSet = { upserts: { alarms: [stored, { ...stored, id: 'A2', source: 'test', isTest: false }] } };
    const codes = checkChangeSetFaults({ ...data, alarms: [] }, changes).map((p) => p.code);
    expect(codes).toContain('alarm_device_not_connected');
    expect(codes).toContain('alarm_test_label');
  });

  it('refuses a fault or job closed without a check, and a check that is not a field measurement', () => {
    const base: Fault = { id: 'F1', title: 'x', type: 'Fiber Cut', severity: 'High', status: 'Closed', affectedLocation: { lat: 0, lng: 0 }, affectedCustomerIds: [], affectedCores: [], affectedSplitterPorts: [], description: '', reportedAt: '', images: [] };
    const data = { ...emptyNetwork(), alarms: [] };
    expect(checkChangeSetFaults(data, { upserts: { faults: [base] } }).map((p) => p.code)).toContain('fault_closed_unverified');
    expect(verificationProblem({ method: 'field_reading', at: '', by: 'Ravi', readingDbm: -19, photoId: 'PH-1' })).toContain('measured in the field');
    expect(verificationProblem({ method: 'field_reading', at: '', by: 'Ravi', readingDbm: -19, readingOrigin: 'field_measured' })).toContain('photo of the meter');
    expect(verificationProblem({ method: 'office_check', at: '', by: 'Office' })).toContain('note');
    const good = { ...base, verification: { method: 'office_check' as const, at: '', by: 'Office', note: 'Customer confirmed by phone' } };
    // A check alone is not enough: the repair needs its photos, or a recorded reason why not.
    expect(checkChangeSetFaults(data, { upserts: { faults: [good] } }).map((p) => p.code)).toEqual(['fault_closed_no_photo']);
    const withReason = { ...good, history: [{ at: '', by: 'Office', action: 'NO_PHOTO', details: 'No photo possible: fixed from the office' }] };
    expect(checkChangeSetFaults(data, { upserts: { faults: [withReason] } })).toEqual([]);
    expect(checkChangeSetFaults(data, { upserts: { faults: [{ ...base, status: 'Resolved' }] } }).map((p) => p.code)).toContain('fault_resolved_without_check');
    // Problems already stored are not blamed on an unrelated change.
    expect(checkChangeSetFaults({ ...data, faults: [base] }, { upserts: { alarms: [] } })).toEqual([]);
  });

  it('flags an alarm naming something not on record and a job naming a missing fault', () => {
    const problems = findFaultProblems({
      ...emptyNetwork(),
      alarms: [{ id: 'A1', kind: 'ont_los', source: 'manual', isTest: false, severity: 'High', state: 'active', element: { type: 'customer', id: 'GHOST' }, firstSeenAt: '', lastSeenAt: '', occurrences: 1 }],
      workOrders: [{ id: 'W1', title: 't', type: 'Repair', priority: 'Low', status: 'Pending', technicianName: '', technicianPhone: '', faultId: 'NOPE', scheduledDate: '', notes: '', photos: [] }],
    }).map((p) => p.code);
    expect(problems).toEqual(expect.arrayContaining(['alarm_missing_element', 'wo_missing_fault']));
  });
});

describe('alarm, fault and job lifecycle', () => {
  it('counts a repeated alarm instead of duplicating it, then acknowledges and clears with history', () => {
    const { data, customers } = network(1);
    let d = applyPatch(data, ok(raiseAlarm(data, { kind: 'ont_los', source: 'manual', element: { type: 'customer', id: customers[0] } }, ctx)).patch);
    d = applyPatch(d, ok(raiseAlarm(d, { kind: 'ont_los', source: 'manual', element: { type: 'customer', id: customers[0] } }, { ...ctx, now: at(2) })).patch);
    expect(d.alarms).toHaveLength(1);
    expect(d.alarms![0]).toMatchObject({ occurrences: 2, state: 'active', isTest: false });
    d = applyPatch(d, ok(acknowledgeAlarms(d, [d.alarms![0].id], ctx)).patch);
    d = applyPatch(d, ok(clearAlarms(d, [d.alarms![0].id], 'Customer powered the ONT back on', ctx)).patch);
    expect(d.alarms![0].state).toBe('cleared');
    expect(d.alarms![0].history!.map((h) => h.action)).toEqual(['RAISED', 'REPORTED_AGAIN', 'ACKNOWLEDGED', 'CLEARED']);
  });

  it('example C: TEST LOS → suspected splitter → fault with affected customers → job → phone repair → field reading → closed', () => {
    const { data, splitter, customers } = network(6);
    const { data: d0, alarms } = testLos(data, customers.slice(0, 5));
    const ix = buildImpactIndex(d0);
    const suspicion = correlateAlarms(ix, d0.alarms ?? []).suspicions.find((s) => s.primary)!;
    const opened = ok(openFault(d0, { element: suspicion.element, alarmIds: suspicion.alarmIds, suspected: suspicion, index: ix }, ctx));
    let d = applyPatch(d0, opened.patch);
    const fault = opened.value;
    expect(fault).toMatchObject({ isTest: true, source: 'test', status: 'Reported', element: { type: 'splitter', id: splitter.id } });
    expect(fault.title).toMatch(/^TEST: Suspected fault at splitter/);
    expect(fault.affectedCustomerIds.sort()).toEqual([...customers].sort());
    expect(fault.suspected?.confidence).toBe('high');
    expect(d.alarms!.filter((a) => a.faultId === fault.id)).toHaveLength(alarms.length);

    // Closing now is refused: there is no check.
    expect(setFaultStatus(d, fault.id, 'Closed', {}, ctx)).toMatchObject({ ok: false, error: { title: 'Check needed' } });
    expect(resolveFault(d, fault.id, ctx)).toMatchObject({ ok: false, error: { title: 'Check needed' } });

    d = applyPatch(d, ok(setFaultStatus(d, fault.id, 'Acknowledged', {}, ctx)).patch);
    const job = ok(createJob(d, { title: 'Check box splitter', faultId: fault.id, technicianName: 'Ravi', steps: ['Open the box', 'Check the splitter input'] }, ctx));
    d = applyPatch(d, job.patch);
    expect(job.value).toMatchObject({ isTest: true, status: 'Assigned', equipmentId: 'FAT-1' });
    expect(d.faults.find((f) => f.id === fault.id)!.status).toBe('Assigned');

    const phone = (kind: Parameters<typeof applyJobEvent>[2], minutes: number) => {
      const r = ok(applyJobEvent(d, job.value.id, { ...kind, at: at(minutes).toISOString(), by: 'Ravi' } as never, ctx));
      d = applyPatch(d, r.patch);
      return r.value;
    };
    phone({ id: 'EVT-1', kind: 'start' } as never, 30);
    phone({ id: 'EVT-2', kind: 'photo', photoId: 'PH-BEFORE', photoKind: 'before' } as never, 31);
    expect(phone({ id: 'EVT-2', kind: 'photo', photoId: 'PH-BEFORE', photoKind: 'before' } as never, 31)).toEqual({ applied: false });
    phone({ id: 'EVT-3', kind: 'step', stepId: job.value.steps![0].id } as never, 32);
    phone({ id: 'EVT-4', kind: 'material', item: 'Splice sleeve', quantity: 2, unit: 'pieces' } as never, 40);
    phone({ id: 'EVT-5', kind: 'photo', photoId: 'PH-AFTER', photoKind: 'after' } as never, 50);
    phone({ id: 'EVT-6', kind: 'repair_done' } as never, 51);
    // A reading that is not field measured, or has no meter photo, is refused.
    expect(applyJobEvent(d, job.value.id, { id: 'EVT-X', kind: 'verify', at: at(52).toISOString(), by: 'Ravi', verification: { method: 'field_reading', readingDbm: -19.2 } }, ctx).ok).toBe(false);
    phone({ id: 'EVT-7', kind: 'verify', verification: { method: 'field_reading', readingDbm: -19.2, readingOrigin: 'field_measured', photoId: 'PH-METER', customerId: customers[0] } } as never, 53);
    const done = d.workOrders.find((w) => w.id === job.value.id)!;
    expect(done.status).toBe('Verified');
    expect(done.photoRefs!.map((p) => p.kind)).toEqual(['before', 'after']);
    expect(done.materials![0]).toMatchObject({ item: 'Splice sleeve', quantity: 2 });
    // The phone changed only the job; the fault waits for the office.
    expect(d.faults.find((f) => f.id === fault.id)!.status).toBe('Assigned');

    const closed = ok(setFaultStatus(d, fault.id, 'Closed', { note: 'Splitter input re-spliced' }, ctx));
    d = applyPatch(d, closed.patch);
    const final = d.faults.find((f) => f.id === fault.id)!;
    expect(final).toMatchObject({ status: 'Closed', resolution: 'Splitter input re-spliced', verification: { method: 'field_reading', readingOrigin: 'field_measured', workOrderId: job.value.id } });
    expect(d.alarms!.filter((a) => a.faultId === fault.id).every((a) => a.state === 'cleared')).toBe(true);
    expect(d.workOrders.find((w) => w.id === job.value.id)!.status).toBe('Closed');
    const timeline = faultTimeline(d, final).map((h) => `${h.source}:${h.action}`);
    expect(timeline).toEqual(expect.arrayContaining([`${fault.id}:RAISED`, `${job.value.id}:FIELD_REPAIR_DONE`, `${job.value.id}:FIELD_VERIFY`, `${fault.id}:STATUS`]));
    expect(setFaultStatus(d, fault.id, 'Acknowledged', {}, ctx).ok).toBe(false);
  });

  it('undo takes back one phone event and its status change, and keeps it in the history', () => {
    const { data } = network(1);
    let d = applyPatch(data, ok(createJob(data, { title: 'Inspect', technicianName: 'Ravi' }, ctx)).patch);
    const id = d.workOrders[0].id;
    d = applyPatch(d, ok(applyJobEvent(d, id, { id: 'E1', kind: 'start', at: at(1).toISOString(), by: 'Ravi' }, ctx)).patch);
    d = applyPatch(d, ok(applyJobEvent(d, id, { id: 'E1B', kind: 'photo', photoId: 'PH-B', photoKind: 'before', at: at(1).toISOString(), by: 'Ravi' }, ctx)).patch);
    d = applyPatch(d, ok(applyJobEvent(d, id, { id: 'E1A', kind: 'photo', photoId: 'PH-A', photoKind: 'after', at: at(2).toISOString(), by: 'Ravi' }, ctx)).patch);
    d = applyPatch(d, ok(applyJobEvent(d, id, { id: 'E2', kind: 'repair_done', at: at(2).toISOString(), by: 'Ravi' }, ctx)).patch);
    expect(d.workOrders[0].status).toBe('Completed');
    d = applyPatch(d, ok(undoJobEvent(d, id, 'E2', ctx)).patch);
    expect(d.workOrders[0].status).toBe('In Progress');
    expect(d.workOrders[0].fieldEvents!.find((e) => e.id === 'E2')!.undoneAt).toBeDefined();
    // A job is verified only with a check, by the office or the phone.
    expect(setJobStatus(d, id, 'Closed', {}, ctx)).toMatchObject({ ok: false, error: { title: 'Check needed' } });
  });

  it('an office check verifies a fault, which then closes; a mixed TEST and real fault is refused', () => {
    const { data, customers } = network(2);
    const real = ok(raiseAlarm(data, { kind: 'ont_los', source: 'manual', element: { type: 'customer', id: customers[0] } }, ctx));
    let d = applyPatch(data, real.patch);
    const test = ok(raiseTestEvent(d, { kind: 'ont_los', elements: [{ type: 'customer', id: customers[1] }] }, ctx));
    d = applyPatch(d, test.patch);
    expect(openFault(d, { element: { type: 'customer', id: customers[0] }, alarmIds: [real.value.id, test.value[0].id] }, ctx)).toMatchObject({ ok: false });
    const f = ok(openFault(d, { element: { type: 'customer', id: customers[0] }, alarmIds: [real.value.id] }, ctx));
    d = applyPatch(d, f.patch);
    expect(f.value.isTest).toBe(false);
    expect(recordFaultVerification(d, f.value.id, { method: 'office_check' }, ctx).ok).toBe(false);
    // No job and no photos: the office records why no photo was possible first.
    expect(recordFaultVerification(d, f.value.id, { method: 'office_check', note: 'Customer says it works' }, ctx)).toMatchObject({ ok: false, error: { title: 'Photos needed' } });
    d = applyPatch(d, ok(recordNoPhotoReason(d, { faultId: f.value.id }, 'ONT restarted by phone call, nobody went', ctx)).patch);
    d = applyPatch(d, ok(recordFaultVerification(d, f.value.id, { method: 'office_check', note: 'Customer says it works' }, ctx)).patch);
    expect(d.faults[0].status).toBe('Verified');
    d = applyPatch(d, ok(setFaultStatus(d, f.value.id, 'Closed', {}, ctx)).patch);
    expect(d.faults[0].status).toBe('Closed');
  });

  it('repair done needs a photo before and after, or a recorded reason; the server runs the same rule', () => {
    const { data } = network(1);
    let d = applyPatch(data, ok(createJob(data, { title: 'Inspect', technicianName: 'Ravi' }, ctx)).patch);
    const id = d.workOrders[0].id;
    const ev = (e: Record<string, unknown>, minutes: number) => applyJobEvent(d, id, { ...e, at: at(minutes).toISOString(), by: 'Ravi' } as never, ctx);
    d = applyPatch(d, ok(ev({ id: 'E1', kind: 'start' }, 1)).patch);
    expect(ev({ id: 'E2', kind: 'repair_done' }, 2)).toMatchObject({ ok: false, error: { title: 'Photos needed' } });
    d = applyPatch(d, ok(ev({ id: 'E3', kind: 'photo', photoId: 'PH-B', photoKind: 'before' }, 3)).patch);
    expect(ev({ id: 'E4', kind: 'repair_done' }, 4).ok).toBe(false);
    expect(setJobStatus(d, id, 'Completed', {}, ctx)).toMatchObject({ ok: false, error: { title: 'Photos needed' } });
    // The phone's reason path: a note that starts "No photo possible: ".
    d = applyPatch(d, ok(ev({ id: 'E5', kind: 'note', text: noPhotoReasonText('Inside the customer flat, not allowed') }, 5)).patch);
    expect(jobPhotoProblem(d.workOrders[0])).toBeNull();
    d = applyPatch(d, ok(ev({ id: 'E6', kind: 'repair_done' }, 6)).patch);
    expect(d.workOrders[0].status).toBe('Completed');

    // Server: a job written as Completed with no photos and no reason is refused.
    const bare = { ...d.workOrders[0], id: 'WO-BARE', fieldNotes: [], photoRefs: [] };
    expect(checkChangeSetFaults(d, { upserts: { workOrders: [bare] } }).map((p) => p.code)).toContain('wo_done_no_photo');
    // An older job already done without photos still saves an unrelated change...
    const old = { ...d, workOrders: [bare, ...d.workOrders] };
    expect(checkChangeSetFaults(old, { upserts: { workOrders: [{ ...bare, notes: 'called the customer' }] } })).toEqual([]);
    // ...but moving it on to verified is a new step and needs the photos or a reason.
    const verified = { ...bare, status: 'Verified' as const, verification: { method: 'office_check' as const, at: '', by: 'Office', note: 'Customer confirmed' } };
    expect(checkChangeSetFaults(old, { upserts: { workOrders: [verified] } }).map((p) => p.code)).toContain('wo_done_no_photo');
    const office = ok(recordNoPhotoReason(old, { workOrderId: 'WO-BARE' }, 'Phone camera broken', ctx));
    expect(office.patch.workOrders!.find((w) => w.id === 'WO-BARE')!.fieldNotes!.at(-1)!.text).toBe('No photo possible: Phone camera broken');
    expect(recordNoPhotoReason(old, { workOrderId: 'WO-BARE' }, '  ', ctx).ok).toBe(false);
  });

  it('settings keep medium at or below high and ignore impossible values', () => {
    const s = resolveFaultSettings([
      { id: 'fault.correlation.highSharePercent', value: 40 },
      { id: 'fault.correlation.minAlarms', value: 1 },
    ]);
    expect(s.highShare).toBe(0.4);
    expect(s.mediumShare).toBe(0.4);
    expect(s.minAlarmsForGroup).toBe(2);
  });
});
