import { useState } from 'react';
import { AlertTriangle, Archive, Download, RotateCcw, Upload } from 'lucide-react';

import { RESTORE_RULE_LABELS, type RestoreRule } from '@fibergis/shared';

import { currentAccount, loginIsOn, useAuthStore } from '../../stores/authStore';
import { backupSystem, downloadServerBackup, resetToSampleData, restoreSystem } from '../../stores/networkActions';
import { useRestoreStore } from '../../stores/restoreStore';

const CARD = 'flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs';
const BUTTON = 'mt-4 flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-semibold shadow-xs transition-colors disabled:opacity-50';

/** What a refused restore found, by rule, with ids only, and the administrator's "restore anyway". */
function RefusalReport() {
  const refusal = useRestoreStore((s) => s.refusal);
  const [busy, setBusy] = useState(false);
  const [sure, setSure] = useState(false);
  if (!refusal) return null;
  return (
    <div role="alert" data-testid="restore-refusal" className="space-y-3 rounded-2xl border border-red-300 bg-red-50 p-5 text-sm md:col-span-2">
      <h4 className="flex items-center gap-2 font-bold text-red-900">
        <AlertTriangle size={16} /> The backup was refused. Nothing was restored.
      </h4>
      <p className="text-xs text-red-900">{refusal.total} problem(s) that the network on the server does not already have:</p>
      <ul className="text-xs text-red-900">
        {(Object.entries(refusal.counts) as [RestoreRule, number][])
          .filter(([, n]) => n > 0)
          .map(([rule, n]) => (
            <li key={rule}>
              {RESTORE_RULE_LABELS[rule]}: {n}
            </li>
          ))}
      </ul>
      <ol className="max-h-56 list-decimal space-y-1 overflow-auto pl-5 text-xs text-slate-800">
        {refusal.problems.map((p, i) => (
          <li key={i}>
            {p.message} <span className="font-mono text-slate-500">({p.refs.join(', ')})</span>
          </li>
        ))}
      </ol>
      {refusal.total > refusal.problems.length && <p className="text-xs text-slate-600">…and {refusal.total - refusal.problems.length} more.</p>}
      <p className="text-xs text-slate-700">Best: fix the backup file or use an older one. If you must restore it as it is, the problems stay in the network and the map check will list them.</p>
      <label className="flex items-center gap-2 text-xs font-semibold text-red-900">
        <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} data-testid="restore-anyway-sure" />
        I have read the problems. Restore it anyway (a safety copy is saved first).
      </label>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={!sure || busy}
          data-testid="restore-anyway"
          className="rounded-lg bg-red-700 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
          onClick={async () => {
            setBusy(true);
            await refusal.retryAccepting();
            setBusy(false);
          }}
        >
          Restore anyway
        </button>
        <button type="button" className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold" onClick={() => useRestoreStore.getState().setRefusal(null)}>
          Keep my network
        </button>
      </div>
    </div>
  );
}

function LastRestore() {
  const result = useRestoreStore((s) => s.lastResult);
  if (!result) return null;
  return (
    <p role="status" data-testid="restore-result" className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-xs text-emerald-900 md:col-span-2">
      Restored {result.restored.length} list(s). Safety copy saved on the server first: <span className="font-mono">{result.safetyCopy ?? 'yes'}</span>.
      {result.photosAdded ? ` ${result.photosAdded} photo(s) added.` : ''}
      {result.photosSkipped ? ` ${result.photosSkipped} file(s) in the zip were not pictures and were skipped.` : ''}
      {result.acceptedProblems ? ` Restored with ${result.acceptedProblems} problem(s) accepted.` : ''}
    </p>
  );
}

/** Administration, Backup (Phase 9): administrator only once login is on; safety copy before every reset and restore. */
export function BackupRestorePanel() {
  const allowed = useAuthStore((s) => !loginIsOn(s) || currentAccount(s)?.role === 'admin');
  const onFile = (file: File | undefined) => {
    if (!file) return;
    if (/\.zip$/i.test(file.name) || file.type === 'application/zip') {
      void restoreSystem(file);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') void restoreSystem(reader.result);
    };
    reader.readAsText(file);
  };

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2" data-testid="backup-panel">
      {!allowed && <p className="rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-600 md:col-span-2">Backups, restore and reset are for the administrator. They hold customer details and can replace the whole network.</p>}
      <RefusalReport />
      <LastRestore />
      <div className={CARD}>
        <div>
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
            <Archive className="h-5 w-5" />
          </div>
          <h4 className="text-sm font-bold text-slate-800">Full backup with photos (.zip)</h4>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            Made by the server: every list in the network and every field and job photo. Keep it safe: it holds customer names and phone numbers.
          </p>
        </div>
        <button type="button" disabled={!allowed} data-testid="backup-zip" onClick={() => void downloadServerBackup()} className={`${BUTTON} bg-blue-600 text-white hover:bg-blue-500`}>
          <Download className="h-3.5 w-3.5" /> Download backup with photos
        </button>
        <button type="button" disabled={!allowed} onClick={backupSystem} className={`${BUTTON} mt-2 border border-blue-600 bg-white text-blue-700 hover:bg-blue-50`}>
          <Download className="h-3.5 w-3.5" /> This browser&apos;s copy as JSON (no photos)
        </button>
      </div>
      <div className={CARD}>
        <div>
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-purple-50 text-purple-600">
            <Upload className="h-5 w-5" />
          </div>
          <h4 className="text-sm font-bold text-slate-800">Restore from a backup (.zip or .json)</h4>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            Needs the server. It is checked against the link, fiber, customer and fault rules first, and the server saves a safety copy of the current network before replacing anything.
          </p>
        </div>
        <label className={`${BUTTON} cursor-pointer bg-purple-600 text-white hover:bg-purple-500 ${allowed ? '' : 'pointer-events-none opacity-50'}`}>
          <Upload className="h-3.5 w-3.5" /> Choose backup file
          <input type="file" accept=".json,.zip,application/json,application/zip" data-testid="restore-file" disabled={!allowed} onChange={(e) => onFile(e.target.files?.[0])} className="hidden" />
        </label>
        <button type="button" disabled={!allowed} data-testid="reset-network" onClick={() => void resetToSampleData()} className={`${BUTTON} mt-2 border border-red-300 bg-white text-red-700 hover:bg-red-50`}>
          <RotateCcw className="h-3.5 w-3.5" /> Replace the network with the sample
        </button>
      </div>
    </div>
  );
}
