import type { Cable, Customer, Splitter, SyncConflict, WorkOrder } from '../model/types';
import type { AccountRole } from './access';

/**
 * Phase 12: customers' personal data by role. A role sees a customer's name, address, house
 * position (GPS) and mobile only when its work needs them. The server takes the rest out of every
 * answer that carries customers; the app shows "Hidden for your role". A hidden value is never
 * stored back: on every write the server keeps the value it holds.
 *
 * | Role | Hidden |
 * |---|---|
 * | Super Admin, Network Admin, Network Planner, NOC Operator, Supervisor | nothing (they own customer records, phone customers about faults, give out jobs) |
 * | GIS Engineer | mobile (mapping needs the name, address and house position, not the phone) |
 * | Field Technician | name, address and mobile, except for customers on their own open jobs. The house position stays: the drop cable is drawn to it anyway, and they need the map |
 * | Read-only | name, address, house position and mobile |
 */

export const CUSTOMER_HIDDEN_TEXT = 'Hidden for your role';

export const PERSONAL_FIELDS = ['name', 'address', 'gps', 'mobile'] as const;
export type PersonalField = (typeof PERSONAL_FIELDS)[number];

export const PERSONAL_FIELD_LABELS: Record<PersonalField, string> = { name: 'Name', address: 'Address', gps: 'House position', mobile: 'Mobile' };

export interface CustomerPrivacyRule {
  hidden: readonly PersonalField[];
  /** Shown in full for customers on this person's own open jobs. */
  ownJobsShown?: boolean;
}

export const CUSTOMER_PRIVACY: Record<AccountRole, CustomerPrivacyRule> = {
  admin: { hidden: [] },
  network_admin: { hidden: [] },
  office: { hidden: [] },
  noc: { hidden: [] },
  supervisor: { hidden: [] },
  engineer: { hidden: ['mobile'] },
  technician: { hidden: ['name', 'address', 'mobile'], ownJobsShown: true },
  viewer: { hidden: ['name', 'address', 'gps', 'mobile'] },
};

/** Who is reading. `null` (setup mode, login off) sees everything. */
export interface PrivacyViewer {
  role: AccountRole;
  displayName: string;
}

const CLOSED_JOB = new Set(['Cancelled', 'Closed']);

/** Customers named on this person's own jobs that are not cancelled or closed. Same "own" as the write check: the technician name. */
export function ownJobCustomerIds(workOrders: readonly Pick<WorkOrder, 'customerId' | 'technicianName' | 'status'>[], displayName: string): Set<string> {
  const ids = new Set<string>();
  for (const w of workOrders) if (w.customerId && w.technicianName === displayName && !CLOSED_JOB.has(w.status)) ids.add(w.customerId);
  return ids;
}

/** Whether this role hides anything at all (then the server must look at customers). */
export const roleHidesPersonalData = (viewer: PrivacyViewer | null): boolean => !!viewer && CUSTOMER_PRIVACY[viewer.role].hidden.length > 0;

/** Whether this role's hiding depends on the person's own jobs. */
export const roleNeedsOwnJobs = (viewer: PrivacyViewer | null): boolean => !!viewer && !!CUSTOMER_PRIVACY[viewer.role].ownJobsShown;

export function hiddenPersonalFields(viewer: PrivacyViewer | null, customerId: string, ownJobs: ReadonlySet<string> = new Set()): PersonalField[] {
  if (!viewer) return [];
  const rule = CUSTOMER_PRIVACY[viewer.role] ?? CUSTOMER_PRIVACY.viewer;
  if (rule.ownJobsShown && ownJobs.has(customerId)) return [];
  return [...rule.hidden];
}

const recordedPosition = (c: Pick<Customer, 'lat' | 'lng'>) => !(c.lat === 0 && c.lng === 0) && Number.isFinite(c.lat) && Number.isFinite(c.lng);

/** A copy with these fields hidden. An empty value stays empty (nothing to hide). */
export function redactCustomer(customer: Customer, hidden: readonly PersonalField[]): Customer {
  if (hidden.length === 0) return customer;
  const next: Customer = { ...customer };
  const done: PersonalField[] = [];
  if (hidden.includes('name')) {
    next.name = CUSTOMER_HIDDEN_TEXT;
    done.push('name');
  }
  if (hidden.includes('address') && (customer.address || customer.building || customer.flatNumber)) {
    next.address = customer.address ? CUSTOMER_HIDDEN_TEXT : '';
    if (customer.building) next.building = CUSTOMER_HIDDEN_TEXT;
    if (customer.flatNumber) next.flatNumber = CUSTOMER_HIDDEN_TEXT;
    done.push('address');
  }
  if (hidden.includes('mobile') && customer.mobile) {
    next.mobile = CUSTOMER_HIDDEN_TEXT;
    done.push('mobile');
  }
  if (hidden.includes('gps') && recordedPosition(customer)) {
    next.lat = 0;
    next.lng = 0;
    delete next.locationAccuracyMeters;
    delete next.locationMethod;
    done.push('gps');
  }
  if (done.length > 0) next.hiddenFields = done;
  else delete next.hiddenFields;
  return next;
}

