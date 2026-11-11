import type { Cable, Customer, Equipment, Fault, JointClosure, Splitter, TracePathNode } from '../model/types';
import { hasRecordedLocation } from './defaults';
import { type CorePathResult, traceCoreUpstream, traceCustomerCores } from './fiberPath';
import { polylineLengthMeters } from './geo';
import { calculateOpticalLossBudget, resolveSplitterLoss, type SplitterLossSpec } from './lossEngine';
import {
  DEFAULT_OPTICAL_SETTINGS,
  fiberLossDb,
  type OpticalSettings,
  opticsClassForTechnology,
  rxBandFor,
} from './opticalSettings';
import { customersOnPonPort } from './ponUsage';
import { budgetStatusForBand, rxReadingOf } from './rxReading';

/** Downstream wavelength used for the path loss shown in this trace. */
const DOWNSTREAM_NM = 1490;

export const RX_WARNING_DBM = DEFAULT_OPTICAL_SETTINGS.rx.goodFloorDbm;
export const RX_SENSITIVITY_DBM = DEFAULT_OPTICAL_SETTINGS.rx.sensitivityDbm;

export interface TraceData {
  equipment: Equipment[];
  cables: Cable[];
  splitters: Splitter[];
  closures: JointClosure[];
  customers: Customer[];
  faults: Fault[];
}

export type BudgetStatus = 'Pass' | 'Warning' | 'Fail' | 'Unknown';

export interface TraceSummary {
  targetId: string;
  targetLabel: string;
  kind: 'customer' | 'equipment' | 'cable';
  totalLengthMeters: number;
  totalLossDb: number;
  txPowerDbm?: number;
  /** Worked out from the recorded launch and estimated loss. Absent when the launch is not recorded. */
  estimatedRxDbm?: number;
  /** A real meter or device reading only. */
  measuredRxDbm?: number;
  /** The customer's reading with its origin, for example "-20.1 dBm (Estimated)" or "Not recorded". */
  rxText?: string;
  budgetStatus: BudgetStatus;
  /** False when a link on the path is missing. Such a trace never carries a pass. */
  pathComplete: boolean;
  /** 'core' when the customer's fibers are recorded end to end; otherwise only cables were followed. */
  level?: 'core' | 'cable';
  downstreamCustomerCount: number;
  warnings: string[];
}

export interface TraceResult {
  nodes: TracePathNode[];
  cableIds: string[];
  equipmentIds: string[];
  summary: TraceSummary;
}

