import type { ChangeSet } from '../model/api';
import type { CableInstallationType, StructureStatus } from '../model/enums';
import { cableSegmentSchema } from '../model/schemas';
import type { Attachment, Cable, CableSegment, Duct, Equipment, LatLng } from '../model/types';
import { type AuditEntry, type CommandContext, type CommandResult, fail, type NetworkData, notice, succeed } from './command';
import { type RandomBytes, randomCode } from './fieldCapture';
import { polylineLengthMeters } from './geo';
import { DEFAULT_OSP_SETTINGS, type OspSettings } from './ospSettings';
import { describeLinkProblems, findBrokenLinks, hasPlacedPosition, pointToLine } from './outsidePlant';

/**
 * Network mapping Phase 6: stretches (segments) of one cable. A physical cable stays one record; a
 * stretch only describes part of it: how that part is installed, the duct (and way) or the aerial
 * spans it runs in, and a length a person measured. Each end is a recorded structure on the cable's
 * line or a distance along the drawn line from the cable's From end.
 *
 * Rules (the same in the browser and on the server):
 * - Errors (refused): a stretch off the cable (an end beyond the drawn line, or a structure not on
 *   it), two stretches of one cable overlapping, a stretch with no length, a duct or span that is not
 *   on record (link check), a stretch in a duct and on spans at once, an install method that
 *   contradicts the duct or spans ("Aerial" in a duct). These are broken data.
 * - Warnings (asked, "Save anyway" is written to the audit trail): measured lengths of the stretches
 *   adding up to more than the drawn length (the drawn line is an estimate), a duct that does not list
 *   the cable, a span with no record of the cable on it.
 *
 * Traces, fault impact and fibre paths never read stretches: they are descriptive.
 */

export type SegmentSettings = Pick<OspSettings, 'attachmentCorridorMeters' | 'poleMoveVertexMeters'>;

/** What the stretch rules read. */
export type SegmentCheckData = Pick<NetworkData, 'equipment' | 'cables'> & Partial<Pick<NetworkData, 'cableSegments' | 'ducts' | 'spans' | 'attachments'>>;

/** Random ids, so two offline browsers cannot make the same one. */
export const newSegmentId = (random?: RandomBytes): string => `SEG-${randomCode(10, random)}`;

export const segmentsOf = (data: Partial<Pick<NetworkData, 'cableSegments'>>): CableSegment[] => data.cableSegments ?? [];

/** Metres, to one decimal: the drawn line is not better than that. */
const tenth = (m: number) => Math.round(m * 10) / 10;

/** The drawn line's length in metres, or undefined when no line is drawn. */
export const drawnMetersOf = (cable: Pick<Cable, 'coordinates'>): number | undefined =>
  cable.coordinates.length >= 2 ? polylineLengthMeters(cable.coordinates) : undefined;

/* ------------------------------------------------------------------ */
/* Where a stretch is                                                  */
/* ------------------------------------------------------------------ */

export type SegmentEndSide = 'from' | 'to';

/** One end as stored: a structure, or a distance along the drawn line. */
export const endOf = (s: Pick<CableSegment, 'fromStructureId' | 'fromMeters' | 'toStructureId' | 'toMeters'>, side: SegmentEndSide) =>
  side === 'from' ? { structureId: s.fromStructureId, meters: s.fromMeters } : { structureId: s.toStructureId, meters: s.toMeters };

/**
 * How far along the cable's drawn line one end is, a reason it cannot be placed, or undefined when
 * its structure is not on record (the link check reports that).
 */
export function endAlong(
  cable: Pick<Cable, 'coordinates'>,
  end: { structureId?: string; meters?: number },
  equipmentById: ReadonlyMap<string, Equipment>,
  settings: SegmentSettings = DEFAULT_OSP_SETTINGS,
): number | string | undefined {
  const drawn = drawnMetersOf(cable);
  if (drawn === undefined) return 'The cable has no line drawn yet, so no stretch can be placed on it. Draw its route first.';
  if (end.structureId) {
    const e = equipmentById.get(end.structureId);
    if (!e) return undefined;
    if (!hasPlacedPosition(e) || (e.lat === 0 && e.lng === 0)) return `${e.name} has no confirmed place on the map, so FiberGIS cannot tell where it is on the cable.`;
    const near = pointToLine([e.lat, e.lng], cable.coordinates);
    if (!near) return undefined;
    if (near.distanceMeters > settings.attachmentCorridorMeters) {
      return `${e.name} is ${Math.round(near.distanceMeters)} m from the cable's drawn line (more than the ${settings.attachmentCorridorMeters} m setting). Choose a pole or box on the line, or fix the line first.`;
    }
    return near.alongMeters;
  }
  if (end.meters === undefined) return undefined;
  if (end.meters > drawn + settings.poleMoveVertexMeters) {
    return `${tenth(end.meters)} m is beyond the end of the drawn line (${Math.round(drawn)} m).`;
  }
  return Math.min(end.meters, drawn);
}

