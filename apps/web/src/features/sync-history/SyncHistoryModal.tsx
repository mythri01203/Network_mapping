import { useEffect, useMemo, useState } from 'react';
import { Camera, Check, GitMerge, History, X } from 'lucide-react';

import { Modal } from '../../components/ui';
import { loadSyncHistory, type SyncHistoryEntry, type SyncHistoryResult, useSyncHistory } from '../../stores/syncHistoryStore';

const RESULT: Record<SyncHistoryResult, { label: string; icon: typeof Check; tone: string }> = {
  sent: { label: 'Sent', icon: Check, tone: 'text-emerald-800' },
  refused: { label: 'Refused', icon: X, tone: 'text-red-700' },
  conflict: { label: 'Changed elsewhere too', icon: GitMerge, tone: 'text-amber-800' },
};

const when = (at: number) => new Date(at).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });

function what(entry: SyncHistoryEntry): string {
  const names = entry.labels.join(', ');
  const more = entry.count > entry.labels.length ? ` and ${entry.count - entry.labels.length} more` : '';
  const notes = entry.notes ? ` (with ${entry.notes} audit note${entry.notes === 1 ? '' : 's'})` : '';
  return `${entry.kind === 'photo' ? 'Photo: ' : ''}${names}${more}${notes}`;
}

/**
 * Phase 19: this device's sync history: what it sent to the server, when, and what came back. It is
 * kept on this device only (with its offline copy), so another computer shows its own list.
 */
export function SyncHistoryModal({ onClose }: { onClose: () => void }) {
  const entries = useSyncHistory((s) => s.entries);
  const [filter, setFilter] = useState<'all' | SyncHistoryResult>('all');
  useEffect(() => {
    loadSyncHistory();
  }, []);
  const shown = useMemo(() => (filter === 'all' ? entries : entries.filter((e) => e.result === filter)), [entries, filter]);

  return (
    <Modal open onClose={onClose} title="Sync history on this device" description="What was sent to the server, when, and the answer. Kept for 30 days, newest first." icon={History} size="lg">
      <div className="space-y-3" data-testid="sync-history">
        <div className="flex flex-wrap gap-1.5 text-xs">
          {(['all', 'sent', 'refused', 'conflict'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`min-h-[36px] rounded-lg px-3 font-semibold ${filter === f ? 'bg-blue-700 text-white' : 'border border-slate-300 bg-white text-slate-700'}`}
            >
              {f === 'all' ? `All (${entries.length})` : `${RESULT[f].label} (${entries.filter((e) => e.result === f).length})`}
            </button>
          ))}
        </div>
        {shown.length === 0 ? (
          <p className="rounded-lg border border-slate-200 p-3 text-xs text-slate-600" data-testid="sync-history-empty">
            Nothing recorded yet on this device.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {shown.map((entry) => {
              const look = RESULT[entry.result];
              const Icon = entry.kind === 'photo' ? Camera : look.icon;
              return (
                <li key={entry.id} className="flex items-start gap-2 p-2 text-xs" data-testid="sync-history-entry" data-result={entry.result}>
                  <Icon size={16} className={`mt-0.5 shrink-0 ${look.tone}`} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap justify-between gap-2">
                      <span className={`font-semibold ${look.tone}`}>{look.label}</span>
                      <span className="tabular-nums text-slate-500">{when(entry.at)}</span>
                    </div>
                    <div className="break-words text-slate-800">{what(entry)}</div>
                    {entry.reason && <div className="text-slate-600">{entry.reason}</div>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
}
