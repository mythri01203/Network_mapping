import {
  type Attachment,
  type Cable,
  type ColorScheme,
  type Customer,
  DEFAULT_COLOR_SCHEMES,
  DEFAULT_OPTICAL_SETTINGS,
  type DeviceStatus,
  type Equipment,
  type JointClosure,
  latestStatus,
  type MonitoringSource,
  type OnuStatus,
  type OpticalSettings,
  type PonPort,
  showFreshness,
  showStatus,
  type Span,
  spanLine,
  type Splitter,
  splitterCapacity,
} from '@fibergis/shared';

import { type CascadeResult, dropFiberColor, walkCascade } from './cascade';
import { distance, makeProjection, pickOrigin, type Projection, seedOf } from './geoLocal';
import { summarizePon } from './lossBudget';
import { drawingFor, portColorCode, ROLE_COLORS, SWITCH_TYPES } from './models';
import type {
  BoxMount,
  CableRole,
  CustomerPath,
  LedState,
  LocalPoint,
  PonPortState,
  RackItem,
  Scene3D,
  SceneBox,
  SceneBoxPort,
  SceneCable,
  SceneHouse,
  SceneOlt,
  ScenePole,
  ScenePonPort,
  SceneRack,
  SceneSpan,
  SceneSwitch,
  SceneText,
} from './types';

/** The records `toScene3D` reads. Everything past the first five is optional. */
export interface Scene3DInput {
  equipment: readonly Equipment[];
  cables: readonly Cable[];
  splitters: readonly Splitter[];
  closures: readonly JointClosure[];
  customers: readonly Customer[];
  spans?: readonly Span[];
  attachments?: readonly Attachment[];
  onuStatuses?: readonly OnuStatus[];
  deviceStatuses?: readonly DeviceStatus[];
  monitoringSources?: readonly MonitoringSource[];
}

export interface Scene3DOptions {
  /** The origin the person picked. Default: the first OLT, else the middle of everything. */
  origin?: { lat: number; lng: number } | null;
  optical?: OpticalSettings;
  schemes?: readonly ColorScheme[];
  now?: Date;
  isDemo?: boolean;
}

/** Drawing defaults, used only when a record does not say. The panels name them. */
export const DRAWING_DEFAULTS = {
  telecomPoleHeight: 8,
  electricPoleHeight: 9,
  switchPorts: 24,
  odfPorts: 24,
  /** Customers closer than this are one building. */
  buildingCellMeters: 4,
  /** Central-office items within this of an OLT, with no rack or site written, share its rack. */
  rackJoinMeters: 40,
  /** Items with the same rack or site name share a rack only within this distance. */
  siteJoinMeters: 100,
} as const;

const PON_STATE: Record<PonPort['status'], PonPortState> = {
  Active: 'in_use',
  Available: 'free',
  Faulty: 'fault',
  Reserved: 'reserved',
};
const PON_LED: Record<PonPortState, LedState> = { in_use: 'blink', free: 'off', fault: 'amber', reserved: 'steady' };

