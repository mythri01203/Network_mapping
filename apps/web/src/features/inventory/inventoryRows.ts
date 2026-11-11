import type { Equipment } from '@fibergis/shared';

export type InventorySortKey = 'name' | 'type' | 'status' | 'installedDate' | 'model';
export type SortDirection = 'asc' | 'desc';

export const INVENTORY_PAGE_SIZE = 50;

/** Search across what people know an item by: id, name, kind, place, make, model, serial and tag. */
export function matchesInventorySearch(eq: Equipment, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [eq.id, eq.name, eq.type, eq.area, eq.street, eq.manufacturer, eq.model, eq.serialNumber, eq.tagCode]
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .some((v) => v.toLowerCase().includes(q));
}

const sortValue = (eq: Equipment, key: InventorySortKey): string =>
  key === 'model' ? [eq.manufacturer, eq.model].filter(Boolean).join(' ') : String(eq[key] ?? '');

/**
 * Sorted copy. Items with nothing recorded for the column go last in either direction, so "not
 * recorded" never hides at the top of a list that looks complete.
 */
export function sortInventory(list: readonly Equipment[], key: InventorySortKey, direction: SortDirection): Equipment[] {
  const sign = direction === 'asc' ? 1 : -1;
  return [...list].sort((a, b) => {
    const va = sortValue(a, key);
    const vb = sortValue(b, key);
    if (!va && !vb) return a.name.localeCompare(b.name);
    if (!va) return 1;
    if (!vb) return -1;
    return sign * va.localeCompare(vb, undefined, { numeric: true, sensitivity: 'base' }) || a.id.localeCompare(b.id);
  });
}

/** One page (counting from 0) and how many pages there are. An out-of-range page shows the last one. */
export function pageOf<T>(list: readonly T[], page: number, size = INVENTORY_PAGE_SIZE): { rows: T[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(list.length / size));
  const current = Math.min(Math.max(0, page), pages - 1);
  return { rows: list.slice(current * size, current * size + size), page: current, pages };
}
