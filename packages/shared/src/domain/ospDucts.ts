import { WAY_CONDITION_LABELS, type WayCondition } from '../model/enums';
import type { Cable, Duct, Equipment } from '../model/types';
import { DEFAULT_OSP_SETTINGS, type OspSettings } from './ospSettings';

/**
 * Phase 4: what is inside a duct, how full each way is, which ways are blocked or damaged, and the
 * underground trace from duct to duct. Every answer comes from what a person recorded: a fill is
 * worked out only from recorded diameters, and the trace follows only recorded duct ends, never
 * ducts that merely pass near each other.
 */

/* ------------------------------------------------------------------ */
/* Places in a duct: the duct itself, its sub-ducts, their microducts  */
/* ------------------------------------------------------------------ */

export type DuctPlaceKind = 'duct' | 'subduct' | 'microduct';

export interface DuctPlace {
  /** `duct` for the duct itself, else the sub-duct or microduct id. */
  key: string;
  kind: DuctPlaceKind;
  /** Plain words: "The duct itself", "Sub-duct Blue", "Microduct Red in sub-duct Blue". */
  label: string;
  subductId?: string;
  microductId?: string;
  innerDiameterMm?: number;
  cableIds: string[];
  /** How many ways sit inside it (sub-ducts in the duct, microducts in a sub-duct). */
  innerWays: number;
  /** Its own recorded condition. Absent: nobody checked. */
  condition?: WayCondition;
  /** The worst of its own and its containers': a blocked duct blocks every way inside it. */
  effectiveCondition?: WayCondition;
  /** The container the effective condition comes from, when it is not this place's own. */
  conditionFrom?: string;
}

const RANK: Record<WayCondition, number> = { clear: 0, damaged: 1, blocked: 2 };

/** The worse of a container's effective condition and a place's own. Unchecked never hides a recorded problem. */
function inherit(own: WayCondition | undefined, parent: { condition?: WayCondition; from?: string }): { condition?: WayCondition; from?: string } {
  if (!parent.condition) return { condition: own };
  if (!own || RANK[parent.condition] > RANK[own]) return { condition: parent.condition, from: parent.from };
  return { condition: own };
}

/** Every place in a duct that can hold cables, outermost first. */
export function ductPlaces(duct: Duct): DuctPlace[] {
  const places: DuctPlace[] = [
    {
      key: 'duct',
      kind: 'duct',
      label: 'The duct itself',
      ...(duct.innerDiameterMm ? { innerDiameterMm: duct.innerDiameterMm } : {}),
      cableIds: duct.cableIds,
      innerWays: duct.subducts.length,
      ...(duct.condition ? { condition: duct.condition, effectiveCondition: duct.condition } : {}),
    },
  ];
  const ductState = { condition: duct.condition, from: 'the duct' };
  for (const sub of duct.subducts) {
    const subState = inherit(sub.condition, ductState);
    places.push({
      key: sub.id,
      kind: 'subduct',
      label: `Sub-duct ${sub.label}`,
      subductId: sub.id,
      ...(sub.innerDiameterMm ? { innerDiameterMm: sub.innerDiameterMm } : {}),
      cableIds: sub.cableIds,
      innerWays: sub.microducts?.length ?? 0,
      ...(sub.condition ? { condition: sub.condition } : {}),
      ...(subState.condition ? { effectiveCondition: subState.condition } : {}),
      ...(subState.from ? { conditionFrom: subState.from } : {}),
    });
    const parent = { condition: subState.condition, from: subState.from ?? `sub-duct ${sub.label}` };
    for (const micro of sub.microducts ?? []) {
      const microState = inherit(micro.condition, parent);
      places.push({
        key: micro.id,
        kind: 'microduct',
        label: `Microduct ${micro.label} in sub-duct ${sub.label}`,
        subductId: sub.id,
        microductId: micro.id,
        ...(micro.innerDiameterMm ? { innerDiameterMm: micro.innerDiameterMm } : {}),
        cableIds: micro.cableIds,
        innerWays: 0,
        ...(micro.condition ? { condition: micro.condition } : {}),
        ...(microState.condition ? { effectiveCondition: microState.condition } : {}),
        ...(microState.from ? { conditionFrom: microState.from } : {}),
      });
    }
  }
  return places;
}

