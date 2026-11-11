import { useCallback, useEffect, useState } from 'react';
import { Check, ClipboardCheck, GitPullRequest, Play, RefreshCw, X } from 'lucide-react';

import { CHANGE_REQUEST_STATUS_LABELS, CHANGE_REQUEST_STATUSES, type ChangeRequest, type ChangeRequestStatus } from '@fibergis/shared';

import { describeApiError } from '../../api/client';
import { governanceClient, type ListedChangeRequest } from '../../api/governanceClient';
import { currentAccount, useAuthStore, useMayDo } from '../../stores/authStore';
import { showToast } from '../../stores/toastStore';

const BUTTON = 'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-semibold disabled:opacity-50';

const STATUS_TONE: Record<ChangeRequestStatus, string> = {
  requested: 'bg-amber-100 text-amber-900',
  approved: 'bg-blue-100 text-blue-900',
  rejected: 'bg-red-100 text-red-900',
  applied: 'bg-emerald-100 text-emerald-900',
  verified: 'bg-emerald-200 text-emerald-950',
  closed: 'bg-slate-200 text-slate-700',
};

const EVENT_WORDS: Record<ChangeRequest['events'][number]['kind'], string> = {
  created: 'Asked',
  approved: 'Approved',
  rejected: 'Rejected',
  applied: 'Made',
  apply_failed: 'Could not be made',
  verified: 'Checked on site',
  closed: 'Closed',
  comment: 'Comment',
};

/**
 * Phase 23: change requests (Administration). Someone asks for a change; another person with the
 * approve right approves or rejects it; a person allowed to make that change makes it (the server
 * checks it like any other change); an approver marks it checked on site; it is closed.
 */
