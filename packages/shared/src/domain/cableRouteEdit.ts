import type { ChangeSet } from '../model/api';
import type { AttachmentStatus } from '../model/enums';
import type { Cable, Duct, Equipment, LatLng, Setting } from '../model/types';
import { cableBuildProblem, type CableDraft,createCable } from './cables';
import {
  applyPatch,
  type AuditEntry,
  type CommandContext,
  type CommandResult,
  fail,
  type NetworkData,
  type NetworkPatch,
  notice,
  succeed,
} from './command';
import { type CableLayoutDraft, setCableLayout } from './fiberCommands';
import { distanceMeters } from './fieldCapture';
import { polylineLengthMeters } from './geo';
import { DEFAULT_OSP_SETTINGS, type OspSettings, resolveOspSettings } from './ospSettings';
import { addAttachments, createSlackLoop, hasPlacedPosition, isPoleType, pointToLine, type SlackLoopDraft, updateDuct } from './outsidePlant';
import { applyRouteEdit, endsMoved, type RouteEdit, routeOverlapRatio } from './routeGeometry';

/**
 * Phase 5: changing a cable's or a duct's line, turning a cable round, the "same cable?" check and
 * the cable wizard's one-step save. A line edit changes the drawn points and the drawn length only:
 * sheath marks, OTDR length, ends and every fibre link stay exactly as they were.
 */

const nameOf = (equipment: readonly Equipment[], id: string) => equipment.find((e) => e.id === id)?.name ?? id;

/** One sentence per connected end that the edit draws away from its equipment. */
function endNotes(
  equipment: readonly Equipment[],
  before: readonly LatLng[],
  after: readonly LatLng[],
  ends: { start?: string; end?: string },
  what: string,
): string[] {
  const moved = endsMoved(before, after);
  const notes: string[] = [];
  const check = (which: 'start' | 'end', id: string | undefined, point: LatLng) => {
    if (!id) return;
    const e = equipment.find((x) => x.id === id);
    if (e && distanceMeters([e.lat, e.lng], point) <= 1) return;
    notes.push(`The ${which === 'start' ? 'From' : 'To'} end will no longer be drawn at ${nameOf(equipment, id)}, but the ${what} stays recorded as connected to it.`);
  };
  if (moved.start) check('start', ends.start, after[0]);
  if (moved.end) check('end', ends.end, after[after.length - 1]);
  return notes;
}

/**
 * One change to a cable's line: move, add or remove a point, extend or trim an end. The drawn length
 * is worked out again; nothing else changes. Drawing a connected end away from its equipment asks
 * first and disconnects nothing.
 */
export function editCableRoute(data: NetworkData, cableId: string, edit: RouteEdit): CommandResult<Cable> {
  const cable = data.cables.find((c) => c.id === cableId);
  if (!cable) return fail('Cable missing', `Cable ${cableId} was not found.`);
  const result = applyRouteEdit(cable.coordinates, edit);
  if (!result.ok) return fail('Line not changed', result.reason, 'warning');
  const lengthMeters = Math.round(polylineLengthMeters(result.points));
  const updated: Cable = { ...cable, coordinates: result.points, lengthMeters };
  const notes = endNotes(data.equipment, cable.coordinates, result.points, { start: cable.startEquipmentId, end: cable.endEquipmentId }, 'cable');
  return succeed(
    updated,
    { cables: data.cables.map((c) => (c.id === cableId ? updated : c)) },
    {
      notice: notice('success', 'Line changed', `${cable.name}: ${result.summary}. Drawn length ${cable.lengthMeters} m → ${lengthMeters} m. Sheath and OTDR lengths are not changed. You can undo this.`),
      audit: [
        {
          action: 'CABLE_ROUTE_EDITED',
          details: `${cable.id}: ${result.summary}; drawn length ${cable.lengthMeters} → ${lengthMeters} m`,
          assetId: cable.id,
          assetType: 'Cable',
        },
      ],
      ...(notes.length ? { confirm: `${notes.join(' ')} Nothing is disconnected. Change the line anyway?` } : {}),
    },
  );
}