function oltModel(olt: Equipment, cascade: CascadeResult, input: Scene3DInput, now: Date): SceneOlt {
  const ponPorts = [...(olt.ponPorts ?? [])].sort((a, b) => a.portNumber - b.portNumber);
  const ports: ScenePonPort[] = ponPorts.map((pon) => {
    const state = PON_STATE[pon.status] ?? 'free';
    let led = PON_LED[state];
    const rows = (input.deviceStatuses ?? []).filter(
      (r) => r.target === 'pon_port' && r.oltId === olt.id && r.ponPortId === pon.id,
    );
    const row =
      rows.filter((r) => !r.isTest).sort((a, b) => b.deviceTime.localeCompare(a.deviceTime))[0] ??
      rows.sort((a, b) => b.deviceTime.localeCompare(a.deviceTime))[0];
    let live: ScenePonPort['live'];
    if (row) {
      const shown = showFreshness(row, input, undefined, now);
      live = { state: row.state, note: shown.note, stale: shown.stale, test: row.isTest };
      if (!shown.stale)
        led = row.state === 'up' ? 'blink' : row.state === 'down' ? 'red' : row.state === 'degraded' ? 'amber' : led;
    }
    const tree = cascade.pons.find((t) => t.oltId === olt.id && t.ponId === pon.id);
    return {
      id: pon.id,
      label: tree?.label ?? pon.id,
      portNumber: pon.portNumber,
      state,
      led,
      live,
      customers: tree ? new Set(tree.customerIds).size : pon.connectedCustomersCount,
      feederCableId: pon.connectedFeederCableId,
    };
  });
  const ponCards = (olt.chassis?.shelves ?? [])
    .flatMap((s) => s.slots)
    .filter((s) => s.card && (s.card.kind === 'pon' || (s.card.ponPortIds?.length ?? 0) > 0));
  const recordedPerCard = Math.max(0, ...ponCards.map((s) => s.card?.portCount ?? s.card?.ponPortIds?.length ?? 0));
  const n = ports.length;
  const portsPerCard = recordedPerCard > 0 ? recordedPerCard : n <= 8 ? 4 : n <= 16 ? 8 : 16;
  const cards = ponCards.length > 0 ? ponCards.length : Math.max(1, Math.ceil(n / portsPerCard));
  return {
    equipmentId: olt.id,
    name: olt.name,
    technology: olt.technology ?? 'PON',
    ports,
    cards,
    portsPerCard,
    cardsRecorded: ponCards.length > 0,
    status: olt.status,
  };
}

function switchModel(eq: Equipment, all: readonly Equipment[]): SceneSwitch {
  const all_ = [...(eq.logicalPorts ?? [])].sort((a, b) => a.portNumber - b.portNumber);
  const isSfp = (p: { portType: string }) => /sfp|qsfp|xfp/i.test(p.portType);
  const logical = all_.filter((p) => !isSfp(p));
  const sfp = all_.filter(isSfp);
  const portsRecorded = logical.length > 0 || !!eq.totalPorts;
  const count = logical.length || Math.max(0, (eq.totalPorts ?? 0) - sfp.length) || DRAWING_DEFAULTS.switchPorts;
  const used = eq.usedPorts ?? 0;
  const ports = Array.from({ length: Math.min(48, count) }, (_, i) => {
    const rec = logical.find((p) => p.portNumber === i + 1) ?? logical[i];
    const inUse = rec ? rec.status === 'Used' : logical.length === 0 && i < used;
    const led: LedState = rec?.status === 'Damaged' ? 'amber' : inUse ? 'blink' : 'off';
    return { number: i + 1, inUse, led };
  });
  const olts = new Set(all.filter((e) => e.type === 'OLT').map((e) => e.id));
  const uplinkTo =
    all_.find((p) => p.connectedEquipmentId && olts.has(p.connectedEquipmentId))?.connectedEquipmentId ??
    all.find((e) => e.type === 'OLT' && (e.logicalPorts ?? []).some((p) => p.connectedEquipmentId === eq.id))?.id;
  return {
    equipmentId: eq.id,
    name: eq.name,
    type: eq.type,
    ports,
    portsRecorded,
    sfpUplinks: Math.max(4, sfp.length),
    uplinkTo,
  };
}

