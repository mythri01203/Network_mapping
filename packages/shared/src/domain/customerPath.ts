import type { Customer, Splitter } from '../model/types';
import { buildFiberIndex, coreKey, describeCore, type FiberData, type FiberIndex, isSpliceActive } from './fiberIndex';

/**
 * Phase 12: one source of truth for a customer's path. The fibre links decide it: the customer's
 * own drop fibre, then back through splices to a splitter output, then from that splitter's input
 * through splices, cascades, ODF ports and patches to an OLT PON port. The customer's path fields
 * (OLT, PON port, feeder, distribution, box, splitter, output, drop) are a copy that must agree.
 *
 * - A field the links decide and the record names differently: "disagrees". A write that adds one
 *   is refused (broken data). One already stored is listed, with the fix from the links, for a
 *   person to confirm. Nothing is ever rewritten silently.
 * - A field the links decide and the record leaves blank: "missing". Never an error.
 * - Where the links stop, the field is not decided: it may be blank, or keep what a person chose.
 *   Nothing is filled from a guess.
 *
 * Only explicit links count: never position, nearness, or which cable ends at which box.
 */

export const CUSTOMER_PATH_FIELDS = [
  'oltId',
  'ponPort',
  'feederCableId',
  'distributionCableId',
  'terminalBoxId',
  'splitterId',
  'splitterOutputPort',
  'dropCableId',
  'fiberCore',
] as const;
export type CustomerPathField = (typeof CUSTOMER_PATH_FIELDS)[number];

/** Plain words for each field, as field staff say them. */
export const CUSTOMER_PATH_FIELD_LABELS: Record<CustomerPathField, string> = {
  oltId: 'OLT',
  ponPort: 'PON port',
  feederCableId: 'feeder cable',
  distributionCableId: 'distribution cable',
  terminalBoxId: 'box',
  splitterId: 'splitter',
  splitterOutputPort: 'splitter output',
  dropCableId: 'drop cable',
  fiberCore: 'drop fiber',
};

export type CustomerPathValues = { [K in CustomerPathField]?: Customer[K] };

export interface LinkedCustomerPath {
  /** What the links decide. A field left out is not decided: the links stop before it. */
  values: CustomerPathValues;
  /** Where the recorded links stop, in plain words. Empty when they reach a PON port. */
  gaps: string[];
  reachesPon: boolean;
  /** The splitter output the links reach first from the customer. */
  output?: { splitterId: string; port: number };
}

/** What feeds a splitter's input, from the links. Cables are listed OLT first. */
export interface SplitterUpstream {
  oltId?: string;
  ponPortId?: string;
  cablesOltFirst: string[];
  gap?: string;
}

/** Shared within one run, so many customers on one splitter walk its upstream once. */
export interface CustomerPathCache {
  index: FiberIndex;
  upstream: Map<string, SplitterUpstream>;
  derived: Map<string, LinkedCustomerPath>;
  /** customer id → splitter outputs that name them (`connectedCustomerId`). */
  owned: Map<string, { splitter: Splitter; port: number; cableId?: string; core?: number }[]>;
}

export const isPonCustomer = (c: Pick<Customer, 'status' | 'accessNetwork'>): boolean => c.status !== 'Disconnected' && c.accessNetwork !== 'hfc';

export function customerPathCache(data: FiberData, index?: FiberIndex): CustomerPathCache {
  const owned: CustomerPathCache['owned'] = new Map();
  for (const splitter of data.splitters) {
    for (const p of splitter.outputPorts) {
      if (!p.connectedCustomerId) continue;
      const list = owned.get(p.connectedCustomerId) ?? [];
      list.push({ splitter, port: p.portNumber, cableId: p.connectedDropCableId, core: p.connectedCore });
      owned.set(p.connectedCustomerId, list);
    }
  }
  return { index: index ?? buildFiberIndex(data), upstream: new Map(), derived: new Map(), owned };
}

const cap = (s: string) => `${s[0].toUpperCase()}${s.slice(1)}`;
const MAX_HOPS = 200;

