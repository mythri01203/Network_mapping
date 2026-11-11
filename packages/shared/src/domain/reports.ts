import type { NetworkSnapshot } from '../model/collections';
import type { Fault, WorkOrder } from '../model/types';
import { capacityPlanningReports } from './capacityReports';
import { type CapacitySettings, resolveCapacitySettings } from './capacitySettings';
import { coreUtilization } from './fiberCommands';
import type { OspSettings } from './ospSettings';
import { buildFiberIndex, splitterCapacity } from './fiberIndex';
import { DEFAULT_OPTICAL_SETTINGS, type OpticalSettings } from './opticalSettings';
import { resolveMonitoringSettings } from './monitoringSettings';
import { cableLengths } from './outsidePlant';
import { ponPortUsage } from './ponUsage';
import { recordReports } from './recordReports';
import { SPLITTER_ARCHITECTURE_LABELS, splitProductText, splitterOutputUse, splitterPlaces } from './splitterManagement';

/**
 * Phase 9 reports (section 22 of the master prompt), built only from what the records hold. Every
 * table says how it is worked out. When the times a figure needs are missing, it is not shown:
 * the table says how many records had them instead. TEST events are left out unless asked for.
 * Live monitoring figures come only from what a real monitoring source sent (Phase 7, Phase 20); with
 * nothing sent, those reports say "No live connection".
 *
 * Reports name records by id and name only: no phone numbers, addresses or other personal data.
 */

export interface ReportFilters {
  /** Inclusive, `YYYY-MM-DD`. Applies to faults (raised) and jobs (created or scheduled). */
  from?: string;
  to?: string;
  /** Matches equipment and customer `area` as written, ignoring case. Empty means every area. */
  area?: string;
  /** TEST alarms, faults and jobs are left out unless this is true. */
  includeTest?: boolean;
}

export type ReportCell = string | number;

export interface ReportColumn {
  key: string;
  label: string;
}

export interface ReportTable {
  id: string;
  title: string;
  /** How the figures are worked out, in plain words. */
  definition: string;
  columns: ReportColumn[];
  rows: Record<string, ReportCell>[];
  /** What is missing or left out. */
  notes: string[];
  /** True when the report needs device data and no real source sent any inside the stale time. */
  noLiveConnection?: boolean;
  /** Network mapping Phase 22: the record lists the figures come from, in plain words. */
  sources?: string[];
  /** Network mapping Phase 22: the settings (with their values) the report used. Empty: none. */
  settingsUsed?: string[];
}

export const NO_LIVE_CONNECTION = 'No live connection';

const col = (key: string, label: string): ReportColumn => ({ key, label });

/** `YYYY-MM-DD HH:mm` and ISO strings both; undefined when missing or unreadable. */
export function parseRecordTime(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const text = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(value) ? value.replace(' ', 'T') : value;
  const time = Date.parse(text);
  return Number.isFinite(time) ? time : undefined;
}

const dayOf = (value: string | undefined): string | undefined => {
  const t = parseRecordTime(value);
  return t === undefined ? undefined : new Date(t).toISOString().slice(0, 10);
};

const inRange = (value: string | undefined, filters: ReportFilters): boolean => {
  if (!filters.from && !filters.to) return true;
  const day = dayOf(value);
  if (!day) return false;
  if (filters.from && day < filters.from) return false;
  if (filters.to && day > filters.to) return false;
  return true;
};

const areaMatches = (area: string | undefined, filters: ReportFilters): boolean =>
  !filters.area?.trim() || (area ?? '').trim().toLowerCase() === filters.area.trim().toLowerCase();

const countBy = <T>(items: readonly T[], key: (item: T) => string): [string, number][] => {
  const map = new Map<string, number>();
  for (const item of items) map.set(key(item), (map.get(key(item)) ?? 0) + 1);
  return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
};

