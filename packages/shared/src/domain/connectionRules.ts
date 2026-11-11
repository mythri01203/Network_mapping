import type { ChangeSet } from '../model/api';
import type { NetworkSnapshot } from '../model/collections';
import type { Building, Customer, Equipment, JointClosure, Ont, Service } from '../model/types';
import { type CustomerPathFinding, newCustomerPathDisagreements } from './customerPath';
import type { FiberProblem } from './fiberRules';
import { buildOltPonPorts } from './oltConfig';

/**
 * Link checks for customers and connections (Phase 5): ONT records, services and buildings. The
 * browser commands and the server run the same rules. Errors are broken data and are refused;
 * warnings may be accepted, and the acceptance goes into the audit trail. A record kept only as
 * history (a removed ONT, an ended service) may name things that are gone, so it is not checked.
 */

export type ConnectionData = Pick<NetworkSnapshot, 'equipment' | 'cables' | 'splitters' | 'customers'> &
  Partial<Pick<NetworkSnapshot, 'onts' | 'services' | 'buildings'>> & {
    /** Phase 12: the splices, so a customer's path can be followed through closures. Without them a spliced path is not decided (never guessed). */
    closures?: readonly JointClosure[];
  };

export const isActiveCustomer = (c: Pick<Customer, 'status'>): boolean => c.status !== 'Disconnected';
export const isLiveOnt = (o: Pick<Ont, 'status'>): boolean => o.status !== 'removed';
export const isLiveService = (s: Pick<Service, 'status'>): boolean => s.status !== 'ended';

/** Serials compare without case or spaces, because labels are copied by hand. */
export const sameSerial = (a: string | undefined, b: string | undefined): boolean =>
  !!a && !!b && a.replace(/\s+/g, '').toLowerCase() === b.replace(/\s+/g, '').toLowerCase();

const ponPortsOf = (olt: Equipment) => olt.ponPorts ?? buildOltPonPorts(olt);

/** Active customers that use an ONT. */
export const customersOnOnt = (data: { customers: readonly Customer[] }, ontId: string): Customer[] =>
  data.customers.filter((c) => c.ontId === ontId && isActiveCustomer(c));