/** Walks one core towards the OLT. Cables are collected customer first and returned OLT first. */
function walkCore(cache: CustomerPathCache, start: { cableId: string; core: number }, seen: Set<string>): SplitterUpstream {
  const { index } = cache;
  const cables: string[] = [];
  const done = (rest: Omit<SplitterUpstream, 'cablesOltFirst'> & { above?: string[] }): SplitterUpstream => {
    const { above = [], ...result } = rest;
    return { ...result, cablesOltFirst: [...above, ...[...cables].reverse()] };
  };
  let current = start;
  for (let hop = 0; hop < MAX_HOPS; hop += 1) {
    const key = coreKey(current.cableId, current.core);
    if (seen.has(key)) return done({ gap: `The links loop back to ${describeCore(index, current.cableId, current.core)}.` });
    seen.add(key);
    if (!index.cables.has(current.cableId)) return done({ gap: `Cable ${current.cableId} is linked on this path but is not on record.` });
    if (cables.at(-1) !== current.cableId) cables.push(current.cableId);
    const sources = index.sources.get(key) ?? [];
    if (sources.length === 0) return done({ gap: `${cap(describeCore(index, current.cableId, current.core))} has no recorded link on its OLT side.` });
    if (sources.length > 1) return done({ gap: `${cap(describeCore(index, current.cableId, current.core))} has ${sources.length} feeds on record. Only one can be right.` });
    const source = sources[0];
    switch (source.kind) {
      case 'splice':
        current = { cableId: source.splice.inputCableId, core: source.splice.inputCore };
        break;
      case 'splitter': {
        const up = upstreamOfSplitter(cache, source.splitter, seen);
        return done({ ...(up.oltId ? { oltId: up.oltId, ponPortId: up.ponPortId } : {}), ...(up.gap ? { gap: up.gap } : {}), above: up.cablesOltFirst });
      }
      case 'odf': {
        const { odf, panel, port } = source;
        if (!port.patch) return done({ gap: `${odf.name} ${panel.label} port ${port.number} has no patch to an OLT PON port.` });
        const olt = index.equipment.get(port.patch.oltId);
        if (!olt) return done({ gap: `${odf.name} ${panel.label} port ${port.number} is patched to ${port.patch.oltId}, which is not on record.` });
        return done({ oltId: olt.id, ponPortId: port.patch.ponPortId });
      }
      case 'pon':
        return done({ oltId: source.olt.id, ponPortId: source.pon.id });
      default:
        return done({ gap: 'The link on the OLT side is of an unknown kind.' });
    }
  }
  return done({ gap: 'The path is longer than 200 links, so it was not followed.' });
}

/** What feeds this splitter, worked out once per run. */
export function upstreamOfSplitter(cache: CustomerPathCache, splitter: Splitter, seen: Set<string> = new Set()): SplitterUpstream {
  const known = cache.upstream.get(splitter.id);
  if (known) return known;
  const mark = `splitter:${splitter.id}`;
  if (seen.has(mark)) return { cablesOltFirst: [], gap: `Splitter ${splitter.name} feeds back into its own tree.` };
  seen.add(mark);
  const input = splitter.inputPort;
  let result: SplitterUpstream;
  if (input.connectedSplitterId) {
    const parent = cache.index.splitters.get(input.connectedSplitterId);
    result =
      parent && input.connectedSplitterPort
        ? upstreamOfSplitter(cache, parent, seen)
        : { cablesOltFirst: [], gap: `The input of splitter ${splitter.name} names splitter ${input.connectedSplitterId}, which is not on record.` };
  } else if (!input.connectedCableId || !input.connectedCore) {
    result = { cablesOltFirst: [], gap: `The input of splitter ${splitter.name} is not linked to a cable fiber.` };
  } else {
    result = walkCore(cache, { cableId: input.connectedCableId, core: input.connectedCore }, seen);
  }
  cache.upstream.set(splitter.id, result);
  return result;
}

