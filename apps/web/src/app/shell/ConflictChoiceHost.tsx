import '../../features/capture/capture.css';

import { useState } from 'react';
import { Building2, Smartphone, Users } from 'lucide-react';

import { syncEngine } from '../../api/syncEngine';
import { BigButton } from '../../features/capture/ui';
import { fieldsToCompare, showValue } from '../../features/operations/conflictFormat';
import { useT } from '../../i18n/useT';
import { useNetworkStore } from '../../stores/networkStore';
import { useSyncStore } from '../../stores/syncStore';

/** "fieldNotes" → "field notes": field names in plain words where the record has no label for them. */
const plain = (field: string) => field.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();

const SHOWN = 5;

/**
 * Appears when this device finds that someone else changed a record it edited (Phase 8). One
 * question, three big answers, and both versions are kept whatever is chosen.
 */
export function ConflictChoiceHost() {
  const { t, lang } = useT();
  const held = useSyncStore((s) => s.held);
  const conflicts = useNetworkStore((s) => s.syncConflicts);
  const [busy, setBusy] = useState(false);
  const current = conflicts.find((c) => c.status === 'open' && held.includes(`${c.collection}/${c.recordId}`));
  if (!current) return null;
  const fields = fieldsToCompare(current.changedFields, current.theirs, current.mine);
  const choose = async (choice: 'theirs' | 'mine' | 'office') => {
    setBusy(true);
    try {
      await syncEngine.resolveConflict(current.id, choice);
    } finally {
      setBusy(false);
    }
  };
  const column = (side: 'theirs' | 'mine') => {
    const record = side === 'theirs' ? current.theirs : current.mine;
    return (
      <div className="flex-1 rounded-2xl border-2 border-slate-900 bg-white p-3" data-testid={`conflict-${side}`}>
        <h3 className="mb-1 flex items-center gap-2 text-[1.125rem] font-bold text-slate-900">
          {side === 'theirs' ? <Users className="h-6 w-6" aria-hidden /> : <Smartphone className="h-6 w-6" aria-hidden />}
          {t(side === 'theirs' ? 'conflict.theirs' : 'conflict.mine')}
        </h3>
        {record ? (
          <dl className="space-y-1 text-[1rem] text-slate-900">
            {fields.slice(0, SHOWN).map((f) => (
              <div key={f}>
                <dt className="text-[0.9rem] font-semibold text-slate-600">{plain(f)}</dt>
                <dd className="break-words">{showValue(record[f])}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-[1.0625rem] font-bold text-red-900">{t('conflict.deleted')}</p>
        )}
      </div>
    );
  };
  return (
    <div lang={lang} role="dialog" aria-modal="true" aria-labelledby="conflict-title" className="field-capture fixed inset-0 z-[2000] flex flex-col bg-slate-50 text-slate-900" data-testid="conflict-choice">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        <h1 id="conflict-title" className="text-[1.5rem] font-bold leading-snug text-slate-900">
          {t('conflict.title')}
        </h1>
        <p className="text-[1.125rem] text-slate-900">{t('conflict.body', { label: current.label })}</p>
        <div className="flex flex-col gap-3 sm:flex-row">
          {column('theirs')}
          {column('mine')}
        </div>
        {fields.length > SHOWN && <p className="text-[1rem] text-slate-700">{t('conflict.more', { count: fields.length - SHOWN })}</p>}
        <p className="rounded-xl bg-emerald-100 p-2 text-[1.0625rem] font-semibold text-emerald-950">{t('conflict.kept')}</p>
      </div>
      <div className="flex shrink-0 flex-col gap-2 border-t-2 border-slate-900 bg-white p-3">
        <BigButton tone="primary" icon={Users} disabled={busy} onClick={() => void choose('theirs')} testId="conflict-keep-theirs">
          {t('conflict.keepTheirs')}
        </BigButton>
        <BigButton tone="plain" icon={Smartphone} disabled={busy} onClick={() => void choose('mine')} testId="conflict-keep-mine">
          {t('conflict.keepMine')}
        </BigButton>
        <BigButton tone="plain" icon={Building2} disabled={busy} onClick={() => void choose('office')} testId="conflict-office">
          {t('conflict.office')}
        </BigButton>
      </div>
    </div>
  );
}
