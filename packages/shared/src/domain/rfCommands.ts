import type { RfElement, RfElementKind, RfLevel, RfLink, RfPortRef } from '../model/rfSchemas';
import type { Customer } from '../model/types';
import { applyPatch, type AuditEntry, type CommandContext, type CommandResult, fail, type NetworkData, type NetworkPatch, type Notice, notice, succeed } from './command';
import { describeFiberProblems } from './fiberRules';
import { newRecordId, nextNumberedName } from './ids';
import { findRfProblems, newRfProblems, type RfCheckData } from './rfRules';
import { DEFAULT_RF_SETTINGS } from './rfSettings';
import { defaultRfPorts, describeRfPort, findRfPort, indexRf, portKey, RF_KIND_INFO } from './rfTree';

/**
 * Cable TV commands (Phase 6). Pure, like the other domain commands: each checks the change with
 * `rfRules.ts` (the same rules the server runs), refuses errors with a plain message, and asks
 * "Save anyway" for warnings, writing the acceptance to the audit trail. Values are kept exactly as
 * entered; nothing is filled in from a typical figure.
 */

const rfDataOf = (d: NetworkData): RfCheckData => ({
  rfElements: d.rfElements ?? [],
  rfLinks: d.rfLinks ?? [],
  rfLevels: d.rfLevels ?? [],
  cables: d.cables,
  customers: d.customers,
  equipment: d.equipment,
});

const line = (action: string, details: string, ctx: CommandContext) => ({
  at: (ctx.now ?? new Date()).toISOString(),
  ...(ctx.actor ? { by: ctx.actor } : {}),
  action,
  details,
});

/** Applies the patch, refuses new errors, and asks before saving new warnings. */
export function checkedRfChange<T>(
  data: NetworkData,
  patch: NetworkPatch,
  value: T,
  extras: { notice: Notice; audit: AuditEntry[] },
  ctx: CommandContext = {},
  /** Warnings not worth a "Save anyway?" for this change; they still show on the Checks tab. */
  skipWarning: (w: { code: string; refs: string[] }) => boolean = () => false,
): CommandResult<T> {
  const after = applyPatch(data, patch);
  const found = newRfProblems(rfDataOf(data), rfDataOf(after), { rf: ctx.rf ?? DEFAULT_RF_SETTINGS, ...(ctx.optical ? { optical: ctx.optical } : {}) });
  const errors = found.errors;
  const warnings = found.warnings.filter((w) => !skipWarning(w));
  if (errors.length > 0) return fail('Not saved', `${describeFiberProblems(errors)} Nothing was saved.`);
  if (warnings.length === 0) return succeed(value, patch, extras);
  const first = extras.audit[0];
  return succeed(value, patch, {
    notice: extras.notice,
    audit: [
      ...extras.audit,
      { action: 'WARNING_ACCEPTED', details: `Saved after the warning: ${warnings.map((w) => w.message).join(' ')}`.slice(0, 900), assetId: first?.assetId ?? 'cable-tv', assetType: first?.assetType ?? 'System' },
    ],
    confirm: `Please check: ${warnings.map((w) => w.message).join(' ')} Save anyway?`,
  });
}

/** All Cable TV problems now in the data: for the Cable TV page and the map check. */
export const rfProblemsOf = (data: NetworkData, ctx: CommandContext = {}) =>
  findRfProblems(rfDataOf(data), { rf: ctx.rf ?? DEFAULT_RF_SETTINGS, ...(ctx.optical ? { optical: ctx.optical } : {}) });

const NAME_PREFIX: Record<RfElementKind, string> = {
  headend: 'HE-',
  cmts: 'CMTS-',
  optical_transmitter: 'TX-',
  edfa: 'EDFA-',
  wdm: 'WDM-',
  optical_splitter: 'OSP-',
  optical_node: 'NODE-',
  mini_node: 'MN-',
  rf_amplifier: 'AMP-',
  rf_splitter: 'SPL-',
  directional_coupler: 'DC-',
  tap: 'TAP-',
  power_inserter: 'PI-',
  power_supply: 'PS-',
  stb: 'STB-',
  cable_modem: 'CM-',
};