/**
 * Turns a cable round: From becomes To. The line is reversed and the ends, their ports and the
 * sheath marks read at each end swap with them. Fibres, splices and every other link stay.
 */
export function reverseCable(data: NetworkData, cableId: string): CommandResult<Cable> {
  const cable = data.cables.find((c) => c.id === cableId);
  if (!cable) return fail('Cable missing', `Cable ${cableId} was not found.`);
  const swapped: Cable = {
    ...cable,
    coordinates: [...cable.coordinates].reverse(),
    startEquipmentId: cable.endEquipmentId,
    endEquipmentId: cable.startEquipmentId,
    startPortName: cable.endPortName,
    endPortName: cable.startPortName,
    sheathMarkStart: cable.sheathMarkEnd,
    sheathMarkEnd: cable.sheathMarkStart,
  };
  const updated = Object.fromEntries(Object.entries(swapped).filter(([, v]) => v !== undefined)) as Cable;
  const startsAtOlt = data.equipment.find((e) => e.id === cable.startEquipmentId)?.type === 'OLT';
  const from = cable.startEquipmentId ? nameOf(data.equipment, cable.startEquipmentId) : 'not connected';
  const to = cable.endEquipmentId ? nameOf(data.equipment, cable.endEquipmentId) : 'not connected';
  return succeed(
    updated,
    { cables: data.cables.map((c) => (c.id === cableId ? updated : c)) },
    {
      notice: notice('success', 'Cable turned round', `${cable.name} now runs from ${to} to ${from}. You can undo this.`),
      audit: [{ action: 'CABLE_REVERSED', details: `${cable.id}: now ${cable.endEquipmentId ?? '?'} → ${cable.startEquipmentId ?? '?'}`, assetId: cable.id, assetType: 'Cable' }],
      ...(startsAtOlt
        ? { confirm: `${cable.name} starts at the OLT ${from}. After turning it round it will be recorded as ending there. Traces read a cable from its From end to its To end. Fibres and splices do not change. Turn it round?` }
        : {}),
    },
  );
}

/** One change to a duct's line. Its structures, ways and the cables in it stay as they were. */
export function editDuctRoute(data: NetworkData, ductId: string, edit: RouteEdit): CommandResult<Duct> {
  const duct = (data.ducts ?? []).find((d) => d.id === ductId);
  if (!duct) return fail('Duct missing', `Duct ${ductId} was not found.`);
  const result = applyRouteEdit(duct.coordinates, edit);
  if (!result.ok) return fail('Line not changed', result.reason, 'warning');
  const updated: Duct = { ...duct, coordinates: result.points };
  const notes = endNotes(data.equipment, duct.coordinates, result.points, { start: duct.fromStructureId, end: duct.toStructureId }, 'duct');
  const before = Math.round(polylineLengthMeters(duct.coordinates));
  const after = Math.round(polylineLengthMeters(result.points));
  return succeed(
    updated,
    { ducts: (data.ducts ?? []).map((d) => (d.id === ductId ? updated : d)) },
    {
      notice: notice('success', 'Line changed', `${duct.name}: ${result.summary}. On the map ${before} m → ${after} m. You can undo this.`),
      audit: [{ action: 'DUCT_ROUTE_EDITED', details: `${duct.id}: ${result.summary}; on the map ${before} → ${after} m`, assetId: duct.id, assetType: 'Duct' }],
      ...(notes.length ? { confirm: `${notes.join(' ')} Nothing is disconnected. Change the line anyway?` } : {}),
    },
  );
}

