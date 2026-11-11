import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';

import { buildOltPonPorts, type Customer, customersOnPonPort, disconnectCustomer, type Equipment, type OltChassis, ponPortUsage } from '@fibergis/shared';

import { saveChassis } from '../../stores/fiberActions';
import { useNetworkStore } from '../../stores/networkStore';
import { OltChassisSection } from './OltChassisSection';

const pristine = useNetworkStore.getState();
afterEach(() => useNetworkStore.setState(pristine, true));

const olt = (extra: Partial<Equipment> = {}): Equipment => {
  const base: Equipment = {
    id: 'OLT-A',
    name: 'Hub OLT',
    type: 'OLT',
    category: 'Central Office',
    lat: 17.4,
    lng: 78.4,
    area: '',
    street: '',
    status: 'Active',
    technology: 'GPON',
    totalPorts: 12,
    images: [],
    installedDate: '',
    ...extra,
  };
  // PON-01 carries an old stored counter of 16 that no record backs.
  const ponPorts = buildOltPonPorts(base).map((p) => (p.id === 'PON-01' ? { ...p, connectedCustomersCount: 16, maxOnu: 64 } : p));
  return { ...base, ponPorts };
};

const customer = (id: string, status: Customer['status'] = 'Active'): Customer => ({
  id,
  name: id,
  mobile: '',
  address: '',
  area: '',
  lat: 17.41,
  lng: 78.41,
  serviceType: 'Fiber Broadband',
  plan: '',
  status,
  installationDate: '',
  oltId: 'OLT-A',
  ponPort: 'PON-01',
  feederCableId: '',
  distributionCableId: '',
  terminalBoxId: '',
  splitterId: '',
  splitterOutputPort: 0,
  dropCableId: '',
  fiberCore: 0,
  ontSerialNumber: '',
  routerModel: '',
  ipAddress: '',
});

const chassis: OltChassis = {
  model: 'C320',
  shelves: [
    {
      id: 'SH-1',
      label: '1',
      slots: [
        { id: 'SL-3', label: '3', card: { model: 'GTGO', kind: 'pon', portCount: 8, ponPortIds: buildOltPonPorts({ totalPorts: 8 }).map((p) => p.id) } },
        { id: 'SL-4', label: '4', card: { model: 'GTGH', kind: 'pon', portCount: 4, ponPortIds: ['PON-09', 'PON-10', 'PON-11', 'PON-12'] } },
        { id: 'SL-5', label: '5' },
      ],
    },
  ],
};

describe('OLT chassis section (Phase 10)', () => {
  it('shows the older rack, shelf and slot "as written" when no chassis is recorded', () => {
    const html = renderToStaticMarkup(<OltChassisSection olt={olt({ rackNumber: 'R-2', slotNumber: '5' })} />);
    expect(html).toContain('No shelves or cards recorded.');
    expect(html).toContain('R-2 <span class="font-normal text-slate-500">(as written)</span>');
    expect(html).toContain('Record shelves and cards');
  });

  it('lists shelves, slots and cards as recorded, with blanks said plainly', () => {
    const html = renderToStaticMarkup(<OltChassisSection olt={olt({ chassis })} />);
    expect(html).toContain('Shelf 1');
    expect(html).toContain('GTGH');
    expect(html).toContain('PON-09, PON-10, PON-11, PON-12');
    expect(html).toContain('PON-01 … PON-08 (8)');
    expect(html).toContain('Empty slot');
    expect(html).not.toContain('Cannot save');
  });

  it('saves the chassis through the store, and refuses a port on two cards', async () => {
    useNetworkStore.setState({ equipment: [olt()] });
    expect(await saveChassis('OLT-A', chassis)).not.toBeNull();
    expect(useNetworkStore.getState().equipment[0].chassis?.shelves[0].slots).toHaveLength(3);
    const broken: OltChassis = structuredClone(chassis);
    broken.shelves[0].slots[1].card!.ponPortIds = ['PON-08'];
    expect(await saveChassis('OLT-A', broken)).toBeNull();
    expect(useNetworkStore.getState().equipment[0].chassis?.shelves[0].slots[1].card?.ponPortIds).toEqual(['PON-09', 'PON-10', 'PON-11', 'PON-12']);
  });
});

describe('PON counts after store commands (Phase 10)', () => {
  it('a disconnect sets the cached count from the records, so a drifted 16 becomes the real number', async () => {
    const c1 = customer('C1');
    useNetworkStore.setState({ equipment: [olt()], customers: [c1, customer('C2'), customer('C3', 'Disconnected')], cables: [], splitters: [], onts: [], services: [] });
    expect(customersOnPonPort(useNetworkStore.getState().customers, 'OLT-A', 'PON-01')).toHaveLength(2);
    await useNetworkStore.getState().runConfirmedCommand((d, ctx) => disconnectCustomer(d, 'C1', 'Moved away', ctx), { skipConfirm: true });
    const state = useNetworkStore.getState();
    expect(state.customers.find((c) => c.id === 'C1')?.status).toBe('Disconnected');
    expect(state.equipment[0].ponPorts?.find((p) => p.id === 'PON-01')?.connectedCustomersCount).toBe(1);
    expect(ponPortUsage(state, 'OLT-A', 'PON-01')).toMatchObject({ ontCount: 1, limit: 64, free: 63 });
  });
});
