import { useState } from 'react';

import {
  type Cable,
  describeSplitterOutputLink,
  SPLITTER_ARCHITECTURE_LABELS,
  SPLITTER_ARCHITECTURES,
  SPLITTER_OUTPUT_STATE_WORDS,
  type SplitterArchitecture,
  type Splitter,
  type SplitterOutputMark,
  type SplitterOutputState,
  type SplitterOutputUse,
  type SplitterPlace,
  splitProductText,
} from '@fibergis/shared';

import { Field, Input } from '../../components/ui';
import { markSplitterPort, saveSplitterArchitecture, setSplitterOutput } from '../../stores/fiberActions';
import { FiberPicker } from './FiberPicker';
import { emptyFiber, type FiberChoice, fiberOf } from './fiberUi';

/**
 * Phase 11: the parts of the splitter card. Where the splitter sits (level, arrangement and split
 * product, worked out from the records and shown as a suggestion) and one output's detail (what is
 * on it, faulty and reserved marks with reasons, connecting with a reason when faulty, history).
 */

/** Phone-sized controls: at least 48 px tall on a phone, the usual size on a desk. */
export const BIG = 'min-h-12 md:min-h-8';
const btn = `${BIG} rounded-lg border px-3 text-[14px] font-semibold md:text-[12px]`;
export const BTN = {
  main: `${btn} border-blue-700 bg-blue-600 text-white hover:bg-blue-500 disabled:border-blue-300 disabled:bg-blue-300`,
  plain: `${btn} border-slate-300 bg-white text-slate-800 hover:bg-slate-50 disabled:text-slate-400`,
  warn: `${btn} border-red-300 bg-white text-red-700 hover:bg-red-50 disabled:text-red-300`,
  danger: `${btn} border-red-700 bg-red-600 text-white disabled:bg-red-300`,
};

/** A mark for each output state, so the state is never told by colour alone. */
export const OUTPUT_MARK: Record<SplitterOutputState, string> = { used: '●', free: '', reserved: 'R', faulty: '✕', not_recorded: '?' };
export const OUTPUT_TILE: Record<SplitterOutputState, string> = {
  used: 'border-blue-300 bg-blue-50 text-blue-900',
  free: 'border-slate-200 bg-white text-slate-800',
  reserved: 'border-amber-300 bg-amber-50 text-amber-900',
  faulty: 'border-red-300 bg-red-50 text-red-800',
  not_recorded: 'border-dashed border-slate-300 bg-slate-50 text-slate-500',
};

const ARCH_SHORT: Record<SplitterArchitecture, string> = { centralised: 'Centralised', distributed: 'Distributed (cascaded)' };

