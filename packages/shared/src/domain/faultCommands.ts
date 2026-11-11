import type { AlarmKind, AlarmSource, FaultStatus, FaultType, JobPhotoKind, Severity, WorkOrderStatus, WorkOrderType } from '../model/enums';
import { ALARM_KIND_LABELS, FAULT_STATUS_LABELS, WORK_ORDER_STATUS_LABELS } from '../model/enums';
import type { Alarm, Fault, HistoryEntry, JobEvent, NetworkElementRef, SuspectedCause, Verification, WorkOrder } from '../model/types';
import { applyPatch, type AuditEntry, type CommandContext, type CommandResult, fail, networkAnchor, type NetworkData, type NetworkPatch, type Notice, notice, succeed } from './command';
import { affectedByElement, buildImpactIndex, elementExists, elementKey, elementLabel, elementLocation, type ImpactData, type ImpactIndex } from './faultImpact';
import {
  type FaultCheckData,
  faultPhotoProblem,
  faultVerificationOf,
  isFaultOpen,
  jobPhotoProblem,
  jobPhotoStage,
  newFaultProblems,
  NO_PHOTO_ACTION,
  noPhotoReasonText,
  verificationProblem,
} from './faultRules';
import { describeFiberProblems } from './fiberRules';
import { photoUrl } from './fieldCapture';
import { randomCode } from './fieldCapture';
import { formatTimestamp, isoDate } from './time';

/**
 * Alarms, faults and work orders (Phase 8). Every id is random, so two offline devices never make
 * the same one. Every step is kept in the record's history with who and when. A fault or job is
 * verified and closed only with a check (a light reading measured in the field, a photo, or an
 * office check). Nothing here claims a cause: a fault opened from alarms keeps the suspicion and
 * its evidence as shown, and who is affected comes from recorded paths only.
 */

export const newAlarmId = (): string => `ALM-${randomCode(10)}`;
export const newFaultId = (): string => `FLT-${randomCode(10)}`;
export const newWorkOrderId = (): string => `WO-${randomCode(10)}`;
export const newJobPartId = (prefix: 'STP' | 'MAT' | 'NTE' | 'EVT'): string => `${prefix}-${randomCode(10)}`;

const nowIso = (ctx: CommandContext) => (ctx.now ?? new Date()).toISOString();
const actorOf = (ctx: CommandContext, by?: string) => by?.trim() || ctx.actor || 'Unknown';

const line = (action: string, details: string, ctx: CommandContext, by?: string): HistoryEntry => ({
  at: nowIso(ctx),
  by: actorOf(ctx, by),
  action: action.slice(0, 60),
  details: details.slice(0, 500),
});

const replace = <T extends { id: string }>(list: readonly T[], item: T): T[] => list.map((x) => (x.id === item.id ? item : x));

const faultDataOf = (data: NetworkData): FaultCheckData => ({
  equipment: data.equipment,
  cables: data.cables,
  splitters: data.splitters,
  closures: data.closures,
  customers: data.customers,
  spans: data.spans ?? [],
  attachments: data.attachments ?? [],
  onts: data.onts ?? [],
  services: data.services ?? [],
  // Cable TV customers are found through recorded RF links, not the PON path (Phase 6).
  rfElements: data.rfElements ?? [],
  rfLinks: data.rfLinks ?? [],
  faults: data.faults,
  workOrders: data.workOrders,
  alarms: data.alarms ?? [],
});

/** Runs the fault rules on a proposed patch. Errors refuse it; there are no warnings here. */
function checked<T>(data: NetworkData, patch: NetworkPatch, value: T, extras: { notice?: Notice; audit: AuditEntry[] }): CommandResult<T> {
  const { errors } = newFaultProblems(faultDataOf(data), faultDataOf(applyPatch(data, patch)));
  if (errors.length > 0) return fail('Not saved', `${describeFiberProblems(errors)} Nothing was saved.`);
  return succeed(value, patch, extras);
}

const impactDataOf = (data: NetworkData): ImpactData => faultDataOf(data);

/* ------------------------------------------------------------------ */
/* Alarms                                                              */
/* ------------------------------------------------------------------ */

export interface AlarmDraft {
  kind: AlarmKind;
  source: Exclude<AlarmSource, 'device_adapter'> | AlarmSource;
  element: NetworkElementRef;
  severity?: Severity;
  note?: string;
  reportedBy?: string;
  id?: string;
  /** Phase 7: the monitoring source and the rows behind a device (or simulator TEST) alarm. */
  monitoringSourceId?: string;
  evidenceIds?: string[];
}

const DEFAULT_SEVERITY: Record<AlarmKind, Severity> = {
  ont_los: 'High',
  ont_offline: 'High',
  low_power: 'Medium',
  pon_port_fault: 'High',
  olt_unreachable: 'Critical',
  damage_reported: 'High',
  hazard_reported: 'Critical',
  other: 'Medium',
};

const NO_LIVE = 'Device alarms come only from a monitoring source, through Live status (file import or push). Report what you saw as a person, or make a TEST event.';

/**
 * `fromMonitoring` is set only by `raiseMonitoringAlarms`, which the server runs for rows that came
 * through the monitoring ingestion path. Every other caller gets "No live connection" for a device alarm.
 */
