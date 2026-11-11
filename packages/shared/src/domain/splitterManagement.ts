import type { SplitterArchitecture } from '../model/enums';
import type { HistoryEntry, Splitter, SplitterPort } from '../model/types';
import { buildFiberIndex, coreKey, describeCore, type FiberData, type FiberIndex, isSpliceActive, splitterCapacity } from './fiberIndex';
import { DEFAULT_OPTICAL_SETTINGS, type OpticalSettings } from './opticalSettings';

/**
 * Phase 11: splitter management worked out from the records only.
 *
 * - Where a splitter sits: the splitters above it (to the PON port) and below it, followed through
 *   recorded links only (cascade in one box, splitter output → fiber → splices → splitter input,
 *   ODF patch). Never from position or from which cable ends at which box.
 * - Its level and the tree's architecture (centralised: one splitter level; distributed: two or
 *   more), given as a suggestion with how it was worked out. A person may record a different answer
 *   with a reason (`Splitter.architecture`); both are shown.
 * - The split product down to it (the recorded ratios multiplied), against the
 *   `optical.limits.splitProduct` setting, as a warning only.
 * - Output use: used, free, reserved, faulty, or "not recorded", from customers, drop fibers and
 *   cascade children.
 */

export const SPLITTER_ARCHITECTURE_LABELS: Record<SplitterArchitecture, string> = {
  centralised: 'Centralised (one splitter level)',
  distributed: 'Distributed (cascaded, two or more levels)',
};

/** History actions on a splitter output. The same words as the ODF port marks. */
export const SPLITTER_OUTPUT_MARKS = { faulty: 'MARKED_FAULTY', repaired: 'MARKED_REPAIRED', reserved: 'MARKED_RESERVED', reservationEnded: 'RESERVATION_ENDED' } as const;

const cap = (s: string) => (s ? `${s[0].toUpperCase()}${s.slice(1)}` : s);

/** "1:8", or "coupler 90/10" for an unequal coupler. */
export const splitterRatioText = (sp: Pick<Splitter, 'ratio' | 'couplerRatio'>): string => (sp.couplerRatio ? `coupler ${sp.couplerRatio}` : sp.ratio);

/* ------------------------------------------------------------------ */
/* Upstream: what feeds a splitter                                     */
/* ------------------------------------------------------------------ */

export type SplitterFeed =
  | { kind: 'splitter'; parent: Splitter; port?: number; via: 'in_box' | 'fiber' }
  | { kind: 'pon'; oltId: string; oltName: string; ponPortId: string; through?: string }
  | { kind: 'gap'; text: string };

/** The one record that feeds this splitter's input, following splices; or the gap, in words. */
export function splitterFeed(index: FiberIndex, sp: Splitter): SplitterFeed {
  const input = sp.inputPort;
  if (input.connectedSplitterId) {
    const parent = index.splitters.get(input.connectedSplitterId);
    if (!parent) return { kind: 'gap', text: `${sp.name} is fed by splitter ${input.connectedSplitterId}, which is not on record` };
    return { kind: 'splitter', parent, ...(input.connectedSplitterPort ? { port: input.connectedSplitterPort } : {}), via: 'in_box' };
  }
  if (!input.connectedCableId) return { kind: 'gap', text: `the input of ${sp.name} is not linked to a fiber` };
  if (!input.connectedCore) return { kind: 'gap', text: `the input of ${sp.name} names cable ${input.connectedCableId} but not which fiber` };
  let key = coreKey(input.connectedCableId, input.connectedCore);
  let label = describeCore(index, input.connectedCableId, input.connectedCore);
  const seen = new Set<string>();
  for (let guard = 0; guard < 500; guard += 1) {
    if (seen.has(key)) return { kind: 'gap', text: `the fibers above ${sp.name} loop back on themselves` };
    seen.add(key);
    const sources = index.sources.get(key) ?? [];
    if (sources.length === 0) return { kind: 'gap', text: `nothing is recorded feeding ${label}` };
    if (sources.length > 1) return { kind: 'gap', text: `${label} has ${sources.length} feeds recorded, so where it comes from is not clear` };
    const s = sources[0];
    if (s.kind === 'splice') {
      key = coreKey(s.splice.inputCableId, s.splice.inputCore);
      label = describeCore(index, s.splice.inputCableId, s.splice.inputCore);
      continue;
    }
    if (s.kind === 'splitter') return { kind: 'splitter', parent: s.splitter, port: s.port.portNumber, via: 'fiber' };
    if (s.kind === 'pon') return { kind: 'pon', oltId: s.olt.id, oltName: s.olt.name, ponPortId: s.pon.id };
    const odfName = `ODF ${s.odf.name} ${s.panel.label} port ${s.port.number}`;
    const patch = s.port.patch;
    if (!patch) return { kind: 'gap', text: `${odfName} has no patch to a PON port recorded` };
    return { kind: 'pon', oltId: patch.oltId, oltName: index.equipment.get(patch.oltId)?.name ?? patch.oltId, ponPortId: patch.ponPortId, through: odfName };
  }
  return { kind: 'gap', text: `the fiber path above ${sp.name} is too long to follow` };
}

