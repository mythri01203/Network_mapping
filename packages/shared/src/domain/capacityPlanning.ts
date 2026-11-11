import type { NetworkSnapshot } from '../model/collections';
import type { Cable, Customer, Equipment, LatLng, NetworkZone, PonPort, Splitter } from '../model/types';
import { CAPACITY_KIND_LABELS, type CapacityKind, type CapacitySettings, DEFAULT_CAPACITY_SETTINGS } from './capacitySettings';
import { activeAssignment, completeCores, coreUtilization, effectiveCoreStatus, isOdfType } from './fiberCommands';
import { ductPlaces, formatFill, placeFill } from './ospDucts';
import { DEFAULT_OSP_SETTINGS, type OspSettings } from './ospSettings';
import { isPoleType } from './outsidePlant';
import { ponPortUsage } from './ponUsage';
import { rackElevation } from './sitesRacks';
import { splitterOutputUse } from './splitterManagement';

/**
 * Network mapping Phase 18: capacity worked out from the records only, for planning.
 *
 * - Every element (splitter, PON port, OLT card, ODF, cable, duct, pole, rack) has a capacity, what
 *   built records use, what planned records hold, reserved, faulty, free and "not recorded". A
 *   position nobody recorded is never counted as free, and a capacity nobody recorded is "not known".
 * - Planned, proposed and awaiting-review records are kept apart from built ones in every figure:
 *   an element that is itself only planned has `plan` set, and the use by waiting customers or
 *   planned cables is `heldForPlanned`, never `used`.
 * - "Nearly full" uses the levels in `capacitySettings.ts` (settings `capacity.*`). Warnings only.
 */

/* ------------------------------------------------------------------ */
/* Built or planned                                                    */
/* ------------------------------------------------------------------ */

export type PlanState = 'built' | 'planned' | 'proposed' | 'awaiting_review' | 'rejected';

export const PLAN_STATE_WORDS: Record<PlanState, string> = {
  built: 'Built',
  planned: 'Planned',
  proposed: 'Proposed',
  awaiting_review: 'Awaiting office review',
  rejected: 'Rejected capture',
};

/** A field capture waiting or rejected, else the recorded status. */
export function equipmentPlanState(e: Pick<Equipment, 'status' | 'reviewStatus'>): PlanState {
  if (e.reviewStatus === 'rejected') return 'rejected';
  if (e.reviewStatus === 'awaiting_review') return 'awaiting_review';
  return e.status === 'Planned' ? 'planned' : 'built';
}

/** A cable marked Planned, or whose route is only proposed, planned or under construction, is not built. */
export function cablePlanState(c: Pick<Cable, 'status' | 'routeStatus'>): PlanState {
  if (c.routeStatus === 'Proposed') return 'proposed';
  if (c.status === 'Planned' || c.routeStatus === 'Planned' || c.routeStatus === 'Under Construction') return 'planned';
  return 'built';
}

/** Spans, ducts: `proposed` and `planned` are not built; `built` and `verified` are. */
export const structurePlanState = (status: string): PlanState => (status === 'proposed' ? 'proposed' : status === 'planned' ? 'planned' : 'built');

/** A customer waiting to be connected holds capacity but is not a built connection. */
export const isWaitingCustomer = (c: Pick<Customer, 'status'>): boolean => c.status === 'Pending Installation';

/* ------------------------------------------------------------------ */
/* Lines                                                               */
/* ------------------------------------------------------------------ */

export type CapacityState = 'ok' | 'nearly_full' | 'full' | 'over' | 'not_known';

export const CAPACITY_STATE_WORDS: Record<CapacityState, string> = {
  ok: 'Room left',
  nearly_full: 'Nearly full',
  full: 'Full',
  over: 'Over capacity',
  not_known: 'Not known',
};

export interface CapacityLine {
  kind: CapacityKind;
  id: string;
  name: string;
  /** The box, OLT, site or structure it belongs to, in words. */
  where: string;
  /** Whether the element itself is built. A planned element's capacity is planned capacity. */
  plan: PlanState;
  /** Positions it has, from the records. Undefined: not recorded. */
  capacity?: number;
  /** Taken by built records. */
  used: number;
  /** Taken by planned, proposed or awaiting-review records, or by customers waiting to be connected. */
  heldForPlanned: number;
  reserved: number;
  faulty: number;
  /** Recorded as free. Never includes positions nobody recorded. */
  free: number;
  /** Positions with no record: neither free nor used. */
  notRecorded: number;
  state: CapacityState;
  /** Plain words, such as "2 of 8 free". */
  summary: string;
  notes: string[];
  /** Map position, for zones. Undefined when not placed. */
  at?: LatLng;
  /** Every recorded point of a line (cables, ducts), for zones. */
  line?: LatLng[];
}

