import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Cable, Duct, Equipment, SlackLoop } from '@fibergis/shared';

import { useConfirmStore } from './confirmStore';
import { useNetworkStore } from './networkStore';
import { moveStructureChecked, saveDuct, saveInspection } from './ospActions';
import { useOspUiStore } from './ospUiStore';
import { useToastStore } from './toastStore';

const pristine = useNetworkStore.getState();
const NOW = '2026-11-04T09:30:00.000Z';

const pole = (id: string, lat: number, lng: number): Equipment => ({
  id,
  name: id,
  type: 'Telecom Pole',
  category: 'Supporting Infrastructure',
  lat,
  lng,
  area: '',
  street: '',
  status: 'Active',
  images: [],
  installedDate: '',
});

const cable = (id: string, coordinates: [number, number][], extra: Partial<Cable> = {}): Cable => ({
  id,
  name: id,
  type: 'Distribution Fiber',
  fiberCount: 12,
  lengthMeters: 0,
  owner: '',
  installationDate: '',
  status: 'Active',
  coordinates,
  cores: [],
  cableCategory: 'Fiber',
  ...extra,
});

const loop: SlackLoop = { id: 'L1', name: 'Slack 10 m', cableId: 'C1', structureId: 'P1', lat: 12.9, lng: 77.6, lengthMeters: 10, lengthSource: 'entered', createdAt: NOW };

const duct: Duct = {
  id: 'D1',
  name: 'Duct 1',
  coordinates: [
    [12.901, 77.6],
    [12.901, 77.601],
  ],
  status: 'built',
  basis: 'office_drawn',
  cableIds: [],
  subducts: [
    { id: 'S1', label: 'Blue', cableIds: [], condition: 'blocked' },
    { id: 'S2', label: 'Red', cableIds: [], condition: 'damaged' },
  ],
  createdAt: NOW,
};

beforeEach(() => {
  localStorage.clear();
  useNetworkStore.setState(pristine, true);
  useNetworkStore.getState().replaceCollections({
    equipment: [pole('P1', 12.9, 77.6), pole('P2', 12.9, 77.6005), pole('P3', 12.92, 77.62)],
    cables: [cable('C1', [[12.9, 77.6], [12.9, 77.6005]]), cable('C2', [[12.95, 77.65], [12.96, 77.66]])],
    spans: [],
    attachments: [],
    ducts: [duct],
    slackLoops: [loop],
    permissions: [],
    inspections: [],
  });
  useToastStore.setState({ toasts: [] });
  useConfirmStore.setState({ pending: null });
  useOspUiStore.setState({ pendingMove: null });
});

afterEach(() => {
  useConfirmStore.setState({ pending: null });
  useOspUiStore.setState({ pendingMove: null });
});

const tick = async (until: () => boolean) => {
  for (let i = 0; i < 20 && !until(); i += 1) await Promise.resolve();
};

describe('moving a pole on the engineer map (Phase 4)', () => {
  it('moves at once when nothing else is at the old place', async () => {
    expect(await moveStructureChecked('P3', 12.9201, 77.62)).toBe(true);
    expect(useOspUiStore.getState().pendingMove).toBeNull();
    expect(useNetworkStore.getState().equipment.find((e) => e.id === 'P3')).toMatchObject({ lat: 12.9201 });
  });

  it('asks first, and "Do not move" leaves everything where it was', async () => {
    const moving = moveStructureChecked('P1', 12.9001, 77.6);
    await tick(() => !!useOspUiStore.getState().pendingMove);
    const offers = useOspUiStore.getState().pendingMove!.preview.offers.map((o) => o.key);
    expect(offers).toEqual(['cable_point:C1:0', 'slack_loop:L1']);
    useOspUiStore.getState().answerMove(null);
    expect(await moving).toBe(false);
    const state = useNetworkStore.getState();
    expect(state.equipment.find((e) => e.id === 'P1')).toMatchObject({ lat: 12.9 });
    expect(state.slackLoops[0]).toMatchObject({ lat: 12.9 });
  });

  it('moves the pole and only what was ticked, as one undoable step', async () => {
    const moving = moveStructureChecked('P1', 12.9001, 77.6);
    await tick(() => !!useOspUiStore.getState().pendingMove);
    useOspUiStore.getState().answerMove({ slackLoopIds: ['L1'] });
    expect(await moving).toBe(true);
    const state = useNetworkStore.getState();
    expect(state.equipment.find((e) => e.id === 'P1')).toMatchObject({ lat: 12.9001 });
    expect(state.slackLoops[0]).toMatchObject({ lat: 12.9001 });
    expect(state.cables[0].coordinates[0]).toEqual([12.9, 77.6]); // not ticked
    state.undo();
    expect(useNetworkStore.getState().slackLoops[0]).toMatchObject({ lat: 12.9 });
    expect(useNetworkStore.getState().equipment.find((e) => e.id === 'P1')).toMatchObject({ lat: 12.9 });
  });
});

describe('cables in ducts (Phase 4)', () => {
  it('refuses a new cable in a blocked way and saves nothing', async () => {
    const next: Duct = { ...duct, subducts: duct.subducts.map((s) => (s.id === 'S1' ? { ...s, cableIds: ['C2'] } : s)) };
    expect(await saveDuct(next)).toBe(false);
    expect(useNetworkStore.getState().ducts[0].subducts[0].cableIds).toEqual([]);
    expect(useToastStore.getState().toasts.at(-1)?.message).toMatch(/blocked/);
  });

  it('asks "Save anyway?" for a damaged way and logs the choice', async () => {
    const next: Duct = { ...duct, subducts: duct.subducts.map((s) => (s.id === 'S2' ? { ...s, cableIds: ['C2'] } : s)) };
    const saving = saveDuct(next);
    await tick(() => !!useConfirmStore.getState().pending);
    expect(useConfirmStore.getState().pending).toMatchObject({ title: 'Please check', confirmLabel: 'Save anyway' });
    useConfirmStore.getState().respond(true);
    expect(await saving).toBe(true);
    expect(useNetworkStore.getState().ducts[0].subducts[1].cableIds).toEqual(['C2']);
    expect(useNetworkStore.getState().auditLogs.some((l) => l.action === 'WARNING_ACCEPTED')).toBe(true);
  });
});

describe('inspections (Phase 4)', () => {
  it('saves an inspection into its own collection', () => {
    const saved = saveInspection({ targetType: 'pole', targetId: 'P1', inspectedOn: '2026-11-03', inspectedBy: 'Ravi', condition: 'good' });
    expect(saved?.targetId).toBe('P1');
    expect(useNetworkStore.getState().inspections).toHaveLength(1);
  });
});