/** Turns a duct round: its two structures and the entries at them swap with the line. */
export function reverseDuct(data: NetworkData, ductId: string): CommandResult<Duct> {
  const duct = (data.ducts ?? []).find((d) => d.id === ductId);
  if (!duct) return fail('Duct missing', `Duct ${ductId} was not found.`);
  const swapped: Duct = {
    ...duct,
    coordinates: [...duct.coordinates].reverse(),
    fromStructureId: duct.toStructureId,
    toStructureId: duct.fromStructureId,
    startEntry: duct.endEntry,
    endEntry: duct.startEntry,
  };
  const updated = Object.fromEntries(Object.entries(swapped).filter(([, v]) => v !== undefined)) as Duct;
  return succeed(
    updated,
    { ducts: (data.ducts ?? []).map((d) => (d.id === ductId ? updated : d)) },
    {
      notice: notice('success', 'Duct turned round', `${duct.name} turned round. You can undo this.`),
      audit: [{ action: 'DUCT_REVERSED', details: `${duct.id}: ends swapped`, assetId: duct.id, assetType: 'Duct' }],
    },
  );
}

/* ------------------------------------------------------------------ */
/* How the cable is made                                               */
/* ------------------------------------------------------------------ */

/** Server: cables in a change set whose recorded build contradicts itself (G.652D as multimode, say). */
export function checkChangeSetCableBuild(changes: ChangeSet): string[] {
  return (changes.upserts?.cables ?? []).flatMap((c) => {
    const problem = cableBuildProblem(c);
    return problem ? [`${c.name} (${c.id}): ${problem}`] : [];
  });
}

export type CableBuildDraft = Pick<Cable, 'fiberStandard' | 'fiberMode' | 'sheath' | 'outerDiameterMm' | 'installationType' | 'manufacturer' | 'model'>;

/** Saves how a cable is made. Blank means not recorded; a contradiction is refused with the reason. */
export function saveCableBuild(data: NetworkData, cableId: string, draft: CableBuildDraft): CommandResult<Cable> {
  const cable = data.cables.find((c) => c.id === cableId);
  if (!cable) return fail('Cable missing', `Cable ${cableId} was not found.`);
  const text = (v: string | undefined) => (v?.trim() ? v.trim() : undefined);
  if (draft.outerDiameterMm !== undefined && !(draft.outerDiameterMm > 0 && draft.outerDiameterMm <= 200)) {
    return fail('Not saved', 'The outside diameter must be between 0 and 200 mm. Check the datasheet.', 'warning');
  }
  const merged = {
    ...cable,
    fiberStandard: draft.fiberStandard,
    fiberMode: draft.fiberMode,
    sheath: draft.sheath,
    outerDiameterMm: draft.outerDiameterMm,
    installationType: draft.installationType,
    manufacturer: text(draft.manufacturer),
    model: text(draft.model),
  };
  const problem = cableBuildProblem(merged);
  if (problem) return fail('Not saved', problem, 'warning');
  const updated = Object.fromEntries(Object.entries(merged).filter(([, v]) => v !== undefined)) as Cable;
  const changed = (['fiberStandard', 'fiberMode', 'sheath', 'outerDiameterMm', 'installationType', 'manufacturer', 'model'] as const).filter((k) => cable[k] !== updated[k]);
  if (changed.length === 0) return fail('Nothing changed', 'These details are already saved.', 'info');
  return succeed(
    updated,
    { cables: data.cables.map((c) => (c.id === cableId ? updated : c)) },
    {
      notice: notice('success', 'Cable details saved', `${cable.name}: ${changed.length} detail(s) saved.`),
      audit: [{ action: 'CABLE_BUILD_SAVED', details: `${cable.id}: ${changed.map((k) => `${k} ${String(cable[k] ?? 'not recorded')} → ${String(updated[k] ?? 'not recorded')}`).join('; ')}`.slice(0, 1000), assetId: cable.id, assetType: 'Cable' }],
    },
  );
}

/* ------------------------------------------------------------------ */
/* "Same cable?"                                                       */
/* ------------------------------------------------------------------ */

/** The audit action written when a person says "it is a different cable" to "same cable?". */
export const POSSIBLE_DUPLICATE_ROUTE_KEPT = 'POSSIBLE_DUPLICATE_ROUTE_KEPT';

