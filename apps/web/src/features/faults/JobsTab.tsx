import { useState } from 'react';
import { ClipboardCheck, UserPlus } from 'lucide-react';

import { describeVerification, isWorkOrderOpen, jobPhotoProblem, recordNoPhotoReason, WORK_ORDER_STATUS_LABELS, type WorkOrder, type WorkOrderStatus } from '@fibergis/shared';

import { assign, checkJob, moveJob } from '../../stores/faultActions';
import { useNetworkStore } from '../../stores/networkStore';
import { when } from './faultFormat';
import { buttonClass, inputClass, JobPhoto, Section, TestBadge } from './faultUi';
import { type TechnicianList, useTechnicianList } from './technicianList';

const NEXT: Partial<Record<WorkOrderStatus, { to: WorkOrderStatus; label: string }[]>> = {
  Pending: [{ to: 'Cancelled', label: 'Cancel' }],
  Assigned: [{ to: 'In Progress', label: 'Mark in progress' }, { to: 'On Hold', label: 'Put on hold' }, { to: 'Cancelled', label: 'Cancel' }],
  Accepted: [{ to: 'In Progress', label: 'Mark in progress' }, { to: 'On Hold', label: 'Put on hold' }],
  'In Progress': [{ to: 'Completed', label: 'Repair done' }, { to: 'On Hold', label: 'Put on hold' }],
  'On Hold': [{ to: 'In Progress', label: 'Resume' }],
  Completed: [{ to: 'Verified', label: 'Mark verified' }, { to: 'In Progress', label: 'Repair did not hold' }],
  Verified: [{ to: 'Closed', label: 'Close the work order' }],
};

/**
 * Who does the job. With login on it is a pick list of real technician accounts; free text only in
 * setup mode, with a note saying so. A name already on the job that has no account stays visible.
 */
export function TechnicianPicker({ list, value, onChange, testId }: { list: TechnicianList; value: string; onChange: (name: string) => void; testId?: string }) {
  if (!list.loginOn) {
    return (
      <div className="space-y-0.5">
        <input className={`${inputClass} max-w-48`} placeholder="Technician name" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Technician name" data-testid={testId} />
        <p className="text-[10px] text-amber-800" data-testid="technician-setup-note">
          Setup mode: there are no accounts yet, so type the name exactly as the technician will choose it on the phone.
        </p>
      </div>
    );
  }
  const options = value && !list.names.includes(value) ? [value, ...list.names] : list.names;
  return (
    <div className="space-y-0.5">
      <select className={`${inputClass} max-w-48`} value={value} onChange={(e) => onChange(e.target.value)} aria-label="Technician" data-testid={testId}>
        <option value="">Choose a technician</option>
        {options.map((n) => (
          <option key={n} value={n}>
            {list.names.includes(n) ? n : `${n} (no account with this name)`}
          </option>
        ))}
      </select>
      {list.state === 'loading' && <p className="text-[10px] text-slate-500">Loading the technician accounts…</p>}
      {list.state === 'failed' && <p className="text-[10px] text-amber-800">Could not load the technician accounts. Check the connection and open this again.</p>}
      {list.state === 'ready' && list.names.length === 0 && <p className="text-[10px] text-amber-800">No technician accounts yet. Make one in Administration first.</p>}
    </div>
  );
}

