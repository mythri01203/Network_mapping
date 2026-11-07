import type { Cable, Customer, Equipment, FiberTraceHop, PonPort, Splitter } from '../model/types';
import { hasRecordedLocation } from './defaults';
import { polylineLengthMeters } from './geo';
import { calculateOpticalLossBudget, type OpticalLossBudgetResult, type SplitterLossSpec } from './lossEngine';
import {
  checkLinkBudget,
  DEFAULT_OPTICAL_SETTINGS,
  fiberLossDb,
  type OpticalSettings,
  type OpticsClass,
  opticsClassForTechnology,
  type WavelengthNm,
} from './opticalSettings';
import { type RxReading, rxReadingOf } from './rxReading';
import { findPon, findUpstreamChain, type TraceData, upstreamCandidates, type UpstreamHop } from './trace';

export interface OpticalTraceOptions {
  wavelengthNm?: WavelengthNm;
  /** The port's real launch power, if the caller knows it better than the record does. */
  oltTxPowerDbm?: number;
  opticsClass?: OpticsClass;
  settings?: OpticalSettings;
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
  /** Missing links and values, each naming the exact segment. Any entry makes the trace incomplete. */
  warnings: string[];
  /** Caveats that do not break the path, such as an assumed optics class or an unrecorded core. */
  notes: string[];
  /** True only when no link on the path is missing. */
  complete: boolean;
  /** How the loss total was reached, for the "Estimated" label. */
  connectorPairsCounted: number;
  spliceRecordsCounted: number;
  /** The customer's reading, labelled with its origin. */
  rxReading?: RxReading;
}

const cableLengthMeters = (c: Cable): number =>
  c.lengthMeters > 0 ? c.lengthMeters : Math.round(polylineLengthMeters(c.coordinates || []));

const isSupportOnly = (type: string) => /Pole|Manhole|Chamber|Slack|Duct/i.test(type);
const isClosure = (type: string) => /Closure|Splice/i.test(type);
const isSplitterEquipment = (type: string) => type === 'Fiber Splitter' || type === 'Outdoor Splitter' || type === 'Ratio Coupler';

const hopTypeForCable = (c: Cable): FiberTraceHop['type'] =>
  c.type === 'Drop Fiber' ? 'Drop' : c.type === 'Main Feeder Fiber' ? 'Feeder' : 'Distribution';

const hopStatus = (status: string): FiberTraceHop['status'] => (status === 'Faulty' || status === 'Damaged' ? 'Faulty' : 'Normal');

const eqLabel = (eq: Equipment) => `${eq.name} (${eq.id})`;
const cableLabel = (c: Cable) => `${c.name} (${c.id})`;

/**
 * Traces a customer, equipment or cable back to its OLT using only linked records and recorded
 * values. Where a link or value is missing it says so in `warnings` and inserts a gap hop at that
 * point; it never falls back to the first OLT or ODF, an assumed port, core, ratio or drop length.
 * A trace with gaps carries no pass verdict. Loss totals are estimates built from `settings`.
 */
