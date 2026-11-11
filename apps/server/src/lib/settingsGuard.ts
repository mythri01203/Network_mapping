import {
  type AttributeTarget,
  ATTRIBUTE_TARGETS,
  attributeDefinitions,
  attributeValuesProblem,
  type ChangeSet,
  isEditableListKey,
  LIST_SETTING_PREFIX,
  listChangeProblem,
  ruleSettingProblem,
  type Setting,
  usedListValues,
} from '@fibergis/shared';

import type { WriteGuard } from '../db/repository';
import { HttpError } from './errors';

/** A list, rule or custom field setting that cannot be saved. Sending it again unchanged fails again. */
const settingsRefused = (message: string) => new HttpError(409, 'settings_refused', `${message} Nothing was saved.`);

/**
 * Phase 23: editable lists, naming rules and custom fields (Administration, Lists and rules). A
 * list may not lose a value records use (it can be hidden instead), a fixed list takes no new values,
 * rules and field definitions must be in their form, and custom field values must fit their
 * definitions. Other settings are not judged here.
 */
export function settingsGuard(changes: ChangeSet): WriteGuard | undefined {
  const settingUpserts = changes.upserts?.settings ?? [];
  const settingDeletes = changes.deletes?.settings ?? [];
  // Phase 19: inspection checklists (`checklist.<target>`) are checked like the other lists.
  const ruled = (id: string) => id.startsWith(LIST_SETTING_PREFIX) || id.startsWith('naming.') || id.startsWith('attr.') || id.startsWith('checklist.');
  const touchesRules = settingUpserts.some((s) => ruled(s.id)) || settingDeletes.some(ruled);
  const attributeTargets = ATTRIBUTE_TARGETS.filter((target) => (changes.upserts?.[target] ?? []).some((r) => (r as { customAttributes?: unknown }).customAttributes !== undefined));
  if (!touchesRules && attributeTargets.length === 0) return undefined;

  return (read) => {
    const stored = read('settings');
    const storedById = new Map(stored.map((s) => [s.id, s]));
    for (const setting of settingUpserts) {
      if (setting.id.startsWith(LIST_SETTING_PREFIX)) {
        const key = setting.id.slice(LIST_SETTING_PREFIX.length);
        if (!isEditableListKey(key)) throw settingsRefused(`"${key}" is not a list that can be edited.`);
        const problem = listChangeProblem(key, storedById.get(setting.id)?.value, setting.value, usedListValues(key, { equipment: read('equipment') }));
        if (problem) throw settingsRefused(problem);
        continue;
      }
      const problem = ruleSettingProblem(setting.id, setting.value);
      if (problem) throw settingsRefused(problem);
    }
    for (const id of settingDeletes) {
      if (!id.startsWith(LIST_SETTING_PREFIX) || !storedById.has(id)) continue;
      const key = id.slice(LIST_SETTING_PREFIX.length);
      if (!isEditableListKey(key)) continue;
      // Removing the whole list setting removes every value added to it.
      const problem = listChangeProblem(key, storedById.get(id)?.value, '{}', usedListValues(key, { equipment: read('equipment') }));
      if (problem) throw settingsRefused(problem);
    }
    if (attributeTargets.length === 0) return;
    // Definitions as they will be after this change.
    const deleted = new Set(settingDeletes);
    const merged = new Map<string, Pick<Setting, 'id' | 'value'>>(stored.filter((s) => !deleted.has(s.id)).map((s) => [s.id, s]));
    for (const s of settingUpserts) merged.set(s.id, s);
    for (const target of attributeTargets as AttributeTarget[]) {
      const defs = attributeDefinitions(target, [...merged.values()]);
      for (const record of changes.upserts?.[target] ?? []) {
        const values = (record as { customAttributes?: Record<string, string | number | boolean> }).customAttributes;
        const problem = attributeValuesProblem(defs, values);
        if (problem) throw settingsRefused(`${record.id}: ${problem}`);
      }
    }
  };
}

/** Runs several write guards in order; the first that refuses stops the write. */
export function composeGuards(...guards: (WriteGuard | undefined)[]): WriteGuard | undefined {
  const present = guards.filter((g): g is WriteGuard => g !== undefined);
  if (present.length === 0) return undefined;
  return (read) => {
    for (const guard of present) guard(read);
  };
}
