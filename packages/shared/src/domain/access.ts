import { z } from 'zod';

import type { ChangeSet } from '../model/api';
import { type CollectionName } from '../model/collections';
import type { UserRole } from '../model/enums';
import { type PermissionAction, PERMISSION_WORDS, permissionsForChange, roleHasAction } from './permissions';

/**
 * Phase 9: who may do what. One set of rules, run by the server on every write (the last line) and
 * by the browser before a change is made (so a person is told at once, in plain words).
 *
 * While no account exists the server runs in "setup" mode and these rules are not applied: the app
 * behaves as before login existed, so the owner is never locked out of their own network.
 */

/**
 * Phase 23: eight roles. The five stored role names from Phase 9 are kept exactly as they are, so
 * every existing account keeps the same rights with no change to the database:
 * `admin` is Super Admin, `engineer` is GIS Engineer, `office` is Network Planner, `technician` is
 * Field Technician and `viewer` is Read-only. Three are new: `network_admin`, `noc` and `supervisor`.
 */
export const ACCOUNT_ROLES = ['admin', 'network_admin', 'engineer', 'office', 'technician', 'noc', 'supervisor', 'viewer'] as const;
export const accountRoleSchema = z.enum(ACCOUNT_ROLES);
export type AccountRole = z.infer<typeof accountRoleSchema>;
export const isAccountRole = (value: string): value is AccountRole => (ACCOUNT_ROLES as readonly string[]).includes(value);

/** Other spellings of a role a person or a script may send. Each maps to the stored name. */
const ROLE_ALIASES: Record<string, AccountRole> = {
  super_admin: 'admin',
  superadmin: 'admin',
  administrator: 'admin',
  networkadmin: 'network_admin',
  gis_engineer: 'engineer',
  network_engineer: 'engineer',
  network_planner: 'office',
  planner: 'office',
  field_technician: 'technician',
  noc_operator: 'noc',
  read_only: 'viewer',
  readonly: 'viewer',
};

/**
 * The stored role name for a role as written anywhere (old or new name, any case, spaces or
 * dashes). Undefined when it is not a role at all; callers then give the least rights (Read-only).
 */
export function normalizeAccountRole(value: unknown): AccountRole | undefined {
  if (typeof value !== 'string') return undefined;
  const key = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (isAccountRole(key)) return key;
  return ROLE_ALIASES[key] ?? ROLE_ALIASES[key.replace(/_/g, '')];
}

/** A role sent to the API: any spelling `normalizeAccountRole` knows. */
export const accountRoleInputSchema = z
  .string()
  .transform((value, ctx) => {
    const role = normalizeAccountRole(value);
    if (!role) {
      ctx.addIssue({ code: 'custom', message: `Not a role. Use one of: ${ACCOUNT_ROLES.join(', ')}.` });
      return z.NEVER;
    }
    return role;
  });

/** What the role is called on screen. */
export const ACCOUNT_ROLE_LABELS: Record<AccountRole, string> = {
  admin: 'Super Admin',
  network_admin: 'Network Admin',
  engineer: 'GIS Engineer',
  office: 'Network Planner',
  technician: 'Field Technician',
  noc: 'NOC Operator',
  supervisor: 'Supervisor',
  viewer: 'Read-only',
};

/** What each role may do, in one plain line, for the user list and the login help. */
export const ACCOUNT_ROLE_DUTIES: Record<AccountRole, string> = {
  admin: 'Everything, including users, reset, restore and full backups.',
  network_admin: 'Everything on the network, settings, approvals and monitoring sources. Not users, reset, restore or full backups.',
  engineer: 'Add, change, move, connect and delete network records; settings and lists. Not approvals, users, reset or restore.',
  office: 'Plan and change records (customers, faults, jobs, network). Cannot delete network records or change settings.',
  technician: 'Field capture, light readings and their own jobs. Cannot delete network records.',
  noc: 'Watch the network: faults, alarms and jobs. Cannot change network items.',
  supervisor: 'Faults and jobs (give, close), and approve change requests. Cannot change network items.',
  viewer: 'Look only. Cannot change or export anything.',
};

