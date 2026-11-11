/**
 * Network mapping Phase 6: stretches of a cable (how each part is installed, the duct or spans it
 * runs in, a measured length). Each wraps a pure command from `@fibergis/shared`, so it gets undo,
 * audit, toasts and sync like every other change. Warnings ask "Save anyway?" first.
 */
import type { CableSegment } from '@fibergis/shared';
import * as domain from '@fibergis/shared';

import { selectOspSettings, useNetworkStore } from './networkStore';

export async function saveCableSegment(draft: domain.CableSegmentDraft): Promise<CableSegment | null> {
  const settings = selectOspSettings(useNetworkStore.getState());
  const result = await useNetworkStore
    .getState()
    .runConfirmedCommand((data, ctx) => domain.saveCableSegment(data, draft, ctx, settings), { confirmTitle: 'Please check', confirmLabel: 'Save anyway' });
  return result?.value ?? null;
}

export async function deleteCableSegment(id: string): Promise<boolean> {
  const result = await useNetworkStore
    .getState()
    .runConfirmedCommand((data) => domain.deleteCableSegment(data, id), { confirmTitle: 'Delete stretch record', confirmLabel: 'Delete this stretch' });
  return result !== null;
}
