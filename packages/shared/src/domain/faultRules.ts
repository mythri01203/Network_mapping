import type { ChangeSet } from '../model/api';
import type { FaultStatus, WorkOrderStatus } from '../model/enums';
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
      error('alarm_device_not_connected', a.id, `There is no live connection to the OLT yet, so alarm ${a.id} cannot be stored as a device alarm.`, [a.id]);
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
