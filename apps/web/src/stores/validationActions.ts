/**
 * Network mapping Phase 15: stored map check findings (`validationFindings`). The check itself runs
 * on the server, with the operator's settings, and stores what it finds; the browser then loads the
 * findings like any other records. Marking a finding "fine as it is", "fixed" or "open again" is a
 * pure command from `@fibergis/shared`, so it gets audit, toasts and sync like every change. Undo
 * leaves findings alone (their history only grows; see `KEPT_BY_UNDO` in networkStore).
 */
import { create } from 'zustand';

import * as domain from '@fibergis/shared';

import { authClient, describeApiError, type ValidationRunResult } from '../api/client';
import { syncEngine } from '../api/syncEngine';
import { currentAccount, loginIsOn } from './authStore';
import { useNetworkStore } from './networkStore';
import { showToast } from './toastStore';

interface ValidationUiState {
  open: boolean;
  running: boolean;
  lastRun: ValidationRunResult | null;
  setOpen: (open: boolean) => void;
}

export const useValidationStore = create<ValidationUiState>()((set) => ({
  open: false,
  running: false,
  lastRun: null,
  setOpen: (open) => set({ open }),
}));

/** Who may run the check and decide on findings: the same roles that may add and change them. */
export function mayChangeFindings(): boolean {
  if (!loginIsOn()) return true;
  const account = currentAccount();
  return !!account && domain.roleCan(account.role, 'create', 'validationFindings') && domain.roleCan(account.role, 'update', 'validationFindings');
}

/** Runs the map check on the server and loads what it stored. */
export async function runMapCheckNow(): Promise<boolean> {
  const store = useValidationStore.getState();
  if (store.running) return false;
  if (!authClient.runValidation) return false;
  useValidationStore.setState({ running: true });
  try {
    const result = await authClient.runValidation();
    useValidationStore.setState({ lastRun: result });
    await syncEngine.refresh().catch(() => undefined);
    const s = result.summary;
    showToast(
      result.counts.errors > 0 ? 'warning' : 'success',
      'Map check done',
      `${s.found} problem(s) found: ${s.opened} new, ${s.noLongerFound} no longer found${s.reopened ? `, ${s.reopened} opened again` : ''}.`,
    );
    return true;
  } catch (error) {
    showToast('error', 'Map check not run', describeApiError(error));
    return false;
  } finally {
    useValidationStore.setState({ running: false });
  }
}

const run = (command: (data: domain.NetworkData, ctx: domain.CommandContext) => domain.CommandResult<domain.ValidationFinding>) =>
  useNetworkStore.getState().runCommand(command) !== null;

export const acknowledgeFindingAction = (id: string, note: string) => run((data, ctx) => domain.acknowledgeFinding(data, id, note, ctx));
export const resolveFindingAction = (id: string, note: string) => run((data, ctx) => domain.resolveFinding(data, id, note, ctx));
export const reopenFindingAction = (id: string, note: string) => run((data, ctx) => domain.reopenFinding(data, id, note, ctx));
