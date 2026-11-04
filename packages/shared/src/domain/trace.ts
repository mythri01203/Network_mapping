import type { Cable, Customer, Equipment, Fault, JointClosure, Splitter, TracePathNode } from '../model/types';
import { polylineLengthMeters } from './geo';

// Planning values for a GPON downstream (1490 nm) optical link budget.
export const FIBER_ATTENUATION_DB_PER_KM = 0.35;
export const CONNECTOR_LOSS_DB = 0.5;
export const DEFAULT_SPLICE_LOSS_DB = 0.1;
export const RX_WARNING_DBM = -25;
export const RX_SENSITIVITY_DBM = -28;
export const DEFAULT_TX_POWER_DBM = 3;

export interface TraceData {
  equipments: Equipment[];
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
  estimatedRxDbm?: number;
  measuredRxDbm?: number;
  budgetStatus: BudgetStatus;
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

export const budgetStatusFor = (rx?: number): BudgetStatus => {
  if (rx === undefined || rx === null || Number.isNaN(rx)) return 'Unknown';
  if (rx < RX_SENSITIVITY_DBM) return 'Fail';
  if (rx < RX_WARNING_DBM) return 'Warning';
  return 'Pass';
};

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

/**
 * Walks trunk cables (end → start) from an equipment back to its serving OLT.
 * Hops are returned OLT-first. An OLT is always treated as the signal source,
 * so inter-OLT backhaul links are never followed.
 */
export function findUpstreamChain(
  startEquipmentId: string,
  data: TraceData,
  preferredCableIds: string[] = [],
): UpstreamHop[] {
  const hops: UpstreamHop[] = [];
  const start = data.equipments.find((e) => e.id === startEquipmentId);
  if (!start || start.type === 'OLT') return hops;

  const visitedCables = new Set<string>();
  const visitedEquipment = new Set<string>([startEquipmentId]);
  let currentId: string | undefined = startEquipmentId;

  for (let guard = 0; guard < 16 && currentId; guard++) {
    const candidates = data.cables.filter(
      (c) => isTrunkCable(c) && c.endEquipmentId === currentId && !visitedCables.has(c.id),
    );
    if (candidates.length === 0) break;
    const cable = candidates.find((c) => preferredCableIds.includes(c.id)) || candidates[0];
    visitedCables.add(cable.id);
    const from = cable.startEquipmentId ? data.equipments.find((e) => e.id === cable.startEquipmentId) : undefined;
    hops.unshift({ cable, from });
    if (!from || from.type === 'OLT' || visitedEquipment.has(from.id)) break;
    visitedEquipment.add(from.id);
    currentId = from.id;
  }
  return hops;
}

/** Returns the OLT that ultimately feeds an equipment (or the equipment itself if it is an OLT). */
export function findServingOlt(equipmentId: string, data: TraceData, preferredCableIds: string[] = []) {
  const eq = data.equipments.find((e) => e.id === equipmentId);
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
        const nextEq = next ? data.equipments.find((e) => e.id === next) : undefined;
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

const findPatchOdf = (olt: Equipment, data: TraceData) =>
  data.equipments
    .filter((e) => e.type === 'ODF')
    .map((e) => ({
      e,
      d: polylineLengthMeters([
        [olt.lat, olt.lng],
        [e.lat, e.lng],
      ]),
    }))
    .filter((x) => x.d <= 250)
    .sort((a, b) => a.d - b.d)[0]?.e;

const findPon = (olt: Equipment, feederCableId?: string, ponPortId?: string) =>
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
  private closureIds = new Set<string>();
  private plannedCableIds = new Set<string>();

  constructor(private data: TraceData) {}

  planCables(ids: (string | undefined)[]) {
    ids.forEach((id) => id && this.plannedCableIds.add(id));
  }

  add(node: TracePathNode, lossDb = 0) {
    this.lossDb += lossDb;
    this.nodes.push({ ...node, lossDb: round2(lossDb), cumulativeLossDb: round2(this.lossDb) });
  }

  addEquipment(eq: Equipment, details: string, connectorLoss = CONNECTOR_LOSS_DB) {
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
    this.add(
      {
        type: 'Splitter',
        id: sp.id,
        name: sp.name,
        details: `Ratio ${sp.ratio} | ${details} | Insertion loss ${sp.insertionLossDb} dB`,
        status: sp.status === 'Faulty' || portFaulty ? 'Faulty' : sp.status === 'Maintenance' ? 'Warning' : 'Normal',
        lat: at?.lat,
        lng: at?.lng,
      },
      sp.insertionLossDb,
    );
  }

  addCable(cable: Cable, nodeType: TracePathNode['type'], label: string, coreNumber?: number) {
    const length = cableLength(cable);
    this.lengthMeters += length;
    this.cableIds.push(cable.id);
    this.plannedCableIds.add(cable.id);
    let status = cableStatus(cable);
    const core = coreNumber ? cable.cores.find((c) => c.coreNumber === coreNumber) : undefined;
    if (core && (core.status === 'Damaged' || core.status === 'Under Maintenance')) {
      status = core.status === 'Damaged' ? 'Faulty' : 'Warning';
      this.warnings.push(`Core ${coreNumber} on ${cable.id} is ${core.status}.`);
    }
    const coreText = core ? ` | Core ${core.coreNumber} (${core.colorName})` : '';
    const coords = cable.coordinates || [];
    const mid = coords[Math.floor(coords.length / 2)];
    this.add(
      {
        type: nodeType,
        id: cable.id,
        name: `${label}: ${cable.name}`,
        details: `${cable.fiberCount}F ${cable.installationType} | ${length} m${coreText}`,
        status,
        lat: mid?.[0],
        lng: mid?.[1],
        lengthMeters: length,
      },
      (length / 1000) * FIBER_ATTENUATION_DB_PER_KM,
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
        const splices = cl.splices.filter((s) => s.inputCableId === cable.id || s.outputCableId === cable.id);
        const avgLoss = splices.length
          ? splices.reduce((sum, s) => sum + (s.spliceLossDb || 0), 0) / splices.length
          : DEFAULT_SPLICE_LOSS_DB;
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
    const active = this.data.faults.filter((f) => f.status !== 'Resolved');
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
    summary: Omit<TraceSummary, 'totalLengthMeters' | 'totalLossDb' | 'estimatedRxDbm' | 'budgetStatus' | 'warnings'>,
    extraCableIds: string[] = [],
    extraEquipmentIds: string[] = [],
  ): TraceResult {
    const estimatedRxDbm = summary.txPowerDbm !== undefined ? round1(summary.txPowerDbm - this.lossDb) : undefined;
    return {
      nodes: this.nodes,
      cableIds: [...new Set([...this.cableIds, ...extraCableIds])],
      equipmentIds: [...new Set([...this.equipmentIds, ...extraEquipmentIds])],
      summary: {
        ...summary,
        totalLengthMeters: Math.round(this.lengthMeters),
        totalLossDb: round2(this.lossDb),
        estimatedRxDbm,
        budgetStatus: budgetStatusFor(summary.measuredRxDbm ?? estimatedRxDbm),
        warnings: this.warnings,
      },
    };
  }
}

/**
 * Adds OLT → PON → ODF → (cable, equipment)* hops for the route that ends at `endEquipment`.
 * `endEquipment` itself is not added unless it is the OLT. Returns the PON transmit power when known.
 */
function buildTrunk(
  builder: PathBuilder,
  hops: UpstreamHop[],
  endEquipment: Equipment,
  data: TraceData,
  opts: { ponPortId?: string; firstCableId?: string; lastCore?: number } = {},
): number | undefined {
  const olt = hops[0]?.from?.type === 'OLT' ? hops[0].from : endEquipment.type === 'OLT' ? endEquipment : undefined;
  builder.planCables(hops.map((h) => h.cable.id));
  let txPowerDbm: number | undefined;

  if (!olt) {
    if (!isCatv(endEquipment)) {
      builder.warnings.push(`No upstream OLT found for ${endEquipment.id}; the route is incomplete.`);
    }
  } else {
    const feederId = hops[0]?.cable.id ?? opts.firstCableId;
    const pon = findPon(olt, feederId, opts.ponPortId);
    txPowerDbm = pon?.txPowerDbm ?? pon?.signalDbm ?? DEFAULT_TX_POWER_DBM;
    builder.addEquipment(olt, [olt.technology || 'PON', 'OLT', olt.model].filter(Boolean).join(' | '), 0);
    if (pon) {
      builder.add({
        type: 'PON',
        id: `${olt.id}/${pon.id}`,
        name: `PON Port ${pon.id}${pon.slotCardPort ? ` (${pon.slotCardPort})` : ''}`,
        details: `Tx ${txPowerDbm >= 0 ? '+' : ''}${txPowerDbm} dBm | ${pon.connectedCustomersCount} customer(s) | ${pon.status}`,
        status: pon.status === 'Faulty' ? 'Faulty' : pon.status === 'Active' ? 'Normal' : 'Warning',
      });
    } else if (feederId) {
      builder.warnings.push(
        `No PON port on ${olt.id} is mapped to ${feederId}; assumed Tx +${DEFAULT_TX_POWER_DBM} dBm.`,
      );
    }
    if (feederId) {
      const odf = findPatchOdf(olt, data);
      if (odf && odf.id !== endEquipment.id) builder.addEquipment(odf, 'Central office patching (connector pair)');
    }
  }

  hops.forEach((hop, idx) => {
    if (idx > 0 && hop.from) {
      builder.addEquipment(hop.from, `${hop.from.type} cross-connect | ${hop.from.area}`);
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

export function traceCustomer(customer: Customer, data: TraceData): TraceResult {
  const builder = new PathBuilder(data);
  const fat = data.equipments.find((e) => e.id === customer.terminalBoxId);
  const splitter = data.splitters.find((s) => s.id === customer.splitterId);
  let txPowerDbm: number | undefined;

  if (!fat) {
    builder.warnings.push(`Terminal box ${customer.terminalBoxId} no longer exists.`);
  } else {
    const preferred = [
      customer.feederCableId,
      customer.distributionCableId,
      splitter?.inputPort.connectedCableId || '',
    ];
    const hops = findUpstreamChain(fat.id, data, preferred);
    builder.planCables([customer.dropCableId]);
    txPowerDbm = buildTrunk(builder, hops, fat, data, {
      ponPortId: customer.ponPort,
      lastCore: splitter?.inputPort.connectedCore,
    });
    builder.addEquipment(
      fat,
      [fat.type, fat.poleNumber ? `Pole ${fat.poleNumber}` : '', fat.street].filter(Boolean).join(' | '),
    );
    if (splitter) {
      const port = splitter.outputPorts.find((p) => p.portNumber === customer.splitterOutputPort);
      builder.addSplitter(splitter, `Output port ${customer.splitterOutputPort}`, fat, port?.status === 'Faulty');
    } else {
      builder.warnings.push(`Splitter ${customer.splitterId} not found.`);
    }
  }

  const drop = data.cables.find((c) => c.id === customer.dropCableId);
  if (drop) {
    builder.addCable(drop, 'Drop', 'Drop Cable', customer.fiberCore);
  } else {
    // Unmapped drop: estimate route length as 1.2× the straight-line distance.
    const estimated = fat
      ? Math.round(
          polylineLengthMeters([
            [fat.lat, fat.lng],
            [customer.lat, customer.lng],
          ]) * 1.2,
        )
      : 0;
    builder.lengthMeters += estimated;
    builder.add(
      {
        type: 'Drop',
        id: customer.dropCableId || `${customer.id}-DROP`,
        name: `Drop Cable${customer.dropCableId ? ` (${customer.dropCableId})` : ''}`,
        details: `Not mapped on GIS | estimated ${estimated} m`,
        status: 'Warning',
        lengthMeters: estimated,
      },
      (estimated / 1000) * FIBER_ATTENUATION_DB_PER_KM,
    );
    builder.warnings.push('Drop cable is not mapped on GIS; its length was estimated.');
  }

  const measured = budgetStatusFor(customer.rxOpticalPowerDbm);
  builder.add(
    {
      type: 'ONT',
      id: customer.ontSerialNumber,
      name: `Customer ONT (${customer.ontSerialNumber})`,
      details: `${customer.routerModel} | Measured Rx ${customer.rxOpticalPowerDbm} dBm`,
      status: measured === 'Fail' ? 'Faulty' : measured === 'Warning' ? 'Warning' : 'Normal',
      lat: customer.lat,
      lng: customer.lng,
    },
    CONNECTOR_LOSS_DB,
  );
  builder.add({
    type: 'Customer',
    id: customer.id,
    name: customer.name,
    details: `${customer.serviceType} | ${customer.plan} | IP ${customer.ipAddress} | ${customer.status}`,
    status: customer.status === 'Active' ? 'Normal' : 'Warning',
    lat: customer.lat,
    lng: customer.lng,
  });
  builder.applyFaults(customer.id);

  return builder.finalize({
    targetId: customer.id,
    targetLabel: `${customer.name} (${customer.id})`,
    kind: 'customer',
    txPowerDbm,
    measuredRxDbm: customer.rxOpticalPowerDbm,
    downstreamCustomerCount: 1,
  });
}

export function traceEquipment(eq: Equipment, data: TraceData): TraceResult {
  const builder = new PathBuilder(data);
  const downstream = collectDownstream(eq.id, data);
  let txPowerDbm: number | undefined;

  if (eq.type === 'OLT') {
    builder.addEquipment(
      eq,
      `${eq.technology || 'PON'} OLT | ${downstream.customers.length} downstream customer(s)`,
      0,
    );
    (eq.ponPorts || []).forEach((pon) => {
      const feeder = pon.connectedFeederCableId
        ? data.cables.find((c) => c.id === pon.connectedFeederCableId)
        : undefined;
      if (pon.connectedFeederCableId && !feeder) {
        builder.warnings.push(`${eq.id} ${pon.id} references missing cable ${pon.connectedFeederCableId}.`);
      }
      builder.add({
        type: 'PON',
        id: `${eq.id}/${pon.id}`,
        name: `PON Port ${pon.id}`,
        details: feeder
          ? `${pon.status} | Feeds ${feeder.id} → ${feeder.endEquipmentId || 'unterminated'} | ${pon.connectedCustomersCount} customer(s)`
          : `${pon.status} | No feeder mapped`,
        status: pon.status === 'Faulty' ? 'Faulty' : pon.connectedFeederCableId && !feeder ? 'Warning' : 'Normal',
      });
    });
  } else {
    const hops = findUpstreamChain(eq.id, data);
    txPowerDbm = buildTrunk(builder, hops, eq, data);
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

export function traceCable(cable: Cable, data: TraceData): TraceResult {
  const builder = new PathBuilder(data);
  const start = cable.startEquipmentId ? data.equipments.find((e) => e.id === cable.startEquipmentId) : undefined;
  const end = cable.endEquipmentId ? data.equipments.find((e) => e.id === cable.endEquipmentId) : undefined;
  const isCoax = cable.cableCategory === 'Coaxial';
  let txPowerDbm: number | undefined;

  if (!start) {
    builder.warnings.push(`${cable.id} has no start equipment mapped.`);
  } else if (isCoax || isCatv(start)) {
    builder.addEquipment(start, `${start.type} | cable origin`, 0);
  } else {
    const hops = findUpstreamChain(start.id, data);
    builder.planCables([cable.id]);
    txPowerDbm = buildTrunk(builder, hops, start, data, { firstCableId: cable.id });
    if (start.type !== 'OLT') builder.addEquipment(start, `${start.type} | cable origin`);
  }
  const role = cableRole(cable, start?.type === 'OLT');
  builder.addCable(cable, role.type, role.label);
  if (end) builder.addEquipment(end, `${end.type} | cable termination`);
  else builder.warnings.push(`${cable.id} has no end equipment mapped.`);
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

/** Estimated downstream Rx for a new subscriber on a FAT splitter (used during provisioning). */
export function estimateRxForSplitter(fat: Equipment, splitter: Splitter, data: TraceData, dropLengthMeters = 0) {
  const builder = new PathBuilder(data);
  const hops = findUpstreamChain(fat.id, data, [splitter.inputPort.connectedCableId || '']);
  const tx = buildTrunk(builder, hops, fat, data, { lastCore: splitter.inputPort.connectedCore });
  builder.addEquipment(fat, fat.type);
  builder.addSplitter(splitter, 'provisioning', fat);
  const dropLoss = (dropLengthMeters / 1000) * FIBER_ATTENUATION_DB_PER_KM + CONNECTOR_LOSS_DB;
  const olt = hops[0]?.from?.type === 'OLT' ? hops[0].from : undefined;
  const pon = olt ? findPon(olt, hops[0]?.cable.id) : undefined;
  return {
    olt,
    pon,
    hops,
    rxDbm: tx !== undefined ? round1(tx - builder.lossDb - dropLoss) : undefined,
  };
}