export interface RfElementDetails {
  name?: string;
  status?: RfElement['status'];
  siteEquipmentId?: string;
  customerId?: string;
  powered?: boolean;
  powerFeed?: RfElement['powerFeed'];
  passesPower?: boolean;
  gainDb?: number;
  tiltDb?: number;
  ratedOutputDbuv?: number;
  ratedAtInputDbm?: number;
  wavelengthNm?: number;
  edfaKind?: RfElement['edfaKind'];
  valuesSource?: string;
  vendor?: string;
  model?: string;
  serialNumber?: string;
  docsisVersion?: RfElement['docsisVersion'];
  notes?: string;
  /** Tap: the tap value on every drop port, and the through loss on OUT. As entered. */
  tapValueDb?: number;
  throughLossDb?: number;
  /** Other passive parts: loss per output port id, as entered. */
  portLosses?: Record<string, number | undefined>;
}

export interface RfElementDraft extends RfElementDetails {
  kind: RfElementKind;
  /** Number of outputs, for kinds that have a choice. Fixed once made. */
  outputs?: number;
  wdmRole?: 'combine' | 'separate';
}

const clean = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '')) as T;

function applyDetails(el: RfElement, d: RfElementDetails): RfElement | string {
  const info = RF_KIND_INFO[el.kind];
  if (info.power === 'ask' && d.powered === undefined) return `Say whether ${el.name} is powered or passive. A passive mini-node has a much tighter level budget, so it is never assumed.`;
  if (el.kind === 'edfa' && !d.edfaKind) return `Say whether ${el.name} is a plain EDFA or a WDM EDFA with a pass port for PON light.`;
  const ports = el.ports.map((p) => {
    let loss = p.lossDb;
    if (el.kind === 'tap') {
      if (p.role === 'drop') loss = d.tapValueDb;
      if (p.role === 'through') loss = d.throughLossDb;
    } else if (d.portLosses && p.id in d.portLosses) loss = d.portLosses[p.id];
    const { lossDb: _old, ...rest } = p;
    return loss === undefined || !Number.isFinite(loss) ? rest : { ...rest, lossDb: loss };
  });
  const { portLosses: _p, tapValueDb: _t, throughLossDb: _th, ...fields } = d;
  const keep = { id: el.id, kind: el.kind, createdAt: el.createdAt, ports, history: el.history, wdmRole: el.wdmRole, status: d.status ?? el.status, name: d.name?.trim() || el.name };
  return clean({ ...fields, ...keep }) as RfElement;
}

export function createRfElement(data: NetworkData, draft: RfElementDraft, ctx: CommandContext = {}): CommandResult<RfElement> {
  if (!RF_KIND_INFO[draft.kind]) return fail('Not saved', 'Choose what kind of item this is.');
  if (draft.kind === 'wdm' && !draft.wdmRole) return fail('Not saved', 'Say whether this WDM puts TV and PON light together or takes them apart.');
  const existing = data.rfElements ?? [];
  const base: RfElement = {
    id: newRecordId('RF-'),
    name: draft.name?.trim() || nextNumberedName(NAME_PREFIX[draft.kind], existing),
    kind: draft.kind,
    status: draft.status ?? 'built',
    ports: defaultRfPorts(draft.kind, { outputs: draft.outputs, wdmRole: draft.wdmRole }),
    ...(draft.kind === 'wdm' ? { wdmRole: draft.wdmRole } : {}),
    createdAt: (ctx.now ?? new Date()).toISOString(),
    history: [line('created', `${RF_KIND_INFO[draft.kind].label} recorded`, ctx)],
  };
  const el = applyDetails(base, draft);
  if (typeof el === 'string') return fail('Not saved', el);
  return checkedRfChange(data, { rfElements: [...existing, el] }, el, {
    notice: notice('success', 'Saved', `${RF_KIND_INFO[el.kind].label} ${el.name} recorded. Link it to what feeds it.`),
    audit: [{ action: 'RF_ITEM_ADDED', details: `${RF_KIND_INFO[el.kind].label} ${el.name}`, assetId: el.id, assetType: 'RfElement' }],
  }, ctx, (w) => NOT_YET_FOR_NEW_ITEM.has(w.code) && w.refs.includes(el.id));
}

/**
 * A brand-new item cannot be linked or measured yet: linking and readings come after adding it.
 * Asking "Save anyway?" for these on every new item would only teach people to click through.
 */
