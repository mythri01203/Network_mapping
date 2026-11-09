import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { type MonitoringSettings, resolveMonitoringSettings, roleMay, type SystemAction } from '@fibergis/shared';

import { syncEngine } from '../../api/syncEngine';
import { currentAccount, loginIsOn, useAuthStore } from '../../stores/authStore';
import { useNetworkStore } from '../../stores/networkStore';

/** The clock the ages are worked out from. Ticks every 30 s so "3 min ago" and "stale" stay true. */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function useMonitoringSettings(): MonitoringSettings {
  const settings = useNetworkStore((s) => s.settings);
  return useMemo(() => resolveMonitoringSettings(settings), [settings]);
}

/** Sources, readings and statuses as last loaded from the server. */
export function useMonitoringData() {
  return useNetworkStore(
    useShallow((s) => ({ monitoringSources: s.monitoringSources, onuReadings: s.onuReadings, onuStatuses: s.onuStatuses })),
  );
}

/** The same rule the server applies (`roleMay` in access.ts). Setup mode: allowed, as on the server. */
export function useMay(action: SystemAction): boolean {
  return useAuthStore((s) => {
    const account = loginIsOn(s) ? currentAccount(s) : null;
    return !account || roleMay(account.role, action);
  });
}

/** After a monitoring route stored something, load it now instead of waiting for the next check. */
export const refreshFromServer = (): Promise<void> => syncEngine.refresh();
