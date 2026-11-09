import { describe, expect, it } from 'vitest';

import type { NetworkData } from '../src/domain/command';
import { findFaultProblems } from '../src/domain/faultRules';
import { raiseMonitoringAlarms } from '../src/domain/monitoringAlarms';
import { mappingProblem, parseDelimited, rowsFromTable } from '../src/domain/monitoringCsv';
import { contentId, matchOnt, planIngest } from '../src/domain/monitoringIngest';
import { checkChangeSetMonitoring, findMonitoringProblems } from '../src/domain/monitoringRules';
import { resolveMonitoringSettings } from '../src/domain/monitoringSettings';
import { liveSources, showReading, showStatus, withDeviceRx } from '../src/domain/monitoringStatus';
import { summarizeMonitoring } from '../src/domain/monitoringSummary';
import { reconcileCustomerRx } from '../src/domain/reconciliation';
import type { MonitoringSource, OnuStatus } from '../src/model/monitoringSchemas';
import type { Ont } from '../src/model/types';
import { customer, emptyNetwork } from './fixtures';

const T0 = new Date('2026-11-09T10:00:00.000Z');
const min = (m: number) => new Date(T0.getTime() + m * 60_000).toISOString();
const ont = (id: string, extra: Partial<Ont> = {}): Ont => ({ id, arrangement: 'single', status: 'installed', statusSource: 'person', createdAt: min(-10_000), ...extra });
const real: MonitoringSource = { id: 'MON-REAL', name: 'NMS push', kind: 'push', isTest: false, enabled: true, createdAt: min(-100) };
const test: MonitoringSource = { id: 'MON-TEST', name: 'TEST simulator', kind: 'test_simulator', isTest: true, enabled: true, createdAt: min(-100) };
const onts = [ont('ONT-1', { onuAddress: 'gpon-onu_1/2/3:5', serialNumber: 'ZTEG00000001' }), ont('ONT-2', { onuAddress: '0/5/0 ont 1' }), ont('ONT-3', { onuAddress: '0/5/0 ont 1' })];
const ctx = (source = real, existing: string[] = []) => ({ source, onts, existingIds: new Set(existing), now: T0 });

describe('matching rows to ONTs (exactly as written)', () => {
  it('matches the address or serial exactly, and never guesses', () => {
    expect(matchOnt(onts, 'gpon-onu_1/2/3:5').ont?.id).toBe('ONT-1');
    expect(matchOnt(onts, undefined, 'ZTEG00000001')).toMatchObject({ by: 'serial' });
    expect(matchOnt(onts, 'GPON-ONU_1/2/3:5').ont).toBeUndefined();
    expect(matchOnt(onts, 'gpon-onu_1/2/3:05').reason).toMatch(/No ONT record/);
    expect(matchOnt(onts, '0/5/0 ont 1').reason).toMatch(/on 2 ONTs/);
    expect(matchOnt([...onts, ont('ONT-9', { serialNumber: 'X9' })], 'gpon-onu_1/2/3:5', 'X9').reason).toMatch(/two different ONTs/);
  });
});

describe('planIngest', () => {
  it('skips rows with a reason, keeps unmatched ones listed, and stores a repeat once', () => {
    const rows = [
      { onuAddress: 'gpon-onu_1/2/3:5', deviceTime: min(-1), ontRxDbm: -21.3, unit: 'dBm', state: 'online' as const },
      { serial: 'NOPE', deviceTime: min(-1), state: 'los' as const },
      { serial: 'ZTEG00000001', deviceTime: '2026-11-09 10:00', state: 'online' as const },
      { serial: 'ZTEG00000001', deviceTime: min(30), state: 'online' as const },
      { serial: 'ZTEG00000001', deviceTime: min(-1), ontRxDbm: 3, unit: 'mW' },
      { serial: 'ZTEG00000001', deviceTime: min(-1), ontRxDbm: -99, unit: 'dBm' },
      { deviceTime: min(-1), state: 'online' as const },
      { onuAddress: 'gpon-onu_1/2/3:5', deviceTime: min(-1), ontRxDbm: -21.3, unit: 'dBm', state: 'online' as const },
    ];
    const plan = planIngest(rows, ctx());
    expect(plan.readings).toHaveLength(1);
    expect(plan.statuses).toHaveLength(2);
    expect(plan.readings[0]).toMatchObject({ ontId: 'ONT-1', origin: 'device_reported', sourceId: 'MON-REAL', isTest: false, unit: 'dBm', receivedAt: T0.toISOString() });
    expect(plan.unmatched).toEqual([expect.objectContaining({ row: 2, key: 'NOPE' })]);
    expect(plan.skipped.map((s) => s.row)).toEqual([3, 4, 5, 6, 7]);
    expect(plan.skipped[0].reason).toMatch(/time zone/);
    expect(plan.skipped[1].reason).toMatch(/ahead of the server clock/);
    expect(plan.skipped[2].reason).toMatch(/not dBm/);
    expect(plan.skipped[3].reason).toMatch(/outside/);
    expect(plan.duplicates).toBe(2);
    const again = planIngest(rows.slice(0, 1), ctx(real, [...plan.readings, ...plan.statuses].map((r) => r.id)));
    expect(again).toMatchObject({ readings: [], statuses: [], duplicates: 2 });
    expect(contentId('RD', ['a', 1])).toBe(contentId('RD', ['a', 1]));
  });
});