export function addAlarm(alarms: Alarm[], data: NetworkData, draft: AlarmDraft, ctx: CommandContext, fromMonitoring = false): { alarms: Alarm[]; alarm: Alarm; repeated: boolean } | string {
  if (draft.source === 'device_adapter' && !fromMonitoring) return NO_LIVE;
  const evidence = draft.evidenceIds?.length ? { evidenceIds: draft.evidenceIds.slice(-20) } : {};
  const monitoring = draft.monitoringSourceId ? { monitoringSourceId: draft.monitoringSourceId, ...evidence } : {};
  if (!elementExists(impactDataOf(data), draft.element)) return `${elementLabel(impactDataOf(data), draft.element)} is not on record.`;
  const isTest = draft.source === 'test';
  const at = nowIso(ctx);
  const key = elementKey(draft.element);
  const open = alarms.find((a) => a.state !== 'cleared' && a.kind === draft.kind && a.isTest === isTest && elementKey(a.element) === key);
  if (open) {
    const alarm: Alarm = {
      ...open,
      lastSeenAt: at,
      occurrences: open.occurrences + 1,
      ...(draft.monitoringSourceId ? { monitoringSourceId: open.monitoringSourceId ?? draft.monitoringSourceId, evidenceIds: [...(open.evidenceIds ?? []), ...(draft.evidenceIds ?? [])].slice(-20) } : {}),
      history: [...(open.history ?? []), line('REPORTED_AGAIN', `${isTest ? 'TEST: ' : ''}${ALARM_KIND_LABELS[draft.kind]} reported again${draft.note ? `: ${draft.note}` : ''}`, ctx, draft.reportedBy)],
    };
    return { alarms: replace(alarms, alarm), alarm, repeated: true };
  }
  const alarm: Alarm = {
    id: draft.id ?? newAlarmId(),
    kind: draft.kind,
    source: draft.source,
    isTest,
    severity: draft.severity ?? DEFAULT_SEVERITY[draft.kind],
    state: 'active',
    element: draft.element,
    firstSeenAt: at,
    lastSeenAt: at,
    occurrences: 1,
    ...(draft.note?.trim() ? { note: draft.note.trim().slice(0, 1000) } : {}),
    reportedBy: actorOf(ctx, draft.reportedBy),
    ...monitoring,
    history: [line('RAISED', `${isTest ? 'TEST: ' : ''}${ALARM_KIND_LABELS[draft.kind]} on ${elementLabel(impactDataOf(data), draft.element)}`, ctx, draft.reportedBy)],
  };
  return { alarms: [alarm, ...alarms], alarm, repeated: false };
}

/** Records one alarm. The same alarm still open is counted again rather than duplicated. */
export function raiseAlarm(data: NetworkData, draft: AlarmDraft, ctx: CommandContext = {}): CommandResult<Alarm> {
  const result = addAlarm(data.alarms ?? [], data, draft, ctx);
  if (typeof result === 'string') return fail(draft.source === 'device_adapter' ? 'No live connection' : 'Not saved', result);
  const { alarm, repeated } = result;
  return checked(data, { alarms: result.alarms }, alarm, {
    notice: notice(alarm.isTest ? 'info' : 'warning', repeated ? 'Alarm reported again' : alarm.isTest ? 'TEST event made' : 'Alarm recorded', `${alarm.isTest ? 'TEST: ' : ''}${ALARM_KIND_LABELS[alarm.kind]} on ${elementLabel(impactDataOf(data), alarm.element)}.`),
    audit: [{ action: repeated ? 'ALARM_REPEATED' : 'ALARM_RAISED', details: `${alarm.isTest ? 'TEST ' : ''}${alarm.kind} ${alarm.id} on ${elementKey(alarm.element)} (${alarm.source})`, assetId: alarm.id, assetType: 'Alarm' }],
  });
}

/**
 * Makes a clearly labelled TEST event: one alarm per chosen element, all `source: 'test'`. They are
 * shown as TEST everywhere and left out of reports unless asked for.
 */
export function raiseTestEvent(data: NetworkData, input: { kind: AlarmKind; elements: NetworkElementRef[]; note?: string }, ctx: CommandContext = {}): CommandResult<Alarm[]> {
  if (input.elements.length === 0) return fail('Nothing chosen', 'Choose at least one customer or element for the TEST event.');
  let alarms = data.alarms ?? [];
  const made: Alarm[] = [];
  for (const element of input.elements) {
    const result = addAlarm(alarms, data, { kind: input.kind, source: 'test', element, note: input.note ?? 'TEST event' }, ctx);
    if (typeof result === 'string') return fail('Not saved', result);
    alarms = result.alarms;
    made.push(result.alarm);
  }
  return checked(data, { alarms }, made, {
    notice: notice('info', 'TEST event made', `${made.length} TEST alarm(s): ${ALARM_KIND_LABELS[input.kind]}. They are marked TEST everywhere and left out of reports.`),
    audit: [{ action: 'TEST_EVENT', details: `TEST ${input.kind} on ${made.length} element(s): ${made.map((a) => elementKey(a.element)).join(', ').slice(0, 400)}`, assetId: made[0].id, assetType: 'Alarm' }],
  });
}

export function acknowledgeAlarms(data: NetworkData, ids: string[], ctx: CommandContext = {}): CommandResult<number> {
  const at = nowIso(ctx);
  let count = 0;
  const alarms = (data.alarms ?? []).map((a) => {
    if (!ids.includes(a.id) || a.state !== 'active') return a;
    count += 1;
    return { ...a, state: 'acknowledged' as const, acknowledgedAt: at, acknowledgedBy: actorOf(ctx), history: [...(a.history ?? []), line('ACKNOWLEDGED', 'Seen by the office', ctx)] };
  });
  if (count === 0) return fail('Nothing to acknowledge', 'These alarms are already acknowledged or cleared.', 'info');
  return checked(data, { alarms }, count, {
    notice: notice('success', 'Acknowledged', `${count} alarm(s) acknowledged.`),
    audit: [{ action: 'ALARM_ACKNOWLEDGED', details: ids.join(', ').slice(0, 400), assetId: ids[0], assetType: 'Alarm' }],
  });
}

export function clearAlarms(data: NetworkData, ids: string[], note: string, ctx: CommandContext = {}): CommandResult<number> {
  const at = nowIso(ctx);
  let count = 0;
  const alarms = (data.alarms ?? []).map((a) => {
    if (!ids.includes(a.id) || a.state === 'cleared') return a;
    count += 1;
    return { ...a, state: 'cleared' as const, clearedAt: at, clearedBy: actorOf(ctx), history: [...(a.history ?? []), line('CLEARED', note || 'Cleared by the office', ctx)] };
  });
  if (count === 0) return fail('Nothing to clear', 'These alarms are already cleared.', 'info');
  return checked(data, { alarms }, count, {
    notice: notice('success', 'Cleared', `${count} alarm(s) cleared. They stay in the history.`),
    audit: [{ action: 'ALARM_CLEARED', details: `${ids.join(', ').slice(0, 300)}${note ? `: ${note}` : ''}`, assetId: ids[0], assetType: 'Alarm' }],
  });
}

/* ------------------------------------------------------------------ */
/* Faults                                                              */
/* ------------------------------------------------------------------ */

export interface FaultOpenDraft {
  element: NetworkElementRef;
  alarmIds?: string[];
  /** The suspicion as the office saw it, kept unchanged on the fault. */
  suspected?: Omit<SuspectedCause, 'computedAt'>;
  title?: string;
  type?: FaultType;
  severity?: Severity;
  description?: string;
  source?: Exclude<AlarmSource, 'device_adapter'>;
  /** Reuse a built index; otherwise one is built from the data. */
  index?: ImpactIndex;
}

