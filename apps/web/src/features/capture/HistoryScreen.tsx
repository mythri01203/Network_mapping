import { useEffect } from 'react';
import { AlertTriangle, Camera, Check, GitMerge, X } from 'lucide-react';

import { useT } from '../../i18n/useT';
import { loadSyncHistory, type SyncHistoryEntry, useSyncHistory } from '../../stores/syncHistoryStore';
import { cx } from './feedback';
import { StepTitle } from './steps';
import { Say } from './ui';

/** Day and time with Western digits, as the field rules ask. */
const when = (at: number) => {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const LOOK: Record<SyncHistoryEntry['result'], { tone: string; icon: typeof Check }> = {
  sent: { tone: 'border-emerald-800 bg-emerald-50 text-emerald-950', icon: Check },
  refused: { tone: 'border-red-900 bg-red-50 text-red-950', icon: X },
  conflict: { tone: 'border-amber-700 bg-amber-50 text-slate-900', icon: GitMerge },
};

/**
 * Phase 19: what this phone sent and what came back, newest first. Each line has its own icon and
 * words (never colour alone): sent, not accepted (with the office's reason) or changed by someone
 * else too. It reads this device's own log; nothing is guessed.
 */
export function HistoryScreen() {
  const { t } = useT();
  const entries = useSyncHistory((s) => s.entries);
  useEffect(() => {
    loadSyncHistory();
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3" data-testid="history-screen">
      <StepTitle k="history.title" />
      {entries.length === 0 ? (
        <p className="rounded-2xl border-2 border-slate-900 bg-white p-4 text-[1.125rem] font-semibold" data-testid="history-empty">
          <Say k="history.empty" />
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {entries.map((entry) => {
            const look = LOOK[entry.result];
            const Icon = look.icon;
            return (
              <li key={entry.id} className={cx('flex min-h-[4.5rem] items-start gap-3 rounded-2xl border-2 p-3', look.tone)} data-testid="history-entry" data-result={entry.result}>
                <Icon className="mt-1 h-8 w-8 shrink-0" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-[1.25rem] font-bold">
                      <Say k={entry.result === 'sent' ? 'history.sent' : entry.result === 'refused' ? 'history.refused' : 'history.conflict'} />
                    </span>
                    <span className="text-[1rem] font-semibold tabular-nums">{when(entry.at)}</span>
                  </div>
                  <p className="flex flex-wrap items-center gap-1 text-[1.0625rem] font-semibold">
                    {entry.kind === 'photo' && (
                      <>
                        <Camera className="h-5 w-5" aria-hidden /> <Say k="history.photo" />:
                      </>
                    )}
                    <span className="break-words">{entry.labels.join(', ')}</span>
                    {entry.count > entry.labels.length && <span>({t('history.items', { count: entry.count })})</span>}
                  </p>
                  {entry.result === 'refused' && (
                    <p className="mt-1 flex items-start gap-1 text-[1rem]">
                      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
                      <span>
                        {entry.reason ? `${entry.reason} ` : ''}
                        <Say k="history.keptOnPhone" />
                      </span>
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
