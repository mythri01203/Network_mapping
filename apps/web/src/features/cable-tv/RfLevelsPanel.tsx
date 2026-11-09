import { describeRfPort, formatRfBoth, RF_ORIGIN_LABELS } from '@fibergis/shared';

import { deleteRfLevel } from '../../stores/rfActions';
import { RfLevelForm } from './RfLevelForm';
import { estimateText, levelText } from './rfText';
import type { RfModel } from './useRfModel';

const ORIGIN_STYLE: Record<string, string> = {
  field_measured: 'bg-emerald-50 text-emerald-800 border-emerald-300',
  device_reported: 'bg-blue-50 text-blue-800 border-blue-300',
  designed: 'bg-violet-50 text-violet-800 border-violet-300',
  calculated: 'bg-slate-100 text-slate-700 border-slate-300',
};

/** Recorded levels with their unit and origin, each against the estimate and the active profile. */
export function RfLevelsPanel({ model }: { model: RfModel }) {
  const profile = model.rf.profiles[model.rf.activeProfile];
  return (
    <div className="space-y-4">
      <RfLevelForm model={model} />
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h4 className="mb-1 text-sm font-bold text-slate-800">Levels on record ({model.checks.length})</h4>
        <p className="mb-2 text-xs text-slate-600">
          No live connection: nothing here comes from a device integration. Customer ports are checked against {profile.label} (proposed: check with your
          operators).
        </p>
        {model.checks.length === 0 ? (
          <p className="text-sm text-slate-600">Not recorded.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-xs" data-testid="rf-levels">
            {model.checks.map((c) => (
              <li key={c.level.id} className="py-2" data-testid="rf-level-row">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-slate-900">{describeRfPort(model.ix, c.level)}</span>
                  <span className={`rounded border px-1.5 py-0.5 text-[11px] font-semibold ${ORIGIN_STYLE[c.level.origin]}`} data-testid="rf-level-origin-badge">
                    {RF_ORIGIN_LABELS[c.level.origin]}
                  </span>
                  <button type="button" className="ml-auto text-[11px] text-slate-500 underline" onClick={() => void deleteRfLevel(c.level.id)}>
                    Entered by mistake
                  </button>
                </div>
                <div className="text-slate-800" data-testid="rf-level-text">{levelText(c.level, c.trueDbuv)}</div>
                <div className="text-slate-600">
                  {[c.level.technician && `read by ${c.level.technician}`, c.level.instrument && `meter ${c.level.instrument}`, c.level.measuredAt && `on ${c.level.measuredAt.slice(0, 10)}`, c.level.source && `source: ${c.level.source}`]
                    .filter(Boolean)
                    .join(' · ') || 'Who, meter and date not recorded'}
                </div>
                {c.port?.signal === 'rf' && <div className="text-slate-600">{estimateText(c.estimate, model.rf)}</div>}
                {c.outsideProfile && c.window && (
                  <div className="font-semibold text-amber-800" data-testid="rf-level-profile">
                    {c.outsideProfile === 'below' ? 'Below' : 'Above'} the {profile.label} window {formatRfBoth(c.window.min)} to {formatRfBoth(c.window.max)} (proposed).
                  </div>
                )}
                {c.aboveEstimate && (
                  <div className="font-semibold text-amber-800">
                    Above the estimate by more than {model.rf.aboveEstimateDb} dB. Passive parts cannot add signal: check the unit, a test point, or the port read.
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