export function findConnectionProblems(data: ConnectionData): FiberProblem[] {
  const problems: FiberProblem[] = [];
  const error = (code: string, key: string, message: string, refs: string[]) => problems.push({ severity: 'error', code, key: `${code}:${key}`, message, refs });
  const warning = (code: string, key: string, message: string, refs: string[]) => problems.push({ severity: 'warning', code, key: `${code}:${key}`, message, refs });

  const equipment = new Map(data.equipment.map((e) => [e.id, e]));
  const cables = new Map(data.cables.map((c) => [c.id, c]));
  const splitters = new Map(data.splitters.map((s) => [s.id, s]));
  const customers = new Map(data.customers.map((c) => [c.id, c]));
  const onts = new Map((data.onts ?? []).map((o) => [o.id, o]));
  const buildings = new Map((data.buildings ?? []).map((b) => [b.id, b]));
  const ontName = (o: Ont) => `ONT ${o.serialNumber || o.id}`;

  // --- ONTs ------------------------------------------------------------------------------------
  const liveOnts = (data.onts ?? []).filter(isLiveOnt);
  for (const ont of liveOnts) {
    if (ont.oltId) {
      const olt = equipment.get(ont.oltId);
      if (!olt) error('ont_missing_olt', ont.id, `${ontName(ont)} names OLT ${ont.oltId}, which is not on record.`, [ont.id]);
      else if (ont.ponPortId && !ponPortsOf(olt).some((p) => p.id === ont.ponPortId)) {
        error('ont_missing_pon', ont.id, `${ontName(ont)} names port ${ont.ponPortId} on ${olt.name}, which has no such port.`, [ont.id, olt.id]);
      }
    } else if (ont.ponPortId) {
      error('ont_pon_without_olt', ont.id, `${ontName(ont)} names PON port ${ont.ponPortId} but no OLT.`, [ont.id]);
    }
    if (ont.splitterId) {
      const sp = splitters.get(ont.splitterId);
      const n = sp ? Number(sp.ratio.split(':')[1]) || 0 : 0;
      if (!sp) error('ont_missing_splitter', ont.id, `${ontName(ont)} names splitter ${ont.splitterId}, which is not on record.`, [ont.id]);
      else if (ont.splitterOutputPort !== undefined && n > 0 && ont.splitterOutputPort > n) {
        error('ont_splitter_port', ont.id, `${ontName(ont)} is on output ${ont.splitterOutputPort} of ${sp.name}, which has ${n} outputs.`, [ont.id, sp.id]);
      }
    }
    if (ont.dropCableId) {
      const cable = cables.get(ont.dropCableId);
      if (!cable) error('ont_missing_drop', ont.id, `${ontName(ont)} names drop cable ${ont.dropCableId}, which is not on record.`, [ont.id]);
      else if (ont.dropCore !== undefined && (ont.dropCore < 1 || ont.dropCore > cable.fiberCount)) {
        error('ont_missing_core', ont.id, `${ontName(ont)} names fiber ${ont.dropCore} of ${cable.name}, which has ${cable.fiberCount} fibers.`, [ont.id, cable.id]);
      }
    }
    const users = customersOnOnt(data, ont.id);
    if (ont.arrangement === 'single' && users.length > 1) {
      error(
        'ont_single_shared',
        ont.id,
        `${ontName(ont)} is recorded for one customer, but ${users.length} use it (${users.map((c) => c.name).join(', ')}). Mark it as shared, or move a customer to another ONT.`,
        [ont.id, ...users.map((c) => c.id)],
      );
    }
    // Physical link of the ONT against its customer's.
    const [customer] = users;
    if (customer && users.length === 1) {
      if (ont.dropCableId && customer.dropCableId && (ont.dropCableId !== customer.dropCableId || (ont.dropCore ?? 0) !== customer.fiberCore)) {
        warning(
          'ont_drop_mismatch',
          ont.id,
          `${ontName(ont)} is recorded on fiber ${ont.dropCore ?? '?'} of ${ont.dropCableId}, but ${customer.name} is on fiber ${customer.fiberCore} of ${customer.dropCableId}.`,
          [ont.id, customer.id],
        );
      }
      if (ont.splitterId && customer.splitterId && (ont.splitterId !== customer.splitterId || ont.splitterOutputPort !== customer.splitterOutputPort)) {
        warning(
          'ont_splitter_mismatch',
          ont.id,
          `${ontName(ont)} is recorded on output ${ont.splitterOutputPort ?? '?'} of ${ont.splitterId}, but ${customer.name} is on output ${customer.splitterOutputPort} of ${customer.splitterId}.`,
          [ont.id, customer.id],
        );
      }
    }
  }
  // Two live ONTs with one serial.
  const bySerial = new Map<string, Ont[]>();
  for (const ont of liveOnts) {
    if (!ont.serialNumber?.trim()) continue;
    const key = ont.serialNumber.replace(/\s+/g, '').toLowerCase();
    bySerial.set(key, [...(bySerial.get(key) ?? []), ont]);
  }
  for (const [key, list] of bySerial) {
    if (list.length > 1) {
      error('ont_serial_twice', key, `Serial ${list[0].serialNumber} is recorded on ${list.length} ONTs (${list.map((o) => o.id).join(', ')}). A serial belongs to one ONT.`, list.map((o) => o.id));
    }
  }

  // --- Customers -------------------------------------------------------------------------------
  for (const c of data.customers) {
    if (c.ontId) {
      const ont = onts.get(c.ontId);
      if (!ont) error('customer_missing_ont', c.id, `${c.name} names ONT ${c.ontId}, which is not on record.`, [c.id]);
      else if (!isLiveOnt(ont) && isActiveCustomer(c)) {
        error('customer_on_removed_ont', c.id, `${c.name} is on ONT ${ont.serialNumber || ont.id}, which was removed. Record the ONT that replaced it.`, [c.id, ont.id]);
      }
    }
    if (c.buildingId) {
      const b = buildings.get(c.buildingId);
      if (!b) error('customer_missing_building', c.id, `${c.name} names building ${c.buildingId}, which is not on record.`, [c.id]);
      else if (c.unitId && !b.units.some((u) => u.id === c.unitId)) {
        error('customer_missing_unit', c.id, `${c.name} names a unit that ${b.name} does not have.`, [c.id, b.id]);
      }
    } else if (c.unitId) {
      error('customer_unit_without_building', c.id, `${c.name} names a unit but no building.`, [c.id]);
    }
    if (!isActiveCustomer(c)) {
      const held = data.splitters.flatMap((s) => s.outputPorts.filter((p) => p.connectedCustomerId === c.id).map((p) => `output ${p.portNumber} of ${s.name}`));
      if (held.length > 0) {
        warning('disconnected_holds_port', c.id, `${c.name} is disconnected but still holds ${held.join(', ')}. Free the output so it can be reused.`, [c.id]);
      }
    }
  }

  // --- Services --------------------------------------------------------------------------------
  const activeKinds = new Map<string, Service[]>();
  for (const s of data.services ?? []) {
    const customer = customers.get(s.customerId);
    if (!customer) {
      error('service_missing_customer', s.id, `Service ${s.id} names customer ${s.customerId}, which is not on record.`, [s.id]);
      continue;
    }
    if (!isLiveService(s)) continue;
    if (s.ontId) {
      const ont = onts.get(s.ontId);
      if (!ont) error('service_missing_ont', s.id, `${customer.name}'s service ${s.id} names ONT ${s.ontId}, which is not on record.`, [s.id, customer.id]);
      else if (!isLiveOnt(ont)) warning('service_on_removed_ont', s.id, `${customer.name}'s service ${s.id} is on ONT ${ont.serialNumber || ont.id}, which was removed.`, [s.id, ont.id]);
      else if (customer.ontId !== ont.id) {
        warning('service_ont_not_customers', s.id, `${customer.name}'s service ${s.id} names ONT ${ont.serialNumber || ont.id}, which is not the customer's ONT.`, [s.id, customer.id]);
      }
    }
    if (!isActiveCustomer(customer) && (s.status === 'active' || s.status === 'suspended')) {
      warning('service_on_disconnected', s.id, `${customer.name} is disconnected, but service ${s.id} is still ${s.status}.`, [s.id, customer.id]);
    }
    if (s.status === 'active') {
      const key = `${s.customerId}/${s.kind}`;
      activeKinds.set(key, [...(activeKinds.get(key) ?? []), s]);
    }
  }
  for (const [key, list] of activeKinds) {
    if (list.length > 1) {
      const customer = customers.get(list[0].customerId);
      warning('service_kind_twice', key, `${customer?.name ?? list[0].customerId} has ${list.length} active ${list[0].kind} services (${list.map((s) => s.id).join(', ')}). Check one is not a duplicate.`, list.map((s) => s.id));
    }
  }

  // --- Buildings -------------------------------------------------------------------------------
  for (const b of data.buildings ?? []) {
    if (b.entryEquipmentId && !equipment.has(b.entryEquipmentId)) {
      error('building_missing_entry', b.id, `${b.name}: its entry point ${b.entryEquipmentId} is not on record.`, [b.id]);
    }
    if (b.riserCableId && !cables.has(b.riserCableId)) {
      error('building_missing_riser', b.id, `${b.name}: its riser cable ${b.riserCableId} is not on record.`, [b.id]);
    }
    const boxIds = new Set(b.floorBoxes.map((f) => f.id));
    for (const box of b.floorBoxes) {
      if (box.equipmentId && !equipment.has(box.equipmentId)) {
        error('building_missing_box_pin', `${b.id}/${box.id}`, `${b.name}: floor box ${box.label} names pin ${box.equipmentId}, which is not on record.`, [b.id]);
      }
      if (box.splitterId && !splitters.has(box.splitterId)) {
        error('building_missing_box_splitter', `${b.id}/${box.id}`, `${b.name}: floor box ${box.label} names splitter ${box.splitterId}, which is not on record.`, [b.id]);
      }
    }
    const labels = new Map<string, number>();
    for (const unit of b.units) {
      if (unit.floorBoxId && !boxIds.has(unit.floorBoxId)) {
        error('building_unit_missing_box', `${b.id}/${unit.id}`, `${b.name}: ${unit.label} names a floor box the building does not have.`, [b.id]);
      }
      const key = unit.label.trim().toLowerCase();
      labels.set(key, (labels.get(key) ?? 0) + 1);
    }
    for (const [label, count] of labels) {
      if (count > 1) warning('building_unit_twice', `${b.id}/${label}`, `${b.name} lists unit "${label}" ${count} times.`, [b.id]);
    }
    // A customer in a unit whose floor box holds a different splitter than the one they are on.
    for (const unit of b.units) {
      const box = b.floorBoxes.find((f) => f.id === unit.floorBoxId);
      if (!box?.splitterId) continue;
      for (const c of data.customers) {
        if (c.unitId !== unit.id || !isActiveCustomer(c) || !c.splitterId || c.splitterId === box.splitterId) continue;
        warning('unit_splitter_mismatch', `${b.id}/${unit.id}/${c.id}`, `${c.name} in ${unit.label} is on splitter ${c.splitterId}, but floor box ${box.label} holds ${box.splitterId}.`, [b.id, c.id]);
      }
    }
  }
  return problems;
}

