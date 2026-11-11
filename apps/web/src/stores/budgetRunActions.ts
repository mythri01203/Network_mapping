/**
 * Network mapping Phase 17: stored optical budget runs (`opticalBudgetRuns`). Storing one wraps the
 * pure command `storeBudgetRun` from `@fibergis/shared`, so it gets audit, toasts, sync and the same
 * access rules as the server (engineers, network admins and planners may store; technicians, NOC,
 * supervisors and look-only accounts may not). A run is history: it changes no network record and
 * is never changed or deleted.
 */
import type { CorePathResult, OpticalBudgetRun } from '@fibergis/shared';
import * as domain from '@fibergis/shared';

import { currentAccount, loginIsOn, useAuthStore } from './authStore';
import { useNetworkStore } from './networkStore';

export function storeBudgetRun(path: CorePathResult, note?: string): OpticalBudgetRun | null {
  const overrides = useNetworkStore.getState().settings ?? [];
  return useNetworkStore.getState().runCommand((data, ctx) => domain.storeBudgetRun(data, { path, overrides, note }, ctx))?.value ?? null;
}

/** Whether the person here may store budget runs. Login off (setup mode): yes, as on the server. */
export const useMayStoreBudgetRuns = (): boolean =>
  useAuthStore((s) => {
    if (!loginIsOn(s)) return true;
    const account = currentAccount(s);
    return !!account && domain.roleCan(account.role, 'create', 'opticalBudgetRuns');
  });
