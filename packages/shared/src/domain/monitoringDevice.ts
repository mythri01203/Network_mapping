import {
  DEVICE_STATE_LABELS,
  type DeviceIngestRow,
  type DeviceMatchKind,
  type DeviceStatus,
  type MonitoringSource,
  type OnuState,
} from '../model/monitoringSchemas';
import type { Alarm, Customer, Equipment, Ont, Service } from '../model/types';
import { isActiveCustomer } from './connectionRules';
import { affectedByElement, type ImpactIndex } from './faultImpact';
import { contentId, deviceTimeProblem, type SkippedRow } from './monitoringIngest';
import { DEFAULT_MONITORING_SETTINGS, type MonitoringSettings } from './monitoringSettings';
import { latestStatus, type MonitoringData, showFreshness, type ShownValue,showStatus } from './monitoringStatus';
import { CUSTOMER_LIVE_STATES, type CustomerLiveState } from './monitoringSummary';
import { ponPortUsage } from './ponUsage';
import { NO_LIVE_CONNECTION } from './reports';

/**
 * Network mapping Phase 20: OLT, card and PON port status, from stored device rows only.
 *
 * Two kinds of evidence are kept apart and never mixed into one claim:
 * - What the device said about the OLT, a card, a PON port or an uplink (`deviceStatuses`, push only).
 *   Shown as the device said it, with its age and source. A port's status is never made up from its ONUs.
 * - What the ONUs on each port said (`onuStatuses`), counted per port, per card and per OLT from the
 *   ONT records on each port (Phase 10 counts). A light reading is never counted as online.
 *
 * "Live" only for a real (not TEST) row inside the status stale time; older is "Stale" with its age;
 * nothing at all is "No live connection". TEST rows are counted apart and never added in.
 */

/* ------------------------------------------------------------------ */
/* Ingest: matching and checking device rows                            */
/* ------------------------------------------------------------------ */

const OLT_KEY_WORDS: Record<Exclude<DeviceMatchKind, 'none'>, string> = { olt_id: 'record id', olt_serial: 'serial', olt_ip: 'management IP' };

/** Exact match on the OLT record id, serial and IP. Every identifier given must point at the same one OLT. */
export function matchOltRecord(
  equipment: readonly Equipment[],
  row: Pick<DeviceIngestRow, 'oltId' | 'oltSerial' | 'oltIp'>,
): { olt?: Equipment; by: DeviceMatchKind; key: string; reason?: string } {
  const olts = equipment.filter((e) => e.type === 'OLT');
  const given: [Exclude<DeviceMatchKind, 'none'>, string | undefined, (e: Equipment) => string | undefined][] = [
    ['olt_id', row.oltId?.trim() || undefined, (e) => e.id],
    ['olt_serial', row.oltSerial?.trim() || undefined, (e) => e.serialNumber?.trim()],
    ['olt_ip', row.oltIp?.trim() || undefined, (e) => e.ipAddress?.trim()],
  ];
  const key = given.map(([, v]) => v).find(Boolean) ?? '';
  const found: { by: Exclude<DeviceMatchKind, 'none'>; olt: Equipment }[] = [];
  for (const [by, value, get] of given) {
    if (!value) continue;
    const hits = olts.filter((e) => get(e) === value);
    if (hits.length > 1) return { by: 'none', key, reason: `OLT ${OLT_KEY_WORDS[by]} "${value}" is written on ${hits.length} OLT records` };
    if (hits.length === 0) return { by: 'none', key, reason: `No OLT record has ${OLT_KEY_WORDS[by]} "${value}"` };
    found.push({ by, olt: hits[0] });
  }
  if (found.length === 0) return { by: 'none', key, reason: 'No OLT id, serial or IP' };
  if (new Set(found.map((f) => f.olt.id)).size > 1) return { by: 'none', key, reason: 'The OLT id, serial and IP given are on different OLT records' };
  return { olt: found[0].olt, by: found[0].by, key };
}

