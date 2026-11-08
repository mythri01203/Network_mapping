import { DEFAULT_COLOR_SCHEMES } from '../fiber/colors';
import type { BuildingKind, OntArrangement, OntStatus, PonTechnology, ServiceKind, ServiceStatus } from '../model/enums';
import type {
  Building,
  BuildingFloorBox,
  BuildingUnit,
  Cable,
  CoreAssignment,
  Customer,
  CustomerConnection,
  Equipment,
  HistoryEntry,
  Ont,
  Service,
  Splitter,
  SplitterPort,
} from '../model/types';
import {
  applyPatch,
  type AuditEntry,
  type CommandContext,
  type CommandResult,
  fail,
  type NetworkData,
  type NetworkPatch,
  type Notice,
  notice,
  succeed,
} from './command';
import {
  type ConnectionData,
  customersOnOnt,
  isActiveCustomer,
  isLiveOnt,
  isLiveService,
  newConnectionProblems,
  sameSerial,
} from './connectionRules';
import { hasRecordedLocation, isValidCoordinate } from './defaults';
import { activeAssignment, completeCores } from './fiberCommands';
import { buildFiberIndex, describeCore, type FiberData, newFiberId, splitterCapacity } from './fiberIndex';
import { traceCustomerCores } from './fiberPath';
import { describeFiberProblems, newFiberProblems } from './fiberRules';
import { randomCode } from './fieldCapture';
import { buildOltPonPorts } from './oltConfig';
import { DEFAULT_OPTICAL_SETTINGS } from './opticalSettings';
import { setPortUsage } from './ports';
import { markServingCores } from './provisioning';
import { rxReadingOf } from './rxReading';
import { isoDate } from './time';

/**
 * Customers and connections (Phase 5): ONT records apart from customers, services, disconnect and
 * move, buildings with entry, riser, floor boxes and units. Nothing is deleted: a disconnect, a
 * move or an ONT swap keeps the old link as history with its reason. Each command checks its result
 * with the connection rules and the fiber rules, the same ones the server runs.
 */

export type ConnectionIdPrefix = 'ONT' | 'SVC' | 'BLD' | 'UNT' | 'FLB';
export const newConnectionId = (prefix: ConnectionIdPrefix): string => `${prefix}-${randomCode(10)}`;

const connectionDataOf = (data: NetworkData): ConnectionData => ({
  equipment: data.equipment,
  cables: data.cables,
  splitters: data.splitters,
  customers: data.customers,
  onts: data.onts ?? [],
  services: data.services ?? [],
  buildings: data.buildings ?? [],
});

const fiberDataOf = (data: NetworkData): FiberData => ({
  equipment: data.equipment,
  cables: data.cables,
  splitters: data.splitters,
  closures: data.closures,
  customers: data.customers,
});

/** Runs the connection and fiber rules on a proposed patch: errors refuse it, warnings ask first. */
export function checkedConnectionChange<T>(
  data: NetworkData,
  patch: NetworkPatch,
  value: T,
  extras: { notice: Notice; audit: AuditEntry[] },
  ctx: CommandContext = {},
): CommandResult<T> {
  const after = applyPatch(data, patch);
  const conn = newConnectionProblems(connectionDataOf(data), connectionDataOf(after));
  const fiber = newFiberProblems(fiberDataOf(data), fiberDataOf(after), { settings: ctx.optical ?? DEFAULT_OPTICAL_SETTINGS, schemes: ctx.schemes });
  const errors = [...conn.errors, ...fiber.errors];
  if (errors.length > 0) return fail('Not saved', `${describeFiberProblems(errors)} Nothing was saved.`);
  const warnings = [...conn.warnings, ...fiber.warnings];
  if (warnings.length === 0) return succeed(value, patch, extras);
  const first = extras.audit[0];
  return succeed(value, patch, {
    notice: extras.notice,
    audit: [
      ...extras.audit,
      {
        action: 'WARNING_ACCEPTED',
        details: `Saved after the warning: ${warnings.map((w) => w.message).join(' ')}`,
        assetId: first?.assetId ?? 'connection',
        assetType: first?.assetType ?? 'System',
      },
    ],
    confirm: `Please check: ${warnings.map((w) => w.message).join(' ')} Save anyway?`,
  });
}

const line = (action: string, details: string, ctx: CommandContext): HistoryEntry => ({
  at: (ctx.now ?? new Date()).toISOString(),
  ...(ctx.actor ? { by: ctx.actor } : {}),
  action,
  details: details.slice(0, 500),
});

const nowIso = (ctx: CommandContext) => (ctx.now ?? new Date()).toISOString();
const clean = (value: string | undefined) => value?.trim() || undefined;
const replace = <T extends { id: string }>(list: readonly T[], item: T): T[] => {
  const found = list.some((x) => x.id === item.id);
  return found ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item];
};

/* ------------------------------------------------------------------ */
/* ONT records                                                         */
/* ------------------------------------------------------------------ */

/** How to show a customer's ONT: its record, or the serial still embedded in the customer record. */
export interface OntView {
  record?: Ont;
  serialNumber?: string;
  vendor?: string;
  model?: string;
  source: 'ont_record' | 'customer_record' | 'none';
}

export function ontOfCustomer(data: Pick<NetworkData, 'onts'>, customer: Customer): OntView {
  const record = customer.ontId ? (data.onts ?? []).find((o) => o.id === customer.ontId) : undefined;
  if (record) return { record, serialNumber: record.serialNumber, vendor: record.vendor, model: record.model, source: 'ont_record' };
  if (customer.ontSerialNumber?.trim()) return { serialNumber: customer.ontSerialNumber, source: 'customer_record' };
  return { source: 'none' };
}

export interface OntDraft {
  serialNumber?: string;
  vendor?: string;
  model?: string;
  technology?: PonTechnology;
  firmware?: string;
  arrangement?: OntArrangement;
  onuAddress?: string;
  notes?: string;
}

/** Why a serial cannot be used: another live ONT or another customer's embedded serial has it. */
function serialTaken(data: NetworkData, serial: string | undefined, except: { ontIds?: string[]; customerIds?: string[] } = {}): string | undefined {
  if (!serial?.trim()) return undefined;
  const ont = (data.onts ?? []).find((o) => isLiveOnt(o) && !except.ontIds?.includes(o.id) && sameSerial(o.serialNumber, serial));
  if (ont) return `Serial ${serial.trim()} is already on ONT ${ont.id}${customersOnOnt(data, ont.id).length ? ` (${customersOnOnt(data, ont.id).map((c) => c.name).join(', ')})` : ''}.`;
  const customer = data.customers.find((c) => isActiveCustomer(c) && !c.ontId && !except.customerIds?.includes(c.id) && sameSerial(c.ontSerialNumber, serial));
  if (customer) return `Serial ${serial.trim()} is already recorded for ${customer.name} (${customer.id}).`;
  return undefined;
}

/** The physical link a customer's record gives, keeping only parts that exist. */
function linkFromCustomer(data: NetworkData, customer: Customer): Partial<Ont> {
  const olt = data.equipment.find((e) => e.id === customer.oltId && e.type === 'OLT');
  const pon = olt ? (olt.ponPorts ?? buildOltPonPorts(olt)).find((p) => p.id === customer.ponPort) : undefined;
  const splitter = data.splitters.find((s) => s.id === customer.splitterId);
  const drop = data.cables.find((c) => c.id === customer.dropCableId);
  return {
    ...(olt ? { oltId: olt.id } : {}),
    ...(olt && pon ? { ponPortId: pon.id } : {}),
    ...(splitter ? { splitterId: splitter.id } : {}),
    ...(splitter && customer.splitterOutputPort > 0 && customer.splitterOutputPort <= splitterCapacity(splitter) ? { splitterOutputPort: customer.splitterOutputPort } : {}),
    ...(drop ? { dropCableId: drop.id } : {}),
    ...(drop && customer.fiberCore > 0 && customer.fiberCore <= drop.fiberCount ? { dropCore: customer.fiberCore } : {}),
  };
}

