import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Cable, Equipment, LatLng } from '@fibergis/shared';

import { useConfirmStore } from '../../stores/confirmStore';
import { useNetworkStore } from '../../stores/networkStore';
import { useToastStore } from '../../stores/toastStore';
import { useUiStore } from '../../stores/uiStore';
import { useRouteEditStore } from '../map/sketch/routeEditStore';
import { askSameCable, editCableLine, saveNewCable, splitCableAt, turnCableRound } from './cableRouteActions';

const pristine = useNetworkStore.getState();

const P: LatLng[] = [
  [12.95, 77.61],
  [12.951, 77.61],
  [12.952, 77.61],
];

const box = (id: string, at: LatLng): Equipment => ({
  id,
  name: id,
  type: 'FAT',
  category: 'Fiber Distribution',
  lat: at[0],
  lng: at[1],
  area: '',
  street: '',
  status: 'Active',
  images: [],
  installedDate: '2026-01-01',
});

const line = (id: string, coordinates: LatLng[]): Cable => ({
  id,
  name: id,
  type: 'Distribution Fiber',
  fiberCount: 2,
  lengthMeters: 999,
  owner: '',
  installationDate: '2026-01-01',
  status: 'Active',
  coordinates,
  startEquipmentId: 'BOX-A',
  endEquipmentId: 'BOX-B',
  cores: [
    { coreNumber: 1, status: 'Available' },
    { coreNumber: 2, status: 'Available' },
  ],
  cableCategory: 'Fiber',
  sheathMarkStart: 10,
  sheathMarkEnd: 230,
  sheathMarkUnit: 'm',
});

beforeEach(() => {
  localStorage.clear();
  useNetworkStore.setState(pristine, true);
  useNetworkStore.getState().replaceCollections({
    equipment: [box('BOX-A', P[0]), box('BOX-B', P[2])],
    cables: [line('CBL-1', P)],
    splitters: [],
    closures: [],
    customers: [],
    attachments: [],
    slackLoops: [],
    ducts: [],
    spans: [],
    permissions: [],
  });
  useUiStore.setState({ selectedObject: null });
  useToastStore.setState({ toasts: [] });
  useConfirmStore.setState({ pending: null });
  useRouteEditStore.getState().stop();
});

afterEach(() => useConfirmStore.setState({ pending: null }));

async function answer(yes: boolean) {
  for (let i = 0; i < 40 && !useConfirmStore.getState().pending; i += 1) await Promise.resolve();
  const pending = useConfirmStore.getState().pending;
  useConfirmStore.getState().respond(yes);
  return pending;
}

const cableNow = (id = 'CBL-1') => useNetworkStore.getState().cables.find((c) => c.id === id);

describe('route tools in the browser', () => {
  it('a line edit is one undo step, and only the drawn length changes', async () => {
    expect(await editCableLine('CBL-1', { kind: 'insert', point: [12.9505, 77.6101] })).toBe(true);
    expect(cableNow()?.coordinates).toHaveLength(4);
    expect(cableNow()?.lengthMeters).not.toBe(999);
    expect(cableNow()).toMatchObject({ sheathMarkStart: 10, sheathMarkEnd: 230 });
    useNetworkStore.getState().undo();
    expect(cableNow()?.coordinates).toHaveLength(3);
    expect(cableNow()?.lengthMeters).toBe(999);
  });

  it('asks before drawing a connected end away, and "no" changes nothing', async () => {
    const pending = editCableLine('CBL-1', { kind: 'move', index: 2, to: [12.9525, 77.611] });
    const question = await answer(false);
    expect(question?.message).toMatch(/no longer be drawn at BOX-B/);
    expect(await pending).toBe(false);
    expect(cableNow()?.coordinates[2]).toEqual(P[2]);
  });

  it('turns a cable round in one step', async () => {
    expect(await turnCableRound('CBL-1')).toBe(true);
    expect(cableNow()).toMatchObject({ startEquipmentId: 'BOX-B', endEquipmentId: 'BOX-A', sheathMarkStart: 230 });
  });

  it('splits after the person reads what moves, and one undo puts it back', async () => {
    const pending = splitCableAt({ cableId: 'CBL-1', index: 1, newCableId: 'CBL-2' });
    const question = await answer(true);
    expect(question?.title).toBe('Split this cable?');
    expect(question?.message).toMatch(/CBL-2/);
    const parts = await pending;
    expect(parts?.second.id).toBe('CBL-2');
    expect(useNetworkStore.getState().cables.map((c) => c.id).sort()).toEqual(['CBL-1', 'CBL-2']);
    useNetworkStore.getState().undo();
    expect(useNetworkStore.getState().cables.map((c) => c.id)).toEqual(['CBL-1']);
    expect(cableNow()?.coordinates).toEqual(P);
  });

  it('asks "same cable?" for a new cable with the same ends along the same line, and never blocks', async () => {
    const asking = askSameCable({ id: 'NEW', startEquipmentId: 'BOX-A', endEquipmentId: 'BOX-B', coordinates: P });
    const question = await answer(true);
    expect(question?.title).toBe('Is this the same cable?');
    expect(await asking).toMatchObject({ cable: { id: 'CBL-1' } });
    expect(await askSameCable({ id: 'NEW', startEquipmentId: 'BOX-A', coordinates: P })).toBeNull();
  });

  it('saves a new cable with its slack loop as one undo step', async () => {
    const created = await saveNewCable({
      draft: { id: 'CBL-9', name: 'New', type: 'Drop Fiber', coordinates: [P[0], [12.95, 77.612]], startEquipmentId: 'BOX-A' },
      slackLoops: [{ structureId: 'BOX-A', lengthMeters: 10 }],
    });
    expect(created?.id).toBe('CBL-9');
    expect(useNetworkStore.getState().slackLoops).toHaveLength(1);
    useNetworkStore.getState().undo();
    expect(cableNow('CBL-9')).toBeUndefined();
    expect(useNetworkStore.getState().slackLoops).toHaveLength(0);
  });
});

describe('route edit screen state', () => {
  it('keeps split for cables only and clears the tapped point on a new tool', () => {
    const store = useRouteEditStore.getState();
    store.start({ kind: 'duct', id: 'D1' }, 'split');
    expect(useRouteEditStore.getState().tool).toBe('move');
    store.start({ kind: 'cable', id: 'CBL-1' }, 'move');
    store.pick(1);
    store.setTool('trim');
    expect(useRouteEditStore.getState()).toMatchObject({ tool: 'trim', picked: null });
    store.setTool('extend');
    store.addExtendPoint([1, 1]);
    expect(useRouteEditStore.getState().extendPoints).toEqual([]);
    store.setExtendEnd('end');
    store.addExtendPoint([1, 1]);
    expect(useRouteEditStore.getState().extendPoints).toEqual([[1, 1]]);
  });
});
