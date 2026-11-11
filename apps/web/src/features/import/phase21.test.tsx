import { strFromU8, unzipSync } from 'fflate';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';

import { type Building, type Duct, type Equipment, planKmlImport, previewSourceRows, type Span } from '@fibergis/shared';
import { createSampleNetwork } from '@fibergis/shared/sample';

import { buildNetworkKml } from '../../lib/kml';
import { getNetworkData, getNetworkSnapshot, useNetworkStore } from '../../stores/networkStore';
import { applyKmlImport } from '../../stores/ospActions';
import { ImportHistoryList } from './ImportHistoryPanel';
import { previewRollback, rollbackImport } from './importRollback';
import { buildNetworkKmz, EXCEL_LAYER_IDS, networkKmlSource, networkWorkbook } from './networkExport';

const pristine = useNetworkStore.getState();
afterEach(() => useNetworkStore.setState(pristine, true));

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

describe('network export (KML, KMZ, Excel)', () => {
  const sample = createSampleNetwork();
  const duct: Duct = { id: 'DCT-1', name: 'Main road duct', coordinates: [[17.4, 78.4], [17.401, 78.401]], status: 'built', basis: 'office_drawn', cableIds: [], subducts: [], createdAt: '2026-11-01' };
  const span: Span = { id: 'SPN-1', name: 'P1 to P2', fromStructureId: 'P1', toStructureId: 'P2', status: 'built', basis: 'office_drawn', createdAt: '2026-11-01' };
  const lostSpan: Span = { ...span, id: 'SPN-2', name: 'To nowhere', toStructureId: 'MISSING' };
  const building: Building = { id: 'BLD-1', name: 'Sai Residency', kind: 'apartment', lat: 17.402, lng: 78.402, floorBoxes: [], units: [], createdAt: '2026-11-01', footprint: [[17.402, 78.402], [17.4021, 78.402], [17.4021, 78.4021]] } as Building;
  const source = { equipment: [pole('P1', 17.4, 78.4), pole('P2', 17.401, 78.4)], cables: [], customers: [], ducts: [duct], spans: [span, lostSpan], buildings: [building] };

  it('puts ducts, spans (between their poles) and buildings in the KML, and leaves out a span it cannot draw', () => {
    const kml = buildNetworkKml(source);
    expect(kml).toContain('<name>Ducts</name>');
    expect(kml).toContain('Main road duct (DCT-1)');
    expect(kml).toContain('<coordinates>78.4,17.4,0 78.4,17.401,0</coordinates>');
    expect(kml).toContain('Measured length: not recorded');
    expect(kml).not.toContain('To nowhere');
    expect(kml).toContain('Sai Residency (BLD-1)');
    expect(kml).toContain('<Polygon>');
  });

  it('zips the same KML as doc.kml in a KMZ', () => {
    const files = unzipSync(buildNetworkKmz(source));
    expect(Object.keys(files)).toEqual(['doc.kml']);
    expect(strFromU8(files['doc.kml']!)).toBe(buildNetworkKml(source));
  });

  it('makes one Excel sheet per kind of record, with a sheet saying what the file is', () => {
    const sheets = networkWorkbook(sample, { exportedAt: new Date('2026-11-11T10:00:00Z'), exportedBy: 'Office One', hiddenForRole: true });
    expect(sheets).toHaveLength(EXCEL_LAYER_IDS.length + 1);
    expect(sheets[0]!.rows).toEqual(expect.arrayContaining([{ what: 'Saved by', value: 'Office One' }, expect.objectContaining({ what: 'Customer details' })]));
    const equipment = sheets.find((s) => s.name === 'All equipment')!;
    expect(equipment.rows).toHaveLength(sample.equipment.length);
    // A value nobody recorded is an empty cell, never a made-up one.
    expect(equipment.rows.some((r) => r.serialNumber === null)).toBe(true);
    expect(networkKmlSource(sample).ducts).toBe(sample.ducts);
  });
});

describe('import history in the app', () => {
  const rows = [
    { index: 0, layer: 'poles', properties: { ID: 'NEW-1', lat: '10.10', lng: '76.10' }, geometry: null },
    { index: 1, layer: 'poles', properties: { ID: 'NEW-2', lat: '10.11', lng: '76.11' }, geometry: null },
  ];

  const importTwoPoles = () => {
    const preview = previewSourceRows(rows, { name: 'ID', lat: 'lat', lng: 'lng' }, 'csv');
    const plan = planKmlImport(getNetworkData(), preview, { [preview.groups[0]!.key]: { target: 'Telecom Pole', status: 'existing' } }, { fileName: 'poles.csv', format: 'csv' });
    expect(applyKmlImport(plan)).toEqual({ equipment: 2, cables: 0, ducts: 0 });
    return plan;
  };

  it('keeps an import record and lists it, and the store Undo removes the import with its record', () => {
    const plan = importTwoPoles();
    const stored = useNetworkStore.getState().imports!.find((r) => r.id === plan.importId)!;
    expect(stored).toMatchObject({ fileName: 'poles.csv', format: 'csv', counts: { points: 2 } });
    const html = renderToStaticMarkup(<ImportHistoryList imports={useNetworkStore.getState().imports ?? []} />);
    expect(html).toContain('poles.csv');
    expect(html).toContain('CSV spreadsheet');
    useNetworkStore.getState().undo();
    expect(useNetworkStore.getState().imports!.some((r) => r.id === plan.importId)).toBe(false);
    expect(getNetworkSnapshot().equipment.some((e) => e.name === 'NEW-1')).toBe(false);
  });

  it('shows what an undo would do, and refuses with a plain message when an item was changed', () => {
    const plan = importTwoPoles();
    const check = previewRollback(plan.importId);
    expect(check.ok && check.removed).toBe(2);
    const first = plan.equipment[0]!;
    useNetworkStore.setState({ equipment: useNetworkStore.getState().equipment.map((e) => (e.id === first.id ? { ...e, notes: 'Checked' } : e)) });
    const refused = previewRollback(plan.importId);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.message).toMatch(/NEW-1.*changed after the import/);
  });

  it('needs the office server for the undo, and changes nothing without it', async () => {
    const plan = importTwoPoles();
    const before = getNetworkSnapshot().equipment.length;
    const outcome = await rollbackImport(plan.importId, 'wrong file');
    expect(outcome.ok).toBe(false);
    expect(getNetworkSnapshot().equipment.length).toBe(before);
    expect(useNetworkStore.getState().imports!.find((r) => r.id === plan.importId)!.rolledBackAt).toBeUndefined();
  });
});
