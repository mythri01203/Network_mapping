import { type ColorScheme, coreIdentity, DEFAULT_COLOR_SCHEMES } from '../fiber/colors';
import type { Building, Customer, Equipment, Fault, NetworkElementRef, OdfPanel, OdfPort, Ont, PonPort, Service, Splitter } from '../model/types';
import type { NetworkData } from './command';
import {
  buildConnectionIndex,
  type Connection,
  CONNECTION_KIND_LABELS,
  type ConnectionEnd,
  type ConnectionIndex,
  type ConnectionIndexData,
  type ConnectionKind,
  endKey,
  type LinkCheckState,
  linkCheckSummary,
} from './connectionIndex';
import { affectedByElement, buildImpactIndex, type ImpactData } from './faultImpact';
import { coreKey } from './fiberIndex';
import { DEFAULT_OPTICAL_SETTINGS, type OpticalSettings } from './opticalSettings';
import { ductsForCable } from './outsidePlant';
import { type LogicalNode, serviceTopology } from './serviceTopology';
import { resolveTraceTarget, type TraceData } from './trace';

/**
 * Network mapping Phase 15: ONE trace engine for fibre-level traces, built on the Phase 13
 * connection index. It follows only the physical links a record holds (splices, ODF feeder fibres
 * and patch cords, OLT feeders, splitter inputs, outputs and cascades, drop fibres, ONTs), never
 * position, never which cables end at a box, and never the older "as written" copies of a link.
 * Every step carries its own state: faulty, planned, a link nobody has checked yet (UNVERIFIED, from
 * the Phase 13 link checks), or a missing link (a gap). A gap is never filled in: the trace stops
 * there and says what is missing. Two feeds on one fibre are a gap too: no feed is picked.
 *
 * The older cable-level walk in `trace.ts` (cable ends) is kept only for the physical route when no
 * fibre is recorded: then it is the honest answer, and it is labelled "cables only".
 */

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export const TRACE_TYPES = [
  'asset_to_asset',
  'cable_to_cable',
  'core_to_core',
  'port_to_port',
  'olt_to_ont',
  'customer_to_olt',
  'splitter_to_customers',
  'upstream',
  'downstream',
  'physical_route',
  'logical_service',
  'fault_impact',
] as const;
export type TraceType = (typeof TRACE_TYPES)[number];

/** Plain words for each trace, for menus and reports. */
export const TRACE_TYPE_LABELS: Record<TraceType, string> = {
  asset_to_asset: 'Between two items',
  cable_to_cable: 'Between two cables',
  core_to_core: 'Between two fibres',
  port_to_port: 'Between two ports',
  olt_to_ont: 'OLT to every ONT',
  customer_to_olt: 'Customer to OLT',
  splitter_to_customers: 'Splitter to its customers',
  upstream: 'Towards the OLT (upstream)',
  downstream: 'Towards customers (downstream)',
  physical_route: 'Where the cables run (physical route)',
  logical_service: 'Service path (logical)',
  fault_impact: 'Who a fault affects',
};

/** The traces that need a second point. */
export const TRACE_TYPES_BETWEEN: ReadonlySet<TraceType> = new Set(['asset_to_asset', 'cable_to_cable', 'core_to_core', 'port_to_port']);

/** Where a trace starts or ends. */
export type TracePoint =
  | { type: 'equipment'; id: string }
  | { type: 'cable'; id: string }
  | { type: 'core'; cableId: string; core: number }
  | { type: 'pon_port'; oltId: string; ponPortId: string }
  | { type: 'odf_port'; equipmentId: string; panelId: string; portId: string }
  | { type: 'splitter'; id: string; port?: number }
  | { type: 'customer'; id: string }
  | { type: 'ont'; id: string }
  | { type: 'closure'; id: string }
  | { type: 'splice'; closureId: string; spliceId: string }
  | { type: 'fault'; id: string }
  | { type: 'service'; id: string };

export interface TraceRequest {
  type: TraceType;
  from: TracePoint;
  /** Only for the "between" traces. */
  to?: TracePoint;
}

export type TraceStepKind =
  | 'equipment'
  | 'port'
  | 'odf'
  | 'cable'
  | 'tube'
  | 'core'
  | 'splice'
  | 'splitter'
  | 'ont'
  | 'customer'
  | 'connector'
  | 'service'
  | 'route'
  | 'gap'
  | 'note';

/**
 * `ok`: on record, and every link here was checked good. `unverified`: on record, but a link here has
 * no check (or its check is out of date or could not tell). `warning`: under maintenance or similar.
 * `planned`: recorded as planned, not done. `faulty`: marked faulty, damaged or failed, or an open
 * fault names it, or its check failed. `missing`: a link that is not on record (a gap).
 */
export type TraceStepState = 'ok' | 'unverified' | 'warning' | 'planned' | 'faulty' | 'missing';

export const TRACE_STEP_STATES: readonly TraceStepState[] = ['ok', 'unverified', 'warning', 'planned', 'faulty', 'missing'];

export const TRACE_STEP_STATE_LABELS: Record<TraceStepState, string> = {
  ok: 'Checked good',
  unverified: 'Not checked',
  warning: 'Check',
  planned: 'Planned, not done',
  faulty: 'Faulty',
  missing: 'Missing link',
};

const STATE_RANK: Record<TraceStepState, number> = { ok: 0, unverified: 1, warning: 2, planned: 3, faulty: 4, missing: 5 };
export const worseState = (a: TraceStepState, b: TraceStepState): TraceStepState => (STATE_RANK[b] > STATE_RANK[a] ? b : a);

export interface TraceStepLink {
  connectionId: string;
  kind: ConnectionKind;
  /** What kind of link, in plain words. */
  kindLabel: string;
  check: LinkCheckState;
  /** "Not checked. Nobody has recorded a check of this link." or "Checked: good on ...". */
  checkLabel: string;
  /** Where the link is recorded, so a person can open it. */
  recordedIn: string;
}

export interface TraceStep {
  /** Stable for the same records: the same node gives the same key in every trace. */
  key: string;
  kind: TraceStepKind;
  title: string;
  detail: string;
  state: TraceStepState;
  /** Why the state is what it is, in plain words. Empty for `ok`. */
  reasons: string[];
  /** Record ids (and `olt/port`, `cable#fibre`, `odf/panel/port` keys) this step stands for. */
  ids: string[];
  cableId?: string;
  core?: number;
  tube?: number;
  /** Physical links passed at this step, with their check state. */
  links: TraceStepLink[];
  lat?: number;
  lng?: number;
}

export interface TracePath {
  /** OLT side first. */
  steps: TraceStep[];
  /** No missing link on this path. A faulty or unchecked step does not make it incomplete. */
  complete: boolean;
  gaps: string[];
  /** The OLT port it reaches, when it reaches one. */
  reaches?: { oltId: string; ponPortId: string };
  label?: string;
}

export interface TraceTreeNode {
  step: TraceStep;
  children: TraceTreeNode[];
}

export type TraceLevel = 'fibre' | 'cable' | 'logical' | 'impact';

export interface NetworkTraceResult {
  type: TraceType;
  title: string;
  fromLabel: string;
  toLabel?: string;
  /** `fibre`: from the fibre links. `cable`: cables only (fibres not recorded): a picture of where cables go, not a proven path. */
  level: TraceLevel;
  paths: TracePath[];
  trees: TraceTreeNode[];
  /** No missing link anywhere in the result. */
  complete: boolean;
  gaps: string[];
  warnings: string[];
  notes: string[];
  /** For the map highlight and zoom. */
  cableIds: string[];
  equipmentIds: string[];
  coreKeys: string[];
  customerIds: string[];
  splitterIds: string[];
  closureIds: string[];
  counts: Record<TraceStepState, number> & { steps: number };
}

export type NetworkTraceData = ConnectionIndexData & {
  faults?: readonly Fault[];
  services?: readonly Service[];
  buildings?: readonly Building[];
  cableSegments?: NetworkData['cableSegments'];
  ducts?: NetworkData['ducts'];
  attachments?: NetworkData['attachments'];
  spans?: NetworkData['spans'];
};

export interface TraceGraph {
  data: NetworkTraceData;
  index: ConnectionIndex;
  schemes: readonly ColorScheme[];
  settings: OpticalSettings;
  cables: Map<string, NetworkTraceData['cables'][number]>;
  equipment: Map<string, Equipment>;
  splitters: Map<string, Splitter>;
  customers: Map<string, Customer>;
  onts: Map<string, Ont>;
  closures: Map<string, NetworkTraceData['closures'][number]>;
  /** Node key → live links that feed it (towards the OLT). */
  up: Map<string, Connection[]>;
  /** Node key → live links that leave it (towards customers). */
  down: Map<string, Connection[]>;
  /** Open, real faults by the record they name. */
  faultsOn: Map<string, Fault[]>;
}

/* ------------------------------------------------------------------ */
/* Graph                                                               */
/* ------------------------------------------------------------------ */

/**
 * Link kinds that carry light from one record to the next. The "as written" kinds (the splitter
 * written on an OLT port, the customer written on a splitter output, the box written on a fibre,
 * cable ends, port notes) are copies or claims, never followed: they are shown on the item screens.
 * Cable TV links are traced with the RF tree (Cable TV screen), not here.
 */
const FOLLOWED: ReadonlySet<ConnectionKind> = new Set<ConnectionKind>([
  'splice',
  'odf_rear',
  'odf_patch',
  'pon_feeder',
  'splitter_input',
  'splitter_cascade',
  'splitter_output',
  'customer_drop',
  'ont_drop',
  'customer_ont',
  'closure_pigtail',
]);