export interface UpstreamHop {
  cable: Cable;
  from?: Equipment;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

const isTrunkCable = (c: Cable) => c.cableCategory !== 'Coaxial' && c.type !== 'Drop Fiber';
const isCatv = (eq?: Equipment) => eq?.category === 'Cable TV Infrastructure';

/** Rates a receive level against the bands. Too much light fails too: 0 dBm is never a pass. */
export const budgetStatusFor = (rx?: number, settings: OpticalSettings = DEFAULT_OPTICAL_SETTINGS): BudgetStatus =>
  budgetStatusForBand(rxBandFor(rx, settings));

const equipmentNodeType = (eq: Equipment): TracePathNode['type'] => {
  if (eq.type === 'OLT') return 'OLT';
  if (eq.type === 'ODF' || eq.type === 'Fiber Patch Panel') return 'ODF';
  if (eq.type === 'FDMS' || eq.type === 'Fiber Distribution Cabinet') return 'FDMS';
  if (eq.type === 'FDT') return 'FDT';
  if (eq.type === 'FAT' || eq.type.includes('Terminal Box')) return 'FAT';
  if (eq.type.includes('Closure')) return 'Closure';
  if (eq.type === 'Fiber Splitter') return 'Splitter';
  if (eq.type === 'ONT' || eq.type === 'ONU') return 'ONT';
  return 'Equipment';
};

const equipmentStatus = (eq: Equipment): TracePathNode['status'] => {
  if (eq.status === 'Faulty') return 'Faulty';
  if (eq.status === 'Warning' || eq.status === 'Maintenance') return 'Warning';
  return 'Normal';
};

const cableStatus = (c: Cable): TracePathNode['status'] => {
  if (c.status === 'Damaged') return 'Faulty';
  if (c.status === 'Maintenance') return 'Warning';
  return 'Normal';
};

const cableLength = (c: Cable) =>
  c.lengthMeters > 0 ? c.lengthMeters : Math.round(polylineLengthMeters(c.coordinates || []));

/** Trunk cables that end at this equipment. More than one means the upstream path is ambiguous. */
export const upstreamCandidates = (equipmentId: string, data: Pick<TraceData, 'cables'>) =>
  data.cables.filter((c) => isTrunkCable(c) && c.endEquipmentId === equipmentId);

export interface UpstreamWalk {
  /** OLT first. */
  hops: UpstreamHop[];
  /** Where several cables end at one box and no record says which one serves this path. */
  ambiguousAt?: { equipmentId: string; cableIds: string[] };
}

/** The gap for a box fed by several cables when nothing on record picks one. */
export const ambiguousFeedGap = (a: NonNullable<UpstreamWalk['ambiguousAt']>) =>
  `${a.equipmentId} is fed by ${a.cableIds.length} cables (${a.cableIds.join(', ')}). No record says which one serves this path, so none was followed. Record the fiber link (splitter input or splice) to show the path.`;

/**
 * Walks trunk cables (end → start) from an equipment back to its serving OLT.
 * Hops are returned OLT-first. An OLT is always treated as the signal source,
 * so inter-OLT backhaul links are never followed. Where several cables end at a box and none of
 * them is a preferred (recorded) cable, the walk stops there and says so: it never picks one.
 */
export function walkUpstreamCables(
  startEquipmentId: string,
  data: TraceData,
  preferredCableIds: string[] = [],
): UpstreamWalk {
  const hops: UpstreamHop[] = [];
  const start = data.equipment.find((e) => e.id === startEquipmentId);
  if (!start || start.type === 'OLT') return { hops };

  const visitedCables = new Set<string>();
  const visitedEquipment = new Set<string>([startEquipmentId]);
  let currentId: string | undefined = startEquipmentId;

  for (let guard = 0; guard < 16 && currentId; guard++) {
    const atId: string = currentId;
    const candidates = data.cables.filter(
      (c) => isTrunkCable(c) && c.endEquipmentId === atId && !visitedCables.has(c.id),
    );
    if (candidates.length === 0) break;
    const preferred = candidates.find((c) => preferredCableIds.includes(c.id));
    if (!preferred && candidates.length > 1) {
      return { hops, ambiguousAt: { equipmentId: atId, cableIds: candidates.map((c) => c.id) } };
    }
    const cable = preferred ?? candidates[0];
    visitedCables.add(cable.id);
    const from = cable.startEquipmentId ? data.equipment.find((e) => e.id === cable.startEquipmentId) : undefined;
    hops.unshift({ cable, from });
    if (!from || from.type === 'OLT' || visitedEquipment.has(from.id)) break;
    visitedEquipment.add(from.id);
    currentId = from.id;
  }
  return { hops };
}

/** The hops of `walkUpstreamCables`. Stops at a box fed by several cables with none recorded. */
export function findUpstreamChain(
  startEquipmentId: string,
  data: TraceData,
  preferredCableIds: string[] = [],
): UpstreamHop[] {
  return walkUpstreamCables(startEquipmentId, data, preferredCableIds).hops;
}

/** Returns the OLT that ultimately feeds an equipment (or the equipment itself if it is an OLT). */
export function findServingOlt(equipmentId: string, data: TraceData, preferredCableIds: string[] = []) {
  const eq = data.equipment.find((e) => e.id === equipmentId);
  if (eq?.type === 'OLT') return { olt: eq, hops: [] as UpstreamHop[] };
  const hops = findUpstreamChain(equipmentId, data, preferredCableIds);
  const olt = hops[0]?.from?.type === 'OLT' ? hops[0].from : undefined;
  return { olt, hops };
}

/** Collects every cable/equipment downstream (start → end direction) of an equipment. */
export function collectDownstream(equipmentId: string, data: TraceData) {
  const cableIds = new Set<string>();
  const equipmentIds = new Set<string>([equipmentId]);
  const queue = [equipmentId];
  while (queue.length) {
    const current = queue.shift()!;
    data.cables
      .filter((c) => c.startEquipmentId === current)
      .forEach((c) => {
        const next = c.endEquipmentId;
        const nextEq = next ? data.equipment.find((e) => e.id === next) : undefined;
        // Do not cross into another OLT's serving area via backhaul links.
        if (nextEq?.type === 'OLT') return;
        if (cableIds.has(c.id)) return;
        cableIds.add(c.id);
        if (next && nextEq && !equipmentIds.has(next)) {
          equipmentIds.add(next);
          queue.push(next);
        }
      });
  }
  const customers = data.customers.filter((cu) => equipmentIds.has(cu.terminalBoxId));
  customers.forEach((cu) => {
    if (cu.dropCableId && data.cables.some((c) => c.id === cu.dropCableId)) cableIds.add(cu.dropCableId);
  });
  return { cableIds: [...cableIds], equipmentIds: [...equipmentIds], customers };
}

/** The PON port explicitly linked to this feeder, or named by the record. Never a guess. */
export const findPon = (olt: Equipment, feederCableId?: string, ponPortId?: string) =>
  olt.ponPorts?.find((p) => !!feederCableId && p.connectedFeederCableId === feederCableId) ||
  olt.ponPorts?.find((p) => !!ponPortId && p.id === ponPortId);

const cableRole = (cable: Cable, isFirstFromOlt: boolean): { type: TracePathNode['type']; label: string } => {
  if (cable.type === 'Drop Fiber') return { type: 'Drop', label: 'Drop Cable' };
  if (cable.type === 'Main Feeder Fiber' || isFirstFromOlt) return { type: 'Feeder', label: 'Feeder Cable' };
  if (cable.type === 'Distribution Fiber') return { type: 'Distribution', label: 'Distribution Cable' };
  return { type: 'Distribution', label: 'Branch Cable' };
};

class PathBuilder {
  nodes: TracePathNode[] = [];
  cableIds: string[] = [];
  equipmentIds: string[] = [];
  lengthMeters = 0;
  lossDb = 0;
  warnings: string[] = [];
  /** Set by `gap`: a link or value on the path itself is missing. */
  incomplete = false;
  /** The parts the one loss calculation adds up. */
  private connectorPairs = 0;
  private splitterSpecs: SplitterLossSpec[] = [];
  private spliceLossDb = 0;
  private closureIds = new Set<string>();
  private plannedCableIds = new Set<string>();
  readonly data: TraceData;
  private settings: OpticalSettings;

