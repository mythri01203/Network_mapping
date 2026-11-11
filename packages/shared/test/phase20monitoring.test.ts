import { describe, expect, it } from 'vitest';

import { applyPatch, type CommandResult, type NetworkData } from '../src/domain/command';
import { raiseTestEvent } from '../src/domain/faultCommands';
import { correlateAlarms, NO_ALARM_IS_NOT_UP } from '../src/domain/faultCorrelation';
import { affectedByElement, buildImpactIndex, elementLabel } from '../src/domain/faultImpact';
import { addOdfPanel, createClosure, patchOdfPort, recordSplice, setOdfPortFeeder } from '../src/domain/fiberCommands';
import { raiseDeviceAlarms } from '../src/domain/monitoringAlarms';
import { deviceStatusBoard, matchOltRecord, planDeviceIngest } from '../src/domain/monitoringDevice';
import { ingestBodySchema } from '../src/domain/monitoringIngest';
import { findMonitoringProblems } from '../src/domain/monitoringRules';
import { buildOltPonPorts } from '../src/domain/oltConfig';
import { createSplitter, provisionCustomer } from '../src/domain/provisioning';
import { buildReports, liveMonitoringReport, NO_LIVE_CONNECTION } from '../src/domain/reports';
import type { DeviceIngestRow, DeviceStatus, MonitoringSource, OnuReading, OnuStatus } from '../src/model/monitoringSchemas';
import type { Cable, Equipment, Ont } from '../src/model/types';
import { createSampleNetwork } from '../src/sample';
import { cable, customer, emptyNetwork, equipment, NOW } from './fixtures';

/**
 * Network mapping Phase 20: OLT, card and PON port status from device rows; fault impact down to
 * ports and fibres; the live report wording.
 */

const T0 = new Date('2026-11-09T10:00:00.000Z');
const min = (m: number) => new Date(T0.getTime() + m * 60_000).toISOString();
const real: MonitoringSource = { id: 'MON-REAL', name: 'NMS push', kind: 'push', isTest: false, enabled: true, createdAt: min(-1000) };
const test: MonitoringSource = { id: 'MON-TEST', name: 'TEST simulator', kind: 'test_simulator', isTest: true, enabled: true, createdAt: min(-1000) };

const olt = (id: string, extra: Partial<Equipment> = {}): Equipment => {
  const base = equipment({ id, type: 'OLT', category: 'Central Office', technology: 'GPON', totalPorts: 4, ...extra });
  return { ...base, ponPorts: buildOltPonPorts(base).map((p) => ({ ...p, vendorAddress: `gpon 0/1/${p.portNumber - 1}` })) };
};
const withChassis = (e: Equipment): Equipment => ({
  ...e,
  chassis: {
    shelves: [
      { id: 'SH-0', label: '0', slots: [{ id: 'SL-1', label: '1', card: { model: 'GPHF', kind: 'pon', ponPortIds: ['PON-01', 'PON-02'] } }, { id: 'SL-2', label: '2', card: { model: 'GPHF', kind: 'pon', ponPortIds: ['PON-03', 'PON-04'] } }] },
    ],
  },
});
const ont = (id: string, ponPortId: string, extra: Partial<Ont> = {}): Ont => ({ id, arrangement: 'single', status: 'installed', statusSource: 'person', createdAt: min(-10_000), oltId: 'OLT-A', ponPortId, ...extra });
const onuStatus = (id: string, ontId: string, state: OnuStatus['state'], at: string, source = real): OnuStatus => ({ id, ontId, matchedBy: 'onu_address', origin: 'device_reported', sourceId: source.id, isTest: source.isTest, deviceTime: at, receivedAt: at, state });
const reading = (id: string, ontId: string, at: string): OnuReading => ({ id, ontId, matchedBy: 'serial', origin: 'device_reported', sourceId: real.id, isTest: false, deviceTime: at, receivedAt: at, direction: 'ont_rx', valueDbm: -21, unit: 'dBm' });

