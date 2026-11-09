import { useState } from 'react';
import { ClipboardCheck, Lock, MapPin, Pause, Play, Wrench } from 'lucide-react';

import {
  affectedByElement,
  describeVerification,
  type Fault,
  FAULT_STATUS_LABELS,
  faultPhotoProblem,
  type FaultStatus,
  faultTimeline,
  faultVerificationOf,
  type ImpactIndex,
  isFaultOpen,
  recordNoPhotoReason,
} from '@fibergis/shared';

import { checkFault, makeJob, moveFault, resume } from '../../stores/faultActions';
import { useMapStore } from '../../stores/mapStore';
import { useNetworkStore } from '../../stores/networkStore';
import { useUiStore } from '../../stores/uiStore';
import { when } from './faultFormat';
import { buttonClass, ConfidenceBadge, inputClass, Section, TestBadge } from './faultUi';
import { TechnicianPicker, WorkOrderDetail } from './JobsTab';
import { ImpactList } from './SuspectedTab';
import { useTechnicianList } from './technicianList';

const STEPS: FaultStatus[] = ['Reported', 'Acknowledged', 'Assigned', 'In Repair', 'Repaired', 'Verified', 'Closed'];

function Stepper({ fault }: { fault: Fault }) {
  const at = STEPS.indexOf(fault.status === 'On Hold' ? (fault.heldFrom ?? 'Reported') : fault.status);
  return (
    <ol className="flex flex-wrap gap-1 text-[10px]" data-testid="fault-stepper">
      {STEPS.map((s, i) => (
        <li key={s} className={`rounded px-1.5 py-0.5 font-semibold ${i < at ? 'bg-emerald-100 text-emerald-900' : i === at ? 'bg-blue-700 text-white' : 'bg-slate-100 text-slate-500'}`}>
          {i <= at ? '✓ ' : ''}
          {FAULT_STATUS_LABELS[s]}
        </li>
      ))}
      {fault.status === 'On Hold' && <li className="rounded bg-amber-200 px-1.5 py-0.5 font-bold text-amber-900">On hold</li>}
    </ol>
  );
}

function NewJobForm({ fault, onDone }: { fault: Fault; onDone: (id: string) => void }) {
  const [title, setTitle] = useState(`Check ${fault.suspected?.label ?? fault.title}`.slice(0, 120));
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const technicians = useTechnicianList();
  // With login on, a job goes only to a real technician account (or stays unassigned).
  const nameOk = !name.trim() || !technicians.loginOn || technicians.names.includes(name.trim());
  const [steps, setSteps] = useState((fault.suspected?.checks ?? ['Find and repair the fault.']).join('\n'));
  return (
    <div className="space-y-1.5 rounded-lg border border-blue-200 bg-blue-50 p-2" data-testid="new-job-form">
      <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Work order title" data-testid="job-title" />
      <div className="grid gap-1.5 sm:grid-cols-2">
        <TechnicianPicker list={technicians} value={name} onChange={setName} testId="job-technician" />
        <input className={inputClass} placeholder="Technician phone (optional)" value={phone} onChange={(e) => setPhone(e.target.value)} aria-label="Technician phone" />
      </div>
      <textarea className={inputClass} rows={3} value={steps} onChange={(e) => setSteps(e.target.value)} aria-label="Steps, one per line" data-testid="job-steps" />
      <p className="text-[10px] text-slate-500">One step per line. The technician ticks each one on the phone, takes photos before and after, and records a light reading to check the repair.</p>
      <button
        type="button"
        data-testid="make-job"
        disabled={!title.trim() || !nameOk}
        onClick={() => {
          const order = makeJob({ title, faultId: fault.id, technicianName: name, technicianPhone: phone, steps: steps.split('\n'), type: 'Repair' });
          if (order) onDone(order.id);
        }}
        className={`${buttonClass} bg-blue-700 text-white`}
      >
        <Wrench className="mr-1 inline h-3.5 w-3.5" /> Make the work order
      </button>
    </div>
  );
}