export interface DuplicateRoute {
  cable: Cable;
  /** Share (0 to 1) of the shorter line within the corridor of the other. */
  overlapRatio: number;
}

type RouteSettings = Pick<OspSettings, 'duplicateRouteCorridorMeters' | 'duplicateRouteOverlapRatio'>;

const sameEnds = (a: Pick<Cable, 'startEquipmentId' | 'endEquipmentId'>, b: Pick<Cable, 'startEquipmentId' | 'endEquipmentId'>) =>
  !!a.startEquipmentId &&
  !!a.endEquipmentId &&
  ((a.startEquipmentId === b.startEquipmentId && a.endEquipmentId === b.endEquipmentId) || (a.startEquipmentId === b.endEquipmentId && a.endEquipmentId === b.startEquipmentId));

/** Overlap of the shorter line with the longer one. */
const overlapOf = (a: readonly LatLng[], b: readonly LatLng[], corridor: number) =>
  polylineLengthMeters(a) <= polylineLengthMeters(b) ? routeOverlapRatio(a, b, corridor) : routeOverlapRatio(b, a, corridor);

/**
 * Other cables with the same two ends whose line runs along this one. A warning only: two cables
 * between the same boxes can be real (a spare, a ring). Cables with a blank end or no line are not
 * compared, since there is nothing to compare.
 */
export function findDuplicateRoutes(
  cables: readonly Cable[],
  candidate: Pick<Cable, 'id' | 'startEquipmentId' | 'endEquipmentId' | 'coordinates'>,
  settings: RouteSettings = DEFAULT_OSP_SETTINGS,
): DuplicateRoute[] {
  if (candidate.coordinates.length < 2 || !candidate.startEquipmentId || !candidate.endEquipmentId) return [];
  const found: DuplicateRoute[] = [];
  for (const other of cables) {
    if (other.id === candidate.id || other.coordinates.length < 2 || !sameEnds(candidate, other)) continue;
    const overlapRatio = overlapOf(candidate.coordinates, other.coordinates, settings.duplicateRouteCorridorMeters);
    if (overlapRatio >= settings.duplicateRouteOverlapRatio) found.push({ cable: other, overlapRatio });
  }
  return found.sort((a, b) => b.overlapRatio - a.overlapRatio);
}

export interface RouteWarning {
  rule: 'possible_duplicate_route';
  cableId: string;
  name: string;
  nearId: string;
  nearName: string;
  overlapPercent: number;
  /** The same change carries the person's "it is a different cable" choice for this cable. */
  overridden: boolean;
  message: string;
}

/**
 * Server: warnings, never refusals, for cables in a change set that are new or whose ends or line
 * changed, and that run along another cable with the same two ends. Uses the operator's
 * `osp.duplicateRoute.*` settings.
 */
