import type { NetworkElementType } from '../model/enums';
import type { RfElement, RfLink } from '../model/rfSchemas';
import type { Attachment, Customer, NetworkElementRef, Ont, Service, Span } from '../model/types';
import type { NetworkData } from './command';
import { isActiveCustomer, isLiveService } from './connectionRules';
import { buildFiberIndex, coreKey, describeCore, type FiberData, type FiberIndex } from './fiberIndex';
import { type CorePathResult, traceCustomerCores } from './fiberPath';
import { DEFAULT_OPTICAL_SETTINGS, type OpticalSettings } from './opticalSettings';
import { cablesOnSpan, cablesOnStructure } from './outsidePlant';
import { customerRfPath, indexRf, type RfIndex } from './rfTree';

/**
 * Who is affected when one element fails (Phase 8). Built only from recorded links: each active
 * customer's fibers are traced core by core (`traceCustomerCores`), and a customer counts as
 * affected only when that recorded path passes through the element. A customer whose path breaks
 * before reaching it is never assumed to be on it: if their own record names the element, they are
 * listed apart as "may be affected, path not fully recorded". Nothing is worked out from distance.
 * Cable TV customers (Phase 6) are not on a PON path at all: they are followed up the recorded RF
 * links from their set top box or modem (`customerRfPath`), never counted as a broken PON path.
 */

export type ImpactData = FiberData & {
  spans?: readonly Span[];
  attachments?: readonly Attachment[];
  onts?: readonly Ont[];
  services?: readonly Service[];
  /** Phase 6 Cable TV records. Absent: Cable TV customers are kept apart with "RF links not given". */
  rfElements?: readonly RfElement[];
  rfLinks?: readonly RfLink[];
};

/**
 * A Cable TV customer: on a coax tap (`accessNetwork: 'hfc'`), or with no fiber drop and either a
 * Cable TV service or a set top box or modem recorded for them. Never traced as a PON customer.
 */
export function isTvCustomer(c: Customer, rfCustomerIds: ReadonlySet<string> = new Set()): boolean {
  if (c.accessNetwork === 'hfc') return true;
  if (c.accessNetwork === 'pon' || c.dropCableId) return false;
  return c.serviceType === 'Cable TV' || rfCustomerIds.has(c.id);
}

/** A Cable TV customer's recorded RF path, from the top down to their device. */
export interface TvPathInfo {
  customer: Customer;
  rfElementIds: string[];
  /** Map pins the RF items on the path sit at (a pole box with a tap or an amplifier). */
  siteIds: string[];
  /** Drawn cables the recorded RF links run in, and the fibers of fiber links. */
  cableIds: string[];
  coreKeys: string[];
  complete: boolean;
  gap?: string;
}

export interface CustomerPathInfo {
  customer: Customer;
  path: CorePathResult;
  /** Closures the path splices through. */
  closureIds: string[];
}

export interface ImpactIndex {
  data: ImpactData;
  fiber: FiberIndex;
  /** Active fiber (PON) customers only, by id. */
  paths: Map<string, CustomerPathInfo>;
  /** Active Cable TV customers, by id, with their recorded RF path. Never in `paths`. */
  tv: Map<string, TvPathInfo>;
}

function tvPathOf(data: ImpactData, rf: RfIndex, customer: Customer): TvPathInfo {
  const rfData = { rfElements: data.rfElements ?? [], rfLinks: data.rfLinks ?? [], cables: data.cables };
  const { trace, gap } = customerRfPath(rfData, customer.id, rf);
  const steps = trace?.steps ?? [];
  const links = steps.map((s) => s.link).filter((l): l is RfLink => !!l);
  const why = data.rfElements ? gap : 'The Cable TV records (RF items and links) were not given to this check.';
  return {
    customer,
    rfElementIds: steps.map((s) => s.element.id),
    siteIds: [...new Set(steps.map((s) => s.element.siteEquipmentId).filter((x): x is string => !!x))],
    cableIds: [...new Set(links.map((l) => l.cableId).filter((x): x is string => !!x))],
    coreKeys: [...new Set(links.filter((l) => l.cableId && l.fiberNumber).map((l) => coreKey(l.cableId!, l.fiberNumber!)))],
    complete: !!trace?.complete,
    ...(why ? { gap: why } : {}),
  };
}