/** What the links say feeds one splitter, for showing the path before a customer is saved on it. */
export function linkedUpstreamOfSplitter(data: FiberData, splitterId: string): SplitterUpstream | undefined {
  const cache = customerPathCache(data);
  const splitter = cache.index.splitters.get(splitterId);
  return splitter ? upstreamOfSplitter(cache, splitter) : undefined;
}

/** Fills the fields a splitter output and its upstream decide. */
function fromOutput(cache: CustomerPathCache, splitter: Splitter, port: number, values: CustomerPathValues, gaps: string[]): boolean {
  values.splitterId = splitter.id;
  values.splitterOutputPort = port;
  if (splitter.terminalBoxId && cache.index.equipment.has(splitter.terminalBoxId)) values.terminalBoxId = splitter.terminalBoxId;
  const up = upstreamOfSplitter(cache, splitter);
  // The cable that feeds the splitter is known even when the links stop further up.
  if (up.cablesOltFirst.length > 0) values.distributionCableId = up.cablesOltFirst[up.cablesOltFirst.length - 1];
  if (up.oltId) {
    values.oltId = up.oltId;
    if (up.ponPortId) values.ponPort = up.ponPortId;
    // The feeder is the cable at the OLT end, so it is known only when the links reach the OLT.
    if (up.cablesOltFirst.length > 0) values.feederCableId = up.cablesOltFirst[0];
    return true;
  }
  if (up.gap) gaps.push(up.gap);
  return false;
}

/**
 * What the fibre links say this customer's path is. The customer's own drop fibre is the starting
 * link; without it, the one splitter output that names the customer and carries a fibre.
 */
export function customerPathFromLinks(customer: Customer, cache: CustomerPathCache): LinkedCustomerPath {
  const known = cache.derived.get(customer.id);
  if (known) return known;
  const { index } = cache;
  const values: CustomerPathValues = {};
  const gaps: string[] = [];
  let reachesPon = false;
  let output: LinkedCustomerPath['output'];
  const owned = (cache.owned.get(customer.id) ?? []).filter((o) => o.cableId && o.core);
  const drop =
    customer.dropCableId && customer.fiberCore
      ? { cableId: customer.dropCableId, core: customer.fiberCore }
      : owned.length === 1
        ? { cableId: owned[0].cableId!, core: owned[0].core! }
        : undefined;
  if (!drop) {
    gaps.push(customer.dropCableId ? `${customer.name}'s drop fiber number is not recorded.` : `${customer.name} has no drop fiber recorded.`);
    // An output that names the customer still says which splitter they are on.
    const named = cache.owned.get(customer.id) ?? [];
    if (named.length === 1) {
      output = { splitterId: named[0].splitter.id, port: named[0].port };
      reachesPon = fromOutput(cache, named[0].splitter, named[0].port, values, gaps);
    }
  } else {
    values.dropCableId = drop.cableId;
    values.fiberCore = drop.core;
    let current = drop;
    const seen = new Set<string>();
    for (let hop = 0; hop < MAX_HOPS; hop += 1) {
      const key = coreKey(current.cableId, current.core);
      if (seen.has(key) || !index.cables.has(current.cableId)) {
        gaps.push(seen.has(key) ? `The links loop back to ${describeCore(index, current.cableId, current.core)}.` : `Cable ${current.cableId} is linked on this path but is not on record.`);
        break;
      }
      seen.add(key);
      const sources = index.sources.get(key) ?? [];
      if (sources.length !== 1) {
        gaps.push(
          sources.length === 0
            ? `${cap(describeCore(index, current.cableId, current.core))} has no recorded link to a splitter output.`
            : `${cap(describeCore(index, current.cableId, current.core))} has ${sources.length} feeds on record. Only one can be right.`,
        );
        break;
      }
      const source = sources[0];
      if (source.kind === 'splice') {
        current = { cableId: source.splice.inputCableId, core: source.splice.inputCore };
        continue;
      }
      if (source.kind === 'splitter') {
        output = { splitterId: source.splitter.id, port: source.port.portNumber };
        reachesPon = fromOutput(cache, source.splitter, source.port.portNumber, values, gaps);
        break;
      }
      // Straight from an ODF port or a PON port: no splitter on the way (point to point).
      const up = walkCore(cache, current, new Set());
      if (up.oltId) {
        values.oltId = up.oltId;
        if (up.ponPortId) values.ponPort = up.ponPortId;
        reachesPon = true;
      } else if (up.gap) gaps.push(up.gap);
      break;
    }
  }
  const result: LinkedCustomerPath = { values, gaps, reachesPon, ...(output ? { output } : {}) };
  cache.derived.set(customer.id, result);
  return result;
}

