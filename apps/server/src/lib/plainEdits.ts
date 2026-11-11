import type { ChangeSet, CollectionName } from '@fibergis/shared';

import type { CollectionReader } from '../db/repository';

/**
 * Phase 24b: a quick answer for the commonest write on a big network, an edit of an item's plain
 * details (a pole renamed, a note or photo added, a maintenance entry). Such an edit cannot add a
 * fibre problem or a site and rack problem, so those two whole-network checks are skipped for it.
 *
 * Why the answer is the same: both checks compare the problems before and after the change by their
 * keys, and refuse only for a key that is new. Every key is built from record ids, and whether a
 * problem exists never depends on the fields below (they appear in the messages only, or nowhere).
 * So when every changed item is already stored and differs from its stored copy only in these
 * fields, the problem keys before and after are the same and both checks return nothing.
 *
 * `test/plainEdits.test.ts` compares the guard with and without this shortcut on random change sets,
 * and checks that the fibre and site rules still never read these fields. Anything else (a moved
 * item, a status, a port, a new or deleted item, any cable, splitter, closure, customer, site or rack
 * in the same change) takes the full checks as before.
 */
export const PLAIN_EQUIPMENT_FIELDS: ReadonlySet<string> = new Set([
  'name',
  'area',
  'street',
  'poleNumber',
  'buildingName',
  'notes',
  'images',
  'installedDate',
  'warrantyUntil',
  'condition',
  'maintenance',
  'serialNumber',
  'manufacturer',
  'firmware',
  'tagCode',
  'ownerType',
  'material',
  'customAttributes',
]);

/** Collections the fibre and site/rack checks read, besides equipment. A change to any of them is never plain. */
const OTHER_CHECKED: readonly CollectionName[] = ['cables', 'splitters', 'closures', 'customers', 'sites', 'racks'];

/** Beyond this many items, the whole check is as quick and simpler. */
const PLAIN_MAX_ITEMS = 200;

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The fields that differ between two records (a field present on one side only counts). */
function changedFields(stored: Record<string, unknown>, next: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(stored), ...Object.keys(next)]);
  return [...keys].filter((key) => !same(stored[key], next[key]));
}

/**
 * True when the change only edits plain details of items that are already stored (see above).
 * Needs targeted reads (`read.find`); without them it answers false and the full checks run.
 */
export function isPlainEquipmentEdit(read: CollectionReader, changes: ChangeSet): boolean {
  const upserts = (changes.upserts?.equipment ?? []) as unknown as Record<string, unknown>[];
  if (!read.find || upserts.length === 0 || upserts.length > PLAIN_MAX_ITEMS) return false;
  if ((changes.deletes?.equipment?.length ?? 0) > 0) return false;
  for (const name of OTHER_CHECKED) {
    if ((changes.upserts?.[name]?.length ?? 0) > 0 || (changes.deletes?.[name]?.length ?? 0) > 0) return false;
  }
  const ids = upserts.map((r) => r.id as string);
  if (new Set(ids).size !== ids.length) return false;
  const stored = new Map((read.find.byIds('equipment', ids) as unknown as Record<string, unknown>[]).map((r) => [r.id as string, r]));
  return upserts.every((next) => {
    const before = stored.get(next.id as string);
    return !!before && changedFields(before, next).every((field) => PLAIN_EQUIPMENT_FIELDS.has(field));
  });
}

/**
 * True when every item the change stores is already stored: the "possible duplicate" warning looks
 * only at new items, so it has nothing to say and needs no read of every item. Needs `read.find`.
 */
export function storesOnlyKnownEquipment(read: CollectionReader, changes: ChangeSet): boolean {
  const upserts = (changes.upserts?.equipment ?? []) as unknown as { id: string }[];
  if (!read.find || upserts.length === 0 || upserts.length > PLAIN_MAX_ITEMS) return false;
  const deleted = new Set(changes.deletes?.equipment ?? []);
  if (upserts.some((r) => deleted.has(r.id))) return false;
  const ids = new Set(upserts.map((r) => r.id));
  return read.find.byIds('equipment', ids).length === ids.size;
}
