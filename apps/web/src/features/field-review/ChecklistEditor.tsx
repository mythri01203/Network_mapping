import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';

import {
  type ChecklistOverlay,
  checklistSettingId,
  checklistSettingProblem,
  emptyChecklistOverlay,
  INSPECTION_TARGET_LABELS,
  INSPECTION_TARGETS,
  type InspectionTarget,
  parseChecklistOverlay,
  randomCode,
  resolveChecklist,
  type Setting,
} from '@fibergis/shared';

import { logAudit } from '../../stores/networkActions';
import { useNetworkStore } from '../../stores/networkStore';
import { showToast } from '../../stores/toastStore';
import { useUiStore } from '../../stores/uiStore';

const BUTTON = 'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-semibold disabled:opacity-50';
const FIELD = 'h-9 rounded-lg border border-slate-300 bg-white px-2 text-xs';

function ChecklistTargetEditor({ target, settings, canEdit }: { target: InspectionTarget; settings: readonly Setting[]; canEdit: boolean }) {
  const role = useUiStore((s) => s.userRole);
  const stored = settings.find((s) => s.id === checklistSettingId(target));
  const parsed = stored ? parseChecklistOverlay(stored.value) : null;
  const [draft, setDraft] = useState<ChecklistOverlay>(() => (parsed?.ok ? parsed.overlay : emptyChecklistOverlay()));
  const [newLabel, setNewLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const entries = resolveChecklist(target, [{ id: checklistSettingId(target), value: JSON.stringify(draft) }]);

  const save = () => {
    const value = JSON.stringify(draft);
    const problem = checklistSettingProblem(checklistSettingId(target), value);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    useNetworkStore.getState().saveSetting({ id: checklistSettingId(target), value, updatedAt: new Date().toISOString(), updatedBy: role });
    const what = `Inspection checklist for ${INSPECTION_TARGET_LABELS[target].toLowerCase()} saved`;
    logAudit('SETTING_CHANGED', what, checklistSettingId(target), 'System');
    showToast('success', 'Saved', what);
  };

  const rename = (id: string, label: string) => setDraft((d) => ({ ...d, labels: { ...d.labels, [id]: label } }));
  const toggleHidden = (id: string) => setDraft((d) => ({ ...d, hidden: d.hidden.includes(id) ? d.hidden.filter((h) => h !== id) : [...d.hidden, id] }));
  const add = () => {
    const label = newLabel.trim();
    if (!label) return;
    setDraft((d) => ({ ...d, added: [...d.added, { id: `own.${randomCode(8)}`, label }] }));
    setNewLabel('');
  };
  // Removing an item the owner added is safe: answers already given keep their own words.
  const remove = (id: string) =>
    setDraft((d) => {
      const { [id]: _gone, ...labels } = d.labels;
      return { added: d.added.filter((a) => a.id !== id), labels, hidden: d.hidden.filter((h) => h !== id) };
    });

  return (
    <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3" data-testid={`checklist-editor-${target}`}>
      <ul className="space-y-1.5">
        {entries.map((e) => (
          <li key={e.id} className="flex flex-wrap items-center gap-2 text-xs">
            <input
              className={`${FIELD} min-w-0 flex-1`}
              value={e.label}
              disabled={!canEdit}
              maxLength={120}
              onChange={(ev) => (e.builtIn ? rename(e.id, ev.target.value) : setDraft((d) => ({ ...d, added: d.added.map((a) => (a.id === e.id ? { ...a, label: ev.target.value } : a)) })))}
              aria-label={`Checklist item ${e.label}`}
            />
            <label className="flex items-center gap-1 text-slate-600">
              <input type="checkbox" checked={e.hidden} disabled={!canEdit} onChange={() => toggleHidden(e.id)} /> Hidden
            </label>
            {e.builtIn ? (
              <span className="text-[11px] text-slate-400">built in</span>
            ) : (
              <button type="button" disabled={!canEdit} onClick={() => remove(e.id)} aria-label={`Remove ${e.label}`} className={`${BUTTON} text-red-700 hover:bg-red-50`}>
                <Trash2 size={14} />
              </button>
            )}
          </li>
        ))}
      </ul>
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <input className={`${FIELD} min-w-0 flex-1`} placeholder="New item, such as: Earth wire connected" value={newLabel} maxLength={120} onChange={(e) => setNewLabel(e.target.value)} data-testid={`checklist-new-${target}`} />
          <button type="button" onClick={add} disabled={!newLabel.trim()} className={`${BUTTON} border border-slate-300 bg-white text-slate-700`}>
            <Plus size={14} /> Add item
          </button>
          <button type="button" onClick={save} className={`${BUTTON} bg-blue-700 text-white`} data-testid={`checklist-save-${target}`}>
            Save checklist
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

/**
 * Phase 19: inspection checklists per kind of thing, under Lists and rules. Built-in items can be
 * renamed or hidden, never removed; the owner can add their own. The inspection form asks the
 * visible items and stores each answer with its words as shown.
 */
export function ChecklistEditor({ canEdit }: { canEdit: boolean }) {
  const settings = useNetworkStore((s) => s.settings);
  const [target, setTarget] = useState<InspectionTarget>('pole');
  return (
    <div className="space-y-2" data-testid="checklist-editor">
      <p className="text-xs text-slate-500">
        Asked on every new inspection. The starting items are a proposal, not a standard: change them to your own rules. Answers already saved keep their words.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {INSPECTION_TARGETS.map((t) => (
          <button key={t} type="button" onClick={() => setTarget(t)} className={`${BUTTON} ${t === target ? 'bg-blue-700 text-white' : 'border border-slate-300 bg-white text-slate-700'}`}>
            {INSPECTION_TARGET_LABELS[t]}
          </button>
        ))}
      </div>
      <ChecklistTargetEditor key={target} target={target} settings={settings} canEdit={canEdit} />
    </div>
  );
}
