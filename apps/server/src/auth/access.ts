import type { FastifyReply, FastifyRequest } from 'fastify';

import {
  type Account,
  ACCOUNT_ROLE_LABELS,
  AUDIT_ROLE_FOR,
  type AuthMode,
  type ChangeSet,
  checkChangeAccess,
  type CollectionName,
  type Customer,
  describeAccessProblems,
  roleMay,
  type SystemAction,
} from '@fibergis/shared';

import type { NetworkRepository, WriteOptions } from '../db/repository';
import { HttpError } from '../lib/errors';
import type { SessionInfo } from './authStore';

/** Who is asking, worked out once per request by the session hook. */
export interface RequestAuth {
  mode: AuthMode;
  account: Account | null;
  session?: SessionInfo;
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

const SYSTEM_WORDS: Record<SystemAction, string> = {
  reset: 'reset the network',
  restore: 'restore a backup',
  backup: 'download a full backup',
  manage_users: 'manage user accounts',
  change_settings: 'change settings',
  upload_photo: 'send photos',
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

/** Write options for a change set: the access check (login on) and who made it. */
export function writeOptionsFor(request: FastifyRequest, changes: ChangeSet): WriteOptions {
  const account = request.auth.mode === 'enforced' ? accountOf(request) : null;
  if (!account) return {};
  return {
    actorId: account.id,
    access: (lookup) => {
      const problems = checkChangeAccess(account, changes, lookup);
      if (problems.length > 0) {
        throw forbidden(describeAccessProblems(problems), { problems: problems.slice(0, 20).map(({ collection, id, action }) => ({ collection, id, action })) });
      }
    },
  };
}

const HIDDEN = 'Hidden for look-only accounts';

/** Personal data a viewer does not need: phone numbers. Viewers never write, so nothing hidden is ever saved back. */
export function redactForViewer<T extends { customers?: Customer[] }>(request: FastifyRequest, data: T): T {
  if (request.auth.account?.role !== 'viewer') return data;
  return { ...data, customers: data.customers?.map((c) => ({ ...c, mobile: c.mobile ? HIDDEN : c.mobile })) };
}

export const redactRecordForViewer = (request: FastifyRequest, collection: CollectionName, record: unknown): unknown =>
  collection === 'customers' && request.auth.account?.role === 'viewer' && record && typeof record === 'object' && (record as Customer).mobile
    ? { ...(record as Customer), mobile: HIDDEN }
    : record;

/** Writes the headers that keep personal answers out of shared caches. */
export const noStore = (reply: FastifyReply) => reply.header('cache-control', 'no-store');
