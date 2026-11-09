import type { ChangeSet } from '../model/api';
import type { FaultStatus, WorkOrderStatus } from '../model/enums';
import type { MonitoringSource } from '../model/monitoringSchemas';
import type { Alarm, Fault, Verification, WorkOrder } from '../model/types';
import { elementExists, type ImpactData } from './faultImpact';
import type { FiberProblem } from './fiberRules';

/**
 * Checks for alarms, faults and work orders (Phase 8). The browser commands and the server run the
 * same rules (`apps/server/src/lib/linkGuard.ts`). Errors are broken data or a claim with no
 * evidence, and are refused: a device alarm while no OLT is connected, a TEST event not labelled
 * TEST (or a real one labelled TEST), TEST and real alarms in one fault, links to records that do
 * not exist, and a fault or job verified or closed without a verification. Problems already stored
 * are not blamed on a new change.
 */

export type FaultCheckData = ImpactData & {
  faults: readonly Fault[];
  workOrders: readonly WorkOrder[];
  alarms?: readonly Alarm[];
  /** Phase 7: when given, a device alarm must name a real (not TEST) source on record. */
  monitoringSources?: readonly MonitoringSource[];
};

/** Statuses that need a verification first. */
export const FAULT_NEEDS_VERIFICATION: readonly FaultStatus[] = ['Verified', 'Closed'];
export const WORK_ORDER_NEEDS_VERIFICATION: readonly WorkOrderStatus[] = ['Verified', 'Closed'];

/** Faults still needing attention. Older `Resolved` faults count as done. */
export const isFaultOpen = (f: Pick<Fault, 'status'>): boolean => f.status !== 'Verified' && f.status !== 'Closed' && f.status !== 'Resolved';
export const isWorkOrderOpen = (w: Pick<WorkOrder, 'status'>): boolean => !['Completed', 'Verified', 'Closed', 'Cancelled'].includes(w.status);
/** A job a technician still has to do or finish (repair done but no check yet counts). */
export const isJobForField = (w: Pick<WorkOrder, 'status' | 'verification'>): boolean =>
  ['Pending', 'Assigned', 'Accepted', 'In Progress', 'On Hold'].includes(w.status) || (w.status === 'Completed' && !w.verification);

/** Why a verification does not count, in plain words, or null when it is complete. */
export function verificationProblem(v: Verification): string | null {
  if (!v.by?.trim()) return 'Say who checked the repair.';
  switch (v.method) {
    case 'field_reading':
      if (v.readingDbm === undefined) return 'A light reading needs its value.';
      if (v.readingOrigin !== 'field_measured') return 'Only a light reading measured in the field counts as a check.';
      if (!v.photoId) return 'A light reading needs the photo of the meter.';
      return null;
    case 'photo':
      return v.photoId ? null : 'A photo check needs the photo.';
    case 'office_check':
      return v.note?.trim() ? null : 'An office check needs a note of what was checked.';
  }
}

/**
 * A repair is shown by a photo before and a photo after it. When no photo is possible (no light,
 * inside a customer's home, the phone broke) the reason is written down instead: a job note that
 * starts with this text (from the phone or the office), or a fault history line with action
 * `NO_PHOTO`. The reason stays in the record.
 */
export const NO_PHOTO_PREFIX = 'No photo possible: ';
export const NO_PHOTO_ACTION = 'NO_PHOTO';
export const noPhotoReasonText = (reason: string): string => `${NO_PHOTO_PREFIX}${reason.trim()}`;

/** The reason in a "No photo possible: …" text, or '' when it is not one. */
export function noPhotoReasonOf(text: string | undefined): string {
  if (!text || !text.toLowerCase().startsWith(NO_PHOTO_PREFIX.toLowerCase())) return '';
  return text.slice(NO_PHOTO_PREFIX.length).trim();
}

/** Why a job has no proof of the repair, in plain words, or null when it has both photos or a reason. */
export function jobPhotoProblem(w: Pick<WorkOrder, 'photoRefs' | 'fieldNotes'>): string | null {
  if ((w.fieldNotes ?? []).some((n) => noPhotoReasonOf(n.text))) return null;
  const kinds = new Set((w.photoRefs ?? []).map((p) => p.kind));
  const before = kinds.has('before');
  const after = kinds.has('after');
  if (before && after) return null;
  const need = !before && !after ? 'a photo before and a photo after the repair' : !before ? 'a photo before the repair' : 'a photo after the repair';
  return `It needs ${need}, or a note of why no photo was possible.`;
}