const planCtx = (equipmentList: Equipment[], existing: string[] = []) => ({ source: real, equipment: equipmentList, existingIds: new Set(existing), now: T0 });

describe('device rows: matched exactly as written, or listed with the reason', () => {
  const a = withChassis(olt('OLT-A', { serialNumber: 'HW-1', ipAddress: '10.0.0.1' }));
  const b = olt('OLT-B', { serialNumber: 'HW-2', ipAddress: '10.0.0.2' });

  it('matches the OLT by id, serial or IP, and refuses identifiers that disagree', () => {
    expect(matchOltRecord([a, b], { oltId: 'OLT-A' })).toMatchObject({ by: 'olt_id', olt: { id: 'OLT-A' } });
    expect(matchOltRecord([a, b], { oltSerial: 'HW-2' })).toMatchObject({ by: 'olt_serial', olt: { id: 'OLT-B' } });
    expect(matchOltRecord([a, b], { oltIp: '10.0.0.1' })).toMatchObject({ by: 'olt_ip', olt: { id: 'OLT-A' } });
    expect(matchOltRecord([a, b], { oltSerial: 'hw-1' }).reason).toMatch(/No OLT record has serial "hw-1"/);
    expect(matchOltRecord([a, b], { oltSerial: 'HW-1', oltIp: '10.0.0.2' }).reason).toMatch(/different OLT records/);
    expect(matchOltRecord([a, { ...b, serialNumber: 'HW-1' }], { oltSerial: 'HW-1' }).reason).toMatch(/on 2 OLT records/);
  });

  it('plans OLT, card, PON port and interface rows; skips impossible ones; stores a repeat once', () => {
    const rows: DeviceIngestRow[] = [
      { target: 'pon_port', oltSerial: 'HW-1', portAddress: 'gpon 0/1/0', deviceTime: min(-1), state: 'up', onuOnline: 30, onuTotal: 32, losCount: 2 },
      { target: 'pon_port', oltSerial: 'HW-1', portAddress: 'gpon 0/1/9', deviceTime: min(-1), state: 'down' },
      { target: 'card', oltId: 'OLT-A', shelf: '0', slot: '2', deviceTime: min(-1), state: 'degraded', rawState: 'partial' },
      { target: 'card', oltId: 'OLT-B', slot: '1', deviceTime: min(-1), state: 'up' },
      { target: 'olt', oltIp: '10.0.0.1', deviceTime: min(-1), state: 'up' },
      { target: 'interface', oltId: 'OLT-A', interfaceName: 'xgei-0/3/1', deviceTime: min(-1), state: 'up' },
      { target: 'olt', oltId: 'OLT-A', deviceTime: '2026-11-09 10:00', state: 'up' },
      { target: 'olt', oltId: 'OLT-A', deviceTime: min(30), state: 'up' },
      { target: 'pon_port', oltId: 'OLT-A', deviceTime: min(-1), state: 'up' },
      { target: 'pon_port', oltId: 'OLT-A', portAddress: 'PON-02', deviceTime: min(-1), state: 'up', onuOnline: 40, onuTotal: 32 },
      { target: 'olt', deviceTime: min(-1), state: 'up' },
      { target: 'pon_port', oltSerial: 'HW-1', portAddress: 'gpon 0/1/0', deviceTime: min(-1), state: 'up', onuOnline: 30, onuTotal: 32, losCount: 2 },
    ];
    const plan = planDeviceIngest(rows, planCtx([a, b]));
    expect(plan.statuses).toHaveLength(6);
    expect(plan.statuses[0]).toMatchObject({ target: 'pon_port', oltId: 'OLT-A', ponPortId: 'PON-01', matchedBy: 'olt_serial', portAddress: 'gpon 0/1/0', origin: 'device_reported', isTest: false, receivedAt: T0.toISOString(), onuOnline: 30, losCount: 2 });
    expect(plan.statuses[2]).toMatchObject({ target: 'card', slotId: 'SL-2', rawState: 'partial' });
    expect(plan.matched).toBe(4);
    expect(plan.unmatched.map((u) => u.reason)).toEqual([expect.stringContaining('"gpon 0/1/9" is not the address or id'), expect.stringContaining('no chassis recorded')]);
    // Unmatched rows keep the OLT they did match, but no port or slot.
    expect(plan.statuses[1]).toMatchObject({ oltId: 'OLT-A', unmatchedReason: expect.any(String) });
    expect(plan.statuses[1].ponPortId).toBeUndefined();
    expect(plan.skipped.map((s) => s.row)).toEqual([7, 8, 9, 10, 11]);
    expect(plan.skipped.map((s) => s.reason)).toEqual([
      expect.stringContaining('time zone'),
      expect.stringContaining('ahead of the server clock'),
      expect.stringContaining('needs "portAddress"'),
      expect.stringContaining('impossible'),
      'No OLT id, serial or IP',
    ]);
    expect(plan.duplicates).toBe(1);
    expect(planDeviceIngest(rows.slice(0, 1), planCtx([a, b], plan.statuses.map((s) => s.id)))).toMatchObject({ statuses: [], duplicates: 1 });
  });

  it('accepts devices in a push body, and still refuses an empty push', () => {
    expect(ingestBodySchema.safeParse({ devices: [{ target: 'olt', oltId: 'OLT-A', deviceTime: min(-1), state: 'up' }] }).success).toBe(true);
    expect(ingestBodySchema.safeParse({ rows: [] }).success).toBe(false);
    expect(ingestBodySchema.safeParse({}).success).toBe(false);
    expect(ingestBodySchema.safeParse({ devices: [{ target: 'olt', oltId: 'OLT-A', deviceTime: min(-1), state: 'online' }] }).success).toBe(false);
  });

  it('checks stored device rows: no source is an error, an OLT gone since is a warning', () => {
    const plan = planDeviceIngest([{ target: 'olt', oltId: 'OLT-A', deviceTime: min(-1), state: 'up' }], planCtx([a]));
    const problems = findMonitoringProblems({ monitoringSources: [], deviceStatuses: plan.statuses, equipment: [] });
    expect(problems.map((p) => [p.severity, p.code])).toEqual([
      ['error', 'monitoring_row_no_source'],
      ['warning', 'monitoring_unknown_olt'],
    ]);
  });
});