export interface ConnectionChangeCheck {
  errors: FiberProblem[];
  warnings: FiberProblem[];
}

/** Problems a change adds. Problems already in the data are not blamed on it. */
export function newConnectionProblems(before: ConnectionData, after: ConnectionData): ConnectionChangeCheck {
  const old = new Set(findConnectionProblems(before).map((p) => p.key));
  const added = findConnectionProblems(after).filter((p) => !old.has(p.key));
  return { errors: added.filter((p) => p.severity === 'error'), warnings: added.filter((p) => p.severity === 'warning') };
}

const CONNECTION_CHECKED = ['equipment', 'cables', 'splitters', 'customers', 'onts', 'services', 'buildings'] as const;

/**
 * Whether a change set could add a connection problem: it writes an ONT, service or building, a
 * customer, or deletes equipment, a cable or a splitter that one of them may name.
 */
export function changeSetTouchesConnections(changes: ChangeSet): boolean {
  const writes = (['onts', 'services', 'buildings', 'customers'] as const).some(
    (name) => (changes.upserts?.[name]?.length ?? 0) > 0 || (changes.deletes?.[name]?.length ?? 0) > 0,
  );
  const deletesParents = (['equipment', 'cables', 'splitters'] as const).some((name) => (changes.deletes?.[name]?.length ?? 0) > 0);
  // Phase 12: a splitter output names its customer, which must agree with the fibre links.
  const writesOutputs = (changes.upserts?.splitters?.length ?? 0) > 0;
  return writes || deletesParents || writesOutputs;
}

