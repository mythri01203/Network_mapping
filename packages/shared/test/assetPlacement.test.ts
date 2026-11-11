import { describe, expect, it } from 'vitest';

import {
  assetHistory,
  checkTypedCoordinates,
  copySettingsPlan,
  duplicateTemplate,
  LINE_PLACEMENT_MAX,
  maintenanceProblems,
  newPointDuplicateWarnings,
  nextMaintenanceDue,
  pointsAlongLine,
  POSSIBLE_DUPLICATE_KEPT,
} from '../src/domain/assetPlacement';
import { polylineLengthMeters } from '../src/domain/geo';
import { DEFAULT_OSP_SETTINGS } from '../src/domain/ospSettings';
import { equipmentSchema } from '../src/model/schemas';
import type { AuditLog, Equipment } from '../src/model/types';
import { equipment } from './fixtures';

const log = (overrides: Partial<AuditLog> & Pick<AuditLog, 'id' | 'assetId'>): AuditLog => ({
  timestamp: '2026-11-10 09:00:00',
  user: 'Ravi',
  role: 'Network Engineer',
  action: 'EQUIPMENT_UPDATED',
  details: 'Updated',
  assetType: 'Equipment',
  ...overrides,
});

describe('typed coordinates', () => {
  it('reads two numbers, or both pasted into one box', () => {
    expect(checkTypedCoordinates('12.971599', '77.594566')).toMatchObject({ ok: true, lat: 12.971599, lng: 77.594566, warnings: [] });
    expect(checkTypedCoordinates('12.971599, 77.594566')).toMatchObject({ ok: true, lat: 12.971599, lng: 77.594566 });
    expect(checkTypedCoordinates(' 12.971599 77.594566 ')).toMatchObject({ ok: true, lat: 12.971599 });
  });

  it('refuses what is not plain decimal degrees, with what to type instead', () => {
    for (const [a, b] of [['12°58′17″', '77.5'], ['12.97N', '77.59E'], ['abc', '77.5'], ['12,971599', '77.594566'], ['', '']]) {
      const result = checkTypedCoordinates(a, b);
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/Type/);
    }
  });

  it('refuses impossible values and 0,0 (which means "not recorded")', () => {
    expect(checkTypedCoordinates('95.1', '12.9')).toMatchObject({ ok: false, swapped: { lat: 12.9, lng: 95.1 } });
    expect(checkTypedCoordinates('12.9', '190.5')).toMatchObject({ ok: false });
    expect(checkTypedCoordinates('0', '0').error).toMatch(/not? place recorded|no place recorded/);
  });

  it('warns about a swap in India and offers the swap, never applying it', () => {
    const result = checkTypedCoordinates('77.594566', '12.971599');
    expect(result.ok).toBe(true);
    expect(result.lat).toBe(77.594566);
    expect(result.swapped).toEqual({ lat: 12.971599, lng: 77.594566 });
    expect(result.warnings[0]).toMatch(/swapped/);
  });

  it('warns, but allows, a place outside India and too few decimals', () => {
    const outside = checkTypedCoordinates('51.507351', '-0.127758');
    expect(outside.ok).toBe(true);
    expect(outside.swapped).toBeUndefined();
    expect(outside.warnings.join(' ')).toMatch(/outside India/);
    const rough = checkTypedCoordinates('12.97', '77.59');
    expect(rough.ok).toBe(true);
    expect(rough.warnings.join(' ')).toMatch(/2 decimal places.*1 km/);
  });
});