describe('the board: OLT, card and PON port status from stored rows', () => {
  const a = withChassis(olt('OLT-A'));
  const onts = [ont('ONT-1', 'PON-01'), ont('ONT-2', 'PON-01'), ont('ONT-3', 'PON-02'), ont('ONT-4', 'PON-03')];
  const customers = [
    customer({ id: 'C-1', name: 'Asha', ontId: 'ONT-1', oltId: 'OLT-A', ponPort: 'PON-01' }),
    customer({ id: 'C-2', name: 'Ravi', ontId: 'ONT-2', oltId: 'OLT-A', ponPort: 'PON-01' }),
    customer({ id: 'C-5', name: 'No ONT', oltId: 'OLT-A', ponPort: 'PON-01' }),
  ];
  const base = { equipment: [a], customers, onts, monitoringSources: [real, test] };

  it('says "No live connection" everywhere when nothing was sent, and counts no one as online', () => {
    const board = deviceStatusBoard(base, { now: T0 });
    expect(board.live).toBe(false);
    expect(board.olts[0]).toMatchObject({ freshness: 'none', note: NO_LIVE_CONNECTION });
    for (const p of board.olts[0].ports) {
      expect(p.freshness).toBe('none');
      expect(p.note).toBe(NO_LIVE_CONNECTION);
      expect(p.counts.online).toBe(0);
      expect(p.device).toBeUndefined();
    }
    expect(board.olts[0].ports[0].counts).toMatchObject({ no_data: 2, no_ont_record: 1 });
  });

  it('a light reading alone is not online and does not make a port live', () => {
    const board = deviceStatusBoard({ ...base, onuReadings: [reading('RD-1', 'ONT-1', min(-1))] }, { now: T0 });
    expect(board.olts[0].ports[0]).toMatchObject({ freshness: 'none', counts: expect.objectContaining({ online: 0, no_data: 2 }) });
  });

  it('aggregates ONU statuses per port, card and OLT; stale is stale; TEST is kept apart', () => {
    const rows = [
      onuStatus('S-1', 'ONT-1', 'online', min(-2)),
      onuStatus('S-2', 'ONT-2', 'los', min(-3)),
      onuStatus('S-3', 'ONT-3', 'offline', min(-120)),
      onuStatus('S-4', 'ONT-4', 'online', min(-1), test),
    ];
    const board = deviceStatusBoard({ ...base, onuStatuses: rows }, { now: T0 });
    const [p1, p2, p3, p4] = board.olts[0].ports;
    expect(p1).toMatchObject({ onts: 3, freshness: 'live', counts: expect.objectContaining({ online: 1, los: 1, no_ont_record: 1 }), impacted: 1, impactedCustomerIds: ['C-2'], customers: 3 });
    expect(p1.note).toMatch(/^Live · 2 min ago · NMS push$/);
    expect(p2).toMatchObject({ freshness: 'stale', counts: expect.objectContaining({ stale: 1, offline: 0 }), impacted: 0 });
    expect(p2.note).toMatch(/^Stale · 2 h ago · NMS push$/);
    // TEST only: never live, never counted.
    expect(p3).toMatchObject({ freshness: 'none', counts: expect.objectContaining({ online: 0, no_data: 1 }) });
    expect(p4.onts).toBe(0);
    const [card1, card2] = board.olts[0].cards;
    expect(card1).toMatchObject({ label: 'Shelf 0 · Slot 1', ponPortIds: ['PON-01', 'PON-02'], onts: 4, freshness: 'live' });
    expect(card1.counts).toMatchObject({ online: 1, los: 1, stale: 1, no_ont_record: 1 });
    expect(card2).toMatchObject({ freshness: 'none', note: NO_LIVE_CONNECTION });
    expect(board.olts[0]).toMatchObject({ onts: 5, impacted: 1, freshness: 'live' });
    expect(p1.cardLabel).toBe('Shelf 0 · Slot 1');
  });

  it('shows what the device said about a port, card and OLT, with its age; never made up from ONUs', () => {
    const plan = planDeviceIngest(
      [
        { target: 'pon_port', oltId: 'OLT-A', portAddress: 'gpon 0/1/2', deviceTime: min(-90), state: 'down', losCount: 5, onuTotal: 8 },
        { target: 'card', oltId: 'OLT-A', slot: '2', deviceTime: min(-1), state: 'up' },
        { target: 'olt', oltId: 'OLT-A', deviceTime: min(-1), state: 'up' },
        { target: 'interface', oltId: 'OLT-A', interfaceName: 'uplink 1', deviceTime: min(-1), state: 'degraded' },
      ],
      planCtx([a]),
    );
    const board = deviceStatusBoard({ ...base, deviceStatuses: plan.statuses }, { now: T0 });
    const o = board.olts[0];
    expect(o.device).toMatchObject({ label: 'Up', shown: expect.objectContaining({ freshness: 'live' }) });
    const p3 = o.ports.find((p) => p.ponPortId === 'PON-03')!;
    expect(p3.device).toMatchObject({ label: 'Down (stale, last known)', countsText: 'Device says 8 ONUs · 5 LOS' });
    expect(p3.freshness).toBe('stale');
    // The other ports have no device row: no port status is shown for them.
    expect(o.ports.find((p) => p.ponPortId === 'PON-01')!.device).toBeUndefined();
    expect(o.cards[1].device?.label).toBe('Up');
    expect(o.interfaces).toEqual([expect.objectContaining({ name: 'uplink 1', device: expect.objectContaining({ label: 'Degraded' }) })]);
  });

  it('counts open alarms per port and the customers they hit; TEST alarms apart', () => {
    const data = { ...base, alarms: [] } as const;
    const nd: NetworkData = { ...emptyNetwork(), equipment: [a], customers, onts };
    const made = raiseTestEvent(nd, { kind: 'ont_los', elements: [{ type: 'customer', id: 'C-1' }] }, { now: T0 });
    if (!made.ok) throw new Error(made.error.message);
    const board = deviceStatusBoard({ ...data, alarms: made.patch.alarms }, { now: T0 });
    expect(board.olts[0].ports[0]).toMatchObject({ openAlarms: 0, testAlarms: 1, impacted: 0 });
  });
});

