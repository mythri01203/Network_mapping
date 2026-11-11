import { z } from 'zod';

import { CHECKLIST_ANSWERS, type ChecklistAnswer, INSPECTION_TARGETS, type InspectionTarget } from '../model/enums';
import type { Inspection, Setting } from '../model/types';

/**
 * Phase 19: inspection checklists, one per kind of thing inspected (pole, chamber, span, duct, box).
 * The owner edits them under Administration, Lists and rules, the same way as the other editable
 * lists: a built-in item is never removed (it can be renamed or hidden), and the owner can add their
 * own. They are `settings` records (`checklist.<target>`), so they sync and are checked on the server.
 *
 * An answer is stored on the inspection with the words as shown at that moment. An item nobody
 * answered is not stored, so it reads "Not recorded" later; it is never filled in as OK.
 */

export const CHECKLIST_SETTING_PREFIX = 'checklist.';
export const checklistSettingId = (target: InspectionTarget) => `${CHECKLIST_SETTING_PREFIX}${target}`;

export interface ChecklistItemDef {
  id: string;
  label: string;
}

/**
 * Starting lists, proposed in Phase 19 from the outside-plant checks in fibergis-osp-mapping. They
 * are a starting point, not a standard: change them to your own inspection rules.
 */
export const BUILT_IN_CHECKLISTS: Record<InspectionTarget, readonly ChecklistItemDef[]> = {
  pole: [
    { id: 'pole.straight', label: 'Pole stands straight, not leaning' },
    { id: 'pole.base', label: 'Ground at the base is firm, not dug or washed away' },
    { id: 'pole.body', label: 'No cracks, rust or rot on the pole' },
    { id: 'pole.hardware', label: 'Clamps and hooks holding our cable are tight' },
    { id: 'pole.clearance', label: 'Our cable is clear of power wires and trees' },
    { id: 'pole.tag', label: 'Tag or pole number can be read' },
  ],
  chamber: [
    { id: 'chamber.cover', label: 'Cover is in place, not broken, and closes' },
    { id: 'chamber.water', label: 'No water or mud standing inside' },
    { id: 'chamber.ducts', label: 'Duct ends are sealed' },
    { id: 'chamber.cables', label: 'Cables are tied and labelled' },
    { id: 'chamber.slack', label: 'Spare cable is coiled, not loose' },
  ],
  span: [
    { id: 'span.sag', label: 'Cable sag looks normal' },
    { id: 'span.height', label: 'Cable is high enough over the road' },
    { id: 'span.damage', label: 'No cuts or damage on the cable' },
    { id: 'span.trees', label: 'No branches touching the cable' },
  ],
  duct: [
    { id: 'duct.ends', label: 'Duct ends are sealed' },
    { id: 'duct.route', label: 'No digging or damage along the duct route' },
    { id: 'duct.markers', label: 'Route markers are in place' },
  ],
  box: [
    { id: 'box.closed', label: 'Box is closed and locked' },
    { id: 'box.seal', label: 'Seal or rubber gasket is in good shape' },
    { id: 'box.water', label: 'No water or insects inside' },
    { id: 'box.mount', label: 'Box is firmly mounted' },
    { id: 'box.labels', label: 'Ports and drop wires are labelled' },
  ],
};

const ITEM_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$/;

const checklistOverlaySchema = z.strictObject({
  added: z.array(z.strictObject({ id: z.string().regex(ITEM_ID), label: z.string().trim().min(1).max(120) })).max(40).default([]),
  labels: z.record(z.string(), z.string().trim().min(1).max(120)).default({}),
  hidden: z.array(z.string()).max(60).default([]),
});
export type ChecklistOverlay = z.infer<typeof checklistOverlaySchema>;

export const emptyChecklistOverlay = (): ChecklistOverlay => ({ added: [], labels: {}, hidden: [] });

export interface ChecklistEntry extends ChecklistItemDef {
  builtIn: boolean;
  /** Not asked on new inspections. Older answers keep it. */
  hidden: boolean;
}

const parseJsonValue = (value: unknown): unknown => {
  if (typeof value !== 'string') return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
};

