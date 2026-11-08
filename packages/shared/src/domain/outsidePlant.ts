import type { ChangeSet } from '../model/api';
import type { NetworkSnapshot } from '../model/collections';
import type {
  AttachmentStatus,
  LengthMarkUnit,
  LinkBasis,
  PermissionKind,
  StructureStatus,
} from '../model/enums';
import type {
  Attachment,
  Cable,
  Duct,
  Equipment,
  LatLng,
  Permission,
  SlackLoop,
  Span,
  Subduct,
} from '../model/types';
import {
  type AuditEntry,
  type CommandContext,
  type CommandResult,
  fail,
  type NetworkData,
  type NetworkPatch,
  notice,
  type OspCollection,
  succeed,
} from './command';
import { isLatLngPair, isValidCoordinate } from './defaults';
import { assetGroupOf, distanceMeters, type RandomBytes, randomCode } from './fieldCapture';
import { polylineLengthMeters } from './geo';
import { DEFAULT_OSP_SETTINGS, type OspSettings } from './ospSettings';

/**
 * Outside plant: spans between poles, which cables are carried where (attachments), ducts with
 * their occupancy, slack loops and permissions. Every link here is an explicit record a person or a
 * file created. Nothing is ever linked because two things are near each other: nearness only produces
 * suggestions that a person must confirm one by one.
 */

/* ------------------------------------------------------------------ */
/* IDs and small helpers                                               */
/* ------------------------------------------------------------------ */

export type OspIdPrefix = 'SPN' | 'ATT' | 'DCT' | 'SUB' | 'SLK' | 'PRM' | 'IMP';

/** Random IDs, so two offline browsers cannot make the same one. */
export const newOspId = (prefix: OspIdPrefix, random?: RandomBytes): string => `${prefix}-${randomCode(10, random)}`;

const spansOf = (data: Partial<Pick<NetworkData, 'spans'>>) => data.spans ?? [];
const attachmentsOf = (data: Partial<Pick<NetworkData, 'attachments'>>) => data.attachments ?? [];
const ductsOf = (data: Partial<Pick<NetworkData, 'ducts'>>) => data.ducts ?? [];
const slackLoopsOf = (data: Partial<Pick<NetworkData, 'slackLoops'>>) => data.slackLoops ?? [];
const permissionsOf = (data: Partial<Pick<NetworkData, 'permissions'>>) => data.permissions ?? [];

const stamp = (ctx: CommandContext) => ({
  createdAt: (ctx.now ?? new Date()).toISOString(),
  ...(ctx.actor ? { createdBy: ctx.actor } : {}),
});

const trimmed = (value: string | undefined) => {
  const text = value?.trim();
  return text ? text : undefined;
};

/** A pole as the "same one?" groups see it: any type with Pole in its name. */
export const isPoleType = (type: string): boolean => assetGroupOf(type) === 'pole';

/** Equipment whose stored position means something (not a placeholder waiting for the office). */
export const hasPlacedPosition = (e: Pick<Equipment, 'officeMustPlace' | 'locationMethod'>): boolean =>
  !e.officeMustPlace && e.locationMethod !== 'not_placed';

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */

const EARTH_RADIUS_M = 6371e3;

export interface LineProximity {
  /** Shortest distance from the point to the line. */
  distanceMeters: number;
  /** How far along the line the nearest place is, from its first point. */
  alongMeters: number;
}

/**
 * Distance from a point to a polyline, using a flat local projection around the point. Good to well
 * under a metre at the tens of metres this is used for.
 */
export function pointToLine(point: LatLng, line: readonly LatLng[]): LineProximity | undefined {
  if (line.length === 0) return undefined;
  const [lat0, lng0] = point;
  const k = (Math.PI / 180) * EARTH_RADIUS_M;
  const cos0 = Math.cos((lat0 * Math.PI) / 180);
  const xy = (p: LatLng) => [(p[1] - lng0) * k * cos0, (p[0] - lat0) * k] as const;
  if (line.length === 1) {
    return { distanceMeters: distanceMeters(point, line[0]), alongMeters: 0 };
  }
  let best: LineProximity | undefined;
  let travelled = 0;
  for (let i = 0; i < line.length - 1; i += 1) {
    const [ax, ay] = xy(line[i]);
    const [bx, by] = xy(line[i + 1]);
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSq));
    const px = ax + t * dx;
    const py = ay + t * dy;
    const distance = Math.hypot(px, py);
    const segment = polylineLengthMeters([line[i], line[i + 1]]);
    if (!best || distance < best.distanceMeters) best = { distanceMeters: distance, alongMeters: travelled + t * segment };
    travelled += segment;
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* Duplicate check                                                     */
/* ------------------------------------------------------------------ */

export interface PossibleDuplicate {
  equipment: Equipment;
  distanceMeters: number;
}

/** Same kind of item: same "same one?" group (pole, box, drop) when it has one, else the same type. */
export const sameKind = (a: string, b: string): boolean => {
  const group = assetGroupOf(a);
  return group !== null ? assetGroupOf(b) === group : a === b;
};

/**
 * Existing items of the same kind within the duplicate radius, nearest first. Used to ask "same one?"
 * before creating. It only warns: the person decides, and a new item is always allowed.
 */
export function findPossibleDuplicates(
  equipment: readonly Equipment[],
  type: string,
  point: LatLng,
  settings: Pick<OspSettings, 'duplicateRadiusMeters'> = DEFAULT_OSP_SETTINGS,
  limit = 3,
): PossibleDuplicate[] {
  if (!isValidCoordinate(point[0], point[1])) return [];
  return equipment
    .filter((e) => sameKind(e.type, type) && hasPlacedPosition(e))
    .map((e) => ({ equipment: e, distanceMeters: distanceMeters(point, [e.lat, e.lng]) }))
    .filter((d) => d.distanceMeters <= settings.duplicateRadiusMeters)
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, limit);
}

/* ------------------------------------------------------------------ */
/* Spans                                                               */
/* ------------------------------------------------------------------ */

export interface SpanDraft {
  id?: string;
  fromStructureId: string;
  toStructureId: string;
  status: StructureStatus;
  basis: LinkBasis;
  measuredLengthMeters?: number;
  roadCrossing?: boolean;
  captureRunId?: string;
  notes?: string;
}

