import type { FastifyReply, FastifyRequest } from 'fastify';

import {
  type Account,
  ACCOUNT_ROLE_LABELS,
  type AuditActor,
  AUDIT_ROLE_FOR,
  type AuthMode,
  type Cable,
  type ChangeSet,
  checkChangeAccess,
  type CollectionName,
  type Customer,
  describeAccessProblems,
  hiddenDiffFields,
  hiddenPersonalFields,
  holdsHiddenText,
  ownJobCustomerIds,
  type PermissionAction,
  PERMISSION_WORDS,
  type PrivacyViewer,
  redactNetworkForRole,
  redactRecordForRole,
  restoreHiddenCable,
  restoreHiddenCustomer,
  restoreHiddenSplitter,
  roleHasAction,
  roleHidesPersonalData,
  roleMay,
  roleNeedsOwnJobs,
  type Splitter,
  type SyncConflict,
  type SystemAction,
  type WorkOrder,
  type WriteSource,
} from '@fibergis/shared';

import { SETUP_ACTOR } from '../db/historyStore';
import type { NetworkRepository, WriteOptions } from '../db/repository';
import { HttpError } from '../lib/errors';
import type { SessionInfo } from './authStore';

/** Who is asking, worked out once per request by the session hook. */
export interface RequestAuth {
  mode: AuthMode;
  account: Account | null;
  session?: SessionInfo;
  /** No account exists yet and this device is not the server computer: it must wait for the first admin. */
  setupPending?: true;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: RequestAuth;
  }
}

export const SESSION_COOKIE = 'fibergis_session';

export const loginRequired = () =>
  new HttpError(401, 'login_required', 'Please log in. Anything saved on this device is kept and will be sent after you log in.');

export const forbidden = (message: string, details?: Record<string, unknown>) => new HttpError(403, 'forbidden', message, details);

const LOOPBACK_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * True only for the server computer itself: a loopback address, reached by a loopback name. The
 * name check matters because a dev proxy on this computer forwards phones from loopback too, and
 * because a page on another site can point its own name at 127.0.0.1 (DNS rebinding).
 */
export function isLocalRequest(request: FastifyRequest): boolean {
  if (!LOOPBACK_IPS.has(request.ip)) return false;
  const host = (request.host ?? '').toLowerCase();
  const name = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0];
  return LOOPBACK_HOSTS.has(name);
}

/** A temporary password must be changed first. Nothing was refused for good: change it and send again. */
export const passwordChangeRequired = () =>
  new HttpError(403, 'password_change_required', 'Choose your own password first. Anything saved on this device is kept and will be sent after that.');

const SYSTEM_WORDS: Record<SystemAction, string> = {
  reset: 'reset the network',
  restore: 'restore a backup',
  backup: 'download a full backup',
  manage_users: 'manage user accounts',
  change_settings: 'change settings',
  upload_photo: 'send photos',
  manage_monitoring: 'manage monitoring sources and tokens',
  import_monitoring: 'import monitoring files',
  manage_voice: 'make or approve voice lessons',
};

/** The account, or a 401 when login is on and nobody is logged in. In setup mode: null. */
export function accountOf(request: FastifyRequest): Account | null {
  if (request.auth.mode === 'setup') return request.auth.account;
  if (!request.auth.account) throw loginRequired();
  return request.auth.account;
}

/** Refuses a whole-network action this account may not take. Setup mode allows it (login is off). */
export function requireSystem(request: FastifyRequest, action: SystemAction): Account | null {
  const account = accountOf(request);
  if (!account || request.auth.mode === 'setup') return account;
  if (!roleMay(account.role, action)) {
    throw forbidden(`${ACCOUNT_ROLE_LABELS[account.role]} accounts cannot ${SYSTEM_WORDS[action]}. Ask the administrator.`);
  }
  return account;
}

/**
 * Audit entries are append-only once login is on: a new entry is stamped with the person who is
 * logged in (never what the browser says), an entry already stored is never changed, and deletes
 * are dropped (browsers keep only their newest 500; the server keeps all). A viewer adds nothing.
 */
