import React, { useMemo, useState } from 'react';
import { ClipboardCheck, MapPin, RefreshCw } from 'lucide-react';

import {
  boundsOf,
  findingCounts,
  GEOMETRY_RULE_LABELS,
  type GeometryRule,
  sortFindings,
  VALIDATION_FINDING_EVENT_LABELS,
  VALIDATION_FINDING_PRESENCE_LABELS,
  VALIDATION_FINDING_STATE_LABELS,
  type ValidationFinding,
} from '@fibergis/shared';

import { authClient } from '../../api/client';
import { Modal } from '../../components/ui';
import { useMapStore } from '../../stores/mapStore';
import { useNetworkStore } from '../../stores/networkStore';
import { showToast } from '../../stores/toastStore';
import { type SelectedObject, useUiStore } from '../../stores/uiStore';
import { acknowledgeFindingAction, mayChangeFindings, reopenFindingAction, resolveFindingAction, runMapCheckNow, useValidationStore } from '../../stores/validationActions';

/**
 * Network mapping Phase 15: the stored map check findings. Each says what was found, where (zoom to
 * it), and what to do, in plain words. People mark it "fine as it is" or "fixed", always with a
 * note; nothing is deleted, and every change stays in its history. 48 px targets; works at 390 px.
 */

const BIG = 'min-h-12 rounded-xl px-4 text-sm font-semibold';

const SEVERITY: Record<ValidationFinding['severity'], { words: string; mark: string; badge: string }> = {
  error: { words: 'Must fix', mark: '✕', badge: 'border-red-300 bg-red-50 text-red-900' },
  warning: { words: 'Check this', mark: '!', badge: 'border-amber-300 bg-amber-50 text-amber-900' },
  note: { words: 'Good to know', mark: 'i', badge: 'border-slate-300 bg-white text-slate-700' },
};

type Filter = 'open' | 'gone' | 'acknowledged' | 'resolved' | 'all';

const FILTERS: { id: Filter; words: string }[] = [
  { id: 'open', words: 'Open' },
  { id: 'gone', words: 'No longer found' },
  { id: 'acknowledged', words: 'Fine as it is' },
  { id: 'resolved', words: 'Fixed' },
  { id: 'all', words: 'All' },
];

const ruleWords = (rule: string) => GEOMETRY_RULE_LABELS[rule as GeometryRule] ?? rule.replace(/-/g, ' ');

/** Where to look: the finding's own point, or the record it is about (as this account may see it). */
function locate(f: ValidationFinding): boolean {
  const map = useMapStore.getState();
  if (f.lat !== undefined && f.lng !== undefined) {
    map.flyTo(f.lat, f.lng, 18);
    return true;
  }
  const s = useNetworkStore.getState();
  const eq = s.equipment.find((e) => e.id === f.targetId);
  if (eq && !(eq.lat === 0 && eq.lng === 0)) {
    map.flyTo(eq.lat, eq.lng, 18);
    return true;
  }
  const cable = s.cables.find((c) => c.id === f.targetId);
  const bounds = cable ? boundsOf(cable.coordinates) : null;
  if (bounds) {
    map.fitBounds(bounds);
    return true;
  }
  const customer = s.customers.find((c) => c.id === f.targetId);
  if (customer && Number.isFinite(customer.lat) && !(customer.lat === 0 && customer.lng === 0)) {
    map.flyTo(customer.lat, customer.lng, 18);
    return true;
  }
  return false;
}

/** Opens the record in the inspector, when it is a kind the inspector shows. */
function openRecord(f: ValidationFinding): boolean {
  const s = useNetworkStore.getState();
  const pick = (): SelectedObject | null => {
    const eq = s.equipment.find((e) => e.id === f.targetId);
    if (eq) return { type: 'equipment', data: eq };
    const cable = s.cables.find((c) => c.id === f.targetId);
    if (cable) return { type: 'cable', data: cable };
    const customer = s.customers.find((c) => c.id === f.targetId);
    if (customer) return { type: 'customer', data: customer };
    const closure = s.closures.find((c) => c.id === f.targetId);
    if (closure) return { type: 'closure', data: closure };
    const duct = (s.ducts ?? []).find((d) => d.id === f.targetId);
    if (duct) return { type: 'duct', data: duct };
    const span = (s.spans ?? []).find((d) => d.id === f.targetId);
    if (span) return { type: 'span', data: span };
    return null;
  };
  const selection = pick();
  if (!selection) return false;
  useUiStore.getState().select(selection);
  return true;
}