/** Phase 12: a customer path or splitter owner that disagrees with the fibre links, as a refusal. */
export const customerPathProblem = (f: CustomerPathFinding): FiberProblem => ({
  severity: 'error',
  code: f.kind === 'customer_field' ? 'customer_path_mismatch' : 'splitter_owner_mismatch',
  key: f.key,
  message: `Broken data: ${f.message} Fix the links first, or use "Check customer paths" to take the fix from the links.`,
  refs: [f.customerId, ...(f.splitterId ? [f.splitterId] : [])],
});

/**
 * Phase 12: the customers and splitters this write stores whose path now disagrees with the fibre
 * links, and did not before. A disagreement already stored is not blamed (it is listed for a person
 * to fix), and a field the links do not decide is never checked.
 */
export function customerPathChangeErrors(before: ConnectionData, after: ConnectionData, written: { customerIds: ReadonlySet<string>; splitterIds: ReadonlySet<string> }): FiberProblem[] {
  const fiber = (d: ConnectionData) => ({ equipment: d.equipment, cables: d.cables, splitters: d.splitters, closures: d.closures ?? [], customers: d.customers });
  return newCustomerPathDisagreements(fiber(before), fiber(after), written).map(customerPathProblem);
}

/** Records in `after` that are not the same object as in `before`: what a browser command wrote. */
export function writtenIds<T extends { id: string }>(before: readonly T[], after: readonly T[]): Set<string> {
  const old = new Map(before.map((r) => [r.id, r]));
  return new Set(after.filter((r) => old.get(r.id) !== r).map((r) => r.id));
}

