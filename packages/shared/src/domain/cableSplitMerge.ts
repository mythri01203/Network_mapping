import type { Attachment, Cable, CoreAssignment, Customer, FiberCore, LatLng } from '../model/types';
import { mergeCableSegments, splitCableSegments } from './cableSegments';
import { type CommandContext, type CommandResult, fail, type NetworkData, type NetworkPatch, notice, sameId } from './command';
import { newConnectionProblems } from './connectionRules';
import { checkedFiberChange, completeCores } from './fiberCommands';
import { newFiberId } from './fiberIndex';
import { distanceMeters } from './fieldCapture';
import { polylineLengthMeters } from './geo';
import { cableIdPrefix, newRecordId } from './ids';
import { DEFAULT_OSP_SETTINGS, type OspSettings } from './ospSettings';
import { describeLinkProblems, findBrokenLinks, hasPlacedPosition, newOspId, pointToLine } from './outsidePlant';
import { nearestSegmentIndex, vertexNear } from './routeGeometry';
import { isoDate } from './time';

/**
 * Phase 5: splitting one cable record into two, and joining two that meet end to end into one.
 *
 * A link (a splice, an ODF feeder fibre, a splitter input, a customer's drop, a pole attachment...)
 * always lands on the part of the cable where it really is, worked out from where its record sits
 * on the line. When FiberGIS cannot tell, nothing is changed and the person is told why. Nothing is
 * ever dropped. Splitting never invents a joint: if fibre records sit on both sides of the split
 * point, the person is told the path will show a gap until the joint is recorded.
 */

type SplitSettings = Pick<OspSettings, 'poleMoveVertexMeters' | 'attachmentCorridorMeters'>;

/** First part, second part, the split point itself, or not known. */
type Side = 'A' | 'B' | 'J' | '?';

/** Every string value equal to `id` inside a record, as a path list. Record ids (`id` keys) are not counted. */
function mentions(value: unknown, id: string): boolean {
  if (typeof value === 'string') return value === id;
  if (Array.isArray(value)) return value.some((v) => mentions(v, id));
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).some(([key, v]) => key !== 'id' && mentions(v, id));
  }
  return false;
}

/** The record with every string value equal to `from` replaced by `to` (record ids left alone). */
function replaceId<T>(value: T, from: string, to: string): T {
  if (typeof value === 'string') return (value === from ? to : value) as T;
  if (Array.isArray(value)) return value.map((v) => replaceId(v, from, to)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, v]) => [key, key === 'id' ? v : replaceId(v, from, to)]),
    ) as T;
  }
  return value;
}

const dropUndefined = <T extends object>(record: T): T =>
  Object.fromEntries(Object.entries(record).filter(([, v]) => v !== undefined)) as T;

const lengthOf = (points: readonly LatLng[]) => Math.round(polylineLengthMeters(points));

const appendRemark = (remarks: string | undefined, note: string) => [remarks?.trim(), note].filter(Boolean).join(' ');

const recordName = (r: { id: string; name?: string }) => (r.name && r.name !== r.id ? `${r.name} (${r.id})` : r.id);

const listNames = (names: readonly string[], limit = 4) =>
  `${names.slice(0, limit).join(', ')}${names.length > limit ? ` and ${names.length - limit} more` : ''}`;

/** Fiber, connection and link checks on the result, the same the server runs. */
function checkedNetworkChange<T>(
  data: NetworkData,
  patch: NetworkPatch,
  value: T,
  extras: { notice: ReturnType<typeof notice>; audit: { action: string; details: string; assetId: string; assetType: 'Cable' }[]; confirm: string },
  ctx: CommandContext,
): CommandResult<T> {
  const after = { ...data, ...patch };
  const before = findBrokenLinks(data);
  const known = new Set(before.map((p) => `${p.collection}/${p.id}/${p.missingId ?? ''}/${p.message}`));
  const broken = findBrokenLinks(after).filter((p) => !known.has(`${p.collection}/${p.id}/${p.missingId ?? ''}/${p.message}`));
  if (broken.length > 0) return fail('Not changed', `${describeLinkProblems(broken)} Nothing was changed.`);
  const connection = newConnectionProblems(data, after);
  if (connection.errors.length > 0) {
    return fail('Not changed', `${connection.errors[0].message}${connection.errors.length > 1 ? ` (and ${connection.errors.length - 1} more)` : ''} Nothing was changed.`);
  }
  const checked = checkedFiberChange(data, patch, value, { notice: extras.notice, audit: extras.audit }, ctx);
  if (!checked.ok) return checked;
  return { ...checked, confirm: [extras.confirm, checked.confirm].filter(Boolean).join('\n\n') };
}

/* ------------------------------------------------------------------ */
/* Split                                                               */
/* ------------------------------------------------------------------ */

export interface SplitDraft {
  cableId: string;
  /** Split at this point of the line. It must not be an end. */
  index?: number;
  /** Or at this place: a point is added to the line there first (or the point already there is used). */
  at?: LatLng;
  /** The second part's id. Give one so the question and the saved record name the same id. */
  newCableId?: string;
  /** The second part's name. Blank: the cable's name with "(2)". */
  newName?: string;
  /**
   * Equipment at the split point, chosen by the person (a closure, a joint box). The first part
   * then ends there and the second starts there. Nothing is chosen for them.
   */
  junctionEquipmentId?: string;
}

export interface SplitResult {
  first: Cable;
  second: Cable;
}