/** The audit trail's older role field (a fixed list in saved entries). New roles use the nearest older one. */
export const AUDIT_ROLE_FOR: Record<AccountRole, UserRole> = {
  admin: 'Administrator',
  network_admin: 'Administrator',
  engineer: 'Network Engineer',
  office: 'Network Operator',
  technician: 'Field Technician',
  noc: 'Network Operator',
  supervisor: 'Supervisor',
  viewer: 'Viewer',
};

/** The person behind a request, as both sides know them. Never carries a password or token. */
export interface Account {
  id: string;
  username: string;
  displayName: string;
  role: AccountRole;
}

export interface AccountSummary extends Account {
  active: boolean;
  mustChangePassword: boolean;
  createdAt: string;
  lastLoginAt?: string;
}

export type AuthMode = 'setup' | 'enforced';

export interface AuthStatus {
  /** `setup`: no account exists yet, login is off. `enforced`: every request needs a session. */
  mode: AuthMode;
  account: Account | null;
  mustChangePassword?: boolean;
  /** Shortest password the server accepts. */
  passwordMinLength: number;
  /**
   * No account exists yet and this device is not the server computer, so it is locked until the
   * first administrator is made on the server computer. `setupCodeAccepted`: it may be made here
   * with the server's setup code instead.
   */
  setupPending?: boolean;
  setupCodeAccepted?: boolean;
  /** Phase 23b: the organisation whose data this session works on (absent when not logged in and not in setup mode). */
  organisation?: { id: string; name: string };
  /** Phase 23b: this account may list, add, switch off and switch on organisations (an administrator of the first organisation). */
  platformAdmin?: boolean;
}

/** Phase 23b: one organisation (ISP) on this server. Each has its own database file, photos, voice clips and backups. */
export type OrganisationStatus = 'active' | 'suspended';

export interface OrganisationSummary {
  id: string;
  name: string;
  /** `suspended`: nobody in it can log in, and its monitoring tokens stop working. Its data is kept. */
  status: OrganisationStatus;
  /** The first organisation: the server's own database. Its administrators manage the organisations. */
  host: boolean;
  createdAt: string;
  updatedAt: string;
  /** Accounts switched on in it. */
  activeAccounts: number;
}

/** Phase 23b: something the platform administrator did, kept for good in the control database. */
export interface PlatformEvent {
  seq: number;
  at: string;
  actorId: string | null;
  actorName: string;
  action: string;
  organisationId: string | null;
  details: string;
}

export const organisationNameSchema = z.string().trim().min(2, 'An organisation name is at least 2 characters.').max(80);

export const PASSWORD_MAX_LENGTH = 200;

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9._-]{1,39}$/, 'A login name is 2 to 40 letters or digits (also ".", "_" or "-"), starting with a letter or digit.');

export const displayNameSchema = z.string().trim().min(1, 'Enter the person’s name.').max(80);