/** The PON port whose address is exactly this on the OLT (then its record id), or the reason there is none. */
export function matchPonPortRecord(olt: Equipment, address: string): { ponPortId?: string; reason?: string } {
  const ports = olt.ponPorts ?? [];
  const byAddress = ports.filter((p) => p.vendorAddress?.trim() === address);
  if (byAddress.length > 1) return { reason: `Address "${address}" is written on ${byAddress.length} PON ports of ${olt.name}` };
  if (byAddress[0]) return { ponPortId: byAddress[0].id };
  const byId = ports.find((p) => p.id === address);
  if (byId) return { ponPortId: byId.id };
  return { reason: `"${address}" is not the address or id of a PON port recorded on ${olt.name}` };
}

/** The chassis slot with this label (and shelf label, when given), or the reason there is none. */
export function matchSlotRecord(olt: Equipment, slot: string, shelf?: string): { slotId?: string; reason?: string } {
  const shelves = olt.chassis?.shelves ?? [];
  if (shelves.length === 0) return { reason: `${olt.name} has no chassis recorded (shelves, slots and cards), so the card cannot be placed` };
  const hits = shelves.flatMap((sh) => (!shelf || sh.label === shelf ? sh.slots.filter((s) => s.label === slot) : []));
  if (hits.length > 1) return { reason: `Slot "${slot}" is in ${hits.length} shelves of ${olt.name}; send the shelf too` };
  if (hits[0]) return { slotId: hits[0].id };
  return { reason: `${olt.name} has no recorded slot "${slot}"${shelf ? ` in shelf "${shelf}"` : ''}` };
}

export interface DeviceIngestPlan {
  statuses: DeviceStatus[];
  skipped: SkippedRow[];
  unmatched: { row: number; key: string; reason: string }[];
  duplicates: number;
  matched: number;
}

export interface DeviceIngestContext {
  source: Pick<MonitoringSource, 'id' | 'isTest'>;
  equipment: readonly Equipment[];
  existingIds: ReadonlySet<string>;
  now: Date;
  settings?: MonitoringSettings;
}

/** Device rows to store, with the same rules as ONU rows: real time with zone, no future, no repeats. */
export function planDeviceIngest(rows: readonly DeviceIngestRow[], ctx: DeviceIngestContext): DeviceIngestPlan {
  const settings = ctx.settings ?? DEFAULT_MONITORING_SETTINGS;
  const plan: DeviceIngestPlan = { statuses: [], skipped: [], unmatched: [], duplicates: 0, matched: 0 };
  const seen = new Set(ctx.existingIds);
  const receivedAt = ctx.now.toISOString();
  rows.forEach((row, i) => {
    const n = i + 1;
    const skip = (reason: string) => plan.skipped.push({ row: n, reason });
    if (!row.oltId?.trim() && !row.oltSerial?.trim() && !row.oltIp?.trim()) return skip('No OLT id, serial or IP');
    const timeProblem = deviceTimeProblem(row.deviceTime, ctx.now, settings);
    if (timeProblem) return skip(timeProblem);
    const portAddress = row.portAddress?.trim() || undefined;
    const slot = row.slot?.trim() || undefined;
    const shelf = row.shelf?.trim() || undefined;
    const interfaceName = row.interfaceName?.trim() || undefined;
    if (row.target === 'pon_port' && !portAddress) return skip('A PON port row needs "portAddress"');
    if (row.target === 'card' && !slot) return skip('A card row needs "slot"');
    if (row.target === 'interface' && !interfaceName) return skip('An interface row needs "interfaceName"');
    if (row.onuTotal !== undefined) {
      if (row.onuOnline !== undefined && row.onuOnline > row.onuTotal) return skip(`onuOnline ${row.onuOnline} is more than onuTotal ${row.onuTotal}, which is impossible`);
      if (row.losCount !== undefined && row.losCount > row.onuTotal) return skip(`losCount ${row.losCount} is more than onuTotal ${row.onuTotal}, which is impossible`);
    }

    const match = matchOltRecord(ctx.equipment, row);
    let part: { ponPortId?: string; slotId?: string; reason?: string } = {};
    if (match.olt && row.target === 'pon_port' && portAddress) part = matchPonPortRecord(match.olt, portAddress);
    if (match.olt && row.target === 'card' && slot) part = matchSlotRecord(match.olt, slot, shelf);
    const reason = match.reason ?? part.reason;
    const deviceTime = new Date(Date.parse(row.deviceTime)).toISOString();
    const counts = { onuOnline: row.onuOnline, onuTotal: row.onuTotal, losCount: row.losCount, alarmCount: row.alarmCount };
    const id = contentId('DV', [ctx.source.id, row.target, match.key, portAddress, shelf, slot, interfaceName, deviceTime, row.state, counts.onuOnline, counts.onuTotal, counts.losCount, counts.alarmCount]);
    if (seen.has(id)) return void (plan.duplicates += 1);
    seen.add(id);
    const definedCounts = Object.fromEntries(Object.entries(counts).filter(([, v]) => v !== undefined)) as Partial<typeof counts>;
    plan.statuses.push({
      id,
      target: row.target,
      ...(match.olt ? { oltId: match.olt.id } : {}),
      ...(part.ponPortId ? { ponPortId: part.ponPortId } : {}),
      ...(part.slotId ? { slotId: part.slotId } : {}),
      matchedBy: match.by,
      oltKey: match.key,
      ...(portAddress ? { portAddress } : {}),
      ...(shelf ? { shelf } : {}),
      ...(slot ? { slot } : {}),
      ...(interfaceName ? { interfaceName } : {}),
      origin: 'device_reported',
      sourceId: ctx.source.id,
      isTest: ctx.source.isTest,
      deviceTime,
      receivedAt,
      state: row.state,
      ...(row.rawState?.trim() ? { rawState: row.rawState.trim() } : {}),
      ...definedCounts,
      ...(reason ? { unmatchedReason: reason.slice(0, 200) } : {}),
    });
    if (reason) plan.unmatched.push({ row: n, key: [match.key, portAddress ?? slot].filter(Boolean).join(' '), reason });
    else plan.matched += 1;
  });
  return plan;
}

