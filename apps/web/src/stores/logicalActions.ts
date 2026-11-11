/**
 * Network mapping Phase 14: the logical layer's operations for the topology screens. Each wraps a
 * pure command from `@fibergis/shared`, so it gets undo, audit, toasts and sync. A warning (a VLAN
 * used twice on a PON port, an ONT registered on another port than its fibres reach) is asked first;
 * saving anyway is written to the audit trail.
 */
import * as domain from '@fibergis/shared';

import { logAudit } from './networkActions';
import { type Command, useNetworkStore } from './networkStore';
import { showToast } from './toastStore';

const logicalSettings = () => domain.resolveLogicalSettings(useNetworkStore.getState().settings);

const run = async <T>(command: Command<T>): Promise<T | null> =>
  (await useNetworkStore.getState().runConfirmedCommand(command, { confirmTitle: 'Please check', confirmLabel: 'Save anyway' }))?.value ?? null;

/** Records a service's VLAN, profile, IP and circuit id exactly as typed. */
export const saveBinding = (serviceId: string, draft: domain.ServiceBindingDraft) => run((d, ctx) => domain.saveServiceBinding(d, serviceId, draft, ctx, logicalSettings()));

/** Records the PON port the OLT shows an ONT on, or clears it with `null`. */
export const saveOntRegistration = (ontId: string, registration: domain.PonRef | null) => run((d, ctx) => domain.setOntRegistration(d, ontId, registration, ctx, logicalSettings()));

/** Turns a logical rule setting on or off for everyone. Back to the default removes the override. */
export function setLogicalSetting(def: domain.LogicalSettingDef, value: boolean, who: string) {
  const store = useNetworkStore.getState();
  const was = logicalSettings()[def.key];
  if (was === value) return;
  if (value === def.defaultValue) store.deleteSetting(def.id);
  else store.saveSetting({ id: def.id, value, source: 'Set on the Topology screen', updatedAt: new Date().toISOString(), updatedBy: who });
  // The store refuses a change the account may not make; only a change that took is logged.
  if (logicalSettings()[def.key] !== value) return;
  logAudit('SETTING_CHANGED', `${def.label}: ${was ? 'on' : 'off'} → ${value ? 'on' : 'off'}`, def.id, 'System');
  showToast('success', 'Setting saved', `${def.label}: ${value ? 'on' : 'off'}.`);
}
