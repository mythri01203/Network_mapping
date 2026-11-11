import { type ColorScheme, DEFAULT_COLOR_SCHEMES } from '../fiber/colors';
import type { CollectionName } from '../model/collections';
import type { LinkVerification } from '../model/linkVerificationSchemas';
import type { RfElement, RfLink } from '../model/rfSchemas';
import type { Cable, Customer, Equipment, JointClosure, Ont, Splitter } from '../model/types';
import { spliceDirectionMismatch } from './closureTrays';
import { type CoreKey, coreKey, describeCore } from './fiberIndex';
import { connectorClash } from './fiberRules';

/**
 * Network mapping Phase 13: ONE read-only list of every physical link FiberGIS knows about, built
 * from the fields where each kind of link is recorded today (splices on closures, feeder fibres and
 * patch cords on ODF ports, splitter inputs and outputs, customer and ONT fields, cable ends,
 * logical ports, the older `connectedTo*` fields on fibres, Cable TV links). Nothing is stored here
 * and nothing is worked out from position: a link appears only because a record says so, and it
 * says where it is recorded. The existing fields and commands are unchanged; this index only reads
 * them. Built once in one pass over the records (linear in their size), then looked up by element
 * or by fibre.
 */

export const CONNECTION_KINDS = [
  'splice',
  'closure_pigtail',
  'odf_rear',
  'odf_patch',
  'pon_feeder',
  'pon_splitter',
  'splitter_input',
  'splitter_cascade',
  'splitter_output',
  'splitter_customer',
  'splitter_equipment',
  'customer_drop',
  'customer_splitter',
  'customer_ont',
  'ont_drop',
  'ont_splitter',
  'ont_pon',
  'cable_end',
  'logical_port',
  'core_equipment',
  'core_splice_target',
  'rf_link',
] as const;
export type ConnectionKind = (typeof CONNECTION_KINDS)[number];

/** What each kind of link is, in plain words. */
export const CONNECTION_KIND_LABELS: Record<ConnectionKind, string> = {
  splice: 'Splice (fibre joined to fibre)',
  closure_pigtail: 'Fibre ends on a connector in a closure',
  odf_rear: 'Fibre behind an ODF port',
  odf_patch: 'Patch cord from an ODF port to an OLT port',
  pon_feeder: 'OLT port straight onto a fibre (no ODF)',
  pon_splitter: 'OLT port to a splitter (as written on the port)',
  splitter_input: 'Fibre into a splitter',
  splitter_cascade: 'Splitter output into another splitter',
  splitter_output: 'Splitter output onto a fibre',
  splitter_customer: 'Splitter output to a customer (as written on the splitter)',
  splitter_equipment: 'Splitter output to a box (as written on the splitter)',
  customer_drop: 'Customer on a drop fibre (as written on the customer)',
  customer_splitter: 'Customer on a splitter output (as written on the customer)',
  customer_ont: "Customer's ONT",
  ont_drop: 'ONT on a drop fibre',
  ont_splitter: 'ONT on a splitter output',
  ont_pon: 'ONT registered on an OLT port',
  cable_end: 'Cable end at an item',
  logical_port: 'Port link (as written on the port)',
  core_equipment: 'Fibre to an item (as written on the fibre)',
  core_splice_target: 'Fibre to another fibre (as written on the fibre)',
  rf_link: 'Cable TV link',
};

/** One end of a link, as a typed reference to the record it names. */
export type ConnectionEnd =
  | { type: 'core'; cableId: string; core: number }
  | { type: 'cable'; cableId: string }
  | { type: 'cable_end'; cableId: string; end: 'start' | 'end' }
  | { type: 'pon_port'; oltId: string; ponPortId: string }
  | { type: 'odf_port'; equipmentId: string; panelId: string; portId: string; portNumber: number; side: 'rear' | 'front' }
  | { type: 'splitter'; splitterId: string }
  | { type: 'splitter_input'; splitterId: string }
  | { type: 'splitter_output'; splitterId: string; port: number }
  | { type: 'customer'; customerId: string }
  | { type: 'ont'; ontId: string }
  | { type: 'equipment'; equipmentId: string; port?: string }
  | { type: 'equipment_port'; equipmentId: string; portId: string }
  /** A connector whose far side is written as text only (closure pigtails). Never a link to a record. */
  | { type: 'connector'; connectorType?: string; connectsTo?: string }
  | { type: 'rf_port'; elementId: string; portId: string };

export interface ConnectionSide {
  ref: ConnectionEnd;
  /** Plain words, such as "fibre 3 of FDR-01" or "output 2 of splitter SPL-1". */
  label: string;
  /** False when the end names a record (or a port or fibre of it) that is not on record. */
  onRecord: boolean;
}

/** `current`: recorded and not ended. `planned`: recorded as planned. `retired`: taken out, kept as history. `mistake`: struck out as entered by mistake. */
export type ConnectionState = 'current' | 'planned' | 'retired' | 'mistake';

export const CONNECTION_STATE_LABELS: Record<ConnectionState, string> = {
  current: 'On record',
  planned: 'Planned',
  retired: 'Taken out (history)',
  mistake: 'Entered by mistake (history)',
};

export type ConnectionWarningCode = 'end_not_on_record' | 'connector_mismatch' | 'direction' | 'two_feeds' | 'two_continuations' | 'loop';

export interface ConnectionWarning {
  code: ConnectionWarningCode;
  message: string;
}

export interface ConnectionRecordedIn {
  collection: CollectionName;
  recordId: string;
  /** The field path inside that record, such as `splices[SPC-1]` or `odfPanels[P1].ports[3].patch`. */
  field: string;
  /** Plain words, such as "Splice in closure CL-1". */
  label: string;
}