const push = <K, V>(map: Map<K, V[]>, key: K, value: V) => {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
};

const CLOSED_FAULT = new Set(['Resolved', 'Verified', 'Closed']);

export interface TraceGraphOptions {
  schemes?: readonly ColorScheme[];
  settings?: OpticalSettings;
  /** A connection index already built from the same records (the screens share one). */
  index?: ConnectionIndex;
}

/** Builds the graph once (linear in the records); every trace then reads it. */
export function buildTraceGraph(data: NetworkTraceData, options: TraceGraphOptions = {}): TraceGraph {
  const schemes = options.schemes ?? DEFAULT_COLOR_SCHEMES;
  const index = options.index ?? buildConnectionIndex(data, schemes);
  const up = new Map<string, Connection[]>();
  const down = new Map<string, Connection[]>();
  for (const c of index.connections) {
    if (!FOLLOWED.has(c.kind)) continue;
    if (c.state !== 'current' && c.state !== 'planned') continue;
    push(up, endKey(c.to.ref), c);
    push(down, endKey(c.from.ref), c);
  }
  const faultsOn = new Map<string, Fault[]>();
  for (const f of data.faults ?? []) {
    if (f.isTest || CLOSED_FAULT.has(f.status)) continue;
    const ids = new Set<string>();
    if (f.affectedCableId) ids.add(f.affectedCableId);
    if (f.affectedEquipmentId) ids.add(f.affectedEquipmentId);
    if (f.element) ids.add(f.element.type === 'core' && f.element.fiberNumber ? coreKey(f.element.id, f.element.fiberNumber) : f.element.type === 'pon_port' && f.element.ponPortId ? `${f.element.id}/${f.element.ponPortId}` : f.element.id);
    for (const id of ids) push(faultsOn, id, f);
  }
  return {
    data,
    index,
    schemes,
    settings: options.settings ?? DEFAULT_OPTICAL_SETTINGS,
    cables: new Map(data.cables.map((c) => [c.id, c])),
    equipment: new Map(data.equipment.map((e) => [e.id, e])),
    splitters: new Map(data.splitters.map((s) => [s.id, s])),
    customers: new Map(data.customers.map((c) => [c.id, c])),
    onts: new Map((data.onts ?? []).map((o) => [o.id, o])),
    closures: new Map(data.closures.map((c) => [c.id, c])),
    up,
    down,
    faultsOn,
  };
}

/* ------------------------------------------------------------------ */
/* Steps                                                               */
/* ------------------------------------------------------------------ */

interface StepDraft {
  key: string;
  kind: TraceStepKind;
  title: string;
  detail: string;
  ids: string[];
  state?: TraceStepState;
  reasons?: string[];
  cableId?: string;
  core?: number;
  tube?: number;
  links?: Connection[];
  lat?: number;
  lng?: number;
}

function stepLink(g: TraceGraph, c: Connection): { link: TraceStepLink; state: TraceStepState; reason?: string } {
  const summary = linkCheckSummary(g.index, c);
  const link: TraceStepLink = {
    connectionId: c.id,
    kind: c.kind,
    kindLabel: CONNECTION_KIND_LABELS[c.kind],
    check: summary.state,
    checkLabel: summary.label,
    recordedIn: c.recordedIn.label,
  };
  if (c.state === 'planned') return { link, state: 'planned', reason: `${CONNECTION_KIND_LABELS[c.kind]}: ${c.stateLabel}.` };
  if (summary.state === 'failed') return { link, state: 'faulty', reason: `${CONNECTION_KIND_LABELS[c.kind]}: ${summary.label}` };
  if (summary.state === 'passed') return { link, state: 'ok' };
  return { link, state: 'unverified', reason: `${CONNECTION_KIND_LABELS[c.kind]}: ${summary.label}` };
}

function makeStep(g: TraceGraph, d: StepDraft): TraceStep {
  let state: TraceStepState = d.state ?? 'ok';
  const reasons = [...(d.reasons ?? [])];
  const links: TraceStepLink[] = [];
  for (const c of d.links ?? []) {
    const r = stepLink(g, c);
    links.push(r.link);
    state = worseState(state, r.state);
    if (r.reason) reasons.push(r.reason);
  }
  // "Checked good" only when a recorded check passed for its links; nothing on record that is
  // wrong is not the same as checked.
  if (state === 'ok' && links.length === 0) state = 'unverified';
  // An open, real fault naming the record (never a TEST fault).
  for (const id of d.ids) {
    for (const f of g.faultsOn.get(id) ?? []) {
      state = worseState(state, 'faulty');
      const words = `Open fault ${f.id} (${f.type}) names it.`;
      if (!reasons.includes(words)) reasons.push(words);
    }
  }
  return {
    key: d.key,
    kind: d.kind,
    title: d.title,
    detail: d.detail,
    state,
    reasons,
    ids: [...new Set(d.ids.filter(Boolean))],
    ...(d.cableId !== undefined ? { cableId: d.cableId } : {}),
    ...(d.core !== undefined ? { core: d.core } : {}),
    ...(d.tube !== undefined ? { tube: d.tube } : {}),
    links,
    ...(d.lat !== undefined && d.lng !== undefined && Number.isFinite(d.lat) && Number.isFinite(d.lng) && !(d.lat === 0 && d.lng === 0) ? { lat: d.lat, lng: d.lng } : {}),
  };
}

const gapStep = (key: string, message: string, at?: { lat?: number; lng?: number }): TraceStep => ({
  key,
  kind: 'gap',
  title: 'Missing link',
  detail: message,
  state: 'missing',
  reasons: [message],
  ids: [],
  links: [],
  ...(at?.lat !== undefined && at?.lng !== undefined && !(at.lat === 0 && at.lng === 0) ? { lat: at.lat, lng: at.lng } : {}),
});

// A note is not a checked item: never "Checked good" (notes are left out of the counts, and the screen shows no state for them).
const noteStep = (key: string, title: string, detail: string): TraceStep => ({ key, kind: 'note', title, detail, state: 'unverified', reasons: [], ids: [], links: [] });

const cap = (s: string) => (s ? `${s[0].toUpperCase()}${s.slice(1)}` : s);

function equipmentState(eq: Equipment | undefined): { state: TraceStepState; reasons: string[] } {
  if (!eq) return { state: 'ok', reasons: [] };
  if (eq.status === 'Faulty') return { state: 'faulty', reasons: [`${eq.name} is marked faulty.`] };
  if (eq.status === 'Maintenance' || eq.status === 'Warning') return { state: 'warning', reasons: [`${eq.name} is marked ${eq.status.toLowerCase()}.`] };
  if (eq.status === 'Planned') return { state: 'planned', reasons: [`${eq.name} is planned.`] };
  return { state: 'ok', reasons: [] };
}

/** Cable, tube (when the layout is recorded) and fibre, OLT side first. */
function coreSteps(g: TraceGraph, cableId: string, core: number, links: Connection[]): TraceStep[] {
  const cable = g.cables.get(cableId);
  if (!cable) return [gapStep(`gap:cable:${cableId}`, `Cable ${cableId} is named on this path but is not on record.`)];
  const id = coreIdentity(cable, core, g.schemes);
  const coords = cable.coordinates ?? [];
  const mid = coords[Math.floor(coords.length / 2)];
  const cableState: TraceStepState = cable.status === 'Damaged' ? 'faulty' : cable.status === 'Planned' ? 'planned' : cable.status === 'Maintenance' ? 'warning' : 'ok';
  const cableReasons = cableState === 'ok' ? [] : [`${cable.name} is marked ${cable.status.toLowerCase()}.`];
  const steps: TraceStep[] = [
    makeStep(g, {
      key: `cable:${cableId}`,
      kind: 'cable',
      title: cable.name,
      detail: [cable.type, `${cable.fiberCount} fibres`, cable.lengthMeters > 0 ? `${Math.round(cable.lengthMeters)} m recorded` : 'length not recorded'].join(' · '),
      ids: [cableId],
      state: cableState,
      reasons: cableReasons,
      cableId,
      lat: mid?.[0],
      lng: mid?.[1],
    }),
  ];
  if (id.tubeNumber !== undefined) {
    steps.push(
      makeStep(g, {
        key: `tube:${cableId}#${id.tubeNumber}`,
        kind: 'tube',
        title: `Tube ${id.tubeNumber}${id.tubeColor ? ` (${id.tubeColor.name})` : ''}`,
        detail: id.tubeSchemeKnown ? `In ${cable.name}` : `In ${cable.name}. Tube colour not known.`,
        ids: [cableId],
        cableId,
        tube: id.tubeNumber,
      }),
    );
  }
  const record = cable.cores.find((k) => k.coreNumber === core);
  let state: TraceStepState = 'ok';
  const reasons: string[] = [];
  if (!id.exists) {
    return [...steps, gapStep(`gap:core:${cableId}#${core}`, `${cable.name} has ${cable.fiberCount} fibres, so fibre ${core} does not exist.`)];
  }
  if (record && (record.status === 'Damaged' || record.status === 'Faulty' || record.status === 'Retired')) {
    state = 'faulty';
    reasons.push(`Fibre ${core} of ${cable.name} is marked ${record.status === 'Retired' ? 'retired (out of use)' : record.status.toLowerCase()}.`);
  } else if (record?.status === 'Under Maintenance') {
    state = 'warning';
    reasons.push(`Fibre ${core} of ${cable.name} is under maintenance.`);
  }
  steps.push(
    makeStep(g, {
      key: `core:${cableId}#${core}`,
      kind: 'core',
      title: `Fibre ${core}${id.fiberColor ? ` (${id.fiberColor.name})` : ''}`,
      detail: `${id.label} · ${cable.name}${id.schemeKnown ? '' : ' · colour scheme not recorded, shown by number'}`,
      ids: [cableId, coreKey(cableId, core)],
      state,
      reasons,
      cableId,
      core,
      ...(id.tubeNumber !== undefined ? { tube: id.tubeNumber } : {}),
      links,
      lat: mid?.[0],
      lng: mid?.[1],
    }),
  );
  return steps;
}

