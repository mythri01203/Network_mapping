import { useState } from 'react';
import { AlertTriangle, Search } from 'lucide-react';

import { affectedByElement, type CorrelationResult, type ImpactIndex, type ImpactResult, type NetworkElementRef, SERVICE_KIND_LABELS } from '@fibergis/shared';

import { openFaultFor } from '../../stores/faultActions';
import { elementReady } from './faultFormat';
import { buttonClass, ConfidenceBadge, ElementPicker, NoLiveConnection, Section, TestBadge } from './faultUi';

/** Who depends on an element, from recorded paths, with the uncertain ones apart. */
export function ImpactList({ impact }: { impact: ImpactResult }) {
  return (
    <div className="space-y-2" data-testid="impact">
      <div className="text-[11px] font-semibold text-slate-800" data-testid="impact-summary">
        {impact.affected.length} customer(s) on recorded paths through {impact.label} · {impact.activeServices} active service(s)
      </div>
      <div className="grid gap-1 sm:grid-cols-2">
        {impact.affected.map((c) => (
          <div key={c.customerId} className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px]" data-testid="affected-customer">
            <div className="font-semibold text-slate-900">
              {c.name} <span className="font-mono text-slate-500">{c.customerId}</span>
            </div>
            <div className="text-slate-500">
              {c.services.length ? c.services.map((s) => `${SERVICE_KIND_LABELS[s.kind]} (${s.status})`).join(', ') : 'No service record'}
              {!c.pathComplete ? ' · path breaks further up, but this element is on its recorded part' : ''}
            </div>
          </div>
        ))}
      </div>
      {impact.mayBeAffected.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-2" data-testid="may-be-affected">
          <div className="text-[11px] font-bold text-amber-900">May be affected: path not fully recorded ({impact.mayBeAffected.length})</div>
          {impact.mayBeAffected.map((c) => (
            <div key={c.customerId} className="text-[11px] text-amber-900">
              {c.name} <span className="font-mono">{c.customerId}</span>: {c.reason}. First missing link: {c.firstGap}
            </div>
          ))}
        </div>
      )}
      {impact.notes.map((n) => (
        <p key={n} className="text-[10px] text-slate-500">
          {n}
        </p>
      ))}
    </div>
  );
}

export function ImpactTab({ ix }: { ix: ImpactIndex }) {
  const [element, setElement] = useState<NetworkElementRef | null>({ type: 'splitter', id: '' });
  const impact = elementReady(element) ? affectedByElement(ix, element) : null;
  return (
    <div className="space-y-3">
      <Section title="Who is affected if this fails?" testId="impact-tab">
        <p className="text-[11px] text-slate-600">
          Choose a cable, one fiber, a closure, a splitter, a PON port, a pole or a span. Only recorded links are followed; a customer whose path is not
          fully recorded is listed apart.
        </p>
        <ElementPicker value={element} onChange={setElement} testId="impact-picker" />
        {impact ? <ImpactList impact={impact} /> : <p className="text-[11px] text-slate-500">Choose what to check.</p>}
      </Section>
    </div>
  );
}

export function SuspectedTab({ ix, correlation, onOpenFault }: { ix: ImpactIndex; correlation: CorrelationResult; onOpenFault: (faultId: string) => void }) {
  const { suspicions, notes } = correlation;
  return (
    <div className="space-y-3">
      <NoLiveConnection />
      {notes.map((n) => (
        <p key={n} className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-700">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-600" /> {n}
        </p>
      ))}
      {suspicions.length === 0 && <p className="text-[11px] text-slate-500">No open alarms to compare.</p>}
      {suspicions.map((s) => (
        <div key={s.key} className={`space-y-2 rounded-xl border p-3 ${s.primary ? 'border-rose-300 bg-rose-50/50' : 'border-slate-200 bg-white'}`} data-testid="suspicion">
          <div className="flex flex-wrap items-center gap-1.5">
            <TestBadge isTest={s.isTest} />
            <ConfidenceBadge confidence={s.confidence} />
            <span className="text-xs font-bold text-slate-900" data-testid="suspicion-label">
              Suspected: {s.label}
            </span>
            {s.primary && <span className="text-[10px] font-semibold text-rose-700">Best match for these alarms</span>}
          </div>
          <ul className="list-disc space-y-0.5 pl-5 text-[11px] text-slate-800" data-testid="evidence">
            {s.evidence.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
          {s.missing.length > 0 && (
            <div className="rounded border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-900" data-testid="missing">
              <div className="font-bold">Not recorded, so less sure:</div>
              {s.missing.map((m) => (
                <div key={m}>{m}</div>
              ))}
            </div>
          )}
          <div className="text-[11px] text-slate-600">
            <span className="font-semibold">Check first:</span> {s.checks.join(' ')}
          </div>
          <div className="flex flex-wrap gap-2">
            {s.faultIds.length > 0 ? (
              s.faultIds.map((id) => (
                <button key={id} type="button" onClick={() => onOpenFault(id)} className={`${buttonClass} border border-slate-300`}>
                  Show fault {id}
                </button>
              ))
            ) : (
              <button
                type="button"
                data-testid="open-fault"
                onClick={() => {
                  const fault = openFaultFor({ element: s.element, alarmIds: s.alarmIds, suspected: { element: s.element, label: s.label, confidence: s.confidence, evidence: s.evidence, missing: s.missing, checks: s.checks }, index: ix });
                  if (fault) onOpenFault(fault.id);
                }}
                className={`${buttonClass} bg-rose-600 text-white`}
              >
                <Search className="mr-1 inline h-3.5 w-3.5" /> Open a fault for this
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
