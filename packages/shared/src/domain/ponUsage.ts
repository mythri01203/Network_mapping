import type { Cable, Customer, Equipment, JointClosure, Ont, PonPort, Service, Splitter } from '../model/types';
import { isActiveCustomer, isLiveOnt, isLiveService } from './connectionRules';
import { tracePonTree } from './fiberPath';
import type { OpticalSettings } from './opticalSettings';

/**
 * Phase 10: what a PON port serves, counted from the records every time: customers whose record
 * names the port, ONT records, live services and, when asked, what the recorded fibers reach.
 *
 * The stored `connectedCustomersCount` on a PON port was a running counter that could drift. It is
 * kept only as a cache: commands now set it to the count of customer records (`recountPonCustomers`)
 * instead of adding or taking one, and screens show the counts worked out here.
 */

export interface PonUsageData {
  equipment: readonly Equipment[];
  customers: readonly Customer[];
  onts?: readonly Ont[];
  services?: readonly Service[];
  /** Needed only to follow the fibers (`trace: true`). */
  cables?: readonly Cable[];
  splitters?: readonly Splitter[];
  closures?: readonly JointClosure[];
}

export interface PonPortUsage {
  oltId: string;
  ponPortId: string;
  /** Active customers whose record names this OLT and port. */
  customers: Customer[];
  /** Live ONT records on this port, or used by the customers above. */
  onts: Ont[];
  /** Active customers on this port with no live ONT record (only a serial on the customer, if any). */
  customersWithoutOnt: Customer[];
  /** ONT records plus customers with no ONT record, each counted as one ONT. */
  ontCount: number;
  /** Live services of those customers or on those ONTs. */
  services: Service[];
  /** The vendor's ONU limit, when someone recorded it. */
  limit?: number;
  /** Limit minus counted ONTs, when the limit is recorded. Never below 0. */
  free?: number;
  overLimit: boolean;
  /** The old stored counter, kept only as a cache. Shown only to explain a difference. */
  storedCount: number;
  /** What the recorded fibers reach from this port, when asked for. */
  reached?: { customers: Customer[]; splitterIds: string[]; problems: string[] };
  /** Plain-word checks: differences between the records. Never errors. */
  notes: string[];
}

/** Active customers whose record names this OLT and PON port. */
export const customersOnPonPort = (customers: readonly Customer[], oltId: string, ponPortId: string): Customer[] =>
  customers.filter((c) => isActiveCustomer(c) && c.accessNetwork !== 'hfc' && c.oltId === oltId && c.ponPort === ponPortId);

/** Counts for one PON port, from the records. Undefined when the OLT or port is not on record. */
export function ponPortUsage(
  data: PonUsageData,
  oltId: string,
  ponPortId: string,
  options: { trace?: boolean; settings?: OpticalSettings } = {},
): PonPortUsage | undefined {
  const olt = data.equipment.find((e) => e.id === oltId);
  const pon = olt?.ponPorts?.find((p) => p.id === ponPortId);
  if (!olt || !pon) return undefined;
  return usageOf(data, olt, pon, options);
}

/** Counts for every PON port of an OLT, in port order. */
export function oltPonUsage(data: PonUsageData, oltId: string, options: { trace?: boolean; settings?: OpticalSettings } = {}): PonPortUsage[] {
  const olt = data.equipment.find((e) => e.id === oltId);
  if (!olt) return [];
  return [...(olt.ponPorts ?? [])].sort((a, b) => a.portNumber - b.portNumber).map((pon) => usageOf(data, olt, pon, options));
}

