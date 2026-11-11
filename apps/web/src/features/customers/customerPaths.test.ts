import { afterEach, describe, expect, it } from 'vitest';

import { buildCores, type Cable, type Customer, CUSTOMER_HIDDEN_TEXT, type Equipment, proposeCustomerPathFixes, type Splitter } from '@fibergis/shared';

import { fixCustomerPaths } from '../../stores/connectionActions';
import { useNetworkStore } from '../../stores/networkStore';
import { housePositionNote } from './personalData';

const pristine = useNetworkStore.getState();
afterEach(() => useNetworkStore.setState(pristine, true));

const eq = (id: string, type: Equipment['type'], extra: Partial<Equipment> = {}): Equipment => ({
  id,
  name: id,
  type,
  category: 'Fiber Distribution',
  lat: 17.4,
  lng: 78.4,
  area: '',
  street: '',
  status: 'Active',
  images: [],
  installedDate: '',
  ...extra,
});
const cable = (id: string, fiberCount: number): Cable => ({
  id,
  name: id,
  type: 'Distribution Fiber',
  fiberCount,
  lengthMeters: 100,
  owner: '',
  installationDate: '',
  status: 'Active',
  coordinates: [],
  cores: buildCores(fiberCount),
  cableCategory: 'Fiber',
});
const splitter: Splitter = {
  id: 'SPL-1',
  name: 'SPL-1',
  terminalBoxId: 'FAT-1',
  ratio: '1:8',
  insertionLossDb: 10.5,
  status: 'Active',
  inputPort: { id: 'SPL-1-IN', connectedCableId: 'FEED', connectedCore: 1 },
  outputPorts: Array.from({ length: 8 }, (_, i) => ({
    portNumber: i + 1,
    label: `OUT-${i + 1}`,
    status: i === 1 ? ('Occupied' as const) : ('Available' as const),
    ...(i === 1 ? { connectedCustomerId: 'C1', connectedCustomerName: 'Asha', connectedDropCableId: 'DROP', connectedCore: 1 } : {}),
  })),
};
const asha: Customer = {
  id: 'C1',
  name: 'Asha',
  mobile: '98450 11111',
  address: '12 Lake Road',
  area: '',
  lat: 17.41,
  lng: 78.41,
  serviceType: 'Fiber Broadband',
  plan: '',
  status: 'Active',
  installationDate: '',
  oltId: 'OLT-B',
  ponPort: '',
  feederCableId: '',
  distributionCableId: '',
  terminalBoxId: 'FAT-1',
  splitterId: 'SPL-1',
  splitterOutputPort: 2,
  dropCableId: 'DROP',
  fiberCore: 1,
  ontSerialNumber: '',
  routerModel: '',
  ipAddress: '',
};

const load = (customers: Customer[]) =>
  useNetworkStore.setState({
    equipment: [eq('OLT-1', 'OLT', { ponPorts: [{ id: 'PON-01', portNumber: 1, status: 'Active', connectedFeederCableId: 'FEED', feederCore: 1, connectedCustomersCount: 1 }] }), eq('OLT-B', 'OLT'), eq('FAT-1', 'FAT')],
    cables: [cable('FEED', 12), cable('DROP', 2)],
    splitters: [splitter],
    closures: [],
    customers,
  });

describe('customer paths and hidden personal data in the app (Phase 12)', () => {
  it('fixes a customer from the fibre links only for the ones chosen, with a history line', async () => {
    load([asha]);
    const state = useNetworkStore.getState();
    const fixes = proposeCustomerPathFixes({ equipment: state.equipment, cables: state.cables, splitters: state.splitters, closures: state.closures, customers: state.customers });
    expect(fixes[0].customerPatch).toEqual({ oltId: 'OLT-1', ponPort: 'PON-01', feederCableId: 'FEED', distributionCableId: 'FEED' });
    // Nothing changes until a person confirms the fix.
    expect(useNetworkStore.getState().customers[0].oltId).toBe('OLT-B');
    await fixCustomerPaths(['C1']);
    const fixed = useNetworkStore.getState().customers[0];
    expect(fixed).toMatchObject({ oltId: 'OLT-1', ponPort: 'PON-01', feederCableId: 'FEED' });
    expect(fixed.history?.at(-1)?.action).toBe('PATH_FROM_LINKS');
  });

  it('shows "Hidden for your role" for a hidden house position, not "not recorded"', () => {
    const hidden = { ...asha, name: CUSTOMER_HIDDEN_TEXT, mobile: CUSTOMER_HIDDEN_TEXT, lat: 0, lng: 0, hiddenFields: ['name', 'mobile', 'gps'] as Customer['hiddenFields'] };
    expect(housePositionNote(hidden)).toEqual({ text: `House position: ${CUSTOMER_HIDDEN_TEXT}`, hidden: true });
    expect(housePositionNote({ ...asha, lat: 0, lng: 0 })).toEqual({ text: 'House location not recorded', hidden: false });
    expect(housePositionNote(asha)).toBeUndefined();
  });
});
