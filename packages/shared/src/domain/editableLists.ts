import { z } from 'zod';

import type { CollectionName, NetworkSnapshot } from '../model/collections';
import { CABLE_STATUSES, CABLE_TYPES, EQUIPMENT_CATEGORIES, EQUIPMENT_STATUSES, EQUIPMENT_TYPES_BY_CATEGORY, SPLITTER_RATIOS } from '../model/enums';
import type { Setting } from '../model/types';
import { CHECKLIST_SETTING_PREFIX, checklistSettingProblem } from './inspectionChecklist';

/**
 * Phase 23: lists the owner can edit (Administration, Lists and rules), kept as `settings` records
 * and laid over the built-in values. A built-in value is never removed: it can be given another
 * name on screen or left out of the pickers for new items, and records that use it keep it.
 *
 * Only lists whose field accepts any text take new values (equipment types, connector types). The
 * others are checked by the database as fixed values (a splitter ratio drives the loss sums), so
 * a new value there needs a program change; their names can still be changed.
 *
 * Naming rules shape the name or asset number shown on new items. Record ids stay as they are
 * (random and never changed), because phones and backups rely on them.
 *
 * Custom attributes are extra fields the owner defines for a kind of record; their values are kept
 * on the record under `customAttributes`.
 */

export const EDITABLE_LIST_KEYS = ['equipmentTypes', 'equipmentStatuses', 'cableTypes', 'cableStatuses', 'connectorTypes', 'splitterRatios'] as const;
export type EditableListKey = (typeof EDITABLE_LIST_KEYS)[number];

/** Connector types offered for ODF and patch ports. The stored field takes up to 20 characters of any text. */
export const BUILT_IN_CONNECTOR_TYPES = ['SC/APC', 'SC/UPC', 'LC/APC', 'LC/UPC'] as const;

interface ListDef {
  title: string;
  /** Built-in values, and the group each belongs to (equipment category). */
  builtIn: readonly { value: string; group?: string }[];
  /** True when the stored field accepts any text, so new values can be added. */
  allowsCustom: boolean;
  /** Longest value the stored field takes. */
  maxLength: number;
  /** Groups a new value may go in (equipment categories). */
  groups?: readonly string[];
}

const plain = (values: readonly string[]) => values.map((value) => ({ value }));

export const EDITABLE_LISTS: Record<EditableListKey, ListDef> = {
  equipmentTypes: {
    title: 'Equipment types',
    builtIn: Object.entries(EQUIPMENT_TYPES_BY_CATEGORY).flatMap(([group, values]) => (values as readonly string[]).map((value) => ({ value, group }))),
    allowsCustom: true,
    maxLength: 60,
    groups: EQUIPMENT_CATEGORIES,
  },
  equipmentStatuses: { title: 'Equipment statuses', builtIn: plain(EQUIPMENT_STATUSES), allowsCustom: false, maxLength: 40 },
  cableTypes: { title: 'Cable types', builtIn: plain(CABLE_TYPES), allowsCustom: false, maxLength: 60 },
  cableStatuses: { title: 'Cable statuses', builtIn: plain(CABLE_STATUSES), allowsCustom: false, maxLength: 40 },
  connectorTypes: { title: 'Connection (connector) types', builtIn: plain(BUILT_IN_CONNECTOR_TYPES), allowsCustom: true, maxLength: 20 },
  splitterRatios: { title: 'Splitter ratios', builtIn: plain(SPLITTER_RATIOS), allowsCustom: false, maxLength: 10 },
};

export const LIST_SETTING_PREFIX = 'list.';
export const NAMING_SETTING_PREFIX = 'naming.';
export const ATTRIBUTE_SETTING_PREFIX = 'attr.';

export const listSettingId = (key: EditableListKey) => `${LIST_SETTING_PREFIX}${key}`;

const listOverlaySchema = z.strictObject({
  added: z.array(z.strictObject({ value: z.string().trim().min(1).max(60), label: z.string().trim().min(1).max(80).optional(), group: z.string().max(60).optional() })).max(200).default([]),
  labels: z.record(z.string(), z.string().trim().min(1).max(80)).default({}),
  hidden: z.array(z.string()).max(200).default([]),
});
export type ListOverlay = z.infer<typeof listOverlaySchema>;

export interface ListEntry {
  value: string;
  label: string;
  builtIn: boolean;
  /** Not offered for new items. Records that already use it keep it. */
  hidden: boolean;
  group?: string;
}

export interface ResolvedList {
  key: EditableListKey;
  title: string;
  allowsCustom: boolean;
  entries: ListEntry[];
}

type SettingLike = Pick<Setting, 'id' | 'value'>;

