import { useMemo, useState } from 'react';
import { ListChecks, Plus, Trash2 } from 'lucide-react';

import {
  ATTRIBUTE_TARGETS,
  ATTRIBUTE_TYPES,
  type AttributeTarget,
  type AttributeType,
  attributeDefinitions,
  attributeSettingId,
  EDITABLE_LIST_KEYS,
  EDITABLE_LISTS,
  type EditableListKey,
  listChangeProblem,
  listSettingId,
  type ListOverlay,
  NAMING_TARGETS,
  type NamingTarget,
  namingRuleFor,
  namingSettingId,
  nextNameFromRule,
  parseListOverlay,
  resolveEditableList,
  ruleSettingProblem,
  type Setting,
  usedListValues,
} from '@fibergis/shared';

import { useMayDo } from '../../stores/authStore';
import { logAudit } from '../../stores/networkActions';
import { useNetworkStore } from '../../stores/networkStore';
import { showToast } from '../../stores/toastStore';
import { useUiStore } from '../../stores/uiStore';
import { ChecklistEditor } from '../field-review/ChecklistEditor';

const BUTTON = 'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-semibold disabled:opacity-50';
const FIELD = 'h-9 rounded-lg border border-slate-300 bg-white px-2 text-xs';

const TYPE_WORDS: Record<AttributeType, string> = { text: 'Text', number: 'Number', yes_no: 'Yes or no', choice: 'One of a list', date: 'Date' };

function useSave() {
  const role = useUiStore((s) => s.userRole);
  return (setting: Pick<Setting, 'id' | 'value'>, what: string) => {
    useNetworkStore.getState().saveSetting({ ...setting, updatedAt: new Date().toISOString(), updatedBy: role });
    logAudit('SETTING_CHANGED', what, setting.id, 'System');
    showToast('success', 'Saved', what);
  };
}