const NOT_YET_FOR_NEW_ITEM = new Set(['rf_not_linked', 'rf_passive_node_no_light', 'rf_device_no_customer']);

export function saveRfElement(data: NetworkData, elementId: string, details: RfElementDetails, ctx: CommandContext = {}): CommandResult<RfElement> {
  const list = data.rfElements ?? [];
  const current = list.find((e) => e.id === elementId);
  if (!current) return fail('Not saved', `Item ${elementId} is not on record.`);
  const next = applyDetails(current, details);
  if (typeof next === 'string') return fail('Not saved', next);
  next.history = [...(current.history ?? []), line('changed', 'Details changed', ctx)];
  return checkedRfChange(data, { rfElements: list.map((e) => (e.id === elementId ? next : e)) }, next, {
    notice: notice('success', 'Saved', `${next.name} saved.`),
    audit: [{ action: 'RF_ITEM_CHANGED', details: next.name, assetId: next.id, assetType: 'RfElement' }],
  }, ctx);
}

/** Refused while a live link or a recorded level names the item, so nothing is lost silently. */
export function deleteRfElement(data: NetworkData, elementId: string, ctx: CommandContext = {}): CommandResult<string> {
  const list = data.rfElements ?? [];
  const el = list.find((e) => e.id === elementId);
  if (!el) return fail('Not deleted', `Item ${elementId} is not on record.`);
  const links = (data.rfLinks ?? []).filter((l) => l.status === 'active' && (l.from.elementId === el.id || l.to.elementId === el.id));
  if (links.length > 0) return fail('Not deleted', `${el.name} still has ${links.length} link(s). Take them out first, so the gap is recorded.`);
  const levels = (data.rfLevels ?? []).filter((l) => l.elementId === el.id);
  if (levels.length > 0) return fail('Not deleted', `${el.name} has ${levels.length} recorded level(s). They are kept as history, so the item stays. Mark it as not built instead.`);
  // Removed links keep naming it as history; they are dropped with the item they point to.
  const rfLinks = (data.rfLinks ?? []).filter((l) => l.from.elementId !== el.id && l.to.elementId !== el.id);
  return checkedRfChange(data, { rfElements: list.filter((e) => e.id !== el.id), rfLinks }, el.id, {
    notice: notice('success', 'Deleted', `${el.name} was deleted.`),
    audit: [{ action: 'RF_ITEM_DELETED', details: el.name, assetId: el.id, assetType: 'RfElement' }],
  }, ctx);
}

export interface RfLinkDraft {
  from: RfPortRef;
  to: RfPortRef;
  medium: RfLink['medium'];
  coaxType?: string;
  lengthM?: number;
  lengthSource?: RfLink['lengthSource'];
  cableId?: string;
  fiberNumber?: number;
  wavelengthsNm?: number[];
}

/** Records one link from an output port to an input port. A port already in use is refused. */
export function linkRf(data: NetworkData, draft: RfLinkDraft, ctx: CommandContext = {}): CommandResult<RfLink> {
  const ix = indexRf(rfDataOf(data));
  const fromEl = ix.elements.get(draft.from.elementId);
  const toEl = ix.elements.get(draft.to.elementId);
  if (!fromEl || !toEl) return fail('Not linked', 'Choose both ends of the link.');
  if (!findRfPort(fromEl, draft.from.portId) || !findRfPort(toEl, draft.to.portId)) return fail('Not linked', 'Choose a port on each end.');
  const usedFrom = ix.outOf.get(portKey(draft.from.elementId, draft.from.portId))?.[0];
  if (usedFrom) {
    const tapPort = fromEl.kind === 'tap' && findRfPort(fromEl, draft.from.portId)?.role === 'drop';
    return fail('Not linked', `${describeRfPort(ix, draft.from)} already feeds ${describeRfPort(ix, usedFrom.to)}.${tapPort ? ' One tap port takes one house wire: choose a free drop port.' : ' Take that link out first, or record a splitter.'} Nothing was saved.`);
  }
  const usedTo = ix.into.get(portKey(draft.to.elementId, draft.to.portId))?.[0];
  if (usedTo) return fail('Not linked', `${describeRfPort(ix, draft.to)} is already fed from ${describeRfPort(ix, usedTo.from)}. One input takes one feed. Nothing was saved.`);
  if (draft.medium === 'coax' && draft.lengthM !== undefined && !draft.lengthSource) return fail('Not linked', 'Say where the coax length came from: drawn on the map, sheath marks or an estimate.');
  const link: RfLink = clean({
    id: newRecordId('RFL-'),
    from: draft.from,
    to: draft.to,
    medium: draft.medium,
    coaxType: draft.medium === 'coax' ? draft.coaxType?.trim() : undefined,
    lengthM: draft.lengthM,
    lengthSource: draft.lengthM !== undefined ? draft.lengthSource : undefined,
    cableId: draft.cableId,
    fiberNumber: draft.medium === 'fiber' ? draft.fiberNumber : undefined,
    wavelengthsNm: draft.medium === 'fiber' && draft.wavelengthsNm?.length ? [...new Set(draft.wavelengthsNm)] : undefined,
    status: 'active' as const,
    createdAt: (ctx.now ?? new Date()).toISOString(),
    createdBy: ctx.actor,
    history: [line('linked', `${describeRfPort(ix, draft.from)} → ${describeRfPort(ix, draft.to)}`, ctx)],
  }) as RfLink;
  return checkedRfChange(data, { rfLinks: [...(data.rfLinks ?? []), link] }, link, {
    notice: notice('success', 'Linked', `${describeRfPort(ix, draft.from)} now feeds ${describeRfPort(ix, draft.to)}.`),
    audit: [{ action: 'RF_LINKED', details: `${describeRfPort(ix, draft.from)} → ${describeRfPort(ix, draft.to)} (${draft.medium})`, assetId: link.id, assetType: 'RfLink' }],
  }, ctx);
}

