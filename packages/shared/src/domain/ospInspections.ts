import { INSPECTION_TARGET_LABELS, type InspectionTarget, OSP_CONDITION_LABELS, type OspCondition } from '../model/enums';
import type { Equipment, Inspection } from '../model/types';
import { type CommandContext, type CommandResult, fail, type NetworkData, notice, succeed } from './command';
import { assetGroupOf, PHOTO_ID_PATTERN } from './fieldCapture';
import { checklistAnswersProblem } from './inspectionChecklist';
import { isPoleType, newOspId } from './outsidePlant';

/**
 * Phase 4: inspections of poles, chambers, spans and ducts. Each one is what a person saw on one
 * day, kept as history: a new inspection never changes an older one or the record it is about.
 * Technicians may add them from the field; nothing in an inspection is filled in for them.
 */

const inspectionsOf = (data: Partial<Pick<NetworkData, 'inspections'>>) => data.inspections ?? [];

/** Chambers: manholes, handholes and underground chambers. */
const CHAMBER_TYPES = /Manhole|Handhole|Chamber/i;

/** What an inspection of this equipment is called: a pole, a chamber, a box (Phase 19), or none of them. */
export function inspectionTargetOf(equipment: Pick<Equipment, 'type'>): Extract<InspectionTarget, 'pole' | 'chamber' | 'box'> | undefined {
  if (isPoleType(equipment.type)) return 'pole';
  if (CHAMBER_TYPES.test(equipment.type)) return 'chamber';
  if (assetGroupOf(equipment.type) === 'box') return 'box';
  return undefined;
}

/** The name of what was inspected, or undefined when it is not on record. */
export function inspectionTargetName(data: Pick<NetworkData, 'equipment' | 'spans' | 'ducts'>, targetType: InspectionTarget, targetId: string): string | undefined {
  if (targetType === 'span') return data.spans?.find((s) => s.id === targetId)?.name;
  if (targetType === 'duct') return data.ducts?.find((d) => d.id === targetId)?.name;
  return data.equipment.find((e) => e.id === targetId)?.name;
}

export interface InspectionDraft {
  targetType: InspectionTarget;
  targetId: string;
  /** YYYY-MM-DD, as the person chose it. */
  inspectedOn: string;
  inspectedBy: string;
  condition?: OspCondition;
  findings?: string;
  photoIds?: string[];
  /** Phase 19: the checklist items the person answered, with the words shown (`checklistAnswersFor`). */
  checklist?: Inspection['checklist'];
}

const localDay = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** Why this inspection cannot be saved, in plain words, or null. */
export function inspectionProblem(data: NetworkData, draft: InspectionDraft, now = new Date()): string | null {
  if (draft.targetType === 'span' ? !data.spans?.some((s) => s.id === draft.targetId) : draft.targetType === 'duct' ? !data.ducts?.some((d) => d.id === draft.targetId) : false) {
    return `The ${INSPECTION_TARGET_LABELS[draft.targetType].toLowerCase()} ${draft.targetId} is not on record.`;
  }
  if (draft.targetType === 'pole' || draft.targetType === 'chamber' || draft.targetType === 'box') {
    const item = data.equipment.find((e) => e.id === draft.targetId);
    if (!item) return `${draft.targetId} is not on the map.`;
    if (inspectionTargetOf(item) !== draft.targetType) {
      return `${item.name} is a ${item.type}, not a ${INSPECTION_TARGET_LABELS[draft.targetType].toLowerCase()}.`;
    }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.inspectedOn) || Number.isNaN(Date.parse(`${draft.inspectedOn}T00:00:00`))) {
    return 'Choose the day of the inspection.';
  }
  // A day after today cannot have been inspected yet. One day of grace for phones set to another time zone.
  const tomorrow = new Date(now.getTime() + 24 * 3600 * 1000);
  if (draft.inspectedOn > localDay(tomorrow)) return 'The inspection day is in the future. Choose the day it was done.';
  if (!draft.inspectedBy.trim()) return 'Write who did the inspection.';
  if (!draft.condition) return 'Choose how it looked: good, fair or poor.';
  const bad = (draft.photoIds ?? []).find((id) => !PHOTO_ID_PATTERN.test(id));
  if (bad) return `The photo "${bad}" is not a saved photo.`;
  if ((draft.photoIds?.length ?? 0) > 20) return 'Keep it to 20 photos or fewer.';
  return checklistAnswersProblem(draft.checklist);
}

