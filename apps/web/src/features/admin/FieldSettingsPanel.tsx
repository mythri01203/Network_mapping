import { useState } from 'react';

import { FAULT_SETTING_DEFS, FIELD_SETTING_DEFS, MONITORING_SETTING_DEFS, OSP_SETTING_DEFS } from '@fibergis/shared';

/** What a settings row needs: both field capture and outside-plant settings have this shape. */
interface SettingRowDef {
  id: string;
  label: string;
  unit: string;
  defaultValue: number | string;
  source: string;
  check?: (value: number | string) => string | null;
}

import { logAudit } from '../../stores/networkActions';
import { useNetworkStore } from '../../stores/networkStore';
import { showToast } from '../../stores/toastStore';
import { useUiStore } from '../../stores/uiStore';

function FieldSettingRow({ def }: { def: SettingRowDef }) {
  const override = useNetworkStore((s) => s.settings.find((item) => item.id === def.id));
  const role = useUiStore((s) => s.userRole);
  const isText = typeof def.defaultValue === 'string';
  const current = override && typeof override.value === typeof def.defaultValue ? override.value : def.defaultValue;
  const [draft, setDraft] = useState(String(current));
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    useNetworkStore.getState().deleteSetting(def.id);
    setDraft(String(def.defaultValue));
    setError(null);
    if (override) {
      logAudit('SETTING_RESET', `${def.label} back to the default ${def.defaultValue || '(not set)'}`, def.id, 'System');
      showToast('info', 'Back to default', `${def.label} uses its default again.`);
    }
  };

  const save = () => {
    const value: number | string = isText ? draft.trim() : Number(draft);
    const problem = (!isText && !Number.isFinite(value) ? 'Enter a number.' : null) ?? def.check?.(value) ?? null;
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    if (value === def.defaultValue) {
      reset();
      return;
    }
    useNetworkStore.getState().saveSetting({ id: def.id, value, updatedAt: new Date().toISOString(), updatedBy: role });
    logAudit('SETTING_CHANGED', `${def.label}: ${current || '(not set)'} → ${value}`, def.id, 'System');
    showToast('success', 'Setting saved', `${def.label} is now ${value}${isText ? '' : ` ${def.unit}`}.`);
  };

  return (
    <tr className="align-top">
      <td className="py-2 pr-3">
        <div className="font-semibold text-slate-800">{def.label}</div>
        <div className="text-[11px] text-slate-500">
          Default {def.defaultValue === '' ? 'not set' : `${def.defaultValue}${isText ? '' : ` ${def.unit}`}`}. {def.source}
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
            aria-label={def.label}
            inputMode={isText ? 'tel' : 'decimal'}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            data-testid={`field-setting-${def.id}`}
            className={`${isText ? 'w-44' : 'w-24'} rounded-lg border px-2 py-1.5 font-mono text-xs outline-none focus:border-blue-500 ${
              override ? 'border-blue-300 bg-blue-50' : 'border-slate-200 bg-white'
            }`}
          />
          {!isText && <span className="text-[11px] text-slate-500">{def.unit}</span>}
        </div>
        {error && <div className="mt-1 text-[11px] font-semibold text-red-700">{error}</div>}
      </td>
      <td className="py-2 whitespace-nowrap text-right">
        <button
          type="button"
          onClick={save}
          disabled={draft === String(current)}
          data-testid={`field-setting-save-${def.id}`}
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

/** Limits used by the phone capture flow, and the supervisor's number for its call button. */
export function FieldSettingsPanel() {
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <h3 className="text-sm font-bold text-slate-800">Field capture settings</h3>
        <p className="text-xs text-slate-500">
          Used by the phone capture flow (/capture). The GPS and "same one?" limits are proposals, not standards: test
          them on your own streets. Changes are saved for everyone and listed in the audit trail.
        </p>
      </div>
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <tbody className="divide-y divide-slate-100">
              {FIELD_SETTING_DEFS.map((def) => (
                <FieldSettingRow key={def.id} def={def} />
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

/** Limits for grouping alarms into a suspected shared cause (Phase 8). */
export function FaultSettingsPanel() {
  return (
    <div className="mx-auto max-w-5xl space-y-4" data-testid="fault-settings">
      <div>
        <h3 className="text-sm font-bold text-slate-800">Fault checks settings</h3>
        <p className="text-xs text-slate-500">
          Used when alarms are compared to find a suspected shared cause (Faults and field work, Suspected causes). They decide how sure the screen
          sounds, never what is true: every result stays "suspected" until someone checks on site. There is no live OLT connection, so a customer with
          no alarm is not proven to be working.
        </p>
      </div>
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <tbody className="divide-y divide-slate-100">
              {FAULT_SETTING_DEFS.map((def) => (
                <FieldSettingRow key={def.id} def={def} />
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

/** Limits for poles, routes and lengths: the "same one?" distance, pole suggestions and length flags. */
export function OspSettingsPanel() {
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <h3 className="text-sm font-bold text-slate-800">Poles and routes settings</h3>
        <p className="text-xs text-slate-500">
          Used when adding poles, chambers and boxes on the map, when suggesting poles near a cable line, and when comparing drawn,
          sheath and optical lengths. They are proposals, not standards, and they only warn: nothing is ever blocked or linked by them.
        </p>
      </div>
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <tbody className="divide-y divide-slate-100">
              {OSP_SETTING_DEFS.map((def) => (
                <FieldSettingRow key={def.id} def={def} />
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

/** How old a monitored status or reading may be before it is shown as stale (Phase 7). */
export function MonitoringSettingsPanel() {
  return (
    <div className="mx-auto max-w-5xl space-y-4" data-testid="monitoring-settings">
      <div>
        <h3 className="text-sm font-bold text-slate-800">Monitoring settings</h3>
        <p className="text-xs text-slate-500">
          Used by Live status, the customer panel and the dashboard. They are proposals, not standards: match them to how often your OLT or NMS sends data. A value older than
          these is shown as stale, never as current, and &quot;Live&quot; is shown only for a real source inside the status time.
        </p>
      </div>
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <tbody className="divide-y divide-slate-100">
              {MONITORING_SETTING_DEFS.map((def) => (
                <FieldSettingRow key={def.id} def={def} />
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