describe('duplicate an item', () => {
  const source = equipment({
    id: 'FAT-AAAA',
    type: 'FAT',
    name: 'FAT-07',
    manufacturer: 'Acme',
    model: 'FAT-16',
    catalogModelId: 'CAT-1',
    specOverrides: [{ key: 'Mount', value: 'Pole' }],
    serialNumber: 'SN-123',
    tagCode: 'TAG-9',
    images: [{ id: 'IMG-1', equipmentId: 'FAT-AAAA', url: 'x', name: 'x', category: 'Front View', uploadDate: '2026-01-01', uploadedBy: 'a', description: '', annotations: [] }],
    photoIds: ['PH-1'],
    installedDate: '2025-02-03',
    totalPorts: 16,
    usedPorts: 9,
    availablePorts: 7,
    lat: 12.9,
    lng: 77.6,
    notes: 'Behind the temple',
    ipAddress: '10.0.0.5',
    warrantyUntil: '2027-01-01',
    condition: 'poor',
    maintenance: [{ date: '2026-01-01', by: 'Ravi', what: 'Cleaned' }],
    logicalPorts: [{ id: 'P1', portNumber: 1, portType: 'SC', status: 'Used', connectedEquipmentId: 'X' }],
  });

  it('copies what the item is, and never its serial, tag, photos, connections, install date or place', () => {
    const t = duplicateTemplate(source);
    expect(t).toMatchObject({ type: 'FAT', manufacturer: 'Acme', model: 'FAT-16', catalogModelId: 'CAT-1', totalPorts: 16, usedPorts: 0, availablePorts: 16 });
    for (const key of ['id', 'name', 'serialNumber', 'tagCode', 'images', 'photoIds', 'installedDate', 'lat', 'lng', 'notes', 'ipAddress', 'logicalPorts', 'warrantyUntil', 'condition', 'maintenance'] as const) {
      expect(t).not.toHaveProperty(key);
    }
    // A deep copy: editing the copy's specs leaves the source alone.
    t.specOverrides![0].value = 'Wall';
    expect(source.specOverrides![0].value).toBe('Pole');
  });
});

describe('copy settings from another item', () => {
  const target = equipment({ id: 'B', type: 'FAT', name: 'FAT-02', manufacturer: 'Old', catalogModelId: 'CAT-OLD', serialNumber: 'SN-B', status: 'Planned' });

  it('copies make, model, catalogue model, spec changes and status only', () => {
    const source = equipment({ id: 'A', type: 'FAT', name: 'FAT-01', manufacturer: 'Acme', model: 'X1', catalogModelId: 'CAT-1', specOverrides: [{ key: 'K', value: 'V' }], serialNumber: 'SN-A', status: 'Active' });
    const { next, lines, changed } = copySettingsPlan(target, source);
    expect(changed).toBe(true);
    expect(next).toMatchObject({ id: 'B', name: 'FAT-02', serialNumber: 'SN-B', manufacturer: 'Acme', model: 'X1', catalogModelId: 'CAT-1', status: 'Active' });
    expect(next.specOverrides).toEqual([{ key: 'K', value: 'V' }]);
    expect(lines.map((l) => l.change)).toEqual(['set', 'set', 'set', 'set', 'set']);
  });

  it('keeps what the other item has not recorded, and drops a link that would contradict the copied make', () => {
    const source = equipment({ id: 'A', type: 'FAT', name: 'FAT-01', manufacturer: 'Acme', status: 'Planned' });
    const { next, lines } = copySettingsPlan(target, source);
    expect(next.manufacturer).toBe('Acme');
    expect(next.catalogModelId).toBeUndefined();
    const byField = Object.fromEntries(lines.map((l) => [l.field, l]));
    expect(byField.model.change).toBe('kept');
    expect(byField.catalogModelId.change).toBe('removed');
    expect(byField.status.change).toBe('same');
  });
});

