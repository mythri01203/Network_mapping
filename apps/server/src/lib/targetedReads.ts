import type { Attachment, CableSegment, ChangeSet, CollectionName, SegmentCheckData } from '@fibergis/shared';

import type { CollectionReader } from '../db/repository';

/**
 * Phase 24: readers that hand a check only the stored records a change set can affect, instead of
 * whole collections. Each is used only for a check whose answer is provably the same:
 *
 * - The outside-plant link check reports (a) problems of records the change stores and (b) records
 *   left pointing to an id the change deletes. Every such record is in the subset: the stored records
 *   the change replaces, every record of the checked collections whose stored JSON names a deleted id,
 *   and every record any of those could point to (looked up by every string they contain, whatever
 *   the field is called). Records outside the subset can only add problems the check filters out.
 * - The catalogue check compares each item with the model it names: the subset is the items the
 *   change stores, the items naming a deleted model, and every model those name.
 * - The monitoring check looks up stored alarms by the ids the change stores.
 * - The cable stretch check (network mapping Phase 6) reports errors of the stretches the change
 *   stores only: it needs those cables, every stored stretch of them, and the structures, ducts and
 *   spans those stretches name (plus the attachments of those cables, for its warnings).
 * - The rule for link checks (network mapping Phase 13, `linkVerifications`) reads nothing stored: it
 *   judges only the checks the change stores (`LINK_VERIFICATION_READS` is empty on purpose). A
 *   check naming a link that is gone is flagged when shown, never refused, so no network read is needed.
 * - The rule for map check findings (network mapping Phase 15, `validationFindings`) compares each
 *   finding the change stores or deletes with its own stored copy only (`storedFindingsFor`).
 *
 * The rest (fiber, connections, faults, Cable TV) compare the whole network before and after, so they
 * keep whole reads (shared, read once per write by the repository).
 *
 * A check that later reads a collection these readers do not know gets the whole collection; and
 * `test/targetedGuard.test.ts` compares the targeted and whole answers on random change sets, so a new
 * rule that compares records with each other fails it until the reader is taught. With no `find`
 * (another repository), too many ids, or nothing to narrow, the whole reader is used as before.
 */

/** Network mapping Phase 13: what the rule for link checks reads from storage. Nothing; a test keeps it so. */
export const LINK_VERIFICATION_READS: readonly CollectionName[] = [];

/** Beyond this many ids to look for, whole reads are as quick and simpler. */
export const TARGETED_MAX_IDS = 500;

/** Every string in a record (values and keys, at any depth): a superset of the ids it points to. */
export function stringsIn(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (typeof value === 'string') into.add(value);
  else if (Array.isArray(value)) for (const item of value) stringsIn(item, into);
  else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      into.add(key);
      stringsIn(item, into);
    }
  }
  return into;
}

const upsertsOf = (changes: ChangeSet, name: CollectionName) => (changes.upserts?.[name] ?? []) as unknown as { id: string }[];
const deletesOf = (changes: ChangeSet, name: CollectionName) => changes.deletes?.[name] ?? [];

/** The collections a data builder asks for, found by calling it with an empty reader. */
export function collectionsRead(build: (read: CollectionReader) => unknown): Set<CollectionName> {
  const names = new Set<CollectionName>();
  build(((name: CollectionName) => {
    names.add(name);
    return [];
  }) as CollectionReader);
  return names;
}

/** A reader serving `subset` for the named collections and whole reads for any other. */
function subsetReader(read: CollectionReader, subset: Map<CollectionName, Set<string>>): CollectionReader {
  const find = read.find!;
  const served = new Map<CollectionName, unknown[]>();
  for (const [name, ids] of subset) served.set(name, find.byIds(name, ids));
  return (<C extends CollectionName>(name: C) => (served.has(name) ? [...served.get(name)!] : read(name))) as CollectionReader;
}

const addAll = (target: Set<string>, values: Iterable<string>) => {
  for (const value of values) target.add(value);
};