const TYPE_FOR_KIND: Record<AlarmKind, FaultType> = {
  ont_los: 'Customer Disconnection',
  ont_offline: 'Customer Disconnection',
  low_power: 'Low Optical Signal',
  pon_port_fault: 'Port Failure',
  olt_unreachable: 'Equipment Failure',
  damage_reported: 'Cable Damage',
  hazard_reported: 'Safety Hazard',
  other: 'Equipment Failure',
};

/**
 * Opens a fault for an element, usually from a suspected cause. Who is affected is worked out from
 * recorded paths now and stored; customers whose path is incomplete are kept apart.
 */
export function openFault(data: NetworkData, draft: FaultOpenDraft, ctx: CommandContext = {}): CommandResult<Fault> {
  const impactData = impactDataOf(data);
  if (!elementExists(impactData, draft.element)) return fail('Not on record', `${elementLabel(impactData, draft.element)} is not on record.`);
  const alarmById = new Map((data.alarms ?? []).map((a) => [a.id, a]));
  const alarms = (draft.alarmIds ?? []).map((id) => alarmById.get(id));
  if (alarms.some((a) => !a)) return fail('Alarm missing', 'One of the alarms is no longer on record. Refresh and try again.');
  const linked = alarms as Alarm[];
  const tests = new Set(linked.map((a) => a.isTest));
  if (tests.size > 1) return fail('Not saved', 'TEST events and real alarms cannot be in one fault.');
  const isTest = linked.length > 0 ? linked[0].isTest : draft.source === 'test';
  const already = linked.find((a) => a.faultId && data.faults.some((f) => f.id === a.faultId && isFaultOpen(f)));
  if (already) return fail('Already open', `Alarm ${already.id} is already in fault ${already.faultId}. Open that fault instead.`, 'info');

  const ix = draft.index ?? buildImpactIndex(impactData, ctx.optical);
  const impact = affectedByElement(ix, draft.element);
  const label = impact.label;
  const at = nowIso(ctx);
  const location = elementLocation(impactData, draft.element);
  const anchor = location ? undefined : networkAnchor(data, ctx.fallbackLocation);
  const kind = linked[0]?.kind;
  const type = draft.type ?? (kind ? TYPE_FOR_KIND[kind] : 'Equipment Failure');
  const fault: Fault = {
    id: newFaultId(),
    title: draft.title?.trim() || `${isTest ? 'TEST: ' : ''}Suspected fault at ${label}`,
    type,
    severity: draft.severity ?? (impact.affected.length > 1 ? 'High' : 'Medium'),
    status: 'Reported',
    affectedLocation: location ?? { lat: anchor?.[0] ?? 0, lng: anchor?.[1] ?? 0 },
    ...(location ? {} : { locationMethod: 'not_placed' as const, officeMustPlace: true }),
    ...(draft.element.type === 'cable' || draft.element.type === 'core' ? { affectedCableId: draft.element.id } : {}),
    ...(draft.element.type === 'equipment' || draft.element.type === 'olt' || draft.element.type === 'pon_port' ? { affectedEquipmentId: draft.element.id } : {}),
    affectedCustomerIds: impact.affected.map((c) => c.customerId),
    mayBeAffectedCustomerIds: impact.mayBeAffected.map((c) => c.customerId),
    affectedCores: draft.element.type === 'core' && draft.element.fiberNumber ? [draft.element.fiberNumber] : [],
    affectedSplitterPorts: [],
    description:
      draft.description?.trim() ||
      `${linked.length > 0 ? `Opened from ${linked.length} alarm(s). ` : ''}Suspected element: ${label}. This is a suspicion from recorded paths, not proof: check on site.`,
    reportedAt: formatTimestamp(ctx.now),
    images: [],
    source: isTest ? 'test' : (draft.source ?? (linked[0]?.source === 'field_report' ? 'field_report' : 'manual')),
    isTest,
    element: draft.element,
    ...(linked.length > 0 ? { alarmIds: linked.map((a) => a.id) } : {}),
    ...(draft.suspected ? { suspected: { ...draft.suspected, computedAt: at } } : {}),
    history: [
      line(
        'RAISED',
        `${isTest ? 'TEST. ' : ''}Opened for ${label}: ${impact.affected.length} customer(s) on recorded paths, ${impact.mayBeAffected.length} may be affected (path not fully recorded)${draft.suspected ? `, confidence ${draft.suspected.confidence}` : ''}.`,
        ctx,
      ),
    ],
  };
  const alarmsPatch = linked.length > 0 ? (data.alarms ?? []).map((a) => (draft.alarmIds!.includes(a.id) ? { ...a, faultId: fault.id, history: [...(a.history ?? []), line('IN_FAULT', `Added to fault ${fault.id}`, ctx)] } : a)) : undefined;
  return checked(data, { faults: [fault, ...data.faults], ...(alarmsPatch ? { alarms: alarmsPatch } : {}) }, fault, {
    notice: notice(isTest ? 'info' : 'warning', isTest ? 'TEST fault opened' : 'Fault opened', `${fault.id}: ${impact.affected.length} customer(s) affected on recorded paths${impact.mayBeAffected.length ? `, ${impact.mayBeAffected.length} may be affected` : ''}.`),
    audit: [{ action: 'FAULT_OPENED', details: `${isTest ? 'TEST ' : ''}${fault.id} for ${elementKey(draft.element)} (${impact.affected.length} affected, ${impact.mayBeAffected.length} may be)`, assetId: fault.id, assetType: 'Fault' }],
  });
}

const STAGE: Partial<Record<FaultStatus, number>> = {
  Reported: 0,
  Acknowledged: 1,
  Investigating: 1,
  Assigned: 2,
  Dispatched: 2,
  'In Repair': 3,
  'In Progress': 3,
  Repaired: 4,
  Verified: 5,
  Closed: 6,
  Resolved: 6,
};

export const faultStageIndex = (status: FaultStatus): number => STAGE[status] ?? -1;

/**
 * Moves a fault on. Verified and Closed need a check (the fault's own, or one of its jobs');
 * closing also clears its open alarms and closes its verified jobs. On Hold keeps the step to
 * return to. A closed fault does not change: open a new one.
 */
