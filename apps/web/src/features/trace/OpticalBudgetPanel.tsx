import { useMemo, useState } from 'react';
import { Calculator, History, Save } from 'lucide-react';

import {
  BUDGET_INPUT_ORIGIN_LABELS,
  BUDGET_OUTCOME_LABELS,
  type BudgetInputOrigin,
  type BudgetOutcome,
  budgetRunsFor,
  type CorePathResult,
  fibrePathBudget,
  type OpticalBudgetRun,
} from '@fibergis/shared';

import { Badge, type BadgeTone, Button, cn } from '../../components/ui';
import { storeBudgetRun, useMayStoreBudgetRuns } from '../../stores/budgetRunActions';
import { selectOpticalSettings, useNetworkStore } from '../../stores/networkStore';

/**
 * Network mapping Phase 17: the optical budget of a traced fibre path. Every input says where it
 * came from (the record, the drawn line, a setting, a default, or not recorded); an assumed optics
 * class gives "Estimated with default class", never a pass or fail; a splitter with no loss is
 * "Unknown". Engineers and planners can store the run with the time and their name. Stacks into
 * one column at phone width.
 */

const ORIGIN_TONE: Record<BudgetInputOrigin, BadgeTone> = {
  record: 'green',
  map: 'amber',
  setting: 'blue',
  default: 'amber',
  not_recorded: 'red',
};

const OUTCOME_TONE: Record<BudgetOutcome, string> = {
  fits_with_margin: 'border-emerald-300 bg-emerald-50 text-emerald-900',
  fits_under_margin: 'border-amber-300 bg-amber-50 text-amber-900',
  too_little_loss: 'border-red-300 bg-red-50 text-red-900',
  over_budget: 'border-red-300 bg-red-50 text-red-900',
  estimated_default_class: 'border-slate-300 bg-slate-50 text-slate-800',
  unknown_splitter: 'border-amber-300 bg-amber-50 text-amber-900',
};

const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
};

