/**
 * Phase 5: cable and duct route operations for the engineer screens. Each is one pure command from
 * `@fibergis/shared`, run through the network store, so it is one undo step with its audit entry,
 * toast and sync. A command that needs a "please check" answer asks first.
 */
import type { Cable, Duct, LatLng } from '@fibergis/shared';
import * as domain from '@fibergis/shared';

import { requestConfirm } from '../../stores/confirmStore';
import { logAudit } from '../../stores/networkActions';
import { type Command, selectOspSettings, useNetworkStore } from '../../stores/networkStore';
import { useUiStore } from '../../stores/uiStore';

const ospSettings = () => selectOspSettings(useNetworkStore.getState());

const runChecked = <T>(command: Command<T>, title: string, label: string) =>
  useNetworkStore.getState().runConfirmedCommand(command, { confirmTitle: title, confirmLabel: label });

/** One change to a cable's line. Resolves true once saved. */
export async function editCableLine(cableId: string, edit: domain.RouteEdit): Promise<boolean> {
  return (await runChecked<Cable>((data) => domain.editCableRoute(data, cableId, edit), 'Please check', 'Change the line')) !== null;
}

/** One change to a duct's line. Resolves true once saved. */
export async function editDuctLine(ductId: string, edit: domain.RouteEdit): Promise<boolean> {
  return (await runChecked<Duct>((data) => domain.editDuctRoute(data, ductId, edit), 'Please check', 'Change the line')) !== null;
}

export async function turnCableRound(cableId: string): Promise<boolean> {
  return (await runChecked<Cable>((data) => domain.reverseCable(data, cableId), 'Turn the cable round?', 'Turn it round')) !== null;
}

export async function turnDuctRound(ductId: string): Promise<boolean> {
  return (await runChecked<Duct>((data) => domain.reverseDuct(data, ductId), 'Turn the duct round?', 'Turn it round')) !== null;
}

/** Splits a cable after the person has read what moves where. Resolves with the two parts. */
export async function splitCableAt(draft: domain.SplitDraft): Promise<domain.SplitResult | null> {
  const settings = ospSettings();
  const result = await runChecked<domain.SplitResult>((data, ctx) => domain.splitCable(data, draft, ctx, settings), 'Split this cable?', 'Split the cable');
  if (result) useUiStore.getState().select({ type: 'cable', data: result.value.first });
  return result?.value ?? null;
}

/** Joins another cable into this one. Resolves with the joined cable. */
export async function joinCables(cableId: string, otherCableId: string): Promise<Cable | null> {
  const settings = ospSettings();
  const result = await runChecked<Cable>((data, ctx) => domain.mergeCables(data, cableId, otherCableId, ctx, settings), 'Join these cables?', 'Join them');
  if (result) useUiStore.getState().select({ type: 'cable', data: result.value });
  return result?.value ?? null;
}

export const joinCandidates = (cableId: string): domain.MergeCandidate[] =>
  domain.mergeCandidates(useNetworkStore.getState(), cableId, ospSettings());

/** Saves how the cable is made. */
export const saveCableBuildDetails = (cableId: string, draft: domain.CableBuildDraft): boolean =>
  useNetworkStore.getState().runCommand((data) => domain.saveCableBuild(data, cableId, draft)) !== null;

/**
 * Asks "Is this the same cable?" when another cable with the same two ends runs along this line.
 * Resolves with the twin the person said it is a different cable from (to log), null when there is
 * none, or false when they want to go back.
 */
export async function askSameCable(candidate: Pick<Cable, 'id' | 'startEquipmentId' | 'endEquipmentId' | 'coordinates'>): Promise<domain.DuplicateRoute | null | false> {
  const [twin] = domain.findDuplicateRoutes(useNetworkStore.getState().cables, candidate, ospSettings());
  if (!twin) return null;
  const goOn = await requestConfirm({
    title: 'Is this the same cable?',
    message: `${twin.cable.name} (${twin.cable.id}) already runs between the same two places, along the same line (${Math.round(twin.overlapRatio * 100)}% of it).\n\nIf it is the same cable, go back and use that one. Two cables on one route can be real, such as a spare or a ring.`,
    confirmLabel: 'No, it is a different cable',
    cancelLabel: 'Go back',
  });
  return goOn ? twin : false;
}

/** Writes the person's "it is a different cable" answer, so the server's warning shows it was seen. */
export const logDifferentCable = (cable: Pick<Cable, 'id' | 'name'>, twin: domain.DuplicateRoute) =>
  logAudit(
    domain.POSSIBLE_DUPLICATE_ROUTE_KEPT,
    `${cable.name} (${cable.id}) saved although ${twin.cable.name} (${twin.cable.id}) has the same two ends along ${Math.round(twin.overlapRatio * 100)}% of the line; the person said it is a different cable`,
    cable.id,
    'Cable',
  );

/** Saves a new cable with its tubes, poles, duct and slack loops as one change (one undo step). */
export async function saveNewCable(setup: domain.CableSetup): Promise<Cable | null> {
  const settings = ospSettings();
  const result = await runChecked<Cable>((data, ctx) => domain.createCableWithSetup(data, setup, ctx, settings), 'Please check', 'Save anyway');
  return result?.value ?? null;
}

/** A copy of a cable's line, for drawing a new cable along the same route. Ends are not copied. */
export const lineOf = (cable: Pick<Cable, 'coordinates'>): LatLng[] => cable.coordinates.map((p) => [p[0], p[1]] as LatLng);