/** Where the line would be split, before anything is changed. */
export function splitPoint(cable: Pick<Cable, 'coordinates'>, draft: Pick<SplitDraft, 'index' | 'at'>): { points: LatLng[]; index: number } | string {
  const line = cable.coordinates;
  if (line.length < 2) return 'This cable has no line drawn yet, so there is nothing to split.';
  if (draft.index !== undefined) {
    if (!Number.isInteger(draft.index) || draft.index <= 0 || draft.index >= line.length - 1) {
      return 'Choose a point between the two ends. A cable cannot be split at its end.';
    }
    return { points: [...line], index: draft.index };
  }
  if (!draft.at) return 'Tap the point where the cable is to be split.';
  const existing = vertexNear(line, draft.at, 0.5);
  if (existing >= 0) {
    if (existing === 0 || existing === line.length - 1) return 'Choose a point between the two ends. A cable cannot be split at its end.';
    return { points: [...line], index: existing };
  }
  const after = nearestSegmentIndex(line, draft.at);
  const points = [...line.slice(0, after + 1), [draft.at[0], draft.at[1]] as LatLng, ...line.slice(after + 1)];
  return { points, index: after + 1 };
}

/**
 * Splits a cable record into two at a point of its line. The first part keeps the id; the second
 * gets a new one. Both keep every fibre with its number, state and history; uses given to a fibre
 * (assignments) are kept on both parts, because the fibre carries them through. Every record that
 * names the cable at a place goes with the part at that place, or the split is refused with the
 * reason. Drawn lengths are worked out again; the sheath mark read at each end stays with that end,
 * and a whole-cable OTDR length is kept in the remarks of both parts, since it measured neither.
 */
