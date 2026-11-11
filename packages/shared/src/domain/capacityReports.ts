import { SCENARIO_STATUS_LABELS } from '../model/planningSchemas';
import type { Setting } from '../model/types';
import {
  boxDemand,
  CAPACITY_STATE_WORDS,
  type CapacityData,
  type CapacityLine,
  capacityLines,
  capacityTotals,
  isWaitingCustomer,
  oltCardCapacity,
  PLAN_STATE_WORDS,
  planCounts,
  pointInZone,
  zonesOfLine,
  zonesWithBoundary,
} from './capacityPlanning';
import { CAPACITY_KIND_LABELS, type CapacitySettings, capacitySettingSources, DEFAULT_CAPACITY_SETTINGS } from './capacitySettings';
import type { OpticalSettings } from './opticalSettings';
import { DEFAULT_OSP_SETTINGS, type OspSettings } from './ospSettings';
import { evaluateScenario, SCENARIO_LINE_STATE_WORDS } from './planningScenarios';
import type { ReportCell, ReportColumn, ReportTable } from './reports';

/**
 * Network mapping Phase 18: the capacity planning reports. Built from the records only, by the
 * functions in `capacityPlanning.ts` and `planningScenarios.ts`. Planned and built are separate
 * columns or separate rows everywhere; scenarios are a separate report and never enter the others.
 */

export interface CapacityReportOptions {
  capacity?: CapacitySettings;
  /** The settings records, so each report can say where its warning levels came from. */
  settingRecords?: readonly Setting[];
  osp?: OspSettings;
  optical?: OpticalSettings;
}

const col = (key: string, label: string): ReportColumn => ({ key, label });

const capText = (l: CapacityLine) => (l.capacity === undefined ? 'Not recorded' : l.capacity);

const STATE_ORDER: Record<CapacityLine['state'], number> = { over: 0, full: 1, nearly_full: 2, not_known: 3, ok: 4 };

function levelsNote(options: CapacityReportOptions): string {
  const sources = capacitySettingSources([...(options.settingRecords ?? [])]);
  return `"Nearly full" levels: ${sources.map((s) => `${CAPACITY_KIND_LABELS[s.def.kind]} ${s.value}%${s.fromSetting ? ' (your setting)' : ''}`).join('; ')}. Defaults are planning proposals, not standards; change them on the Capacity dashboard.`;
}

function useReport(lines: readonly CapacityLine[], options: CapacityReportOptions): ReportTable {
  const rows: Record<string, ReportCell>[] = [...lines]
    .sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name))
    .map((l) => ({
      kind: CAPACITY_KIND_LABELS[l.kind],
      id: l.id,
      name: l.name,
      where: l.where,
      plan: PLAN_STATE_WORDS[l.plan],
      capacity: capText(l),
      used: l.used,
      planned: l.heldForPlanned,
      reserved: l.reserved,
      faulty: l.faulty,
      free: l.capacity === undefined ? 'Not known' : l.free,
      notRecorded: l.notRecorded,
      state: CAPACITY_STATE_WORDS[l.state],
      notes: l.notes.join(' '),
    }));
  const unknown = lines.filter((l) => l.capacity === undefined).length;
  return {
    id: 'capacity-use',
    title: 'Capacity: used, planned and free, per element',
    definition:
      'One row per splitter, PON port, OLT card, ODF, cable, duct, pole and rack, from the records. Used = taken by built records. Planned = held by planned, proposed or awaiting-review records, or by customers waiting to be connected; never added to used. Free = recorded as free only. Not recorded = positions with no record: neither free nor used. "Built or planned" is the element itself: a planned element\'s capacity is planned capacity.',
    columns: [
      col('kind', 'Kind'),
      col('id', 'Id'),
      col('name', 'Name'),
      col('where', 'Where'),
      col('plan', 'Built or planned'),
      col('capacity', 'Capacity'),
      col('used', 'Used (built)'),
      col('planned', 'Held for planned'),
      col('reserved', 'Reserved'),
      col('faulty', 'Faulty'),
      col('free', 'Free'),
      col('notRecorded', 'Not recorded'),
      col('state', 'State'),
      col('notes', 'Notes'),
    ],
    rows,
    notes: [
      levelsNote(options),
      ...(unknown > 0 ? [`${unknown} element(s) have no recorded capacity (ONU limit, pole allowance, rack height or ODF panels). Their free room is "Not known", never assumed.`] : []),
      'Rejected field captures are left out. Live ONU counts need a connection to the OLT; these are the records.',
    ],
  };
}