export interface Connection {
  /** Stable: made from the record and the field, so the same link has the same id every time. */
  id: string;
  kind: ConnectionKind;
  /** The OLT side when the record says which way the signal goes (`directed`), else the record's own end. */
  from: ConnectionSide;
  to: ConnectionSide;
  /** True when the record itself says which end is towards the OLT or headend. */
  directed: boolean;
  state: ConnectionState;
  /** The state in the record's own words, such as "Recorded as Spliced" or "Taken out 2026-02-01: re-spliced". */
  stateLabel: string;
  recordedIn: ConnectionRecordedIn;
  /** Who and when, only when the record has it. Absent: not recorded. */
  recordedBy?: string;
  recordedAt?: string;
  /** The closure, box or ODF where the link physically is, when recorded. */
  place?: { label: string; ids: string[] };
  /** A Cable TV link that runs in a recorded fibre. */
  via?: { cableId: string; core: number };
  /** Connectors as recorded at each end and the adapter they plug into. Absent: not recorded. */
  connectors?: { from?: string; to?: string; adapter?: string };
  warnings: ConnectionWarning[];
  /** The two ends as one string. A check made when the ends were different is out of date. */
  endsKey: string;
  /** Every record id this link is listed under (both ends, their hosts, the place). */
  elementIds: string[];
}

export interface ConnectionIndexData {
  equipment: readonly Equipment[];
  cables: readonly Cable[];
  splitters: readonly Splitter[];
  closures: readonly JointClosure[];
  customers: readonly Customer[];
  onts?: readonly Ont[];
  rfElements?: readonly RfElement[];
  rfLinks?: readonly RfLink[];
  linkVerifications?: readonly LinkVerification[];
}

export interface ConnectionIndex {
  connections: Connection[];
  byId: Map<string, Connection>;
  byElement: Map<string, Connection[]>;
  byCore: Map<CoreKey, Connection[]>;
  /** Checks of each connection id, newest first. */
  checks: Map<string, LinkVerification[]>;
  /** Checks naming a connection that is not in the index any more. Kept and shown, never deleted. */
  orphanChecks: LinkVerification[];
}

const push = <K, V>(map: Map<K, V[]>, key: K, value: V) => {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
};

/** One end as a stable string. */
export function endKey(ref: ConnectionEnd): string {
  switch (ref.type) {
    case 'core':
      return `core:${ref.cableId}#${ref.core}`;
    case 'cable':
      return `cable:${ref.cableId}`;
    case 'cable_end':
      return `cable-${ref.end}:${ref.cableId}`;
    case 'pon_port':
      return `pon:${ref.oltId}/${ref.ponPortId}`;
    case 'odf_port':
      return `odf:${ref.equipmentId}/${ref.panelId}/${ref.portId}/${ref.side}`;
    case 'splitter':
      return `splitter:${ref.splitterId}`;
    case 'splitter_input':
      return `splitter-in:${ref.splitterId}`;
    case 'splitter_output':
      return `splitter-out:${ref.splitterId}#${ref.port}`;
    case 'customer':
      return `customer:${ref.customerId}`;
    case 'ont':
      return `ont:${ref.ontId}`;
    case 'equipment':
      return `equipment:${ref.equipmentId}${ref.port ? `/${ref.port}` : ''}`;
    case 'equipment_port':
      return `port:${ref.equipmentId}/${ref.portId}`;
    case 'connector':
      return `connector:${ref.connectorType ?? ''}/${ref.connectsTo ?? ''}`;
    case 'rf_port':
      return `rf:${ref.elementId}/${ref.portId}`;
  }
}

/** The id prefixes this index makes, one per kind. A check naming anything else names no link FiberGIS knows. */
export const CONNECTION_ID_PREFIXES: Record<ConnectionKind, string> = {
  splice: 'splice',
  closure_pigtail: 'pigtail',
  odf_rear: 'odf-rear',
  odf_patch: 'odf-patch',
  pon_feeder: 'pon-feeder',
  pon_splitter: 'pon-splitter',
  splitter_input: 'splitter-in',
  splitter_cascade: 'splitter-cascade',
  splitter_output: 'splitter-out',
  splitter_customer: 'splitter-customer',
  splitter_equipment: 'splitter-box',
  customer_drop: 'customer-drop',
  customer_splitter: 'customer-splitter',
  customer_ont: 'customer-ont',
  ont_drop: 'ont-drop',
  ont_splitter: 'ont-splitter',
  ont_pon: 'ont-pon',
  cable_end: 'cable-end',
  logical_port: 'port',
  core_equipment: 'core-equipment',
  core_splice_target: 'core-splice',
  rf_link: 'rf',
};

const PREFIX_TO_KIND = new Map<string, ConnectionKind>(Object.entries(CONNECTION_ID_PREFIXES).map(([kind, prefix]) => [prefix, kind as ConnectionKind]));

/** The kind a connection id names, or undefined when it is not an id this index makes. */
export function connectionKindOfId(id: string): ConnectionKind | undefined {
  const i = id.indexOf(':');
  if (i <= 0 || i === id.length - 1) return undefined;
  return PREFIX_TO_KIND.get(id.slice(0, i));
}

const connectionId = (kind: ConnectionKind, ...parts: (string | number)[]) => `${CONNECTION_ID_PREFIXES[kind]}:${parts.join(':')}`;

const has = (value: string | undefined): value is string => typeof value === 'string' && value.trim() !== '';
const present = (value: string | undefined) => (has(value) ? value.trim() : undefined);

export interface ConnectionIndexOptions {
  /** False: customers are named by id only (for words that are stored, such as a check's label). */
  customerNames?: boolean;
}

