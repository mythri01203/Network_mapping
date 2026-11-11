import { useMemo, useState } from 'react';
import { Camera, Link2, Trash2 } from 'lucide-react';

import {
  checkHasEvidence,
  checkStanding,
  type Connection,
  CONNECTION_KIND_LABELS,
  CONNECTION_STATE_LABELS,
  type ConnectionIndex,
  connectionsForCore,
  connectionsForElement,
  describeConnection,
  LINK_CHECK_METHOD_LABELS,
  LINK_CHECK_METHODS,
  LINK_CHECK_RESULT_LABELS,
  LINK_CHECK_RESULTS,
  linkCheckCounts,
  type LinkCheckMethod,
  type LinkCheckResult,
  linkCheckSummary,
  type LinkVerification,
  orphanChecksFor,
  photoUrl,
  randomCode,
} from '@fibergis/shared';

import { Modal } from '../../components/ui';
import { currentAccount } from '../../stores/authStore';
import { deleteLinkCheck, saveLinkCheck } from '../../stores/linkCheckActions';
import { showToast } from '../../stores/toastStore';
import { compressImageFile } from '../capture/photo';
import { InspectorSection } from '../inspector/sections';
import { CHECK_STYLE, readingFrom, useConnectionIndex } from './connectionsUi';

const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');

export type ConnectionsTarget = { elementId: string } | { cableId: string; core: number };

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Network mapping Phase 13: every recorded link of one item or one fibre, with where it is
 * recorded, who and when (or "Not recorded"), its warnings and whether anybody checked it. "Not
 * checked" is always shown. Links taken out or entered by mistake are kept under "History".
 * `bare`: no section frame (inside the fibre detail, which has its own).
 */
export function ConnectionsPanel({ target, bare = false }: { target: ConnectionsTarget; bare?: boolean }) {
  const index = useConnectionIndex();
  return <ConnectionsView index={index} target={target} bare={bare} />;
}

/** The panel for a given index (the store's in the app; any in tests). */
export function ConnectionsView({ index, target, bare = false }: { index: ConnectionIndex; target: ConnectionsTarget; bare?: boolean }) {
  const list = useMemo(
    () => ('elementId' in target ? connectionsForElement(index, target.elementId) : connectionsForCore(index, target.cableId, target.core)),
    [index, target],
  );
  const orphans = useMemo(() => orphanChecksFor(index, target), [index, target]);
  const live = list.filter((c) => c.state === 'current' || c.state === 'planned');
  const history = list.filter((c) => c.state === 'retired' || c.state === 'mistake');
  const counts = linkCheckCounts(index, live);
  const [checking, setChecking] = useState<Connection | null>(null);

  const body = (
    <div className="space-y-2" data-testid="connections-panel">
      {list.length === 0 ? (
        <p className="text-[13px] text-slate-600" data-testid="connections-empty">
          No links are recorded {'elementId' in target ? 'for this item' : 'for this fibre'}. Only links a person recorded are shown; nothing is worked out from the map.
        </p>
      ) : (
        <p className="text-[13px] text-slate-800" data-testid="connections-summary">
          <strong className="tabular-nums">{live.length}</strong> link{live.length === 1 ? '' : 's'} on record:{' '}
          <span className="tabular-nums">{counts.passed}</span> checked good, <span className="tabular-nums">{counts.failed}</span> checked bad,{' '}
          <span className="tabular-nums">{counts.not_checked}</span> not checked
          {counts.inconclusive ? `, ${counts.inconclusive} could not tell` : ''}
          {counts.changed_since_check ? `, ${counts.changed_since_check} changed since their check` : ''}.
        </p>
      )}
      {live.length > 0 && (
        <ul className="space-y-2">
          {live.map((c) => (
            <ConnectionRow key={c.id} index={index} connection={c} onCheck={() => setChecking(c)} />
          ))}
        </ul>
      )}
      {history.length > 0 && (
        <details className="rounded-lg border border-slate-200 p-2" data-testid="connections-history">
          <summary className="flex min-h-[48px] cursor-pointer items-center text-[13px] font-semibold text-slate-700 md:min-h-0">History: {history.length} link(s) taken out or entered by mistake</summary>
          <ul className="mt-2 space-y-2">
            {history.map((c) => (
              <ConnectionRow key={c.id} index={index} connection={c} />
            ))}
          </ul>
        </details>
      )}
      {orphans.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-2" data-testid="connections-orphan-checks">
          <p className="text-[13px] font-semibold text-amber-900">
            <span aria-hidden>! </span>Checks of links no longer on record ({orphans.length})
          </p>
          <p className="text-[12px] text-amber-900">The link was changed or removed after the check. The check is kept as it was recorded.</p>
          <ul className="mt-1 space-y-1">
            {orphans.map((v) => (
              <CheckLine key={v.id} check={v} standing="link_gone" />
            ))}
          </ul>
        </div>
      )}
      {checking && <LinkCheckForm connection={checking} onClose={() => setChecking(null)} />}
    </div>
  );

  if (bare) {
    return (
      <div className="space-y-1.5" data-testid="connections-bare">
        <p className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-700">
          <Link2 size={14} aria-hidden /> Connections of this fibre
        </p>
        {body}
      </div>
    );
  }
  return (
    <InspectorSection title="Connections" icon={Link2} aside={live.length || undefined}>
      {body}
    </InspectorSection>
  );
}

