import { useState } from 'react';

import { activeAssignment, type Cable, coreSpliceHistory, type FiberCore, isCoreFaultStatus, type LossSource } from '@fibergis/shared';

import { Button, Field, Input } from '../../components/ui';
import { changeFiberCondition, type FiberConditionChange } from '../../stores/fiberActions';
import { useNetworkStore } from '../../stores/networkStore';

const CHANGE_TEXT: Record<FiberConditionChange, { button: string; title: string; reason: string; save: string }> = {
  faulty: { button: 'Mark faulty', title: 'Mark this fiber faulty', reason: 'What is wrong (what the test showed)', save: 'Save: fiber is faulty' },
  repaired: { button: 'Mark repaired', title: 'Mark this fiber repaired', reason: 'What was done, and the test result', save: 'Save: fiber is repaired' },
  retire: { button: 'Retire (out of use)', title: 'Take this fiber out of use', reason: 'Why it is taken out of use', save: 'Save: fiber is retired' },
  return: { button: 'Bring back into use', title: 'Bring this fiber back into use', reason: 'Why it can be used again', save: 'Save: fiber back in use' },
};

const EVENT_TEXT: Record<string, string> = {
  marked_faulty: 'Marked faulty',
  marked_repaired: 'Marked repaired',
  retired: 'Retired',
  returned_to_service: 'Brought back into use',
};

const LOSS_ORIGIN: Record<LossSource, string> = {
  designed: 'design value',
  calculated: 'estimated',
  field_measured: 'measured',
  device_reported: 'from a device',
};

const tall = 'min-h-12 md:min-h-0';

/** Which condition changes make sense for this fiber now. */
function changesFor(core: FiberCore): FiberConditionChange[] {
  if (core.status === 'Retired') return ['return'];
  const list: FiberConditionChange[] = [];
  if (core.status !== 'Faulty') list.push('faulty');
  if (isCoreFaultStatus(core.status)) list.push('repaired');
  const held = !!activeAssignment(core) || core.status === 'In Use' || core.status === 'Reserved';
  if (!held) list.push('retire');
  return list;
}