/** Level, arrangement and split product from the records, and what a person recorded instead. */
export function SplitterPlaceBlock({ place }: { place: SplitterPlace }) {
  const sp = place.splitter;
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<SplitterArchitecture | ''>(sp.architecture?.value ?? '');
  const [level, setLevel] = useState(sp.architecture?.level?.toString() ?? '');
  const [reason, setReason] = useState('');
  const levelText = place.level !== undefined ? String(place.level) : place.levelAtLeast > 1 ? `Not known (at least ${place.levelAtLeast})` : 'Not known';
  const rows: [string, string][] = [
    ['Level from the PON port', levelText],
    ['Arrangement', place.suggestion.architecture ? ARCH_SHORT[place.suggestion.architecture] : 'Not known'],
    ['Split to here', `${splitProductText(place.split)}${place.split.factors.length > 1 ? ` (${place.split.factors.join(' × ')})` : ''}`],
  ];
  const save = async () => {
    if (!value) return;
    const saved = await saveSplitterArchitecture(sp.id, { value, ...(level ? { level: Number(level) } : {}), reason });
    if (saved) {
      setEditing(false);
      setReason('');
    }
  };
  return (
    <div className="space-y-1.5 rounded-md border border-slate-200 bg-white p-2" data-testid="splitter-place">
      <dl className="grid grid-cols-[8.5rem_1fr] gap-x-2 gap-y-1 text-xs">
        {rows.map(([label, text]) => (
          <div key={label} className="contents">
            <dt className="text-slate-500">{label}</dt>
            <dd className="font-semibold text-slate-800">{text}</dd>
          </div>
        ))}
      </dl>
      <p className="text-[11px] text-slate-600" data-testid="splitter-place-text">
        Suggested from the records: {place.suggestion.text}
      </p>
      {place.overSplitLimit && (
        <p className="text-xs text-amber-800" data-testid="splitter-split-warning">
          Check: the splits multiply to {splitProductText(place.split)}, above the limit of {place.splitLimit} in Optical settings. Customers here may get too little light.
        </p>
      )}
      {place.split.couplers > 0 && <p className="text-[11px] text-slate-500">Unequal couplers on the way are not multiplied in; each leg has its own loss.</p>}
      <details className="text-[11px] text-slate-600">
        <summary className={`${BIG} flex cursor-pointer items-center`}>How this was worked out</summary>
        <ul className="mt-1 list-disc space-y-0.5 pl-4" data-testid="splitter-place-how">
          {place.suggestion.how.map((h) => (
            <li key={h}>{h}</li>
          ))}
          <li>Only recorded links are followed. Nothing is worked out from where things are on the map.</li>
        </ul>
      </details>
      {sp.architecture && (
        <p className={`text-xs ${place.differs ? 'text-amber-800' : 'text-slate-700'}`} data-testid="splitter-arch-recorded">
          Recorded by {sp.architecture.by ?? 'someone (name not recorded)'} on {sp.architecture.at.slice(0, 10)}: {SPLITTER_ARCHITECTURE_LABELS[sp.architecture.value]}
          {sp.architecture.level !== undefined ? `, level ${sp.architecture.level}` : ''}. Why: {sp.architecture.reason}
          {place.differs ? ' This differs from the records above; check the links or the site.' : ''}
        </p>
      )}
      {editing ? (
        <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-2">
          <p className="text-xs font-semibold text-slate-700">What do you know about this splitter?</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {SPLITTER_ARCHITECTURES.map((a) => (
              <button
                key={a}
                type="button"
                data-testid={`splitter-arch-${a}`}
                aria-pressed={value === a}
                className={`${btn} text-left ${value === a ? 'border-blue-600 bg-blue-50 text-blue-900' : 'border-slate-300 bg-white text-slate-800'}`}
                onClick={() => setValue(a)}
              >
                {SPLITTER_ARCHITECTURE_LABELS[a]}
              </button>
            ))}
          </div>
          <Field label="Level (optional)" hint="1 is the first splitter after the PON port">
            <Input data-testid="splitter-arch-level" className={BIG} inputMode="numeric" value={level} onChange={(e) => setLevel(e.target.value.replace(/\D/g, '').slice(0, 2))} />
          </Field>
          <Field label="How do you know?">
            <Input data-testid="splitter-arch-reason" className={BIG} value={reason} maxLength={300} placeholder="Seen on site, as-built drawing…" onChange={(e) => setReason(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className={BTN.plain} onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button type="button" className={BTN.main} data-testid="splitter-arch-save" disabled={!value || !reason.trim()} onClick={() => void save()}>
              Save
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={BTN.plain} data-testid="splitter-arch-edit" onClick={() => setEditing(true)}>
            {sp.architecture ? 'Change what was recorded' : 'Record what you know'}
          </button>
          {sp.architecture && (
            <button type="button" className={BTN.plain} data-testid="splitter-arch-clear" onClick={() => void saveSplitterArchitecture(sp.id, null)}>
              Remove recorded answer
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const MARK_TEXT: Record<SplitterOutputMark, { ask: string; button: string; hint: string }> = {
  faulty: { ask: 'What is wrong?', button: 'Mark faulty', hint: 'No light on this output, connector broken…' },
  repaired: { ask: 'What was done?', button: 'Mark repaired', hint: 'Connector replaced, cleaned and tested…' },
  reserved: { ask: 'What is it kept for?', button: 'Reserve', hint: 'New building, block B…' },
  end_reservation: { ask: 'Why (optional)', button: 'End reservation', hint: 'Not needed any more…' },
};

/** One output: what is on it, its mark and reason, connecting a fiber, and its history. */
export function SplitterOutputDetail({ splitter, use, cables }: { splitter: Splitter; use: SplitterOutputUse; cables: readonly Cable[] }) {
  const [mark, setMark] = useState<SplitterOutputMark | null>(null);
  const [markReason, setMarkReason] = useState('');
  const [out, setOut] = useState<FiberChoice>(emptyFiber);
  const [override, setOverride] = useState('');
  const n = use.portNumber;
  const port = use.port;
  const faulty = use.state === 'faulty';
  const reserved = use.state === 'reserved';
  const linked = use.links.length > 0;
  const hasCustomer = use.links.some((l) => l.kind === 'customer');
  const hasCascade = use.links.some((l) => l.kind === 'splitter');
  const cableName = (id: string) => cables.find((c) => c.id === id)?.name ?? id;

  const doMark = async () => {
    if (!mark) return;
    if (await markSplitterPort(splitter.id, n, mark, markReason)) {
      setMark(null);
      setMarkReason('');
    }
  };

  return (
    <div className="space-y-2 rounded-md border border-blue-200 bg-blue-50/40 p-2" data-testid="splitter-out-detail">
      <div>
        <p className="font-semibold">
          Output {n}
          {port?.label ? ` (${port.label})` : ''}
        </p>
        <p className="text-xs text-slate-700" data-testid="splitter-out-state">
          {OUTPUT_MARK[use.state] ? `${OUTPUT_MARK[use.state]} ` : ''}
          {SPLITTER_OUTPUT_STATE_WORDS[use.state]}
          {use.reason ? `: ${use.reason}` : ''}
          {use.state === 'not_recorded' ? ': this output has no record yet. Mark it, or connect it, to record it.' : ''}
        </p>
        <p className="text-xs text-slate-700" data-testid="splitter-out-links">
          On it: {linked ? use.links.map((l) => (l.kind === 'fiber' ? `${cableName(l.cableId)}, ${l.core ? `fiber ${l.core}` : 'fiber not recorded'}` : describeSplitterOutputLink(l))).join('; ') : use.markedOnly ? 'marked in use, but nothing linked is recorded' : 'nothing recorded'}
        </p>
        {port?.override && <p className="text-[11px] text-red-800">Connected while marked faulty: {port.override.reason} ({port.override.at.slice(0, 10)}{port.override.by ? `, ${port.override.by}` : ''})</p>}
        <p className="text-[11px] text-slate-500">Loss {port?.lossDb ?? (splitter.insertionLossDb > 0 ? splitter.insertionLossDb : 'not recorded')}{port?.lossDb !== undefined || splitter.insertionLossDb > 0 ? ' dB configured' : ''}</p>
      </div>

      {/* Faulty and reserved marks, with the reason kept in the output's history. */}
      <div className="flex flex-wrap gap-2">
        {!faulty && (
          <button type="button" className={BTN.warn} data-testid="splitter-mark-faulty" onClick={() => setMark('faulty')}>
            Mark faulty
          </button>
        )}
        {faulty && (
          <button type="button" className={BTN.plain} data-testid="splitter-mark-repaired" onClick={() => setMark('repaired')}>
            Mark repaired
          </button>
        )}
        {!faulty && !reserved && !linked && !use.markedOnly && (
          <button type="button" className={BTN.plain} data-testid="splitter-mark-reserved" onClick={() => setMark('reserved')}>
            Reserve
          </button>
        )}
        {reserved && (
          <button type="button" className={BTN.plain} data-testid="splitter-end-reservation" onClick={() => setMark('end_reservation')}>
            End reservation
          </button>
        )}
      </div>
      {mark && (
        <div className="space-y-2 rounded-md border border-slate-200 bg-white p-2">
          <Field label={MARK_TEXT[mark].ask}>
            <Input data-testid="splitter-mark-reason" className={BIG} value={markReason} placeholder={MARK_TEXT[mark].hint} maxLength={300} onChange={(e) => setMarkReason(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className={BTN.plain} onClick={() => setMark(null)}>
              Cancel
            </button>
            <button type="button" className={mark === 'faulty' ? BTN.danger : BTN.main} data-testid="splitter-mark-save" disabled={mark !== 'end_reservation' && !markReason.trim()} onClick={() => void doMark()}>
              {MARK_TEXT[mark].button}
            </button>
          </div>
        </div>
      )}

      {/* The fiber leaving this output. */}
      {port?.connectedDropCableId ? (
        !hasCustomer && (
          <button type="button" className={BTN.plain} data-testid="splitter-out-free" onClick={() => void setSplitterOutput(splitter.id, n, null)}>
            Free this output
          </button>
        )
      ) : hasCascade ? (
        <p className="text-[11px] text-slate-600">It feeds a splitter in this box. Unlink that splitter's input to free it.</p>
      ) : hasCustomer ? (
        <p className="text-[11px] text-slate-600">A customer is recorded on it. Move or disconnect the customer to free it.</p>
      ) : (
        <div className="space-y-2">
          <FiberPicker label={`Output ${n} goes to`} value={out} onChange={setOut} cables={cables} testId="splitter-out" />
          {faulty && (
            <Field label="This output is marked faulty. Why connect it anyway?">
              <Input data-testid="splitter-out-override" className={BIG} value={override} maxLength={300} onChange={(e) => setOverride(e.target.value)} />
            </Field>
          )}
          {reserved && <p className="text-[11px] text-amber-800">This output is reserved. Connecting it ends the reservation; you will be asked first.</p>}
          <button
            type="button"
            className={`${BTN.main} w-full`}
            data-testid="splitter-out-save"
            disabled={!fiberOf(out) || (faulty && !override.trim())}
            onClick={() => {
              const target = fiberOf(out);
              if (target) void setSplitterOutput(splitter.id, n, { ...target, ...(faulty ? { overrideReason: override } : {}) });
            }}
          >
            Connect output
          </button>
        </div>
      )}

      {(port?.history ?? []).length > 0 && (
        <details className="text-[11px] text-slate-600">
          <summary className={`${BIG} flex cursor-pointer items-center`}>History ({port!.history!.length})</summary>
          <ul className="mt-1 space-y-0.5" data-testid="splitter-out-history">
            {[...port!.history!].reverse().map((h, i) => (
              <li key={i}>
                {h.at.slice(0, 10)}: {h.details}
                {h.by ? ` (${h.by})` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
