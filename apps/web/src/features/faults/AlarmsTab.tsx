import { useMemo, useState } from 'react';
import { BellPlus, CheckCheck, FlaskConical, XCircle } from 'lucide-react';

import {
  ALARM_KIND_LABELS,
  ALARM_KINDS,
  ALARM_SOURCE_LABELS,
  type AlarmKind,
  elementLabel,
  type ImpactIndex,
  type NetworkElementRef,
} from '@fibergis/shared';

import { acknowledge, clear, makeTestEvent, reportAlarm } from '../../stores/faultActions';
import { useNetworkStore } from '../../stores/networkStore';
import { elementReady, when } from './faultFormat';
import { buttonClass, ElementPicker, inputClass, NoLiveConnection, Section, TestBadge } from './faultUi';

const MANUAL_KINDS: AlarmKind[] = ALARM_KINDS.filter((k) => k !== 'hazard_reported');

/** A TEST event: choose a splitter, tick the customers on it, and say what happened. */
function TestEventForm({ ix, onDone }: { ix: ImpactIndex; onDone: () => void }) {
  const splitters = useNetworkStore((s) => s.splitters);
  const [kind, setKind] = useState<AlarmKind>('ont_los');
  const [splitterId, setSplitterId] = useState('');
  const [ticked, setTicked] = useState<string[]>([]);
  const [element, setElement] = useState<NetworkElementRef | null>(null);
  const onSplitter = useMemo(
    () => (splitterId ? [...ix.paths.values()].filter((i) => i.path.splitterIds.includes(splitterId)).map((i) => i.customer) : []),
    [ix, splitterId],
  );
  const customerKind = kind === 'ont_los' || kind === 'ont_offline' || kind === 'low_power';
  const elements: NetworkElementRef[] = customerKind ? ticked.map((id) => ({ type: 'customer', id })) : elementReady(element) ? [element] : [];
  return (
    <div className="space-y-2 rounded-lg border-2 border-dashed border-violet-400 bg-violet-50 p-3" data-testid="test-event-form">
      <p className="text-[11px] font-semibold text-violet-900">
        A TEST event is a drill. It is marked TEST everywhere, never counted as a real outage, and left out of reports unless asked for.
      </p>
      <select className={inputClass} value={kind} onChange={(e) => setKind(e.target.value as AlarmKind)} aria-label="TEST event kind" data-testid="test-kind">
        {MANUAL_KINDS.map((k) => (
          <option key={k} value={k}>
            {ALARM_KIND_LABELS[k]}
          </option>
        ))}
      </select>
      {customerKind ? (
        <>
          <select className={inputClass} value={splitterId} onChange={(e) => { setSplitterId(e.target.value); setTicked([]); }} aria-label="Splitter" data-testid="test-splitter">
            <option value="">Choose a splitter to list its customers…</option>
            {splitters.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.id})
              </option>
            ))}
          </select>
          {splitterId && onSplitter.length === 0 && <p className="text-[11px] text-slate-600">No customer has a recorded path through this splitter.</p>}
          <div className="grid gap-1 sm:grid-cols-2">
            {onSplitter.map((c) => (
              <label key={c.id} className="flex items-center gap-2 rounded border border-slate-200 bg-white px-2 py-1 text-[11px]">
                <input
                  type="checkbox"
                  data-testid="test-customer"
                  checked={ticked.includes(c.id)}
                  onChange={(e) => setTicked(e.target.checked ? [...ticked, c.id] : ticked.filter((x) => x !== c.id))}
                />
                {c.name} ({c.id})
              </label>
            ))}
          </div>
        </>
      ) : (
        <ElementPicker value={element} onChange={setElement} types={['cable', 'closure', 'splitter', 'pon_port', 'olt', 'equipment', 'span']} />
      )}
      <button
        type="button"
        data-testid="make-test-event"
        disabled={elements.length === 0}
        onClick={() => {
          if (makeTestEvent({ kind, elements })) onDone();
        }}
        className={`${buttonClass} bg-violet-700 text-white`}
      >
        <FlaskConical className="mr-1 inline h-3.5 w-3.5" />
        Make TEST event ({elements.length})
      </button>
    </div>
  );
}