export interface SegmentRange {
  /** Metres along the drawn line from the cable's From end; `from` <= `to`. */
  from: number;
  to: number;
}

/** Where a stretch lies along its cable, or the reason it cannot be placed. Undefined: an end is not on record. */
export function segmentRange(
  cable: Pick<Cable, 'coordinates'>,
  segment: CableSegment,
  equipmentById: ReadonlyMap<string, Equipment>,
  settings: SegmentSettings = DEFAULT_OSP_SETTINGS,
): SegmentRange | string | undefined {
  const a = endAlong(cable, endOf(segment, 'from'), equipmentById, settings);
  if (typeof a === 'string') return a;
  const b = endAlong(cable, endOf(segment, 'to'), equipmentById, settings);
  if (typeof b === 'string') return b;
  if (a === undefined || b === undefined) return undefined;
  return { from: Math.min(a, b), to: Math.max(a, b) };
}

/** The part of a line between two distances along it (for drawing a stretch). Empty when there is no line. */
export function lineBetween(line: readonly LatLng[], fromMeters: number, toMeters: number): LatLng[] {
  if (line.length < 2) return [];
  const [a, b] = fromMeters <= toMeters ? [fromMeters, toMeters] : [toMeters, fromMeters];
  const at = (p: LatLng, q: LatLng, t: number): LatLng => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  const out: LatLng[] = [];
  let travelled = 0;
  for (let i = 0; i < line.length - 1; i += 1) {
    const length = polylineLengthMeters([line[i], line[i + 1]]);
    const start = travelled;
    const end = travelled + length;
    travelled = end;
    if (end < a || start > b || length === 0) continue;
    if (out.length === 0) out.push(at(line[i], line[i + 1], Math.max(0, (a - start) / length)));
    if (end <= b) out.push(line[i + 1]);
    else {
      out.push(at(line[i], line[i + 1], (b - start) / length));
      break;
    }
  }
  return out.length === 1 ? [out[0], out[0]] : out;
}

/** Plain words for one end: the structure's name, or the distance from the cable's start. */
export function describeSegmentEnd(segment: CableSegment, side: SegmentEndSide, equipmentById: ReadonlyMap<string, Pick<Equipment, 'name'>>): string {
  const end = endOf(segment, side);
  if (end.structureId) return equipmentById.get(end.structureId)?.name ?? `${end.structureId} (missing)`;
  return end.meters !== undefined ? `${tenth(end.meters)} m from the start` : 'Not recorded';
}

/** Stretches of one cable, in order along it (those that cannot be placed last). */
export function segmentsForCable(
  data: Pick<NetworkData, 'equipment' | 'cables'> & Partial<Pick<NetworkData, 'cableSegments'>>,
  cableId: string,
  settings: SegmentSettings = DEFAULT_OSP_SETTINGS,
): { segment: CableSegment; range?: SegmentRange; problem?: string }[] {
  const cable = data.cables.find((c) => c.id === cableId);
  const byId = new Map(data.equipment.map((e) => [e.id, e]));
  const rows = segmentsOf(data)
    .filter((s) => s.cableId === cableId)
    .map((segment) => {
      const range = cable ? segmentRange(cable, segment, byId, settings) : 'The cable is not on record.';
      return typeof range === 'string' ? { segment, problem: range } : range ? { segment, range } : { segment, problem: 'An end of this stretch is not on record.' };
    });
  return rows.sort((x, y) => (x.range?.from ?? Infinity) - (y.range?.from ?? Infinity));
}

/* ------------------------------------------------------------------ */
/* Rules                                                               */
/* ------------------------------------------------------------------ */

export type SegmentIssueCode =
  | 'no_line'
  | 'off_cable'
  | 'empty'
  | 'overlap'
  | 'duct_and_spans'
  | 'method_contradiction'
  | 'duct_not_listing'
  | 'span_not_recorded'
  | 'lengths_exceed_drawn';