/** Traces every active customer once, so many questions can be answered from one pass. */
export function buildImpactIndex(data: ImpactData, settings: OpticalSettings = DEFAULT_OPTICAL_SETTINGS): ImpactIndex {
  const fiber = buildFiberIndex(data);
  const rf = indexRf({ rfElements: data.rfElements ?? [], rfLinks: data.rfLinks ?? [], cables: data.cables });
  const rfCustomerIds = new Set((data.rfElements ?? []).filter((e) => (e.kind === 'stb' || e.kind === 'cable_modem') && e.customerId).map((e) => e.customerId!));
  const paths = new Map<string, CustomerPathInfo>();
  const tv = new Map<string, TvPathInfo>();
  for (const customer of data.customers) {
    if (!isActiveCustomer(customer)) continue;
    if (isTvCustomer(customer, rfCustomerIds)) {
      tv.set(customer.id, tvPathOf(data, rf, customer));
      continue;
    }
    const path = traceCustomerCores(customer, data, { settings, index: fiber });
    const closureIds = [...new Set(path.steps.filter((s) => s.kind === 'splice').map((s) => s.id))];
    paths.set(customer.id, { customer, path, closureIds });
  }
  return { data, fiber, paths, tv };
}

const STRUCTURE = /pole|manhole|handhole|chamber/i;
/** A pin that carries cables rather than joining fibers: its cables come from attachment records. */
export const isStructurePin = (type: string | undefined): boolean => !!type && STRUCTURE.test(type);

const asNetwork = (data: ImpactData) => data as unknown as NetworkData;

/** Cables recorded on a pole or span (attachments, Phase 3). Never cables drawn nearby. */
export function cablesRecordedOn(data: ImpactData, el: NetworkElementRef): string[] {
  if (el.type === 'span') return [...new Set(cablesOnSpan(asNetwork(data), el.id).map((c) => c.cable.id))];
  if (el.type === 'equipment') return [...new Set(cablesOnStructure(asNetwork(data), el.id).map((c) => c.cable.id))];
  return [];
}

export const elementKey = (el: NetworkElementRef): string =>
  el.type === 'pon_port' ? `pon_port:${el.id}/${el.ponPortId ?? ''}` : el.type === 'core' ? `core:${el.id}#${el.fiberNumber ?? 0}` : `${el.type}:${el.id}`;

/** What a person calls the element, for messages. Ids are kept so two items with one name differ. */
export function elementLabel(data: ImpactData, el: NetworkElementRef): string {
  switch (el.type) {
    case 'customer': {
      const c = data.customers.find((x) => x.id === el.id);
      return c ? `customer ${c.name} (${c.id})` : `customer ${el.id}`;
    }
    case 'ont': {
      const o = data.onts?.find((x) => x.id === el.id);
      return `ONT ${o?.serialNumber || el.id}`;
    }
    case 'splitter': {
      const s = data.splitters.find((x) => x.id === el.id);
      return s ? `splitter ${s.name} (${s.id})` : `splitter ${el.id}`;
    }
    case 'pon_port': {
      const olt = data.equipment.find((x) => x.id === el.id);
      const pon = olt?.ponPorts?.find((p) => p.id === el.ponPortId);
      const address = pon?.vendorAddress ?? pon?.slotCardPort;
      return `${olt?.name ?? el.id} PON port ${el.ponPortId ?? '?'}${address ? ` (${address})` : ''}`;
    }
    case 'olt': {
      const olt = data.equipment.find((x) => x.id === el.id);
      return `OLT ${olt?.name ?? el.id}`;
    }
    case 'cable': {
      const c = data.cables.find((x) => x.id === el.id);
      return c ? `cable ${c.name} (${c.id})` : `cable ${el.id}`;
    }
    case 'core': {
      const c = data.cables.find((x) => x.id === el.id);
      if (!c || !el.fiberNumber) return `fiber ${el.fiberNumber ?? '?'} of cable ${el.id}`;
      return describeCore(buildFiberIndex({ ...data, cables: [c] }), c.id, el.fiberNumber);
    }
    case 'closure': {
      const c = data.closures.find((x) => x.id === el.id);
      return c ? `closure ${c.name} (${c.id})` : `closure ${el.id}`;
    }
    case 'equipment': {
      const e = data.equipment.find((x) => x.id === el.id);
      return e ? `${e.type} ${e.name} (${e.id})` : `pin ${el.id}`;
    }
    case 'span': {
      const s = data.spans?.find((x) => x.id === el.id);
      return s ? `span ${s.name} (${s.id})` : `span ${el.id}`;
    }
  }
}