/* ------------------------------------------------------------------ */
/* Findings: where records and links disagree                          */
/* ------------------------------------------------------------------ */

export type CustomerPathState = 'disagrees' | 'missing' | 'unclear';

export interface CustomerPathFinding {
  kind: 'customer_field' | 'splitter_owner';
  /** disagrees: the record says one thing, the links another. missing: blank, the links say. unclear: two records disagree and the links do not settle it. */
  state: CustomerPathState;
  customerId: string;
  field?: CustomerPathField;
  splitterId?: string;
  port?: number;
  recorded?: string | number;
  /** What the links say. Absent for an owner that should be cleared, or when the links do not settle it. */
  fromLinks?: string | number;
  /** Stable for the same disagreement, so a write is blamed only for one it adds. */
  key: string;
  message: string;
}

const blank = (v: unknown) => v === undefined || v === null || v === '' || v === 0;

export interface FindingScope {
  /** Only these customers' fields, and the outputs that name them or that they reach. */
  customerIds?: ReadonlySet<string>;
  /** Only these splitters' outputs. */
  splitterIds?: ReadonlySet<string>;
}

/** Customers whose links reach this splitter output first. */
function linkedOwners(cache: CustomerPathCache, customersById: ReadonlyMap<string, Customer>, splitter: Splitter, port: number): Customer[] {
  const record = splitter.outputPorts.find((p) => p.portNumber === port);
  if (!record?.connectedDropCableId || !record.connectedCore) return [];
  const found: Customer[] = [];
  const queue = [{ cableId: record.connectedDropCableId, core: record.connectedCore }];
  const seen = new Set<string>();
  for (let guard = 0; queue.length && guard < 1000; guard += 1) {
    const next = queue.shift()!;
    const key = coreKey(next.cableId, next.core);
    if (seen.has(key)) continue;
    seen.add(key);
    for (const sink of cache.index.sinks.get(key) ?? []) {
      if (sink.kind === 'splice' && isSpliceActive(sink.splice)) queue.push({ cableId: sink.splice.outputCableId, core: sink.splice.outputCore });
      else if (sink.kind === 'customer') {
        const c = customersById.get(sink.customer.id);
        if (c && isPonCustomer(c)) {
          const out = customerPathFromLinks(c, cache).output;
          if (out?.splitterId === splitter.id && out.port === port) found.push(c);
        }
      }
    }
  }
  return found;
}

const show = (field: CustomerPathField, v: string | number | undefined) => (blank(v) ? 'not recorded' : field === 'fiberCore' ? `fiber ${v}` : field === 'splitterOutputPort' ? `output ${v}` : String(v));

/**
 * Every place where a customer's path fields or a splitter output's customer disagree with the
 * fibre links, or are blank where the links say. With a scope, only those records (for a write).
 */