function ponOf(g: TraceGraph, oltId: string, ponPortId: string): { olt?: Equipment; pon?: PonPort } {
  const olt = g.equipment.get(oltId);
  return { olt, pon: olt?.ponPorts?.find((p) => p.id === ponPortId) };
}

/** OLT then its port. */
function ponSteps(g: TraceGraph, oltId: string, ponPortId: string): TraceStep[] {
  const { olt, pon } = ponOf(g, oltId, ponPortId);
  if (!olt || !pon) return [gapStep(`gap:pon:${oltId}/${ponPortId}`, `OLT ${oltId} port ${ponPortId} is named but is not on record.`)];
  const es = equipmentState(olt);
  const address = pon.vendorAddress ?? pon.slotCardPort;
  return [
    makeStep(g, { key: `equipment:${olt.id}`, kind: 'equipment', title: olt.name, detail: [olt.type, olt.technology ?? 'technology not recorded', olt.model].filter(Boolean).join(' · '), ids: [olt.id], state: es.state, reasons: es.reasons, lat: olt.lat, lng: olt.lng }),
    makeStep(g, {
      key: `port:${olt.id}/${pon.id}`,
      kind: 'port',
      title: `PON port ${pon.id}${address ? ` (${address})` : ''}`,
      detail: [pon.technology ?? olt.technology ?? 'technology not recorded', pon.txPowerDbm !== undefined ? `launch ${pon.txPowerDbm} dBm (recorded)` : 'launch not recorded', `marked ${pon.status}`].join(' · '),
      ids: [olt.id, `${olt.id}/${pon.id}`],
      state: pon.status === 'Faulty' ? 'faulty' : 'ok',
      reasons: pon.status === 'Faulty' ? [`${olt.name} ${pon.id} is marked faulty.`] : [],
      lat: olt.lat,
      lng: olt.lng,
    }),
  ];
}

function odfOf(g: TraceGraph, equipmentId: string, panelId: string, portId: string): { odf?: Equipment; panel?: OdfPanel; port?: OdfPort } {
  const odf = g.equipment.get(equipmentId);
  const panel = odf?.odfPanels?.find((p) => p.id === panelId);
  return { odf, panel, port: panel?.ports.find((p) => p.id === portId) };
}

function odfStep(g: TraceGraph, equipmentId: string, panelId: string, portId: string, links: Connection[]): TraceStep {
  const { odf, panel, port } = odfOf(g, equipmentId, panelId, portId);
  const damaged = port?.status === 'damaged';
  const es = equipmentState(odf);
  return makeStep(g, {
    key: `odf:${equipmentId}/${panelId}/${portId}`,
    kind: 'odf',
    title: `${odf?.name ?? equipmentId}, ${panel?.label ?? panelId} port ${port?.number ?? portId}`,
    detail: [odf?.type ?? 'ODF', port?.connectorType ?? panel?.connectorType ?? 'connector not recorded', port?.patch?.cordLabel ? `patch cord ${port.patch.cordLabel}` : undefined].filter(Boolean).join(' · '),
    ids: [equipmentId, `${equipmentId}/${panelId}/${portId}`],
    state: damaged ? worseState(es.state, 'faulty') : es.state,
    reasons: [...es.reasons, ...(damaged ? [`${odf?.name ?? equipmentId} ${panel?.label ?? panelId} port ${port?.number ?? portId} is marked faulty.`] : [])],
    links,
    lat: odf?.lat,
    lng: odf?.lng,
  });
}

function splitterStep(g: TraceGraph, splitterId: string, port: number | undefined, links: Connection[]): TraceStep {
  const sp = g.splitters.get(splitterId);
  if (!sp) return gapStep(`gap:splitter:${splitterId}`, `Splitter ${splitterId} is named but is not on record.`);
  const host = g.equipment.get(sp.terminalBoxId);
  const portRecord = port !== undefined ? sp.outputPorts.find((p) => p.portNumber === port) : undefined;
  let state: TraceStepState = 'ok';
  const reasons: string[] = [];
  if (sp.status === 'Faulty') {
    state = 'faulty';
    reasons.push(`Splitter ${sp.name} is marked faulty.`);
  } else if (sp.status === 'Maintenance') {
    state = 'warning';
    reasons.push(`Splitter ${sp.name} is under maintenance.`);
  }
  if (portRecord?.status === 'Faulty') {
    state = 'faulty';
    reasons.push(`Output ${port} of splitter ${sp.name} is marked faulty.`);
  }
  return makeStep(g, {
    key: `splitter:${sp.id}${port !== undefined ? `#${port}` : ''}`,
    kind: 'splitter',
    title: `Splitter ${sp.name}${port !== undefined ? `, output ${port}` : ''}`,
    detail: [sp.couplerRatio ? `coupler ${sp.couplerRatio}` : `${sp.kind ?? 'PLC'} ${sp.ratio}`, host ? `in ${host.name}` : sp.terminalBoxId ? `box ${sp.terminalBoxId} (not on record)` : 'box not recorded'].join(' · '),
    ids: [sp.id, ...(sp.terminalBoxId ? [sp.terminalBoxId] : []), ...(port !== undefined ? [`${sp.id}#${port}`] : [])],
    state,
    reasons,
    links,
    lat: host?.lat,
    lng: host?.lng,
  });
}

function spliceStep(g: TraceGraph, c: Connection): TraceStep {
  const [, closureId, spliceId] = c.id.split(':');
  const closure = g.closures.get(closureId);
  const splice = closure?.splices.find((s) => s.id === spliceId);
  const tray = closure?.trays?.find((t) => t.id === splice?.trayId);
  const failed = splice?.status === 'Failed' || splice?.status === 'Damaged';
  return makeStep(g, {
    key: `splice:${closureId}/${spliceId}`,
    kind: 'splice',
    title: `Splice in ${closure?.name ?? closureId}${tray ? `, ${tray.label}` : ''}`,
    detail: `${c.from.label} → ${c.to.label}${splice?.spliceType ? ` · ${splice.spliceType}` : ''}${splice?.spliceLossDb !== undefined ? ` · ${splice.spliceLossDb} dB recorded` : ' · loss not recorded'}`,
    ids: [closureId, ...(closure?.equipmentId ? [closure.equipmentId] : []), `${closureId}/${spliceId}`],
    state: failed ? 'faulty' : 'ok',
    reasons: failed ? [`The splice is marked ${splice!.status.toLowerCase()}.`] : [],
    links: [c],
    lat: closure?.lat,
    lng: closure?.lng,
  });
}

function customerStep(g: TraceGraph, customerId: string, links: Connection[]): TraceStep {
  const c = g.customers.get(customerId);
  if (!c) return gapStep(`gap:customer:${customerId}`, `Customer ${customerId} is named but is not on record.`);
  const state: TraceStepState = c.status === 'Pending Installation' ? 'planned' : 'ok';
  return makeStep(g, {
    key: `customer:${c.id}`,
    kind: 'customer',
    title: c.name && c.name !== c.id ? `${c.name} (${c.id})` : `Customer ${c.id}`,
    detail: [c.status, c.serviceType, c.ontSerialNumber ? `ONT ${c.ontSerialNumber} (as written on the customer)` : undefined].filter(Boolean).join(' · '),
    ids: [c.id],
    state,
    reasons: state === 'planned' ? ['The customer is pending installation.'] : [],
    links,
    lat: c.lat,
    lng: c.lng,
  });
}

function ontStep(g: TraceGraph, ontId: string, links: Connection[]): TraceStep {
  const o = g.onts.get(ontId);
  if (!o) return gapStep(`gap:ont:${ontId}`, `ONT ${ontId} is named but is not on record.`);
  const state: TraceStepState = o.status === 'faulty' ? 'faulty' : o.status === 'in_stock' ? 'planned' : 'ok';
  return makeStep(g, {
    key: `ont:${o.id}`,
    kind: 'ont',
    title: `ONT ${o.serialNumber ?? '(serial not recorded)'}`,
    detail: [[o.vendor, o.model].filter(Boolean).join(' ') || 'make not recorded', o.status.replace('_', ' ')].join(' · '),
    ids: [o.id],
    state,
    reasons: state === 'faulty' ? ['The ONT is marked faulty.'] : state === 'planned' ? ['The ONT is in stock, not installed.'] : [],
    links,
  });
}

/* ------------------------------------------------------------------ */
/* Upstream: one chain to the OLT                                      */
/* ------------------------------------------------------------------ */

const live = (list: readonly Connection[] | undefined) => list ?? [];

const describeFeeds = (list: readonly Connection[]) => list.slice(0, 4).map((c) => c.recordedIn.label).join('; ');

/** Node keys as the connection index writes them. */
const K = {
  core: (cableId: string, core: number) => endKey({ type: 'core', cableId, core }),
  pon: (oltId: string, ponPortId: string) => endKey({ type: 'pon_port', oltId, ponPortId }),
  customer: (customerId: string) => endKey({ type: 'customer', customerId }),
  ont: (ontId: string) => endKey({ type: 'ont', ontId }),
  splitterIn: (splitterId: string) => endKey({ type: 'splitter_input', splitterId }),
  splitterOut: (splitterId: string, port: number) => endKey({ type: 'splitter_output', splitterId, port }),
};

