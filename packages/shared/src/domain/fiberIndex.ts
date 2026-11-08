import {
  type ColorScheme,
  type CoreIdentity,
  coreIdentity,
  DEFAULT_COLOR_SCHEMES,
} from '../fiber/colors';
import type {
  Cable,
  Customer,
  Equipment,
  JointClosure,
  OdfPanel,
  OdfPort,
  PonPort,
  SpliceRecord,
  Splitter,
  SplitterPort,
} from '../model/types';
import { randomCode } from './fieldCapture';

/**
 * Core-level links between records. A fiber path is a chain of explicit records: OLT PON port,
 * patch, ODF port, cable core, splice, splitter input and output, drop core, ONT. Each cable core
 * has an OLT side (its source) and a customer side (its continuation). Nothing here is worked out
 * from position or from which cable ends at which box.
 */

export type FiberData = {
  equipment: readonly Equipment[];
  cables: readonly Cable[];
  splitters: readonly Splitter[];
  closures: readonly JointClosure[];
  customers: readonly Customer[];
};

export type CoreKey = string;
export const coreKey = (cableId: string, core: number): CoreKey => `${cableId}#${core}`;

/** Random record ids, so two offline browsers cannot make the same one. */
export const newFiberId = (prefix: 'CA' | 'SPC' | 'TRY' | 'ODP' | 'ODX' | 'CLO' | 'SPL'): string => `${prefix}-${randomCode(10)}`;

/** A splice that still joins its two cores. A planned splice already claims both sides. */
export const isSpliceActive = (s: SpliceRecord): boolean => !s.retiredAt && s.status !== 'Unused';

/** What feeds a core on its OLT side. */
export type CoreSource =
  | { kind: 'splice'; closure: JointClosure; splice: SpliceRecord }
  | { kind: 'splitter'; splitter: Splitter; port: SplitterPort }
  | { kind: 'odf'; odf: Equipment; panel: OdfPanel; port: OdfPort }
  | { kind: 'pon'; olt: Equipment; pon: PonPort };

/** Where a core goes on its customer side. */
export type CoreSink =
  | { kind: 'splice'; closure: JointClosure; splice: SpliceRecord }
  | { kind: 'splitter'; splitter: Splitter }
  | { kind: 'customer'; customer: Customer };

export interface OdfPortRef {
  odf: Equipment;
  panel: OdfPanel;
  port: OdfPort;
}

export interface FiberIndex {
  data: FiberData;
  cables: Map<string, Cable>;
  equipment: Map<string, Equipment>;
  splitters: Map<string, Splitter>;
  sources: Map<CoreKey, CoreSource[]>;
  sinks: Map<CoreKey, CoreSink[]>;
  /** `${oltId}/${ponPortId}` → ODF ports patched to it. */
  ponPatches: Map<string, OdfPortRef[]>;
  /** `${splitterId}#${port}` → splitters whose input is that output (cascade in one box). */
  cascadeChildren: Map<string, Splitter[]>;
  schemes: readonly ColorScheme[];
}

const push = <K, V>(map: Map<K, V[]>, key: K, value: V) => {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
};

export const ponKey = (oltId: string, ponPortId: string) => `${oltId}/${ponPortId}`;