export function findCustomerPathFindings(data: FiberData, scope?: FindingScope, cache: CustomerPathCache = customerPathCache(data)): CustomerPathFinding[] {
  const findings: CustomerPathFinding[] = [];
  const customersById = new Map(data.customers.map((c) => [c.id, c]));
  const wantCustomer = (id: string) => !scope || !!scope.customerIds?.has(id);

  // --- The customer's own fields ----------------------------------------------------------
  for (const customer of data.customers) {
    if (!isPonCustomer(customer) || !wantCustomer(customer.id)) continue;
    const linked = customerPathFromLinks(customer, cache);
    for (const field of CUSTOMER_PATH_FIELDS) {
      const fromLinks = linked.values[field];
      if (fromLinks === undefined) continue;
      const recorded = customer[field];
      if (recorded === fromLinks) continue;
      const label = CUSTOMER_PATH_FIELD_LABELS[field];
      const state: CustomerPathState = blank(recorded) ? 'missing' : 'disagrees';
      findings.push({
        kind: 'customer_field',
        state,
        customerId: customer.id,
        field,
        ...(blank(recorded) ? {} : { recorded }),
        fromLinks,
        key: `customer_path:${customer.id}/${field}:${String(recorded)}>${String(fromLinks)}`,
        message:
          state === 'missing'
            ? `${customer.name}: the ${label} is not recorded, but the fibre links lead to ${show(field, fromLinks)}.`
            : `${customer.name} is recorded on ${label} ${show(field, recorded)}, but the fibre links lead to ${show(field, fromLinks)}.`,
      });
    }
  }

  // --- Splitter outputs: the customer they name ------------------------------------------
  const outputsToCheck: { splitter: Splitter; port: number }[] = [];
  const queued = new Set<string>();
  const queue = (splitter: Splitter, port: number) => {
    const k = `${splitter.id}#${port}`;
    if (queued.has(k)) return;
    queued.add(k);
    outputsToCheck.push({ splitter, port });
  };
  if (!scope) {
    for (const s of data.splitters) for (const p of s.outputPorts) queue(s, p.portNumber);
  } else {
    for (const s of data.splitters) {
      if (scope.splitterIds?.has(s.id)) for (const p of s.outputPorts) queue(s, p.portNumber);
    }
    for (const id of scope.customerIds ?? []) {
      for (const o of cache.owned.get(id) ?? []) queue(o.splitter, o.port);
      const c = customersById.get(id);
      const out = c && isPonCustomer(c) ? customerPathFromLinks(c, cache).output : undefined;
      const sp = out ? cache.index.splitters.get(out.splitterId) : undefined;
      if (sp && out) queue(sp, out.port);
    }
  }
  for (const { splitter, port } of outputsToCheck) {
    const record = splitter.outputPorts.find((p) => p.portNumber === port);
    if (!record) continue;
    const named = record.connectedCustomerId;
    const owners = linkedOwners(cache, customersById, splitter, port);
    const where = `Output ${port} of splitter ${splitter.name}`;
    const base = { kind: 'splitter_owner' as const, splitterId: splitter.id, port };
    if (named) {
      const c = customersById.get(named);
      if (c && !isPonCustomer(c)) continue; // A disconnected customer holding an output has its own warning.
      if (c && owners.some((o) => o.id === c.id)) continue;
      const out = c ? customerPathFromLinks(c, cache).output : undefined;
      // The links lead this customer to this very output: owner and links agree (whatever the
      // customer's own fields still say; those are their own findings above).
      // Only when no other customer's fibre leads to this output: then it really is theirs.
      if (c && out && out.splitterId === splitter.id && out.port === port && owners.every((o) => o.id === c.id)) continue;
      if (c && !out && c.splitterId === splitter.id && c.splitterOutputPort === port) continue; // Both records agree; the links do not say.
      // Shared ONT (an MDU unit): customers on one ONT share one output.
      if (c && c.ontId && owners.length > 0 && owners.every((o) => o.ontId === c.ontId)) continue;
      const settled = !c || !!out || owners.length === 1;
      const owner = owners.length === 1 ? owners[0] : undefined;
      findings.push({
        ...base,
        state: settled ? 'disagrees' : 'unclear',
        customerId: named,
        recorded: named,
        ...(owner ? { fromLinks: owner.id } : {}),
        key: `splitter_owner:${splitter.id}#${port}:${named}>${owner?.id ?? (settled ? 'none' : '?')}`,
        message: !c
          ? `${where} names customer ${named}, who is not on record.`
          : owner
            ? `${where} is recorded for ${c.name}, but its fibre leads to ${owner.name}.`
            : out
              ? `${where} is recorded for ${c.name}, but ${c.name}'s fibre leads to output ${out.port} of ${cache.index.splitters.get(out.splitterId)?.name ?? out.splitterId}.`
              : `${where} is recorded for ${c.name}, but ${c.name} is recorded on ${c.splitterId ? `output ${c.splitterOutputPort} of ${cache.index.splitters.get(c.splitterId)?.name ?? c.splitterId}` : 'no splitter'}, and no fibre link settles which is right. Check on site.`,
      });
    } else if (owners.length === 1) {
      findings.push({
        ...base,
        state: 'missing',
        customerId: owners[0].id,
        fromLinks: owners[0].id,
        key: `splitter_owner:${splitter.id}#${port}:>${owners[0].id}`,
        message: `${where} does not name its customer, but its fibre leads to ${owners[0].name}.`,
      });
    }
  }
  return findings;
}