/** Errors a change set would add to the stored connection records. Used by the server before it writes. */
export function checkChangeSetConnections(current: ConnectionData, changes: ChangeSet): FiberProblem[] {
  const after: Record<string, { id: string }[]> = {};
  for (const name of CONNECTION_CHECKED) {
    const byId = new Map(((current[name] ?? []) as unknown as { id: string }[]).map((r) => [r.id, r]));
    for (const id of changes.deletes?.[name] ?? []) byId.delete(id);
    for (const record of (changes.upserts?.[name] ?? []) as { id: string }[]) byId.set(record.id, record);
    after[name] = [...byId.values()];
  }
  let closures = current.closures;
  if (closures && (changes.upserts?.closures?.length || changes.deletes?.closures?.length)) {
    const byId = new Map(closures.map((c) => [c.id, c]));
    for (const id of changes.deletes?.closures ?? []) byId.delete(id);
    for (const record of changes.upserts?.closures ?? []) byId.set(record.id, record);
    closures = [...byId.values()];
  }
  const next = { ...(after as unknown as ConnectionData), ...(closures ? { closures } : {}) };
  const errors = newConnectionProblems(current, next).errors;
  const written = {
    customerIds: new Set((changes.upserts?.customers ?? []).map((c) => c.id)),
    splitterIds: new Set((changes.upserts?.splitters ?? []).map((s) => s.id)),
  };
  return [...errors, ...customerPathChangeErrors(current, next, written)];
}

/**
 * Why an equipment pin or cable cannot be deleted yet: a building or a live ONT still names it.
 * Records kept as history (removed ONTs) do not hold anything.
 */
export function connectionUsesOf(data: Partial<Pick<ConnectionData, 'onts' | 'buildings'>>, id: string): string[] {
  const uses: string[] = [];
  for (const b of data.buildings ?? []) {
    if (b.entryEquipmentId === id) uses.push(`${b.name} uses it as its entry point`);
    if (b.riserCableId === id) uses.push(`${b.name} uses it as its riser`);
    for (const box of b.floorBoxes) if (box.equipmentId === id) uses.push(`${b.name} floor box ${box.label} is this pin`);
  }
  for (const o of (data.onts ?? []).filter(isLiveOnt)) {
    if (o.dropCableId === id) uses.push(`ONT ${o.serialNumber || o.id} is on it`);
    if (o.oltId === id) uses.push(`ONT ${o.serialNumber || o.id} is registered on it`);
  }
  return uses;
}

/** The building a customer is in, and their unit. */
export function buildingOf(data: Pick<ConnectionData, 'buildings'>, customer: Pick<Customer, 'buildingId' | 'unitId'>): { building?: Building; unit?: Building['units'][number] } {
  const building = customer.buildingId ? (data.buildings ?? []).find((b) => b.id === customer.buildingId) : undefined;
  return { building, unit: building?.units.find((u) => u.id === customer.unitId) };
}
