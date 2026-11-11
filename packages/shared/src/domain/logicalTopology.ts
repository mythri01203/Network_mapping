import { SERVICE_KIND_LABELS, SERVICE_STATUS_LABELS } from '../model/enums';
import type { Customer, Equipment, Ont, PonPort, Service, Setting } from '../model/types';
import { type AuditEntry, type CommandContext, type CommandResult, fail, type NetworkData } from './command';
import { checkedConnectionChange } from './connectionCommands';
import { customersOnOnt, isLiveOnt, isLiveService } from './connectionRules';
import { type CustomerPathCache, customerPathCache, customerPathFromLinks, isPonCustomer, type LinkedCustomerPath, upstreamOfSplitter } from './customerPath';
import { CUSTOMER_HIDDEN_TEXT } from './customerPrivacy';
import { describeCore, type FiberData } from './fiberIndex';
import type { FiberProblem } from './fiberRules';
import { buildOltPonPorts } from './oltConfig';

/**
 * Network mapping Phase 14: the logical layer next to the physical one.
 *
 * - **Physical**: what the fibre links reach (Phase 12 `customerPathFromLinks`, through splices,
 *   splitters, cascades, ODF ports and patches). Never position.
 * - **Logical**: what a person wrote about the service: service → ONT (`services.ontId`, else the
 *   customer's ONT) → the PON port the ONT is registered on (`onts.oltId` / `ponPortId`) → OLT, plus
 *   the VLAN tags, profile, IP or circuit id on the service record, each only as written.
 *
 * Both are shown side by side and every place they disagree is named. A value nobody recorded is
 * "Not recorded"; nothing is filled in. The rules here are warnings only (a wrong rule must never
 * stop field work): a VLAN used twice on one PON port when the setting says it must be unique, and a
 * service whose ONT is registered on a different PON port than the one its fibres reach.
 */

export const NOT_RECORDED = 'Not recorded';

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

export interface LogicalSettings {
  /** A VLAN tag (or S-VLAN and C-VLAN pair) may be used by only one service on one PON port. */
  vlanUniquePerPon: boolean;
}

export interface LogicalSettingDef {
  id: string;
  key: keyof LogicalSettings;
  label: string;
  defaultValue: boolean;
  source: string;
}

export const LOGICAL_SETTING_DEFS: readonly LogicalSettingDef[] = [
  {
    id: 'logical.vlanUniquePerPon',
    key: 'vlanUniquePerPon',
    label: 'Each VLAN may be used by only one service on a PON port',
    defaultValue: false,
    source:
      'Proposed, off by default. Many operators give every customer on a port the same internet VLAN (N:1, often with PPPoE), so a repeated VLAN is normal there. Turn this on only if your OLT gives each customer their own VLAN (1:1). It only warns; nothing is blocked.',
  },
];

/** Defaults with the operator's overrides. A value of the wrong type is ignored. */
export function resolveLogicalSettings(overrides: readonly Pick<Setting, 'id' | 'value'>[] = []): LogicalSettings {
  const byId = new Map(overrides.map((o) => [o.id, o.value]));
  const settings: LogicalSettings = { vlanUniquePerPon: false };
  for (const def of LOGICAL_SETTING_DEFS) {
    const value = byId.get(def.id);
    settings[def.key] = typeof value === 'boolean' ? value : def.defaultValue;
  }
  return settings;
}

export const DEFAULT_LOGICAL_SETTINGS: LogicalSettings = resolveLogicalSettings();

/* ------------------------------------------------------------------ */
/* Words                                                               */
/* ------------------------------------------------------------------ */

export type LogicalData = FiberData & { onts?: readonly Ont[]; services?: readonly Service[] };

export interface PonRef {
  oltId: string;
  ponPortId: string;
}

const samePon = (a: PonRef, b: PonRef) => a.oltId === b.oltId && a.ponPortId === b.ponPortId;
const ponId = (p: PonRef) => `${p.oltId}/${p.ponPortId}`;

/**
 * How a customer is named on these screens. The server already hides a name the role may not see
 * (Phase 12); then the id is used, so a list of "Hidden for your role" stays readable.
 */
export function customerLabel(c: Pick<Customer, 'id' | 'name' | 'hiddenFields'>): string {
  const hidden = c.hiddenFields?.includes('name') || c.name === CUSTOMER_HIDDEN_TEXT;
  return hidden ? `Customer ${c.id} (name hidden for your role)` : c.name;
}