export async function prepareAuditEntries(request: FastifyRequest, changes: ChangeSet, repository: NetworkRepository): Promise<ChangeSet> {
  const account = request.auth.mode === 'enforced' ? request.auth.account : null;
  if (!account) return changes;
  const next: ChangeSet = { ...changes };
  if (next.deletes?.auditLogs) {
    const { auditLogs: _dropped, ...rest } = next.deletes;
    next.deletes = rest;
  }
  const entries = next.upserts?.auditLogs;
  if (entries) {
    const kept = [];
    if (account.role !== 'viewer') {
      for (const entry of entries) {
        if (await repository.get('auditLogs', entry.id)) continue;
        kept.push({ ...entry, user: account.displayName, role: AUDIT_ROLE_FOR[account.role] });
      }
    }
    next.upserts = { ...next.upserts, auditLogs: kept };
    if (kept.length === 0) {
      const { auditLogs: _none, ...rest } = next.upserts;
      next.upserts = rest;
    }
  }
  return next;
}

/** Phase 23: who the server's audit events name for this request. */
export function auditActorOf(request: FastifyRequest): AuditActor {
  const account = request.auth.account;
  if (!account) return SETUP_ACTOR;
  return { id: account.id, name: account.displayName, role: account.role };
}

/**
 * Phase 23: refuses an action this role does not have (approve, export, configure...). Setup mode
 * allows it (login is off), as every other rule does.
 */
export function requireAction(request: FastifyRequest, action: PermissionAction): Account | null {
  const account = accountOf(request);
  if (!account || request.auth.mode === 'setup') return account;
  if (!roleHasAction(account.role, action)) {
    throw forbidden(`${ACCOUNT_ROLE_LABELS[account.role]} accounts cannot ${PERMISSION_WORDS[action]}. Ask a supervisor or the administrator.`);
  }
  return account;
}

/**
 * Write options for a change set: the access check (login on), who made it and how it came in.
 * The server's audit events and revisions are written for every write, login on or off.
 */
export function writeOptionsFor(request: FastifyRequest, changes: ChangeSet, source: WriteSource = 'changes'): WriteOptions {
  const account = request.auth.mode === 'enforced' ? accountOf(request) : null;
  const trace = { actor: auditActorOf(request), source };
  if (!account) return trace;
  return {
    ...trace,
    actorId: account.id,
    access: (lookup) => {
      const problems = checkChangeAccess(account, changes, lookup);
      if (problems.length > 0) {
        throw forbidden(describeAccessProblems(problems), {
          problems: problems.slice(0, 20).map(({ collection, id, action, permission }) => ({ collection, id, action, ...(permission ? { permission } : {}) })),
        });
      }
    },
  };
}

/**
 * Phase 12: who is reading, for the personal-data rules (`CUSTOMER_PRIVACY` in the shared code).
 * Setup mode (login off, the server computer only) sees everything, as every other rule.
 */
export const privacyViewerOf = (request: FastifyRequest): PrivacyViewer | null => {
  const account = request.auth.account;
  return account ? { role: account.role, displayName: account.displayName } : null;
};

/**
 * The customers on this person's own open jobs (a Field Technician sees those in full). Read from
 * the jobs given, or the stored ones. Empty for every other role.
 */
export async function ownJobsOf(request: FastifyRequest, repository: Pick<NetworkRepository, 'list'>, workOrders?: readonly WorkOrder[]): Promise<Set<string>> {
  const viewer = privacyViewerOf(request);
  if (!viewer || !roleNeedsOwnJobs(viewer)) return new Set();
  return ownJobCustomerIds(workOrders ?? (await repository.list('workOrders')), viewer.displayName);
}

type Redactable = { customers?: Customer[]; splitters?: Splitter[]; cables?: Cable[]; syncConflicts?: SyncConflict[]; workOrders?: WorkOrder[] };

/**
 * Phase 12: personal data this role does not need, taken out of a snapshot, area answer or changes
 * feed: customers' name, address, house position and mobile (see `CUSTOMER_PRIVACY`), the customer
 * names copied onto splitter outputs and fibers, and the sync conflict copies. Without `ownJobs`, the
 * jobs in `data` decide a technician's own customers. Nothing hidden is ever saved back
 * (`restoreHiddenPersonalData`).
 */
export function redactForViewer<T extends Redactable>(request: FastifyRequest, data: T, ownJobs?: ReadonlySet<string>): T {
  const viewer = privacyViewerOf(request);
  if (!roleHidesPersonalData(viewer)) return data;
  const own = ownJobs ?? (roleNeedsOwnJobs(viewer) && data.workOrders ? ownJobCustomerIds(data.workOrders, viewer!.displayName) : new Set<string>());
  return redactNetworkForRole(data, viewer, own);
}

