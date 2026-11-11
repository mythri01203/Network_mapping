import type { CollectionName } from '../model/collections';
import type { AccountRole } from './access';

/**
 * Phase 23: the kinds of change a role may make, as one table both sides read. The server applies
 * it on every write (with the finer per-collection rules in `access.ts`); the browser reads it to
 * hide buttons a person cannot use.
 *
 * A change is never trusted to say what it is: the action is worked out from what the change does.
 * Moving a point is `move`, adding or removing a link between two records is `connect` or
 * `disconnect`, giving a core or port to a use is `allocate` or `deallocate`. A settings or catalogue
 * change is also `configure`.
 */

export const PERMISSION_ACTIONS = ['view', 'create', 'edit', 'move', 'delete', 'connect', 'disconnect', 'allocate', 'deallocate', 'approve', 'export', 'configure'] as const;
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

/** What each action means, in plain words, for the role table and refusals. */
export const PERMISSION_WORDS: Record<PermissionAction, string> = {
  view: 'look at the network',
  create: 'add items',
  edit: 'change items',
  move: 'move items on the map',
  delete: 'delete items',
  connect: 'connect items (cables, cores, ports, customers)',
  disconnect: 'disconnect items',
  allocate: 'give a core or port to a use (allocate)',
  deallocate: 'free a core or port (deallocate)',
  approve: 'approve change requests',
  export: 'save lists and reports to a file (export)',
  configure: 'change settings, lists and the catalogue',
};

/** Short column titles for the role table. */
export const PERMISSION_TITLES: Record<PermissionAction, string> = {
  view: 'View',
  create: 'Create',
  edit: 'Edit',
  move: 'Move',
  delete: 'Delete',
  connect: 'Connect',
  disconnect: 'Disconnect',
  allocate: 'Allocate',
  deallocate: 'Deallocate',
  approve: 'Approve',
  export: 'Export',
  configure: 'Configure',
};

const ALL: readonly PermissionAction[] = PERMISSION_ACTIONS;

/** Role → the actions it may take at most. The per-collection rules in `access.ts` can narrow these further. */
export const ROLE_ACTIONS: Record<AccountRole, readonly PermissionAction[]> = {
  admin: ALL,
  network_admin: ALL,
  engineer: ALL.filter((a) => a !== 'approve'),
  office: ['view', 'create', 'edit', 'move', 'delete', 'connect', 'disconnect', 'allocate', 'deallocate', 'export'],
  technician: ['view', 'create', 'edit', 'move', 'delete', 'connect', 'disconnect'],
  noc: ['view', 'create', 'edit', 'export'],
  supervisor: ['view', 'create', 'edit', 'approve', 'export'],
  viewer: ['view'],
};

/** Where a role has an action only for some records, in plain words. */
export const ROLE_ACTION_LIMITS: Partial<Record<AccountRole, Partial<Record<PermissionAction, string>>>> = {
  office: { delete: 'Only documents, planning scenarios, and their own trips and routes.' },
  technician: {
    create: 'Field capture only: poles, boxes, faults, problem reports, Cable TV meter readings, checks of links.',
    edit: 'Their own jobs, their own field captures, and light readings on customers.',
    move: 'Their own field captures only.',
    delete: 'Undo of their own field capture only.',
    connect: 'Their own field captures only.',
    disconnect: 'Their own field captures only.',
  },
  noc: { create: 'Faults, alarms, jobs and documents. Not network items.', edit: 'Faults, alarms, jobs and documents. Not network items.' },
  supervisor: { create: 'Faults, jobs and documents. Not network items.', edit: 'Faults, alarms, jobs and documents. Not network items.' },
};

export const roleHasAction = (role: AccountRole, action: PermissionAction): boolean => ROLE_ACTIONS[role]?.includes(action) ?? false;

/** Settings and the catalogue are configuration: every change to them also needs `configure`. */
export const CONFIG_COLLECTIONS: ReadonlySet<CollectionName> = new Set<CollectionName>(['settings', 'catalog']);

/**
 * Records that are part of the network itself. Only for these is a change looked at for moves,
 * links and allocations; a fault or a job that names a cable is not "connecting" anything.
 */
export const NETWORK_COLLECTIONS: ReadonlySet<CollectionName> = new Set<CollectionName>([
  'equipment',
  'cables',
  'splitters',
  'closures',
  'customers',
  'spans',
  'attachments',
  'ducts',
  'slackLoops',
  'buildings',
  'onts',
  'services',
  'zones',
  'rfElements',
  'rfLinks',
  // Phase 9: moving a rack to another site is a link change; a site's map point is a move.
  'sites',
  'racks',
  // Phase 6: naming a stretch's duct, way or end structures is a link change.
  'cableSegments',
  // Phase 13: `linkVerifications` is deliberately not here. A check names a link; it is evidence,
  // like a fault or an inspection naming a cable, and recording one connects nothing.
  // Phase 15: `validationFindings` is not here either. A finding names a record it is about; marking
  // it fine or fixed changes nothing in the network, so it needs only `create` or `edit`.
  // Phase 17: `opticalBudgetRuns` is not here. A run names the path it was worked out for and
  // changes nothing; storing one needs only `create` (and the server refuses changes and deletes).
  // Phase 21: `imports` is not here either. An import record lists the ids it made; it links nothing.
  // The records it made are judged on their own (an undo needs `delete` on each of them).
]);

type Json =Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Same value, ignoring key order and unset fields. */
function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, i) => same(item, b[i]));
  if (isObject(a) && isObject(b)) {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) if (!same(a[key], b[key])) return false;
    return true;
  }
  return false;
}