/** "OLT-1 PON-02", with the OLT's name when it is on record. */
export function ponText(equipment: ReadonlyMap<string, Equipment> | readonly Equipment[], p: PonRef): string {
  const olt = Array.isArray(equipment) ? (equipment as readonly Equipment[]).find((e) => e.id === p.oltId) : (equipment as ReadonlyMap<string, Equipment>).get(p.oltId);
  return `${olt ? olt.name : `${p.oltId} (not on record)`} ${p.ponPortId}`;
}

/** The VLAN tags of a service in plain words. */
export function vlanText(s: Pick<Service, 'vlan' | 'sVlan' | 'cVlan'>): string {
  const parts: string[] = [];
  if (s.vlan !== undefined) parts.push(`VLAN ${s.vlan}`);
  if (s.sVlan !== undefined || s.cVlan !== undefined) parts.push(`S-VLAN ${s.sVlan ?? 'not recorded'}, C-VLAN ${s.cVlan ?? 'not recorded'}`);
  return parts.length ? parts.join(' · ') : `VLAN ${NOT_RECORDED.toLowerCase()}`;
}

/** The tag that must be unique when the setting is on, or nothing when no tag is recorded. */
export function vlanKey(s: Pick<Service, 'vlan' | 'sVlan' | 'cVlan'>): string | undefined {
  if (s.sVlan !== undefined || s.cVlan !== undefined) return `S${s.sVlan ?? '-'}/C${s.cVlan ?? '-'}`;
  return s.vlan !== undefined ? `V${s.vlan}` : undefined;
}

export const hasBinding = (s: Service): boolean =>
  s.vlan !== undefined || s.sVlan !== undefined || s.cVlan !== undefined || !!s.profileName || !!s.ipAddress || !!s.circuitId;