/** Builds the index. Pure: the same records give the same list, in the same order. */
export function buildConnectionIndex(data: ConnectionIndexData, schemes: readonly ColorScheme[] = DEFAULT_COLOR_SCHEMES, options: ConnectionIndexOptions = {}): ConnectionIndex {
  const customerNames = options.customerNames !== false;
  const equipment = new Map(data.equipment.map((e) => [e.id, e]));
  const cables = new Map(data.cables.map((c) => [c.id, c]));
  const splitters = new Map(data.splitters.map((s) => [s.id, s]));
  const customers = new Map(data.customers.map((c) => [c.id, c]));
  const onts = new Map((data.onts ?? []).map((o) => [o.id, o]));
  const rfElements = new Map((data.rfElements ?? []).map((e) => [e.id, e]));
  const coreIndex = { cables, schemes };

  /** Every end with its words, whether it is on record, and the ids it is listed under. */
  const side = (ref: ConnectionEnd): ConnectionSide & { ids: string[] } => {
    switch (ref.type) {
      case 'core': {
        const cable = cables.get(ref.cableId);
        const ok = !!cable && Number.isInteger(ref.core) && ref.core >= 1 && ref.core <= cable.fiberCount;
        const label = cable ? describeCore(coreIndex, ref.cableId, ref.core) : `fibre ${ref.core} of cable ${ref.cableId}`;
        return { ref, label: ok ? label : `${label} (${cable ? `the cable has ${cable.fiberCount} fibres` : 'not on record'})`, onRecord: ok, ids: [ref.cableId] };
      }
      case 'cable':
      case 'cable_end': {
        const cable = cables.get(ref.cableId);
        const name = cable ? cable.name : `cable ${ref.cableId} (not on record)`;
        const label = ref.type === 'cable' ? `cable ${name}` : `${ref.end === 'start' ? 'start (From end)' : 'end (To end)'} of ${name}`;
        return { ref, label, onRecord: !!cable, ids: [ref.cableId] };
      }
      case 'pon_port': {
        const olt = equipment.get(ref.oltId);
        const pon = olt?.ponPorts?.find((p) => p.id === ref.ponPortId);
        const label = olt ? `${olt.name} ${ref.ponPortId}${pon ? '' : ' (port not on this OLT)'}` : `OLT ${ref.oltId} (not on record) ${ref.ponPortId}`;
        return { ref, label, onRecord: !!pon, ids: [ref.oltId] };
      }
      case 'odf_port': {
        const odf = equipment.get(ref.equipmentId);
        const panel = odf?.odfPanels?.find((p) => p.id === ref.panelId);
        return { ref, label: `${odf?.name ?? ref.equipmentId} ${panel?.label ?? ref.panelId} port ${ref.portNumber} (${ref.side === 'rear' ? 'back' : 'front'})`, onRecord: !!panel, ids: [ref.equipmentId] };
      }
      case 'splitter':
      case 'splitter_input':
      case 'splitter_output': {
        const sp = splitters.get(ref.splitterId);
        const name = sp ? sp.name : `${ref.splitterId} (not on record)`;
        const portOk = ref.type !== 'splitter_output' || !!sp?.outputPorts.some((p) => p.portNumber === ref.port);
        const label =
          ref.type === 'splitter' ? `splitter ${name}` : ref.type === 'splitter_input' ? `input of splitter ${name}` : `output ${ref.port} of splitter ${name}${sp && !portOk ? ' (no such output)' : ''}`;
        return { ref, label, onRecord: !!sp && portOk, ids: [ref.splitterId, ...(sp && has(sp.terminalBoxId) ? [sp.terminalBoxId] : [])] };
      }
      case 'customer': {
        const c = customers.get(ref.customerId);
        const label = !c ? `customer ${ref.customerId} (not on record)` : customerNames && c.name !== c.id ? `customer ${c.name} (${c.id})` : `customer ${c.id}`;
        return { ref, label, onRecord: !!c, ids: [ref.customerId] };
      }
      case 'ont': {
        const o = onts.get(ref.ontId);
        return { ref, label: o ? `ONT ${o.serialNumber ? o.serialNumber : '(serial not recorded)'} (${o.id})` : `ONT ${ref.ontId} (not on record)`, onRecord: !!o, ids: [ref.ontId] };
      }
      case 'equipment': {
        const e = equipment.get(ref.equipmentId);
        const port = ref.port ? `, port "${ref.port}" (as written)` : '';
        return { ref, label: e ? `${e.name}${port}` : `${ref.equipmentId} (not on record)${port}`, onRecord: !!e, ids: [ref.equipmentId] };
      }
      case 'equipment_port': {
        const e = equipment.get(ref.equipmentId);
        const p = e?.logicalPorts?.find((x) => x.id === ref.portId);
        return { ref, label: `${e?.name ?? ref.equipmentId} port ${p?.slotCardPort ?? p?.portNumber ?? ref.portId}`, onRecord: !!p, ids: [ref.equipmentId] };
      }
      case 'connector':
        return {
          ref,
          label: `connector ${ref.connectorType ?? '(type not recorded)'}${ref.connectsTo ? `, plugs into "${ref.connectsTo}" (as written, not a link)` : ', what it plugs into is not recorded'}`,
          onRecord: true,
          ids: [],
        };
      case 'rf_port': {
        const el = rfElements.get(ref.elementId);
        const p = el?.ports.find((x) => x.id === ref.portId);
        const label = el ? `${el.name}, ${p ? p.label : `port ${ref.portId} (not on this item)`}` : `Cable TV item ${ref.elementId} (not on record)`;
        return { ref, label, onRecord: !!p, ids: [ref.elementId, ...(el?.siteEquipmentId ? [el.siteEquipmentId] : [])] };
      }
    }
  };

  const connections: Connection[] = [];
  type Draft = Omit<Connection, 'from' | 'to' | 'warnings' | 'endsKey' | 'elementIds'> & {
    from: ConnectionEnd;
    to: ConnectionEnd;
    warnings?: ConnectionWarning[];
  };
  const add = (draft: Draft) => {
    const from = side(draft.from);
    const to = side(draft.to);
    const warnings = [...(draft.warnings ?? [])];
    for (const s of [from, to]) {
      if (!s.onRecord) warnings.push({ code: 'end_not_on_record', message: `One end names ${s.label}. Check the record; FiberGIS does not guess what was meant.` });
    }
    const elementIds = [...new Set([...from.ids, ...to.ids, ...(draft.place?.ids ?? [])].filter(has))];
    const { from: _f, to: _t, warnings: _w, ...rest } = draft;
    const connection: Connection = {
      ...rest,
      from: { ref: from.ref, label: from.label, onRecord: from.onRecord },
      to: { ref: to.ref, label: to.label, onRecord: to.onRecord },
      warnings,
      endsKey: `${endKey(draft.from)}>${endKey(draft.to)}`,
      elementIds,
    };
    connections.push(connection);
  };

  const recorded = (by: string | undefined, at: string | undefined) => ({
    ...(present(by) ? { recordedBy: present(by) } : {}),
    ...(present(at) ? { recordedAt: present(at) } : {}),
  });

  // --- Closures: splices and pigtails ------------------------------------------------------------
  for (const closure of data.closures) {
    const place = { label: `closure ${closure.name}`, ids: [closure.id, ...(has(closure.equipmentId) ? [closure.equipmentId] : [])] };
    for (const s of closure.splices) {
      const state: ConnectionState = s.enteredInError ? 'mistake' : s.retiredAt || s.status === 'Unused' ? 'retired' : s.status === 'Pending' ? 'planned' : 'current';
      const stateLabel = s.enteredInError
        ? `Entered by mistake${s.retiredAt ? `, struck out ${s.retiredAt.slice(0, 10)}` : ''}${s.retiredReason ? `: ${s.retiredReason}` : ''}`
        : s.retiredAt
          ? `Taken out ${s.retiredAt.slice(0, 10)}${s.retiredBy ? ` by ${s.retiredBy}` : ''}${s.retiredReason ? `: ${s.retiredReason}` : ''}`
          : `Recorded as ${s.status}`;
      const warnings: ConnectionWarning[] = [];
      const mismatch = state === 'current' || state === 'planned' ? (s.inputCableId !== s.outputCableId ? spliceDirectionMismatch(closure, s.inputCableId, s.outputCableId) : undefined) : undefined;
      if (mismatch) {
        warnings.push({
          code: 'direction',
          message:
            mismatch === 'input'
              ? `The OLT-side fibre's cable is recorded at ${closure.name} as going out towards customers. Check which side is which.`
              : `The customer-side fibre's cable is recorded at ${closure.name} as coming in from the OLT. Check which side is which.`,
        });
      }
      add({
        id: connectionId('splice', closure.id, s.id),
        kind: 'splice',
        from: { type: 'core', cableId: s.inputCableId, core: s.inputCore },
        to: { type: 'core', cableId: s.outputCableId, core: s.outputCore },
        directed: true,
        state,
        stateLabel,
        recordedIn: { collection: 'closures', recordId: closure.id, field: `splices[${s.id}]`, label: `Splice in closure ${closure.name}` },
        ...recorded(s.technician, s.date),
        place,
        warnings,
      });
    }
    for (const t of closure.terminations ?? []) {
      add({
        id: connectionId('closure_pigtail', closure.id, t.id),
        kind: 'closure_pigtail',
        from: { type: 'core', cableId: t.cableId, core: t.core },
        to: { type: 'connector', ...(present(t.connectorType) ? { connectorType: present(t.connectorType) } : {}), ...(present(t.connectsTo) ? { connectsTo: present(t.connectsTo) } : {}) },
        directed: false,
        state: t.enteredInError ? 'mistake' : t.retiredAt ? 'retired' : 'current',
        stateLabel: t.enteredInError ? 'Entered by mistake' : t.retiredAt ? `Taken out ${t.retiredAt.slice(0, 10)}${t.retiredReason ? `: ${t.retiredReason}` : ''}` : 'Recorded',
        recordedIn: { collection: 'closures', recordId: closure.id, field: `terminations[${t.id}]`, label: `Pigtail in closure ${closure.name}` },
        ...recorded(t.technician, t.date),
        place,
        ...(present(t.connectorType) ? { connectors: { to: present(t.connectorType) } } : {}),
      });
    }
  }

  // --- Equipment: ODF ports, PON ports, cable-free logical ports ----------------------------------
  for (const eq of data.equipment) {
    for (const panel of eq.odfPanels ?? []) {
      for (const port of panel.ports) {
        const adapter = present(port.connectorType) ?? present(panel.connectorType);
        const place = { label: `ODF ${eq.name}`, ids: [eq.id] };
        const where = `odfPanels[${panel.id}].ports[${port.number}]`;
        const portRef = (side: 'rear' | 'front'): ConnectionEnd => ({ type: 'odf_port', equipmentId: eq.id, panelId: panel.id, portId: port.id, portNumber: port.number, side });
        if (port.feederCableId && port.feederCore) {
          const plug = present(port.pigtail?.connectorType);
          const clash = connectorClash(adapter, plug);
          add({
            id: connectionId('odf_rear', eq.id, panel.id, port.id),
            kind: 'odf_rear',
            from: portRef('rear'),
            to: { type: 'core', cableId: port.feederCableId, core: port.feederCore },
            directed: true,
            state: 'current',
            stateLabel: 'Recorded',
            recordedIn: { collection: 'equipment', recordId: eq.id, field: `${where}.feederCore`, label: `Feeder fibre on ${eq.name} ${panel.label} port ${port.number}` },
            place,
            ...(adapter || plug ? { connectors: { ...(plug ? { from: plug } : {}), ...(adapter ? { adapter } : {}) } } : {}),
            warnings: clash ? [{ code: 'connector_mismatch', message: `The pigtail is ${plug} but the adapter is ${adapter}. ${clash}` }] : [],
          });
        }
        if (port.patch) {
          const plug = present(port.patch.cordConnectorOdf);
          const clash = connectorClash(adapter, plug);
          const cordPon = present(port.patch.cordConnectorPon);
          add({
            id: connectionId('odf_patch', eq.id, panel.id, port.id),
            kind: 'odf_patch',
            from: { type: 'pon_port', oltId: port.patch.oltId, ponPortId: port.patch.ponPortId },
            to: portRef('front'),
            directed: true,
            state: 'current',
            stateLabel: port.patch.override ? `Patched while the port was marked ${port.patch.override.status}: ${port.patch.override.reason}` : 'Recorded',
            recordedIn: { collection: 'equipment', recordId: eq.id, field: `${where}.patch`, label: `Patch cord on ${eq.name} ${panel.label} port ${port.number}` },
            ...recorded(port.patch.patchedBy, port.patch.patchedAt),
            place,
            ...(adapter || plug || cordPon ? { connectors: { ...(cordPon ? { from: cordPon } : {}), ...(plug ? { to: plug } : {}), ...(adapter ? { adapter } : {}) } } : {}),
            warnings: clash ? [{ code: 'connector_mismatch', message: `The patch cord is ${plug} but the adapter is ${adapter}. ${clash}` }] : [],
          });
        }
      }
    }
    for (const pon of eq.ponPorts ?? []) {
      const ponRef: ConnectionEnd = { type: 'pon_port', oltId: eq.id, ponPortId: pon.id };
      if (pon.connectedFeederCableId && pon.feederCore) {
        add({
          id: connectionId('pon_feeder', eq.id, pon.id),
          kind: 'pon_feeder',
          from: ponRef,
          to: { type: 'core', cableId: pon.connectedFeederCableId, core: pon.feederCore },
          directed: true,
          state: 'current',
          stateLabel: 'Recorded',
          recordedIn: { collection: 'equipment', recordId: eq.id, field: `ponPorts[${pon.id}].feederCore`, label: `Feeder fibre on ${eq.name} ${pon.id}` },
          place: { label: `OLT ${eq.name}`, ids: [eq.id] },
        });
      }
      if (has(pon.connectedSplitterId)) {
        add({
          id: connectionId('pon_splitter', eq.id, pon.id),
          kind: 'pon_splitter',
          from: ponRef,
          to: { type: 'splitter', splitterId: pon.connectedSplitterId },
          directed: true,
          state: 'current',
          stateLabel: 'As written on the OLT port',
          recordedIn: { collection: 'equipment', recordId: eq.id, field: `ponPorts[${pon.id}].connectedSplitterId`, label: `Splitter written on ${eq.name} ${pon.id}` },
        });
      }
    }
    // Only ports stored on the item; ports the screens make up from a count are not links.
    for (const port of eq.logicalPorts ?? []) {
      const portRef: ConnectionEnd = { type: 'equipment_port', equipmentId: eq.id, portId: port.id };
      const base = {
        kind: 'logical_port' as const,
        from: portRef,
        directed: false,
        state: 'current' as const,
        stateLabel: `Port marked ${port.status}`,
        ...recorded(undefined, port.assignedDate),
      };
      const at = (field: string, words: string) => ({ collection: 'equipment' as const, recordId: eq.id, field: `logicalPorts[${port.id}].${field}`, label: `${words} written on ${eq.name} port ${port.slotCardPort ?? port.portNumber}` });
      if (has(port.connectedEquipmentId)) {
        add({ ...base, id: connectionId('logical_port', eq.id, port.id, 'equipment'), to: { type: 'equipment', equipmentId: port.connectedEquipmentId }, recordedIn: at('connectedEquipmentId', 'Item') });
      }
      if (has(port.connectedSplitterId)) {
        add({ ...base, id: connectionId('logical_port', eq.id, port.id, 'splitter'), to: { type: 'splitter', splitterId: port.connectedSplitterId }, recordedIn: at('connectedSplitterId', 'Splitter') });
      }
      if (has(port.connectedCableId)) {
        add({
          ...base,
          id: connectionId('logical_port', eq.id, port.id, 'cable'),
          to: port.connectedCore ? { type: 'core', cableId: port.connectedCableId, core: port.connectedCore } : { type: 'cable', cableId: port.connectedCableId },
          recordedIn: at('connectedCableId', port.connectedCore ? 'Fibre' : 'Cable'),
        });
      }
      if (has(port.customerId)) {
        add({ ...base, id: connectionId('logical_port', eq.id, port.id, 'customer'), to: { type: 'customer', customerId: port.customerId }, recordedIn: at('customerId', 'Customer') });
      }
    }
  }

  // --- Splitters ---------------------------------------------------------------------------------
  for (const sp of data.splitters) {
    const host = equipment.get(sp.terminalBoxId);
    const place = has(sp.terminalBoxId) ? { label: host ? host.name : `${sp.terminalBoxId} (not on record)`, ids: [sp.terminalBoxId] } : undefined;
    const input = sp.inputPort;
    const inputBy = recorded(input.linkedBy, input.linkedAt);
    if (has(input.connectedCableId) && input.connectedCore) {
      add({
        id: connectionId('splitter_input', sp.id),
        kind: 'splitter_input',
        from: { type: 'core', cableId: input.connectedCableId, core: input.connectedCore },
        to: { type: 'splitter_input', splitterId: sp.id },
        directed: true,
        state: 'current',
        stateLabel: 'Recorded',
        recordedIn: { collection: 'splitters', recordId: sp.id, field: 'inputPort.connectedCore', label: `Input of splitter ${sp.name}` },
        ...inputBy,
        ...(place ? { place } : {}),
      });
    }
    if (has(input.connectedSplitterId) && input.connectedSplitterPort) {
      add({
        id: connectionId('splitter_cascade', sp.id),
        kind: 'splitter_cascade',
        from: { type: 'splitter_output', splitterId: input.connectedSplitterId, port: input.connectedSplitterPort },
        to: { type: 'splitter_input', splitterId: sp.id },
        directed: true,
        state: 'current',
        stateLabel: 'Recorded',
        recordedIn: { collection: 'splitters', recordId: sp.id, field: 'inputPort.connectedSplitterId', label: `Input of splitter ${sp.name}` },
        ...inputBy,
        ...(place ? { place } : {}),
        warnings: input.connectedSplitterId === sp.id ? [{ code: 'loop', message: `Splitter ${sp.name} is recorded as feeding itself.` }] : [],
      });
    }
    for (const port of sp.outputPorts) {
      const out: ConnectionEnd = { type: 'splitter_output', splitterId: sp.id, port: port.portNumber };
      const base = { from: out, directed: true, state: 'current' as const, stateLabel: `Output marked ${port.status}`, ...recorded(undefined, port.connectedAt), ...(place ? { place } : {}) };
      const at = (field: string) => ({ collection: 'splitters' as const, recordId: sp.id, field: `outputPorts[${port.portNumber}].${field}`, label: `Output ${port.portNumber} of splitter ${sp.name}` });
      if (has(port.connectedDropCableId) && port.connectedCore) {
        const loop = has(input.connectedCableId) && input.connectedCableId === port.connectedDropCableId && input.connectedCore === port.connectedCore;
        add({
          ...base,
          id: connectionId('splitter_output', sp.id, port.portNumber),
          kind: 'splitter_output',
          to: { type: 'core', cableId: port.connectedDropCableId, core: port.connectedCore },
          recordedIn: at('connectedCore'),
          warnings: loop ? [{ code: 'loop', message: `The same fibre is recorded as both the input and output ${port.portNumber} of splitter ${sp.name}.` }] : [],
        });
      }
      if (has(port.connectedCustomerId)) {
        add({ ...base, id: connectionId('splitter_customer', sp.id, port.portNumber), kind: 'splitter_customer', to: { type: 'customer', customerId: port.connectedCustomerId }, recordedIn: at('connectedCustomerId') });
      }
      if (has(port.connectedEquipmentId)) {
        add({ ...base, id: connectionId('splitter_equipment', sp.id, port.portNumber), kind: 'splitter_equipment', to: { type: 'equipment', equipmentId: port.connectedEquipmentId }, recordedIn: at('connectedEquipmentId') });
      }
    }
  }

  // --- Customers ---------------------------------------------------------------------------------
  for (const c of data.customers) {
    const disconnected = c.status === 'Disconnected';
    const state: ConnectionState = disconnected ? 'retired' : c.status === 'Pending Installation' ? 'planned' : 'current';
    const stateLabel = disconnected ? `Customer disconnected${c.disconnectedAt ? ` ${c.disconnectedAt.slice(0, 10)}` : ''}: field kept as history` : `Customer ${c.status}`;
    const me: ConnectionEnd = { type: 'customer', customerId: c.id };
    const at = (field: string, words: string) => ({ collection: 'customers' as const, recordId: c.id, field, label: `${words} on customer ${c.id}` });
    if (has(c.dropCableId) && c.fiberCore > 0) {
      add({ id: connectionId('customer_drop', c.id), kind: 'customer_drop', from: { type: 'core', cableId: c.dropCableId, core: c.fiberCore }, to: me, directed: true, state, stateLabel, recordedIn: at('dropCableId', 'Drop fibre') });
    }
    if (has(c.splitterId) && c.splitterOutputPort > 0) {
      add({
        id: connectionId('customer_splitter', c.id),
        kind: 'customer_splitter',
        from: { type: 'splitter_output', splitterId: c.splitterId, port: c.splitterOutputPort },
        to: me,
        directed: true,
        state,
        stateLabel,
        recordedIn: at('splitterOutputPort', 'Splitter output'),
      });
    }
    if (has(c.ontId)) {
      add({ id: connectionId('customer_ont', c.id), kind: 'customer_ont', from: { type: 'ont', ontId: c.ontId }, to: me, directed: true, state, stateLabel, recordedIn: at('ontId', 'ONT') });
    }
  }

  // --- ONTs --------------------------------------------------------------------------------------
  for (const o of data.onts ?? []) {
    const removed = o.status === 'removed' || !!o.removedAt;
    const state: ConnectionState = removed ? 'retired' : o.status === 'in_stock' ? 'planned' : 'current';
    const stateLabel = removed ? `ONT removed${o.removedAt ? ` ${o.removedAt.slice(0, 10)}` : ''}${o.removedReason ? `: ${o.removedReason}` : ''}` : `ONT ${o.status.replace('_', ' ')}`;
    const me: ConnectionEnd = { type: 'ont', ontId: o.id };
    const at = (field: string, words: string) => ({ collection: 'onts' as const, recordId: o.id, field, label: `${words} on ONT ${o.id}` });
    if (has(o.dropCableId) && o.dropCore) {
      add({ id: connectionId('ont_drop', o.id), kind: 'ont_drop', from: { type: 'core', cableId: o.dropCableId, core: o.dropCore }, to: me, directed: true, state, stateLabel, recordedIn: at('dropCore', 'Drop fibre') });
    }
    if (has(o.splitterId) && o.splitterOutputPort) {
      add({ id: connectionId('ont_splitter', o.id), kind: 'ont_splitter', from: { type: 'splitter_output', splitterId: o.splitterId, port: o.splitterOutputPort }, to: me, directed: true, state, stateLabel, recordedIn: at('splitterOutputPort', 'Splitter output') });
    }
    if (has(o.oltId) && has(o.ponPortId)) {
      add({ id: connectionId('ont_pon', o.id), kind: 'ont_pon', from: { type: 'pon_port', oltId: o.oltId, ponPortId: o.ponPortId }, to: me, directed: true, state, stateLabel, recordedIn: at('ponPortId', 'OLT port') });
    }
  }

  // --- Cables: ends and the older per-fibre fields ----------------------------------------------
  for (const cable of data.cables) {
    for (const end of ['start', 'end'] as const) {
      const eqId = end === 'start' ? cable.startEquipmentId : cable.endEquipmentId;
      if (!has(eqId)) continue;
      const port = present(end === 'start' ? cable.startPortName : cable.endPortName);
      add({
        id: connectionId('cable_end', cable.id, end),
        kind: 'cable_end',
        from: { type: 'cable_end', cableId: cable.id, end },
        to: { type: 'equipment', equipmentId: eqId, ...(port ? { port } : {}) },
        directed: false,
        state: cable.status === 'Planned' ? 'planned' : 'current',
        stateLabel: `Cable ${cable.status}`,
        recordedIn: { collection: 'cables', recordId: cable.id, field: `${end}EquipmentId`, label: `${end === 'start' ? 'From' : 'To'} end of cable ${cable.name}` },
      });
    }
    for (const core of cable.cores) {
      const me: ConnectionEnd = { type: 'core', cableId: cable.id, core: core.coreNumber };
      if (has(core.connectedToEquipmentId)) {
        const port = present(core.connectedPort);
        add({
          id: connectionId('core_equipment', cable.id, core.coreNumber),
          kind: 'core_equipment',
          from: me,
          to: { type: 'equipment', equipmentId: core.connectedToEquipmentId, ...(port ? { port } : {}) },
          directed: false,
          state: core.status === 'Retired' ? 'retired' : 'current',
          stateLabel: `As written on the fibre (marked ${core.status})`,
          recordedIn: { collection: 'cables', recordId: cable.id, field: `cores[${core.coreNumber}].connectedToEquipmentId`, label: `Fibre ${core.coreNumber} of cable ${cable.name}` },
        });
      }
      if (has(core.spliceTargetCableId) && core.spliceTargetCore) {
        add({
          id: connectionId('core_splice_target', cable.id, core.coreNumber),
          kind: 'core_splice_target',
          from: me,
          to: { type: 'core', cableId: core.spliceTargetCableId, core: core.spliceTargetCore },
          directed: false,
          state: core.status === 'Retired' ? 'retired' : 'current',
          stateLabel: 'As written on the fibre (not a splice record)',
          recordedIn: { collection: 'cables', recordId: cable.id, field: `cores[${core.coreNumber}].spliceTargetCableId`, label: `Fibre ${core.coreNumber} of cable ${cable.name}` },
        });
      }
    }
  }

  // --- Cable TV links (no PON rule is applied to them) -------------------------------------------
  for (const link of data.rfLinks ?? []) {
    const fromEl = rfElements.get(link.from.elementId);
    const toEl = rfElements.get(link.to.elementId);
    const fp = fromEl?.ports.find((p) => p.id === link.from.portId);
    const tp = toEl?.ports.find((p) => p.id === link.to.portId);
    const warnings: ConnectionWarning[] = [];
    if (fp && tp && (fp.direction !== 'out' || tp.direction !== 'in')) {
      warnings.push({ code: 'direction', message: `Signal goes from an OUT port to an IN port, but this link is recorded from ${fp.label} (${fp.direction.toUpperCase()}) to ${tp.label} (${tp.direction.toUpperCase()}).` });
    }
    if (fp && tp && fp.signal !== tp.signal) {
      warnings.push({ code: 'connector_mismatch', message: `${fp.label} carries ${fp.signal} and ${tp.label} takes ${tp.signal}. Light becomes TV signal only inside a node.` });
    }
    if (link.from.elementId === link.to.elementId) warnings.push({ code: 'loop', message: 'This Cable TV item is recorded as linked to itself.' });
    const via = link.medium === 'fiber' && has(link.cableId) && link.fiberNumber ? { cableId: link.cableId, core: link.fiberNumber } : undefined;
    add({
      id: connectionId('rf_link', link.id),
      kind: 'rf_link',
      from: { type: 'rf_port', elementId: link.from.elementId, portId: link.from.portId },
      to: { type: 'rf_port', elementId: link.to.elementId, portId: link.to.portId },
      directed: true,
      state: link.status === 'removed' ? 'retired' : 'current',
      stateLabel: link.status === 'removed' ? `Removed${link.removedAt ? ` ${link.removedAt.slice(0, 10)}` : ''}${link.removedReason ? `: ${link.removedReason}` : ''}` : `Recorded (${link.medium})`,
      recordedIn: { collection: 'rfLinks', recordId: link.id, field: '', label: `Cable TV link ${link.id}` },
      ...recorded(link.createdBy, link.createdAt),
      ...(via ? { via } : {}),
      warnings,
    });
  }

  // --- One fibre, one feed and one continuation (the same records as the fibre index) -----------
  const live = (c: Connection) => c.state === 'current' || c.state === 'planned';
  const feeds = new Map<CoreKey, Connection[]>();
  const continues = new Map<CoreKey, Connection[]>();
  for (const c of connections) {
    if (!live(c)) continue;
    if ((c.kind === 'splice' || c.kind === 'odf_rear' || c.kind === 'pon_feeder' || c.kind === 'splitter_output') && c.to.ref.type === 'core') {
      push(feeds, coreKey(c.to.ref.cableId, c.to.ref.core), c);
    }
    if ((c.kind === 'splice' || c.kind === 'splitter_input' || c.kind === 'customer_drop') && c.from.ref.type === 'core') {
      push(continues, coreKey(c.from.ref.cableId, c.from.ref.core), c);
    }
  }
  for (const [map, code, words] of [
    [feeds, 'two_feeds', 'feed'],
    [continues, 'two_continuations', 'go on from'],
  ] as const) {
    for (const list of map.values()) {
      if (list.length < 2) continue;
      const fibre = code === 'two_feeds' ? list[0].to.label : list[0].from.label;
      const named = list.slice(0, 5).map((o) => o.recordedIn.label).join('; ');
      // One message per fibre, shared by its links, so a badly broken fibre stays linear.
      const warning: ConnectionWarning = { code, message: `${list.length} links are recorded to ${words} ${fibre}. One fibre takes one. Check: ${named}${list.length > 5 ? ` and ${list.length - 5} more` : ''}.` };
      for (const c of list) c.warnings.push(warning);
    }
  }

  // --- Lookups and checks ------------------------------------------------------------------------
  const byId = new Map<string, Connection>();
  const byElement = new Map<string, Connection[]>();
  const byCore = new Map<CoreKey, Connection[]>();
  for (const c of connections) {
    byId.set(c.id, c);
    for (const id of c.elementIds) push(byElement, id, c);
    const cores = new Set<CoreKey>();
    for (const s of [c.from.ref, c.to.ref]) if (s.type === 'core') cores.add(coreKey(s.cableId, s.core));
    if (c.via) cores.add(coreKey(c.via.cableId, c.via.core));
    for (const k of cores) push(byCore, k, c);
    if (c.via && !c.elementIds.includes(c.via.cableId)) {
      c.elementIds.push(c.via.cableId);
      push(byElement, c.via.cableId, c);
    }
  }
  const checks = new Map<string, LinkVerification[]>();
  const orphanChecks: LinkVerification[] = [];
  for (const v of data.linkVerifications ?? []) {
    push(checks, v.connectionId, v);
    if (!byId.has(v.connectionId)) orphanChecks.push(v);
  }
  for (const list of checks.values()) list.sort(newestFirst);
  orphanChecks.sort(newestFirst);
  return { connections, byId, byElement, byCore, checks, orphanChecks };
}

