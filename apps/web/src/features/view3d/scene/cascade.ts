import {
  buildFiberIndex,
  type Cable,
  type ColorScheme,
  coreKey,
  type Customer,
  DEFAULT_COLOR_SCHEMES,
  type Equipment,
  type FiberData,
  type FiberIndex,
  identityOf,
  ponKey,
  type PonPort,
  type Splitter,
  splitterCapacity,
} from '@fibergis/shared';

import type { CableRole, PathHop } from './types';

/**
 * Walks every PON tree. First fiber by fiber from the PON port (splices, splitter inputs, cascade
 * links and drop fibers, exactly as recorded). Customers that walk does not reach are then placed
 * from the links written on the customer record (OLT, PON port, splitter, output), with each
 * missing link named. Position on the map is never used to connect anything.
 */

export interface CableRoleInfo {
  role: CableRole;
  level?: number;
  ponKeys: Set<string>;
}

export interface SplitterPlace {
  level: number;
  ponKey: string;
  /** The splitter and output feeding this one, when recorded. */
  parent?: { splitterId: string; port?: number };
  /** Outputs that feed another splitter. */
  childPorts: Set<number>;
}

export interface WalkedPath {
  ponKey?: string;
  hops: PathHop[];
  source: 'fiber' | 'record';
  complete: boolean;
  fatBoxId?: string;
  fatPort?: number;
  dropCableId?: string;
  dropCore?: number;
  /** Drawn lengths (metres) of the cables on the path, as recorded. */
  cableIds: string[];
  splices: number;
}

export interface PonTree {
  key: string;
  oltId: string;
  ponId: string;
  label: string;
  pon: PonPort;
  olt: Equipment;
  splitterIds: string[];
  customerIds: string[];
  feederCableIds: string[];
  sources: Set<'fiber' | 'record'>;
}

export interface CascadeResult {
  index: FiberIndex;
  pons: PonTree[];
  cableRoles: Map<string, CableRoleInfo>;
  splitters: Map<string, SplitterPlace>;
  paths: Map<string, WalkedPath>;
}

/** "PON 0/1/3" from what the record says: vendor address, then slot/card/port, then the id. */
export function ponLabel(pon: PonPort): string {
  if (pon.vendorAddress) return `PON ${pon.vendorAddress}`;
  if (pon.slotCardPort) return `PON ${pon.slotCardPort}`;
  return pon.id.toUpperCase().startsWith('PON') ? pon.id : `PON ${pon.id}`;
}

const boxName = (index: FiberIndex, sp: Splitter) => index.equipment.get(sp.terminalBoxId)?.name ?? sp.name;