/** A short line for a service: kind, status and its binding, each "as written". */
export function serviceBindingLine(s: Service): string {
  return [
    SERVICE_KIND_LABELS[s.kind],
    SERVICE_STATUS_LABELS[s.status],
    vlanText(s),
    s.profileName ? `profile "${s.profileName}" as written` : undefined,
    s.ipAddress ? `IP ${s.ipAddress} as written` : undefined,
    s.circuitId ? `circuit ${s.circuitId}` : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
}

const ontLabel = (o: Ont) => `ONT ${o.serialNumber || `${o.id} (serial not recorded)`}`;
const ponPortsOf = (olt: Equipment): PonPort[] => olt.ponPorts ?? buildOltPonPorts(olt);

/* ------------------------------------------------------------------ */
/* What the fibre links reach                                          */
/* ------------------------------------------------------------------ */

export interface LinkedPon {
  pon?: PonRef;
  /** Why the links do not decide a PON port. */
  gap?: string;
  /** What the answer was worked out from. */
  via: 'ont_drop' | 'ont_splitter' | 'customer' | 'none';
}

/** Shared within one run. */
export interface LogicalCache {
  paths: CustomerPathCache;
  data: LogicalData;
  ontPon: Map<string, LinkedPon>;
}

export const logicalCache = (data: LogicalData, paths?: CustomerPathCache): LogicalCache => ({ paths: paths ?? customerPathCache(data), data, ontPon: new Map() });

const fromPath = (path: LinkedCustomerPath): Pick<LinkedPon, 'pon' | 'gap'> =>
  path.values.oltId && path.values.ponPort ? { pon: { oltId: path.values.oltId, ponPortId: path.values.ponPort } } : { gap: path.gaps[0] ?? 'The fibre links do not reach a PON port.' };

/** The PON port a customer's own fibre links reach. */
export function linkedPonOfCustomer(cache: LogicalCache, customer: Customer): LinkedPon {
  return { ...fromPath(customerPathFromLinks(customer, cache.paths)), via: 'customer' };
}

/**
 * The PON port an ONT's fibres reach: its own recorded drop fibre first (where it is plugged in),
 * else its recorded splitter output, else its customers' links (when they all agree).
 */
export function linkedPonOfOnt(cache: LogicalCache, ont: Ont): LinkedPon {
  const known = cache.ontPon.get(ont.id);
  if (known) return known;
  let result: LinkedPon;
  if (ont.dropCableId && ont.dropCore) {
    // The path walker takes a customer; this stands in for the ONT's own plug, under an id no customer has.
    const stand = { id: `ont:${ont.id}`, name: ontLabel(ont), status: 'Active', dropCableId: ont.dropCableId, fiberCore: ont.dropCore } as Customer;
    result = { ...fromPath(customerPathFromLinks(stand, cache.paths)), via: 'ont_drop' };
  } else if (ont.splitterId && cache.paths.index.splitters.get(ont.splitterId)) {
    const up = upstreamOfSplitter(cache.paths, cache.paths.index.splitters.get(ont.splitterId)!);
    result = up.oltId && up.ponPortId ? { pon: { oltId: up.oltId, ponPortId: up.ponPortId }, via: 'ont_splitter' } : { gap: up.gap ?? 'The splitter is not linked to a PON port.', via: 'ont_splitter' };
  } else {
    const users = customersOnOnt(cache.data, ont.id).filter(isPonCustomer);
    const found = users.map((c) => linkedPonOfCustomer(cache, c));
    const pons = found.filter((f) => f.pon);
    if (users.length === 0) result = { gap: `${ontLabel(ont)} has no drop fibre, splitter output or customer recorded.`, via: 'none' };
    else if (pons.length === 0) result = { gap: found[0].gap, via: 'customer' };
    else if (pons.some((p) => !samePon(p.pon!, pons[0].pon!))) result = { gap: `The customers on ${ontLabel(ont)} reach different PON ports.`, via: 'customer' };
    else result = { pon: pons[0].pon, via: 'customer' };
  }
  cache.ontPon.set(ont.id, result);
  return result;
}

/* ------------------------------------------------------------------ */
/* Service bindings                                                    */
/* ------------------------------------------------------------------ */

export type PonAgreement = 'agrees' | 'disagrees' | 'not_decided' | 'not_recorded';

export interface ServiceBinding {
  service: Service;
  customer?: Customer;
  /** The ONT named by the service, else the customer's ONT record. */
  ont?: Ont;
  ontFrom: 'service' | 'customer' | 'none';
  /** The PON port the ONT is recorded as registered on. */
  recordedPon?: PonRef;
  linked: LinkedPon;
  agreement: PonAgreement;
}

export function bindingOf(cache: LogicalCache, service: Service): ServiceBinding {
  const { data } = cache;
  const customer = data.customers.find((c) => c.id === service.customerId);
  const onts = data.onts ?? [];
  const named = service.ontId ? onts.find((o) => o.id === service.ontId) : undefined;
  const own = !named && customer?.ontId ? onts.find((o) => o.id === customer.ontId) : undefined;
  const ont = named ?? own;
  const recordedPon = ont?.oltId && ont.ponPortId ? { oltId: ont.oltId, ponPortId: ont.ponPortId } : undefined;
  const linked: LinkedPon = ont ? linkedPonOfOnt(cache, ont) : customer ? linkedPonOfCustomer(cache, customer) : { gap: 'The customer is not on record.', via: 'none' };
  const agreement: PonAgreement = !recordedPon ? 'not_recorded' : !linked.pon ? 'not_decided' : samePon(recordedPon, linked.pon) ? 'agrees' : 'disagrees';
  return { service, customer, ont, ontFrom: named ? 'service' : own ? 'customer' : 'none', recordedPon, linked, agreement };
}

/** Bindings of every live service of a PON (fibre) customer. Ended services are history. */
export function serviceBindings(data: LogicalData, cache: LogicalCache = logicalCache(data)): ServiceBinding[] {
  const out: ServiceBinding[] = [];
  for (const s of data.services ?? []) {
    if (!isLiveService(s)) continue;
    const customer = data.customers.find((c) => c.id === s.customerId);
    if (customer && !isPonCustomer(customer)) continue;
    out.push(bindingOf(cache, s));
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Rules (warnings only)                                               */
/* ------------------------------------------------------------------ */

const serviceWho = (b: ServiceBinding) => `${b.service.id} (${SERVICE_KIND_LABELS[b.service.kind]}${b.customer ? `, ${customerLabel(b.customer)}` : ''})`;

/**
 * Warnings about the logical layer:
 * - `vlan_twice_on_pon`: with `logical.vlanUniquePerPon` on, two or more live services on one PON
 *   port carry the same VLAN tag (or S-VLAN and C-VLAN pair). The port is the ONT's registration,
 *   else the one its fibres reach; a service on neither is not compared.
 * - `service_pon_mismatch`: an ONT with live services is registered on one PON port, but its fibres
 *   reach another. Both are named. When the links stop before a PON port nothing is said.
 */
export function findLogicalProblems(data: LogicalData, settings: LogicalSettings = DEFAULT_LOGICAL_SETTINGS, cache: LogicalCache = logicalCache(data)): FiberProblem[] {
  const problems: FiberProblem[] = [];
  const equipment = cache.paths.index.equipment;
  const bindings = serviceBindings(data, cache);

  const byOnt = new Map<string, ServiceBinding[]>();
  for (const b of bindings) if (b.ont && b.agreement === 'disagrees') byOnt.set(b.ont.id, [...(byOnt.get(b.ont.id) ?? []), b]);
  for (const [ontId, list] of byOnt) {
    const { ont, recordedPon, linked } = list[0];
    problems.push({
      severity: 'warning',
      code: 'service_pon_mismatch',
      key: `service_pon_mismatch:${ontId}:${ponId(recordedPon!)}:${ponId(linked.pon!)}`,
      message: `${ontLabel(ont!)} is recorded as registered on ${ponText(equipment, recordedPon!)}, but its fibres reach ${ponText(equipment, linked.pon!)}. Services on it: ${list.map(serviceWho).join(', ')}. Check which port the OLT shows it on, then fix the ONT record or the fibre links.`,
      refs: [ontId, ...list.map((b) => b.service.id), recordedPon!.oltId, linked.pon!.oltId],
    });
  }

  if (settings.vlanUniquePerPon) {
    const groups = new Map<string, { pon: PonRef; tag: string; list: ServiceBinding[] }>();
    for (const b of bindings) {
      const tag = vlanKey(b.service);
      const pon = b.recordedPon ?? b.linked.pon;
      if (!tag || !pon) continue;
      const key = `${ponId(pon)}|${tag}`;
      const g = groups.get(key) ?? { pon, tag, list: [] };
      g.list.push(b);
      groups.set(key, g);
    }
    for (const [key, g] of groups) {
      if (g.list.length < 2) continue;
      problems.push({
        severity: 'warning',
        code: 'vlan_twice_on_pon',
        key: `vlan_twice_on_pon:${key}`,
        message: `${vlanText(g.list[0].service)} is used by ${g.list.length} services on ${ponText(equipment, g.pon)}: ${g.list.map(serviceWho).join(', ')}. The setting "${LOGICAL_SETTING_DEFS[0].label}" is on. Check the VLANs with the OLT.`,
        refs: [...g.list.map((b) => b.service.id), g.pon.oltId],
      });
    }
  }
  return problems;
}

/** Logical warnings a change adds. Ones already in the data are not blamed on it. */
export function newLogicalProblems(before: LogicalData, after: LogicalData, settings: LogicalSettings = DEFAULT_LOGICAL_SETTINGS): FiberProblem[] {
  const old = new Set(findLogicalProblems(before, settings).map((p) => p.key));
  return findLogicalProblems(after, settings).filter((p) => !old.has(p.key));
}

/* ------------------------------------------------------------------ */
/* Combined view: physical next to logical                             */
/* ------------------------------------------------------------------ */

export type CombinedTarget = { kind: 'olt'; id: string } | { kind: 'pon'; oltId: string; ponPortId: string } | { kind: 'splitter'; id: string } | { kind: 'customer'; id: string };

export interface CombinedStep {
  label: string;
  value: string;
  /** `missing`: nothing recorded or decided. `mismatch`: disagrees with the other side. */
  status: 'ok' | 'missing' | 'mismatch';
  ref?: { type: 'equipment' | 'customer' | 'cable'; id: string };
}

export interface CombinedService {
  service: Service;
  title: string;
  steps: CombinedStep[];
}

export interface CombinedRow {
  key: string;
  customer: Customer;
  customerLabel: string;
  physical: CombinedStep[];
  physicalGaps: string[];
  ont?: Ont;
  logical: CombinedStep[];
  services: CombinedService[];
  /** Older fields on the customer record (plan, IP), as written. */
  olderFields: string[];
  /** Every place the two sides disagree, in plain words. */
  disagreements: string[];
  pon: PonAgreement;
}

export interface CombinedView {
  title: string;
  rows: CombinedRow[];
  /** Logical warnings that concern these rows. */
  findings: FiberProblem[];
  counts: { customers: number; agree: number; disagree: number; notDecided: number; notRecorded: number };
}

const step = (label: string, value: string | undefined, extra: Partial<CombinedStep> = {}): CombinedStep => ({ label, value: value ?? NOT_RECORDED, status: value ? 'ok' : 'missing', ...extra });

function targetTitle(data: LogicalData, target: CombinedTarget): string {
  switch (target.kind) {
    case 'olt':
      return `OLT ${data.equipment.find((e) => e.id === target.id)?.name ?? `${target.id} (not on record)`}`;
    case 'pon':
      return `PON port ${ponText(data.equipment, target)}`;
    case 'splitter':
      return `Splitter ${data.splitters.find((s) => s.id === target.id)?.name ?? `${target.id} (not on record)`}`;
    case 'customer': {
      const c = data.customers.find((x) => x.id === target.id);
      return c ? customerLabel(c) : `Customer ${target.id} (not on record)`;
    }
  }
}

/** The customer's ONT record: the one they name, else one a live service of theirs names. */
function ontOf(data: LogicalData, c: Customer): Ont | undefined {
  const onts = data.onts ?? [];
  const own = c.ontId ? onts.find((o) => o.id === c.ontId) : undefined;
  if (own) return own;
  const sid = (data.services ?? []).find((s) => s.customerId === c.id && isLiveService(s) && s.ontId)?.ontId;
  return sid ? onts.find((o) => o.id === sid) : undefined;
}

/** Whether a customer belongs under the target, by the links or by anything recorded about them. */
function inTarget(cache: LogicalCache, c: Customer, target: CombinedTarget): boolean {
  if (target.kind === 'customer') return c.id === target.id;
  const path = customerPathFromLinks(c, cache.paths);
  const ont = ontOf(cache.data, c);
  const linkedOnt = ont ? linkedPonOfOnt(cache, ont).pon : undefined;
  if (target.kind === 'splitter') return path.values.splitterId === target.id || c.splitterId === target.id || ont?.splitterId === target.id;
  const oltMatch = (oltId?: string) => oltId === (target.kind === 'olt' ? target.id : target.oltId);
  const match = (oltId?: string, pon?: string) => (target.kind === 'olt' ? oltMatch(oltId) : oltMatch(oltId) && pon === target.ponPortId);
  return match(path.values.oltId, path.values.ponPort) || match(c.oltId, c.ponPort) || match(ont?.oltId, ont?.ponPortId) || match(linkedOnt?.oltId, linkedOnt?.ponPortId);
}

function rowFor(cache: LogicalCache, c: Customer): CombinedRow {
  const { data } = cache;
  const index = cache.paths.index;
  const path = customerPathFromLinks(c, cache.paths);
  const v = path.values;
  const name = (id: string | undefined, kind: 'equipment' | 'cable') => (id ? (kind === 'equipment' ? index.equipment.get(id)?.name : index.cables.get(id)?.name) ?? `${id} (not on record)` : undefined);
  const ont = ontOf(data, c);
  const linkedOnt = ont ? linkedPonOfOnt(cache, ont) : linkedPonOfCustomer(cache, c);
  const recordedPon = ont?.oltId && ont.ponPortId ? { oltId: ont.oltId, ponPortId: ont.ponPortId } : undefined;
  const pon: PonAgreement = !recordedPon ? 'not_recorded' : !linkedOnt.pon ? 'not_decided' : samePon(recordedPon, linkedOnt.pon) ? 'agrees' : 'disagrees';
  const disagreements: string[] = [];
  const ponMismatch = pon === 'disagrees';
  if (ponMismatch) disagreements.push(`PON port: the ONT record says ${ponText(index.equipment, recordedPon!)}; the fibre links reach ${ponText(index.equipment, linkedOnt.pon!)}.`);
  // The ONT's own plug decides its port; when that is not the customer's own drop fibre, it is shown apart.
  const ontOwnPath = !!ont && linkedOnt.via !== 'customer' && !(ont.dropCableId === c.dropCableId && ont.dropCore === c.fiberCore);

  const physical: CombinedStep[] = [
    step('OLT', name(v.oltId, 'equipment'), v.oltId ? { ref: { type: 'equipment', id: v.oltId } } : {}),
    step('PON port', v.ponPort, ponMismatch && !ontOwnPath ? { status: 'mismatch' } : {}),
    step('Feeder cable', name(v.feederCableId, 'cable'), v.feederCableId ? { ref: { type: 'cable', id: v.feederCableId } } : {}),
    step('Distribution cable', name(v.distributionCableId, 'cable'), v.distributionCableId ? { ref: { type: 'cable', id: v.distributionCableId } } : {}),
    step('Box', name(v.terminalBoxId, 'equipment'), v.terminalBoxId ? { ref: { type: 'equipment', id: v.terminalBoxId } } : {}),
    step('Splitter output', v.splitterId ? `Output ${v.splitterOutputPort ?? '?'} of ${index.splitters.get(v.splitterId)?.name ?? v.splitterId}` : undefined),
    step('Drop fibre', v.dropCableId && v.fiberCore ? describeCore(index, v.dropCableId, v.fiberCore) : undefined, v.dropCableId ? { ref: { type: 'cable', id: v.dropCableId } } : {}),
  ];
  if (ontOwnPath) {
    physical.push(step('PON port the ONT’s own fibre reaches', linkedOnt.pon ? ponText(index.equipment, linkedOnt.pon) : undefined, ponMismatch ? { status: 'mismatch' } : {}));
  }

  const logical: CombinedStep[] = [];
  if (ont) {
    logical.push(step('ONT', `${ontLabel(ont)}${[ont.vendor, ont.model].filter(Boolean).length ? ` (${[ont.vendor, ont.model].filter(Boolean).join(' ')})` : ''}`));
    logical.push(step('Registered on (ONT record)', recordedPon ? ponText(index.equipment, recordedPon) : undefined, ponMismatch ? { status: 'mismatch' } : {}));
    logical.push(step('OLT address of the ONT, as written', ont.onuAddress));
    const outText = ont.splitterId ? `Output ${ont.splitterOutputPort ?? '?'} of ${index.splitters.get(ont.splitterId)?.name ?? ont.splitterId}` : undefined;
    const outMismatch = !!ont.splitterId && !!v.splitterId && (ont.splitterId !== v.splitterId || (ont.splitterOutputPort !== undefined && ont.splitterOutputPort !== v.splitterOutputPort));
    logical.push(step('Splitter output (ONT record)', outText, outMismatch ? { status: 'mismatch' } : {}));
    if (outMismatch) disagreements.push(`Splitter output: the ONT record says ${outText}; the fibre links lead to output ${v.splitterOutputPort ?? '?'} of ${index.splitters.get(v.splitterId!)?.name ?? v.splitterId}.`);
    const dropMismatch = !!ont.dropCableId && !!c.dropCableId && (ont.dropCableId !== c.dropCableId || (ont.dropCore ?? 0) !== c.fiberCore);
    if (dropMismatch) disagreements.push(`Drop fibre: the ONT record says fibre ${ont.dropCore ?? '?'} of ${name(ont.dropCableId, 'cable')}; the customer is on fibre ${c.fiberCore} of ${name(c.dropCableId, 'cable')}.`);
    if (!isLiveOnt(ont)) disagreements.push(`${ontLabel(ont)} is recorded as removed.`);
  } else {
    logical.push(step('ONT', c.ontSerialNumber?.trim() ? `ONT ${c.ontSerialNumber.trim()} (written on the customer record; no ONT record)` : undefined));
    logical.push(step('Registered on (ONT record)', undefined));
  }

  const services: CombinedService[] = (data.services ?? [])
    .filter((s) => s.customerId === c.id && isLiveService(s))
    .map((s) => {
      const steps: CombinedStep[] = [];
      if (s.ontId && ont && s.ontId !== ont.id) {
        steps.push(step('ONT named on the service', s.ontId, { status: 'mismatch' }));
        disagreements.push(`Service ${s.id} names ONT ${s.ontId}, which is not this customer's ONT.`);
      } else if (!s.ontId) steps.push(step('ONT named on the service', ont ? `None; uses the customer's ${ontLabel(ont)}` : undefined));
      if (s.sVlan !== undefined || s.cVlan !== undefined) {
        steps.push(step('S-VLAN (outer tag)', s.sVlan?.toString()));
        steps.push(step('C-VLAN (inner tag)', s.cVlan?.toString()));
        if (s.vlan !== undefined) steps.push(step('VLAN', s.vlan.toString()));
      } else steps.push(step('VLAN', s.vlan?.toString()));
      steps.push(step('Profile, as written', s.profileName));
      steps.push(step('Plan, as written', s.planName));
      steps.push(step('IP, as written', s.ipAddress));
      steps.push(step('Circuit id, as written', s.circuitId));
      steps.push(step('ONT port, as written', s.ontPort));
      steps.push(step('Who and when', s.bindingRecordedAt ? `${s.bindingRecordedBy ?? 'Name not recorded'}, ${s.bindingRecordedAt.slice(0, 10)}` : undefined));
      return { service: s, title: `${SERVICE_KIND_LABELS[s.kind]} · ${SERVICE_STATUS_LABELS[s.status]}`, steps };
    });

  const olderFields = [c.plan?.trim() ? `Plan "${c.plan.trim()}"` : undefined, c.ipAddress?.trim() ? `IP ${c.ipAddress.trim()}` : undefined].filter((x): x is string => !!x);
  return { key: c.id, customer: c, customerLabel: customerLabel(c), physical, physicalGaps: path.gaps, ont, logical, services, olderFields, disagreements, pon };
}

/**
 * The physical path from the fibre links next to the logical binding for every fibre customer under
 * an OLT, PON port, splitter, or one customer. A customer is listed when the links reach the target
 * or anything recorded about them (customer fields, ONT record) names it, so a disagreement shows
 * from either side.
 */
export function combinedView(data: LogicalData, target: CombinedTarget, settings: LogicalSettings = DEFAULT_LOGICAL_SETTINGS): CombinedView {
  const cache = logicalCache(data);
  const customers = data.customers.filter((c) => (target.kind === 'customer' ? c.id === target.id : isPonCustomer(c)) && inTarget(cache, c, target));
  const rows = customers.map((c) => rowFor(cache, c));
  const ids = new Set(rows.flatMap((r) => [r.customer.id, ...(r.ont ? [r.ont.id] : []), ...r.services.map((s) => s.service.id)]));
  const findings = findLogicalProblems(data, settings, cache).filter((p) => p.refs.some((ref) => ids.has(ref)));
  for (const f of findings) {
    if (f.code !== 'vlan_twice_on_pon') continue;
    for (const r of rows) if (r.services.some((s) => f.refs.includes(s.service.id))) r.disagreements.push(f.message);
  }
  return {
    title: targetTitle(data, target),
    rows,
    findings,
    counts: {
      customers: rows.length,
      agree: rows.filter((r) => r.pon === 'agrees').length,
      disagree: rows.filter((r) => r.pon === 'disagrees').length,
      notDecided: rows.filter((r) => r.pon === 'not_decided').length,
      notRecorded: rows.filter((r) => r.pon === 'not_recorded').length,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Commands                                                            */
/* ------------------------------------------------------------------ */

export interface ServiceBindingDraft {
  vlan?: number;
  sVlan?: number;
  cVlan?: number;
  profileName?: string;
  ipAddress?: string;
  circuitId?: string;
}

const BINDING_KEYS = ['vlan', 'sVlan', 'cVlan', 'profileName', 'ipAddress', 'circuitId'] as const;
const validVlan = (n: number | undefined) => n === undefined || (Number.isInteger(n) && n >= 1 && n <= 4094);

const historyLine = (action: string, details: string, ctx: CommandContext) => ({
  at: (ctx.now ?? new Date()).toISOString(),
  ...(ctx.actor ? { by: ctx.actor } : {}),
  action,
  details: details.slice(0, 500),
});

/** Adds the logical warnings a change adds to a checked result: asked first, accepted into the audit trail. */
function withLogicalWarnings<T>(data: NetworkData, result: CommandResult<T>, settings: LogicalSettings, assetId: string, assetType: AuditEntry['assetType']): CommandResult<T> {
  if (!result.ok) return result;
  const after = { ...data, ...result.patch } as NetworkData;
  const warnings = newLogicalProblems(data, after, settings);
  if (warnings.length === 0) return result;
  const text = warnings.map((w) => w.message).join(' ');
  return {
    ...result,
    audit: [...result.audit, { action: 'WARNING_ACCEPTED', details: `Saved after the warning: ${text}`.slice(0, 2000), assetId, assetType }],
    confirm: result.confirm ? `${result.confirm.replace(/ Save anyway\?$/, '')} ${text} Save anyway?` : `Please check: ${text} Save anyway?`,
  };
}

/**
 * Records a service's logical binding exactly as the person typed it. Every field is replaced:
 * one left out is removed (it becomes "Not recorded"). A VLAN outside 1 to 4094 is refused,
 * because no network can carry it.
 */
export function saveServiceBinding(data: NetworkData, serviceId: string, draft: ServiceBindingDraft, ctx: CommandContext = {}, settings: LogicalSettings = DEFAULT_LOGICAL_SETTINGS): CommandResult<Service> {
  const service = (data.services ?? []).find((s) => s.id === serviceId);
  if (!service) return fail('Service missing', `Service ${serviceId} was not found.`);
  if (!isLiveService(service)) return fail('Service ended', 'This service has ended and is kept as history.');
  for (const key of ['vlan', 'sVlan', 'cVlan'] as const) {
    if (!validVlan(draft[key])) return fail('Not a VLAN', `A VLAN is a whole number from 1 to 4094. ${draft[key]} cannot be used.`);
  }
  const next: Service = { ...service };
  for (const key of BINDING_KEYS) {
    const value = draft[key];
    const clean = typeof value === 'string' ? value.trim() : value;
    if (clean === undefined || clean === '') delete next[key];
    else (next as Record<string, unknown>)[key] = clean;
  }
  const changed = BINDING_KEYS.some((k) => next[k] !== service[k]);
  if (!changed) return fail('Nothing changed', 'The binding is the same as before.', 'info');
  next.bindingRecordedAt = (ctx.now ?? new Date()).toISOString();
  if (ctx.actor) next.bindingRecordedBy = ctx.actor;
  else delete next.bindingRecordedBy;
  const summary = serviceBindingLine(next);
  next.history = [...(service.history ?? []), historyLine('BINDING_RECORDED', summary, ctx)];
  const result = checkedConnectionChange(data, { services: (data.services ?? []).map((s) => (s.id === next.id ? next : s)) }, next, {
    notice: { tone: 'success', title: 'Service settings saved', message: `${service.id}: ${summary}.` },
    audit: [{ action: 'SERVICE_BINDING_RECORDED', details: `${service.id} for ${service.customerId}: ${summary}`, assetId: service.id, assetType: 'Service' }],
  }, ctx);
  return withLogicalWarnings(data, result, settings, service.id, 'Service');
}

/**
 * Records which PON port the OLT has an ONT registered on, as a person read it from the OLT. `null`
 * clears it ("Not recorded"). An OLT or port that is not on record is refused. When the fibres reach
 * another port, the person is asked first and the acceptance goes into the audit trail.
 */
export function setOntRegistration(data: NetworkData, ontId: string, registration: PonRef | null, ctx: CommandContext = {}, settings: LogicalSettings = DEFAULT_LOGICAL_SETTINGS): CommandResult<Ont> {
  const ont = (data.onts ?? []).find((o) => o.id === ontId);
  if (!ont) return fail('ONT missing', `ONT ${ontId} was not found.`);
  if (!isLiveOnt(ont)) return fail('ONT is history', `${ontLabel(ont)} was removed and is kept as history.`);
  const next: Ont = { ...ont };
  if (registration) {
    const olt = data.equipment.find((e) => e.id === registration.oltId && e.type === 'OLT');
    if (!olt) return fail('OLT missing', `OLT ${registration.oltId} is not on record.`);
    if (!ponPortsOf(olt).some((p) => p.id === registration.ponPortId)) return fail('Port missing', `${olt.name} has no port ${registration.ponPortId}.`);
    next.oltId = olt.id;
    next.ponPortId = registration.ponPortId;
  } else {
    delete next.oltId;
    delete next.ponPortId;
  }
  if (next.oltId === ont.oltId && next.ponPortId === ont.ponPortId) return fail('Nothing changed', 'The registration is the same as before.', 'info');
  const words = registration ? `registered on ${ponText(data.equipment, registration)}` : 'registration cleared (not recorded)';
  next.history = [...(ont.history ?? []), historyLine('REGISTRATION_RECORDED', words, ctx)];
  const result = checkedConnectionChange(data, { onts: (data.onts ?? []).map((o) => (o.id === next.id ? next : o)) }, next, {
    notice: { tone: 'success', title: 'Registration saved', message: `${ontLabel(ont)}: ${words}.` },
    audit: [{ action: 'ONT_REGISTRATION_RECORDED', details: `${ont.id}: ${words}`, assetId: ont.id, assetType: 'ONT' }],
  }, ctx);
  return withLogicalWarnings(data, result, settings, ont.id, 'ONT');
}

/** Choices for the combined view: every OLT, PON port, splitter and fibre customer on record. */
export function combinedTargets(data: LogicalData): { key: string; target: CombinedTarget; label: string; group: 'OLT' | 'PON port' | 'Splitter' | 'Customer' }[] {
  const out: ReturnType<typeof combinedTargets> = [];
  for (const olt of data.equipment.filter((e) => e.type === 'OLT')) {
    out.push({ key: `olt:${olt.id}`, target: { kind: 'olt', id: olt.id }, label: olt.name, group: 'OLT' });
    for (const p of olt.ponPorts ?? []) out.push({ key: `pon:${olt.id}/${p.id}`, target: { kind: 'pon', oltId: olt.id, ponPortId: p.id }, label: `${olt.name} ${p.id}`, group: 'PON port' });
  }
  for (const s of data.splitters) out.push({ key: `splitter:${s.id}`, target: { kind: 'splitter', id: s.id }, label: `${s.name} (${s.ratio})`, group: 'Splitter' });
  for (const c of data.customers.filter(isPonCustomer)) out.push({ key: `customer:${c.id}`, target: { kind: 'customer', id: c.id }, label: customerLabel(c) === c.name ? `${c.name} · ${c.id}` : customerLabel(c), group: 'Customer' });
  return out;
}