function FaultDetail({ fault, ix, onShowJob }: { fault: Fault; ix: ImpactIndex; onShowJob: (id: string) => void }) {
  const workOrders = useNetworkStore((s) => s.workOrders);
  const customers = useNetworkStore((s) => s.customers);
  const [newJob, setNewJob] = useState(false);
  const [note, setNote] = useState('');
  const [checkNote, setCheckNote] = useState('');
  const jobs = workOrders.filter((w) => w.faultId === fault.id);
  const verification = faultVerificationOf({ workOrders }, fault);
  // Verified and Closed also need the repair photos (from a job) or a recorded reason why not.
  const photoWhy = faultPhotoProblem({ workOrders }, fault);
  const [noPhoto, setNoPhoto] = useState('');
  const open = isFaultOpen(fault);
  const now = fault.element ? affectedByElement(ix, fault.element) : null;
  const name = (id: string) => customers.find((c) => c.id === id)?.name ?? id;
  const timeline = faultTimeline({ workOrders }, fault);
  return (
    <div className="space-y-3" data-testid="fault-detail">
      <div className="space-y-1.5 rounded-xl border border-rose-200 bg-rose-50/60 p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <TestBadge isTest={fault.isTest} />
          <span className="font-mono text-[10px] text-rose-700">{fault.id}</span>
          <h3 className="text-sm font-bold text-rose-950">{fault.title}</h3>
          <span className="rounded bg-rose-700 px-1.5 py-0.5 text-[10px] font-bold text-white" data-testid="fault-status">
            {FAULT_STATUS_LABELS[fault.status]}
          </span>
        </div>
        <Stepper fault={fault} />
        <p className="text-[11px] text-slate-700">{fault.description}</p>
        <div className="text-[10px] text-slate-500">
          Raised {fault.reportedAt} · source {fault.source ?? 'not recorded'} · {fault.severity}
          {fault.assignedTechnician ? ` · ${fault.assignedTechnician}` : ''}
        </div>
      </div>

      {fault.suspected && (
        <Section title="Why this was suspected (as shown when the fault was opened)" testId="fault-suspected">
          <ConfidenceBadge confidence={fault.suspected.confidence} />
          <ul className="list-disc pl-5 text-[11px] text-slate-700">
            {fault.suspected.evidence.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
          {fault.suspected.missing.length > 0 && <div className="text-[11px] text-amber-900">Not recorded: {fault.suspected.missing.join(' ')}</div>}
        </Section>
      )}

      <Section title={`Affected customers when opened (${fault.affectedCustomerIds.length})`} testId="fault-affected">
        <div className="text-[11px] text-slate-700">{fault.affectedCustomerIds.map((id) => `${name(id)} (${id})`).join(', ') || 'None on recorded paths.'}</div>
        {(fault.mayBeAffectedCustomerIds ?? []).length > 0 && (
          <div className="text-[11px] text-amber-900">May be affected, path not fully recorded: {fault.mayBeAffectedCustomerIds!.map((id) => `${name(id)} (${id})`).join(', ')}</div>
        )}
        {now && (
          <details className="text-[11px]">
            <summary className="cursor-pointer font-semibold text-slate-700">Who is affected now, from today's records</summary>
            <ImpactList impact={now} />
          </details>
        )}
      </Section>

      <Section
        title={`Work orders (${jobs.length})`}
        testId="fault-jobs"
        right={
          open && (
            <button type="button" onClick={() => setNewJob(!newJob)} className={`${buttonClass} border border-blue-300 text-blue-800`} data-testid="new-job">
              Make a work order
            </button>
          )
        }
      >
        {newJob && (
          <NewJobForm
            fault={fault}
            onDone={(id) => {
              setNewJob(false);
              onShowJob(id);
            }}
          />
        )}
        {jobs.map((w) => (
          <div key={w.id} className="rounded-lg border border-slate-200 p-2">
            <WorkOrderDetail key={w.id} order={w} />
          </div>
        ))}
      </Section>

      <Section title="Check and close" testId="fault-close">
        {verification ? (
          <div className="text-[11px] font-semibold text-emerald-800" data-testid="fault-verification">
            Checked: {describeVerification(verification)}
            {verification.workOrderId ? ` (work order ${verification.workOrderId})` : ''}
          </div>
        ) : (
          <div className="text-[11px] text-slate-700" data-testid="fault-verification">
            No check yet. A fault closes only after a light reading measured in the field, a photo, or an office check.
          </div>
        )}
        {open && (
          <div className="flex flex-wrap gap-1.5">
            {fault.status === 'Reported' && (
              <button type="button" onClick={() => moveFault(fault.id, 'Acknowledged')} className={`${buttonClass} border border-slate-300`} data-testid="fault-ack">
                Acknowledge
              </button>
            )}
            {['Assigned', 'Acknowledged', 'Dispatched', 'Investigating'].includes(fault.status) && (
              <button type="button" onClick={() => moveFault(fault.id, 'In Repair')} className={`${buttonClass} border border-slate-300`}>
                Mark in repair
              </button>
            )}
            {['In Repair', 'In Progress'].includes(fault.status) && (
              <button type="button" onClick={() => moveFault(fault.id, 'Repaired')} className={`${buttonClass} border border-slate-300`}>
                Mark repaired
              </button>
            )}
            {fault.status === 'On Hold' ? (
              <button type="button" onClick={() => resume(fault.id)} className={`${buttonClass} border border-slate-300`}>
                <Play className="mr-1 inline h-3.5 w-3.5" /> Resume
              </button>
            ) : (
              <button type="button" onClick={() => moveFault(fault.id, 'On Hold', note || undefined)} className={`${buttonClass} border border-slate-300`}>
                <Pause className="mr-1 inline h-3.5 w-3.5" /> Put on hold
              </button>
            )}
            {verification && fault.status !== 'Verified' && (
              <button type="button" onClick={() => moveFault(fault.id, 'Verified')} className={`${buttonClass} border border-emerald-400 text-emerald-800`} data-testid="fault-verify">
                Mark verified
              </button>
            )}
          </div>
        )}
        {open && photoWhy && (
          <div className="space-y-1 rounded border border-amber-300 bg-amber-50 p-2 text-[11px]" data-testid="fault-photo-needed">
            <div className="text-amber-900">Photos of the repair: {photoWhy}</div>
            <div className="flex flex-wrap gap-1.5">
              <input className={`${inputClass} max-w-72`} placeholder="Why no photo was possible" value={noPhoto} onChange={(e) => setNoPhoto(e.target.value)} aria-label="Why no photo was possible" />
              <button
                type="button"
                disabled={noPhoto.trim().length < 3}
                onClick={() => {
                  if (useNetworkStore.getState().runCommand((d, ctx) => recordNoPhotoReason(d, { faultId: fault.id }, noPhoto, ctx))) setNoPhoto('');
                }}
                className={`${buttonClass} border border-slate-300`}
                data-testid="fault-no-photo-reason"
              >
                Record the reason
              </button>
            </div>
          </div>
        )}
        {open && !verification && (
          <div className="flex flex-wrap gap-1.5">
            <input className={`${inputClass} max-w-72`} placeholder="What the office checked (for an office check)" value={checkNote} onChange={(e) => setCheckNote(e.target.value)} aria-label="Office check note" />
            <button type="button" disabled={!checkNote.trim()} onClick={() => checkFault(fault.id, { method: 'office_check', note: checkNote })} className={`${buttonClass} border border-slate-300`}>
              <ClipboardCheck className="mr-1 inline h-3.5 w-3.5" /> Record office check
            </button>
          </div>
        )}
        {open && (
          <div className="flex flex-wrap gap-1.5">
            <input className={`${inputClass} max-w-72`} placeholder="What was found and done (resolution)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Resolution" data-testid="fault-resolution" />
            <button type="button" onClick={() => moveFault(fault.id, 'Closed', note || undefined)} className={`${buttonClass} bg-emerald-700 text-white`} data-testid="fault-close-button">
              <Lock className="mr-1 inline h-3.5 w-3.5" /> Close the fault
            </button>
          </div>
        )}
        {!open && fault.closedAt && (
          <div className="text-[11px] text-slate-700">
            Closed {when(fault.closedAt)} by {fault.closedBy ?? '?'}
            {fault.resolution ? `: ${fault.resolution}` : ''}
          </div>
        )}
      </Section>

      <Section title="Repair, check and resolution history" testId="fault-timeline">
        <ol className="space-y-0.5 text-[11px]">
          {timeline.map((h, i) => (
            <li key={`${h.source}-${h.at}-${i}`} className="text-slate-700">
              <span className="font-mono text-[10px] text-slate-500">{when(h.at)}</span> · <span className="font-semibold">{h.source}</span> · {h.by ?? '?'} · {h.details}
            </li>
          ))}
        </ol>
      </Section>
    </div>
  );
}

export function FaultsTab({ ix, selectedId, onSelect, onShowJob }: { ix: ImpactIndex; selectedId: string | null; onSelect: (id: string) => void; onShowJob: (id: string) => void }) {
  const faults = useNetworkStore((s) => s.faults);
  const flyTo = useMapStore((s) => s.flyTo);
  const setModalOpen = useUiStore((s) => s.setModalOpen);
  const [showClosed, setShowClosed] = useState(false);
  const list = faults.filter((f) => showClosed || isFaultOpen(f) || f.status === 'Verified');
  const selected = faults.find((f) => f.id === selectedId) ?? list[0];
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <div className="space-y-1.5">
        <label className="flex items-center gap-1 text-[11px] text-slate-600">
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Show closed
        </label>
        {list.length === 0 && <p className="text-[11px] text-slate-500">No open faults.</p>}
        {list.map((f) => (
          <button key={f.id} type="button" onClick={() => onSelect(f.id)} data-testid="fault-row" className={`w-full rounded-lg border p-2 text-left text-[11px] ${selected?.id === f.id ? 'border-rose-300 bg-rose-50' : 'border-slate-200 bg-white'}`}>
            <div className="flex items-center gap-1.5">
              <TestBadge isTest={f.isTest} />
              <span className="font-mono text-[10px] text-rose-700">{f.id}</span>
              <span className="text-[10px] text-slate-500">{f.severity}</span>
            </div>
            <div className="font-semibold text-slate-900">{f.title}</div>
            <div className="text-slate-500">
              {FAULT_STATUS_LABELS[f.status]} · {f.affectedCustomerIds.length} affected
            </div>
          </button>
        ))}
      </div>
      <div className="space-y-2 md:col-span-2">
        {selected && (
          <>
            <button
              type="button"
              onClick={() => {
                flyTo(selected.affectedLocation.lat, selected.affectedLocation.lng, 18);
                setModalOpen('faults', false);
              }}
              className={`${buttonClass} bg-slate-800 text-white`}
            >
              <MapPin className="mr-1 inline h-3.5 w-3.5" /> Show on the map
            </button>
            <FaultDetail key={selected.id} fault={selected} ix={ix} onShowJob={onShowJob} />
          </>
        )}
      </div>
    </div>
  );
}