/** Takes a link out. It is kept with the date and reason, so the gap it leaves can be named. */
export function unlinkRf(data: NetworkData, linkId: string, reason: string, ctx: CommandContext = {}): CommandResult<RfLink> {
  const link = (data.rfLinks ?? []).find((l) => l.id === linkId);
  if (!link || link.status !== 'active') return fail('Not changed', 'That link is not recorded as in place.');
  if (!reason.trim()) return fail('Not changed', 'Say why the link is taken out (cut, moved, entered by mistake).');
  const ix = indexRf(rfDataOf(data));
  const at = (ctx.now ?? new Date()).toISOString();
  const next: RfLink = { ...link, status: 'removed', removedAt: at, removedReason: reason.trim().slice(0, 300), history: [...(link.history ?? []), line('taken out', reason.trim().slice(0, 300), ctx)] };
  return checkedRfChange(data, { rfLinks: (data.rfLinks ?? []).map((l) => (l.id === linkId ? next : l)) }, next, {
    notice: notice('success', 'Link taken out', `${describeRfPort(ix, link.to)} is no longer fed. The old link is kept as history.`),
    audit: [{ action: 'RF_UNLINKED', details: `${describeRfPort(ix, link.from)} → ${describeRfPort(ix, link.to)}: ${reason.trim()}`, assetId: link.id, assetType: 'RfLink' }],
  }, ctx);
}

export interface RfLevelDraft {
  elementId: string;
  portId: string;
  value: number;
  unit: RfLevel['unit'];
  origin: Exclude<RfLevel['origin'], 'calculated'>;
  frequencyMhz?: number;
  channel?: string;
  testPointOffsetDb?: number;
  merDb?: number;
  ber?: string;
  measuredAt?: string;
  instrument?: string;
  technician?: string;
  photoId?: string;
  source?: string;
  note?: string;
}

/** Stores one level exactly as read, with its unit and origin. An estimate is never stored. */
export function recordRfLevel(data: NetworkData, draft: RfLevelDraft, ctx: CommandContext = {}): CommandResult<RfLevel> {
  if (!Number.isFinite(draft.value)) return fail('Not saved', 'Enter the level as read.');
  if ((draft.origin as string) === 'calculated') return fail('Not saved', 'Estimates are worked out on the page. Record only a designed, measured or device level.');
  const ix = indexRf(rfDataOf(data));
  const el = ix.elements.get(draft.elementId);
  const p = findRfPort(el, draft.portId);
  if (!el || !p) return fail('Not saved', 'Choose the item and the port the level was read at.');
  if (p.signal === 'rf' && draft.frequencyMhz === undefined) return fail('Not saved', 'Enter the frequency (MHz) the level was read at.');
  const level: RfLevel = clean({
    ...draft,
    frequencyMhz: p.signal === 'rf' ? draft.frequencyMhz : undefined,
    id: newRecordId('RFV-'),
    createdAt: (ctx.now ?? new Date()).toISOString(),
    createdBy: ctx.actor,
  }) as RfLevel;
  return checkedRfChange(data, { rfLevels: [...(data.rfLevels ?? []), level] }, level, {
    notice: notice('success', 'Saved', `Level recorded at ${describeRfPort(ix, draft)}.`),
    audit: [{ action: 'RF_LEVEL_RECORDED', details: `${draft.value} ${draft.unit} (${draft.origin}) at ${describeRfPort(ix, draft)}`, assetId: level.id, assetType: 'RfLevel' }],
  }, ctx);
}

