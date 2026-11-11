/**
 * Network mapping Phase 18: expansion scenarios (`planningScenarios`). Each wraps a pure command from
 * `@fibergis/shared`, so it gets undo, audit, toasts, sync and the same access rules as the server
 * (planners and engineers may write; technicians, NOC, supervisors and look-only accounts may not).
 * A scenario is a plan only: none of these change a network record.
 */
import type { PlanningScenario } from '@fibergis/shared';
import * as domain from '@fibergis/shared';

import { currentAccount, loginIsOn, useAuthStore } from './authStore';
import { useNetworkStore } from './networkStore';

export function addScenario(draft: domain.ScenarioDraft): PlanningScenario | null {
  return useNetworkStore.getState().runCommand((data, ctx) => domain.createScenario(data, draft, ctx))?.value ?? null;
}

export function updateScenario(scenario: PlanningScenario): PlanningScenario | null {
  return useNetworkStore.getState().runCommand((data, ctx) => domain.saveScenario(data, scenario, ctx))?.value ?? null;
}

export async function removeScenario(id: string): Promise<boolean> {
  const result = await useNetworkStore.getState().runConfirmedCommand(
    (data) => {
      const r = domain.deleteScenario(data, id);
      return r.ok ? { ...r, confirm: `Delete the scenario "${r.value.name}"? The network is not changed either way.` } : r;
    },
    { confirmTitle: 'Delete scenario', confirmLabel: 'Delete scenario' },
  );
  return result !== null;
}

/** Whether the person here may write scenarios. Login off (setup mode): yes, as on the server. */
export const useMayPlan = (): boolean =>
  useAuthStore((s) => {
    if (!loginIsOn(s)) return true;
    const account = currentAccount(s);
    return !!account && domain.roleCan(account.role, 'create', 'planningScenarios');
  });
