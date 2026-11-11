import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';

import type { Equipment, Rack } from '@fibergis/shared';

import { useNetworkStore } from '../../stores/networkStore';
import { addRack, addSite, placeItemInRack, removeRack } from '../../stores/plantActions';
import { odfPortState } from '../fiber/odfUi';
import { RackElevation } from './RackElevation';

const pristine = useNetworkStore.getState();

const item = (id: string, extra: Partial<Equipment> = {}): Equipment => ({
  id,
  name: id,
  type: 'ODF',
  category: 'Central Office',
  lat: 17.4,
  lng: 78.4,
  area: '',
  street: '',
  status: 'Active',
  images: [],
  installedDate: '',
  ...extra,
});

const rack: Rack = { id: 'RACK-1', siteId: 'SITE-1', name: 'Rack 1', heightUnits: 6 };

afterEach(() => useNetworkStore.setState(pristine, true));

describe('rack elevation (Phase 9)', () => {
  it('draws each unit with what fills it and marks the rest free', () => {
    const items = [item('OLT-A', { type: 'OLT', rackId: 'RACK-1', siteId: 'SITE-1', rackUnit: 2, rackUnits: 2 }), item('ODF-A', { rackId: 'RACK-1', siteId: 'SITE-1', rackUnit: 5 })];
    const html = renderToStaticMarkup(<RackElevation rack={rack} items={items} />);
    expect(html).toContain('Free, as recorded: units 1, 4, 6 (3 of 6).');
    expect(html).toContain('1 item(s) have no height recorded');
    expect(html).toContain('height not recorded');
    expect(html).toContain('Numbering not recorded');
    expect(html).toContain('data-testid="rack-item-OLT-A"');
    // Unit 1 at the bottom: OLT-A fills units 2 to 3, rows 4 and 5 of 6.
    expect(html).toMatch(/grid-row:4 \/ span 2[^>]*data-testid="rack-item-OLT-A"/);
  });

  it('calls nothing free when the rack height is not recorded', () => {
    const tall: Rack = { id: 'RACK-2', siteId: 'SITE-1', name: 'Wall frame' };
    const html = renderToStaticMarkup(<RackElevation rack={tall} items={[item('ODF-B', { rackId: 'RACK-2', rackUnit: 3 })]} />);
    expect(html).toContain('Height not recorded');
    expect(html).toContain('Record the rack height to see free units');
    expect(html).not.toContain('Free, as recorded');
  });
});

describe('sites and racks in the store', () => {
  it('saves sites, racks and an item place, and refuses deleting a rack in use', async () => {
    useNetworkStore.setState({ sites: [], racks: [], equipment: [item('ODF-C')] });
    const s = await addSite({ name: 'Hub room' });
    const r = await addRack({ siteId: s!.id, name: 'R1', heightUnits: 42 });
    await placeItemInRack('ODF-C', { rackId: r!.id, rackUnit: 10, rackUnits: 1 });
    const state = useNetworkStore.getState();
    expect(state.sites).toHaveLength(1);
    expect(state.equipment[0]).toMatchObject({ siteId: s!.id, rackId: r!.id, rackUnit: 10 });
    expect(await removeRack(r!.id)).toBeNull();
    expect(useNetworkStore.getState().racks).toHaveLength(1);
    // Undo covers the new collections.
    useNetworkStore.getState().undo();
    expect(useNetworkStore.getState().equipment[0].rackId).toBeUndefined();
  });
});

describe('ODF port tiles', () => {
  it('say the state in words and a mark, not colour alone', () => {
    const base = { id: 'X', number: 1, status: 'available' as const };
    expect(odfPortState({ ...base, status: 'damaged' })).toMatchObject({ mark: '✕', word: 'Faulty' });
    expect(odfPortState({ ...base, status: 'reserved' })).toMatchObject({ mark: 'R', word: 'Reserved' });
    expect(odfPortState(base)).toMatchObject({ word: 'Free' });
    expect(odfPortState({ ...base, feederCableId: 'C', feederCore: 1 }).word).toBe('Fiber behind, not patched');
  });
});