export function buildFiberIndex(data: FiberData, schemes: readonly ColorScheme[] = DEFAULT_COLOR_SCHEMES): FiberIndex {
  const index: FiberIndex = {
    data,
    cables: new Map(data.cables.map((c) => [c.id, c])),
    equipment: new Map(data.equipment.map((e) => [e.id, e])),
    splitters: new Map(data.splitters.map((s) => [s.id, s])),
    sources: new Map(),
    sinks: new Map(),
    ponPatches: new Map(),
    cascadeChildren: new Map(),
    schemes,
  };
  for (const closure of data.closures) {
    for (const splice of closure.splices) {
      if (!isSpliceActive(splice)) continue;
      push(index.sources, coreKey(splice.outputCableId, splice.outputCore), { kind: 'splice', closure, splice });
      push(index.sinks, coreKey(splice.inputCableId, splice.inputCore), { kind: 'splice', closure, splice });
    }
  }
  for (const splitter of data.splitters) {
    const input = splitter.inputPort;
    if (input.connectedCableId && input.connectedCore) {
      push(index.sinks, coreKey(input.connectedCableId, input.connectedCore), { kind: 'splitter', splitter });
    }
    if (input.connectedSplitterId && input.connectedSplitterPort) {
      push(index.cascadeChildren, `${input.connectedSplitterId}#${input.connectedSplitterPort}`, splitter);
    }
    for (const port of splitter.outputPorts) {
      if (port.connectedDropCableId && port.connectedCore) {
        push(index.sources, coreKey(port.connectedDropCableId, port.connectedCore), { kind: 'splitter', splitter, port });
      }
    }
  }
  for (const eq of data.equipment) {
    for (const panel of eq.odfPanels ?? []) {
      for (const port of panel.ports) {
        if (port.feederCableId && port.feederCore) {
          push(index.sources, coreKey(port.feederCableId, port.feederCore), { kind: 'odf', odf: eq, panel, port });
        }
        if (port.patch) push(index.ponPatches, ponKey(port.patch.oltId, port.patch.ponPortId), { odf: eq, panel, port });
      }
    }
    for (const pon of eq.ponPorts ?? []) {
      if (pon.connectedFeederCableId && pon.feederCore) {
        push(index.sources, coreKey(pon.connectedFeederCableId, pon.feederCore), { kind: 'pon', olt: eq, pon });
      }
    }
  }
  for (const customer of data.customers) {
    if (customer.status === 'Disconnected') continue;
    if (customer.dropCableId && customer.fiberCore) {
      push(index.sinks, coreKey(customer.dropCableId, customer.fiberCore), { kind: 'customer', customer });
    }
  }
  return index;
}

export function identityOf(index: Pick<FiberIndex, 'cables' | 'schemes'>, cableId: string, core: number): CoreIdentity | undefined {
  const cable = index.cables.get(cableId);
  return cable ? coreIdentity(cable, core, index.schemes) : undefined;
}

/** "Fiber 3 of FDR-01 (Feeder A)", with the colour when the scheme is known. */
export function describeCore(index: Pick<FiberIndex, 'cables' | 'schemes'>, cableId: string, core: number): string {
  const cable = index.cables.get(cableId);
  if (!cable) return `fiber ${core} of cable ${cableId} (cable not on record)`;
  const id = coreIdentity(cable, core, index.schemes);
  const colour = id.fiberColor ? ` (${id.fiberColor.name}${id.tubeNumber !== undefined ? `, in tube ${id.tubeNumber}` : ''})` : '';
  return `fiber ${core}${colour} of ${cable.name}${cable.name !== cable.id ? ` (${cable.id})` : ''}`;
}

export const describeSource = (index: FiberIndex, s: CoreSource): string => {
  switch (s.kind) {
    case 'splice':
      return `splice in ${s.closure.name} from ${describeCore(index, s.splice.inputCableId, s.splice.inputCore)}`;
    case 'splitter':
      return `output ${s.port.portNumber} of splitter ${s.splitter.name}`;
    case 'odf':
      return `ODF ${s.odf.name} ${s.panel.label} port ${s.port.number}`;
    case 'pon':
      return `${s.olt.name} ${s.pon.id}`;
    default:
      return 'unknown';
  }
};

export const describeSink = (index: FiberIndex, s: CoreSink): string => {
  switch (s.kind) {
    case 'splice':
      return `splice in ${s.closure.name} to ${describeCore(index, s.splice.outputCableId, s.splice.outputCore)}`;
    case 'splitter':
      return `input of splitter ${s.splitter.name}`;
    case 'customer':
      return `ONT of ${s.customer.name}`;
    default:
      return 'unknown';
  }
};

/** Output count of a splitter, from its ratio. */
export const splitterCapacity = (s: Pick<Splitter, 'ratio'>): number => Number(s.ratio.split(':')[1]) || 0;

/** Configured loss of one output: the port's own for couplers, else the splitter's. */
export const splitterPortLossDb = (s: Splitter, portNumber: number): number | undefined => {
  const port = s.outputPorts.find((p) => p.portNumber === portNumber);
  if (port?.lossDb !== undefined) return port.lossDb;
  return s.insertionLossDb > 0 ? s.insertionLossDb : undefined;
};
