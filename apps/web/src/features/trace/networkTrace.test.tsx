import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildTraceReport, type Cable, type Customer, type Equipment, type JointClosure, reconcileFindings, type Splitter, traceNetwork } from '@fibergis/shared';

import { traceNetworkPath } from '../../stores/networkActions';
import { useNetworkStore } from '../../stores/networkStore';
import { useTraceStore } from '../../stores/traceStore';
import { acknowledgeFindingAction, resolveFindingAction } from '../../stores/validationActions';
import { FindingCard } from '../validation/ValidationFindingsModal';
import { StepCard, TraceSummaryView } from './NetworkTraceModal';
import { TraceDiagram } from './TraceDiagram';
import { drawTracePdf, pdfText } from './traceExport';

/** Network mapping Phase 15: the trace screen on the one engine, its highlight, report, and findings. */

vi.mock('leaflet', () => ({ default: {} }));

const pristine = useNetworkStore.getState();

const olt: Equipment = {
  id: 'OLT-1',
  name: 'OLT 1',
  type: 'OLT',
  category: 'Central Office',
  lat: 12.9,
  lng: 77.6,
  area: '',
  street: '',
  status: 'Active',
  images: [],
  installedDate: '',
  ponPorts: [{ id: 'PON-01', status: 'Active', connectedFeederCableId: 'FDR', feederCore: 1 } as NonNullable<Equipment['ponPorts']>[number]],
};
const box: Equipment = { ...olt, id: 'FAT-1', name: 'FAT 1', type: 'FAT', category: 'Fiber Distribution', ponPorts: undefined, lat: 12.91 };
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
const splitter: Splitter = {
  id: 'SPL-1',
  name: 'SPL-1',
  terminalBoxId: 'FAT-1',
  ratio: '1:8',
  insertionLossDb: 10.5,
  status: 'Active',
  inputPort: { id: 'SPL-1-IN', connectedCableId: 'DIST', connectedCore: 1 },
  outputPorts: Array.from({ length: 8 }, (_, i) => ({ portNumber: i + 1, label: `OUT-${i + 1}`, status: 'Available' as const, ...(i === 0 ? { connectedDropCableId: 'DROP', connectedCore: 1 } : {}) })),
};
const customer = { id: 'CU-1', name: 'Asha', status: 'Active', dropCableId: 'DROP', fiberCore: 1, lat: 12.912, lng: 77.6 } as unknown as Customer;

beforeEach(() => {
  localStorage.clear();
  useNetworkStore.setState(pristine, true);
  useTraceStore.getState().clear();
  useTraceStore.getState().closePanel();
  useNetworkStore.getState().replaceCollections({
    equipment: [olt, box],
    cables: [cable('FDR', 'OLT-1', 'FAT-1'), cable('DIST', 'OLT-1', 'FAT-1'), cable('DROP', 'FAT-1', 'CU-1')],
    splitters: [splitter],
    closures: [closure],
    customers: [{ ...(pristine.customers[0] ?? {}), ...customer } as Customer],
    onts: [],
    rfElements: [],
    rfLinks: [],
    linkVerifications: [],
    validationFindings: [],
  });
});

const data = () => {
  const s = useNetworkStore.getState();
  return { equipment: s.equipment, cables: s.cables, splitters: s.splitters, closures: s.closures, customers: s.customers };
};

describe('the trace screen', () => {
  it('traces from the inspector with the one engine, opens the screen and highlights every cable, fibre level included', () => {
    expect(traceNetworkPath('CU-1')).toBe(true);
    const t = useTraceStore.getState();
    expect(t.panelOpen).toBe(true);
    expect(t.network?.type).toBe('customer_to_olt');
    expect(t.network?.complete).toBe(true);
    expect(t.cableIds.sort()).toEqual(['DIST', 'DROP', 'FDR']);
    expect(t.equipmentIds).toContain('OLT-1');
    expect(traceNetworkPath('nothing-like-this')).toBe(false);
    useTraceStore.getState().clear();
    expect(useTraceStore.getState().cableIds).toEqual([]);
  });

  it('opens an OLT with what it feeds, and a closure towards the OLT', () => {
    traceNetworkPath('OLT-1');
    expect(useTraceStore.getState().network?.customerIds).toEqual(['CU-1']);
    traceNetworkPath('CL-1');
    expect(useTraceStore.getState().network?.paths[0].reaches).toEqual({ oltId: 'OLT-1', ponPortId: 'PON-01' });
  });

  it('shows every step with its state in words and a mark, never colour alone', () => {
    const result = traceNetwork(data(), { type: 'customer_to_olt', from: { type: 'customer', id: 'CU-1' } });
    const splice = result.paths[0].steps.find((s) => s.kind === 'splice')!;
    const html = renderToStaticMarkup(<StepCard step={splice} index={3} />);
    expect(html).toContain('Not checked');
    expect(html).toContain('○');
    expect(html).toContain('Show on map');
    const summary = renderToStaticMarkup(<TraceSummaryView result={result} />);
    expect(summary).toContain('No missing link on record.');
  });

  it('draws the diagram and a gap as missing', () => {
    const broken = { ...data(), closures: [] };
    const result = traceNetwork(broken, { type: 'customer_to_olt', from: { type: 'customer', id: 'CU-1' } });
    const svg = renderToStaticMarkup(<TraceDiagram result={result} />);
    expect(svg).toContain('data-testid="trace-diagram"');
    expect(svg).toContain('Missing link');
    const summary = renderToStaticMarkup(<TraceSummaryView result={result} />);
    expect(summary).toContain('Not complete');
  });

  it('makes a PDF report in plain characters', () => {
    const result = traceNetwork(data(), { type: 'olt_to_ont', from: { type: 'equipment', id: 'OLT-1' } });
    const doc = drawTracePdf(buildTraceReport(result, new Date('2026-11-11T10:00:00Z')));
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
    expect(pdfText('fibre 1 → input · ok ✓')).toBe('fibre 1 -> input - ok ');
  });
});

describe('map check findings', () => {
  const stored = () =>
    reconcileFindings(
      [],
      [{ key: 'geometry:cable-end-gap:FDR:end', rule: 'cable-end-gap', severity: 'warning', source: 'geometry', targetCollection: 'cables', targetId: 'FDR', message: 'Cable "FDR": the To end is 900 m from "FAT 1".', fix: 'Move the end.' }],
      { now: new Date('2026-11-11T09:00:00Z') },
    ).upserts;

  it('lists a finding with what to do, and marks it fine or fixed only with a note', () => {
    const [f] = stored();
    useNetworkStore.getState().replaceCollections({ validationFindings: [f] });
    const html = renderToStaticMarkup(<FindingCard finding={f} canDecide />);
    expect(html).toContain('What to do:');
    expect(html).toContain('Check this');
    expect(html).toContain('Fine as it is');
    expect(html).toContain('Fixed');
    expect(acknowledgeFindingAction(f.id, '')).toBe(false);
    expect(resolveFindingAction(f.id, 'Moved the line end to the box.')).toBe(true);
    const after = useNetworkStore.getState().validationFindings!.find((x) => x.id === f.id)!;
    expect(after.state).toBe('resolved');
    expect(after.history.at(-1)).toMatchObject({ event: 'resolved', note: 'Moved the line end to the box.' });
    expect(renderToStaticMarkup(<FindingCard finding={after} canDecide={false} />)).not.toContain('data-testid="finding-fixed"');
  });
});