/** Splitter outputs keep the customer's id (a link) but not their name, when the name is hidden. */
export function redactSplitterNames(splitter: Splitter, nameHidden: (customerId: string) => boolean): Splitter {
  if (!splitter.outputPorts.some((p) => p.connectedCustomerName && p.connectedCustomerId && nameHidden(p.connectedCustomerId))) return splitter;
  return {
    ...splitter,
    outputPorts: splitter.outputPorts.map((p) =>
      p.connectedCustomerName && p.connectedCustomerId && nameHidden(p.connectedCustomerId) ? { ...p, connectedCustomerName: CUSTOMER_HIDDEN_TEXT } : p,
    ),
  };
}

/** Cable fibers keep the customer's id but not their name (on the fiber and in "ONT of <name>"). */
export function redactCableNames(cable: Cable, nameHidden: (customerId: string) => boolean): Cable {
  const touches = cable.cores.some((k) => (k.customerId && k.customerName && nameHidden(k.customerId)) || k.assignments?.some((a) => a.customerId && a.destination && nameHidden(a.customerId)));
  if (!touches) return cable;
  return {
    ...cable,
    cores: cable.cores.map((k) => ({
      ...k,
      ...(k.customerId && k.customerName && nameHidden(k.customerId) ? { customerName: CUSTOMER_HIDDEN_TEXT } : {}),
      ...(k.assignments
        ? { assignments: k.assignments.map((a) => (a.customerId && a.destination && nameHidden(a.customerId) ? { ...a, destination: CUSTOMER_HIDDEN_TEXT } : a)) }
        : {}),
    })),
  };
}

type RedactableData = {
  customers?: Customer[];
  splitters?: Splitter[];
  cables?: Cable[];
  syncConflicts?: SyncConflict[];
};

/** Redacts one stored record of any collection for this reader. `null` means "leave it out". */
export function redactRecordForRole(collection: string, record: unknown, viewer: PrivacyViewer | null, ownJobs: ReadonlySet<string> = new Set()): unknown {
  if (!roleHidesPersonalData(viewer) || !record || typeof record !== 'object') return record;
  const hiddenFor = (id: string) => hiddenPersonalFields(viewer, id, ownJobs);
  const nameHidden = (id: string) => hiddenFor(id).includes('name');
  switch (collection) {
    case 'customers': {
      const c = record as Customer;
      return redactCustomer(c, hiddenFor(c.id));
    }
    case 'splitters':
      return Array.isArray((record as Splitter).outputPorts) ? redactSplitterNames(record as Splitter, nameHidden) : record;
    case 'cables':
      return Array.isArray((record as Cable).cores) ? redactCableNames(record as Cable, nameHidden) : record;
    case 'syncConflicts': {
      // A look-only account never sees them (they hold whole copies of other records).
      if (viewer!.role === 'viewer') return null;
      const conflict = record as SyncConflict;
      const side = (copy: Record<string, unknown> | null) => (copy ? (redactRecordForRole(conflict.collection, copy, viewer, ownJobs) as Record<string, unknown>) : copy);
      return { ...conflict, mine: side(conflict.mine), theirs: side(conflict.theirs) };
    }
    default:
      return record;
  }
}

/** Redacts every collection in a snapshot, area answer or changes feed for this reader. */
export function redactNetworkForRole<T extends RedactableData>(data: T, viewer: PrivacyViewer | null, ownJobs: ReadonlySet<string> = new Set()): T {
  if (!roleHidesPersonalData(viewer)) return data;
  const each = <R>(collection: string, list: R[] | undefined) => list?.map((r) => redactRecordForRole(collection, r, viewer, ownJobs) as R).filter((r) => r !== null);
  return {
    ...data,
    ...(data.customers ? { customers: each('customers', data.customers) } : {}),
    ...(data.splitters ? { splitters: each('splitters', data.splitters) } : {}),
    ...(data.cables ? { cables: each('cables', data.cables) } : {}),
    ...(data.syncConflicts ? { syncConflicts: each('syncConflicts', data.syncConflicts) } : {}),
  };
}

/** Fields of a customer audit diff whose values are personal. */
const PERSONAL_KEYS: Record<PersonalField, readonly string[]> = {
  name: ['name'],
  address: ['address', 'building', 'flatNumber'],
  gps: ['lat', 'lng', 'locationAccuracyMeters', 'locationMethod'],
  mobile: ['mobile'],
};

/** The record fields that hold these personal fields. */
export const personalKeysOf = (hidden: readonly PersonalField[]): Set<string> => new Set(hidden.flatMap((f) => PERSONAL_KEYS[f]));

/**
 * Which values of an audit diff this reader may not see: personal fields of a customer, and the
 * fiber or output lists (they carry customer names) when the name is hidden.
 */