export interface SegmentIssue {
  severity: 'error' | 'warning';
  code: SegmentIssueCode;
  cableId: string;
  /** Absent for a whole-cable issue (lengths). */
  segmentId?: string;
  /** For an overlap: the other stretch. */
  otherSegmentId?: string;
  message: string;
}

const AERIAL_METHODS: readonly CableInstallationType[] = ['Aerial'];
const DUCT_METHODS: readonly CableInstallationType[] = ['Duct', 'Underground'];

/** The way (sub-duct or microduct) by id, with a label for messages. */
function wayOf(duct: Duct, wayId: string): { label: string; cableIds: string[] } | undefined {
  for (const s of duct.subducts) {
    if (s.id === wayId) return { label: `way ${s.label}`, cableIds: s.cableIds };
    const m = s.microducts?.find((x) => x.id === wayId);
    if (m) return { label: `microduct ${m.label} in way ${s.label}`, cableIds: m.cableIds };
  }
  return undefined;
}

const ductListsCable = (duct: Duct, cableId: string) =>
  duct.cableIds.includes(cableId) || duct.subducts.some((s) => s.cableIds.includes(cableId) || (s.microducts ?? []).some((m) => m.cableIds.includes(cableId)));

/** What a person would call a stretch in a message. */
export function segmentLabel(segment: CableSegment, equipmentById: ReadonlyMap<string, Pick<Equipment, 'name'>>): string {
  return `${describeSegmentEnd(segment, 'from', equipmentById)} to ${describeSegmentEnd(segment, 'to', equipmentById)}`;
}

/**
 * Problems of one stretch against the network it would be saved into (`data.cableSegments` should
 * already hold it). Missing records are left to the link check (`findBrokenLinks`).
 */
export function segmentIssues(data: SegmentCheckData, segment: CableSegment, settings: SegmentSettings = DEFAULT_OSP_SETTINGS): SegmentIssue[] {
  const cable = data.cables.find((c) => c.id === segment.cableId);
  if (!cable) return [];
  const issues: SegmentIssue[] = [];
  const add = (severity: SegmentIssue['severity'], code: SegmentIssueCode, message: string) =>
    issues.push({ severity, code, cableId: cable.id, segmentId: segment.id, message });
  const byId = new Map(data.equipment.map((e) => [e.id, e]));
  const label = segmentLabel(segment, byId);

  // Where it is.
  const range = segmentRange(cable, segment, byId, settings);
  if (typeof range === 'string') add('error', drawnMetersOf(cable) === undefined ? 'no_line' : 'off_cable', `Stretch ${label} of ${cable.name}: ${range}`);
  else if (range) {
    if (range.to - range.from < Math.max(0.5, Math.min(settings.poleMoveVertexMeters, 1))) {
      add('error', 'empty', `Stretch ${label} of ${cable.name} starts and ends at the same place. Choose two different points.`);
    } else {
      for (const other of segmentsOf(data)) {
        if (other.id === segment.id || other.cableId !== cable.id) continue;
        const r = segmentRange(cable, other, byId, settings);
        if (!r || typeof r === 'string') continue;
        const overlap = Math.min(range.to, r.to) - Math.max(range.from, r.from);
        if (overlap > settings.poleMoveVertexMeters) {
          issues.push({
            severity: 'error',
            code: 'overlap',
            cableId: cable.id,
            segmentId: segment.id,
            otherSegmentId: other.id,
            message: `Stretch ${label} overlaps stretch ${segmentLabel(other, byId)} of ${cable.name} by about ${Math.round(overlap)} m. Stretches of one cable must not overlap: change one of them first.`,
          });
        }
      }
    }
  }

  // What it runs in.
  const spanIds = segment.spanIds ?? [];
  if (segment.ductId && spanIds.length) {
    add('error', 'duct_and_spans', `Stretch ${label} is recorded both in a duct and on poles. A stretch is one or the other: record two stretches.`);
  }
  const method = segment.installMethod;
  if (method && segment.ductId && !DUCT_METHODS.includes(method)) {
    add('error', 'method_contradiction', `Stretch ${label} is recorded as "${method}" but runs in a duct. Choose Duct or Underground, or leave the method not recorded.`);
  }
  if (method && spanIds.length && !AERIAL_METHODS.includes(method)) {
    add('error', 'method_contradiction', `Stretch ${label} is recorded as "${method}" but hangs on spans. Choose Aerial, or leave the method not recorded.`);
  }

  // Records that should agree with it (warnings: one of them may simply not be recorded yet).
  const duct = segment.ductId ? (data.ducts ?? []).find((d) => d.id === segment.ductId) : undefined;
  if (duct) {
    const way = segment.ductWayId ? wayOf(duct, segment.ductWayId) : undefined;
    if (way && !way.cableIds.includes(cable.id)) {
      add('warning', 'duct_not_listing', `Duct ${duct.name} does not list ${cable.name} in ${way.label}. If it really runs there, add it in the duct panel too.`);
    } else if (!way && !ductListsCable(duct, cable.id)) {
      add('warning', 'duct_not_listing', `Duct ${duct.name} does not list ${cable.name}. If it really runs there, add it in the duct panel too.`);
    }
  }
  const spanById = new Map((data.spans ?? []).map((s) => [s.id, s]));
  const attachments = data.attachments ?? [];
  for (const spanId of spanIds) {
    const span = spanById.get(spanId);
    if (span && !attachments.some((a) => a.cableId === cable.id && a.spanId === spanId)) {
      add('warning', 'span_not_recorded', `No record says ${cable.name} is on span ${span.name}. If it is, record it in the span panel too.`);
    }
  }
  return issues;
}

