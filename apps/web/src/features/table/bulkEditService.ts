import {
  AUDIT_ROLE_FOR,
  type AuditLog,
  type BulkFieldEdit,
  type ChangeSet,
  checkChangeAccess,
  type CollectionName,
  describeAccessProblems,
  describeBulkEditProblems,
  formatLogTimestamp,
  planBulkEdit,
  uniqueId,
} from '@fibergis/shared';

import { ApiError, ApiUnavailableError, describeApiError } from '../../api/client';
import { syncEngine } from '../../api/syncEngine';
import { currentAccount, loginIsOn, mayDo } from '../../stores/authStore';
import { getNetworkSnapshot } from '../../stores/networkStore';
import { useUiStore } from '../../stores/uiStore';

/**
 * Phase 16: bulk edit, sent to the server as one change set through `POST /changes`, where every
 * rule (schema, links, fibres, connections, permissions, versions) is applied to all of it in one
 * transaction. One failing record refuses the whole set; the reply names that record and why.
 * Nothing is changed on this device until the server has stored it, and nothing is queued.
 */

export type BulkEditOutcome =
  | { ok: true; changed: number; unchanged: number }
  | { ok: false; message: string; recordId?: string };

/** The record a server issue path ("upserts.cables.3.owner") points at. */
function recordOfIssue(path: string, collection: CollectionName, changed: readonly { id: string }[]): string | undefined {
  const parts = path.split('.');
  const at = parts.indexOf(collection);
  const index = at >= 0 ? Number(parts[at + 1]) : NaN;
  return Number.isInteger(index) ? changed[index]?.id : undefined;
}

export async function saveBulkEdit(collection: CollectionName, ids: readonly string[], edits: readonly BulkFieldEdit[], now = new Date()): Promise<BulkEditOutcome> {
  if (!mayDo('edit')) return { ok: false, message: 'Your account cannot change items. Nothing was changed. Ask the office or an engineer, or send a change request.' };
  const data = getNetworkSnapshot();
  const records = data[collection] as readonly { id: string; name?: string }[];

  // A record with unsent changes on this device would be sent twice in two ways; wait for "Sent".
  const unsent = new Set(syncEngine.unsentIds()[collection] ?? []);
  const waiting = ids.find((id) => unsent.has(id));
  if (waiting) {
    const name = records.find((r) => r.id === waiting)?.name;
    return { ok: false, recordId: waiting, message: `Nothing was changed. ${name ? `${name} (${waiting})` : waiting} has changes on this device that are not sent yet. Wait until the sync shows "Sent", then try again.` };
  }

  const account = loginIsOn() ? currentAccount() : null;
  const actor = account?.displayName ?? `${useUiStore.getState().userRole} (local session)`;
  const plan = planBulkEdit(collection, records, ids, edits, { now, actor });
  if (!plan.ok) return { ok: false, message: describeBulkEditProblems(plan.problems), recordId: plan.problems[0]?.id || undefined };
  if (plan.changed.length === 0) return { ok: true, changed: 0, unchanged: plan.unchanged.length };

  const fields = edits.map((e) => `${e.field} ${e.value === undefined ? 'cleared (not recorded)' : `set to "${String(e.value)}"`}`).join(', ');
  const role = useUiStore.getState().userRole;
  const log: AuditLog = {
    id: uniqueId('LOG'),
    timestamp: formatLogTimestamp(now),
    user: account ? account.displayName : `${role} (local session)`,
    role: account ? AUDIT_ROLE_FOR[account.role] : role,
    action: 'BULK_EDIT',
    details: `Changed ${plan.changed.length} ${collection} at once: ${fields}. Items: ${plan.changed
      .slice(0, 20)
      .map((r) => r.id)
      .join(', ')}${plan.changed.length > 20 ? `, and ${plan.changed.length - 20} more` : ''}`.slice(0, 1000),
    assetId: 'BULK',
    assetType: 'System',
  };
  const changes: ChangeSet = { upserts: { [collection]: plan.changed, auditLogs: [log] } as ChangeSet['upserts'] };

  // The same access rules the server applies, so the person hears at once in plain words.
  if (account) {
    const lookup = (c: CollectionName, id: string) => {
      const record = (data[c] as readonly { id: string }[] | undefined)?.find((r) => r.id === id);
      return record ? { record: record as unknown as Record<string, unknown> } : undefined;
    };
    const problems = checkChangeAccess(account, changes, lookup);
    if (problems.length > 0) return { ok: false, message: `Nothing was changed. ${describeAccessProblems(problems)}`, recordId: problems[0].id };
  }

  try {
    await syncEngine.sendAtomic(changes);
    return { ok: true, changed: plan.changed.length, unchanged: plan.unchanged.length };
  } catch (error) {
    if (error instanceof ApiUnavailableError) return { ok: false, message: error.message.includes('Nothing was changed') ? error.message : `${error.message} Nothing was changed.` };
    if (error instanceof ApiError) {
      if (error.isVersionConflict) {
        const first = error.conflicts[0];
        return { ok: false, recordId: first?.id, message: `Nothing was changed. Someone else changed ${first ? first.id : 'one of these items'} since this device loaded it. Wait a moment for the latest copy, then try again.` };
      }
      const issue = error.issues[0];
      const recordId = issue ? recordOfIssue(issue.path, collection, plan.changed as { id: string }[]) : undefined;
      const problems = Array.isArray(error.body.problems) ? (error.body.problems as { id?: string }[]) : [];
      return { ok: false, recordId: recordId ?? problems[0]?.id, message: `Nothing was changed. ${recordId ? `${recordId}: ` : ''}${describeApiError(error)}` };
    }
    return { ok: false, message: `Nothing was changed. ${describeApiError(error)}` };
  }
}
