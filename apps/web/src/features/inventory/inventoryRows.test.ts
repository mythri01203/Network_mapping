import { describe, expect, it } from 'vitest';

import type { Equipment } from '@fibergis/shared';

import { matchesInventorySearch, pageOf, sortInventory } from './inventoryRows';

const eq = (id: string, over: Partial<Equipment> = {}): Equipment => ({
  id,
  name: id,
  type: 'FAT',
  category: 'Fiber Distribution',
  lat: 12.9,
  lng: 77.6,
  area: '',
  street: '',
  status: 'Active',
  images: [],
  installedDate: '',
  ...over,
});

describe('inventory rows', () => {
  it('finds an item by make, model, serial or tag', () => {
    const box = eq('FAT-1', { manufacturer: 'Acme', model: 'FAT-16', serialNumber: 'SN123', tagCode: 'QR-9' });
    for (const q of ['acme', 'fat-16', 'sn123', 'qr-9', 'FAT-1']) expect(matchesInventorySearch(box, q)).toBe(true);
    expect(matchesInventorySearch(box, 'zte')).toBe(false);
    expect(matchesInventorySearch(box, '  ')).toBe(true);
  });

  it('sorts with numbers in order and puts not recorded last both ways', () => {
    const list = [eq('a', { name: 'Box 10', installedDate: '2025-01-02' }), eq('b', { name: 'Box 2', installedDate: '' }), eq('c', { name: 'Box 1', installedDate: '2024-06-01' })];
    expect(sortInventory(list, 'name', 'asc').map((e) => e.name)).toEqual(['Box 1', 'Box 2', 'Box 10']);
    expect(sortInventory(list, 'installedDate', 'asc').map((e) => e.id)).toEqual(['c', 'a', 'b']);
    expect(sortInventory(list, 'installedDate', 'desc').map((e) => e.id)).toEqual(['a', 'c', 'b']);
  });

  it('pages and keeps the page in range', () => {
    const list = Array.from({ length: 120 }, (_, i) => i);
    expect(pageOf(list, 0)).toMatchObject({ page: 0, pages: 3 });
    expect(pageOf(list, 2).rows).toHaveLength(20);
    expect(pageOf(list, 9).page).toBe(2);
    expect(pageOf([], 0)).toEqual({ rows: [], page: 0, pages: 1 });
  });
});