/** The same for one record. `null` means leave it out (a sync conflict, for a look-only account). */
export const redactRecordForViewer = (request: FastifyRequest, collection: CollectionName, record: unknown, ownJobs: ReadonlySet<string> = new Set()): unknown =>
  redactRecordForRole(collection, record, privacyViewerOf(request), ownJobs);

/** Phase 12: an audit event's values this role may not see. The field names stay. */
export function redactAuditDiff<E extends { collection: string; recordId: string; diff: { field: string }[] }>(request: FastifyRequest, event: E, ownJobs: ReadonlySet<string> = new Set()): E {
  const hidden = hiddenDiffFields(event.collection, event.recordId, privacyViewerOf(request), ownJobs);
  if (hidden.size === 0) return event;
  return { ...event, diff: event.diff.map((d) => (hidden.has(d.field) ? { field: d.field } : d)) };
}

/**
 * Phase 12: a write never stores a value its writer could not see. A customer, splitter output,
 * fiber or sync conflict that comes back with "Hidden for your role" (or a hidden house position)
 * keeps the stored value; the `hiddenFields` mark is never stored. A value the writer changed is
 * kept, so the permission check still judges it.
 */
export async function restoreHiddenPersonalData(request: FastifyRequest, changes: ChangeSet, repository: Pick<NetworkRepository, 'get' | 'list'>): Promise<ChangeSet> {
  const up = changes.upserts;
  if (!up) return changes;
  const viewer = privacyViewerOf(request);
  const hidesGps = !!viewer && hiddenPersonalFields(viewer, '').includes('gps');
  const touchedCustomers = (up.customers ?? []).some((c) => c.hiddenFields || holdsHiddenText(c) || (hidesGps && c.lat === 0 && c.lng === 0));
  const touchedSplitters = (up.splitters ?? []).some(holdsHiddenText);
  const touchedCables = (up.cables ?? []).some(holdsHiddenText);
  const touchedConflicts = (up.syncConflicts ?? []).some(holdsHiddenText);
  if (!touchedCustomers && !touchedSplitters && !touchedCables && !touchedConflicts) return changes;
  const own = await ownJobsOf(request, repository);
  const next = { ...up };
  if (touchedCustomers) {
    next.customers = await Promise.all(
      (up.customers ?? []).map(async (c) => restoreHiddenCustomer(c, await repository.get('customers', c.id), hiddenPersonalFields(viewer, c.id, own))),
    );
  }
  const names = new Map((next.customers ?? []).map((c) => [c.id, c.name]));
  const nameOf = async (id: string) => names.get(id) ?? (await repository.get('customers', id))?.name;
  const resolveNames = async (ids: Iterable<string>) => {
    const out = new Map<string, string | undefined>();
    for (const id of ids) out.set(id, await nameOf(id));
    return (id: string) => out.get(id);
  };
  if (touchedSplitters) {
    next.splitters = await Promise.all(
      (up.splitters ?? []).map(async (s) => {
        if (!holdsHiddenText(s)) return s;
        const lookup = await resolveNames(s.outputPorts.flatMap((p) => (p.connectedCustomerId ? [p.connectedCustomerId] : [])));
        return restoreHiddenSplitter(s, await repository.get('splitters', s.id), lookup);
      }),
    );
  }
  if (touchedCables) {
    next.cables = await Promise.all(
      (up.cables ?? []).map(async (c) => {
        if (!holdsHiddenText(c)) return c;
        const ids = c.cores.flatMap((k) => [k.customerId, ...(k.assignments ?? []).map((a) => a.customerId)]).filter((id): id is string => !!id);
        return restoreHiddenCable(c, await repository.get('cables', c.id), await resolveNames(ids));
      }),
    );
  }
  if (touchedConflicts) {
    next.syncConflicts = await Promise.all(
      (up.syncConflicts ?? []).map(async (conflict) => {
        if (!holdsHiddenText(conflict)) return conflict;
        const stored = await repository.get('syncConflicts', conflict.id);
        return stored ? { ...conflict, mine: stored.mine, theirs: stored.theirs } : conflict;
      }),
    );
  }
  return { ...changes, upserts: next };
}

/** Writes the headers that keep personal answers out of shared caches. */
export const noStore = (reply: FastifyReply) => reply.header('cache-control', 'no-store');