/**
 * Walks from one node towards the OLT. Steps are built customer side first and reversed at the end,
 * so the OLT comes first. Stops at a PON port (complete), or at the first missing link (a gap).
 */
export function walkUpstream(g: TraceGraph, start: ConnectionEnd, label?: string): TracePath {
  const rev: TraceStep[] = [];
  const gaps: string[] = [];
  const pushAll = (steps: TraceStep[]) => {
    for (let i = steps.length - 1; i >= 0; i -= 1) rev.push(steps[i]);
  };
  const gap = (message: string, at?: { lat?: number; lng?: number }) => {
    gaps.push(message);
    rev.push(gapStep(`gap:${gaps.length}:${message.slice(0, 40)}`, message, at));
  };
  const seen = new Set<string>();
  let ref: ConnectionEnd | undefined = start;
  let reaches: TracePath['reaches'];

  for (let guard = 0; ref && guard < 400; guard += 1) {
    const key = endKey(ref);
    if (seen.has(key)) {
      gap('The path loops back on itself. A splice or splitter link is recorded the wrong way round.');
      break;
    }
    seen.add(key);
    const feeds = live(g.up.get(key));
    switch (ref.type) {
      case 'customer': {
        const c = g.customers.get(ref.customerId);
        const drop = feeds.filter((f) => f.kind === 'customer_drop');
        const ontLinks = feeds.filter((f) => f.kind === 'customer_ont');
        pushAll([customerStep(g, ref.customerId, [...drop, ...ontLinks])]);
        if (!c) return finishPath(rev, gaps, reaches, label);
        const ontLink = ontLinks[0];
        const ontId = ontLink?.from.ref.type === 'ont' ? ontLink.from.ref.ontId : undefined;
        const ontDrop = ontId ? live(g.up.get(K.ont(ontId))).filter((f) => f.kind === 'ont_drop') : [];
        const dropCore = drop[0]?.from.ref;
        if (ontId) {
          pushAll([ontStep(g, ontId, ontDrop)]);
          const ontCore = ontDrop[0]?.from.ref;
          if (dropCore?.type === 'core' && ontCore?.type === 'core' && endKey(dropCore) !== endKey(ontCore)) {
            rev.push(noteStep(`note:ont-core:${c.id}`, 'Two fibres named', `The customer names ${drop[0].from.label}, but the ONT names ${ontDrop[0].from.label}. The customer's fibre is followed.`));
          }
          if (!dropCore && ontCore) {
            ref = ontCore;
            continue;
          }
        } else if (c.ontSerialNumber) {
          rev.push(noteStep(`note:ont:${c.id}`, `ONT ${c.ontSerialNumber}`, 'Written on the customer record; no ONT record.'));
        }
        if (!dropCore) {
          gap(`${c.name && c.name !== c.id ? c.name : `Customer ${c.id}`} has no drop fibre recorded (house wire and fibre number). Record it on the customer.`, c);
          return finishPath(rev, gaps, reaches, label);
        }
        ref = dropCore;
        continue;
      }
      case 'ont': {
        const drop = feeds.filter((f) => f.kind === 'ont_drop');
        pushAll([ontStep(g, ref.ontId, drop)]);
        if (drop.length === 0) {
          gap(`ONT ${g.onts.get(ref.ontId)?.serialNumber ?? ref.ontId} has no drop fibre recorded.`);
          return finishPath(rev, gaps, reaches, label);
        }
        ref = drop[0].from.ref;
        continue;
      }
      case 'core': {
        const coreFeeds = feeds.filter((f) => f.kind === 'splice' || f.kind === 'odf_rear' || f.kind === 'pon_feeder' || f.kind === 'splitter_output');
        const cable = g.cables.get(ref.cableId);
        const first = cable?.coordinates?.[0];
        if (coreFeeds.length > 1) {
          pushAll(coreSteps(g, ref.cableId, ref.core, []));
          gap(`${cap(describeCoreWords(g, ref.cableId, ref.core))} has ${coreFeeds.length} feeds on record (${describeFeeds(coreFeeds)}). Only one can be right, so none was followed.`, { lat: first?.[0], lng: first?.[1] });
          return finishPath(rev, gaps, reaches, label);
        }
        const feed = coreFeeds[0];
        if (!feed) {
          pushAll(coreSteps(g, ref.cableId, ref.core, []));
          if (rev.some((s) => s.kind === 'gap')) return finishPath(rev, gaps, reaches, label);
          gap(`${cap(describeCoreWords(g, ref.cableId, ref.core))} has no recorded link on its OLT side: no splice, splitter output, ODF port or OLT port feeds it. Record where it is joined.`, { lat: first?.[0], lng: first?.[1] });
          return finishPath(rev, gaps, reaches, label);
        }
        if (feed.kind === 'splice') {
          pushAll(coreSteps(g, ref.cableId, ref.core, []));
          pushAll([spliceStep(g, feed)]);
          if (feed.state === 'planned') {
            gap(`The splice in ${feed.place?.label ?? 'a closure'} is planned, not done.`);
            return finishPath(rev, gaps, reaches, label);
          }
        } else {
          pushAll(coreSteps(g, ref.cableId, ref.core, [feed]));
        }
        ref = feed.from.ref;
        continue;
      }
      case 'odf_port': {
        const front: ConnectionEnd = { ...ref, side: 'front' };
        const patches: Connection[] = live(g.up.get(endKey(front))).filter((f) => f.kind === 'odf_patch');
        pushAll([odfStep(g, ref.equipmentId, ref.panelId, ref.portId, patches)]);
        if (patches.length === 0) {
          const { odf, panel, port } = odfOf(g, ref.equipmentId, ref.panelId, ref.portId);
          gap(`${odf?.name ?? ref.equipmentId} ${panel?.label ?? ref.panelId} port ${port?.number ?? ref.portNumber} has no patch cord to an OLT port on record.`, odf);
          return finishPath(rev, gaps, reaches, label);
        }
        if (patches.length > 1) {
          gap(`This ODF port has ${patches.length} patch cords on record. Only one can be right.`);
          return finishPath(rev, gaps, reaches, label);
        }
        seen.add(endKey(front));
        ref = patches[0].from.ref;
        continue;
      }
      case 'pon_port': {
        pushAll(ponSteps(g, ref.oltId, ref.ponPortId));
        if (ponOf(g, ref.oltId, ref.ponPortId).pon) reaches = { oltId: ref.oltId, ponPortId: ref.ponPortId };
        else gaps.push(`OLT ${ref.oltId} port ${ref.ponPortId} is not on record.`);
        return finishPath(rev, gaps, reaches, label);
      }
      case 'splitter_output':
      case 'splitter_input': {
        const splitterId: string = ref.splitterId;
        const port = ref.type === 'splitter_output' ? ref.port : undefined;
        const inFeeds: Connection[] = live(g.up.get(K.splitterIn(splitterId))).filter((f) => f.kind === 'splitter_input' || f.kind === 'splitter_cascade');
        pushAll([splitterStep(g, splitterId, port, inFeeds)]);
        seen.add(K.splitterIn(splitterId));
        const sp = g.splitters.get(splitterId);
        if (!sp) return finishPath(rev, gaps, reaches, label);
        const host = g.equipment.get(sp.terminalBoxId);
        if (inFeeds.length > 1) {
          gap(`The input of splitter ${sp.name} has ${inFeeds.length} feeds on record (${describeFeeds(inFeeds)}). Only one can be right.`, host);
          return finishPath(rev, gaps, reaches, label);
        }
        if (inFeeds.length === 0) {
          const input = sp.inputPort;
          gap(
            input.connectedCableId && !input.connectedCore
              ? `The input of splitter ${sp.name} is linked to cable ${input.connectedCableId}, but not to a fibre number. Record which fibre.`
              : `The input of splitter ${sp.name} is not linked to a fibre. Record which fibre feeds it.`,
            host,
          );
          return finishPath(rev, gaps, reaches, label);
        }
        ref = inFeeds[0].from.ref;
        continue;
      }
      default: {
        gap('This kind of point has no fibre link to follow.');
        return finishPath(rev, gaps, reaches, label);
      }
    }
  }
  return finishPath(rev, gaps, reaches, label);
}

function describeCoreWords(g: TraceGraph, cableId: string, core: number): string {
  const cable = g.cables.get(cableId);
  return cable ? `fibre ${core} of ${cable.name}` : `fibre ${core} of cable ${cableId}`;
}

function finishPath(rev: TraceStep[], gaps: string[], reaches: TracePath['reaches'], label?: string): TracePath {
  const steps = [...rev].reverse();
  // A gap a step found by itself (a cable or fibre not on record) counts as much as one the walk found.
  const all = [...gaps, ...steps.filter((s) => s.kind === 'gap' && !gaps.includes(s.detail)).map((s) => s.detail)];
  return { steps, complete: all.length === 0 && !!reaches, gaps: all, ...(reaches ? { reaches } : {}), ...(label ? { label } : {}) };
}

/* ------------------------------------------------------------------ */
/* Downstream: a tree towards customers                                */
/* ------------------------------------------------------------------ */

const TREE_LIMIT = 20_000;

