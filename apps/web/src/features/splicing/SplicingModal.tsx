import React, { useState } from 'react';
import { FileDown, GitBranch } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import {
  type Cable,
  coreIdentity,
  type FiberTermination,
  type JointClosure,
  type LossSource,
  pickerEntries,
  spliceDirectionMismatch,
  type SpliceRecord,
  type SpliceType,
  takenPositions,
  trayUsage,
} from '@fibergis/shared';

import { Button, Field, Input, Modal, Select, Textarea } from '../../components/ui';
import { markSpliceMistake, redoSplice, savePigtail, saveSplice, saveTrayCapacity, takePigtailOut, takeSpliceOut } from '../../stores/fiberActions';
import { selectColorSchemes, useNetworkStore } from '../../stores/networkStore';
import { useUiStore } from '../../stores/uiStore';
import { FiberSwatch } from '../fiber/FiberChip';
import { FiberPicker } from '../fiber/FiberPicker';
import { emptyFiber, type FiberChoice, fiberOf } from '../fiber/fiberUi';
import { SpliceDiagram } from './SpliceDiagram';
import { PhotoStrip, SplicePhotoPicker } from './SplicePhotos';
import { buildSpliceReport, downloadSpliceReport } from './spliceReport';
import { historyWords, LOSS_SOURCE_LABELS, lossWords, NOT_RECORDED, placeWords, SPLICE_STATUS_WORDS } from './spliceWords';

/** Phones get 48 px targets; desktop keeps the compact engineer layout. */
const tall = 'min-h-12 md:min-h-0';

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

const trayName = (closure: JointClosure, id?: string) => (id ? (closure.trays ?? []).find((t) => t.id === id)?.label : undefined);

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

/** Asks for a reason, then runs the action. Used for "out of service" and "entered by mistake". */
function ReasonAsk({ testId, placeholder, label, required, onSave, onCancel }: { testId: string; placeholder: string; label: string; required: boolean; onSave: (reason: string) => void; onCancel: () => void }) {
  const [reason, setReason] = useState('');
  return (
    <div className="mt-1 space-y-1.5">
      <Input data-testid={`${testId}-reason`} className={tall} value={reason} placeholder={placeholder} onChange={(e) => setReason(e.target.value)} />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="danger" className={tall} data-testid={`${testId}-confirm`} disabled={required && !reason.trim()} onClick={() => onSave(reason)}>
          {label}
        </Button>
        <Button size="sm" variant="ghost" className={tall} onClick={onCancel}>
          Keep it
        </Button>
      </div>
    </div>
  );
}

