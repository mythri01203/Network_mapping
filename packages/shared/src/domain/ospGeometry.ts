import type { Building, Cable, Duct, Equipment, HistoryEntry, LatLng, SlackLoop, Span } from '../model/types';
import { type CommandContext, type CommandResult, fail, type NetworkData, type NetworkPatch, notice, succeed } from './command';
import { isLatLngPair, isValidCoordinate } from './defaults';
import { distanceMeters } from './fieldCapture';
import { polygonAreaSqMeters, polylineLengthMeters } from './geo';
import { DEFAULT_OSP_SETTINGS, type OspSettings } from './ospSettings';

/**
 * Phase 4: shapes drawn by a person (a span's bends, a building's outline) and what may move with
 * a pole or chamber. Nothing here is worked out from nearness alone: a drawn shape is kept as
 * drawn, and when a structure moves, things near it are only offered, one by one, for a person to
 * tick. Nothing moves that was not ticked.
 */

const realPoint = (p: unknown): p is LatLng => isLatLngPair(p) && isValidCoordinate(p[0], p[1]);

/* ------------------------------------------------------------------ */
/* Span route                                                          */
/* ------------------------------------------------------------------ */

/**
 * Saves the bends a person drew between a span's two poles (a sag or a detour), or clears them
 * (null) so the span is a straight line again. The two ends are never stored: they follow the poles.
 */
export function setSpanRoute(data: NetworkData, spanId: string, bends: readonly LatLng[] | null, ctx: CommandContext = {}): CommandResult<Span> {
  const spans = data.spans ?? [];
  const span = spans.find((s) => s.id === spanId);
  if (!span) return fail('Span missing', `Span ${spanId} was not found.`);
  if (bends && bends.length > 200) return fail('Line not saved', 'Use 200 points or fewer.');
  if (bends && !bends.every(realPoint)) return fail('Line not saved', 'A point is not a real place. Draw the line again.');
  const updated: Span = { ...span };
  if (bends && bends.length > 0) updated.routePoints = bends.map((p) => [p[0], p[1]] as LatLng);
  else delete updated.routePoints;
  const when = (ctx.now ?? new Date()).toISOString();
  return succeed(
    updated,
    { spans: spans.map((s) => (s.id === spanId ? updated : s)) },
    {
      notice: notice('success', bends?.length ? 'Span line saved' : 'Span line cleared', bends?.length ? `${span.name}: ${bends.length} bend(s) drawn.` : `${span.name} is a straight line again.`),
      audit: [
        {
          action: 'SPAN_ROUTE_DRAWN',
          details: `Span ${spanId}: ${bends?.length ? `${bends.length} bend point(s) drawn` : 'drawn line cleared'} at ${when}`,
          assetId: spanId,
          assetType: 'Span',
        },
      ],
    },
  );
}

/* ------------------------------------------------------------------ */
/* Building footprint                                                  */
/* ------------------------------------------------------------------ */

const sameSpot = (a: LatLng, b: LatLng) => distanceMeters(a, b) < 0.05;

/** Why an outline cannot be used, or null. At least 3 different corners that enclose some area. */
export function footprintProblem(points: readonly LatLng[]): string | null {
  if (!points.every(realPoint)) return 'A corner is not a real place. Draw the outline again.';
  const corners = points.filter((p, i) => i === 0 || !sameSpot(p, points[i - 1]));
  if (corners.length > 1 && sameSpot(corners[0], corners[corners.length - 1])) corners.pop();
  if (corners.length < 3) return 'Tap at least three corners of the building.';
  if (corners.length > 500) return 'Use 500 corners or fewer.';
  if (polygonAreaSqMeters(corners) < 1) return 'The corners are in a line, so they do not enclose the building. Tap around it.';
  return null;
}

/**
 * Saves the outline a person drew around a building, or removes it (null). The building's point
 * stays as it is: the outline is in addition to it, never instead.
 */