export interface SplitterAbove {
  splitter: Splitter;
  /** The output of that splitter the next one down hangs on, when recorded. */
  port?: number;
  via: 'in_box' | 'fiber';
}

export interface SplitterChain {
  /** Splitters between the PON port and this one, the first splitter (level 1) first. */
  above: SplitterAbove[];
  root?: { oltId: string; oltName: string; ponPortId: string; through?: string };
  /** Why the walk stopped before a PON port, in words that fit inside a sentence. */
  gap?: string;
  /** Known only when the walk reached a PON port. */
  level?: number;
  /** At least this level: the splitters found above, plus this one. */
  levelAtLeast: number;
}

/** Walks up from a splitter to its PON port through recorded links only. */
export function splitterChain(index: FiberIndex, sp: Splitter): SplitterChain {
  const above: SplitterAbove[] = [];
  const seen = new Set<string>([sp.id]);
  let current = sp;
  for (let guard = 0; guard < 50; guard += 1) {
    const feed = splitterFeed(index, current);
    if (feed.kind === 'gap') return { above, gap: feed.text, levelAtLeast: above.length + 1 };
    if (feed.kind === 'pon') {
      const { kind: _k, ...root } = feed;
      return { above, root, level: above.length + 1, levelAtLeast: above.length + 1 };
    }
    if (seen.has(feed.parent.id)) return { above, gap: `${feed.parent.name} feeds back into its own tree`, levelAtLeast: above.length + 1 };
    seen.add(feed.parent.id);
    above.unshift({ splitter: feed.parent, ...(feed.port ? { port: feed.port } : {}), via: feed.via });
    current = feed.parent;
  }
  return { above, gap: 'the cascade above is too deep to follow', levelAtLeast: above.length + 1 };
}

/* ------------------------------------------------------------------ */
/* Downstream: splitters a splitter feeds                              */
/* ------------------------------------------------------------------ */

export interface SplitterBelow {
  port: number;
  splitter: Splitter;
  via: 'in_box' | 'fiber';
}

/** Splitters fed straight from this one's outputs: in the same box, or along a recorded fiber. */
export function splittersBelow(index: FiberIndex, sp: Splitter): SplitterBelow[] {
  const found: SplitterBelow[] = [];
  const top = Math.max(splitterCapacity(sp), ...sp.outputPorts.map((p) => p.portNumber), 0);
  for (let n = 1; n <= top; n += 1) {
    for (const child of index.cascadeChildren.get(`${sp.id}#${n}`) ?? []) found.push({ port: n, splitter: child, via: 'in_box' });
  }
  for (const port of sp.outputPorts) {
    if (!port.connectedDropCableId || !port.connectedCore) continue;
    const queue = [coreKey(port.connectedDropCableId, port.connectedCore)];
    const seen = new Set<string>();
    for (let guard = 0; queue.length && guard < 2000; guard += 1) {
      const key = queue.shift()!;
      if (seen.has(key)) continue;
      seen.add(key);
      for (const sink of index.sinks.get(key) ?? []) {
        if (sink.kind === 'splice' && isSpliceActive(sink.splice)) queue.push(coreKey(sink.splice.outputCableId, sink.splice.outputCore));
        else if (sink.kind === 'splitter' && sink.splitter.id !== sp.id) found.push({ port: port.portNumber, splitter: sink.splitter, via: 'fiber' });
      }
    }
  }
  return found;
}