/** A copy of the duct with one cable added to one place. Undefined when the place is not in it. */
export function withCableIn(duct: Duct, placeKey: string, cableId: string): Duct | undefined {
  if (placeKey === 'duct') return { ...duct, cableIds: [...duct.cableIds, cableId] };
  let found = false;
  const subducts = duct.subducts.map((sub) => {
    if (sub.id === placeKey) {
      found = true;
      return { ...sub, cableIds: [...sub.cableIds, cableId] };
    }
    if (!sub.microducts?.some((m) => m.id === placeKey)) return sub;
    found = true;
    return { ...sub, microducts: sub.microducts.map((m) => (m.id === placeKey ? { ...m, cableIds: [...m.cableIds, cableId] } : m)) };
  });
  return found ? { ...duct, subducts } : undefined;
}

/**
 * A copy of the duct with one place's condition set as a person recorded it (undefined: not
 * checked). The time and note are kept with it. Undefined when the place is not in the duct.
 */
export function withWayCondition(duct: Duct, placeKey: string, condition: WayCondition | undefined, at: string, note?: string): Duct | undefined {
  const apply = <T extends { condition?: WayCondition; conditionAt?: string; conditionNote?: string }>(item: T): T => {
    const next = { ...item };
    delete next.condition;
    delete next.conditionAt;
    delete next.conditionNote;
    if (!condition) return next;
    return { ...next, condition, conditionAt: at, ...(note?.trim() ? { conditionNote: note.trim() } : {}) };
  };
  if (placeKey === 'duct') return apply(duct);
  let found = false;
  const subducts = duct.subducts.map((sub) => {
    if (sub.id === placeKey) {
      found = true;
      return apply(sub);
    }
    if (!sub.microducts?.some((m) => m.id === placeKey)) return sub;
    found = true;
    return { ...sub, microducts: sub.microducts.map((m) => (m.id === placeKey ? apply(m) : m)) };
  });
  return found ? { ...duct, subducts } : undefined;
}

/** A copy of the duct with a cable taken out of every place. */
export const withoutCable = (duct: Duct, cableId: string): Duct => ({
  ...duct,
  cableIds: duct.cableIds.filter((c) => c !== cableId),
  subducts: duct.subducts.map((sub) => ({
    ...sub,
    cableIds: sub.cableIds.filter((c) => c !== cableId),
    ...(sub.microducts ? { microducts: sub.microducts.map((m) => ({ ...m, cableIds: m.cableIds.filter((c) => c !== cableId) })) } : {}),
  })),
});

/* ------------------------------------------------------------------ */
/* Fill                                                                */
/* ------------------------------------------------------------------ */

/** The fill above which a warning is shown, for this many cables (settings `osp.duct.fill*`). */
export function fillLimit(cableCount: number, settings: Pick<OspSettings, 'ductFillOneCableRatio' | 'ductFillTwoCablesRatio' | 'ductFillManyCablesRatio'> = DEFAULT_OSP_SETTINGS): number {
  if (cableCount <= 1) return settings.ductFillOneCableRatio;
  if (cableCount === 2) return settings.ductFillTwoCablesRatio;
  return settings.ductFillManyCablesRatio;
}

export interface PlaceFill {
  cableCount: number;
  /** Cable area over the inside area, 0 and up. Absent when it cannot be worked out; `missing` says why. */
  ratio?: number;
  limit: number;
  over: boolean;
  missing?: string;
  /** Cables in it whose outside diameter is not recorded. */
  cablesWithoutDiameter: Cable[];
}

/**
 * How full one place is: the cables' cross-section areas over the inside area, from recorded
 * diameters only. Nothing is assumed: a missing diameter gives no number and says which is missing.
 */