function ReportForm({ onDone }: { onDone: () => void }) {
  const [kind, setKind] = useState<AlarmKind>('damage_reported');
  const [element, setElement] = useState<NetworkElementRef | null>(null);
  const [note, setNote] = useState('');
  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3" data-testid="report-form">
      <p className="text-[11px] text-slate-600">What a person saw or was told, such as a customer's call or a cut cable seen on the road.</p>
      <select className={inputClass} value={kind} onChange={(e) => setKind(e.target.value as AlarmKind)} aria-label="What happened">
        {MANUAL_KINDS.map((k) => (
          <option key={k} value={k}>
            {ALARM_KIND_LABELS[k]}
          </option>
        ))}
      </select>
      <ElementPicker value={element} onChange={setElement} />
      <input className={inputClass} placeholder="What was seen or said (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      <button
        type="button"
        disabled={!elementReady(element)}
        onClick={() => {
          if (elementReady(element) && reportAlarm({ kind, source: 'manual', element, note })) onDone();
        }}
        className={`${buttonClass} bg-rose-600 text-white`}
      >
        Save the report
      </button>
    </div>
  );
}

export function AlarmsTab({ ix }: { ix: ImpactIndex }) {
  const alarms = useNetworkStore((s) => s.alarms);
  const [form, setForm] = useState<'none' | 'test' | 'report'>('none');
  const [showCleared, setShowCleared] = useState(false);
  const list = alarms.filter((a) => showCleared || a.state !== 'cleared');
  return (
    <div className="space-y-3">
      <NoLiveConnection />
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setForm(form === 'report' ? 'none' : 'report')} className={`${buttonClass} bg-rose-600 text-white`} data-testid="open-report">
          <BellPlus className="mr-1 inline h-3.5 w-3.5" /> Report Outage
        </button>
        <button type="button" onClick={() => setForm(form === 'test' ? 'none' : 'test')} className={`${buttonClass} bg-violet-700 text-white`} data-testid="open-test-event">
          <FlaskConical className="mr-1 inline h-3.5 w-3.5" /> Make a TEST event
        </button>
        <label className="ml-auto flex items-center gap-1 text-[11px] text-slate-600">
          <input type="checkbox" checked={showCleared} onChange={(e) => setShowCleared(e.target.checked)} /> Show cleared
        </label>
      </div>
      {form === 'test' && <TestEventForm ix={ix} onDone={() => setForm('none')} />}
      {form === 'report' && <ReportForm onDone={() => setForm('none')} />}
      <Section title={`Alarms (${list.length})`} testId="alarm-list">
        {list.length === 0 && <p className="text-[11px] text-slate-500">No open alarms.</p>}
        <div className="space-y-1.5">
          {list.map((a) => (
            <div key={a.id} className="flex flex-col gap-1 rounded-lg border border-slate-200 p-2 text-[11px] sm:flex-row sm:items-center" data-testid="alarm-row">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <TestBadge isTest={a.isTest} />
                  <span className="font-bold text-slate-900">{ALARM_KIND_LABELS[a.kind]}</span>
                  <span className="text-slate-600">on {elementLabel(ix.data, a.element)}</span>
                </div>
                <div className="text-slate-500">
                  {ALARM_SOURCE_LABELS[a.source]} · first {when(a.firstSeenAt)} · last {when(a.lastSeenAt)} · {a.occurrences}× · {a.state}
                  {a.faultId ? ` · in fault ${a.faultId}` : ''}
                </div>
              </div>
              <div className="flex gap-1">
                {a.state === 'active' && (
                  <button type="button" onClick={() => acknowledge([a.id])} className={`${buttonClass} border border-slate-200`}>
                    <CheckCheck className="mr-1 inline h-3.5 w-3.5" /> Seen
                  </button>
                )}
                {a.state !== 'cleared' && (
                  <button type="button" onClick={() => clear([a.id], 'Cleared by the office')} className={`${buttonClass} border border-slate-200`}>
                    <XCircle className="mr-1 inline h-3.5 w-3.5" /> Clear
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