const withoutLink = (ont: Ont): Ont => {
  const { oltId: _o, ponPortId: _p, splitterId: _s, splitterOutputPort: _n, dropCableId: _d, dropCore: _c, ...rest } = ont;
  return rest;
};
const linkText = (o: Partial<Ont>) =>
  [o.oltId && `${o.oltId} ${o.ponPortId ?? ''}`.trim(), o.splitterId && `${o.splitterId} output ${o.splitterOutputPort ?? '?'}`, o.dropCableId && `${o.dropCableId} fiber ${o.dropCore ?? '?'}`]
    .filter(Boolean)
    .join(', ') || 'no link';

function buildOnt(draft: OntDraft, ctx: CommandContext, base: Partial<Ont> = {}): Ont {
  return {
    id: newConnectionId('ONT'),
    arrangement: draft.arrangement ?? 'single',
    status: 'in_stock',
    statusSource: 'person',
    statusAt: nowIso(ctx),
    createdAt: nowIso(ctx),
    ...(ctx.actor ? { createdBy: ctx.actor } : {}),
    ...base,
    ...(clean(draft.serialNumber) ? { serialNumber: clean(draft.serialNumber) } : {}),
    ...(clean(draft.vendor) ? { vendor: clean(draft.vendor) } : {}),
    ...(clean(draft.model) ? { model: clean(draft.model) } : {}),
    ...(draft.technology ? { technology: draft.technology } : {}),
    ...(clean(draft.firmware) ? { firmware: clean(draft.firmware) } : {}),
    ...(clean(draft.onuAddress) ? { onuAddress: clean(draft.onuAddress) } : {}),
    ...(clean(draft.notes) ? { notes: clean(draft.notes) } : {}),
  };
}

/** Adds an ONT record, such as one in stock. The serial is kept exactly as entered. */
export function createOnt(data: NetworkData, draft: OntDraft, ctx: CommandContext = {}): CommandResult<Ont> {
  const taken = serialTaken(data, draft.serialNumber);
  if (taken) return fail('Serial in use', `${taken} Check the label on the ONT.`);
  const ont = { ...buildOnt(draft, ctx), history: [line('CREATED', `Added${draft.serialNumber?.trim() ? ` with serial ${draft.serialNumber.trim()}` : ' with no serial recorded'}`, ctx)] };
  return checkedConnectionChange(data, { onts: [...(data.onts ?? []), ont] }, ont, {
    notice: notice('success', 'ONT added', `ONT ${ont.serialNumber ?? '(serial not recorded)'} saved as ${ont.status === 'in_stock' ? 'in stock' : ont.status}.`),
    audit: [{ action: 'ONT_CREATED', details: `${ont.id}${ont.serialNumber ? ` serial ${ont.serialNumber}` : ''}`, assetId: ont.id, assetType: 'ONT' }],
  }, ctx);
}

/** Saves what a person recorded about an ONT. Its customers' displayed serial follows the record. */
export function saveOntDetails(data: NetworkData, ontId: string, draft: OntDraft, ctx: CommandContext = {}): CommandResult<Ont> {
  const ont = (data.onts ?? []).find((o) => o.id === ontId);
  if (!ont) return fail('ONT missing', `ONT ${ontId} was not found.`);
  if (!isLiveOnt(ont)) return fail('ONT is history', 'This ONT was removed. Its record is kept as history and is not edited.');
  const users = customersOnOnt(data, ont.id);
  const taken = serialTaken(data, draft.serialNumber, { ontIds: [ont.id], customerIds: users.map((c) => c.id) });
  if (taken) return fail('Serial in use', `${taken} Check the label on the ONT.`);
  const changed: string[] = [];
  const next: Ont = { ...ont };
  for (const key of ['serialNumber', 'vendor', 'model', 'firmware', 'onuAddress', 'notes'] as const) {
    if (!(key in draft)) continue;
    const value = clean(draft[key]);
    if (value !== ont[key]) changed.push(key);
    if (value) next[key] = value;
    else delete next[key];
  }
  if (draft.technology !== undefined && draft.technology !== ont.technology) {
    next.technology = draft.technology;
    changed.push('technology');
  }
  if (draft.arrangement && draft.arrangement !== ont.arrangement) {
    next.arrangement = draft.arrangement;
    changed.push('arrangement');
  }
  if (changed.length === 0) return fail('Nothing changed', 'No ONT detail was changed.', 'info');
  next.history = [...(ont.history ?? []), line('DETAILS_SAVED', changed.join(', '), ctx)];
  const customers = changed.includes('serialNumber')
    ? data.customers.map((c) => (c.ontId === ont.id ? { ...c, ontSerialNumber: next.serialNumber ?? '' } : c))
    : undefined;
  return checkedConnectionChange(data, { onts: replace(data.onts ?? [], next), ...(customers ? { customers } : {}) }, next, {
    notice: notice('success', 'ONT saved', `ONT ${next.serialNumber ?? next.id}: ${changed.join(', ')} saved.`),
    audit: [{ action: 'ONT_UPDATED', details: `${ont.id}: ${changed.join(', ')}`, assetId: ont.id, assetType: 'ONT' }],
  }, ctx);
}

/** Marks an ONT faulty, installed or back in stock, as a person found it. Not a device report. */
export function setOntStatus(data: NetworkData, ontId: string, status: Exclude<OntStatus, 'removed'>, note: string, ctx: CommandContext = {}): CommandResult<Ont> {
  const ont = (data.onts ?? []).find((o) => o.id === ontId);
  if (!ont) return fail('ONT missing', `ONT ${ontId} was not found.`);
  if (!isLiveOnt(ont)) return fail('ONT is history', 'This ONT was removed and is kept as history.');
  if (ont.status === status) return fail('Nothing changed', 'The ONT already has that status.', 'info');
  if (status === 'in_stock' && customersOnOnt(data, ont.id).length > 0) return fail('Still in use', 'Move its customers to another ONT first.');
  const next: Ont = { ...ont, status, statusSource: 'person', statusAt: nowIso(ctx), history: [...(ont.history ?? []), line('STATUS', `${ont.status} → ${status}${note.trim() ? `: ${note.trim()}` : ''}`, ctx)] };
  return checkedConnectionChange(data, { onts: replace(data.onts ?? [], next) }, next, {
    notice: notice('success', 'ONT status saved', `ONT ${ont.serialNumber ?? ont.id} is now recorded as ${status.replace('_', ' ')}.`),
    audit: [{ action: 'ONT_STATUS', details: `${ont.id}: ${ont.status} → ${status}${note.trim() ? ` (${note.trim()})` : ''}`, assetId: ont.id, assetType: 'ONT' }],
  }, ctx);
}

/** An ONT record made from the serial embedded in an older customer record. */
function adoptedOnt(data: NetworkData, customer: Customer, ctx: CommandContext): Ont {
  return {
    ...buildOnt({ serialNumber: customer.ontSerialNumber }, ctx, linkFromCustomer(data, customer)),
    status: isActiveCustomer(customer) ? 'installed' : 'in_stock',
    statusSource: 'customer_record',
    history: [line('CREATED', `Made from ${customer.id}'s record${customer.ontSerialNumber ? ` (serial ${customer.ontSerialNumber} as it was written there)` : ' (no serial was recorded)'}`, ctx)],
  };
}

/**
 * Makes an ONT record for a customer whose ONT exists only as fields in their own record. Nothing is
 * guessed: vendor and model stay blank, and only links that exist are copied.
 */