const round1 = (n: number) => Math.round(n * 10) / 10;
const km = (m: number) => round1(m / 100) / 10;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Hours between two record times, or undefined when either is missing or the order is impossible. */
const hoursBetween = (start: string | undefined, end: string | undefined): number | undefined => {
  const a = parseRecordTime(start);
  const b = parseRecordTime(end);
  if (a === undefined || b === undefined || b < a) return undefined;
  return (b - a) / 3_600_000;
};

const isTestFault = (f: Fault) => f.isTest === true;
const isTestJob = (w: WorkOrder) => w.isTest === true;

type ReportData = Pick<
  NetworkSnapshot,
  'equipment' | 'cables' | 'splitters' | 'closures' | 'customers' | 'faults' | 'workOrders' | 'spans' | 'ducts' | 'slackLoops' | 'onts' | 'alarms' | 'permissions'
> &
  // Network mapping Phase 18: what the capacity planning reports also read, when given.
  Partial<Pick<NetworkSnapshot, 'attachments' | 'sites' | 'racks' | 'zones' | 'services' | 'settings' | 'planningScenarios'>> &
  // Network mapping Phase 22: the stored map check findings, when given.
  Partial<Pick<NetworkSnapshot, 'validationFindings'>>;

function inventoryReport(data: ReportData, filters: ReportFilters): ReportTable {
  const equipment = data.equipment.filter((e) => areaMatches(e.area, filters));
  const rows = countBy(equipment, (e) => `${e.type}\u0000${e.status}`).map(([key, count]) => {
    const [type, status] = key.split('\u0000');
    return { type, status, count };
  });
  rows.push({ type: 'Span (pole to pole)', status: 'all', count: (data.spans ?? []).length });
  rows.push({ type: 'Duct', status: 'all', count: (data.ducts ?? []).length });
  rows.push({ type: 'Joint closure record', status: 'all', count: data.closures.length });
  return {
    id: 'inventory',
    title: 'Inventory: network items by type and status',
    definition: 'Each equipment record counted once by its type and status as recorded. Spans, ducts and closure records are counted from their own lists.',
    columns: [col('type', 'Type'), col('status', 'Status'), col('count', 'Count')],
    rows,
    notes: filters.area?.trim() ? [`Only equipment with area "${filters.area.trim()}". Spans, ducts and closures are not filtered by area.`] : [],
  };
}

function cableLengthReport(data: ReportData): ReportTable {
  const byType = new Map<string, { count: number; drawn: number; sheathCount: number; sheath: number; opticalCount: number; optical: number }>();
  for (const cable of data.cables) {
    const lengths = cableLengths(cable, data.slackLoops ?? []);
    const key = `${cable.type}\u0000${cable.installationType ?? 'Not recorded'}`;
    const row = byType.get(key) ?? { count: 0, drawn: 0, sheathCount: 0, sheath: 0, opticalCount: 0, optical: 0 };
    row.count += 1;
    row.drawn += lengths.drawnMeters ?? 0;
    if (lengths.sheathMeters !== undefined) {
      row.sheathCount += 1;
      row.sheath += lengths.sheathMeters;
    }
    if (lengths.opticalMeters !== undefined) {
      row.opticalCount += 1;
      row.optical += lengths.opticalMeters;
    }
    byType.set(key, row);
  }
  const rows = [...byType.entries()].map(([key, r]) => {
    const [type, installation] = key.split('\u0000');
    return {
      type,
      installation,
      cables: r.count,
      drawnKm: km(r.drawn),
      sheath: r.sheathCount > 0 ? `${km(r.sheath)} km (${r.sheathCount} of ${r.count} cables)` : 'Not recorded',
      optical: r.opticalCount > 0 ? `${km(r.optical)} km (${r.opticalCount} of ${r.count} cables)` : 'Not recorded',
    };
  });
  return {
    id: 'cable-length',
    title: 'Cable length by type and installation',
    definition: 'Drawn length is worked out from the line on the map. Sheath length comes from the marks at both ends and optical length from an OTDR, only where recorded. The three are never added together.',
    columns: [col('type', 'Cable type'), col('installation', 'Installation'), col('cables', 'Cables'), col('drawnKm', 'Drawn (km)'), col('sheath', 'Sheath (marks)'), col('optical', 'Optical (OTDR)')],
    rows,
    notes: [],
  };
}

