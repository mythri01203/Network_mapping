import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';

import type { NetworkData } from '@fibergis/shared';

import { useNetworkStore } from '../../../stores/networkStore';

/** The collections outside-plant questions need, as a NetworkData the shared helpers accept. */
export function useOspData(): NetworkData {
  const parts = useNetworkStore(
    useShallow((s) => ({
      equipment: s.equipment,
      cables: s.cables,
      spans: s.spans,
      attachments: s.attachments,
      ducts: s.ducts,
      slackLoops: s.slackLoops,
      permissions: s.permissions,
      inspections: s.inspections,
      buildings: s.buildings,
    })),
  );
  return useMemo(
    () => ({ ...parts, splitters: [], closures: [], customers: [], faults: [], workOrders: [], zones: [], documents: [] }),
    [parts],
  );
}

/** Blank text becomes "not recorded" (undefined), never an empty string stored as a fact. */
export const blankToUndefined = (value: string): string | undefined => (value.trim() ? value.trim() : undefined);

/** A typed number, or undefined when the box is empty. NaN when it is not a number. */
export const parseOptionalNumber = (value: string): number | undefined => (value.trim() === '' ? undefined : Number(value));

export const formatMeters = (m: number | undefined): string | undefined =>
  m === undefined ? undefined : m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m * 10) / 10} m`;