export function adoptCustomerOnt(data: NetworkData, customerId: string, ctx: CommandContext = {}): CommandResult<Ont> {
  const customer = data.customers.find((c) => c.id === customerId);
  if (!customer) return fail('Customer Missing', `Customer ${customerId} was not found.`);
  if (customer.ontId) return fail('Already has an ONT record', `${customer.name} already uses ONT ${customer.ontId}.`, 'info');
  const taken = serialTaken(data, customer.ontSerialNumber, { customerIds: [customer.id] });
  if (taken) return fail('Serial in use', `${taken} Check the label on the ONT before making a record.`);
  const ont = adoptedOnt(data, customer, ctx);
  const updated: Customer = { ...customer, ontId: ont.id, history: [...(customer.history ?? []), line('ONT_RECORD', `ONT record ${ont.id} made from this record`, ctx)] };
  return checkedConnectionChange(data, { onts: [...(data.onts ?? []), ont], customers: replace(data.customers, updated) }, ont, {
    notice: notice('success', 'ONT record made', `${customer.name}: ONT ${ont.serialNumber ?? '(serial not recorded)'} now has its own record. Add the vendor and model from the label.`),
    audit: [{ action: 'ONT_RECORD_MADE', details: `${ont.id} from customer ${customer.id}`, assetId: ont.id, assetType: 'ONT' }],
  }, ctx);
}

const moveServices = (services: readonly Service[], fromOntId: string | undefined, toOntId: string, ctx: CommandContext, why: string): { services: Service[]; moved: number } => {
  let moved = 0;
  const next = services.map((s) => {
    if (!fromOntId || s.ontId !== fromOntId || !isLiveService(s)) return s;
    moved += 1;
    return { ...s, ontId: toOntId, history: [...(s.history ?? []), line('ONT_CHANGED', `${fromOntId} → ${toOntId}: ${why}`, ctx)] };
  });
  return { services: next, moved };
};

/** Moves a customer to another ONT record. A one-customer ONT that already serves someone is refused. */
export function attachCustomerToOnt(data: NetworkData, customerId: string, ontId: string, reason: string, ctx: CommandContext = {}): CommandResult<Customer> {
  const customer = data.customers.find((c) => c.id === customerId);
  if (!customer) return fail('Customer Missing', `Customer ${customerId} was not found.`);
  if (!isActiveCustomer(customer)) return fail('Customer disconnected', `${customer.name} is disconnected. Reconnect them first.`);
  const ont = (data.onts ?? []).find((o) => o.id === ontId);
  if (!ont) return fail('ONT missing', `ONT ${ontId} was not found.`);
  if (!isLiveOnt(ont)) return fail('ONT is history', `ONT ${ont.serialNumber ?? ont.id} was removed. Choose an ONT in stock or in use.`);
  if (customer.ontId === ont.id) return fail('Already on this ONT', `${customer.name} already uses this ONT.`, 'info');
  const others = customersOnOnt(data, ont.id).filter((c) => c.id !== customer.id);
  if (ont.arrangement === 'single' && others.length > 0) {
    return fail('ONT in use', `ONT ${ont.serialNumber ?? ont.id} already serves ${others.map((c) => c.name).join(', ')}, and it is recorded for one customer. Choose another ONT, or record it as shared (MDU) first.`);
  }
  const why = reason.trim() || 'moved to another ONT';
  let onts = data.onts ?? [];
  const old = customer.ontId ? onts.find((o) => o.id === customer.ontId) : undefined;
  if (old && customersOnOnt(data, old.id).filter((c) => c.id !== customer.id).length === 0) {
    onts = replace(onts, { ...withoutLink(old), status: 'in_stock', statusSource: 'person', statusAt: nowIso(ctx), history: [...(old.history ?? []), line('UNLINKED', `${customer.id} moved to ${ont.id} (${why}); was on ${linkText(old)}`, ctx)] });
  }
  const hasLink = !!(ont.splitterId || ont.dropCableId);
  const nextOnt: Ont = {
    ...ont,
    ...(hasLink ? {} : linkFromCustomer(data, customer)),
    status: 'installed',
    statusSource: 'person',
    statusAt: nowIso(ctx),
    history: [...(ont.history ?? []), line('LINKED', `Now used by ${customer.id} (${why})`, ctx)],
  };
  onts = replace(onts, nextOnt);
  const legacy = !old && customer.ontSerialNumber ? ` Serial ${customer.ontSerialNumber} written on the customer record is kept in its history.` : '';
  const updated: Customer = {
    ...customer,
    ontId: ont.id,
    ontSerialNumber: ont.serialNumber ?? '',
    history: [...(customer.history ?? []), line('ONT_CHANGED', `${old?.id ?? (customer.ontSerialNumber ? `serial ${customer.ontSerialNumber}` : 'no ONT')} → ${ont.id}: ${why}`, ctx)],
  };
  const { services, moved } = moveServices(data.services ?? [], old?.id, ont.id, ctx, why);
  return checkedConnectionChange(data, { onts, customers: replace(data.customers, updated), ...(moved ? { services } : {}) }, updated, {
    notice: notice('success', 'ONT changed', `${customer.name} now uses ONT ${ont.serialNumber ?? ont.id}.${moved ? ` ${moved} service(s) moved with them.` : ''}${legacy}`),
    audit: [{ action: 'CUSTOMER_ONT_CHANGED', details: `${customer.id}: ${old?.id ?? 'none'} → ${ont.id} (${why})`, assetId: customer.id, assetType: 'Customer' }],
  }, ctx);
}

/**
 * Swaps a customer's ONT for a new one, such as after a fault. The old ONT is kept as a removed
 * record with the reason and what replaced it; everything that used it moves to the new one.
 */
export function swapOnt(data: NetworkData, customerId: string, draft: OntDraft, reason: string, ctx: CommandContext = {}): CommandResult<Ont> {
  const customer = data.customers.find((c) => c.id === customerId);
  if (!customer) return fail('Customer Missing', `Customer ${customerId} was not found.`);
  if (!isActiveCustomer(customer)) return fail('Customer disconnected', `${customer.name} is disconnected, so there is no ONT to swap.`);
  if (!reason.trim()) return fail('Say why', 'Write why the ONT is being replaced, such as "No light, power LED off".');
  const existing = customer.ontId ? (data.onts ?? []).find((o) => o.id === customer.ontId) : undefined;
  if (customer.ontId && !existing) return fail('ONT missing', `ONT ${customer.ontId} was not found.`);
  if (existing && !isLiveOnt(existing)) return fail('ONT is history', 'That ONT was already removed.');
  const old = existing ?? adoptedOnt(data, customer, ctx);
  const users = existing ? customersOnOnt(data, existing.id) : [customer];
  const taken = serialTaken(data, draft.serialNumber, { ontIds: [old.id], customerIds: users.map((c) => c.id) });
  if (taken) return fail('Serial in use', `${taken} Check the label on the new ONT.`);
  if (draft.serialNumber?.trim() && sameSerial(draft.serialNumber, old.serialNumber)) {
    return fail('Same serial', 'The new ONT has the same serial as the old one. Check the label on the new ONT.');
  }
  const { oltId, ponPortId, splitterId, splitterOutputPort, dropCableId, dropCore } = old;
  const next = buildOnt({ arrangement: old.arrangement, technology: old.technology, ...draft }, ctx, {
    ...(oltId ? { oltId } : {}),
    ...(ponPortId ? { ponPortId } : {}),
    ...(splitterId ? { splitterId } : {}),
    ...(splitterOutputPort ? { splitterOutputPort } : {}),
    ...(dropCableId ? { dropCableId } : {}),
    ...(dropCore ? { dropCore } : {}),
  });
  const fresh: Ont = { ...next, status: 'installed', history: [line('INSTALLED', `Replaced ONT ${old.serialNumber ?? old.id} for ${users.map((c) => c.id).join(', ')}: ${reason.trim()}`, ctx)] };
  const removed: Ont = {
    ...old,
    status: 'removed',
    statusSource: 'person',
    statusAt: nowIso(ctx),
    removedAt: nowIso(ctx),
    removedReason: reason.trim(),
    replacedByOntId: fresh.id,
    history: [...(old.history ?? []), line('REMOVED', `Replaced by ${fresh.id}${fresh.serialNumber ? ` (${fresh.serialNumber})` : ''}: ${reason.trim()}`, ctx)],
  };
  const onts = replace(replace(data.onts ?? [], removed), fresh);
  const userIds = new Set(users.map((c) => c.id));
  const customers = data.customers.map((c) =>
    userIds.has(c.id)
      ? { ...c, ontId: fresh.id, ontSerialNumber: fresh.serialNumber ?? '', history: [...(c.history ?? []), line('ONT_SWAPPED', `${old.serialNumber ?? old.id} → ${fresh.serialNumber ?? fresh.id}: ${reason.trim()}`, ctx)] }
      : c,
  );
  const { services, moved } = moveServices(data.services ?? [], old.id, fresh.id, ctx, `ONT swapped: ${reason.trim()}`);
  return checkedConnectionChange(data, { onts, customers, ...(moved ? { services } : {}) }, fresh, {
    notice: notice('success', 'ONT swapped', `${customer.name}: ONT ${old.serialNumber ?? '(no serial)'} replaced by ${fresh.serialNumber ?? '(serial not recorded)'}. The old one is kept as history.${moved ? ` ${moved} service(s) moved.` : ''}`),
    audit: [{ action: 'ONT_SWAPPED', details: `${customer.id}: ${old.id} → ${fresh.id} (${reason.trim()})`, assetId: fresh.id, assetType: 'ONT' }],
  }, ctx);
}