  constructor(data: TraceData, settings: OpticalSettings = DEFAULT_OPTICAL_SETTINGS) {
    this.data = data;
    this.settings = settings;
  }

  /** Records a missing link or value. The trace stops counting as complete. */
  gap(message: string) {
    this.incomplete = true;
    this.warnings.push(message);
  }

  get connectorLossDb() {
    return this.settings.connectorPairDb;
  }

  planCables(ids: (string | undefined)[]) {
    ids.forEach((id) => id && this.plannedCableIds.add(id));
  }

  add(node: TracePathNode, lossDb = 0) {
    this.lossDb += lossDb;
    this.nodes.push({ ...node, lossDb: round2(lossDb), cumulativeLossDb: round2(this.lossDb) });
  }

  /** Fiber length that has no hop of its own, such as a planned drop. */
  addDistance(meters: number) {
    this.lengthMeters += Math.max(0, meters);
  }

  /** The one loss calculation, over the same parts the hops show. */
  totalLossDb(): number {
    return calculateOpticalLossBudget(
      {
        totalDistanceMeters: this.lengthMeters,
        wavelengthNm: DOWNSTREAM_NM,
        splitters: this.splitterSpecs,
        connectorsCount: this.connectorPairs,
        recordedSpliceLossDb: round2(this.spliceLossDb),
      },
      this.settings,
    ).totalLossDb;
  }

  /** One estimated connector pair. */
  connector(): number {
    this.connectorPairs += 1;
    return this.settings.connectorPairDb;
  }

  addEquipment(eq: Equipment, details: string, withConnector = true) {
    const connectorLoss = withConnector ? this.connector() : 0;
    this.equipmentIds.push(eq.id);
    this.add(
      {
        type: equipmentNodeType(eq),
        id: eq.id,
        name: eq.name,
        details,
        status: equipmentStatus(eq),
        lat: eq.lat,
        lng: eq.lng,
      },
      connectorLoss,
    );
  }

  addSplitter(sp: Splitter, details: string, at?: Equipment, portFaulty = false) {
    const spec: SplitterLossSpec = { ratio: sp.ratio, ...(sp.insertionLossDb > 0 ? { lossDb: sp.insertionLossDb } : {}) };
    this.splitterSpecs.push(spec);
    const loss = resolveSplitterLoss(spec, this.settings) ?? 0;
    this.add(
      {
        type: 'Splitter',
        id: sp.id,
        name: sp.name,
        details: `Ratio ${sp.ratio} | ${details} | Insertion loss ${loss} dB`,
        status: sp.status === 'Faulty' || portFaulty ? 'Faulty' : sp.status === 'Maintenance' ? 'Warning' : 'Normal',
        lat: at?.lat,
        lng: at?.lng,
      },
      loss,
    );
  }

  addCable(cable: Cable, nodeType: TracePathNode['type'], label: string, coreNumber?: number) {
    const length = cableLength(cable);
    this.lengthMeters += length;
    this.cableIds.push(cable.id);
    this.plannedCableIds.add(cable.id);
    let status = cableStatus(cable);
    const core = coreNumber ? cable.cores.find((c) => c.coreNumber === coreNumber) : undefined;
    if (core && (core.status === 'Damaged' || core.status === 'Faulty' || core.status === 'Retired' || core.status === 'Under Maintenance')) {
      status = core.status === 'Under Maintenance' ? 'Warning' : 'Faulty';
      this.warnings.push(`Core ${coreNumber} on ${cable.id} is ${core.status}.`);
    }
    // The colour only when one is on record: a new cable with no scheme has none.
    const coreText = core ? ` | Core ${core.coreNumber}${core.colorName ? ` (${core.colorName})` : ''}` : '';
    if (length <= 0) this.gap(`${cable.id} has no length recorded, so its loss is not counted.`);
    const coords = cable.coordinates || [];
    const mid = coords[Math.floor(coords.length / 2)];
    this.add(
      {
        type: nodeType,
        id: cable.id,
        name: `${label}: ${cable.name}`,
        details: `${cable.fiberCount}F ${cable.installationType ?? 'installation not recorded'} | ${length} m${coreText}`,
        status,
        lat: mid?.[0],
        lng: mid?.[1],
        lengthMeters: length,
      },
      fiberLossDb(length, DOWNSTREAM_NM, this.settings),
    );
    this.addClosuresOn(cable);
  }

