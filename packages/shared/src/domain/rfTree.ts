import { coreIdentity } from '../fiber/colors';
import type { RfElement, RfElementKind, RfLevel, RfLink, RfPort } from '../model/rfSchemas';
import type { Cable, Customer, Equipment } from '../model/types';

/**
 * The directional RF tree (Phase 6), built only from recorded links. Direction comes from the ports
 * (signal enters on `in`, leaves on `out`), never from how a line was drawn or what is nearby. A
 * missing link is named, never filled in. A loop is reported, never walked twice.
 */

export interface RfData {
  rfElements: readonly RfElement[];
  rfLinks: readonly RfLink[];
  rfLevels?: readonly RfLevel[];
  cables?: readonly Cable[];
  customers?: readonly Customer[];
  equipment?: readonly Equipment[];
}

export interface RfKindInfo {
  label: string;
  /** Plain words for screens. */
  plain: string;
  /** `always`: needs power. `never`: passive. `ask`: must be recorded (nodes and mini-nodes). */
  power: 'always' | 'never' | 'ask' | 'customer';
  /** Starts a tree. */
  root?: boolean;
  /** Has a number of outputs the person chooses. */
  outputs?: { label: string; role: RfPort['role']; signal: 'optical' | 'rf'; defaultCount: number; max: number };
}

export const RF_KIND_INFO: Record<RfElementKind, RfKindInfo> = {
  headend: { label: 'Headend', plain: 'Headend (TV control room)', power: 'always', root: true },
  cmts: { label: 'CMTS / CCAP', plain: 'CMTS (cable internet in the headend)', power: 'always', root: true },
  optical_transmitter: { label: 'Optical transmitter', plain: 'Optical transmitter (TV to light)', power: 'always' },
  edfa: { label: 'EDFA', plain: 'EDFA (light booster)', power: 'always', outputs: { label: 'OUT', role: 'output', signal: 'optical', defaultCount: 1, max: 32 } },
  wdm: { label: 'WDM', plain: 'WDM (puts TV and internet light on one fiber, or takes them apart)', power: 'never' },
  optical_splitter: { label: 'Optical splitter (video)', plain: 'Light splitter for TV', power: 'never', outputs: { label: 'OUT', role: 'output', signal: 'optical', defaultCount: 2, max: 64 } },
  optical_node: { label: 'Optical node', plain: 'Optical node (light to TV signal)', power: 'ask', outputs: { label: 'RF OUT', role: 'main', signal: 'rf', defaultCount: 1, max: 8 } },
  mini_node: { label: 'Mini-node', plain: 'Mini-node (small light to TV signal box)', power: 'ask', outputs: { label: 'RF OUT', role: 'main', signal: 'rf', defaultCount: 1, max: 8 } },
  rf_amplifier: { label: 'RF amplifier', plain: 'Amplifier (makes the TV signal stronger)', power: 'always', outputs: { label: 'OUT', role: 'main', signal: 'rf', defaultCount: 1, max: 8 } },
  rf_splitter: { label: 'RF splitter', plain: 'TV line splitter', power: 'never', outputs: { label: 'OUT', role: 'output', signal: 'rf', defaultCount: 2, max: 16 } },
  directional_coupler: { label: 'Directional coupler', plain: 'Coupler (takes a little signal off the line)', power: 'never' },
  tap: { label: 'Tap', plain: 'Tap (where house wires connect)', power: 'never', outputs: { label: 'DROP', role: 'drop', signal: 'rf', defaultCount: 4, max: 16 } },
  power_inserter: { label: 'Power inserter', plain: 'Power inserter (puts power on the line)', power: 'never' },
  power_supply: { label: 'Power supply', plain: 'Power supply for the line', power: 'always' },
  stb: { label: 'Set top box', plain: 'Set top box (at the customer)', power: 'customer' },
  cable_modem: { label: 'Cable modem', plain: 'Cable modem (at the customer)', power: 'customer' },
};