/** One splice in service: input fiber on the left, output on the right, a line between, and what is recorded about it. */
function SpliceRow({ closure, splice, onRedo }: { closure: JointClosure; splice: SpliceRecord; onRedo: (s: SpliceRecord) => void }) {
  const [asking, setAsking] = useState<'out' | 'mistake' | null>(null);
  const broken = splice.status === 'Failed' || splice.status === 'Damaged';
  const place = placeWords(trayName(closure, splice.trayId), splice.cassette, splice.position);
  return (
    <li className="rounded-md border border-slate-200 bg-white p-2 text-xs" data-testid={`splice-row-${splice.id}`}>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <FiberEnd cableId={splice.inputCableId} core={splice.inputCore} />
        <span className="flex items-center" aria-hidden>
          <span className={`w-8 ${splice.status === 'Pending' ? 'border-t-2 border-dashed border-slate-500' : broken ? 'h-0.5 bg-red-600' : 'h-0.5 bg-slate-700'}`} />
          {broken && <span className="ml-0.5 font-bold text-red-700">✕</span>}
          {splice.status === 'Tested' && <span className="ml-0.5 font-bold text-green-800">✓</span>}
        </span>
        <FiberEnd cableId={splice.outputCableId} core={splice.outputCore} />
      </div>
      <p className="mt-1 text-[11px] leading-5 text-slate-600">
        {place} · {splice.spliceType ?? 'type not recorded'} · {SPLICE_STATUS_WORDS[splice.status]} · {lossWords(splice)}
        {splice.lossMeter ? ` · read on ${splice.lossMeter}` : ''}
        {splice.otdrRef ? ` · OTDR ${splice.otdrRef}` : ''}
        {splice.reportRef ? ` · report ${splice.reportRef}` : ''} · {splice.technician || 'technician not recorded'} · {splice.date || 'date not recorded'}
      </p>
      {splice.notes && <p className="mt-0.5 text-[11px] text-slate-700">Note: {splice.notes}</p>}
      {splice.photoIds?.length ? (
        <div className="mt-1">
          <PhotoStrip ids={splice.photoIds} alt="Splice photo" />
        </div>
      ) : null}
      {asking === 'out' && (
        <ReasonAsk testId={`splice-retire-${splice.id}`} placeholder="Why (cut, re-made …)" label="Take out of service" required={false} onCancel={() => setAsking(null)} onSave={(r) => void takeSpliceOut(closure.id, splice.id, r)} />
      )}
      {asking === 'mistake' && (
        <>
          <p className="mt-1 text-[11px] text-slate-700">Only for a record that never existed. It is struck out and kept in the history with your name and reason.</p>
          <ReasonAsk testId={`splice-mistake-${splice.id}`} placeholder="Why is it a mistake? (wrong fiber chosen …)" label="Strike out: entered by mistake" required onCancel={() => setAsking(null)} onSave={(r) => void markSpliceMistake(closure.id, splice.id, r)} />
        </>
      )}
      {!asking && (
        <div className="mt-1 flex flex-wrap gap-2">
          <Button size="xs" className={tall} data-testid={`splice-retire-${splice.id}`} onClick={() => setAsking('out')}>
            Out of service
          </Button>
          <Button size="xs" className={tall} data-testid={`splice-redo-${splice.id}`} onClick={() => onRedo(splice)}>
            Re-splice
          </Button>
          <Button size="xs" variant="ghost" className={tall} data-testid={`splice-mistake-${splice.id}`} onClick={() => setAsking('mistake')}>
            Entered by mistake
          </Button>
        </div>
      )}
    </li>
  );
}

