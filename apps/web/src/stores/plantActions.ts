/**
 * Phase 9: sites, racks and what sits in them, and ODF port marks, pigtails and patch cords. Each
 * wraps a pure command from `@fibergis/shared`, so it gets undo, audit, toasts and sync. A warning a
 * command raises is shown first; saving anyway is written to the audit trail.
 */
import type { Equipment, OdfPort, Rack, Site } from '@fibergis/shared';
import * as domain from '@fibergis/shared';

import { type Command, useNetworkStore } from './networkStore';

const run = async <T>(command: Command<T>, title = 'Please check', label = 'Save anyway'): Promise<T | null> =>
  (await useNetworkStore.getState().runConfirmedCommand(command, { confirmTitle: title, confirmLabel: label }))?.value ?? null;

export const addSite = (draft: domain.SiteDraft): Promise<Site | null> => run((d, ctx) => domain.createSite(d, draft, ctx));
export const saveSite = (id: string, draft: domain.SiteDraft): Promise<Site | null> => run((d, ctx) => domain.updateSite(d, id, draft, ctx));
export const removeSite = (id: string): Promise<Site | null> => run((d) => domain.deleteSite(d, id), 'Delete site', 'Delete site');

export const addRack = (draft: domain.RackDraft): Promise<Rack | null> => run((d, ctx) => domain.createRack(d, draft, ctx));
export const saveRack = (id: string, draft: domain.RackDraft): Promise<Rack | null> => run((d, ctx) => domain.updateRack(d, id, draft, ctx));
export const removeRack = (id: string): Promise<Rack | null> => run((d) => domain.deleteRack(d, id), 'Delete rack', 'Delete rack');

export const placeItemInRack = (equipmentId: string, place: domain.RackPlace | null): Promise<Equipment | null> =>
  run((d, ctx) => domain.placeInRack(d, equipmentId, place, ctx));

export const markPort = (odfId: string, panelId: string, port: number, mark: domain.OdfPortMark, reason: string): Promise<OdfPort | null> =>
  run((d, ctx) => domain.markOdfPort(d, odfId, panelId, port, mark, reason, ctx));

export const savePortDetails = (odfId: string, panelId: string, port: number, details: domain.OdfPortDetails): Promise<OdfPort | null> =>
  run((d, ctx) => domain.saveOdfPortDetails(d, odfId, panelId, port, details, ctx));
