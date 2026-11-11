/**
 * Network mapping Phase 13: checks of links (`linkVerifications`). Each wraps a pure command from
 * `@fibergis/shared`, so it gets undo, audit, toasts and sync like every other change. Warnings
 * (no photo or reading, a link no longer on record) ask "Save anyway", and that is audited.
 */
import type { LinkVerification } from '@fibergis/shared';
import * as domain from '@fibergis/shared';

import { useNetworkStore } from './networkStore';

export async function saveLinkCheck(draft: domain.LinkCheckDraft): Promise<LinkVerification | null> {
  const result = await useNetworkStore
    .getState()
    .runConfirmedCommand((data, ctx) => domain.createLinkCheck(data, draft, ctx), { confirmTitle: 'Please check', confirmLabel: 'Save anyway' });
  return result?.value ?? null;
}

export async function deleteLinkCheck(id: string): Promise<boolean> {
  const result = await useNetworkStore
    .getState()
    .runConfirmedCommand((data) => domain.deleteLinkCheck(data, id), { confirmTitle: 'Delete check', confirmLabel: 'Delete check' });
  return result !== null;
}