function buildRacks(input: Scene3DInput, cascade: CascadeResult, proj: Projection, now: Date): SceneRack[] {
  const coItems = input.equipment.filter((e) => drawingFor(e.type).kind === 'rack');
  const olts = coItems.filter((e) => e.type === 'OLT');
  const groups = new Map<string, Equipment[]>();
  const keyOf = (e: Equipment): string => {
    if (e.rackId) return `rack:${e.rackId}`;
    if (e.site?.trim()) return `site:${e.site.trim().toLowerCase()}`;
    if (e.type === 'OLT') return `olt:${e.id}`;
    const here = proj.toLocal(e.lat, e.lng);
    let best: Equipment | undefined;
    let bestD: number = DRAWING_DEFAULTS.rackJoinMeters;
    for (const o of olts) {
      const d = distance(here, proj.toLocal(o.lat, o.lng));
      if (d <= bestD) {
        best = o;
        bestD = d;
      }
    }
    return best ? keyOf(best) : `own:${e.id}`;
  };
  // A rack or site name is free text and can repeat across places: items share a rack only when
  // they also stand within `siteJoinMeters` of it.
  const placed: { key: string; id: string; at: LocalPoint }[] = [];
  for (const e of [...olts, ...coItems.filter((x) => x.type !== 'OLT')]) {
    const k = keyOf(e);
    const here = proj.toLocal(e.lat, e.lng);
    let group = placed.find((g) => g.key === k && distance(g.at, here) <= DRAWING_DEFAULTS.siteJoinMeters);
    if (!group) {
      const same = placed.filter((g) => g.key === k).length;
      group = { key: k, id: same ? `${k}#${same + 1}` : k, at: here };
      placed.push(group);
    }
    const list = groups.get(group.id) ?? [];
    list.push(e);
    groups.set(group.id, list);
  }
  const order = { odf: 0, olt: 1, generic: 2, switch: 3 } as const;
  const racks: SceneRack[] = [];
  for (const [id, list] of groups) {
    const anchor = list.find((e) => e.type === 'OLT') ?? list[0];
    const items: RackItem[] = list.map((e): RackItem => {
      if (e.type === 'OLT') {
        const olt = oltModel(e, cascade, input, now);
        return { kind: 'olt', heightU: e.rackUnits ?? Math.max(4, Math.ceil(olt.cards / 2) * 3), olt };
      }
      if (SWITCH_TYPES.has(e.type))
        return { kind: 'switch', heightU: e.rackUnits ?? 1, sw: switchModel(e, input.equipment) };
      if (e.type === 'ODF' || e.type === 'Fiber Patch Panel') {
        const recorded = (e.odfPanels ?? []).flatMap((p) => p.ports);
        const ports = recorded.length
          ? recorded.map((p, i) => ({ number: i + 1, inUse: !!p.patch || !!p.feederCableId }))
          : Array.from({ length: e.totalPorts || DRAWING_DEFAULTS.odfPorts }, (_, i) => ({
              number: i + 1,
              inUse: i < (e.usedPorts ?? 0),
            }));
        return {
          kind: 'odf',
          heightU: e.rackUnits ?? (ports.length > 24 ? 2 : 1),
          odf: { equipmentId: e.id, name: e.name, ports: ports.slice(0, 96) },
        };
      }
      return { kind: 'generic', heightU: e.rackUnits ?? 2, equipmentId: e.id, name: e.name, type: e.type };
    });
    const unitOf = (item: RackItem) => list.find((e) => e.id === itemId(item))?.rackUnit;
    items.sort((a, b) => {
      const ua = unitOf(a);
      const ub = unitOf(b);
      if (ua !== undefined && ub !== undefined) return ub - ua;
      return order[a.kind] - order[b.kind];
    });
    racks.push({
      id,
      label: anchor.rackNumber ? `Rack ${anchor.rackNumber}` : anchor.site ? anchor.site : `${anchor.name} rack`,
      position: proj.toLocal(anchor.lat, anchor.lng),
      items,
      furniture: 'not_recorded',
    });
  }
  // Racks of one site stand side by side instead of inside each other.
  racks.forEach((r, i) => {
    const near = racks.slice(0, i).filter((o) => distance(o.position, r.position) < 3).length;
    if (near) r.position = { x: r.position.x + near * 0.9, z: r.position.z };
  });
  return racks;
}

export const itemId = (item: RackItem): string =>
  item.kind === 'olt'
    ? item.olt.equipmentId
    : item.kind === 'switch'
      ? item.sw.equipmentId
      : item.kind === 'odf'
        ? item.odf.equipmentId
        : item.equipmentId;

function mountFor(e: Equipment, model: SceneBox['model'], aerialEnds: Set<string>): BoxMount {
  const aerial = aerialEnds.has(e.id);
  switch (model) {
    case 'fat':
      return e.type === 'Wall-Mounted Terminal Box'
        ? 'wall'
        : e.type === 'Underground Terminal Box'
          ? 'underground'
          : 'pole';
    case 'closure':
      return aerial ? 'strand' : 'ground';
    case 'cabinet':
    case 'ont':
    case 'marker':
    case 'generic':
      return 'ground';
    case 'manhole':
      return 'underground';
    case 'slack':
      return aerial ? 'strand' : 'underground';
    case 'catv_node':
    case 'catv_amp':
    case 'catv_tap':
      return aerial ? 'strand' : 'pole';
    case 'entry':
      return 'wall';
  }
}

