/**
 * PON overview for the map: which PON port serves which area, street, cable, box, splitter and
 * customer, how full each PON and splitter is, and the calculated light level at each splitter.
 *
 * Built only from recorded fiber links (`tracePonTree`, `traceCoreUpstream`, `traceCustomerCores`).
 * A customer or box whose fibers are not recorded end to end is not given a PON; it is counted as
 * "not traced" instead. Every level here is calculated from the PON port's recorded launch power and
 * the Optical settings; with no recorded launch power there is no level.
 */
import type { Customer, Splitter } from '../model/types';
import { isActiveCustomer } from './connectionRules';
import { buildFiberIndex, type FiberData } from './fiberIndex';
import { traceCoreUpstream, traceCustomerCores, tracePonTree } from './fiberPath';
import { DEFAULT_OPTICAL_SETTINGS, type OpticalSettings } from './opticalSettings';

export type PonKey = string;
export const ponKeyOf = (oltId: string, ponPortId: string): PonKey => `${oltId}/${ponPortId}`;

export interface CustomerCounts {
  total: number;
  active: number;
  suspended: number;
  pending: number;
  disconnected: number;
}

export interface OutputCounts {
  total: number;
  used: number;
  free: number;
  reserved: number;
  faulty: number;
}

export interface PonSummary {
  key: PonKey;
  oltId: string;
  oltName: string;
  ponPortId: string;
  portNumber: number;
  /** As the OLT writes it, when recorded. */
  vendorAddress?: string;
  opticsClass?: string;
  /** Recorded launch power. */
  txPowerDbm?: number;
  /** Vendor ONU limit for the port, when recorded. */
  maxOnu?: number;
  /** Customer areas, most customers first. */
  areas: { name: string; customers: number }[];
  /** Streets of the boxes on this PON, as recorded on them. */
  streets: string[];
  customers: CustomerCounts;
  /** Outputs of the last splitters (the ones customers plug into): what is free for new connections. */
  accessOutputs: OutputCounts;
  splitterIds: string[];
  cableIds: string[];
  /** Boxes (FDT, FAT, closures) the PON passes through. */
  equipmentIds: string[];
  customerIds: string[];
  /** Calculated ONT receive levels of its traced customers. */
  rxRange?: { minDbm: number; maxDbm: number };
  maxSplitProduct: number;
  problems: string[];
  /** Splitter boxes and customers, for zooming to the PON. */
  bounds?: { south: number; west: number; north: number; east: number };
}

export interface SplitterSummary {
  splitterId: string;
  name: string;
  ratio: string;
  boxId: string;
  ponKey?: PonKey;
  /** 1 = nearest the OLT. Undefined when its input is not traced to a PON port. */
  stage?: number;
  /** Feeds customers directly (no splitter below it). */
  access: boolean;
  outputs: OutputCounts;
  lossDb: number;
  /** Calculated downstream level at the input, and at each output. */
  inputDbm?: number;
  outputDbm?: number;
  /** Splitters fed from its outputs. */
  childIds: string[];
}

export interface CableUse {
  cableId: string;
  ponKeys: PonKey[];
  coresTotal: number;
  coresUsed: number;
  coresFree: number;
}

export interface CustomerPon {
  customerId: string;
  ponKey: PonKey;
  /** Calculated ONT receive level (downstream). */
  rxDbm?: number;
  /** Splitter stages from OLT to this customer. */
  splitterIds: string[];
}