const port = (id: string, label: string, direction: 'in' | 'out', signal: RfPort['signal'], role?: RfPort['role'], optional?: boolean): RfPort => ({
  id,
  label,
  direction,
  signal,
  ...(role ? { role } : {}),
  ...(optional ? { optional } : {}),
});

/** The ports an element of this kind has. Losses are left blank for the person to enter. */
export function defaultRfPorts(kind: RfElementKind, options: { outputs?: number; wdmRole?: 'combine' | 'separate' } = {}): RfPort[] {
  const info = RF_KIND_INFO[kind];
  const count = Math.max(1, Math.min(info.outputs?.max ?? 1, Math.round(options.outputs ?? info.outputs?.defaultCount ?? 1)));
  const outs = (prefix: string, signal: 'optical' | 'rf', role: RfPort['role']) =>
    Array.from({ length: count }, (_, i) => port(`${prefix.replace(/\s+/g, '')}${i + 1}`, `${prefix} ${i + 1}`, 'out', signal, role));
  switch (kind) {
    case 'headend':
    case 'cmts':
      return [port('OUT', 'RF OUT', 'out', 'rf', 'main')];
    case 'optical_transmitter':
      return [port('RFIN', 'RF IN', 'in', 'rf', 'main'), port('OPTOUT', 'OPT OUT', 'out', 'optical', 'main')];
    case 'edfa':
      return [port('OPTIN', 'OPT IN', 'in', 'optical', 'main'), ...outs('OUT', 'optical', 'output')];
    case 'wdm':
      return options.wdmRole === 'combine'
        ? [port('VIDEOIN', '1550 IN', 'in', 'optical', 'video'), port('PONIN', 'PON IN', 'in', 'optical', 'pon', true), port('COMOUT', 'COM OUT', 'out', 'optical', 'common')]
        : [port('COMIN', 'COM IN', 'in', 'optical', 'common'), port('VIDEOOUT', '1550 OUT', 'out', 'optical', 'video'), port('PONOUT', 'PON OUT', 'out', 'optical', 'pon')];
    case 'optical_splitter':
      return [port('IN', 'IN', 'in', 'optical', 'main'), ...outs('OUT', 'optical', 'output')];
    case 'optical_node':
    case 'mini_node':
      return [port('OPTIN', 'OPT IN', 'in', 'optical', 'main'), ...outs('RF OUT', 'rf', 'main')];
    case 'rf_amplifier':
      return [port('IN', 'IN', 'in', 'rf', 'main'), ...outs('OUT', 'rf', 'main')];
    case 'rf_splitter':
      return [port('IN', 'IN', 'in', 'rf', 'main'), ...outs('OUT', 'rf', 'output')];
    case 'directional_coupler':
      return [port('IN', 'IN', 'in', 'rf', 'main'), port('OUT', 'OUT', 'out', 'rf', 'through'), port('TAP', 'TAP', 'out', 'rf', 'tap_leg')];
    case 'tap':
      return [port('IN', 'IN', 'in', 'rf', 'main'), port('OUT', 'OUT (line)', 'out', 'rf', 'through'), ...outs('DROP', 'rf', 'drop')];
    case 'power_inserter':
      return [port('IN', 'IN', 'in', 'rf', 'main'), port('ACIN', 'AC IN', 'in', 'power', 'power', true), port('OUT', 'OUT', 'out', 'rf', 'main')];
    case 'power_supply':
      return [port('ACOUT', 'AC OUT', 'out', 'power', 'power')];
    case 'stb':
    case 'cable_modem':
      return [port('IN', 'IN', 'in', 'rf', 'main')];
  }
}

/** Powered (`true`), passive (`false`) or not recorded (`undefined`). */
export function isPoweredRf(el: Pick<RfElement, 'kind' | 'powered'>): boolean | undefined {
  const power = RF_KIND_INFO[el.kind].power;
  if (power === 'always' || power === 'customer') return true;
  if (power === 'never') return false;
  return el.powered;
}