function CheckBadge({ index, connection }: { index: ConnectionIndex; connection: Connection }) {
  const summary = linkCheckSummary(index, connection);
  const style = CHECK_STYLE[summary.state];
  return (
    <div className="space-y-0.5">
      <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[12px] font-semibold ${style.badge}`} data-testid={`connection-check-${summary.state}`}>
        <span aria-hidden>{style.mark}</span> {style.words}
      </span>
      {summary.latest && <p className="text-[12px] text-slate-600">{summary.label}</p>}
    </div>
  );
}

function ConnectionRow({ index, connection: c, onCheck }: { index: ConnectionIndex; connection: Connection; onCheck?: () => void }) {
  const checks = index.checks.get(c.id) ?? [];
  const who = c.recordedBy || c.recordedAt ? [c.recordedBy ? `by ${c.recordedBy}` : 'by: not recorded', c.recordedAt ? `on ${c.recordedAt.slice(0, 10)}` : 'when: not recorded'].join(', ') : 'Who and when: not recorded';
  return (
    <li className={`rounded-lg border p-2 text-[13px] ${c.state === 'current' || c.state === 'planned' ? 'border-slate-200' : 'border-slate-200 bg-slate-50'}`} data-testid={`connection-${c.id}`}>
      <div className="text-[12px] font-semibold text-slate-600">
        {CONNECTION_KIND_LABELS[c.kind]}
        {c.state !== 'current' && <span className="ml-1 rounded bg-slate-200 px-1 text-slate-800">{CONNECTION_STATE_LABELS[c.state]}</span>}
      </div>
      <p className={`break-words text-slate-900 ${c.state === 'mistake' ? 'line-through' : ''}`}>{describeConnection(c)}</p>
      <p className="text-[12px] text-slate-600">
        Recorded in: {c.recordedIn.label}. {who}. {c.stateLabel}.
      </p>
      {c.place && <p className="text-[12px] text-slate-600">Where: {c.place.label}</p>}
      {c.connectors && (
        <p className="text-[12px] text-slate-600">
          Connectors: {c.connectors.from ?? 'not recorded'} → {c.connectors.to ?? 'not recorded'}
          {c.connectors.adapter ? `, adapter ${c.connectors.adapter}` : ''}
        </p>
      )}
      {c.warnings.length > 0 && (
        <ul className="mt-1 space-y-0.5" data-testid={`connection-warnings-${c.id}`}>
          {c.warnings.map((w, i) => (
            <li key={i} className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[12px] text-amber-900">
              <span aria-hidden>! </span>
              {w.message}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-1.5">
        <CheckBadge index={index} connection={c} />
      </div>
      {checks.length > 1 && (
        <details className="mt-1 text-[12px]">
          <summary className="flex min-h-[48px] cursor-pointer items-center text-slate-700 md:min-h-0">All {checks.length} checks</summary>
          <ul className="mt-1 space-y-1">
            {checks.map((v) => (
              <CheckLine key={v.id} check={v} standing={checkStanding(index, v)} />
            ))}
          </ul>
        </details>
      )}
      {checks.length === 1 && (
        <ul className="mt-1">
          <CheckLine check={checks[0]} standing={checkStanding(index, checks[0])} />
        </ul>
      )}
      {onCheck && (
        <button
          type="button"
          onClick={onCheck}
          className="mt-2 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg border border-blue-300 bg-blue-50 px-3 text-[14px] font-semibold text-blue-800 hover:bg-blue-100"
          data-testid={`connection-record-check-${c.id}`}
        >
          Record a check
        </button>
      )}
    </li>
  );
}

function CheckLine({ check: v, standing }: { check: LinkVerification; standing: 'current' | 'link_changed' | 'link_gone' }) {
  return (
    <li className="flex items-start gap-2 rounded border border-slate-200 bg-white p-1.5 text-[12px] text-slate-700" data-testid={`link-check-${v.id}`}>
      <div className="min-w-0 flex-1">
        <div>
          <strong>{v.checkedOn}</strong>, {v.technician}: {LINK_CHECK_METHOD_LABELS[v.method]}, {LINK_CHECK_RESULT_LABELS[v.result]}
        </div>
        {standing !== 'current' && <div className="text-amber-900">{standing === 'link_gone' ? `Link not on record any more. It was: ${v.connectionLabel}` : 'Made before the link was changed: check again.'}</div>}
        <div>
          {[
            v.readingDbm !== undefined ? `Reading ${v.readingDbm} dBm${v.wavelengthNm ? ` at ${v.wavelengthNm} nm` : ''} (measured)` : '',
            v.otdrRef ? `OTDR ${v.otdrRef}` : '',
            v.instrument ? `with ${v.instrument}` : '',
          ]
            .filter(Boolean)
            .join(' · ') || (checkHasEvidence(v) ? '' : 'No photo, OTDR reference or reading.')}
        </div>
        {v.notes && <div className="whitespace-pre-wrap">{v.notes}</div>}
        {v.photoIds && v.photoIds.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {v.photoIds.map((id) => (
              <a key={id} href={`${API_BASE}${photoUrl(id)}`} target="_blank" rel="noreferrer">
                <img src={`${API_BASE}${photoUrl(id)}`} alt="Check photo" className="h-12 w-12 rounded border border-slate-200 object-cover" loading="lazy" />
              </a>
            ))}
          </div>
        )}
      </div>
      <button
        type="button"
        aria-label={`Delete the check of ${v.checkedOn}`}
        onClick={() => void deleteLinkCheck(v.id)}
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-600 md:h-8 md:w-8"
      >
        <Trash2 size={16} />
      </button>
    </li>
  );
}

const RESULT_STYLE: Record<LinkCheckResult, { tile: string; on: string; mark: string }> = {
  pass: { tile: 'border-emerald-300 text-emerald-900', on: 'border-emerald-700 bg-emerald-600 text-white', mark: '✓' },
  fail: { tile: 'border-red-300 text-red-900', on: 'border-red-700 bg-red-600 text-white', mark: '✕' },
  inconclusive: { tile: 'border-slate-300 text-slate-800', on: 'border-slate-700 bg-slate-600 text-white', mark: '?' },
};

const WAVELENGTHS = [1310, 1490, 1550, 1625] as const;

/**
 * "Record a check": one screen, big targets. Nothing is chosen for the person except today's date
 * and their own name, both shown and changeable. How it was checked and what was found must be
 * picked; a meter reading needs the number and its sign, chosen by the person.
 */
export function LinkCheckForm({ connection, onClose }: { connection: Connection; onClose: () => void }) {
  const [method, setMethod] = useState<LinkCheckMethod>();
  const [result, setResult] = useState<LinkCheckResult>();
  const [checkedOn, setCheckedOn] = useState(today);
  const [technician, setTechnician] = useState(() => currentAccount()?.displayName ?? '');
  const [digits, setDigits] = useState('');
  const [sign, setSign] = useState<'-' | '+'>();
  const [wavelength, setWavelength] = useState<number>();
  const [otdrRef, setOtdrRef] = useState('');
  const [instrument, setInstrument] = useState('');
  const [notes, setNotes] = useState('');
  const [photoIds, setPhotoIds] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const reading = readingFrom(digits, sign);
  const readingNeeded = method === 'power_reading';
  const readingIncomplete = digits.trim() !== '' && reading === undefined;
  const canSave = !!method && !!result && !!technician.trim() && !!checkedOn && !sending && !readingIncomplete && (!readingNeeded || reading !== undefined);

  const addPhoto = async (file: File | undefined) => {
    if (!file) return;
    setSending(true);
    try {
      const blob = await compressImageFile(file);
      const id = `LCK-${randomCode(12)}`;
      const response = await fetch(`${API_BASE}${photoUrl(id)}`, { method: 'PUT', headers: { 'content-type': blob.type || 'image/jpeg' }, body: blob });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setPhotoIds((ids) => [...ids, id]);
    } catch {
      showToast('error', 'Photo not saved', 'The photo could not reach the office. Try again when there is a connection.');
    } finally {
      setSending(false);
    }
  };

  const save = async () => {
    if (!canSave) return;
    const saved = await saveLinkCheck({
      connectionId: connection.id,
      method,
      result,
      checkedOn,
      technician,
      photoIds,
      otdrRef,
      instrument,
      notes,
      ...(reading !== undefined ? { readingDbm: reading } : {}),
      ...(wavelength ? { wavelengthNm: wavelength } : {}),
    });
    if (saved) onClose();
  };

  const label = 'mb-1 block text-[14px] font-semibold text-slate-800';
  const input = 'block min-h-[48px] w-full rounded-lg border border-slate-300 bg-white px-3 text-[16px] text-slate-900 outline-none focus:border-blue-500';
  const tile = (on: boolean) => `flex min-h-[56px] items-center justify-center gap-1 rounded-xl border-2 px-2 text-center text-[14px] font-semibold ${on ? 'border-blue-700 bg-blue-600 text-white' : 'border-slate-300 bg-white text-slate-800'}`;

  return (
    <Modal
      open
      onClose={onClose}
      title="Record a check"
      description={describeConnection(connection)}
      icon={Link2}
      size="md"
      closeOnOverlayClick={false}
      footer={
        <div className="grid w-full grid-cols-2 gap-2">
          <button type="button" onClick={onClose} className="min-h-[52px] rounded-lg border border-slate-300 bg-white text-[15px] font-semibold text-slate-800 hover:bg-slate-50">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={!canSave}
            className="min-h-[52px] rounded-lg bg-blue-600 text-[15px] font-semibold text-white hover:bg-blue-500 disabled:bg-blue-300"
            data-testid="link-check-save"
          >
            Save check
          </button>
        </div>
      }
    >
      <div className="space-y-4" data-testid="link-check-form">
        <div>
          <span className={label}>How did you check it?</span>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="How did you check it?">
            {LINK_CHECK_METHODS.map((m) => (
              <button key={m} type="button" role="radio" aria-checked={method === m} onClick={() => setMethod(m)} className={tile(method === m)} data-testid={`link-check-method-${m}`}>
                {LINK_CHECK_METHOD_LABELS[m]}
              </button>
            ))}
          </div>
        </div>
        <div>
          <span className={label}>What did you find?</span>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="What did you find?">
            {LINK_CHECK_RESULTS.map((r) => (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={result === r}
                onClick={() => setResult(r)}
                data-testid={`link-check-result-${r}`}
                className={`flex min-h-[56px] items-center justify-center gap-2 rounded-xl border-2 px-2 text-[14px] font-semibold ${result === r ? RESULT_STYLE[r].on : `bg-white ${RESULT_STYLE[r].tile}`}`}
              >
                <span className="text-[20px] leading-none" aria-hidden>
                  {RESULT_STYLE[r].mark}
                </span>
                {LINK_CHECK_RESULT_LABELS[r]}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <span className={label}>Meter reading in dBm {readingNeeded ? '(needed)' : '(if you read one)'}</span>
          <div className="grid grid-cols-[auto_auto_1fr] gap-2">
            {(['-', '+'] as const).map((s) => (
              <button key={s} type="button" aria-pressed={sign === s} onClick={() => setSign(s)} className={`${tile(sign === s)} min-w-[56px]`} data-testid={`link-check-sign-${s === '-' ? 'minus' : 'plus'}`}>
                {s === '-' ? '− minus' : '+ plus'}
              </button>
            ))}
            <input
              className={input}
              inputMode="decimal"
              value={digits}
              placeholder="19.4"
              onChange={(e) => setDigits(e.target.value.replace(/[^\d.,]/g, ''))}
              aria-label="Reading, digits only"
              data-testid="link-check-reading"
            />
          </div>
          {readingIncomplete && <p className="text-[13px] text-amber-900">Choose minus or plus, and write the number like 19.4.</p>}
          {reading !== undefined && (
            <p className="text-[16px] font-semibold text-slate-900" data-testid="link-check-reading-shown">
              {reading} dBm
            </p>
          )}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Wavelength on the meter">
            {WAVELENGTHS.map((w) => (
              <button key={w} type="button" role="radio" aria-checked={wavelength === w} onClick={() => setWavelength(wavelength === w ? undefined : w)} className={tile(wavelength === w)}>
                {w} nm
              </button>
            ))}
          </div>
          <p className="text-[12px] text-slate-500">Wavelength: tap the one set on the meter, or leave it as not recorded.</p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className={label}>Day</span>
            <input type="date" className={input} value={checkedOn} max={today()} onChange={(e) => setCheckedOn(e.target.value)} data-testid="link-check-date" />
          </label>
          <label className="block">
            <span className={label}>Who checked it</span>
            <input className={input} value={technician} onChange={(e) => setTechnician(e.target.value)} data-testid="link-check-by" />
          </label>
          <label className="block">
            <span className={label}>OTDR file or test number (optional)</span>
            <input className={input} value={otdrRef} maxLength={120} onChange={(e) => setOtdrRef(e.target.value)} data-testid="link-check-otdr" />
          </label>
          <label className="block">
            <span className={label}>Meter or OTDR used (optional)</span>
            <input className={input} value={instrument} maxLength={120} onChange={(e) => setInstrument(e.target.value)} />
          </label>
        </div>
        <label className="block">
          <span className={label}>Notes (optional)</span>
          <textarea className={`${input} min-h-[80px] py-2`} value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <div className="space-y-2">
          <span className={label}>Photos (meter screen, OTDR trace, the link)</span>
          {photoIds.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {photoIds.map((id) => (
                <img key={id} src={`${API_BASE}${photoUrl(id)}`} alt="Check photo" className="h-16 w-16 rounded-lg border border-slate-200 object-cover" />
              ))}
            </div>
          )}
          <label className="flex min-h-[52px] cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 text-[15px] font-semibold text-slate-700 hover:bg-slate-100">
            <Camera size={20} />
            {sending ? 'Sending photo…' : 'Take a photo'}
            <input type="file" accept="image/*" capture="environment" className="sr-only" disabled={sending} onChange={(e) => void addPhoto(e.target.files?.[0])} data-testid="link-check-photo-input" />
          </label>
        </div>
      </div>
    </Modal>
  );
}
