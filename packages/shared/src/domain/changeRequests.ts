import { z } from 'zod';

import { type ChangeSet, changeSetSchema, type RecordVersions } from '../model/api';
import type { CollectionName } from '../model/collections';
import { type Account, ACCOUNT_ROLE_LABELS } from './access';
import { roleHasAction } from './permissions';

/**
 * Phase 23: a change someone proposes, for another person to check before it is made. It moves
 * through: requested → approved or rejected → applied → verified (checked on site) → closed.
 *
 * Approving needs the `approve` right, and nobody approves their own request. Applying runs the
 * same checked write as any other change, with the rights of the person who applies it, so a request
 * can never do more than that person could do by hand. If a record changed after the request was
 * made, applying is refused (the request is out of date) and nothing is written.
 */

export const CHANGE_REQUEST_STATUSES = ['requested', 'approved', 'rejected', 'applied', 'verified', 'closed'] as const;
export type ChangeRequestStatus = (typeof CHANGE_REQUEST_STATUSES)[number];

export const CHANGE_REQUEST_STATUS_LABELS: Record<ChangeRequestStatus, string> = {
  requested: 'Waiting for approval',
  approved: 'Approved, not made yet',
  rejected: 'Rejected',
  applied: 'Made, not checked on site yet',
  verified: 'Made and checked',
  closed: 'Closed',
};

export type ChangeRequestEventKind = 'created' | 'approved' | 'rejected' | 'applied' | 'apply_failed' | 'verified' | 'closed' | 'comment';

export interface ChangeRequestEvent {
  at: string;
  byId: string | null;
  byName: string;
  kind: ChangeRequestEventKind;
  text?: string;
}

export interface ChangeRequestPerson {
  id: string | null;
  name: string;
}

export interface ChangeRequestSummaryLine {
  collection: CollectionName;
  upserts: number;
  deletes: number;
}

export interface ChangeRequest {
  id: string;
  title: string;
  reason: string;
  status: ChangeRequestStatus;
  changes: ChangeSet;
  /** The version each touched record had when the request was made. */
  baseVersions: RecordVersions;
  requestedBy: ChangeRequestPerson;
  requestedAt: string;
  reviewedBy?: ChangeRequestPerson;
  reviewedAt?: string;
  reviewNote?: string;
  appliedBy?: ChangeRequestPerson;
  appliedAt?: string;
  appliedRevision?: number;
  verifiedBy?: ChangeRequestPerson;
  verifiedAt?: string;
  closedAt?: string;
  events: ChangeRequestEvent[];
}

/** Most records one request may touch. A bigger job is several requests. */
export const CHANGE_REQUEST_MAX_RECORDS = 500;

export const createChangeRequestSchema = z.object({
  title: z.string().trim().min(1, 'Say in a few words what the change is.').max(120),
  reason: z.string().trim().max(1000).optional(),
  changes: changeSetSchema,
});

export const reviewChangeRequestSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  note: z.string().trim().max(1000).optional(),
});

export const changeRequestNoteSchema = z.object({ text: z.string().trim().min(1, 'Write the comment.').max(1000) });
export const closeChangeRequestSchema = z.object({ note: z.string().trim().max(1000).optional() });

/** How many records of each collection a change set adds, changes or deletes. */
export function summarizeChangeSet(changes: ChangeSet): ChangeRequestSummaryLine[] {
  const lines = new Map<CollectionName, ChangeRequestSummaryLine>();
  const line = (collection: CollectionName) => {
    const existing = lines.get(collection) ?? { collection, upserts: 0, deletes: 0 };
    lines.set(collection, existing);
    return existing;
  };
  for (const [collection, records] of Object.entries(changes.upserts ?? {}) as [CollectionName, unknown[] | undefined][]) {
    if (records?.length) line(collection).upserts += records.length;
  }
  for (const [collection, ids] of Object.entries(changes.deletes ?? {}) as [CollectionName, string[] | undefined][]) {
    if (ids?.length) line(collection).deletes += ids.length;
  }
  return [...lines.values()];
}

