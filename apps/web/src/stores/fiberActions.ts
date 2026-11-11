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

/** Phase 7: a fiber's condition (faulty, repaired, retired, back in use), with reason and evidence. */
export type FiberConditionChange = 'faulty' | 'repaired' | 'retire' | 'return';
const CONDITION_COMMANDS = {
  faulty: domain.markCoreFaulty,
  repaired: domain.markCoreRepaired,
  retire: domain.retireCore,
  return: domain.returnCoreToService,
} as const;
export const changeFiberCondition = (change: FiberConditionChange, cableId: string, core: number, draft: domain.CoreConditionDraft) =>
  run((d, ctx) => CONDITION_COMMANDS[change](d, cableId, core, draft, ctx));

export const setUpClosure = (draft: domain.ClosureDraft) => run((d, ctx) => domain.createClosure(d, draft, ctx));
export const saveClosure = (closureId: string, details: domain.ClosureDetails) => run((d, ctx) => domain.saveClosureDetails(d, closureId, details, ctx));

export const saveSplice = (closureId: string, draft: domain.SpliceDraft) => run((d, ctx) => domain.recordSplice(d, closureId, draft, ctx));
export const takeSpliceOut = (closureId: string, spliceId: string, reason: string) => run((d, ctx) => domain.retireSplice(d, closureId, spliceId, reason, ctx));
export const redoSplice = (closureId: string, oldId: string, draft: domain.SpliceDraft, reason: string) =>
  run((d, ctx) => domain.resplice(d, closureId, oldId, draft, reason, ctx));
/** Phase 8: "entered by mistake" strikes the splice out and keeps it as history. */
export const markSpliceMistake = (closureId: string, spliceId: string, reason: string) =>
  run((d, ctx) => domain.markSpliceEnteredByMistake(d, closureId, spliceId, reason, ctx));
export const savePigtail = (closureId: string, draft: domain.TerminationDraft) => run((d, ctx) => domain.recordTermination(d, closureId, draft, ctx));
export const takePigtailOut = (closureId: string, id: string, reason: string, mistake = false) =>
  run((d, ctx) => domain.takeTerminationOut(d, closureId, id, reason, { mistake }, ctx));
export const saveTrayCapacity = (closureId: string, trayId: string, capacity: number | undefined) =>
  run((d, ctx) => domain.setTrayCapacity(d, closureId, trayId, capacity, ctx));

export const addPanel = (odfId: string, draft: domain.OdfPanelDraft) => run((d, ctx) => domain.addOdfPanel(d, odfId, draft, ctx));
export const setPortFeeder = (odfId: string, panelId: string, port: number, feeder: domain.OdfFeederChoice | null) =>
  run((d, ctx) => domain.setOdfPortFeeder(d, odfId, panelId, port, feeder, ctx));
export const setPortPatch = (odfId: string, panelId: string, port: number, target: domain.OdfPatchTarget | null) =>
  run((d, ctx) => domain.patchOdfPort(d, odfId, panelId, port, target, ctx));

export const savePonPort = (oltId: string, ponPortId: string, details: domain.PonPortDetails) => run((d, ctx) => domain.updatePonPort(d, oltId, ponPortId, details, ctx));
/** Phase 10: an OLT's shelves, slots and cards; `null` removes the chassis record. */
export const saveChassis = (oltId: string, chassis: domain.OltChassis | null) => run((d, ctx) => domain.saveOltChassis(d, oltId, chassis, ctx));

export const addSplitter = (draft: domain.SplitterDraft) => run((d, ctx) => domain.createSplitter(d, draft, ctx));
export const setSplitterInput = (splitterId: string, input: domain.SplitterInput | null) => run((d, ctx) => domain.linkSplitterInput(d, splitterId, input, ctx));
export const setSplitterOutput = (splitterId: string, port: number, target: domain.SplitterOutputTarget | null) =>
  run((d, ctx) => domain.connectSplitterOutput(d, splitterId, port, target, ctx));
export const saveSplitter = (splitterId: string, details: domain.SplitterDetails) => run((d, ctx) => domain.saveSplitterDetails(d, splitterId, details, ctx));
/** Phase 11: mark a splitter output faulty or reserved, or clear the mark, with a reason kept in its history. */
export const markSplitterPort = (splitterId: string, port: number, mark: domain.SplitterOutputMark, reason: string) =>
  run((d, ctx) => domain.markSplitterOutput(d, splitterId, port, mark, reason, ctx));
/** Phase 11: what a person knows about the splitter's arrangement, with a reason; `null` removes it. */
export const saveSplitterArchitecture = (splitterId: string, draft: domain.SplitterArchitectureDraft | null) =>
  run((d, ctx) => domain.recordSplitterArchitecture(d, splitterId, draft, ctx));