/** How many splitter levels are recorded under this one (0 when none). Loops are cut. */
function depthBelow(index: FiberIndex, sp: Splitter, seen: Set<string> = new Set()): number {
  if (seen.has(sp.id)) return 0;
  seen.add(sp.id);
  let deepest = 0;
  for (const child of splittersBelow(index, sp)) deepest = Math.max(deepest, 1 + depthBelow(index, child.splitter, seen));
  return deepest;
}

/* ------------------------------------------------------------------ */
/* Place: level, architecture and split product                       */
/* ------------------------------------------------------------------ */

export interface SplitProduct {
  /** The equal-split ratios multiplied, from the first splitter down to this one. */
  product: number;
  /** Each stage as recorded, such as ["1:4", "1:8"]. */
  factors: string[];
  /** Unequal couplers on the way, which are not multiplied in (each leg has its own loss). */
  couplers: number;
  /** False when the fiber above is not recorded: the real product is at least this. */
  complete: boolean;
}

export interface SplitterPlace extends SplitterChain {
  splitter: Splitter;
  below: SplitterBelow[];
  /** Recorded splitter levels under this one. */
  levelsBelow: number;
  split: SplitProduct;
  /** The settings limit for the split product, and whether this splitter is above it. */
  splitLimit: number;
  overSplitLimit: boolean;
  suggestion: {
    architecture?: SplitterArchitecture;
    /** One plain sentence. */
    text: string;
    /** How it was worked out, one line per fact. */
    how: string[];
  };
  /** What a person recorded, when they did. */
  recorded?: NonNullable<Splitter['architecture']>;
  /** The recorded answer disagrees with what the records show. */
  differs: boolean;
}

export interface SplitterPlaceOptions {
  settings?: OpticalSettings;
  index?: FiberIndex;
}

/** "1:32", or "at least 1:8" when the fiber above is not recorded. */
export function splitProductText(split: SplitProduct): string {
  const text = `1:${split.product}`;
  return split.complete ? text : `at least ${text}`;
}