export const loginRequestSchema = z.object({
  username: z.string().trim().toLowerCase().min(1).max(40),
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

export const passwordSchema = (minLength: number) =>
  z
    .string()
    .min(minLength, `The password must be at least ${minLength} characters.`)
    .max(PASSWORD_MAX_LENGTH, `The password must be at most ${PASSWORD_MAX_LENGTH} characters.`);

/* ------------------------------------------------------------------ */
/* Permission rules                                                    */
/* ------------------------------------------------------------------ */

export type AccessAction = 'create' | 'update' | 'delete';

/** Bike Mode, trips and conflict records: kept by each device for its own person. */
const PERSONAL: readonly CollectionName[] = ['gpsRoutes', 'agentTrips', 'syncConflicts'];

/** Light-reading fields a technician may set on a customer from the field (`recordFieldRxReading`). */
const FIELD_RX_FIELDS = new Set(['rxOpticalPowerDbm', 'rxSource', 'rxMeasuredAt', 'rxLaunchDbm', 'rxPhotoId', 'rxCaptureId']);

const COLLECTION_WORDS: Partial<Record<CollectionName, string>> = {
  equipment: 'network item',
  cables: 'cable',
  splitters: 'splitter',
  closures: 'closure',
  customers: 'customer',
  faults: 'fault',
  workOrders: 'job',
  auditLogs: 'audit entry',
  settings: 'setting',
  catalog: 'catalogue entry',
  spans: 'span',
  alarms: 'alarm',
  syncConflicts: 'conflict record',
  rfElements: 'Cable TV item',
  rfLinks: 'Cable TV link',
  rfLevels: 'Cable TV level',
  inspections: 'inspection',
  sites: 'site',
  racks: 'rack',
  cableSegments: 'cable stretch',
  linkVerifications: 'link check',
  validationFindings: 'map check finding',
  planningScenarios: 'planning scenario',
  // Network mapping Phase 17: engineers, network admins and planners store them; nobody deletes one.
  opticalBudgetRuns: 'optical budget run',
  imports: 'import record',
};

const word =(collection: CollectionName) => COLLECTION_WORDS[collection] ?? collection;

const ACTION_WORDS: Record<AccessAction, string> = { create: 'add', update: 'change', delete: 'delete' };

export interface AccessProblem {
  collection: CollectionName;
  id: string;
  action: AccessAction;
  /** Phase 23: the kind of change the role may not make, when that was the reason. */
  permission?: PermissionAction;
  /** Plain words with a next action. */
  message: string;
}

/**
 * What a reader knows about a stored record. `createdBy` is the account id the server recorded
 * when the record was first stored: `null` when not recorded (older records, setup mode),
 * `undefined` when this side cannot know (the browser), so the browser leaves that to the server.
 */
export interface StoredRecord {
  record: Record<string, unknown>;
  createdBy?: string | null;
}

export type StoredLookup = (collection: CollectionName, id: string) => StoredRecord | undefined;

/** True when two JSON values are the same, ignoring key order and unset fields. */
export function sameJson(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, i) => sameJson(item, b[i]));
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
    if (!sameJson(left[key], right[key])) return false;
  }
  return true;
}