function coreReport(data: ReportData): ReportTable {
  const rows = data.cables
    .filter((c) => c.fiberCount > 0 && c.type !== 'Coaxial Cable')
    .map((cable) => {
      const u = coreUtilization(cable);
      return { cable: cable.id, name: cable.name, type: cable.type, total: u.total, inUse: u.inUse, reserved: u.reserved, free: u.available, damaged: u.damaged, other: u.other, usedPercent: u.usedPercent };
    })
    .sort((a, b) => b.usedPercent - a.usedPercent || a.cable.localeCompare(b.cable));
  return {
    id: 'cores',
    title: 'Fiber core use and free cores',
    definition: 'Counted from each core record and its assignments: in use (or spliced), reserved, free (available or dark), damaged, other (unknown, unverified, under maintenance). Percent used = in use ÷ total.',
    columns: [col('cable', 'Cable id'), col('name', 'Name'), col('type', 'Type'), col('total', 'Cores'), col('inUse', 'In use'), col('reserved', 'Reserved'), col('free', 'Free'), col('damaged', 'Damaged'), col('other', 'Other'), col('usedPercent', 'Used %')],
    rows,
    notes: rows.some((r) => r.other > 0) ? ['"Other" cores have a status nobody has confirmed. Count them as not known, not as free.'] : [],
  };
}

function capacityReport(data: ReportData): ReportTable {
  const rows: Record<string, ReportCell>[] = [];
  for (const s of data.splitters) {
    // Phase 11: counted from what is on each output (customers, fibers, cascade splitters), not only
    // the port's status word. An output with no port record is not counted as free.
    const { counts } = splitterOutputUse(data, s);
    rows.push({ kind: 'Splitter', id: s.id, name: s.name, where: s.terminalBoxId, capacity: splitterCapacity(s), used: counts.used, reserved: counts.reserved, faulty: counts.faulty, free: counts.notRecorded ? `${counts.free} (${counts.notRecorded} not recorded)` : counts.free });
  }
  for (const olt of data.equipment.filter((e) => (e.ponPorts ?? []).length > 0)) {
    for (const port of olt.ponPorts ?? []) {
      // Phase 10: counted from the ONT and customer records, not the stored counter.
      const usage = ponPortUsage(data, olt.id, port.id);
      const used = usage?.ontCount ?? 0;
      const limit = port.maxOnu;
      rows.push({
        kind: 'PON port',
        id: `${olt.id} / ${port.vendorAddress ?? port.id}`,
        name: olt.name,
        where: olt.id,
        capacity: limit ?? 'ONU limit not recorded',
        used,
        reserved: '',
        faulty: '',
        free: limit !== undefined ? Math.max(0, limit - used) : 'Not known',
      });
    }
  }
  return {
    id: 'capacity',
    title: 'Splitter and PON port capacity',
    definition: 'Splitter outputs counted from each output record (capacity from the ratio). PON port use is the number of ONTs on the port, counted from the ONT records and the active customers recorded on the port (a customer with no ONT record counts as one ONT); its capacity is the vendor ONU limit when someone recorded it. Live ONU counts need a connection to the OLT.',
    columns: [col('kind', 'Kind'), col('id', 'Id'), col('name', 'Name'), col('where', 'Box or OLT'), col('capacity', 'Capacity'), col('used', 'Used'), col('reserved', 'Reserved'), col('faulty', 'Faulty'), col('free', 'Free')],
    rows,
    notes: [`Online ONUs per port: ${NO_LIVE_CONNECTION}.`],
  };
}

/**
 * Phase 11: every splitter's outputs from the records, with its level and split product. Ids only,
 * no customer names.
 */
