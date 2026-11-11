import { useState } from 'react';
import { AlertTriangle, Search } from 'lucide-react';

import {
  affectedByElement,
  type CorrelationResult,
  CUSTOMER_HIDDEN_TEXT,
  type DownstreamImpact,
  type DownstreamPortKind,
  type ImpactIndex,
  type ImpactResult,
  type NetworkElementRef,
  SERVICE_KIND_LABELS,
} from '@fibergis/shared';

import { openFaultFor } from '../../stores/faultActions';
import { elementReady } from './faultFormat';
import { buttonClass, ConfidenceBadge, ElementPicker, NoLiveConnection, Section, TestBadge } from './faultUi';

/** A name hidden for the reader's role is shown as such, never as if it were the name. */
const shownName = (c: { name: string; nameHidden?: true }) => (c.nameHidden ? CUSTOMER_HIDDEN_TEXT : c.name);

/** Phase 20: equipment, ports and fibres below the element, from recorded links. */
function DownstreamList({ downstream }: { downstream: DownstreamImpact }) {
  const [open, setOpen] = useState(false);
  const byKind = (kind: DownstreamPortKind) => downstream.ports.filter((p) => p.kind === kind);
  const groups: { title: string; items: string[]; testId: string }[] = [
    { title: 'Equipment', items: downstream.equipment.map((e) => e.label), testId: 'downstream-equipment' },
    { title: 'PON ports', items: byKind('pon_port').map((p) => p.label), testId: 'downstream-pon' },
    { title: 'ODF ports', items: byKind('odf_port').map((p) => p.label), testId: 'downstream-odf' },
    { title: 'Splitter outputs', items: byKind('splitter_output').map((p) => p.label), testId: 'downstream-splitter-outputs' },
    { title: 'Fibres', items: downstream.cores.map((c) => `${c.label} (${c.status === 'Not recorded' ? 'state not recorded' : c.status})`), testId: 'downstream-cores' },
    { title: 'Fibres already marked faulty, retired or damaged', items: downstream.outOfUseCores.map((c) => `${c.label} (${c.status})`), testId: 'downstream-out-of-use' },
  ];
  const counts = `${downstream.equipment.length} item(s), ${downstream.ports.length} port(s), ${downstream.cores.length} fibre(s)${downstream.outOfUseCores.length ? `, ${downstream.outOfUseCores.length} already out of use` : ''}`;
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2" data-testid="downstream">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex min-h-[48px] w-full items-center justify-between gap-2 text-left text-[11px] font-semibold text-slate-800">
        <span>Below it on recorded links: {counts}</span>
        <span className="text-blue-700">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <div className="mt-1 space-y-2">
          {groups
            .filter((g) => g.items.length > 0)
            .map((g) => (
              <div key={g.title} data-testid={g.testId}>
                <div className="text-[11px] font-bold text-slate-700">
                  {g.title} ({g.items.length})
                </div>
                <ul className="max-h-40 list-disc space-y-0.5 overflow-y-auto pl-5 text-[11px] text-slate-700">
                  {g.items.slice(0, 300).map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                  {g.items.length > 300 && <li>… and {g.items.length - 300} more</li>}
                </ul>
              </div>
            ))}
          {downstream.notes.map((n) => (
            <p key={n} className="text-[10px] text-slate-500">
              {n}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

/** Who depends on an element, from recorded paths, with the uncertain ones apart. */
export function ImpactList({ impact }: { impact: ImpactResult }) {
  return (
    <div className="space-y-2" data-testid="impact">
      <div className="text-[11px] font-semibold text-slate-800" data-testid="impact-summary">
        {impact.affected.length} customer(s) on recorded paths through {impact.label} · {impact.activeServices} active service(s)
      </div>
      {impact.downstream && <DownstreamList downstream={impact.downstream} />}
      <div className="grid gap-1 sm:grid-cols-2">
        {impact.affected.map((c) => (
          <div key={c.customerId} className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px]" data-testid="affected-customer">
            <div className="font-semibold text-slate-900">
              <span className={c.nameHidden ? 'italic text-slate-500' : ''}>{shownName(c)}</span> <span className="font-mono text-slate-500">{c.customerId}</span>
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
              {shownName(c)} <span className="font-mono">{c.customerId}</span>: {c.reason}. First missing link: {c.firstGap}
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
  const impact = elementReady(element) ? affectedByElement(ix, element, { downstream: true }) : null;
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
