import type { AlarmKind } from '../model/enums';
import { type DeviceStatus, type MonitoringSource, ONU_STATE_LABELS, type OnuReading, type OnuStatus } from '../model/monitoringSchemas';
import type { Alarm, NetworkElementRef } from '../model/types';
import type { AuditEntry, CommandContext, NetworkData } from './command';
import { isActiveCustomer } from './connectionRules';
import { addAlarm } from './faultCommands';
import { DEFAULT_MONITORING_SETTINGS, type MonitoringSettings } from './monitoringSettings';
import { latestReading, latestStatus, type MonitoringData } from './monitoringStatus';
import { DEFAULT_OPTICAL_SETTINGS, type OpticalSettings, rxBandFor } from './opticalSettings';

/**
 * Alarms from monitoring (Phase 7). A new LOS or offline status, or a fresh ONT receive level
 * outside the Optical settings bands, raises a Phase 8 alarm with source `device_adapter` on each
 * active customer of that ONT (or on the ONT when it has none), naming the source and the rows.
 * Grouping into a suspected cause is left to `correlateAlarms`, which words it "suspected". TEST
 * rows raise TEST alarms only. An alarm still open is counted again, never duplicated. Old rows (a
 * history import) and a power-loss (dying gasp) status raise nothing: dying gasp is not a fiber fault.
 */

export interface MonitoringAlarmResult {
  alarms: Alarm[];
  raised: Alarm[];
  audit: AuditEntry[];
}

type Trigger = { ontId: string; kind: AlarmKind; row: OnuStatus | OnuReading; note: string };

export function raiseMonitoringAlarms(
  data: NetworkData & MonitoringData,
  fresh: { statuses: readonly OnuStatus[]; readings: readonly OnuReading[] },
  source: Pick<MonitoringSource, 'id' | 'name' | 'isTest'>,
  options: { optical?: OpticalSettings; settings?: MonitoringSettings; now: Date },
  ctx: CommandContext = {},
): MonitoringAlarmResult {
  const optical = options.optical ?? DEFAULT_OPTICAL_SETTINGS;
  const settings = options.settings ?? DEFAULT_MONITORING_SETTINGS;
  const now = options.now.getTime();
  const isFresh = (row: { deviceTime: string }, minutes: number) => now - Date.parse(row.deviceTime) <= minutes * 60_000;
  // "After" = stored rows plus this batch, so only the newest row for each ONT can raise.
  const after: MonitoringData = {
    ...data,
    onuStatuses: [...(data.onuStatuses ?? []), ...fresh.statuses],
    onuReadings: [...(data.onuReadings ?? []), ...fresh.readings],
  };
  const triggers: Trigger[] = [];
  const ontIds = new Set([...fresh.statuses, ...fresh.readings].map((r) => r.ontId).filter((id): id is string => !!id));
  for (const ontId of ontIds) {
    const status = latestStatus(after, ontId, source.isTest);
    if (status && fresh.statuses.includes(status) && isFresh(status, settings.statusStaleMinutes)) {
      if (status.state === 'los') triggers.push({ ontId, kind: 'ont_los', row: status, note: ONU_STATE_LABELS.los });
      if (status.state === 'offline') triggers.push({ ontId, kind: 'ont_offline', row: status, note: ONU_STATE_LABELS.offline });
    }
    const reading = latestReading(after, ontId, 'ont_rx', source.isTest);
    if (reading && fresh.readings.includes(reading) && isFresh(reading, settings.readingStaleMinutes)) {
      const band = rxBandFor(reading.valueDbm, optical);
      if (band === 'bad') triggers.push({ ontId, kind: 'low_power', row: reading, note: `Receive level ${reading.valueDbm.toFixed(1)} dBm, below the Optical settings band` });
      if (band === 'too_much_light') triggers.push({ ontId, kind: 'other', row: reading, note: `Too much light: ${reading.valueDbm.toFixed(1)} dBm, above the Optical settings band` });
    }
  }

  let alarms = data.alarms ?? [];
  const raised: Alarm[] = [];
  for (const t of triggers) {
    const customers = data.customers.filter((c) => c.ontId === t.ontId && isActiveCustomer(c));
    const elements: NetworkElementRef[] = customers.length > 0 ? customers.map((c) => ({ type: 'customer', id: c.id })) : [{ type: 'ont', id: t.ontId }];
    for (const element of elements) {
      const result = addAlarm(
        alarms,
        data,
        {
          kind: t.kind,
          source: source.isTest ? 'test' : 'device_adapter',
          element,
          note: `${source.isTest ? 'TEST · not real. ' : ''}${t.note}, reported by ${source.name} for device time ${t.row.deviceTime}`,
          reportedBy: source.name,
          monitoringSourceId: source.id,
          evidenceIds: [t.row.id],
        },
        ctx,
        true,
      );
      if (typeof result === 'string') continue;
      alarms = result.alarms;
      raised.push(result.alarm);
    }
  }
  const audit: AuditEntry[] = raised.length
    ? [{ action: source.isTest ? 'TEST_MONITORING_ALARM' : 'MONITORING_ALARM', details: `${raised.length} alarm(s) from ${source.name}: ${raised.map((a) => `${a.kind} on ${a.element.id}`).join(', ').slice(0, 400)}`, assetId: raised[0].id, assetType: 'Alarm' }]
    : [];
  return { alarms, raised, audit };
}