function splitterCapacityReport(data: ReportData, optical: OpticalSettings): ReportTable {
  const index = buildFiberIndex(data);
  const places = splitterPlaces(data, { index, settings: optical });
  let notRecorded = 0;
  let faultyInUse = 0;
  let markedOnly = 0;
  let overLimit = 0;
  let couplers = 0;
  const rows: Record<string, ReportCell>[] = data.splitters.map((s) => {
    const { counts } = splitterOutputUse(data, s);
    const place = places.get(s.id);
    notRecorded += counts.notRecorded;
    faultyInUse += counts.faultyInUse;
    markedOnly += counts.markedOnly;
    if (place?.overSplitLimit) overLimit += 1;
    if (place?.split.couplers) couplers += 1;
    const level = place?.level !== undefined ? place.level : place && place.levelAtLeast > 1 ? `Not known (at least ${place.levelAtLeast})` : 'Not known';
    const worked = place?.suggestion.architecture ? SPLITTER_ARCHITECTURE_LABELS[place.suggestion.architecture] : 'Not known';
    return {
      id: s.id,
      name: s.name,
      where: s.terminalBoxId,
      ratio: s.couplerRatio ? `coupler ${s.couplerRatio}` : s.ratio,
      level,
      arrangement: s.architecture ? `${worked} · recorded: ${SPLITTER_ARCHITECTURE_LABELS[s.architecture.value]}${s.architecture.level !== undefined ? `, level ${s.architecture.level}` : ''}` : worked,
      split: place ? `${splitProductText(place.split)}${place.overSplitLimit ? ' (above limit)' : ''}` : 'Not known',
      outputs: counts.capacity,
      used: counts.used,
      customers: counts.customers,
      fibers: counts.fibers,
      cascade: counts.splitters,
      free: counts.free,
      reserved: counts.reserved,
      faulty: counts.faulty,
      notRecorded: counts.notRecorded,
    };
  });
  const limit = optical.limits.splitProduct;
  const notes = [
    'Level and arrangement are worked out from the recorded links up to the PON port (cascade in a box, splitter output to fiber to splices to splitter input, ODF patch). They are a suggestion, never a guess from position; "recorded" is what a person wrote, with a reason.',
    `Split = the ratios multiplied from the first splitter down to this one, against the limit of ${limit} in Optical settings. "At least" means the fiber above is not recorded.`,
    ...(notRecorded > 0 ? [`${notRecorded} output(s) have no port record and nothing linked: "not recorded", not free.`] : []),
    ...(faultyInUse > 0 ? [`${faultyInUse} faulty output(s) still have something connected; they are counted as faulty.`] : []),
    ...(markedOnly > 0 ? [`${markedOnly} output(s) are marked in use with nothing linked recorded; they are counted as used.`] : []),
    ...(overLimit > 0 ? [`${overLimit} splitter(s) are above the split limit. This is a warning only.`] : []),
    ...(couplers > 0 ? [`${couplers} splitter(s) have an unequal coupler on the way; couplers are not multiplied in.`] : []),
  ];
  return {
    id: 'splitter-capacity',
    title: 'Splitter outputs: used, free, reserved, faulty',
    definition:
      'For each output of each splitter (outputs from the ratio): used = an active customer recorded on it, a drop or lead fiber on the port, or a splitter cascaded from it; faulty and reserved = the mark on the port, with its reason in the port history; free = a port record with nothing on it; not recorded = no port record and nothing linked. Customers, fibers and cascade count the used outputs carrying each.',
    columns: [
      col('id', 'Splitter'),
      col('name', 'Name'),
      col('where', 'Box'),
      col('ratio', 'Ratio'),
      col('level', 'Level'),
      col('arrangement', 'Arrangement'),
      col('split', 'Split to here'),
      col('outputs', 'Outputs'),
      col('used', 'Used'),
      col('customers', 'Customers'),
      col('fibers', 'Drop fibers'),
      col('cascade', 'Cascade'),
      col('free', 'Free'),
      col('reserved', 'Reserved'),
      col('faulty', 'Faulty'),
      col('notRecorded', 'Not recorded'),
    ],
    rows,
    notes: rows.length === 0 ? ['No splitter records yet.'] : notes,
  };
}

