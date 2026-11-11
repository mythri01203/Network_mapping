import { useMemo, useState } from 'react';
import { History, Undo2 } from 'lucide-react';

import { IMPORT_FORMAT_LABELS, type ImportRecord, importsNewestFirst, roleCan, type RollbackPlan } from '@fibergis/shared';

import { Button, Textarea } from '../../components/ui';
import { currentAccount, loginIsOn } from '../../stores/authStore';
import { useNetworkStore } from '../../stores/networkStore';
import { showToast } from '../../stores/toastStore';
import { previewRollback, rollbackImport } from './importRollback';

/** Undo needs the right to delete what imports make, and to mark the import record. */
function mayUndoImports(): boolean {
  if (!loginIsOn()) return true;
  const account = currentAccount();
  return !!account && (['equipment', 'cables', 'ducts'] as const).every((c) => roleCan(account.role, 'delete', c)) && roleCan(account.role, 'update', 'imports');
}

const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
};

/** Network mapping Phase 21: every import, newest first, with what it made and an undo for the whole import. */
export function ImportHistoryPanel() {
  const imports = useNetworkStore((s) => s.imports);
  return <ImportHistoryList imports={imports ?? []} />;
}

export function ImportHistoryList({ imports }: { imports: readonly ImportRecord[] }) {
  const list = useMemo(() => importsNewestFirst(imports), [imports]);
  const [open, setOpen] = useState<string | null>(null);
  if (list.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center text-[13px] text-slate-600" data-testid="import-history-empty">
        <History className="text-slate-400" />
        No imports yet. Each file you import is listed here, with who imported it and when, and can be undone in one go.
      </div>
    );
  }
  return (
    <ul className="space-y-2" data-testid="import-history">
      {list.map((r) => (
        <ImportCard key={r.id} record={r} open={open === r.id} onToggle={() => setOpen((o) => (o === r.id ? null : r.id))} />
      ))}
    </ul>
  );
}

function ImportCard({ record, open, onToggle }: { record: ImportRecord; open: boolean; onToggle: () => void }) {
  const [check, setCheck] = useState<RollbackPlan | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const canUndo = mayUndoImports();
  const c = record.counts;

  const startUndo = () => {
    setResult(null);
    setCheck(previewRollback(record.id));
  };
  const confirmUndo = async () => {
    setBusy(true);
    const outcome = await rollbackImport(record.id, note);
    setBusy(false);
    setCheck(null);
    if (outcome.ok) {
      setResult({ ok: true, text: `Import undone: ${outcome.summary}` });
      showToast('success', 'Import undone', `${record.fileName}: ${outcome.summary}`);
    } else setResult({ ok: false, text: `${outcome.title}. ${outcome.message}` });
  };

  return (
    <li className="rounded-lg border border-slate-200 p-3" data-testid={`import-${record.id}`}>
      <button type="button" onClick={onToggle} className="flex w-full flex-col items-start gap-0.5 text-left" aria-expanded={open}>
        <span className="break-all text-[13px] font-semibold text-slate-900">{record.fileName}</span>
        <span className="text-[12px] text-slate-600">
          {IMPORT_FORMAT_LABELS[record.format]} · {when(record.importedAt)} · by {record.importedBy}
        </span>
        <span className="text-[12px] text-slate-600">
          {c.points} point(s), {c.cables} cable(s), {c.ducts} duct(s) added · {c.skipped} not imported{c.heldBack ? ` · ${c.heldBack} looked like existing items` : ''}
          {c.endsConfirmed ? ` · ${c.endsConfirmed} end(s) connected by a person` : ''}
        </span>
        {record.rolledBackAt && (
          <span className="mt-1 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-700" data-testid="import-undone">
            Undone {when(record.rolledBackAt)} by {record.rolledBackBy}
            {record.rollbackNote ? `: ${record.rollbackNote}` : ''}
          </span>
        )}
      </button>

      {open && (
        <div className="mt-2 space-y-2 border-t border-slate-100 pt-2">
          <details>
            <summary className="cursor-pointer text-[12px] font-medium text-slate-700">What was chosen</summary>
            <ul className="mt-1 space-y-0.5 text-[12px] text-slate-600">
              {Object.entries(record.settingsUsed).map(([k, v]) => (
                <li key={k}>
                  {k}: {v}
                </li>
              ))}
              {record.overrides.map((o) => (
                <li key={o} className="text-amber-800">
                  Accepted: {o}
                </li>
              ))}
            </ul>
          </details>

          {!record.rolledBackAt && !check && (
            <>
              <Button variant="secondary" onClick={startUndo} disabled={!canUndo} data-testid="import-undo">
                <Undo2 size={14} /> Undo this import…
              </Button>
              {!canUndo && <p className="text-[12px] text-slate-600">Your account cannot delete network items, so it cannot undo an import. Ask an engineer or the administrator.</p>}
            </>
          )}

          {check && !check.ok && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-[12px] text-amber-900" data-testid="import-undo-blocked">
              <p className="font-semibold">{check.title}</p>
              {check.blockers.length > 0 ? (
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {check.blockers.slice(0, 8).map((b) => (
                    <li key={`${b.collection}:${b.id}:${b.message}`}>{b.message}</li>
                  ))}
                  {check.blockers.length > 8 && <li>And {check.blockers.length - 8} more.</li>}
                </ul>
              ) : (
                <p>{check.message}</p>
              )}
              <p className="mt-1">Nothing was changed.</p>
              <Button className="mt-2" onClick={() => setCheck(null)}>
                Close
              </Button>
            </div>
          )}

          {check?.ok && (
            <div className="space-y-2 rounded-md border border-red-200 bg-red-50 p-2 text-[12px] text-red-900" data-testid="import-undo-confirm">
              <p>
                This removes the {check.removed} item(s) this import added{check.restored ? ` and puts ${check.restored} back as they were` : ''}. {check.alreadyGone ? `${check.alreadyGone} were already deleted. ` : ''}
                Nothing else is changed. The import stays in this list, marked undone.
              </p>
              <label className="flex flex-col gap-1 font-medium">
                Why (optional)
                <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="For example: wrong file" />
              </label>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => setCheck(null)}>Keep the import</Button>
                <Button variant="danger" onClick={() => void confirmUndo()} disabled={busy} data-testid="import-undo-go">
                  {busy ? 'Undoing…' : 'Undo the import'}
                </Button>
              </div>
            </div>
          )}

          {result && <p className={`text-[12px] ${result.ok ? 'text-emerald-700' : 'text-red-800'}`}>{result.text}</p>}
        </div>
      )}
    </li>
  );
}
