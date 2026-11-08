import type { CoreIdentity } from '../fiber/colors';
import type { PonTechnology } from '../model/enums';
import type { Cable, Customer, Equipment, PonPort, Splitter } from '../model/types';
import {
  buildFiberIndex,
  type CoreKey,
  coreKey,
  type CoreSource,
  describeCore,
  describeSink,
  describeSource,
  type FiberData,
  type FiberIndex,
  identityOf,
  isSpliceActive,
  ponKey,
  splitterCapacity,
  splitterPortLossDb,
} from './fiberIndex';
import { calculateOpticalLossBudget, type OpticalLossBudgetResult, type SplitterLossSpec } from './lossEngine';
import {
  checkLinkBudget,
  DEFAULT_OPTICAL_SETTINGS,
  fiberLossDb,
  type LinkVerdict,
  type OpticalSettings,
  type OpticsClass,
  opticsClassForTechnology,
  type WavelengthNm,
} from './opticalSettings';
import { cableLengths } from './outsidePlant';
import { rxReadingOf } from './rxReading';

/**
 * Core-level trace. It follows one fiber at a time from the customer's drop core back through
 * splitter ports, splices, ODF ports and patches to an OLT PON port, using only explicit records.
 * Where the chain breaks it names the exact missing link and gives no verdict. Loss is worked out
 * per wavelength and direction by `calculateOpticalLossBudget`, the one loss calculation.
 */

export type CorePathStepKind = 'olt' | 'patch' | 'odf' | 'cable' | 'splice' | 'splitter' | 'ont' | 'gap';

export interface CorePathStep {
  kind: CorePathStepKind;
  /** Record id the step stands for (cable, closure, splitter, ODF, OLT or customer). */
  id: string;
  title: string;
  detail: string;
  status: 'ok' | 'warning' | 'broken';
  cableId?: string;
  core?: number;
  identity?: CoreIdentity;
  lengthMeters?: number;
  lengthBasis?: 'optical' | 'sheath' | 'drawn';
  /** Loss of this step at the downstream wavelength, for the hop list. Estimated. */
  lossDb?: number;
  lat?: number;
  lng?: number;
}

export interface DirectionBudget {
  direction: 'downstream' | 'upstream';
  wavelengthNm: WavelengthNm;
  /** The wavelength the path really uses, when settings hold no value for it. */
  nominalNm?: number;
  budget: OpticalLossBudgetResult;
  /** A vendor's own budget for the port, kept apart from the class. */
  vendor?: { budgetDb: number; remainingDb: number; source?: string };
}

export interface CorePathResult {
  targetId: string;
  targetLabel: string;
  complete: boolean;
  /** OLT first. Gap steps mark exactly where the chain breaks. */
  steps: CorePathStep[];
  /** Each missing or broken link, in plain words. Any entry means no verdict. */
  gaps: string[];
  warnings: string[];
  notes: string[];
  olt?: Equipment;
  pon?: PonPort;
  opticsClass: OpticsClass;
  opticsClassRecorded: boolean;
  /** Only on a complete path. */
  directions: DirectionBudget[];
  /** Worst of the directions, only on a complete path. */
  verdict?: LinkVerdict;
  coreKeys: CoreKey[];
  cableIds: string[];
  equipmentIds: string[];
  splitterIds: string[];
  /** How the total was reached. */
  parts: PathParts;
}

export interface PathParts {
  distanceMeters: number;
  splitters: SplitterLossSpec[];
  splitProduct: number;
  connectorPairs: number;
  /** Splice loss in total: recorded values where known, else the setting for its type. */
  spliceLossDb: number;
  splicesRecorded: number;
  splicesDefaulted: number;
}

