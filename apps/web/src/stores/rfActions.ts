/**
 * Cable TV operations for the office screens (Phase 6). Each wraps a pure command from
 * `@fibergis/shared`, so it gets undo, audit, toasts and sync, and the same checks the server runs.
 * A warning is shown first; saving anyway is written to the audit trail.
 */
import * as domain from '@fibergis/shared';

import { type Command, useNetworkStore } from './networkStore';

const run = async <T>(command: Command<T>): Promise<T | null> =>
  (await useNetworkStore.getState().runConfirmedCommand(command, { confirmTitle: 'Please check', confirmLabel: 'Save anyway' }))?.value ?? null;

export const addRfElement = (draft: domain.RfElementDraft) => run((d, ctx) => domain.createRfElement(d, draft, ctx));
export const saveRfElement = (id: string, details: domain.RfElementDetails) => run((d, ctx) => domain.saveRfElement(d, id, details, ctx));
export const deleteRfElement = (id: string) => run((d, ctx) => domain.deleteRfElement(d, id, ctx));
export const addRfLink = (draft: domain.RfLinkDraft) => run((d, ctx) => domain.linkRf(d, draft, ctx));
export const takeOutRfLink = (id: string, reason: string) => run((d, ctx) => domain.unlinkRf(d, id, reason, ctx));
export const addRfLevel = (draft: domain.RfLevelDraft) => run((d, ctx) => domain.recordRfLevel(d, draft, ctx));
export const deleteRfLevel = (id: string) => run((d, ctx) => domain.deleteRfLevel(d, id, ctx));
export const addTvCustomer = (draft: domain.TvCustomerDraft) => run((d, ctx) => domain.addTvCustomer(d, draft, ctx));
export const disconnectTvCustomer = (id: string, reason: string) => run((d, ctx) => domain.disconnectTvCustomer(d, id, reason, ctx));