/** Where a record is drawn: a point, a line or an area. */
const POSITION_KEYS = ['lat', 'lng', 'coordinates', 'boundaryCoords'] as const;
const positionOf = (record: Json) => POSITION_KEYS.map((key) => record[key]);

/** Fields ending in "Id" that are not a link between network records. */
const NOT_LINKS = new Set([
  'id',
  'captureRunId',
  'previousAssetId',
  'catalogModelId',
  'rxPhotoId',
  'rxCaptureId',
  'photoId',
  'importId',
  'documentId',
  'trayId',
  'replacedBySpliceId',
  'styleId',
  'tagCode',
]);
/** Fields that say which port or core a link uses. */
const LINK_PARTS = new Set([
  'ponPort',
  'splitterOutputPort',
  'fiberCore',
  'connectedCore',
  'connectedPort',
  'spliceTargetCore',
  'connectedSplitterPort',
  'feederCore',
  'inputCore',
  'outputCore',
  'startPortName',
  'endPortName',
]);
/** Parts of a record that are history, pictures or allocations, never links. */
const SKIP_BRANCHES = new Set(['history', 'connectionHistory', 'assignments', 'images', 'importInfo', 'specOverrides', 'photoIds', 'opticalPower', 'oltConfig', 'verification']);

const itemKey = (item: unknown, index: number): string => {
  if (!isObject(item)) return String(index);
  for (const key of ['id', 'portNumber', 'number', 'coreNumber']) if (item[key] !== undefined) return `${key}:${String(item[key])}`;
  return String(index);
};

const meaningful = (value: unknown) =>
  (typeof value === 'string' && value.trim() !== '') || (typeof value === 'number' && Number.isFinite(value) && value > 0);

/** Every link a network record holds, as `path=value` strings. Retired splices and released items do not count. */
export function linkKeysOf(record: Json | undefined): Set<string> {
  const keys = new Set<string>();
  const walk = (value: unknown, path: string, parentKey: string) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        if (isObject(item) && (item.retiredAt !== undefined || item.releasedAt !== undefined)) return;
        walk(item, `${path}[${itemKey(item, index)}]`, parentKey);
      });
      return;
    }
    if (!isObject(value)) return;
    for (const [key, child] of Object.entries(value)) {
      if (SKIP_BRANCHES.has(key)) continue;
      // A core given to a customer is an allocation, not a link.
      if (parentKey === 'cores' && (key === 'customerId' || key === 'customerName')) continue;
      const here = path ? `${path}.${key}` : key;
      if (Array.isArray(child) || isObject(child)) {
        walk(child, here, key);
        continue;
      }
      const isLink = (key.endsWith('Id') && !NOT_LINKS.has(key)) || LINK_PARTS.has(key);
      if (isLink && meaningful(child)) keys.add(`${here}=${String(child)}`);
    }
  };
  if (record) walk(record, '', '');
  return keys;
}

/** Every allocation a record holds: active core assignments, cores given to a customer, reserved ports. */
export function allocationKeysOf(collection: CollectionName, record: Json | undefined): Set<string> {
  const keys = new Set<string>();
  if (!record) return keys;
  const list = (value: unknown): Json[] => (Array.isArray(value) ? value.filter(isObject) : []);
  if (collection === 'cables') {
    for (const core of list(record.cores)) {
      const n = String(core.coreNumber);
      for (const a of list(core.assignments)) {
        if (a.releasedAt === undefined) keys.add(`core${n}:${String(a.id)}:${String(a.kind)}:${String(a.use)}:${String(a.customerId ?? '')}`);
      }
      if (meaningful(core.customerId)) keys.add(`core${n}:customer=${String(core.customerId)}`);
    }
  }
  if (collection === 'splitters') {
    for (const port of list(record.outputPorts)) if (port.status === 'Reserved') keys.add(`out${String(port.portNumber)}:reserved`);
  }
  if (collection === 'equipment') {
    for (const port of list(record.ponPorts)) if (port.status === 'Reserved') keys.add(`pon${String(port.id)}:reserved`);
    for (const panel of list(record.odfPanels)) {
      for (const port of list(panel.ports)) if (port.status === 'reserved') keys.add(`odf${String(panel.id)}/${String(port.number)}:reserved`);
    }
  }
  return keys;
}

const grew = (before: Set<string>, after: Set<string>) => [...after].some((key) => !before.has(key));

/**
 * What a change does, worked out from the stored record and the new one. A new record is `create`,
 * a removed one `delete`, anything else `edit` plus `move`, `connect`, `disconnect`, `allocate` or
 * `deallocate` when the change does that. Settings and catalogue changes also need `configure`.
 */
export function permissionsForChange(collection: CollectionName, before: Json | undefined, after: Json | undefined): PermissionAction[] {
  const needed = new Set<PermissionAction>();
  if (!before && after) needed.add('create');
  else if (before && !after) needed.add('delete');
  else if (before && after) {
    needed.add('edit');
    if (NETWORK_COLLECTIONS.has(collection)) {
      if (!same(positionOf(before), positionOf(after))) needed.add('move');
      const linksBefore = linkKeysOf(before);
      const linksAfter = linkKeysOf(after);
      if (grew(linksBefore, linksAfter)) needed.add('connect');
      if (grew(linksAfter, linksBefore)) needed.add('disconnect');
      const allocBefore = allocationKeysOf(collection, before);
      const allocAfter = allocationKeysOf(collection, after);
      if (grew(allocBefore, allocAfter)) needed.add('allocate');
      if (grew(allocAfter, allocBefore)) needed.add('deallocate');
    }
  }
  if (CONFIG_COLLECTIONS.has(collection) && needed.size > 0) needed.add('configure');
  return PERMISSION_ACTIONS.filter((action) => needed.has(action));
}