export function newDuplicateRouteWarnings(
  stored: readonly Cable[],
  changes: ChangeSet,
  settings: RouteSettings | readonly Pick<Setting, 'id' | 'value'>[],
): RouteWarning[] {
  const incoming = changes.upserts?.cables ?? [];
  if (incoming.length === 0) return [];
  const limits: RouteSettings = 'duplicateRouteCorridorMeters' in settings ? settings : resolveOspSettings(settings as readonly Pick<Setting, 'id' | 'value'>[]);
  const deleted = new Set(changes.deletes?.cables ?? []);
  const storedById = new Map(stored.map((c) => [c.id, c]));
  const incomingIds = new Set(incoming.map((c) => c.id));
  const compareWith = [...stored.filter((c) => !deleted.has(c.id) && !incomingIds.has(c.id)), ...incoming];
  const overrides = new Set((changes.upserts?.auditLogs ?? []).filter((log) => log.action === POSSIBLE_DUPLICATE_ROUTE_KEPT).map((log) => log.assetId));
  const warnings: RouteWarning[] = [];
  const seenPairs = new Set<string>();
  for (const cable of incoming) {
    const before = storedById.get(cable.id);
    const changed =
      !before ||
      before.startEquipmentId !== cable.startEquipmentId ||
      before.endEquipmentId !== cable.endEquipmentId ||
      JSON.stringify(before.coordinates) !== JSON.stringify(cable.coordinates);
    if (!changed) continue;
    const [twin] = findDuplicateRoutes(compareWith, cable, limits);
    if (!twin) continue;
    const pair = [cable.id, twin.cable.id].sort().join('|');
    if (seenPairs.has(pair)) continue;
    seenPairs.add(pair);
    const overlapPercent = Math.round(twin.overlapRatio * 100);
    const overridden = overrides.has(cable.id);
    warnings.push({
      rule: 'possible_duplicate_route',
      cableId: cable.id,
      name: cable.name,
      nearId: twin.cable.id,
      nearName: twin.cable.name,
      overlapPercent,
      overridden,
      message: `${cable.name} has the same two ends as ${twin.cable.name}, and ${overlapPercent}% of the shorter line runs along the other. It may be the same cable mapped twice.${overridden ? ' The person said it is a different cable.' : ' Check it on the map.'}`,
    });
  }
  return warnings;
}

/* ------------------------------------------------------------------ */
/* Cable wizard: one save, one undo step                               */
/* ------------------------------------------------------------------ */

export interface CableSetup {
  draft: CableDraft;
  /** Tubes and colours from the drum sheet (Phase 7). Absent: not recorded. */
  layout?: CableLayoutDraft;
  /** Poles the person ticked as carrying this cable, with the state they chose. */
  poles?: { ids: string[]; status: AttachmentStatus };
  /** The duct (and way) the person chose for it. */
  duct?: { ductId: string; subductId?: string; microductId?: string };
  /** Slack loops the person recorded. */
  slackLoops?: Omit<SlackLoopDraft, 'cableId'>[];
}

/**
 * Creates a cable with its tubes, poles, duct and slack loops as one change, so one Undo removes all
 * of it. Each part runs the same command as on its own screen, with the same checks and warnings.
 */
export function createCableWithSetup(data: NetworkData, setup: CableSetup, ctx: CommandContext = {}, settings: OspSettings = DEFAULT_OSP_SETTINGS): CommandResult<Cable> {
  const created = createCable(data, setup.draft, ctx);
  if (!created.ok) return created;
  const id = created.value.id;
  let current = applyPatch(data, created.patch);
  let patch: NetworkPatch = { ...created.patch };
  const audit: AuditEntry[] = [...created.audit];
  const confirms: string[] = [];
  const extras: string[] = [];

  const step = (result: CommandResult<unknown>, label: string): string | null => {
    if (!result.ok) return `${label}: ${result.error.message}`;
    current = applyPatch(current, result.patch);
    patch = { ...patch, ...result.patch };
    audit.push(...result.audit);
    if (result.confirm) confirms.push(result.confirm);
    return null;
  };

  if (setup.layout && (setup.layout.colorScheme || setup.layout.tubeColorScheme || setup.layout.fibersPerTube || setup.layout.tubes?.length || setup.layout.layoutSource)) {
    const problem = step(setCableLayout(current, id, setup.layout, ctx), 'Tubes and colours');
    if (problem) return fail('Cable not saved', `${problem} Nothing was saved.`);
    extras.push('tubes and colours');
  }
  if (setup.poles && setup.poles.ids.length > 0) {
    const drafts = setup.poles.ids.map((structureId) => ({ cableId: id, structureId, status: setup.poles!.status, basis: 'route_proposal_confirmed' as const }));
    const problem = step(addAttachments(current, drafts, ctx), 'Poles');
    if (problem) return fail('Cable not saved', `${problem} Nothing was saved.`);
    extras.push(`${setup.poles.ids.length} pole(s)`);
  }
  if (setup.duct) {
    const duct = (current.ducts ?? []).find((d) => d.id === setup.duct!.ductId);
    if (!duct) return fail('Cable not saved', `Duct ${setup.duct.ductId} was not found. Nothing was saved.`);
    const { subductId, microductId } = setup.duct;
    const withCable: Duct = !subductId
      ? { ...duct, cableIds: [...duct.cableIds, id] }
      : {
          ...duct,
          subducts: duct.subducts.map((s) =>
            s.id !== subductId
              ? s
              : microductId
                ? { ...s, microducts: (s.microducts ?? []).map((m) => (m.id === microductId ? { ...m, cableIds: [...m.cableIds, id] } : m)) }
                : { ...s, cableIds: [...s.cableIds, id] },
          ),
        };
    const problem = step(updateDuct(current, withCable, settings), 'Duct');
    if (problem) return fail('Cable not saved', `${problem} Nothing was saved.`);
    extras.push(`duct ${duct.name}`);
  }
  for (const loop of setup.slackLoops ?? []) {
    const problem = step(createSlackLoop(current, { ...loop, cableId: id }, ctx), 'Slack loop');
    if (problem) return fail('Cable not saved', `${problem} Nothing was saved.`);
  }
  if (setup.slackLoops?.length) extras.push(`${setup.slackLoops.length} slack loop(s)`);

  const cable = current.cables.find((c) => c.id === id) ?? created.value;
  return succeed(cable, patch, {
    notice: created.notice && extras.length ? { ...created.notice, message: `${created.notice.message}, with ${extras.join(', ')}` } : created.notice,
    audit,
    ...(confirms.length ? { confirm: confirms.join('\n\n') } : {}),
  });
}