const SPLITTER_PORT: Record<string, SceneBoxPort['state']> = {
  Occupied: 'used',
  Available: 'free',
  Faulty: 'fault',
  Reserved: 'reserved',
};

function boxPorts(e: Equipment, splitters: readonly Splitter[], cascade: CascadeResult): SceneBoxPort[] {
  const inBox = splitters.filter((s) => s.terminalBoxId === e.id);
  if (inBox.length) {
    const ports: SceneBoxPort[] = [];
    for (const sp of inBox) {
      const children = cascade.splitters.get(sp.id)?.childPorts ?? new Set<number>();
      for (let p = 1; p <= splitterCapacity(sp); p += 1) {
        if (children.has(p)) continue;
        const rec = sp.outputPorts.find((x) => x.portNumber === p);
        ports.push({
          number: ports.length + 1,
          state: rec ? (SPLITTER_PORT[rec.status] ?? 'free') : 'free',
          customerId: rec?.connectedCustomerId,
        });
      }
    }
    return ports;
  }
  if (e.totalPorts)
    return Array.from({ length: Math.min(48, e.totalPorts) }, (_, i) => ({
      number: i + 1,
      state: i < (e.usedPorts ?? 0) ? 'used' : 'free',
    }));
  return [];
}

const roleByType = (c: Cable): CableRole =>
  c.cableCategory === 'Coaxial'
    ? 'other'
    : c.type === 'Main Feeder Fiber'
      ? 'feeder'
      : c.type === 'Distribution Fiber'
        ? 'branch'
        : c.type === 'Drop Fiber'
          ? 'drop'
          : 'other';

const UNDERGROUND = new Set(['Underground', 'Duct', 'Direct Buried']);

function pathText(path: CustomerPath): string {
  const parts: string[] = [];
  const splitterHops = path.hops.filter((h) => h.kind === 'splitter');
  const lastSplitter = splitterHops[splitterHops.length - 1];
  for (const h of path.hops) {
    if (h.kind === 'pon') parts.push(h.label);
    else if (h.kind === 'gap') parts.push(`[not recorded: ${h.text}]`);
    else {
      const word = h === lastSplitter ? 'port' : 'out';
      parts.push(h.outPort ? `${h.boxName} ${word} ${h.outPort}` : `${h.boxName} (output not recorded)`);
    }
  }
  let text = parts.join(' → ');
  if (path.portColor)
    text += ` (${path.portColor.name} port code${path.fiberColor ? `, ${path.fiberColor.name} drop fiber` : ''})`;
  return text;
}

/**
 * Converts the app's records into the scene graph the 3D view draws. Pure: same input, same output;
 * reads nothing else. Every object keeps the id of the record it came from.
 */