const changedKeys = (before: Record<string, unknown>, after: Record<string, unknown>): string[] =>
  [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((key) => !sameJson(before[key], after[key]));

/** Simple yes or no for showing or hiding a button. The full check (own jobs, field captures) is `checkChangeAccess`. */
export function roleCan(role: AccountRole, action: AccessAction, collection: CollectionName): boolean {
  if (collection === 'auditLogs') return action === 'create' && role !== 'viewer';
  switch (role) {
    case 'admin':
    case 'network_admin':
    case 'engineer':
      return true;
    case 'noc':
      // Phase 23: watches the network; opens and updates faults, alarms and jobs. Never network items.
      if (PERSONAL.includes(collection)) return true;
      if (action === 'delete') return false;
      return ['faults', 'alarms', 'workOrders', 'documents'].includes(collection);
    case 'supervisor':
      // Phase 23: gives and closes jobs, follows faults, approves change requests. Never network items.
      if (PERSONAL.includes(collection)) return true;
      if (action === 'delete') return false;
      if (action === 'create') return ['faults', 'workOrders', 'documents'].includes(collection);
      return ['faults', 'alarms', 'workOrders', 'documents'].includes(collection);
    case 'office':
      // Phase 2: the catalogue is configuration, changed by the same people as settings.
      if (collection === 'settings' || collection === 'catalog') return false;
      if (action !== 'delete') return true;
      // Network mapping Phase 18: planners keep their own expansion scenarios, which are never network records.
      return collection === 'documents' || collection === 'planningScenarios' || PERSONAL.includes(collection);
    case 'technician':
      if (PERSONAL.includes(collection)) return true;
      // Network mapping Phase 13: link checks are field evidence, like inspections.
      if (action === 'create') return ['equipment', 'faults', 'spans', 'alarms', 'rfLevels', 'inspections', 'linkVerifications'].includes(collection);
      if (action === 'update') return ['workOrders', 'customers', 'equipment', 'faults', 'spans', 'inspections', 'linkVerifications'].includes(collection);
      return ['equipment', 'faults', 'spans', 'inspections', 'linkVerifications'].includes(collection);
    case 'viewer':
      return false;
  }
}

const isFieldCapture = (collection: CollectionName, record: Record<string, unknown> | undefined): boolean => {
  if (!record) return false;
  if (collection === 'equipment' || collection === 'faults') return record.captureSource === 'field_capture';
  if (collection === 'spans') return record.basis === 'field_sequence' && record.status === 'proposed';
  // Phase 4: an inspection is field evidence. A technician may add one, and change or remove only their own.
  if (collection === 'inspections') return true;
  // Network mapping Phase 13: so is a check of a link (OTDR, red light, meter reading). Their own only.
  if (collection === 'linkVerifications') return true;
  return false;
};

/** `undefined` when this side cannot know (the browser). */
const ownedBy = (stored: StoredRecord, account: Account): boolean | undefined =>
  stored.createdBy === undefined ? undefined : stored.createdBy === account.id;

const refuse = (collection: CollectionName, id: string, action: AccessAction, message: string): AccessProblem => ({ collection, id, action, message });

const noRight = (account: Account, collection: CollectionName, id: string, action: AccessAction): AccessProblem =>
  refuse(
    collection,
    id,
    action,
    account.role === 'viewer'
      ? 'This account can only look. Nothing was changed. Ask the office for a working account.'
      : `${ACCOUNT_ROLE_LABELS[account.role]} accounts cannot ${ACTION_WORDS[action]} a ${word(collection)} (${id}). Nothing was changed. Ask ${askWhom(account.role)}.`,
  );

const askWhom = (role: AccountRole) => (role === 'technician' ? 'the office or an engineer' : 'an engineer or the administrator');

/** Phase 23: the role may change this record but not in this way (move, connect, allocate...). */
const noPermission = (account: Account, collection: CollectionName, id: string, action: AccessAction, permission: PermissionAction): AccessProblem => ({
  ...refuse(
    collection,
    id,
    action,
    `${ACCOUNT_ROLE_LABELS[account.role]} accounts cannot ${PERMISSION_WORDS[permission]}. ${word(collection)} ${id} was not changed. Ask ${askWhom(account.role)}, or send a change request.`,
  ),
  permission,
});

/** Phase 19: the office review of a phone capture (`fieldReview.ts`). */
const REVIEW_KEYS = ['reviewStatus', 'reviewedAt', 'reviewedBy', 'reviewReason'] as const;
const DECIDED = new Set(['accepted', 'rejected']);

/**
 * Phase 19: a technician's capture goes in waiting for the office (or, from an older phone app, with
 * no review status at all). Only the office accepts or rejects it, and once it has, the record is
 * the office's: the technician can no longer change or undo it.
 */
function fieldReviewProblem(collection: CollectionName, id: string, action: AccessAction, after: Record<string, unknown> | undefined, before: Record<string, unknown> | undefined): AccessProblem | null {
  if (collection !== 'equipment') return null;
  if (before && DECIDED.has(String(before.reviewStatus))) {
    return refuse(collection, id, action, `The office has already checked ${id}, so it was not changed. Call the office if it is wrong.`);
  }
  if (after && DECIDED.has(String(after.reviewStatus))) {
    return refuse(collection, id, action, `Only the office accepts or rejects field captures. ${id} was not changed.`);
  }
  if (before && after && REVIEW_KEYS.some((key) => !sameJson(before[key], after[key]))) {
    return refuse(collection, id, action, `Only the office changes the review of a field capture. ${id} was not changed.`);
  }
  return null;
}

/** A technician's write: field captures, light readings, their own jobs, their own trips and conflict records. */
function technicianProblem(account: Account, collection: CollectionName, id: string, action: AccessAction, after: Record<string, unknown> | undefined, stored: StoredRecord | undefined): AccessProblem | null {
  if (PERSONAL.includes(collection)) return null;
  const review = fieldReviewProblem(collection, id, action, after, stored?.record);
  if (review) return review;
  if (action === 'create') {
    if (collection === 'alarms') return after?.source === 'field_report' ? null : refuse(collection, id, action, 'From the phone you can report a problem, not add an office alarm. Nothing was changed.');
    // Phase 6: a Cable TV level read on site, with the meter photo.
    if (collection === 'rfLevels') {
      return after?.origin === 'field_measured' && typeof after.photoId === 'string'
        ? null
        : refuse(collection, id, action, 'From the field you can record a level you read on the meter, with a photo of the meter. Nothing was saved.');
    }
    if (isFieldCapture(collection, after)) return null;
    return refuse(collection, id, action, `Technicians add items with Field capture only. ${id} was not added. Use the Field capture screen, or ask the office.`);
  }
  if (!stored) return noRight(account, collection, id, action);
  const before = stored.record;
  if (action === 'delete') {
    // Undo of their own capture, just made on this phone. Anything else stays with the office.
    if (isFieldCapture(collection, before) && ownedBy(stored, account) !== false) return null;
    return refuse(collection, id, action, `Technicians cannot delete network records. ${id} was kept. Ask the office or an engineer if it is wrong.`);
  }
  // Update.
  if (collection === 'workOrders') {
    if (before.technicianName !== account.displayName) return refuse(collection, id, action, `Job ${id} is not yours, so it was not changed. Call the office.`);
    if (after && after.technicianName !== before.technicianName) {
      return refuse(collection, id, action, `Only the office can give job ${id} to someone else. Nothing was changed.`);
    }
    const status = after?.status;
    if (status !== before.status && (status === 'Closed' || status === 'Cancelled')) {
      return refuse(collection, id, action, `The office closes jobs. Job ${id} was not closed.`);
    }
    return null;
  }
  if (collection === 'customers') {
    const changed = after ? changedKeys(before, after) : [];
    if (changed.every((key) => FIELD_RX_FIELDS.has(key))) return null;
    return refuse(collection, id, action, `From the field you can record a light reading only. Customer ${id} was not changed. Tell the office what is wrong.`);
  }
  if (isFieldCapture(collection, before) && ownedBy(stored, account) !== false && (!after || isFieldCapture(collection, after))) return null;
  return noRight(account, collection, id, action);
}

const DEVICE_READING_FIELDS = ['rxSource', 'rxOpticalPowerDbm', 'rxMeasuredAt'] as const;
/** What the office writes when it decides a conflict a phone left to it; never the copies themselves. */
const CONFLICT_DECISION_FIELDS = new Set(['status', 'decidedAt', 'decidedBy']);

/**
 * A customer light reading may say "reported by the device" only when it came from the monitoring
 * connection (Phase 7), never typed in. Keeping one already stored is fine.
 */
function deviceReadingProblem(id: string, after: Record<string, unknown>, before: Record<string, unknown> | undefined): AccessProblem | null {
  if (after.rxSource !== 'device_reported') return null;
  if (before && DEVICE_READING_FIELDS.every((key) => sameJson(before[key], after[key]))) return null;
  return refuse(
    'customers',
    id,
    before ? 'update' : 'create',
    `A reading "reported by the device" comes only from the OLT connection. Customer ${id} was not changed. Save a meter reading as "measured on site" with a photo instead.`,
  );
}

/**
 * Which writes in a change set this account may not make. Audit entries are not judged here: the
 * server keeps them append-only (a new one is stamped with the real person; an old one is never
 * changed or deleted). An upsert that equals the stored record changes nothing and is allowed.
 */
export function checkChangeAccess(account: Account, changes: ChangeSet, lookup: StoredLookup): AccessProblem[] {
  const problems: AccessProblem[] = [];
  const consider = (collection: CollectionName, id: string, after: Record<string, unknown> | undefined) => {
    if (collection === 'auditLogs') return;
    const stored = lookup(collection, id);
    if (after && stored && sameJson(after, stored.record)) return;
    if (!after && !stored) return; // Already gone.
    const action: AccessAction = !after ? 'delete' : stored ? 'update' : 'create';
    if (!roleCan(account.role, action, collection)) {
      problems.push(noRight(account, collection, id, action));
      return;
    }
    // Phase 23: what the change does (move, connect, allocate, configure...) must be allowed too.
    const missing = permissionsForChange(collection, stored?.record, after).find((permission) => !roleHasAction(account.role, permission));
    if (missing) {
      problems.push(account.role === 'viewer' ? noRight(account, collection, id, action) : noPermission(account, collection, id, action, missing));
      return;
    }
    // Trips, routes and sync conflicts belong to the person who made them. Only an engineer or an
    // administrator may change someone else's (a conflict copy could otherwise be filled with any
    // change and then saved by an office user who trusts it).
    const officeDecision =
      collection === 'syncConflicts' &&
      (account.role === 'office' || account.role === 'supervisor') &&
      !!after &&
      !!stored &&
      changedKeys(stored.record, after).every((key) => CONFLICT_DECISION_FIELDS.has(key));
    const maySeeAll = account.role === 'admin' || account.role === 'network_admin' || account.role === 'engineer';
    if (stored && PERSONAL.includes(collection) && !maySeeAll && !officeDecision && ownedBy(stored, account) === false) {
      problems.push(refuse(collection, id, action, `This ${word(collection)} (${id}) belongs to someone else, so it was not changed.`));
      return;
    }
    const fake = after && collection === 'customers' ? deviceReadingProblem(id, after, stored?.record) : null;
    if (fake) {
      problems.push(fake);
      return;
    }
    if (account.role === 'technician') {
      const problem = technicianProblem(account, collection, id, action, after, stored);
      if (problem) problems.push(problem);
    }
  };
  for (const [collection, records] of Object.entries(changes.upserts ?? {}) as [CollectionName, { id: string }[]][]) {
    for (const record of records ?? []) consider(collection, record.id, record as unknown as Record<string, unknown>);
  }
  for (const [collection, ids] of Object.entries(changes.deletes ?? {}) as [CollectionName, string[]][]) {
    for (const id of ids ?? []) consider(collection, id, undefined);
  }
  return problems;
}

/** One line for a refusal: the first problem, and how many more. */
export function describeAccessProblems(problems: readonly AccessProblem[]): string {
  if (problems.length === 0) return '';
  const [first] = problems;
  return problems.length > 1 ? `${first.message} (${problems.length - 1} more not allowed.)` : first.message;
}

/** Whole-network actions with their own rule. */
export type SystemAction =
  | 'reset'
  | 'restore'
  | 'backup'
  | 'manage_users'
  | 'change_settings'
  | 'upload_photo'
  /** Phase 7: make, change or switch off monitoring sources and their push tokens, run the TEST simulator. */
  | 'manage_monitoring'
  /** Phase 7: import a CSV or TSV export from the OLT or NMS. */
  | 'import_monitoring'
  /** Learning assistant: generate (paid) and approve voice clips. */
  | 'manage_voice';

export function roleMay(role: AccountRole, action: SystemAction): boolean {
  switch (action) {
    case 'reset':
    case 'restore':
    case 'backup':
    case 'manage_users':
    case 'manage_voice':
      return role === 'admin';
    case 'manage_monitoring':
      return role === 'admin' || role === 'network_admin';
    case 'import_monitoring':
      return role === 'admin' || role === 'network_admin' || role === 'engineer' || role === 'noc';
    case 'change_settings':
      return roleHasAction(role, 'configure');
    case 'upload_photo':
      return role !== 'viewer';
  }
}