export function WorkOrderDetail({ order }: { order: WorkOrder }) {
  const technicians = useTechnicianList();
  const [name, setName] = useState(order.technicianName === 'Unassigned' ? '' : order.technicianName);
  const [phone, setPhone] = useState(order.technicianPhone);
  const [checkNote, setCheckNote] = useState('');
  const [noPhoto, setNoPhoto] = useState('');
  const photos = order.photoRefs ?? [];
  // Repair done, verified and closed each need a photo before and after, or a recorded reason.
  const photoWhy = jobPhotoProblem(order);
  const events = (order.fieldEvents ?? []).filter((e) => !e.undoneAt);
  return (
    <div className="space-y-2" data-testid="work-order-detail">
      <div className="flex flex-wrap items-center gap-1.5">
        <TestBadge isTest={order.isTest} />
        <span className="font-mono text-[10px] text-blue-700">{order.id}</span>
        <span className="text-xs font-bold text-slate-900">{order.title}</span>
        <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-blue-800" data-testid="work-order-status">
          {WORK_ORDER_STATUS_LABELS[order.status]}
        </span>
      </div>
      <div className="text-[11px] text-slate-600">
        {order.type} · {order.priority} · {order.technicianName}
        {order.technicianPhone ? ` (${order.technicianPhone})` : ''} · {order.faultId ? `fault ${order.faultId}` : 'no fault'}
      </div>
      {order.notes && <p className="text-[11px] text-slate-700">{order.notes}</p>}
      {!['Verified', 'Closed', 'Cancelled'].includes(order.status) && (
        <div className="flex flex-wrap items-start gap-1.5">
          <TechnicianPicker list={technicians} value={name} onChange={setName} testId="job-assign-name" />
          <input className={`${inputClass} max-w-40`} placeholder="Phone (optional)" value={phone} onChange={(e) => setPhone(e.target.value)} aria-label="Technician phone" data-testid="job-assign-phone" />
          <button
            type="button"
            data-testid="job-assign"
            disabled={
              !name.trim() ||
              (technicians.loginOn && !technicians.names.includes(name.trim())) ||
              (name.trim() === order.technicianName && phone.trim() === order.technicianPhone)
            }
            onClick={() => assign(order.id, name, phone)}
            className={`${buttonClass} border border-slate-300`}
          >
            <UserPlus className="mr-1 inline h-3.5 w-3.5" /> Assign
          </button>
        </div>
      )}
      {(order.steps ?? []).length > 0 && (
        <div className="text-[11px]">
          <div className="font-semibold text-slate-800">Steps</div>
          {order.steps!.map((s) => (
            <div key={s.id} className={s.doneAt ? 'text-emerald-800' : 'text-slate-600'}>
              {s.doneAt ? '✓' : '○'} {s.label}
              {s.doneAt ? ` (${s.doneBy ?? '?'}, ${when(s.doneAt)})` : ''}
            </div>
          ))}
        </div>
      )}
      {photos.length > 0 && (
        <div className="flex flex-wrap gap-2" data-testid="job-photos">
          {photos.map((p) => (
            <figure key={p.photoId} className="w-24 text-center text-[10px] text-slate-600">
              <JobPhoto photoId={p.photoId} className="h-20 w-24 rounded border border-slate-200" />
              <figcaption>
                {p.kind === 'before' ? 'Before' : p.kind === 'after' ? 'After' : p.kind === 'meter' ? 'Meter' : 'Photo'} · {when(p.at)}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
      {(order.materials ?? []).length > 0 && (
        <div className="text-[11px] text-slate-700">
          <span className="font-semibold">Materials (as entered):</span> {order.materials!.map((m) => `${m.quantity} ${m.unit} ${m.item}`).join('; ')}
        </div>
      )}
      {(order.fieldNotes ?? []).map((n) => (
        <div key={n.id} className="text-[11px] text-slate-700">
          Note from {n.by ?? 'field'} ({when(n.at)}): {n.text}
        </div>
      ))}
      {photoWhy && ['Accepted', 'In Progress', 'On Hold', 'Completed'].includes(order.status) && (
        <div className="space-y-1 rounded border border-amber-300 bg-amber-50 p-2 text-[11px]" data-testid="job-photo-needed">
          <div className="text-amber-900">Photos of the repair: {photoWhy}</div>
          <div className="flex flex-wrap gap-1.5">
            <input className={`${inputClass} max-w-72`} placeholder="Why no photo was possible" value={noPhoto} onChange={(e) => setNoPhoto(e.target.value)} aria-label="Why no photo was possible" />
            <button
              type="button"
              disabled={noPhoto.trim().length < 3}
              onClick={() => {
                if (useNetworkStore.getState().runCommand((d, ctx) => recordNoPhotoReason(d, { workOrderId: order.id }, noPhoto, ctx))) setNoPhoto('');
              }}
              className={`${buttonClass} border border-slate-300`}
              data-testid="job-no-photo-reason"
            >
              Record the reason
            </button>
          </div>
        </div>
      )}
      <div className="rounded border border-slate-200 bg-slate-50 p-2 text-[11px]" data-testid="job-verification">
        {order.verification ? (
          <>
            <div className="font-semibold text-emerald-800">Checked: {describeVerification(order.verification)}</div>
            {order.verification.photoId && <JobPhoto photoId={order.verification.photoId} className="mt-1 h-20 w-24 rounded border border-slate-200" />}
          </>
        ) : (
          <div className="space-y-1">
            <div className="text-slate-700">No check yet. It needs a light reading measured in the field (from the phone), a photo, or an office check.</div>
            {order.status !== 'Cancelled' && order.status !== 'Closed' && (
              <div className="flex flex-wrap gap-1.5">
                <input className={`${inputClass} max-w-72`} placeholder="What the office checked" value={checkNote} onChange={(e) => setCheckNote(e.target.value)} aria-label="Office check" />
                <button type="button" disabled={!checkNote.trim()} onClick={() => checkJob(order.id, { method: 'office_check', note: checkNote })} className={`${buttonClass} border border-slate-300`}>
                  <ClipboardCheck className="mr-1 inline h-3.5 w-3.5" /> Record office check
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {(NEXT[order.status] ?? []).map((n) => (
          <button key={n.to} type="button" onClick={() => moveJob(order.id, n.to)} className={`${buttonClass} ${n.to === 'Closed' ? 'bg-emerald-600 text-white' : 'border border-slate-300'}`} data-testid={`job-to-${n.to.replace(' ', '-').toLowerCase()}`}>
            {n.label}
          </button>
        ))}
      </div>
      <details className="text-[11px]">
        <summary className="cursor-pointer font-semibold text-slate-700">History ({(order.history ?? []).length}) · phone events {events.length}</summary>
        <ol className="mt-1 space-y-0.5" data-testid="job-history">
          {(order.history ?? []).map((h, i) => (
            <li key={`${h.at}-${i}`} className="text-slate-600">
              {when(h.at)} · {h.by ?? '?'} · {h.details}
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}

export function JobsTab({ selectedId, onSelect }: { selectedId: string | null; onSelect: (id: string) => void }) {
  const workOrders = useNetworkStore((s) => s.workOrders);
  const [showDone, setShowDone] = useState(false);
  const list = workOrders.filter((w) => showDone || isWorkOrderOpen(w) || w.status === 'Completed' || w.status === 'Verified');
  const selected = workOrders.find((w) => w.id === selectedId) ?? list[0];
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <div className="space-y-1.5">
        <label className="flex items-center gap-1 text-[11px] text-slate-600">
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show closed and cancelled
        </label>
        {list.length === 0 && <p className="text-[11px] text-slate-500">No work orders.</p>}
        {list.map((w) => (
          <button
            key={w.id}
            type="button"
            onClick={() => onSelect(w.id)}
            data-testid="work-order-row"
            className={`w-full rounded-lg border p-2 text-left text-[11px] ${selected?.id === w.id ? 'border-blue-400 bg-blue-50' : 'border-slate-200 bg-white'}`}
          >
            <div className="flex items-center gap-1.5">
              <TestBadge isTest={w.isTest} />
              <span className="font-mono text-[10px] text-blue-700">{w.id}</span>
            </div>
            <div className="font-semibold text-slate-900">{w.title}</div>
            <div className="text-slate-500">
              {w.technicianName} · {WORK_ORDER_STATUS_LABELS[w.status]}
            </div>
          </button>
        ))}
      </div>
      <div className="md:col-span-2">{selected ? <Section title="Work order"><WorkOrderDetail key={selected.id} order={selected} /></Section> : null}</div>
    </div>
  );
}