export const portKey = (elementId: string, portId: string) => `${elementId}::${portId}`;

export interface RfIndex {
  elements: Map<string, RfElement>;
  /** Active links only. */
  links: RfLink[];
  into: Map<string, RfLink[]>;
  outOf: Map<string, RfLink[]>;
  /** Removed links, newest first, by the port they went into. */
  removedInto: Map<string, RfLink[]>;
  cables: Map<string, Cable>;
}

export function indexRf(data: RfData): RfIndex {
  const into = new Map<string, RfLink[]>();
  const outOf = new Map<string, RfLink[]>();
  const removedInto = new Map<string, RfLink[]>();
  const links = data.rfLinks.filter((l) => l.status === 'active');
  for (const link of links) {
    const to = portKey(link.to.elementId, link.to.portId);
    const from = portKey(link.from.elementId, link.from.portId);
    into.set(to, [...(into.get(to) ?? []), link]);
    outOf.set(from, [...(outOf.get(from) ?? []), link]);
  }
  for (const link of data.rfLinks.filter((l) => l.status === 'removed')) {
    const to = portKey(link.to.elementId, link.to.portId);
    removedInto.set(to, [...(removedInto.get(to) ?? []), link].sort((a, b) => (b.removedAt ?? '').localeCompare(a.removedAt ?? '')));
  }
  return {
    elements: new Map(data.rfElements.map((e) => [e.id, e])),
    links,
    into,
    outOf,
    removedInto,
    cables: new Map((data.cables ?? []).map((c) => [c.id, c])),
  };
}

export const findRfPort = (el: RfElement | undefined, portId: string): RfPort | undefined => el?.ports.find((p) => p.id === portId);

/** "Tap T-12, DROP 2". */
export function describeRfPort(ix: RfIndex, ref: { elementId: string; portId: string }): string {
  const el = ix.elements.get(ref.elementId);
  if (!el) return `item ${ref.elementId} (not on record)`;
  const p = findRfPort(el, ref.portId);
  return `${RF_KIND_INFO[el.kind].label} ${el.name}, ${p ? p.label : `port ${ref.portId} (not on this item)`}`;
}

/** "RG6 coax, 35 m (sheath marks)", "Fiber 3 of Feeder A (1550 + 1490/1310 nm)". */
export function describeRfLink(ix: RfIndex, link: RfLink): string {
  if (link.medium === 'coax') {
    const len = link.lengthM !== undefined ? `${link.lengthM} m${link.lengthSource ? ` (${LENGTH_SOURCE_WORDS[link.lengthSource]})` : ''}` : 'length not recorded';
    return `${link.coaxType || 'Coax (type not recorded)'}${link.coaxType ? ' coax' : ''}, ${len}`;
  }
  if (link.medium === 'fiber') {
    const cable = link.cableId ? ix.cables.get(link.cableId) : undefined;
    const fiber = cable && link.fiberNumber ? coreIdentity(cable, link.fiberNumber).label : link.fiberNumber ? `Fiber ${link.fiberNumber}` : 'Fiber (number not recorded)';
    const where = cable ? ` of ${cable.name}` : link.cableId ? ` of cable ${link.cableId} (not on record)` : ' (cable not recorded)';
    const waves = link.wavelengthsNm?.length ? ` · ${link.wavelengthsNm.join(' / ')} nm` : '';
    return `${fiber}${where}${waves}`;
  }
  if (link.medium === 'power') return 'Power cable';
  return 'Short jumper';
}

export const LENGTH_SOURCE_WORDS = { drawn: 'drawn on the map', sheath: 'sheath marks', estimate: 'estimate' } as const;