/** True when a device row is tied to its whole target (the OLT, and the port or slot it names). */
export const isDeviceRowMatched = (row: DeviceStatus): boolean =>
  !!row.oltId && (row.target === 'olt' || row.target === 'interface' || (row.target === 'pon_port' ? !!row.ponPortId : !!row.slotId));

/* ------------------------------------------------------------------ */
/* The board: OLT, card and PON port status                             */
/* ------------------------------------------------------------------ */

export type Freshness = ShownValue['freshness'];

/** What the device said about one item, as shown. */
export interface DeviceSaid {
  record: DeviceStatus;
  shown: ShownValue;
  /** "Down", "Up (stale, last known)", "TEST: Up". */
  label: string;
  /** "Device says 30 of 32 ONUs online · 2 LOS", or empty when it sent no counts. */
  countsText: string;
}

export interface StatusTotals {
  /** ONT records on the ports (Phase 10 count), plus active customers there with no ONT record. */
  onts: number;
  /** By the newest real ONU status of each ONT. Customers with no ONT record count as `no_ont_record`. */
  counts: Record<CustomerLiveState, number>;
  /** Open real alarms on the ports, their ONTs or their customers. */
  openAlarms: number;
  /** Open TEST alarms there, counted apart. */
  testAlarms: number;
  /** Active customers on the ports (by their record, and by recorded fiber path when an index is given). */
  customers: number;
  /** Of those: newest real status LOS or offline inside the stale time, or an open real "down" alarm. */
  impacted: number;
}

interface Evidence {
  /** Newest real row (device or ONU status) behind the figures, for the freshness note. */
  newest?: { deviceTime: string; sourceId: string; isTest: boolean; receivedAt: string };
  freshness: Freshness;
  /** "Live · 2 min ago · NMS push", "Stale · 3 h ago · NMS push" or "No live connection". */
  note: string;
}

export interface PonStatusRow extends StatusTotals, Evidence {
  key: string;
  oltId: string;
  ponPortId: string;
  /** "OLT-1 · gpon 0/1/0", from the port's recorded address. */
  label: string;
  portNumber: number;
  /** "Shelf 1 · Slot 5", when the chassis records the card holding the port. */
  cardLabel?: string;
  device?: DeviceSaid;
  customerIds: string[];
  impactedCustomerIds: string[];
  /** Customers who may be on the port by their own record but whose fiber path is not fully recorded. */
  mayBeCustomers: number;
}