export function setFaultStatus(data: NetworkData, faultId: string, to: FaultStatus, opts: { note?: string } = {}, ctx: CommandContext = {}): CommandResult<Fault> {
  const fault = data.faults.find((f) => f.id === faultId);
  if (!fault) return fail('Fault missing', `Fault ${faultId} was not found.`);
  if (fault.status === to) return succeed(fault, {});
  if (fault.status === 'Closed' || fault.status === 'Resolved') return fail('Closed', `${faultId} is closed. Open a new fault if the problem came back.`, 'info');
  if (to === 'Resolved' || to === 'Investigating' || to === 'Dispatched' || to === 'In Progress') return fail('Not used', `"${to}" is an older status. Use the steps shown instead.`);
  if (to === 'Reported') return fail('Not allowed', 'A fault cannot go back to Raised. Put it on hold, or close it with a check.');
  const at = nowIso(ctx);
  const by = actorOf(ctx);
  const note = opts.note?.trim();
  const verification = faultVerificationOf(faultDataOf(data), fault);
  if ((to === 'Verified' || to === 'Closed') && !verification) {
    return fail('Check needed', `${faultId} cannot be ${to === 'Closed' ? 'closed' : 'marked verified'} yet. Record a check first: a light reading measured in the field, a photo, or an office check.`);
  }
  // Verified to Closed is the same step for photos, so an older verified fault still closes.
  const photoWhy = (to === 'Verified' || to === 'Closed') && fault.status !== 'Verified' ? faultPhotoProblem(faultDataOf(data), fault) : null;
  if (photoWhy) return fail('Photos needed', `${faultId} cannot be ${to === 'Closed' ? 'closed' : 'marked verified'} yet. ${photoWhy}`);
  if (to === 'Assigned' && !data.workOrders.some((w) => w.faultId === faultId && w.technicianName && w.technicianName !== 'Unassigned')) {
    return fail('Make a work order', 'Assign the fault by making a work order for a technician.');
  }
  let updated: Fault = {
    ...fault,
    status: to,
    ...(fault.status === 'On Hold' ? { heldFrom: undefined } : {}),
    ...(to === 'On Hold' ? { heldFrom: fault.status } : {}),
    ...(to === 'Acknowledged' && !fault.acknowledgedAt ? { acknowledgedAt: at, acknowledgedBy: by } : {}),
    ...(to === 'Repaired' && !fault.repairedAt ? { repairedAt: at } : {}),
    history: [...(fault.history ?? []), line('STATUS', `${FAULT_STATUS_LABELS[fault.status]} → ${FAULT_STATUS_LABELS[to]}${note ? `: ${note}` : ''}`, ctx)],
  };
  if ((to === 'Verified' || to === 'Closed') && verification) {
    updated = {
      ...updated,
      ...(fault.verification ? {} : { verification }),
      verifiedAt: fault.verifiedAt ?? at,
      verifiedBy: fault.verifiedBy ?? verification.by,
    };
  }
  const patch: NetworkPatch = {};
  if (to === 'Closed') {
    updated = { ...updated, closedAt: at, closedBy: by, resolvedAt: formatTimestamp(ctx.now), ...(note ? { resolution: note } : {}) };
    const alarmIds = new Set(fault.alarmIds ?? []);
    if (alarmIds.size > 0) {
      patch.alarms = (data.alarms ?? []).map((a) =>
        alarmIds.has(a.id) && a.state !== 'cleared'
          ? { ...a, state: 'cleared' as const, clearedAt: at, clearedBy: by, history: [...(a.history ?? []), line('CLEARED', `Fault ${faultId} closed`, ctx)] }
          : a,
      );
    }
    const jobs = data.workOrders.filter((w) => w.faultId === faultId && w.status === 'Verified');
    if (jobs.length > 0) {
      patch.workOrders = data.workOrders.map((w) =>
        jobs.includes(w) ? { ...w, status: 'Closed' as const, closedAt: at, closedBy: by, history: [...(w.history ?? []), line('STATUS', `Verified → Closed with fault ${faultId}`, ctx)] } : w,
      );
    }
  }
  if (to === 'Acknowledged' && (fault.alarmIds?.length ?? 0) > 0) {
    patch.alarms = (data.alarms ?? []).map((a) =>
      fault.alarmIds!.includes(a.id) && a.state === 'active' ? { ...a, state: 'acknowledged' as const, acknowledgedAt: at, acknowledgedBy: by } : a,
    );
  }
  patch.faults = replace(data.faults, updated);
  return checked(data, patch, updated, {
    notice: notice('success', 'Fault updated', `${faultId}: ${FAULT_STATUS_LABELS[to]}.`),
    audit: [{ action: 'FAULT_STATUS', details: `${faultId}: ${fault.status} → ${to}${note ? ` (${note})` : ''}`, assetId: faultId, assetType: 'Fault' }],
  });
}

/** Resumes a fault on hold at the step it was on. */
export function resumeFault(data: NetworkData, faultId: string, ctx: CommandContext = {}): CommandResult<Fault> {
  const fault = data.faults.find((f) => f.id === faultId);
  if (!fault || fault.status !== 'On Hold') return fail('Not on hold', `${faultId} is not on hold.`, 'info');
  return setFaultStatus(data, faultId, fault.heldFrom && fault.heldFrom !== 'On Hold' ? fault.heldFrom : 'Acknowledged', { note: 'Resumed' }, ctx);
}

export type VerificationInput = Omit<Verification, 'at' | 'by' | 'workOrderId'> & { by?: string };

/** Records the check for a fault (usually an office check) and marks it verified. */
export function recordFaultVerification(data: NetworkData, faultId: string, input: VerificationInput, ctx: CommandContext = {}): CommandResult<Fault> {
  const fault = data.faults.find((f) => f.id === faultId);
  if (!fault) return fail('Fault missing', `Fault ${faultId} was not found.`);
  if (fault.status === 'Closed' || fault.status === 'Resolved') return fail('Closed', `${faultId} is closed.`, 'info');
  const verification: Verification = { ...input, at: nowIso(ctx), by: actorOf(ctx, input.by) };
  const why = verificationProblem(verification);
  if (why) return fail('Check not complete', why);
  const photoWhy = fault.status === 'Verified' ? null : faultPhotoProblem(faultDataOf(data), fault);
  if (photoWhy) return fail('Photos needed', `${faultId} cannot be marked verified yet. ${photoWhy}`);
  const updated: Fault = {
    ...fault,
    verification,
    status: 'Verified',
    verifiedAt: verification.at,
    verifiedBy: verification.by,
    history: [...(fault.history ?? []), line('VERIFIED', describeVerification(verification), ctx)],
  };
  return checked(data, { faults: replace(data.faults, updated) }, updated, {
    notice: notice('success', 'Check recorded', `${faultId} is verified. Close it when you are ready.`),
    audit: [{ action: 'FAULT_VERIFIED', details: `${faultId}: ${describeVerification(verification)}`, assetId: faultId, assetType: 'Fault' }],
  });
}