const newestFirst = (a: LinkVerification, b: LinkVerification) => b.checkedOn.localeCompare(a.checkedOn) || b.createdAt.localeCompare(a.createdAt);

const STATE_ORDER: Record<ConnectionState, number> = { current: 0, planned: 1, retired: 2, mistake: 3 };
const byStateThenKind = (a: Connection, b: Connection) =>
  STATE_ORDER[a.state] - STATE_ORDER[b.state] || CONNECTION_KINDS.indexOf(a.kind) - CONNECTION_KINDS.indexOf(b.kind) || a.id.localeCompare(b.id);

/** Every link listed under one record (equipment, cable, splitter, closure, customer, ONT, Cable TV item), current first. */
export const connectionsForElement = (index: ConnectionIndex, id: string): Connection[] => [...(index.byElement.get(id) ?? [])].sort(byStateThenKind);

/** Every link of one fibre, current first. */
export const connectionsForCore = (index: ConnectionIndex, cableId: string, core: number): Connection[] => [...(index.byCore.get(coreKey(cableId, core)) ?? [])].sort(byStateThenKind);

/**
 * Checks whose link is gone, that belong here: their own connection id names this record, or (for a
 * fibre) the ends they were made on include it. Read from the check itself, never guessed.
 */
export function orphanChecksFor(index: ConnectionIndex, target: { elementId: string } | { cableId: string; core: number }): LinkVerification[] {
  if ('elementId' in target) return index.orphanChecks.filter((v) => v.connectionId.split(':').slice(1).includes(target.elementId));
  const key = `core:${target.cableId}#${target.core}`;
  return index.orphanChecks.filter((v) => (v.endsKey ?? '').split('>').includes(key));
}