/** The input port the signal comes in on: the main one, then any required one. */
export function mainInputOf(el: RfElement): RfPort | undefined {
  const ins = el.ports.filter((p) => p.direction === 'in' && p.signal !== 'power');
  return ins.find((p) => p.role === 'main' || p.role === 'common') ?? ins.find((p) => p.role === 'video') ?? ins.find((p) => !p.optional);
}

/** Why a port has no feed: "Tap T-12 has no recorded link on its IN port (the link from … was taken out on … : reason)". */
export function gapAtPort(ix: RfIndex, el: RfElement, p: RfPort): string {
  const removed = ix.removedInto.get(portKey(el.id, p.id))?.[0];
  const why = removed
    ? ` The link from ${describeRfPort(ix, removed.from)} was taken out${removed.removedAt ? ` on ${removed.removedAt.slice(0, 10)}` : ''}${removed.removedReason ? `: ${removed.removedReason}` : ''}.`
    : '';
  return `${RF_KIND_INFO[el.kind].label} ${el.name} has no recorded link on its ${p.label} port.${why}`;
}

export interface RfTraceStep {
  element: RfElement;
  /** The link that feeds this element (absent at the top). */
  link?: RfLink;
}

export interface RfTrace {
  /** From the top (headend, or the last item reached) down to the element traced. */
  steps: RfTraceStep[];
  complete: boolean;
  /** The exact missing link when the trace does not reach a headend. */
  gap?: string;
  loop?: boolean;
  amplifiers: number;
}

/** Follows recorded links up from an element to a headend or CMTS. Never guesses a feed. */
export function traceRfUpstream(ix: RfIndex, elementId: string): RfTrace {
  const steps: RfTraceStep[] = [];
  const seen = new Set<string>();
  let current = ix.elements.get(elementId);
  let viaLink: RfLink | undefined;
  if (!current) return { steps, complete: false, gap: `Item ${elementId} is not on record.`, amplifiers: 0 };
  const finish = (complete: boolean, gap?: string, loop?: boolean): RfTrace => {
    const ordered = steps.reverse();
    return { steps: ordered, complete, ...(gap ? { gap } : {}), ...(loop ? { loop } : {}), amplifiers: ordered.filter((s) => s.element.kind === 'rf_amplifier').length };
  };
  for (;;) {
    if (seen.has(current.id)) return finish(false, `The recorded links go round in a loop at ${RF_KIND_INFO[current.kind].label} ${current.name}.`, true);
    seen.add(current.id);
    steps.push({ element: current, ...(viaLink ? { link: viaLink } : {}) });
    if (RF_KIND_INFO[current.kind].root) return finish(true);
    const input = mainInputOf(current);
    if (!input) return finish(false, `${RF_KIND_INFO[current.kind].label} ${current.name} has no input port recorded.`);
    const feeds = ix.into.get(portKey(current.id, input.id)) ?? [];
    if (feeds.length === 0) return finish(false, gapAtPort(ix, current, input));
    if (feeds.length > 1) return finish(false, `${RF_KIND_INFO[current.kind].label} ${current.name} ${input.label} has ${feeds.length} links recorded into it. One input takes one feed.`);
    const [feed] = feeds;
    const upstream = ix.elements.get(feed.from.elementId);
    if (!upstream) return finish(false, `The link into ${current.name} ${input.label} comes from item ${feed.from.elementId}, which is not on record.`);
    // Steps hold the link that feeds them; the link belongs to the element below it.
    steps[steps.length - 1] = { element: current, link: feed };
    viaLink = undefined;
    current = upstream;
  }
}

export interface RfTreeNode {
  element: RfElement;
  /** The link from the parent into this element. */
  via?: RfLink;
  /** The parent's port the link leaves from. */
  depth: number;
  children: RfTreeNode[];
  /** Set when this element was already shown higher up: the links loop back. */
  loop?: boolean;
}