const parseJsonValue = (value: unknown): unknown => {
  if (typeof value !== 'string') return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
};

/** The owner's changes to one list, or the reason they cannot be read. */
export function parseListOverlay(value: unknown): { ok: true; overlay: ListOverlay } | { ok: false; error: string } {
  const parsed = listOverlaySchema.safeParse(parseJsonValue(value));
  if (!parsed.success) return { ok: false, error: 'The list setting is not in the expected form (JSON with "added", "labels" and "hidden").' };
  return { ok: true, overlay: parsed.data };
}

export const emptyListOverlay = (): ListOverlay => ({ added: [], labels: {}, hidden: [] });

/** A list as people see it: the built-in values (renamed or hidden as set) and the values the owner added. */
export function resolveEditableList(key: EditableListKey, settings: readonly SettingLike[] = []): ResolvedList {
  const def = EDITABLE_LISTS[key];
  const stored = settings.find((s) => s.id === listSettingId(key));
  const parsed = stored ? parseListOverlay(stored.value) : null;
  const overlay = parsed?.ok ? parsed.overlay : emptyListOverlay();
  const hidden = new Set(overlay.hidden);
  const builtInValues = new Set(def.builtIn.map((b) => b.value));
  const entries: ListEntry[] = def.builtIn.map((b) => ({
    value: b.value,
    label: overlay.labels[b.value] ?? b.value,
    builtIn: true,
    hidden: hidden.has(b.value),
    ...(b.group ? { group: b.group } : {}),
  }));
  if (def.allowsCustom) {
    for (const added of overlay.added) {
      if (builtInValues.has(added.value) || entries.some((e) => e.value === added.value)) continue;
      entries.push({ value: added.value, label: added.label ?? added.value, builtIn: false, hidden: hidden.has(added.value), ...(added.group ? { group: added.group } : {}) });
    }
  }
  return { key, title: def.title, allowsCustom: def.allowsCustom, entries };
}

/** What a picker for a new or edited item should offer: visible values, plus the item's own value if it is hidden or unknown. */
export function pickerEntries(key: EditableListKey, settings: readonly SettingLike[] = [], current?: string): ListEntry[] {
  const list = resolveEditableList(key, settings).entries;
  const shown = list.filter((e) => !e.hidden);
  if (current && !shown.some((e) => e.value === current)) {
    shown.push(list.find((e) => e.value === current) ?? { value: current, label: current, builtIn: false, hidden: true });
  }
  return shown;
}

/** The values records already use, for lists whose values the owner can add and remove. */
export function usedListValues(key: EditableListKey, data: Partial<Pick<NetworkSnapshot, 'equipment'>>): Set<string> {
  const used = new Set<string>();
  if (key === 'equipmentTypes') for (const e of data.equipment ?? []) used.add(e.type);
  if (key === 'connectorTypes') {
    for (const e of data.equipment ?? []) {
      for (const panel of e.odfPanels ?? []) {
        if (panel.connectorType) used.add(panel.connectorType);
        for (const port of panel.ports) if (port.connectorType) used.add(port.connectorType);
      }
    }
  }
  return used;
}

/**
 * Why a change to a list setting cannot be saved, in plain words, or null. A value records use can
 * be hidden but never removed; a fixed list takes no new values; a new value must fit the field.
 */
export function listChangeProblem(key: EditableListKey, before: unknown, after: unknown, used: ReadonlySet<string>): string | null {
  const def = EDITABLE_LISTS[key];
  const next = parseListOverlay(after);
  if (!next.ok) return next.error;
  const builtIn = new Set(def.builtIn.map((b) => b.value));
  for (const added of next.overlay.added) {
    if (!def.allowsCustom) return `${def.title} is a fixed list: "${added.value}" cannot be added without a program change. You can rename or hide values instead.`;
    if (builtIn.has(added.value)) return `"${added.value}" is already in ${def.title}.`;
    if (added.value.length > def.maxLength) return `"${added.value}" is too long for ${def.title} (at most ${def.maxLength} characters).`;
    if (added.group && def.groups && !def.groups.includes(added.group)) return `"${added.group}" is not a group of ${def.title}.`;
  }
  for (const label of Object.keys(next.overlay.labels)) {
    if (!builtIn.has(label) && !next.overlay.added.some((a) => a.value === label)) return `"${label}" is not in ${def.title}, so it cannot be renamed.`;
  }
  const prev = before === undefined ? null : parseListOverlay(before);
  const prevAdded = prev?.ok ? prev.overlay.added : [];
  const kept = new Set(next.overlay.added.map((a) => a.value));
  const removedInUse = prevAdded.map((a) => a.value).filter((value) => !kept.has(value) && used.has(value));
  if (removedInUse.length > 0) return `"${removedInUse[0]}" is used by records, so it cannot be removed. Hide it instead: it stays on those records and is not offered for new ones.`;
  return null;
}