/** Everything a node feeds, as a tree. A dead end is shown as "nothing recorded beyond", never as a customer. */
export function buildDownstreamTree(g: TraceGraph, start: ConnectionEnd): TraceTreeNode {
  const seen = new Set<string>();
  let budget = TREE_LIMIT;
  const node = (step: TraceStep, children: TraceTreeNode[] = []): TraceTreeNode => ({ step, children });

  const visit = (ref: ConnectionEnd, links: Connection[]): TraceTreeNode => {
    budget -= 1;
    const key = endKey(ref);
    // Connectors are text only and may repeat, so they are never "reached again".
    if (ref.type !== 'connector' && seen.has(key)) return node(noteStep(`note:loop:${key}`, 'Reached again', 'This point is already in the tree above: a link is recorded twice or the wrong way round.'));
    seen.add(key);
    if (budget <= 0) return node(noteStep(`note:limit:${key}`, 'Tree cut short', `More than ${TREE_LIMIT} points: trace from a lower point to see the rest.`));
    const out = live(g.down.get(key));
    switch (ref.type) {
      case 'pon_port': {
        const [olt, port] = ponSteps(g, ref.oltId, ref.ponPortId);
        const portNode = port ? node(port, children(out)) : node(olt);
        return port ? node(olt, [portNode]) : portNode;
      }
      case 'odf_port': {
        const rear: ConnectionEnd = { ...ref, side: 'rear' };
        const front: ConnectionEnd = { ...ref, side: 'front' };
        seen.add(endKey(rear));
        seen.add(endKey(front));
        const rearOut = live(g.down.get(endKey(rear))).filter((c) => c.kind === 'odf_rear');
        return node(odfStep(g, ref.equipmentId, ref.panelId, ref.portId, links), children(rearOut));
      }
      case 'core': {
        const steps = coreSteps(g, ref.cableId, ref.core, links);
        const core = steps[steps.length - 1];
        // A customer on an ONT on this fibre is shown under the ONT, not twice.
        const viaOnt = new Set<string>();
        for (const c of out) {
          if (c.kind !== 'ont_drop' || c.to.ref.type !== 'ont') continue;
          for (const l of live(g.down.get(endKey(c.to.ref)))) if (l.kind === 'customer_ont' && l.to.ref.type === 'customer') viaOnt.add(l.to.ref.customerId);
        }
        const kids = out.filter((c) => !(c.kind === 'customer_drop' && c.to.ref.type === 'customer' && viaOnt.has(c.to.ref.customerId)));
        const childNodes = children(kids);
        if (childNodes.length === 0) childNodes.push(node(noteStep(`note:end:${key}`, 'Nothing recorded beyond', 'No splice, splitter, customer or connector is recorded on the far side of this fibre.')));
        return node(core.kind === 'gap' ? core : { ...core, title: `${core.title} of ${g.cables.get(ref.cableId)?.name ?? ref.cableId}` }, childNodes);
      }
      case 'splitter_input': {
        const sp = g.splitters.get(ref.splitterId);
        const step = splitterStep(g, ref.splitterId, undefined, links);
        if (!sp) return node(step);
        const outputs: TraceTreeNode[] = [];
        let unrecorded = 0;
        for (const p of [...sp.outputPorts].sort((a, b) => a.portNumber - b.portNumber)) {
          const outKey = K.splitterOut(sp.id, p.portNumber);
          const portOut = live(g.down.get(outKey)).filter((c) => c.kind === 'splitter_output' || c.kind === 'splitter_cascade');
          if (portOut.length === 0) {
            unrecorded += 1;
            continue;
          }
          seen.add(outKey);
          const faulty = p.status === 'Faulty';
          outputs.push(
            node(
              makeStep(g, { key: `splitter:${sp.id}#${p.portNumber}`, kind: 'port', title: `Output ${p.portNumber}${p.label ? ` (${p.label})` : ''}`, detail: `Splitter ${sp.name} · marked ${p.status}`, ids: [sp.id, `${sp.id}#${p.portNumber}`], state: faulty ? 'faulty' : 'ok', reasons: faulty ? [`Output ${p.portNumber} is marked faulty.`] : [] }),
              children(portOut),
            ),
          );
        }
        if (unrecorded > 0) outputs.push(node(noteStep(`note:outputs:${sp.id}`, `${unrecorded} output(s) with nothing recorded`, 'Free, or not recorded yet. They are never counted as free here.')));
        return node(step, outputs);
      }
      case 'customer':
        return node(customerStep(g, ref.customerId, links));
      case 'ont': {
        const users = out.filter((c) => c.kind === 'customer_ont');
        return node(ontStep(g, ref.ontId, links), children(users));
      }
      case 'connector':
        return node(makeStep(g, { key: `connector:${links[0]?.id ?? key}`, kind: 'connector', title: 'Connector (pigtail)', detail: links[0]?.to.label ?? 'connector', ids: links[0]?.place?.ids ?? [], links }));
      default:
        return node(noteStep(`note:${key}`, 'Not followed', 'This kind of point is not followed by the fibre trace.'));
    }
  };

  const children = (out: readonly Connection[]): TraceTreeNode[] => {
    const list: TraceTreeNode[] = [];
    for (const c of out) {
      if (c.kind === 'splice') {
        // The splice is its own step, with the fibre it feeds below it. A planned splice joins nothing yet.
        const below = c.state === 'planned' ? node(gapStep(`gap:planned:${c.id}`, 'This splice is planned, not done.')) : visit(c.to.ref, []);
        list.push(node(spliceStep(g, c), [below]));
        continue;
      }
      if (c.kind === 'odf_patch' && c.to.ref.type === 'odf_port') {
        list.push(visit(c.to.ref, [c]));
        continue;
      }
      if (c.kind === 'splitter_input' || c.kind === 'splitter_cascade') {
        if (c.to.ref.type === 'splitter_input') list.push(visit(c.to.ref, [c]));
        continue;
      }
      list.push(visit(c.to.ref, [c]));
    }
    return list;
  };

  return visit(start, []);
}

/* ------------------------------------------------------------------ */
/* Points                                                              */
/* ------------------------------------------------------------------ */

/** Plain words for a point. */
export function tracePointLabel(g: TraceGraph, p: TracePoint): string {
  switch (p.type) {
    case 'equipment':
      return g.equipment.get(p.id)?.name ?? `${p.id} (not on record)`;
    case 'cable':
      return g.cables.get(p.id)?.name ?? `cable ${p.id} (not on record)`;
    case 'core':
      return describeCoreWords(g, p.cableId, p.core);
    case 'pon_port':
      return `${g.equipment.get(p.oltId)?.name ?? p.oltId} ${p.ponPortId}`;
    case 'odf_port': {
      const { odf, panel, port } = odfOf(g, p.equipmentId, p.panelId, p.portId);
      return `${odf?.name ?? p.equipmentId} ${panel?.label ?? p.panelId} port ${port?.number ?? p.portId}`;
    }
    case 'splitter':
      return `splitter ${g.splitters.get(p.id)?.name ?? p.id}${p.port !== undefined ? ` output ${p.port}` : ''}`;
    case 'customer': {
      const c = g.customers.get(p.id);
      return c ? (c.name && c.name !== c.id ? `${c.name} (${c.id})` : `customer ${c.id}`) : `customer ${p.id} (not on record)`;
    }
    case 'ont':
      return `ONT ${g.onts.get(p.id)?.serialNumber ?? p.id}`;
    case 'closure':
      return `closure ${g.closures.get(p.id)?.name ?? p.id}`;
    case 'splice':
      return `splice ${p.spliceId} in ${g.closures.get(p.closureId)?.name ?? p.closureId}`;
    case 'fault':
      return `fault ${p.id}`;
    case 'service':
      return `service ${p.id}`;
  }
}

/** The ids a step must carry to stand for this point (for "between two points"). */
function pointMatchIds(p: TracePoint): string[] {
  switch (p.type) {
    case 'core':
      return [coreKey(p.cableId, p.core)];
    case 'pon_port':
      return [`${p.oltId}/${p.ponPortId}`];
    case 'odf_port':
      return [`${p.equipmentId}/${p.panelId}/${p.portId}`];
    case 'splitter':
      return [p.port !== undefined ? `${p.id}#${p.port}` : p.id];
    case 'splice':
      return [`${p.closureId}/${p.spliceId}`];
    default:
      return [p.id];
  }
}

const usedCores = (g: TraceGraph, cableId: string): number[] => {
  const cable = g.cables.get(cableId);
  if (!cable) return [];
  const cores: number[] = [];
  for (let n = 1; n <= cable.fiberCount; n += 1) {
    const k = K.core(cableId, n);
    if ((g.up.get(k)?.length ?? 0) > 0 || (g.down.get(k)?.length ?? 0) > 0) cores.push(n);
  }
  return cores;
};

export interface PointStarts {
  /** Nodes to walk towards the OLT from. */
  up: { ref: ConnectionEnd; label: string }[];
  /** Nodes to build a downstream tree from. */
  down: { ref: ConnectionEnd; label: string }[];
  /** Why there is nothing to follow, when there is nothing. */
  none?: string;
}

/**
 * Where a point enters the fibre links. A cable is every fibre with a link on record; a box is its
 * splitters and the splices of its closures; an OLT is its PON ports; an ODF its ports. Nothing is
 * worked out from which cables end at an item.
 */