const spanName = (from: Equipment, to: Equipment) => `${from.name} – ${to.name}`;

/** The span joining two structures, in either direction. */
export const spanBetween = (spans: readonly Span[], a: string, b: string): Span | undefined =>
  spans.find((s) => (s.fromStructureId === a && s.toStructureId === b) || (s.fromStructureId === b && s.toStructureId === a));

/** Map length of a span, from its two ends. Undefined when an end is missing. */
export function spanDrawnMeters(span: Span, equipment: readonly Equipment[]): number | undefined {
  const from = equipment.find((e) => e.id === span.fromStructureId);
  const to = equipment.find((e) => e.id === span.toStructureId);
  return from && to ? distanceMeters([from.lat, from.lng], [to.lat, to.lng]) : undefined;
}

/** Builds a span record, or explains why it cannot exist. Does not change anything. */
export function buildSpan(data: NetworkData, draft: SpanDraft, ctx: CommandContext = {}): Span | string {
  const from = data.equipment.find((e) => e.id === draft.fromStructureId);
  const to = data.equipment.find((e) => e.id === draft.toStructureId);
  if (!from) return `The first end (${draft.fromStructureId}) does not exist.`;
  if (!to) return `The second end (${draft.toStructureId}) does not exist.`;
  if (from.id === to.id) return 'A span joins two different poles.';
  if (draft.basis === 'field_sequence' && draft.status !== 'proposed') {
    return 'A span from the field order can only be proposed until the office confirms it.';
  }
  if (draft.measuredLengthMeters !== undefined && !(draft.measuredLengthMeters > 0)) return 'A measured length must be above 0.';
  const existing = spanBetween(spansOf(data), from.id, to.id);
  if (existing) return `A span between ${from.name} and ${to.name} already exists (${existing.id}).`;
  return {
    id: draft.id ?? newOspId('SPN'),
    name: spanName(from, to),
    fromStructureId: from.id,
    toStructureId: to.id,
    status: draft.status,
    basis: draft.basis,
    ...(draft.measuredLengthMeters !== undefined ? { measuredLengthMeters: draft.measuredLengthMeters } : {}),
    ...(draft.roadCrossing ? { roadCrossing: true } : {}),
    ...(draft.captureRunId ? { captureRunId: draft.captureRunId } : {}),
    ...(trimmed(draft.notes) ? { notes: trimmed(draft.notes) } : {}),
    ...stamp(ctx),
  };
}

export function createSpan(data: NetworkData, draft: SpanDraft, ctx: CommandContext = {}): CommandResult<Span> {
  const span = buildSpan(data, draft, ctx);
  if (typeof span === 'string') return fail('Span not added', span, 'warning');
  return succeed(
    span,
    { spans: [...spansOf(data), span] },
    {
      notice: notice('success', 'Span added', `${span.name} (${span.status}).`),
      audit: [
        {
          action: 'SPAN_CREATED',
          details: `Span ${span.id} ${span.fromStructureId} – ${span.toStructureId}, ${span.status}, basis ${span.basis}`,
          assetId: span.id,
          assetType: 'Span',
        },
      ],
    },
  );
}

/** The office confirms a proposed span, or changes how sure it is. Basis stays as recorded. */
export function setSpanStatus(
  data: NetworkData,
  id: string,
  status: Exclude<StructureStatus, 'proposed'>,
  ctx: CommandContext = {},
): CommandResult<Span> {
  const span = spansOf(data).find((s) => s.id === id);
  if (!span) return fail('Span missing', `Span ${id} was not found.`);
  const updated: Span = {
    ...span,
    status,
    confirmedAt: (ctx.now ?? new Date()).toISOString(),
    ...(ctx.actor ? { confirmedBy: ctx.actor } : {}),
  };
  return succeed(
    updated,
    { spans: spansOf(data).map((s) => (s.id === id ? updated : s)) },
    {
      notice: notice('success', span.status === 'proposed' ? 'Span confirmed' : 'Span updated', `${span.name}: ${status}.`),
      audit: [
        {
          action: span.status === 'proposed' ? 'SPAN_CONFIRMED' : 'SPAN_STATUS_CHANGED',
          details: `Span ${id}: ${span.status} → ${status}`,
          assetId: id,
          assetType: 'Span',
        },
      ],
    },
  );
}

/** Saves edited span details (length, crossing, notes). Ends cannot be changed: delete and add again. */
export function updateSpan(data: NetworkData, span: Span): CommandResult<Span> {
  const current = spansOf(data).find((s) => s.id === span.id);
  if (!current) return fail('Span missing', `Span ${span.id} was not found.`);
  if (current.fromStructureId !== span.fromStructureId || current.toStructureId !== span.toStructureId) {
    return fail('Ends cannot change', 'Delete this span and add a new one between the right poles.');
  }
  if (span.measuredLengthMeters !== undefined && !(span.measuredLengthMeters > 0)) {
    return fail('Length not saved', 'A measured length must be above 0.');
  }
  return succeed(
    span,
    { spans: spansOf(data).map((s) => (s.id === span.id ? span : s)) },
    {
      notice: notice('success', 'Span saved', span.name),
      audit: [{ action: 'SPAN_UPDATED', details: `Updated span ${span.id}`, assetId: span.id, assetType: 'Span' }],
    },
  );
}

/** Removes a span and the attachments recorded on it. The caller must confirm. */
export function deleteSpan(data: NetworkData, id: string): CommandResult<Span> {
  const span = spansOf(data).find((s) => s.id === id);
  if (!span) return fail('Span missing', `Span ${id} was not found.`);
  const onSpan = attachmentsOf(data).filter((a) => a.spanId === id);
  return succeed(
    span,
    {
      spans: spansOf(data).filter((s) => s.id !== id),
      ...(onSpan.length ? { attachments: attachmentsOf(data).filter((a) => a.spanId !== id) } : {}),
    },
    {
      confirm: `Delete span ${span.name}?${onSpan.length ? ` ${onSpan.length} cable record(s) on it will also be removed.` : ''} You can undo this.`,
      notice: notice('info', 'Span deleted', span.name),
      audit: [
        {
          action: 'SPAN_DELETED',
          details: `Deleted span ${id}${onSpan.length ? ` and attachments ${onSpan.map((a) => a.id).join(', ')}` : ''}`,
          assetId: id,
          assetType: 'Span',
        },
      ],
    },
  );
}