export interface CardStatusRow extends StatusTotals, Evidence {
  key: string;
  oltId: string;
  slotId: string;
  label: string;
  model?: string;
  ponPortIds: string[];
  device?: DeviceSaid;
}

export interface InterfaceStatusRow {
  name: string;
  device: DeviceSaid;
}

export interface OltStatusRow extends StatusTotals, Evidence {
  oltId: string;
  label: string;
  device?: DeviceSaid;
  ports: PonStatusRow[];
  cards: CardStatusRow[];
  interfaces: InterfaceStatusRow[];
}

export interface DeviceBoard {
  /** A real row inside the status stale time exists somewhere on the board. */
  live: boolean;
  olts: OltStatusRow[];
  /** Real device rows not tied to a whole OLT, card or port. */
  unmatchedDeviceRows: number;
  testRows: number;
  notes: string[];
}

export interface DeviceBoardData extends MonitoringData {
  equipment: readonly Equipment[];
  customers: readonly Customer[];
  onts?: readonly Ont[];
  services?: readonly Service[];
  alarms?: readonly Alarm[];
}

const DOWN_STATES: readonly OnuState[] = ['los', 'offline'];
const DOWN_ALARMS: readonly Alarm['kind'][] = ['ont_los', 'ont_offline', 'low_power'];

const emptyCounts = (): Record<CustomerLiveState, number> => Object.fromEntries(CUSTOMER_LIVE_STATES.map((s) => [s, 0])) as Record<CustomerLiveState, number>;

type TimedRow = { deviceTime: string; sourceId: string; isTest: boolean; receivedAt: string };
const newer = <T extends TimedRow>(a: T | undefined, b: T | undefined): T | undefined =>
  !a ? b : !b ? a : b.deviceTime > a.deviceTime || (b.deviceTime === a.deviceTime && b.receivedAt > a.receivedAt) ? b : a;

function evidenceOf(newest: TimedRow | undefined, data: MonitoringData, settings: MonitoringSettings, now: Date): Evidence {
  if (!newest) return { freshness: 'none', note: NO_LIVE_CONNECTION };
  const v = showFreshness(newest, data, settings, now);
  return { newest, freshness: v.freshness, note: v.note };
}

function deviceSaid(row: DeviceStatus | undefined, data: MonitoringData, settings: MonitoringSettings, now: Date): DeviceSaid | undefined {
  if (!row) return undefined;
  const shown = showFreshness(row, data, settings, now);
  const label = `${row.isTest ? 'TEST: ' : ''}${DEVICE_STATE_LABELS[row.state]}${shown.stale ? ' (stale, last known)' : ''}`;
  const parts = [
    row.onuOnline !== undefined ? `${row.onuOnline}${row.onuTotal !== undefined ? ` of ${row.onuTotal}` : ''} ONUs online` : row.onuTotal !== undefined ? `${row.onuTotal} ONUs` : '',
    row.losCount !== undefined ? `${row.losCount} LOS` : '',
    row.alarmCount !== undefined ? `${row.alarmCount} alarm(s) on the device` : '',
  ].filter(Boolean);
  return { record: row, shown, label, countsText: parts.length ? `Device says ${parts.join(' · ')}` : '' };
}

const sumTotals = (rows: readonly StatusTotals[]): StatusTotals => {
  const counts = emptyCounts();
  for (const r of rows) for (const s of CUSTOMER_LIVE_STATES) counts[s] += r.counts[s];
  return {
    onts: rows.reduce((n, r) => n + r.onts, 0),
    counts,
    openAlarms: rows.reduce((n, r) => n + r.openAlarms, 0),
    testAlarms: rows.reduce((n, r) => n + r.testAlarms, 0),
    customers: rows.reduce((n, r) => n + r.customers, 0),
    impacted: rows.reduce((n, r) => n + r.impacted, 0),
  };
};

