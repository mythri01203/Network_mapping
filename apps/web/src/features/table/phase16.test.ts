import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BULK_EDITABLE_FIELDS, type Cable, type Customer, type Equipment, isBulkEditable, type NetworkSnapshot } from '@fibergis/shared';
import { createSampleNetwork } from '@fibergis/shared/sample';

import { ApiError } from '../../api/client';
import { useSelectionStore } from '../../stores/selectionStore';
import { connectedKeys, countByCollection, describeCounts, hitTest, invertKeys, keyOf, keysInArea, pointInPolygon, recordIndex,shapeOf } from '../selection/selectionModel';
import { saveBulkEdit } from './bulkEditService';
import { layerById, TABLE_LAYERS, tableContext,type TableLayer } from './tableLayers';
import { layerRows, NOT_RECORDED, orderedColumns, queryRows, rowWindow, showCell, sortRows, tableCsv } from './tableModel';

const sync = vi.hoisted(() => ({ sendAtomic: vi.fn(), unsentIds: vi.fn(() => ({}) as Record<string, string[]>) }));
vi.mock('../../api/syncEngine', () => ({ syncEngine: sync }));

/** Phase 16: selection set, area and connected selection, the attribute table model, bulk edit. */

const base = createSampleNetwork();
const pole = (i: number, lat: number, lng: number, extra: Partial<Equipment> = {}): Equipment => ({
  ...base.equipment.find((e) => e.id === 'POLE-01')!,
  id: `P-${i}`,
  name: `Pole ${i}`,
  lat,
  lng,
  ...extra,
});
const line = (id: string, coordinates: [number, number][], extra: Partial<Cable> = {}): Cable => ({ ...base.cables[0], id, name: id, coordinates, startEquipmentId: undefined, endEquipmentId: undefined, ...extra });
const network = (over: Partial<NetworkSnapshot>): NetworkSnapshot => ({ ...createSampleNetwork(), equipment: [], cables: [], customers: [], splitters: [], closures: [], spans: [], ducts: [], slackLoops: [], attachments: [], faults: [], zones: [], onts: [], buildings: [], ...over });

describe('areas', () => {
  const square: [number, number][] = [
    [0, 0],
    [0, 1],
    [1, 1],
    [1, 0],
  ];
  it('holds points inside and lines crossing it, and nothing with no recorded place', () => {
    expect(pointInPolygon([0.5, 0.5], square)).toBe(true);
    expect(pointInPolygon([1.5, 0.5], square)).toBe(false);
    const data = network({
      equipment: [pole(1, 0.5, 0.5), pole(2, 2, 2), pole(3, 0, 0, { lat: 0, lng: 0 })],
      cables: [line('CROSS', [[-1, 0.5], [2, 0.5]]), line('AWAY', [[3, 3], [4, 4]])],
    });
    expect(keysInArea(data, square).sort()).toEqual(['cables:CROSS', 'equipment:P-1']);
  });
});

describe('connected by recorded links', () => {
  it('follows cable ends and customer links, never distance', () => {
    const a = pole(1, 12.9, 77.6);
    const b = pole(2, 12.9001, 77.6001);
    const near = pole(3, 12.90005, 77.60005);
    const cable = line('C1', [[12.9, 77.6], [12.9001, 77.6001]], { startEquipmentId: 'P-1', endEquipmentId: 'P-2' });
    const customer: Customer = { ...base.customers[0], id: 'CU-1', terminalBoxId: 'P-2', dropCableId: '', splitterId: '', oltId: '', ontId: undefined, buildingId: undefined };
    const data = network({ equipment: [a, b, near], cables: [cable], customers: [customer] });
    expect(connectedKeys(data, ['cables:C1']).sort()).toEqual(['equipment:P-1', 'equipment:P-2']);
    expect(connectedKeys(data, ['equipment:P-2']).sort()).toEqual(['cables:C1', 'customers:CU-1']);
    // The pole right beside the cable is not joined to it.
    expect(connectedKeys(data, ['cables:C1'])).not.toContain('equipment:P-3');
    // A link to a record that is not on record is not selected.
    const broken = network({ equipment: [a], cables: [{ ...cable, endEquipmentId: 'GONE' }] });
    expect(connectedKeys(broken, ['cables:C1'])).toEqual(['equipment:P-1']);
  });

  it('inverts within the kinds chosen and counts in words', () => {
    const data = network({ equipment: [pole(1, 1, 1), pole(2, 1, 1), pole(3, 1, 1)], cables: [line('C1', [[1, 1], [2, 2]])] });
    expect(invertKeys(data, new Set(['equipment:P-1']))).toEqual(['equipment:P-2', 'equipment:P-3']);
    expect(describeCounts(countByCollection(['equipment:P-1', 'cables:C1', 'cables:C2']))).toBe('2 cables, 1 item of equipment');
  });
});

