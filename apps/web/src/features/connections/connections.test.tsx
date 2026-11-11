import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Cable, Equipment, JointClosure, Splitter } from '@fibergis/shared';

import { useConfirmStore } from '../../stores/confirmStore';
import { saveLinkCheck } from '../../stores/linkCheckActions';
import { useNetworkStore } from '../../stores/networkStore';
import { useToastStore } from '../../stores/toastStore';
import { ConnectionsView } from './ConnectionsPanel';
import { connectionIndexOf, readingFrom } from './connectionsUi';

/** Network mapping Phase 13: the Connections panel and "Record a check". */

vi.mock('leaflet', () => ({ default: {} }));

const pristine = useNetworkStore.getState();

/** The index of what is in the store now (server rendering reads a store's first state, so it is passed in). */
const storeIndex = () => {
  const s = useNetworkStore.getState();
  return connectionIndexOf({ ...s, schemes: [] });
};

const box = (id: string): Equipment => ({ id, name: id, type: 'FAT', category: 'Fiber Distribution', lat: 12.9, lng: 77.6, area: '', street: '', status: 'Active', images: [], installedDate: '' });
const cores = (n: number) => Array.from({ length: n }, (_, i) => ({ coreNumber: i + 1, status: 'Available' as const }));
const cable = (id: string): Cable => ({ id, name: id, type: 'Distribution Fiber', fiberCount: 12, lengthMeters: 0, owner: '', installationDate: '', status: 'Active', coordinates: [], cores: cores(12), cableCategory: 'Fiber' });
const splitter: Splitter = {
  id: 'SPL-1',
  name: 'SPL-1',
  terminalBoxId: 'FAT-1',
  ratio: '1:8',
  insertionLossDb: 10.5,
  status: 'Active',
  inputPort: { id: 'SPL-1-IN', connectedCableId: 'DIST', connectedCore: 1 },
  outputPorts: Array.from({ length: 8 }, (_, i) => ({ portNumber: i + 1, label: `OUT-${i + 1}`, status: 'Available' as const })),
};
const closure: JointClosure = {
  id: 'CL-1',
  name: 'CL-1',
  closureType: 'Horizontal In-line',
  lat: 12.9,
  lng: 77.6,
  area: '',
  entryPortsCount: 2,
  exitPortsCount: 2,
  installationDate: '',
  technician: '',
  images: [],
  equipmentId: 'FAT-1',
  splices: [
    { id: 'S1', inputCableId: 'FDR', inputCableName: 'FDR', inputCore: 1, outputCableId: 'DIST', outputCableName: 'DIST', outputCore: 1, status: 'Spliced', technician: 'Asha', date: '2026-02-03' },
    { id: 'S0', inputCableId: 'FDR', inputCableName: 'FDR', inputCore: 2, outputCableId: 'DIST', outputCableName: 'DIST', outputCore: 2, status: 'Spliced', technician: 'Asha', date: '2026-01-03', retiredAt: '2026-02-01', retiredReason: 'Re-spliced' },
  ],
};

beforeEach(() => {
  localStorage.clear();
  useNetworkStore.setState(pristine, true);
  useNetworkStore.getState().replaceCollections({
    equipment: [box('FAT-1')],
    cables: [cable('FDR'), cable('DIST')],
    splitters: [splitter],
    closures: [closure],
    customers: [],
    onts: [],
    rfElements: [],
    rfLinks: [],
    linkVerifications: [],
  });
  useToastStore.setState({ toasts: [] });
  useConfirmStore.setState({ pending: null });
});

describe('Connections panel', () => {
  it('lists every recorded link of the box with where it is recorded, and shows "Not checked"', () => {
    const html = renderToStaticMarkup(<ConnectionsView index={storeIndex()} target={{ elementId: 'FAT-1' }} />);
    expect(html).toContain('data-testid="connection-splice:CL-1:S1"');
    expect(html).toContain('data-testid="connection-splitter-in:SPL-1"');
    expect(html).toContain('Splice in closure CL-1');
    expect(html).toContain('by Asha, on 2026-02-03');
    // Nobody recorded who linked the splitter input: it says so.
    expect(html).toContain('Who and when: not recorded');
    // Two live links and the retired splice (history keeps its check state too).
    expect(html.match(/data-testid="connection-check-not_checked"/g)?.length).toBe(3);
    // The retired splice is history, not hidden and not mixed in with the live links.
    expect(html).toContain('data-testid="connections-history"');
    expect(html).toContain('Record a check');
  });

  it('says plainly when nothing is recorded', () => {
    const html = renderToStaticMarkup(<ConnectionsView index={storeIndex()} target={{ cableId: 'FDR', core: 9 }} bare />);
    expect(html).toContain('data-testid="connections-empty"');
    expect(html).toContain('nothing is worked out from the map');
  });

  it('records a check with its evidence and shows it on the fibre', async () => {
    const saved = await saveLinkCheck({
      connectionId: 'splice:CL-1:S1',
      method: 'power_reading',
      result: 'pass',
      checkedOn: '2026-11-04',
      technician: 'Ravi',
      readingDbm: readingFrom('19.4', '-'),
      wavelengthNm: 1490,
      photoIds: ['LCK-PHOTO0001'],
    });
    expect(saved).toMatchObject({ readingDbm: -19.4, wavelengthNm: 1490, photoIds: ['LCK-PHOTO0001'], technician: 'Ravi' });
    expect(useNetworkStore.getState().linkVerifications).toHaveLength(1);
    expect(useNetworkStore.getState().auditLogs.some((a) => a.action === 'LINK_CHECK_RECORDED')).toBe(true);
    const html = renderToStaticMarkup(<ConnectionsView index={storeIndex()} target={{ cableId: 'FDR', core: 1 }} bare />);
    expect(html).toContain('data-testid="connection-check-passed"');
    expect(html).toContain('-19.4 dBm at 1490 nm (measured)');
  });

  it('asks "Save anyway" for a check with no evidence, and saves nothing when the person says no', async () => {
    const pending = saveLinkCheck({ connectionId: 'splitter-in:SPL-1', method: 'visual', result: 'pass', checkedOn: '2026-11-04', technician: 'Ravi' });
    await vi.waitFor(() => expect(useConfirmStore.getState().pending?.message).toMatch(/no photo, OTDR reference or reading/));
    useConfirmStore.getState().respond(false);
    expect(await pending).toBeNull();
    expect(useNetworkStore.getState().linkVerifications).toEqual([]);
  });

  it('takes the sign of a reading only from the person', () => {
    expect(readingFrom('19.4', undefined)).toBeUndefined();
    expect(readingFrom('19,4', '-')).toBe(-19.4);
    expect(readingFrom('3', '+')).toBe(3);
    expect(readingFrom('1006', '-')).toBeUndefined();
  });
});