/**
 * Status per OLT, per card (Phase 10 chassis) and per PON port, from stored rows only. With an
 * impact index, customers on each port also include those whose recorded fiber path reaches it.
 */
export function deviceStatusBoard(
  data: DeviceBoardData,
  options: { settings?: MonitoringSettings; now?: Date; impact?: ImpactIndex } = {},
): DeviceBoard {
  const settings = options.settings ?? DEFAULT_MONITORING_SETTINGS;
  const now = options.now ?? new Date();
  const devices = data.deviceStatuses ?? [];
  const realDevices = devices.filter((d) => !d.isTest && isDeviceRowMatched(d));
  const newestDevice = (pred: (d: DeviceStatus) => boolean) => realDevices.filter(pred).reduce<DeviceStatus | undefined>((best, d) => newer(best, d), undefined);
  const openAlarms = (data.alarms ?? []).filter((a) => a.state !== 'cleared');
  const customersById = new Map(data.customers.map((c) => [c.id, c]));
  const usageData = { equipment: data.equipment, customers: data.customers, onts: data.onts, services: data.services };

  const olts: OltStatusRow[] = [];
  for (const olt of data.equipment.filter((e) => e.type === 'OLT')) {
    const slotOfPort = new Map<string, { label: string }>();
    for (const shelf of olt.chassis?.shelves ?? []) {
      for (const slot of shelf.slots) for (const pid of slot.card?.ponPortIds ?? []) slotOfPort.set(pid, { label: `Shelf ${shelf.label} · Slot ${slot.label}` });
    }
    const ports: PonStatusRow[] = [];
    for (const pon of [...(olt.ponPorts ?? [])].sort((a, b) => a.portNumber - b.portNumber)) {
      const usage = ponPortUsage(usageData, olt.id, pon.id);
      const counts = emptyCounts();
      let newest: TimedRow | undefined;
      const downOnts = new Set<string>();
      for (const ont of usage?.onts ?? []) {
        const row = latestStatus(data, ont.id);
        const status = showStatus(row, data, settings, now);
        const state: CustomerLiveState = !status.state ? 'no_data' : status.stale ? 'stale' : status.state;
        counts[state] += 1;
        if (!status.stale && status.state && DOWN_STATES.includes(status.state)) downOnts.add(ont.id);
        newest = newer(newest, row);
      }
      counts.no_ont_record += usage?.customersWithoutOnt.length ?? 0;
      const portDevice = newestDevice((d) => d.target === 'pon_port' && d.oltId === olt.id && d.ponPortId === pon.id);
      newest = newer(newest, portDevice);

      const recordIds = new Set((usage?.customers ?? []).map((c) => c.id));
      const impact = options.impact ? affectedByElement(options.impact, { type: 'pon_port', id: olt.id, ponPortId: pon.id }) : undefined;
      for (const a of impact?.affected ?? []) recordIds.add(a.customerId);
      const customerIds = [...recordIds].filter((id) => {
        const c = customersById.get(id);
        return !!c && isActiveCustomer(c);
      });
      const ontIds = new Set((usage?.onts ?? []).map((o) => o.id));
      for (const id of customerIds) {
        const ontId = customersById.get(id)?.ontId;
        if (ontId) ontIds.add(ontId);
      }
      const customerSet = new Set(customerIds);
      const here = (a: Alarm) =>
        (a.element.type === 'pon_port' && a.element.id === olt.id && a.element.ponPortId === pon.id) ||
        (a.element.type === 'customer' && customerSet.has(a.element.id)) ||
        (a.element.type === 'ont' && ontIds.has(a.element.id));
      const alarmsHere = openAlarms.filter(here);
      const impactedCustomerIds = customerIds.filter((id) => {
        const ontId = customersById.get(id)?.ontId;
        if (ontId && downOnts.has(ontId)) return true;
        if (ontId && !ontIds.has(ontId)) {
          const s = showStatus(latestStatus(data, ontId), data, settings, now);
          if (!s.stale && s.state && DOWN_STATES.includes(s.state)) return true;
        }
        return alarmsHere.some((a) => !a.isTest && DOWN_ALARMS.includes(a.kind) && ((a.element.type === 'customer' && a.element.id === id) || (a.element.type === 'ont' && a.element.id === ontId)));
      });
      const address = pon.vendorAddress ?? pon.slotCardPort;
      ports.push({
        key: `${olt.id}|${pon.id}`,
        oltId: olt.id,
        ponPortId: pon.id,
        label: `${olt.name} · ${address ?? pon.id}`,
        portNumber: pon.portNumber,
        ...(slotOfPort.get(pon.id) ? { cardLabel: slotOfPort.get(pon.id)!.label } : {}),
        ...(portDevice ? { device: deviceSaid(portDevice, data, settings, now) } : {}),
        onts: usage?.ontCount ?? 0,
        counts,
        openAlarms: alarmsHere.filter((a) => !a.isTest).length,
        testAlarms: alarmsHere.filter((a) => a.isTest).length,
        customers: customerIds.length,
        impacted: impactedCustomerIds.length,
        customerIds,
        impactedCustomerIds,
        mayBeCustomers: impact?.mayBeAffected.length ?? 0,
        ...evidenceOf(newest, data, settings, now),
      });
    }

    const cards: CardStatusRow[] = [];
    for (const shelf of olt.chassis?.shelves ?? []) {
      for (const slot of shelf.slots) {
        if (!slot.card) continue;
        const portRows = ports.filter((p) => slot.card?.ponPortIds?.includes(p.ponPortId));
        const cardDevice = newestDevice((d) => d.target === 'card' && d.oltId === olt.id && d.slotId === slot.id);
        const newest = portRows.reduce<TimedRow | undefined>((best, p) => newer(best, p.newest), cardDevice);
        cards.push({
          key: `${olt.id}|${slot.id}`,
          oltId: olt.id,
          slotId: slot.id,
          label: `Shelf ${shelf.label} · Slot ${slot.label}`,
          ...(slot.card.model ? { model: slot.card.model } : {}),
          ponPortIds: portRows.map((p) => p.ponPortId),
          ...(cardDevice ? { device: deviceSaid(cardDevice, data, settings, now) } : {}),
          ...sumTotals(portRows),
          ...evidenceOf(newest, data, settings, now),
        });
      }
    }

    const interfaces = new Map<string, DeviceStatus>();
    for (const d of realDevices) {
      if (d.target !== 'interface' || d.oltId !== olt.id || !d.interfaceName) continue;
      interfaces.set(d.interfaceName, newer(interfaces.get(d.interfaceName), d)!);
    }
    const oltDevice = newestDevice((d) => d.target === 'olt' && d.oltId === olt.id);
    const anyDevice = newestDevice((d) => d.oltId === olt.id);
    const newest = ports.reduce<TimedRow | undefined>((best, p) => newer(best, p.newest), anyDevice);
    olts.push({
      oltId: olt.id,
      label: olt.name,
      ...(oltDevice ? { device: deviceSaid(oltDevice, data, settings, now) } : {}),
      ports,
      cards,
      interfaces: [...interfaces.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, row]) => ({ name, device: deviceSaid(row, data, settings, now)! })),
      ...sumTotals(ports),
      ...evidenceOf(newest, data, settings, now),
    });
  }
  olts.sort((a, b) => a.label.localeCompare(b.label));

  const notes = [
    'Online, offline and LOS are counted from the newest status each ONU sent. A light reading alone is never counted as online.',
    '"Device says" figures are what the OLT or NMS sent for the port, card or OLT. They are shown as sent and not checked against the records.',
    'A port or card status is shown only when the device sent one. It is never worked out from its ONUs.',
  ];
  const unmatchedDeviceRows = devices.filter((d) => !d.isTest && !isDeviceRowMatched(d)).length;
  if (unmatchedDeviceRows > 0) notes.push(`${unmatchedDeviceRows} device row(s) did not match an OLT, card or port on record. They are kept and listed under Not matched.`);
  return {
    live: olts.some((o) => o.freshness === 'live'),
    olts,
    unmatchedDeviceRows,
    testRows: devices.filter((d) => d.isTest).length,
    notes,
  };
}