describe('right-click hit test', () => {
  it('finds the pin under the pointer before the cable it sits on', () => {
    const data = network({ equipment: [pole(1, 10, 10)], cables: [line('C1', [[10, 9], [10, 11]])] });
    const toScreen = ([lat, lng]: [number, number]) => ({ x: lng * 100, y: -lat * 100 });
    const near = { south: 9, west: 9, north: 11, east: 11 };
    expect(hitTest(data, { x: 1002, y: -1001 }, toScreen, near)).toBe('equipment:P-1');
    expect(hitTest(data, { x: 950, y: -1003 }, toScreen, near)).toBe('cables:C1');
    expect(hitTest(data, { x: 950, y: -1100 }, toScreen, near)).toBeNull();
  });
});

describe('attribute table model', () => {
  const layer = layerById('equipment') as TableLayer<Equipment>;
  const data = network({ equipment: [pole(1, 1, 1, { manufacturer: 'Beta' }), pole(2, 1, 1, { manufacturer: undefined }), pole(3, 1, 1, { manufacturer: 'alpha' })] });
  const ctx = tableContext(data);
  const make = layer.columns.find((c) => c.key === 'manufacturer')!;

  it('shows a missing value as Not recorded and sorts it last both ways', () => {
    expect(showCell(undefined)).toBe(NOT_RECORDED);
    expect(showCell('  ')).toBe(NOT_RECORDED);
    expect(sortRows(data.equipment, make, 'asc', ctx).map((e) => e.id)).toEqual(['P-3', 'P-1', 'P-2']);
    expect(sortRows(data.equipment, make, 'desc', ctx).map((e) => e.id)).toEqual(['P-1', 'P-3', 'P-2']);
  });

  it('filters by words, conditions and the chosen rows', () => {
    const rows = layerRows(layer, data);
    expect(queryRows(layer, rows, ctx, { text: 'beta' }).map((e) => e.id)).toEqual(['P-1']);
    expect(queryRows(layer, rows, ctx, { conditions: [{ field: 'manufacturer', operator: 'is_empty' }] }).map((e) => e.id)).toEqual(['P-2']);
    expect(queryRows(layer, rows, ctx, { only: new Set(['P-3']) }).map((e) => e.id)).toEqual(['P-3']);
  });

  it('draws only the rows in view', () => {
    expect(rowWindow(50_000, 0, 360, 36)).toEqual({ start: 0, end: 18 });
    expect(rowWindow(50_000, 36_000, 360, 36)).toEqual({ start: 992, end: 1018 });
    expect(rowWindow(5, 0, 1000, 36)).toEqual({ start: 0, end: 5 });
    expect(rowWindow(0, 0, 360, 36)).toEqual({ start: 0, end: 0 });
  });

  it('keeps saved column order and visibility, adding new columns in their place', () => {
    const cols = orderedColumns(layer, { order: ['name', 'id'], hidden: ['id'] });
    expect(cols.slice(0, 2).map((c) => [c.column.key, c.visible])).toEqual([
      ['name', true],
      ['id', false],
    ]);
    expect(cols.length).toBe(layer.columns.length);
  });

  it('exports through the safe writer: blanks for not recorded, formulas kept as text', () => {
    const rows = [pole(1, 1, 1, { name: '=cmd|"x"', manufacturer: undefined })];
    const csv = tableCsv(rows, [layer.columns.find((c) => c.key === 'name')!, make], ctx);
    expect(csv).toBe(`Name,Make\r\n"'=cmd|""x""",\r\n`);
  });

  it('only offers bulk edit on fields the shared rules allow', () => {
    for (const l of TABLE_LAYERS) {
      for (const c of l.columns) if (c.edit) expect(isBulkEditable(l.collection, c.edit.field), `${l.id}.${c.key}`).toBe(true);
      if (l.editable) expect(BULK_EDITABLE_FIELDS[l.collection], l.id).toBeDefined();
    }
  });
});