function PigtailRow({ closure, pigtail }: { closure: JointClosure; pigtail: FiberTermination }) {
  const [asking, setAsking] = useState<'out' | 'mistake' | null>(null);
  return (
    <li className="rounded-md border border-slate-200 bg-white p-2 text-xs" data-testid={`pigtail-row-${pigtail.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <FiberEnd cableId={pigtail.cableId} core={pigtail.core} />
        <span aria-hidden>→ ▣</span>
        <span>
          Ends on a pigtail: <strong>{pigtail.connectorType ?? 'connector not recorded'}</strong>
          {pigtail.pigtailLabel ? ` (${pigtail.pigtailLabel})` : ''}
        </span>
      </div>
      <p className="mt-1 text-[11px] leading-5 text-slate-600">
        {placeWords(trayName(closure, pigtail.trayId), pigtail.cassette, pigtail.position)} · plugs into: {pigtail.connectsTo || NOT_RECORDED} · {pigtail.technician || 'technician not recorded'} · {pigtail.date || 'date not recorded'}
      </p>
      {pigtail.notes && <p className="mt-0.5 text-[11px] text-slate-700">Note: {pigtail.notes}</p>}
      {pigtail.photoIds?.length ? <PhotoStrip ids={pigtail.photoIds} alt="Pigtail photo" /> : null}
      {asking === 'out' && <ReasonAsk testId={`pigtail-out-${pigtail.id}`} placeholder="Why (cut off, spliced instead …)" label="Take pigtail out" required={false} onCancel={() => setAsking(null)} onSave={(r) => void takePigtailOut(closure.id, pigtail.id, r)} />}
      {asking === 'mistake' && (
        <ReasonAsk testId={`pigtail-mistake-${pigtail.id}`} placeholder="Why is it a mistake?" label="Strike out: entered by mistake" required onCancel={() => setAsking(null)} onSave={(r) => void takePigtailOut(closure.id, pigtail.id, r, true)} />
      )}
      {!asking && (
        <div className="mt-1 flex flex-wrap gap-2">
          <Button size="xs" className={tall} data-testid={`pigtail-out-${pigtail.id}`} onClick={() => setAsking('out')}>
            Take out
          </Button>
          <Button size="xs" variant="ghost" className={tall} data-testid={`pigtail-mistake-${pigtail.id}`} onClick={() => setAsking('mistake')}>
            Entered by mistake
          </Button>
        </div>
      )}
    </li>
  );
}

/** Tray, cassette and position. Shows the positions already taken; never picks one for the person. */
function PlaceFields({ closure, trayId, setTrayId, cassette, setCassette, position, setPosition, exceptId, testId }: {
  closure: JointClosure;
  trayId: string;
  setTrayId: (v: string) => void;
  cassette: string;
  setCassette: (v: string) => void;
  position: string;
  setPosition: (v: string) => void;
  exceptId?: string;
  testId: string;
}) {
  const usage = trayUsage(closure).find((u) => u.tray.id === trayId);
  const taken = trayId ? takenPositions(closure, trayId, cassette, exceptId) : [];
  const clash = position !== '' && taken.includes(Number(position));
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      <Field label="Tray">
        <Select data-testid={`${testId}-tray`} className={tall} value={trayId} onChange={(e) => setTrayId(e.target.value)}>
          <option value="">Tray not recorded</option>
          {(closure.trays ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Cassette (if any)">
        <Input data-testid={`${testId}-cassette`} className={tall} value={cassette} maxLength={40} disabled={!trayId} onChange={(e) => setCassette(e.target.value)} />
      </Field>
      <Field label="Position on tray">
        <Input data-testid={`${testId}-position`} className={tall} inputMode="numeric" value={position} disabled={!trayId} onChange={(e) => setPosition(e.target.value.replace(/\D/g, '').slice(0, 3))} />
      </Field>
      {trayId && (
        <p className="text-[11px] text-slate-600 sm:col-span-3" data-testid={`${testId}-taken`}>
          {usage?.tray.capacity !== undefined ? `${usage.used} of ${usage.tray.capacity} positions used. ` : `${usage?.used ?? 0} used; number of positions not recorded. `}
          {taken.length ? `Taken${cassette.trim() ? ` in cassette ${cassette.trim()}` : ''}: ${taken.join(', ')}.` : 'No position recorded as taken.'}
          {clash && <strong className="block text-red-700">Position {position} is already taken. Choose another, or take the other one out first.</strong>}
          {usage?.tray.capacity !== undefined && usage.used >= usage.tray.capacity && <strong className="block text-amber-800">This tray is full by its record. You can still save; you will be asked to check.</strong>}
        </p>
      )}
    </div>
  );
}

function SpliceForm({ closure, redo, onDone }: { closure: JointClosure; redo: SpliceRecord | null; onDone: () => void }) {
  const cables = useNetworkStore((s) => s.cables);
  const local = cablesAtClosure(closure, cables);
  const [trayId, setTrayId] = useState(redo?.trayId ?? '');
  const [cassette, setCassette] = useState(redo?.cassette ?? '');
  const [position, setPosition] = useState(redo?.position !== undefined ? String(redo.position) : '');
  const [from, setFrom] = useState<FiberChoice>(redo ? { cableId: redo.inputCableId, core: String(redo.inputCore) } : emptyFiber);
  const [to, setTo] = useState<FiberChoice>(redo ? { cableId: redo.outputCableId, core: String(redo.outputCore) } : emptyFiber);
  const [type, setType] = useState<SpliceType>('fusion');
  const [loss, setLoss] = useState('');
  const [lossSource, setLossSource] = useState<LossSource | ''>('');
  const [meter, setMeter] = useState('');
  const [otdr, setOtdr] = useState('');
  const [reportRef, setReportRef] = useState('');
  const [technician, setTechnician] = useState('');
  const [date, setDate] = useState('');
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [status, setStatus] = useState<'Spliced' | 'Tested' | 'Pending'>('Spliced');
  const a = fiberOf(from);
  const b = fiberOf(to);
  const direction = a && b && a.cableId !== b.cableId ? spliceDirectionMismatch(closure, a.cableId, b.cableId) : undefined;
  const nameOf = (id: string) => cables.find((c) => c.id === id)?.name ?? id;

  const submit = async () => {
    if (!a || !b) return;
    const draft = {
      trayId: trayId || undefined,
      ...(trayId && cassette.trim() ? { cassette: cassette.trim() } : {}),
      ...(trayId && position ? { position: Number(position) } : {}),
      inputCableId: a.cableId,
      inputCore: a.core,
      outputCableId: b.cableId,
      outputCore: b.core,
      spliceType: type,
      ...(loss ? { spliceLossDb: Number(loss), lossSource: (lossSource || undefined) as LossSource | undefined } : {}),
      lossMeter: meter,
      otdrRef: otdr,
      reportRef,
      technician,
      date: date || undefined,
      status,
      notes,
      photoIds: photos,
    };
    const saved = redo ? await redoSplice(closure.id, redo.id, draft, 'Re-spliced') : await saveSplice(closure.id, draft);
    if (saved) onDone();
  };

  return (
    <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3" data-testid="splice-form">
      <p className="text-xs font-semibold text-slate-700">{redo ? 'Re-splice: the old splice is kept as history' : 'Record a splice'}</p>
      <PlaceFields closure={closure} trayId={trayId} setTrayId={setTrayId} cassette={cassette} setCassette={setCassette} position={position} setPosition={setPosition} exceptId={redo?.id} testId="splice" />
      <FiberPicker label="From (towards the OLT)" value={from} onChange={setFrom} cables={local} testId="splice-from" />
      <FiberPicker label="To (towards customers)" value={to} onChange={setTo} cables={local} testId="splice-to" />
      {direction && (
        <p role="status" className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900" data-testid="splice-direction-hint">
          ⚠ {direction === 'input' ? `${nameOf(a!.cableId)} is recorded here as going out towards customers.` : `${nameOf(b!.cableId)} is recorded here as coming in from the OLT side.`} Check which side is towards the OLT. You can still save.
        </p>
      )}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
        <Field label="Type">
          <Select data-testid="splice-type" className={tall} value={type} onChange={(e) => setType(e.target.value as SpliceType)}>
            <option value="fusion">Fusion</option>
            <option value="mechanical">Mechanical</option>
          </Select>
        </Field>
        <Field label="State">
          <Select data-testid="splice-status" className={tall} value={status} onChange={(e) => setStatus(e.target.value as 'Spliced' | 'Tested' | 'Pending')}>
            <option value="Spliced">Done</option>
            <option value="Tested">Done and tested</option>
            <option value="Pending">Planned, not done</option>
          </Select>
        </Field>
        <Field label="Loss in dB (if known)" hint="Example: 0.05">
          <div className="relative">
            <Input data-testid="splice-loss" className={`${tall} pr-9`} inputMode="decimal" value={loss} onChange={(e) => setLoss(e.target.value.replace(/[^\d.]/g, ''))} />
            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-500">dB</span>
          </div>
        </Field>
        <Field label="Loss from">
          <Select data-testid="splice-loss-source" className={tall} value={lossSource} disabled={!loss} onChange={(e) => setLossSource(e.target.value as LossSource)}>
            <option value="">Choose…</option>
            {(Object.keys(LOSS_SOURCE_LABELS) as LossSource[]).map((k) => (
              <option key={k} value={k}>
                {LOSS_SOURCE_LABELS[k]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Meter or splicer used" hint="Make, model or serial">
          <Input data-testid="splice-meter" className={tall} value={meter} maxLength={120} onChange={(e) => setMeter(e.target.value)} />
        </Field>
        <Field label="OTDR or test ref">
          <Input data-testid="splice-otdr" className={tall} value={otdr} maxLength={120} onChange={(e) => setOtdr(e.target.value)} />
        </Field>
        <Field label="Report or job sheet no.">
          <Input data-testid="splice-report-ref" className={tall} value={reportRef} maxLength={120} onChange={(e) => setReportRef(e.target.value)} />
        </Field>
        <Field label="Technician" hint="Left empty: your name is saved">
          <Input className={tall} value={technician} onChange={(e) => setTechnician(e.target.value)} />
        </Field>
        <Field label="Date spliced" hint="Left empty: today is saved">
          <Input type="date" className={tall} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      <Field label="Notes (optional)">
        <Textarea data-testid="splice-notes" rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <SplicePhotoPicker ids={photos} onChange={setPhotos} testId="splice-photos" />
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" className={`${tall} max-md:w-full`} data-testid="splice-save" disabled={!a || !b || (!!loss && !lossSource)} onClick={() => void submit()}>
          {redo ? 'Save re-splice' : 'Save splice'}
        </Button>
        {redo && (
          <Button variant="ghost" className={tall} onClick={onDone}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}

function PigtailForm({ closure }: { closure: JointClosure }) {
  const cables = useNetworkStore((s) => s.cables);
  const settings = useNetworkStore((s) => s.settings);
  const local = cablesAtClosure(closure, cables);
  const [fiber, setFiber] = useState<FiberChoice>(emptyFiber);
  const [connector, setConnector] = useState('');
  const [label, setLabel] = useState('');
  const [connectsTo, setConnectsTo] = useState('');
  const [trayId, setTrayId] = useState('');
  const [cassette, setCassette] = useState('');
  const [position, setPosition] = useState('');
  const [technician, setTechnician] = useState('');
  const [date, setDate] = useState('');
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const chosen = fiberOf(fiber);
  const connectors = pickerEntries('connectorTypes', settings);

  const submit = async () => {
    if (!chosen) return;
    const saved = await savePigtail(closure.id, {
      cableId: chosen.cableId,
      core: chosen.core,
      ...(connector ? { connectorType: connector } : {}),
      pigtailLabel: label,
      connectsTo,
      trayId: trayId || undefined,
      ...(trayId && cassette.trim() ? { cassette: cassette.trim() } : {}),
      ...(trayId && position ? { position: Number(position) } : {}),
      technician,
      date: date || undefined,
      notes,
      photoIds: photos,
    });
    if (saved) {
      setFiber(emptyFiber);
      setLabel('');
      setPosition('');
      setNotes('');
      setPhotos([]);
    }
  };

  return (
    <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3" data-testid="pigtail-form">
      <p className="text-xs font-semibold text-slate-700">A fiber that ends on a pigtail (a connector) here, not spliced to another fiber</p>
      <FiberPicker label="Which fiber" value={fiber} onChange={setFiber} cables={local} testId="pigtail-fiber" />
      <PlaceFields closure={closure} trayId={trayId} setTrayId={setTrayId} cassette={cassette} setCassette={setCassette} position={position} setPosition={setPosition} testId="pigtail" />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Field label="Connector type">
          <Select data-testid="pigtail-connector" className={tall} value={connector} onChange={(e) => setConnector(e.target.value)}>
            <option value="">Not known</option>
            {connectors.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Label on the pigtail (if any)">
          <Input data-testid="pigtail-label" className={tall} value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <Field label="Plugs into (as written)" hint="Text only. It does not link anything.">
          <Input data-testid="pigtail-connects-to" className={tall} value={connectsTo} maxLength={120} onChange={(e) => setConnectsTo(e.target.value)} />
        </Field>
        <Field label="Technician" hint="Left empty: your name is saved">
          <Input className={tall} value={technician} onChange={(e) => setTechnician(e.target.value)} />
        </Field>
        <Field label="Date" hint="Left empty: today is saved">
          <Input type="date" className={tall} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      <Field label="Notes (optional)">
        <Textarea rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <SplicePhotoPicker ids={photos} onChange={setPhotos} testId="pigtail-photos" />
      <Button variant="primary" className={`${tall} max-md:w-full`} data-testid="pigtail-save" disabled={!chosen} onClick={() => void submit()}>
        Save pigtail
      </Button>
    </div>
  );
}

/** Each tray: how many positions are used, and its capacity as printed (optional). */
function TrayCapacities({ closure }: { closure: JointClosure }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const usage = trayUsage(closure);
  if (usage.length === 0) return <p className="text-xs text-slate-500">No trays recorded. Add trays on the closure screen.</p>;
  return (
    <ul className="space-y-1.5" data-testid="splice-trays">
      {usage.map((u) => {
        const over = u.tray.capacity !== undefined && u.used > u.tray.capacity;
        return (
          <li key={u.tray.id} className="rounded-md border border-slate-200 bg-white p-2 text-xs" data-testid={`splice-tray-${u.tray.label}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <strong>{u.tray.label}</strong>: {u.used} used of {u.tray.capacity ?? 'positions not recorded'}
                {over && <strong className="ml-1 text-amber-800">⚠ more than its positions</strong>}
                {u.positionsTaken.length > 0 && <strong className="ml-1 text-red-700">✕ a position is recorded twice</strong>}
              </span>
              {editing !== u.tray.id && (
                <Button size="xs" className={tall} data-testid={`splice-tray-edit-${u.tray.label}`} onClick={() => { setEditing(u.tray.id); setValue(u.tray.capacity !== undefined ? String(u.tray.capacity) : ''); }}>
                  Set positions
                </Button>
              )}
            </div>
            {editing === u.tray.id && (
              <div className="mt-1.5 flex flex-wrap items-end gap-2">
                <Field label="Splice positions printed on the tray">
                  <Input data-testid={`splice-tray-capacity-${u.tray.label}`} className={tall} inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value.replace(/\D/g, '').slice(0, 3))} />
                </Field>
                <Button size="sm" variant="primary" className={tall} data-testid={`splice-tray-save-${u.tray.label}`} onClick={async () => { if (await saveTrayCapacity(closure.id, u.tray.id, value ? Number(value) : undefined)) setEditing(null); }}>
                  {value ? 'Save' : 'Save: not recorded'}
                </Button>
                <Button size="sm" variant="ghost" className={tall} onClick={() => setEditing(null)}>
                  Cancel
                </Button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Closure splice screen: splice picture, trays, splices and pigtails, history, and the forms. */
export const SplicingModal: React.FC = () => {
  const { open, setModalOpen, closureId } = useUiStore(
    useShallow((s) => ({ open: s.modals.splicing, setModalOpen: s.setModalOpen, closureId: s.splicingClosureId })),
  );
  const closures = useNetworkStore((s) => s.closures);
  const cables = useNetworkStore((s) => s.cables);
  const schemes = useNetworkStore(selectColorSchemes);
  const [picked, setPicked] = useState<string | null>(null);
  const [tray, setTray] = useState<string>('all');
  const [redo, setRedo] = useState<SpliceRecord | null>(null);
  const [mode, setMode] = useState<'splice' | 'pigtail'>('splice');
  if (!open) return null;
  const selectedId = picked ?? closureId;
  const closure = closures.find((c) => c.id === selectedId);
  const close = () => {
    setModalOpen('splicing', false);
    setPicked(null);
    setRedo(null);
  };
  const onTray = (trayId?: string) => tray === 'all' || (tray === 'none' ? !trayId : trayId === tray);
  const active = closure?.splices.filter((s) => !s.retiredAt && onTray(s.trayId)) ?? [];
  const pigtails = (closure?.terminations ?? []).filter((t) => !t.retiredAt && onTray(t.trayId));
  const history = closure?.splices.filter((s) => s.retiredAt) ?? [];
  const pigtailHistory = (closure?.terminations ?? []).filter((t) => t.retiredAt);
  const printReport = () => {
    if (!closure) return;
    const now = new Date();
    downloadSpliceReport(buildSpliceReport(closure, cables, schemes, now), `splice-report-${closure.name.replace(/[^\w-]+/g, '_')}-${now.toISOString().slice(0, 10)}.pdf`);
  };

  return (
    <Modal open onClose={close} title={closure ? `Splices in ${closure.name}` : 'Splices'} description="Fiber to fiber, tray by tray. Nothing is joined unless you record it." icon={GitBranch} size="xl">
      <div className="space-y-3 text-[13px]" data-testid="splicing-modal">
        <Field label="Closure">
          <Select data-testid="splice-closure" className={tall} value={selectedId ?? ''} onChange={(e) => setPicked(e.target.value || null)}>
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
                  className={`min-h-12 rounded-md border px-2.5 text-xs md:min-h-8 ${tray === t.id ? 'border-blue-500 bg-blue-50 font-semibold' : 'border-slate-200 bg-white'}`}
                >
                  {tray === t.id ? '● ' : ''}
                  {t.label}
                </button>
              ))}
            </div>
            <details open className="text-xs" data-testid="splice-picture-section">
              <summary className="flex min-h-12 cursor-pointer items-center font-semibold text-slate-700 md:min-h-0">Splice picture</summary>
              <div className="mt-1">
                <SpliceDiagram closure={closure} tray={tray} />
              </div>
            </details>
            <Button icon={FileDown} className={`${tall} max-md:w-full`} data-testid="splice-report" onClick={printReport}>
              Download splice report (PDF)
            </Button>
            <details className="text-xs" data-testid="splice-tray-section">
              <summary className="flex min-h-12 cursor-pointer items-center font-semibold text-slate-700 md:min-h-0">Trays and positions</summary>
              <div className="mt-1">
                <TrayCapacities closure={closure} />
              </div>
            </details>
            <ul className="space-y-1.5" data-testid="splice-diagram">
              {active.length === 0 && <li className="text-xs text-slate-500">No splices in service here.</li>}
              {active.map((s) => (
                <SpliceRow key={s.id} closure={closure} splice={s} onRedo={(r) => { setMode('splice'); setRedo(r); }} />
              ))}
            </ul>
            {pigtails.length > 0 && (
              <ul className="space-y-1.5" data-testid="pigtail-list">
                {pigtails.map((t) => (
                  <PigtailRow key={t.id} closure={closure} pigtail={t} />
                ))}
              </ul>
            )}
            {!redo && (
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="What to record">
                {(
                  [
                    ['splice', 'Joined to another fiber'],
                    ['pigtail', 'Ends on a pigtail'],
                  ] as const
                ).map(([id, text]) => (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={mode === id}
                    data-testid={`splice-mode-${id}`}
                    onClick={() => setMode(id)}
                    className={`min-h-12 rounded-md border px-2 text-xs font-medium md:min-h-9 ${mode === id ? 'border-blue-600 bg-blue-50 text-blue-900' : 'border-slate-300 bg-white text-slate-700'}`}
                  >
                    {mode === id ? '● ' : '○ '}
                    {text}
                  </button>
                ))}
              </div>
            )}
            {mode === 'pigtail' && !redo ? (
              <PigtailForm key={closure.id} closure={closure} />
            ) : (
              <SpliceForm key={`${closure.id}-${redo?.id ?? 'new'}`} closure={closure} redo={redo} onDone={() => setRedo(null)} />
            )}
            {history.length + pigtailHistory.length > 0 && (
              <details className="text-xs text-slate-600" data-testid="splice-history">
                <summary className="flex min-h-12 cursor-pointer items-center font-semibold md:min-h-0">
                  History ({history.length + pigtailHistory.length} out of service or entered by mistake)
                </summary>
                <ul className="mt-1 space-y-1.5">
                  {history.map((s) => (
                    <li key={s.id} data-testid={`splice-history-${s.id}`} data-mistake={s.enteredInError ? 'yes' : 'no'}>
                      <span className={s.enteredInError ? 'line-through' : ''}>
                        {s.inputCableName} fiber {s.inputCore} → {s.outputCableName} fiber {s.outputCore}
                      </span>
                      <span className="block">
                        {s.enteredInError ? '✕ ' : ''}
                        {historyWords(s)}
                        {s.replacedBySpliceId ? '. Replaced by a new splice' : ''}
                      </span>
                    </li>
                  ))}
                  {pigtailHistory.map((t) => (
                    <li key={t.id} data-testid={`pigtail-history-${t.id}`}>
                      <span className={t.enteredInError ? 'line-through' : ''}>
                        Pigtail on {t.cableName} fiber {t.core} ({t.connectorType ?? 'connector not recorded'})
                      </span>
                      <span className="block">
                        {t.enteredInError ? '✕ ' : ''}
                        {historyWords(t)}
                      </span>
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
