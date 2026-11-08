import type { NetworkSnapshot } from '../model/collections';
import type { Fault, WorkOrder } from '../model/types';
import { coreUtilization } from './fiberCommands';
import { splitterCapacity } from './fiberIndex';
import { cableLengths } from './outsidePlant';

/**
 * Phase 9 reports (section 22 of the master prompt), built only from what the records hold. Every
 * table says how it is worked out. When the times a figure needs are missing, it is not shown:
 * the table says how many records had them instead. TEST events are left out unless asked for.
 * Live monitoring figures need Phase 7, so those reports say "No live connection".
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
  /** True for reports that need a live device connection (Phase 7). */
  noLiveConnection?: boolean;
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
>;

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
    const capacity = splitterCapacity(s);
    const by = (status: string) => s.outputPorts.filter((p) => p.status === status).length;
    rows.push({ kind: 'Splitter', id: s.id, name: s.name, where: s.terminalBoxId, capacity, used: by('Occupied'), reserved: by('Reserved'), faulty: by('Faulty'), free: Math.max(0, capacity - by('Occupied') - by('Reserved') - by('Faulty')) });
  }
  for (const olt of data.equipment.filter((e) => (e.ponPorts ?? []).length > 0)) {
    for (const port of olt.ponPorts ?? []) {
      const limit = port.maxOnu;
      rows.push({
        kind: 'PON port',
        id: `${olt.id} / ${port.vendorAddress ?? port.id}`,
        name: olt.name,
        where: olt.id,
        capacity: limit ?? 'ONU limit not recorded',
        used: port.connectedCustomersCount,
        reserved: '',
        faulty: '',
        free: limit !== undefined ? Math.max(0, limit - port.connectedCustomersCount) : 'Not known',
      });
    }
  }
  return {
    id: 'capacity',
    title: 'Splitter and PON port capacity',
    definition: 'Splitter outputs counted from each output record (capacity from the ratio). PON port use is the number of customers recorded on the port; its capacity is the vendor ONU limit when someone recorded it. Live ONU counts need a connection to the OLT.',
    columns: [col('kind', 'Kind'), col('id', 'Id'), col('name', 'Name'), col('where', 'Box or OLT'), col('capacity', 'Capacity'), col('used', 'Used'), col('reserved', 'Reserved'), col('faulty', 'Faulty'), col('free', 'Free')],
    rows,
    notes: [`Online ONUs per port: ${NO_LIVE_CONNECTION}.`],
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
    definition: 'Customer status and ONT record status as recorded by people. Online, offline and LOS need a live connection to the OLT and are not shown.',
    columns: [col('what', 'What'), col('status', 'Status'), col('count', 'Count')],
    rows,
    notes: [`Online / offline / LOS: ${NO_LIVE_CONNECTION}.`, ...(filters.area?.trim() ? [`Only customers with area "${filters.area.trim()}". ONT records are not filtered by area.`] : [])],
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

function liveReport(): ReportTable {
  return {
    id: 'live',
    title: 'Live monitoring: optical readings, alarms from devices, availability',
    definition: 'These need a live connection to your OLTs (Phase 7). Until then nothing is shown, so no number here can be mistaken for a reading.',
    columns: [col('report', 'Report'), col('state', 'State')],
    rows: [
      { report: 'ONT online / offline / LOS and history', state: NO_LIVE_CONNECTION },
      { report: 'Optical readings and trends from devices', state: NO_LIVE_CONNECTION },
      { report: 'Device alarms', state: NO_LIVE_CONNECTION },
      { report: 'Network availability', state: NO_LIVE_CONNECTION },
      { report: 'Cable TV (HFC/RF) levels', state: 'Not built (Phase 6)' },
    ],
    notes: ['Field light readings are on each customer and in Topology, Readings and lengths; they are meter readings, not live.'],
    noLiveConnection: true,
  };
}

/** Every report, in the order the Reports screen shows them. */
export function buildReports(data: ReportData, filters: ReportFilters = {}, today = new Date().toISOString().slice(0, 10)): ReportTable[] {
  const faults = faultReport(data, filters);
  return [
    inventoryReport(data, filters),
    cableLengthReport(data),
    coreReport(data),
    capacityReport(data),
    customerReport(data, filters),
    faults.summary,
    faults.repair,
    workOrderReport(data, filters),
    permissionReport(data, today),
    liveReport(),
  ];
}

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