/* ------------------------------------------------------------------ */
/* Naming rules                                                        */
/* ------------------------------------------------------------------ */

export const NAMING_TARGETS = ['equipment', 'cables', 'closures', 'splitters', 'customers'] as const satisfies readonly CollectionName[];
export type NamingTarget = (typeof NAMING_TARGETS)[number];

/**
 * A naming rule: a pattern with parts in braces. `{n}` or `{n:3}` is the next free number (padded),
 * `{type}` the item type, `{area}` the area, `{yyyy}` the year. Example: `FAT-{area}-{n:3}`.
 * `type` limits the rule to one equipment type.
 */
const namingRuleSchema = z.strictObject({
  pattern: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .refine((p) => /\{n(?::\d)?\}/.test(p), 'The pattern needs a number part, {n} or {n:3}.'),
  type: z.string().trim().max(60).optional(),
  note: z.string().max(300).optional(),
});
export type NamingRule = z.infer<typeof namingRuleSchema>;

export const namingSettingId = (target: NamingTarget, type?: string) => `${NAMING_SETTING_PREFIX}${target}${type ? `.${type}` : ''}`;

export function parseNamingRule(value: unknown): { ok: true; rule: NamingRule } | { ok: false; error: string } {
  const parsed = namingRuleSchema.safeParse(parseJsonValue(value));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'The naming rule is not in the expected form.' };
  return { ok: true, rule: parsed.data };
}

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const fill = (pattern: string, parts: { type?: string; area?: string; year: string }) =>
  pattern
    .replace(/\{type\}/g, parts.type ?? '')
    .replace(/\{area\}/g, (parts.area ?? '').replace(/\s+/g, '').toUpperCase())
    .replace(/\{yyyy\}/g, parts.year);

/** The rule for a new item: one for its type first, then the general one. */
export function namingRuleFor(target: NamingTarget, settings: readonly SettingLike[], type?: string): NamingRule | null {
  for (const id of [type ? namingSettingId(target, type) : null, namingSettingId(target)]) {
    if (!id) continue;
    const stored = settings.find((s) => s.id === id);
    const parsed = stored ? parseNamingRule(stored.value) : null;
    if (parsed?.ok) return parsed.rule;
  }
  return null;
}

/** The next name the rule gives, after the highest number already used by a name of the same shape. */
export function nextNameFromRule(rule: NamingRule, existingNames: readonly string[], parts: { type?: string; area?: string; now?: Date } = {}): string {
  const year = String((parts.now ?? new Date()).getFullYear());
  const filled = fill(rule.pattern, { ...parts, year });
  const match = /\{n(?::(\d))?\}/.exec(filled);
  if (!match) return filled;
  const width = match[1] ? Number(match[1]) : 1;
  const [head, tail] = [filled.slice(0, match.index), filled.slice(match.index + match[0].length)];
  const shape = new RegExp(`^${escapeRegex(head)}(\\d+)${escapeRegex(tail)}$`);
  let highest = 0;
  for (const name of existingNames) {
    const m = shape.exec(name);
    if (m) highest = Math.max(highest, Number(m[1]));
  }
  return `${head}${String(highest + 1).padStart(width, '0')}${tail}`;
}

/** A plain warning when a name does not follow the rule. Never blocks: the owner may have older names. */
export function nameRuleWarning(rule: NamingRule, name: string, parts: { type?: string; area?: string; now?: Date } = {}): string | null {
  const year = String((parts.now ?? new Date()).getFullYear());
  const filled = fill(rule.pattern, { ...parts, year });
  const shape = new RegExp(`^${filled.split(/\{n(?::\d)?\}/).map(escapeRegex).join('\\d+')}$`);
  return shape.test(name) ? null : `"${name}" does not follow the naming rule ${rule.pattern}.`;
}

/* ------------------------------------------------------------------ */
/* Custom attributes                                                   */
/* ------------------------------------------------------------------ */

export const ATTRIBUTE_TARGETS = ['equipment', 'cables', 'customers'] as const satisfies readonly CollectionName[];
export type AttributeTarget = (typeof ATTRIBUTE_TARGETS)[number];
export const ATTRIBUTE_TYPES = ['text', 'number', 'yes_no', 'choice', 'date'] as const;
export type AttributeType = (typeof ATTRIBUTE_TYPES)[number];