export const FindingCard: React.FC<{ finding: ValidationFinding; canDecide: boolean }> = ({ finding: f, canDecide }) => {
  const [deciding, setDeciding] = useState<'acknowledged' | 'resolved' | 'open' | null>(null);
  const [note, setNote] = useState('');
  const sev = SEVERITY[f.severity];
  const save = () => {
    const done = deciding === 'acknowledged' ? acknowledgeFindingAction(f.id, note) : deciding === 'resolved' ? resolveFindingAction(f.id, note) : reopenFindingAction(f.id, note);
    if (done) {
      setDeciding(null);
      setNote('');
    }
  };
  return (
    <li className="rounded-xl border border-slate-200 bg-white p-3" data-testid="finding" data-state={f.state} data-presence={f.presence}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${sev.badge}`}>
          <span aria-hidden>{sev.mark}</span> {sev.words}
        </span>
        <span className="text-xs font-semibold text-slate-700">{ruleWords(f.rule)}</span>
        <span className="font-mono text-xs text-slate-500">{f.targetId}</span>
      </div>
      <p className="mt-1 text-sm text-slate-900">{f.message}</p>
      <p className="mt-1 text-sm text-slate-700">
        <span className="font-semibold">What to do: </span>
        {f.fix}
      </p>
      <p className="mt-1 text-xs text-slate-600">
        {VALIDATION_FINDING_STATE_LABELS[f.state]}
        {f.stateBy && f.state !== 'open' ? ` · ${f.stateBy}, ${f.stateAt?.slice(0, 10) ?? 'day not recorded'}${f.stateNote ? `: "${f.stateNote}"` : ''}` : ''} · {VALIDATION_FINDING_PRESENCE_LABELS[f.presence]} · first found {f.firstFoundAt.slice(0, 10)}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className={`${BIG} inline-flex items-center gap-2 border border-slate-300 bg-white text-slate-800`} onClick={() => locate(f) || showToast('info', 'No position', 'Nothing about this finding has a position on record.')}>
          <MapPin className="h-4 w-4" /> Show on map
        </button>
        <button type="button" className={`${BIG} border border-slate-300 bg-white text-slate-800`} onClick={() => openRecord(f) || showToast('info', 'Open it from its list', `${f.targetId} is not a kind the inspector opens.`)}>
          Open the item
        </button>
        {canDecide && f.state !== 'acknowledged' && (
          <button type="button" className={`${BIG} border border-slate-300 bg-white text-slate-800`} onClick={() => setDeciding('acknowledged')} data-testid="finding-fine">
            Fine as it is
          </button>
        )}
        {canDecide && f.state !== 'resolved' && (
          <button type="button" className={`${BIG} border border-emerald-400 bg-emerald-50 text-emerald-900`} onClick={() => setDeciding('resolved')} data-testid="finding-fixed">
            Fixed
          </button>
        )}
        {canDecide && f.state !== 'open' && (
          <button type="button" className={`${BIG} border border-slate-300 bg-white text-slate-800`} onClick={() => setDeciding('open')}>
            Open again
          </button>
        )}
      </div>
      {deciding && (
        <div className="mt-2 space-y-2 rounded-xl border border-blue-200 bg-blue-50 p-3">
          <label className="block text-sm font-semibold text-slate-800" htmlFor={`note-${f.id}`}>
            {deciding === 'acknowledged' ? 'Why is it fine as it is?' : deciding === 'resolved' ? 'What did you fix?' : 'Why does it need a look again?'}
          </label>
          <textarea id={`note-${f.id}`} value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="w-full rounded-xl border border-slate-300 p-3 text-base" data-testid="finding-note" />
          <div className="flex flex-wrap gap-2">
            <button type="button" className={`${BIG} bg-blue-600 text-white disabled:opacity-50`} disabled={!note.trim()} onClick={save} data-testid="finding-save">
              Save
            </button>
            <button type="button" className={`${BIG} border border-slate-300 bg-white text-slate-800`} onClick={() => setDeciding(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      <details className="mt-2 text-xs text-slate-600">
        <summary className="flex min-h-12 cursor-pointer items-center font-semibold">History ({f.history.length})</summary>
        <ol className="space-y-1 pl-4">
          {f.history.map((h, i) => (
            <li key={`${h.at}-${i}`}>
              {h.at.slice(0, 16).replace('T', ' ')} · {VALIDATION_FINDING_EVENT_LABELS[h.event]}
              {h.by ? ` · ${h.by}` : ''}
              {h.note ? `: ${h.note}` : ''}
            </li>
          ))}
        </ol>
      </details>
    </li>
  );
};

const PAGE = 50;

export const ValidationFindingsModal: React.FC = () => {
  const open = useValidationStore((s) => s.open);
  const running = useValidationStore((s) => s.running);
  const lastRun = useValidationStore((s) => s.lastRun);
  const setOpen = useValidationStore((s) => s.setOpen);
  const findings = useNetworkStore((s) => s.validationFindings);
  const [filter, setFilter] = useState<Filter>('open');
  const [shown, setShown] = useState(PAGE);
  const all = useMemo(() => sortFindings(findings ?? []), [findings]);
  const counts = useMemo(() => findingCounts(all), [all]);
  const list = useMemo(
    () =>
      all.filter((f) =>
        filter === 'all' ? true : filter === 'gone' ? f.presence === 'no_longer_found' : filter === 'open' ? f.state === 'open' && f.presence === 'found' : f.state === filter,
      ),
    [all, filter],
  );
  if (!open) return null;
  const canDecide = mayChangeFindings();
  const canRun = canDecide && !!authClient.runValidation;
  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      title="Map check findings"
      description="Problems the map check found, kept with who looked at them. Passing every check does not prove the map matches the street."
      icon={ClipboardCheck}
      size="xl"
      footer={
        <button type="button" className={`${BIG} border border-slate-300 bg-white text-slate-800`} onClick={() => setOpen(false)}>
          Close
        </button>
      }
    >
      <div className="space-y-3" data-testid="validation-findings">
        <div className="flex flex-wrap items-center gap-2">
          {canRun && (
            <button type="button" className={`${BIG} inline-flex items-center gap-2 bg-blue-600 text-white disabled:opacity-60`} disabled={running} onClick={() => void runMapCheckNow()} data-testid="validation-run">
              <RefreshCw className={`h-4 w-4 ${running ? 'animate-spin' : ''}`} /> {running ? 'Checking…' : 'Check the map now'}
            </button>
          )}
          <span className="text-sm text-slate-700">
            {counts.open} open · {counts.acknowledged} fine as it is · {counts.resolved} fixed · {counts.noLongerFound} no longer found
            {lastRun ? ` · last check ${lastRun.checkedAt.slice(0, 16).replace('T', ' ')}` : ''}
          </span>
        </div>
        {!canRun && <p className="text-sm text-slate-600">{canDecide ? 'The check runs on the server. Connect to the server to run it.' : 'Your account can read the findings. An engineer or the office runs the check and marks findings.'}</p>}
        <div className="flex flex-wrap gap-2" role="tablist">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={filter === f.id}
              className={`${BIG} border ${filter === f.id ? 'border-blue-600 bg-blue-50 text-blue-800' : 'border-slate-300 bg-white text-slate-800'}`}
              onClick={() => {
                setFilter(f.id);
                setShown(PAGE);
              }}
            >
              {f.words}
            </button>
          ))}
        </div>
        {list.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            {all.length === 0 ? 'No findings stored yet. Run the check to see what it finds.' : 'Nothing in this list.'}
          </p>
        ) : (
          <ul className="space-y-2">
            {list.slice(0, shown).map((f) => (
              <FindingCard key={f.id} finding={f} canDecide={canDecide} />
            ))}
          </ul>
        )}
        {list.length > shown && (
          <button type="button" className={`${BIG} w-full border border-slate-300 bg-white text-slate-800`} onClick={() => setShown((n) => n + PAGE)}>
            Show {Math.min(PAGE, list.length - shown)} more of {list.length - shown}
          </button>
        )}
      </div>
    </Modal>
  );
};