export interface PonOverview {
  pons: PonSummary[];
  splitters: Map<string, SplitterSummary>;
  cables: Map<string, CableUse>;
  /** Box id → PON keys passing through it. */
  equipment: Map<string, PonKey[]>;
  customers: Map<string, CustomerPon>;
  /** Customers with a recorded path not reaching any PON port. */
  notTraced: string[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function countCustomers(list: readonly Pick<Customer, 'status'>[]): CustomerCounts {
  const counts: CustomerCounts = { total: list.length, active: 0, suspended: 0, pending: 0, disconnected: 0 };
  for (const c of list) {
    if (c.status === 'Active') counts.active += 1;
    else if (c.status === 'Suspended') counts.suspended += 1;
    else if (c.status === 'Pending Installation') counts.pending += 1;
    else counts.disconnected += 1;
  }
  return counts;
}

export function countOutputs(splitter: Pick<Splitter, 'outputPorts'>): OutputCounts {
  const counts: OutputCounts = { total: splitter.outputPorts.length, used: 0, free: 0, reserved: 0, faulty: 0 };
  for (const p of splitter.outputPorts) {
    if (p.status === 'Occupied' || p.connectedCustomerId || p.connectedDropCableId) counts.used += 1;
    else if (p.status === 'Faulty') counts.faulty += 1;
    else if (p.status === 'Reserved') counts.reserved += 1;
    else counts.free += 1;
  }
  return counts;
}

const addOutputs = (a: OutputCounts, b: OutputCounts): OutputCounts => ({
  total: a.total + b.total,
  used: a.used + b.used,
  free: a.free + b.free,
  reserved: a.reserved + b.reserved,
  faulty: a.faulty + b.faulty,
});

/** Builds the PON overview of a whole network. */
export function buildPonOverview(data: FiberData, settings: OpticalSettings = DEFAULT_OPTICAL_SETTINGS): PonOverview {
  const index = buildFiberIndex(data);
  const customersById = new Map(data.customers.map((c) => [c.id, c]));
  const splitters = new Map<string, SplitterSummary>();
  const cables = new Map<string, CableUse>();
  const equipment = new Map<string, PonKey[]>();
  const customers = new Map<string, CustomerPon>();
  const pons: PonSummary[] = [];

  const children = new Map<string, string[]>();
  for (const sp of data.splitters) {
    if (sp.inputPort.connectedSplitterId) children.set(sp.inputPort.connectedSplitterId, [...(children.get(sp.inputPort.connectedSplitterId) ?? []), sp.id]);
  }
  for (const sp of data.splitters) {
    splitters.set(sp.id, {
      splitterId: sp.id,
      name: sp.name,
      ratio: sp.ratio,
      boxId: sp.terminalBoxId,
      access: true,
      outputs: countOutputs(sp),
      lossDb: sp.insertionLossDb,
      childIds: [...(children.get(sp.id) ?? [])],
    });
  }

  const addPon = (map: Map<string, PonKey[]>, id: string | undefined, key: PonKey) => {
    if (!id) return;
    const list = map.get(id) ?? [];
    if (!list.includes(key)) map.set(id, [...list, key]);
  };

  for (const olt of data.equipment) {
    if (olt.type !== 'OLT') continue;
    for (const pon of olt.ponPorts ?? []) {
      const tree = tracePonTree(olt.id, pon.id, data, { settings, index });
      if (!tree) continue;
      const key = ponKeyOf(olt.id, pon.id);
      const cableIds = [...new Set(tree.coreKeys.map((k) => k.slice(0, k.lastIndexOf('#'))))];
      const boxIds = new Set<string>();
      for (const id of cableIds) {
        const cable = index.cables.get(id);
        if (!cable) continue;
        const use = cables.get(id) ?? { cableId: id, ponKeys: [], coresTotal: cable.fiberCount, coresUsed: 0, coresFree: 0 };
        if (!use.ponKeys.includes(key)) use.ponKeys.push(key);
        cables.set(id, use);
        if (cable.type !== 'Drop Fiber') for (const end of [cable.startEquipmentId, cable.endEquipmentId]) if (end && end !== olt.id) boxIds.add(end);
      }
      for (const sid of tree.splitterIds) {
        const sp = index.splitters.get(sid);
        if (sp) boxIds.add(sp.terminalBoxId);
        const summary = splitters.get(sid);
        if (summary) summary.ponKey = key;
      }
      for (const id of boxIds) addPon(equipment, id, key);

      const treeCustomers = tree.customers.map((c) => customersById.get(c.id) ?? c);
      const areaCount = new Map<string, number>();
      for (const c of treeCustomers) if (c.area) areaCount.set(c.area, (areaCount.get(c.area) ?? 0) + 1);
      const streets = new Set<string>();
      let south = Infinity, west = Infinity, north = -Infinity, east = -Infinity;
      const grow = (p: { lat: number; lng: number }) => {
        if (!p.lat && !p.lng) return;
        south = Math.min(south, p.lat); north = Math.max(north, p.lat);
        west = Math.min(west, p.lng); east = Math.max(east, p.lng);
      };
      // Streets come from the boxes customers are served from (those holding a splitter), not the exchange.
      const splitterBoxes = new Set(tree.splitterIds.map((sid) => index.splitters.get(sid)?.terminalBoxId));
      for (const id of boxIds) {
        const box = index.equipment.get(id);
        if (!box) continue;
        if (box.street && splitterBoxes.has(box.id)) streets.add(box.street);
        if (splitterBoxes.has(box.id)) grow(box);
      }
      for (const c of treeCustomers) grow(c);

      let access: OutputCounts = { total: 0, used: 0, free: 0, reserved: 0, faulty: 0 };
      for (const sid of tree.splitterIds) {
        const summary = splitters.get(sid);
        if (!summary) continue;
        const sp = index.splitters.get(sid)!;
        const feedsSplitter = summary.childIds.length > 0 || sp.outputPorts.some((p) => p.connectedDropCableId && p.connectedCore && hasSplitterOn(data, p.connectedDropCableId, p.connectedCore));
        summary.access = !feedsSplitter;
        if (summary.access) access = addOutputs(access, summary.outputs);
      }

      pons.push({
        key,
        oltId: olt.id,
        oltName: olt.name,
        ponPortId: pon.id,
        portNumber: pon.portNumber,
        ...(pon.vendorAddress ? { vendorAddress: pon.vendorAddress } : {}),
        ...(pon.opticsClass ? { opticsClass: pon.opticsClass } : {}),
        ...(pon.txPowerDbm !== undefined ? { txPowerDbm: pon.txPowerDbm } : {}),
        ...(pon.maxOnu !== undefined ? { maxOnu: pon.maxOnu } : {}),
        areas: [...areaCount.entries()].sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, customers: n })),
        streets: [...streets],
        customers: countCustomers(treeCustomers),
        accessOutputs: access,
        splitterIds: tree.splitterIds,
        cableIds,
        equipmentIds: [...boxIds],
        customerIds: treeCustomers.map((c) => c.id),
        maxSplitProduct: tree.maxSplitProduct,
        problems: tree.problems,
        ...(Number.isFinite(south) ? { bounds: { south, west, north, east } } : {}),
      });
    }
  }

  // Core use per traced cable.
  for (const use of cables.values()) {
    const cable = index.cables.get(use.cableId)!;
    use.coresUsed = cable.cores.filter((k) => k.status === 'In Use' || k.assignments?.some((a) => !a.releasedAt)).length;
    use.coresFree = Math.max(0, use.coresTotal - use.coresUsed);
  }

  // Levels at each splitter input, from the recorded launch power.
  const levelAt = new Map<string, number | undefined>();
  const stageOf = new Map<string, number | undefined>();
  const resolve = (sp: Splitter, seen: Set<string>): void => {
    if (levelAt.has(sp.id) || seen.has(sp.id)) return;
    seen.add(sp.id);
    const summary = splitters.get(sp.id)!;
    let level: number | undefined;
    let stage: number | undefined;
    if (sp.inputPort.connectedSplitterId) {
      const parent = index.splitters.get(sp.inputPort.connectedSplitterId);
      if (parent) {
        resolve(parent, seen);
        const p = splitters.get(parent.id)!;
        level = p.outputDbm;
        stage = stageOf.get(parent.id) !== undefined ? stageOf.get(parent.id)! + 1 : undefined;
      }
    } else if (sp.inputPort.connectedCableId && sp.inputPort.connectedCore) {
      const path = traceCoreUpstream(sp.inputPort.connectedCableId, sp.inputPort.connectedCore, data, { settings, index });
      if (path.complete && path.pon) {
        stage = path.steps.filter((s) => s.kind === 'splitter').length + 1;
        if (path.pon.txPowerDbm !== undefined) level = path.pon.txPowerDbm - path.steps.reduce((n, s) => n + (s.lossDb ?? 0), 0);
      }
    }
    levelAt.set(sp.id, level);
    stageOf.set(sp.id, stage);
    if (stage !== undefined) summary.stage = stage;
    if (level !== undefined) {
      summary.inputDbm = round1(level);
      const loss = sp.insertionLossDb > 0 ? sp.insertionLossDb : (settings.splitterDb[sp.ratio] ?? 0);
      summary.outputDbm = round1(level - loss);
    }
  };
  for (const sp of data.splitters) resolve(sp, new Set());

  // Customers: PON and calculated Rx from their own recorded path.
  const notTraced: string[] = [];
  const rx = new Map<PonKey, number[]>();
  for (const c of data.customers) {
    if (!isActiveCustomer(c)) continue;
    if (c.accessNetwork === 'hfc') continue;
    const path = traceCustomerCores(c, data, { settings, index });
    if (!path.complete || !path.olt || !path.pon) {
      if (c.splitterId || c.terminalBoxId) notTraced.push(c.id);
      continue;
    }
    const key = ponKeyOf(path.olt.id, path.pon.id);
    const down = path.directions.find((d) => d.direction === 'downstream');
    const level = path.pon.txPowerDbm !== undefined && down ? round1(path.pon.txPowerDbm - down.budget.totalLossDb) : undefined;
    customers.set(c.id, { customerId: c.id, ponKey: key, ...(level !== undefined ? { rxDbm: level } : {}), splitterIds: path.splitterIds });
    if (level !== undefined) rx.set(key, [...(rx.get(key) ?? []), level]);
  }
  for (const pon of pons) {
    const levels = rx.get(pon.key);
    if (levels?.length) pon.rxRange = { minDbm: Math.min(...levels), maxDbm: Math.max(...levels) };
  }

  pons.sort((a, b) => a.oltName.localeCompare(b.oltName) || a.portNumber - b.portNumber);
  return { pons, splitters, cables, equipment, customers, notTraced };
}

function hasSplitterOn(data: FiberData, cableId: string, core: number): boolean {
  return data.splitters.some((s) => s.inputPort.connectedCableId === cableId && s.inputPort.connectedCore === core);
}