export function setBuildingFootprint(data: NetworkData, buildingId: string, points: readonly LatLng[] | null, ctx: CommandContext = {}): CommandResult<Building> {
  const buildings = data.buildings ?? [];
  const building = buildings.find((b) => b.id === buildingId);
  if (!building) return fail('Building missing', `Building ${buildingId} was not found.`);
  const problem = points ? footprintProblem(points) : null;
  if (problem) return fail('Outline not saved', problem, 'warning');
  const updated: Building = { ...building };
  if (points) {
    const corners = points.filter((p, i) => i === 0 || !sameSpot(p, points[i - 1])).map((p) => [p[0], p[1]] as LatLng);
    if (corners.length > 3 && sameSpot(corners[0], corners[corners.length - 1])) corners.pop();
    updated.footprint = corners;
  } else delete updated.footprint;
  const line: HistoryEntry = {
    at: (ctx.now ?? new Date()).toISOString(),
    ...(ctx.actor ? { by: ctx.actor } : {}),
    action: points ? 'FOOTPRINT_DRAWN' : 'FOOTPRINT_REMOVED',
    details: points ? `Outline with ${updated.footprint?.length} corners` : 'Outline removed; the point stays',
  };
  updated.history = [...(building.history ?? []), line];
  return succeed(
    updated,
    { buildings: buildings.map((b) => (b.id === buildingId ? updated : b)) },
    {
      notice: notice('success', points ? 'Outline saved' : 'Outline removed', points ? `${building.name}: about ${Math.round(polygonAreaSqMeters(updated.footprint ?? []))} m² as drawn.` : `${building.name} keeps its point.`),
      audit: [{ action: line.action, details: `${building.id}: ${line.details}`, assetId: building.id, assetType: 'Building' }],
    },
  );
}

/* ------------------------------------------------------------------ */
/* Moving a pole or chamber                                            */
/* ------------------------------------------------------------------ */

export type MoveOfferKind = 'cable_point' | 'slack_loop' | 'duct_end';

export interface MoveOffer {
  /** Stable key for ticking, such as `cable_point:C1:3`. */
  key: string;
  kind: MoveOfferKind;
  /** Plain words: what it is. */
  label: string;
  /** Plain words: why it is offered. */
  detail: string;
  cableId?: string;
  index?: number;
  slackLoopId?: string;
  ductId?: string;
  end?: 'start' | 'end';
}

export interface MovePreview {
  structure: Equipment;
  /** Cables that start or end at it: their end moves with it, as before Phase 4. */
  cableEndIds: string[];
  /** Everything else at the old position, offered one by one. None is ticked. */
  offers: MoveOffer[];
}

/** What a person ticked. Only these move. */
export interface MoveChoices {
  cablePoints?: { cableId: string; index: number }[];
  slackLoopIds?: string[];
  ductEnds?: { ductId: string; end: 'start' | 'end' }[];
}

export const moveOfferKey = (offer: Pick<MoveOffer, 'kind' | 'cableId' | 'index' | 'slackLoopId' | 'ductId' | 'end'>): string =>
  offer.kind === 'cable_point' ? `cable_point:${offer.cableId}:${offer.index}` : offer.kind === 'slack_loop' ? `slack_loop:${offer.slackLoopId}` : `duct_end:${offer.ductId}:${offer.end}`;

/** The choices for a set of ticked offers. */
export function choicesFromOffers(offers: readonly MoveOffer[], ticked: ReadonlySet<string>): MoveChoices {
  const chosen = offers.filter((o) => ticked.has(o.key));
  return {
    cablePoints: chosen.filter((o) => o.kind === 'cable_point').map((o) => ({ cableId: o.cableId!, index: o.index! })),
    slackLoopIds: chosen.filter((o) => o.kind === 'slack_loop').map((o) => o.slackLoopId!),
    ductEnds: chosen.filter((o) => o.kind === 'duct_end').map((o) => ({ ductId: o.ductId!, end: o.end! })),
  };
}

const round1 = (m: number) => Math.round(m * 10) / 10;

/**
 * What else sits at a structure's old position, offered for moving with it: points of cable lines
 * within `osp.poleMove.vertexMeters` (other than the ends of cables that start or end there, which
 * move with it anyway), slack loops recorded at it, and the ends of ducts recorded at it. Being
 * near is only a reason to ask: nothing is ticked.
 */