/**
 * The proposed span a "Next pole" capture records between the previous pole and this one: order
 * only, drawn dashed, until the office confirms it. Never made when either end is not a pole or a
 * span between them already exists. The ID follows the capture's ID, so saving twice makes one span.
 */
export function fieldSequenceSpan(data: NetworkData, record: Equipment, now: Date, capturedBy?: string): Span | undefined {
  if (!record.previousAssetId || !isPoleType(record.type)) return undefined;
  const previous = data.equipment.find((e) => e.id === record.previousAssetId);
  if (!previous || !isPoleType(previous.type) || previous.id === record.id) return undefined;
  if (spanBetween(spansOf(data), previous.id, record.id)) return undefined;
  const code = record.id.split('-').at(-1) ?? record.id;
  return {
    id: `SPN-${code}`,
    name: spanName(previous, record),
    fromStructureId: previous.id,
    toStructureId: record.id,
    status: 'proposed',
    basis: 'field_sequence',
    ...(record.captureRunId ? { captureRunId: record.captureRunId } : {}),
    createdAt: now.toISOString(),
    ...(capturedBy ? { createdBy: capturedBy } : {}),
    notes: 'The worker captured these two poles one after the other. That does not prove a cable runs between them.',
  };
}

/* ------------------------------------------------------------------ */
/* Attachments                                                         */
/* ------------------------------------------------------------------ */

export interface AttachmentDraft {
  cableId: string;
  structureId?: string;
  spanId?: string;
  status: AttachmentStatus;
  basis: LinkBasis;
  notes?: string;
}

const sameHost = (a: Pick<Attachment, 'cableId' | 'structureId' | 'spanId'>, b: Pick<Attachment, 'cableId' | 'structureId' | 'spanId'>) =>
  a.cableId === b.cableId && a.structureId === b.structureId && a.spanId === b.spanId;

/**
 * Records that cables are carried on poles or spans. Each draft is one person-confirmed fact.
 * Ones already recorded are skipped, and anything pointing to a missing record is refused.
 */
export function addAttachments(
  data: NetworkData,
  drafts: readonly AttachmentDraft[],
  ctx: CommandContext = {},
): CommandResult<Attachment[]> {
  if (drafts.length === 0) return fail('Nothing ticked', 'Tick at least one pole first.', 'warning');
  const existing = attachmentsOf(data);
  const created: Attachment[] = [];
  let skipped = 0;
  for (const draft of drafts) {
    if (!data.cables.some((c) => c.id === draft.cableId)) return fail('Cable missing', `Cable ${draft.cableId} was not found.`);
    if ((draft.structureId === undefined) === (draft.spanId === undefined)) {
      return fail('Choose one', 'A cable is recorded on one pole or one span at a time.');
    }
    if (draft.structureId && !data.equipment.some((e) => e.id === draft.structureId)) {
      return fail('Pole missing', `${draft.structureId} was not found.`);
    }
    if (draft.spanId && !spansOf(data).some((s) => s.id === draft.spanId)) {
      return fail('Span missing', `Span ${draft.spanId} was not found.`);
    }
    if ([...existing, ...created].some((a) => sameHost(a, draft))) {
      skipped += 1;
      continue;
    }
    created.push({
      id: newOspId('ATT'),
      cableId: draft.cableId,
      ...(draft.structureId ? { structureId: draft.structureId } : {}),
      ...(draft.spanId ? { spanId: draft.spanId } : {}),
      status: draft.status,
      basis: draft.basis,
      ...(trimmed(draft.notes) ? { notes: trimmed(draft.notes) } : {}),
      ...stamp(ctx),
    });
  }
  if (created.length === 0) return fail('Already recorded', 'These are already recorded on this cable.', 'info');
  return succeed(
    created,
    { attachments: [...existing, ...created] },
    {
      notice: notice(
        'success',
        'Saved',
        `${created.length} record(s) of where the cable is carried${skipped ? `; ${skipped} already recorded` : ''}.`,
      ),
      audit: created.map((a) => ({
        action: 'ATTACHMENT_CREATED',
        details: `Cable ${a.cableId} on ${a.structureId ?? `span ${a.spanId}`}, ${a.status}, basis ${a.basis}`,
        assetId: a.id,
        assetType: 'Attachment' as const,
      })),
    },
  );
}

export function deleteAttachment(data: NetworkData, id: string): CommandResult<Attachment> {
  const attachment = attachmentsOf(data).find((a) => a.id === id);
  if (!attachment) return fail('Not found', `Record ${id} was not found.`);
  return succeed(
    attachment,
    { attachments: attachmentsOf(data).filter((a) => a.id !== id) },
    {
      notice: notice('info', 'Removed', 'The cable is no longer recorded there.'),
      audit: [
        {
          action: 'ATTACHMENT_DELETED',
          details: `Cable ${attachment.cableId} no longer recorded on ${attachment.structureId ?? `span ${attachment.spanId}`}`,
          assetId: id,
          assetType: 'Attachment',
        },
      ],
    },
  );
}

export interface PoleSuggestion {
  pole: Equipment;
  distanceMeters: number;
  alongMeters: number;
}

/**
 * Poles near a cable's drawn line that are not yet recorded as carrying it, in order along the line.
 * These are suggestions only: being near a line never means a cable is on a pole.
 */
export function suggestPolesForCable(
  data: NetworkData,
  cableId: string,
  settings: Pick<OspSettings, 'attachmentCorridorMeters'> = DEFAULT_OSP_SETTINGS,
): PoleSuggestion[] {
  const cable = data.cables.find((c) => c.id === cableId);
  if (!cable || cable.coordinates.length < 2) return [];
  const recorded = new Set(polesSupportingCable(data, cableId).map((p) => p.structure.id));
  const suggestions: PoleSuggestion[] = [];
  for (const pole of data.equipment) {
    if (!isPoleType(pole.type) || !hasPlacedPosition(pole) || recorded.has(pole.id)) continue;
    const near = pointToLine([pole.lat, pole.lng], cable.coordinates);
    if (near && near.distanceMeters <= settings.attachmentCorridorMeters) suggestions.push({ pole, ...near });
  }
  return suggestions.sort((a, b) => a.alongMeters - b.alongMeters);
}