/** One editable list: built-in values (rename, hide) and the owner's own values (add, remove when unused). */
function ListEditor({ listKey, settings, canEdit }: { listKey: EditableListKey; settings: readonly Setting[]; canEdit: boolean }) {
  const def = EDITABLE_LISTS[listKey];
  const equipment = useNetworkStore((s) => s.equipment);
  const save = useSave();
  const stored = settings.find((s) => s.id === listSettingId(listKey));
  const parsed = stored ? parseListOverlay(stored.value) : null;
  const [draft, setDraft] = useState<ListOverlay>(() => (parsed?.ok ? parsed.overlay : { added: [], labels: {}, hidden: [] }));
  const [newValue, setNewValue] = useState('');
  const [newGroup, setNewGroup] = useState(def.groups?.[0] ?? '');
  const [error, setError] = useState<string | null>(null);
  const used = useMemo(() => usedListValues(listKey, { equipment }), [listKey, equipment]);
  const entries = resolveEditableList(listKey, [{ id: listSettingId(listKey), value: JSON.stringify(draft) }]).entries;

  const toggleHidden = (value: string) => setDraft((d) => ({ ...d, hidden: d.hidden.includes(value) ? d.hidden.filter((v) => v !== value) : [...d.hidden, value] }));
  const rename = (value: string, label: string) =>
    setDraft((d) => {
      const labels = { ...d.labels };
      if (label.trim() && label.trim() !== value) labels[value] = label.trim();
      else delete labels[value];
      return { ...d, labels };
    });

  const commit = () => {
    const value = JSON.stringify(draft);
    const problem = listChangeProblem(listKey, stored?.value, value, used);
    setError(problem);
    if (problem) return;
    save({ id: listSettingId(listKey), value }, `${def.title}: list changed`);
  };

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4" data-testid={`list-editor-${listKey}`}>
      <p className="text-xs text-slate-600">
        {def.allowsCustom
          ? 'You can add your own values. A value used by any record cannot be removed: hide it instead, and it stays on those records.'
          : 'This list is fixed by the program (the checks depend on it). You can change the name shown and hide values from new items; adding a value needs a program change.'}
      </p>
      <table className="w-full text-left text-xs">
        <thead className="text-[11px] uppercase text-slate-500">
          <tr>
            <th className="py-1 pr-2">Value (stored)</th>
            <th className="py-1 pr-2">Name shown</th>
            <th className="py-1 pr-2">Offer for new items</th>
            <th className="py-1" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {entries.map((e) => (
            <tr key={e.value}>
              <td className="py-1 pr-2 font-mono">
                {e.value}
                {!e.builtIn && <span className="ml-1 rounded bg-blue-100 px-1 text-[10px] text-blue-800">yours</span>}
                {e.group && <div className="text-[10px] text-slate-400">{e.group}</div>}
              </td>
              <td className="py-1 pr-2">
                <input className={`${FIELD} w-48`} disabled={!canEdit} defaultValue={e.label} onBlur={(ev) => rename(e.value, ev.target.value)} aria-label={`Name shown for ${e.value}`} />
              </td>
              <td className="py-1 pr-2">
                <input type="checkbox" disabled={!canEdit} checked={!e.hidden} onChange={() => toggleHidden(e.value)} aria-label={`Offer ${e.value} for new items`} />
              </td>
              <td className="py-1">
                {!e.builtIn && canEdit && (
                  <button
                    type="button"
                    className="text-red-700 disabled:opacity-40"
                    disabled={used.has(e.value)}
                    title={used.has(e.value) ? 'Used by records: hide it instead' : 'Remove'}
                    onClick={() => setDraft((d) => ({ ...d, added: d.added.filter((a) => a.value !== e.value) }))}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {def.allowsCustom && canEdit && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs font-semibold text-slate-700">
            New value
            <input className={`${FIELD} mt-1 block w-48`} value={newValue} maxLength={def.maxLength} onChange={(e) => setNewValue(e.target.value)} />
          </label>
          {def.groups && (
            <label className="text-xs font-semibold text-slate-700">
              Group
              <select className={`${FIELD} mt-1 block`} value={newGroup} onChange={(e) => setNewGroup(e.target.value)}>
                {def.groups.map((g) => (
                  <option key={g}>{g}</option>
                ))}
              </select>
            </label>
          )}
          <button
            type="button"
            className={`${BUTTON} border border-slate-300 bg-white text-slate-700`}
            disabled={!newValue.trim()}
            onClick={() => {
              setDraft((d) => ({ ...d, added: [...d.added, { value: newValue.trim(), ...(def.groups ? { group: newGroup } : {}) }] }));
              setNewValue('');
            }}
          >
            <Plus size={14} /> Add
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs font-semibold text-red-700">
          {error}
        </p>
      )}
      {canEdit && (
        <button type="button" className={`${BUTTON} bg-blue-700 text-white`} onClick={commit} data-testid={`list-save-${listKey}`}>
          Save {def.title.toLowerCase()}
        </button>
      )}
    </div>
  );
}

function NamingRules({ settings, canEdit }: { settings: readonly Setting[]; canEdit: boolean }) {
  const save = useSave();
  const [target, setTarget] = useState<NamingTarget>('equipment');
  const records = useNetworkStore((s) => s[target]) as readonly { name: string }[];
  const [type, setType] = useState('');
  const [pattern, setPattern] = useState('');
  const [error, setError] = useState<string | null>(null);
  const rules = settings.filter((s) => s.id.startsWith('naming.'));
  const existing = records.map((r) => r.name);
  const preview = pattern ? nextNameFromRule({ pattern }, existing, { type: type || undefined, area: 'AREA' }) : '';

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4" data-testid="naming-rules">
      <p className="text-xs text-slate-600">
        A pattern for the name of new items. {'{n}'} or {'{n:3}'} is the next free number, {'{area}'} the area, {'{type}'} the type, {'{yyyy}'} the year. Example: FAT-{'{area}'}-{'{n:3}'}. Record ids do not change.
      </p>
      <ul className="space-y-1 text-xs">
        {rules.length === 0 && <li className="text-slate-500">No naming rules yet.</li>}
        {rules.map((r) => (
          <li key={r.id} className="flex items-center gap-2">
            <span className="font-mono">{r.id.replace(/^naming\./, '')}</span>
            <span className="font-mono text-slate-600">{(() => { try { return (JSON.parse(String(r.value)) as { pattern: string }).pattern; } catch { return String(r.value); } })()}</span>
            {canEdit && (
              <button type="button" className="text-red-700" aria-label={`Remove rule ${r.id}`} onClick={() => useNetworkStore.getState().deleteSetting(r.id)}>
                <Trash2 size={14} />
              </button>
            )}
          </li>
        ))}
      </ul>
      {canEdit && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs font-semibold text-slate-700">
            For
            <select className={`${FIELD} mt-1 block`} value={target} onChange={(e) => setTarget(e.target.value as NamingTarget)}>
              {NAMING_TARGETS.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          {target === 'equipment' && (
            <label className="text-xs font-semibold text-slate-700">
              Only this type (optional)
              <input className={`${FIELD} mt-1 block w-32`} value={type} onChange={(e) => setType(e.target.value)} placeholder="FAT" />
            </label>
          )}
          <label className="text-xs font-semibold text-slate-700">
            Pattern
            <input className={`${FIELD} mt-1 block w-56 font-mono`} value={pattern} onChange={(e) => setPattern(e.target.value)} />
          </label>
          <button
            type="button"
            className={`${BUTTON} bg-blue-700 text-white`}
            disabled={!pattern.trim()}
            onClick={() => {
              const id = namingSettingId(target, target === 'equipment' && type.trim() ? type.trim() : undefined);
              const value = JSON.stringify({ pattern: pattern.trim(), ...(type.trim() ? { type: type.trim() } : {}) });
              const problem = ruleSettingProblem(id, value);
              setError(problem);
              if (!problem) save({ id, value }, `Naming rule ${id.replace(/^naming\./, '')}: ${pattern.trim()}`);
            }}
          >
            Save rule
          </button>
          {preview && <span className="text-xs text-slate-500">Next name would be: <span className="font-mono">{preview}</span></span>}
        </div>
      )}
      {namingRuleFor(target, settings, type || undefined) && <p className="text-[11px] text-slate-400">A rule is already set for {target}.</p>}
      {error && (
        <p role="alert" className="text-xs font-semibold text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

function CustomFields({ settings, canEdit }: { settings: readonly Setting[]; canEdit: boolean }) {
  const save = useSave();
  const [target, setTarget] = useState<AttributeTarget>('equipment');
  const [form, setForm] = useState<{ key: string; label: string; type: AttributeType; choices: string; unit: string }>({ key: '', label: '', type: 'text', choices: '', unit: '' });
  const [error, setError] = useState<string | null>(null);
  const defs = ATTRIBUTE_TARGETS.flatMap((t) => attributeDefinitions(t, settings));

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4" data-testid="custom-fields">
      <p className="text-xs text-slate-600">Your own fields for a kind of record, such as a pole height class. The server checks every value against its field.</p>
      <ul className="space-y-1 text-xs">
        {defs.length === 0 && <li className="text-slate-500">No custom fields yet.</li>}
        {defs.map((d) => (
          <li key={`${d.target}.${d.key}`} className="flex items-center gap-2">
            <span className="font-mono">
              {d.target}.{d.key}
            </span>
            <span className="font-semibold">{d.label}</span>
            <span className="text-slate-500">
              {TYPE_WORDS[d.type]}
              {d.choices ? `: ${d.choices.join(', ')}` : ''}
              {d.unit ? ` (${d.unit})` : ''}
            </span>
            {canEdit && (
              <button type="button" className="text-red-700" aria-label={`Remove field ${d.key}`} onClick={() => useNetworkStore.getState().deleteSetting(attributeSettingId(d.target, d.key))}>
                <Trash2 size={14} />
              </button>
            )}
          </li>
        ))}
      </ul>
      {canEdit && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs font-semibold text-slate-700">
            For
            <select className={`${FIELD} mt-1 block`} value={target} onChange={(e) => setTarget(e.target.value as AttributeTarget)}>
              {ATTRIBUTE_TARGETS.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-700">
            Key
            <input className={`${FIELD} mt-1 block w-32 font-mono`} value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} placeholder="heightClass" />
          </label>
          <label className="text-xs font-semibold text-slate-700">
            Name shown
            <input className={`${FIELD} mt-1 block w-40`} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
          </label>
          <label className="text-xs font-semibold text-slate-700">
            Kind
            <select className={`${FIELD} mt-1 block`} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as AttributeType })}>
              {ATTRIBUTE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_WORDS[t]}
                </option>
              ))}
            </select>
          </label>
          {form.type === 'choice' && (
            <label className="text-xs font-semibold text-slate-700">
              Choices (comma between)
              <input className={`${FIELD} mt-1 block w-48`} value={form.choices} onChange={(e) => setForm({ ...form, choices: e.target.value })} />
            </label>
          )}
          <label className="text-xs font-semibold text-slate-700">
            Unit (optional)
            <input className={`${FIELD} mt-1 block w-20`} value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
          </label>
          <button
            type="button"
            className={`${BUTTON} bg-blue-700 text-white`}
            disabled={!form.key.trim() || !form.label.trim()}
            onClick={() => {
              const id = attributeSettingId(target, form.key.trim());
              const choices = form.choices.split(',').map((c) => c.trim()).filter(Boolean);
              const value = JSON.stringify({ label: form.label.trim(), type: form.type, ...(form.type === 'choice' ? { choices } : {}), ...(form.unit.trim() ? { unit: form.unit.trim() } : {}) });
              const problem = ruleSettingProblem(id, value);
              setError(problem);
              if (!problem) save({ id, value }, `Custom field ${target}.${form.key.trim()}: ${form.label.trim()}`);
            }}
          >
            Save field
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs font-semibold text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

/** Phase 23: Administration, Lists and rules. Changing them needs the configure right (checked again on the server). */
export function ListsRulesPanel() {
  const settings = useNetworkStore((s) => s.settings);
  const canEdit = useMayDo('configure');
  const [listKey, setListKey] = useState<EditableListKey>('equipmentTypes');

  return (
    <div className="mx-auto max-w-5xl space-y-6" data-testid="lists-rules-panel">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800">
          <ListChecks size={16} /> Lists and rules
        </h3>
        <p className="text-xs text-slate-500">
          {canEdit ? 'Changes are sent to the server like any other change.' : 'Your account can look at these but not change them. Ask a GIS engineer or a network admin.'}
        </p>
      </div>
      <section className="space-y-2">
        <div className="flex flex-wrap gap-1.5">
          {EDITABLE_LIST_KEYS.map((k) => (
            <button key={k} type="button" onClick={() => setListKey(k)} className={`${BUTTON} ${k === listKey ? 'bg-blue-700 text-white' : 'border border-slate-300 bg-white text-slate-700'}`}>
              {EDITABLE_LISTS[k].title}
            </button>
          ))}
        </div>
        <ListEditor key={listKey} listKey={listKey} settings={settings} canEdit={canEdit} />
      </section>
      <section className="space-y-2">
        <h4 className="text-xs font-bold uppercase text-slate-500">Naming rules</h4>
        <NamingRules settings={settings} canEdit={canEdit} />
      </section>
      <section className="space-y-2">
        <h4 className="text-xs font-bold uppercase text-slate-500">Custom fields</h4>
        <CustomFields settings={settings} canEdit={canEdit} />
      </section>
      {/* Phase 19: inspection checklists follow the same rules as the lists above. */}
      <section className="space-y-2">
        <h4 className="text-xs font-bold uppercase text-slate-500">Inspection checklists</h4>
        <ChecklistEditor canEdit={canEdit} />
      </section>
    </div>
  );
}