/** Why a fault has no proof of the repair, or null: a job of it with both photos (or a reason), or a reason on the fault. */
export function faultPhotoProblem(data: Pick<FaultCheckData, 'workOrders'>, fault: Pick<Fault, 'id' | 'history'>): string | null {
  if ((fault.history ?? []).some((h) => h.action === NO_PHOTO_ACTION && noPhotoReasonOf(h.details))) return null;
  const jobs = data.workOrders.filter((w) => w.faultId === fault.id && w.status !== 'Cancelled');
  if (jobs.some((w) => !jobPhotoProblem(w))) return null;
  return jobs.length === 0
    ? 'It has no work order with a photo before and after the repair. Record why no photo was possible.'
    : 'Its work order has no photo before and after the repair. Take them, or record why no photo was possible.';
}

const DONE: readonly WorkOrderStatus[] = ['Completed', 'Verified', 'Closed'];
/** "done" (repair done) and "checked" (verified or closed) are kept apart, so a step forward is a new check. */
export const jobPhotoStage = (status: WorkOrderStatus): 'done' | 'checked' | null => (status === 'Completed' ? 'done' : DONE.includes(status) ? 'checked' : null);

/** The verification that lets a fault close: its own, or a complete one from one of its jobs. */
export function faultVerificationOf(data: Pick<FaultCheckData, 'workOrders'>, fault: Fault): Verification | undefined {
  if (fault.verification && !verificationProblem(fault.verification)) return fault.verification;
  for (const w of data.workOrders) {
    if (w.faultId === fault.id && w.verification && !verificationProblem(w.verification)) return { ...w.verification, workOrderId: w.id };
  }
  return undefined;
}