export function hiddenDiffFields(collection: string, recordId: string, viewer: PrivacyViewer | null, ownJobs: ReadonlySet<string> = new Set()): Set<string> {
  if (!roleHidesPersonalData(viewer)) return new Set();
  if (collection === 'customers') return personalKeysOf(hiddenPersonalFields(viewer, recordId, ownJobs));
  const namesHidden = CUSTOMER_PRIVACY[viewer!.role].hidden.includes('name');
  if (!namesHidden) return new Set();
  if (collection === 'splitters') return new Set(['outputPorts']);
  if (collection === 'cables') return new Set(['cores']);
  if (collection === 'syncConflicts') return new Set(['mine', 'theirs']);
  return new Set();
}

/* ------------------------------------------------------------------ */
/* Writes: a hidden value is never stored                              */
/* ------------------------------------------------------------------ */

const isHidden = (v: unknown) => v === CUSTOMER_HIDDEN_TEXT;

/**
 * A customer as it should be stored: any value this writer could not see (it came back hidden) is
 * the stored one. A value the writer did change is kept, so the permission check still judges it.
 * `hiddenFields` is never stored.
 */
export function restoreHiddenCustomer(incoming: Customer, stored: Customer | undefined, roleHidden: readonly PersonalField[] = []): Customer {
  const marked = new Set<PersonalField>([...(incoming.hiddenFields ?? []), ...roleHidden]);
  const { hiddenFields: _drop, ...next } = incoming;
  const out: Customer = { ...next };
  if (!stored) return out;
  if (isHidden(out.name)) out.name = stored.name;
  if (isHidden(out.address)) out.address = stored.address;
  if (isHidden(out.building)) out.building = stored.building;
  if (isHidden(out.flatNumber)) out.flatNumber = stored.flatNumber;
  if (isHidden(out.mobile)) out.mobile = stored.mobile;
  // A hidden position comes back as 0, 0 (not recorded). It is never a real "clear".
  if (marked.has('gps') && out.lat === 0 && out.lng === 0 && recordedPosition(stored)) {
    out.lat = stored.lat;
    out.lng = stored.lng;
    if (stored.locationAccuracyMeters !== undefined) out.locationAccuracyMeters = stored.locationAccuracyMeters;
    if (stored.locationMethod !== undefined) out.locationMethod = stored.locationMethod;
  }
  for (const key of ['building', 'flatNumber', 'locationAccuracyMeters', 'locationMethod'] as const) {
    if (out[key] === undefined) delete out[key];
  }
  return out;
}

/** A hidden name on a splitter output is the customer's real name (or the stored one). */
export function restoreHiddenSplitter(incoming: Splitter, stored: Splitter | undefined, nameOf: (customerId: string) => string | undefined): Splitter {
  if (!incoming.outputPorts.some((p) => isHidden(p.connectedCustomerName))) return incoming;
  return {
    ...incoming,
    outputPorts: incoming.outputPorts.map((p) => {
      if (!isHidden(p.connectedCustomerName)) return p;
      const real = (p.connectedCustomerId ? nameOf(p.connectedCustomerId) : undefined) ?? stored?.outputPorts.find((s) => s.portNumber === p.portNumber)?.connectedCustomerName;
      const { connectedCustomerName: _n, ...rest } = p;
      return real ? { ...rest, connectedCustomerName: real } : rest;
    }),
  };
}

/** A hidden name on a cable fiber or assignment is the stored one, or the customer's real name. */
export function restoreHiddenCable(incoming: Cable, stored: Cable | undefined, nameOf: (customerId: string) => string | undefined): Cable {
  const touched = incoming.cores.some((k) => isHidden(k.customerName) || k.assignments?.some((a) => isHidden(a.destination)));
  if (!touched) return incoming;
  return {
    ...incoming,
    cores: incoming.cores.map((k) => {
      const before = stored?.cores.find((s) => s.coreNumber === k.coreNumber);
      const core = { ...k };
      if (isHidden(core.customerName)) {
        const real = before?.customerName ?? (core.customerId ? nameOf(core.customerId) : undefined);
        if (real) core.customerName = real;
        else delete core.customerName;
      }
      if (core.assignments?.some((a) => isHidden(a.destination))) {
        core.assignments = core.assignments.map((a) => {
          if (!isHidden(a.destination)) return a;
          const was = before?.assignments?.find((b) => b.id === a.id)?.destination;
          const name = a.customerId ? nameOf(a.customerId) : undefined;
          const real = was ?? (name ? `ONT of ${name}` : undefined);
          const { destination: _d, ...rest } = a;
          return real ? { ...rest, destination: real } : rest;
        });
      }
      return core;
    }),
  };
}

/** True when a copy still holds a hidden value somewhere. */
export const holdsHiddenText = (value: unknown): boolean => JSON.stringify(value ?? null).includes(CUSTOMER_HIDDEN_TEXT);
