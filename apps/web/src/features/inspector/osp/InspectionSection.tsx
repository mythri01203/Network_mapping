import { useMemo, useState } from 'react';
import { Camera, ClipboardCheck, Plus, Trash2 } from 'lucide-react';

import {
  activeChecklist,
  CHECKLIST_ANSWER_LABELS,
  CHECKLIST_ANSWERS,
  type ChecklistAnswer,
  type ChecklistAnswers,
  checklistAnswersFor,
  checklistProblemCount,
  INSPECTION_TARGET_LABELS,
  inspectionsFor,
  type InspectionTarget,
  OSP_CONDITION_LABELS,
  OSP_CONDITIONS,
  type OspCondition,
  photoUrl,
  randomCode,
} from '@fibergis/shared';

import { Modal } from '../../../components/ui';
import { currentAccount } from '../../../stores/authStore';
import { useNetworkStore } from '../../../stores/networkStore';
import { deleteInspection, saveInspection } from '../../../stores/ospActions';
import { showToast } from '../../../stores/toastStore';
import { compressImageFile } from '../../capture/photo';
import { InspectorSection } from '../sections';

const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');

/** Colour, mark and words together, never colour alone. */
const CONDITION_STYLE: Record<OspCondition, { tile: string; on: string; mark: string }> = {
  good: { tile: 'border-emerald-300 text-emerald-900', on: 'border-emerald-700 bg-emerald-600 text-white', mark: '✓' },
  fair: { tile: 'border-amber-300 text-amber-900', on: 'border-amber-700 bg-amber-500 text-white', mark: '!' },
  poor: { tile: 'border-red-300 text-red-900', on: 'border-red-700 bg-red-600 text-white', mark: '✕' },
};

const BADGE: Record<OspCondition, string> = {
  good: 'bg-emerald-100 text-emerald-900',
  fair: 'bg-amber-100 text-amber-900',
  poor: 'bg-red-100 text-red-900',
};

/** Phase 19: checklist answers, with a mark and words as well as colour. */
const ANSWER_STYLE: Record<ChecklistAnswer, { on: string; mark: string }> = {
  ok: { on: 'border-emerald-700 bg-emerald-600 text-white', mark: '✓' },
  problem: { on: 'border-red-700 bg-red-600 text-white', mark: '✕' },
  not_checked: { on: 'border-slate-600 bg-slate-500 text-white', mark: '–' },
};

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Phase 4: inspections of one pole, chamber, span or duct, newest first, with a big "Record an
 * inspection" button. Each is history: what one person saw on one day.
 */