/** Collections the link check holds as `current`; their problems come from the last seven only. */
export const LINK_COLLECTIONS = ['equipment', 'cables', 'spans', 'attachments', 'ducts', 'slackLoops', 'permissions', 'inspections', 'cableSegments'] as const satisfies readonly CollectionName[];
const LINK_CHECKED: readonly CollectionName[] = ['spans', 'attachments', 'ducts', 'slackLoops', 'permissions', 'inspections', 'cableSegments'];
/** Collections whose ids the link check looks up (a span's poles, an attachment's cable and span, an inspection's target, a stretch's cable, ends, duct and spans). */
const LINK_TARGETS: readonly CollectionName[] = ['equipment', 'cables', 'spans', 'ducts'];

/** The link check's reader, or undefined to read whole collections. `wanted`: what its data builder reads. */
export function linkCheckReader(read: CollectionReader, changes: ChangeSet, wanted: ReadonlySet<CollectionName>): CollectionReader | undefined {
  if (!read.find) return undefined;
  const known = new Set<CollectionName>(LINK_COLLECTIONS);
  if ([...wanted].some((name) => !known.has(name))) return undefined;
  const deleted = new Set<string>();
  for (const name of LINK_COLLECTIONS) addAll(deleted, deletesOf(changes, name));
  const upserted = LINK_COLLECTIONS.flatMap((name) => upsertsOf(changes, name));
  if (deleted.size + upserted.length > TARGETED_MAX_IDS) return undefined;

  const subset = new Map<CollectionName, Set<string>>(LINK_COLLECTIONS.map((name) => [name, new Set<string>()]));
  // The stored records the change replaces keep their place in the order.
  for (const name of LINK_COLLECTIONS) addAll(subset.get(name)!, upsertsOf(changes, name).map((r) => r.id));
  // Records left pointing to something the change deletes.
  const referrers = read.find.mentioning(LINK_CHECKED, deleted);
  for (const { collection, record } of referrers) subset.get(collection)?.add(String(record.id));
  // Everything those records and the stored ones could point to.
  const named = new Set<string>();
  for (const record of upserted) stringsIn(record, named);
  for (const { record } of referrers) stringsIn(record, named);
  if (named.size > TARGETED_MAX_IDS * 20) return undefined;
  for (const name of LINK_TARGETS) addAll(subset.get(name)!, named);
  return subsetReader(read, subset);
}

/** The catalogue check's reader, or undefined to read whole collections. */
export function catalogCheckReader(read: CollectionReader, changes: ChangeSet): CollectionReader | undefined {
  if (!read.find) return undefined;
  const deletedModels = deletesOf(changes, 'catalog');
  const upsertedItems = upsertsOf(changes, 'equipment');
  if (deletedModels.length + upsertedItems.length + deletesOf(changes, 'equipment').length > TARGETED_MAX_IDS) return undefined;
  const items = new Set<string>(upsertedItems.map((r) => r.id));
  const naming = read.find.mentioning(['equipment'], deletedModels);
  for (const { record } of naming) items.add(String(record.id));
  // Stored items (before) and the change's items (after) both need the models they name.
  const stored = read.find.byIds('equipment', items);
  const models = new Set<string>();
  for (const record of [...stored, ...upsertedItems]) stringsIn(record, models);
  addAll(models, deletedModels);
  addAll(models, upsertsOf(changes, 'catalog').map((r) => r.id));
  if (models.size > TARGETED_MAX_IDS * 20) return undefined;
  return subsetReader(
    read,
    new Map<CollectionName, Set<string>>([
      ['equipment', items],
      ['catalog', models],
    ]),
  );
}

/** Stored alarms by the ids a change stores (the monitoring check looks nothing else up). */
/**
 * Network mapping Phase 15: the stored map check findings a change names (its upserts and deletes),
 * looked up by id. The findings rule compares each finding only with its own stored copy.
 */