/* ------------------------------------------------------------------ */
/* Disconnect and move                                                 */
/* ------------------------------------------------------------------ */

const outputHeldBy = (port: SplitterPort, customer: Customer) =>
  port.connectedCustomerId === customer.id ||
  (!port.connectedCustomerId && !!customer.dropCableId && port.connectedDropCableId === customer.dropCableId && port.connectedCore === customer.fiberCore);

/** Frees every splitter output this customer holds, with a history line on each. */
function freeCustomerOutputs(splitters: readonly Splitter[], customer: Customer, why: string, ctx: CommandContext): { splitters: Splitter[]; freed: string[] } {
  const freed: string[] = [];
  const next = splitters.map((s) => {
    if (!s.outputPorts.some((p) => outputHeldBy(p, customer))) return s;
    return {
      ...s,
      outputPorts: s.outputPorts.map((p): SplitterPort => {
        if (!outputHeldBy(p, customer)) return p;
        freed.push(`${s.id} output ${p.portNumber}`);
        const { connectedCustomerId: _c, connectedCustomerName: _n, connectedDropCableId: _d, connectedCore: _k, connectedEquipmentId: _e, connectedAt: _a, ...rest } = p;
        return {
          ...rest,
          status: p.status === 'Faulty' ? 'Faulty' : 'Available',
          history: [...(p.history ?? []), line('OUTPUT_FREED', `Freed from ${customer.id} (was ${p.connectedDropCableId ?? 'no fiber'} fiber ${p.connectedCore ?? '?'}): ${why}`, ctx)],
        };
      }),
    };
  });
  return { splitters: next, freed };
}

/** Releases the drop fiber given to this customer. A fiber given to someone else is left alone. */
function releaseCustomerFiber(cables: readonly Cable[], customer: Customer, cableId: string, core: number, why: string, ctx: CommandContext): { cables: Cable[]; released?: string; note?: string } {
  const cable = cables.find((c) => c.id === cableId);
  if (!cable || core < 1 || core > cable.fiberCount) return { cables: [...cables] };
  const record = completeCores(cable).find((k) => k.coreNumber === core)!;
  const active = activeAssignment(record);
  const ours = active ? active.customerId === customer.id || (!active.customerId && record.customerId === customer.id) : record.status === 'In Use' && record.customerId === customer.id;
  if (!ours) {
    return { cables: [...cables], note: active ? `fiber ${core} of ${cable.name} is recorded for ${active.use}, so it was left as it is` : undefined };
  }
  const at = nowIso(ctx);
  const updated: Cable = {
    ...cable,
    cores: completeCores(cable).map((k) => {
      if (k.coreNumber !== core) return k;
      const { customerId: _c, customerName: _n, connectedToEquipmentId: _e, connectedPort: _p, ...rest } = k;
      return {
        ...rest,
        status: 'Available' as const,
        assignments: (k.assignments ?? []).map((a) => (a.releasedAt ? a : { ...a, releasedAt: at, ...(ctx.actor ? { releasedBy: ctx.actor } : {}), releaseReason: why.slice(0, 300) })),
      };
    }),
  };
  return { cables: cables.map((c) => (c.id === cable.id ? updated : c)), released: `${cable.id} fiber ${core}` };
}

/** Gives a drop fiber to a customer. A fiber already in use or damaged is refused. */
function giveCustomerFiber(cables: readonly Cable[], customer: Customer, cableId: string, core: number, source: string, ctx: CommandContext): { cables: Cable[] } | string {
  const cable = cables.find((c) => c.id === cableId);
  if (!cable) return `Cable ${cableId} is not on record.`;
  if (!Number.isInteger(core) || core < 1 || core > cable.fiberCount) return `${cable.name} has ${cable.fiberCount} fibers, so fiber ${core} does not exist.`;
  const record = completeCores(cable).find((k) => k.coreNumber === core)!;
  const label = describeCore({ cables: new Map([[cable.id, cable]]), schemes: ctx.schemes ?? DEFAULT_COLOR_SCHEMES }, cable.id, core);
  const active = activeAssignment(record);
  if (active && active.customerId !== customer.id) return `${label[0].toUpperCase()}${label.slice(1)} is already ${active.kind === 'reserved' ? 'reserved' : 'in use'} for ${active.use}. Choose a free fiber.`;
  if (!active && record.status === 'In Use' && record.customerId !== customer.id) return `${label[0].toUpperCase()}${label.slice(1)} is marked In Use${record.customerId ? ` for ${record.customerId}` : ''}. Choose a free fiber.`;
  if (record.status === 'Damaged') return `${label[0].toUpperCase()}${label.slice(1)} is marked damaged.`;
  if (active) return { cables: [...cables] };
  const assignment: CoreAssignment = {
    id: newFiberId('CA'),
    kind: 'in_use',
    use: `Customer ${customer.id}`,
    source,
    destination: `ONT of ${customer.name}`,
    customerId: customer.id,
    effectiveFrom: isoDate(ctx.now),
    createdAt: nowIso(ctx),
    ...(ctx.actor ? { createdBy: ctx.actor } : {}),
  };
  const updated: Cable = {
    ...cable,
    cores: completeCores(cable).map((k) =>
      k.coreNumber === core ? { ...k, status: 'In Use' as const, customerId: customer.id, customerName: customer.name, assignments: [...(k.assignments ?? []), assignment] } : k,
    ),
  };
  return { cables: cables.map((c) => (c.id === cable.id ? updated : c)) };
}

/** Frees the access box port the customer held, and lowers the PON port's customer count. */
function releaseBoxAndPon(equipment: readonly Equipment[], customer: Customer): Equipment[] {
  return equipment.map((e) => {
    let next = e;
    if (e.id === customer.terminalBoxId && e.logicalPorts?.some((p) => p.customerId === customer.id)) next = setPortUsage(next, undefined, false, customer.id);
    if (e.id === customer.oltId && customer.ponPort && next.ponPorts?.some((p) => p.id === customer.ponPort)) {
      next = { ...next, ponPorts: next.ponPorts!.map((p) => (p.id === customer.ponPort ? { ...p, connectedCustomersCount: Math.max(0, p.connectedCustomersCount - 1) } : p)) };
    }
    return next;
  });
}