/** Whether the element is on record, with the sub-part (port, fiber) it names. */
export function elementExists(data: ImpactData, el: NetworkElementRef): boolean {
  switch (el.type) {
    case 'customer':
      return data.customers.some((x) => x.id === el.id);
    case 'ont':
      return (data.onts ?? []).some((x) => x.id === el.id);
    case 'splitter':
      return data.splitters.some((x) => x.id === el.id);
    case 'pon_port':
      return !!el.ponPortId && !!data.equipment.find((x) => x.id === el.id)?.ponPorts?.some((p) => p.id === el.ponPortId);
    case 'olt':
    case 'equipment':
      return data.equipment.some((x) => x.id === el.id);
    case 'cable':
      return data.cables.some((x) => x.id === el.id);
    case 'core': {
      const c = data.cables.find((x) => x.id === el.id);
      return !!c && !!el.fiberNumber && el.fiberNumber >= 1 && el.fiberNumber <= c.fiberCount;
    }
    case 'closure':
      return data.closures.some((x) => x.id === el.id);
    case 'span':
      return (data.spans ?? []).some((x) => x.id === el.id);
  }
}

/** Where the element is on the map, from its own record. Undefined when it has no position. */
export function elementLocation(data: ImpactData, el: NetworkElementRef): { lat: number; lng: number } | undefined {
  const pin = (id: string) => {
    const e = data.equipment.find((x) => x.id === id);
    return e ? { lat: e.lat, lng: e.lng } : undefined;
  };
  switch (el.type) {
    case 'customer': {
      const c = data.customers.find((x) => x.id === el.id);
      return c && (c.lat !== 0 || c.lng !== 0) ? { lat: c.lat, lng: c.lng } : undefined;
    }
    case 'ont': {
      const user = data.customers.find((c) => c.ontId === el.id);
      return user && (user.lat !== 0 || user.lng !== 0) ? { lat: user.lat, lng: user.lng } : undefined;
    }
    case 'splitter': {
      const s = data.splitters.find((x) => x.id === el.id);
      return s ? pin(s.terminalBoxId) : undefined;
    }
    case 'pon_port':
    case 'olt':
    case 'equipment':
      return pin(el.id);
    case 'cable':
    case 'core': {
      const c = data.cables.find((x) => x.id === el.id);
      const mid = c?.coordinates[Math.floor(c.coordinates.length / 2)];
      return mid ? { lat: mid[0], lng: mid[1] } : undefined;
    }
    case 'closure': {
      const c = data.closures.find((x) => x.id === el.id);
      return c ? { lat: c.lat, lng: c.lng } : undefined;
    }
    case 'span': {
      const s = data.spans?.find((x) => x.id === el.id);
      const a = s ? pin(s.fromStructureId) : undefined;
      const b = s ? pin(s.toStructureId) : undefined;
      return a && b ? { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 } : (a ?? b);
    }
  }
}

/** True when the customer's recorded path passes through the element. */
export function pathPassesThrough(ix: ImpactIndex, info: CustomerPathInfo, el: NetworkElementRef, structureCables?: readonly string[]): boolean {
  const { path, customer } = info;
  switch (el.type) {
    case 'customer':
      return customer.id === el.id;
    case 'ont':
      return customer.ontId === el.id;
    case 'splitter':
      return path.splitterIds.includes(el.id);
    case 'pon_port':
      return path.olt?.id === el.id && path.pon?.id === el.ponPortId;
    case 'olt':
      return path.olt?.id === el.id;
    case 'cable':
      return path.cableIds.includes(el.id);
    case 'core':
      return !!el.fiberNumber && path.coreKeys.includes(coreKey(el.id, el.fiberNumber));
    case 'closure':
      return info.closureIds.includes(el.id);
    case 'span':
      return (structureCables ?? cablesRecordedOn(ix.data, el)).some((id) => path.cableIds.includes(id));
    case 'equipment': {
      const pinRecord = ix.fiber.equipment.get(el.id);
      if (pinRecord && isStructurePin(pinRecord.type)) {
        return (structureCables ?? cablesRecordedOn(ix.data, el)).some((id) => path.cableIds.includes(id));
      }
      if (path.equipmentIds.includes(el.id)) return true;
      if (path.splitterIds.some((sid) => ix.fiber.splitters.get(sid)?.terminalBoxId === el.id)) return true;
      return info.closureIds.some((cid) => ix.data.closures.find((c) => c.id === cid)?.equipmentId === el.id);
    }
  }
}