/** Only for a level entered by mistake. */
export function deleteRfLevel(data: NetworkData, levelId: string, ctx: CommandContext = {}): CommandResult<string> {
  const level = (data.rfLevels ?? []).find((l) => l.id === levelId);
  if (!level) return fail('Not deleted', 'That level is not on record.');
  return checkedRfChange(data, { rfLevels: (data.rfLevels ?? []).filter((l) => l.id !== levelId) }, levelId, {
    notice: notice('success', 'Deleted', 'The level was deleted as entered by mistake.'),
    audit: [{ action: 'RF_LEVEL_DELETED', details: `${level.value} ${level.unit} at ${level.elementId}/${level.portId}, entered by mistake`, assetId: level.id, assetType: 'RfLevel' }],
  }, ctx);
}

export interface TvCustomerDraft {
  name: string;
  mobile?: string;
  address?: string;
  area?: string;
  /** Leave both out when the house position is not known: it is recorded as not placed. */
  lat?: number;
  lng?: number;
  plan?: string;
  tap: RfPortRef;
  device: { kind: 'stb' | 'cable_modem'; serialNumber?: string; model?: string; vendor?: string; docsisVersion?: RfElement['docsisVersion'] };
  drop: { coaxType?: string; lengthM?: number; lengthSource?: RfLink['lengthSource'] };
}

/**
 * The Cable TV customer flow, next to the fiber one: a customer on one tap drop port, with a set top
 * box or modem, joined by a coax house wire. The customer has no PON fields; their path is the RF
 * tree. A used tap port is refused.
 */
