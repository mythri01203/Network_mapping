import { useState } from 'react';

import { type ColumnMapping, type DelimitedTable, mappingProblem, ONU_STATE_LABELS, ONU_STATES, type OnuState, parseDelimited, rowsFromTable, statusWordsIn } from '@fibergis/shared';

import { describeApiError } from '../../api/client';
import { type IngestResult, monitoringClient } from '../../api/monitoringClient';
import { Button } from '../../components/ui';
import { showToast } from '../../stores/toastStore';
import { ImportPreview } from './ImportPreview';
import { refreshFromServer, useMonitoringData } from './useMonitoring';

const FIELDS: { key: keyof Omit<ColumnMapping, 'defaultUnit' | 'statusWords'>; label: string }[] = [
  { key: 'onuAddress', label: 'ONU address (as the OLT writes it)' },
  { key: 'serial', label: 'ONT serial' },
  { key: 'deviceTime', label: 'Time the device read it (with time zone)' },
  { key: 'ontRx', label: 'ONT receive level' },
  { key: 'oltRx', label: 'OLT receive from the ONU (upstream)' },
  { key: 'unit', label: 'Unit' },
  { key: 'status', label: 'Status' },
];

/**
 * Import a CSV or TSV export: choose which column is which (saved on the source for next time),
 * map the vendor's status words, preview what matches and what is skipped and why, then import.
 */
export function ImportPanel() {
  const { monitoringSources } = useMonitoringData();
  const files = monitoringSources.filter((s) => s.kind === 'file_import');
  const [sourceId, setSourceId] = useState('');
  const [table, setTable] = useState<DelimitedTable | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [preview, setPreview] = useState<{ result: IngestResult; rowNumbers: number[]; localSkipped: { row: number; reason: string }[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const source = files.find((s) => s.id === sourceId);

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    const parsed = parseDelimited(await file.text());
    setPreview(null);
    if ('error' in parsed) {
      setTable(null);
      showToast('warning', 'File not read', parsed.error);
      return;
    }
    setTable(parsed);
    // The mapping saved on this source last time, kept only for columns this file has.
    const saved = source?.columnMapping ?? {};
    setMapping(Object.fromEntries(Object.entries(saved).filter(([k, v]) => k === 'defaultUnit' || k === 'statusWords' || parsed.headers.includes(String(v)))) as ColumnMapping);
  };

  const send = async (dryRun: boolean) => {
    if (!table || !source) return;
    const { rows, rowNumbers, skipped } = rowsFromTable(table, mapping);
    if (rows.length === 0) {
      setPreview({ result: { stored: { readings: 0, statuses: 0 }, matched: 0, duplicates: 0, skipped: [], unmatched: [], alarmsRaised: 0, isTest: false, dryRun: true }, rowNumbers, localSkipped: skipped });
      return;
    }
    setBusy(true);
    try {
      const result = await monitoringClient.importRows({ sourceId: source.id, rows, columnMapping: mapping, dryRun });
      setPreview({ result, rowNumbers, localSkipped: skipped });
      if (!dryRun) {
        await refreshFromServer();
        showToast('success', 'Imported', `${result.stored.readings} reading(s) and ${result.stored.statuses} status(es) stored; ${result.unmatched.length} not matched, ${result.skipped.length + skipped.length} skipped.`);
      }
    } catch (error) {
      showToast('error', 'Not imported', describeApiError(error));
    } finally {
      setBusy(false);
    }
  };

  const problem = mappingProblem(mapping);
  const words = table ? statusWordsIn(table, mapping.status) : [];
  const select = 'min-h-[40px] w-full rounded-lg border border-slate-300 px-2';

  return (
    <div className="space-y-3 text-xs text-slate-700" data-testid="mon-import">
      <p>Export a CSV or TSV from your OLT or NMS. Nothing is guessed: you choose the columns, and a row is shown on a customer only if its ONU address or serial is exactly the one on their ONT record.</p>
      {files.length === 0 ? (
        <p data-testid="mon-import-nosource">No file import source yet. The administrator adds one under Sources.</p>
      ) : (
        <label className="flex flex-col gap-1">
          <span className="font-semibold">Source</span>
          <select value={sourceId} onChange={(e) => setSourceId(e.target.value)} className={select} data-testid="mon-import-source">
            <option value="">Choose…</option>
            {files.map((s) => (
              <option key={s.id} value={s.id} disabled={!s.enabled}>
                {s.name}
                {s.enabled ? '' : ' (off)'}
              </option>
            ))}
          </select>
        </label>
      )}
      {source && <input type="file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values" data-testid="mon-import-file" onChange={(e) => void readFile(e.target.files?.[0])} />}
      {table && (
        <div className="space-y-2 rounded-lg border border-slate-200 p-3">
          <div className="font-semibold">
            {table.rows.length} row(s), {table.headers.length} columns. Which column is which?
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {FIELDS.map((f) => (
              <label key={f.key} className="flex flex-col gap-1">
                <span>{f.label}</span>
                <select value={mapping[f.key] ?? ''} onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value || undefined })} className={select} data-testid={`mon-map-${f.key}`}>
                  <option value="">Not in this file</option>
                  {table.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={mapping.defaultUnit === 'dBm'} onChange={(e) => setMapping({ ...mapping, defaultUnit: e.target.checked ? 'dBm' : undefined })} data-testid="mon-map-dbm" />
            The levels are in dBm (the file has no unit column)
          </label>
          {words.length > 0 && (
            <div className="space-y-1">
              <div className="font-semibold">What does each status word in the file mean?</div>
              {words.map((w) => (
                <label key={w} className="flex items-center gap-2">
                  <span className="w-32 truncate font-mono">{w}</span>
                  <select
                    value={mapping.statusWords?.[w] ?? ''}
                    onChange={(e) => {
                      const next = { ...mapping.statusWords };
                      if (e.target.value) next[w] = e.target.value as OnuState;
                      else delete next[w];
                      setMapping({ ...mapping, statusWords: next });
                    }}
                    className="min-h-[40px] rounded-lg border border-slate-300 px-2"
                    data-testid={`mon-word-${w}`}
                  >
                    <option value="">Not mapped (rows skipped)</option>
                    {ONU_STATES.map((s) => (
                      <option key={s} value={s}>
                        {ONU_STATE_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          )}
          {problem && <p className="font-semibold text-amber-800">{problem}</p>}
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || !!problem} onClick={() => void send(true)} data-testid="mon-import-preview">
              Preview
            </Button>
            <Button variant="primary" disabled={busy || !!problem || !preview?.result.dryRun} onClick={() => void send(false)} data-testid="mon-import-go">
              Import
            </Button>
          </div>
        </div>
      )}
      {preview && <ImportPreview {...preview} />}
    </div>
  );
}