export function splitCable(data: NetworkData, draft: SplitDraft, ctx: CommandContext = {}, settings: SplitSettings = DEFAULT_OSP_SETTINGS): CommandResult<SplitResult> {
  const cable = data.cables.find((c) => c.id === draft.cableId);
  if (!cable) return fail('Cable missing', `Cable ${draft.cableId} was not found.`);
  const at = splitPoint(cable, draft);
  if (typeof at === 'string') return fail('Not split', at, 'warning');
  const { points, index: k } = at;
  const X = cable.id;
  const B = draft.newCableId?.trim() || newRecordId(cableIdPrefix(cable.type));
  if (data.cables.some((c) => sameId(c.id, B))) return fail('Not split', `A cable with the id ${B} already exists. Choose another id.`);

  const byId = new Map(data.equipment.map((e) => [e.id, e]));
  const junction = draft.junctionEquipmentId ? byId.get(draft.junctionEquipmentId) : undefined;
  if (draft.junctionEquipmentId && !junction) return fail('Not split', `${draft.junctionEquipmentId} is not on record.`);
  if (junction && (junction.id === cable.startEquipmentId || junction.id === cable.endEquipmentId)) {
    return fail('Not split', `${junction.name} is already an end of this cable. Choose the equipment at the split point, or none.`, 'warning');
  }

  // Where along the line the split point is, for records that sit beside the line.
  const splitAlong = polylineLengthMeters(points.slice(0, k + 1));
  const sideOfPosition = (p: LatLng): Side => {
    const near = pointToLine(p, points);
    if (!near || near.distanceMeters > settings.attachmentCorridorMeters) return '?';
    if (Math.abs(near.alongMeters - splitAlong) <= settings.poleMoveVertexMeters) return 'J';
    return near.alongMeters < splitAlong ? 'A' : 'B';
  };
  const sideOfEquipment = (id: string | undefined): Side => {
    if (!id) return '?';
    const isStart = id === cable.startEquipmentId;
    const isEnd = id === cable.endEquipmentId;
    if (isStart && isEnd) return '?';
    if (isStart) return 'A';
    if (isEnd) return 'B';
    if (junction && id === junction.id) return 'J';
    const e = byId.get(id);
    if (!e || !hasPlacedPosition(e) || (e.lat === 0 && e.lng === 0)) return '?';
    if (distanceMeters([e.lat, e.lng], points[k]) <= settings.poleMoveVertexMeters) return 'J';
    return sideOfPosition([e.lat, e.lng]);
  };

  const problems: string[] = [];
  const onA: string[] = [];
  const onB: string[] = [];
  const fiberA: string[] = [];
  const fiberB: string[] = [];
  const both: string[] = [];
  const stayed: string[] = [];
  const why = (side: Side) =>
    side === 'J' ? 'it is at the split point, so FiberGIS cannot tell which side each fibre is on' : 'its place is not on this cable’s line, so FiberGIS cannot tell which part it is on';

  const patch: NetworkPatch = {};

  /** Records that sit at one place: on the second part, every mention of the cable moves to it. */
  function placeRecords<R extends { id: string; name?: string }>(
    list: readonly R[] | undefined,
    label: string,
    sideOf: (r: R) => Side,
    fiber: boolean,
  ): R[] | undefined {
    if (!list) return undefined;
    let changed = false;
    const next = list.map((r) => {
      if (!mentions(r, X)) return r;
      const side = sideOf(r);
      if (side === 'A') {
        onA.push(`${label} ${recordName(r)}`);
        if (fiber) fiberA.push(recordName(r));
        return r;
      }
      if (side === 'B') {
        changed = true;
        onB.push(`${label} ${recordName(r)}`);
        if (fiber) fiberB.push(recordName(r));
        return replaceId(r, X, B);
      }
      problems.push(`${label} ${recordName(r)} names this cable, but ${why(side)}.`);
      return r;
    });
    return changed ? next : undefined;
  }

  const equipment = placeRecords(data.equipment, 'Equipment', (e) => sideOfEquipment(e.id), true);
  if (equipment) patch.equipment = equipment;
  const splitters = placeRecords(data.splitters, 'Splitter', (s) => sideOfEquipment(s.terminalBoxId), true);
  if (splitters) patch.splitters = splitters;
  const closures = placeRecords(data.closures, 'Closure', (c) => (c.equipmentId ? sideOfEquipment(c.equipmentId) : sideOfPosition([c.lat, c.lng])), true);
  if (closures) patch.closures = closures;
  const buildings = placeRecords(data.buildings, 'Building', (b) => (b.entryEquipmentId ? sideOfEquipment(b.entryEquipmentId) : sideOfPosition([b.lat, b.lng])), false);
  if (buildings) patch.buildings = buildings;

  // Customers: each path field goes with the part that leads to them.
  const splitterBox = new Map(data.splitters.map((s) => [s.id, s.terminalBoxId]));
  const towardsCustomer = (c: Customer, field: 'feederCableId' | 'distributionCableId' | 'dropCableId'): Side => {
    const boxes = [c.terminalBoxId, splitterBox.get(c.splitterId)].filter(Boolean) as string[];
    const sideOfBox = boxes.map(sideOfEquipment).find((s) => s === 'A' || s === 'B' || s === 'J');
    if (field === 'dropCableId') {
      const own = sideOfEquipment(c.id);
      if (own === 'A' || own === 'B') return own;
      // A drop leaves the box: the customer is at the other end.
      if (sideOfBox === 'A') return 'B';
      if (sideOfBox === 'B') return 'A';
      return c.lat || c.lng ? sideOfPosition([c.lat, c.lng]) : '?';
    }
    if (sideOfBox === 'A' || sideOfBox === 'B') return sideOfBox;
    if (c.oltId && c.oltId === cable.startEquipmentId) return 'B';
    if (c.oltId && c.oltId === cable.endEquipmentId) return 'A';
    return '?';
  };
  const customerSide = new Map<string, Side>();
  let customersChanged = false;
  const customers = data.customers.map((c) => {
    let next = c;
    for (const field of ['feederCableId', 'distributionCableId', 'dropCableId'] as const) {
      if (c[field] !== X) continue;
      const side = towardsCustomer(c, field);
      if (field === 'dropCableId') customerSide.set(c.id, side);
      const label = `Customer ${recordName(c)}`;
      if (side === 'A') {
        onA.push(label);
        if (field === 'dropCableId') fiberA.push(recordName(c));
      } else if (side === 'B') {
        onB.push(label);
        if (field === 'dropCableId') fiberB.push(recordName(c));
        next = { ...next, [field]: B };
        customersChanged = true;
      } else {
        problems.push(`${label} has this cable as their ${field === 'feederCableId' ? 'feeder' : field === 'distributionCableId' ? 'distribution cable' : 'drop'}, and FiberGIS cannot tell which part leads to them.`);
      }
    }
    return next;
  });
  if (customersChanged) patch.customers = customers;

  // ONTs in service on this drop go with their customer's side.
  if (data.onts) {
    let changed = false;
    const onts = data.onts.map((o) => {
      if (o.status === 'removed' || o.dropCableId !== X) return o;
      const sides = data.customers.filter((c) => c.ontId === o.id).map((c) => customerSide.get(c.id) ?? towardsCustomer(c, 'dropCableId'));
      const side: Side = sides.length > 0 && sides.every((s) => s === sides[0]) ? sides[0] : '?';
      if (side === 'A') return o;
      if (side === 'B') {
        changed = true;
        return { ...o, dropCableId: B };
      }
      problems.push(`ONT ${o.serialNumber || o.id} is on this cable, and FiberGIS cannot tell which part reaches it.`);
      return o;
    });
    if (changed) patch.onts = onts;
  }

  // Poles and spans: a pole at the split point carries both parts; a span across it carries both.
  if (data.attachments) {
    const spans = new Map((data.spans ?? []).map((s) => [s.id, s]));
    const added: Attachment[] = [];
    let changed = false;
    const attachments = data.attachments.map((a) => {
      if (a.cableId !== X) return a;
      let sides: Side[];
      if (a.structureId) sides = [sideOfEquipment(a.structureId)];
      else {
        const span = a.spanId ? spans.get(a.spanId) : undefined;
        sides = span ? [sideOfEquipment(span.fromStructureId), sideOfEquipment(span.toStructureId)] : ['?'];
      }
      const host = a.structureId ? (byId.get(a.structureId)?.name ?? a.structureId) : `span ${a.spanId}`;
      if (sides.includes('?')) {
        problems.push(`The record that this cable is on ${host} cannot be placed: ${why('?')}.`);
        return a;
      }
      const hasA = sides.includes('A') || (sides.every((s) => s === 'J'));
      const hasB = sides.includes('B') || (sides.every((s) => s === 'J'));
      if (hasA && hasB) {
        both.push(host);
        added.push({ ...a, id: newOspId('ATT'), cableId: B });
        return a;
      }
      if (hasB) {
        changed = true;
        onB.push(`Pole record ${host}`);
        return { ...a, cableId: B };
      }
      onA.push(`Pole record ${host}`);
      return a;
    });
    if (changed || added.length) patch.attachments = [...attachments, ...added];
  }

  // Slack loops lie at one place on one part.
  if (data.slackLoops) {
    let changed = false;
    const loops = data.slackLoops.map((l) => {
      if (l.cableId !== X) return l;
      const side = l.structureId ? sideOfEquipment(l.structureId) : sideOfPosition([l.lat, l.lng]);
      if (side === 'A') return l;
      if (side === 'B') {
        changed = true;
        onB.push(`Slack loop ${l.name}`);
        return { ...l, cableId: B };
      }
      problems.push(`Slack loop ${l.name} cannot be placed: ${side === 'J' ? 'it is at the split point, so it could belong to either part. Delete it or split at another point' : why(side)}.`);
      return l;
    });
    if (changed) patch.slackLoops = loops;
  }

  // Network mapping Phase 6: each stretch goes with the part it lies on; one across the point is refused.
  if (data.cableSegments?.some((s) => s.cableId === X)) {
    const splitOnLine = pointToLine(points[k], cable.coordinates)?.alongMeters ?? splitAlong;
    const carried = splitCableSegments(data, cable, splitOnLine, B, { first: splitAlong, second: polylineLengthMeters(points.slice(k)) }, settings);
    problems.push(...carried.problems);
    if (carried.segments) patch.cableSegments = carried.segments;
    for (const label of carried.movedToSecond) onB.push(`Stretch ${label}`);
  }

  // Ducts: a duct whose two ends are on different parts holds both.
  if (data.ducts) {
    let changed = false;
    const ducts = data.ducts.map((d) => {
      if (!mentions(d, X)) return d;
      const ends: Side[] = [
        d.fromStructureId ? sideOfEquipment(d.fromStructureId) : sideOfPosition(d.coordinates[0]),
        d.toStructureId ? sideOfEquipment(d.toStructureId) : sideOfPosition(d.coordinates[d.coordinates.length - 1]),
      ];
      if (ends.includes('?')) {
        problems.push(`Duct ${d.name} lists this cable, but its ends are not on the cable’s line, so FiberGIS cannot tell which part runs in it.`);
        return d;
      }
      const hasA = ends.includes('A') || ends.every((s) => s === 'J');
      const hasB = ends.includes('B') || ends.every((s) => s === 'J');
      if (hasA && hasB) {
        changed = true;
        both.push(`duct ${d.name}`);
        const add = (ids: string[]) => (ids.includes(X) ? [...ids, B] : ids);
        return {
          ...d,
          cableIds: add(d.cableIds),
          subducts: d.subducts.map((s) => ({ ...s, cableIds: add(s.cableIds), ...(s.microducts ? { microducts: s.microducts.map((m) => ({ ...m, cableIds: add(m.cableIds) })) } : {}) })),
        };
      }
      if (hasB) {
        changed = true;
        onB.push(`Duct ${d.name}`);
        return replaceId(d, X, B);
      }
      onA.push(`Duct ${d.name}`);
      return d;
    });
    if (changed) patch.ducts = ducts;
  }

  // A permission that covers the cable covers both parts of it.
  if (data.permissions?.some((p) => p.cableIds?.includes(X))) {
    patch.permissions = data.permissions.map((p) => (p.cableIds?.includes(X) ? { ...p, cableIds: [...p.cableIds, B] } : p));
    both.push('permissions');
  }

  // Whole-cable records stay with the first part, which keeps the id.
  const countMentions = (list: readonly unknown[] | undefined) => (list ?? []).filter((r) => mentions(r, X)).length;
  const kept = [
    [countMentions(data.documents), 'document(s)'],
    [countMentions(data.workOrders), 'job(s)'],
    [countMentions(data.faults), 'fault(s)'],
    [countMentions(data.alarms), 'alarm(s)'],
  ] as const;
  for (const [n, what] of kept) if (n > 0) stayed.push(`${n} ${what}`);

  // Anything else that names the cable is not understood here: refuse rather than guess.
  for (const other of data.cables) if (other.id !== X && mentions(other, X)) problems.push(`Cable ${recordName(other)} names this cable in an older link FiberGIS cannot place.`);
  for (const name of ['services', 'spans', 'inspections', 'rfElements', 'rfLinks', 'rfLevels', 'zones', 'monitoringSources', 'onuReadings', 'onuStatuses'] as const) {
    const list = (data as unknown as Partial<Record<string, readonly { id: string; name?: string }[]>>)[name];
    for (const r of list ?? []) if (mentions(r, X)) problems.push(`${name === 'rfLinks' || name === 'rfElements' || name === 'rfLevels' ? 'Cable TV record' : 'Record'} ${recordName(r)} names this cable, and splitting does not handle it yet.`);
  }

  // Fibres: identity, state and history on both parts. Older single links go with their place.
  const coresFirst: FiberCore[] = [];
  const coresSecond: FiberCore[] = [];
  const date = isoDate(ctx.now);
  for (const core of completeCores(cable)) {
    if (core.spliceTargetCableId) {
      problems.push(`Fibre ${core.coreNumber} has an older splice link that FiberGIS cannot place on one part. Record that splice in its closure first.`);
    }
    let first: FiberCore = core;
    let second: FiberCore = {
      ...core,
      ...(core.assignments
        ? {
            assignments: core.assignments.map(
              (a): CoreAssignment => ({ ...a, id: newFiberId('CA'), notes: appendRemark(a.notes, `Kept from ${X} when it was split on ${date}.`).slice(0, 500) }),
            ),
          }
        : {}),
    };
    if (core.connectedToEquipmentId) {
      const side = sideOfEquipment(core.connectedToEquipmentId);
      const strip = (c: FiberCore): FiberCore => dropUndefined({ ...c, connectedToEquipmentId: undefined, connectedToEquipmentName: undefined, connectedPort: undefined });
      if (side === 'A') second = strip(second);
      else if (side === 'B') first = strip(first);
      else problems.push(`Fibre ${core.coreNumber} is recorded as going to ${core.connectedToEquipmentId}, and FiberGIS cannot tell which part that is on.`);
    }
    coresFirst.push(first);
    coresSecond.push(second);
  }

  if (problems.length > 0) {
    return fail('Not split', `${problems.slice(0, 3).join(' ')}${problems.length > 3 ? ` (and ${problems.length - 3} more)` : ''} Nothing was changed.`, 'warning');
  }

  // Lengths: drawn worked out again; each sheath mark stays with its end; OTDR noted, not carried.
  const firstLine = points.slice(0, k + 1);
  const secondLine = points.slice(k);
  const optical =
    cable.opticalLengthMeters !== undefined
      ? `Before the split on ${date}, the whole of ${X} measured ${cable.opticalLengthMeters} m by OTDR${cable.opticalMeasuredAt ? ` (${cable.opticalMeasuredAt.slice(0, 10)})` : ''}${cable.opticalLengthNote ? `, ${cable.opticalLengthNote}` : ''}.`
      : '';
  const withoutOptical = (c: Cable): Cable => dropUndefined({ ...c, opticalLengthMeters: undefined, opticalMeasuredAt: undefined, opticalLengthNote: undefined });
  const firstCable: Cable = withoutOptical(
    dropUndefined({
      ...cable,
      coordinates: firstLine,
      lengthMeters: lengthOf(firstLine),
      endEquipmentId: junction?.id,
      endPortName: undefined,
      sheathMarkEnd: undefined,
      sheathMarkUnit: cable.sheathMarkStart !== undefined ? cable.sheathMarkUnit : undefined,
      cores: coresFirst,
      remarks: appendRemark(cable.remarks, [`Split on ${date}: the part beyond ${junction ? junction.name : `point ${k + 1}`} is now ${B}.`, optical].filter(Boolean).join(' ')),
    }),
  );
  const secondName = draft.newName?.trim() || `${cable.name} (2)`;
  const secondCable: Cable = withoutOptical(
    dropUndefined({
      ...cable,
      id: B,
      name: secondName,
      coordinates: secondLine,
      lengthMeters: lengthOf(secondLine),
      startEquipmentId: junction?.id,
      startPortName: undefined,
      sheathMarkStart: undefined,
      sheathMarkUnit: cable.sheathMarkEnd !== undefined ? cable.sheathMarkUnit : undefined,
      cores: coresSecond,
      remarks: appendRemark(cable.remarks, [`Split from ${X} (${cable.name}) on ${date}${junction ? ` at ${junction.name}` : ''}.`, optical].filter(Boolean).join(' ')),
    }),
  );
  patch.cables = [...data.cables.map((c) => (c.id === X ? firstCable : c)), secondCable];

  // Fibre records on both sides: the path through the split point is not joined until someone records it.
  const assigned = cable.cores.filter((c) => c.assignments?.some((a) => !a.releasedAt)).length;
  const lines = [
    `${cable.name} becomes two cables: ${X} (${firstCable.lengthMeters} m, from the start${junction ? ` to ${junction.name}` : ` to point ${k + 1}`}) and ${B} "${secondName}" (${secondCable.lengthMeters} m, to the end).`,
    onB.length ? `Moving to ${B}: ${listNames(onB)}.` : '',
    both.length ? `On both parts: ${listNames(both)}.` : '',
    stayed.length ? `${listNames(stayed)} stay with ${X}.` : '',
    assigned ? `${assigned} fibre(s) given to a use keep that use on both parts.` : '',
    cable.sheathMarkStart !== undefined || cable.sheathMarkEnd !== undefined ? 'Each sheath mark stays with the end where it was read; the new ends have none recorded.' : '',
    optical ? 'The OTDR length was for the whole cable, so it is kept in the remarks of both parts, not as their length.' : '',
    !junction ? 'The new ends are not connected to anything.' : '',
  ].filter(Boolean);
  const gap =
    fiberA.length && fiberB.length
      ? `Please check: fibres are recorded on both sides of this point (${listNames(fiberA, 2)} on the first part, ${listNames(fiberB, 2)} on the second). Those fibre paths will show a gap at ${junction ? junction.name : 'this point'} until the joint is recorded in the splicing screen.`
      : '';
  const confirm = `${lines.join(' ')}${gap ? `\n\n${gap}` : ''}\n\nYou can undo this.`;
  const audit = [
    {
      action: 'CABLE_SPLIT',
      details: `${X} split at point ${k + 1}${junction ? ` (${junction.id})` : ''} into ${X} (${firstCable.lengthMeters} m) and ${B} (${secondCable.lengthMeters} m). Moved to ${B}: ${onB.join(', ') || 'nothing'}. On both: ${both.join(', ') || 'nothing'}.`.slice(0, 1000),
      assetId: X,
      assetType: 'Cable' as const,
    },
    ...(gap ? [{ action: 'WARNING_ACCEPTED', details: `Split after the warning: ${gap}`.slice(0, 1000), assetId: X, assetType: 'Cable' as const }] : []),
  ];
  return checkedNetworkChange(
    data,
    patch,
    { first: firstCable, second: secondCable },
    { notice: notice('success', 'Cable split', `${X} and ${B} saved. You can undo this.`), audit, confirm },
    ctx,
  );
}