describe('device alarms: only a fresh real "down" on a recorded port or OLT', () => {
  it('raises a PON port fault from a fresh down row, nothing from a stale or degraded one', () => {
    const a = olt('OLT-A');
    const data: NetworkData = { ...emptyNetwork(), equipment: [a], monitoringSources: [real] };
    const plan = planDeviceIngest(
      [
        { target: 'pon_port', oltId: 'OLT-A', portAddress: 'gpon 0/1/0', deviceTime: min(-1), state: 'down', rawState: 'LOS' },
        { target: 'pon_port', oltId: 'OLT-A', portAddress: 'gpon 0/1/1', deviceTime: min(-600), state: 'down' },
        { target: 'pon_port', oltId: 'OLT-A', portAddress: 'gpon 0/1/2', deviceTime: min(-1), state: 'degraded' },
        { target: 'olt', oltId: 'OLT-A', deviceTime: min(-1), state: 'down' },
      ],
      planCtx([a]),
    );
    const result = raiseDeviceAlarms(data, plan.statuses, real, { now: T0 }, { now: T0 });
    expect(result.raised.map((r) => [r.kind, r.element.ponPortId ?? r.element.type, r.source])).toEqual([
      ['pon_port_fault', 'PON-01', 'device_adapter'],
      ['olt_unreachable', 'olt', 'device_adapter'],
    ]);
    expect(result.raised[0]).toMatchObject({ monitoringSourceId: real.id, evidenceIds: [plan.statuses[0].id] });
    // The same row again is not new: it raises nothing more.
    expect(raiseDeviceAlarms({ ...data, alarms: result.alarms, deviceStatuses: plan.statuses }, [], real, { now: T0 }).raised).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Fault impact: equipment, ports and fibres below the element          */
/* ------------------------------------------------------------------ */

const ctx = { now: NOW, actor: 'Office Tester' };
function ok<T>(result: CommandResult<T>): { value: T; patch: NetworkData } {
  if (!result.ok) throw new Error(`${result.error.title}: ${result.error.message}`);
  return { value: result.value, patch: result.patch as NetworkData };
}
const line = (id: string, fiberCount: number, from: string, to: string, extra: Partial<Cable> = {}) =>
  cable({ id, name: id, fiberCount, lengthMeters: 500, startEquipmentId: from, endEquipmentId: to, coordinates: [[17.4, 78.4], [17.41, 78.41]], cores: [], ...extra });

/** OLT → ODF patch → feeder → closure splice → street cable → splitter with customers. */
function network(customers = 3) {
  let data: NetworkData = {
    ...emptyNetwork(),
    equipment: [
      equipment({ id: 'OLT-1', type: 'OLT', category: 'Central Office', technology: 'GPON', totalPorts: 2 }),
      equipment({ id: 'ODF-1', type: 'ODF', category: 'Central Office' }),
      equipment({ id: 'JC-1', type: 'Fiber Joint Closure' }),
      equipment({ id: 'FAT-1', type: 'FAT', totalPorts: 8 }),
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
  return { data, splitter, closure, customers: ids, panelId: panel.id };
}

describe('fault impact lists equipment, ports and fibres below the element (recorded links only)', () => {
  it('a PON port: the ODF port, the feeder and street fibres, the closure, the splitter and its used outputs', () => {
    const { data, splitter, closure, customers } = network(3);
    const ix = buildImpactIndex(data);
    const impact = affectedByElement(ix, { type: 'pon_port', id: 'OLT-1', ponPortId: 'PON-01' }, { downstream: true });
    expect(impact.affected.map((a) => a.customerId).sort()).toEqual([...customers].sort());
    const down = impact.downstream!;
    expect(down.ports.filter((p) => p.kind === 'odf_port')).toEqual([expect.objectContaining({ recordId: 'ODF-1', label: expect.stringContaining('port 3') })]);
    expect(down.ports.filter((p) => p.kind === 'splitter_output').map((p) => p.port).sort()).toEqual(['1', '2', '3']);
    expect(down.ports.some((p) => p.kind === 'pon_port')).toBe(false);
    const coreKeys = down.cores.map((c) => `${c.cableId}#${c.core}`);
    expect(coreKeys).toEqual(expect.arrayContaining(['FDR-1#3', 'DST-1#3']));
    expect(coreKeys).not.toContain('FDR-1#4');
    const items = down.equipment.map((e) => `${e.ref.type}:${e.ref.id}`);
    expect(items).toEqual(expect.arrayContaining(['equipment:ODF-1', `closure:${closure.id}`, `splitter:${splitter.id}`, 'equipment:FAT-1']));
    expect(items).not.toContain('olt:OLT-1');
    // Without asking, nothing extra is worked out (correlation stays as fast as before).
    expect(affectedByElement(ix, { type: 'pon_port', id: 'OLT-1', ponPortId: 'PON-01' }).downstream).toBeUndefined();
  });

  it('a splitter: only its outputs and what hangs below them, never the feeder above', () => {
    const { data, splitter } = network(2);
    const down = affectedByElement(buildImpactIndex(data), { type: 'splitter', id: splitter.id }, { downstream: true }).downstream!;
    expect(down.ports.map((p) => `${p.kind}:${p.port}`).sort()).toEqual(['splitter_output:1', 'splitter_output:2']);
    expect(down.cores.map((c) => c.cableId)).not.toContain('FDR-1');
    expect(down.cores.map((c) => c.cableId)).not.toContain('DST-1');
    expect(down.equipment.map((e) => e.ref.id)).not.toContain(splitter.id);
  });

  it('an OLT lists its PON port and everything below it', () => {
    const { data } = network(1);
    const down = affectedByElement(buildImpactIndex(data), { type: 'olt', id: 'OLT-1' }, { downstream: true }).downstream!;
    expect(down.ports.filter((p) => p.kind === 'pon_port').map((p) => p.port)).toEqual(expect.arrayContaining(['PON-01']));
    expect(down.ports.some((p) => p.kind === 'odf_port')).toBe(true);
  });

  it('a closure: the fibres spliced out of it and below, not the feeder coming in', () => {
    const { data, closure } = network(1);
    const down = affectedByElement(buildImpactIndex(data), { type: 'closure', id: closure.id }, { downstream: true }).downstream!;
    const keys = down.cores.map((c) => `${c.cableId}#${c.core}`);
    expect(keys).toContain('DST-1#3');
    expect(keys).not.toContain('FDR-1#3');
  });

  it('lists fibres already marked Faulty or Retired apart, not as newly lost', () => {
    const { data } = network(1);
    const marked = {
      ...data,
      cables: data.cables.map((c) => (c.id === 'DST-1' ? { ...c, cores: [...c.cores.filter((k) => k.coreNumber !== 3), { ...(c.cores.find((k) => k.coreNumber === 3) ?? { coreNumber: 3 }), coreNumber: 3, status: 'Faulty' as const }] } : c)),
    } as NetworkData;
    const down = affectedByElement(buildImpactIndex(marked), { type: 'core', id: 'FDR-1', fiberNumber: 3 }, { downstream: true }).downstream!;
    expect(down.outOfUseCores.map((c) => `${c.cableId}#${c.core}:${c.status}`)).toEqual(['DST-1#3:Faulty']);
    expect(down.cores.map((c) => `${c.cableId}#${c.core}`)).not.toContain('DST-1#3');
    expect(down.notes.join(' ')).toMatch(/already marked faulty, retired or damaged/);
  });

  it('a cable lists every fibre in it, used or spare', () => {
    const { data } = network(1);
    const down = affectedByElement(buildImpactIndex(data), { type: 'cable', id: 'DST-1' }, { downstream: true }).downstream!;
    expect(down.cores.filter((c) => c.cableId === 'DST-1')).toHaveLength(12);
  });

  it('flags a name hidden for the role and never repeats it in messages', () => {
    const { data, splitter, customers } = network(1);
    const hidden = { ...data, customers: data.customers.map((c) => (c.id === customers[0] ? { ...c, name: 'Hidden for your role', hiddenFields: ['name' as const] } : c)) };
    const ix = buildImpactIndex(hidden);
    const impact = affectedByElement(ix, { type: 'splitter', id: splitter.id }, { downstream: true });
    expect(impact.affected[0]).toMatchObject({ customerId: customers[0], nameHidden: true });
    expect(elementLabel(hidden, { type: 'customer', id: customers[0] })).toBe(`customer ${customers[0]}`);
  });
});

describe('wording: what exists now, and no live claim without data', () => {
  it('correlation no longer says there is no OLT connection, but still says no alarm is not "up"', () => {
    const { data, customers } = network(3);
    const made = ok(raiseTestEvent(data, { kind: 'ont_los', elements: customers.map((id) => ({ type: 'customer' as const, id })) }, ctx));
    const next = applyPatch(data, made.patch);
    const result = correlateAlarms(buildImpactIndex(next), next.alarms ?? []);
    const evidence = result.suspicions.flatMap((s) => s.evidence).join(' ');
    expect(evidence).toContain(NO_ALARM_IS_NOT_UP);
    expect(evidence).not.toMatch(/No live connection to the OLT/);
  });

  it('the live report: "No live connection" with nothing sent; Stale with an old row; Live with a fresh one', () => {
    const none = liveMonitoringReport({}, T0);
    expect(none.noLiveConnection).toBe(true);
    expect(none.rows.slice(0, 4).map((r) => r.state)).toEqual([NO_LIVE_CONNECTION, NO_LIVE_CONNECTION, NO_LIVE_CONNECTION, NO_LIVE_CONNECTION]);
    expect(JSON.stringify(none.rows)).not.toMatch(/Not built/);

    const stale = liveMonitoringReport({ monitoringSources: [real], onuStatuses: [onuStatus('S-1', 'ONT-1', 'online', min(-300))] }, T0);
    expect(stale.noLiveConnection).toBe(true);
    expect(String(stale.rows[0].state)).toMatch(/^Stale: 1 ONU status row\(s\) kept from real sources, newest 5 h ago \(2026-11-09 05:00 UTC\)$/);

    const testOnly = liveMonitoringReport({ monitoringSources: [test], onuStatuses: [onuStatus('S-T', 'ONT-1', 'online', min(-1), test)] }, T0);
    expect(testOnly.rows[0].state).toBe(NO_LIVE_CONNECTION);
    expect(testOnly.noLiveConnection).toBe(true);

    const device: DeviceStatus = { ...planDeviceIngest([{ target: 'olt', oltId: 'OLT-A', deviceTime: min(-1), state: 'up' }], planCtx([olt('OLT-A')])).statuses[0] };
    const live = liveMonitoringReport({ monitoringSources: [real], deviceStatuses: [device] }, T0);
    expect(live.noLiveConnection).toBeUndefined();
    expect(String(live.rows[2].state)).toMatch(/^Live: 1 device status row\(s\)/);
    expect(live.rows[0].state).toBe(NO_LIVE_CONNECTION);
  });

  it('buildReports on the sample network has no live claim and no "Not built" line', () => {
    const live = buildReports(createSampleNetwork(), {}, '2026-11-08').find((t) => t.id === 'live')!;
    expect(live.noLiveConnection).toBe(true);
    expect(live.rows[0].state).toBe(NO_LIVE_CONNECTION);
    expect(live.rows.find((r) => String(r.report).startsWith('Cable TV'))?.state).not.toMatch(/Not built/);
  });
});
