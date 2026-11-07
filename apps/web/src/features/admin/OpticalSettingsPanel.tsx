import React, { useMemo, useState } from 'react';
import { RotateCcw } from 'lucide-react';

import {
  OPTICAL_SETTING_DEFS,
  type OpticalSettingDef,
  type OpticalSettingGroup,
  validateOpticalOverride,
} from '@fibergis/shared';

import { logAudit } from '../../stores/networkActions';
import { selectOpticalSettings, useNetworkStore } from '../../stores/networkStore';
import { showToast } from '../../stores/toastStore';
import { useUiStore } from '../../stores/uiStore';

const GROUPS: OpticalSettingGroup[] = [
  'Fiber loss',
  'Splices and connectors',
  'Splitters',
  'Couplers',
  'Class budgets',
  'ONT receive levels',
  'Margins',
];

function SettingRow({ def }: { def: OpticalSettingDef }) {
  const override = useNetworkStore((s) => s.settings.find((item) => item.id === def.id));
  const optical = useNetworkStore(selectOpticalSettings);
  const role = useUiStore((s) => s.userRole);
  const current = typeof override?.value === 'number' ? override.value : def.defaultValue;
  const [draft, setDraft] = useState(String(current));
  const [source, setSource] = useState(override?.source ?? '');
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    const value = Number(draft);
    const problem = validateOpticalOverride(def.id, value, optical);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    if (value === def.defaultValue && !source.trim()) {
      reset();
      return;
    }
    useNetworkStore.getState().saveSetting({
      id: def.id,
      value,
      source: source.trim() || undefined,
      updatedAt: new Date().toISOString(),
      updatedBy: role,
    });
    logAudit('SETTING_CHANGED', `${def.label}: ${current} → ${value} ${def.unit}${source.trim() ? ` (${source.trim()})` : ''}`, def.id, 'System');
    showToast('success', 'Setting saved', `${def.label} is now ${value} ${def.unit}.`);
  };

  const reset = () => {
    useNetworkStore.getState().deleteSetting(def.id);
    setDraft(String(def.defaultValue));
    setSource('');
    setError(null);
    if (override) {
      logAudit('SETTING_RESET', `${def.label} back to the default ${def.defaultValue} ${def.unit}`, def.id, 'System');
      showToast('info', 'Back to default', `${def.label} is ${def.defaultValue} ${def.unit} again.`);
    }
  };

  const changed = String(current) !== draft || (override?.source ?? '') !== source;

  return (
    <tr className="align-top">
      <td className="py-2 pr-3">
        <div className="font-semibold text-slate-800">{def.label}</div>
        <div className="text-[11px] text-slate-500">
          Default {def.defaultValue} {def.unit}. {def.source}
        </div>
        {override?.updatedAt && (
          <div className="text-[11px] text-blue-700">
            Changed {override.updatedAt.slice(0, 10)}
            {override.updatedBy ? ` by ${override.updatedBy}` : ''}
          </div>
        )}
      </td>
      <td className="py-2 pr-3">
        <div className="flex items-center gap-1">
          <input
            aria-label={`${def.label} (${def.unit})`}
            inputMode="decimal"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className={`w-24 rounded-lg border px-2 py-1.5 font-mono text-xs outline-none focus:border-blue-500 ${
              override ? 'border-blue-300 bg-blue-50' : 'border-slate-200 bg-white'
            }`}
          />
          <span className="text-[11px] text-slate-500">{def.unit}</span>
        </div>
        {error && <div className="mt-1 text-[11px] font-semibold text-red-700">{error}</div>}
      </td>
      <td className="py-2 pr-3">
        <input
          aria-label={`Where ${def.label} comes from`}
          placeholder="Source, e.g. datasheet"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          className="w-full min-w-32 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-blue-500"
        />
      </td>
      <td className="py-2 whitespace-nowrap text-right">
        <button
          type="button"
          onClick={save}
          disabled={!changed}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
        >
          Save
        </button>
        {override && (
          <button
            type="button"
            onClick={reset}
            className="ml-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Reset
          </button>
        )}
      </td>
    </tr>
  );
}

/** Editor for the operator's optical overrides. Every calculation in the app reads these values. */
export const OpticalSettingsPanel: React.FC = () => {
  const settings = useNetworkStore((s) => s.settings);
  const overrides = useMemo(() => settings.filter((s) => s.id.startsWith('optical.')), [settings]);

  const resetAll = () => {
    overrides.forEach((item) => useNetworkStore.getState().deleteSetting(item.id));
    logAudit('SETTING_RESET', `All ${overrides.length} optical settings back to defaults`, 'optical', 'System');
    showToast('info', 'Back to defaults', 'All optical settings use their documented defaults again.');
  };

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-slate-800">Optical settings</h3>
          <p className="text-xs text-slate-500">
            Planning values used by every loss estimate and receive level check. A datasheet for the installed part
            overrides them. Changes are saved for everyone and listed in the audit trail.
          </p>
        </div>
        <button
          type="button"
          onClick={resetAll}
          disabled={overrides.length === 0}
          className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-40"
        >
          <RotateCcw className="h-3.5 w-3.5" /> Reset all to defaults ({overrides.length} changed)
        </button>
      </div>

      {GROUPS.map((group) => (
        <section key={group} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs">
          <h4 className="mb-2 text-xs font-bold uppercase text-slate-700">{group}</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <tbody className="divide-y divide-slate-100">
                {OPTICAL_SETTING_DEFS.filter((d) => d.group === group).map((def) => (
                  <SettingRow key={def.id} def={def} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
};
