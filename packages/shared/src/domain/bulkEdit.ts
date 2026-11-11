import { COLLECTION_SCHEMAS, type CollectionName } from '../model/collections';

/**
 * Phase 16: changing chosen fields on many records at once (the attribute table's "Change
 * selected"). Only plain fields a person writes may be changed this way: never identity, position,
 * links, fibres, ports, readings, history or review state, which have their own commands and checks.
 * The plan is all or nothing: if one record would not be valid, nothing is changed and the reply
 * names that record and why. The server then applies every rule again to the same change set.
 */

/** The fields bulk edit may write, per collection. Anything else is refused. */
export const BULK_EDITABLE_FIELDS: Partial<Record<CollectionName, readonly string[]>> = {
  equipment: ['status', 'area', 'street', 'manufacturer', 'model', 'ownerName', 'condition', 'installedDate', 'warrantyUntil', 'notes'],
  cables: ['status', 'routeStatus', 'installationType', 'owner', 'manufacturer', 'model', 'remarks'],
  customers: ['area', 'building', 'plan'],
  closures: ['area', 'technician', 'condition', 'sealStatus', 'remarks'],
  splitters: ['status', 'manufacturer', 'model', 'kind'],
  ducts: ['status', 'material', 'ownerName', 'condition', 'conditionNote'],
  spans: ['status', 'condition'],
  slackLoops: ['notes'],
  zones: ['status'],
  onts: ['vendor', 'model', 'firmware'],
  buildings: ['kind', 'notes'],
};

/** Values a field may not be set to in bulk (a span is proposed only by the field walk). */
const REFUSED_VALUES: Partial<Record<CollectionName, Record<string, readonly unknown[]>>> = {
  spans: { status: ['proposed'] },
};

export interface BulkFieldEdit {
  field: string;
  /** The value the person chose. `undefined` clears the field, so it shows "Not recorded". */
  value: string | number | boolean | undefined;
}

export interface BulkEditContext {
  now?: Date;
  /** Who is making the change, as shown in the app. The server stamps the real person in its audit. */
  actor?: string;
}

export interface BulkEditProblem {
  id: string;
  label: string;
  field?: string;
  message: string;
}

export type BulkEditPlan =
  | { ok: true; collection: CollectionName; changed: Record<string, unknown>[]; unchanged: string[] }
  | { ok: false; collection: CollectionName; problems: BulkEditProblem[] };

export const isBulkEditable = (collection: CollectionName, field: string): boolean => !!BULK_EDITABLE_FIELDS[collection]?.includes(field);

const labelOf = (record: Record<string, unknown>): string => {
  const name = typeof record.name === 'string' ? record.name : typeof record.title === 'string' ? record.title : undefined;
  return name && name !== record.id ? `${name} (${String(record.id)})` : String(record.id);
};

/**
 * Who confirmed a status and when a condition was seen go with the change, as the single-record
 * commands do (`setSpanStatus`), so a bulk change never looks older or less checked than it is.
 */
function stamps(collection: CollectionName, field: string, ctx: BulkEditContext): Record<string, unknown> {
  const at = (ctx.now ?? new Date()).toISOString();
  if (collection === 'spans' && field === 'status') return { confirmedAt: at, ...(ctx.actor ? { confirmedBy: ctx.actor } : {}) };
  if ((collection === 'spans' || collection === 'ducts') && field === 'condition') return { conditionAt: at };
  return {};
}

const same = (a: unknown, b: unknown) => a === b || (a === undefined && b === undefined);

/** A schema problem in plain words. */
function plainIssue(field: string, issue: { code?: string; message: string; path: PropertyKey[] }): string {
  const where = issue.path.length > 0 ? issue.path.map(String).join('.') : field;
  switch (issue.code) {
    case 'invalid_type':
      return `${where} must be recorded for this item; it cannot be left blank.`;
    case 'too_small':
      return `${where} cannot be blank or this small.`;
    case 'too_big':
      return `${where} is too long or too large.`;
    case 'invalid_value':
    case 'invalid_enum_value':
      return `${where} is not one of the allowed choices.`;
    case 'invalid_format':
    case 'invalid_string':
      return `${where} is not written the right way (${issue.message}).`;
    default:
      return `${where}: ${issue.message}`;
  }
}

/**
 * Works out the changed records for a bulk edit. All or nothing: any refused field, missing record
 * or record that would not be valid refuses the whole edit, listing each problem with its record.
 */
export function planBulkEdit(
  collection: CollectionName,
  records: readonly { id: string }[],
  ids: readonly string[],
  edits: readonly BulkFieldEdit[],
  ctx: BulkEditContext = {},
): BulkEditPlan {
  const problems: BulkEditProblem[] = [];
  if (edits.length === 0) problems.push({ id: '', label: 'No change', message: 'Choose a field and a value first.' });
  for (const edit of edits) {
    if (!isBulkEditable(collection, edit.field)) {
      problems.push({ id: '', label: edit.field, field: edit.field, message: `${edit.field} cannot be changed for many items at once. Open each item to change it.` });
    } else if (REFUSED_VALUES[collection]?.[edit.field]?.includes(edit.value)) {
      problems.push({ id: '', label: edit.field, field: edit.field, message: `${edit.field} cannot be set to "${String(edit.value)}" here.` });
    }
  }
  if (ids.length === 0) problems.push({ id: '', label: 'Nothing chosen', message: 'Choose at least one item.' });
  if (problems.length > 0) return { ok: false, collection, problems };

  const byId = new Map(records.map((r) => [r.id, r as Record<string, unknown>]));
  const schema = COLLECTION_SCHEMAS[collection];
  const changed: Record<string, unknown>[] = [];
  const unchanged: string[] = [];
  for (const id of new Set(ids)) {
    const record = byId.get(id);
    if (!record) {
      problems.push({ id, label: id, message: `${id} is no longer on this device (deleted or not loaded). Nothing was changed.` });
      continue;
    }
    const next: Record<string, unknown> = { ...record };
    let differs = false;
    for (const edit of edits) {
      if (same(record[edit.field], edit.value)) continue;
      differs = true;
      if (edit.value === undefined) delete next[edit.field];
      else next[edit.field] = edit.value;
      Object.assign(next, stamps(collection, edit.field, ctx));
    }
    if (!differs) {
      unchanged.push(id);
      continue;
    }
    const parsed = schema.safeParse(next);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      problems.push({ id, label: labelOf(record), field: String(issue.path[0] ?? edits[0].field), message: plainIssue(edits[0].field, issue) });
      continue;
    }
    changed.push(next);
  }
  if (problems.length > 0) return { ok: false, collection, problems };
  return { ok: true, collection, changed, unchanged };
}

/** One line for a refused bulk edit: the first record and its reason, and how many more. */
export function describeBulkEditProblems(problems: readonly BulkEditProblem[]): string {
  if (problems.length === 0) return '';
  const [first] = problems;
  const more = problems.length > 1 ? ` (${problems.length - 1} more item(s) have problems too)` : '';
  return `Nothing was changed. ${first.id ? `${first.label}: ` : ''}${first.message}${more}`;
}