describe('file import mapping', () => {
  it('reads CSV and TSV, maps chosen columns only, and skips unmapped status words', () => {
    const table = parseDelimited('SN\tTime\tRx dBm\tState\nZTEG00000001\t2026-11-09T09:59:00Z\t-22.1\tworking\nZTEG00000001\t2026-11-09T09:58:00Z\t-22\tweird\n');
    if ('error' in table) throw new Error(table.error);
    const mapping = { serial: 'SN', deviceTime: 'Time', ontRx: 'Rx dBm', status: 'State', defaultUnit: 'dBm' as const, statusWords: { working: 'online' as const } };
    expect(mappingProblem(mapping)).toBeNull();
    expect(mappingProblem({ deviceTime: 'Time' })).toMatch(/ONU address or the serial/);
    const { rows, skipped } = rowsFromTable(table, mapping);
    expect(rows).toEqual([{ serial: 'ZTEG00000001', deviceTime: '2026-11-09T09:59:00Z', ontRxDbm: '-22.1', unit: 'dBm', state: 'online', rawState: 'working' }]);
    expect(skipped[0]).toMatchObject({ row: 2, reason: expect.stringContaining('weird') });
    expect(parseDelimited('a,b\n1,"x, y"')).toMatchObject({ rows: [['1', 'x, y']] });
    expect(parseDelimited('only one line')).toHaveProperty('error');
  });
});

const status = (id: string, ontId: string, state: OnuStatus['state'], at: string, source = real): OnuStatus => ({ id, ontId, matchedBy: 'onu_address', origin: 'device_reported', sourceId: source.id, isTest: source.isTest, deviceTime: at, receivedAt: at, state });

describe('freshness and the live label', () => {
  it('says Live only for a real source inside the window, stale with its age, and TEST as TEST', () => {
    const data = { monitoringSources: [real, test] };
    expect(showStatus(undefined, data, undefined, T0)).toMatchObject({ label: 'No live connection', freshness: 'none' });
    expect(showStatus(status('S1', 'ONT-1', 'online', min(-2)), data, undefined, T0)).toMatchObject({ label: 'Online', freshness: 'live', note: expect.stringMatching(/^Live · 2 min ago · NMS push/) });
    const stale = showStatus(status('S1', 'ONT-1', 'online', min(-20)), data, undefined, T0);
    expect(stale).toMatchObject({ freshness: 'stale', stale: true, label: 'Online (stale, last known)' });
    const settings = resolveMonitoringSettings([{ id: 'monitoring.statusStaleMinutes', value: 30 }]);
    expect(showStatus(status('S1', 'ONT-1', 'online', min(-20)), data, settings, T0).stale).toBe(false);
    expect(showStatus(status('S2', 'ONT-1', 'los', min(-1), test), data, undefined, T0)).toMatchObject({ freshness: 'test', label: 'TEST: LOS (no light)' });
    expect(liveSources({ ...data, onuStatuses: [status('S2', 'ONT-1', 'online', min(-1), test)] }, undefined, T0).live).toBe(false);
    expect(liveSources({ ...data, onuStatuses: [status('S1', 'ONT-1', 'online', min(-1))] }, undefined, T0).live).toBe(true);
  });
});