export function traceOpticalPath(
  targetId: string,
  data: TraceData,
  options: OpticalTraceOptions = {},
): OpticalTraceResult | null {
  const q = targetId.trim().toLowerCase();
  if (!q) return null;
  const customerList = data.customers || [];
  const equipmentList = data.equipment || [];
  const cableList = data.cables || [];

  const customer = customerList.find(
    (c) => c.id.toLowerCase() === q || (!!c.ontSerialNumber && c.ontSerialNumber.toLowerCase() === q) || c.name.toLowerCase() === q,
  );
  const equipment = !customer ? equipmentList.find((e) => e.id.toLowerCase() === q) : undefined;
  const cable = !customer && !equipment ? cableList.find((c) => c.id.toLowerCase() === q) : undefined;
  if (!customer && !equipment && !cable) return null;

  const settings = options.settings ?? DEFAULT_OPTICAL_SETTINGS;
  const wavelengthNm = options.wavelengthNm ?? 1490;
  const warnings: string[] = [];
  const notes: string[] = [];
  const hops: FiberTraceHop[] = [];
  const cableIds: string[] = [];
  const equipmentIds: string[] = [];
  const splitterLosses: SplitterLossSpec[] = [];
  let connectorPairs = 0;
  let spliceRecords = 0;
  let recordedSpliceLoss = 0;
  let cumulativeDistance = 0;
  let cumulativeLoss = 0;

  type NewHop = Omit<FiberTraceHop, 'index' | 'cumulativeDistanceMeters' | 'cumulativeLossDb'>;
  const appendHop = (hop: NewHop) => {
    cumulativeDistance += hop.hopDistanceMeters;
    cumulativeLoss = Math.round((cumulativeLoss + hop.hopLossDb) * 100) / 100;
    hops.push({
      ...hop,
      index: hops.length + 1,
      cumulativeDistanceMeters: Math.round(cumulativeDistance),
      cumulativeLossDb: cumulativeLoss,
    });
  };

  /** Records a missing link, in the result and at this point of the chain. */
  const addGap = (message: string) => {
    warnings.push(message);
    appendHop({
      id: `gap-${warnings.length}`,
      name: 'Missing link',
      type: 'Gap',
      status: 'Warning',
      hopDistanceMeters: 0,
      hopLossDb: 0,
      details: message,
      gap: true,
    });
  };

  /** One estimated connector pair where fiber is patched into this equipment. */
  const connectorLoss = () => {
    connectorPairs += 1;
    return settings.connectorPairDb;
  };

  const addCableHop = (c: Cable, coreNumber?: number) => {
    cableIds.push(c.id);
    const length = cableLengthMeters(c);
    if (length <= 0) addGap(`${cableLabel(c)} has no length recorded, so its loss is not counted.`);
    const core = coreNumber !== undefined ? c.cores.find((k) => k.coreNumber === coreNumber) : undefined;
    const coreText = core ? `Core ${core.coreNumber} (${core.colorName})` : 'Core not recorded';
    if (!core && c.type !== 'Coaxial Cable') notes.push(`${cableLabel(c)}: which core carries this path is not recorded.`);
    appendHop({
      id: c.id,
      name: c.name,
      type: hopTypeForCable(c),
      status: c.status === 'Damaged' ? 'Faulty' : 'Normal',
      hopDistanceMeters: length,
      hopLossDb: fiberLossDb(length, wavelengthNm, settings),
      coreNumber: core?.coreNumber,
      coreColorName: core?.colorName,
      coreColorHex: core?.colorHex,
      details: [`${c.fiberCount}F`, c.installationType ?? 'Installation not recorded', coreText].join(' · '),
    });
  };

  const addSplitterStage = (sp: Splitter, details: string, at?: Equipment) => {
    const spec: SplitterLossSpec = { ratio: sp.ratio, lossDb: sp.insertionLossDb };
    splitterLosses.push(spec);
    const loss = sp.insertionLossDb > 0 ? sp.insertionLossDb : settings.splitterDb[sp.ratio];
    appendHop({
      id: sp.id,
      name: `${sp.name}`,
      type: 'Splitter',
      status: sp.status === 'Faulty' ? 'Faulty' : sp.status === 'Maintenance' ? 'Warning' : 'Normal',
      lat: at?.lat,
      lng: at?.lng,
      hopDistanceMeters: 0,
      hopLossDb: loss,
      details: `${details} · Ratio ${sp.ratio}`,
      splitRatio: sp.ratio,
    });
  };

  /** Equipment the path passes through between two cables. */
  const addThroughEquipment = (eq: Equipment, previousCable?: Cable) => {
    equipmentIds.push(eq.id);
    const primary = previousCable
      ? (data.splitters || []).find((sp) => sp.terminalBoxId === eq.id && sp.inputPort.connectedCableId === previousCable.id)
      : undefined;

    if (isSplitterEquipment(eq.type) && !primary) {
      const ratio = eq.splitterConfig?.ratio;
      if (ratio) {
        splitterLosses.push({ ratio });
        appendHop({
          id: eq.id,
          name: eq.name,
          type: 'Splitter',
          status: hopStatus(eq.status),
          lat: eq.lat,
          lng: eq.lng,
          hopDistanceMeters: 0,
          hopLossDb: settings.splitterDb[ratio],
          details: `${eq.type} · Ratio ${ratio}`,
          equipmentType: eq.type,
          splitRatio: ratio,
        });
      } else {
        addGap(`${eqLabel(eq)} has no split ratio recorded, so its loss is not counted.`);
      }
      return;
    }

    appendHop({
      id: eq.id,
      name: eq.name,
      type: isClosure(eq.type) ? 'Closure' : eq.type,
      status: hopStatus(eq.status),
      lat: eq.lat,
      lng: eq.lng,
      hopDistanceMeters: 0,
      hopLossDb: isSupportOnly(eq.type) || isClosure(eq.type) ? 0 : connectorLoss(),
      details: eq.type,
      equipmentType: eq.type,
    });
    if (primary) addSplitterStage(primary, `Split stage in ${eq.id}`, eq);
  };

  /** Recorded splices joining two consecutive cables of this path. */
  const addRecordedSplices = (a: Cable, b: Cable) => {
    for (const closure of data.closures || []) {
      const joined = closure.splices.filter(
        (s) => (s.inputCableId === a.id && s.outputCableId === b.id) || (s.inputCableId === b.id && s.outputCableId === a.id),
      );
      const linksBoth =
        (closure.cableAId === a.id && closure.cableBId === b.id) || (closure.cableAId === b.id && closure.cableBId === a.id);
      if (joined.length === 0 && !linksBoth) continue;
      if (joined.length === 0) {
        notes.push(`${closure.name} (${closure.id}) joins ${a.id} and ${b.id} but holds no splice record.`);
        continue;
      }
      const loss = Math.max(...joined.map((s) => s.spliceLossDb || 0));
      spliceRecords += 1;
      recordedSpliceLoss += loss;
      appendHop({
        id: closure.id,
        name: closure.name,
        type: 'Closure',
        status: joined.some((s) => s.status === 'Failed' || s.status === 'Damaged') ? 'Warning' : 'Normal',
        lat: closure.lat,
        lng: closure.lng,
        hopDistanceMeters: 0,
        hopLossDb: loss,
        details: `${closure.closureType} · recorded splice loss ${loss} dB`,
      });
    }
  };

  const walkChain = (chain: UpstreamHop[]) => {
    chain.forEach((link, idx) => {
      if (idx > 0) {
        const previous = chain[idx - 1].cable;
        if (link.from) addThroughEquipment(link.from, previous);
        addRecordedSplices(previous, link.cable);
      }
      const coreRecord = link.cable.cores.find((k) => !!customer && k.customerId === customer.id)?.coreNumber;
      const inputCore =
        idx === chain.length - 1 && splitterForCustomer?.inputPort.connectedCableId === link.cable.id
          ? splitterForCustomer.inputPort.connectedCore
          : undefined;
      addCableHop(link.cable, coreRecord ?? inputCore);
    });
  };

  // --- Which records this path is built on -------------------------------------------------------

  const terminal = customer ? equipmentList.find((e) => e.id === customer.terminalBoxId) : undefined;
  const splitterForCustomer = customer ? (data.splitters || []).find((s) => s.id === customer.splitterId) : undefined;

  const startEquipment: Equipment | undefined = customer
    ? terminal
    : equipment ?? (cable?.startEquipmentId ? equipmentList.find((e) => e.id === cable.startEquipmentId) : undefined);

  const preferred = [
    customer?.feederCableId ?? '',
    customer?.distributionCableId ?? '',
    splitterForCustomer?.inputPort.connectedCableId ?? '',
  ];
  const chain = startEquipment ? findUpstreamChain(startEquipment.id, data, preferred) : [];

  // Two cables into one box: nothing on record says which one serves this path.
  for (const link of chain) {
    const atId = link.cable.endEquipmentId;
    if (!atId) continue;
    const incoming = upstreamCandidates(atId, data);
    if (incoming.length > 1 && !preferred.includes(link.cable.id)) {
      warnings.push(
        `${atId} is fed by ${incoming.length} cables (${incoming.map((c) => c.id).join(', ')}). No record says which one serves this path; ${link.cable.id} was followed.`,
      );
    }
  }

  const chainOlt = chain[0]?.from?.type === 'OLT' ? chain[0].from : undefined;
  const servingOlt =
    chainOlt ?? (startEquipment?.type === 'OLT' ? startEquipment : undefined);
  const recordedOlt = customer?.oltId ? equipmentList.find((e) => e.id === customer.oltId) : undefined;

  // --- OLT and PON port --------------------------------------------------------------------------

  const firstCable = chain[0]?.cable ?? (startEquipment?.type === 'OLT' ? cable : undefined);
  let pon: PonPort | undefined;
  const olt = servingOlt ?? recordedOlt;
  if (olt) {
    pon = findPon(olt, firstCable?.id, customer?.ponPort);
    const launch = options.oltTxPowerDbm ?? pon?.txPowerDbm;
    equipmentIds.push(olt.id);
    const tech = pon?.technology ?? olt.technology;
    appendHop({
      id: olt.id,
      name: pon ? `${olt.name} [Port: ${pon.slotCardPort || pon.id}]` : olt.name,
      type: 'OLT',
      status: olt.status === 'Faulty' ? 'Faulty' : 'Normal',
      lat: olt.lat,
      lng: olt.lng,
      portId: pon?.id,
      portName: pon ? pon.slotCardPort || pon.id : undefined,
      hopDistanceMeters: 0,
      hopLossDb: firstCable ? connectorLoss() : 0,
      details: [
        tech ?? 'Technology not recorded',
        launch !== undefined ? `Launch ${launch >= 0 ? '+' : ''}${launch} dBm (recorded)` : 'Launch not recorded',
      ].join(' · '),
      equipmentType: olt.type,
    });
    if (!pon && firstCable) addGap(`No PON port on ${eqLabel(olt)} is linked to ${cableLabel(firstCable)}.`);
  }

  if (customer && customer.oltId && !recordedOlt) {
    warnings.push(`${customer.name} points to OLT ${customer.oltId}, which no longer exists.`);
  }
  if (chainOlt && recordedOlt && chainOlt.id !== recordedOlt.id) {
    warnings.push(`${customer?.name} is recorded on ${recordedOlt.id}, but its cables lead to ${chainOlt.id}.`);
  }

  // --- Where the chain to the OLT breaks ---------------------------------------------------------

  if (startEquipment && startEquipment.type !== 'OLT' && !chainOlt) {
    if (chain.length === 0) {
      addGap(`No cable is linked into ${eqLabel(startEquipment)}, so nothing connects it to an OLT.`);
    } else if (!chain[0].from) {
      addGap(`${cableLabel(chain[0].cable)} has no start equipment, so the path to an OLT stops there.`);
    } else {
      addGap(`No cable is linked into ${eqLabel(chain[0].from)}, so the path to an OLT stops there.`);
      addThroughEquipment(chain[0].from);
    }
  }

  // --- Cables and equipment along the chain ------------------------------------------------------

  walkChain(chain);

  // --- The target itself -------------------------------------------------------------------------

  let rxReading: RxReading | undefined;

  if (customer) {
    if (!customer.terminalBoxId) addGap(`${customer.name} has no terminal box linked.`);
    else if (!terminal) addGap(`${customer.name} points to terminal box ${customer.terminalBoxId}, which no longer exists.`);
    else {
      equipmentIds.push(terminal.id);
      appendHop({
        id: terminal.id,
        name: terminal.name,
        type: 'FAT',
        status: hopStatus(terminal.status),
        lat: terminal.lat,
        lng: terminal.lng,
        portId: customer.splitterOutputPort ? `Port ${customer.splitterOutputPort}` : undefined,
        portName: customer.splitterOutputPort ? `Port ${customer.splitterOutputPort}` : undefined,
        hopDistanceMeters: 0,
        hopLossDb: connectorLoss(),
        details: terminal.type,
        equipmentType: terminal.type,
      });
    }

    if (!customer.splitterId) addGap(`${customer.name} has no splitter recorded at the terminal box.`);
    else if (!splitterForCustomer) addGap(`Splitter ${customer.splitterId} no longer exists.`);
    else {
      if (terminal && splitterForCustomer.terminalBoxId !== terminal.id) {
        addGap(`Splitter ${splitterForCustomer.id} is installed in ${splitterForCustomer.terminalBoxId}, not in ${terminal.id}.`);
      }
      const port = splitterForCustomer.outputPorts.find((p) => p.portNumber === customer.splitterOutputPort);
      if (!port) addGap(`Splitter ${splitterForCustomer.id} has no output port ${customer.splitterOutputPort}.`);
      else if (port.connectedCustomerId && port.connectedCustomerId !== customer.id) {
        addGap(`Port ${port.portNumber} of ${splitterForCustomer.id} is recorded for ${port.connectedCustomerName ?? port.connectedCustomerId}.`);
      }
      addSplitterStage(splitterForCustomer, `Output port ${customer.splitterOutputPort}`, terminal);
    }

    const drop = customer.dropCableId ? cableList.find((c) => c.id === customer.dropCableId) : undefined;
    if (!customer.dropCableId) addGap(`${customer.name} has no drop cable recorded.`);
    else if (!drop) addGap(`Drop cable ${customer.dropCableId} is not on the map, so its length is not counted.`);
    else addCableHop(drop, customer.fiberCore);

    rxReading = rxReadingOf(customer, settings);
    const located = hasRecordedLocation(customer);
    if (!located) notes.push(`${customer.name}: the house location is not recorded.`);
    appendHop({
      id: customer.id,
      name: `${customer.name} · ONT (${customer.ontSerialNumber || 'Serial not recorded'})`,
      type: 'ONT',
      status:
        rxReading.band === 'bad' || rxReading.band === 'too_much_light'
          ? 'Faulty'
          : rxReading.band === 'low_margin'
            ? 'Warning'
            : 'Normal',
      lat: located ? customer.lat : undefined,
      lng: located ? customer.lng : undefined,
      hopDistanceMeters: 0,
      hopLossDb: connectorLoss(),
      details: `${customer.routerModel || 'Model not recorded'} · Rx: ${rxReading.text}`,
      equipmentType: 'ONU',
    });
  } else if (equipment && equipment.type !== 'OLT') {
    addThroughEquipment(equipment, chain.at(-1)?.cable);
  } else if (cable) {
    if (startEquipment && startEquipment.type !== 'OLT') addThroughEquipment(startEquipment, chain.at(-1)?.cable);
    if (!cable.startEquipmentId) addGap(`${cableLabel(cable)} has no start equipment linked.`);
    else if (!startEquipment) addGap(`${cableLabel(cable)} starts at ${cable.startEquipmentId}, which no longer exists.`);
    addCableHop(cable);
    const end = cable.endEquipmentId ? equipmentList.find((e) => e.id === cable.endEquipmentId) : undefined;
    if (end) addThroughEquipment(end);
    else addGap(`${cableLabel(cable)} has no end equipment linked.`);
  }

  // --- Estimated budget --------------------------------------------------------------------------

  const technology = pon?.technology ?? olt?.technology;
  const opticsClass = options.opticsClass ?? opticsClassForTechnology(technology);
  if (!options.opticsClass) {
    notes.push(
      technology
        ? `The optics class is not recorded per port, so ${technology} was checked against ${opticsClass}.`
        : `Technology is not recorded, so this was checked against ${opticsClass}.`,
    );
  }
  const launchDbm = options.oltTxPowerDbm ?? pon?.txPowerDbm;
  if (customer && launchDbm === undefined) notes.push('OLT launch power is not recorded, so expected Rx is shown as a range.');
  if (spliceRecords === 0) notes.push('No splice loss is on record for this path, so splices are not counted. Real loss may be higher.');

  const parts = {
    totalDistanceMeters: cumulativeDistance,
    splitters: splitterLosses,
    connectorsCount: connectorPairs,
    recordedSpliceLossDb: recordedSpliceLoss,
    opticsClass,
  };
  const budget = calculateOpticalLossBudget(
    {
      ...parts,
      wavelengthNm,
      oltTxPowerDbm: launchDbm,
      measuredRxDbm: rxReading?.isMeasured ? rxReading.valueDbm : undefined,
    },
    settings,
  );

  const complete = warnings.length === 0;
  if (!complete) {
    budget.verdict = 'Incomplete';
    budget.verdictTitle = 'Path is not complete';
    budget.verdictDescription = `${warnings.length} missing ${warnings.length === 1 ? 'link' : 'links'}. The loss total covers only the linked part, so no pass or fail is given.`;
    budget.recommendedAction = warnings[0];
  } else if (!customer) {
    budget.verdict = 'Not Assessed';
    budget.verdictTitle = 'Loss so far';
    budget.verdictDescription = 'A budget check needs a whole path to a customer. This total stops at the selected item.';
    budget.recommendedAction = 'Trace a customer to check the whole path.';
  } else if (wavelengthNm !== 1310) {
    // 1310 nm upstream has more fiber loss and is usually the limit, so say when it changes the answer.
    const upstream = calculateOpticalLossBudget({ ...parts, wavelengthNm: 1310 }, settings);
    if (checkLinkBudget(upstream.totalLossDb, opticsClass, settings).verdict !== budget.linkVerdict) {
      notes.push(`At 1310 nm upstream the estimated loss is ${upstream.totalLossDb.toFixed(2)} dB: ${upstream.verdictTitle.toLowerCase()}.`);
    }
  }

  return {
    targetId: customer?.id || equipment?.id || cable?.id || targetId,
    targetLabel: customer
      ? `${customer.name} (ONT: ${customer.ontSerialNumber || 'serial not recorded'})`
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
    notes: [...new Set(notes)],
    complete,
    connectorPairsCounted: connectorPairs,
    spliceRecordsCounted: spliceRecords,
    rxReading,
  };
}