/* ------------------------------------------------------------------ */
/* Engineer questions                                                  */
/* ------------------------------------------------------------------ */

export interface SupportingStructure {
  structure: Equipment;
  /** Recorded directly on the pole, or as the end of a span the cable is recorded on. */
  via: 'pole' | 'span';
  attachment: Attachment;
  span?: Span;
  /** Position along the cable's drawn line, when it has one. */
  alongMeters?: number;
}

/** "Which poles support this route?" From attachment records only, in order along the line. */
export function polesSupportingCable(data: NetworkData, cableId: string): SupportingStructure[] {
  const cable = data.cables.find((c) => c.id === cableId);
  const byId = new Map(data.equipment.map((e) => [e.id, e]));
  const spanById = new Map(spansOf(data).map((s) => [s.id, s]));
  const found = new Map<string, SupportingStructure>();
  for (const attachment of attachmentsOf(data)) {
    if (attachment.cableId !== cableId) continue;
    if (attachment.structureId) {
      const structure = byId.get(attachment.structureId);
      if (structure) found.set(structure.id, { structure, via: 'pole', attachment });
      continue;
    }
    const span = attachment.spanId ? spanById.get(attachment.spanId) : undefined;
    if (!span) continue;
    for (const end of [span.fromStructureId, span.toStructureId]) {
      const structure = byId.get(end);
      if (structure && !found.has(end)) found.set(end, { structure, via: 'span', attachment, span });
    }
  }
  const list = [...found.values()];
  if (cable && cable.coordinates.length >= 2) {
    for (const item of list) item.alongMeters = pointToLine([item.structure.lat, item.structure.lng], cable.coordinates)?.alongMeters;
    list.sort((a, b) => (a.alongMeters ?? 0) - (b.alongMeters ?? 0));
  } else {
    list.sort((a, b) => a.structure.name.localeCompare(b.structure.name));
  }
  return list;
}

export interface CableOnStructure {
  cable: Cable;
  via: 'pole' | 'span';
  attachment: Attachment;
  span?: Span;
}

/** "Which cables are on this pole?" Recorded on the pole itself or on a span that ends at it. */
export function cablesOnStructure(data: NetworkData, structureId: string): CableOnStructure[] {
  const cableById = new Map(data.cables.map((c) => [c.id, c]));
  const spans = new Map(spansAt(data, structureId).map((s) => [s.id, s]));
  const found = new Map<string, CableOnStructure>();
  for (const attachment of attachmentsOf(data)) {
    const cable = cableById.get(attachment.cableId);
    if (!cable) continue;
    if (attachment.structureId === structureId) {
      found.set(cable.id, { cable, via: 'pole', attachment });
    } else if (attachment.spanId && spans.has(attachment.spanId) && !found.has(cable.id)) {
      found.set(cable.id, { cable, via: 'span', attachment, span: spans.get(attachment.spanId) });
    }
  }
  return [...found.values()].sort((a, b) => a.cable.name.localeCompare(b.cable.name));
}

export const spansAt = (data: NetworkData, structureId: string): Span[] =>
  spansOf(data).filter((s) => s.fromStructureId === structureId || s.toStructureId === structureId);

/** Cables recorded on one span. */
export function cablesOnSpan(data: NetworkData, spanId: string): { cable: Cable; attachment: Attachment }[] {
  const cableById = new Map(data.cables.map((c) => [c.id, c]));
  return attachmentsOf(data)
    .filter((a) => a.spanId === spanId)
    .flatMap((attachment) => {
      const cable = cableById.get(attachment.cableId);
      return cable ? [{ cable, attachment }] : [];
    });
}

/* ------------------------------------------------------------------ */
/* Ducts                                                               */
/* ------------------------------------------------------------------ */

/** Every cable id recorded in a duct, in the duct itself or in a sub-duct. */
export const ductCableIds = (duct: Pick<Duct, 'cableIds' | 'subducts'>): string[] => [
  ...duct.cableIds,
  ...duct.subducts.flatMap((s) => s.cableIds),
];

export function ductsForCable(data: NetworkData, cableId: string): { duct: Duct; subduct?: Subduct }[] {
  return ductsOf(data).flatMap((duct) => {
    if (duct.cableIds.includes(cableId)) return [{ duct }];
    const subduct = duct.subducts.find((s) => s.cableIds.includes(cableId));
    return subduct ? [{ duct, subduct }] : [];
  });
}

export const ductsAt = (data: NetworkData, structureId: string): Duct[] =>
  ductsOf(data).filter((d) => d.fromStructureId === structureId || d.toStructureId === structureId);

/** Problems with a duct's own references, or null when it is sound. */
function ductProblem(data: NetworkData, duct: Duct): string | null {
  if (duct.coordinates.length < 2 || !duct.coordinates.every(isLatLngPair)) return 'A duct needs at least two points on the map.';
  for (const end of [duct.fromStructureId, duct.toStructureId]) {
    if (end && !data.equipment.some((e) => e.id === end)) return `End ${end} does not exist.`;
  }
  const ids = ductCableIds(duct);
  for (const cableId of ids) {
    if (!data.cables.some((c) => c.id === cableId)) return `Cable ${cableId} does not exist.`;
  }
  const repeated = ids.find((cableId, i) => ids.indexOf(cableId) !== i);
  if (repeated) return `Cable ${repeated} is listed twice in this duct. One cable can only be in one place.`;
  const labels = duct.subducts.map((s) => s.label.trim().toLowerCase());
  if (new Set(labels).size !== labels.length) return 'Two sub-ducts have the same label.';
  return null;
}

export interface DuctDraft {
  name: string;
  coordinates: LatLng[];
  fromStructureId?: string;
  toStructureId?: string;
  status: StructureStatus;
  basis: LinkBasis;
  wayCount?: number;
  diameterMm?: number;
  material?: string;
  subductLabels?: string[];
  notes?: string;
}