function customerReport(data: ReportData, filters: ReportFilters): ReportTable {
  const customers = data.customers.filter((c) => areaMatches(c.area, filters));
  const rows: Record<string, ReportCell>[] = countBy(customers, (c) => c.status).map(([status, count]) => ({ what: 'Customer', status, count }));
  for (const [status, count] of countBy(data.onts ?? [], (o) => o.status)) rows.push({ what: 'ONT record', status, count });
  const linked = customers.filter((c) => c.status !== 'Disconnected' && !!c.oltId && !!c.ponPort).length;
  rows.push({ what: 'Customer linked to an OLT port (from records)', status: 'not disconnected', count: linked });
  return {
    id: 'customers',
    title: 'Customers and ONTs by status',
    definition: 'Customer status and ONT record status as recorded by people. Online, offline and LOS are not shown here: they come only from what a monitoring source sent (Live status, and the Live monitoring report).',
    columns: [col('what', 'What'), col('status', 'Status'), col('count', 'Count')],
    rows,
    notes: ['Online / offline / LOS: see Live status. Only what a monitoring source sent is shown there.', ...(filters.area?.trim() ? [`Only customers with area "${filters.area.trim()}". ONT records are not filtered by area.`] : [])],
  };
}

function faultReport(data: ReportData, filters: ReportFilters): { summary: ReportTable; repair: ReportTable } {
  const all = data.faults.filter((f) => inRange(f.reportedAt, filters));
  const tests = all.filter(isTestFault).length;
  const faults = filters.includeTest ? all : all.filter((f) => !isTestFault(f));
  const summaryRows = countBy(faults, (f) => `${f.type}\u0000${f.severity}\u0000${f.status}`).map(([key, count]) => {
    const [type, severity, status] = key.split('\u0000');
    return { type, severity, status, count };
  });
  const repaired = faults.filter((f) => f.repairedAt);
  const hours = repaired.map((f) => hoursBetween(f.reportedAt, f.repairedAt)).filter((h): h is number => h !== undefined);
  const repairRows: Record<string, ReportCell>[] = [
    { measure: 'Faults in the period', value: faults.length },
    { measure: 'With both raised and repaired times recorded', value: hours.length },
  ];
  if (hours.length > 0) {
    repairRows.push({ measure: 'Median time to repair (hours)', value: round1(median(hours)) });
    repairRows.push({ measure: 'Mean time to repair (hours)', value: round1(hours.reduce((a, b) => a + b, 0) / hours.length) });
    repairRows.push({ measure: 'Longest (hours)', value: round1(Math.max(...hours)) });
  } else {
    repairRows.push({ measure: 'Time to repair', value: 'Not worked out: no fault has both times recorded' });
  }
  const resolvedOnly = faults.filter((f) => !f.repairedAt && f.resolvedAt).length;
  const notes = [
    filters.includeTest ? `TEST events included (${tests}).` : `TEST events left out (${tests}). Tick "Include TEST" to see them.`,
    ...(resolvedOnly > 0 ? [`${resolvedOnly} older fault(s) only have a "Resolved" time, written before repairs were recorded; they are not counted in repair times.`] : []),
    'Network availability is not worked out: it needs outage start and end times from a live connection or a complete outage record.',
  ];
  return {
    summary: {
      id: 'faults',
      title: 'Faults by type, severity and status',
      definition: 'Faults raised in the period (by their raised time), counted by type, severity and status as recorded.',
      columns: [col('type', 'Type'), col('severity', 'Severity'), col('status', 'Status'), col('count', 'Count')],
      rows: summaryRows,
      notes,
    },
    repair: {
      id: 'repair-times',
      title: 'Fault repair times',
      definition: 'Time to repair = repaired time − raised time, only for faults that have both. Faults without both times are counted, never guessed.',
      columns: [col('measure', 'Measure'), col('value', 'Value')],
      rows: repairRows,
      notes,
    },
  };
}