export interface RfTree {
  /** Trees from each headend or CMTS. */
  roots: RfTreeNode[];
  /** Items no headend reaches, each at the top of its own piece, with the exact gap. */
  detached: { node: RfTreeNode; gap: string }[];
  loops: string[];
  counts: { powered: number; passive: number; powerNotRecorded: number; customerDevices: number };
}

/** Walks every recorded link downstream from each headend, and lists the pieces no headend reaches. */
export function buildRfTree(data: RfData, ix: RfIndex = indexRf(data)): RfTree {
  const placed = new Set<string>();
  const loops: string[] = [];
  const walk = (el: RfElement, depth: number, via: RfLink | undefined, path: Set<string>): RfTreeNode => {
    if (path.has(el.id)) {
      loops.push(`The recorded links go round in a loop at ${RF_KIND_INFO[el.kind].label} ${el.name}.`);
      return { element: el, ...(via ? { via } : {}), depth, children: [], loop: true };
    }
    placed.add(el.id);
    const next = new Set(path).add(el.id);
    const children: RfTreeNode[] = [];
    for (const p of el.ports.filter((x) => x.direction === 'out')) {
      for (const link of ix.outOf.get(portKey(el.id, p.id)) ?? []) {
        const child = ix.elements.get(link.to.elementId);
        if (child) children.push(walk(child, depth + 1, link, next));
      }
    }
    return { element: el, ...(via ? { via } : {}), depth, children };
  };
  const roots = data.rfElements.filter((e) => RF_KIND_INFO[e.kind].root).map((e) => walk(e, 0, undefined, new Set()));
  const detached: RfTree['detached'] = [];
  for (const el of data.rfElements) {
    if (placed.has(el.id)) continue;
    // The top of a piece: follow its feeds up until one is missing, then walk down from there.
    const trace = traceRfUpstream(ix, el.id);
    const top = trace.steps[0]?.element ?? el;
    if (placed.has(top.id)) continue;
    detached.push({ node: walk(top, 0, undefined, new Set()), gap: trace.gap ?? 'Not reached from any headend.' });
  }
  const counts = { powered: 0, passive: 0, powerNotRecorded: 0, customerDevices: 0 };
  for (const el of data.rfElements) {
    if (RF_KIND_INFO[el.kind].power === 'customer') counts.customerDevices += 1;
    else {
      const powered = isPoweredRf(el);
      if (powered === true) counts.powered += 1;
      else if (powered === false) counts.passive += 1;
      else counts.powerNotRecorded += 1;
    }
  }
  return { roots, detached, loops: [...new Set(loops)], counts };
}

/** Elements whose recorded links lead back to themselves. */
export function findRfLoops(ix: RfIndex): string[] {
  const state = new Map<string, 'open' | 'done'>();
  const found = new Set<string>();
  const visit = (id: string) => {
    state.set(id, 'open');
    const el = ix.elements.get(id);
    for (const p of el?.ports.filter((x) => x.direction === 'out') ?? []) {
      for (const link of ix.outOf.get(portKey(id, p.id)) ?? []) {
        const next = link.to.elementId;
        if (!ix.elements.has(next)) continue;
        const s = state.get(next);
        if (s === 'open') found.add(next);
        else if (!s) visit(next);
      }
    }
    state.set(id, 'done');
  };
  for (const id of ix.elements.keys()) if (!state.has(id)) visit(id);
  return [...found];
}

/** The set top box or modem of a customer, and the path from it up to the headend. */
export function customerRfPath(data: RfData, customerId: string, ix: RfIndex = indexRf(data)): { device?: RfElement; trace?: RfTrace; gap?: string } {
  const device = data.rfElements.find((e) => (e.kind === 'stb' || e.kind === 'cable_modem') && e.customerId === customerId);
  if (!device) return { gap: 'No set top box or cable modem is recorded for this customer.' };
  const trace = traceRfUpstream(ix, device.id);
  return { device, trace, ...(trace.gap ? { gap: trace.gap } : {}) };
}