export function createDuct(data: NetworkData, draft: DuctDraft, ctx: CommandContext = {}): CommandResult<Duct> {
  const name = draft.name.trim();
  if (!name) return fail('Name needed', 'Give the duct a name people will recognise.', 'warning');
  const duct: Duct = {
    id: newOspId('DCT'),
    name,
    coordinates: draft.coordinates,
    ...(draft.fromStructureId ? { fromStructureId: draft.fromStructureId } : {}),
    ...(draft.toStructureId ? { toStructureId: draft.toStructureId } : {}),
    status: draft.status,
    basis: draft.basis,
    ...(draft.wayCount ? { wayCount: draft.wayCount } : {}),
    ...(draft.diameterMm ? { diameterMm: draft.diameterMm } : {}),
    ...(trimmed(draft.material) ? { material: trimmed(draft.material) } : {}),
    cableIds: [],
    subducts: (draft.subductLabels ?? []).filter((l) => l.trim()).map((label) => ({ id: newOspId('SUB'), label: label.trim(), cableIds: [] })),
    ...(trimmed(draft.notes) ? { notes: trimmed(draft.notes) } : {}),
    ...stamp(ctx),
  };
  const problem = ductProblem(data, duct);
  if (problem) return fail('Duct not added', problem);
  return succeed(
    duct,
    { ducts: [...ductsOf(data), duct] },
    {
      notice: notice('success', 'Duct added', `${duct.name}, ${Math.round(polylineLengthMeters(duct.coordinates))} m on the map.`),
      audit: [{ action: 'DUCT_CREATED', details: `Duct ${duct.id} ${duct.name}, ${duct.status}`, assetId: duct.id, assetType: 'Duct' }],
    },
  );
}

/** Saves a duct's details and occupancy. Refuses a missing cable or one cable listed twice. */
export function updateDuct(data: NetworkData, duct: Duct): CommandResult<Duct> {
  if (!ductsOf(data).some((d) => d.id === duct.id)) return fail('Duct missing', `Duct ${duct.id} was not found.`);
  const problem = ductProblem(data, duct);
  if (problem) return fail('Duct not saved', problem);
  return succeed(
    duct,
    { ducts: ductsOf(data).map((d) => (d.id === duct.id ? duct : d)) },
    {
      notice: notice('success', 'Duct saved', duct.name),
      audit: [
        {
          action: 'DUCT_UPDATED',
          details: `Duct ${duct.id}: ${ductCableIds(duct).length} cable(s), ${duct.subducts.length} sub-duct(s)`,
          assetId: duct.id,
          assetType: 'Duct',
        },
      ],
    },
  );
}

export function deleteDuct(data: NetworkData, id: string): CommandResult<Duct> {
  const duct = ductsOf(data).find((d) => d.id === id);
  if (!duct) return fail('Duct missing', `Duct ${id} was not found.`);
  const cables = ductCableIds(duct).length;
  return succeed(
    duct,
    { ducts: ductsOf(data).filter((d) => d.id !== id) },
    {
      confirm: `Delete duct ${duct.name}?${cables ? ` It lists ${cables} cable(s); the cables stay, only this duct record goes.` : ''} You can undo this.`,
      notice: notice('info', 'Duct deleted', duct.name),
      audit: [{ action: 'DUCT_DELETED', details: `Deleted duct ${id} ${duct.name}`, assetId: id, assetType: 'Duct' }],
    },
  );
}

/* ------------------------------------------------------------------ */
/* Slack loops                                                         */
/* ------------------------------------------------------------------ */

const FEET_TO_METERS = 0.3048;

/** Length between two printed marks. Marks may count down, so the difference is taken either way. */
export const lengthFromMarks = (a: number, b: number, unit: LengthMarkUnit): number =>
  Math.abs(b - a) * (unit === 'ft' ? FEET_TO_METERS : 1);

export interface SlackLoopDraft {
  cableId: string;
  structureId?: string;
  /** Used only when no structure is given. */
  position?: LatLng;
  lengthMeters?: number;
  marks?: { before: number; after: number; unit: LengthMarkUnit };
  notes?: string;
}

export function createSlackLoop(data: NetworkData, draft: SlackLoopDraft, ctx: CommandContext = {}): CommandResult<SlackLoop> {
  const cable = data.cables.find((c) => c.id === draft.cableId);
  if (!cable) return fail('Cable missing', `Cable ${draft.cableId} was not found.`);
  const host = draft.structureId ? data.equipment.find((e) => e.id === draft.structureId) : undefined;
  if (draft.structureId && !host) return fail('Place missing', `${draft.structureId} was not found.`);
  const position: LatLng | undefined = host ? [host.lat, host.lng] : draft.position;
  if (!position || !isValidCoordinate(position[0], position[1])) {
    return fail('Where is it?', 'Choose the pole, chamber or box where the loop is.', 'warning');
  }
  const fromMarks = draft.marks ? lengthFromMarks(draft.marks.before, draft.marks.after, draft.marks.unit) : undefined;
  const length = fromMarks ?? draft.lengthMeters;
  if (length === undefined || !Number.isFinite(length) || length <= 0) {
    return fail('Length needed', 'Enter the loop length, or the cable marks before and after it.', 'warning');
  }
  const rounded = Math.round(length * 10) / 10;
  const loop: SlackLoop = {
    id: newOspId('SLK'),
    name: `Slack ${rounded} m on ${cable.name}${host ? ` at ${host.name}` : ''}`,
    cableId: cable.id,
    ...(host ? { structureId: host.id } : {}),
    lat: position[0],
    lng: position[1],
    lengthMeters: rounded,
    lengthSource: draft.marks ? 'marks' : 'entered',
    ...(draft.marks ? { markBefore: draft.marks.before, markAfter: draft.marks.after, markUnit: draft.marks.unit } : {}),
    ...(trimmed(draft.notes) ? { notes: trimmed(draft.notes) } : {}),
    ...stamp(ctx),
  };
  return succeed(
    loop,
    { slackLoops: [...slackLoopsOf(data), loop] },
    {
      notice: notice('success', 'Slack loop added', loop.name),
      audit: [{ action: 'SLACK_LOOP_CREATED', details: `${loop.name} (${loop.lengthSource})`, assetId: loop.id, assetType: 'SlackLoop' }],
    },
  );
}

export function deleteSlackLoop(data: NetworkData, id: string): CommandResult<SlackLoop> {
  const loop = slackLoopsOf(data).find((l) => l.id === id);
  if (!loop) return fail('Not found', `Slack loop ${id} was not found.`);
  return succeed(
    loop,
    { slackLoops: slackLoopsOf(data).filter((l) => l.id !== id) },
    {
      confirm: `Delete ${loop.name}? You can undo this.`,
      notice: notice('info', 'Slack loop deleted', loop.name),
      audit: [{ action: 'SLACK_LOOP_DELETED', details: `Deleted ${loop.name}`, assetId: id, assetType: 'SlackLoop' }],
    },
  );
}