export function toScene3D(input: Scene3DInput, options: Scene3DOptions = {}): Scene3D {
  const now = options.now ?? new Date();
  const optical = options.optical ?? DEFAULT_OPTICAL_SETTINGS;
  const schemes = options.schemes ?? DEFAULT_COLOR_SCHEMES;
  const cascade = walkCascade(input, schemes);
  const notes: SceneText[] = [];

  const firstOlt = input.equipment.find((e) => e.type === 'OLT');
  const allPoints: [number, number][] = [
    ...input.equipment.map((e) => [e.lat, e.lng] as [number, number]),
    ...input.customers.map((c) => [c.lat, c.lng] as [number, number]),
  ];
  const origin = options.origin ?? pickOrigin(allPoints, firstOlt ? [firstOlt.lat, firstOlt.lng] : null);
  const proj = makeProjection(origin);
  const eqById = new Map(input.equipment.map((e) => [e.id, e]));

  const racks = buildRacks(input, cascade, proj, now);

  // Poles
  const poles: ScenePole[] = [];
  for (const e of input.equipment) {
    const d = drawingFor(e.type);
    if (d.kind !== 'pole') continue;
    const fallback = d.electric ? DRAWING_DEFAULTS.electricPoleHeight : DRAWING_DEFAULTS.telecomPoleHeight;
    poles.push({
      id: e.id,
      name: e.name,
      position: proj.toLocal(e.lat, e.lng),
      kind: d.electric ? 'electric' : 'telecom',
      height: e.heightMeters ?? fallback,
      heightRecorded: e.heightMeters !== undefined,
    });
  }
  if (poles.some((p) => !p.heightRecorded))
    notes.push({
      key: 'note.poleHeight',
      values: {
        n: poles.filter((p) => !p.heightRecorded).length,
        telecom: DRAWING_DEFAULTS.telecomPoleHeight,
        electric: DRAWING_DEFAULTS.electricPoleHeight,
      },
    });
  const poleById = new Map(poles.map((p) => [p.id, p]));

  // Spans between structures, as recorded.
  const spans: SceneSpan[] = [];
  for (const s of input.spans ?? []) {
    const line = spanLine(s, input.equipment as Equipment[]);
    if (!line || line.length < 2) continue;
    const a = poleById.get(s.fromStructureId);
    const b = poleById.get(s.toStructureId);
    spans.push({
      id: s.id,
      fromId: s.fromStructureId,
      toId: s.toStructureId,
      points: line.map(([lat, lng]) => proj.toLocal(lat, lng)),
      power: a?.kind === 'electric' || b?.kind === 'electric',
    });
  }

  // Which boxes have an aerial cable ending at them.
  const attached = new Set((input.attachments ?? []).map((a) => a.cableId));
  const isAerial = (c: Cable, role: CableRole) =>
    c.installationType === 'Aerial' ||
    c.installationType === 'Facade' ||
    attached.has(c.id) ||
    (c.installationType === undefined && role === 'drop');
  const aerialEnds = new Set<string>();
  for (const c of input.cables) {
    const role = cascade.cableRoles.get(c.id)?.role ?? roleByType(c);
    if (!isAerial(c, role)) continue;
    if (c.startEquipmentId) aerialEnds.add(c.startEquipmentId);
    if (c.endEquipmentId) aerialEnds.add(c.endEquipmentId);
  }

  // Boxes, closures, cabinets and everything else that stands outside.
  const boxes: SceneBox[] = [];
  for (const e of input.equipment) {
    const d = drawingFor(e.type);
    if (d.kind !== 'box') continue;
    boxes.push({
      id: e.id,
      name: e.name,
      type: e.type,
      model: d.model,
      mount: mountFor(e, d.model, aerialEnds),
      position: proj.toLocal(e.lat, e.lng),
      splitters: input.splitters
        .filter((s) => s.terminalBoxId === e.id)
        .map((s) => ({ id: s.id, name: s.name, ratio: s.ratio, level: cascade.splitters.get(s.id)?.level })),
      ports: boxPorts(e, input.splitters, cascade),
      status: e.status,
    });
  }
  const boxById = new Map(boxes.map((b) => [b.id, b]));

  // Customers: numbering, paths, colours, live status.
  const active = input.customers.filter((c) => c.status !== 'Disconnected');
  const sortKey = (c: Customer) => {
    const p = cascade.paths.get(c.id);
    const box = p?.fatBoxId ? (eqById.get(p.fatBoxId)?.name ?? p.fatBoxId) : '~';
    return [box, String(p?.fatPort ?? 999).padStart(4, '0'), c.id] as const;
  };
  const sorted = [...active].sort((a, b) => {
    const ka = sortKey(a);
    const kb = sortKey(b);
    return (
      ka[0].localeCompare(kb[0], undefined, { numeric: true }) ||
      ka[1].localeCompare(kb[1]) ||
      ka[2].localeCompare(kb[2])
    );
  });

  const cell = DRAWING_DEFAULTS.buildingCellMeters;
  const houseByCell = new Map<string, SceneHouse>();
  const customers: CustomerPath[] = [];
  sorted.forEach((c, i) => {
    const pos = proj.toLocal(c.lat, c.lng);
    const cellKey = `${Math.round(pos.x / cell)}:${Math.round(pos.z / cell)}`;
    let house = houseByCell.get(cellKey);
    if (!house) {
      house = {
        id: `H-${c.id}`,
        position: pos,
        yaw: 0,
        customerIds: [],
        seed: seedOf(c.id),
        floors: 1,
        fault: false,
        number: i + 1,
      };
      houseByCell.set(cellKey, house);
    }
    house.customerIds.push(c.id);
    const walked = cascade.paths.get(c.id);
    const dropCable = walked?.dropCableId ? cascade.index.cables.get(walked.dropCableId) : undefined;
    const fiber = dropFiberColor(cascade.index, dropCable, walked?.dropCore);
    let live: CustomerPath['live'];
    if (c.ontId) {
      // A real row first; a TEST row only when there is none, and it stays labelled TEST.
      const row = latestStatus(input, c.ontId) ?? latestStatus(input, c.ontId, true);
      if (row) {
        const shown = showStatus(row, input, undefined, now);
        const bad = row.state === 'los' || row.state === 'offline' || row.state === 'dying_gasp';
        live = { state: row.state, label: shown.label, fault: bad && !shown.stale };
        if (live.fault) house.fault = true;
      }
    }
    const path: CustomerPath = {
      customerId: c.id,
      name: c.hiddenFields?.includes('name') ? c.id : c.name,
      number: i + 1,
      ponKey: walked?.ponKey,
      hops: walked?.hops ?? [{ kind: 'gap', text: 'No recorded link to a PON port' }],
      source: walked?.source ?? 'record',
      complete: walked?.complete ?? false,
      fatBoxId: walked?.fatBoxId,
      fatPort: walked?.fatPort,
      dropCableId: walked?.dropCableId,
      dropCore: walked?.dropCore,
      portColor: walked?.fatPort ? portColorCode(walked.fatPort) : undefined,
      fiberColor: fiber.chip,
      fiberColorNote: fiber.note,
      text: '',
      houseId: house.id,
      live,
    };
    path.text = pathText(path);
    customers.push(path);
  });
  const houses = [...houseByCell.values()];
  const pathById = new Map(customers.map((p) => [p.customerId, p]));
  for (const h of houses) {
    h.floors = h.customerIds.length > 1 ? Math.min(8, Math.ceil(h.customerIds.length / 2)) : 1;
    const fat = pathById.get(h.customerIds[0])?.fatBoxId;
    const target = fat ? boxById.get(fat)?.position : undefined;
    // Front of the house (its +z side) turns towards the box that serves it.
    h.yaw = target ? Math.atan2(target.x - h.position.x, target.z - h.position.z) : h.seed * Math.PI * 2;
  }
  const houseByCustomer = new Map(customers.map((p) => [p.customerId, houses.find((h) => h.id === p.houseId)!]));

  // Cables
  const cables: SceneCable[] = [];
  let undrawn = 0;
  const drawnDropFor = new Set<string>();
  for (const c of input.cables) {
    const info = cascade.cableRoles.get(c.id);
    const role = info?.role ?? roleByType(c);
    let points = c.coordinates.map(([lat, lng]) => proj.toLocal(lat, lng));
    let schematic = false;
    if (points.length < 2) {
      const a = c.startEquipmentId ? eqById.get(c.startEquipmentId) : undefined;
      const b = c.endEquipmentId ? eqById.get(c.endEquipmentId) : undefined;
      if (a && b) {
        points = [proj.toLocal(a.lat, a.lng), proj.toLocal(b.lat, b.lng)];
        schematic = true;
      } else {
        undrawn += 1;
        continue;
      }
    }
    const customer = role === 'drop' ? customers.find((p) => p.dropCableId === c.id) : undefined;
    if (customer) drawnDropFor.add(customer.customerId);
    const colorHex =
      role === 'drop'
        ? (customer?.portColor?.hex ?? ROLE_COLORS.other)
        : role === 'feeder' || role === 'branch'
          ? ROLE_COLORS.feeder
          : (c.colorHex ?? ROLE_COLORS.other);
    cables.push({
      id: c.id,
      name: c.name,
      role,
      level: info?.level,
      ponKeys: info ? [...info.ponKeys] : [],
      aerial: isAerial(c, role) && !UNDERGROUND.has(c.installationType ?? ''),
      points,
      schematic,
      startId: c.startEquipmentId,
      endId: c.endEquipmentId,
      colorHex,
      customerId: customer?.customerId,
    });
  }
  if (undrawn) notes.push({ key: 'note.undrawn', values: { n: undrawn } });

  // A customer whose box is on record but whose drop has no drawn line: a straight schematic drop,
  // marked as such, so the recorded link is visible without inventing a route.
  let schematicDrops = 0;
  for (const p of customers) {
    if (drawnDropFor.has(p.customerId) || !p.fatBoxId) continue;
    const box = boxById.get(p.fatBoxId);
    const house = houseByCustomer.get(p.customerId);
    if (!box || !house) continue;
    schematicDrops += 1;
    cables.push({
      id: `schematic:${p.customerId}`,
      name: `Drop to ${p.name} (route not drawn)`,
      role: 'drop',
      ponKeys: p.ponKey ? [p.ponKey] : [],
      aerial: true,
      points: [box.position, house.position],
      schematic: true,
      startId: box.id,
      colorHex: p.portColor?.hex ?? ROLE_COLORS.other,
      customerId: p.customerId,
    });
  }
  if (schematicDrops) notes.push({ key: 'note.schematic', values: { n: schematicDrops } });

  const pons = cascade.pons
    .map((t) => summarizePon(t, cascade, optical))
    .filter((s) => s.used > 0 || s.levels.length > 0);
  const recordOnly = customers.filter((p) => p.source === 'record').length;
  if (recordOnly) notes.push({ key: 'note.record', values: { n: recordOnly } });

  // Bounds of the main network. A record far away from all the others (say a test cable left in
  // another city) would stretch the scene to hundreds of kilometres and crush the network into one
  // spot. Such records are still drawn where they are, but left out of the bounds and named.
  const items: { name: string; pts: LocalPoint[] }[] = [
    ...racks.map((r) => ({ name: r.label, pts: [r.position] })),
    ...poles.map((p) => ({ name: p.name, pts: [p.position] })),
    ...boxes.map((b) => ({ name: b.name, pts: [b.position] })),
    ...houses.map((h) => ({ name: h.customerIds[0] ?? h.id, pts: [h.position] })),
    ...cables.filter((c) => c.points.length).map((c) => ({ name: c.name, pts: c.points })),
  ];
  const { center, extent, far } = mainBounds(items);
  if (far.length)
    notes.push({
      key: 'note.far',
      values: {
        n: far.length,
        km: FAR_KM,
        names: far
          .slice(0, 3)
          .map((f) => f.name)
          .join(', '),
      },
    });

  return {
    origin,
    extent,
    center,
    racks,
    poles,
    spans,
    boxes,
    cables,
    houses,
    customers,
    pons,
    notes,
    isDemo: !!options.isDemo,
  };
}

