/**
 * Outside-plant operations for the engineer screens: spans, attachments, ducts, slack loops,
 * permissions, the "same one?" check before placing, and KML import. Each wraps a pure command from
 * `@fibergis/shared`, so it gets undo, audit, toasts and sync like every other change.
 */
import type { Duct, Equipment, Permission, SlackLoop, Span, StructureStatus } from '@fibergis/shared';
import * as domain from '@fibergis/shared';

import { requestConfirm } from './confirmStore';
import { useMapStore } from './mapStore';
import { addEquipment, logAudit } from './networkActions';
import { type Command, type CommandOptions, selectOspSettings, useNetworkStore } from './networkStore';
import { useUiStore } from './uiStore';

const run = <T>(command: Command<T>, options?: CommandOptions) => useNetworkStore.getState().runCommand(command, options);
const runConfirmed = <T>(command: Command<T>, title: string, label: string) =>
  useNetworkStore.getState().runConfirmedCommand(command, { confirmTitle: title, confirmLabel: label });

// --- Spans ---------------------------------------------------------------------------------------

export const addSpan = (draft: domain.SpanDraft): Span | null => run((data, ctx) => domain.createSpan(data, draft, ctx))?.value ?? null;

export const setSpanStatus = (id: string, status: Exclude<StructureStatus, 'proposed'>): boolean =>
  run((data, ctx) => domain.setSpanStatus(data, id, status, ctx)) !== null;

export const saveSpan = (span: Span): boolean => run((data) => domain.updateSpan(data, span)) !== null;

export async function deleteSpan(id: string): Promise<boolean> {
  return (await runConfirmed((data) => domain.deleteSpan(data, id), 'Delete span', 'Delete span')) !== null;
}

// --- Attachments ---------------------------------------------------------------------------------

export const addAttachments = (drafts: domain.AttachmentDraft[]): number =>
  run((data, ctx) => domain.addAttachments(data, drafts, ctx))?.value.length ?? 0;

export const removeAttachment = (id: string): boolean => run((data) => domain.deleteAttachment(data, id)) !== null;

// --- Ducts ---------------------------------------------------------------------------------------

export const addDuct = (draft: domain.DuctDraft): Duct | null => run((data, ctx) => domain.createDuct(data, draft, ctx))?.value ?? null;

export const saveDuct = (duct: Duct): boolean => run((data) => domain.updateDuct(data, duct)) !== null;

export async function deleteDuct(id: string): Promise<boolean> {
  return (await runConfirmed((data) => domain.deleteDuct(data, id), 'Delete duct', 'Delete duct')) !== null;
}

// --- Slack loops ---------------------------------------------------------------------------------

export const addSlackLoop = (draft: domain.SlackLoopDraft): SlackLoop | null =>
  run((data, ctx) => domain.createSlackLoop(data, draft, ctx))?.value ?? null;

export async function deleteSlackLoop(id: string): Promise<boolean> {
  return (await runConfirmed((data) => domain.deleteSlackLoop(data, id), 'Delete slack loop', 'Delete')) !== null;
}

// --- Permissions ---------------------------------------------------------------------------------

export const savePermission = (draft: domain.PermissionDraft): Permission | null =>
  run((data, ctx) => domain.savePermission(data, draft, ctx))?.value ?? null;

export async function deletePermission(id: string): Promise<boolean> {
  return (await runConfirmed((data) => domain.deletePermission(data, id), 'Delete permission', 'Delete')) !== null;
}

// --- KML import ----------------------------------------------------------------------------------

export const applyKmlImport = (plan: domain.KmlImportPlan) => run((data, ctx) => domain.importKml(data, plan, ctx))?.value ?? null;

// --- "Same one?" before placing ------------------------------------------------------------------

/**
 * Places equipment from the engineer map, first asking "same one?" when an item of the same kind is
 * already within the duplicate setting. It never blocks: "Add a new one" always works, and that
 * choice is written to the audit trail.
 */
export async function placeEquipmentChecked(draft: domain.EquipmentDraft): Promise<Equipment | null> {
  const state = useNetworkStore.getState();
  const settings = selectOspSettings(state);
  const [twin] = domain.findPossibleDuplicates(state.equipment, draft.type, [draft.lat, draft.lng], settings, 1);
  if (twin) {
    const meters = Math.max(1, Math.round(twin.distanceMeters));
    const addNew = await requestConfirm({
      title: 'Is this the same one?',
      message: `${twin.equipment.name} (${twin.equipment.type}) is already on the map about ${meters} m from here.\n\nIf it is the same ${twin.equipment.type.toLowerCase()}, nothing new is added and it is shown instead.`,
      imageUrl: twin.equipment.images[0]?.url,
      confirmLabel: 'No, add a new one',
      cancelLabel: 'Same one: show it',
    });
    if (!addNew) {
      useUiStore.getState().select({ type: 'equipment', data: twin.equipment });
      // Keep the person's zoom (never zoom out to show it), so the next tap lands where they expect.
      const map = useMapStore.getState();
      map.flyTo(twin.equipment.lat, twin.equipment.lng, Math.max(map.viewport.zoom, 18));
      return null;
    }
    const created = addEquipment(draft);
    if (created) {
      logAudit(
        'POSSIBLE_DUPLICATE_KEPT',
        `${created.name} (${created.id}) added although ${twin.equipment.name} (${twin.equipment.id}) is ${meters} m away; the person chose "new"`,
        created.id,
        'Equipment',
      );
    }
    return created;
  }
  return addEquipment(draft);
}
