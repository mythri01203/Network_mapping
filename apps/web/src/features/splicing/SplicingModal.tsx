import React, { useState } from 'react';
import { GitBranch } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import {
  type Cable,
  coreIdentity,
  type JointClosure,
  type LossSource,
  type SpliceRecord,
  type SpliceType,
} from '@fibergis/shared';

import { Button, Field, Input, Modal, Select } from '../../components/ui';
import { requestConfirm } from '../../stores/confirmStore';
import { redoSplice,saveSplice, takeSpliceOut } from '../../stores/fiberActions';
import { removeSplice } from '../../stores/networkActions';
import { selectColorSchemes, useNetworkStore } from '../../stores/networkStore';
import { useUiStore } from '../../stores/uiStore';
import { FiberSwatch } from '../fiber/FiberChip';
import { FiberPicker } from '../fiber/FiberPicker';
import { emptyFiber, type FiberChoice, fiberOf } from '../fiber/fiberUi';

const LOSS_SOURCE_LABELS: Record<LossSource, string> = {
  field_measured: 'Measured with a meter',
  device_reported: 'OTDR or splicer reading',
  designed: 'Design value',
  calculated: 'Worked out',
};

/** Cables recorded at a closure: its entries, its legacy A/B cables and cables drawn to its pin. */
function cablesAtClosure(closure: JointClosure, cables: readonly Cable[]): Cable[] {
  const ids = new Set<string>([
    ...(closure.cableEntries ?? []).map((e) => e.cableId),
    ...[closure.cableAId, closure.cableBId].filter((x): x is string => !!x),
  ]);
  return cables.filter(
    (c) =>
      c.cableCategory !== 'Coaxial' &&
      (ids.has(c.id) || (!!closure.equipmentId && (c.startEquipmentId === closure.equipmentId || c.endEquipmentId === closure.equipmentId))),
  );
}

function FiberEnd({ cableId, core }: { cableId: string; core: number }) {
  const cable = useNetworkStore((s) => s.cables.find((c) => c.id === cableId));
  const schemes = useNetworkStore(selectColorSchemes);
  const identity = cable ? coreIdentity(cable, core, schemes) : undefined;
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <FiberSwatch identity={identity} />
      <span className="min-w-0 truncate">
        <strong>{cable?.name ?? cableId}</strong> {identity?.shortLabel ?? `F${core}`}
        {identity?.fiberColor ? ` ${identity.fiberColor.name}` : ''}
      </span>
    </span>
  );
}

/** One row of the tray diagram: input fiber on the left, output on the right, a line between. */
function SpliceRow({ closure, splice, onRedo }: { closure: JointClosure; splice: SpliceRecord; onRedo: (s: SpliceRecord) => void }) {
  const [reason, setReason] = useState('');
  const [asking, setAsking] = useState(false);
  const broken = splice.status === 'Failed' || splice.status === 'Damaged';
  return (
    <li className="rounded-md border border-slate-200 bg-white p-2 text-xs" data-testid={`splice-row-${splice.id}`}>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <FiberEnd cableId={splice.inputCableId} core={splice.inputCore} />
        <span className={`h-0.5 w-8 ${broken ? 'bg-red-500' : splice.status === 'Pending' ? 'border-t-2 border-dashed border-slate-400' : 'bg-slate-700'}`} aria-hidden />
        <FiberEnd cableId={splice.outputCableId} core={splice.outputCore} />
      </div>
      <p className="mt-1 text-[11px] text-slate-600">
        {splice.spliceType ?? 'fusion'} · {splice.status} ·{' '}
        {splice.spliceLossDb !== undefined ? `${splice.spliceLossDb} dB (${splice.lossSource ? LOSS_SOURCE_LABELS[splice.lossSource] : 'origin not recorded'})` : 'loss not recorded'}
        {splice.otdrRef ? ` · OTDR ${splice.otdrRef}` : ''}
        {splice.technician ? ` · ${splice.technician}` : ''} · {splice.date}
      </p>
      {asking ? (
        <div className="mt-1 flex gap-2">
          <Input data-testid={`splice-retire-reason-${splice.id}`} value={reason} placeholder="Why (cut, re-made, wrong record…)" onChange={(e) => setReason(e.target.value)} />
          <Button size="sm" variant="danger" data-testid={`splice-retire-confirm-${splice.id}`} onClick={() => void takeSpliceOut(closure.id, splice.id, reason)}>
            Take out
          </Button>
        </div>
      ) : (
        <div className="mt-1 flex flex-wrap gap-2">
          <Button size="xs" data-testid={`splice-retire-${splice.id}`} onClick={() => setAsking(true)}>
            Out of service
          </Button>
          <Button size="xs" data-testid={`splice-redo-${splice.id}`} onClick={() => onRedo(splice)}>
            Re-splice
          </Button>
          <Button
            size="xs"
            variant="ghost"
            onClick={async () => {
              const ok = await requestConfirm({
                title: 'Delete splice record',
                message: 'Only for a record entered by mistake. A splice that existed should be taken out of service instead, so its history stays.',
                confirmLabel: 'Delete record',
                tone: 'danger',
              });
              if (ok) removeSplice(closure.id, splice.id);
            }}
          >
            Entered by mistake
          </Button>
        </div>
      )}
    </li>
  );
}