/** One line for a check, for histories and screens. */
export function describeVerification(v: Verification): string {
  switch (v.method) {
    case 'field_reading':
      return `Light reading ${v.readingDbm} dBm measured in the field${v.customerId ? ` at customer ${v.customerId}` : ''}, with the meter photo, by ${v.by}`;
    case 'photo':
      return `Photo check by ${v.by}${v.note ? `: ${v.note}` : ''}`;
    case 'office_check':
      return `Office check by ${v.by}: ${v.note ?? ''}`;
  }
}

/* ------------------------------------------------------------------ */
/* Work orders                                                         */
/* ------------------------------------------------------------------ */

export interface JobDraft {
  title: string;
  type?: WorkOrderType;
  priority?: Severity;
  faultId?: string;
  technicianName?: string;
  technicianPhone?: string;
  steps?: string[];
  equipmentId?: string;
  cableId?: string;
  customerId?: string;
  scheduledDate?: string;
  notes?: string;
}

/** Where a job for a fault should send the technician, from the fault's own element. */
function placeForFault(data: NetworkData, fault: Fault): Pick<WorkOrder, 'equipmentId' | 'cableId' | 'customerId'> {
  const el = fault.element;
  if (!el) return { equipmentId: fault.affectedEquipmentId, cableId: fault.affectedCableId };
  switch (el.type) {
    case 'equipment':
    case 'olt':
    case 'pon_port':
      return { equipmentId: el.id };
    case 'splitter':
      return { equipmentId: data.splitters.find((s) => s.id === el.id)?.terminalBoxId };
    case 'closure':
      return { equipmentId: data.closures.find((c) => c.id === el.id)?.equipmentId };
    case 'cable':
    case 'core':
      return { cableId: el.id };
    case 'customer':
      return { customerId: el.id };
    case 'ont':
      return { customerId: data.customers.find((c) => c.ontId === el.id)?.id };
    case 'span':
      return {};
  }
}

/** Makes a work order, from a fault or on its own, with a random id. */
export function createJob(data: NetworkData, draft: JobDraft, ctx: CommandContext = {}): CommandResult<WorkOrder> {
  const title = draft.title.trim();
  if (!title) return fail('Missing title', 'A work order needs a title.');
  const fault = draft.faultId ? data.faults.find((f) => f.id === draft.faultId) : undefined;
  if (draft.faultId && !fault) return fail('Fault missing', `Fault ${draft.faultId} was not found.`);
  if (fault && !isFaultOpen(fault)) return fail('Fault closed', `${fault.id} is already ${fault.status.toLowerCase()}.`, 'info');
  if (draft.equipmentId && !data.equipment.some((e) => e.id === draft.equipmentId)) return fail('Not on record', `${draft.equipmentId} is not on record.`);
  if (draft.cableId && !data.cables.some((c) => c.id === draft.cableId)) return fail('Not on record', `${draft.cableId} is not on record.`);
  if (draft.customerId && !data.customers.some((c) => c.id === draft.customerId)) return fail('Not on record', `${draft.customerId} is not on record.`);
  const at = nowIso(ctx);
  const technician = draft.technicianName?.trim();
  const place = fault ? placeForFault(data, fault) : {};
  const order: WorkOrder = {
    id: newWorkOrderId(),
    title: fault?.isTest && !title.startsWith('TEST') ? `TEST: ${title}` : title,
    type: draft.type ?? 'Repair',
    priority: draft.priority ?? fault?.severity ?? 'Medium',
    status: technician ? 'Assigned' : 'Pending',
    technicianName: technician || 'Unassigned',
    technicianPhone: draft.technicianPhone?.trim() ?? '',
    equipmentId: draft.equipmentId ?? place.equipmentId,
    cableId: draft.cableId ?? place.cableId,
    customerId: draft.customerId ?? place.customerId,
    faultId: fault?.id,
    scheduledDate: draft.scheduledDate || isoDate(ctx.now),
    notes: draft.notes?.trim() ?? '',
    photos: [],
    ...(fault?.isTest ? { isTest: true } : {}),
    steps: (draft.steps ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 50).map((label) => ({ id: newJobPartId('STP'), label })),
    photoRefs: [],
    materials: [],
    fieldNotes: [],
    fieldEvents: [],
    createdAt: at,
    ...(technician ? { assignedAt: at } : {}),
    history: [line('CREATED', `${fault ? `For fault ${fault.id}. ` : ''}${technician ? `Assigned to ${technician}.` : 'Not assigned yet.'}`, ctx)],
  };
  const patch: NetworkPatch = { workOrders: [order, ...data.workOrders] };
  if (fault) {
    const toAssigned = technician && faultStageIndex(fault.status) < faultStageIndex('Assigned') && fault.status !== 'On Hold';
    patch.faults = replace(data.faults, {
      ...fault,
      workOrderId: fault.workOrderId ?? order.id,
      ...(technician ? { assignedTechnician: technician } : {}),
      ...(toAssigned ? { status: 'Assigned' as const } : {}),
      history: [...(fault.history ?? []), line('WORK_ORDER', `Work order ${order.id} made${technician ? ` for ${technician}` : ''}${toAssigned ? '; fault assigned' : ''}`, ctx)],
    });
  }
  return checked(data, patch, order, {
    notice: notice('success', 'Work order made', `${order.id}: ${order.title}${technician ? `, for ${technician}` : ''}.`),
    audit: [{ action: 'WORK_ORDER_CREATED', details: `${order.isTest ? 'TEST ' : ''}${order.type} ${order.id}${fault ? ` for ${fault.id}` : ''}`, assetId: order.id, assetType: 'WorkOrder' }],
  });
}

