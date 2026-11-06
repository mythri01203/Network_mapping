import { getFiberColor } from '../fiber/colors';
import type { Cable, Customer, FiberTraceHop } from '../model/types';
import { polylineLengthMeters } from './geo';
import { calculateOpticalLossBudget, type OpticalLossBudgetResult, type WavelengthNm } from './lossEngine';
import { findUpstreamChain, type TraceData } from './trace';

export interface OpticalTraceOptions {
  wavelengthNm?: WavelengthNm;
  oltTxPowerDbm?: number;
}

export interface OpticalTraceResult {
  targetId: string;
  targetLabel: string;
  targetKind: 'customer' | 'equipment' | 'cable';
  customer?: Customer;
  hops: FiberTraceHop[];
  budget: OpticalLossBudgetResult;
  cableIds: string[];
  equipmentIds: string[];
  warnings: string[];
}

const cableLengthMeters = (c: Cable): number =>
  c.lengthMeters > 0 ? c.lengthMeters : Math.round(polylineLengthMeters(c.coordinates || []));

/**
 * Recursive & adjacency-list optical graph traversal service that traces
 * from an ONU/Customer or network node back to its parent Splitter(s) and OLT PON port.
 */
export function traceOpticalPath(
  targetId: string,
  data: TraceData,
  options: OpticalTraceOptions = {},
): OpticalTraceResult | null {
  const q = targetId.trim().toLowerCase();
  const customerList = data.customers || [];
  const equipmentList = data.equipment || [];
  const cableList = data.cables || [];

  // 1. Identify target
  const customer = customerList.find(
    (c) => c.id.toLowerCase() === q || c.ontSerialNumber.toLowerCase() === q || c.name.toLowerCase() === q,
  );
  const equipment = !customer ? equipmentList.find((e) => e.id.toLowerCase() === q) : undefined;
  const cable = !customer && !equipment ? cableList.find((c) => c.id.toLowerCase() === q) : undefined;

  if (!customer && !equipment && !cable) {
    return null;
  }

  const wavelengthNm = options.wavelengthNm ?? 1490;
  const warnings: string[] = [];
  const hops: FiberTraceHop[] = [];
  const cableIds: string[] = [];
  const equipmentIds: string[] = [];
  const splittersEncountered: string[] = [];

  let cumulativeDistance = 0;
  let cumulativeLoss = 0;

  const appendHop = (hopData: Omit<FiberTraceHop, 'index' | 'cumulativeDistanceMeters' | 'cumulativeLossDb'>) => {
    cumulativeDistance += hopData.hopDistanceMeters;
    cumulativeLoss = Math.round((cumulativeLoss + hopData.hopLossDb) * 100) / 100;
    const fullHop: FiberTraceHop = {
      ...hopData,
      index: hops.length + 1,
      cumulativeDistanceMeters: Math.round(cumulativeDistance),
      cumulativeLossDb: cumulativeLoss,
    };
    hops.push(fullHop);
    return fullHop;
  };

  // Find upstream root starting equipment ID
  const startEqId = customer ? customer.terminalBoxId : equipment ? equipment.id : cable?.endEquipmentId || '';
  const upstreamChain = startEqId ? findUpstreamChain(startEqId, data) : [];

  // 2. Identify the serving OLT
  const servingOlt =
    upstreamChain[0]?.from?.type === 'OLT'
      ? upstreamChain[0].from
      : equipment?.type === 'OLT'
        ? equipment
        : data.equipment.find((e) => e.type === 'OLT');

  const ponPortName =
    customer?.ponPort ||
    servingOlt?.ponPorts?.[0]?.slotCardPort ||
    servingOlt?.ponPorts?.[0]?.id ||
    'PON-01';
  const ponPortId = customer?.ponPort || servingOlt?.ponPorts?.[0]?.id || 'PON-01';

  // --- HOP 1: OLT & PON Port ---
  if (servingOlt) {
    equipmentIds.push(servingOlt.id);
    const oltTx = options.oltTxPowerDbm ?? (servingOlt.ponPorts?.[0]?.txPowerDbm || 3.0);
    appendHop({
      id: servingOlt.id,
      name: `${servingOlt.name} [Port: ${ponPortName}]`,
      type: 'OLT',
      status: servingOlt.status === 'Faulty' ? 'Faulty' : 'Normal',
      lat: servingOlt.lat,
      lng: servingOlt.lng,
      portId: ponPortId,
      portName: ponPortName,
      hopDistanceMeters: 0,
      hopLossDb: 0.5, // OLT optical patch adapter connector loss
      details: `${servingOlt.type} Chassis · Tx Laser: +${oltTx} dBm (Class B+)`,
      equipmentType: servingOlt.type,
    });
  }

  // --- HOP 2: ODF / Central Office Patch ---
  const odf = data.equipment.find((e) => e.type === 'ODF');
  if (odf) {
    equipmentIds.push(odf.id);
    appendHop({
      id: odf.id,
      name: `${odf.name} (Tray 1, Port 12)`,
      type: 'ODF',
      status: 'Normal',
      lat: odf.lat,
      lng: odf.lng,
      portId: 'ODF-P12',
      portName: 'Port 12',
      hopDistanceMeters: 15,
      hopLossDb: 0.5, // Mated connector
      details: 'High-density fiber patch termination frame (SC/APC)',
      equipmentType: 'ODF',
    });
  }

  // --- HOP 3: Feeder Cable & Intermediate Trunks ---
  upstreamChain.forEach((link, idx) => {
    const c = link.cable;
    cableIds.push(c.id);
    const length = cableLengthMeters(c);
    const fiberRate = wavelengthNm === 1550 ? 0.2 : wavelengthNm === 1310 ? 0.35 : 0.25;
    const loss = Math.round((length / 1000) * fiberRate * 100) / 100;

    const coreNum = idx === 0 ? 1 : 2;
    const color = getFiberColor(coreNum);

    appendHop({
      id: c.id,
      name: c.name,
      type: c.type === 'Main Feeder Fiber' ? 'Feeder' : 'Distribution',
      status: c.status === 'Damaged' ? 'Faulty' : 'Normal',
      hopDistanceMeters: length,
      hopLossDb: loss,
      coreNumber: coreNum,
      coreColorName: color.name,
      coreColorHex: color.hex,
      details: `${c.fiberCount}F ${c.installationType} · Core ${coreNum} (${color.name})`,
    });

    if (link.from && link.from.type !== 'OLT') {
      equipmentIds.push(link.from.id);
      const isSplitter = link.from.type === 'Fiber Splitter' || link.from.type === 'Ratio Coupler';
      if (isSplitter) splittersEncountered.push('1:4');

      appendHop({
        id: link.from.id,
        name: link.from.name,
        type: isSplitter ? 'Splitter' : (link.from.type as FiberTraceHop['type']),
        status: link.from.status === 'Faulty' ? 'Faulty' : 'Normal',
        lat: link.from.lat,
        lng: link.from.lng,
        hopDistanceMeters: 0,
        hopLossDb: isSplitter ? 7.2 : 0.5,
        details: `${link.from.type} · ${link.from.category}`,
        equipmentType: link.from.type,
        splitRatio: isSplitter ? '1:4' : undefined,
      });
    }
  });

  // --- HOP 4: Distribution Splitter / FAT Terminal Box ---
  const termBox = customer
    ? data.equipment.find((e) => e.id === customer.terminalBoxId)
    : equipment
      ? equipment
      : undefined;

  if (termBox) {
    equipmentIds.push(termBox.id);
    const splitter = data.splitters.find((s) => s.terminalBoxId === termBox.id || s.id === customer?.splitterId);
    const ratio = splitter?.ratio || '1:8';
    splittersEncountered.push(ratio);
    const splitterLoss = splitter?.insertionLossDb || (ratio === '1:8' ? 10.5 : 7.2);

    appendHop({
      id: termBox.id,
      name: `${termBox.name} [Splitter: ${ratio}]`,
      type: 'FAT',
      status: termBox.status === 'Faulty' ? 'Faulty' : 'Normal',
      lat: termBox.lat,
      lng: termBox.lng,
      portId: customer ? `Port ${customer.splitterOutputPort}` : 'Port 1',
      portName: customer ? `Port ${customer.splitterOutputPort}` : 'Outbound Port 1',
      hopDistanceMeters: 0,
      hopLossDb: splitterLoss + 0.5, // Splitter insertion loss + connector
      details: `Fiber Access Terminal with ${ratio} PLC Splitter module (SC/APC)`,
      equipmentType: termBox.type,
      splitRatio: ratio,
    });
  }

  // --- HOP 5: Customer Drop Cable & ONU ---
  if (customer) {
    const dropLength = 85; // meters
    const dropCore = customer.fiberCore || 1;
    const dropColor = getFiberColor(dropCore);
    const dropLoss = Math.round((dropLength / 1000) * 0.35 * 100) / 100;

    appendHop({
      id: customer.dropCableId || `DROP-${customer.id}`,
      name: `Subscriber Drop Cable (${customer.name})`,
      type: 'Drop',
      status: 'Normal',
      hopDistanceMeters: dropLength,
      hopLossDb: dropLoss,
      coreNumber: dropCore,
      coreColorName: dropColor.name,
      coreColorHex: dropColor.hex,
      details: `2F Rugged Outdoor Bow-Type Drop Cable · Core ${dropCore} (${dropColor.name})`,
    });

    // --- HOP 6: Customer ONT / ONU ---
    appendHop({
      id: customer.id,
      name: `${customer.name} · ONU (${customer.ontSerialNumber})`,
      type: 'ONT',
      status: customer.rxOpticalPowerDbm < -27 ? 'Faulty' : customer.rxOpticalPowerDbm < -24 ? 'Warning' : 'Normal',
      lat: customer.lat,
      lng: customer.lng,
      hopDistanceMeters: 0,
      hopLossDb: 0.5, // Optical rosette patch cord insertion
      details: `${customer.routerModel} · Measured Rx: ${customer.rxOpticalPowerDbm.toFixed(1)} dBm`,
      equipmentType: 'ONU',
    });
  }

  // Calculate automated link budget diagnosis
  const budget = calculateOpticalLossBudget({
    totalDistanceMeters: cumulativeDistance,
    wavelengthNm,
    splitters: splittersEncountered.length ? splittersEncountered : ['1:8'],
    splicesCount: Math.max(2, upstreamChain.length),
    connectorsCount: 4,
    oltTxPowerDbm: options.oltTxPowerDbm ?? 3.0,
    measuredRxDbm: customer?.rxOpticalPowerDbm,
  });

  return {
    targetId: customer?.id || equipment?.id || cable?.id || targetId,
    targetLabel: customer
      ? `${customer.name} (ONU: ${customer.ontSerialNumber})`
      : equipment
        ? `${equipment.name} (${equipment.type})`
        : cable?.name || targetId,
    targetKind: customer ? 'customer' : equipment ? 'equipment' : 'cable',
    customer,
    hops,
    budget,
    cableIds,
    equipmentIds,
    warnings,
  };
}
