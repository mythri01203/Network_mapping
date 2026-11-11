import { describe, expect, it } from 'vitest';

import { describeBulkEditProblems, isBulkEditable, planBulkEdit } from '../src/domain/bulkEdit';
import { searchNetwork } from '../src/domain/networkSearch';
import { describeConditions, filterRecords, isNotRecorded, meetsCondition } from '../src/domain/recordQuery';
import { reportToCsv } from '../src/domain/reports';
import type { Cable, Equipment } from '../src/model/types';
import { cable, customer, equipment } from './fixtures';

/** Phase 16: search, filter conditions, bulk edit (all or nothing) and the safe CSV writer. */

const olt = equipment({
  id: 'OLT-01',
  type: 'OLT',
  name: 'Head end OLT',
  serialNumber: 'ZTE-SN-778899',
  model: 'C320',
  ponPorts: [
    { id: 'PON-3', portNumber: 3, slotCardPort: '0/1/3', vendorAddress: 'gpon-olt_1/1/3', status: 'Active', connectedCustomersCount: 0 },
  ],
});
const odf = equipment({
  id: 'ODF-01',
  type: 'ODF',
  name: 'Exchange ODF',
  odfPanels: [{ id: 'PNL-A', label: 'A', ports: [{ id: 'ODFP-A-12', number: 12, status: 'available' }] }],
});
const pole = equipment({ id: 'POLE-7', type: 'Telecom Pole', name: 'P7', poleNumber: 'BESCOM-4411', tagCode: 'QR-0007' });
const feeder = cable({ id: 'CBL-01', name: 'Main road line', fiberCount: 24, model: 'ADSS-24' });
const data = {
  equipment: [olt, odf, pole],
  cables: [feeder],
  customers: [customer({ id: 'CUST-9', name: 'Lakshmi Stores', ontSerialNumber: 'HWTC1234ABCD' })],
};

describe('searchNetwork', () => {
  it('finds serial, model, tag, pole number and names the field that matched', () => {
    expect(searchNetwork(data, 'zte-sn-778899').hits[0]).toMatchObject({ kind: 'equipment', id: 'OLT-01', matched: { field: 'Serial number', value: 'ZTE-SN-778899' } });
    expect(searchNetwork(data, 'c320').hits[0]).toMatchObject({ id: 'OLT-01', matched: { field: 'Model' } });
    expect(searchNetwork(data, 'QR-0007').hits[0]).toMatchObject({ kind: 'pole', id: 'POLE-7', matched: { field: 'Tag (QR)' } });
    expect(searchNetwork(data, 'bescom-4411').hits[0]).toMatchObject({ kind: 'pole', matched: { field: 'Pole number' } });
    expect(searchNetwork(data, 'HWTC1234').hits[0]).toMatchObject({ kind: 'customer', id: 'CUST-9', matched: { field: 'ONT serial' } });
  });

  it('finds a fibre by cable and number, only within the fibres the cable has', () => {
    const hit = searchNetwork(data, 'CBL-01/5').hits.find((h) => h.kind === 'core');
    expect(hit).toMatchObject({ collection: 'cables', id: 'CBL-01', part: '5' });
    // No record for that fibre: said so, never filled in.
    expect(hit?.detail).toContain('no record');
    expect(searchNetwork(data, 'Main road line fibre 12').hits.some((h) => h.kind === 'core' && h.part === '12')).toBe(true);
    expect(searchNetwork(data, 'CBL-01/30').hits.some((h) => h.kind === 'core')).toBe(false);
  });

  it('finds PON and ODF ports by their written addresses', () => {
    expect(searchNetwork(data, '0/1/3').hits[0]).toMatchObject({ kind: 'ponPort', id: 'OLT-01', part: 'PON-3' });
    expect(searchNetwork(data, 'OLT-01/PON-3').hits[0]).toMatchObject({ kind: 'ponPort', part: 'PON-3' });
    expect(searchNetwork(data, 'A/12').hits[0]).toMatchObject({ kind: 'odfPort', id: 'ODF-01', part: 'ODFP-A-12' });
    // A bare number is not an ODF adapter on its own.
    expect(searchNetwork(data, '12').hits.some((h) => h.kind === 'odfPort')).toBe(false);
  });

  it('never matches or shows a value hidden for the reader’s role', () => {
    const hidden = { customers: [customer({ id: 'CUST-H', name: 'Hidden for your role', address: 'Hidden for your role', ontSerialNumber: 'ZXIC0001' })] };
    expect(searchNetwork(hidden, 'hidden').total).toBe(0);
    expect(searchNetwork(hidden, 'ZXIC0001').hits[0]).toMatchObject({ id: 'CUST-H', label: 'CUST-H' });
  });

  it('pages, limits kinds and finds nothing for a blank query', () => {
    expect(searchNetwork(data, '   ').total).toBe(0);
    const all = searchNetwork(data, 'e', { limit: 2 });
    expect(all.hits).toHaveLength(2);
    expect(all.total).toBeGreaterThan(2);
    const next = searchNetwork(data, 'e', { limit: 2, offset: 2 });
    expect(next.hits[0]).not.toEqual(all.hits[0]);
    expect(searchNetwork(data, 'e', { kinds: ['cable'] }).hits.every((h) => h.kind === 'cable')).toBe(true);
  });
});