export function addTvCustomer(data: NetworkData, draft: TvCustomerDraft, ctx: CommandContext = {}): CommandResult<{ customer: Customer; device: RfElement; link: RfLink }> {
  const name = draft.name.trim();
  if (!name) return fail('Not saved', 'Enter the customer name.');
  const ix = indexRf(rfDataOf(data));
  const tap = ix.elements.get(draft.tap.elementId);
  const tapPort = findRfPort(tap, draft.tap.portId);
  if (!tap || !tapPort || tap.kind !== 'tap' || tapPort.role !== 'drop') return fail('Not saved', 'Choose the tap and the drop port the house wire is on.');
  const used = ix.outOf.get(portKey(tap.id, tapPort.id))?.[0];
  if (used) return fail('Port already in use', `${describeRfPort(ix, draft.tap)} already feeds ${describeRfPort(ix, used.to)}. One tap port takes one house wire: choose a free drop port. Nothing was saved.`);
  if (draft.drop.lengthM !== undefined && !draft.drop.lengthSource) return fail('Not saved', 'Say where the house wire length came from: drawn, sheath marks or an estimate.');
  const placed = draft.lat !== undefined && draft.lng !== undefined && Number.isFinite(draft.lat) && Number.isFinite(draft.lng) && !(draft.lat === 0 && draft.lng === 0);
  const now = ctx.now ?? new Date();
  const customer: Customer = {
    id: newRecordId('CUST-'),
    name,
    mobile: draft.mobile?.trim() ?? '',
    address: draft.address?.trim() ?? '',
    area: draft.area?.trim() ?? '',
    lat: placed ? draft.lat! : 0,
    lng: placed ? draft.lng! : 0,
    locationMethod: placed ? 'typed' : 'not_placed',
    serviceType: 'Cable TV',
    plan: draft.plan?.trim() ?? '',
    status: 'Active',
    installationDate: now.toISOString().slice(0, 10),
    oltId: '', ponPort: '', feederCableId: '', distributionCableId: '', terminalBoxId: '', splitterId: '', splitterOutputPort: 0, dropCableId: '', fiberCore: 0,
    ontSerialNumber: '', routerModel: '', ipAddress: '',
    accessNetwork: 'hfc',
    history: [line('connected', `Cable TV on ${describeRfPort(ix, draft.tap)}`, ctx)],
  };
  const device: RfElement = clean({
    id: newRecordId('RF-'),
    name: nextNumberedName(NAME_PREFIX[draft.device.kind], data.rfElements ?? []),
    kind: draft.device.kind,
    status: 'built' as const,
    customerId: customer.id,
    ports: defaultRfPorts(draft.device.kind),
    serialNumber: draft.device.serialNumber?.trim(),
    model: draft.device.model?.trim(),
    vendor: draft.device.vendor?.trim(),
    docsisVersion: draft.device.kind === 'cable_modem' ? draft.device.docsisVersion : undefined,
    createdAt: now.toISOString(),
    history: [line('created', `For customer ${customer.id}`, ctx)],
  }) as RfElement;
  const link: RfLink = clean({
    id: newRecordId('RFL-'),
    from: draft.tap,
    to: { elementId: device.id, portId: 'IN' },
    medium: 'coax' as const,
    coaxType: draft.drop.coaxType?.trim(),
    lengthM: draft.drop.lengthM,
    lengthSource: draft.drop.lengthM !== undefined ? draft.drop.lengthSource : undefined,
    status: 'active' as const,
    createdAt: now.toISOString(),
    createdBy: ctx.actor,
    history: [line('linked', `House wire to ${customer.id}`, ctx)],
  }) as RfLink;
  return checkedRfChange(
    data,
    { customers: [...data.customers, customer], rfElements: [...(data.rfElements ?? []), device], rfLinks: [...(data.rfLinks ?? []), link] },
    { customer, device, link },
    {
      notice: notice('success', 'Cable TV customer added', `${name} is on ${describeRfPort(ix, draft.tap)} with ${RF_KIND_INFO[device.kind].label} ${device.name}.${placed ? '' : ' House position not recorded: place it later.'}`),
      audit: [
        { action: 'TV_CUSTOMER_ADDED', details: `${customer.id} on ${describeRfPort(ix, draft.tap)}`, assetId: customer.id, assetType: 'Customer' },
        { action: 'RF_LINKED', details: `${describeRfPort(ix, draft.tap)} → ${device.name}`, assetId: link.id, assetType: 'RfLink' },
      ],
    },
    ctx,
  );
}

/** Disconnects a Cable TV customer: the house wire link is taken out with the reason; the box is kept. */
export function disconnectTvCustomer(data: NetworkData, customerId: string, reason: string, ctx: CommandContext = {}): CommandResult<Customer> {
  const customer = data.customers.find((c) => c.id === customerId);
  if (!customer || customer.accessNetwork !== 'hfc') return fail('Not changed', 'That is not a Cable TV customer on record.');
  if (!reason.trim()) return fail('Not changed', 'Say why the customer is disconnected.');
  const at = (ctx.now ?? new Date()).toISOString();
  const devices = new Set((data.rfElements ?? []).filter((e) => e.customerId === customerId).map((e) => e.id));
  const rfLinks = (data.rfLinks ?? []).map((l) =>
    l.status === 'active' && devices.has(l.to.elementId)
      ? { ...l, status: 'removed' as const, removedAt: at, removedReason: `Customer disconnected: ${reason.trim()}`.slice(0, 300), history: [...(l.history ?? []), line('taken out', `Customer disconnected: ${reason.trim()}`, ctx)] }
      : l,
  );
  const next: Customer = { ...customer, status: 'Disconnected', disconnectedAt: at, disconnectReason: reason.trim().slice(0, 300), history: [...(customer.history ?? []), line('disconnected', reason.trim(), ctx)] };
  return checkedRfChange(data, { customers: data.customers.map((c) => (c.id === customerId ? next : c)), rfLinks }, next, {
    notice: notice('success', 'Disconnected', `${customer.name} is disconnected. The tap port is free; the old link is kept as history.`),
    audit: [{ action: 'TV_CUSTOMER_DISCONNECTED', details: `${customer.id}: ${reason.trim()}`, assetId: customer.id, assetType: 'Customer' }],
  }, ctx);
}