function SpliceForm({ closure, redo, onDone }: { closure: JointClosure; redo: SpliceRecord | null; onDone: () => void }) {
  const cables = useNetworkStore((s) => s.cables);
  const local = cablesAtClosure(closure, cables);
  const [trayId, setTrayId] = useState(redo?.trayId ?? '');
  const [from, setFrom] = useState<FiberChoice>(redo ? { cableId: redo.inputCableId, core: String(redo.inputCore) } : emptyFiber);
  const [to, setTo] = useState<FiberChoice>(redo ? { cableId: redo.outputCableId, core: String(redo.outputCore) } : emptyFiber);
  const [type, setType] = useState<SpliceType>('fusion');
  const [loss, setLoss] = useState('');
  const [lossSource, setLossSource] = useState<LossSource | ''>('');
  const [otdr, setOtdr] = useState('');
  const [technician, setTechnician] = useState('');
  const [date, setDate] = useState('');
  const [status, setStatus] = useState<'Spliced' | 'Tested' | 'Pending'>('Spliced');
  const a = fiberOf(from);
  const b = fiberOf(to);

  const submit = async () => {
    if (!a || !b) return;
    const draft = {
      trayId: trayId || undefined,
      inputCableId: a.cableId,
      inputCore: a.core,
      outputCableId: b.cableId,
      outputCore: b.core,
      spliceType: type,
      ...(loss ? { spliceLossDb: Number(loss), lossSource: (lossSource || undefined) as LossSource | undefined } : {}),
      otdrRef: otdr,
      technician,
      date: date || undefined,
      status,
    };
    const saved = redo ? await redoSplice(closure.id, redo.id, draft, 'Re-spliced') : await saveSplice(closure.id, draft);
    if (saved) onDone();
  };

  return (
    <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3" data-testid="splice-form">
      <p className="text-xs font-semibold text-slate-700">{redo ? 'Re-splice: the old splice is kept as history' : 'Record a splice'}</p>
      <Field label="Tray">
        <Select data-testid="splice-tray" value={trayId} onChange={(e) => setTrayId(e.target.value)}>
          <option value="">Tray not recorded</option>
          {(closure.trays ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </Select>
      </Field>
      <FiberPicker label="From (towards the OLT)" value={from} onChange={setFrom} cables={local} testId="splice-from" />
      <FiberPicker label="To (towards customers)" value={to} onChange={setTo} cables={local} testId="splice-to" />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Field label="Type">
          <Select data-testid="splice-type" value={type} onChange={(e) => setType(e.target.value as SpliceType)}>
            <option value="fusion">Fusion</option>
            <option value="mechanical">Mechanical</option>
          </Select>
        </Field>
        <Field label="State">
          <Select data-testid="splice-status" value={status} onChange={(e) => setStatus(e.target.value as 'Spliced' | 'Tested' | 'Pending')}>
            <option value="Spliced">Done</option>
            <option value="Tested">Done and tested</option>
            <option value="Pending">Planned, not done</option>
          </Select>
        </Field>
        <Field label="Loss dB (if known)">
          <Input data-testid="splice-loss" inputMode="decimal" value={loss} onChange={(e) => setLoss(e.target.value.replace(/[^\d.]/g, ''))} />
        </Field>
        <Field label="Loss from">
          <Select data-testid="splice-loss-source" value={lossSource} disabled={!loss} onChange={(e) => setLossSource(e.target.value as LossSource)}>
            <option value="">Choose…</option>
            {(Object.keys(LOSS_SOURCE_LABELS) as LossSource[]).map((k) => (
              <option key={k} value={k}>
                {LOSS_SOURCE_LABELS[k]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="OTDR or test ref">
          <Input data-testid="splice-otdr" value={otdr} onChange={(e) => setOtdr(e.target.value)} />
        </Field>
        <Field label="Technician">
          <Input value={technician} onChange={(e) => setTechnician(e.target.value)} />
        </Field>
        <Field label="Date">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      <div className="flex gap-2">
        <Button variant="primary" data-testid="splice-save" disabled={!a || !b || (!!loss && !lossSource)} onClick={() => void submit()}>
          {redo ? 'Save re-splice' : 'Save splice'}
        </Button>
        {redo && (
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}

/** Closure splice screen: tray diagram, core-to-core mapping, history, and the splice form. */
export const SplicingModal: React.FC = () => {
  const { open, setModalOpen, closureId } = useUiStore(
    useShallow((s) => ({ open: s.modals.splicing, setModalOpen: s.setModalOpen, closureId: s.splicingClosureId })),
  );
  const closures = useNetworkStore((s) => s.closures);
  const [picked, setPicked] = useState<string | null>(null);
  const [tray, setTray] = useState<string>('all');
  const [redo, setRedo] = useState<SpliceRecord | null>(null);
  if (!open) return null;
  const selectedId = picked ?? closureId;
  const closure = closures.find((c) => c.id === selectedId);
  const close = () => {
    setModalOpen('splicing', false);
    setPicked(null);
    setRedo(null);
  };
  const active = closure?.splices.filter((s) => !s.retiredAt && (tray === 'all' || (tray === 'none' ? !s.trayId : s.trayId === tray))) ?? [];
  const history = closure?.splices.filter((s) => s.retiredAt) ?? [];

  return (
    <Modal open onClose={close} title={closure ? `Splices in ${closure.name}` : 'Splices'} description="Fiber to fiber, tray by tray. Nothing is joined unless you record it." icon={GitBranch} size="xl">
      <div className="space-y-3 text-[13px]" data-testid="splicing-modal">
        <Field label="Closure">
          <Select data-testid="splice-closure" value={selectedId ?? ''} onChange={(e) => setPicked(e.target.value || null)}>
            <option value="">Choose a closure…</option>
            {closures.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        {closures.length === 0 && <p className="text-xs text-slate-600">No closure records yet. Select a closure pin on the map and tap Set up closure.</p>}
        {closure && (
          <>
            <div className="flex flex-wrap gap-1" role="tablist">
              {[{ id: 'all', label: 'All trays' }, ...(closure.trays ?? []).map((t) => ({ id: t.id, label: t.label })), { id: 'none', label: 'No tray' }].map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={tray === t.id}
                  data-testid={`splice-tab-${t.label}`}
                  onClick={() => setTray(t.id)}
                  className={`min-h-8 rounded-md border px-2.5 text-xs ${tray === t.id ? 'border-blue-500 bg-blue-50 font-semibold' : 'border-slate-200 bg-white'}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <ul className="space-y-1.5" data-testid="splice-diagram">
              {active.length === 0 && <li className="text-xs text-slate-500">No splices in service here.</li>}
              {active.map((s) => (
                <SpliceRow key={s.id} closure={closure} splice={s} onRedo={setRedo} />
              ))}
            </ul>
            <SpliceForm key={redo?.id ?? 'new'} closure={closure} redo={redo} onDone={() => setRedo(null)} />
            {history.length > 0 && (
              <details className="text-xs text-slate-600" data-testid="splice-history">
                <summary className="cursor-pointer font-semibold">History ({history.length} out of service)</summary>
                <ul className="mt-1 space-y-1">
                  {history.map((s) => (
                    <li key={s.id}>
                      {s.inputCableName} fiber {s.inputCore} → {s.outputCableName} fiber {s.outputCore}: out of service {s.retiredAt?.slice(0, 10)}
                      {s.retiredReason ? ` (${s.retiredReason})` : ''}
                      {s.retiredBy ? `, ${s.retiredBy}` : ''}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </div>
    </Modal>
  );
};