const attributeDefSchema = z
  .strictObject({
    label: z.string().trim().min(1).max(80),
    type: z.enum(ATTRIBUTE_TYPES),
    choices: z.array(z.string().trim().min(1).max(60)).max(50).optional(),
    unit: z.string().trim().max(20).optional(),
    /** Asked for on new items; older items without it stay valid. */
    required: z.boolean().optional(),
    /** Only for this equipment type. */
    appliesToType: z.string().trim().max(60).optional(),
    note: z.string().max(300).optional(),
  })
  .refine((d) => d.type !== 'choice' || (d.choices?.length ?? 0) > 0, 'A choice field needs its choices.');
export type AttributeDef = z.infer<typeof attributeDefSchema>;

/** `attr.<target>.<key>`; the key is what the value is stored under on the record. */
export const ATTRIBUTE_KEY_PATTERN = /^[a-z][a-zA-Z0-9_]{0,39}$/;
export const attributeSettingId = (target: AttributeTarget, key: string) => `${ATTRIBUTE_SETTING_PREFIX}${target}.${key}`;

export interface AttributeDefinition extends AttributeDef {
  target: AttributeTarget;
  key: string;
}

export function parseAttributeSetting(id: string, value: unknown): { ok: true; def: AttributeDefinition } | { ok: false; error: string } {
  const [, target, key] = /^attr\.([a-zA-Z]+)\.(.+)$/.exec(id) ?? [];
  if (!target || !(ATTRIBUTE_TARGETS as readonly string[]).includes(target)) return { ok: false, error: `Custom fields can be made for ${ATTRIBUTE_TARGETS.join(', ')} only.` };
  if (!key || !ATTRIBUTE_KEY_PATTERN.test(key)) return { ok: false, error: 'A field key is 1 to 40 letters, digits or "_", starting with a small letter.' };
  const parsed = attributeDefSchema.safeParse(parseJsonValue(value));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'The custom field is not in the expected form.' };
  return { ok: true, def: { ...parsed.data, target: target as AttributeTarget, key } };
}

/** The owner's custom fields for one kind of record. */
export function attributeDefinitions(target: AttributeTarget, settings: readonly SettingLike[] = []): AttributeDefinition[] {
  return settings
    .filter((s) => s.id.startsWith(`${ATTRIBUTE_SETTING_PREFIX}${target}.`))
    .map((s) => parseAttributeSetting(s.id, s.value))
    .flatMap((r) => (r.ok ? [r.def] : []));
}

export type AttributeValue = string | number | boolean;

/**
 * Why custom field values on a record are wrong for their definitions, or null. A field with no
 * definition (for example, one the owner removed later) is kept as it is and not judged.
 */
export function attributeValuesProblem(defs: readonly AttributeDefinition[], values: Record<string, AttributeValue> | undefined): string | null {
  if (!values) return null;
  for (const def of defs) {
    const value = values[def.key];
    if (value === undefined) continue;
    const name = `"${def.label}"`;
    switch (def.type) {
      case 'text':
        if (typeof value !== 'string') return `${name} must be text.`;
        break;
      case 'number':
        if (typeof value !== 'number' || !Number.isFinite(value)) return `${name} must be a number.`;
        break;
      case 'yes_no':
        if (typeof value !== 'boolean') return `${name} must be yes or no.`;
        break;
      case 'choice':
        if (typeof value !== 'string' || !def.choices?.includes(value)) return `${name} must be one of: ${(def.choices ?? []).join(', ')}.`;
        break;
      case 'date':
        if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return `${name} must be a date.`;
        break;
    }
  }
  return null;
}

/** Why a settings record in the Lists and rules area cannot be saved, or null (other settings are not judged here). */
export function ruleSettingProblem(id: string, value: unknown): string | null {
  if (id.startsWith(NAMING_SETTING_PREFIX)) {
    const [, target] = /^naming\.([a-zA-Z]+)(?:\.(.+))?$/.exec(id) ?? [];
    if (!target || !(NAMING_TARGETS as readonly string[]).includes(target)) return `Naming rules can be set for ${NAMING_TARGETS.join(', ')} only.`;
    const parsed = parseNamingRule(value);
    return parsed.ok ? null : parsed.error;
  }
  if (id.startsWith(ATTRIBUTE_SETTING_PREFIX)) {
    const parsed = parseAttributeSetting(id, value);
    return parsed.ok ? null : parsed.error;
  }
  // Phase 19: inspection checklists follow the same editable-list rules.
  if (id.startsWith(CHECKLIST_SETTING_PREFIX)) return checklistSettingProblem(id, value);
  return null;
}

export const isEditableListKey = (value: string): value is EditableListKey => (EDITABLE_LIST_KEYS as readonly string[]).includes(value);