export function walkCascade(data: FiberData, schemes: readonly ColorScheme[] = DEFAULT_COLOR_SCHEMES): CascadeResult {
  const index = buildFiberIndex(data, schemes);
  const cableRoles = new Map<string, CableRoleInfo>();
  const splitters = new Map<string, SplitterPlace>();
  const paths = new Map<string, WalkedPath>();
  const pons: PonTree[] = [];
  const ponByKey = new Map<string, PonTree>();

  const setRole = (cableId: string, role: CableRole, key: string, level?: number) => {
    const info = cableRoles.get(cableId);
    if (!info) {
      cableRoles.set(cableId, { role, level, ponKeys: new Set([key]) });
      return;
    }
    info.ponKeys.add(key);
    // A drop found later wins over a provisional branch role; feeder never turns into a drop.
    if (role === 'drop' && info.role === 'branch') {
      info.role = 'drop';
      info.level = undefined;
    }
  };

  for (const olt of data.equipment) {
    if (olt.type !== 'OLT') continue;
    for (const pon of olt.ponPorts ?? []) {
      const key = ponKey(olt.id, pon.id);
      const tree: PonTree = {
        key,
        oltId: olt.id,
        ponId: pon.id,
        label: ponLabel(pon),
        pon,
        olt,
        splitterIds: [],
        customerIds: [],
        feederCableIds: [],
        sources: new Set(),
      };
      pons.push(tree);
      ponByKey.set(key, tree);
      const ponHop: PathHop = { kind: 'pon', oltId: olt.id, ponId: pon.id, label: tree.label };

      const seenCores = new Set<string>();
      const walkCore = (
        cableId: string,
        core: number,
        hops: PathHop[],
        level: number,
        cablesSoFar: string[],
        splices: number,
      ) => {
        const ck = coreKey(cableId, core);
        if (seenCores.has(ck)) return;
        seenCores.add(ck);
        setRole(cableId, level === 0 ? 'feeder' : 'branch', key, level === 0 ? undefined : level);
        if (level === 0 && !tree.feederCableIds.includes(cableId)) tree.feederCableIds.push(cableId);
        const onPath = [...cablesSoFar, cableId];
        for (const sink of index.sinks.get(ck) ?? []) {
          if (sink.kind === 'splice')
            walkCore(sink.splice.outputCableId, sink.splice.outputCore, hops, level, onPath, splices + 1);
          else if (sink.kind === 'splitter') visitSplitter(sink.splitter, hops, level + 1, onPath, splices, undefined);
          else if (sink.kind === 'customer') {
            const c = sink.customer;
            if (paths.has(c.id)) continue;
            setRole(cableId, 'drop', key);
            const last = [...hops].reverse().find((h) => h.kind === 'splitter');
            paths.set(c.id, {
              ponKey: key,
              hops,
              source: 'fiber',
              complete: true,
              fatBoxId: last?.kind === 'splitter' ? last.boxId : undefined,
              fatPort: last?.kind === 'splitter' ? last.outPort : undefined,
              dropCableId: cableId,
              dropCore: core,
              cableIds: onPath,
              splices,
            });
            tree.customerIds.push(c.id);
            tree.sources.add('fiber');
          }
        }
      };

      const visitSplitter = (
        sp: Splitter,
        hops: PathHop[],
        level: number,
        cablesSoFar: string[],
        splices: number,
        parent: SplitterPlace['parent'],
      ) => {
        if (splitters.has(sp.id)) return;
        splitters.set(sp.id, { level, ponKey: key, parent, childPorts: new Set() });
        tree.splitterIds.push(sp.id);
        tree.sources.add('fiber');
        for (let p = 1; p <= splitterCapacity(sp); p += 1) {
          const hop: PathHop = {
            kind: 'splitter',
            splitterId: sp.id,
            boxId: sp.terminalBoxId,
            boxName: boxName(index, sp),
            ratio: sp.ratio,
            level,
            outPort: p,
          };
          const next = [...hops, hop];
          const children = index.cascadeChildren.get(`${sp.id}#${p}`) ?? [];
          if (children.length) splitters.get(sp.id)!.childPorts.add(p);
          for (const child of children)
            visitSplitter(child, next, level + 1, cablesSoFar, splices, { splitterId: sp.id, port: p });
          const out = sp.outputPorts.find((x) => x.portNumber === p);
          if (out?.connectedDropCableId && out.connectedCore) {
            const before = splitters.size;
            walkCore(out.connectedDropCableId, out.connectedCore, next, level, cablesSoFar, splices);
            if (splitters.size > before) splitters.get(sp.id)!.childPorts.add(p);
          }
        }
      };

      for (const ref of index.ponPatches.get(key) ?? []) {
        if (ref.port.feederCableId && ref.port.feederCore)
          walkCore(ref.port.feederCableId, ref.port.feederCore, [ponHop], 0, [], 0);
      }
      if (pon.connectedFeederCableId && pon.feederCore)
        walkCore(pon.connectedFeederCableId, pon.feederCore, [ponHop], 0, [], 0);
      if (pon.connectedFeederCableId && !tree.feederCableIds.includes(pon.connectedFeederCableId)) {
        tree.feederCableIds.push(pon.connectedFeederCableId);
        setRole(pon.connectedFeederCableId, 'feeder', key);
      }
    }
  }

  placeFromRecords(data, index, ponByKey, cableRoles, splitters, paths, setRole);
  return { index, pons, cableRoles, splitters, paths };
}

/** The splitter (and output) feeding `sp`, from what is written on the records. */
function recordedParent(
  sp: Splitter,
  data: FiberData,
  index: FiberIndex,
): { splitter: Splitter; port?: number } | undefined {
  const input = sp.inputPort;
  if (input.connectedSplitterId) {
    const parent = index.splitters.get(input.connectedSplitterId);
    if (parent) return { splitter: parent, port: input.connectedSplitterPort };
  }
  if (!input.connectedCableId) return undefined;
  for (const other of data.splitters) {
    if (other.id === sp.id) continue;
    const out = other.outputPorts.find((p) => p.connectedDropCableId === input.connectedCableId);
    if (out) return { splitter: other, port: out.portNumber };
  }
  // The input cable's recorded start end is a box holding exactly one splitter: that splitter
  // feeds this one, but which output is not recorded.
  const cable = index.cables.get(input.connectedCableId);
  if (cable?.startEquipmentId && cable.startEquipmentId !== sp.terminalBoxId) {
    const there = data.splitters.filter((s) => s.terminalBoxId === cable.startEquipmentId && s.id !== sp.id);
    if (there.length === 1) return { splitter: there[0] };
  }
  return undefined;
}

function findPon(customer: Customer, index: FiberIndex): { olt: Equipment; pon: PonPort } | undefined {
  const olt = index.equipment.get(customer.oltId);
  if (!olt) return undefined;
  const ref = customer.ponPort.trim().toLowerCase();
  const pon = (olt.ponPorts ?? []).find(
    (p) =>
      p.id.toLowerCase() === ref ||
      p.vendorAddress?.toLowerCase() === ref ||
      p.slotCardPort?.toLowerCase() === ref ||
      String(p.portNumber) === ref,
  );
  return pon ? { olt, pon } : undefined;
}