export function ChangeRequestsPanel() {
  const mayApprove = useMayDo('approve');
  const me = useAuthStore((s) => currentAccount(s));
  const [status, setStatus] = useState<ChangeRequestStatus | ''>('');
  const [requests, setRequests] = useState<ListedChangeRequest[]>([]);
  const [open, setOpen] = useState<ChangeRequest | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setRequests((await governanceClient.changeRequests(status || undefined)).requests);
    } catch (err) {
      showToast('error', 'Change requests not loaded', describeApiError(err));
    }
  }, [status]);

  useEffect(() => {
    // Loading the list from the server when the panel opens; the state is set after the await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const step = async (label: string, run: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await run();
      showToast('success', label, 'Saved on the server.');
      setNote('');
      if (open) setOpen(await governanceClient.changeRequest(open.id));
    } catch (err) {
      showToast('error', `${label}: not done`, describeApiError(err));
      if (open) setOpen(await governanceClient.changeRequest(open.id).catch(() => open));
    } finally {
      setBusy(false);
      await load();
    }
  };

  const mine = (r: { requestedBy: { id: string | null } }) => !!me && r.requestedBy.id === me.id;

  return (
    <div className="mx-auto max-w-5xl space-y-4" data-testid="change-requests-panel">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800">
            <GitPullRequest size={16} /> Change requests
          </h3>
          <p className="text-xs text-slate-500">
            A change someone asked for. Another person approves it, then someone allowed to make that change makes it. Nothing changes on the map until it is made.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-xs" value={status} onChange={(e) => setStatus(e.target.value as ChangeRequestStatus | '')} aria-label="Show requests that are">
            <option value="">All</option>
            {CHANGE_REQUEST_STATUSES.map((s) => (
              <option key={s} value={s}>
                {CHANGE_REQUEST_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          <button type="button" className={`${BUTTON} border border-slate-300 bg-white text-slate-700`} onClick={() => void load()}>
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full text-left text-xs" data-testid="change-requests-table">
          <thead className="bg-slate-50 text-[11px] uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">What</th>
              <th className="px-3 py-2">Asked by</th>
              <th className="px-3 py-2">State</th>
              <th className="px-3 py-2">Records</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {requests.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                  No change requests.
                </td>
              </tr>
            )}
            {requests.map((r) => (
              <tr key={r.id} data-testid={`cr-row-${r.id}`}>
                <td className="px-3 py-2">
                  <div className="font-semibold text-slate-800">{r.title}</div>
                  <div className="font-mono text-[10px] text-slate-400">{r.id}</div>
                </td>
                <td className="px-3 py-2">
                  {r.requestedBy.name}
                  <div className="text-[10px] text-slate-400">{new Date(r.requestedAt).toLocaleString()}</div>
                </td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_TONE[r.status]}`}>{CHANGE_REQUEST_STATUS_LABELS[r.status]}</span>
                </td>
                <td className="px-3 py-2 text-slate-600">{r.summary.map((s) => `${s.collection}: ${s.upserts ? `${s.upserts} saved` : ''}${s.upserts && s.deletes ? ', ' : ''}${s.deletes ? `${s.deletes} deleted` : ''}`).join('; ')}</td>
                <td className="px-3 py-2">
                  <button type="button" className={`${BUTTON} border border-slate-300 bg-white text-slate-700`} onClick={() => void governanceClient.changeRequest(r.id).then(setOpen, (err) => showToast('error', 'Not opened', describeApiError(err)))}>
                    Open
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open && (
        <div className="space-y-3 rounded-2xl border border-slate-300 bg-white p-4" data-testid="change-request-detail">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h4 className="text-sm font-bold text-slate-800">{open.title}</h4>
              {open.reason && <p className="text-xs text-slate-600">{open.reason}</p>}
              <p className="mt-1 text-xs">
                <span className={`rounded-full px-2 py-0.5 font-semibold ${STATUS_TONE[open.status]}`}>{CHANGE_REQUEST_STATUS_LABELS[open.status]}</span>
              </p>
            </div>
            <button type="button" aria-label="Close this request view" className={`${BUTTON} text-slate-500`} onClick={() => setOpen(null)}>
              <X size={16} />
            </button>
          </div>
          <ol className="space-y-1 text-xs text-slate-700">
            {open.events.map((e, i) => (
              <li key={i}>
                <span className="font-semibold">{EVENT_WORDS[e.kind]}</span> · {e.byName} · {new Date(e.at).toLocaleString()}
                {e.text ? <span className="text-slate-600">: {e.text}</span> : null}
              </li>
            ))}
          </ol>
          <details className="text-xs">
            <summary className="cursor-pointer font-semibold text-slate-600">The records in this request</summary>
            <pre className="mt-2 max-h-64 overflow-auto rounded bg-slate-50 p-2 text-[11px]">{JSON.stringify(open.changes, null, 2)}</pre>
          </details>
          {open.status !== 'closed' && (
            <label className="block text-xs font-semibold text-slate-700">
              Note (optional)
              <input className="mt-1 h-9 w-full rounded-lg border border-slate-300 px-2 text-sm" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            {open.status === 'requested' && mayApprove && !mine(open) && (
              <>
                <button type="button" disabled={busy} data-testid="cr-approve" className={`${BUTTON} bg-emerald-700 text-white`} onClick={() => void step('Approved', () => governanceClient.review(open.id, 'approve', note || undefined))}>
                  <Check size={14} /> Approve
                </button>
                <button type="button" disabled={busy} data-testid="cr-reject" className={`${BUTTON} bg-red-700 text-white`} onClick={() => void step('Rejected', () => governanceClient.review(open.id, 'reject', note || undefined))}>
                  <X size={14} /> Reject
                </button>
              </>
            )}
            {open.status === 'requested' && mayApprove && mine(open) && <p className="text-xs text-slate-500">Someone else must approve your own request.</p>}
            {open.status === 'approved' && (
              <button type="button" disabled={busy} data-testid="cr-apply" className={`${BUTTON} bg-blue-700 text-white`} onClick={() => void step('Change made', () => governanceClient.apply(open.id))}>
                <Play size={14} /> Make this change now
              </button>
            )}
            {open.status === 'applied' && mayApprove && (
              <button type="button" disabled={busy} data-testid="cr-verify" className={`${BUTTON} bg-emerald-700 text-white`} onClick={() => void step('Marked as checked', () => governanceClient.verify(open.id, note || undefined))}>
                <ClipboardCheck size={14} /> Checked on site
              </button>
            )}
            {open.status !== 'closed' && note.trim() && (
              <button type="button" disabled={busy} className={`${BUTTON} border border-slate-300 bg-white text-slate-700`} onClick={() => void step('Comment added', () => governanceClient.comment(open.id, note.trim()))}>
                Add comment
              </button>
            )}
            {open.status !== 'closed' && (mayApprove || mine(open)) && (
              <button type="button" disabled={busy} data-testid="cr-close" className={`${BUTTON} border border-slate-300 bg-white text-slate-700`} onClick={() => void step('Closed', () => governanceClient.close(open.id, note || undefined))}>
                Close request
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
