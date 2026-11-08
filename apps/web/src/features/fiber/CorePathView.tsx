import { AlertTriangle, CheckCircle2 } from 'lucide-react';

import { type CorePathResult, LINK_VERDICT_LABELS } from '@fibergis/shared';

import { cn } from '../../components/ui';
import { FiberSwatch } from './FiberChip';

const KIND_LABEL: Record<string, string> = {
  olt: 'OLT port',
  patch: 'Patch cord',
  odf: 'ODF port',
  cable: 'Fiber',
  splice: 'Splice',
  splitter: 'Splitter',
  ont: 'ONT',
  gap: 'Missing link',
};

/** A core-by-core path: each step in order, the exact gap if the chain breaks, and the budget per direction. */
export function CorePathView({ path, showBudget = true }: { path: CorePathResult; showBudget?: boolean }) {
  return (
    <div className="space-y-3" data-testid="core-path">
      <div
        data-testid="core-path-status"
        className={cn(
          'flex items-start gap-2 rounded-md border px-3 py-2 text-[13px]',
          path.complete ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-amber-300 bg-amber-50 text-amber-900',
        )}
      >
        {path.complete ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <AlertTriangle size={16} className="mt-0.5 shrink-0" />}
        <span>
          {path.complete
            ? `Fiber path recorded end to end: ${path.steps.length} steps from ${path.olt?.name ?? 'the OLT'} ${path.pon?.id ?? ''}.`
            : `Fiber path is broken: ${path.gaps[0]}`}
        </span>
      </div>

      <ol className="space-y-1">
        {path.steps.map((step, i) => (
          <li
            key={`${step.kind}-${step.id}-${i}`}
            data-testid={`core-step-${step.kind}`}
            className={cn(
              'rounded-md border px-2.5 py-1.5 text-xs',
              step.kind === 'gap' ? 'border-amber-300 bg-amber-50' : step.status === 'broken' ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-white',
            )}
          >
            <div className="flex items-center gap-2">
              <span className="w-5 shrink-0 text-right tabular-nums text-slate-400">{i + 1}</span>
              {step.kind === 'cable' && <FiberSwatch identity={step.identity} />}
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{KIND_LABEL[step.kind]}</span>
              <span className="min-w-0 flex-1 truncate font-medium text-slate-900">{step.title}</span>
              {step.lossDb !== undefined && step.kind !== 'gap' && <span className="shrink-0 tabular-nums text-slate-500">{step.lossDb} dB</span>}
            </div>
            <p className="mt-0.5 pl-7 text-[11px] leading-snug text-slate-600">{step.detail}</p>
          </li>
        ))}
      </ol>

      {showBudget && path.complete && path.directions.length > 0 && (
        <div className="space-y-1.5" data-testid="core-budget">
          {path.directions.map((d) => (
            <div key={d.direction} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-slate-800">
                  {d.direction === 'downstream' ? 'Down' : 'Up'} at {d.nominalNm ?? d.wavelengthNm} nm
                </span>
                <span className="tabular-nums font-semibold text-slate-900">{d.budget.totalLossDb.toFixed(2)} dB (estimated)</span>
              </div>
              <p className="mt-0.5 text-slate-600" data-testid={`core-verdict-${d.direction}`}>
                {LINK_VERDICT_LABELS[d.budget.linkVerdict]} for {d.budget.opticsClass} ({d.budget.classMinLossDb ?? '?'} to {d.budget.classMaxLossDb} dB):{' '}
                {d.budget.remainingDb.toFixed(2)} dB left, {d.budget.afterMarginDb.toFixed(2)} dB after the repair margin.
              </p>
              {d.vendor && (
                <p className="mt-0.5 text-slate-500">
                  Vendor budget {d.vendor.budgetDb} dB{d.vendor.source ? ` (${d.vendor.source})` : ''}: {d.vendor.remainingDb.toFixed(2)} dB left. Shown apart from the class.
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {(path.warnings.length > 0 || path.notes.length > 0) && (
        <ul className="space-y-0.5 text-[11px] text-slate-600">
          {path.warnings.map((w) => (
            <li key={w} className="text-amber-800">
              Check: {w}
            </li>
          ))}
          {path.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