export function placeFill(place: DuctPlace, cables: readonly Cable[], settings: OspSettings = DEFAULT_OSP_SETTINGS): PlaceFill {
  const byId = new Map(cables.map((c) => [c.id, c]));
  const inside = place.cableIds.map((id) => byId.get(id)).filter((c): c is Cable => !!c);
  const without = inside.filter((c) => !c.outerDiameterMm);
  const limit = fillLimit(inside.length, settings);
  const base = { cableCount: inside.length, limit, over: false, cablesWithoutDiameter: without };
  if (inside.length === 0) return { ...base, ratio: 0 };
  if (place.innerWays > 0) {
    return { ...base, missing: `It holds ${place.innerWays} smaller way(s), so fill is worked out for each of them, not for this.` };
  }
  if (!place.innerDiameterMm) return { ...base, missing: 'Inside diameter not recorded.' };
  if (without.length > 0) {
    return { ...base, missing: `Outside diameter not recorded for ${without.map((c) => c.name).join(', ')}.` };
  }
  const area = inside.reduce((sum, c) => sum + (c.outerDiameterMm ?? 0) ** 2, 0);
  const ratio = area / place.innerDiameterMm ** 2;
  return { ...base, ratio, over: ratio > limit };
}

export const formatFill = (ratio: number): string => `${Math.round(ratio * 1000) / 10}%`;

/* ------------------------------------------------------------------ */
/* Capacity                                                            */
/* ------------------------------------------------------------------ */

export interface DuctCapacity {
  /** Ducts laid together, as recorded. */
  wayCount?: number;
  /** Sub-ducts described in the record. */
  described: number;
  /** Ways counted but not described, when the count is higher than the list. */
  undescribed: number;
  inUse: number;
  /** Empty and not blocked. Includes ways whose condition was never checked. */
  free: number;
  blocked: number;
  damaged: number;
  notChecked: number;
  microducts: { total: number; inUse: number; free: number; blocked: number };
}

const usedBy = (place: DuctPlace, all: readonly DuctPlace[]) =>
  place.cableIds.length > 0 || all.some((p) => p.subductId === place.key && p.kind === 'microduct' && p.cableIds.length > 0);