function usageOf(data: PonUsageData, olt: Equipment, pon: PonPort, options: { trace?: boolean; settings?: OpticalSettings }): PonPortUsage {
  const notes: string[] = [];
  const customers = customersOnPonPort(data.customers, olt.id, pon.id);
  const liveOnts = (data.onts ?? []).filter(isLiveOnt);
  const ontById = new Map(liveOnts.map((o) => [o.id, o]));
  const onts = new Map<string, Ont>();
  for (const o of liveOnts) if (o.oltId === olt.id && o.ponPortId === pon.id) onts.set(o.id, o);
  const customersWithoutOnt: Customer[] = [];
  for (const c of customers) {
    const ont = c.ontId ? ontById.get(c.ontId) : undefined;
    if (!ont) {
      customersWithoutOnt.push(c);
      continue;
    }
    if (ont.ponPortId && (ont.oltId !== olt.id || ont.ponPortId !== pon.id)) {
      notes.push(`${c.name} is recorded on ${pon.id}, but their ONT ${ont.serialNumber ?? ont.id} is recorded on ${ont.oltId ?? 'another OLT'} ${ont.ponPortId}.`);
    }
    onts.set(ont.id, ont);
  }
  const customerIds = new Set(customers.map((c) => c.id));
  const services = (data.services ?? []).filter((s) => isLiveService(s) && (customerIds.has(s.customerId) || (!!s.ontId && onts.has(s.ontId))));
  const ontCount = onts.size + customersWithoutOnt.length;
  const limit = pon.maxOnu;
  const overLimit = limit !== undefined && ontCount > limit;
  if (overLimit) notes.push(`${pon.id} has ${ontCount} ONTs on record, above its recorded limit of ${limit}.`);

  let reached: PonPortUsage['reached'];
  if (options.trace && data.cables && data.splitters) {
    const tree = tracePonTree(
      olt.id,
      pon.id,
      { equipment: [...data.equipment], cables: [...data.cables], splitters: [...data.splitters], closures: [...(data.closures ?? [])], customers: [...data.customers] },
      { settings: options.settings },
    );
    if (tree) {
      const active = tree.customers.filter(isActiveCustomer);
      reached = { customers: active, splitterIds: tree.splitterIds, problems: tree.problems };
      const reachedIds = new Set(active.map((c) => c.id));
      const notReached = customers.filter((c) => !reachedIds.has(c.id));
      const notNamed = active.filter((c) => !customerIds.has(c.id));
      if (notReached.length > 0) {
        notes.push(`${notReached.length} customer(s) name ${pon.id}, but the recorded fibers do not reach them yet: ${notReached.slice(0, 3).map((c) => c.name).join(', ')}${notReached.length > 3 ? ' …' : ''}.`);
      }
      if (notNamed.length > 0) {
        notes.push(`The fibers from ${pon.id} reach ${notNamed.length} customer(s) whose record names another port or none: ${notNamed.slice(0, 3).map((c) => c.name).join(', ')}${notNamed.length > 3 ? ' …' : ''}.`);
      }
    }
  }

  return {
    oltId: olt.id,
    ponPortId: pon.id,
    customers,
    onts: [...onts.values()],
    customersWithoutOnt,
    ontCount,
    services,
    ...(limit !== undefined ? { limit, free: Math.max(0, limit - ontCount) } : {}),
    overLimit,
    storedCount: pon.connectedCustomersCount,
    ...(reached ? { reached } : {}),
    notes,
  };
}

/** Capacity in plain words: "12 of 64 ONTs (52 free)" or "12 ONTs · limit not recorded". */
export function ponCapacityText(usage: Pick<PonPortUsage, 'ontCount' | 'limit' | 'free'>): string {
  if (usage.limit === undefined) return `${usage.ontCount} ONT(s) · ONU limit not recorded`;
  return `${usage.ontCount} of ${usage.limit} ONTs (${usage.free ?? 0} free)`;
}

/**
 * Sets the cached `connectedCustomersCount` of every PON port on the given OLTs to the number of
 * customer records on that port. Used by commands after they change customers, in place of adding
 * or taking one. Equipment that does not change keeps its identity.
 */
export function recountPonCustomers(equipment: readonly Equipment[], customers: readonly Customer[], oltIds: Iterable<string | undefined>): Equipment[] {
  const wanted = new Set([...oltIds].filter((id): id is string => !!id));
  if (wanted.size === 0) return [...equipment];
  return equipment.map((e) => {
    if (!wanted.has(e.id) || !e.ponPorts?.length) return e;
    let changed = false;
    const ponPorts = e.ponPorts.map((p) => {
      const count = customersOnPonPort(customers, e.id, p.id).length;
      if (count === p.connectedCustomersCount) return p;
      changed = true;
      return { ...p, connectedCustomersCount: count };
    });
    return changed ? { ...e, ponPorts } : e;
  });
}
