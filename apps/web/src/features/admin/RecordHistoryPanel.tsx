import { useCallback, useEffect, useState } from 'react';
import { Download, History, Search } from 'lucide-react';

import {
  ACCOUNT_ROLE_LABELS,
  type AuditEvent,
  COLLECTION_NAMES,
  type CollectionName,
  type RecordRevisionSummary,
  type RevisionComparison,
  type RevisionRetention,
  WRITE_SOURCE_LABELS,
} from '@fibergis/shared';

import { describeApiError } from '../../api/client';
import { governanceClient } from '../../api/governanceClient';
import { useMayDo } from '../../stores/authStore';
import { showToast } from '../../stores/toastStore';

const BUTTON = 'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-semibold disabled:opacity-50';
const FIELD = 'h-9 rounded-lg border border-slate-300 bg-white px-2 text-xs';

const OP_WORDS: Record<AuditEvent['op'], string> = { create: 'Added', update: 'Changed', delete: 'Deleted', summary: 'Many records' };

/**
 * Phase 23: the server's own record of every write (who, when, how it came in, which fields), and
 * the stored versions of one record with a before and after comparison. The server writes these;
 * nothing here can change them.
 */
export function RecordHistoryPanel() {
  const mayExport = useMayDo('export');
  const [collection, setCollection] = useState<CollectionName | ''>('');
  const [recordId, setRecordId] = useState('');
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [retention, setRetention] = useState<RevisionRetention | null>(null);
  const [revisions, setRevisions] = useState<RecordRevisionSummary[] | null>(null);
  const [comparison, setComparison] = useState<RevisionComparison | null>(null);

  const load = useCallback(async () => {
    try {
      const id = recordId.trim();
      const result = await governanceClient.auditEvents({ ...(collection ? { collection } : {}), ...(collection && id ? { id } : {}), limit: 200 });
      setEvents(result.events);
      setRetention(result.retention);
      setComparison(null);
      setRevisions(collection && id ? (await governanceClient.revisions(collection, id)).revisions : null);
    } catch (err) {
      showToast('error', 'History not loaded', describeApiError(err));
    }
  }, [collection, recordId]);

  useEffect(() => {
    // Loading the newest events when the panel opens; the state is set after the await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    // Only on opening: the search button loads again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const compare = async (from: RecordRevisionSummary) => {
    if (!collection) return;
    try {
      setComparison(await governanceClient.compare(collection, recordId.trim(), from.seq, 'current'));
    } catch (err) {
      showToast('error', 'Not compared', describeApiError(err));
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4" data-testid="record-history-panel">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800">
          <History size={16} /> Server history
        </h3>
        <p className="text-xs text-slate-500">
          Written by the server for every change, from the app, a script or a change request. It cannot be edited or deleted.
          {retention ? ` Old versions of a record are kept for ${retention.keepDays} days (at most ${retention.keepPerRecord} per record); this list of changes is kept for good.` : ''}
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs font-semibold text-slate-700">
          Kind of record
          <select className={`${FIELD} mt-1 block`} value={collection} onChange={(e) => setCollection(e.target.value as CollectionName | '')}>
            <option value="">All</option>
            {COLLECTION_NAMES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold text-slate-700">
          Record id (for its versions)
          <input className={`${FIELD} mt-1 block w-56 font-mono`} value={recordId} onChange={(e) => setRecordId(e.target.value)} placeholder="e.g. POLE-01" />
        </label>
        <button type="button" className={`${BUTTON} bg-blue-700 text-white`} onClick={() => void load()} data-testid="history-search">
          <Search size={14} /> Show
        </button>
        {mayExport && (
          <a className={`${BUTTON} border border-slate-300 bg-white text-slate-700`} href={governanceClient.auditCsvUrl()} download>
            <Download size={14} /> Save as spreadsheet (CSV)
          </a>
        )}
      </div>

      {revisions && (
        <div className="rounded-2xl border border-slate-200 bg-white p-3">
          <h4 className="mb-2 text-xs font-bold uppercase text-slate-500">Stored versions of {recordId.trim()}</h4>
          {revisions.length === 0 ? (
            <p className="text-xs text-slate-500">No stored versions (none kept, or not changed since Phase 23).</p>
          ) : (
            <ul className="space-y-1 text-xs">
              {revisions.map((r) => (
                <li key={r.seq} className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-slate-400">#{r.seq}</span>
                  <span className="font-semibold">{OP_WORDS[r.op]}</span>
                  <span>{r.actorName}</span>
                  <span className="text-slate-500">{new Date(r.at).toLocaleString()}</span>
                  <span className="text-slate-500">({WRITE_SOURCE_LABELS[r.source]})</span>
                  <button type="button" className="text-blue-700 underline" onClick={() => void compare(r)}>
                    Compare with now
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {comparison && (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-3 text-xs" data-testid="history-compare">
          <h4 className="mb-2 font-bold text-blue-900">
            Version #{String(comparison.before.seq)} against {comparison.after.data ? 'now' : 'now (deleted)'}: {comparison.fields.length} field(s) differ
          </h4>
          <table className="w-full text-left">
            <thead className="text-[11px] uppercase text-blue-800">
              <tr>
                <th className="py-1 pr-2">Field</th>
                <th className="py-1 pr-2">Before</th>
                <th className="py-1">After</th>
              </tr>
            </thead>
            <tbody>
              {comparison.fields.map((f) => (
                <tr key={f.field} className="align-top">
                  <td className="py-1 pr-2 font-mono font-semibold">{f.field}</td>
                  <td className="py-1 pr-2 font-mono break-all text-red-800">{f.before ?? '(not set)'}</td>
                  <td className="py-1 font-mono break-all text-emerald-800">{f.after ?? '(not set)'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full text-left text-xs" data-testid="server-audit-table">
          <thead className="bg-slate-50 text-[11px] uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Who</th>
              <th className="px-3 py-2">What</th>
              <th className="px-3 py-2">Record</th>
              <th className="px-3 py-2">Fields changed</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {events.map((e) => (
              <tr key={e.seq}>
                <td className="px-3 py-2 font-mono text-[11px] text-slate-500">{new Date(e.at).toLocaleString()}</td>
                <td className="px-3 py-2">
                  <span className="font-semibold text-slate-800">{e.actorName}</span>
                  <div className="text-[10px] text-blue-600">{e.actorRole ? ACCOUNT_ROLE_LABELS[e.actorRole] : ''} · {WRITE_SOURCE_LABELS[e.source]}</div>
                </td>
                <td className="px-3 py-2">
                  {OP_WORDS[e.op]}
                  {e.actions.length > 0 && <div className="text-[10px] text-slate-500">{e.actions.join(', ')}</div>}
                </td>
                <td className="px-3 py-2 font-mono text-[11px]">
                  {e.collection}
                  {e.recordId ? `/${e.recordId}` : ''}
                </td>
                <td className="px-3 py-2 text-slate-600">{e.note ?? (e.diff.map((d) => d.field).join(', ') || '—')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