/** Records further than this from the middle of the network are left out of its bounds. */
export const FAR_KM = 20;

/**
 * The middle and half-size of the network, from every item's points. Items more than `FAR_KM` from
 * the median point are left out, when they are a small part (under 10%) of everything: a stray
 * record, not a second town. Pure; tested.
 */
export function mainBounds<T extends { pts: LocalPoint[] }>(
  items: readonly T[],
): { center: LocalPoint; extent: number; far: T[] } {
  const all = items.flatMap((i) => i.pts);
  if (!all.length) return { center: { x: 0, z: 0 }, extent: 30, far: [] };
  const median = (v: number[]) => {
    const s = [...v].sort((a, b) => a - b);
    return s[s.length >> 1];
  };
  const mid = { x: median(all.map((p) => p.x)), z: median(all.map((p) => p.z)) };
  const limit = FAR_KM * 1000;
  let far = items.filter((i) => i.pts.some((p) => Math.hypot(p.x - mid.x, p.z - mid.z) > limit));
  if (far.length > items.length * 0.1) far = [];
  const farSet = new Set<T>(far);
  const kept = items.filter((i) => !farSet.has(i)).flatMap((i) => i.pts);
  const pts = kept.length ? kept : all;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  return {
    center: { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 },
    extent: Math.max(30, (maxX - minX) / 2, (maxZ - minZ) / 2),
    far,
  };
}

/** Finds a customer by house number, customer id or part of the name. */
export function findCustomer(scene: Scene3D, query: string): CustomerPath | undefined {
  const q = query.trim().toLowerCase();
  if (!q) return undefined;
  if (/^\d+$/.test(q)) {
    const n = Number(q);
    const byNumber = scene.customers.find((c) => c.number === n);
    if (byNumber) return byNumber;
  }
  return (
    scene.customers.find((c) => c.customerId.toLowerCase() === q) ??
    scene.customers.find((c) => c.customerId.toLowerCase().includes(q)) ??
    scene.customers.find((c) => c.name.toLowerCase().includes(q))
  );
}
