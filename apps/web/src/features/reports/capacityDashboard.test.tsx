import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';

import { DEFAULT_OPTICAL_SETTINGS, DEFAULT_OSP_SETTINGS, type Equipment, type Splitter } from '@fibergis/shared';

import { useNetworkStore } from '../../stores/networkStore';
import { addScenario, updateScenario } from '../../stores/planningActions';
import { CapacityDashboardView } from './CapacityDashboardModal';
import { ScenarioPanel } from './ScenarioPanel';

const pristine = useNetworkStore.getState();

const box = (id: string, extra: Partial<Equipment> = {}): Equipment => ({
  id,
  name: id,
  type: 'FAT',
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

const splitter = (id: string, boxId: string, recorded: number): Splitter => ({
  id,
  name: id,
  terminalBoxId: boxId,
  ratio: '1:8',
  insertionLossDb: 10.5,
  status: 'Active',
  inputPort: { id: `${id}-in` },
  outputPorts: Array.from({ length: recorded }, (_, i) => ({ portNumber: i + 1, label: `${i + 1}`, status: i < recorded - 1 ? ('Occupied' as const) : ('Available' as const) })),
});

afterEach(() => {
  useNetworkStore.setState(pristine, true);
});

describe('capacity dashboard (Phase 18)', () => {
  it('says nearly full from the records, keeps planned apart and never counts not recorded as free', () => {
    const data = {
      equipment: [box('FAT-1'), box('FAT-2', { status: 'Planned' }), box('OLT-1', { type: 'OLT', ponPorts: [{ id: 'PON-1', portNumber: 1, status: 'Available' as const, connectedCustomersCount: 0 }] })],
      splitters: [splitter('SPL-1', 'FAT-1', 8), splitter('SPL-2', 'FAT-2', 4)],
      customers: [],
      cables: [],
      planningScenarios: [],
    };
    // Server rendering reads a store's first state, so the view is given its data.
    const html = renderToStaticMarkup(
      <CapacityDashboardView data={data} settingRecords={[]} faults={[]} optical={DEFAULT_OPTICAL_SETTINGS} osp={DEFAULT_OSP_SETTINGS} mayConfigure={false} onClose={() => {}} onOpenReports={() => {}} />,
    );
    expect(html).toContain('By kind: built and planned kept apart');
    expect(html).toContain('Planned, proposed or awaiting review');
    // SPL-1: 7 of 8 occupied, 1 free: nearly full at the 80% default.
    expect(html).toContain('Nearly full');
    expect(html).toContain('1 of 8 outputs free');
    // SPL-2: 4 outputs have no record: not free.
    expect(html).toContain('4 not recorded');
    // PON-1 has no ONU limit: not known.
    expect(html).toContain('with capacity not recorded');
    expect(html).toContain('Expansion scenarios');
  });

  it('a scenario is stored in its own collection and changes no network record', () => {
    useNetworkStore.setState({ equipment: [box('FAT-1')], splitters: [splitter('SPL-1', 'FAT-1', 8)], customers: [], cables: [], planningScenarios: [] });
    const before = useNetworkStore.getState();
    const made = addScenario({ name: 'Ward 12' });
    expect(made).not.toBeNull();
    const saved = updateScenario({ ...made!, items: [{ id: 'L1', kind: 'customers', count: 3, splitterId: 'SPL-1' }] });
    expect(saved?.items).toHaveLength(1);
    const after = useNetworkStore.getState();
    expect(after.planningScenarios).toHaveLength(1);
    expect(after.equipment).toBe(before.equipment);
    expect(after.splitters).toBe(before.splitters);
    expect(after.customers).toBe(before.customers);
    const html = renderToStaticMarkup(
      <ScenarioPanel data={{ equipment: after.equipment, splitters: after.splitters, customers: after.customers, cables: after.cables, planningScenarios: after.planningScenarios }} optical={DEFAULT_OPTICAL_SETTINGS} osp={DEFAULT_OSP_SETTINGS} />,
    );
    expect(html).toContain('A plan only');
    // SPL-1 has 1 free output; 3 more customers are short by 2.
    expect(html).toContain('Short by 2 output(s)');
    expect(html).toContain('3 more customer(s) on splitter SPL-1');
  });
});