export type CapacityData = Pick<NetworkSnapshot, 'equipment' | 'cables' | 'splitters' | 'customers'> &
  Partial<Pick<NetworkSnapshot, 'closures' | 'onts' | 'services' | 'spans' | 'attachments' | 'ducts' | 'sites' | 'racks' | 'zones' | 'planningScenarios'>>;

export interface CapacityOptions {
  settings?: CapacitySettings;
  osp?: OspSettings;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

/** The state from the recorded figures and the level for this kind. */
function stateOf(kind: CapacityKind, capacity: number | undefined, taken: number, free: number, settings: CapacitySettings): CapacityState {
  if (capacity === undefined || capacity <= 0) return 'not_known';
  if (taken > capacity) return 'over';
  if (free <= 0) return 'full';
  // Free is only what is recorded as free: positions not recorded count against the room left.
  return 1 - free / capacity >= settings.nearlyFull[kind] ? 'nearly_full' : 'ok';
}

function finish(
  base: Omit<CapacityLine, 'state' | 'summary'> & { unit?: string },
  settings: CapacitySettings,
): CapacityLine {
  const { unit = '', ...line } = base;
  const taken = line.used + line.heldForPlanned + line.reserved + line.faulty;
  const state = stateOf(line.kind, line.capacity, taken, line.free, settings);
  const u = unit ? ` ${unit}` : '';
  let summary: string;
  if (line.capacity === undefined) {
    summary = `${line.used + line.heldForPlanned}${u} on record · capacity not recorded`;
  } else {
    const parts = [`${line.free} of ${line.capacity}${u} free`];
    if (line.heldForPlanned) parts.push(`${line.heldForPlanned} held for planned work`);
    if (line.notRecorded) parts.push(`${line.notRecorded} not recorded`);
    summary = parts.join(', ');
    if (state === 'over') summary = `${taken}${u} on ${line.capacity}: over by ${taken - line.capacity}`;
  }
  if (state === 'nearly_full') line.notes.push(`Nearly full: ${pct(1 - line.free / (line.capacity ?? 1))} taken or not recorded; the level for ${CAPACITY_KIND_LABELS[line.kind].toLowerCase()} is ${pct(settings.nearlyFull[line.kind])} (Capacity settings).`);
  return { ...line, state, summary };
}

const placed = (e: Pick<Equipment, 'lat' | 'lng' | 'officeMustPlace'> | undefined): LatLng | undefined =>
  e && !e.officeMustPlace && Number.isFinite(e.lat) && Number.isFinite(e.lng) ? [e.lat, e.lng] : undefined;

/* ---------- splitters ---------- */

function splitterLines(data: CapacityData, byId: Map<string, Equipment>, settings: CapacitySettings): CapacityLine[] {
  const customers = new Map(data.customers.map((c) => [c.id, c]));
  const cables = new Map(data.cables.map((c) => [c.id, c]));
  const splitterPlan = (sp: Splitter): PlanState => {
    const box = byId.get(sp.terminalBoxId);
    return box ? equipmentPlanState(box) : 'built';
  };
  const out: CapacityLine[] = [];
  for (const sp of data.splitters) {
    const box = byId.get(sp.terminalBoxId);
    const plan = splitterPlan(sp);
    if (plan === 'rejected') continue;
    const { outputs, counts } = splitterOutputUse(data, sp);
    let used = 0;
    let held = 0;
    for (const o of outputs) {
      if (o.state !== 'used') continue;
      const planned =
        o.links.length > 0 &&
        o.links.every((l) =>
          l.kind === 'customer'
            ? !!customers.get(l.id) && isWaitingCustomer(customers.get(l.id)!)
            : l.kind === 'fiber'
              ? !!cables.get(l.cableId) && cablePlanState(cables.get(l.cableId)!) !== 'built'
              : (() => {
                  const child = data.splitters.find((s) => s.id === l.id);
                  return !!child && splitterPlan(child) !== 'built';
                })(),
        );
      if (planned) held += 1;
      else used += 1;
    }
    const notes: string[] = [];
    if (!box) notes.push(`Its box ${sp.terminalBoxId || '(none)'} is not on record, so where it is is not known.`);
    if (counts.markedOnly) notes.push(`${counts.markedOnly} output(s) are marked in use with nothing linked recorded.`);
    if (counts.faultyInUse) notes.push(`${counts.faultyInUse} faulty output(s) still have something connected.`);
    out.push(
      finish(
        {
          kind: 'splitter',
          id: sp.id,
          name: sp.name,
          where: box ? `${box.name} (${box.id})` : `${sp.terminalBoxId || 'Box'} (not on record)`,
          plan,
          capacity: counts.capacity,
          used,
          heldForPlanned: held,
          reserved: counts.reserved,
          faulty: counts.faulty,
          free: counts.free,
          notRecorded: counts.notRecorded,
          notes,
          unit: 'outputs',
          ...(placed(box) ? { at: placed(box) } : {}),
        },
        settings,
      ),
    );
  }
  return out;
}

/* ---------- PON ports and OLT cards ---------- */

type PortUse = 'used' | 'planned' | 'reserved' | 'faulty' | 'free';

interface PonPortFigures {
  use: PortUse;
  ontCount: number;
  waiting: number;
  limit?: number;
}

function ponFigures(data: CapacityData, olt: Equipment, port: PonPort, patched: Set<string>): PonPortFigures {
  const usage = ponPortUsage(data, olt.id, port.id);
  const ontCount = usage?.ontCount ?? 0;
  const waiting = (usage?.customers ?? []).filter(isWaitingCustomer).length;
  const linked = !!port.connectedFeederCableId || !!port.connectedSplitterId || !!port.feederCore || patched.has(`${olt.id}#${port.id}`);
  let use: PortUse;
  if (port.status === 'Faulty') use = 'faulty';
  else if (ontCount > waiting || linked || port.status === 'Active') use = 'used';
  else if (ontCount > 0) use = 'planned';
  else if (port.status === 'Reserved') use = 'reserved';
  else use = 'free';
  return { use, ontCount, waiting, ...(port.maxOnu !== undefined ? { limit: port.maxOnu } : {}) };
}

function patchedPonPorts(equipment: readonly Equipment[]): Set<string> {
  const set = new Set<string>();
  for (const e of equipment) for (const panel of e.odfPanels ?? []) for (const p of panel.ports) if (p.patch) set.add(`${p.patch.oltId}#${p.patch.ponPortId}`);
  return set;
}

function ponLines(data: CapacityData, settings: CapacitySettings, patched: Set<string>): CapacityLine[] {
  const out: CapacityLine[] = [];
  for (const olt of data.equipment) {
    if (!(olt.ponPorts ?? []).length) continue;
    const plan = equipmentPlanState(olt);
    if (plan === 'rejected') continue;
    for (const port of [...(olt.ponPorts ?? [])].sort((a, b) => a.portNumber - b.portNumber)) {
      const f = ponFigures(data, olt, port, patched);
      const built = Math.max(0, f.ontCount - f.waiting);
      const notes: string[] = [];
      let free = 0;
      let reserved = 0;
      let faulty = 0;
      if (f.limit !== undefined) {
        const room = Math.max(0, f.limit - built - f.waiting);
        if (port.status === 'Faulty') {
          faulty = room;
          notes.push('The port is marked faulty: no new ONT counted as possible until it is repaired.');
        } else if (port.status === 'Reserved' && f.ontCount === 0) {
          reserved = room;
          notes.push('The port is reserved.');
        } else free = room;
      } else notes.push('ONU limit not recorded on this port, so its room left is not known.');
      if (f.waiting) notes.push(`${f.waiting} customer(s) waiting to be connected are recorded on this port.`);
      out.push(
        finish(
          {
            kind: 'pon_port',
            id: `${olt.id} / ${port.vendorAddress ?? port.id}`,
            name: `${olt.name} port ${port.portNumber}`,
            where: `${olt.name} (${olt.id})`,
            plan,
            ...(f.limit !== undefined ? { capacity: f.limit } : {}),
            used: built,
            heldForPlanned: f.waiting,
            reserved,
            faulty,
            free,
            notRecorded: 0,
            notes,
            unit: 'ONTs',
            ...(placed(olt) ? { at: placed(olt) } : {}),
          },
          settings,
        ),
      );
    }
  }
  return out;
}

export interface OltCardRow {
  oltId: string;
  oltName: string;
  plan: PlanState;
  shelf: string;
  slot: string;
  /** "Empty slot", "Card GPHF (PON)", "PON ports on no recorded card". */
  what: string;
  line?: CapacityLine;
  ontCount: number;
  /** Sum of the recorded ONU limits, or undefined when any port has none. */
  ontLimit?: number;
  limitsMissing: number;
}

/** OLT chassis capacity: each card's PON ports in use, free, reserved, faulty; empty slots; ports on no card. */
export function oltCardCapacity(data: CapacityData, options: CapacityOptions = {}): OltCardRow[] {
  const settings = options.settings ?? DEFAULT_CAPACITY_SETTINGS;
  const patched = patchedPonPorts(data.equipment);
  const rows: OltCardRow[] = [];
  for (const olt of data.equipment) {
    const ports = olt.ponPorts ?? [];
    const plan = equipmentPlanState(olt);
    if (plan === 'rejected' || (!olt.chassis && ports.length === 0)) continue;
    const byPortId = new Map(ports.map((p) => [p.id, p]));
    const onCard = new Set<string>();
    const lineFor = (id: string, name: string, where: string, list: PonPort[], portCount: number | undefined, notes: string[]): Omit<OltCardRow, 'oltId' | 'oltName' | 'plan' | 'shelf' | 'slot' | 'what'> => {
      const figures = list.map((p) => ponFigures(data, olt, p, patched));
      const count = (u: PortUse) => figures.filter((f) => f.use === u).length;
      const capacity = portCount ?? (list.length > 0 ? list.length : undefined);
      if (portCount === undefined && list.length > 0) notes.push(`Port count on the card not recorded: counted from the ${list.length} port(s) listed on it, so it may have more.`);
      const notRecorded = portCount !== undefined ? Math.max(0, portCount - list.length) : 0;
      if (notRecorded) notes.push(`${notRecorded} port(s) on the card are not described, so they are not counted as free.`);
      const limitsMissing = figures.filter((f) => f.limit === undefined).length;
      const line = finish(
        {
          kind: 'olt_card',
          id,
          name,
          where,
          plan,
          ...(capacity !== undefined ? { capacity } : {}),
          used: count('used'),
          heldForPlanned: count('planned'),
          reserved: count('reserved'),
          faulty: count('faulty'),
          free: count('free'),
          notRecorded,
          notes,
          unit: 'PON ports',
          ...(placed(olt) ? { at: placed(olt) } : {}),
        },
        settings,
      );
      return {
        line,
        ontCount: figures.reduce((s, f) => s + f.ontCount, 0),
        ...(limitsMissing === 0 && figures.length > 0 ? { ontLimit: figures.reduce((s, f) => s + (f.limit ?? 0), 0) } : {}),
        limitsMissing,
      };
    };
    for (const shelf of olt.chassis?.shelves ?? []) {
      for (const slot of shelf.slots) {
        const base = { oltId: olt.id, oltName: olt.name, plan, shelf: shelf.label, slot: slot.label };
        if (!slot.card) {
          rows.push({ ...base, what: 'Empty slot (as recorded)', ontCount: 0, limitsMissing: 0 });
          continue;
        }
        const card = slot.card;
        const list = (card.ponPortIds ?? []).map((id) => byPortId.get(id)).filter((p): p is PonPort => !!p);
        for (const p of list) onCard.add(p.id);
        const kindWord = card.kind ? card.kind.toUpperCase() === 'PON' ? 'PON' : card.kind : 'kind not recorded';
        const what = `Card ${card.model ?? '(model not recorded)'} (${kindWord})`;
        if (card.kind && card.kind !== 'pon' && list.length === 0) {
          rows.push({ ...base, what, ontCount: 0, limitsMissing: 0 });
          continue;
        }
        const missing = (card.ponPortIds ?? []).length - list.length;
        const notes = missing > 0 ? [`${missing} port id(s) on the card are not PON ports of this OLT.`] : [];
        rows.push({ ...base, what, ...lineFor(`${olt.id} / ${shelf.label}/${slot.label}`, `${olt.name} shelf ${shelf.label} slot ${slot.label}`, `${olt.name} (${olt.id})`, list, card.portCount, notes) });
      }
    }
    const loose = ports.filter((p) => !onCard.has(p.id));
    if (loose.length > 0) {
      rows.push({
        oltId: olt.id,
        oltName: olt.name,
        plan,
        shelf: '',
        slot: '',
        what: olt.chassis ? 'PON ports on no recorded card' : 'PON ports (chassis not recorded)',
        ...lineFor(`${olt.id} / no card`, `${olt.name} ports not on a card`, `${olt.name} (${olt.id})`, loose, undefined, []),
      });
    }
  }
  return rows;
}

/* ---------- ODF ---------- */

function odfLines(data: CapacityData, settings: CapacitySettings): CapacityLine[] {
  const out: CapacityLine[] = [];
  for (const odf of data.equipment) {
    if (!isOdfType(odf.type)) continue;
    const plan = equipmentPlanState(odf);
    if (plan === 'rejected') continue;
    const ports = (odf.odfPanels ?? []).flatMap((p) => p.ports);
    let used = 0;
    let reserved = 0;
    let faulty = 0;
    let free = 0;
    let fedFree = 0;
    let notRecorded = 0;
    for (const p of ports) {
      if (p.status === 'damaged') faulty += 1;
      else if (p.patch || p.status === 'in_use') used += 1;
      else if (p.status === 'reserved') reserved += 1;
      else if (p.status === 'unknown') notRecorded += 1;
      else {
        free += 1;
        if (p.feederCableId) fedFree += 1;
      }
    }
    const notes: string[] = [];
    if (ports.length === 0) notes.push('No panels or adapters recorded, so its capacity is not known.');
    if (free > 0) notes.push(`${fedFree} of the ${free} free adapter(s) have a fibre behind them, ready to patch; the rest need a fibre first.`);
    if (notRecorded) notes.push(`${notRecorded} adapter(s) have the state "not known": not counted as free.`);
    out.push(
      finish(
        {
          kind: 'odf',
          id: odf.id,
          name: odf.name,
          where: odf.site?.trim() || odf.area || 'Not recorded',
          plan,
          ...(ports.length > 0 ? { capacity: ports.length } : {}),
          used,
          heldForPlanned: 0,
          reserved,
          faulty,
          free,
          notRecorded,
          notes,
          unit: 'adapters',
          ...(placed(odf) ? { at: placed(odf) } : {}),
        },
        settings,
      ),
    );
  }
  return out;
}

/* ---------- cables ---------- */

function cableLines(data: CapacityData, byId: Map<string, Equipment>, settings: CapacitySettings): CapacityLine[] {
  const waiting = new Set(data.customers.filter(isWaitingCustomer).map((c) => c.id));
  const out: CapacityLine[] = [];
  for (const cable of data.cables) {
    if (cable.fiberCount <= 0 || cable.type === 'Coaxial Cable') continue;
    const u = coreUtilization(cable);
    let held = 0;
    for (const core of completeCores(cable)) {
      const status = effectiveCoreStatus(core);
      if (status !== 'In Use' && status !== 'Spliced') continue;
      const customerId = activeAssignment(core)?.customerId ?? core.customerId;
      if (customerId && waiting.has(customerId)) held += 1;
    }
    const notes: string[] = [];
    if (u.other) notes.push(`${u.other} fibre(s) have a state nobody confirmed (unknown, unverified, under maintenance or retired): not counted as free.`);
    const from = cable.startEquipmentId ? byId.get(cable.startEquipmentId)?.name ?? cable.startEquipmentId : 'not recorded';
    const to = cable.endEquipmentId ? byId.get(cable.endEquipmentId)?.name ?? cable.endEquipmentId : 'not recorded';
    out.push(
      finish(
        {
          kind: 'cable_cores',
          id: cable.id,
          name: cable.name,
          where: `${from} to ${to}`,
          plan: cablePlanState(cable),
          capacity: u.total,
          used: u.inUse - held,
          heldForPlanned: held,
          reserved: u.reserved,
          faulty: u.damaged,
          free: u.available,
          notRecorded: u.other,
          notes,
          unit: 'fibres',
          ...(cable.coordinates.length > 0 ? { line: cable.coordinates } : {}),
        },
        settings,
      ),
    );
  }
  return out;
}

/* ---------- ducts ---------- */

function ductLines(data: CapacityData, settings: CapacitySettings, osp: OspSettings): CapacityLine[] {
  const cables = new Map(data.cables.map((c) => [c.id, c]));
  const plannedCable = (id: string) => {
    const c = cables.get(id);
    return !!c && cablePlanState(c) !== 'built';
  };
  const out: CapacityLine[] = [];
  for (const duct of data.ducts ?? []) {
    const places = ductPlaces(duct);
    const subs = places.filter((p) => p.kind === 'subduct');
    const notes: string[] = [];
    let capacity: number;
    let used = 0;
    let held = 0;
    let faulty = 0;
    let free = 0;
    let notRecorded = 0;
    const cablesIn = (key: string) => places.filter((p) => p.key === key || (p.kind === 'microduct' && p.subductId === key)).flatMap((p) => p.cableIds);
    if (subs.length === 0) {
      if (duct.wayCount && duct.wayCount > 1) {
        capacity = duct.wayCount;
        const inside = duct.cableIds;
        if (inside.length > 0) {
          if (inside.every(plannedCable)) held = 1;
          else used = 1;
          notes.push(`${inside.length} cable(s) are recorded in the duct but not in which of its ${duct.wayCount} ways: counted as one way taken, the rest not recorded.`);
        } else notes.push(`The ${duct.wayCount} ways are not described one by one, so none is counted as free.`);
        notRecorded = capacity - used - held;
      } else {
        capacity = 1;
        const inside = duct.cableIds;
        if (duct.condition === 'blocked') faulty = 1;
        else if (inside.length > 0) {
          if (inside.every(plannedCable)) held = 1;
          else used = 1;
        } else free = 1;
      }
    } else {
      const undescribed = duct.wayCount && duct.wayCount > subs.length ? duct.wayCount - subs.length : 0;
      capacity = subs.length + undescribed;
      notRecorded = undescribed;
      if (undescribed) notes.push(`${undescribed} way(s) are counted on the duct but not described: not counted as free.`);
      let notChecked = 0;
      let damaged = 0;
      for (const sub of subs) {
        const inside = cablesIn(sub.key);
        if (sub.effectiveCondition === 'blocked') faulty += 1;
        else if (inside.length > 0) {
          if (inside.every(plannedCable)) held += 1;
          else used += 1;
        } else {
          free += 1;
          if (!sub.effectiveCondition) notChecked += 1;
        }
        if (sub.effectiveCondition === 'damaged') damaged += 1;
      }
      if (notChecked) notes.push(`${notChecked} free way(s) were never checked; they are free as recorded but may be blocked.`);
      if (damaged) notes.push(`${damaged} way(s) are recorded as damaged.`);
      if (duct.cableIds.length > 0) notes.push(`${duct.cableIds.length} cable(s) are recorded in the duct itself, outside its sub-ducts.`);
    }
    let fillUnknown = 0;
    for (const place of places) {
      if (place.innerWays > 0 || place.cableIds.length === 0) continue;
      const fill = placeFill(place, data.cables, osp);
      if (fill.ratio === undefined) fillUnknown += 1;
      else if (fill.over) notes.push(`${place.label} is ${formatFill(fill.ratio)} full, above the ${formatFill(fill.limit)} level for ${fill.cableCount} cable(s) (Poles and routes settings).`);
    }
    if (fillUnknown) notes.push(`How full ${fillUnknown} way(s) are is not known: a diameter is not recorded.`);
    const line = finish(
      {
        kind: 'duct',
        id: duct.id,
        name: duct.name,
        where: `${duct.fromStructureId ?? 'not recorded'} to ${duct.toStructureId ?? 'not recorded'}`,
        plan: structurePlanState(duct.status),
        capacity,
        used,
        heldForPlanned: held,
        reserved: 0,
        faulty,
        free,
        notRecorded,
        notes,
        unit: 'ways',
        line: duct.coordinates,
      },
      settings,
    );
    // A way over its fill level is nearly full, whatever the way count says.
    if (line.state === 'ok' && notes.some((n) => n.includes('full, above the'))) line.state = 'nearly_full';
    out.push(line);
  }
  return out;
}

/* ---------- poles ---------- */

export interface CablesOnPole {
  built: string[];
  planned: string[];
}

/** Cables recorded on each pole (on the pole itself or on a span ending at it), built and planned apart. */
export function cablesOnPoles(data: CapacityData): Map<string, CablesOnPole> {
  const cables = new Map(data.cables.map((c) => [c.id, c]));
  const spanEnds = new Map((data.spans ?? []).map((s) => [s.id, [s.fromStructureId, s.toStructureId]]));
  const state = new Map<string, Map<string, boolean>>();
  for (const a of data.attachments ?? []) {
    const cable = cables.get(a.cableId);
    if (!cable) continue;
    const built = a.status !== 'planned' && cablePlanState(cable) === 'built';
    const poles = a.structureId ? [a.structureId] : (spanEnds.get(a.spanId ?? '') ?? []);
    for (const pole of poles) {
      const m = state.get(pole) ?? state.set(pole, new Map()).get(pole)!;
      m.set(cable.id, (m.get(cable.id) ?? false) || built);
    }
  }
  const out = new Map<string, CablesOnPole>();
  for (const [pole, m] of state) {
    out.set(pole, { built: [...m].filter(([, b]) => b).map(([id]) => id), planned: [...m].filter(([, b]) => !b).map(([id]) => id) });
  }
  return out;
}

function poleLines(data: CapacityData, settings: CapacitySettings): CapacityLine[] {
  const onPoles = cablesOnPoles(data);
  const out: CapacityLine[] = [];
  for (const pole of data.equipment) {
    if (!isPoleType(pole.type)) continue;
    const plan = equipmentPlanState(pole);
    if (plan === 'rejected') continue;
    const on = onPoles.get(pole.id) ?? { built: [], planned: [] };
    const cap = pole.attachmentCapacity;
    const notes: string[] = [];
    if (cap === undefined) notes.push('How many cables the owner allows on this pole is not recorded.');
    else if (pole.attachmentCapacitySource) notes.push(`Allowed number from: ${pole.attachmentCapacitySource}.`);
    out.push(
      finish(
        {
          kind: 'pole',
          id: pole.id,
          name: pole.name,
          where: [pole.ownerName, pole.street, pole.area].filter((s) => s?.trim()).join(', ') || 'Not recorded',
          plan,
          ...(cap !== undefined ? { capacity: cap } : {}),
          used: on.built.length,
          heldForPlanned: on.planned.length,
          reserved: 0,
          faulty: 0,
          free: cap !== undefined ? Math.max(0, cap - on.built.length - on.planned.length) : 0,
          notRecorded: 0,
          notes,
          unit: 'cables',
          ...(placed(pole) ? { at: placed(pole) } : {}),
        },
        settings,
      ),
    );
  }
  return out;
}

/* ---------- racks ---------- */

function rackLines(data: CapacityData, settings: CapacitySettings): CapacityLine[] {
  const sites = new Map((data.sites ?? []).map((s) => [s.id, s]));
  const out: CapacityLine[] = [];
  for (const rack of data.racks ?? []) {
    const el = rackElevation(rack, data.equipment);
    const site = sites.get(rack.siteId);
    const notes: string[] = [];
    let used = 0;
    let held = 0;
    for (const slot of el.slots) {
      const units = Math.max(0, Math.min(slot.to, el.height ?? slot.to) - slot.from + 1);
      if (equipmentPlanState(slot.equipment) === 'built') used += units;
      else held += units;
    }
    if (el.height === undefined) notes.push('Rack height not recorded, so no unit is counted as free.');
    if (el.heightUnknown) notes.push(`${el.heightUnknown} item(s) have no height recorded: counted as one unit each, so more may be taken.`);
    if (el.unplaced.length) notes.push(`${el.unplaced.length} item(s) are in this rack with no unit written: not counted.`);
    const at: LatLng | undefined = site?.lat !== undefined && site?.lng !== undefined ? [site.lat, site.lng] : undefined;
    out.push(
      finish(
        {
          kind: 'rack',
          id: rack.id,
          name: rack.name,
          where: site ? site.name : `${rack.siteId} (not on record)`,
          plan: 'built',
          ...(el.height !== undefined ? { capacity: el.height } : {}),
          used,
          heldForPlanned: held,
          reserved: 0,
          faulty: 0,
          free: el.freeUnits?.length ?? 0,
          notRecorded: 0,
          notes,
          unit: 'units',
          ...(at ? { at } : {}),
        },
        settings,
      ),
    );
  }
  return out;
}

/** Every element's capacity, from the records. Rejected captures are left out. */
export function capacityLines(data: CapacityData, options: CapacityOptions = {}): CapacityLine[] {
  const settings = options.settings ?? DEFAULT_CAPACITY_SETTINGS;
  const osp = options.osp ?? DEFAULT_OSP_SETTINGS;
  const byId = new Map(data.equipment.map((e) => [e.id, e]));
  const patched = patchedPonPorts(data.equipment);
  const cards = oltCardCapacity(data, { settings }).flatMap((r) => (r.line ? [r.line] : []));
  return [
    ...splitterLines(data, byId, settings),
    ...ponLines(data, settings, patched),
    ...cards,
    ...odfLines(data, settings),
    ...cableLines(data, byId, settings),
    ...ductLines(data, settings, osp),
    ...poleLines(data, settings),
    ...rackLines(data, settings),
  ];
}

/* ------------------------------------------------------------------ */
/* Totals and zones                                                    */
/* ------------------------------------------------------------------ */

export interface CapacityTotals {
  kind: CapacityKind;
  /** Built elements, or elements that are only planned: never added together. */
  built: boolean;
  elements: number;
  /** Elements whose capacity is not recorded. Their positions are not in `capacity`. */
  capacityNotRecorded: number;
  capacity: number;
  used: number;
  heldForPlanned: number;
  reserved: number;
  faulty: number;
  free: number;
  notRecorded: number;
  nearlyFull: number;
  full: number;
  over: number;
}

/** Totals by kind, with built and planned elements apart. */
export function capacityTotals(lines: readonly CapacityLine[]): CapacityTotals[] {
  const map = new Map<string, CapacityTotals>();
  for (const l of lines) {
    const built = l.plan === 'built';
    const key = `${l.kind}#${built}`;
    const t =
      map.get(key) ??
      map.set(key, { kind: l.kind, built, elements: 0, capacityNotRecorded: 0, capacity: 0, used: 0, heldForPlanned: 0, reserved: 0, faulty: 0, free: 0, notRecorded: 0, nearlyFull: 0, full: 0, over: 0 }).get(key)!;
    t.elements += 1;
    if (l.capacity === undefined) t.capacityNotRecorded += 1;
    else t.capacity += l.capacity;
    t.used += l.used;
    t.heldForPlanned += l.heldForPlanned;
    t.reserved += l.reserved;
    t.faulty += l.faulty;
    t.free += l.free;
    t.notRecorded += l.notRecorded;
    if (l.state === 'nearly_full') t.nearlyFull += 1;
    if (l.state === 'full') t.full += 1;
    if (l.state === 'over') t.over += 1;
  }
  const order = Object.keys(CAPACITY_KIND_LABELS);
  return [...map.values()].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || Number(b.built) - Number(a.built));
}