describe('items along a drawn line', () => {
  // About 111 m going north.
  const line: [number, number][] = [
    [12.9, 77.6],
    [12.901, 77.6],
  ];
  const length = polylineLengthMeters(line);

  it('places one at the start and one every gap, measured along the line', () => {
    const plan = pointsAlongLine(line, 50, false);
    expect(plan.ok).toBe(true);
    expect(plan.points).toHaveLength(3);
    expect(polylineLengthMeters([plan.points[0], plan.points[1]])).toBeCloseTo(50, 0);
    expect(plan.lastGapMeters).toBeCloseTo(length - 100, 1);
    expect(plan.endAdded).toBe(false);
  });

  it('adds one at the end only when asked and when the last gap is real', () => {
    const plan = pointsAlongLine(line, 50, true);
    expect(plan.points).toHaveLength(4);
    expect(plan.points[3]).toEqual(line[1]);
    expect(plan.endAdded).toBe(true);
    const exact = pointsAlongLine(line, length / 2, true);
    expect(exact.points).toHaveLength(3);
    expect(exact.endAdded).toBe(false);
  });

  it('follows bends', () => {
    const bent: [number, number][] = [[12.9, 77.6], [12.9005, 77.6], [12.9005, 77.6005]];
    const plan = pointsAlongLine(bent, 10, true);
    for (let i = 1; i < plan.points.length - 1; i += 1) {
      expect(polylineLengthMeters([plan.points[i - 1], plan.points[i]])).toBeLessThanOrEqual(10.01);
    }
  });

  it('refuses a missing line, a gap under 1 m and too many items', () => {
    expect(pointsAlongLine([[12.9, 77.6]], 10, false).ok).toBe(false);
    expect(pointsAlongLine(line, 0, false).error).toMatch(/1 or more/);
    expect(pointsAlongLine(line, Number.NaN, false).ok).toBe(false);
    const long: [number, number][] = [[12.9, 77.6], [12.91, 77.6]]; // about 1.1 km
    const many = pointsAlongLine(long, 1, false);
    expect(many.ok).toBe(false);
    expect(many.error).toMatch(new RegExp(`at most ${LINE_PLACEMENT_MAX}`));
    expect(pointsAlongLine(line, 1, false).points.length).toBeLessThanOrEqual(LINE_PLACEMENT_MAX);
  });
});

describe('history of one item', () => {
  it('lists only audit entries for this asset and the history kept in the record, newest first', () => {
    const odf = equipment({
      id: 'ODF-1',
      type: 'ODF',
      odfPanels: [
        { id: 'PN', label: 'Panel A', ports: [{ id: 'PT', number: 3, status: 'in_use', history: [{ at: '2026-11-09T10:00:00.000Z', by: 'Asha', action: 'PATCHED', details: 'To OLT-1 PON 2' }] }] },
      ],
    });
    const lines = assetHistory(odf, [
      log({ id: 'L1', assetId: 'ODF-1', timestamp: '2026-11-08 08:00:00', action: 'EQUIPMENT_CREATED' }),
      log({ id: 'L2', assetId: 'OTHER', action: 'EQUIPMENT_UPDATED' }),
      log({ id: 'L3', assetId: 'ODF-1', timestamp: '2026-11-10 08:00:00', details: 'Mentions ODF-1' }),
    ]);
    expect(lines.map((l) => l.action)).toEqual(['EQUIPMENT_UPDATED', 'PATCHED', 'EQUIPMENT_CREATED']);
    expect(lines[1]).toMatchObject({ source: 'record', part: 'Panel A, port 3', by: 'Asha' });
  });

  it('is empty when nothing is on record, never filled in', () => {
    expect(assetHistory(equipment({ id: 'X', type: 'FAT' }), [log({ id: 'L', assetId: 'Y' })])).toEqual([]);
  });
});

describe('maintenance, warranty and condition fields', () => {
  it('are optional; absent means not recorded', () => {
    const plain = equipment({ id: 'E', type: 'FAT' });
    expect(equipmentSchema.parse(plain)).not.toHaveProperty('condition');
    expect(equipmentSchema.safeParse({ ...plain, condition: 'unknown' }).success).toBe(false);
    expect(equipmentSchema.safeParse({ ...plain, warrantyUntil: 'next year' }).success).toBe(false);
    expect(
      equipmentSchema.safeParse({ ...plain, warrantyUntil: '2028-03-31', condition: 'fair', maintenance: [{ date: '2026-11-01', by: 'Ravi', what: 'Replaced lid', nextDue: '2027-05-01' }] })
        .success,
    ).toBe(true);
    expect(equipmentSchema.safeParse({ ...plain, maintenance: [{ date: '2026-11-01', by: '', what: 'x' }] }).success).toBe(false);
  });

  it('checks an entry in plain words and finds the next check day only from what was recorded', () => {
    expect(maintenanceProblems({ date: '', by: '', what: '' })).toHaveLength(3);
    expect(maintenanceProblems({ date: '2026-11-01', by: 'Ravi', what: 'Cleaned', nextDue: '2026-10-01' })[0]).toMatch(/before/);
    expect(maintenanceProblems({ date: '2026-11-01', by: 'Ravi', what: 'Cleaned' })).toEqual([]);
    expect(nextMaintenanceDue(undefined)).toBeUndefined();
    expect(nextMaintenanceDue([{ date: '2026-01-01', by: 'a', what: 'b' }])).toBeUndefined();
    expect(nextMaintenanceDue([{ date: '2026-01-01', by: 'a', what: 'b', nextDue: '2026-06-01' }, { date: '2026-02-01', by: 'a', what: 'b', nextDue: '2027-01-01' }])).toBe('2027-01-01');
  });
});