export function parseChecklistOverlay(value: unknown): { ok: true; overlay: ChecklistOverlay } | { ok: false; error: string } {
  const parsed = checklistOverlaySchema.safeParse(parseJsonValue(value));
  if (!parsed.success) return { ok: false, error: 'The checklist setting is not in the expected form (JSON with "added", "labels" and "hidden").' };
  return { ok: true, overlay: parsed.data };
}

export const isChecklistTarget = (value: string): value is InspectionTarget => (INSPECTION_TARGETS as readonly string[]).includes(value);

type SettingLike = Pick<Setting, 'id' | 'value'>;

/** Every item of one checklist, built-in first, as the owner set it (renamed, hidden or added). */
export function resolveChecklist(target: InspectionTarget, settings: readonly SettingLike[] = []): ChecklistEntry[] {
  const stored = settings.find((s) => s.id === checklistSettingId(target));
  const parsed = stored ? parseChecklistOverlay(stored.value) : null;
  const overlay = parsed?.ok ? parsed.overlay : emptyChecklistOverlay();
  const hidden = new Set(overlay.hidden);
  const builtIn = BUILT_IN_CHECKLISTS[target];
  const entries: ChecklistEntry[] = builtIn.map((item) => ({ id: item.id, label: overlay.labels[item.id] ?? item.label, builtIn: true, hidden: hidden.has(item.id) }));
  for (const added of overlay.added) {
    if (entries.some((e) => e.id === added.id)) continue;
    entries.push({ id: added.id, label: overlay.labels[added.id] ?? added.label, builtIn: false, hidden: hidden.has(added.id) });
  }
  return entries;
}

/** The items asked on a new inspection. */
export const activeChecklist = (target: InspectionTarget, settings: readonly SettingLike[] = []): ChecklistItemDef[] =>
  resolveChecklist(target, settings)
    .filter((e) => !e.hidden)
    .map(({ id, label }) => ({ id, label }));

/** Why a checklist setting cannot be saved, in plain words, or null. */
export function checklistSettingProblem(id: string, value: unknown): string | null {
  const target = id.slice(CHECKLIST_SETTING_PREFIX.length);
  if (!isChecklistTarget(target)) return `Checklists can be set for ${INSPECTION_TARGETS.join(', ')} only.`;
  const parsed = parseChecklistOverlay(value);
  if (!parsed.ok) return parsed.error;
  const builtIn = new Set(BUILT_IN_CHECKLISTS[target].map((i) => i.id));
  const seen = new Set<string>();
  for (const added of parsed.overlay.added) {
    if (builtIn.has(added.id) || seen.has(added.id)) return `The checklist item "${added.id}" is there twice.`;
    seen.add(added.id);
  }
  for (const key of Object.keys(parsed.overlay.labels)) {
    if (!builtIn.has(key) && !seen.has(key)) return `"${key}" is not an item of this checklist, so it cannot be renamed.`;
  }
  return null;
}

export type ChecklistAnswers = Partial<Record<string, ChecklistAnswer>>;

/** The answers to store, in the order shown, with the words shown. Unanswered items are left out. */
export function checklistAnswersFor(items: readonly ChecklistItemDef[], answers: ChecklistAnswers): NonNullable<Inspection['checklist']> {
  return items.flatMap((item) => {
    const answer = answers[item.id];
    return answer && (CHECKLIST_ANSWERS as readonly string[]).includes(answer) ? [{ itemId: item.id, label: item.label, answer }] : [];
  });
}

/** Why stored checklist answers are wrong, or null. */
export function checklistAnswersProblem(checklist: Inspection['checklist']): string | null {
  if (!checklist) return null;
  const seen = new Set<string>();
  for (const entry of checklist) {
    if (seen.has(entry.itemId)) return `The checklist item "${entry.label}" is answered twice.`;
    seen.add(entry.itemId);
    if (!(CHECKLIST_ANSWERS as readonly string[]).includes(entry.answer)) return `"${entry.label}" has no valid answer.`;
  }
  return null;
}

/** How many answers say "Problem", for a short line on the inspection list. */
export const checklistProblemCount = (checklist: Inspection['checklist']): number => (checklist ?? []).filter((c) => c.answer === 'problem').length;