function workOrderReport(data: ReportData, filters: ReportFilters): ReportTable {
  const all = data.workOrders.filter((w) => inRange(w.createdAt ?? w.scheduledDate, filters));
  const tests = all.filter(isTestJob).length;
  const jobs = filters.includeTest ? all : all.filter((w) => !isTestJob(w));
  const byTech = new Map<string, { jobs: WorkOrder[] }>();
  for (const w of jobs) {
    const name = w.technicianName?.trim() || 'Unassigned';
    (byTech.get(name) ?? byTech.set(name, { jobs: [] }).get(name)!).jobs.push(w);
  }
  const rows = [...byTech.entries()]
    .sort((a, b) => b[1].jobs.length - a[1].jobs.length || a[0].localeCompare(b[0]))
    .map(([technician, { jobs: list }]) => {
      const times = list.map((w) => hoursBetween(w.assignedAt ?? w.createdAt, w.repairedAt)).filter((h): h is number => h !== undefined);
      const open = list.filter((w) => !['Completed', 'Verified', 'Closed', 'Cancelled'].includes(w.status)).length;
      return {
        technician,
        jobs: list.length,
        open,
        repaired: list.filter((w) => !!w.repairedAt).length,
        verified: list.filter((w) => w.status === 'Verified' || w.status === 'Closed').length,
        medianHours: times.length > 0 ? round1(median(times)) : 'Not recorded',
        timed: `${times.length} of ${list.length}`,
      };
    });
  return {
    id: 'work-orders',
    title: 'Jobs by technician',
    definition: 'Jobs created (or scheduled) in the period. Time to repair = repaired time − assigned time (or created time), only for jobs with both. Verified counts jobs with a check (light reading, photo or office check).',
    columns: [col('technician', 'Technician'), col('jobs', 'Jobs'), col('open', 'Open'), col('repaired', 'Repaired'), col('verified', 'Verified or closed'), col('medianHours', 'Median hours to repair'), col('timed', 'Jobs with both times')],
    rows,
    notes: [filters.includeTest ? `TEST jobs included (${tests}).` : `TEST jobs left out (${tests}).`],
  };
}

function permissionReport(data: ReportData, today: string): ReportTable {
  const rows = (data.permissions ?? []).map((p) => {
    const end = p.validUntil?.slice(0, 10);
    const state = !end ? 'No end date recorded' : end < today ? 'Ended' : 'In force';
    return { id: p.id, structure: p.structureIds.join(' '), authority: p.authority || 'Not recorded', kind: p.kind ?? 'Not recorded', until: end ?? 'Not recorded', state };
  });
  return {
    id: 'permissions',
    title: 'Pole and route permissions',
    definition: 'Each permission record as typed: authority, kind and end date. "Ended" means the end date has passed today.',
    columns: [col('id', 'Permission'), col('structure', 'Pole or structure'), col('authority', 'Authority'), col('kind', 'Kind'), col('until', 'Valid until'), col('state', 'State')],
    rows,
    notes: rows.length === 0 ? ['No permission records yet.'] : [],
  };
}

/** What the live report reads, when given. Absent collections count as "nothing sent". */
export type LiveReportData = Partial<Pick<NetworkSnapshot, 'alarms' | 'settings' | 'monitoringSources' | 'onuReadings' | 'onuStatuses' | 'deviceStatuses' | 'rfLevels'>>;

/**
 * Network mapping Phase 20: the monitoring framework exists (Phase 7: file import, push, TEST
 * simulator; Phase 20: OLT, card and PON port rows). Each line says what real sources have sent:
 * "Live" only when a real (not TEST) row arrived inside the stale time in Monitoring settings,
 * "Stale" with the time of the newest one, and "No live connection" when nothing real was sent.
 * Rows are counted, never turned into an availability figure.
 */