export function pointStarts(g: TraceGraph, p: TracePoint): PointStarts {
  const up: PointStarts['up'] = [];
  const down: PointStarts['down'] = [];
  const both = (ref: ConnectionEnd, label: string) => {
    up.push({ ref, label });
    down.push({ ref, label });
  };
  const splitterIn = (sp: Splitter) => both({ type: 'splitter_input', splitterId: sp.id }, `splitter ${sp.name}`);
  const spliceRefs = (closureId: string, spliceIds?: string[]) => {
    const closure = g.closures.get(closureId);
    for (const s of closure?.splices ?? []) {
      if (spliceIds && !spliceIds.includes(s.id)) continue;
      if (s.retiredAt || s.enteredInError || s.status === 'Unused') continue;
      const label = `splice ${s.id} in ${closure!.name}`;
      up.push({ ref: { type: 'core', cableId: s.outputCableId, core: s.outputCore }, label });
      down.push({ ref: { type: 'core', cableId: s.inputCableId, core: s.inputCore }, label });
    }
  };
  switch (p.type) {
    case 'core':
      both({ type: 'core', cableId: p.cableId, core: p.core }, describeCoreWords(g, p.cableId, p.core));
      break;
    case 'cable':
      for (const n of usedCores(g, p.id)) both({ type: 'core', cableId: p.id, core: n }, describeCoreWords(g, p.id, n));
      if (up.length === 0) return { up, down, none: `No fibre of ${tracePointLabel(g, p)} has a link on record (splice, splitter, ODF or OLT port, drop).` };
      break;
    case 'pon_port':
      both({ type: 'pon_port', oltId: p.oltId, ponPortId: p.ponPortId }, tracePointLabel(g, p));
      break;
    case 'odf_port': {
      const { port } = odfOf(g, p.equipmentId, p.panelId, p.portId);
      both({ type: 'odf_port', equipmentId: p.equipmentId, panelId: p.panelId, portId: p.portId, portNumber: port?.number ?? 0, side: 'rear' }, tracePointLabel(g, p));
      break;
    }
    case 'splitter': {
      const sp = g.splitters.get(p.id);
      if (!sp) return { up, down, none: `Splitter ${p.id} is not on record.` };
      if (p.port !== undefined) {
        up.push({ ref: { type: 'splitter_output', splitterId: sp.id, port: p.port }, label: tracePointLabel(g, p) });
        const outs = live(g.down.get(K.splitterOut(sp.id, p.port)));
        for (const c of outs) down.push({ ref: c.to.ref, label: tracePointLabel(g, p) });
        if (outs.length === 0) down.push({ ref: { type: 'splitter_input', splitterId: sp.id }, label: `splitter ${sp.name}` });
      } else splitterIn(sp);
      break;
    }
    case 'customer':
      both({ type: 'customer', customerId: p.id }, tracePointLabel(g, p));
      break;
    case 'ont':
      both({ type: 'ont', ontId: p.id }, tracePointLabel(g, p));
      break;
    case 'closure':
      spliceRefs(p.id);
      if (up.length === 0) return { up, down, none: `${cap(tracePointLabel(g, p))} has no splice in service on record.` };
      break;
    case 'splice':
      spliceRefs(p.closureId, [p.spliceId]);
      if (up.length === 0) return { up, down, none: `Splice ${p.spliceId} is not in service in ${g.closures.get(p.closureId)?.name ?? p.closureId} (or not on record).` };
      break;
    case 'equipment': {
      const eq = g.equipment.get(p.id);
      if (!eq) return { up, down, none: `${p.id} is not on record.` };
      for (const pon of eq.ponPorts ?? []) both({ type: 'pon_port', oltId: eq.id, ponPortId: pon.id }, `${eq.name} ${pon.id}`);
      for (const panel of eq.odfPanels ?? []) {
        for (const port of panel.ports) {
          if (!port.patch && !port.feederCableId) continue;
          both({ type: 'odf_port', equipmentId: eq.id, panelId: panel.id, portId: port.id, portNumber: port.number, side: 'rear' }, `${eq.name} ${panel.label} port ${port.number}`);
        }
      }
      for (const sp of g.data.splitters) if (sp.terminalBoxId === eq.id) splitterIn(sp);
      for (const cl of g.data.closures) if (cl.equipmentId === eq.id) spliceRefs(cl.id);
      if (up.length === 0) {
        return { up, down, none: `${eq.name} has no fibre link of its own on record (no PON or ODF port in use, no splitter inside, no closure with splices). Trace one of its cables, or see where its cables run.` };
      }
      break;
    }
    case 'fault':
    case 'service':
      return { up, down, none: 'Use the fault or service trace for this.' };
  }
  return { up, down };
}

/* ------------------------------------------------------------------ */
/* Results                                                             */
/* ------------------------------------------------------------------ */

/** Every step of a result once, paths first then trees, in order. */
export function traceSteps(result: Pick<NetworkTraceResult, 'paths' | 'trees'>): { step: TraceStep; depth: number; group: number }[] {
  const out: { step: TraceStep; depth: number; group: number }[] = [];
  result.paths.forEach((p, group) => p.steps.forEach((step) => out.push({ step, depth: 0, group })));
  const walk = (n: TraceTreeNode, depth: number, group: number) => {
    out.push({ step: n.step, depth, group });
    for (const c of n.children) walk(c, depth + 1, group);
  };
  result.trees.forEach((t, i) => walk(t, 0, result.paths.length + i));
  return out;
}

function result(g: TraceGraph, base: Pick<NetworkTraceResult, 'type' | 'title' | 'fromLabel' | 'level'> & Partial<Pick<NetworkTraceResult, 'toLabel' | 'paths' | 'trees' | 'warnings' | 'notes'>> & { gaps?: string[] }): NetworkTraceResult {
  const paths = base.paths ?? [];
  const trees = base.trees ?? [];
  const all = traceSteps({ paths, trees });
  const counts = { ok: 0, unverified: 0, warning: 0, planned: 0, faulty: 0, missing: 0, steps: 0 } as NetworkTraceResult['counts'];
  const cableIds = new Set<string>();
  const equipmentIds = new Set<string>();
  const coreKeys = new Set<string>();
  const customerIds = new Set<string>();
  const splitterIds = new Set<string>();
  const closureIds = new Set<string>();
  const gaps = [...(base.gaps ?? [])];
  for (const { step } of all) {
    if (step.kind === 'note') continue;
    counts.steps += 1;
    counts[step.state] += 1;
    if (step.kind === 'gap' && !gaps.includes(step.detail)) gaps.push(step.detail);
    if (step.cableId) cableIds.add(step.cableId);
    if (step.kind === 'core' && step.cableId && step.core) coreKeys.add(coreKey(step.cableId, step.core));
    if (step.kind === 'customer') step.ids.forEach((id) => customerIds.add(id));
    if (step.kind === 'splitter' && step.ids[0]) splitterIds.add(step.ids[0]);
    if (step.kind === 'splice' && step.ids[0]) closureIds.add(step.ids[0]);
    for (const id of step.ids) if (g.equipment.has(id)) equipmentIds.add(id);
  }
  for (const p of paths) for (const gp of p.gaps) if (!gaps.includes(gp)) gaps.push(gp);
  return {
    type: base.type,
    title: base.title,
    fromLabel: base.fromLabel,
    ...(base.toLabel ? { toLabel: base.toLabel } : {}),
    level: base.level,
    paths,
    trees,
    complete: gaps.length === 0 && counts.missing === 0,
    gaps,
    warnings: base.warnings ?? [],
    notes: base.notes ?? [],
    cableIds: [...cableIds],
    equipmentIds: [...equipmentIds],
    coreKeys: [...coreKeys],
    customerIds: [...customerIds],
    splitterIds: [...splitterIds],
    closureIds: [...closureIds],
    counts,
  };
}

const UNVERIFIED_NOTE = 'A link marked "Not checked" is on record but nobody has recorded a check of it (OTDR, red light, meter or looking at it). It is shown, never hidden.';

/** Walks towards the OLT from every start of a point. */
export function upstreamPaths(g: TraceGraph, p: TracePoint): { paths: TracePath[]; none?: string } {
  const starts = pointStarts(g, p);
  if (starts.none) return { paths: [], none: starts.none };
  const seen = new Set<string>();
  const paths: TracePath[] = [];
  for (const s of starts.up) {
    const k = endKey(s.ref);
    if (seen.has(k)) continue;
    seen.add(k);
    paths.push(walkUpstream(g, s.ref, s.label));
  }
  return { paths };
}

function traceUpstreamOf(g: TraceGraph, type: TraceType, p: TracePoint): NetworkTraceResult {
  const fromLabel = tracePointLabel(g, p);
  const { paths, none } = upstreamPaths(g, p);
  return result(g, {
    type,
    title: `${TRACE_TYPE_LABELS[type]}: ${fromLabel}`,
    fromLabel,
    level: 'fibre',
    paths,
    ...(none ? { gaps: [none] } : {}),
    notes: [UNVERIFIED_NOTE],
  });
}

function traceDownstreamOf(g: TraceGraph, type: TraceType, p: TracePoint): NetworkTraceResult {
  const fromLabel = tracePointLabel(g, p);
  const starts = pointStarts(g, p);
  const trees: TraceTreeNode[] = [];
  const seen = new Set<string>();
  for (const s of starts.down) {
    const k = endKey(s.ref);
    if (seen.has(k)) continue;
    seen.add(k);
    trees.push(buildDownstreamTree(g, s.ref));
  }
  const res = result(g, { type, title: `${TRACE_TYPE_LABELS[type]}: ${fromLabel}`, fromLabel, level: 'fibre', trees, ...(starts.none ? { gaps: [starts.none] } : {}), notes: [UNVERIFIED_NOTE] });
  const customers = res.customerIds.length;
  res.notes.unshift(`${customers} customer(s) reached through recorded links. A customer whose fibres are not recorded is not in this tree.`);
  return res;
}