/** Where a splitter sits, its level, the architecture suggested by the records and its split product. */
export function splitterPlace(data: FiberData, splitterId: string, options: SplitterPlaceOptions = {}): SplitterPlace | undefined {
  const index = options.index ?? buildFiberIndex(data);
  const sp = index.splitters.get(splitterId);
  if (!sp) return undefined;
  const settings = options.settings ?? DEFAULT_OPTICAL_SETTINGS;
  const chain = splitterChain(index, sp);
  const below = splittersBelow(index, sp);
  const levelsBelow = below.length ? depthBelow(index, sp) : 0;

  const stages = [...chain.above.map((a) => a.splitter), sp];
  let product = 1;
  let couplers = 0;
  for (const stage of stages) {
    if (stage.couplerRatio) couplers += 1;
    else product *= splitterCapacity(stage) || 1;
  }
  const split: SplitProduct = { product, factors: stages.map(splitterRatioText), couplers, complete: !!chain.root };
  const splitLimit = settings.limits.splitProduct;
  const overSplitLimit = splitLimit > 0 && product > splitLimit;

  const how: string[] = [];
  if (chain.root) how.push(`Fed from ${chain.root.oltName} ${chain.root.ponPortId}${chain.root.through ? ` through ${chain.root.through}` : ''}.`);
  if (chain.above.length > 0) {
    how.push(`From the PON port: ${[...chain.above.map((a) => `${a.splitter.name} (${splitterRatioText(a.splitter)}${a.port ? `, output ${a.port}` : ''})`), `${sp.name} (this one)`].join(' → ')}.`);
  }
  if (chain.gap) how.push(`${cap(chain.gap)}, so the walk to the PON port stops ${chain.above.length ? `at ${chain.above[0].splitter.name}` : 'here'}.`);
  if (below.length > 0) {
    how.push(`Feeds ${below.length} splitter(s) below it: ${below.map((b) => `${b.splitter.name} on output ${b.port}`).join(', ')}${levelsBelow > 1 ? ` (${levelsBelow} levels recorded below)` : ''}.`);
  } else {
    const capacity = splitterCapacity(sp);
    const empty = Array.from({ length: capacity }, (_, i) => i + 1).filter((n) => {
      const port = sp.outputPorts.find((p) => p.portNumber === n);
      const customer = data.customers.some((c) => c.status !== 'Disconnected' && c.splitterId === sp.id && c.splitterOutputPort === n);
      return !customer && !port?.connectedCustomerId && !port?.connectedDropCableId;
    }).length;
    how.push(`No splitter is recorded below it${empty > 0 ? `; ${empty} of its ${capacity} outputs have nothing recorded on them, so a splitter there would not be seen` : ''}.`);
  }

  let architecture: SplitterArchitecture | undefined;
  let text: string;
  const levelWords = chain.level !== undefined ? `level ${chain.level}` : chain.levelAtLeast > 1 ? `level not known (at least ${chain.levelAtLeast})` : 'level not known';
  if (chain.above.length > 0 || below.length > 0) {
    architecture = 'distributed';
    text = `Distributed (cascaded): this splitter is ${levelWords}.`;
  } else if (chain.root) {
    architecture = 'centralised';
    text = 'Centralised: the only splitter level between the PON port and the customers, as far as recorded (level 1).';
  } else {
    text = 'Not known: the fiber from this splitter to the PON port is not recorded, and no splitter is recorded above or below it.';
  }
  const recorded = sp.architecture;
  const differs =
    !!recorded &&
    ((architecture !== undefined && recorded.value !== architecture) || (recorded.level !== undefined && chain.level !== undefined && recorded.level !== chain.level));
  return { ...chain, splitter: sp, below, levelsBelow, split, splitLimit, overSplitLimit, suggestion: { ...(architecture ? { architecture } : {}), text, how }, ...(recorded ? { recorded } : {}), differs };
}