export function liveMonitoringReport(data: LiveReportData, now = new Date()): ReportTable {
  const monitoring = resolveMonitoringSettings(data.settings ?? []);
  const realSources = new Set((data.monitoringSources ?? []).filter((s) => !s.isTest).map((s) => s.id));
  const real = <T extends { sourceId: string; isTest: boolean }>(rows: readonly T[] | undefined) => (rows ?? []).filter((r) => !r.isTest && realSources.has(r.sourceId));
  const sentence = (rows: readonly { deviceTime: string }[], staleMinutes: number, what: string): string => {
    if (rows.length === 0) return NO_LIVE_CONNECTION;
    const newest = rows.reduce((m, r) => (r.deviceTime > m ? r.deviceTime : m), rows[0].deviceTime);
    const minutes = Math.max(0, Math.round((now.getTime() - Date.parse(newest)) / 60_000));
    const age = minutes < 120 ? `${minutes} min ago` : minutes < 2880 ? `${Math.round(minutes / 60)} h ago` : `${Math.round(minutes / 1440)} days ago`;
    const live = minutes <= staleMinutes;
    return `${live ? 'Live' : 'Stale'}: ${rows.length} ${what} kept from real sources, newest ${age} (${newest.slice(0, 16).replace('T', ' ')} UTC)`;
  };
  const statuses = real(data.onuStatuses);
  const readings = real(data.onuReadings);
  const devices = real(data.deviceStatuses);
  const liveNow = [...statuses, ...devices].some((r) => now.getTime() - Date.parse(r.deviceTime) <= monitoring.statusStaleMinutes * 60_000);
  const deviceAlarms = (data.alarms ?? []).filter((a) => a.source === 'device_adapter' && !a.isTest);
  const openDevice = deviceAlarms.filter((a) => a.state !== 'cleared').length;
  const rfLevels = data.rfLevels ?? [];
  return {
    id: 'live',
    title: 'Live monitoring: status, optical readings and alarms from devices',
    definition: `Counted from what monitoring sources (file import or push) have sent. "Live" only when a real source sent a row in the last ${monitoring.statusStaleMinutes} min (status) or ${monitoring.readingStaleMinutes} min (light readings), as set in Monitoring settings; otherwise "Stale" with the newest time, or "${NO_LIVE_CONNECTION}" when nothing real was sent. TEST rows are left out.`,
    columns: [col('report', 'Report'), col('state', 'State')],
    rows: [
      { report: 'ONT online / offline / LOS and history', state: sentence(statuses, monitoring.statusStaleMinutes, 'ONU status row(s)') },
      { report: 'Optical readings from devices (history is a list; no trend charts)', state: sentence(readings, monitoring.readingStaleMinutes, 'light reading(s)') },
      { report: 'OLT, card and PON port status from devices', state: sentence(devices, monitoring.statusStaleMinutes, 'device status row(s)') },
      {
        report: 'Device alarms',
        state: deviceAlarms.length === 0 ? (realSources.size === 0 ? NO_LIVE_CONNECTION : 'None raised by a monitoring source') : `${openDevice} open, ${deviceAlarms.length - openDevice} cleared (raised by monitoring sources)`,
      },
      { report: 'Network availability', state: 'Not worked out: it needs outage start and end times, which status rows alone do not prove' },
      {
        report: 'Cable TV (HFC/RF) levels',
        state: rfLevels.length > 0 ? `${rfLevels.length} level(s) recorded by people with a meter (Cable TV). Not live: no RF monitoring source` : 'None recorded. Levels are recorded by people with a meter (Cable TV); there is no RF monitoring source',
      },
    ],
    notes: [
      'A light reading is not proof that an ONT is online: online, offline and LOS come only from status rows.',
      'Field light readings are on each customer and in Topology, Readings and lengths; they are meter readings, not live.',
      ...(realSources.size === 0 ? ['No real monitoring source is set up. The administrator adds one under Live status, Sources.'] : []),
    ],
    ...(liveNow ? {} : { noLiveConnection: true }),
  };
}