/** Gives a job to a technician, or to another one. */
export function assignJob(data: NetworkData, workOrderId: string, technicianName: string, technicianPhone: string, ctx: CommandContext = {}): CommandResult<WorkOrder> {
  const order = data.workOrders.find((w) => w.id === workOrderId);
  if (!order) return fail('Work order missing', `${workOrderId} was not found.`);
  const name = technicianName.trim();
  if (!name) return fail('Name needed', 'Type the technician\'s name.');
  if (['Verified', 'Closed', 'Cancelled'].includes(order.status)) return fail('Finished', `${workOrderId} is ${order.status.toLowerCase()}.`, 'info');
  const at = nowIso(ctx);
  const updated: WorkOrder = {
    ...order,
    technicianName: name,
    technicianPhone: technicianPhone.trim(),
    status: order.status === 'Pending' ? 'Assigned' : order.status,
    assignedAt: at,
    history: [...(order.history ?? []), line('ASSIGNED', `Assigned to ${name}${order.technicianName && order.technicianName !== 'Unassigned' && order.technicianName !== name ? ` (was ${order.technicianName})` : ''}`, ctx)],
  };
  const patch: NetworkPatch = { workOrders: replace(data.workOrders, updated) };
  const fault = order.faultId ? data.faults.find((f) => f.id === order.faultId) : undefined;
  if (fault && isFaultOpen(fault)) {
    const toAssigned = faultStageIndex(fault.status) < faultStageIndex('Assigned') && fault.status !== 'On Hold';
    patch.faults = replace(data.faults, {
      ...fault,
      assignedTechnician: name,
      ...(toAssigned ? { status: 'Assigned' as const } : {}),
      history: [...(fault.history ?? []), line('ASSIGNED', `${order.id} assigned to ${name}`, ctx)],
    });
  }
  return checked(data, patch, updated, {
    notice: notice('success', 'Assigned', `${workOrderId} is now ${name}'s job.`),
    audit: [{ action: 'WORK_ORDER_ASSIGNED', details: `${workOrderId} to ${name}`, assetId: workOrderId, assetType: 'WorkOrder' }],
  });
}

/** True when a job moves into repair done, or into verified or closed: each step needs the photos (or a reason). */
const needsPhotoCheck = (from: WorkOrderStatus, to: WorkOrderStatus): boolean => {
  const next = jobPhotoStage(to);
  return next !== null && next !== jobPhotoStage(from);
};

/** Keeps the job's fault in step when the office moves the job. Never moves a fault backwards. */
function faultFollowsJob(data: NetworkData, order: WorkOrder, to: WorkOrderStatus, verification: Verification | undefined, ctx: CommandContext): Fault[] | undefined {
  const fault = order.faultId ? data.faults.find((f) => f.id === order.faultId) : undefined;
  if (!fault || !isFaultOpen(fault) || fault.status === 'On Hold') return undefined;
  const target: FaultStatus | undefined = to === 'In Progress' ? 'In Repair' : to === 'Completed' ? 'Repaired' : to === 'Verified' || to === 'Closed' ? 'Verified' : undefined;
  if (!target || faultStageIndex(fault.status) >= faultStageIndex(target)) return undefined;
  const at = nowIso(ctx);
  const updated: Fault = {
    ...fault,
    status: target,
    ...(target === 'Repaired' || target === 'Verified' ? { repairedAt: fault.repairedAt ?? order.repairedAt ?? at } : {}),
    ...(target === 'Verified' && verification ? { verification: fault.verification ?? { ...verification, workOrderId: order.id }, verifiedAt: at, verifiedBy: verification.by } : {}),
    history: [...(fault.history ?? []), line('STATUS', `${FAULT_STATUS_LABELS[fault.status]} → ${FAULT_STATUS_LABELS[target]} (work order ${order.id})`, ctx)],
  };
  return replace(data.faults, updated);
}

/**
 * The office moves a job. Verified and Closed need a check on the job. Its fault follows forward
 * (in repair, repaired, verified); it never closes with the job: the office closes the fault.
 */
export function setJobStatus(data: NetworkData, workOrderId: string, to: WorkOrderStatus, opts: { note?: string } = {}, ctx: CommandContext = {}): CommandResult<WorkOrder> {
  const order = data.workOrders.find((w) => w.id === workOrderId);
  if (!order) return fail('Work order missing', `${workOrderId} was not found.`);
  if (order.status === to) return succeed(order, {});
  if (order.status === 'Closed' || order.status === 'Cancelled') return fail('Finished', `${workOrderId} is ${order.status.toLowerCase()}.`, 'info');
  if ((to === 'Verified' || to === 'Closed') && (!order.verification || verificationProblem(order.verification))) {
    return fail('Check needed', `${workOrderId} cannot be ${to === 'Closed' ? 'closed' : 'marked verified'} yet. It needs a check: a light reading measured in the field, a photo, or an office check.`);
  }
  if (to === 'Assigned' && (!order.technicianName || order.technicianName === 'Unassigned')) return fail('Name needed', 'Choose a technician first.');
  const photoWhy = needsPhotoCheck(order.status, to) ? jobPhotoProblem(order) : null;
  if (photoWhy) return fail('Photos needed', `${workOrderId} cannot be ${to === 'Completed' ? 'marked repair done' : to === 'Closed' ? 'closed' : 'marked verified'} yet. ${photoWhy}`);
  const at = nowIso(ctx);
  const note = opts.note?.trim();
  const updated: WorkOrder = {
    ...order,
    status: to,
    ...(order.status === 'On Hold' ? { heldFrom: undefined } : {}),
    ...(to === 'On Hold' ? { heldFrom: order.status } : {}),
    ...(to === 'In Progress' && !order.startedAt ? { startedAt: at } : {}),
    ...(to === 'Completed' ? { repairedAt: order.repairedAt ?? at, completedDate: isoDate(ctx.now) } : {}),
    ...(to === 'Verified' ? { verifiedAt: at } : {}),
    ...(to === 'Closed' ? { closedAt: at, closedBy: actorOf(ctx) } : {}),
    history: [...(order.history ?? []), line('STATUS', `${WORK_ORDER_STATUS_LABELS[order.status]} → ${WORK_ORDER_STATUS_LABELS[to]}${note ? `: ${note}` : ''}`, ctx)],
  };
  const faults = faultFollowsJob(data, order, to, updated.verification, ctx);
  return checked(data, { workOrders: replace(data.workOrders, updated), ...(faults ? { faults } : {}) }, updated, {
    notice: notice('success', 'Work order updated', `${workOrderId}: ${WORK_ORDER_STATUS_LABELS[to]}.`),
    audit: [{ action: 'WORK_ORDER_STATUS', details: `${workOrderId}: ${order.status} → ${to}${note ? ` (${note})` : ''}`, assetId: workOrderId, assetType: 'WorkOrder' }],
  });
}