/**
 * Phase 20: alarms from OLT and PON port rows. A new "down" for a PON port raises a PON port fault
 * on that port; a new "down" for the whole OLT raises "OLT not reachable" on it. Only the newest row
 * for the item, only inside the status stale time, only when it is tied to a record. "Degraded" and
 * "unknown" raise nothing: they are shown as the device said. Cards and interfaces raise nothing.
 */
export function raiseDeviceAlarms(
  data: NetworkData & MonitoringData,
  fresh: readonly DeviceStatus[],
  source: Pick<MonitoringSource, 'id' | 'name' | 'isTest'>,
  options: { settings?: MonitoringSettings; now: Date; alarms?: Alarm[] },
  ctx: CommandContext = {},
): MonitoringAlarmResult {
  const settings = options.settings ?? DEFAULT_MONITORING_SETTINGS;
  const now = options.now.getTime();
  const all = [...(data.deviceStatuses ?? []), ...fresh];
  const keyOf = (d: DeviceStatus) => `${d.target}|${d.oltId}|${d.ponPortId ?? ''}`;
  const newestByKey = new Map<string, DeviceStatus>();
  for (const d of all) {
    if (d.isTest !== source.isTest || !d.oltId || (d.target !== 'olt' && d.target !== 'pon_port') || (d.target === 'pon_port' && !d.ponPortId)) continue;
    const kept = newestByKey.get(keyOf(d));
    if (!kept || d.deviceTime > kept.deviceTime || (d.deviceTime === kept.deviceTime && d.receivedAt > kept.receivedAt)) newestByKey.set(keyOf(d), d);
  }
  let alarms = options.alarms ?? data.alarms ?? [];
  const raised: Alarm[] = [];
  for (const row of newestByKey.values()) {
    if (!fresh.includes(row) || row.state !== 'down' || now - Date.parse(row.deviceTime) > settings.statusStaleMinutes * 60_000) continue;
    const element: NetworkElementRef = row.target === 'pon_port' ? { type: 'pon_port', id: row.oltId!, ponPortId: row.ponPortId } : { type: 'olt', id: row.oltId! };
    const kind: AlarmKind = row.target === 'pon_port' ? 'pon_port_fault' : 'olt_unreachable';
    const what = row.target === 'pon_port' ? `PON port ${row.portAddress ?? row.ponPortId} reported down` : 'OLT reported down';
    const result = addAlarm(
      alarms,
      data,
      {
        kind,
        source: source.isTest ? 'test' : 'device_adapter',
        element,
        note: `${source.isTest ? 'TEST · not real. ' : ''}${what}${row.rawState ? ` ("${row.rawState}")` : ''}, by ${source.name} for device time ${row.deviceTime}`,
        reportedBy: source.name,
        monitoringSourceId: source.id,
        evidenceIds: [row.id],
      },
      ctx,
      true,
    );
    if (typeof result === 'string') continue;
    alarms = result.alarms;
    raised.push(result.alarm);
  }
  const audit: AuditEntry[] = raised.length
    ? [{ action: source.isTest ? 'TEST_MONITORING_ALARM' : 'MONITORING_ALARM', details: `${raised.length} OLT or PON port alarm(s) from ${source.name}: ${raised.map((a) => `${a.kind} on ${a.element.id}${a.element.ponPortId ? `/${a.element.ponPortId}` : ''}`).join(', ').slice(0, 400)}`, assetId: raised[0].id, assetType: 'Alarm' }]
    : [];
  return { alarms, raised, audit };
}