/** Mark faulty, repaired, retired or back in use, with a reason and optional evidence. */
export function CoreConditionActions({ cable, core }: { cable: Cable; core: FiberCore }) {
  const [open, setOpen] = useState<FiberConditionChange | null>(null);
  const [reason, setReason] = useState('');
  const [otdrRef, setOtdrRef] = useState('');
  const [photos, setPhotos] = useState('');
  const changes = changesFor(core);

  const save = async (change: FiberConditionChange) => {
    const photoIds = photos
      .split(/[\s,]+/)
      .map((p) => p.trim())
      .filter(Boolean);
    const done = await changeFiberCondition(change, cable.id, core.coreNumber, { reason, otdrRef: otdrRef || undefined, photoIds });
    if (done) {
      setOpen(null);
      setReason('');
      setOtdrRef('');
      setPhotos('');
    }
  };

  return (
    <div className="space-y-2" data-testid="core-condition">
      {!open ? (
        <div className="flex flex-wrap gap-2">
          {changes.map((c) => (
            <Button key={c} size="sm" variant={c === 'faulty' || c === 'retire' ? 'danger' : 'secondary'} data-testid={`core-condition-${c}`} className={tall} onClick={() => setOpen(c)}>
              {CHANGE_TEXT[c].button}
            </Button>
          ))}
        </div>
      ) : (
        <div className="space-y-2 rounded-md border border-slate-300 bg-white p-2.5" data-testid="core-condition-form">
          <p className="text-[13px] font-semibold text-slate-900">{CHANGE_TEXT[open].title}</p>
          <Field label={CHANGE_TEXT[open].reason} required>
            <Input data-testid="core-condition-reason" className={tall} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Field label="OTDR test or file (if any)">
              <Input data-testid="core-condition-otdr" className={tall} value={otdrRef} placeholder="OTDR-0042" onChange={(e) => setOtdrRef(e.target.value)} />
            </Field>
            <Field label="Photo numbers (if any)">
              <Input data-testid="core-condition-photos" className={tall} value={photos} placeholder="PH-123, PH-124" onChange={(e) => setPhotos(e.target.value)} />
            </Field>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="primary" data-testid="core-condition-save" className={tall} disabled={!reason.trim()} onClick={() => void save(open)}>
              {CHANGE_TEXT[open].save}
            </Button>
            <Button size="sm" variant="ghost" className={tall} onClick={() => setOpen(null)}>
              Cancel
            </Button>
          </div>
          {!reason.trim() && <p className="text-[11px] text-slate-600">Write the reason first. It is kept in the fiber's history.</p>}
        </div>
      )}
    </div>
  );
}

/** Condition changes, uses and splices of one fiber, all from the records, oldest first. */
export function CoreHistory({ cable, core }: { cable: Cable; core: FiberCore }) {
  const closures = useNetworkStore((s) => s.closures);
  const splices = coreSpliceHistory(closures, cable.id, core.coreNumber);
  const conditions = core.history ?? [];
  const uses = (core.assignments ?? []).filter((a) => a.releasedAt || a.override);
  if (conditions.length === 0 && uses.length === 0 && splices.length === 0) {
    return (
      <p className="text-[11px] text-slate-600" data-testid="core-history-empty">
        No history on record for this fiber.
      </p>
    );
  }
  return (
    <details className="text-[11px] text-slate-700" data-testid="core-history" open={conditions.length + splices.length <= 3}>
      <summary className="flex min-h-12 cursor-pointer items-center font-medium md:min-h-0">History of this fiber</summary>
      <div className="mt-1 space-y-2">
        {conditions.length > 0 && (
          <div>
            <p className="font-semibold text-slate-800">Condition</p>
            <ul className="space-y-0.5" data-testid="core-condition-history">
              {conditions.map((e, i) => (
                <li key={`${e.at}-${i}`}>
                  {e.at.slice(0, 10)} · {EVENT_TEXT[e.action] ?? e.action}
                  {e.by ? ` by ${e.by}` : ''}: {e.reason}
                  {e.otdrRef ? ` · OTDR ${e.otdrRef}` : ''}
                  {e.photoIds?.length ? ` · photos ${e.photoIds.join(', ')}` : ''}
                </li>
              ))}
            </ul>
          </div>
        )}
        {uses.length > 0 && (
          <div>
            <p className="font-semibold text-slate-800">Uses</p>
            <ul className="space-y-0.5" data-testid="core-use-history">
              {uses.map((a) => (
                <li key={a.id}>
                  {a.kind === 'reserved' ? 'Reserved' : 'Used'} for {a.use}, {a.effectiveFrom} to {a.releasedAt ? a.releasedAt.slice(0, 10) : 'now'}
                  {a.releaseReason ? ` (${a.releaseReason})` : ''}
                  {a.override ? ` · given while marked ${a.override.status.toLowerCase()}${a.override.by ? ` by ${a.override.by}` : ''}: ${a.override.reason}` : ''}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div>
          <p className="font-semibold text-slate-800">Splices</p>
          {splices.length === 0 ? (
            <p data-testid="core-splice-history-empty">No splice on record for this fiber.</p>
          ) : (
            <ul className="space-y-0.5" data-testid="core-splice-history">
              {splices.map((s) => (
                <li key={s.splice.id} className={s.active ? '' : 'text-slate-500'}>
                  {s.splice.date || 'date not recorded'} · {s.closureName}: {s.side === 'from' ? 'to' : 'from'} {s.otherCableName || s.otherCableId} fiber {s.otherCore} ({s.side === 'from' ? 'towards customers' : 'towards the OLT'})
                  {s.splice.spliceLossDb !== undefined ? ` · ${s.splice.spliceLossDb} dB ${s.splice.lossSource ? LOSS_ORIGIN[s.splice.lossSource] : 'origin not recorded'}` : ''}
                  {s.splice.otdrRef ? ` · OTDR ${s.splice.otdrRef}` : ''}
                  {s.active ? ' · in service' : s.splice.retiredAt && s.splice.enteredInError ? ` · ✕ entered by mistake, struck out ${s.splice.retiredAt.slice(0, 10)}${s.splice.retiredBy ? ` by ${s.splice.retiredBy}` : ''}${s.splice.retiredReason ? ` (${s.splice.retiredReason})` : ''}` : s.splice.retiredAt ? ` · out of service since ${s.splice.retiredAt.slice(0, 10)}${s.splice.retiredReason ? ` (${s.splice.retiredReason})` : ''}` : ` · ${s.splice.status.toLowerCase()}`}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </details>
  );
}
