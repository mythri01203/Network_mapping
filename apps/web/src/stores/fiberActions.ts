/**
 * Fiber path operations for the engineer screens: cable layout and colours, core assignment,
 * closures and splices, ODF panels and patches, PON port details and splitter ports. Each wraps a
 * pure command from `@fibergis/shared`, so it gets undo, audit, toasts and sync. A warning the
 * command raises is shown first; saving anyway is written to the audit trail.
 */
import * as domain from '@fibergis/shared';

import { type Command, useNetworkStore } from './networkStore';

const run = async <T>(command: Command<T>): Promise<T | null> =>
  (await useNetworkStore.getState().runConfirmedCommand(command, { confirmTitle: 'Please check', confirmLabel: 'Save anyway' }))?.value ?? null;

export const saveCableLayout = (cableId: string, draft: domain.CableLayoutDraft) => run((d, ctx) => domain.setCableLayout(d, cableId, draft, ctx));

export const assignFiber = (draft: domain.CoreAssignmentDraft) => run((d, ctx) => domain.assignCore(d, draft, ctx));
export const releaseFiber = (cableId: string, core: number, reason: string) => run((d, ctx) => domain.releaseCore(d, cableId, core, reason, ctx));

export const setUpClosure = (draft: domain.ClosureDraft) => run((d, ctx) => domain.createClosure(d, draft, ctx));
export const saveClosure = (closureId: string, details: domain.ClosureDetails) => run((d, ctx) => domain.saveClosureDetails(d, closureId, details, ctx));

export const saveSplice = (closureId: string, draft: domain.SpliceDraft) => run((d, ctx) => domain.recordSplice(d, closureId, draft, ctx));
export const takeSpliceOut = (closureId: string, spliceId: string, reason: string) => run((d, ctx) => domain.retireSplice(d, closureId, spliceId, reason, ctx));
export const redoSplice = (closureId: string, oldId: string, draft: domain.SpliceDraft, reason: string) =>
  run((d, ctx) => domain.resplice(d, closureId, oldId, draft, reason, ctx));

export const addPanel = (odfId: string, draft: domain.OdfPanelDraft) => run((d, ctx) => domain.addOdfPanel(d, odfId, draft, ctx));
export const setPortFeeder = (odfId: string, panelId: string, port: number, feeder: { cableId: string; core: number } | null) =>
  run((d, ctx) => domain.setOdfPortFeeder(d, odfId, panelId, port, feeder, ctx));
export const setPortPatch = (odfId: string, panelId: string, port: number, target: { oltId: string; ponPortId: string; cordLabel?: string } | null) =>
  run((d, ctx) => domain.patchOdfPort(d, odfId, panelId, port, target, ctx));

export const savePonPort = (oltId: string, ponPortId: string, details: domain.PonPortDetails) => run((d, ctx) => domain.updatePonPort(d, oltId, ponPortId, details, ctx));

export const addSplitter = (draft: domain.SplitterDraft) => run((d, ctx) => domain.createSplitter(d, draft, ctx));
export const setSplitterInput = (splitterId: string, input: domain.SplitterInput | null) => run((d, ctx) => domain.linkSplitterInput(d, splitterId, input, ctx));
export const setSplitterOutput = (splitterId: string, port: number, target: { cableId: string; core: number; equipmentId?: string } | null) =>
  run((d, ctx) => domain.connectSplitterOutput(d, splitterId, port, target, ctx));
export const saveSplitter = (splitterId: string, details: domain.SplitterDetails) => run((d, ctx) => domain.saveSplitterDetails(d, splitterId, details, ctx));