const connectionOf = (customer: Customer, kind: CustomerConnection['kind'], reason: string, ctx: CommandContext, ont?: Ont): CustomerConnection => ({
  kind,
  at: nowIso(ctx),
  ...(ctx.actor ? { by: ctx.actor } : {}),
  reason: reason.slice(0, 300),
  ...(customer.oltId ? { oltId: customer.oltId } : {}),
  ...(customer.ponPort ? { ponPort: customer.ponPort } : {}),
  ...(customer.terminalBoxId ? { terminalBoxId: customer.terminalBoxId } : {}),
  ...(customer.splitterId ? { splitterId: customer.splitterId } : {}),
  ...(customer.splitterOutputPort ? { splitterOutputPort: customer.splitterOutputPort } : {}),
  ...(customer.dropCableId ? { dropCableId: customer.dropCableId } : {}),
  ...(customer.fiberCore ? { fiberCore: customer.fiberCore } : {}),
  ...(customer.ontId ? { ontId: customer.ontId } : {}),
  ...(ont?.serialNumber || customer.ontSerialNumber ? { ontSerialNumber: ont?.serialNumber ?? customer.ontSerialNumber } : {}),
});

const NO_LINK = { oltId: '', ponPort: '', feederCableId: '', distributionCableId: '', terminalBoxId: '', splitterId: '', splitterOutputPort: 0, dropCableId: '', fiberCore: 0 } as const;

/**
 * Disconnects a customer. Their drop fiber, splitter output, box port and ONT link are released with
 * the reason; their services end; the old connection stays in the customer's history. The drop
 * cable record stays, because the cable is still on the street.
 */
export function disconnectCustomer(data: NetworkData, customerId: string, reason: string, ctx: CommandContext = {}): CommandResult<Customer> {
  const customer = data.customers.find((c) => c.id === customerId);
  if (!customer) return fail('Customer Missing', `Customer ${customerId} was not found.`);
  if (!isActiveCustomer(customer)) return fail('Already disconnected', `${customer.name} is already disconnected.`, 'info');
  const why = reason.trim();
  if (!why) return fail('Say why', 'Write why the customer is disconnected, such as "Moved away" or "Not paid".');
  const text = `Customer ${customer.id} disconnected: ${why}`;

  const fiber = customer.dropCableId && customer.fiberCore ? releaseCustomerFiber(data.cables, customer, customer.dropCableId, customer.fiberCore, text, ctx) : { cables: data.cables };
  const outputs = freeCustomerOutputs(data.splitters, customer, text, ctx);
  const equipment = releaseBoxAndPon(data.equipment, customer);

  const ont = customer.ontId ? (data.onts ?? []).find((o) => o.id === customer.ontId) : undefined;
  let onts = data.onts;
  let ontNote = '';
  if (ont && isLiveOnt(ont)) {
    const others = customersOnOnt(data, ont.id).filter((c) => c.id !== customer.id);
    if (others.length === 0) {
      onts = replace(data.onts ?? [], { ...withoutLink(ont), status: 'in_stock', statusSource: 'person', statusAt: nowIso(ctx), history: [...(ont.history ?? []), line('UNLINKED', `${text}; was on ${linkText(ont)}`, ctx)] });
      ontNote = ` ONT ${ont.serialNumber ?? ont.id} is back in stock.`;
    } else {
      onts = replace(data.onts ?? [], { ...ont, history: [...(ont.history ?? []), line('CUSTOMER_LEFT', text, ctx)] });
      ontNote = ` ONT ${ont.serialNumber ?? ont.id} still serves ${others.map((c) => c.name).join(', ')}.`;
    }
  }
  let ended = 0;
  const services = (data.services ?? []).map((s) => {
    if (s.customerId !== customer.id || !isLiveService(s)) return s;
    ended += 1;
    return { ...s, status: 'ended' as ServiceStatus, endedAt: nowIso(ctx), endReason: `Customer disconnected: ${why}`.slice(0, 300), history: [...(s.history ?? []), line('ENDED', `Customer disconnected: ${why}`, ctx)] };
  });

  // The reading belonged to the connection that is now released: keep it in the history line only.
  const reading = rxReadingOf(customer, ctx.optical);
  const { ontId: _ont, rxOpticalPowerDbm: _rx, rxSource: _rs, rxMeasuredAt: _rm, rxLaunchDbm: _rl, rxPhotoId: _rp, rxCaptureId: _rc, ...rest } = customer;
  const updated: Customer = {
    ...rest,
    ...NO_LINK,
    status: 'Disconnected',
    disconnectedAt: nowIso(ctx),
    disconnectReason: why.slice(0, 300),
    connectionHistory: [...(customer.connectionHistory ?? []), connectionOf(customer, 'disconnected', why, ctx, ont)],
    history: [...(customer.history ?? []), line('DISCONNECTED', `${why}${reading.valueDbm !== undefined ? `. Last reading ${reading.text}` : ''}`, ctx)],
  };
  const released = [fiber.released, ...outputs.freed].filter(Boolean);
  return checkedConnectionChange(
    data,
    {
      customers: replace(data.customers, updated),
      cables: fiber.cables,
      splitters: outputs.splitters,
      equipment,
      ...(onts !== data.onts ? { onts } : {}),
      ...(ended ? { services } : {}),
    },
    updated,
    {
      notice: notice(
        'success',
        'Customer disconnected',
        `${customer.name} is disconnected. Released: ${released.length ? released.join(', ') : 'nothing was recorded on a fiber or output'}.${ontNote}${ended ? ` ${ended} service(s) ended.` : ''}${fiber.note ? ` Note: ${fiber.note}.` : ''} The old connection is kept in the history.`,
      ),
      audit: [{ action: 'CUSTOMER_DISCONNECTED', details: `${customer.id}: ${why}; released ${released.join(', ') || 'nothing'}`, assetId: customer.id, assetType: 'Customer' }],
    },
    ctx,
  );
}

export interface MoveTarget {
  splitterId: string;
  port: number;
  /** The drop fiber to use. Without it the customer's own drop is re-plugged in the same box. */
  drop?: { cableId: string; core: number };
}

/**
 * Moves a customer to another splitter output, or reconnects a disconnected one. The old output and
 * fiber are released with the reason, the new ones are checked first: an output or fiber already
 * used by someone else is refused. The OLT link is worked out again from the recorded fibers; when
 * they do not reach a PON port, the customer shows as not linked and the gap is named.
 */