export function OpticalBudgetPanel({ path }: { path: CorePathResult }) {
  const optical = useNetworkStore(selectOpticalSettings);
  const overrides = useNetworkStore((s) => s.settings);
  const splitters = useNetworkStore((s) => s.splitters);
  const customers = useNetworkStore((s) => s.customers);
  const runs = useNetworkStore((s) => s.opticalBudgetRuns);
  const mayStore = useMayStoreBudgetRuns();
  const [note, setNote] = useState('');

  const customer = customers.find((c) => c.id === path.targetId);
  const budget = useMemo(
    () => fibrePathBudget(path, { settings: optical, overrides, splitters, customer }),
    [path, optical, overrides, splitters, customer],
  );
  const stored = useMemo(() => budgetRunsFor({ opticalBudgetRuns: runs }, path.targetId), [runs, path.targetId]);

  return (
    <section className="space-y-3 rounded-xl border border-slate-200 p-4 text-xs" data-testid="optical-budget">
      <h3 className="flex flex-wrap items-center gap-2 text-sm font-bold text-slate-900">
        <Calculator className="h-4 w-4 shrink-0" />
        Optical budget
        <Badge tone="blue">Estimated, not measured</Badge>
      </h3>

      <p
        data-testid="optical-budget-outcome"
        className={cn('rounded-md border px-3 py-2 text-[13px]', budget.outcome ? OUTCOME_TONE[budget.outcome] : 'border-amber-300 bg-amber-50 text-amber-900')}
      >
        {budget.outcomeText}
      </p>

      {budget.directions.length > 0 && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {budget.directions.map((d) => (
            <div key={d.direction} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2" data-testid={`optical-budget-${d.direction}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-1">
                <span className="font-semibold text-slate-800">
                  {d.direction === 'downstream' ? 'Down' : 'Up'} at {d.nominalNm ?? d.wavelengthNm} nm
                </span>
                <span className="tabular-nums font-semibold text-slate-900">{d.totalLossDb.toFixed(2)} dB</span>
              </div>
              <p className="mt-0.5 font-medium text-slate-700">{BUDGET_OUTCOME_LABELS[d.outcome]}</p>
              <p className="mt-0.5 text-slate-600">
                {d.remainingDb.toFixed(2)} dB left below {d.classMaxLossDb} dB, {d.afterMarginDb.toFixed(2)} dB after the {d.marginDb} dB repair margin.
              </p>
              {d.direction === 'downstream' && (
                <p className="mt-0.5 text-slate-600">
                  Expected receive:{' '}
                  {d.expectedRxDbm !== undefined
                    ? `${d.expectedRxDbm} dBm`
                    : d.expectedRxRangeDbm
                      ? `${d.expectedRxRangeDbm.min} to ${d.expectedRxRangeDbm.max} dBm (launch not recorded)`
                      : 'not known'}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {budget.flagged.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2" data-testid="optical-budget-flagged">
          <p className="font-semibold text-amber-900">
            {budget.flagged.length} {budget.flagged.length === 1 ? 'input is' : 'inputs are'} not from your records
          </p>
          <ul className="mt-1 space-y-1">
            {budget.flagged.map((l) => (
              <li key={l.key} className="flex flex-wrap items-center gap-1.5 text-slate-700">
                <Badge tone={ORIGIN_TONE[l.origin]}>{BUDGET_INPUT_ORIGIN_LABELS[l.origin]}</Badge>
                <span className="font-medium">{l.label}:</span>
                <span className="tabular-nums">{l.value}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <details className="rounded-md border border-slate-200 px-3 py-2" data-testid="optical-budget-inputs">
        <summary className="cursor-pointer font-semibold text-slate-700">Every input and where it came from ({budget.inputs.length})</summary>
        <ul className="mt-2 divide-y divide-slate-100">
          {budget.inputs.map((l) => (
            <li key={l.key} className="py-1.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-medium text-slate-800">{l.label}</span>
                <span className="tabular-nums text-slate-900">{l.value}</span>
                <Badge tone={ORIGIN_TONE[l.origin]}>{BUDGET_INPUT_ORIGIN_LABELS[l.origin]}</Badge>
              </div>
              <p className="mt-0.5 break-words text-[11px] text-slate-500">{l.source}</p>
            </li>
          ))}
        </ul>
      </details>

      <details className="rounded-md border border-slate-200 px-3 py-2" data-testid="optical-budget-formula">
        <summary className="cursor-pointer font-semibold text-slate-700">How it was worked out</summary>
        <div className="mt-2 space-y-1.5 break-words text-[11px] text-slate-600">
          {budget.directions.map((d) => (
            <p key={d.direction}>{d.formula}</p>
          ))}
          <p className="text-slate-500">{budget.formula}</p>
        </div>
      </details>

      {mayStore && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            placeholder="Note (optional), such as “before handover”"
            aria-label="Note for this budget run"
            className="h-9 w-full min-w-0 flex-1 rounded-md border border-slate-200 px-2 text-xs outline-none focus:border-blue-500"
          />
          <Button
            variant="primary"
            size="lg"
            icon={Save}
            disabled={!budget.complete}
            title={budget.complete ? undefined : 'There is no budget to store: the fibre path is not recorded end to end.'}
            onClick={() => {
              if (storeBudgetRun(path, note)) setNote('');
            }}
            data-testid="optical-budget-store"
          >
            Store this budget run
          </Button>
        </div>
      )}

      <BudgetRunList runs={stored} />
    </section>
  );
}

/** The stored runs for one path, newest first: when, who, the totals and how many inputs were not from records. */
export function BudgetRunList({ runs }: { runs: readonly OpticalBudgetRun[] }) {
  return (
    <div data-testid="optical-budget-runs">
      <p className="flex items-center gap-1.5 font-semibold text-slate-700">
        <History className="h-3.5 w-3.5" /> Stored runs for this path ({runs.length})
      </p>
      {runs.length === 0 ? (
        <p className="mt-0.5 text-slate-500">None stored yet.</p>
      ) : (
        <ul className="mt-1 space-y-1">
          {runs.slice(0, 5).map((r) => (
            <li key={r.id} className="rounded-md border border-slate-200 px-2.5 py-1.5">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="font-medium text-slate-800">{when(r.ranAt)}</span>
                <span className="text-slate-500">by {r.ranBy}</span>
              </div>
              <p className="text-slate-600">
                {r.directions.map((d) => `${d.direction === 'downstream' ? 'Down' : 'Up'} ${d.totalLossDb.toFixed(2)} dB: ${BUDGET_OUTCOME_LABELS[d.outcome]}`).join(' · ')}
                {' · '}
                {r.inputs.filter((l) => l.origin !== 'record').length} inputs not from records
              </p>
              {r.note && <p className="text-slate-500">Note: {r.note}</p>}
            </li>
          ))}
        </ul>
      )}
      {runs.length > 5 && <p className="mt-0.5 text-slate-500">Showing the newest 5.</p>}
    </div>
  );
}