/** Every report, in the order the Reports screen shows them. */
export function buildReports(
  data: ReportData & LiveReportData,
  filters: ReportFilters = {},
  today = new Date().toISOString().slice(0, 10),
  /** Phase 11: the operator's optical settings, for the split limit. Defaults when not given. */
  options: { optical?: OpticalSettings; capacity?: CapacitySettings; osp?: OspSettings } = {},
): ReportTable[] {
  const faults = faultReport(data, filters);
  return [
    inventoryReport(data, filters),
    cableLengthReport(data),
    coreReport(data),
    capacityReport(data),
    splitterCapacityReport(data, options.optical ?? DEFAULT_OPTICAL_SETTINGS),
    // Network mapping Phase 18: capacity planning (per element, OLT chassis, zones, demand, planned against built, scenarios).
    ...capacityPlanningReports(data, {
      capacity: options.capacity ?? resolveCapacitySettings(data.settings ?? []),
      settingRecords: data.settings ?? [],
      ...(options.osp ? { osp: options.osp } : {}),
      ...(options.optical ? { optical: options.optical } : {}),
    }),
    customerReport(data, filters),
    faults.summary,
    faults.repair,
    workOrderReport(data, filters),
    permissionReport(data, today),
    // Network mapping Phase 22: the M30 reports that were missing (inventory, OSP, ducts, splicing, ODF, orphans, paths, findings).
    ...recordReports(data, { filters, today, ...(options.osp ? { osp: options.osp } : {}) }),
    liveMonitoringReport(data),
  ].map((t) => (t.sources ? t : { ...t, sources: EARLIER_REPORT_SOURCES[t.id] ?? [] }));
}

/** Network mapping Phase 22: the record lists each earlier report reads, for the PDF and Excel. */
const EARLIER_REPORT_SOURCES: Record<string, string[]> = {
  inventory: ['Network items', 'Spans', 'Ducts', 'Joint closure records'],
  'cable-length': ['Cables', 'Slack loops'],
  cores: ['Cables (fibres and their assignments)'],
  capacity: ['Splitters', 'Network items (OLT PON ports)', 'ONT records', 'Customers (ids only)'],
  'splitter-capacity': ['Splitters', 'Cables', 'Joint closure records (splices)', 'Network items (ODF ports, OLT PON ports)', 'Customers (ids only)', 'Optical settings (split limit)'],
  'capacity-use': ['Splitters', 'Network items (OLTs, ODFs, poles)', 'Cables', 'Ducts', 'Cables on poles and spans (attachments)', 'Sites and racks', 'Customers (ids only)', 'ONT records', 'Capacity settings'],
  'olt-chassis-capacity': ['Network items (OLT chassis and PON ports)', 'ONT records', 'Customers (ids only)', 'Cables', 'Splitters', 'Capacity settings'],
  'capacity-zones': ['Zones (drawn boundaries)', 'The capacity per element', 'Customers waiting (house position used only to find the zone, never shown)'],
  'capacity-demand': ['Customers waiting (Pending Installation, by box)', 'Splitters'],
  'planned-vs-built': ['Network items', 'Cables', 'Spans', 'Ducts', 'Cables on poles and spans (attachments)', 'Customers (ids only)'],
  'planned-vs-built-capacity': ['The capacity per element'],
  'capacity-scenarios': ['Planning scenarios', 'The records as they are today'],
  customers: ['Customers (ids only)', 'ONT records'],
  faults: ['Faults'],
  'repair-times': ['Faults'],
  'work-orders': ['Jobs (work orders)'],
  permissions: ['Permissions'],
  live: ['Monitoring sources', 'ONU status rows', 'Light readings from devices', 'Device status rows', 'Alarms', 'Cable TV levels', 'Monitoring settings'],
};

/** A cell made safe for a spreadsheet: text that starts like a formula is kept as text. */
const csvCell = (value: ReportCell): string => {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  let text = value;
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** CSV with a header row, CRLF line ends (what spreadsheets expect). */
export function reportToCsv(table: Pick<ReportTable, 'columns' | 'rows'>): string {
  const lines = [table.columns.map((c) => csvCell(c.label)).join(',')];
  for (const row of table.rows) lines.push(table.columns.map((c) => csvCell(row[c.key] ?? '')).join(','));
  return `${lines.join('\r\n')}\r\n`;
}