export interface CoreTraceOptions {
  settings?: OpticalSettings;
  index?: FiberIndex;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const VERDICT_RANK: Record<LinkVerdict, number> = {
  fits_with_margin: 0,
  fits_under_margin: 1,
  too_little_loss: 2,
  over_budget: 3,
};

/** Length used for loss: OTDR if recorded, else the sheath marks, else the drawn line. */
export function budgetLengthOf(cable: Cable): { meters: number; basis: 'optical' | 'sheath' | 'drawn' } {
  const lengths = cableLengths(cable);
  if (lengths.opticalMeters !== undefined) return { meters: lengths.opticalMeters, basis: 'optical' };
  if (lengths.sheathMeters !== undefined && lengths.sheathMeters > 0) return { meters: lengths.sheathMeters, basis: 'sheath' };
  return { meters: cable.lengthMeters > 0 ? cable.lengthMeters : Math.round(lengths.drawnMeters ?? 0), basis: 'drawn' };
}

const isAccessTerminal = (type?: string) =>
  !!type && (type === 'FAT' || type.includes('Terminal Box') || type === 'Distribution Point' || type === 'FDT');

/** Downstream and upstream wavelengths for a technology, and which settings value stands in. */
export function wavelengthsFor(technology?: PonTechnology): { down: WavelengthNm; up: WavelengthNm; downNominal?: number; upNominal?: number } {
  if (technology === 'XGS-PON' || technology === 'XG-PON' || technology === '10G-EPON') {
    return { down: 1550, up: 1310, downNominal: 1577, upNominal: 1270 };
  }
  return { down: 1490, up: 1310 };
}

/** Which optics family a class belongs to. */
const classFamily = (c: OpticsClass): 'GPON' | 'EPON' | 'XG' => (c.startsWith('GPON') ? 'GPON' : c.startsWith('EPON') ? 'EPON' : 'XG');
const technologyFamily = (t?: PonTechnology): 'GPON' | 'EPON' | 'XG' | 'any' | undefined =>
  !t ? undefined : t === 'GPON' ? 'GPON' : t === 'EPON' ? 'EPON' : t === 'Combo PON' ? 'any' : 'XG';

/** A port's recorded class against its technology. Null when they fit or either is unknown. */
export function opticsClassMismatch(pon: Pick<PonPort, 'opticsClass' | 'technology'>, olt?: Pick<Equipment, 'technology'>): string | null {
  const cls = pon.opticsClass;
  const tech = pon.technology ?? olt?.technology;
  const family = technologyFamily(tech);
  if (!cls || !family || family === 'any') return null;
  return classFamily(cls) === family ? null : `${tech} port with ${cls} optics: the class does not fit the technology.`;
}

class StepCollector {
  steps: CorePathStep[] = [];
  gaps: string[] = [];
  warnings: string[] = [];
  notes: string[] = [];
  coreKeys: CoreKey[] = [];
  cableIds: string[] = [];
  equipmentIds: string[] = [];
  splitterIds: string[] = [];
  parts: PathParts = {
    distanceMeters: 0,
    splitters: [],
    splitProduct: 1,
    connectorPairs: 0,
    spliceLossDb: 0,
    splicesRecorded: 0,
    splicesDefaulted: 0,
  };
  olt?: Equipment;
  pon?: PonPort;

  constructor(
    private index: FiberIndex,
    private settings: OpticalSettings,
  ) {}

  /** Steps are collected customer first and reversed at the end. */
  add(step: CorePathStep) {
    this.steps.push(step);
  }

  gap(message: string, at?: { lat?: number; lng?: number }) {
    this.gaps.push(message);
    this.add({ kind: 'gap', id: `gap-${this.gaps.length}`, title: 'Missing link', detail: message, status: 'broken', ...at });
  }

  connector(eq?: Equipment) {
    this.parts.connectorPairs += 1;
    if (eq) this.equipmentIds.push(eq.id);
    return this.settings.connectorPairDb;
  }