function totalsReport(lines: readonly CapacityLine[]): ReportTable {
  const rows = capacityTotals(lines).map((t) => ({
    kind: CAPACITY_KIND_LABELS[t.kind],
    plan: t.built ? 'Built' : 'Planned, proposed or awaiting review',
    elements: t.elements,
    capacity: t.capacityNotRecorded ? `${t.capacity} (${t.capacityNotRecorded} with capacity not recorded)` : t.capacity,
    used: t.used,
    planned: t.heldForPlanned,
    reserved: t.reserved,
    faulty: t.faulty,
    free: t.free,
    notRecorded: t.notRecorded,
    warnings: [t.over ? `${t.over} over` : '', t.full ? `${t.full} full` : '', t.nearlyFull ? `${t.nearlyFull} nearly full` : ''].filter(Boolean).join(', ') || 'None',
  }));
  return {
    id: 'planned-vs-built-capacity',
    title: 'Capacity planned against built',
    definition:
      'The per-element figures added up by kind, with built elements and planned elements (planned, proposed, awaiting office review) in separate rows that are never added together. Within built elements, "Held for planned" is use by planned records and waiting customers.',
    columns: [
      col('kind', 'Kind'),
      col('plan', 'Elements that are'),
      col('elements', 'Elements'),
      col('capacity', 'Capacity'),
      col('used', 'Used (built)'),
      col('planned', 'Held for planned'),
      col('reserved', 'Reserved'),
      col('faulty', 'Faulty'),
      col('free', 'Free'),
      col('notRecorded', 'Not recorded'),
      col('warnings', 'Warnings'),
    ],
    rows,
    notes: ['Capacity counts only elements whose capacity is recorded.'],
  };
}

function planReport(data: CapacityData): ReportTable {
  const rows = planCounts(data).map((r) => ({
    what: r.what,
    built: r.counts.built,
    planned: r.counts.planned,
    proposed: r.counts.proposed,
    awaiting: r.counts.awaiting_review,
    rejected: r.counts.rejected,
  }));
  return {
    id: 'planned-vs-built',
    title: 'Records planned against built',
    definition:
      'Each record counted once by what it says: equipment status "Planned" or a field capture awaiting office review (or rejected); a cable marked Planned or with a proposed, planned or under-construction route; span and duct status; cable-on-pole status; a customer "Pending Installation" counted as planned. Built = everything else.',
    columns: [col('what', 'Records'), col('built', 'Built'), col('planned', 'Planned'), col('proposed', 'Proposed'), col('awaiting', 'Awaiting review'), col('rejected', 'Rejected')],
    rows,
    notes: ['A splitter has no status of its own: it follows the box it sits in.'],
  };
}

function oltReport(data: CapacityData, options: CapacityReportOptions): ReportTable {
  const rows = oltCardCapacity(data, { settings: options.capacity }).map((r) => ({
    olt: `${r.oltName} (${r.oltId})`,
    plan: PLAN_STATE_WORDS[r.plan],
    place: r.shelf || r.slot ? `Shelf ${r.shelf} slot ${r.slot}` : '—',
    what: r.what,
    ports: r.line ? capText(r.line) : '—',
    used: r.line?.used ?? '',
    planned: r.line?.heldForPlanned ?? '',
    reserved: r.line?.reserved ?? '',
    faulty: r.line?.faulty ?? '',
    free: r.line ? r.line.free : '',
    notRecorded: r.line?.notRecorded ?? '',
    onts: r.line ? r.ontCount : '',
    ontLimit: r.line ? (r.ontLimit !== undefined ? r.ontLimit : `Not recorded on ${r.limitsMissing} port(s)`) : '',
    state: r.line ? CAPACITY_STATE_WORDS[r.line.state] : '',
  }));
  return {
    id: 'olt-chassis-capacity',
    title: 'OLT chassis: cards, PON ports and empty slots',
    definition:
      'From the chassis recorded on each OLT (Phase 10). A PON port is used when ONTs or active customers are recorded on it, a feeder, splitter or ODF patch is linked to it, or it is marked Active; held for planned when only waiting customers are on it; reserved and faulty as marked; free otherwise. Empty slots are slots recorded with no card. ONU limits add up only when every port on the card has one.',
    columns: [
      col('olt', 'OLT'),
      col('plan', 'Built or planned'),
      col('place', 'Shelf and slot'),
      col('what', 'What'),
      col('ports', 'PON ports'),
      col('used', 'Used'),
      col('planned', 'Held for planned'),
      col('reserved', 'Reserved'),
      col('faulty', 'Faulty'),
      col('free', 'Free'),
      col('notRecorded', 'Not recorded'),
      col('onts', 'ONTs on record'),
      col('ontLimit', 'ONU limit'),
      col('state', 'State'),
    ],
    rows,
    notes: rows.length === 0 ? ['No OLT has PON ports or a chassis recorded.'] : ['An OLT with no chassis recorded is listed as "PON ports (chassis not recorded)".'],
  };
}