describe('selection store', () => {
  beforeEach(() => useSelectionStore.setState({ keys: new Set(), multiMode: false, areaTool: null }));
  it('adds, takes away and toggles', () => {
    const s = useSelectionStore.getState();
    s.setKeys(['a:1', 'a:2']);
    s.setKeys(['a:3'], 'add');
    s.setKeys(['a:1'], 'remove');
    s.toggle('a:2');
    expect([...useSelectionStore.getState().keys]).toEqual(['a:3']);
    s.setMultiMode(true);
    s.setAreaTool('polygon');
    expect(useSelectionStore.getState().multiMode).toBe(false);
  });
});

describe('bulk edit service', () => {
  beforeEach(() => {
    sync.sendAtomic.mockReset();
    sync.unsentIds.mockReset().mockReturnValue({});
  });
  const [c1, c2] = base.cables;

  it('sends one change set with the edited records and an audit note', async () => {
    sync.sendAtomic.mockResolvedValue({ revision: 2, upserted: 3, deleted: 0, versions: {} });
    const out = await saveBulkEdit('cables', [c1.id, c2.id], [{ field: 'remarks', value: 'Checked 11 Nov' }]);
    expect(out).toEqual({ ok: true, changed: 2, unchanged: 0 });
    const sent = sync.sendAtomic.mock.calls[0][0];
    expect(sent.upserts.cables.map((c: Cable) => [c.id, c.remarks])).toEqual([
      [c1.id, 'Checked 11 Nov'],
      [c2.id, 'Checked 11 Nov'],
    ]);
    expect(sent.upserts.auditLogs[0]).toMatchObject({ action: 'BULK_EDIT' });
  });

  it('refuses the whole edit when one record fails, and sends nothing', async () => {
    const out = await saveBulkEdit('cables', [c1.id, c2.id], [{ field: 'owner', value: undefined }]);
    expect(out.ok).toBe(false);
    expect(sync.sendAtomic).not.toHaveBeenCalled();
    expect(!out.ok && out.message).toMatch(/^Nothing was changed\./);
  });

  it('names the record the server refused', async () => {
    sync.sendAtomic.mockRejectedValue(new ApiError(400, 'validation_error', 'The request data is invalid.', [{ path: 'upserts.cables.1.status', message: 'Invalid option' }]));
    const out = await saveBulkEdit('cables', [c1.id, c2.id], [{ field: 'status', value: 'Maintenance' }]);
    expect(out).toMatchObject({ ok: false, recordId: c2.id });
    expect(!out.ok && out.message).toContain('Nothing was changed');
  });

  it('waits for unsent changes on this device first', async () => {
    sync.unsentIds.mockReturnValue({ cables: [c2.id] });
    const out = await saveBulkEdit('cables', [c1.id, c2.id], [{ field: 'status', value: 'Maintenance' }]);
    expect(out).toMatchObject({ ok: false, recordId: c2.id });
    expect(sync.sendAtomic).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* 50,000 records                                                      */
/* ------------------------------------------------------------------ */

describe('performance with 50,000 records', () => {
  it('sorts, filters, selects, searches and exports quickly enough', async () => {
    const { searchNetwork } = await import('@fibergis/shared');
    const N = 50_000;
    const template = base.equipment.find((e) => e.id === 'POLE-01')!;
    const equipment: Equipment[] = Array.from({ length: N }, (_, i) => ({
      ...template,
      id: `PL-${i}`,
      name: `Pole ${i}`,
      lat: 12.9 + (i % 250) * 0.0004,
      lng: 77.5 + Math.floor(i / 250) * 0.0004,
      status: i % 7 === 0 ? 'Faulty' : 'Active',
      manufacturer: i % 3 === 0 ? undefined : `Maker ${i % 11}`,
      serialNumber: `SN-${i}`,
    }));
    const cables: Cable[] = Array.from({ length: N }, (_, i) => ({
      ...base.cables[0],
      id: `CB-${i}`,
      name: `Line ${i}`,
      coordinates: [
        [equipment[i].lat, equipment[i].lng],
        [equipment[(i + 1) % N].lat, equipment[(i + 1) % N].lng],
      ],
      startEquipmentId: equipment[i].id,
      endEquipmentId: equipment[(i + 1) % N].id,
    }));
    const data = network({ equipment, cables });
    const timings: Record<string, number> = {};
    const time = <T>(name: string, fn: () => T): T => {
      const t = performance.now();
      const out = fn();
      timings[name] = Math.round(performance.now() - t);
      return out;
    };

    const layer = layerById('poles') as TableLayer<Equipment>;
    const ctx = time('table context', () => tableContext(data));
    const rows = time('layer rows (50k poles)', () => layerRows(layer, data));
    expect(rows.length).toBe(N);
    const sorted = time('sort 50k by make', () => queryRows(layer, rows, ctx, { sort: { key: 'manufacturer', direction: 'asc' } }));
    expect(sorted.length).toBe(N);
    const filtered = time('filter 50k (status is Faulty and make recorded)', () => queryRows(layer, rows, ctx, { conditions: [{ field: 'status', operator: 'equals', value: 'Faulty' }, { field: 'manufacturer', operator: 'not_empty' }] }));
    expect(filtered.length).toBeGreaterThan(0);
    time('quick text filter 50k', () => queryRows(layer, rows, ctx, { text: 'maker 7' }));
    time('row window', () => rowWindow(N, 900_000, 600, 36));

    const area: [number, number][] = [
      [12.9, 77.5],
      [12.9, 77.54],
      [12.95, 77.54],
      [12.95, 77.5],
    ];
    const inArea = time('area select over 100k (50k points + 50k lines)', () => keysInArea(data, area));
    expect(inArea.length).toBeGreaterThan(1000);
    const store = useSelectionStore.getState();
    time('select 50k into the selection set', () => store.setKeys(rows.map((r) => keyOf('equipment', r.id))));
    expect(useSelectionStore.getState().keys.size).toBe(N);
    time('chosen-only table of 50k', () => queryRows(layer, rows, ctx, { only: new Set(rows.map((r) => r.id)) }));
    time('invert 50k', () => invertKeys(data, new Set(rows.slice(0, 1000).map((r) => keyOf('equipment', r.id)))));
    time('connected for 1,000 poles', () => connectedKeys(data, rows.slice(0, 1000).map((r) => keyOf('equipment', r.id))));
    time('shapes of 50k selected (highlight input)', () => {
      const index = recordIndex(data);
      for (const r of rows) shapeOf('equipment', r, index);
    });
    const found = time('search 100k records for "SN-4999"', () => searchNetwork(data, 'SN-4999'));
    expect(found.hits[0].id).toBe('PL-4999');
    const csv = time('CSV of 50k rows, shown columns', () => tableCsv(rows, orderedColumns(layer).filter((c) => c.visible).map((c) => c.column), ctx));
    expect(csv.split('\r\n').length).toBe(N + 2);
    store.clear();

    console.warn(`Phase 16 timings with 50,000 records (ms): ${JSON.stringify(timings, null, 1)}`);
    // Generous bounds so a slow test machine does not fail; the report gives the real numbers.
    expect(timings['sort 50k by make']).toBeLessThan(5000);
    expect(timings['area select over 100k (50k points + 50k lines)']).toBeLessThan(5000);
    expect(timings['search 100k records for "SN-4999"']).toBeLessThan(5000);
  }, 120_000);
});