/** Ways in use, free, blocked and damaged, from the record only. */
export function ductCapacity(duct: Duct): DuctCapacity {
  const places = ductPlaces(duct);
  const subs = places.filter((p) => p.kind === 'subduct');
  const micros = places.filter((p) => p.kind === 'microduct');
  const count = (list: DuctPlace[], test: (p: DuctPlace) => boolean) => list.filter(test).length;
  return {
    ...(duct.wayCount ? { wayCount: duct.wayCount } : {}),
    described: subs.length,
    undescribed: duct.wayCount && duct.wayCount > subs.length ? duct.wayCount - subs.length : 0,
    inUse: count(subs, (p) => usedBy(p, places)),
    free: count(subs, (p) => !usedBy(p, places) && p.effectiveCondition !== 'blocked'),
    blocked: count(subs, (p) => p.effectiveCondition === 'blocked'),
    damaged: count(subs, (p) => p.effectiveCondition === 'damaged'),
    notChecked: count(subs, (p) => !p.effectiveCondition),
    microducts: {
      total: micros.length,
      inUse: count(micros, (p) => p.cableIds.length > 0),
      free: count(micros, (p) => p.cableIds.length === 0 && p.effectiveCondition !== 'blocked'),
      blocked: count(micros, (p) => p.effectiveCondition === 'blocked'),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Checks when cables are added                                        */
/* ------------------------------------------------------------------ */

export interface OccupancyIssue {
  /** `error`: physically impossible (a blocked way). `warning`: the person may save anyway, and that is logged. */
  severity: 'error' | 'warning';
  placeKey: string;
  message: string;
}

/**
 * What adding cables to a duct runs into: a blocked way cannot take a new cable (error); a damaged
 * way or a fill above the setting is a warning. Only cables new to a place are judged, so a cable
 * already recorded in a way that was later found blocked is never blamed on this change.
 */
export function ductOccupancyIssues(
  before: Duct | undefined,
  after: Duct,
  cables: readonly Cable[],
  settings: OspSettings = DEFAULT_OSP_SETTINGS,
): OccupancyIssue[] {
  const old = new Map((before ? ductPlaces(before) : []).map((p) => [p.key, new Set(p.cableIds)]));
  const byId = new Map(cables.map((c) => [c.id, c]));
  const issues: OccupancyIssue[] = [];
  for (const place of ductPlaces(after)) {
    const added = place.cableIds.filter((id) => !old.get(place.key)?.has(id));
    if (added.length === 0) continue;
    const names = added.map((id) => byId.get(id)?.name ?? id).join(', ');
    const from = place.conditionFrom ? ` (because ${place.conditionFrom} is blocked)` : '';
    if (place.effectiveCondition === 'blocked') {
      issues.push({
        severity: 'error',
        placeKey: place.key,
        message: `${place.label} in ${after.name} is recorded as blocked${from}, so ${names} cannot go in. If it has been cleared, mark it "${WAY_CONDITION_LABELS.clear}" first.`,
      });
      continue;
    }
    if (place.effectiveCondition === 'damaged') {
      issues.push({
        severity: 'warning',
        placeKey: place.key,
        message: `${place.label} in ${after.name} is recorded as damaged${place.conditionFrom ? ` (${place.conditionFrom} is)` : ''}. Check that ${names} can be pulled through.`,
      });
    }
    const fill = placeFill(place, cables, settings);
    if (fill.ratio !== undefined && fill.over) {
      issues.push({
        severity: 'warning',
        placeKey: place.key,
        message: `${place.label} in ${after.name} would be ${formatFill(fill.ratio)} full with ${fill.cableCount} cable(s); the setting warns above ${formatFill(fill.limit)}.`,
      });
    }
  }
  return issues;
}

/* ------------------------------------------------------------------ */
/* Underground trace                                                   */
/* ------------------------------------------------------------------ */

export interface UndergroundStep {
  duct: Duct;
  /** 0 for the duct the trace started from. */
  depth: number;
  /** The structure it shares with the duct it was reached from. */
  viaStructureId?: string;
  viaStructure?: Equipment;
  fromDuctId?: string;
}

export interface UndergroundGap {
  ductId: string;
  end: 'start' | 'end';
  message: string;
}

export interface UndergroundTrace {
  steps: UndergroundStep[];
  /** Structures the trace passed through or ended at, in the order reached. */
  structures: Equipment[];
  /** Ends where the trace could not go on, and why. */
  gaps: UndergroundGap[];
}

/**
 * Duct to duct along shared structures: from one duct, every duct recorded as ending at the same
 * chamber (or pole, or building entry), and on from those. Read only. Ducts are joined only by a
 * recorded end, never because their lines touch on the map; an end not recorded is listed as a gap.
 */
export function undergroundTrace(data: { equipment: readonly Equipment[]; ducts?: readonly Duct[] }, startDuctId: string): UndergroundTrace | undefined {
  const ducts = data.ducts ?? [];
  const start = ducts.find((d) => d.id === startDuctId);
  if (!start) return undefined;
  const equipment = new Map(data.equipment.map((e) => [e.id, e]));
  const atStructure = new Map<string, Duct[]>();
  for (const duct of ducts) {
    for (const end of new Set([duct.fromStructureId, duct.toStructureId])) {
      if (end) atStructure.set(end, [...(atStructure.get(end) ?? []), duct]);
    }
  }
  const steps: UndergroundStep[] = [{ duct: start, depth: 0 }];
  const seenDucts = new Set([start.id]);
  const seenStructures = new Set<string>();
  const structures: Equipment[] = [];
  const gaps: UndergroundGap[] = [];
  for (let i = 0; i < steps.length; i += 1) {
    const { duct, depth } = steps[i];
    for (const end of ['start', 'end'] as const) {
      const structureId = end === 'start' ? duct.fromStructureId : duct.toStructureId;
      if (!structureId) {
        gaps.push({ ductId: duct.id, end, message: `${duct.name}: where its ${end} is, is not recorded, so the trace stops there.` });
        continue;
      }
      const structure = equipment.get(structureId);
      if (!structure) {
        gaps.push({ ductId: duct.id, end, message: `${duct.name}: its ${end} names ${structureId}, which is not on record.` });
        continue;
      }
      if (!seenStructures.has(structureId)) {
        seenStructures.add(structureId);
        structures.push(structure);
      }
      for (const next of atStructure.get(structureId) ?? []) {
        if (seenDucts.has(next.id)) continue;
        seenDucts.add(next.id);
        steps.push({ duct: next, depth: depth + 1, viaStructureId: structureId, viaStructure: structure, fromDuctId: duct.id });
      }
    }
  }
  return { steps, structures, gaps };
}