describe('dashboard summary', () => {
  it('counts from the newest real status, stale as stale, TEST apart', () => {
    const customers = [customer({ id: 'C1', ontId: 'ONT-1' }), customer({ id: 'C2', ontId: 'ONT-2' }), customer({ id: 'C3', ontId: 'ONT-3' }), customer({ id: 'C4' })];
    const data = {
      customers,
      onts,
      equipment: [],
      monitoringSources: [real, test],
      onuStatuses: [status('S1', 'ONT-1', 'offline', min(-5)), status('S2', 'ONT-1', 'online', min(-1)), status('S3', 'ONT-2', 'los', min(-90)), status('S4', 'ONT-3', 'los', min(-1), test)],
      onuReadings: [{ id: 'R1', ontId: 'ONT-1', matchedBy: 'onu_address' as const, origin: 'device_reported' as const, sourceId: real.id, isTest: false, deviceTime: min(-1), receivedAt: min(-1), direction: 'ont_rx' as const, valueDbm: -29.5, unit: 'dBm' as const }],
    };
    const s = summarizeMonitoring(data, undefined, undefined, T0);
    expect(s.live).toBe(true);
    expect(s.counts).toMatchObject({ online: 1, stale: 1, no_data: 1, no_ont_record: 1, los: 0 });
    expect(s.testRows).toBe(1);
    expect(s.worstRx[0]).toMatchObject({ ontId: 'ONT-1', customerIds: ['C1'] });
    expect(showReading(data.onuReadings[0], data, undefined, undefined, T0).text).toBe('-29.5 dBm (Measured)');
    const none = summarizeMonitoring({ customers, onts, equipment: [] }, undefined, undefined, T0);
    expect(none).toMatchObject({ live: false, realSources: 0 });
  });

  it('feeds a real device reading into the predicted-against-measured check, never a TEST one', () => {
    const c = customer({ id: 'C1', ontId: 'ONT-1' });
    const reading = (isTest: boolean) => ({ id: 'R', ontId: 'ONT-1', matchedBy: 'serial' as const, origin: 'device_reported' as const, sourceId: isTest ? test.id : real.id, isTest, deviceTime: min(-1), receivedAt: min(-1), direction: 'ont_rx' as const, valueDbm: -21, unit: 'dBm' as const });
    expect(withDeviceRx(c, { onuReadings: [reading(true)] })).toBe(c);
    const measured = withDeviceRx(c, { onuReadings: [reading(false)] });
    expect(measured).toMatchObject({ rxSource: 'device_reported', rxOpticalPowerDbm: -21, rxMeasuredAt: min(-1) });
    expect(reconcileCustomerRx(measured, { ...emptyNetwork(), customers: [measured] }).status).not.toBe('not_measured');
  });
});

describe('alarms from monitoring', () => {
  const base = (): NetworkData => ({ ...emptyNetwork(), customers: [customer({ id: 'C1', ontId: 'ONT-1' })], onts });
  it('raises a device alarm for a new LOS, counts a repeat, and raises nothing for old rows or dying gasp', () => {
    const fresh = { statuses: [status('S1', 'ONT-1', 'los', min(-1))], readings: [] };
    const first = raiseMonitoringAlarms(base(), fresh, real, { now: T0 });
    expect(first.raised).toHaveLength(1);
    expect(first.raised[0]).toMatchObject({ source: 'device_adapter', isTest: false, kind: 'ont_los', element: { type: 'customer', id: 'C1' }, monitoringSourceId: 'MON-REAL', evidenceIds: ['S1'] });
    const data = { ...base(), alarms: first.alarms, monitoringSources: [real] };
    expect(findFaultProblems({ ...data, faults: [], workOrders: [], spans: [], attachments: [], services: [] } as never).map((p) => p.code)).not.toContain('alarm_device_not_connected');
    const second = raiseMonitoringAlarms({ ...data, onuStatuses: fresh.statuses }, { statuses: [status('S2', 'ONT-1', 'los', min(0))], readings: [] }, real, { now: T0 });
    expect(second.alarms).toHaveLength(1);
    expect(second.alarms[0].occurrences).toBe(2);
    expect(raiseMonitoringAlarms(base(), { statuses: [status('S9', 'ONT-1', 'los', min(-600))], readings: [] }, real, { now: T0 }).raised).toEqual([]);
    expect(raiseMonitoringAlarms(base(), { statuses: [status('S9', 'ONT-1', 'dying_gasp', min(-1))], readings: [] }, real, { now: T0 }).raised).toEqual([]);
    const fromTest = raiseMonitoringAlarms(base(), { statuses: [status('S5', 'ONT-1', 'offline', min(-1), test)], readings: [] }, test, { now: T0 });
    expect(fromTest.raised[0]).toMatchObject({ source: 'test', isTest: true, note: expect.stringContaining('TEST') });
  });
});

describe('monitoring rules', () => {
  it('flags unknown ONTs and TEST rows outside the TEST path, and refuses ordinary writes', () => {
    const rows = [status('S1', 'ONT-GONE', 'online', min(-1)), { ...status('S2', 'ONT-1', 'online', min(-1)), isTest: true }];
    const codes = findMonitoringProblems({ monitoringSources: [real], onuStatuses: rows, onts }).map((p) => p.code);
    expect(codes).toEqual(['monitoring_unknown_ont', 'monitoring_test_outside_test_path']);
    expect(checkChangeSetMonitoring({ upserts: { onuStatuses: [rows[0]] } }, () => undefined)[0].code).toBe('monitoring_write_path');
    const alarm = raiseMonitoringAlarms({ ...emptyNetwork(), customers: [customer({ id: 'C1', ontId: 'ONT-1' })], onts }, { statuses: [status('S1', 'ONT-1', 'los', min(-1))], readings: [] }, real, { now: T0 }).raised[0];
    expect(checkChangeSetMonitoring({ upserts: { alarms: [alarm] } }, () => undefined)).toHaveLength(1);
    expect(checkChangeSetMonitoring({ upserts: { alarms: [{ ...alarm, state: 'acknowledged' }] } }, () => alarm)).toHaveLength(0);
  });
});
