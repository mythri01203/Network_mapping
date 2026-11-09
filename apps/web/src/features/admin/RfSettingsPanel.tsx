import { useState } from 'react';

import { resolveRfSettings, RF_PROFILE_IDS, RF_PROPOSED, RF_SETTING_DEFS, type RfSettingDef, roleMay } from '@fibergis/shared';

import { currentAccount, loginIsOn, useAuthStore } from '../../stores/authStore';
import { logAudit } from '../../stores/networkActions';
import { useNetworkStore } from '../../stores/networkStore';
import { showToast } from '../../stores/toastStore';
import { useUiStore } from '../../stores/uiStore';

/** Same rule as the store: with login on, only roles that may change settings (access.ts) can edit. */
function useCanEdit(): boolean {
  return useAuthStore((s) => {
    const account = loginIsOn(s) ? currentAccount(s) : null;
    return !account || roleMay(account.role, 'change_settings');
  });
}

const sourceNote = (def: RfSettingDef) => def.source.replace(RF_PROPOSED, '').trim();
const showValue = (def: RfSettingDef, value: number | string) => `${value}${def.unit && def.unit !== 'count' ? ` ${def.unit}` : ''}`;

/** The low and high estimate frequencies must stay in order, or the calculation falls back to its defaults. */
function crossCheck(def: RfSettingDef, value: number | string): string | null {
  if (def.id !== 'rf.calc.lowMhz' && def.id !== 'rf.calc.highMhz') return null;
  const others = useNetworkStore.getState().settings.filter((s) => s.id !== def.id);
  const rf = resolveRfSettings([...others, { id: def.id, value }]);
  if (rf.highMhz <= rf.lowMhz) return 'The high frequency must be above the low frequency.';
  return null;
}

function RfSettingRow({ def, canEdit }: { def: RfSettingDef; canEdit: boolean }) {
  const override = useNetworkStore((s) => s.settings.find((item) => item.id === def.id));
  const role = useUiStore((s) => s.userRole);
  const isText = typeof def.defaultValue === 'string';
  const current: number | string = override && typeof override.value === typeof def.defaultValue ? (override.value as number | string) : def.defaultValue;
  const [draft, setDraft] = useState(String(current));
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    useNetworkStore.getState().deleteSetting(def.id);
    setDraft(String(def.defaultValue));
    setError(null);
    if (override) {
      logAudit('SETTING_RESET', `${def.label} back to the default ${showValue(def, def.defaultValue)}`, def.id, 'System');
      showToast('info', 'Back to default', `${def.label} uses its default again.`);
    }
  };

  const save = () => {
    const value: number | string = isText ? draft.trim() : Number(draft);
    const problem = (!isText && (draft.trim() === '' || !Number.isFinite(value)) ? 'Enter a number.' : null) ?? def.check?.(value) ?? crossCheck(def, value);
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
    logAudit('SETTING_CHANGED', `${def.label}: ${showValue(def, current)} → ${showValue(def, value)}`, def.id, 'System');
    showToast('success', 'Setting saved', `${def.label} is now ${showValue(def, value)}.`);
  };

  const inputClass = `rounded-lg border px-2 py-1.5 font-mono text-xs outline-none focus:border-blue-500 disabled:opacity-60 ${
    override ? 'border-blue-300 bg-blue-50' : 'border-slate-200 bg-white'
  }`;

  return (
    <tr className="align-top">
      <td className="py-2 pr-3">
        <div className="font-semibold text-slate-800">{def.label}</div>
        <div className="text-[11px] font-semibold text-amber-700">{RF_PROPOSED.replace(/\.$/, '')}</div>
        <div className="text-[11px] text-slate-500">
          Default {showValue(def, def.defaultValue)}. {sourceNote(def)}
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
          {isText ? (
            <select aria-label={def.label} value={draft} disabled={!canEdit} onChange={(e) => setDraft(e.target.value)} data-testid={`rf-setting-${def.id}`} className={`w-36 ${inputClass}`}>
              {RF_PROFILE_IDS.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          ) : (
            <input aria-label={`${def.label} (${def.unit})`} inputMode="decimal" value={draft} disabled={!canEdit} onChange={(e) => setDraft(e.target.value)} data-testid={`rf-setting-${def.id}`} className={`w-24 ${inputClass}`} />
          )}
          {!isText && def.unit !== 'count' && <span className="text-[11px] text-slate-500">{def.unit}</span>}
        </div>
        {error && <div className="mt-1 text-[11px] font-semibold text-red-700">{error}</div>}
      </td>
      <td className="py-2 whitespace-nowrap text-right">
        {canEdit && (
          <>
            <button type="button" onClick={save} disabled={draft === String(current)} data-testid={`rf-setting-save-${def.id}`} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">
              Save
            </button>
            {override && (
              <button type="button" onClick={reset} className="ml-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                Reset
              </button>
            )}
          </>
        )}
      </td>
    </tr>
  );
}

const GROUPS: { title: string; match: (id: string) => boolean }[] = [
  { title: 'Level profile', match: (id) => id === 'rf.profile.active' },
  { title: 'Customer level windows', match: (id) => id.startsWith('rf.profile.') && id !== 'rf.profile.active' },
  { title: 'Estimate frequencies', match: (id) => id.startsWith('rf.calc.') },
  { title: 'Coax loss', match: (id) => id.startsWith('rf.coax.') },
  { title: 'Limits and hints', match: (id) => id.startsWith('rf.amp.') || id.startsWith('rf.check.') || id.startsWith('rf.hint.') },
];

/** Cable TV level settings (Phase 6). Every value is proposed until operators confirm it. */
export function RfSettingsPanel() {
  const settings = useNetworkStore((s) => s.settings);
  const canEdit = useCanEdit();
  const rf = resolveRfSettings(settings);
  const valueOf = (id: string) => String(settings.find((s) => s.id === id)?.value ?? '');

  return (
    <div className="mx-auto max-w-5xl space-y-4" data-testid="rf-settings">
      <div>
        <h3 className="text-sm font-bold text-slate-800">Cable TV settings</h3>
        <p className="text-xs text-slate-500">
          Used by the Cable TV page to estimate levels and check customers. No cable operator has been asked yet, so every value is
          proposed: check with your operators. Changes are saved for everyone and listed in the audit trail.
        </p>
        <p className="mt-1 text-xs text-slate-700">
          Profile in use: <span className="font-semibold">{rf.profiles[rf.activeProfile].label}</span> ({rf.activeProfile}, levels in{' '}
          {rf.profiles[rf.activeProfile].unit === 'dBuV' ? 'dBµV' : 'dBmV'}).
        </p>
        {!canEdit && (
          <p className="mt-1 text-xs font-semibold text-amber-700" data-testid="rf-settings-readonly">
            Only engineers and the administrator change these settings. You can read them.
          </p>
        )}
      </div>
      {GROUPS.map((group) => (
        <section key={group.title} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs">
          <h4 className="mb-2 text-xs font-bold uppercase text-slate-700">{group.title}</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <tbody className="divide-y divide-slate-100">
                {RF_SETTING_DEFS.filter((def) => group.match(def.id)).map((def) => (
                  <RfSettingRow key={`${def.id}:${valueOf(def.id)}`} def={def} canEdit={canEdit} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