/* ------------------------------------------------------------------ */
/* Permissions                                                         */
/* ------------------------------------------------------------------ */

export interface PermissionDraft {
  id?: string;
  authority: string;
  kind?: PermissionKind;
  permitNumber?: string;
  structureIds: string[];
  cableIds?: string[];
  issuedOn?: string;
  validFrom?: string;
  validUntil?: string;
  rentAmount?: number;
  rentTerms?: string;
  notes?: string;
}

function permissionProblem(data: NetworkData, p: PermissionDraft): string | null {
  if (!p.authority.trim()) return 'Write who gave the permission, such as BESCOM.';
  for (const id of p.structureIds) if (!data.equipment.some((e) => e.id === id)) return `${id} does not exist.`;
  for (const id of p.cableIds ?? []) if (!data.cables.some((c) => c.id === id)) return `Cable ${id} does not exist.`;
  if (p.rentAmount !== undefined && !(Number.isFinite(p.rentAmount) && p.rentAmount >= 0)) return 'Rent must be 0 or more.';
  if (p.validFrom && p.validUntil && p.validUntil < p.validFrom) return 'The end date is before the start date.';
  return null;
}

const permissionRecord = (draft: PermissionDraft, base: Pick<Permission, 'id' | 'createdAt' | 'createdBy'>): Permission => ({
  ...base,
  authority: draft.authority.trim(),
  ...(draft.kind ? { kind: draft.kind } : {}),
  ...(trimmed(draft.permitNumber) ? { permitNumber: trimmed(draft.permitNumber) } : {}),
  structureIds: [...new Set(draft.structureIds)],
  ...(draft.cableIds?.length ? { cableIds: [...new Set(draft.cableIds)] } : {}),
  ...(trimmed(draft.issuedOn) ? { issuedOn: trimmed(draft.issuedOn) } : {}),
  ...(trimmed(draft.validFrom) ? { validFrom: trimmed(draft.validFrom) } : {}),
  ...(trimmed(draft.validUntil) ? { validUntil: trimmed(draft.validUntil) } : {}),
  ...(draft.rentAmount !== undefined ? { rentAmount: draft.rentAmount } : {}),
  ...(trimmed(draft.rentTerms) ? { rentTerms: trimmed(draft.rentTerms) } : {}),
  ...(trimmed(draft.notes) ? { notes: trimmed(draft.notes) } : {}),
});

export function savePermission(data: NetworkData, draft: PermissionDraft, ctx: CommandContext = {}): CommandResult<Permission> {
  const problem = permissionProblem(data, draft);
  if (problem) return fail('Permission not saved', problem, 'warning');
  const current = draft.id ? permissionsOf(data).find((p) => p.id === draft.id) : undefined;
  if (draft.id && !current) return fail('Permission missing', `Permission ${draft.id} was not found.`);
  const record = permissionRecord(
    draft,
    current ? { id: current.id, createdAt: current.createdAt, createdBy: current.createdBy } : { id: newOspId('PRM'), ...stamp(ctx) },
  );
  const list = current ? permissionsOf(data).map((p) => (p.id === record.id ? record : p)) : [...permissionsOf(data), record];
  return succeed(
    record,
    { permissions: list },
    {
      notice: notice('success', 'Permission saved', `${record.authority}${record.permitNumber ? `, ${record.permitNumber}` : ''}`),
      audit: [
        {
          action: current ? 'PERMISSION_UPDATED' : 'PERMISSION_CREATED',
          details: `${record.authority} ${record.permitNumber ?? '(no number)'} for ${record.structureIds.length} structure(s)`,
          assetId: record.id,
          assetType: 'Permission',
        },
      ],
    },
  );
}

export function deletePermission(data: NetworkData, id: string): CommandResult<Permission> {
  const permission = permissionsOf(data).find((p) => p.id === id);
  if (!permission) return fail('Not found', `Permission ${id} was not found.`);
  return succeed(
    permission,
    { permissions: permissionsOf(data).filter((p) => p.id !== id) },
    {
      confirm: `Delete the ${permission.authority} permission${permission.permitNumber ? ` ${permission.permitNumber}` : ''}? You can undo this.`,
      notice: notice('info', 'Permission deleted', permission.authority),
      audit: [{ action: 'PERMISSION_DELETED', details: `Deleted permission ${id}`, assetId: id, assetType: 'Permission' }],
    },
  );
}

export const permissionsFor = (data: NetworkData, structureId: string): Permission[] =>
  permissionsOf(data).filter((p) => p.structureIds.includes(structureId));

/* ------------------------------------------------------------------ */
/* Lengths                                                             */
/* ------------------------------------------------------------------ */

export type LengthFlagCode = 'optical_short' | 'optical_long' | 'drawn_vs_sheath';

export interface CableLengths {
  /** Worked out from the drawn line, geodesically. Undefined when fewer than two points. */
  drawnMeters?: number;
  /** From the printed marks a person entered at both ends. */
  sheathMeters?: number;
  /** As an OTDR reported it. */
  opticalMeters?: number;
  slackMeters: number;
  slackCount: number;
  flags: { code: LengthFlagCode; message: string }[];
}

const pct = (ratio: number) => `${Math.round(Math.abs(ratio) * 1000) / 10}%`;