function zoneReport(data: CapacityData, lines: readonly CapacityLine[]): ReportTable {
  const zones = zonesWithBoundary(data.zones ?? []);
  const noBoundary = (data.zones ?? []).length - zones.length;
  type Acc = { capacity: number; unknown: number; used: number; planned: number; reserved: number; faulty: number; free: number; notRecorded: number; warn: number; elements: number; plannedCapacity: number };
  const acc = new Map<string, Acc>();
  let crossing = 0;
  let unplaced = 0;
  const add = (zone: string, l: CapacityLine) => {
    const key = `${zone}\u0000${l.kind}`;
    const a = acc.get(key) ?? acc.set(key, { capacity: 0, unknown: 0, used: 0, planned: 0, reserved: 0, faulty: 0, free: 0, notRecorded: 0, warn: 0, elements: 0, plannedCapacity: 0 }).get(key)!;
    a.elements += 1;
    if (l.plan !== 'built') {
      a.plannedCapacity += l.capacity ?? 0;
      return;
    }
    if (l.capacity === undefined) a.unknown += 1;
    else a.capacity += l.capacity;
    a.used += l.used;
    a.planned += l.heldForPlanned;
    a.reserved += l.reserved;
    a.faulty += l.faulty;
    a.free += l.free;
    a.notRecorded += l.notRecorded;
    if (l.state === 'nearly_full' || l.state === 'full' || l.state === 'over') a.warn += 1;
  };
  for (const l of lines) {
    const z = zonesOfLine(l, zones);
    if (z === 'crosses') {
      crossing += 1;
      continue;
    }
    if (z === 'not_placed') {
      unplaced += 1;
      continue;
    }
    if (z.length === 0) add('Outside every drawn zone', l);
    for (const zone of z) add(`${zone.name} (${zone.areaCode})`, l);
  }
  // Waiting customers by where they are, against free splitter outputs in the zone.
  const waiting = new Map<string, number>();
  for (const c of data.customers) {
    if (!isWaitingCustomer(c)) continue;
    const inZones = zones.filter((z) => pointInZone([c.lat, c.lng], z.boundaryCoords));
    for (const name of inZones.length ? inZones.map((z) => `${z.name} (${z.areaCode})`) : ['Outside every drawn zone']) waiting.set(name, (waiting.get(name) ?? 0) + 1);
  }
  const rows: Record<string, ReportCell>[] = [...acc.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, a]) => {
      const [zone, kind] = key.split('\u0000');
      const splitter = kind === 'splitter';
      const want = splitter ? waiting.get(zone) ?? 0 : undefined;
      return {
        zone,
        kind: CAPACITY_KIND_LABELS[kind as CapacityLine['kind']],
        elements: a.elements,
        capacity: a.unknown ? `${a.capacity} (${a.unknown} not recorded)` : a.capacity,
        used: a.used,
        planned: a.planned,
        reserved: a.reserved,
        faulty: a.faulty,
        free: a.free,
        notRecorded: a.notRecorded,
        warn: a.warn,
        plannedCapacity: a.plannedCapacity,
        waiting: want ?? '',
        spare: splitter ? (a.free - (want ?? 0) >= 0 ? `Spare ${a.free - (want ?? 0)}` : `Short by ${(want ?? 0) - a.free}`) : '',
      };
    });
  return {
    id: 'capacity-zones',
    title: 'Spare and shortage per zone',
    definition:
      'Each element counted in the drawn zone its position is in (a box, an OLT, a pole, the site of a rack). A cable or duct counts in a zone only when every recorded point is inside it. Built elements only in the figures; elements that are only planned add to "Planned capacity" instead. Waiting customers (Pending Installation) are counted by their house position, against the free splitter outputs of the zone, as if every waiting customer still needed one.',
    columns: [
      col('zone', 'Zone'),
      col('kind', 'Kind'),
      col('elements', 'Elements'),
      col('capacity', 'Capacity (built)'),
      col('used', 'Used'),
      col('planned', 'Held for planned'),
      col('reserved', 'Reserved'),
      col('faulty', 'Faulty'),
      col('free', 'Free'),
      col('notRecorded', 'Not recorded'),
      col('warn', 'Nearly full or full'),
      col('plannedCapacity', 'Planned capacity (not built)'),
      col('waiting', 'Customers waiting'),
      col('spare', 'Spare or short'),
    ],
    rows,
    notes: [
      ...(zones.length === 0 ? ['No zone has a drawn boundary, so everything is "Outside every drawn zone". Draw zone boundaries on the Zones screen.'] : []),
      ...(noBoundary > 0 ? [`${noBoundary} zone(s) have no boundary drawn: nothing is counted in them.`] : []),
      ...(crossing > 0 ? [`${crossing} cable(s) or duct(s) cross a zone edge: not counted in any zone.`] : []),
      ...(unplaced > 0 ? [`${unplaced} element(s) have no usable position (not placed yet, or the site has no position): not counted in any zone.`] : []),
      'A zone that overlaps another counts its elements in both.',
    ],
  };
}