/** Saves one inspection as the person recorded it. */
export function createInspection(data: NetworkData, draft: InspectionDraft, ctx: CommandContext = {}): CommandResult<Inspection> {
  const now = ctx.now ?? new Date();
  const problem = inspectionProblem(data, draft, now);
  if (problem) return fail('Inspection not saved', problem, 'warning');
  const findings = draft.findings?.trim();
  const inspection: Inspection = {
    id: newOspId('INS'),
    targetType: draft.targetType,
    targetId: draft.targetId,
    inspectedOn: draft.inspectedOn,
    inspectedBy: draft.inspectedBy.trim(),
    condition: draft.condition!,
    ...(findings ? { findings } : {}),
    ...(draft.photoIds?.length ? { photoIds: [...new Set(draft.photoIds)] } : {}),
    ...(draft.checklist?.length ? { checklist: draft.checklist.map((c) => ({ itemId: c.itemId, label: c.label, answer: c.answer })) } : {}),
    createdAt: now.toISOString(),
    ...(ctx.actor ? { createdBy: ctx.actor } : {}),
  };
  const name = inspectionTargetName(data, draft.targetType, draft.targetId) ?? draft.targetId;
  return succeed(
    inspection,
    { inspections: [...inspectionsOf(data), inspection] },
    {
      notice: notice('success', 'Inspection saved', `${name}: ${OSP_CONDITION_LABELS[inspection.condition]}, ${inspection.inspectedOn}.`),
      audit: [
        {
          action: 'INSPECTION_CREATED',
          details: `${INSPECTION_TARGET_LABELS[inspection.targetType]} ${inspection.targetId} inspected ${inspection.inspectedOn} by ${inspection.inspectedBy}: ${inspection.condition}${inspection.photoIds ? `, ${inspection.photoIds.length} photo(s)` : ''}${
            inspection.checklist ? `, checklist ${inspection.checklist.length} answered (${inspection.checklist.filter((c) => c.answer === 'problem').length} problem)` : ''
          }`,
          assetId: inspection.id,
          assetType: 'Inspection',
        },
      ],
    },
  );
}

/** Removes one inspection, for a mistake. The caller must confirm. */
export function deleteInspection(data: NetworkData, id: string): CommandResult<Inspection> {
  const inspection = inspectionsOf(data).find((i) => i.id === id);
  if (!inspection) return fail('Not found', `Inspection ${id} was not found.`);
  return succeed(
    inspection,
    { inspections: inspectionsOf(data).filter((i) => i.id !== id) },
    {
      confirm: `Delete the inspection of ${inspection.inspectedOn} by ${inspection.inspectedBy}? You can undo this.`,
      notice: notice('info', 'Inspection deleted', `${inspection.inspectedOn}, ${inspection.inspectedBy}`),
      audit: [{ action: 'INSPECTION_DELETED', details: `Deleted inspection ${id} of ${inspection.targetId}`, assetId: id, assetType: 'Inspection' }],
    },
  );
}

/** Inspections of one record, newest first (by inspection day, then when saved). */
export function inspectionsFor(data: Partial<Pick<NetworkData, 'inspections'>>, targetType: InspectionTarget, targetId: string): Inspection[] {
  const sameKind = (t: InspectionTarget) => (targetType === 'pole' || targetType === 'chamber' ? t === 'pole' || t === 'chamber' : t === targetType);
  return inspectionsOf(data)
    .filter((i) => i.targetId === targetId && sameKind(i.targetType))
    .sort((a, b) => b.inspectedOn.localeCompare(a.inspectedOn) || b.createdAt.localeCompare(a.createdAt));
}

export const latestInspection = (data: Partial<Pick<NetworkData, 'inspections'>>, targetType: InspectionTarget, targetId: string): Inspection | undefined =>
  inspectionsFor(data, targetType, targetId)[0];