export const changeSetSize = (changes: ChangeSet): number => summarizeChangeSet(changes).reduce((sum, l) => sum + l.upserts + l.deletes, 0);

/** The change set without audit entries: the server writes its own record of an applied request. */
export function withoutAuditEntries(changes: ChangeSet): ChangeSet {
  const upserts = { ...(changes.upserts ?? {}) };
  const deletes = { ...(changes.deletes ?? {}) };
  delete upserts.auditLogs;
  delete deletes.auditLogs;
  return { upserts, deletes, ...(changes.expect ? { expect: changes.expect } : {}) };
}

export type ChangeRequestStep = 'approve' | 'reject' | 'apply' | 'verify' | 'close' | 'comment';

const isRequester = (request: ChangeRequest, account: Account) => request.requestedBy.id !== null && request.requestedBy.id === account.id;

/**
 * Why this account may not take this step on this request, in plain words, or null when it may.
 * `account` is null in setup mode (login off): every step its status allows is allowed, as
 * everything else is.
 */
export function changeRequestStepProblem(request: ChangeRequest, step: ChangeRequestStep, account: Account | null): string | null {
  return changeRequestRightsProblem(request, step, account) ?? changeRequestStatusProblem(request, step);
}

/** Why this account may not take this step at all (its role, or its own request), or null. */
export function changeRequestRightsProblem(request: ChangeRequest, step: ChangeRequestStep, account: Account | null): string | null {
  if (!account) return null;
  const approver = roleHasAction(account.role, 'approve');
  const label = ACCOUNT_ROLE_LABELS[account.role];
  switch (step) {
    case 'approve':
    case 'reject':
      if (!approver) return `${label} accounts cannot approve or reject change requests. Ask a supervisor or a network admin.`;
      if (isRequester(request, account)) return 'Someone else must check your own request. Ask a supervisor or a network admin.';
      return null;
    case 'apply':
      // Applying is checked record by record against the applier's own rights, like any change.
      return null;
    case 'verify':
      return approver ? null : `${label} accounts cannot mark a change as checked. Ask a supervisor or a network admin.`;
    case 'close':
      return approver || isRequester(request, account) ? null : 'Only the person who asked, or an approver, can close this request.';
    case 'comment':
      return approver || isRequester(request, account) ? null : 'Only the person who asked, or an approver, can comment on this request.';
  }
}

/** Why the request is not at a point where this step can be taken, or null. */
export function changeRequestStatusProblem(request: ChangeRequest, step: ChangeRequestStep): string | null {
  const now = CHANGE_REQUEST_STATUS_LABELS[request.status];
  switch (step) {
    case 'approve':
    case 'reject':
      return request.status === 'requested' ? null : `This request is "${now}", so it cannot be ${step === 'approve' ? 'approved' : 'rejected'} now.`;
    case 'apply':
      return request.status === 'approved' ? null : `Only an approved request can be made. This one is "${now}".`;
    case 'verify':
      return request.status === 'applied' ? null : `Only a request that has been made can be marked as checked. This one is "${now}".`;
    case 'close':
      return request.status === 'closed' ? 'This request is already closed.' : null;
    case 'comment':
      return request.status === 'closed' ? 'This request is closed. Make a new one if more is needed.' : null;
  }
}

/**
 * Who may see a request: everyone who works on the network (so an engineer can make an approved
 * one), not Read-only accounts. A request can hold whole customer records, phone numbers included.
 */
export const mayReadChangeRequest = (request: ChangeRequest, account: Account | null): boolean =>
  !account || account.role !== 'viewer' || isRequester(request, account);

/** Who may ask for a change: any role that may add or change something. Read-only accounts may not. */
export const mayRequestChange = (account: Account | null): boolean => !account || roleHasAction(account.role, 'create') || roleHasAction(account.role, 'edit');