/** Ray casting on `[lat, lng]`. A point on the edge may fall either side. */
export function pointInZone([lat, lng]: LatLng, ring: readonly LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [yi, xi] = ring[i];
    const [yj, xj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export const zonesWithBoundary = (zones: readonly NetworkZone[] = []): NetworkZone[] => zones.filter((z) => z.boundaryCoords.length >= 3);

/**
 * The drawn zones an element is in: by its position, or for a line only when every recorded point
 * is inside (a line that crosses an edge belongs to no zone, and is listed as such).
 */
export function zonesOfLine(line: Pick<CapacityLine, 'at' | 'line'>, zones: readonly NetworkZone[]): NetworkZone[] | 'crosses' | 'not_placed' {
  if (line.at) return zones.filter((z) => pointInZone(line.at!, z.boundaryCoords));
  if (line.line && line.line.length > 0) {
    const all = zones.filter((z) => line.line!.every((p) => pointInZone(p, z.boundaryCoords)));
    if (all.length > 0) return all;
    return zones.some((z) => line.line!.some((p) => pointInZone(p, z.boundaryCoords))) ? 'crosses' : [];
  }
  return 'not_placed';
}

/* ------------------------------------------------------------------ */
/* Demand: customers waiting                                           */
/* ------------------------------------------------------------------ */

export interface BoxDemand {
  boxId: string;
  boxName: string;
  boxPlan?: PlanState;
  /** Customers with status Pending Installation recorded on this box. */
  waiting: number;
  /** Of those, how many already hold a splitter output. */
  holdingOutput: number;
  needingOutput: number;
  /** Free outputs on the splitters in this box (all splitters share the box's built or planned state). */
  freeOutputs: number;
  notRecordedOutputs: number;
  splitters: number;
  /** Needing an output minus free ones, when above 0. */
  shortBy: number;
  state: 'enough' | 'short' | 'no_splitter' | 'box_not_recorded';
  at?: LatLng;
}

/** Customers waiting to be connected against free splitter outputs, per box. */
export function boxDemand(data: CapacityData): BoxDemand[] {
  const byId = new Map(data.equipment.map((e) => [e.id, e]));
  const splitterIds = new Set(data.splitters.map((s) => s.id));
  const groups = new Map<string, Customer[]>();
  for (const c of data.customers) {
    if (!isWaitingCustomer(c)) continue;
    const key = c.terminalBoxId?.trim() ?? '';
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const rows: BoxDemand[] = [];
  for (const [boxId, list] of groups) {
    const box = boxId ? byId.get(boxId) : undefined;
    const holdingOutput = list.filter((c) => c.splitterId && splitterIds.has(c.splitterId) && c.splitterOutputPort > 0).length;
    const needingOutput = list.length - holdingOutput;
    const inBox = boxId ? data.splitters.filter((s) => s.terminalBoxId === boxId) : [];
    let freeOutputs = 0;
    let notRecordedOutputs = 0;
    for (const s of inBox) {
      const { counts } = splitterOutputUse(data, s);
      freeOutputs += counts.free;
      notRecordedOutputs += counts.notRecorded;
    }
    const shortBy = Math.max(0, needingOutput - freeOutputs);
    const state: BoxDemand['state'] = !boxId || !box ? 'box_not_recorded' : inBox.length === 0 ? 'no_splitter' : shortBy > 0 ? 'short' : 'enough';
    rows.push({
      boxId: boxId || '',
      boxName: box?.name ?? (boxId ? `${boxId} (not on record)` : 'Box not recorded'),
      ...(box ? { boxPlan: equipmentPlanState(box) } : {}),
      waiting: list.length,
      holdingOutput,
      needingOutput,
      freeOutputs,
      notRecordedOutputs,
      splitters: inBox.length,
      shortBy: state === 'no_splitter' ? needingOutput : shortBy,
      state,
      ...(placed(box) ? { at: placed(box) } : {}),
    });
  }
  return rows.sort((a, b) => b.shortBy - a.shortBy || b.waiting - a.waiting || a.boxName.localeCompare(b.boxName));
}

/* ------------------------------------------------------------------ */
/* Planned against built                                               */
/* ------------------------------------------------------------------ */

export interface PlanCountRow {
  what: string;
  counts: Record<PlanState, number>;
}

const zero = (): Record<PlanState, number> => ({ built: 0, planned: 0, proposed: 0, awaiting_review: 0, rejected: 0 });

/** How many records of each kind are built, planned, proposed, awaiting review or rejected. */
export function planCounts(data: CapacityData): PlanCountRow[] {
  const row = (what: string, states: PlanState[]): PlanCountRow => {
    const counts = zero();
    for (const s of states) counts[s] += 1;
    return { what, counts };
  };
  const byId = new Map(data.equipment.map((e) => [e.id, e]));
  return [
    row('Network items (poles, boxes, OLTs…)', data.equipment.map(equipmentPlanState)),
    row('Cables', data.cables.map(cablePlanState)),
    row('Splitters (by the box they sit in)', data.splitters.map((s) => (byId.get(s.terminalBoxId) ? equipmentPlanState(byId.get(s.terminalBoxId)!) : 'built'))),
    row('Spans (pole to pole)', (data.spans ?? []).map((s) => structurePlanState(s.status))),
    row('Ducts', (data.ducts ?? []).map((d) => structurePlanState(d.status))),
    row('Cables on poles and spans (attachments)', (data.attachments ?? []).map((a) => (a.status === 'planned' ? 'planned' : 'built'))),
    row('Customers (waiting = planned, disconnected left out)', data.customers.filter((c) => c.status !== 'Disconnected').map((c) => (isWaitingCustomer(c) ? 'planned' : 'built'))),
  ];
}