/**
 * True when a Cable TV customer's recorded RF path passes through the element: an RF item sitting
 * at that pin, a drawn cable (or fiber) one of its RF links runs in, or a pole or span carrying such
 * a cable. PON-only elements (splitter, PON port, OLT, closure) never carry an RF path.
 */
export function tvPathPassesThrough(ix: ImpactIndex, info: TvPathInfo, el: NetworkElementRef, structureCables?: readonly string[]): boolean {
  switch (el.type) {
    case 'customer':
      return info.customer.id === el.id;
    case 'cable':
      return info.cableIds.includes(el.id);
    case 'core':
      return !!el.fiberNumber && info.coreKeys.includes(coreKey(el.id, el.fiberNumber));
    case 'span':
      return (structureCables ?? cablesRecordedOn(ix.data, el)).some((id) => info.cableIds.includes(id));
    case 'equipment': {
      if (info.siteIds.includes(el.id)) return true;
      if (!isStructurePin(ix.fiber.equipment.get(el.id)?.type)) return false;
      return (structureCables ?? cablesRecordedOn(ix.data, el)).some((id) => info.cableIds.includes(id));
    }
    default:
      return false;
  }
}

const customerCables = (c: Customer) => [c.feederCableId, c.distributionCableId, c.dropCableId].filter(Boolean);

/**
 * For a customer whose path is not fully recorded: what in their own record names the element,
 * or null. These records are cable level, so they only make a customer "may be affected".
 */
export function recordNamesElement(ix: ImpactIndex, customer: Customer, el: NetworkElementRef, structureCables?: readonly string[]): string | null {
  const cables = customerCables(customer);
  switch (el.type) {
    case 'splitter':
      return customer.splitterId === el.id ? 'their record names this splitter' : null;
    case 'pon_port':
      return customer.oltId === el.id && !!customer.ponPort && customer.ponPort === el.ponPortId ? 'their record names this PON port' : null;
    case 'olt':
      return customer.oltId === el.id ? 'their record names this OLT' : null;
    case 'cable':
      return cables.includes(el.id) ? 'their record names this cable' : null;
    case 'core':
      return customer.dropCableId === el.id && customer.fiberCore === el.fiberNumber ? 'their record names this fiber' : null;
    case 'closure': {
      const closure = ix.data.closures.find((c) => c.id === el.id);
      const inClosure = new Set((closure?.cableEntries ?? []).map((e) => e.cableId));
      const hit = cables.find((id) => inClosure.has(id));
      return hit ? `their record names cable ${hit}, which is recorded at this closure` : null;
    }
    case 'span':
    case 'equipment': {
      if (el.type === 'equipment' && customer.terminalBoxId === el.id) return 'their record names this box';
      const on = structureCables ?? cablesRecordedOn(ix.data, el);
      const hit = cables.find((id) => on.includes(id));
      return hit ? `their record names cable ${hit}, which is recorded on it` : null;
    }
    default:
      return null;
  }
}

export interface AffectedCustomer {
  customerId: string;
  name: string;
  /** False when the path breaks further up: the element is on its recorded part, the rest is not. */
  pathComplete: boolean;
  /** `hfc`: a Cable TV customer, found through recorded RF links rather than a fiber path. */
  network?: 'hfc';
  services: { id: string; kind: Service['kind']; status: Service['status'] }[];
}

export interface MaybeAffectedCustomer {
  customerId: string;
  name: string;
  reason: string;
  /** The first missing link on their path, in plain words. */
  firstGap: string;
}

export interface ImpactResult {
  element: NetworkElementRef;
  label: string;
  exists: boolean;
  affected: AffectedCustomer[];
  mayBeAffected: MaybeAffectedCustomer[];
  /** Live services of the affected customers. */
  activeServices: number;
  /** Cables recorded on a pole or span, which is how its customers are found. */
  structureCables?: string[];
  notes: string[];
}

const SERVICE_FIELDS = (s: Service) => ({ id: s.id, kind: s.kind, status: s.status });

