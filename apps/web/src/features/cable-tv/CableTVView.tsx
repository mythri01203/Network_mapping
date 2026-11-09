import { useState } from 'react';
import { Tv } from 'lucide-react';

import { RF_PROFILE_IDS, RF_PROPOSED, type RfProfileId } from '@fibergis/shared';

import { logAudit } from '../../stores/networkActions';
import { useNetworkStore } from '../../stores/networkStore';
import { RfItemsPanel } from './RfItemsPanel';
import { RfLevelsPanel } from './RfLevelsPanel';
import { RfLinksPanel } from './RfLinksPanel';
import { RfTreePanel } from './RfTreePanel';
import { TvCustomersPanel } from './TvCustomersPanel';
import { useRfModel } from './useRfModel';

type Tab = 'tree' | 'items' | 'links' | 'levels' | 'customers' | 'checks';

const TABS: { id: Tab; label: string }[] = [
  { id: 'tree', label: 'RF tree' },
  { id: 'items', label: 'Items' },
  { id: 'links', label: 'Links' },
  { id: 'levels', label: 'Levels' },
  { id: 'customers', label: 'TV customers' },
  { id: 'checks', label: 'Checks' },
];

/**
 * Cable TV (HFC) page (Phase 6). Everything shown comes from the Cable TV records (`rfElements`,
 * `rfLinks`, `rfLevels`) and the Cable TV settings; there is no example or fixed value on it.
 */
export function CableTVView() {
  const model = useRfModel();
  const [tab, setTab] = useState<Tab>('tree');
  const profile = model.rf.profiles[model.rf.activeProfile];
  const errors = model.problems.filter((p) => p.severity === 'error');
  const warnings = model.problems.filter((p) => p.severity === 'warning');

  const chooseProfile = (id: RfProfileId) => {
    if (id === model.rf.activeProfile) return;
    const before = model.rf.profiles[model.rf.activeProfile].label;
    useNetworkStore.getState().saveSetting({ id: 'rf.profile.active', value: id, updatedAt: new Date().toISOString() });
    logAudit('SETTING_CHANGED', `Cable TV level profile: ${before} → ${model.rf.profiles[id].label}`, 'rf.profile.active', 'System');
  };

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden bg-slate-50 text-slate-900" data-testid="cable-tv-view">
      <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-100 text-orange-700">
            <Tv className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-bold">Cable TV (HFC)</h2>
            <p className="text-xs text-slate-600">Headend to set top box, from recorded items and links only. No live connection.</p>
          </div>
          <label className="ml-auto flex items-center gap-2 text-xs font-semibold text-slate-700">
            Level profile
            <select
              className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs"
              value={model.rf.activeProfile}
              onChange={(e) => chooseProfile(e.target.value as RfProfileId)}
              data-testid="rf-profile"
              aria-label="Level profile"
            >
              {RF_PROFILE_IDS.map((id) => (
                <option key={id} value={id}>
                  {model.rf.profiles[id].label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900" data-testid="rf-proposed-note">
          {profile.label}: every level, tilt and profile value is {RF_PROPOSED.toLowerCase().replace(/\.$/, '')}. No cable operator has been interviewed
          yet. Source: {profile.source} Change them in Administration, Cable TV settings.
        </p>
        <div className="mt-2 flex flex-wrap gap-1" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              data-testid={`rf-tab-${t.id}`}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${tab === t.id ? 'bg-orange-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
            >
              {t.label}
              {t.id === 'checks' && model.problems.length > 0 ? ` (${model.problems.length})` : ''}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-6xl">
          {tab === 'tree' && <RfTreePanel model={model} />}
          {tab === 'items' && <RfItemsPanel model={model} />}
          {tab === 'links' && <RfLinksPanel model={model} />}
          {tab === 'levels' && <RfLevelsPanel model={model} />}
          {tab === 'customers' && <TvCustomersPanel model={model} />}
          {tab === 'checks' && (
            <section className="rounded-xl border border-slate-200 bg-white p-4" data-testid="rf-checks">
              <h4 className="text-sm font-bold">Checks on the Cable TV records</h4>
              <p className="mb-2 text-xs text-slate-600">
                {errors.length} must fix, {warnings.length} to check. Passing these does not prove the map matches the street. No PON splitter or fiber rule
                is applied to Cable TV parts.
              </p>
              {model.problems.length === 0 && <p className="text-sm text-slate-600">Nothing found.</p>}
              <ul className="space-y-1 text-xs">
                {model.problems.map((p) => (
                  <li key={p.key} className={p.severity === 'error' ? 'font-semibold text-red-700' : 'text-amber-800'} data-testid="rf-check-row">
                    {p.severity === 'error' ? 'Must fix: ' : 'Check: '}
                    {p.message}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