export function structureMovePreview(data: NetworkData, structureId: string, settings: Pick<OspSettings, 'poleMoveVertexMeters'> = DEFAULT_OSP_SETTINGS): MovePreview | undefined {
  const structure = data.equipment.find((e) => e.id === structureId);
  if (!structure) return undefined;
  const old: LatLng = [structure.lat, structure.lng];
  const onPole = new Set((data.attachments ?? []).filter((a) => a.structureId === structureId).map((a) => a.cableId));
  const cableEndIds: string[] = [];
  const offers: MoveOffer[] = [];
  for (const cable of data.cables) {
    const n = cable.coordinates.length;
    const atStart = cable.startEquipmentId === structureId && n > 0;
    const atEnd = cable.endEquipmentId === structureId && n > 0;
    if (atStart || atEnd) cableEndIds.push(cable.id);
    cable.coordinates.forEach((point, index) => {
      if ((atStart && index === 0) || (atEnd && index === n - 1)) return;
      const gap = distanceMeters(old, point);
      if (gap > settings.poleMoveVertexMeters) return;
      const offer = { kind: 'cable_point' as const, cableId: cable.id, index };
      offers.push({
        ...offer,
        key: moveOfferKey(offer),
        label: `${cable.name}: point ${index + 1} of ${n}`,
        detail: `${round1(gap)} m from where ${structure.name} was. ${onPole.has(cable.id) ? 'Recorded as carried on it.' : 'Not recorded as carried on it.'}`,
      });
    });
  }
  for (const loop of (data.slackLoops ?? []) as SlackLoop[]) {
    if (loop.structureId !== structureId) continue;
    const offer = { kind: 'slack_loop' as const, slackLoopId: loop.id };
    offers.push({ ...offer, key: moveOfferKey(offer), label: loop.name, detail: `Slack loop recorded at ${structure.name}.` });
  }
  for (const duct of (data.ducts ?? []) as Duct[]) {
    for (const end of ['start', 'end'] as const) {
      if ((end === 'start' ? duct.fromStructureId : duct.toStructureId) !== structureId) continue;
      const point = end === 'start' ? duct.coordinates[0] : duct.coordinates[duct.coordinates.length - 1];
      const offer = { kind: 'duct_end' as const, ductId: duct.id, end };
      offers.push({
        ...offer,
        key: moveOfferKey(offer),
        label: `${duct.name}: its ${end}`,
        detail: `Recorded as ${end === 'start' ? 'starting' : 'ending'} at ${structure.name}${point ? `, drawn ${round1(distanceMeters(old, point))} m from it` : ''}.`,
      });
    }
  }
  return { structure, cableEndIds, offers };
}

export interface ChosenMove {
  patch: Pick<NetworkPatch, 'cables' | 'slackLoops' | 'ducts'>;
  /** Plain words for the notice and audit, or empty when nothing was chosen. */
  moved: string[];
  movedCableIds: string[];
}

/**
 * Applies the ticked choices on top of `cables` (which may already have their ends moved). A choice
 * that no longer matches the records (the point is gone, the loop or duct is no longer at the
 * structure) refuses the whole move, so nothing moves that the person did not see.
 */
export function applyMoveChoices(data: NetworkData, cables: Cable[], structureId: string, to: LatLng, choices: MoveChoices): ChosenMove | string {
  const moved: string[] = [];
  const movedCableIds: string[] = [];
  const patch: ChosenMove['patch'] = {};
  const points = choices.cablePoints ?? [];
  if (points.length) {
    const byCable = new Map<string, number[]>();
    for (const p of points) byCable.set(p.cableId, [...(byCable.get(p.cableId) ?? []), p.index]);
    for (const [cableId, indexes] of byCable) {
      const cable = cables.find((c) => c.id === cableId);
      if (!cable) return `Cable ${cableId} is no longer on record. Nothing was moved.`;
      if (indexes.some((i) => !Number.isInteger(i) || i < 0 || i >= cable.coordinates.length)) return `${cable.name} no longer has that point. Nothing was moved.`;
    }
    patch.cables = cables.map((cable) => {
      const indexes = byCable.get(cable.id);
      if (!indexes) return cable;
      const coordinates = cable.coordinates.map((p, i) => (indexes.includes(i) ? ([to[0], to[1]] as LatLng) : ([...p] as LatLng)));
      moved.push(`${indexes.length} point(s) of ${cable.name}`);
      movedCableIds.push(cable.id);
      return { ...cable, coordinates, lengthMeters: Math.round(polylineLengthMeters(coordinates)) };
    });
  }
  const loopIds = new Set(choices.slackLoopIds ?? []);
  if (loopIds.size) {
    const loops = data.slackLoops ?? [];
    for (const id of loopIds) {
      const loop = loops.find((l) => l.id === id);
      if (!loop || loop.structureId !== structureId) return `Slack loop ${id} is no longer recorded there. Nothing was moved.`;
    }
    patch.slackLoops = loops.map((l) => {
      if (!loopIds.has(l.id)) return l;
      moved.push(l.name);
      return { ...l, lat: to[0], lng: to[1] };
    });
  }
  const ends = choices.ductEnds ?? [];
  if (ends.length) {
    const ducts = data.ducts ?? [];
    for (const e of ends) {
      const duct = ducts.find((d) => d.id === e.ductId);
      if (!duct || (e.end === 'start' ? duct.fromStructureId : duct.toStructureId) !== structureId) return `Duct ${e.ductId} no longer ends there. Nothing was moved.`;
    }
    patch.ducts = ducts.map((d) => {
      const mine = ends.filter((e) => e.ductId === d.id);
      if (mine.length === 0) return d;
      const coordinates = d.coordinates.map((p) => [...p] as LatLng);
      for (const e of mine) coordinates[e.end === 'start' ? 0 : coordinates.length - 1] = [to[0], to[1]];
      moved.push(`${d.name} (${mine.map((e) => e.end).join(' and ')})`);
      return { ...d, coordinates };
    });
  }
  return { patch, moved, movedCableIds };
}