  /** Adds splice closures on a cable whose other leg (if any) is also part of this route. */
  private addClosuresOn(cable: Cable) {
    this.data.closures
      .filter((cl) => cl.cableAId === cable.id || cl.cableBId === cable.id)
      .filter((cl) => !this.closureIds.has(cl.id))
      .forEach((cl) => {
        const otherCableId = cl.cableAId === cable.id ? cl.cableBId : cl.cableAId;
        if (otherCableId && !this.plannedCableIds.has(otherCableId)) return;
        this.closureIds.add(cl.id);
        // Splices out of service or entered by mistake (Phase 8) no longer join anything.
        const splices = cl.splices.filter((s) => !s.retiredAt && s.status !== 'Unused' && (s.inputCableId === cable.id || s.outputCableId === cable.id));
        const avgLoss = splices.length
          ? splices.reduce((sum, s) => sum + (s.spliceLossDb ?? this.settings.fusionSpliceDb), 0) / splices.length
          : this.settings.fusionSpliceDb;
        this.spliceLossDb += avgLoss;
        const bad = splices.some((s) => s.status === 'Failed' || s.status === 'Damaged');
        if (bad) this.warnings.push(`Closure ${cl.id} has failed/damaged splice records.`);
        this.add(
          {
            type: 'Closure',
            id: cl.id,
            name: cl.name,
            details: `${cl.closureType} | ${splices.length} splice record(s) | Avg splice loss ${round2(avgLoss)} dB`,
            status: bad ? 'Warning' : 'Normal',
            lat: cl.lat,
            lng: cl.lng,
          },
          avgLoss,
        );
      });
  }

  applyFaults(customerId?: string) {
    // Open, real faults only: a TEST fault never marks a real path as faulty.
    const active = this.data.faults.filter((f) => !f.isTest && !['Resolved', 'Verified', 'Closed'].includes(f.status));
    this.nodes.forEach((n) => {
      const fault = active.find(
        (f) =>
          (!!f.affectedCableId && f.affectedCableId === n.id) ||
          (!!f.affectedEquipmentId && f.affectedEquipmentId === n.id) ||
          (n.type === 'Customer' && !!customerId && f.affectedCustomerIds.includes(customerId)),
      );
      if (!fault) return;
      n.status = 'Faulty';
      n.details += ` [ACTIVE FAULT ${fault.id}: ${fault.type}]`;
      if (!this.warnings.some((w) => w.includes(fault.id))) {
        this.warnings.push(`Active fault ${fault.id} (${fault.type}) on ${n.id}.`);
      }
    });
  }