/* ------------------------------------------------------------------ */
/* Merge                                                               */
/* ------------------------------------------------------------------ */

type EndName = 'start' | 'end';

interface Meeting {
  /** Which end of the kept cable meets which end of the other. */
  keptEnd: EndName;
  otherEnd: EndName;
  /** Equipment at the joint, when either records one. */
  junctionId?: string;
}

const endPoint = (c: Cable, end: EndName) => (end === 'start' ? c.coordinates[0] : c.coordinates[c.coordinates.length - 1]);
const endEquipment = (c: Cable, end: EndName) => (end === 'start' ? c.startEquipmentId : c.endEquipmentId);

/** How two cables meet end to end, or why they do not. */
export function cablesMeeting(a: Cable, b: Cable, toleranceMeters: number): Meeting | string {
  if (a.coordinates.length < 2 || b.coordinates.length < 2) return 'Both cables need a drawn line.';
  const options: Meeting[] = [];
  for (const keptEnd of ['start', 'end'] as const) {
    for (const otherEnd of ['start', 'end'] as const) {
      const ea = endEquipment(a, keptEnd);
      const eb = endEquipment(b, otherEnd);
      const close = distanceMeters(endPoint(a, keptEnd), endPoint(b, otherEnd)) <= toleranceMeters;
      if (ea && eb && ea === eb) options.push({ keptEnd, otherEnd, junctionId: ea });
      else if (close && !(ea && eb)) options.push({ keptEnd, otherEnd, junctionId: ea ?? eb });
    }
  }
  if (options.length === 0) return `${a.name} and ${b.name} do not meet end to end.`;
  if (options.length > 1) return `${a.name} and ${b.name} meet at both ends, so FiberGIS cannot tell where to join them.`;
  return options[0];
}

