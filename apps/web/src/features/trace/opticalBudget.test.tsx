import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { budgetRunsFor, type Cable, type Customer, type Equipment, type JointClosure, type Splitter, traceCustomerCores } from '@fibergis/shared';

import { storeBudgetRun } from '../../stores/budgetRunActions';
import { useNetworkStore } from '../../stores/networkStore';
import { BudgetRunList, OpticalBudgetPanel } from './OpticalBudgetPanel';

/** Network mapping Phase 17: the budget panel on the Route Trace screen, and stored runs. */

vi.mock('leaflet', () => ({ default: {} }));

const pristine = useNetworkStore.getState();

const olt = (opticsClass?: 'GPON B+'): Equipment => ({
  id: 'OLT-1',
  name: 'OLT 1',
  type: 'OLT',
  category: 'Central Office',
  technology: 'GPON',
  lat: 12.9,
  lng: 77.6,
  area: '',
  street: '',
  status: 'Active',
  images: [],
  installedDate: '',
  ponPorts: [{ id: 'PON-01', status: 'Active', connectedFeederCableId: 'FDR', feederCore: 1, ...(opticsClass ? { opticsClass } : {}) } as NonNullable<Equipment['ponPorts']>[number]],
});
const box: Equipment = { ...olt(), id: 'FAT-1', name: 'FAT 1', type: 'FAT', category: 'Fiber Distribution', ponPorts: undefined, lat: 12.91 };
const cores = (n: number) => Array.from({ length: n }, (_, i) => ({ coreNumber: i + 1, status: 'Available' as const }));
const cable = (id: string, from: string, to: string): Cable => ({
  id,
  name: id,
  type: 'Distribution Fiber',
  fiberCount: 12,
  lengthMeters: 500,
  owner: '',
  installationDate: '',
  status: 'Active',
  startEquipmentId: from,
  endEquipmentId: to,
  coordinates: [
    [12.9, 77.6],
    [12.91, 77.6],
  ],
  cores: cores(12),
  cableCategory: 'Fiber',
});
const closure: JointClosure = {
  id: 'CL-1',
  name: 'CL-1',
  closureType: 'Horizontal In-line',
  lat: 12.905,
  lng: 77.6,
  area: '',
  entryPortsCount: 2,
  exitPortsCount: 2,
  installationDate: '',
  technician: '',
  images: [],
  splices: [{ id: 'S1', inputCableId: 'FDR', inputCableName: 'FDR', inputCore: 1, outputCableId: 'DIST', outputCableName: 'DIST', outputCore: 1, status: 'Spliced', technician: 'Asha', date: '2026-02-03' }],
};
const splitter = (insertionLossDb: number): Splitter => ({
  id: 'SPL-1',
  name: 'SPL-1',
  terminalBoxId: 'FAT-1',
  ratio: '1:8',
  insertionLossDb,
  status: 'Active',
  inputPort: { id: 'SPL-1-IN', connectedCableId: 'DIST', connectedCore: 1 },
  outputPorts: Array.from({ length: 8 }, (_, i) => ({ portNumber: i + 1, label: `OUT-${i + 1}`, status: 'Available' as const, ...(i === 0 ? { connectedDropCableId: 'DROP', connectedCore: 1 } : {}) })),
});
const customer = { id: 'CU-1', name: 'Asha Devi', status: 'Active', dropCableId: 'DROP', fiberCore: 1, lat: 12.912, lng: 77.6 } as unknown as Customer;

function load(opts: { opticsClass?: 'GPON B+'; splitterLoss?: number } = {}) {
  useNetworkStore.getState().replaceCollections({
    equipment: [olt(opts.opticsClass), box],
    cables: [cable('FDR', 'OLT-1', 'FAT-1'), cable('DIST', 'OLT-1', 'FAT-1'), cable('DROP', 'FAT-1', 'CU-1')],
    splitters: [splitter(opts.splitterLoss ?? 10.5)],
    closures: [closure],
    customers: [{ ...(pristine.customers[0] ?? {}), ...customer } as Customer],
    settings: [],
    opticalBudgetRuns: [],
  });
  const s = useNetworkStore.getState();
  return traceCustomerCores(s.customers[0], { equipment: s.equipment, cables: s.cables, splitters: s.splitters, closures: s.closures, customers: s.customers });
}

beforeEach(() => {
  localStorage.clear();
  useNetworkStore.setState(pristine, true);
});

describe('the optical budget panel', () => {
  it('says "Estimated with default class" and flags every input not from the records', () => {
    const path = load();
    expect(path.complete).toBe(true);
    const html = renderToStaticMarkup(<OpticalBudgetPanel path={path} />);
    expect(html).toContain('Estimated with default class');
    expect(html).not.toContain('Fits with margin');
    expect(html).not.toContain('Over budget');
    expect(html).toContain('not from your records');
    expect(html).toContain('Drawn line on the map');
    expect(html).toContain('Default, not your network');
    expect(html).toContain('optical.splice.fusion');
    expect(html).toContain('How it was worked out');
    expect(html).toContain('Estimated, not measured');
  });

  it('gives a pass or fail only with a recorded class', () => {
    const html = renderToStaticMarkup(<OpticalBudgetPanel path={load({ opticsClass: 'GPON B+' })} />);
    expect(html).not.toContain('Estimated with default class');
    expect(html).toMatch(/Fits with margin|Fits, but under the repair margin|Too little loss|Over budget/);
  });

  it('shows a splitter with no loss as unknown, with no budget and nothing to store', () => {
    const path = load({ opticsClass: 'GPON B+', splitterLoss: 0 });
    const html = renderToStaticMarkup(<OpticalBudgetPanel path={path} />);
    expect(html).toContain('Unknown');
    expect(html).toContain('No budget');
    expect(storeBudgetRun(path)).toBeNull();
    expect(useNetworkStore.getState().opticalBudgetRuns).toEqual([]);
  });

  it('stores a run with the time and who, and lists it, without touching the network', () => {
    const path = load({ opticsClass: 'GPON B+' });
    const before = useNetworkStore.getState();
    const run = storeBudgetRun(path, 'Before handover');
    expect(run).not.toBeNull();
    const after = useNetworkStore.getState();
    expect(after.opticalBudgetRuns).toHaveLength(1);
    expect(after.customers).toBe(before.customers);
    expect(after.splitters).toBe(before.splitters);
    expect(JSON.stringify(run)).not.toContain('Asha Devi');
    // Static rendering reads the store's first state, so the list is rendered from the stored runs.
    const html = renderToStaticMarkup(<BudgetRunList runs={budgetRunsFor(after, customer.id)} />);
    expect(html).toContain('Stored runs for this path (1)');
    expect(html).toContain('Before handover');
    expect(html).toContain(`by ${run!.ranBy}`);
  });
});
