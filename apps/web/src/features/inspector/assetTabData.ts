import { useMemo } from 'react';

import { assetHistory, type Customer, type Equipment, type Splitter } from '@fibergis/shared';

import { useNetworkStore } from '../../stores/networkStore';

/**
 * Customers whose recorded path names this item: as their OLT, their box, or a splitter recorded in
 * this box. Nothing is worked out from distance.
 */
export function customersOnItem(
  customers: readonly Customer[],
  splitters: readonly Splitter[],
  equipmentId: string,
): { customer: Customer; how: string }[] {
  const splitterIds = new Set(splitters.filter((sp) => sp.terminalBoxId === equipmentId).map((sp) => sp.id));
  const rows: { customer: Customer; how: string }[] = [];
  for (const c of customers) {
    const how =
      c.terminalBoxId === equipmentId
        ? 'Box on their record'
        : c.oltId === equipmentId
          ? 'OLT on their record'
          : splitterIds.has(c.splitterId)
            ? `Splitter ${c.splitterId} in this box`
            : undefined;
    if (how) rows.push({ customer: c, how });
  }
  return rows;
}

export function useCustomersOnItem(equipmentId: string) {
  const customers = useNetworkStore((s) => s.customers);
  const splitters = useNetworkStore((s) => s.splitters);
  return useMemo(() => customersOnItem(customers, splitters, equipmentId), [customers, splitters, equipmentId]);
}

export function useItemHistory(equipment: Equipment) {
  const auditLogs = useNetworkStore((s) => s.auditLogs);
  return useMemo(() => assetHistory(equipment, auditLogs), [equipment, auditLogs]);
}

/** How many entries each tab holds, for the tab labels. */
export function useItemTabCounts(equipment: Equipment) {
  const customers = useCustomersOnItem(equipment.id).length;
  const documents = useNetworkStore((s) => s.documents.reduce((n, d) => n + (d.equipmentId === equipment.id ? 1 : 0), 0));
  const history = useItemHistory(equipment).length;
  return { customers, documents, maintenance: equipment.maintenance?.length ?? 0, history };
}

/** A spec row on the slack loop and splice joint panels, matched by any of the usual names for it. */
export interface SpecRowDef {
  label: string;
  /** Lower-case spec keys that mean this row. */
  keys: string[];
}

export const SLACK_LOOP_SPEC_ROWS: SpecRowDef[] = [
  { label: 'Loop length', keys: ['reserve loop length', 'loop length', 'slack length'] },
  { label: 'Minimum bend radius', keys: ['minimum bend radius', 'min bend radius', 'bend radius'] },
  { label: 'Mounting', keys: ['mounting', 'mounting bracket', 'bracket'] },
];

export const SPLICE_JOINT_SPEC_ROWS: SpecRowDef[] = [
  { label: 'Return loss', keys: ['return loss'] },
  { label: 'Protection sleeve', keys: ['protection sleeve', 'splice sleeve', 'sleeve'] },
];
