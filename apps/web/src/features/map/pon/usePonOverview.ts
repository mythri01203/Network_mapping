import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { affectedByElement, buildImpactIndex, buildPonOverview, type Fault, isOpenAlarm, type PonOverview } from '@fibergis/shared';

import { selectOpticalSettings, useNetworkStore } from '../../../stores/networkStore';

const CLOSED_FAULTS = new Set<Fault['status']>(['Resolved', 'Repaired', 'Verified', 'Closed']);

/** The PON overview of the network in the browser, rebuilt only when fiber records change. */
export function usePonOverview(): PonOverview {
  const { equipment, cables, splitters, closures, customers, settings } = useNetworkStore(
    useShallow((s) => ({ equipment: s.equipment, cables: s.cables, splitters: s.splitters, closures: s.closures, customers: s.customers, settings: s.settings })),
  );
  const optical = selectOpticalSettings({ settings });
  return useMemo(() => buildPonOverview({ equipment, cables, splitters, closures, customers }, optical), [equipment, cables, splitters, closures, customers, optical]);
}

export interface AffectedCustomer {
  customerId: string;
  /** Why: the fault or alarm, in plain words. */
  reasons: string[];
  /** TEST alarms are never real. */
  test: boolean;
}

/**
 * Customers a recorded open fault names, or an open alarm reaches through recorded fiber paths.
 * Always "suspected": an alarm is not proof of an outage, and no alarm is not proof of service.
 */
export function useAffectedCustomers(): Map<string, AffectedCustomer> {
  const data = useNetworkStore(
    useShallow((s) => ({
      equipment: s.equipment,
      cables: s.cables,
      splitters: s.splitters,
      closures: s.closures,
      customers: s.customers,
      faults: s.faults,
      alarms: s.alarms,
      spans: s.spans,
      attachments: s.attachments,
      services: s.services,
      onts: s.onts,
    })),
  );
  return useMemo(() => {
    const out = new Map<string, AffectedCustomer>();
    const add = (id: string, reason: string, test: boolean) => {
      const entry = out.get(id) ?? { customerId: id, reasons: [], test };
      if (!entry.reasons.includes(reason)) entry.reasons.push(reason);
      entry.test = entry.test && test;
      out.set(id, entry);
    };
    for (const f of data.faults) {
      if (CLOSED_FAULTS.has(f.status)) continue;
      for (const id of f.affectedCustomerIds) add(id, `Fault: ${f.title}`, false);
    }
    const open = (data.alarms ?? []).filter(isOpenAlarm);
    if (open.length) {
      const ix = buildImpactIndex(data as Parameters<typeof buildImpactIndex>[0]);
      for (const a of open) {
        const impact = affectedByElement(ix, a.element);
        for (const c of impact.affected) add(c.customerId, `${a.isTest ? 'TEST alarm' : 'Alarm'}: ${a.kind.replace(/_/g, ' ')} on ${impact.label}`, a.isTest);
      }
    }
    return out;
  }, [data]);
}