/** Findings whose record was written and that the stored data did not already have. Only "disagrees" blocks. */
export function newCustomerPathDisagreements(before: FiberData, after: FiberData, written: { customerIds: ReadonlySet<string>; splitterIds: ReadonlySet<string> }): CustomerPathFinding[] {
  if (written.customerIds.size === 0 && written.splitterIds.size === 0) return [];
  const scope = { customerIds: written.customerIds, splitterIds: written.splitterIds };
  const old = new Set(findCustomerPathFindings(before, scope).map((f) => f.key));
  return findCustomerPathFindings(after, scope).filter(
    (f) =>
      f.state === 'disagrees' &&
      !old.has(f.key) &&
      (f.kind === 'customer_field' ? written.customerIds.has(f.customerId) : written.splitterIds.has(f.splitterId!) || written.customerIds.has(f.customerId)),
  );
}

/* ------------------------------------------------------------------ */
/* Reconcile: the fix from the links, for a person to confirm          */
/* ------------------------------------------------------------------ */

export interface CustomerPathFix {
  customerId: string;
  customerName: string;
  findings: CustomerPathFinding[];
  /** Fields to set from the links. */
  customerPatch: CustomerPathValues;
  /** Splitter outputs whose customer is set from the links, or cleared (`customerId` absent). */
  outputFixes: { splitterId: string; port: number; customerId?: string }[];
  /** Findings with no fix from the links: a person checks on site. */
  unclear: CustomerPathFinding[];
  /** The links stop here, so the rest stays as it is. */
  gaps: string[];
}

/** Every customer whose records disagree with, or leave out, what the links say; with the fix. */
export function proposeCustomerPathFixes(data: FiberData, only?: ReadonlySet<string>): CustomerPathFix[] {
  const cache = customerPathCache(data);
  const findings = findCustomerPathFindings(data, only ? { customerIds: only, splitterIds: new Set() } : undefined, cache);
  const byCustomer = new Map<string, CustomerPathFix>();
  const customersById = new Map(data.customers.map((c) => [c.id, c]));
  for (const f of findings) {
    if (only && !only.has(f.customerId)) continue;
    const c = customersById.get(f.customerId);
    const fix =
      byCustomer.get(f.customerId) ??
      ({
        customerId: f.customerId,
        customerName: c?.name ?? f.customerId,
        findings: [],
        customerPatch: {},
        outputFixes: [],
        unclear: [],
        gaps: c && isPonCustomer(c) ? customerPathFromLinks(c, cache).gaps : [],
      } satisfies CustomerPathFix);
    byCustomer.set(f.customerId, fix);
    if (f.state === 'unclear') {
      fix.unclear.push(f);
      continue;
    }
    fix.findings.push(f);
    if (f.kind === 'customer_field' && f.field && f.fromLinks !== undefined) {
      (fix.customerPatch as Record<string, unknown>)[f.field] = f.fromLinks;
    } else if (f.kind === 'splitter_owner' && f.splitterId && f.port !== undefined) {
      fix.outputFixes.push({ splitterId: f.splitterId, port: f.port, ...(typeof f.fromLinks === 'string' ? { customerId: f.fromLinks } : {}) });
    }
  }
  return [...byCustomer.values()];
}