/** The three lengths side by side, never merged, with plain notes where they disagree beyond the settings. */
export function cableLengths(
  cable: Cable,
  slackLoops: readonly SlackLoop[] = [],
  settings: OspSettings = DEFAULT_OSP_SETTINGS,
): CableLengths {
  const drawnMeters = cable.coordinates.length >= 2 ? polylineLengthMeters(cable.coordinates) : undefined;
  const sheathMeters =
    cable.sheathMarkStart !== undefined && cable.sheathMarkEnd !== undefined
      ? lengthFromMarks(cable.sheathMarkStart, cable.sheathMarkEnd, cable.sheathMarkUnit ?? 'm')
      : undefined;
  const opticalMeters = cable.opticalLengthMeters;
  const loops = slackLoops.filter((l) => l.cableId === cable.id);
  const slackMeters = loops.reduce((sum, l) => sum + l.lengthMeters, 0);
  const flags: CableLengths['flags'] = [];

  if (sheathMeters !== undefined && sheathMeters > 0 && opticalMeters !== undefined) {
    const ratio = (opticalMeters - sheathMeters) / sheathMeters;
    if (ratio < -settings.opticalShortRatio) {
      flags.push({
        code: 'optical_short',
        message: `Optical length is ${pct(ratio)} shorter than the sheath length. Fiber is normally a little longer than its sheath, so check for a wrong core, a wrong cable or an unrecorded break.`,
      });
    } else if (ratio > settings.opticalLongRatio) {
      flags.push({
        code: 'optical_long',
        message: `Optical length is ${pct(ratio)} longer than the sheath length. This often means slack or a detour that is not recorded.`,
      });
    }
  }
  if (sheathMeters !== undefined && drawnMeters !== undefined && drawnMeters > 0) {
    const expected = drawnMeters + slackMeters;
    const ratio = (sheathMeters - expected) / expected;
    if (Math.abs(ratio) > settings.drawnVsSheathRatio) {
      flags.push({
        code: 'drawn_vs_sheath',
        message: `Sheath length differs by ${pct(ratio)} from the drawn line${slackMeters ? ' plus recorded slack' : ''}. Slack, vertical runs and corners explain some of this; check the marks and the route.`,
      });
    }
  }
  return {
    ...(drawnMeters !== undefined ? { drawnMeters } : {}),
    ...(sheathMeters !== undefined ? { sheathMeters } : {}),
    ...(opticalMeters !== undefined ? { opticalMeters } : {}),
    slackMeters,
    slackCount: loops.length,
    flags,
  };
}

/* ------------------------------------------------------------------ */
/* Cascades when equipment or cables are removed                       */
/* ------------------------------------------------------------------ */

export interface OspCascade {
  patch: NetworkPatch;
  /** Plain words for the confirmation, or empty when nothing else changes. */
  summary: string;
  audit: string;
}