export function moveCustomer(data: NetworkData, customerId: string, target: MoveTarget, reason: string, ctx: CommandContext = {}): CommandResult<Customer> {
  const customer = data.customers.find((c) => c.id === customerId);
  if (!customer) return fail('Customer Missing', `Customer ${customerId} was not found.`);
  const why = reason.trim();
  if (!why) return fail('Say why', 'Write why the customer is moved, such as "Output 3 faulty".');
  const reconnect = !isActiveCustomer(customer);
  const last = reconnect ? customer.connectionHistory?.at(-1) : undefined;

  const splitter = data.splitters.find((s) => s.id === target.splitterId);
  if (!splitter) return fail('Splitter Missing', `Splitter ${target.splitterId} was not found.`);
  if (splitter.status === 'Faulty') return fail('Splitter Faulty', `${splitter.name} is marked faulty. Choose another splitter.`);
  const n = splitterCapacity(splitter);
  if (!Number.isInteger(target.port) || target.port < 1 || target.port > n) return fail('No such output', `${splitter.name} is ${splitter.ratio}: it has ${n} outputs.`);
  if (!reconnect && customer.splitterId === splitter.id && customer.splitterOutputPort === target.port && !target.drop) {
    return fail('Already there', `${customer.name} is already on output ${target.port} of ${splitter.name}.`, 'info');
  }
  const port: SplitterPort = splitter.outputPorts.find((p) => p.portNumber === target.port) ?? { portNumber: target.port, label: `OUT-${String(target.port).padStart(2, '0')}`, status: 'Available' };
  const index = buildFiberIndex(fiberDataOf(data));
  if (port.connectedCustomerId && port.connectedCustomerId !== customer.id) {
    return fail('Output in use', `Output ${target.port} of ${splitter.name} already serves ${port.connectedCustomerName ?? port.connectedCustomerId}. One output feeds one drop. Choose a free output.`);
  }
  if ((index.cascadeChildren.get(`${splitter.id}#${target.port}`) ?? []).length > 0) {
    return fail('Output in use', `Output ${target.port} of ${splitter.name} feeds another splitter. Choose a free output.`);
  }
  if (port.status === 'Faulty') return fail('Output faulty', `Output ${target.port} of ${splitter.name} is marked faulty.`);
  if (port.status === 'Reserved') return fail('Output reserved', `Output ${target.port} of ${splitter.name} is reserved. Choose another output, or free it first.`);

  const currentDrop = customer.dropCableId && customer.fiberCore ? { cableId: customer.dropCableId, core: customer.fiberCore } : last?.dropCableId && last.fiberCore ? { cableId: last.dropCableId, core: last.fiberCore } : undefined;
  const fromBox = customer.terminalBoxId || last?.terminalBoxId;
  if (!target.drop && fromBox && splitter.terminalBoxId !== fromBox) {
    const box = data.equipment.find((e) => e.id === splitter.terminalBoxId);
    return fail('Choose the drop fiber', `${splitter.name} is in ${box?.name ?? splitter.terminalBoxId}, not in the customer's box. Choose the drop fiber that runs from it to the customer.`);
  }
  const drop = target.drop ?? currentDrop;
  if (!drop) return fail('Choose the drop fiber', `${customer.name} has no drop fiber on record. Choose the fiber that runs from the box to them.`);
  if (port.connectedDropCableId && !(port.connectedDropCableId === drop.cableId && port.connectedCore === drop.core)) {
    return fail('Output in use', `Output ${target.port} of ${splitter.name} is already connected to fiber ${port.connectedCore ?? '?'} of ${port.connectedDropCableId}. Free it first, or choose a free output.`);
  }

  const text = `${customer.id} ${reconnect ? 'reconnected' : 'moved'} to ${splitter.id} output ${target.port}: ${why}`;
  // 1. Release the old output and fiber (the same fiber is released and given again, so its history shows the move).
  const outputs = freeCustomerOutputs(data.splitters, customer, text, ctx);
  let cables: Cable[] = [...data.cables];
  const releasedNotes: string[] = [...outputs.freed];
  if (customer.dropCableId && customer.fiberCore) {
    const r = releaseCustomerFiber(cables, customer, customer.dropCableId, customer.fiberCore, text, ctx);
    cables = r.cables;
    if (r.released) releasedNotes.push(r.released);
  }
  const given = giveCustomerFiber(cables, customer, drop.cableId, drop.core, `${splitter.id} output ${target.port}`, ctx);
  if (typeof given === 'string') return fail('Fiber in use', `${given} Nothing was saved.`);
  cables = given.cables;
  // 2. Connect the new output.
  const at = nowIso(ctx);
  const splitters = outputs.splitters.map((s) => {
    if (s.id !== splitter.id) return s;
    const base = s.outputPorts.find((p) => p.portNumber === target.port) ?? port;
    const { connectedEquipmentId: _e, ...restPort } = base;
    const nextPort: SplitterPort = {
      ...restPort,
      status: 'Occupied',
      connectedCustomerId: customer.id,
      connectedCustomerName: customer.name,
      connectedDropCableId: drop.cableId,
      connectedCore: drop.core,
      connectedAt: at,
      history: [...(base.history ?? []), line('OUTPUT_CONNECTED', `${customer.id} on ${drop.cableId} fiber ${drop.core}: ${why}`, ctx)],
    };
    const exists = s.outputPorts.some((p) => p.portNumber === target.port);
    return { ...s, outputPorts: exists ? s.outputPorts.map((p) => (p.portNumber === target.port ? nextPort : p)) : [...s.outputPorts, nextPort].sort((a, b) => a.portNumber - b.portNumber) };
  });
  // 3. Box port: free the old one, use the new one.
  let equipment = reconnect ? [...data.equipment] : releaseBoxAndPon(data.equipment, customer);
  equipment = equipment.map((e) => (e.id === splitter.terminalBoxId && (e.totalPorts || e.logicalPorts?.length) ? setPortUsage(e, target.port, true, customer.id, isoDate(ctx.now)) : e));

  // 4. Work out the OLT link from the recorded fibers.
  const moved: Customer = {
    ...customer,
    ...NO_LINK,
    status: reconnect ? 'Active' : customer.status,
    terminalBoxId: splitter.terminalBoxId,
    splitterId: splitter.id,
    splitterOutputPort: target.port,
    dropCableId: drop.cableId,
    fiberCore: drop.core,
  };
  const interim = applyPatch(data, { cables, splitters, equipment, customers: replace(data.customers, moved) });
  const path = traceCustomerCores(moved, fiberDataOf(interim), { settings: ctx.optical });
  const upstream = path.cableIds.filter((id) => id !== drop.cableId);
  const linked = path.complete && path.olt && path.pon ? { oltId: path.olt.id, ponPort: path.pon.id } : undefined;
  const reading = rxReadingOf(customer, ctx.optical);
  const { disconnectedAt: _d, disconnectReason: _r, rxOpticalPowerDbm: _rx, rxSource: _rs, rxMeasuredAt: _rm, rxLaunchDbm: _rl, rxPhotoId: _rp, rxCaptureId: _rc, ...kept } = moved;
  const updated: Customer = {
    ...kept,
    ...(linked ? { oltId: linked.oltId, ponPort: linked.ponPort } : {}),
    ...(upstream.length ? { feederCableId: upstream.at(-1)!, distributionCableId: upstream[0] } : {}),
    connectionHistory: reconnect ? customer.connectionHistory : [...(customer.connectionHistory ?? []), connectionOf(customer, 'moved', why, ctx)],
    history: [
      ...(customer.history ?? []),
      line(reconnect ? 'RECONNECTED' : 'MOVED', `${splitter.id} output ${target.port}, ${drop.cableId} fiber ${drop.core}: ${why}${reading.valueDbm !== undefined ? `. Earlier reading ${reading.text} was for the old connection` : ''}`, ctx),
    ],
  };
  if (linked) {
    equipment = equipment.map((e) =>
      e.id === linked.oltId && e.ponPorts ? { ...e, ponPorts: e.ponPorts.map((p) => (p.id === linked.ponPort ? { ...p, status: 'Active' as const, connectedCustomersCount: p.connectedCustomersCount + 1 } : p)) } : e,
    );
  }
  // 5. The customer's ONT follows the move.
  const ont = customer.ontId ? (data.onts ?? []).find((o) => o.id === customer.ontId) : undefined;
  const onts =
    ont && isLiveOnt(ont)
      ? replace(data.onts ?? [], {
          ...withoutLink(ont),
          ...(linked ? { oltId: linked.oltId, ponPortId: linked.ponPort } : {}),
          splitterId: splitter.id,
          splitterOutputPort: target.port,
          dropCableId: drop.cableId,
          dropCore: drop.core,
          history: [...(ont.history ?? []), line('MOVED', `${linkText(ont)} → ${splitter.id} output ${target.port}, ${drop.cableId} fiber ${drop.core}: ${why}`, ctx)],
        })
      : data.onts;
  const basePatch: NetworkPatch = { cables, splitters, equipment, customers: replace(data.customers, updated), ...(onts !== data.onts ? { onts } : {}) };
  const marked = markServingCores(applyPatch(data, basePatch), splitter.id, ctx);
  const linkNote = linked ? ` Traced to ${path.olt!.name} ${path.pon!.id}.` : ` Not linked to an OLT yet: ${path.gaps[0] ?? 'the fiber path does not reach a PON port'}.`;
  return checkedConnectionChange(data, { ...basePatch, cables: marked.cables }, updated, {
    notice: notice(
      linked ? 'success' : 'warning',
      reconnect ? 'Customer reconnected' : 'Customer moved',
      `${customer.name} is on output ${target.port} of ${splitter.name}, fiber ${drop.core} of ${drop.cableId}.${linkNote}${releasedNotes.length ? ` Released: ${releasedNotes.join(', ')}.` : ''}${reading.valueDbm !== undefined ? ' The earlier reading was for the old connection, so take a new one.' : ''}`,
    ),
    audit: [{ action: reconnect ? 'CUSTOMER_RECONNECTED' : 'CUSTOMER_MOVED', details: `${text}; released ${releasedNotes.join(', ') || 'nothing'}`, assetId: customer.id, assetType: 'Customer' }],
  }, ctx);
}