describe('filter conditions', () => {
  const rows = [
    { id: 'a', status: 'Active', fibres: 24, owner: 'Own' },
    { id: 'b', status: 'Damaged', fibres: 12, owner: '' },
    { id: 'c', status: 'Active', fibres: undefined, owner: undefined },
  ];
  it('treats a blank or missing value as not recorded, never as a match', () => {
    expect(isNotRecorded('  ')).toBe(true);
    expect(isNotRecorded([])).toBe(true);
    expect(isNotRecorded(0)).toBe(false);
    expect(filterRecords(rows, [{ field: 'owner', operator: 'is_empty' }]).map((r) => r.id)).toEqual(['b', 'c']);
    expect(filterRecords(rows, [{ field: 'fibres', operator: 'lt', value: '100' }]).map((r) => r.id)).toEqual(['a', 'b']);
    expect(meetsCondition(undefined, { operator: 'equals', value: 'Own' })).toBe(false);
    expect(meetsCondition(undefined, { operator: 'not_equals', value: 'Own' })).toBe(true);
  });
  it('combines conditions with and, case-insensitively, and numbers as numbers', () => {
    expect(filterRecords(rows, [{ field: 'status', operator: 'equals', value: 'active' }, { field: 'fibres', operator: 'gt', value: '20' }]).map((r) => r.id)).toEqual(['a']);
    expect(filterRecords(rows, [{ field: 'fibres', operator: 'equals', value: '24.0' }]).map((r) => r.id)).toEqual(['a']);
    expect(describeConditions([{ field: 'status', operator: 'equals', value: 'Active' }], () => 'Status')).toBe('Status is "Active"');
  });
});

describe('bulk edit', () => {
  const cables: Cable[] = [cable({ id: 'C1' }), cable({ id: 'C2' }), cable({ id: 'C3' })];

  it('changes only the chosen field on every chosen record', () => {
    const plan = planBulkEdit('cables', cables, ['C1', 'C2'], [{ field: 'status', value: 'Maintenance' }]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.changed.map((r) => [r.id, r.status])).toEqual([['C1', 'Maintenance'], ['C2', 'Maintenance']]);
    expect(plan.changed[0]).toEqual({ ...cables[0], status: 'Maintenance' });
  });

  it('is refused as a whole when one record fails, naming that record and why', () => {
    // C2's required owner cannot be cleared; C1 and C3 alone would be fine.
    const broken: Cable[] = [cables[0], { ...cables[1], name: 'Lake road' }, cables[2]];
    const plan = planBulkEdit('cables', broken, ['C1', 'C2', 'C3'], [{ field: 'owner', value: undefined }]);
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.problems.length).toBe(3);
    const text = describeBulkEditProblems(plan.problems);
    expect(text).toMatch(/^Nothing was changed\./);
    expect(text).toContain('C1');

    // One bad record among good ones: an invalid status on C2 only (as if another device sent it).
    const mixed = planBulkEdit('cables', [cables[0], { ...cables[1], fiberCount: -1 } as Cable, cables[2]], ['C1', 'C2', 'C3'], [{ field: 'remarks', value: 'Checked' }]);
    expect(mixed.ok).toBe(false);
    if (mixed.ok) return;
    expect(mixed.problems).toEqual([expect.objectContaining({ id: 'C2' })]);
  });

  it('never writes links, positions or identity, and refuses a missing record', () => {
    expect(isBulkEditable('cables', 'startEquipmentId')).toBe(false);
    expect(isBulkEditable('equipment', 'lat')).toBe(false);
    expect(planBulkEdit('cables', cables, ['C1'], [{ field: 'startEquipmentId', value: 'X' }]).ok).toBe(false);
    expect(planBulkEdit('cables', cables, ['C1', 'GONE'], [{ field: 'status', value: 'Active' }]).ok).toBe(false);
  });

  it('stamps who confirmed a span and refuses setting spans back to proposed', () => {
    const span = { id: 'S1', name: 'S1', fromStructureId: 'P1', toStructureId: 'P2', status: 'proposed', basis: 'field_sequence', createdAt: '2026-01-01T00:00:00.000Z' };
    const plan = planBulkEdit('spans', [span], ['S1'], [{ field: 'status', value: 'built' }], { now: new Date('2026-11-11T10:00:00Z'), actor: 'Asha' });
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.changed[0]).toMatchObject({ status: 'built', confirmedAt: '2026-11-11T10:00:00.000Z', confirmedBy: 'Asha' });
    expect(planBulkEdit('spans', [span], ['S1'], [{ field: 'status', value: 'proposed' }]).ok).toBe(false);
  });

  it('reports records that already have the value as unchanged', () => {
    const plan = planBulkEdit('equipment', [equipment({ id: 'E1', type: 'FAT' }) as Equipment], ['E1'], [{ field: 'status', value: 'Active' }]);
    expect(plan.ok && plan.changed.length === 0 && plan.unchanged).toEqual(['E1']);
  });
});

describe('CSV export', () => {
  it('escapes quotes, commas and line breaks and keeps formulas as text', () => {
    const csv = reportToCsv({
      columns: [
        { key: 'a', label: 'Name, "quoted"' },
        { key: 'b', label: 'Note' },
      ],
      rows: [
        { a: '=HYPERLINK("x")', b: 'line 1\nline 2' },
        { a: '+91 98450', b: '@cmd' },
        { a: '-5', b: 7 },
      ],
    });
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('"Name, ""quoted""",Note');
    expect(lines[1]).toBe(`"'=HYPERLINK(""x"")","line 1\nline 2"`);
    expect(lines[2]).toBe("'+91 98450,'@cmd");
    expect(lines[3]).toBe("'-5,7");
  });
});