/** What else changes when a structure goes: its spans and their cable records go, other records forget it. */
export function ospCascadeForEquipment(data: NetworkData, id: string): OspCascade {
  const spans = spansOf(data).filter((s) => s.fromStructureId === id || s.toStructureId === id);
  const spanIds = new Set(spans.map((s) => s.id));
  const attachments = attachmentsOf(data).filter((a) => a.structureId === id || (a.spanId && spanIds.has(a.spanId)));
  const ducts = ductsOf(data).filter((d) => d.fromStructureId === id || d.toStructureId === id);
  const loops = slackLoopsOf(data).filter((l) => l.structureId === id);
  const permissions = permissionsOf(data).filter((p) => p.structureIds.includes(id));
  const patch: NetworkPatch = {};
  if (spans.length) patch.spans = spansOf(data).filter((s) => !spanIds.has(s.id));
  if (attachments.length) patch.attachments = attachmentsOf(data).filter((a) => !attachments.includes(a));
  if (ducts.length) {
    patch.ducts = ductsOf(data).map((d) => {
      if (!ducts.includes(d)) return d;
      const next = { ...d };
      if (next.fromStructureId === id) delete next.fromStructureId;
      if (next.toStructureId === id) delete next.toStructureId;
      return next;
    });
  }
  if (loops.length) {
    patch.slackLoops = slackLoopsOf(data).map((l) => {
      if (l.structureId !== id) return l;
      const next = { ...l };
      delete next.structureId;
      return next;
    });
  }
  if (permissions.length) {
    patch.permissions = permissionsOf(data).map((p) =>
      p.structureIds.includes(id) ? { ...p, structureIds: p.structureIds.filter((s) => s !== id) } : p,
    );
  }
  const parts = [
    spans.length ? `${spans.length} span(s)` : '',
    attachments.length ? `${attachments.length} record(s) of cables carried there` : '',
  ].filter(Boolean);
  const kept = [
    ducts.length ? `${ducts.length} duct(s)` : '',
    loops.length ? `${loops.length} slack loop(s)` : '',
    permissions.length ? `${permissions.length} permission(s)` : '',
  ].filter(Boolean);
  const summary = [
    parts.length ? `${parts.join(' and ')} will also be removed.` : '',
    kept.length ? `${kept.join(', ')} will keep their records but no longer name it.` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return { patch, summary, audit: [...parts, ...kept].join(', ') };
}

/** What else changes when a cable goes: its attachments and slack loops go, ducts and permissions forget it. */
export function ospCascadeForCable(data: NetworkData, id: string): OspCascade {
  const attachments = attachmentsOf(data).filter((a) => a.cableId === id);
  const loops = slackLoopsOf(data).filter((l) => l.cableId === id);
  const ducts = ductsOf(data).filter((d) => ductCableIds(d).includes(id));
  const permissions = permissionsOf(data).filter((p) => p.cableIds?.includes(id));
  const patch: NetworkPatch = {};
  if (attachments.length) patch.attachments = attachmentsOf(data).filter((a) => a.cableId !== id);
  if (loops.length) patch.slackLoops = slackLoopsOf(data).filter((l) => l.cableId !== id);
  if (ducts.length) {
    patch.ducts = ductsOf(data).map((d) =>
      ducts.includes(d)
        ? {
            ...d,
            cableIds: d.cableIds.filter((c) => c !== id),
            subducts: d.subducts.map((s) => ({ ...s, cableIds: s.cableIds.filter((c) => c !== id) })),
          }
        : d,
    );
  }
  if (permissions.length) {
    patch.permissions = permissionsOf(data).map((p) =>
      p.cableIds?.includes(id) ? { ...p, cableIds: p.cableIds.filter((c) => c !== id) } : p,
    );
  }
  const removed = [
    attachments.length ? `${attachments.length} record(s) of poles carrying it` : '',
    loops.length ? `${loops.length} slack loop(s)` : '',
  ].filter(Boolean);
  const kept = [ducts.length ? `${ducts.length} duct(s)` : '', permissions.length ? `${permissions.length} permission(s)` : ''].filter(Boolean);
  const summary = [
    removed.length ? `${removed.join(' and ')} will also be removed.` : '',
    kept.length ? `${kept.join(' and ')} will no longer list it.` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return { patch, summary, audit: [...removed, ...kept].join(', ') };
}

/* ------------------------------------------------------------------ */
/* Link checks: the same rules on the phone, in the office and on the server */
/* ------------------------------------------------------------------ */

export type LinkCheckData = Pick<NetworkSnapshot, 'equipment' | 'cables'> & Partial<Pick<NetworkSnapshot, OspCollection>>;

export interface LinkProblem {
  collection: OspCollection;
  id: string;
  /** The id that should exist and does not. */
  missingId?: string;
  message: string;
}

/** Every outside-plant record that points to something missing, or is impossible on its own. */
export function findBrokenLinks(data: LinkCheckData): LinkProblem[] {
  const equipment = new Set(data.equipment.map((e) => e.id));
  const cables = new Set(data.cables.map((c) => c.id));
  const spans = new Set((data.spans ?? []).map((s) => s.id));
  const problems: LinkProblem[] = [];
  const missing = (collection: OspCollection, id: string, missingId: string, what: string) =>
    problems.push({ collection, id, missingId, message: `${what} "${missingId}" does not exist.` });

  for (const span of data.spans ?? []) {
    if (!equipment.has(span.fromStructureId)) missing('spans', span.id, span.fromStructureId, `Span ${span.id}: its end`);
    if (!equipment.has(span.toStructureId)) missing('spans', span.id, span.toStructureId, `Span ${span.id}: its end`);
    if (span.fromStructureId === span.toStructureId) {
      problems.push({ collection: 'spans', id: span.id, message: `Span ${span.id} starts and ends at the same place.` });
    }
  }
  for (const a of data.attachments ?? []) {
    if (!cables.has(a.cableId)) missing('attachments', a.id, a.cableId, `Attachment ${a.id}: its cable`);
    if (a.structureId && !equipment.has(a.structureId)) missing('attachments', a.id, a.structureId, `Attachment ${a.id}: its pole`);
    if (a.spanId && !spans.has(a.spanId)) missing('attachments', a.id, a.spanId, `Attachment ${a.id}: its span`);
  }
  for (const duct of data.ducts ?? []) {
    for (const end of [duct.fromStructureId, duct.toStructureId]) {
      if (end && !equipment.has(end)) missing('ducts', duct.id, end, `Duct ${duct.id}: its end`);
    }
    const ids = ductCableIds(duct);
    for (const cableId of ids) if (!cables.has(cableId)) missing('ducts', duct.id, cableId, `Duct ${duct.id}: cable`);
    const repeated = ids.find((cableId, i) => ids.indexOf(cableId) !== i);
    if (repeated) {
      problems.push({ collection: 'ducts', id: duct.id, message: `Duct ${duct.id} lists cable ${repeated} twice.` });
    }
  }
  for (const loop of data.slackLoops ?? []) {
    if (!cables.has(loop.cableId)) missing('slackLoops', loop.id, loop.cableId, `Slack loop ${loop.id}: its cable`);
    if (loop.structureId && !equipment.has(loop.structureId)) missing('slackLoops', loop.id, loop.structureId, `Slack loop ${loop.id}: its place`);
  }
  for (const p of data.permissions ?? []) {
    for (const id of p.structureIds) if (!equipment.has(id)) missing('permissions', p.id, id, `Permission ${p.id}: structure`);
    for (const id of p.cableIds ?? []) if (!cables.has(id)) missing('permissions', p.id, id, `Permission ${p.id}: cable`);
  }
  return problems;
}

const LINKED_COLLECTIONS = ['equipment', 'cables', 'spans', 'attachments', 'ducts', 'slackLoops', 'permissions'] as const;
type LinkedCollection = (typeof LINKED_COLLECTIONS)[number];

/** Whether a change set could break an outside-plant link, so the server needs to look. */
export function changeSetTouchesLinks(changes: ChangeSet): boolean {
  const osp = ['spans', 'attachments', 'ducts', 'slackLoops', 'permissions'] as const;
  const writesOsp = osp.some((name) => (changes.upserts?.[name]?.length ?? 0) > 0 || (changes.deletes?.[name]?.length ?? 0) > 0);
  const deletesParents = (changes.deletes?.equipment?.length ?? 0) > 0 || (changes.deletes?.cables?.length ?? 0) > 0;
  return writesOsp || deletesParents;
}

/**
 * Problems a change set would leave behind: an upserted record pointing to something missing, or a
 * delete that leaves another record pointing to nothing. `current` is the stored state before it.
 */
export function checkChangeSetLinks(current: LinkCheckData, changes: ChangeSet): LinkProblem[] {
  const after: Record<string, { id: string }[]> = {};
  const deleted = new Set<string>();
  for (const name of LINKED_COLLECTIONS) {
    const upserts = (changes.upserts?.[name as LinkedCollection] ?? []) as { id: string }[];
    const deletes = new Set(changes.deletes?.[name] ?? []);
    for (const id of deletes) deleted.add(id);
    const byId = new Map(((current[name] ?? []) as { id: string }[]).map((r) => [r.id, r]));
    for (const id of deletes) byId.delete(id);
    for (const record of upserts) byId.set(record.id, record);
    after[name] = [...byId.values()];
  }
  const upserted = new Set(
    (['spans', 'attachments', 'ducts', 'slackLoops', 'permissions'] as const).flatMap((name) =>
      ((changes.upserts?.[name] ?? []) as { id: string }[]).map((r) => `${name}/${r.id}`),
    ),
  );
  return findBrokenLinks(after as unknown as LinkCheckData).filter(
    (p) => upserted.has(`${p.collection}/${p.id}`) || (p.missingId !== undefined && deleted.has(p.missingId)),
  );
}

/** One plain sentence for a refusal. */
export function describeLinkProblems(problems: readonly LinkProblem[]): string {
  const [first] = problems;
  if (!first) return '';
  const more = problems.length > 1 ? ` (and ${problems.length - 1} more)` : '';
  return `${first.message}${more} Nothing was saved. Add the missing item first, or remove the link.`;
}

/** Audit entry helper for cascades, so a removal names what went with it. */
export const cascadeAudit = (base: AuditEntry, cascade: OspCascade): AuditEntry =>
  cascade.audit ? { ...base, details: `${base.details}; also ${cascade.audit}` } : base;