/** Customers and services that depend on the element, from recorded links only. */
export function affectedByElement(ix: ImpactIndex, el: NetworkElementRef): ImpactResult {
  const label = elementLabel(ix.data, el);
  const exists = elementExists(ix.data, el);
  const notes: string[] = [];
  const pinRecord = el.type === 'equipment' ? ix.fiber.equipment.get(el.id) : undefined;
  const structure = el.type === 'span' || (el.type === 'equipment' && isStructurePin(pinRecord?.type));
  const structureCables = structure ? cablesRecordedOn(ix.data, el) : undefined;
  if (!exists) notes.push(`${label} is not on record, so nobody can be listed.`);
  if (structure && structureCables?.length === 0) {
    notes.push('No cable is recorded on it (Phase 3 attachments), so nobody can be listed. A cable drawn past a pole does not count.');
  }
  const services = ix.data.services ?? [];
  const affected: AffectedCustomer[] = [];
  const mayBeAffected: MaybeAffectedCustomer[] = [];
  let noPath = 0;
  if (exists) {
    for (const info of ix.paths.values()) {
      const { customer, path } = info;
      if (pathPassesThrough(ix, info, el, structureCables)) {
        affected.push({
          customerId: customer.id,
          name: customer.name,
          pathComplete: path.complete,
          services: services.filter((s) => s.customerId === customer.id && isLiveService(s)).map(SERVICE_FIELDS),
        });
        continue;
      }
      if (path.complete) continue;
      if (!customer.dropCableId) noPath += 1;
      const reason = recordNamesElement(ix, customer, el, structureCables);
      if (reason) mayBeAffected.push({ customerId: customer.id, name: customer.name, reason, firstGap: path.gaps[0] ?? 'path not recorded' });
    }
    let tvGaps = 0;
    for (const info of ix.tv.values()) {
      if (tvPathPassesThrough(ix, info, el, structureCables)) {
        affected.push({
          customerId: info.customer.id,
          name: info.customer.name,
          pathComplete: info.complete,
          network: 'hfc',
          services: services.filter((s) => s.customerId === info.customer.id && isLiveService(s)).map(SERVICE_FIELDS),
        });
      } else if (!info.complete) tvGaps += 1;
    }
    const carriesRf = el.type === 'equipment' || el.type === 'cable' || el.type === 'core' || el.type === 'span';
    if (carriesRf && tvGaps > 0) {
      notes.push(`${tvGaps} Cable TV customer(s) have no complete RF path recorded, so they cannot be placed on this item. They are not counted as a broken fiber path.`);
    }
  }
  if (noPath > 0) notes.push(`${noPath} active customer(s) have no drop fiber recorded at all, so they cannot be placed on any element.`);
  notes.push('Only recorded links are followed: splices, splitter ports, ODF ports and patches. Nothing is worked out from distance.');
  const activeServices = affected.reduce((n, a) => n + a.services.filter((s) => s.status === 'active').length, 0);
  return { element: el, label, exists, affected, mayBeAffected, activeServices, structureCables, notes };
}

/** Plain next checks for a crew, by what is suspected. Never a claim of what broke. */
export function recommendedChecks(type: NetworkElementType): string[] {
  switch (type) {
    case 'customer':
    case 'ont':
      return ['Check the house wire, its connectors and the ONT power at the house.', 'Take a light reading at the ONT and compare it with the last one.'];
    case 'splitter':
      return ['Open the box: look for water, a broken splitter or a pulled fiber.', 'Check the splice or patch that feeds the splitter input.'];
    case 'closure':
      return ['Open the closure and check the trays and splices on this path.', 'Look for water inside or a crushed cable at the entry.'];
    case 'cable':
    case 'span':
    case 'equipment':
      return ['Walk the route: look for a cut, crush, fire or rodent damage, and fallen poles.', 'Use an OTDR from the nearest closure to find the distance to the break.'];
    case 'core':
      return ['Check the splices of this fiber in the closures on the path.', 'Use an OTDR on this fiber from the nearest closure.'];
    case 'pon_port':
      return ['Check the OLT port and its optic, and the patch cord at the ODF.', 'Look at the port alarms on the OLT itself.'];
    case 'olt':
      return ['Check the OLT power, its uplink and its own alarm list.', 'Check whether other OLTs at the site are affected.'];
  }
}
