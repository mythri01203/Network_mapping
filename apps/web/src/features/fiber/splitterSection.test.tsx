import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';

import { type Equipment, type Splitter, splitterOutputSummary, splitterOutputUse, splitterPlace } from '@fibergis/shared';

import { markSplitterPort, setSplitterOutput } from '../../stores/fiberActions';
import { useNetworkStore } from '../../stores/networkStore';
import { SplitterSection } from './PlantSections';
import { SplitterOutputDetail, SplitterPlaceBlock } from './SplitterParts';

const pristine = useNetworkStore.getState();
afterEach(() => useNetworkStore.setState(pristine, true));

const fat: Equipment = {
  id: 'FAT-1',
  name: 'Box 1',
  type: 'FAT',
  category: 'Fiber Distribution',
  lat: 17.4,
  lng: 78.4,
  area: '',
  street: '',
  status: 'Active',
  images: [],
  installedDate: '',
};

const ports = (n: number) => Array.from({ length: n }, (_, i) => ({ portNumber: i + 1, label: `OUT-${i + 1}`, status: 'Available' as const }));

const top: Splitter = { id: 'SPL-A', name: 'Top', terminalBoxId: 'FAT-1', ratio: '1:4', insertionLossDb: 7.2, status: 'Active', inputPort: { id: 'SPL-A-IN' }, outputPorts: ports(3) };
const child: Splitter = {
  id: 'SPL-B',
  name: 'Child',
  terminalBoxId: 'FAT-1',
  ratio: '1:8',
  insertionLossDb: 10.5,
  status: 'Active',
  inputPort: { id: 'SPL-B-IN', connectedSplitterId: 'SPL-A', connectedSplitterPort: 1 },
  outputPorts: ports(8),
};

const drop = {
  id: 'DROP-1',
  name: 'Drop 1',
  type: 'Drop Fiber' as const,
  fiberCount: 2,
  lengthMeters: 50,
  installationType: 'Aerial' as const,
  owner: '',
  installationDate: '',
  status: 'Active' as const,
  coordinates: [] as [number, number][],
  cores: [],
  cableCategory: 'Fiber' as const,
  startEquipmentId: 'FAT-1',
};

describe('splitter section (Phase 11)', () => {
  it('shows level, arrangement and split from the records, and never guesses a level', () => {
    const data = { equipment: [fat], splitters: [top, child], cables: [], customers: [], closures: [] };
    // The top splitter's input is not linked, so no level is guessed for either.
    const html = renderToStaticMarkup(<SplitterPlaceBlock place={splitterPlace(data, 'SPL-B')!} />);
    expect(html).toContain('Distributed (cascaded)');
    expect(html).toContain('Not known (at least 2)');
    expect(html).toContain('at least 1:32 (1:4 × 1:8)');
    expect(html).toContain('How this was worked out');
    expect(html).toContain('Record what you know');
    const topHtml = renderToStaticMarkup(<SplitterPlaceBlock place={splitterPlace(data, 'SPL-A')!} />);
    expect(topHtml).toContain('>Not known<');
    // Output 4 of the 1:4 has no port record: "not recorded", never free.
    expect(splitterOutputSummary(splitterOutputUse(data, top).counts)).toBe('4 outputs: 1 in use, 2 free, 0 reserved, 0 faulty, 1 not recorded');
  });

  it('renders the section with the store data', () => {
    const html = renderToStaticMarkup(<SplitterSection host={fat} />);
    expect(html).toContain('Add a splitter');
  });

  it('marks an output faulty through the store, and connects it only with a reason', async () => {
    useNetworkStore.setState({ equipment: [fat], splitters: [top], cables: [drop], customers: [], closures: [] });
    expect(await markSplitterPort('SPL-A', 2, 'faulty', 'No light')).not.toBeNull();
    expect(useNetworkStore.getState().splitters[0].outputPorts[1].status).toBe('Faulty');
    expect(await setSplitterOutput('SPL-A', 2, { cableId: 'DROP-1', core: 1 })).toBeNull();
    expect(useNetworkStore.getState().splitters[0].outputPorts[1].connectedDropCableId).toBeUndefined();
    expect(await setSplitterOutput('SPL-A', 2, { cableId: 'DROP-1', core: 1, overrideReason: 'Only output left' })).not.toBeNull();
    const port = useNetworkStore.getState().splitters[0].outputPorts[1];
    expect(port).toMatchObject({ status: 'Faulty', connectedDropCableId: 'DROP-1', override: { reason: 'Only output left' } });
  });

  it('the output detail asks why a faulty output is used, and shows its reason', () => {
    const faulty: Splitter = {
      ...top,
      outputPorts: top.outputPorts.map((p) => (p.portNumber === 2 ? { ...p, status: 'Faulty' as const, history: [{ at: '2026-11-10T08:00:00.000Z', by: 'Ravi', action: 'MARKED_FAULTY', details: 'Marked faulty: No light' }] } : p)),
    };
    const use = splitterOutputUse({ splitters: [faulty], customers: [] }, faulty).outputs[1];
    const html = renderToStaticMarkup(<SplitterOutputDetail splitter={faulty} use={use} cables={[drop]} />);
    expect(html).toContain('Faulty: No light (2026-11-10, Ravi)');
    expect(html).toContain('This output is marked faulty. Why connect it anyway?');
    expect(html).toContain('Mark repaired');
    expect(html).not.toContain('>Reserve<');
  });
});