/** "fibre 3 of FDR-01 → input of splitter SPL-1". */
export const describeConnection = (c: Pick<Connection, 'from' | 'to'>): string => `${c.from.label} → ${c.to.label}`;

/* ------------------------------------------------------------------ */
/* Verification state                                                  */
/* ------------------------------------------------------------------ */

/** Unverified is a state of its own, always shown. A check made before the link changed does not count. */
export type LinkCheckState = 'not_checked' | 'passed' | 'failed' | 'inconclusive' | 'changed_since_check';

export const LINK_CHECK_STATE_LABELS: Record<LinkCheckState, string> = {
  not_checked: 'Not checked',
  passed: 'Checked: good',
  failed: 'Checked: bad',
  inconclusive: 'Checked: could not tell',
  changed_since_check: 'Changed since the last check',
};

export interface LinkCheckSummary {
  state: LinkCheckState;
  /** One plain line, such as "Checked: good on 2026-11-10 by Ravi (OTDR test)". */
  label: string;
  /** The newest check, when there is one. */
  latest?: LinkVerification;
  /** All checks of this link, newest first. */
  checks: LinkVerification[];
  /** The newest check has a photo, an OTDR reference or a reading. */
  hasEvidence: boolean;
}

export const checkHasEvidence = (v: Pick<LinkVerification, 'photoIds' | 'otdrRef' | 'readingDbm'>): boolean =>
  (v.photoIds?.length ?? 0) > 0 || !!v.otdrRef?.trim() || v.readingDbm !== undefined;