  finalize(
    summary: Omit<
      TraceSummary,
      'totalLengthMeters' | 'totalLossDb' | 'estimatedRxDbm' | 'budgetStatus' | 'pathComplete' | 'warnings'
    >,
    extraCableIds: string[] = [],
    extraEquipmentIds: string[] = [],
  ): TraceResult {
    const totalLossDb = this.totalLossDb();
    // No estimate on a broken path: the loss covers only the linked part, so a number would mislead.
    const estimatedRxDbm =
      !this.incomplete && summary.txPowerDbm !== undefined ? round1(summary.txPowerDbm - totalLossDb) : undefined;
    return {
      nodes: this.nodes,
      cableIds: [...new Set([...this.cableIds, ...extraCableIds])],
      equipmentIds: [...new Set([...this.equipmentIds, ...extraEquipmentIds])],
      summary: {
        ...summary,
        level: 'cable',
        totalLengthMeters: Math.round(this.lengthMeters),
        totalLossDb,
        estimatedRxDbm,
        // No verdict on a broken path: a partial total would look healthier than it is.
        budgetStatus: this.incomplete ? 'Unknown' : budgetStatusFor(summary.measuredRxDbm ?? estimatedRxDbm, this.settings),
        pathComplete: !this.incomplete,
        warnings: this.warnings,
      },
    };
  }
}

/**
 * Adds OLT → PON → (cable, equipment)* hops for the route that ends at `endEquipment`. An ODF appears
 * only when a cable links it, never for being nearby. `endEquipment` itself is not added unless it is
 * the OLT. Returns the PON transmit power only when it is on record.
 */
function buildTrunk(
  builder: PathBuilder,
  hops: UpstreamHop[],
  endEquipment: Equipment,
  data: TraceData,
  opts: { ponPortId?: string; firstCableId?: string; lastCore?: number; ambiguousAt?: UpstreamWalk['ambiguousAt'] } = {},
): number | undefined {
  const olt = hops[0]?.from?.type === 'OLT' ? hops[0].from : endEquipment.type === 'OLT' ? endEquipment : undefined;
  builder.planCables(hops.map((h) => h.cable.id));
  let txPowerDbm: number | undefined;

  if (!olt) {
    if (opts.ambiguousAt) builder.gap(ambiguousFeedGap(opts.ambiguousAt));
    else if (!isCatv(endEquipment)) {
      builder.gap(`No cable links ${endEquipment.id} back to an OLT, so the route is incomplete.`);
    }
  } else {
    const feederId = hops[0]?.cable.id ?? opts.firstCableId;
    const pon = findPon(olt, feederId, opts.ponPortId);
    txPowerDbm = pon?.txPowerDbm;
    builder.addEquipment(olt, [olt.technology || 'PON', 'OLT', olt.model].filter(Boolean).join(' | '), false);
    if (pon) {
      builder.add({
        type: 'PON',
        id: `${olt.id}/${pon.id}`,
        name: `PON Port ${pon.id}${pon.slotCardPort ? ` (${pon.slotCardPort})` : ''}`,
        details: `${txPowerDbm !== undefined ? `Tx ${txPowerDbm >= 0 ? '+' : ''}${txPowerDbm} dBm` : 'Tx not recorded'} | ${customersOnPonPort(data.customers, olt.id, pon.id).length} customer(s) on record | ${pon.status}`,
        status: pon.status === 'Faulty' ? 'Faulty' : pon.status === 'Active' ? 'Normal' : 'Warning',
      });
    } else if (feederId) {
      builder.gap(`No PON port on ${olt.id} is linked to ${feederId}.`);
    }
  }

  hops.forEach((hop, idx) => {
    if (idx > 0 && hop.from) {
      builder.addEquipment(hop.from, [`${hop.from.type} cross-connect`, hop.from.area].filter(Boolean).join(' | '));
      // Two-stage splitting: a splitter inside this cabinet fed by the previous cable.
      const prevCableId = hops[idx - 1].cable.id;
      const cabinet = hop.from;
      const primary = data.splitters.find(
        (sp) => sp.terminalBoxId === cabinet.id && sp.inputPort.connectedCableId === prevCableId,
      );
      if (primary) builder.addSplitter(primary, `Primary split stage in ${cabinet.id}`, cabinet);
    }
    const role = cableRole(hop.cable, idx === 0 && hop.from?.type === 'OLT');
    builder.addCable(hop.cable, role.type, role.label, idx === hops.length - 1 ? opts.lastCore : undefined);
  });

  return txPowerDbm;
}

export function traceCustomer(
  customer: Customer,
  data: TraceData,
  settings: OpticalSettings = DEFAULT_OPTICAL_SETTINGS,
): TraceResult {
  const builder = new PathBuilder(data, settings);
  const fat = data.equipment.find((e) => e.id === customer.terminalBoxId);
  const splitter = data.splitters.find((s) => s.id === customer.splitterId);
  let txPowerDbm: number | undefined;

  if (!fat) {
    builder.gap(
      customer.terminalBoxId
        ? `Terminal box ${customer.terminalBoxId} no longer exists.`
        : `${customer.name} has no terminal box linked.`,
    );
  } else {
    const preferred = [
      customer.feederCableId,
      customer.distributionCableId,
      splitter?.inputPort.connectedCableId || '',
    ];
    const { hops, ambiguousAt } = walkUpstreamCables(fat.id, data, preferred);
    builder.planCables([customer.dropCableId]);
    txPowerDbm = buildTrunk(builder, hops, fat, data, {
      ponPortId: customer.ponPort,
      lastCore: splitter?.inputPort.connectedCore,
      ambiguousAt,
    });
    builder.addEquipment(
      fat,
      [fat.type, fat.poleNumber ? `Pole ${fat.poleNumber}` : '', fat.street].filter(Boolean).join(' | '),
    );
    if (splitter) {
      const port = splitter.outputPorts.find((p) => p.portNumber === customer.splitterOutputPort);
      builder.addSplitter(splitter, `Output port ${customer.splitterOutputPort}`, fat, port?.status === 'Faulty');
    } else {
      builder.gap(customer.splitterId ? `Splitter ${customer.splitterId} not found.` : `${customer.name} has no splitter recorded.`);
    }
  }

  const drop = data.cables.find((c) => c.id === customer.dropCableId);
  if (drop) {
    builder.addCable(drop, 'Drop', 'Drop Cable', customer.fiberCore);
  } else {
    builder.add({
      type: 'Drop',
      id: customer.dropCableId || `${customer.id}-DROP`,
      name: `Drop Cable${customer.dropCableId ? ` (${customer.dropCableId})` : ''}`,
      details: 'Not on the map | length not recorded',
      status: 'Warning',
    });
    builder.gap('The drop cable is not on the map, so its length and loss are not counted.');
  }

  const reading = rxReadingOf(customer, settings);
  const located = hasRecordedLocation(customer);
  builder.add(
    {
      type: 'ONT',
      id: customer.ontSerialNumber || `${customer.id}-ONT`,
      name: `Customer ONT (${customer.ontSerialNumber || 'serial not recorded'})`,
      details: `${customer.routerModel || 'Model not recorded'} | Rx ${reading.text}`,
      status: reading.band === 'bad' || reading.band === 'too_much_light' ? 'Faulty' : reading.band === 'low_margin' ? 'Warning' : 'Normal',
      lat: located ? customer.lat : undefined,
      lng: located ? customer.lng : undefined,
    },
    builder.connector(),
  );
  builder.add({
    type: 'Customer',
    id: customer.id,
    name: customer.name,
    details: [customer.serviceType, customer.plan, customer.ipAddress && `IP ${customer.ipAddress}`, customer.status].filter(Boolean).join(' | '),
    status: customer.status === 'Active' ? 'Normal' : 'Warning',
    lat: located ? customer.lat : undefined,
    lng: located ? customer.lng : undefined,
  });
  builder.applyFaults(customer.id);

  // Fiber by fiber: a complete core path replaces the cable route; a broken one names its gap.
  const core = traceCustomerCores(customer, data, { settings });
  if (core.complete) return resultFromCorePath(customer, core, builder, settings);
  for (const gap of core.gaps) builder.gap(`Fiber by fiber: ${gap}`);

  return builder.finalize({
    targetId: customer.id,
    targetLabel: `${customer.name} (${customer.id})`,
    kind: 'customer',
    txPowerDbm,
    measuredRxDbm: reading.isMeasured ? reading.valueDbm : undefined,
    rxText: reading.text,
    downstreamCustomerCount: 1,
  });
}

export function traceEquipment(
  eq: Equipment,
  data: TraceData,
  settings: OpticalSettings = DEFAULT_OPTICAL_SETTINGS,
): TraceResult {
  const builder = new PathBuilder(data, settings);
  const downstream = collectDownstream(eq.id, data);
  let txPowerDbm: number | undefined;

  if (eq.type === 'OLT') {
    builder.addEquipment(
      eq,
      `${eq.technology || 'PON'} OLT | ${downstream.customers.length} downstream customer(s)`,
      false,
    );
    (eq.ponPorts || []).forEach((pon) => {
      const feeder = pon.connectedFeederCableId
        ? data.cables.find((c) => c.id === pon.connectedFeederCableId)
        : undefined;
      if (pon.connectedFeederCableId && !feeder) {
        builder.gap(`${eq.id} ${pon.id} references missing cable ${pon.connectedFeederCableId}.`);
      }
      builder.add({
        type: 'PON',
        id: `${eq.id}/${pon.id}`,
        name: `PON Port ${pon.id}`,
        details: feeder
          ? `${pon.status} | Feeds ${feeder.id} → ${feeder.endEquipmentId || 'unterminated'} | ${customersOnPonPort(data.customers, eq.id, pon.id).length} customer(s) on record`
          : `${pon.status} | No feeder mapped`,
        status: pon.status === 'Faulty' ? 'Faulty' : pon.connectedFeederCableId && !feeder ? 'Warning' : 'Normal',
      });
    });
  } else {
    const { hops, ambiguousAt } = walkUpstreamCables(eq.id, data);
    txPowerDbm = buildTrunk(builder, hops, eq, data, { ambiguousAt });
    builder.addEquipment(
      eq,
      `${eq.type} | ${downstream.equipmentIds.length - 1} downstream node(s) | ${downstream.customers.length} customer(s) served`,
    );
  }
  builder.applyFaults();

  return builder.finalize(
    {
      targetId: eq.id,
      targetLabel: `${eq.name} (${eq.id})`,
      kind: 'equipment',
      txPowerDbm,
      downstreamCustomerCount: downstream.customers.length,
    },
    downstream.cableIds,
    downstream.equipmentIds,
  );
}

export function traceCable(
  cable: Cable,
  data: TraceData,
  settings: OpticalSettings = DEFAULT_OPTICAL_SETTINGS,
): TraceResult {
  const builder = new PathBuilder(data, settings);
  const start = cable.startEquipmentId ? data.equipment.find((e) => e.id === cable.startEquipmentId) : undefined;
  const end = cable.endEquipmentId ? data.equipment.find((e) => e.id === cable.endEquipmentId) : undefined;
  const isCoax = cable.cableCategory === 'Coaxial';
  let txPowerDbm: number | undefined;

  if (!start) {
    builder.gap(`${cable.id} has no start equipment linked.`);
  } else if (isCoax || isCatv(start)) {
    builder.addEquipment(start, `${start.type} | cable origin`, false);
  } else {
    const { hops, ambiguousAt } = walkUpstreamCables(start.id, data);
    builder.planCables([cable.id]);
    txPowerDbm = buildTrunk(builder, hops, start, data, { firstCableId: cable.id, ambiguousAt });
    if (start.type !== 'OLT') builder.addEquipment(start, `${start.type} | cable origin`);
  }
  const role = cableRole(cable, start?.type === 'OLT');
  builder.addCable(cable, role.type, role.label);
  if (end) builder.addEquipment(end, `${end.type} | cable termination`);
  else builder.gap(`${cable.id} has no end equipment linked.`);
  builder.applyFaults();

  const downstream =
    end && end.type !== 'OLT' ? collectDownstream(end.id, data) : { cableIds: [], equipmentIds: [], customers: [] };
  return builder.finalize(
    {
      targetId: cable.id,
      targetLabel: `${cable.name} (${cable.id})`,
      kind: 'cable',
      txPowerDbm: isCoax ? undefined : txPowerDbm,
      downstreamCustomerCount: downstream.customers.length,
    },
    downstream.cableIds,
    downstream.equipmentIds,
  );
}

/**
 * Estimated downstream Rx for a new subscriber on a FAT splitter (used during provisioning).
 * `rxDbm` exists only when the path reaches an OLT port with a recorded launch power; otherwise
 * `rxRangeDbm` gives what the class launch range allows for the same loss.
 */
export function estimateRxForSplitter(
  fat: Equipment,
  splitter: Splitter,
  data: TraceData,
  dropLengthMeters = 0,
  settings: OpticalSettings = DEFAULT_OPTICAL_SETTINGS,
) {
  // When the splitter input is linked to a fiber that is recorded back to a PON port, that path is
  // the answer, including a patch through an ODF that no cable shows.
  const input = splitter.inputPort;
  if (input.connectedCableId && input.connectedCore) {
    const up = traceCoreUpstream(input.connectedCableId, input.connectedCore, data, { settings });
    if (up.complete && up.olt && up.pon) {
      const lossDb = calculateOpticalLossBudget(
        {
          totalDistanceMeters: up.parts.distanceMeters + Math.max(0, dropLengthMeters),
          wavelengthNm: DOWNSTREAM_NM,
          splitters: [...up.parts.splitters, { ratio: splitter.ratio, ...(splitter.insertionLossDb > 0 ? { lossDb: splitter.insertionLossDb } : {}) }],
          // The box's output adapter and the ONT, on top of the ports already on the path.
          connectorsCount: up.parts.connectorPairs + 2,
          recordedSpliceLossDb: up.parts.spliceLossDb,
        },
        settings,
      ).totalLossDb;
      const tx = up.pon.txPowerDbm;
      const cls = up.pon.opticsClass ?? opticsClassForTechnology(up.pon.technology ?? up.olt.technology);
      const range = settings.classes[cls];
      return {
        olt: up.olt,
        pon: up.pon,
        hops: findUpstreamChain(fat.id, data, [input.connectedCableId]),
        /** OLT first, from the recorded fibers. */
        cableIds: [...up.cableIds].reverse(),
        lossDb,
        launchDbm: tx,
        /** 'core': every fiber from the PON port to this splitter is on record. */
        level: 'core' as const,
        gaps: [] as string[],
        pathComplete: true,
        rxDbm: tx !== undefined ? round1(tx - lossDb) : undefined,
        rxRangeDbm:
          range.launchMinDbm !== undefined && range.launchMaxDbm !== undefined
            ? { min: round1(range.launchMinDbm - lossDb), max: round1(range.launchMaxDbm - lossDb) }
            : undefined,
      };
    }
  }
  // The fibers are not on record end to end. The cable route below is only a picture of where the
  // light may come from: it is never stored as the customer's path and gives no Rx estimate.
  const coreGap = !input.connectedCableId || !input.connectedCore
    ? `the input of splitter ${splitter.id} is not linked to a fiber (open ${fat.id} on the map, Splitters and ports, Link input to this fiber)`
    : (traceCoreUpstream(input.connectedCableId, input.connectedCore, data, { settings }).gaps[0] ??
      `the fiber feeding splitter ${splitter.id} is not recorded back to an OLT PON port`);
  const builder = new PathBuilder(data, settings);
  const { hops, ambiguousAt } = walkUpstreamCables(fat.id, data, [input.connectedCableId || '']);
  const tx = buildTrunk(builder, hops, fat, data, { lastCore: input.connectedCore, ambiguousAt });
  builder.addEquipment(fat, fat.type);
  builder.addSplitter(splitter, 'provisioning', fat);
  builder.addDistance(dropLengthMeters);
  builder.connector();
  const olt = hops[0]?.from?.type === 'OLT' ? hops[0].from : undefined;
  const pon = olt ? findPon(olt, hops[0]?.cable.id) : undefined;
  return {
    olt,
    pon,
    hops,
    cableIds: hops.map((h) => h.cable.id),
    lossDb: builder.totalLossDb(),
    launchDbm: tx,
    /** 'cable': only cables were followed, so OLT, PON and cables here are not a recorded path. */
    level: 'cable' as const,
    /** What is missing, first the fiber link, in plain words. */
    gaps: [coreGap, ...builder.warnings],
    pathComplete: false,
    rxDbm: undefined as number | undefined,
    rxRangeDbm: undefined as { min: number; max: number } | undefined,
  };
}

/**
 * Resolves any searchable identifier (customer ID or ONT serial, equipment, cable, `OLT/PON` port,
 * fault, closure or splitter) to the fiber path that serves it.
 */
export function resolveTraceTarget(
  targetId: string,
  data: TraceData,
  settings: OpticalSettings = DEFAULT_OPTICAL_SETTINGS,
): TraceResult | null {
  const id = targetId.trim();
  if (!id) return null;
  const findEquipment = (equipmentId?: string) =>
    equipmentId ? data.equipment.find((e) => e.id === equipmentId) : undefined;
  const findCable = (cableId?: string) => (cableId ? data.cables.find((c) => c.id === cableId) : undefined);

  const customer = data.customers.find((c) => c.id === id || c.ontSerialNumber === id);
  if (customer) return traceCustomer(customer, data, settings);

  const eq = findEquipment(id);
  if (eq) return traceEquipment(eq, data, settings);

  const cable = findCable(id);
  if (cable) return traceCable(cable, data, settings);

  // "OLT-01/PON-03" or a bare PON port ID: trace the feeder leaving that PON.
  const [oltPart, ponPart] = id.includes('/') ? id.split('/') : [undefined, id];
  const olt = data.equipment.find(
    (e) => e.type === 'OLT' && (oltPart ? e.id === oltPart : e.ponPorts?.some((p) => p.id === ponPart)),
  );
  const pon = olt?.ponPorts?.find((p) => p.id === ponPart);
  if (olt && pon) {
    const feeder = findCable(pon.connectedFeederCableId);
    return feeder ? traceCable(feeder, data, settings) : traceEquipment(olt, data, settings);
  }

  const fault = data.faults.find((f) => f.id === id);
  if (fault) {
    const faultCable = findCable(fault.affectedCableId);
    if (faultCable) return traceCable(faultCable, data, settings);
    const faultEq = findEquipment(fault.affectedEquipmentId);
    if (faultEq) return traceEquipment(faultEq, data, settings);
    const faultCustomer = data.customers.find((c) => fault.affectedCustomerIds.includes(c.id));
    return faultCustomer ? traceCustomer(faultCustomer, data, settings) : null;
  }

  const closure = data.closures.find((c) => c.id === id);
  if (closure) {
    const closureCable = findCable(closure.cableAId) ?? findCable(closure.cableBId);
    return closureCable ? traceCable(closureCable, data, settings) : null;
  }

  const splitter = data.splitters.find((s) => s.id === id);
  if (splitter) {
    const host = findEquipment(splitter.terminalBoxId);
    return host ? traceEquipment(host, data, settings) : null;
  }
  return null;
}

const CORE_NODE_TYPES: Record<string, TracePathNode['type']> = {
  patch: 'Equipment',
  odf: 'ODF',
  splice: 'Closure',
  splitter: 'Splitter',
  ont: 'ONT',
};

/** A customer whose fibers are recorded end to end: the nodes and totals come from the core path. */
function resultFromCorePath(customer: Customer, core: CorePathResult, cableBuilder: PathBuilder, settings: OpticalSettings): TraceResult {
  const builder = new PathBuilder(cableBuilder.data, settings);
  for (const step of core.steps) {
    const cable = step.cableId ? builder.data.cables.find((c) => c.id === step.cableId) : undefined;
    const status = step.status === 'broken' ? 'Faulty' : step.status === 'warning' ? 'Warning' : 'Normal';
    if (step.kind === 'olt' && core.olt && core.pon) {
      builder.add({ type: 'OLT', id: core.olt.id, name: core.olt.name, details: step.detail, status, lat: step.lat, lng: step.lng });
      builder.add(
        { type: 'PON', id: `${core.olt.id}/${core.pon.id}`, name: `PON Port ${core.pon.id}${core.pon.vendorAddress ? ` (${core.pon.vendorAddress})` : ''}`, details: step.detail, status },
        step.lossDb ?? 0,
      );
      continue;
    }
    const type = cable ? cableRole(cable, false).type : (CORE_NODE_TYPES[step.kind] ?? 'Equipment');
    builder.add(
      { type, id: step.id, name: step.title, details: step.detail, status, lat: step.lat, lng: step.lng, lengthMeters: step.lengthMeters },
      step.kind === 'cable' ? fiberLossDb(step.lengthMeters ?? 0, DOWNSTREAM_NM, settings) : (step.lossDb ?? 0),
    );
  }
  const located = hasRecordedLocation(customer);
  builder.add({
    type: 'Customer',
    id: customer.id,
    name: customer.name,
    details: [customer.serviceType, customer.plan, customer.status].filter(Boolean).join(' | '),
    status: customer.status === 'Active' ? 'Normal' : 'Warning',
    lat: located ? customer.lat : undefined,
    lng: located ? customer.lng : undefined,
  });
  builder.applyFaults(customer.id);
  const down = core.directions.find((d) => d.direction === 'downstream')?.budget;
  const reading = rxReadingOf(customer, settings);
  const measuredRxDbm = reading.isMeasured ? reading.valueDbm : undefined;
  const estimatedRxDbm = down?.expectedRxDbm;
  return {
    nodes: builder.nodes,
    cableIds: core.cableIds,
    equipmentIds: [...new Set([...(core.olt ? [core.olt.id] : []), ...core.equipmentIds])],
    summary: {
      targetId: customer.id,
      targetLabel: `${customer.name} (${customer.id})`,
      kind: 'customer',
      level: 'core',
      totalLengthMeters: Math.round(core.parts.distanceMeters),
      totalLossDb: down?.totalLossDb ?? 0,
      txPowerDbm: core.pon?.txPowerDbm,
      estimatedRxDbm,
      measuredRxDbm,
      rxText: reading.text,
      budgetStatus: budgetStatusFor(measuredRxDbm ?? estimatedRxDbm, settings),
      pathComplete: true,
      downstreamCustomerCount: 1,
      warnings: [...builder.warnings, ...core.warnings],
    },
  };
}