/** The office records a check on a job (an office check, or a reading it was given) and verifies it. */
export function recordJobVerification(data: NetworkData, workOrderId: string, input: VerificationInput, ctx: CommandContext = {}): CommandResult<WorkOrder> {
  const order = data.workOrders.find((w) => w.id === workOrderId);
  if (!order) return fail('Work order missing', `${workOrderId} was not found.`);
  if (order.status === 'Closed' || order.status === 'Cancelled') return fail('Finished', `${workOrderId} is ${order.status.toLowerCase()}.`, 'info');
  const verification: Verification = { ...input, at: nowIso(ctx), by: actorOf(ctx, input.by), workOrderId };
  const why = verificationProblem(verification);
  if (why) return fail('Check not complete', why);
  const photoWhy = needsPhotoCheck(order.status, 'Verified') ? jobPhotoProblem(order) : null;
  if (photoWhy) return fail('Photos needed', `${workOrderId} cannot be marked verified yet. ${photoWhy}`);
  const updated: WorkOrder = {
    ...order,
    verification,
    status: 'Verified',
    verifiedAt: verification.at,
    repairedAt: order.repairedAt ?? verification.at,
    history: [...(order.history ?? []), line('VERIFIED', describeVerification(verification), ctx)],
  };
  const faults = faultFollowsJob(data, order, 'Verified', verification, ctx);
  return checked(data, { workOrders: replace(data.workOrders, updated), ...(faults ? { faults } : {}) }, updated, {
    notice: notice('success', 'Check recorded', `${workOrderId} is verified.`),
    audit: [{ action: 'WORK_ORDER_VERIFIED', details: `${workOrderId}: ${describeVerification(verification)}`, assetId: workOrderId, assetType: 'WorkOrder' }],
  });
}

/**
 * Records why no photo of the repair was possible, so a job or a fault can be finished without the
 * before and after photos. The reason stays in the record with who and when: a job note ("No photo
 * possible: …") on a work order, a `NO_PHOTO` history line on a fault.
 */
export function recordNoPhotoReason(data: NetworkData, target: { workOrderId: string } | { faultId: string }, reason: string, ctx: CommandContext = {}): CommandResult<{ text: string }> {
  const why = reason.trim();
  if (why.length < 3) return fail('Reason needed', 'Write why no photo was possible.');
  const text = noPhotoReasonText(why).slice(0, 500);
  if ('workOrderId' in target) {
    const order = data.workOrders.find((w) => w.id === target.workOrderId);
    if (!order) return fail('Work order missing', `${target.workOrderId} was not found.`);
    if (order.status === 'Closed' || order.status === 'Cancelled') return fail('Finished', `${order.id} is ${order.status.toLowerCase()}.`, 'info');
    const updated: WorkOrder = {
      ...order,
      fieldNotes: [...(order.fieldNotes ?? []), { id: newJobPartId('NTE'), at: nowIso(ctx), by: actorOf(ctx), text }],
      history: [...(order.history ?? []), line(NO_PHOTO_ACTION, text, ctx)],
    };
    return checked(data, { workOrders: replace(data.workOrders, updated) }, { text }, {
      notice: notice('success', 'Reason recorded', `${order.id}: ${text}`),
      audit: [{ action: 'NO_PHOTO_REASON', details: `${order.id}: ${text}`, assetId: order.id, assetType: 'WorkOrder' }],
    });
  }
  const fault = data.faults.find((f) => f.id === target.faultId);
  if (!fault) return fail('Fault missing', `Fault ${target.faultId} was not found.`);
  if (!isFaultOpen(fault)) return fail('Closed', `${fault.id} is closed.`, 'info');
  const updated: Fault = { ...fault, history: [...(fault.history ?? []), line(NO_PHOTO_ACTION, text, ctx)] };
  return checked(data, { faults: replace(data.faults, updated) }, { text }, {
    notice: notice('success', 'Reason recorded', `${fault.id}: ${text}`),
    audit: [{ action: 'NO_PHOTO_REASON', details: `${fault.id}: ${text}`, assetId: fault.id, assetType: 'Fault' }],
  });
}

/* ------------------------------------------------------------------ */
/* Field job events (the technician's phone)                           */
/* ------------------------------------------------------------------ */

export type JobEventInput = { id: string; at: string; by: string } & (
  | { kind: 'start' }
  | { kind: 'photo'; photoId: string; photoKind: JobPhotoKind }
  | { kind: 'step'; stepId: string }
  | { kind: 'material'; item: string; quantity: number; unit: string }
  | { kind: 'note'; text: string }
  | { kind: 'hold'; text?: string }
  | { kind: 'repair_done' }
  | { kind: 'verify'; verification: Omit<Verification, 'at' | 'by' | 'workOrderId'> }
);

const OPEN_FOR_FIELD: readonly WorkOrderStatus[] = ['Pending', 'Assigned', 'Accepted', 'In Progress', 'On Hold', 'Completed'];

/**
 * Applies one thing the technician did on the phone. Only the work order changes, so a technician
 * offline never edits the fault the office is working on. Saving the same event again does
 * nothing. The office sees each event in the job's history.
 */