/** "Between two points": one feeds the other, they share a feed, or no recorded link joins them. */
function traceBetween(g: TraceGraph, type: TraceType, a: TracePoint, b: TracePoint): NetworkTraceResult {
  const fromLabel = tracePointLabel(g, a);
  const toLabel = tracePointLabel(g, b);
  const title = `${TRACE_TYPE_LABELS[type]}: ${fromLabel} and ${toLabel}`;
  const A = upstreamPaths(g, a);
  const B = upstreamPaths(g, b);
  const aIds = new Set(pointMatchIds(a));
  const bIds = new Set(pointMatchIds(b));
  const matches = (s: TraceStep, ids: Set<string>) => s.ids.some((id) => ids.has(id));
  const segment = (path: TracePath, ids: Set<string>): TracePath | undefined => {
    let j = -1;
    for (let i = path.steps.length - 1; i >= 0; i -= 1) if (matches(path.steps[i], ids)) {
      j = i;
      break;
    }
    if (j < 0) return undefined;
    while (j > 0 && matches(path.steps[j - 1], ids)) j -= 1;
    const steps = path.steps.slice(j);
    const gaps = steps.filter((s) => s.kind === 'gap').map((s) => s.detail);
    return { steps, complete: gaps.length === 0, gaps };
  };
  const shortest = (list: (TracePath | undefined)[]) => list.filter((x): x is TracePath => !!x).sort((x, y) => x.steps.length - y.steps.length)[0];
  const aFeedsB = shortest(B.paths.map((p) => segment(p, aIds)));
  const bFeedsA = shortest(A.paths.map((p) => segment(p, bIds)));
  const best = aFeedsB && bFeedsA ? (aFeedsB.steps.length <= bFeedsA.steps.length ? aFeedsB : bFeedsA) : (aFeedsB ?? bFeedsA);
  if (best) {
    const relation = best === aFeedsB ? `${cap(fromLabel)} feeds ${toLabel}.` : `${cap(toLabel)} feeds ${fromLabel}.`;
    return result(g, { type, title, fromLabel, toLabel, level: 'fibre', paths: [{ ...best, label: relation }], notes: [relation, UNVERIFIED_NOTE] });
  }
  // A shared feed: the step nearest the two points that is on both paths.
  let shared: { pa: TracePath; pb: TracePath; ia: number; ib: number } | undefined;
  // Two outputs of one splitter meet at that splitter.
  const meetKey = (s: TraceStep) => (s.kind === 'splitter' && s.ids[0] ? `splitter:${s.ids[0]}` : s.key);
  for (const pa of A.paths) {
    const keys = new Map(pa.steps.map((s, i) => [meetKey(s), i] as const));
    for (const pb of B.paths) {
      for (let ib = pb.steps.length - 1; ib >= 0; ib -= 1) {
        const ia = keys.get(meetKey(pb.steps[ib]));
        if (ia === undefined || pb.steps[ib].kind === 'gap' || pb.steps[ib].kind === 'note') continue;
        if (!shared || pa.steps.length - ia + pb.steps.length - ib < shared.pa.steps.length - shared.ia + shared.pb.steps.length - shared.ib) shared = { pa, pb, ia, ib };
        break;
      }
    }
  }
  if (shared) {
    const at = shared.pa.steps[shared.ia];
    const toA = shared.pa.steps.slice(shared.ia);
    const toB = shared.pb.steps.slice(shared.ib);
    const words = `Both are fed through ${at.title}.`;
    return result(g, {
      type,
      title,
      fromLabel,
      toLabel,
      level: 'fibre',
      paths: [
        { steps: toA, complete: !toA.some((s) => s.kind === 'gap'), gaps: toA.filter((s) => s.kind === 'gap').map((s) => s.detail), label: `From ${at.title} to ${fromLabel}` },
        { steps: toB, complete: !toB.some((s) => s.kind === 'gap'), gaps: toB.filter((s) => s.kind === 'gap').map((s) => s.detail), label: `From ${at.title} to ${toLabel}` },
      ],
      notes: [words, UNVERIFIED_NOTE],
    });
  }
  const why = [A.none, B.none, ...A.paths.flatMap((p) => p.gaps.slice(0, 1)), ...B.paths.flatMap((p) => p.gaps.slice(0, 1))].filter((x): x is string => !!x);
  return result(g, {
    type,
    title,
    fromLabel,
    toLabel,
    level: 'fibre',
    gaps: [`No recorded link joins ${fromLabel} and ${toLabel}. Nothing is joined because they are near each other.`, ...[...new Set(why)].slice(0, 4)],
    notes: [UNVERIFIED_NOTE],
  });
}

/** Where the cables of a path run: each cable with its stretches, ducts and poles or spans, as recorded. */
function routeDetail(g: TraceGraph, cableId: string): string {
  const parts: string[] = [];
  const segments = (g.data.cableSegments ?? []).filter((s) => s.cableId === cableId);
  for (const s of segments) {
    const where = s.ductId ? `in duct ${s.ductId}${s.ductWayId ? ` (way ${s.ductWayId})` : ''}` : s.spanIds?.length ? `on ${s.spanIds.length} span(s)` : 'place not recorded';
    parts.push(`${s.installMethod ?? 'install method not recorded'} ${where}${s.measuredLengthMeters ? `, ${s.measuredLengthMeters} m measured` : ''}`);
  }
  const asNet = g.data as unknown as NetworkData;
  const ducts = ductsForCable({ ...asNet, ducts: g.data.ducts ?? [] } as NetworkData, cableId);
  if (ducts.length && !segments.some((s) => s.ductId)) parts.push(`listed in duct ${ducts.map((d) => d.duct.id).join(', ')}`);
  const attachments = (g.data.attachments ?? []).filter((a) => a.cableId === cableId);
  const poles = attachments.filter((a) => a.structureId).length;
  const spans = attachments.filter((a) => a.spanId).length;
  if (poles || spans) parts.push(`recorded on ${poles} pole(s) and ${spans} span(s)`);
  return parts.length ? parts.join('; ') : 'No stretch, duct or pole is recorded for this cable: only its drawn line.';
}

function physicalRoute(g: TraceGraph, p: TracePoint, to?: TracePoint): NetworkTraceResult {
  const fibre = to ? traceBetween(g, 'physical_route', p, to) : traceUpstreamOf(g, 'physical_route', p);
  const keep = new Set<TraceStepKind>(['equipment', 'odf', 'cable', 'splice', 'splitter', 'customer', 'gap']);
  const paths: TracePath[] = fibre.paths
    .filter((path) => path.steps.some((s) => s.kind === 'cable'))
    .map((path) => ({
      ...path,
      steps: path.steps
        .filter((s) => keep.has(s.kind))
        .map((s) => (s.kind === 'cable' && s.cableId ? { ...s, kind: 'route' as const, detail: `${s.detail} · ${routeDetail(g, s.cableId)}` } : s)),
    }));
  if (paths.length > 0) {
    return result(g, { type: 'physical_route', title: `${TRACE_TYPE_LABELS.physical_route}: ${fibre.fromLabel}`, fromLabel: fibre.fromLabel, ...(fibre.toLabel ? { toLabel: fibre.toLabel } : {}), level: 'fibre', paths, notes: ['The cables come from the recorded fibre links. Each cable shows its stretches, ducts and poles as recorded; the drawn line is an estimate.'] });
  }
  // No fibre on record end to end: the cable-level route is the honest answer, labelled as such.
  const id = p.type === 'customer' || p.type === 'equipment' || p.type === 'cable' || p.type === 'closure' ? p.id : p.type === 'core' ? p.cableId : p.type === 'splitter' ? p.id : p.type === 'pon_port' ? `${p.oltId}/${p.ponPortId}` : undefined;
  const legacy = id ? resolveTraceTarget(id, traceDataOf(g), g.settings) : null;
  if (!legacy || legacy.nodes.length === 0) {
    return result(g, { type: 'physical_route', title: `${TRACE_TYPE_LABELS.physical_route}: ${fibre.fromLabel}`, fromLabel: fibre.fromLabel, level: 'cable', gaps: fibre.gaps.length ? fibre.gaps : ['Nothing on record shows where this runs.'] });
  }
  const steps: TraceStep[] = legacy.nodes.map((n, i) => {
    const isCable = g.cables.has(n.id);
    return {
      key: `legacy:${i}:${n.id}`,
      kind: isCable ? 'route' : n.type === 'Customer' ? 'customer' : n.type === 'Splitter' ? 'splitter' : 'equipment',
      title: n.name,
      detail: isCable ? `${n.details} · ${routeDetail(g, n.id)}` : n.details,
      state: n.status === 'Faulty' ? 'faulty' : n.status === 'Warning' ? 'warning' : 'unverified',
      reasons: n.status === 'Normal' ? ['Cables only: the fibres are not recorded end to end, so this is not a proven path.'] : [],
      ids: [n.id],
      ...(isCable ? { cableId: n.id } : {}),
      links: [],
      ...(n.lat !== undefined && n.lng !== undefined ? { lat: n.lat, lng: n.lng } : {}),
    };
  });
  return result(g, {
    type: 'physical_route',
    title: `${TRACE_TYPE_LABELS.physical_route}: ${fibre.fromLabel}`,
    fromLabel: fibre.fromLabel,
    level: 'cable',
    paths: [{ steps, complete: false, gaps: [] }],
    gaps: [...fibre.gaps.slice(0, 3), ...legacy.summary.warnings.slice(0, 3)],
    notes: ['Cables only: the fibres are not recorded end to end. This follows cable ends, so it shows where cables go, not that light gets through.'],
  });
}

function traceDataOf(g: TraceGraph): TraceData {
  return { equipment: [...g.data.equipment], cables: [...g.data.cables], splitters: [...g.data.splitters], closures: [...g.data.closures], customers: [...g.data.customers], faults: [...(g.data.faults ?? [])] };
}