const layoutKey = (c: Cable) =>
  JSON.stringify([c.fiberCount, c.colorScheme ?? null, c.tubeColorScheme ?? null, c.fibersPerTube ?? null, c.tubeCount ?? null, (c.tubes ?? []).map((t) => [t.number, t.fiberCount, t.colorName ?? null])]);

const sameUse = (x: CoreAssignment, y: CoreAssignment) =>
  x.kind === y.kind && x.use === y.use && x.customerId === y.customerId && x.equipmentId === y.equipmentId && x.oltId === y.oltId && x.ponPortId === y.ponPortId && (x.releasedAt ?? '') === (y.releasedAt ?? '');

/** Why two cables cannot be one record, or null. */
export function mergeProblem(data: NetworkData, keep: Cable, other: Cable, toleranceMeters: number): string | null {
  if (keep.id === other.id) return 'Choose a different cable.';
  if (keep.cableCategory !== other.cableCategory || keep.type !== other.type) return `${keep.name} is ${keep.type} and ${other.name} is ${other.type}. Only cables of the same kind can be joined.`;
  if (keep.fiberCount !== other.fiberCount) return `${keep.name} has ${keep.fiberCount} fibres and ${other.name} has ${other.fiberCount}. They cannot be one cable.`;
  if (layoutKey(keep) !== layoutKey(other)) return `${keep.name} and ${other.name} have different tube or colour records. Make them the same first, if they really are one cable.`;
  const meeting = cablesMeeting(keep, other, toleranceMeters);
  if (typeof meeting === 'string') return meeting;
  const farKeep = endEquipment(keep, meeting.keptEnd === 'start' ? 'end' : 'start');
  const farOther = endEquipment(other, meeting.otherEnd === 'start' ? 'end' : 'start');
  if (farKeep && farKeep === farOther) return 'Joined, the cable would start and end at the same place.';
  const joints = data.closures.flatMap((c) => c.splices.filter((s) => (s.inputCableId === keep.id && s.outputCableId === other.id) || (s.inputCableId === other.id && s.outputCableId === keep.id)));
  if (joints.length > 0) {
    return `${keep.name} and ${other.name} are joined by ${joints.length} splice record(s). Joining them into one cable would lose those splices. Join only cables that really are one cable.`;
  }
  const a = completeCores(keep);
  const b = completeCores(other);
  const clashes: string[] = [];
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].status !== b[i].status) clashes.push(`fibre ${a[i].coreNumber} is ${a[i].status} on ${keep.name} but ${b[i].status} on ${other.name}`);
    const activeA = (a[i].assignments ?? []).filter((x) => !x.releasedAt);
    const activeB = (b[i].assignments ?? []).filter((x) => !x.releasedAt);
    if (activeA.length && activeB.length && !activeB.every((y) => activeA.some((x) => sameUse(x, y)))) {
      clashes.push(`fibre ${a[i].coreNumber} is given to different uses on each`);
    }
    if (a[i].connectedToEquipmentId && b[i].connectedToEquipmentId && a[i].connectedToEquipmentId !== b[i].connectedToEquipmentId) {
      clashes.push(`fibre ${a[i].coreNumber} goes to different equipment on each`);
    }
  }
  if (clashes.length) return `Not the same: ${clashes.slice(0, 3).join('; ')}${clashes.length > 3 ? ` (and ${clashes.length - 3} more)` : ''}. Make the fibres match first.`;
  return null;
}