export function applyJobEvent(data: NetworkData, workOrderId: string, event: JobEventInput, ctx: CommandContext = {}): CommandResult<{ applied: boolean }> {
  const order = data.workOrders.find((w) => w.id === workOrderId);
  if (!order) return fail('Job missing', `Job ${workOrderId} is not on this phone. Call the office.`);
  if ((order.fieldEvents ?? []).some((e) => e.id === event.id)) return succeed({ applied: false }, {});
  if (!OPEN_FOR_FIELD.includes(order.status)) return fail('Job finished', `Job ${workOrderId} is ${order.status.toLowerCase()}. Call the office.`);
  const at = event.at;
  const by = event.by;
  const ectx = { ...ctx, now: new Date(at), actor: by };
  let next: WorkOrder = { ...order };
  let ref: string | undefined;
  let status: WorkOrderStatus | undefined;
  let details = '';
  switch (event.kind) {
    case 'start':
      status = 'In Progress';
      next.startedAt = order.startedAt ?? at;
      details = 'Started the job';
      break;
    case 'photo':
      ref = event.photoId;
      next.photoRefs = [...(order.photoRefs ?? []), { photoId: event.photoId, kind: event.photoKind, at, by, eventId: event.id }];
      next.photos = [...order.photos, photoUrl(event.photoId)];
      details = `${event.photoKind === 'before' ? 'Photo before the repair' : event.photoKind === 'after' ? 'Photo after the repair' : event.photoKind === 'meter' ? 'Meter photo' : 'Photo'} taken`;
      break;
    case 'step': {
      const step = (order.steps ?? []).find((s) => s.id === event.stepId);
      if (!step) return fail('Step missing', 'This step is no longer on the job.');
      ref = step.id;
      next.steps = (order.steps ?? []).map((s) => (s.id === step.id ? { ...s, doneAt: at, doneBy: by } : s));
      details = `Done: ${step.label}`;
      break;
    }
    case 'material': {
      if (!(event.quantity > 0)) return fail('Number needed', 'Enter how many.');
      const id = newJobPartId('MAT');
      ref = id;
      next.materials = [...(order.materials ?? []), { id, item: event.item.trim().slice(0, 120), quantity: event.quantity, unit: event.unit.slice(0, 20), at, by }];
      details = `Used ${event.quantity} ${event.unit} ${event.item}`;
      break;
    }
    case 'note': {
      if (!event.text.trim()) return fail('Note empty', 'Write the note first.');
      const id = newJobPartId('NTE');
      ref = id;
      next.fieldNotes = [...(order.fieldNotes ?? []), { id, at, by, text: event.text.trim().slice(0, 1000) }];
      details = `Note: ${event.text.trim()}`;
      break;
    }
    case 'hold':
      status = 'On Hold';
      next.heldFrom = order.status === 'On Hold' ? order.heldFrom : order.status;
      if (event.text?.trim()) {
        const id = newJobPartId('NTE');
        ref = id;
        next.fieldNotes = [...(order.fieldNotes ?? []), { id, at, by, text: event.text.trim().slice(0, 1000) }];
      }
      details = `Stopped for now${event.text?.trim() ? `: ${event.text.trim()}` : ''}`;
      break;
    case 'repair_done':
      if (needsPhotoCheck(order.status, 'Completed') && jobPhotoProblem(order)) {
        return fail('Photos needed', 'Take a photo before and a photo after the repair. If no photo is possible, say why.');
      }
      status = 'Completed';
      next.repairedAt = at;
      next.completedDate = at.slice(0, 10);
      details = 'Repair done';
      break;
    case 'verify': {
      const verification: Verification = { ...event.verification, at, by, workOrderId };
      const why = verificationProblem(verification);
      if (why) return fail('Check not complete', why);
      if (needsPhotoCheck(order.status, 'Verified') && jobPhotoProblem(order)) {
        return fail('Photos needed', 'Take a photo before and a photo after the repair. If no photo is possible, say why.');
      }
      status = 'Verified';
      next.verification = verification;
      next.verifiedAt = at;
      next.repairedAt = order.repairedAt ?? at;
      details = describeVerification(verification);
      break;
    }
  }
  if (status && status !== order.status) next.status = status;
  if (order.status === 'On Hold' && status && status !== 'On Hold') next.heldFrom = undefined;
  const record: JobEvent = { id: event.id, kind: event.kind, at, by, ...(ref ? { ref } : {}), ...(status && status !== order.status ? { previousStatus: order.status } : {}) };
  next = { ...next, fieldEvents: [...(order.fieldEvents ?? []), record], history: [...(order.history ?? []), line(`FIELD_${event.kind.toUpperCase()}`, details, ectx, by)] };
  return checked(data, { workOrders: replace(data.workOrders, next) }, { applied: true }, {
    audit: [{ action: 'FIELD_JOB_EVENT', details: `${workOrderId}: ${details}`.slice(0, 500), assetId: workOrderId, assetType: 'WorkOrder' }],
  });
}

/**
 * Takes one phone event back ("Undo"). It is marked undone, not deleted, so the office still sees
 * that it happened and was taken back.
 */
export function undoJobEvent(data: NetworkData, workOrderId: string, eventId: string, ctx: CommandContext = {}): CommandResult<{ undone: boolean }> {
  const order = data.workOrders.find((w) => w.id === workOrderId);
  if (!order) return succeed({ undone: false }, {});
  const event = (order.fieldEvents ?? []).find((e) => e.id === eventId);
  if (!event || event.undoneAt) return succeed({ undone: false }, {});
  if (order.status === 'Closed') return fail('Job closed', 'The office has closed this job. Call the office.');
  const at = nowIso(ctx);
  let next: WorkOrder = { ...order };
  switch (event.kind) {
    case 'photo':
      next.photoRefs = (order.photoRefs ?? []).filter((p) => p.eventId !== event.id);
      if (event.ref) next.photos = order.photos.filter((p) => p !== photoUrl(event.ref!));
      break;
    case 'step':
      next.steps = (order.steps ?? []).map((s) => (s.id === event.ref ? { ...s, doneAt: undefined, doneBy: undefined } : s));
      break;
    case 'material':
      next.materials = (order.materials ?? []).filter((m) => m.id !== event.ref);
      break;
    case 'note':
    case 'hold':
      next.fieldNotes = (order.fieldNotes ?? []).filter((n) => n.id !== event.ref);
      break;
    case 'verify':
      next.verification = undefined;
      next.verifiedAt = undefined;
      break;
    default:
      break;
  }
  if (event.previousStatus && order.status !== event.previousStatus) next.status = event.previousStatus;
  next = {
    ...next,
    fieldEvents: (order.fieldEvents ?? []).map((e) => (e.id === event.id ? { ...e, undoneAt: at } : e)),
    history: [...(order.history ?? []), line('FIELD_UNDO', `Taken back: ${event.kind.replace('_', ' ')}`, ctx)],
  };
  return checked(data, { workOrders: replace(data.workOrders, next) }, { undone: true }, {
    audit: [{ action: 'FIELD_JOB_UNDO', details: `${workOrderId}: ${event.kind} ${event.id} taken back`, assetId: workOrderId, assetType: 'WorkOrder' }],
  });
}

/** One timeline for a fault: its own history and its jobs', oldest first, each line saying where it is from. */
export function faultTimeline(data: Pick<NetworkData, 'workOrders'>, fault: Fault): (HistoryEntry & { source: string })[] {
  const own = (fault.history ?? []).map((h) => ({ ...h, source: fault.id }));
  const jobs = data.workOrders.filter((w) => w.faultId === fault.id).flatMap((w) => (w.history ?? []).map((h) => ({ ...h, source: w.id })));
  return [...own, ...jobs].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}