/* ------------------------------------------------------------------ */
/* Services                                                            */
/* ------------------------------------------------------------------ */

export interface ServiceDraft {
  id?: string;
  customerId: string;
  kind: ServiceKind;
  status?: Exclude<ServiceStatus, 'ended'>;
  planName?: string;
  ontId?: string;
  ontPort?: string;
  startedAt?: string;
  notes?: string;
}

/** Adds or edits a service. Plan names are kept as written; no plan or price is invented. */
export function saveService(data: NetworkData, draft: ServiceDraft, ctx: CommandContext = {}): CommandResult<Service> {
  const customer = data.customers.find((c) => c.id === draft.customerId);
  if (!customer) return fail('Customer Missing', `Customer ${draft.customerId} was not found.`);
  const existing = draft.id ? (data.services ?? []).find((s) => s.id === draft.id) : undefined;
  if (draft.id && !existing) return fail('Service missing', `Service ${draft.id} was not found.`);
  if (existing && !isLiveService(existing)) return fail('Service ended', 'This service has ended and is kept as history. Add a new one instead.');
  if (!existing && !isActiveCustomer(customer)) return fail('Customer disconnected', `${customer.name} is disconnected. Reconnect them before adding a service.`);
  if (draft.ontId) {
    const ont = (data.onts ?? []).find((o) => o.id === draft.ontId);
    if (!ont) return fail('ONT missing', `ONT ${draft.ontId} was not found.`);
    if (!isLiveOnt(ont)) return fail('ONT is history', `ONT ${ont.serialNumber ?? ont.id} was removed.`);
  }
  const base: Service = existing ?? { id: newConnectionId('SVC'), customerId: customer.id, kind: draft.kind, status: 'active', createdAt: nowIso(ctx), ...(ctx.actor ? { createdBy: ctx.actor } : {}) };
  const next: Service = { ...base, kind: draft.kind, status: draft.status ?? base.status };
  for (const key of ['planName', 'ontId', 'ontPort', 'startedAt', 'notes'] as const) {
    const value = clean(draft[key]);
    if (value) next[key] = value;
    else delete next[key];
  }
  next.history = [...(base.history ?? []), line(existing ? 'UPDATED' : 'CREATED', `${next.kind}, ${next.status}${next.planName ? `, plan "${next.planName}" as written` : ''}${next.ontId ? `, ONT ${next.ontId}` : ''}`, ctx)];
  return checkedConnectionChange(data, { services: replace(data.services ?? [], next) }, next, {
    notice: notice('success', existing ? 'Service saved' : 'Service added', `${customer.name}: ${next.kind}${next.planName ? ` (${next.planName})` : ''} ${next.status}.`),
    audit: [{ action: existing ? 'SERVICE_UPDATED' : 'SERVICE_ADDED', details: `${next.id} for ${customer.id}: ${next.kind} ${next.status}`, assetId: next.id, assetType: 'Service' }],
  }, ctx);
}

/** Ends a service. It stays on record as history with the reason. */
export function endService(data: NetworkData, serviceId: string, reason: string, ctx: CommandContext = {}): CommandResult<Service> {
  const service = (data.services ?? []).find((s) => s.id === serviceId);
  if (!service) return fail('Service missing', `Service ${serviceId} was not found.`);
  if (!isLiveService(service)) return fail('Already ended', 'This service has already ended.', 'info');
  if (!reason.trim()) return fail('Say why', 'Write why the service ends.');
  const next: Service = { ...service, status: 'ended', endedAt: nowIso(ctx), endReason: reason.trim().slice(0, 300), history: [...(service.history ?? []), line('ENDED', reason.trim(), ctx)] };
  return checkedConnectionChange(data, { services: replace(data.services ?? [], next) }, next, {
    notice: notice('info', 'Service ended', `${service.kind} ended. It is kept as history.`),
    audit: [{ action: 'SERVICE_ENDED', details: `${service.id}: ${reason.trim()}`, assetId: service.id, assetType: 'Service' }],
  }, ctx);
}

/* ------------------------------------------------------------------ */
/* Buildings                                                           */
/* ------------------------------------------------------------------ */

export interface BuildingDraft {
  name: string;
  kind: BuildingKind;
  address?: string;
  /** The Building Entry Point pin (or other pin) the building is set up from. Its position is used. */
  entryEquipmentId?: string;
  lat?: number;
  lng?: number;
  locationMethod?: Building['locationMethod'];
  locationAccuracyMeters?: number;
  floorsAbove?: number;
  floorsBelow?: number;
}

export function createBuilding(data: NetworkData, draft: BuildingDraft, ctx: CommandContext = {}): CommandResult<Building> {
  if (!draft.name.trim()) return fail('Name needed', 'Write the building name or address as people know it.');
  const pin = draft.entryEquipmentId ? data.equipment.find((e) => e.id === draft.entryEquipmentId) : undefined;
  if (draft.entryEquipmentId && !pin) return fail('Pin Missing', `${draft.entryEquipmentId} is not on the map.`);
  const taken = pin ? (data.buildings ?? []).find((b) => b.entryEquipmentId === pin.id) : undefined;
  if (taken) return fail('Already set up', `${pin!.name} is already the entry point of ${taken.name}. Open it instead.`);
  const lat = draft.lat ?? pin?.lat;
  const lng = draft.lng ?? pin?.lng;
  if (lat === undefined || lng === undefined || !isValidCoordinate(lat, lng) || !hasRecordedLocation({ lat, lng })) {
    return fail('Place needed', 'Set the building up from its entry pin, or give its real position.');
  }
  const method = draft.lat !== undefined ? draft.locationMethod : pin?.locationMethod;
  const accuracy = draft.lat !== undefined ? draft.locationAccuracyMeters : pin?.locationAccuracyMeters;
  const building: Building = {
    id: newConnectionId('BLD'),
    name: draft.name.trim(),
    kind: draft.kind,
    lat,
    lng,
    ...(method ? { locationMethod: method } : {}),
    ...(accuracy !== undefined ? { locationAccuracyMeters: accuracy } : {}),
    ...(clean(draft.address) ? { address: clean(draft.address) } : {}),
    ...(pin ? { entryEquipmentId: pin.id } : {}),
    ...(draft.floorsAbove !== undefined ? { floorsAbove: draft.floorsAbove } : {}),
    ...(draft.floorsBelow !== undefined ? { floorsBelow: draft.floorsBelow } : {}),
    floorBoxes: [],
    units: [],
    history: [line('CREATED', `Set up${pin ? ` from ${pin.id}` : ''}`, ctx)],
    createdAt: nowIso(ctx),
    ...(ctx.actor ? { createdBy: ctx.actor } : {}),
  };
  return checkedConnectionChange(data, { buildings: [...(data.buildings ?? []), building] }, building, {
    notice: notice('success', 'Building set up', `${building.name}. Add its riser, floor boxes and units.`),
    audit: [{ action: 'BUILDING_CREATED', details: `${building.id} ${building.name}${pin ? ` at ${pin.id}` : ''}`, assetId: building.id, assetType: 'Building' }],
  }, ctx);
}