export interface MergeCandidate {
  cable: Cable;
  /** Why it cannot be joined; absent when it can. */
  problem?: string;
}

/** Cables whose end meets an end of this one, each with the reason it cannot be joined, if any. */
export function mergeCandidates(data: NetworkData, cableId: string, settings: Pick<OspSettings, 'poleMoveVertexMeters'> = DEFAULT_OSP_SETTINGS): MergeCandidate[] {
  const keep = data.cables.find((c) => c.id === cableId);
  if (!keep || keep.coordinates.length < 2) return [];
  return data.cables
    .filter((c) => c.id !== keep.id && typeof cablesMeeting(keep, c, settings.poleMoveVertexMeters) !== 'string')
    .map((c) => {
      const problem = mergeProblem(data, keep, c, settings.poleMoveVertexMeters);
      return problem ? { cable: c, problem } : { cable: c };
    });
}

const uniqueBy = <T>(items: readonly T[], key: (t: T) => string): T[] => {
  const seen = new Set<string>();
  return items.filter((t) => {
    const k = key(t);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

/**
 * Joins `otherCableId` into `cableId`, which keeps its id. The two must meet end to end, be the
 * same kind with the same fibres, tubes and colours, and their fibres must agree. Every record that
 * named the other cable then names the joined one. Details (owner, make, dates) are kept from the
 * cable that keeps its id. Drawn length is worked out again; the sheath marks at the two far ends
 * stay, and the marks and OTDR lengths at the joint go into the remarks, never added together.
 */
export function mergeCables(data: NetworkData, cableId: string, otherCableId: string, ctx: CommandContext = {}, settings: Pick<OspSettings, 'poleMoveVertexMeters'> = DEFAULT_OSP_SETTINGS): CommandResult<Cable> {
  const keep = data.cables.find((c) => c.id === cableId);
  const other = data.cables.find((c) => c.id === otherCableId);
  if (!keep || !other) return fail('Cable missing', `Cable ${!keep ? cableId : otherCableId} was not found.`);
  const problem = mergeProblem(data, keep, other, settings.poleMoveVertexMeters);
  if (problem) return fail('Not joined', problem, 'warning');
  const meeting = cablesMeeting(keep, other, settings.poleMoveVertexMeters) as Meeting;
  const date = isoDate(ctx.now);

  // Keep the kept cable's direction; the other is turned to fit on.
  const otherLine = meeting.otherEnd === (meeting.keptEnd === 'end' ? 'start' : 'end') ? other.coordinates : [...other.coordinates].reverse();
  const keepFirst = meeting.keptEnd === 'end';
  const line = keepFirst ? [...keep.coordinates, ...otherLine.slice(1)] : [...otherLine.slice(0, -1), ...keep.coordinates];
  const otherFar: EndName = meeting.otherEnd === 'start' ? 'end' : 'start';
  const otherMark = (end: EndName) => (end === 'start' ? other.sheathMarkStart : other.sheathMarkEnd);
  const otherPort = (end: EndName) => (end === 'start' ? other.startPortName : other.endPortName);
  const unitsMatch = !keep.sheathMarkUnit || !other.sheathMarkUnit || keep.sheathMarkUnit === other.sheathMarkUnit;

  const keptFarMark = keepFirst ? keep.sheathMarkStart : keep.sheathMarkEnd;
  const otherFarMark = otherMark(otherFar);
  const jointMarks = [keepFirst ? keep.sheathMarkEnd : keep.sheathMarkStart, otherMark(meeting.otherEnd)];
  const notes = [
    `Joined with ${other.id} (${other.name}) on ${date}${meeting.junctionId ? ` at ${meeting.junctionId}` : ''}.`,
    jointMarks.some((m) => m !== undefined)
      ? `Sheath marks read at the joint: ${keep.name} ${jointMarks[0] ?? 'not recorded'}, ${other.name} ${jointMarks[1] ?? 'not recorded'}${keep.sheathMarkUnit ?? other.sheathMarkUnit ? ` ${keep.sheathMarkUnit ?? other.sheathMarkUnit}` : ''}.`
      : '',
    !unitsMatch && (keptFarMark !== undefined || otherFarMark !== undefined) ? `The far-end sheath marks were in different units (${keep.sheathMarkUnit}, ${other.sheathMarkUnit}): ${keptFarMark ?? '-'} and ${otherFarMark ?? '-'}.` : '',
    ...[keep, other].map((c) =>
      c.opticalLengthMeters !== undefined ? `Before joining, ${c.id} measured ${c.opticalLengthMeters} m by OTDR${c.opticalMeasuredAt ? ` (${c.opticalMeasuredAt.slice(0, 10)})` : ''}.` : '',
    ),
    other.remarks?.trim() ? `${other.id} remarks: ${other.remarks.trim()}` : '',
  ].filter(Boolean);

  const coresA = completeCores(keep);
  const coresB = completeCores(other);
  const cores = coresA.map((a, i) => {
    const b = coresB[i];
    const assignments = uniqueBy([...(a.assignments ?? []), ...(b.assignments ?? []).filter((y) => !(a.assignments ?? []).some((x) => sameUse(x, y)))], (x) => x.id);
    const history = uniqueBy([...(a.history ?? []), ...(b.history ?? [])], (h) => JSON.stringify(h));
    const attenuation = [a.attenuationDb, b.attenuationDb].some((v) => v !== undefined)
      ? `Loss recorded per part before joining: ${keep.id} ${a.attenuationDb ?? 'not recorded'} dB, ${other.id} ${b.attenuationDb ?? 'not recorded'} dB.`
      : '';
    return dropUndefined({
      ...b,
      ...a,
      assignments: assignments.length ? assignments : undefined,
      history: history.length ? history : undefined,
      connectedToEquipmentId: a.connectedToEquipmentId ?? b.connectedToEquipmentId,
      connectedToEquipmentName: a.connectedToEquipmentId ? a.connectedToEquipmentName : b.connectedToEquipmentName,
      connectedPort: a.connectedToEquipmentId ? a.connectedPort : b.connectedPort,
      customerId: a.customerId ?? b.customerId,
      customerName: a.customerId ? a.customerName : b.customerName,
      attenuationDb: undefined,
      remarks: attenuation ? appendRemark(a.remarks, attenuation) : a.remarks ?? b.remarks,
    });
  });

  const merged: Cable = dropUndefined({
    ...keep,
    coordinates: line,
    lengthMeters: lengthOf(line),
    ...(keepFirst
      ? { endEquipmentId: endEquipment(other, otherFar), endPortName: otherPort(otherFar), sheathMarkEnd: unitsMatch ? otherFarMark : undefined }
      : { startEquipmentId: endEquipment(other, otherFar), startPortName: otherPort(otherFar), sheathMarkStart: unitsMatch ? otherFarMark : undefined }),
    ...(keepFirst ? { sheathMarkStart: unitsMatch ? keptFarMark : undefined } : { sheathMarkEnd: unitsMatch ? keptFarMark : undefined }),
    sheathMarkUnit: unitsMatch ? keep.sheathMarkUnit ?? other.sheathMarkUnit : undefined,
    opticalLengthMeters: undefined,
    opticalMeasuredAt: undefined,
    opticalLengthNote: undefined,
    cores,
    remarks: appendRemark(keep.remarks, notes.join(' ')),
  });

  // Everything that named the other cable now names the joined one; doubles are folded.
  const moved: string[] = [];
  // Other cables naming it (older fibre links) follow too.
  const patch: NetworkPatch = {
    cables: data.cables.filter((c) => c.id !== other.id).map((c) => (c.id === keep.id ? merged : mentions(c, other.id) ? replaceId(c, other.id, keep.id) : c)),
  };
  const keys = ['equipment', 'splitters', 'closures', 'customers', 'faults', 'workOrders', 'documents', 'onts', 'services', 'buildings', 'attachments', 'slackLoops', 'ducts', 'permissions', 'alarms', 'spans', 'inspections', 'rfElements', 'rfLinks', 'rfLevels'] as const;
  for (const key of keys) {
    const list = (data as unknown as Partial<Record<string, { id: string }[]>>)[key];
    if (!list?.some((r) => mentions(r, other.id))) continue;
    let count = 0;
    let next = list.map((r) => {
      if (!mentions(r, other.id)) return r;
      count += 1;
      return replaceId(r, other.id, keep.id);
    });
    if (key === 'attachments') {
      next = uniqueBy(next as unknown as Attachment[], (a) => (a.cableId === keep.id ? `${a.cableId}|${a.structureId ?? ''}|${a.spanId ?? ''}` : a.id)) as unknown as typeof next;
    }
    if (key === 'ducts' || key === 'permissions') {
      const fold = (ids: string[] | undefined) => (ids ? [...new Set(ids)] : ids);
      next = next.map((r) => {
        const d = r as unknown as { cableIds?: string[]; subducts?: { cableIds: string[]; microducts?: { cableIds: string[] }[] }[] };
        return {
          ...r,
          ...(d.cableIds ? { cableIds: fold(d.cableIds) } : {}),
          ...(d.subducts ? { subducts: d.subducts.map((s) => ({ ...s, cableIds: fold(s.cableIds)!, ...(s.microducts ? { microducts: s.microducts.map((m) => ({ ...m, cableIds: fold(m.cableIds)! })) } : {}) })) } : {}),
        };
      });
    }
    if (key === 'closures') {
      next = next.map((r) => {
        const c = r as unknown as { cableAId?: string; cableBId?: string; cableEntries?: { cableId: string; role: 'in' | 'out' | 'through' }[] };
        const entries = c.cableEntries;
        const mergedEntries = entries?.filter((e) => e.cableId === keep.id);
        const fixed =
          entries && mergedEntries && mergedEntries.length > 1
            ? [...entries.filter((e) => e.cableId !== keep.id), { ...mergedEntries[0], role: mergedEntries.every((e) => e.role === mergedEntries[0].role) ? mergedEntries[0].role : ('through' as const) }]
            : entries;
        return {
          ...r,
          ...(c.cableAId === keep.id && c.cableBId === keep.id ? { cableBId: undefined } : {}),
          ...(fixed ? { cableEntries: fixed } : {}),
        };
      }) as typeof next;
    }
    (patch as Record<string, unknown>)[key] = next;
    moved.push(`${count} ${key === 'equipment' ? 'equipment record' : key.replace(/s$/, '')}(s)`);
  }

  // Network mapping Phase 6: stretches of both cables, their distances counted again along the joined line.
  const stretches = mergeCableSegments(data, keep, other, {
    keepFirst,
    otherReversed: otherLine !== other.coordinates,
    keepOffset: keepFirst ? 0 : polylineLengthMeters(line.slice(0, otherLine.length)),
    otherOffset: keepFirst ? polylineLengthMeters(keep.coordinates) : 0,
    total: polylineLengthMeters(line),
  });
  if (stretches.segments) patch.cableSegments = stretches.segments;
  if (stretches.moved) moved.push(`${stretches.moved} stretch record(s)`);

  const lines = [
    `Join ${other.name} (${other.id}) into ${keep.name} (${keep.id})? It becomes one cable of ${merged.lengthMeters} m${merged.startEquipmentId || merged.endEquipmentId ? `, from ${merged.startEquipmentId ?? 'not connected'} to ${merged.endEquipmentId ?? 'not connected'}` : ''}.`,
    `${other.id} is removed.${moved.length ? ` Records that named it now name ${keep.id}: ${listNames(moved)}.` : ''}`,
    `Details such as owner, make and dates are kept from ${keep.name}.`,
    keep.opticalLengthMeters !== undefined || other.opticalLengthMeters !== undefined ? 'OTDR lengths of the parts are kept in the remarks, not added together.' : '',
  ].filter(Boolean);
  return checkedNetworkChange(
    data,
    patch,
    merged,
    {
      notice: notice('success', 'Cables joined', `${keep.name} now runs the whole way (${merged.lengthMeters} m). You can undo this.`),
      audit: [
        {
          action: 'CABLES_MERGED',
          details: `${other.id} joined into ${keep.id}${meeting.junctionId ? ` at ${meeting.junctionId}` : ''}; drawn ${keep.lengthMeters} + ${other.lengthMeters} → ${merged.lengthMeters} m. Renamed links: ${moved.join(', ') || 'none'}.`.slice(0, 1000),
          assetId: keep.id,
          assetType: 'Cable',
        },
      ],
      confirm: `${lines.join(' ')}\n\nYou can undo this.`,
    },
    ctx,
  );
}