  cable(cableId: string, core: number): Cable | undefined {
    const cable = this.index.cables.get(cableId);
    if (!cable) {
      this.gap(`Cable ${cableId} is named on this path but is not on record.`);
      return undefined;
    }
    const identity = identityOf(this.index, cableId, core)!;
    if (!identity.exists) {
      this.gap(`${cable.name} has ${cable.fiberCount} fibers, so fiber ${core} does not exist.`);
      return undefined;
    }
    const length = budgetLengthOf(cable);
    this.parts.distanceMeters += length.meters;
    this.coreKeys.push(coreKey(cableId, core));
    this.cableIds.push(cableId);
    const coreRecord = cable.cores.find((k) => k.coreNumber === core);
    const broken = cable.status === 'Damaged' || coreRecord?.status === 'Damaged';
    if (broken) this.warnings.push(`${describeCore(this.index, cableId, core)} is marked damaged.`);
    if (length.meters <= 0) this.gap(`${cable.name} has no length recorded, so its loss cannot be counted.`);
    if (!identity.schemeKnown) this.notes.push(`${cable.name}: colour scheme not recorded, so fibers are shown by number only.`);
    const coords = cable.coordinates;
    const mid = coords[Math.floor(coords.length / 2)];
    this.add({
      kind: 'cable',
      id: cable.id,
      title: `${cable.name}`,
      detail: `${identity.label} · ${cable.fiberCount}F · ${length.meters} m (${length.basis === 'optical' ? 'OTDR' : length.basis === 'sheath' ? 'sheath marks' : 'drawn line'})`,
      status: broken ? 'warning' : 'ok',
      cableId,
      core,
      identity,
      lengthMeters: length.meters,
      lengthBasis: length.basis,
      lossDb: fiberLossDb(length.meters, 1490, this.settings),
      lat: mid?.[0],
      lng: mid?.[1],
    });
    return cable;
  }
}

/** The one source of a core, or a gap describing why there is none or more than one. */
function sourceOf(index: FiberIndex, cableId: string, core: number): CoreSource | string {
  const sources = index.sources.get(coreKey(cableId, core)) ?? [];
  if (sources.length === 1) return sources[0];
  const what = describeCore(index, cableId, core);
  if (sources.length === 0) {
    return `${what[0].toUpperCase()}${what.slice(1)} has no recorded link on its OLT side: no splice, splitter output, ODF port or PON port feeds it. Record where it is joined.`;
  }
  return `${what[0].toUpperCase()}${what.slice(1)} has ${sources.length} feeds on record (${sources.map((s) => describeSource(index, s)).join('; ')}). Only one can be right.`;
}

/**
 * Walks upstream from a cable core. Stops at a PON port (complete) or at the first missing link.
 * Steps are added customer-first.
 */
function walkUpstream(col: StepCollector, index: FiberIndex, settings: OpticalSettings, start: { cableId: string; core: number }) {
  let current: { cableId: string; core: number } | undefined = start;
  const seen = new Set<string>();
  for (let guard = 0; current && guard < 200; guard += 1) {
    const key = coreKey(current.cableId, current.core);
    if (seen.has(key)) {
      col.gap(`The path loops back to ${describeCore(index, current.cableId, current.core)}. A splice or splitter link is recorded the wrong way round.`);
      return;
    }
    seen.add(key);
    const cable = col.cable(current.cableId, current.core);
    if (!cable) return;
    const source = sourceOf(index, current.cableId, current.core);
    if (typeof source === 'string') {
      col.gap(source, { lat: cable.coordinates[0]?.[0], lng: cable.coordinates[0]?.[1] });
      return;
    }
    switch (source.kind) {
      case 'splice': {
        const { closure, splice } = source;
        const tray = closure.trays?.find((t) => t.id === splice.trayId);
        const type = splice.spliceType ?? 'fusion';
        const recorded = splice.spliceLossDb !== undefined && splice.lossSource !== undefined;
        const legacy = splice.spliceLossDb !== undefined && splice.lossSource === undefined;
        const loss = splice.spliceLossDb ?? (type === 'mechanical' ? settings.mechanicalSpliceDb : settings.fusionSpliceDb);
        if (splice.spliceLossDb !== undefined) col.parts.splicesRecorded += 1;
        else col.parts.splicesDefaulted += 1;
        col.parts.spliceLossDb = round2(col.parts.spliceLossDb + loss);
        const lossText = splice.spliceLossDb === undefined
          ? `${loss} dB (setting for ${type}; nothing recorded)`
          : `${splice.spliceLossDb} dB (${recorded ? (splice.lossSource === 'field_measured' || splice.lossSource === 'device_reported' ? 'measured' : splice.lossSource) : legacy ? 'origin not recorded' : ''})`;
        const failed = splice.status === 'Failed' || splice.status === 'Damaged';
        col.add({
          kind: 'splice',
          id: closure.id,
          title: `Splice in ${closure.name}${tray ? `, ${tray.label}` : ''}`,
          detail: `${describeCore(index, splice.inputCableId, splice.inputCore)} → ${describeCore(index, splice.outputCableId, splice.outputCore)} · ${type} · ${lossText}${splice.otdrRef ? ` · OTDR ${splice.otdrRef}` : ''}`,
          status: failed ? 'broken' : splice.status === 'Pending' ? 'warning' : 'ok',
          lossDb: loss,
          lat: closure.lat,
          lng: closure.lng,
        });
        if (closure.equipmentId) col.equipmentIds.push(closure.equipmentId);
        if (splice.status === 'Pending') {
          col.gap(`The splice in ${closure.name} from ${describeCore(index, splice.inputCableId, splice.inputCore)} is planned, not done.`, closure);
          return;
        }
        if (failed) {
          col.gap(`The splice in ${closure.name} from ${describeCore(index, splice.inputCableId, splice.inputCore)} is marked ${splice.status.toLowerCase()}.`, closure);
          return;
        }
        if (splice.spliceLossDb !== undefined && type === 'fusion' && splice.spliceLossDb > settings.limits.spliceRejectDb) {
          col.warnings.push(`Splice in ${closure.name} records ${splice.spliceLossDb} dB, above the ${settings.limits.spliceRejectDb} dB redo level.`);
        }
        current = { cableId: splice.inputCableId, core: splice.inputCore };
        break;
      }
      case 'splitter': {
        const next = walkSplitter(col, index, settings, source.splitter, source.port.portNumber);
        if (!next) return;
        current = next;
        break;
      }
      case 'odf': {
        const { odf, panel, port } = source;
        const loss = col.connector(odf);
        col.add({
          kind: 'odf',
          id: odf.id,
          title: `${odf.name}, ${panel.label} port ${port.number}`,
          detail: `Feeder ${describeCore(index, port.feederCableId!, port.feederCore!)} at the back${port.connectorType ? ` · ${port.connectorType}` : ''} · one connector pair, estimated ${loss} dB`,
          status: port.status === 'damaged' ? 'broken' : 'ok',
          lossDb: loss,
          lat: odf.lat,
          lng: odf.lng,
        });
        if (port.status === 'damaged') {
          col.gap(`${odf.name} ${panel.label} port ${port.number} is marked damaged.`, odf);
          return;
        }
        if (!port.patch) {
          col.gap(`${odf.name} ${panel.label} port ${port.number} has no patch to an OLT PON port.`, odf);
          return;
        }
        const olt = index.equipment.get(port.patch.oltId);
        const pon = olt?.ponPorts?.find((p) => p.id === port.patch!.ponPortId);
        if (!olt || !pon) {
          col.gap(`${odf.name} ${panel.label} port ${port.number} is patched to ${port.patch.oltId} ${port.patch.ponPortId}, which is not on record.`, odf);
          return;
        }
        col.add({
          kind: 'patch',
          id: `${odf.id}/${port.id}`,
          title: `Patch cord${port.patch.cordLabel ? ` ${port.patch.cordLabel}` : ''}`,
          detail: `${olt.name} ${pon.vendorAddress ?? pon.slotCardPort ?? pon.id} → ${odf.name} ${panel.label} port ${port.number}`,
          status: 'ok',
        });
        addOlt(col, olt, pon);
        return;
      }
      case 'pon':
        addOlt(col, source.olt, source.pon);
        return;
      default:
        return;
    }
  }
}

function addOlt(col: StepCollector, olt: Equipment, pon: PonPort) {
  const loss = col.connector(olt);
  col.olt = olt;
  col.pon = pon;
  const address = pon.vendorAddress ?? pon.slotCardPort;
  col.add({
    kind: 'olt',
    id: olt.id,
    title: `${olt.name}, ${pon.id}${address ? ` (${address})` : ''}`,
    detail: [
      pon.technology ?? olt.technology ?? 'Technology not recorded',
      pon.opticsClass ? `${pon.opticsClass} optics` : 'Optics class not recorded',
      pon.txPowerDbm !== undefined ? `launch ${pon.txPowerDbm} dBm (recorded)` : 'launch not recorded',
      `one connector pair, estimated ${loss} dB`,
    ].join(' · '),
    status: pon.status === 'Faulty' ? 'broken' : 'ok',
    lossDb: loss,
    lat: olt.lat,
    lng: olt.lng,
  });
  if (pon.status === 'Faulty') col.warnings.push(`${olt.name} ${pon.id} is marked faulty.`);
}

/** Adds one splitter stage and returns the core feeding its input, or nothing at a gap. */
function walkSplitter(
  col: StepCollector,
  index: FiberIndex,
  _settings: OpticalSettings,
  splitter: Splitter,
  outputPort: number,
): { cableId: string; core: number } | undefined {
  const seen = new Set<string>();
  let sp: Splitter | undefined = splitter;
  let port = outputPort;
  while (sp) {
    if (seen.has(sp.id)) {
      col.gap(`Splitter ${sp.name} feeds back into its own tree.`);
      return undefined;
    }
    seen.add(sp.id);
    col.splitterIds.push(sp.id);
    const host = index.equipment.get(sp.terminalBoxId);
    const loss = splitterPortLossDb(sp, port);
    const n = splitterCapacity(sp);
    col.parts.splitProduct *= sp.couplerRatio ? 1 : n || 1;
    const portRecord = sp.outputPorts.find((p) => p.portNumber === port);
    let connectorLoss = 0;
    if (isAccessTerminal(host?.type) && col.steps.at(-1)?.kind === 'cable' && col.cableIds.length === 1) {
      // Output adapter in the access box where the drop is plugged in.
      connectorLoss = col.connector(host);
    }
    if (loss === undefined) {
      col.gap(`Splitter ${sp.name} has no insertion loss recorded for output ${port}.`, host);
    } else {
      col.parts.splitters.push({ ratio: sp.couplerRatio ?? sp.ratio, lossDb: loss });
    }
    col.add({
      kind: 'splitter',
      id: sp.id,
      title: `Splitter ${sp.name}${host ? ` in ${host.name}` : ''}`,
      detail: `${sp.couplerRatio ? `Coupler ${sp.couplerRatio}` : `${sp.kind ?? 'PLC'} ${sp.ratio}`} · output ${port}${portRecord?.label ? ` (${portRecord.label})` : ''} · ${loss !== undefined ? `${loss} dB configured${sp.lossSource ? ` (${sp.lossSource})` : ''}` : 'loss not recorded'}${connectorLoss ? ` · output adapter, estimated ${connectorLoss} dB` : ''}`,
      status: sp.status === 'Faulty' || portRecord?.status === 'Faulty' ? 'broken' : 'ok',
      lossDb: round2((loss ?? 0) + connectorLoss),
      lat: host?.lat,
      lng: host?.lng,
    });
    if (sp.status === 'Faulty') {
      col.gap(`Splitter ${sp.name} is marked faulty.`, host);
      return undefined;
    }
    if (n > 0 && port > n) {
      col.gap(`Splitter ${sp.name} is ${sp.ratio}, so output ${port} does not exist.`, host);
      return undefined;
    }
    const input = sp.inputPort;
    if (input.connectedSplitterId) {
      const parent = index.splitters.get(input.connectedSplitterId);
      if (!parent || !input.connectedSplitterPort) {
        col.gap(`The input of splitter ${sp.name} is recorded as fed by splitter ${input.connectedSplitterId}${input.connectedSplitterPort ? ` output ${input.connectedSplitterPort}` : ''}, which is not on record.`, host);
        return undefined;
      }
      port = input.connectedSplitterPort;
      sp = parent;
      continue;
    }
    if (!input.connectedCableId) {
      col.gap(`The input of splitter ${sp.name} is not linked to a cable fiber. Record which fiber feeds it.`, host);
      return undefined;
    }
    if (!input.connectedCore) {
      col.gap(`The input of splitter ${sp.name} is linked to cable ${input.connectedCableId}, but not to a fiber number. Record which fiber.`, host);
      return undefined;
    }
    return { cableId: input.connectedCableId, core: input.connectedCore };
  }
  return undefined;
}

function finish(
  col: StepCollector,
  settings: OpticalSettings,
  target: { id: string; label: string },
  opts: { measuredRxDbm?: number; assessed: boolean },
): CorePathResult {
  const steps = [...col.steps].reverse();
  const pon = col.pon;
  const olt = col.olt;
  const technology = pon?.technology ?? olt?.technology;
  const opticsClassRecorded = !!pon?.opticsClass;
  const opticsClass = pon?.opticsClass ?? opticsClassForTechnology(technology);
  const notes = [...new Set(col.notes)];
  const warnings = [...col.warnings];
  if (pon && !opticsClassRecorded) {
    notes.push(`The optics class of ${pon.id} is not recorded, so ${technology ?? 'this port'} was checked against ${opticsClass}. Record the class on the port.`);
  }
  if (pon) {
    const mismatch = opticsClassMismatch(pon, olt);
    if (mismatch) warnings.push(mismatch);
  }
  if (col.parts.splicesDefaulted > 0) {
    notes.push(`${col.parts.splicesDefaulted} splice(s) have no recorded loss, so the setting for their type is used.`);
  }
  notes.push(`Connector pairs are counted from the ports on the path (${col.parts.connectorPairs}), each at the estimated ${settings.connectorPairDb} dB.`);
  if (col.parts.splitProduct > settings.limits.splitProduct) {
    warnings.push(`The splits on this path multiply to 1:${col.parts.splitProduct}, above the ${settings.limits.splitProduct} limit in settings.`);
  }

  const complete = col.gaps.length === 0 && !!pon;
  const directions: DirectionBudget[] = [];
  let verdict: LinkVerdict | undefined;
  if (complete && opts.assessed) {
    const wl = wavelengthsFor(technology);
    if (wl.downNominal) notes.push(`Settings hold no loss for ${wl.downNominal}/${wl.upNominal} nm, so the ${wl.down}/${wl.up} nm values are used.`);
    for (const [direction, nm, nominal] of [
      ['downstream', wl.down, wl.downNominal],
      ['upstream', wl.up, wl.upNominal],
    ] as const) {
      const budget = calculateOpticalLossBudget(
        {
          totalDistanceMeters: col.parts.distanceMeters,
          wavelengthNm: nm,
          splitters: col.parts.splitters,
          connectorsCount: col.parts.connectorPairs,
          recordedSpliceLossDb: col.parts.spliceLossDb,
          opticsClass,
          oltTxPowerDbm: direction === 'downstream' ? pon?.txPowerDbm : undefined,
          measuredRxDbm: direction === 'downstream' ? opts.measuredRxDbm : undefined,
        },
        settings,
      );
      const vendorBudget = pon?.vendorBudgetDb;
      directions.push({
        direction,
        wavelengthNm: nm,
        nominalNm: nominal,
        budget,
        vendor:
          vendorBudget !== undefined
            ? { budgetDb: vendorBudget, remainingDb: round2(vendorBudget - budget.totalLossDb), source: pon?.vendorBudgetSource }
            : undefined,
      });
      const v = checkLinkBudget(budget.totalLossDb, opticsClass, settings).verdict;
      if (verdict === undefined || VERDICT_RANK[v] > VERDICT_RANK[verdict]) verdict = v;
    }
  }
  return {
    targetId: target.id,
    targetLabel: target.label,
    complete,
    steps,
    gaps: col.gaps,
    warnings,
    notes,
    olt,
    pon,
    opticsClass,
    opticsClassRecorded,
    directions,
    verdict,
    coreKeys: col.coreKeys,
    cableIds: [...new Set(col.cableIds)],
    equipmentIds: [...new Set(col.equipmentIds)],
    splitterIds: col.splitterIds,
    parts: col.parts,
  };
}

/** Traces a customer's light core by core, from the ONT back to the OLT PON port. */
export function traceCustomerCores(customer: Customer, data: FiberData, options: CoreTraceOptions = {}): CorePathResult {
  const settings = options.settings ?? DEFAULT_OPTICAL_SETTINGS;
  const index = options.index ?? buildFiberIndex(data);
  const col = new StepCollector(index, settings);
  const reading = rxReadingOf(customer, settings);
  const ontLoss = col.connector();
  col.add({
    kind: 'ont',
    id: customer.id,
    title: `${customer.name}: ONT ${customer.ontSerialNumber || '(serial not recorded)'}`,
    detail: `Rx ${reading.text} · one connector pair, estimated ${ontLoss} dB`,
    status: 'ok',
    lossDb: ontLoss,
    lat: customer.lat || undefined,
    lng: customer.lng || undefined,
  });
  if (!customer.dropCableId) col.gap(`${customer.name} has no drop cable recorded.`);
  else if (!customer.fiberCore) col.gap(`${customer.name}'s drop fiber number is not recorded.`);
  else {
    const sinks = index.sinks.get(coreKey(customer.dropCableId, customer.fiberCore)) ?? [];
    const others = sinks.filter((s) => !(s.kind === 'customer' && (s.customer.id === customer.id || (!!customer.ontId && s.customer.ontId === customer.ontId))));
    if (others.length > 0) {
      col.warnings.push(`${describeCore(index, customer.dropCableId, customer.fiberCore)} is also recorded for ${others.map((s) => describeSink(index, s)).join('; ')}.`);
    }
    walkUpstream(col, index, settings, { cableId: customer.dropCableId, core: customer.fiberCore });
  }
  const result = finish(
    col,
    settings,
    { id: customer.id, label: `${customer.name} (${customer.id})` },
    { measuredRxDbm: reading.isMeasured ? reading.valueDbm : undefined, assessed: true },
  );
  if (customer.splitterId && result.splitterIds.length > 0 && !result.splitterIds.includes(customer.splitterId)) {
    result.warnings.push(`${customer.name} is recorded on splitter ${customer.splitterId}, but the fibers lead to ${result.splitterIds[0]}.`);
  }
  if (customer.oltId && result.olt && result.olt.id !== customer.oltId) {
    result.warnings.push(`${customer.name} is recorded on ${customer.oltId}, but the fibers lead to ${result.olt.id}.`);
  }
  return result;
}

/** Traces one cable core back to its PON port. No budget verdict: it stops before a customer. */
export function traceCoreUpstream(cableId: string, core: number, data: FiberData, options: CoreTraceOptions = {}): CorePathResult {
  const settings = options.settings ?? DEFAULT_OPTICAL_SETTINGS;
  const index = options.index ?? buildFiberIndex(data);
  const col = new StepCollector(index, settings);
  walkUpstream(col, index, settings, { cableId, core });
  return finish(col, settings, { id: coreKey(cableId, core), label: describeCore(index, cableId, core) }, { assessed: false });
}

/* ------------------------------------------------------------------ */
/* Downstream: what a PON port feeds                                    */
/* ------------------------------------------------------------------ */

export interface PonTreeLeaf {
  customer: Customer;
  path: CorePathResult;
}

export interface PonTree {
  olt: Equipment;
  pon: PonPort;
  /** The first core the port drives, through its patch and ODF or directly. */
  feederCores: { cableId: string; core: number }[];
  coreKeys: CoreKey[];
  splitterIds: string[];
  customers: Customer[];
  leaves: PonTreeLeaf[];
  /** Highest product of split ratios to any customer. */
  maxSplitProduct: number;
  problems: string[];
}

/** Every core, splitter and customer a PON port reaches, following continuations downstream. */
export function tracePonTree(oltId: string, ponPortId: string, data: FiberData, options: CoreTraceOptions = {}): PonTree | undefined {
  const settings = options.settings ?? DEFAULT_OPTICAL_SETTINGS;
  const index = options.index ?? buildFiberIndex(data);
  const olt = index.equipment.get(oltId);
  const pon = olt?.ponPorts?.find((p) => p.id === ponPortId);
  if (!olt || !pon) return undefined;
  const feederCores: { cableId: string; core: number }[] = [];
  for (const ref of index.ponPatches.get(ponKey(oltId, ponPortId)) ?? []) {
    if (ref.port.feederCableId && ref.port.feederCore) feederCores.push({ cableId: ref.port.feederCableId, core: ref.port.feederCore });
  }
  if (pon.connectedFeederCableId && pon.feederCore) feederCores.push({ cableId: pon.connectedFeederCableId, core: pon.feederCore });

  const coreKeys: CoreKey[] = [];
  const splitterIds: string[] = [];
  const customers: Customer[] = [];
  const problems: string[] = [];
  const seenCores = new Set<string>();
  const seenSplitters = new Set<string>();
  const queue = [...feederCores];
  const visitSplitter = (sp: Splitter) => {
    if (seenSplitters.has(sp.id)) {
      problems.push(`Splitter ${sp.name} is reached twice from ${olt.name} ${pon.id}: its output loops back into its own tree.`);
      return;
    }
    seenSplitters.add(sp.id);
    splitterIds.push(sp.id);
    for (const port of sp.outputPorts) {
      if (port.connectedDropCableId && port.connectedCore) queue.push({ cableId: port.connectedDropCableId, core: port.connectedCore });
      for (const child of index.cascadeChildren.get(`${sp.id}#${port.portNumber}`) ?? []) visitSplitter(child);
    }
  };
  for (let guard = 0; queue.length && guard < 5000; guard += 1) {
    const next = queue.shift()!;
    const key = coreKey(next.cableId, next.core);
    if (seenCores.has(key)) continue;
    seenCores.add(key);
    coreKeys.push(key);
    for (const sink of index.sinks.get(key) ?? []) {
      if (sink.kind === 'splice' && isSpliceActive(sink.splice)) queue.push({ cableId: sink.splice.outputCableId, core: sink.splice.outputCore });
      else if (sink.kind === 'splitter') visitSplitter(sink.splitter);
      else if (sink.kind === 'customer') customers.push(sink.customer);
    }
  }
  const leaves = customers.map((customer) => ({ customer, path: traceCustomerCores(customer, data, { settings, index }) }));
  const maxSplitProduct = leaves.reduce((m, l) => Math.max(m, l.path.parts.splitProduct), 1);
  if (pon.maxOnu !== undefined && customers.length > pon.maxOnu) {
    problems.push(`${olt.name} ${pon.id} reaches ${customers.length} customers, above its recorded limit of ${pon.maxOnu} ONUs.`);
  }
  const complete = leaves.filter((l) => l.path.complete && l.path.directions.length > 0);
  if (complete.length > 1) {
    const losses = complete.map((l) => l.path.directions[0].budget.totalLossDb);
    const spread = Math.max(...losses) - Math.min(...losses);
    if (spread > settings.limits.ponSpreadDb) {
      problems.push(`Path loss on ${olt.name} ${pon.id} differs by ${round2(spread)} dB between customers, above the ${settings.limits.ponSpreadDb} dB limit.`);
    }
    const km = complete.map((l) => l.path.parts.distanceMeters / 1000);
    const kmSpread = Math.max(...km) - Math.min(...km);
    if (kmSpread > settings.limits.ponSpreadKm) {
      problems.push(`Fiber distance on ${olt.name} ${pon.id} differs by ${round2(kmSpread)} km between customers, above the ${settings.limits.ponSpreadKm} km limit.`);
    }
  }
  return { olt, pon, feederCores, coreKeys, splitterIds, customers, leaves, maxSplitProduct, problems };
}

/** Plain words for a verdict, for engineers. Field screens show a next action instead. */
export const LINK_VERDICT_LABELS: Record<LinkVerdict, string> = {
  too_little_loss: 'Too little loss (too much light)',
  fits_with_margin: 'Fits with margin',
  fits_under_margin: 'Fits, but under the repair margin',
  over_budget: 'Over budget',
};