const METHOD_WORDS: Record<LinkVerification['method'], string> = {
  otdr: 'OTDR test',
  vfl: 'red light',
  power_reading: 'light meter',
  visual: 'looked at it',
  continuity: 'continuity test',
};

/** Where one link stands: not checked, checked good, bad, could not tell, or changed after its last check. */
export function linkCheckSummary(index: ConnectionIndex, connection: Pick<Connection, 'id' | 'endsKey'>): LinkCheckSummary {
  const checks = index.checks.get(connection.id) ?? [];
  const latest = checks[0];
  if (!latest) return { state: 'not_checked', label: 'Not checked. Nobody has recorded a check of this link.', checks, hasEvidence: false };
  const evidence = checkHasEvidence(latest);
  const who = `on ${latest.checkedOn} by ${latest.technician} (${METHOD_WORDS[latest.method]}${evidence ? '' : ', no photo or reading'})`;
  if (latest.endsKey && latest.endsKey !== connection.endsKey) {
    return { state: 'changed_since_check', label: `Changed since the last check ${who}. Check it again.`, latest, checks, hasEvidence: evidence };
  }
  const state: LinkCheckState = latest.result === 'pass' ? 'passed' : latest.result === 'fail' ? 'failed' : 'inconclusive';
  return { state, label: `${LINK_CHECK_STATE_LABELS[state]} ${who}`, latest, checks, hasEvidence: evidence };
}

/** Whether a stored check still matches its link: the same ends, other ends since, or the link is gone. */
export function checkStanding(index: ConnectionIndex, v: Pick<LinkVerification, 'connectionId' | 'endsKey'>): 'current' | 'link_changed' | 'link_gone' {
  const c = index.byId.get(v.connectionId);
  if (!c) return 'link_gone';
  return v.endsKey && v.endsKey !== c.endsKey ? 'link_changed' : 'current';
}

/** Counts for a list of links: how many are not checked, good, bad... */
export function linkCheckCounts(index: ConnectionIndex, list: readonly Connection[]): Record<LinkCheckState, number> {
  const counts: Record<LinkCheckState, number> = { not_checked: 0, passed: 0, failed: 0, inconclusive: 0, changed_since_check: 0 };
  for (const c of list) counts[linkCheckSummary(index, c).state] += 1;
  return counts;
}