const LOGICAL_KIND: Record<LogicalNode['kind'], TraceStepKind> = { olt: 'equipment', pon: 'port', splitter: 'splitter', output: 'port', ont: 'ont', customer: 'customer', service: 'service', gap: 'gap', note: 'note' };

function logicalService(g: TraceGraph, p: TracePoint): NetworkTraceResult {
  const services = g.data.services ?? [];
  let customerId: string | undefined;
  if (p.type === 'customer') customerId = p.id;
  else if (p.type === 'service') customerId = services.find((s) => s.id === p.id)?.customerId;
  else if (p.type === 'ont') customerId = g.data.customers.find((c) => c.ontId === p.id)?.id;
  const fromLabel = tracePointLabel(g, p);
  if (!customerId) return result(g, { type: 'logical_service', title: `${TRACE_TYPE_LABELS.logical_service}: ${fromLabel}`, fromLabel, level: 'logical', gaps: ['No customer is recorded for this, so no service path can be shown.'] });
  const physical = upstreamPaths(g, { type: 'customer', id: customerId });
  const topo = serviceTopology({ ...g.data, onts: g.data.onts, services: g.data.services, buildings: g.data.buildings } as Parameters<typeof serviceTopology>[0], { settings: g.settings });
  // The branch from a PON port down to this customer and their services.
  const chain: LogicalNode[] = [];
  const find = (n: LogicalNode, trail: LogicalNode[]): boolean => {
    const next = [...trail, n];
    if (n.kind === 'customer' && n.ref?.id === customerId) {
      chain.push(...next, ...n.children);
      return true;
    }
    return n.children.some((c) => find(c, next));
  };
  topo.roots.some((r) => find(r, []));
  const logicalSteps: TraceStep[] = chain.map((n, i) => ({
    key: `logical:${i}:${n.key}`,
    kind: LOGICAL_KIND[n.kind],
    title: n.label,
    detail: n.detail ?? '',
    // Services and VLANs carry no recorded check: never "Checked good".
    state: n.status === 'gap' ? 'missing' : n.status === 'warning' ? 'warning' : 'unverified',
    reasons: n.status === 'ok' ? [] : [n.detail ?? n.label],
    ids: n.ref ? [n.ref.id] : [],
    links: [],
  }));
  const paths: TracePath[] = [...physical.paths.map((x) => ({ ...x, label: 'Physical: the fibres' }))];
  const gaps: string[] = [];
  if (logicalSteps.length) paths.push({ steps: logicalSteps, complete: !logicalSteps.some((s) => s.state === 'missing'), gaps: [], label: 'Logical: port, ONT and services' });
  else gaps.push('This customer is not reached from any OLT port in the service view, so the service path stops at the first missing fibre link.');
  return result(g, {
    type: 'logical_service',
    title: `${TRACE_TYPE_LABELS.logical_service}: ${fromLabel}`,
    fromLabel,
    level: 'logical',
    paths,
    gaps,
    notes: ['The service path is worked out from the same fibre links (the service view). VLAN and service binding are shown only where they are recorded.', UNVERIFIED_NOTE],
  });
}

/** The element a point or fault names, for the impact question. */
function elementOf(g: TraceGraph, p: TracePoint): NetworkElementRef | undefined {
  switch (p.type) {
    case 'fault': {
      const f = (g.data.faults ?? []).find((x) => x.id === p.id);
      if (!f) return undefined;
      if (f.element) return f.element;
      if (f.affectedCableId) return { type: 'cable', id: f.affectedCableId };
      if (f.affectedEquipmentId) return { type: 'equipment', id: f.affectedEquipmentId };
      return undefined;
    }
    case 'equipment':
      return { type: g.equipment.get(p.id)?.type === 'OLT' ? 'olt' : 'equipment', id: p.id };
    case 'cable':
      return { type: 'cable', id: p.id };
    case 'core':
      return { type: 'core', id: p.cableId, fiberNumber: p.core };
    case 'pon_port':
      return { type: 'pon_port', id: p.oltId, ponPortId: p.ponPortId };
    case 'splitter':
      return { type: 'splitter', id: p.id };
    case 'customer':
      return { type: 'customer', id: p.id };
    case 'ont':
      return { type: 'ont', id: p.id };
    case 'closure':
    case 'splice':
      return { type: 'closure', id: p.type === 'closure' ? p.id : p.closureId };
    default:
      return undefined;
  }
}

function faultImpactOf(g: TraceGraph, p: TracePoint): NetworkTraceResult {
  const fromLabel = tracePointLabel(g, p);
  const el = elementOf(g, p);
  if (!el) return result(g, { type: 'fault_impact', title: `${TRACE_TYPE_LABELS.fault_impact}: ${fromLabel}`, fromLabel, level: 'impact', gaps: ['The fault names no element (cable, item, port, fibre), so nobody can be listed.'] });
  const ix = buildImpactIndex(g.data as unknown as ImpactData, g.settings);
  const impact = affectedByElement(ix, el);
  const children: TraceTreeNode[] = [];
  const cableIds = new Set<string>();
  for (const a of impact.affected) {
    const info = ix.paths.get(a.customerId);
    info?.path.cableIds.forEach((id) => cableIds.add(id));
    const step = customerStep(g, a.customerId, []);
    children.push({
      step: { ...step, state: worseState(step.state, a.pathComplete ? 'warning' : 'missing'), reasons: [...step.reasons, a.pathComplete ? 'On the recorded path through this element.' : 'On the recorded part of the path; the rest of the path is not recorded.', ...(a.services.length ? [`${a.services.length} service(s) on record.`] : [])] },
      children: [],
    });
  }
  for (const m of impact.mayBeAffected) {
    const step = customerStep(g, m.customerId, []);
    children.push({ step: { ...step, state: worseState(step.state, 'unverified'), reasons: [`May be affected: ${m.reason}. First missing link: ${m.firstGap}`] }, children: [] });
  }
  const root: TraceStep = { key: `impact:${impact.label}`, kind: 'note', title: impact.label, detail: `${impact.affected.length} customer(s) affected, ${impact.mayBeAffected.length} may be affected, ${impact.activeServices} active service(s).`, state: impact.exists ? 'ok' : 'missing', reasons: [], ids: [el.id], links: [] };
  const res = result(g, { type: 'fault_impact', title: `${TRACE_TYPE_LABELS.fault_impact}: ${fromLabel}`, fromLabel, level: 'impact', trees: [{ step: root, children }], notes: impact.notes, ...(impact.exists ? {} : { gaps: [`${impact.label} is not on record.`] }) });
  // Highlight the cables the affected customers' recorded paths use.
  res.cableIds = [...new Set([...res.cableIds, ...cableIds])];
  return res;
}

/** Runs any of the 12 traces. Pure: the same records and request give the same result. */
export function runNetworkTrace(g: TraceGraph, request: TraceRequest): NetworkTraceResult {
  const { type, from, to } = request;
  if (TRACE_TYPES_BETWEEN.has(type)) {
    if (!to) return result(g, { type, title: TRACE_TYPE_LABELS[type], fromLabel: tracePointLabel(g, from), level: 'fibre', gaps: ['Choose the second point.'] });
    return traceBetween(g, type, from, to);
  }
  switch (type) {
    case 'customer_to_olt':
    case 'upstream':
      return traceUpstreamOf(g, type, from);
    case 'olt_to_ont':
    case 'splitter_to_customers':
    case 'downstream':
      return traceDownstreamOf(g, type, from);
    case 'physical_route':
      return physicalRoute(g, from, to);
    case 'logical_service':
      return logicalService(g, from);
    case 'fault_impact':
      return faultImpactOf(g, from);
    default:
      return traceUpstreamOf(g, 'upstream', from);
  }
}

/** One call for screens and tests that have the records but no graph yet. */
export function traceNetwork(data: NetworkTraceData, request: TraceRequest, options: TraceGraphOptions = {}): NetworkTraceResult {
  return runNetworkTrace(buildTraceGraph(data, options), request);
}

/** The point an id names, looked up in this order: customer, ONT, equipment, cable, closure, splitter, fault, service, `OLT/PORT`, `CABLE#FIBRE`. */
export function tracePointFromId(g: TraceGraph, raw: string): TracePoint | undefined {
  const id = raw.trim();
  if (!id) return undefined;
  if (g.customers.has(id)) return { type: 'customer', id };
  if (g.onts.has(id)) return { type: 'ont', id };
  if (g.equipment.has(id)) return { type: 'equipment', id };
  if (g.cables.has(id)) return { type: 'cable', id };
  if (g.closures.has(id)) return { type: 'closure', id };
  if (g.splitters.has(id)) return { type: 'splitter', id };
  if ((g.data.faults ?? []).some((f) => f.id === id)) return { type: 'fault', id };
  if ((g.data.services ?? []).some((s) => s.id === id)) return { type: 'service', id };
  const hash = id.lastIndexOf('#');
  if (hash > 0) {
    const cableId = id.slice(0, hash);
    const core = Number(id.slice(hash + 1));
    if (g.cables.has(cableId) && Number.isInteger(core) && core > 0) return { type: 'core', cableId, core };
  }
  const slash = id.indexOf('/');
  if (slash > 0) {
    const oltId = id.slice(0, slash);
    const ponPortId = id.slice(slash + 1);
    if (g.equipment.get(oltId)?.ponPorts?.some((p) => p.id === ponPortId)) return { type: 'pon_port', oltId, ponPortId };
  }
  const byOnt = g.data.customers.find((c) => c.ontSerialNumber && c.ontSerialNumber === id);
  if (byOnt) return { type: 'customer', id: byOnt.id };
  return undefined;
}