export function findFaultProblems(data: FaultCheckData): FiberProblem[] {
  const problems: FiberProblem[] = [];
  const error = (code: string, key: string, message: string, refs: string[]) => problems.push({ severity: 'error', code, key: `${code}:${key}`, message, refs });
  const faults = new Map(data.faults.map((f) => [f.id, f]));
  const alarms = new Map((data.alarms ?? []).map((a) => [a.id, a]));
  const orders = new Map(data.workOrders.map((w) => [w.id, w]));

  for (const a of data.alarms ?? []) {
    if (a.source === 'device_adapter') {
      // Phase 7: only the monitoring ingestion path makes these, always with its source and rows.
      if (!a.monitoringSourceId || !a.evidenceIds?.length) {
        error('alarm_device_not_connected', a.id, `There is no live connection to the OLT for alarm ${a.id}: a device alarm must name its monitoring source and the rows it came from.`, [a.id]);
      } else if (data.monitoringSources) {
        const src = data.monitoringSources.find((s) => s.id === a.monitoringSourceId);
        if (!src || src.isTest) error('alarm_device_bad_source', a.id, `Alarm ${a.id} names monitoring source ${a.monitoringSourceId}, which is not a real source on record.`, [a.id]);
      }
    }
    if ((a.source === 'test') !== a.isTest) {
      error('alarm_test_label', a.id, `Alarm ${a.id}: a TEST event must be marked TEST, and only a TEST event may be.`, [a.id]);
    }
    if (a.state !== 'cleared' && !elementExists(data, a.element)) {
      error('alarm_missing_element', a.id, `Alarm ${a.id} is about ${a.element.type} ${a.element.id}${a.element.ponPortId ? ` port ${a.element.ponPortId}` : ''}${a.element.fiberNumber ? ` fiber ${a.element.fiberNumber}` : ''}, which is not on record.`, [a.id]);
    }
    if (a.faultId && !faults.has(a.faultId)) error('alarm_missing_fault', a.id, `Alarm ${a.id} names fault ${a.faultId}, which is not on record.`, [a.id]);
  }

  for (const f of data.faults) {
    const linked = (f.alarmIds ?? []).map((id) => alarms.get(id));
    const missing = (f.alarmIds ?? []).filter((_, i) => !linked[i]);
    if (missing.length > 0) error('fault_missing_alarm', f.id, `Fault ${f.id} names alarm ${missing[0]}, which is not on record.`, [f.id]);
    const present = linked.filter((a): a is Alarm => !!a);
    if (f.source === 'test' && !f.isTest) error('fault_test_label', f.id, `Fault ${f.id} came from a TEST event, so it must be marked TEST.`, [f.id]);
    if (present.some((a) => a.isTest !== !!f.isTest)) {
      error('fault_test_mix', f.id, `Fault ${f.id}: TEST events and real alarms cannot be in one fault.`, [f.id]);
    }
    if (f.workOrderId && !orders.has(f.workOrderId)) error('fault_missing_work_order', f.id, `Fault ${f.id} names work order ${f.workOrderId}, which is not on record.`, [f.id]);
    if (f.verification) {
      const why = verificationProblem(f.verification);
      if (why) error('fault_bad_verification', f.id, `Fault ${f.id}: ${why}`, [f.id]);
    }
    if (FAULT_NEEDS_VERIFICATION.includes(f.status) && !faultVerificationOf(data, f)) {
      error(
        'fault_closed_unverified',
        f.id,
        `Fault ${f.id} cannot be ${f.status === 'Closed' ? 'closed' : 'marked verified'} without a check: a light reading measured in the field, a photo, or an office check.`,
        [f.id],
      );
    }
    if (FAULT_NEEDS_VERIFICATION.includes(f.status)) {
      const why = faultPhotoProblem(data, f);
      if (why) error('fault_closed_no_photo', f.id, `Fault ${f.id} cannot be ${f.status === 'Closed' ? 'closed' : 'marked verified'} yet. ${why}`, [f.id]);
    }
    // `Resolved` predates verification. Writing it now would skip the check.
    if (f.status === 'Resolved') {
      error('fault_resolved_without_check', f.id, `Fault ${f.id}: "Resolved" is no longer used. Close it with a check instead.`, [f.id]);
    }
  }

  for (const w of data.workOrders) {
    const fault = w.faultId ? faults.get(w.faultId) : undefined;
    if (w.faultId && !fault) error('wo_missing_fault', w.id, `Work order ${w.id} names fault ${w.faultId}, which is not on record.`, [w.id]);
    if (fault?.isTest && !w.isTest) error('wo_test_label', w.id, `Work order ${w.id} is for a TEST fault, so it must be marked TEST.`, [w.id, fault.id]);
    if (w.verification) {
      const why = verificationProblem(w.verification);
      if (why) error('wo_bad_verification', w.id, `Work order ${w.id}: ${why}`, [w.id]);
    }
    if (WORK_ORDER_NEEDS_VERIFICATION.includes(w.status) && (!w.verification || verificationProblem(w.verification))) {
      error(
        'wo_closed_unverified',
        w.id,
        `Work order ${w.id} cannot be ${w.status === 'Closed' ? 'closed' : 'marked verified'} without a check: a light reading measured in the field, a photo, or an office check.`,
        [w.id],
      );
    }
    const stage = jobPhotoStage(w.status);
    const photoWhy = stage ? jobPhotoProblem(w) : null;
    if (stage && photoWhy) {
      // Keyed by stage: an older job already done without photos still saves, but moving it on is a new check.
      error('wo_done_no_photo', `${w.id}:${stage}`, `Work order ${w.id} cannot be ${stage === 'done' ? 'marked repair done' : w.status === 'Closed' ? 'closed' : 'marked verified'} yet. ${photoWhy}`, [w.id]);
    }
  }
  return problems;
}

export interface FaultChangeCheck {
  errors: FiberProblem[];
}

/** Problems a change adds. Problems already in the data are not blamed on it. */
export function newFaultProblems(before: FaultCheckData, after: FaultCheckData): FaultChangeCheck {
  const old = new Set(findFaultProblems(before).map((p) => p.key));
  return { errors: findFaultProblems(after).filter((p) => p.severity === 'error' && !old.has(p.key)) };
}

const FAULT_CHECKED = ['alarms', 'faults', 'workOrders'] as const;

/** Whether a change set writes or deletes an alarm, a fault or a work order. */
export function changeSetTouchesFaults(changes: ChangeSet): boolean {
  return FAULT_CHECKED.some((name) => (changes.upserts?.[name]?.length ?? 0) > 0 || (changes.deletes?.[name]?.length ?? 0) > 0);
}

/** Errors a change set would add to the stored alarms, faults and work orders. Used by the server. */
export function checkChangeSetFaults(current: FaultCheckData, changes: ChangeSet): FiberProblem[] {
  const after: Record<string, unknown> = { ...current };
  for (const name of FAULT_CHECKED) {
    const byId = new Map(((current[name] ?? []) as unknown as { id: string }[]).map((r) => [r.id, r]));
    for (const id of changes.deletes?.[name] ?? []) byId.delete(id);
    for (const record of (changes.upserts?.[name] ?? []) as { id: string }[]) byId.set(record.id, record);
    after[name] = [...byId.values()];
  }
  return newFaultProblems(current, after as unknown as FaultCheckData).errors;
}