describe('server duplicate warning', () => {
  const pole = (id: string, lat: number, extra: Partial<Equipment> = {}) =>
    equipment({ id, type: 'Telecom Pole', name: id, category: 'Supporting Infrastructure', lat, lng: 77.6, ...extra });
  const stored = [pole('P1', 12.9), equipment({ id: 'F1', type: 'FAT', name: 'F1', lat: 12.90001, lng: 77.6 })];

  it('warns for a new point of the same kind inside the radius, never for other kinds or edits', () => {
    const warnings = newPointDuplicateWarnings(stored, { upserts: { equipment: [pole('P2', 12.90002)] } }, DEFAULT_OSP_SETTINGS);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ rule: 'possible_duplicate', equipmentId: 'P2', nearId: 'P1', overridden: false });
    expect(warnings[0].message).toMatch(/about 2 m from P1/);
    // An edit or move of a stored pole is not a new point.
    expect(newPointDuplicateWarnings(stored, { upserts: { equipment: [pole('P1', 12.90002)] } }, DEFAULT_OSP_SETTINGS)).toEqual([]);
    // A box beside a pole is a different kind.
    expect(newPointDuplicateWarnings(stored, { upserts: { equipment: [equipment({ id: 'F2', type: 'FAT', lat: 12.9003, lng: 77.6 })] } }, DEFAULT_OSP_SETTINGS)).toEqual([]);
  });

  it('uses the operator setting, checks items earlier in the same change, and skips placeholder points', () => {
    const far = pole('P3', 12.90008); // about 9 m
    expect(newPointDuplicateWarnings(stored, { upserts: { equipment: [far] } }, DEFAULT_OSP_SETTINGS)).toEqual([]);
    expect(newPointDuplicateWarnings(stored, { upserts: { equipment: [far] } }, [{ id: 'osp.duplicate.radiusMeters', value: 12 }])).toHaveLength(1);
    const pair = newPointDuplicateWarnings([], { upserts: { equipment: [pole('A', 12.95), pole('B', 12.95001)] } }, DEFAULT_OSP_SETTINGS);
    expect(pair.map((w) => [w.equipmentId, w.nearId])).toEqual([['B', 'A']]);
    expect(newPointDuplicateWarnings(stored, { upserts: { equipment: [pole('P4', 12.90001, { officeMustPlace: true })] } }, DEFAULT_OSP_SETTINGS)).toEqual([]);
    expect(newPointDuplicateWarnings(stored, { upserts: { equipment: [pole('P5', 12.90001)] }, deletes: { equipment: ['P1'] } }, DEFAULT_OSP_SETTINGS)).toEqual([]);
  });

  it('marks the warning as overridden when the same change carries the person\'s "add a new one" choice', () => {
    const [warning] = newPointDuplicateWarnings(
      stored,
      { upserts: { equipment: [pole('P2', 12.90002)], auditLogs: [log({ id: 'L', assetId: 'P2', action: POSSIBLE_DUPLICATE_KEPT })] } },
      DEFAULT_OSP_SETTINGS,
    );
    expect(warning.overridden).toBe(true);
    expect(warning.message).toMatch(/chose to keep both/);
  });
});