/** Every splitter's place, sharing one index. */
export function splitterPlaces(data: FiberData, options: SplitterPlaceOptions = {}): Map<string, SplitterPlace> {
  const index = options.index ?? buildFiberIndex(data);
  const out = new Map<string, SplitterPlace>();
  for (const sp of data.splitters) {
    const place = splitterPlace(data, sp.id, { ...options, index });
    if (place) out.set(sp.id, place);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* One PON tree                                                        */
/* ------------------------------------------------------------------ */

export interface PonTreeSplits {
  /** Splitters whose recorded fibers lead up to this PON port. */
  splitterIds: string[];
  /** Deepest splitter level on the tree; undefined when no splitter is reached. */
  levels?: number;
  architecture?: SplitterArchitecture;
  /** Highest split product on the tree, with the path that gives it. */
  maxProduct: number;
  maxFactors: string[];
  splitLimit: number;
  overSplitLimit: boolean;
  /** Splitters on this tree with a recorded answer that differs from the records. */
  differs: string[];
}

/** Splitter levels and split product on one PON tree, from each splitter's walk up to the port. */
export function ponTreeSplits(data: FiberData, oltId: string, ponPortId: string, options: SplitterPlaceOptions = {}): PonTreeSplits {
  const index = options.index ?? buildFiberIndex(data);
  const settings = options.settings ?? DEFAULT_OPTICAL_SETTINGS;
  const onTree: { sp: Splitter; level?: number }[] = [];
  let levels: number | undefined;
  let maxProduct = 1;
  let maxFactors: string[] = [];
  for (const sp of data.splitters) {
    const chain = splitterChain(index, sp);
    if (chain.root?.oltId !== oltId || chain.root.ponPortId !== ponPortId) continue;
    onTree.push({ sp, ...(chain.level !== undefined ? { level: chain.level } : {}) });
    levels = Math.max(levels ?? 0, chain.level ?? 0);
    const stages = [...chain.above.map((a) => a.splitter), sp];
    const product = stages.reduce((p, s) => (s.couplerRatio ? p : p * (splitterCapacity(s) || 1)), 1);
    if (maxFactors.length === 0 || product > maxProduct) {
      maxProduct = product;
      maxFactors = stages.map(splitterRatioText);
    }
  }
  const architecture: SplitterArchitecture | undefined = levels === undefined ? undefined : levels >= 2 ? 'distributed' : 'centralised';
  const splitterIds = onTree.map((t) => t.sp.id);
  const differs = onTree
    .filter(({ sp, level }) => sp.architecture && ((architecture && sp.architecture.value !== architecture) || (sp.architecture.level !== undefined && level !== undefined && sp.architecture.level !== level)))
    .map((t) => t.sp.id);
  const splitLimit = settings.limits.splitProduct;
  return { splitterIds, ...(levels !== undefined ? { levels } : {}), ...(architecture ? { architecture } : {}), maxProduct, maxFactors, splitLimit, overSplitLimit: splitLimit > 0 && maxProduct > splitLimit, differs };
}

/* ------------------------------------------------------------------ */
/* Output use                                                          */
/* ------------------------------------------------------------------ */

export type SplitterOutputState = 'used' | 'free' | 'reserved' | 'faulty' | 'not_recorded';

export const SPLITTER_OUTPUT_STATE_WORDS: Record<SplitterOutputState, string> = {
  used: 'In use',
  free: 'Free',
  reserved: 'Reserved',
  faulty: 'Faulty',
  not_recorded: 'Not recorded',
};

export type SplitterOutputLink =
  | { kind: 'customer'; id: string; name?: string }
  | { kind: 'fiber'; cableId: string; core?: number }
  | { kind: 'splitter'; id: string; name: string };

export interface SplitterOutputUse {
  portNumber: number;
  state: SplitterOutputState;
  port?: SplitterPort;
  /** What the records say is on this output. */
  links: SplitterOutputLink[];
  /** Marked "in use" on the port, but nothing linked is recorded. */
  markedOnly: boolean;
  /** For a faulty or reserved output: the reason from its history, with date and who. */
  reason?: string;
}

export interface SplitterOutputCounts {
  capacity: number;
  used: number;
  free: number;
  reserved: number;
  faulty: number;
  notRecorded: number;
  /** Faulty outputs that still carry a connection. Counted under faulty. */
  faultyInUse: number;
  /** Outputs marked in use with nothing linked recorded. Counted under used. */
  markedOnly: number;
  /** What the used outputs carry. One output can carry a drop fiber and the customer on it. */
  customers: number;
  fibers: number;
  splitters: number;
}

/** The newest history line of one kind, or undefined. */
export const lastSplitterPortLine = (port: Pick<SplitterPort, 'history'> | undefined, action: string): HistoryEntry | undefined =>
  [...(port?.history ?? [])].reverse().find((h) => h.action === action);

/** "Cracked leg (2026-11-10, Ravi)", or "reason not recorded". */
export function splitterOutputReason(port: SplitterPort | undefined): string {
  const line =
    port?.status === 'Faulty' ? lastSplitterPortLine(port, SPLITTER_OUTPUT_MARKS.faulty) : port?.status === 'Reserved' ? lastSplitterPortLine(port, SPLITTER_OUTPUT_MARKS.reserved) : undefined;
  return line ? `${line.details.replace(/^(Marked faulty|Reserved): /, '')} (${line.at.slice(0, 10)}${line.by ? `, ${line.by}` : ''})` : 'reason not recorded';
}

/** "customer Asha", "fiber 2 of DROP-1", "splitter SPL-2". Ids only when `names` is false (reports). */
export function describeSplitterOutputLink(link: SplitterOutputLink, names = true): string {
  if (link.kind === 'customer') return `customer ${names && link.name ? link.name : link.id}`;
  if (link.kind === 'fiber') return link.core ? `fiber ${link.core} of ${link.cableId}` : `cable ${link.cableId} (fiber not recorded)`;
  return `splitter ${names ? link.name : link.id}`;
}

/**
 * Each output of a splitter from the records: customers recorded on it (active ones), the drop or
 * lead fiber on the port, and splitters cascaded from it in the box. An output with no port record
 * and nothing linked is "not recorded", never free.
 */
export function splitterOutputUse(
  data: Pick<FiberData, 'splitters' | 'customers'>,
  sp: Splitter,
): { outputs: SplitterOutputUse[]; counts: SplitterOutputCounts } {
  const capacity = splitterCapacity(sp);
  const counts: SplitterOutputCounts = { capacity, used: 0, free: 0, reserved: 0, faulty: 0, notRecorded: 0, faultyInUse: 0, markedOnly: 0, customers: 0, fibers: 0, splitters: 0 };
  const outputs: SplitterOutputUse[] = [];
  for (let n = 1; n <= capacity; n += 1) {
    const port = sp.outputPorts.find((p) => p.portNumber === n);
    const links: SplitterOutputLink[] = [];
    for (const c of data.customers) {
      if (c.status !== 'Disconnected' && c.splitterId === sp.id && c.splitterOutputPort === n) links.push({ kind: 'customer', id: c.id, name: c.name });
    }
    if (port?.connectedCustomerId && !links.some((l) => l.kind === 'customer' && l.id === port.connectedCustomerId)) {
      // The port names a customer whose own record does not (or who is disconnected): still a record.
      const c = data.customers.find((x) => x.id === port.connectedCustomerId);
      const name = c?.name ?? port.connectedCustomerName;
      if (!c || c.status !== 'Disconnected') links.push({ kind: 'customer', id: port.connectedCustomerId, ...(name ? { name } : {}) });
    }
    if (port?.connectedDropCableId) links.push({ kind: 'fiber', cableId: port.connectedDropCableId, ...(port.connectedCore ? { core: port.connectedCore } : {}) });
    for (const child of data.splitters) {
      if (child.id !== sp.id && child.inputPort.connectedSplitterId === sp.id && child.inputPort.connectedSplitterPort === n) links.push({ kind: 'splitter', id: child.id, name: child.name });
    }
    const markedOnly = links.length === 0 && port?.status === 'Occupied';
    let state: SplitterOutputState;
    if (port?.status === 'Faulty') state = 'faulty';
    else if (links.length > 0 || markedOnly) state = 'used';
    else if (port?.status === 'Reserved') state = 'reserved';
    else if (port) state = 'free';
    else state = 'not_recorded';
    counts[state === 'not_recorded' ? 'notRecorded' : state] += 1;
    if (state === 'faulty' && links.length > 0) counts.faultyInUse += 1;
    if (markedOnly) counts.markedOnly += 1;
    if (links.length > 0) {
      if (links.some((l) => l.kind === 'customer')) counts.customers += 1;
      if (links.some((l) => l.kind === 'fiber')) counts.fibers += 1;
      if (links.some((l) => l.kind === 'splitter')) counts.splitters += 1;
    }
    outputs.push({
      portNumber: n,
      state,
      ...(port ? { port } : {}),
      links,
      markedOnly,
      ...(state === 'faulty' || state === 'reserved' ? { reason: splitterOutputReason(port) } : {}),
    });
  }
  return { outputs, counts };
}

/** "8 outputs: 3 in use, 4 free, 1 reserved, 0 faulty", with "N not recorded" only when there are some. */
export function splitterOutputSummary(counts: SplitterOutputCounts): string {
  const parts = [`${counts.used} in use`, `${counts.free} free`, `${counts.reserved} reserved`, `${counts.faulty} faulty`];
  if (counts.notRecorded > 0) parts.push(`${counts.notRecorded} not recorded`);
  return `${counts.capacity} outputs: ${parts.join(', ')}`;
}
