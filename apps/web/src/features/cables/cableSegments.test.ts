import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Cable, Equipment } from '@fibergis/shared';

import { useConfirmStore } from '../../stores/confirmStore';
import { DEFAULT_LAYERS } from '../../stores/mapStore';
import { useNetworkStore } from '../../stores/networkStore';
import { deleteCableSegment, saveCableSegment } from '../../stores/segmentActions';
import { useToastStore } from '../../stores/toastStore';
import { cableInstallLayers, cableLayersOf, isCableVisible } from '../map/layerFilters';
import { useSegmentPickStore } from './segmentPickStore';

/** Network mapping Phase 6: cable stretches in the browser store, the pick state and the map layers. */

const pristine = useNetworkStore.getState();

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

const cable = (extra: Partial<Cable> = {}): Cable => ({
  id: 'C1',
  name: 'Main street',
  type: 'Distribution Fiber',
  fiberCount: 12,
  lengthMeters: 222,
  owner: '',
  installationDate: '',
  status: 'Active',
  coordinates: [
    [12.9, 77.6],
    [12.901, 77.6],
    [12.902, 77.6],
  ],
  cores: [],
  cableCategory: 'Fiber',
  ...extra,
});

const tick = async (until: () => boolean) => {
  for (let i = 0; i < 50 && !until(); i += 1) await new Promise((r) => setTimeout(r, 0));
};

beforeEach(() => {
  localStorage.clear();
  useNetworkStore.setState(pristine, true);
  useNetworkStore.getState().replaceCollections({
    equipment: [pole('P1', 12.9, 77.6), pole('P2', 12.901, 77.6)],
    cables: [cable()],
    spans: [],
    attachments: [],
    ducts: [],
    slackLoops: [],
    permissions: [],
    inspections: [],
    cableSegments: [],
  });
  useToastStore.setState({ toasts: [] });
  useConfirmStore.setState({ pending: null });
  useSegmentPickStore.setState({ job: null, taps: [], result: null, highlight: null });
});

afterEach(() => {
  useConfirmStore.getState().respond(false);
});

describe('stretches in the store', () => {
  it('saves a stretch as one undo step, and keeps the cable one record', async () => {
    const saved = await saveCableSegment({ cableId: 'C1', from: { structureId: 'P1' }, to: { structureId: 'P2' }, installMethod: 'Aerial' });
    expect(saved?.fromStructureId).toBe('P1');
    const state = useNetworkStore.getState();
    expect(state.cableSegments).toHaveLength(1);
    expect(state.cables).toHaveLength(1);
    state.undo();
    expect(useNetworkStore.getState().cableSegments).toEqual([]);
  });

  it('refuses an overlap and saves nothing', async () => {
    await saveCableSegment({ cableId: 'C1', from: { meters: 0 }, to: { meters: 120 } });
    expect(await saveCableSegment({ cableId: 'C1', from: { meters: 100 }, to: { meters: 200 } })).toBeNull();
    expect(useNetworkStore.getState().cableSegments).toHaveLength(1);
    expect(useToastStore.getState().toasts.at(-1)?.message).toMatch(/overlaps/);
  });

  it('asks before saving lengths longer than the drawn line, and "Save anyway" is audited', async () => {
    const saving = saveCableSegment({ cableId: 'C1', from: { meters: 0 }, to: { meters: 200 }, measuredLengthMeters: 400 });
    await tick(() => !!useConfirmStore.getState().pending);
    expect(useConfirmStore.getState().pending?.message).toMatch(/more than the drawn line/);
    useConfirmStore.getState().respond(true);
    expect(await saving).not.toBeNull();
    expect(useNetworkStore.getState().auditLogs.some((a) => a.action === 'WARNING_ACCEPTED')).toBe(true);
  });

  it('deletes a stretch after asking, and the cable stays', async () => {
    const saved = await saveCableSegment({ cableId: 'C1', from: { meters: 0 }, to: { meters: 100 } });
    const deleting = deleteCableSegment(saved!.id);
    await tick(() => !!useConfirmStore.getState().pending);
    useConfirmStore.getState().respond(true);
    expect(await deleting).toBe(true);
    expect(useNetworkStore.getState().cableSegments).toEqual([]);
    expect(useNetworkStore.getState().cables).toHaveLength(1);
  });
});

describe('tapping two points', () => {
  it('gives the two distances to the panel once, in the order tapped', () => {
    const pick = useSegmentPickStore.getState();
    pick.start({ cableId: 'C1' });
    useSegmentPickStore.getState().tap(150);
    expect(useSegmentPickStore.getState().taps).toEqual([150]);
    useSegmentPickStore.getState().tap(40);
    expect(useSegmentPickStore.getState().job).toBeNull();
    expect(useSegmentPickStore.getState().take('OTHER')).toBeNull();
    expect(useSegmentPickStore.getState().take('C1')?.meters).toEqual([150, 40]);
    expect(useSegmentPickStore.getState().take('C1')).toBeNull();
  });
});

describe('install layers for a cable with mixed stretches', () => {
  const visibility = { networkMode: 'All' as const, layers: { ...DEFAULT_LAYERS } };
  const mixed = new Map([['C1', ['Aerial', 'Duct'] as const]]);

  it('is in both install layers, and stays shown while either is on', () => {
    const c = cable();
    expect(cableInstallLayers(c, ['Aerial', 'Duct'])).toEqual(['aerialCable', 'undergroundCable']);
    expect(cableLayersOf(c, ['Aerial', 'Duct'])).toEqual(['distributionCable', 'aerialCable', 'undergroundCable']);
    expect(isCableVisible(c, { ...visibility, segmentMethods: mixed })).toBe(true);
    expect(isCableVisible(c, { ...visibility, layers: { ...DEFAULT_LAYERS, aerialCable: false }, segmentMethods: mixed })).toBe(true);
    expect(isCableVisible(c, { ...visibility, layers: { ...DEFAULT_LAYERS, aerialCable: false, undergroundCable: false }, segmentMethods: mixed })).toBe(false);
    // The role layer still hides it.
    expect(isCableVisible(c, { ...visibility, layers: { ...DEFAULT_LAYERS, distributionCable: false }, segmentMethods: mixed })).toBe(false);
  });

  it('without stretches, behaves as before (its own method only)', () => {
    const aerial = cable({ installationType: 'Aerial' });
    expect(cableInstallLayers(aerial)).toEqual(['aerialCable']);
    expect(isCableVisible(aerial, { ...visibility, layers: { ...DEFAULT_LAYERS, aerialCable: false } })).toBe(false);
    // Its own method and a stretch's method together.
    expect(cableInstallLayers(aerial, ['Direct Buried'])).toEqual(['aerialCable', 'undergroundCable']);
  });
});