export function InspectionsSection({ targetType, targetId, name }: { targetType: InspectionTarget; targetId: string; name: string }) {
  const all = useNetworkStore((s) => s.inspections);
  const list = useMemo(() => inspectionsFor({ inspections: all }, targetType, targetId), [all, targetType, targetId]);
  const [open, setOpen] = useState(false);

  return (
    <InspectorSection title="Inspections" icon={ClipboardCheck} aside={list.length || undefined}>
      <div className="space-y-2" data-testid="inspections">
        {list.length === 0 ? (
          <p className="text-[12px] text-slate-600" data-testid="inspections-empty">
            No inspection recorded for this {INSPECTION_TARGET_LABELS[targetType].toLowerCase()}.
          </p>
        ) : (
          <ul className="space-y-2">
            {list.map((i) => (
              <li key={i.id} className="rounded-lg border border-slate-200 p-2 text-[13px]" data-testid={`inspection-${i.id}`}>
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-slate-900">{i.inspectedOn}</span>
                      <span className={`rounded px-1.5 py-0.5 text-[12px] font-semibold ${BADGE[i.condition]}`}>
                        {CONDITION_STYLE[i.condition].mark} {OSP_CONDITION_LABELS[i.condition]}
                      </span>
                    </div>
                    <div className="text-[12px] text-slate-600">By {i.inspectedBy}</div>
                    {i.checklist && i.checklist.length > 0 && (
                      <details className="mt-1 text-[12px]" data-testid={`inspection-checklist-${i.id}`}>
                        <summary className="cursor-pointer text-slate-700">
                          Checklist: {i.checklist.length} answered
                          {checklistProblemCount(i.checklist) > 0 ? `, ${checklistProblemCount(i.checklist)} problem` : ''}
                        </summary>
                        <ul className="mt-1 space-y-0.5">
                          {i.checklist.map((c) => (
                            <li key={c.itemId}>
                              <span aria-hidden>{ANSWER_STYLE[c.answer].mark}</span> {c.label}: {CHECKLIST_ANSWER_LABELS[c.answer]}
                            </li>
                          ))}
                        </ul>
                        <p className="text-[11px] text-slate-500">Items not listed were not answered (not recorded).</p>
                      </details>
                    )}
                    {i.findings ? <p className="mt-1 whitespace-pre-wrap text-slate-800">{i.findings}</p> : <p className="mt-1 text-[12px] text-slate-500">No findings written.</p>}
                    {i.photoIds && i.photoIds.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {i.photoIds.map((id) => (
                          <a key={id} href={`${API_BASE}${photoUrl(id)}`} target="_blank" rel="noreferrer">
                            <img src={`${API_BASE}${photoUrl(id)}`} alt="Inspection photo" className="h-14 w-14 rounded border border-slate-200 object-cover" loading="lazy" />
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    aria-label={`Delete the inspection of ${i.inspectedOn}`}
                    onClick={() => void deleteInspection(i.id)}
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-600 md:h-8 md:w-8"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg border border-blue-300 bg-blue-50 px-3 text-[14px] font-semibold text-blue-800 hover:bg-blue-100"
          data-testid="inspection-add"
        >
          <Plus size={18} /> Record an inspection
        </button>
      </div>
      {open && <InspectionForm targetType={targetType} targetId={targetId} name={name} onClose={() => setOpen(false)} />}
    </InspectorSection>
  );
}

/**
 * The inspection form: one screen, big targets, nothing chosen for the person except today's date
 * and their own name, both shown and changeable. The condition must be picked. Photos go straight to
 * the office; with no connection a photo is not saved and the screen says so.
 */
export function InspectionForm({ targetType, targetId, name, onClose }: { targetType: InspectionTarget; targetId: string; name: string; onClose: () => void }) {
  const [inspectedOn, setInspectedOn] = useState(today);
  const [inspectedBy, setInspectedBy] = useState(() => currentAccount()?.displayName ?? '');
  const [condition, setCondition] = useState<OspCondition>();
  const [findings, setFindings] = useState('');
  const [photoIds, setPhotoIds] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  // Phase 19: the checklist for this kind of thing (Administration, Lists and rules). Nothing is pre-answered.
  const settings = useNetworkStore((s) => s.settings);
  const checklist = useMemo(() => activeChecklist(targetType, settings), [targetType, settings]);
  const [answers, setAnswers] = useState<ChecklistAnswers>({});

  const addPhoto = async (file: File | undefined) => {
    if (!file) return;
    setSending(true);
    try {
      const blob = await compressImageFile(file);
      const id = `INS-${randomCode(12)}`;
      const response = await fetch(`${API_BASE}${photoUrl(id)}`, { method: 'PUT', headers: { 'content-type': blob.type || 'image/jpeg' }, body: blob });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setPhotoIds((ids) => [...ids, id]);
    } catch {
      showToast('error', 'Photo not saved', 'The photo could not reach the office. Try again when there is a connection.');
    } finally {
      setSending(false);
    }
  };

  const save = () => {
    if (!condition) return;
    const saved = saveInspection({ targetType, targetId, inspectedOn, inspectedBy, condition, findings, photoIds, checklist: checklistAnswersFor(checklist, answers) });
    if (saved) onClose();
  };

  const label = 'mb-1 block text-[14px] font-semibold text-slate-800';
  const input = 'block min-h-[48px] w-full rounded-lg border border-slate-300 bg-white px-3 text-[16px] text-slate-900 outline-none focus:border-blue-500';

  return (
    <Modal
      open
      onClose={onClose}
      title="Record an inspection"
      description={`${INSPECTION_TARGET_LABELS[targetType]}: ${name}`}
      icon={ClipboardCheck}
      size="md"
      closeOnOverlayClick={false}
      footer={
        <div className="grid w-full grid-cols-2 gap-2">
          <button type="button" onClick={onClose} className="min-h-[52px] rounded-lg border border-slate-300 bg-white text-[15px] font-semibold text-slate-800 hover:bg-slate-50">
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!condition || !inspectedBy.trim() || !inspectedOn || sending}
            className="min-h-[52px] rounded-lg bg-blue-600 text-[15px] font-semibold text-white hover:bg-blue-500 disabled:bg-blue-300"
            data-testid="inspection-save"
          >
            Save inspection
          </button>
        </div>
      }
    >
      <div className="space-y-4" data-testid="inspection-form">
        <div>
          <span className={label}>How does it look?</span>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="How does it look?">
            {OSP_CONDITIONS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={condition === c}
                onClick={() => setCondition(c)}
                data-testid={`inspection-condition-${c}`}
                className={`flex min-h-[72px] flex-col items-center justify-center gap-1 rounded-xl border-2 px-1 text-center text-[13px] font-semibold ${condition === c ? CONDITION_STYLE[c].on : `bg-white ${CONDITION_STYLE[c].tile}`}`}
              >
                <span className="text-[22px] leading-none" aria-hidden>
                  {CONDITION_STYLE[c].mark}
                </span>
                {OSP_CONDITION_LABELS[c]}
              </button>
            ))}
          </div>
        </div>
        {checklist.length > 0 && (
          <fieldset className="space-y-2" data-testid="inspection-checklist">
            <legend className={label}>Checklist (answer what you checked; tap again to clear)</legend>
            {checklist.map((item) => (
              <div key={item.id} className="rounded-lg border border-slate-200 p-2" data-testid={`checklist-item-${item.id}`}>
                <div className="mb-1 text-[14px] text-slate-900">{item.label}</div>
                <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label={item.label}>
                  {CHECKLIST_ANSWERS.map((a) => (
                    <button
                      key={a}
                      type="button"
                      role="radio"
                      aria-checked={answers[item.id] === a}
                      onClick={() => setAnswers((prev) => ({ ...prev, [item.id]: prev[item.id] === a ? undefined : a }))}
                      data-testid={`checklist-${item.id}-${a}`}
                      className={`flex min-h-[48px] items-center justify-center gap-1 rounded-lg border-2 px-1 text-[13px] font-semibold ${
                        answers[item.id] === a ? ANSWER_STYLE[a].on : 'border-slate-300 bg-white text-slate-800'
                      }`}
                    >
                      <span aria-hidden>{ANSWER_STYLE[a].mark}</span> {CHECKLIST_ANSWER_LABELS[a]}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </fieldset>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className={label}>Day</span>
            <input type="date" className={input} value={inspectedOn} max={today()} onChange={(e) => setInspectedOn(e.target.value)} data-testid="inspection-date" />
          </label>
          <label className="block">
            <span className={label}>Who checked it</span>
            <input className={input} value={inspectedBy} onChange={(e) => setInspectedBy(e.target.value)} data-testid="inspection-by" />
          </label>
        </div>
        <label className="block">
          <span className={label}>What you saw (optional)</span>
          <textarea
            className={`${input} min-h-[96px] py-2`}
            value={findings}
            maxLength={2000}
            onChange={(e) => setFindings(e.target.value)}
            placeholder="Leaning, cracked, water inside, cable sagging…"
            data-testid="inspection-findings"
          />
        </label>
        <div className="space-y-2">
          <span className={label}>Photos</span>
          {photoIds.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {photoIds.map((id) => (
                <img key={id} src={`${API_BASE}${photoUrl(id)}`} alt="Inspection photo" className="h-16 w-16 rounded-lg border border-slate-200 object-cover" />
              ))}
            </div>
          )}
          <label className="flex min-h-[52px] cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 text-[15px] font-semibold text-slate-700 hover:bg-slate-100">
            <Camera size={20} />
            {sending ? 'Sending photo…' : 'Take a photo'}
            <input type="file" accept="image/*" capture="environment" className="sr-only" disabled={sending} onChange={(e) => void addPhoto(e.target.files?.[0])} data-testid="inspection-photo-input" />
          </label>
        </div>
      </div>
    </Modal>
  );
}