export function storedFindingsFor(read: CollectionReader, changes: ChangeSet) {
  const ids = [...upsertsOf(changes, 'validationFindings').map((f) => f.id), ...deletesOf(changes, 'validationFindings')];
  return read.find && ids.length <= TARGETED_MAX_IDS ? read.find.byIds('validationFindings', ids) : read('validationFindings');
}

/**
 * Network mapping Phase 17: the stored optical budget runs a change names, looked up by id. The rule
 * compares each run only with its own stored copy (a run is never changed or deleted).
 */
export function storedBudgetRunsFor(read: CollectionReader, changes: ChangeSet) {
  const ids = [...upsertsOf(changes, 'opticalBudgetRuns').map((r) => r.id), ...deletesOf(changes, 'opticalBudgetRuns')];
  return read.find && ids.length <= TARGETED_MAX_IDS ? read.find.byIds('opticalBudgetRuns', ids) : read('opticalBudgetRuns');
}

/**
 * Network mapping Phase 21: the stored import records a change names, looked up by id. The rule
 * compares each record only with its own stored copy (history is never rewritten).
 */
export function storedImportsFor(read: CollectionReader, changes: ChangeSet) {
  const ids = [...upsertsOf(changes, 'imports').map((r) => r.id), ...deletesOf(changes, 'imports')];
  return read.find && ids.length <= TARGETED_MAX_IDS ? read.find.byIds('imports', ids) : read('imports');
}

export function storedAlarmsFor(read: CollectionReader, changes: ChangeSet) {
  const ids = upsertsOf(changes, 'alarms').map((a) => a.id);
  return read.find && ids.length <= TARGETED_MAX_IDS ? read.find.byIds('alarms', ids) : read('alarms');
}

/**
 * Network mapping Phase 6: the data the cable stretch check reads, narrowed to the cables whose
 * stretches the change stores. Whole collections when there is no `find` or too many ids.
 */
export function segmentCheckData(read: CollectionReader, changes: ChangeSet): SegmentCheckData {
  const whole = (): SegmentCheckData => ({
    equipment: read('equipment'),
    cables: read('cables'),
    cableSegments: read('cableSegments'),
    ducts: read('ducts'),
    spans: read('spans'),
    attachments: read('attachments'),
  });
  const upserts = upsertsOf(changes, 'cableSegments') as unknown as CableSegment[];
  if (!read.find || upserts.length > TARGETED_MAX_IDS) return whole();
  const find = read.find;
  const cableIds = new Set(upserts.map((s) => s.cableId));
  // Every stored stretch of those cables, and the stored versions of the stretches the change replaces.
  const stored = new Map<string, CableSegment>();
  for (const { record } of find.mentioning(['cableSegments'], cableIds)) {
    const s = record as unknown as CableSegment;
    if (cableIds.has(s.cableId)) stored.set(s.id, s);
  }
  for (const s of find.byIds('cableSegments', upserts.map((u) => u.id))) stored.set(s.id, s);
  const all = [...stored.values(), ...upserts];
  const structures = new Set<string>();
  const ducts = new Set<string>();
  const spans = new Set<string>();
  for (const s of all) {
    if (s.fromStructureId) structures.add(s.fromStructureId);
    if (s.toStructureId) structures.add(s.toStructureId);
    if (s.ductId) ducts.add(s.ductId);
    addAll(spans, s.spanIds ?? []);
  }
  if (structures.size + ducts.size + spans.size + stored.size > TARGETED_MAX_IDS * 20) return whole();
  return {
    equipment: find.byIds('equipment', structures),
    cables: find.byIds('cables', cableIds),
    cableSegments: [...stored.values()],
    ducts: find.byIds('ducts', ducts),
    spans: find.byIds('spans', spans),
    attachments: find
      .mentioning(['attachments'], cableIds)
      .map(({ record }) => record as unknown as Attachment)
      .filter((a) => cableIds.has(a.cableId)),
  };
}
