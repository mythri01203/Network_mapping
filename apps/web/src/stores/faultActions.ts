/**
 * Alarms, faults and work orders for the office screens (Phase 8). Each wraps a pure command from
 * `@fibergis/shared`, so it gets undo, audit, toasts and sync, and the same checks the server runs.
 */
import * as domain from '@fibergis/shared';

import { type Command, useNetworkStore } from './networkStore';

const run = <T>(command: Command<T>): T | null => useNetworkStore.getState().runCommand(command)?.value ?? null;

// --- Alarms --------------------------------------------------------------------------------------
export const reportAlarm = (draft: domain.AlarmDraft) => run((d, ctx) => domain.raiseAlarm(d, draft, ctx));
export const makeTestEvent = (input: Parameters<typeof domain.raiseTestEvent>[1]) => run((d, ctx) => domain.raiseTestEvent(d, input, ctx));
export const acknowledge = (ids: string[]) => run((d, ctx) => domain.acknowledgeAlarms(d, ids, ctx));
export const clear = (ids: string[], note: string) => run((d, ctx) => domain.clearAlarms(d, ids, note, ctx));

// --- Faults --------------------------------------------------------------------------------------
export const openFaultFor = (draft: domain.FaultOpenDraft) => run((d, ctx) => domain.openFault(d, draft, ctx));
export const moveFault = (faultId: string, to: domain.FaultStatus, note?: string) => run((d, ctx) => domain.setFaultStatus(d, faultId, to, { note }, ctx));
export const resume = (faultId: string) => run((d, ctx) => domain.resumeFault(d, faultId, ctx));
export const checkFault = (faultId: string, input: domain.VerificationInput) => run((d, ctx) => domain.recordFaultVerification(d, faultId, input, ctx));

// --- Work orders ---------------------------------------------------------------------------------
export const makeJob = (draft: domain.JobDraft) => run((d, ctx) => domain.createJob(d, draft, ctx));
export const assign = (workOrderId: string, name: string, phone: string) => run((d, ctx) => domain.assignJob(d, workOrderId, name, phone, ctx));
export const moveJob = (workOrderId: string, to: domain.WorkOrderStatus, note?: string) => run((d, ctx) => domain.setJobStatus(d, workOrderId, to, { note }, ctx));
export const checkJob = (workOrderId: string, input: domain.VerificationInput) => run((d, ctx) => domain.recordJobVerification(d, workOrderId, input, ctx));