/* ------------------------------------------------------------------ */
/* Wizard helpers                                                      */
/* ------------------------------------------------------------------ */

export interface StructureNearLine {
  structure: Equipment;
  distanceMeters: number;
  alongMeters: number;
}

/** Poles near a line that is not saved yet, in order along it. Suggestions only, never ticked. */
export function polesNearLine(data: Pick<NetworkData, 'equipment'>, line: readonly LatLng[], settings: Pick<OspSettings, 'attachmentCorridorMeters'> = DEFAULT_OSP_SETTINGS): StructureNearLine[] {
  if (line.length < 2) return [];
  const found: StructureNearLine[] = [];
  for (const structure of data.equipment) {
    if (!isPoleType(structure.type) || !hasPlacedPosition(structure)) continue;
    const near = pointToLine([structure.lat, structure.lng], line);
    if (near && near.distanceMeters <= settings.attachmentCorridorMeters) found.push({ structure, ...near });
  }
  return found.sort((a, b) => a.alongMeters - b.alongMeters);
}

/** Ducts whose line runs along a line that is not saved yet, most overlap first. Suggestions only. */
export function ductsAlongLine(data: Pick<NetworkData, 'ducts'>, line: readonly LatLng[], settings: Pick<OspSettings, 'attachmentCorridorMeters'> = DEFAULT_OSP_SETTINGS): { duct: Duct; overlapRatio: number }[] {
  if (line.length < 2) return [];
  return (data.ducts ?? [])
    .map((duct) => ({ duct, overlapRatio: routeOverlapRatio(duct.coordinates, line, settings.attachmentCorridorMeters) }))
    .filter((d) => d.overlapRatio >= 0.5)
    .sort((a, b) => b.overlapRatio - a.overlapRatio);
}

/** Equipment at or very near a point, for "is there a closure here?" questions. Candidates only. */
export function equipmentNearPoint(data: Pick<NetworkData, 'equipment'>, point: LatLng, radiusMeters: number): Equipment[] {
  return data.equipment
    .filter((e) => hasPlacedPosition(e) && !(e.lat === 0 && e.lng === 0) && distanceMeters([e.lat, e.lng], point) <= radiusMeters)
    .sort((a, b) => distanceMeters([a.lat, a.lng], point) - distanceMeters([b.lat, b.lng], point));
}