export type BuildingDetails = Partial<Pick<Building, 'name' | 'address' | 'kind' | 'floorsAbove' | 'floorsBelow' | 'entryNote' | 'riserCableId' | 'riserNote' | 'notes'>>;

function editBuilding(data: NetworkData, buildingId: string, edit: (b: Building) => Building | string, audit: { action: string; details: string }, title: string, message: (b: Building) => string, ctx: CommandContext): CommandResult<Building> {
  const building = (data.buildings ?? []).find((b) => b.id === buildingId);
  if (!building) return fail('Building missing', `Building ${buildingId} was not found.`);
  const next = edit(building);
  if (typeof next === 'string') return fail('Not saved', next);
  const withHistory: Building = { ...next, history: [...(building.history ?? []), line(audit.action, audit.details, ctx)] };
  return checkedConnectionChange(data, { buildings: replace(data.buildings ?? [], withHistory) }, withHistory, {
    notice: notice('success', title, message(withHistory)),
    audit: [{ action: `BUILDING_${audit.action}`, details: `${building.id}: ${audit.details}`, assetId: building.id, assetType: 'Building' }],
  }, ctx);
}

export function saveBuildingDetails(data: NetworkData, buildingId: string, details: BuildingDetails, ctx: CommandContext = {}): CommandResult<Building> {
  if (details.riserCableId && !data.cables.some((c) => c.id === details.riserCableId)) return fail('Cable Missing', `Cable ${details.riserCableId} is not on record.`);
  if (details.name !== undefined && !details.name.trim()) return fail('Name needed', 'A building needs a name.');
  return editBuilding(
    data,
    buildingId,
    (b) => {
      const next: Building = { ...b };
      for (const key of ['name', 'address', 'entryNote', 'riserCableId', 'riserNote', 'notes'] as const) {
        if (!(key in details)) continue;
        const value = clean(details[key]);
        if (value) next[key] = value;
        else if (key !== 'name') delete next[key];
      }
      if (details.kind) next.kind = details.kind;
      for (const key of ['floorsAbove', 'floorsBelow'] as const) {
        if (!(key in details)) continue;
        if (details[key] === undefined) delete next[key];
        else next[key] = details[key];
      }
      return next;
    },
    { action: 'UPDATED', details: Object.keys(details).join(', ') },
    'Building saved',
    (b) => `${b.name} details saved.`,
    ctx,
  );
}

export interface FloorBoxDraft {
  label: string;
  floor?: string;
  equipmentId?: string;
  splitterId?: string;
}

export function addFloorBox(data: NetworkData, buildingId: string, draft: FloorBoxDraft, ctx: CommandContext = {}): CommandResult<Building> {
  if (!draft.label.trim()) return fail('Name needed', 'Write the name on the box, such as "Floor 3 box".');
  if (draft.equipmentId && !data.equipment.some((e) => e.id === draft.equipmentId)) return fail('Pin Missing', `${draft.equipmentId} is not on the map.`);
  if (draft.splitterId && !data.splitters.some((s) => s.id === draft.splitterId)) return fail('Splitter Missing', `Splitter ${draft.splitterId} was not found.`);
  const box: BuildingFloorBox = {
    id: newConnectionId('FLB'),
    label: draft.label.trim(),
    ...(clean(draft.floor) ? { floor: clean(draft.floor) } : {}),
    ...(draft.equipmentId ? { equipmentId: draft.equipmentId } : {}),
    ...(draft.splitterId ? { splitterId: draft.splitterId } : {}),
  };
  return editBuilding(
    data,
    buildingId,
    (b) => (b.floorBoxes.some((f) => f.label.toLowerCase() === box.label.toLowerCase()) ? `${b.name} already has a box called ${box.label}.` : { ...b, floorBoxes: [...b.floorBoxes, box] }),
    { action: 'FLOOR_BOX_ADDED', details: `${box.label}${box.floor ? ` on floor ${box.floor}` : ''}` },
    'Floor box added',
    (b) => `${b.name}: ${box.label} added.`,
    ctx,
  );
}

export interface UnitDraft {
  label: string;
  floor?: string;
  floorBoxId?: string;
}

export function addBuildingUnit(data: NetworkData, buildingId: string, draft: UnitDraft, ctx: CommandContext = {}): CommandResult<Building> {
  if (!draft.label.trim()) return fail('Name needed', 'Write the flat or shop number as it is on the door, such as "302".');
  const unit: BuildingUnit = {
    id: newConnectionId('UNT'),
    label: draft.label.trim(),
    ...(clean(draft.floor) ? { floor: clean(draft.floor) } : {}),
    ...(draft.floorBoxId ? { floorBoxId: draft.floorBoxId } : {}),
  };
  return editBuilding(
    data,
    buildingId,
    (b) => {
      if (b.units.some((u) => u.label.toLowerCase() === unit.label.toLowerCase())) return `${b.name} already has unit ${unit.label}.`;
      if (unit.floorBoxId && !b.floorBoxes.some((f) => f.id === unit.floorBoxId)) return 'That floor box is not in this building.';
      return { ...b, units: [...b.units, unit] };
    },
    { action: 'UNIT_ADDED', details: `${unit.label}${unit.floor ? ` on floor ${unit.floor}` : ''}` },
    'Unit added',
    (b) => `${b.name}: ${unit.label} added.`,
    ctx,
  );
}

/** Takes a unit off a building. A unit with a customer in it is refused. */
export function removeBuildingUnit(data: NetworkData, buildingId: string, unitId: string, ctx: CommandContext = {}): CommandResult<Building> {
  const inUnit = data.customers.filter((c) => c.unitId === unitId);
  if (inUnit.length > 0) return fail('Unit in use', `${inUnit.map((c) => c.name).join(', ')} ${inUnit.length === 1 ? 'is' : 'are'} recorded in this unit. Move them first.`);
  return editBuilding(
    data,
    buildingId,
    (b) => (b.units.some((u) => u.id === unitId) ? { ...b, units: b.units.filter((u) => u.id !== unitId) } : 'That unit is not in this building.'),
    { action: 'UNIT_REMOVED', details: unitId },
    'Unit removed',
    (b) => `${b.name}: unit removed.`,
    ctx,
  );
}

/** Records which building and unit a customer is in, or clears it. */
export function placeCustomerInUnit(data: NetworkData, customerId: string, place: { buildingId: string; unitId?: string } | null, ctx: CommandContext = {}): CommandResult<Customer> {
  const customer = data.customers.find((c) => c.id === customerId);
  if (!customer) return fail('Customer Missing', `Customer ${customerId} was not found.`);
  const building = place ? (data.buildings ?? []).find((b) => b.id === place.buildingId) : undefined;
  if (place && !building) return fail('Building missing', `Building ${place.buildingId} was not found.`);
  const unit = place?.unitId ? building?.units.find((u) => u.id === place.unitId) : undefined;
  if (place?.unitId && !unit) return fail('Unit missing', `${building!.name} has no such unit.`);
  const { buildingId: _b, unitId: _u, ...rest } = customer;
  const updated: Customer = {
    ...rest,
    ...(building ? { buildingId: building.id, building: building.name } : {}),
    ...(unit ? { unitId: unit.id, flatNumber: unit.label } : {}),
    history: [...(customer.history ?? []), line('PLACED', building ? `${building.name}${unit ? `, ${unit.label}` : ''}` : 'Building cleared', ctx)],
  };
  return checkedConnectionChange(data, { customers: replace(data.customers, updated) }, updated, {
    notice: notice('success', 'Saved', building ? `${customer.name} is in ${building.name}${unit ? `, ${unit.label}` : ''}.` : `${customer.name} is no longer recorded in a building.`),
    audit: [{ action: 'CUSTOMER_PLACED', details: `${customer.id}: ${building ? `${building.id}${unit ? `/${unit.id}` : ''}` : 'cleared'}`, assetId: customer.id, assetType: 'Customer' }],
  }, ctx);
}
