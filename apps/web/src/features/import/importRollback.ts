import {
  AUDIT_ROLE_FOR,
  type AuditLog,
  type ChangeSet,
  checkChangeAccess,
  type CollectionName,
  describeAccessProblems,
  formatLogTimestamp,
  type NetworkData,
  planImportRollback,
  type RollbackPlan,
  uniqueId,
} from '@fibergis/shared';

import { ApiError, ApiUnavailableError, describeApiError } from '../../api/client';
import { syncEngine } from '../../api/syncEngine';
import { currentAccount, loginIsOn } from '../../stores/authStore';
import { getNetworkSnapshot } from '../../stores/networkStore';
import { useUiStore } from '../../stores/uiStore';

/**
 * Network mapping Phase 21: undo of one import ("rollback"). It is sent to the server as one change
 * set through `POST /changes`, like a bulk edit (Phase 16): the same permissions, link checks and
 * version checks apply to all of it at once, and one refusal refuses everything. Nothing changes on
 * this device until the server has stored it. The import record is kept, marked undone.
 */

export type RollbackOutcome = { ok: true; summary: string } | { ok: false; title: string; message: string };

const actorName = () => {
  const account = loginIsOn() ? currentAccount() : null;
  return account?.displayName ?? `${useUiStore.getState().userRole} (local session)`;
};

/** What the undo would do, or why it cannot, on the network this device holds now. */
export function previewRollback(importId: string, now = new Date()): RollbackPlan {
  return planImportRollback(getNetworkSnapshot() as unknown as NetworkData, importId, { now, actor: actorName() });
}

export async function rollbackImport(importId: string, note: string, now = new Date()): Promise<RollbackOutcome> {
  const data = getNetworkSnapshot();
  const plan = planImportRollback(data as unknown as NetworkData, importId, { now, actor: actorName(), note });
  if (!plan.ok) return { ok: false, title: plan.title, message: plan.message };

  // A record with unsent changes on this device would be sent twice in two ways; wait for "Sent".
  const unsent = syncEngine.unsentIds();
  const waiting = [...plan.record.created, ...plan.record.changed].find((r) => (unsent[r.collection] ?? []).includes(r.id)) ?? ((unsent.imports ?? []).includes(importId) ? { id: importId } : undefined);
  if (waiting) {
    return { ok: false, title: 'Not sent yet', message: `Nothing was changed. ${waiting.id} has changes on this device that are not sent yet. Wait until the sync shows "Sent", then try again.` };
  }

  const account = loginIsOn() ? currentAccount() : null;
  const role = useUiStore.getState().userRole;
  const log: AuditLog = {
    id: uniqueId('LOG'),
    timestamp: formatLogTimestamp(now),
    user: account ? account.displayName : `${role} (local session)`,
    role: account ? AUDIT_ROLE_FOR[account.role] : role,
    action: 'IMPORT_UNDONE',
    details: `Undid import ${importId} (${plan.record.fileName}): ${plan.summary}${note.trim() ? ` Reason: ${note.trim()}` : ''}`.slice(0, 1000),
    assetId: importId,
    assetType: 'Import',
  };
  const changes: ChangeSet = { ...plan.changes, upserts: { ...plan.changes.upserts, auditLogs: [log] } };

  // The same access rules the server applies, so the person hears at once in plain words.
  if (account) {
    const lookup = (c: CollectionName, id: string) => {
      const record = (data[c] as readonly { id: string }[] | undefined)?.find((r) => r.id === id);
      return record ? { record: record as unknown as Record<string, unknown> } : undefined;
    };
    const problems = checkChangeAccess(account, changes, lookup);
    if (problems.length > 0) return { ok: false, title: 'Not allowed for your account', message: `Nothing was changed. ${describeAccessProblems(problems)}` };
  }

  try {
    await syncEngine.sendAtomic(changes);
    return { ok: true, summary: plan.summary };
  } catch (error) {
    if (error instanceof ApiUnavailableError) return { ok: false, title: 'Needs the office server', message: error.message.includes('Nothing was changed') ? error.message : `${error.message} Nothing was changed.` };
    if (error instanceof ApiError) {
      if (error.isVersionConflict) {
        const first = error.conflicts[0];
        return { ok: false, title: 'Changed by someone else', message: `Nothing was changed. Someone else changed ${first ? first.id : 'one of these items'} since this device loaded it. Wait a moment for the latest copy, then look again.` };
      }
      return { ok: false, title: 'The server refused the undo', message: `Nothing was changed. ${describeApiError(error)}` };
    }
    return { ok: false, title: 'Not undone', message: `Nothing was changed. ${describeApiError(error)}` };
  }
}