function placeFromRecords(
  data: FiberData,
  index: FiberIndex,
  ponByKey: Map<string, PonTree>,
  cableRoles: Map<string, CableRoleInfo>,
  splitters: Map<string, SplitterPlace>,
  paths: Map<string, WalkedPath>,
  setRole: (cableId: string, role: CableRole, key: string, level?: number) => void,
) {
  for (const c of data.customers) {
    if (paths.has(c.id) || c.status === 'Disconnected' || c.accessNetwork === 'hfc') continue;
    const hops: PathHop[] = [];
    const found = findPon(c, index);
    const key = found ? ponKey(found.olt.id, found.pon.id) : undefined;
    const tree = key ? ponByKey.get(key) : undefined;
    if (found && tree) hops.push({ kind: 'pon', oltId: found.olt.id, ponId: found.pon.id, label: tree.label });
    else
      hops.push({
        kind: 'gap',
        text: c.oltId ? `PON port "${c.ponPort}" of ${c.oltId} is not on record` : 'OLT and PON port not recorded',
      });

    // The splitter chain, from the customer's splitter up through the recorded parents.
    const chain: { sp: Splitter; outPort?: number }[] = [];
    let current = c.splitterId ? index.splitters.get(c.splitterId) : undefined;
    let outPort: number | undefined = c.splitterOutputPort || undefined;
    const guard = new Set<string>();
    while (current && !guard.has(current.id) && guard.size < 20) {
      guard.add(current.id);
      chain.unshift({ sp: current, outPort });
      const parent = recordedParent(current, data, index);
      current = parent?.splitter;
      outPort = parent?.port;
    }
    if (!c.splitterId) hops.push({ kind: 'gap', text: 'Splitter not recorded on the customer' });
    else if (chain.length === 0) hops.push({ kind: 'gap', text: `Splitter ${c.splitterId} is not on record` });

    const cableIds: string[] = [];
    if (key) {
      if (c.feederCableId && index.cables.has(c.feederCableId)) {
        setRole(c.feederCableId, 'feeder', key);
        cableIds.push(c.feederCableId);
        if (tree && !tree.feederCableIds.includes(c.feederCableId)) tree.feederCableIds.push(c.feederCableId);
      }
    }
    chain.forEach(({ sp, outPort: port }, i) => {
      // Levels come from the fiber walk when it reached the splitter, else from the chain depth.
      const known = splitters.get(sp.id);
      const level = known?.level ?? i + 1;
      if (!known && key) {
        const parent = i > 0 ? { splitterId: chain[i - 1].sp.id, port: chain[i - 1].outPort } : undefined;
        splitters.set(sp.id, { level, ponKey: key, parent, childPorts: new Set() });
        tree?.splitterIds.push(sp.id);
      }
      if (i > 0 && chain[i - 1].outPort) splitters.get(chain[i - 1].sp.id)?.childPorts.add(chain[i - 1].outPort!);
      hops.push({
        kind: 'splitter',
        splitterId: sp.id,
        boxId: sp.terminalBoxId,
        boxName: boxName(index, sp),
        ratio: sp.ratio,
        level,
        outPort: port,
      });
      const inCable = sp.inputPort.connectedCableId;
      if (key && inCable && index.cables.has(inCable) && !cableRoles.get(inCable)) {
        setRole(inCable, i === 0 ? 'feeder' : 'branch', key, i === 0 ? undefined : level - 1);
      }
      if (inCable && !cableIds.includes(inCable)) cableIds.push(inCable);
    });
    if (
      key &&
      c.distributionCableId &&
      index.cables.has(c.distributionCableId) &&
      !cableRoles.get(c.distributionCableId)
    ) {
      setRole(c.distributionCableId, 'branch', key, Math.max(1, chain.length - 1));
    }
    if (c.distributionCableId && index.cables.has(c.distributionCableId) && !cableIds.includes(c.distributionCableId))
      cableIds.push(c.distributionCableId);
    if (key && c.dropCableId && index.cables.has(c.dropCableId)) setRole(c.dropCableId, 'drop', key);
    if (c.dropCableId && index.cables.has(c.dropCableId)) cableIds.push(c.dropCableId);

    const last = chain[chain.length - 1];
    const complete = !!(found && tree && last && last.outPort && c.dropCableId);
    paths.set(c.id, {
      ponKey: key,
      hops,
      source: 'record',
      complete,
      fatBoxId: c.terminalBoxId || last?.sp.terminalBoxId,
      fatPort: last?.outPort,
      dropCableId: c.dropCableId || undefined,
      dropCore: c.fiberCore || undefined,
      cableIds,
      splices: 0,
    });
    if (tree) {
      tree.customerIds.push(c.id);
      tree.sources.add('record');
    }
  }
}

/** The colour of a drop fiber from its cable's recorded scheme, or a plain note when not known. */
export function dropFiberColor(
  index: FiberIndex,
  cable: Cable | undefined,
  core: number | undefined,
): { chip?: { name: string; hex: string }; note: string } {
  if (!cable || !core) return { note: 'Drop fiber not recorded' };
  const id = identityOf(index, cable.id, core);
  if (id?.fiberColor && id.schemeKnown)
    return { chip: { name: id.fiberColor.name, hex: id.fiberColor.hex }, note: id.label };
  return { note: id?.label ?? `Fiber ${core} (colour not known)` };
}