/**
 * Whole-cable warning: the measured lengths of its stretches add up to more than the drawn length.
 * Only a warning, because the drawn line is an estimate (slack, sag and bends add length).
 */
export function segmentLengthIssue(data: Pick<NetworkData, 'cables'> & Partial<Pick<NetworkData, 'cableSegments'>>, cableId: string): SegmentIssue | undefined {
  const cable = data.cables.find((c) => c.id === cableId);
  const drawn = cable ? drawnMetersOf(cable) : undefined;
  if (!cable || drawn === undefined) return undefined;
  const measured = segmentsOf(data).filter((s) => s.cableId === cableId && s.measuredLengthMeters !== undefined);
  const total = measured.reduce((sum, s) => sum + (s.measuredLengthMeters ?? 0), 0);
  if (measured.length === 0 || total <= drawn) return undefined;
  return {
    severity: 'warning',
    code: 'lengths_exceed_drawn',
    cableId,
    message: `The measured lengths of ${measured.length} stretch(es) of ${cable.name} add up to ${tenth(total)} m, more than the drawn line (${Math.round(drawn)} m). The drawn line is an estimate (slack, sag and bends add length), so check the line or the measurements.`,
  };
}

/** Every issue of one cable's stretches, for its panel and the map check. */
export function cableSegmentIssues(data: SegmentCheckData, cableId: string, settings: SegmentSettings = DEFAULT_OSP_SETTINGS): SegmentIssue[] {
  const own = segmentsOf(data).filter((s) => s.cableId === cableId);
  const seen = new Set<string>();
  const issues: SegmentIssue[] = [];
  for (const s of own) {
    for (const issue of segmentIssues(data, s, settings)) {
      // An overlap is reported once, not from both sides.
      const key = issue.code === 'overlap' ? `overlap:${[s.id, issue.otherSegmentId].sort().join('|')}` : `${issue.code}:${s.id}:${issue.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      issues.push(issue);
    }
  }
  const length = segmentLengthIssue(data, cableId);
  if (length) issues.push(length);
  return issues;
}

/** Every error in stored stretches (restore check, map check). Missing records are the link check's. */
export function findSegmentErrors(data: SegmentCheckData, settings: SegmentSettings = DEFAULT_OSP_SETTINGS): SegmentIssue[] {
  const cableIds = [...new Set(segmentsOf(data).map((s) => s.cableId))];
  return cableIds.flatMap((id) => cableSegmentIssues(data, id, settings).filter((i) => i.severity === 'error'));
}

/* ------------------------------------------------------------------ */
/* Server check                                                        */
/* ------------------------------------------------------------------ */

/** Whether a change set stores a stretch, so the server needs to look. */
export const changeSetTouchesSegments = (changes: ChangeSet): boolean => (changes.upserts?.cableSegments?.length ?? 0) > 0;

const applyChanges = <T extends { id: string }>(stored: readonly T[] | undefined, upserts: readonly T[] | undefined, deletes: readonly string[] | undefined): T[] => {
  const byId = new Map((stored ?? []).map((r) => [r.id, r]));
  for (const id of deletes ?? []) byId.delete(id);
  for (const r of upserts ?? []) byId.set(r.id, r);
  return [...byId.values()];
};

/**
 * Errors the stretches a change stores would have, worked out on the network after the change. A
 * stretch already stored is not blamed on a change that does not store it (such as a route edit).
 * Warnings never block here.
 */
export function checkChangeSetSegments(current: SegmentCheckData, changes: ChangeSet, settings: SegmentSettings = DEFAULT_OSP_SETTINGS): SegmentIssue[] {
  const upserts = changes.upserts?.cableSegments ?? [];
  if (upserts.length === 0) return [];
  const after: SegmentCheckData = {
    equipment: applyChanges(current.equipment, changes.upserts?.equipment, changes.deletes?.equipment),
    cables: applyChanges(current.cables, changes.upserts?.cables, changes.deletes?.cables),
    cableSegments: applyChanges(current.cableSegments, upserts, changes.deletes?.cableSegments),
    ducts: applyChanges(current.ducts, changes.upserts?.ducts, changes.deletes?.ducts),
    spans: applyChanges(current.spans, changes.upserts?.spans, changes.deletes?.spans),
    attachments: applyChanges(current.attachments, changes.upserts?.attachments, changes.deletes?.attachments),
  };
  const stored = new Map(after.cableSegments!.map((s) => [s.id, s]));
  return upserts.flatMap((s) => segmentIssues(after, stored.get(s.id) ?? s, settings).filter((i) => i.severity === 'error'));
}

/* ------------------------------------------------------------------ */
/* Commands                                                            */
/* ------------------------------------------------------------------ */

export type SegmentEndDraft = { structureId: string } | { meters: number };

export interface CableSegmentDraft {
  /** Set when changing a stretch already recorded. */
  id?: string;
  cableId: string;
  from: SegmentEndDraft;
  to: SegmentEndDraft;
  installMethod?: CableInstallationType;
  ductId?: string;
  ductWayId?: string;
  spanIds?: string[];
  measuredLengthMeters?: number;
  lengthNote?: string;
  status?: StructureStatus;
  notes?: string;
}

const text = (value: string | undefined) => (value?.trim() ? value.trim() : undefined);

const dropUndefined = <T extends object>(record: T): T => Object.fromEntries(Object.entries(record).filter(([, v]) => v !== undefined)) as T;

const endFields = (side: SegmentEndSide, end: SegmentEndDraft) =>
  'structureId' in end ? { [`${side}StructureId`]: end.structureId } : { [`${side}Meters`]: tenth(end.meters) };

/**
 * Records or changes one stretch of a cable. Broken data is refused with the reason; anything that
 * only looks wrong asks "Save anyway?" and the answer is written to the audit trail. The two ends
 * are stored in order along the cable (From end first), whichever was tapped first.
 */
export function saveCableSegment(
  data: NetworkData,
  draft: CableSegmentDraft,
  ctx: CommandContext = {},
  settings: SegmentSettings = DEFAULT_OSP_SETTINGS,
): CommandResult<CableSegment> {
  const cable = data.cables.find((c) => c.id === draft.cableId);
  if (!cable) return fail('Cable missing', `Cable ${draft.cableId} was not found.`);
  const existing = draft.id ? segmentsOf(data).find((s) => s.id === draft.id) : undefined;
  if (draft.id && !existing) return fail('Stretch missing', `Stretch ${draft.id} was not found. Nothing was saved.`);
  if (existing && existing.cableId !== cable.id) return fail('Not saved', 'A stretch belongs to one cable and cannot be moved to another. Nothing was saved.');

  const byId = new Map(data.equipment.map((e) => [e.id, e]));
  let from = draft.from;
  let to = draft.to;
  const a = endAlong(cable, 'structureId' in from ? { structureId: from.structureId } : { meters: from.meters }, byId, settings);
  const b = endAlong(cable, 'structureId' in to ? { structureId: to.structureId } : { meters: to.meters }, byId, settings);
  if (typeof a === 'number' && typeof b === 'number' && a > b) [from, to] = [to, from];

  const now = (ctx.now ?? new Date()).toISOString();
  const spanIds = [...new Set(draft.spanIds ?? [])];
  const record = dropUndefined({
    id: existing?.id ?? newSegmentId(),
    cableId: cable.id,
    ...endFields('from', from),
    ...endFields('to', to),
    installMethod: draft.installMethod,
    ductId: text(draft.ductId),
    ductWayId: draft.ductId ? text(draft.ductWayId) : undefined,
    spanIds: spanIds.length ? spanIds : undefined,
    measuredLengthMeters: draft.measuredLengthMeters,
    lengthNote: draft.measuredLengthMeters !== undefined ? text(draft.lengthNote) : undefined,
    status: draft.status,
    notes: text(draft.notes),
    createdAt: existing?.createdAt ?? now,
    createdBy: existing ? existing.createdBy : ctx.actor,
    ...(existing ? { updatedAt: now, updatedBy: ctx.actor } : {}),
  }) as CableSegment;
  const parsed = cableSegmentSchema.safeParse(record);
  if (!parsed.success) return fail('Not saved', `${parsed.error.issues[0]?.message ?? 'The stretch is not complete.'} Nothing was saved.`, 'warning');

  const list = existing ? segmentsOf(data).map((s) => (s.id === existing.id ? record : s)) : [...segmentsOf(data), record];
  const after = { ...data, cableSegments: list };
  const broken = findBrokenLinks({ ...after, cableSegments: [record] }).filter((p) => p.collection === 'cableSegments');
  if (broken.length > 0) return fail('Not saved', describeLinkProblems(broken));
  const issues = segmentIssues(after, record, settings);
  const errors = issues.filter((i) => i.severity === 'error');
  if (errors.length > 0) return fail('Not saved', `${errors[0].message}${errors.length > 1 ? ` (and ${errors.length - 1} more)` : ''} Nothing was saved.`, 'warning');
  const warnings = issues.filter((i) => i.severity === 'warning');
  const length = record.measuredLengthMeters !== undefined ? segmentLengthIssue(after, cable.id) : undefined;
  if (length) warnings.push(length);

  const label = segmentLabel(record, byId);
  const audit: AuditEntry[] = [
    {
      action: existing ? 'CABLE_SEGMENT_UPDATED' : 'CABLE_SEGMENT_ADDED',
      details: `${cable.id} stretch ${record.id}: ${label}${record.installMethod ? `, ${record.installMethod}` : ''}${record.ductId ? `, duct ${record.ductId}` : ''}${record.spanIds ? `, ${record.spanIds.length} span(s)` : ''}`.slice(0, 1000),
      assetId: cable.id,
      assetType: 'Cable',
    },
    ...(warnings.length
      ? [{ action: 'WARNING_ACCEPTED', details: `Saved after the warning: ${warnings.map((w) => w.message).join(' ')}`.slice(0, 1000), assetId: cable.id, assetType: 'Cable' as const }]
      : []),
  ];
  return succeed(record, { cableSegments: list }, {
    notice: notice('success', 'Stretch saved', `${cable.name}: ${label}. You can undo this.`),
    audit,
    ...(warnings.length ? { confirm: `Please check: ${warnings.map((w) => w.message).join(' ')} Save anyway?` } : {}),
  });
}

/** Removes one stretch record. The cable itself is not changed. */
export function deleteCableSegment(data: NetworkData, id: string): CommandResult<CableSegment> {
  const segment = segmentsOf(data).find((s) => s.id === id);
  if (!segment) return fail('Stretch missing', `Stretch ${id} was not found.`);
  const cable = data.cables.find((c) => c.id === segment.cableId);
  const label = segmentLabel(segment, new Map(data.equipment.map((e) => [e.id, e])));
  return succeed(segment, { cableSegments: segmentsOf(data).filter((s) => s.id !== id) }, {
    confirm: `Delete the stretch record ${label}${cable ? ` of ${cable.name}` : ''}? The cable stays as it is; only this description goes. You can undo this.`,
    notice: notice('info', 'Stretch deleted', label),
    audit: [{ action: 'CABLE_SEGMENT_DELETED', details: `${segment.cableId} stretch ${id}: ${label}`, assetId: segment.cableId, assetType: 'Cable' }],
  });
}

/* ------------------------------------------------------------------ */
/* Split and join (used by cableSplitMerge.ts)                         */
/* ------------------------------------------------------------------ */

/**
 * Stretches of a cable being split at `splitAlong` metres (along its current line): each goes to the
 * part it lies on. A stretch across the split point is refused, never cut in two, because its
 * measured length cannot be divided without inventing numbers. Distances on the second part are
 * counted from the split point; one end at the split point (within the pole-move setting) is set
 * exactly on it.
 */
export function splitCableSegments(
  data: Pick<NetworkData, 'equipment'> & Partial<Pick<NetworkData, 'cableSegments'>>,
  cable: Cable,
  splitAlong: number,
  secondId: string,
  lengths: { first: number; second: number },
  settings: SegmentSettings = DEFAULT_OSP_SETTINGS,
): { segments?: CableSegment[]; problems: string[]; movedToSecond: string[]; keptOnFirst: number } {
  const own = segmentsOf(data).filter((s) => s.cableId === cable.id);
  if (own.length === 0) return { problems: [], movedToSecond: [], keptOnFirst: 0 };
  const byId = new Map(data.equipment.map((e) => [e.id, e]));
  const tol = settings.poleMoveVertexMeters;
  const problems: string[] = [];
  const moved: string[] = [];
  let kept = 0;
  const next = new Map<string, CableSegment>();
  for (const s of own) {
    const label = segmentLabel(s, byId);
    const range = segmentRange(cable, s, byId, settings);
    if (!range || typeof range === 'string') {
      problems.push(`Stretch ${label} cannot be placed on the line${typeof range === 'string' ? `: ${range}` : ''}. Change or delete it first.`);
      continue;
    }
    const clamp = (m: number, max: number) => tenth(Math.min(Math.max(m, 0), max));
    if (range.to <= splitAlong + tol) {
      kept += 1;
      next.set(s.id, dropUndefined({
        ...s,
        fromMeters: s.fromMeters !== undefined ? clamp(s.fromMeters, lengths.first) : undefined,
        toMeters: s.toMeters !== undefined ? clamp(s.toMeters, lengths.first) : undefined,
      }));
    } else if (range.from >= splitAlong - tol) {
      moved.push(label);
      next.set(s.id, dropUndefined({
        ...s,
        cableId: secondId,
        fromMeters: s.fromMeters !== undefined ? clamp(s.fromMeters - splitAlong, lengths.second) : undefined,
        toMeters: s.toMeters !== undefined ? clamp(s.toMeters - splitAlong, lengths.second) : undefined,
      }));
    } else {
      problems.push(
        `Stretch ${label} runs across the split point (${Math.round(range.from)} to ${Math.round(range.to)} m). Change it to end at the split point, or delete it, first.`,
      );
    }
  }
  if (problems.length) return { problems, movedToSecond: [], keptOnFirst: 0 };
  return { segments: segmentsOf(data).map((s) => next.get(s.id) ?? s), problems, movedToSecond: moved, keptOnFirst: kept };
}

/**
 * Stretches of two cables being joined into `keep`: distances are re-counted along the joined line.
 * `keepFirst`: the kept cable's line comes first. `otherReversed`: the other cable was turned round to
 * fit. Structure ends need no change. Distances beyond the joined line are set on its end.
 */
export function mergeCableSegments(
  data: Partial<Pick<NetworkData, 'cableSegments'>>,
  keep: Cable,
  other: Cable,
  join: { keepFirst: boolean; otherReversed: boolean; keepOffset: number; otherOffset: number; total: number },
): { segments?: CableSegment[]; moved: number } {
  const touched = segmentsOf(data).filter((s) => s.cableId === keep.id || s.cableId === other.id);
  if (touched.length === 0) return { moved: 0 };
  const otherDrawn = drawnMetersOf(other) ?? 0;
  const clamp = (m: number) => tenth(Math.min(Math.max(m, 0), join.total));
  const shift = (s: CableSegment, f: (m: number) => number): CableSegment =>
    dropUndefined({
      ...s,
      cableId: keep.id,
      fromMeters: s.fromMeters !== undefined ? clamp(f(s.fromMeters)) : undefined,
      toMeters: s.toMeters !== undefined ? clamp(f(s.toMeters)) : undefined,
    });
  let moved = 0;
  const segments = segmentsOf(data).map((s) => {
    if (s.cableId === keep.id) return join.keepOffset ? shift(s, (m) => m + join.keepOffset) : s;
    if (s.cableId !== other.id) return s;
    moved += 1;
    const turned = (m: number) => (join.otherReversed ? otherDrawn - m : m);
    const next = shift(s, (m) => turned(m) + join.otherOffset);
    // Keep the From end first along the joined line.
    if (join.otherReversed) {
      const swapped = dropUndefined({
        ...next,
        fromStructureId: next.toStructureId,
        fromMeters: next.toMeters,
        toStructureId: next.fromStructureId,
        toMeters: next.fromMeters,
      });
      return swapped;
    }
    return next;
  });
  return { segments, moved };
}

/* ------------------------------------------------------------------ */
/* Corridor view and map layers                                        */
/* ------------------------------------------------------------------ */

export interface CorridorCable {
  cable: Cable;
  /** Plain words for each record that puts it here. */
  sources: string[];
  segments: CableSegment[];
  /** A stretch says it is here but the duct's or span's own record does not, or the other way round. */
  mismatch?: string;
}

/**
 * Read-only: every cable recorded in one duct, from the duct's own list and from cable stretches
 * that name it. Nothing is worked out from where lines run on the map.
 */
export function cablesInDuct(data: Pick<NetworkData, 'cables'> & Partial<Pick<NetworkData, 'ducts' | 'cableSegments'>>, ductId: string): CorridorCable[] {
  const duct = (data.ducts ?? []).find((d) => d.id === ductId);
  if (!duct) return [];
  const rows = new Map<string, { sources: string[]; segments: CableSegment[]; listed: boolean }>();
  const row = (id: string) => rows.get(id) ?? rows.set(id, { sources: [], segments: [], listed: false }).get(id)!;
  for (const id of duct.cableIds) Object.assign(row(id), { listed: true }).sources.push('Listed in the duct');
  for (const s of duct.subducts) {
    for (const id of s.cableIds) Object.assign(row(id), { listed: true }).sources.push(`Listed in way ${s.label}`);
    for (const m of s.microducts ?? []) for (const id of m.cableIds) Object.assign(row(id), { listed: true }).sources.push(`Listed in microduct ${m.label} (way ${s.label})`);
  }
  for (const seg of segmentsOf(data)) {
    if (seg.ductId !== ductId) continue;
    const r = row(seg.cableId);
    r.segments.push(seg);
    const way = seg.ductWayId ? wayOf(duct, seg.ductWayId) : undefined;
    r.sources.push(`A stretch of the cable says it runs here${way ? ` (${way.label})` : ''}`);
  }
  return toCorridor(data.cables, rows, (r) => (!r.listed ? 'The duct\'s own list does not name this cable.' : undefined));
}

/** Read-only: every cable recorded on one span, from pole records (attachments) and cable stretches. */
export function cablesAlongSpan(
  data: Pick<NetworkData, 'cables'> & Partial<Pick<NetworkData, 'spans' | 'attachments' | 'cableSegments'>>,
  spanId: string,
): CorridorCable[] {
  if (!(data.spans ?? []).some((s) => s.id === spanId)) return [];
  const rows = new Map<string, { sources: string[]; segments: CableSegment[]; listed: boolean }>();
  const row = (id: string) => rows.get(id) ?? rows.set(id, { sources: [], segments: [], listed: false }).get(id)!;
  for (const a of data.attachments ?? []) {
    if (a.spanId !== spanId) continue;
    Object.assign(row(a.cableId), { listed: true }).sources.push(attachmentWords(a));
  }
  for (const seg of segmentsOf(data)) {
    if (!seg.spanIds?.includes(spanId)) continue;
    const r = row(seg.cableId);
    r.segments.push(seg);
    r.sources.push('A stretch of the cable says it hangs here');
  }
  return toCorridor(data.cables, rows, (r) => (!r.listed ? 'No pole record says this cable is on the span.' : undefined));
}

const attachmentWords = (a: Attachment) => `Recorded on this span (${a.status})`;

function toCorridor(
  cables: readonly Cable[],
  rows: Map<string, { sources: string[]; segments: CableSegment[]; listed: boolean }>,
  mismatch: (r: { listed: boolean; segments: CableSegment[] }) => string | undefined,
): CorridorCable[] {
  const byId = new Map(cables.map((c) => [c.id, c]));
  const out: CorridorCable[] = [];
  for (const [id, r] of rows) {
    const cable = byId.get(id);
    if (!cable) continue;
    const note = mismatch(r);
    out.push({ cable, sources: [...new Set(r.sources)], segments: r.segments, ...(note ? { mismatch: note } : {}) });
  }
  return out.sort((x, y) => x.cable.name.localeCompare(y.cable.name));
}

/**
 * Install methods recorded on each cable's stretches (only recorded ones), for the map layers. A
 * cable whose stretches say both "Aerial" and "Duct" is in both install layers.
 */
export function segmentInstallMethods(segments: readonly CableSegment[]): Map<string, CableInstallationType[]> {
  const out = new Map<string, CableInstallationType[]>();
  for (const s of segments) {
    if (!s.installMethod) continue;
    const list = out.get(s.cableId) ?? [];
    if (!list.includes(s.installMethod)) list.push(s.installMethod);
    out.set(s.cableId, list);
  }
  return out;
}
