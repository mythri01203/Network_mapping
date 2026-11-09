import { useState } from 'react';
import { GitMerge } from 'lucide-react';

import { isCollectionName, SYNC_CONFLICT_STATUS_LABELS, type SyncConflict } from '@fibergis/shared';

import { useNetworkStore } from '../../stores/networkStore';
import { showToast } from '../../stores/toastStore';
import { useUiStore } from '../../stores/uiStore';
import { fieldsThatWouldChange, fieldsToCompare, showValue } from './conflictFormat';

function decide(conflict: SyncConflict, choice: 'field' | 'office') {
  const store = useNetworkStore.getState();
  const who = `${useUiStore.getState().userRole} (office)`;
  if (choice === 'field' && isCollectionName(conflict.collection)) {
    store.putRecord(conflict.collection, conflict.recordId, conflict.mine as { id: string } | null);
  }
  const status = choice === 'field' ? 'office_used_field' : 'office_kept_office';
  store.saveSyncConflict({ ...conflict, status, decidedAt: new Date().toISOString(), decidedBy: who });
  store.logAudit({
    action: 'SYNC_CONFLICT_DECIDED',
    details: `${conflict.label}: ${SYNC_CONFLICT_STATUS_LABELS[status]} (conflict ${conflict.id}; both versions kept)`,
    assetId: conflict.id,
    assetType: 'SyncConflict',
  });
  showToast('success', 'Decided', `${conflict.label}: ${SYNC_CONFLICT_STATUS_LABELS[status]}. Both versions stay in this list.`);
}

/**
 * Records two people changed at the same time (Phase 8). Each keeps both versions. The office
 * decides the ones a phone sent to it; the rest show what the phone chose.
 */
export function SyncConflictsPanel() {
  const conflicts = useNetworkStore((s) => s.syncConflicts);
  const [showDone, setShowDone] = useState(false);
  const list = conflicts.filter((c) => showDone || c.status === 'open' || c.status === 'office_decides');
  return (
    <div className="mx-auto max-w-5xl space-y-3" data-testid="sync-conflicts">
      <div className="flex items-center gap-2">
        <GitMerge className="h-4 w-4 text-slate-600" />
        <h3 className="text-sm font-bold text-slate-800">Changed twice at the same time</h3>
        <label className="ml-auto flex items-center gap-1 text-[11px] text-slate-600">
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show decided
        </label>
      </div>
      <p className="text-xs text-slate-500">
        When a phone was offline and someone else changed the same record, nothing was overwritten. Both versions are kept here. The person on the
        phone chose "keep theirs", "keep mine" or "office decides"; the last ones wait for you.
      </p>
      {list.length === 0 && <p className="text-xs text-slate-500">Nothing waiting.</p>}
      {list.map((c) => {
        const current = isCollectionName(c.collection)
          ? ((useNetworkStore.getState()[c.collection] as readonly { id: string }[]).find((r) => r.id === c.recordId) as Record<string, unknown> | undefined)
          : undefined;
        const wouldChange = fieldsThatWouldChange(c.mine, current);
        const fields = fieldsToCompare([...new Set([...c.changedFields, ...wouldChange])], c.mine, c.theirs);
        return (
          <div key={c.id} className="space-y-2 rounded-xl border border-slate-200 bg-white p-3 text-xs" data-testid="sync-conflict">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-bold text-slate-900">{c.label}</span>
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700" data-testid="sync-conflict-status">
                {SYNC_CONFLICT_STATUS_LABELS[c.status]}
              </span>
              <span className="text-[10px] text-slate-500">
                Found {c.detectedAt.replace('T', ' ').slice(0, 16)} by {c.detectedBy}
                {c.decidedAt ? ` · decided ${c.decidedAt.replace('T', ' ').slice(0, 16)} by ${c.decidedBy ?? '?'}` : ''}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <thead className="text-slate-500">
                  <tr>
                    <th className="py-1 pr-2">Field</th>
                    <th className="py-1 pr-2">From the phone</th>
                    <th className="py-1 pr-2">At the office then</th>
                    <th className="py-1">On record now</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(fields.length ? fields : ['(whole record)']).map((field) => (
                    <tr key={field}>
                      <td className="py-1 pr-2 font-mono text-slate-600">{field}</td>
                      <td className="py-1 pr-2">{c.mine ? showValue(c.mine[field]) : 'Deleted on the phone'}</td>
                      <td className="py-1 pr-2">{c.theirs ? showValue(c.theirs[field]) : 'Deleted at the office'}</td>
                      <td className="py-1">{current ? showValue(current[field]) : 'Not on record'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {c.status === 'office_decides' && (
              <p className="font-semibold text-slate-700" data-testid="sync-conflict-effect">
                {!c.mine
                  ? `"Use the phone version" deletes ${c.recordId}.`
                  : current
                    ? `"Use the phone version" changes ${wouldChange.length} field(s) of ${c.recordId}, all listed above.`
                    : `"Use the phone version" adds ${c.recordId} again.`}{' '}
                Sent by {c.detectedBy}.
              </p>
            )}
            {c.status === 'office_decides' && (
              <div className="flex flex-wrap gap-2">
                <button type="button" data-testid="office-use-field" onClick={() => decide(c, 'field')} className="rounded-lg bg-blue-700 px-3 py-1.5 font-semibold text-white">
                  Use the phone version
                </button>
                <button type="button" data-testid="office-keep-office" onClick={() => decide(c, 'office')} className="rounded-lg border border-slate-300 px-3 py-1.5 font-semibold">
                  Keep the office version
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
