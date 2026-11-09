import { useState } from 'react';

import { describeRfLink, describeRfPort, type RfLink } from '@fibergis/shared';

import { takeOutRfLink } from '../../stores/rfActions';
import { inputClass } from './RfFields';
import { RfLinkForm } from './RfLinkForm';
import type { RfModel } from './useRfModel';

function TakeOut({ link }: { link: RfLink }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="rounded border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50" data-testid="rf-link-takeout">
        Take out
      </button>
    );
  }
  return (
    <div className="flex items-center gap-1">
      <input className={`${inputClass} w-44`} placeholder="Why (cut, moved, mistake)" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="rf-link-reason" aria-label="Why the link is taken out" />
      <button
        type="button"
        disabled={!reason.trim()}
        onClick={() => void takeOutRfLink(link.id, reason).then((done) => done && setOpen(false))}
        className="rounded bg-red-600 px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-40"
        data-testid="rf-link-takeout-confirm"
      >
        Take this link out
      </button>
    </div>
  );
}

/** Recorded links in the direction the signal flows, and links taken out, kept as history. */
export function RfLinksPanel({ model }: { model: RfModel }) {
  const active = model.data.rfLinks.filter((l) => l.status === 'active');
  const removed = model.data.rfLinks.filter((l) => l.status === 'removed');
  return (
    <div className="space-y-4">
      <RfLinkForm model={model} />
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h4 className="mb-2 text-sm font-bold text-slate-800">Links in place ({active.length})</h4>
        {active.length === 0 ? (
          <p className="text-sm text-slate-600">Not recorded.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-xs" data-testid="rf-links">
            {active.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5" data-testid="rf-link-row">
                <span>
                  <span className="font-semibold text-slate-900">{describeRfPort(model.ix, l.from)}</span> → <span className="font-semibold text-slate-900">{describeRfPort(model.ix, l.to)}</span>
                  <span className="text-slate-600"> · {describeRfLink(model.ix, l)}</span>
                </span>
                <TakeOut link={l} />
              </li>
            ))}
          </ul>
        )}
      </section>
      {removed.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <h4 className="mb-2 text-sm font-bold text-slate-700">Taken out (history, {removed.length})</h4>
          <ul className="space-y-1 text-xs text-slate-600" data-testid="rf-links-removed">
            {removed.map((l) => (
              <li key={l.id}>
                {describeRfPort(model.ix, l.from)} → {describeRfPort(model.ix, l.to)}, taken out {l.removedAt?.slice(0, 10) ?? '(date not recorded)'}: {l.removedReason ?? 'no reason recorded'}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