function demandReport(data: CapacityData): ReportTable {
  const rows = boxDemand(data).map((d) => ({
    box: d.boxName,
    id: d.boxId || '—',
    plan: d.boxPlan ? PLAN_STATE_WORDS[d.boxPlan] : 'Not known',
    waiting: d.waiting,
    holding: d.holdingOutput,
    needing: d.needingOutput,
    splitters: d.splitters,
    free: d.freeOutputs,
    notRecorded: d.notRecordedOutputs,
    result:
      d.state === 'box_not_recorded'
        ? 'Box not recorded on the customer'
        : d.state === 'no_splitter'
          ? `No splitter recorded: short by ${d.shortBy}`
          : d.state === 'short'
            ? `Short by ${d.shortBy} output(s)`
            : `Enough: ${d.freeOutputs - d.needingOutput} spare`,
  }));
  return {
    id: 'capacity-demand',
    title: 'Customers waiting against free outputs, per box',
    definition:
      'Customers with status Pending Installation, grouped by the box on their record. "Already hold an output" have a splitter and output recorded; the rest need a free one. Free outputs are those recorded free on the splitters in that box. Outputs not recorded are never counted as free.',
    columns: [
      col('box', 'Box'),
      col('id', 'Box id'),
      col('plan', 'Box is'),
      col('waiting', 'Customers waiting'),
      col('holding', 'Already hold an output'),
      col('needing', 'Need an output'),
      col('splitters', 'Splitters in box'),
      col('free', 'Free outputs'),
      col('notRecorded', 'Outputs not recorded'),
      col('result', 'Result'),
    ],
    rows,
    notes: rows.length === 0 ? ['No customer is waiting to be connected (status Pending Installation).'] : ['Customers are named by box only; no names or addresses are in this report.'],
  };
}

function scenarioReport(data: CapacityData, options: CapacityReportOptions): ReportTable {
  const rows: Record<string, ReportCell>[] = [];
  for (const scenario of data.planningScenarios ?? []) {
    const result = evaluateScenario(data, scenario, { optical: options.optical, osp: options.osp });
    if (result.lines.length === 0) {
      rows.push({ scenario: scenario.name, status: SCENARIO_STATUS_LABELS[scenario.status], what: 'No planned lines yet', element: '', now: '', ifBuilt: '', state: '', notes: '' });
      continue;
    }
    for (const l of result.lines) {
      rows.push({
        scenario: scenario.name,
        status: SCENARIO_STATUS_LABELS[scenario.status],
        what: l.what,
        element: l.element,
        now: l.now,
        ifBuilt: l.ifBuilt,
        state: SCENARIO_LINE_STATE_WORDS[l.state],
        notes: l.notes.join(' '),
      });
    }
  }
  return {
    id: 'capacity-scenarios',
    title: 'Expansion scenarios: capacity if built (not on the network)',
    definition:
      'Each planning scenario worked out on top of the records as they are today, line by line in order. These are plans only: nothing here is a network record, and no other report counts them.',
    columns: [col('scenario', 'Scenario'), col('status', 'Status'), col('what', 'Planned line'), col('element', 'Looked at'), col('now', 'Now (records)'), col('ifBuilt', 'If built'), col('state', 'Result'), col('notes', 'Notes')],
    rows,
    notes: rows.length === 0 ? ['No planning scenarios yet. Add one on the Capacity dashboard.'] : [],
  };
}

/** Every Phase 18 report, in the order the Reports screen shows them. */
export function capacityPlanningReports(data: CapacityData, options: CapacityReportOptions = {}): ReportTable[] {
  const settings = options.capacity ?? DEFAULT_CAPACITY_SETTINGS;
  const lines = capacityLines(data, { settings, osp: options.osp ?? DEFAULT_OSP_SETTINGS });
  return [useReport(lines, options), oltReport(data, { ...options, capacity: settings }), zoneReport(data, lines), demandReport(data), planReport(data), totalsReport(lines), scenarioReport(data, options)];
}
