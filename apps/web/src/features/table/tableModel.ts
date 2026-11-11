import { type CellValue, type FilterCondition, filterRecords, isNotRecorded, type NetworkSnapshot, type ReportCell, reportToCsv } from '@fibergis/shared';

import type { TableColumn, TableContext, TableLayer } from './tableLayers';

/**
 * Phase 16: what the attribute table does with its rows, kept apart from the screen so it can be
 * tested with 50,000 records: quick text filter, conditions, sort, the window of rows drawn, and
 * the CSV export through the shared safe writer.
 */

export type SortDirection = 'asc' | 'desc';
export interface SortState {
  key: string;
  direction: SortDirection;
}

export const NOT_RECORDED = 'Not recorded';

/** A cell as shown: "Not recorded" for nothing, yes/no for flags, numbers as written. */
export function showCell(value: CellValue): string {
  if (value === undefined || isNotRecorded(value)) return NOT_RECORDED;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return value.toLocaleString(undefined, { maximumFractionDigits: 6 });
  return value;
}

export interface TableQuery {
  /** Words to look for in any shown column. */
  text?: string;
  conditions?: readonly FilterCondition[];
  sort?: SortState | null;
  /** Only rows whose record is in this set. */
  only?: ReadonlySet<string> | null;
}

/** Rows that pass the quick filter, the conditions and the "only selected" choice, sorted. */
export function queryRows<R>(layer: TableLayer<R>, rows: readonly R[], ctx: TableContext, query: TableQuery, columns: readonly TableColumn<R>[] = layer.columns): R[] {
  const byKey = new Map(layer.columns.map((c) => [c.key, c]));
  let out: R[] = query.only ? rows.filter((r) => query.only!.has(layer.recordId(r))) : [...rows];
  const words = (query.text ?? '').trim().toLowerCase();
  if (words) {
    out = out.filter((r) =>
      columns.some((c) => {
        const v = c.get(r, ctx);
        return v !== undefined && String(v).toLowerCase().includes(words);
      }),
    );
  }
  if (query.conditions && query.conditions.length > 0) {
    out = filterRecords(out, query.conditions, (r, field) => byKey.get(field)?.get(r, ctx));
  }
  if (query.sort) {
    const column = byKey.get(query.sort.key);
    if (column) out = sortRows(out, column, query.sort.direction, ctx);
  }
  return out;
}

/**
 * Sorted copy. Values are read once per row (not once per comparison). Rows with nothing recorded
 * go last in either direction, so "not recorded" never hides at the top of a list that looks full.
 */
export function sortRows<R>(rows: readonly R[], column: TableColumn<R>, direction: SortDirection, ctx: TableContext): R[] {
  const sign = direction === 'asc' ? 1 : -1;
  const keyed = rows.map((row, i) => ({ row, i, v: column.get(row, ctx) }));
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  keyed.sort((a, b) => {
    const ea = a.v === undefined || isNotRecorded(a.v);
    const eb = b.v === undefined || isNotRecorded(b.v);
    if (ea || eb) return ea === eb ? a.i - b.i : ea ? 1 : -1;
    if (typeof a.v === 'number' && typeof b.v === 'number') return sign * (a.v - b.v) || a.i - b.i;
    return sign * collator.compare(String(a.v), String(b.v)) || a.i - b.i;
  });
  return keyed.map((k) => k.row);
}

/** Which rows to draw for a scroll position: the ones in view plus a few either side. */
export function rowWindow(total: number, scrollTop: number, viewHeight: number, rowHeight: number, overscan = 8): { start: number; end: number } {
  if (total === 0 || rowHeight <= 0) return { start: 0, end: 0 };
  const first = Math.floor(Math.max(0, scrollTop) / rowHeight);
  const start = Math.max(0, first - overscan);
  const end = Math.min(total, first + Math.ceil(Math.max(0, viewHeight) / rowHeight) + overscan);
  return { start, end: Math.max(start, end) };
}

/** Column order and visibility: saved choices, then any column added later in its own place. */
export function orderedColumns<R>(layer: TableLayer<R>, saved?: { order?: readonly string[]; hidden?: readonly string[] }): { column: TableColumn<R>; visible: boolean }[] {
  const byKey = new Map(layer.columns.map((c) => [c.key, c]));
  const order = [...(saved?.order ?? []).filter((k) => byKey.has(k)), ...layer.columns.map((c) => c.key).filter((k) => !(saved?.order ?? []).includes(k))];
  const hidden = saved?.hidden ? new Set(saved.hidden) : new Set(layer.columns.filter((c) => c.hidden).map((c) => c.key));
  return order.map((k) => ({ column: byKey.get(k)!, visible: !hidden.has(k) }));
}

/**
 * The rows as CSV through the shared writer (`reportToCsv`): quotes, commas and line breaks are
 * escaped and text that starts like a formula is kept as text. A blank cell means not recorded, as
 * in the other exports.
 */
export function tableCsv<R>(rows: readonly R[], columns: readonly TableColumn<R>[], ctx: TableContext): string {
  return reportToCsv({
    columns: columns.map((c) => ({ key: c.key, label: c.label })),
    rows: rows.map((r) => {
      const out: Record<string, ReportCell> = {};
      for (const c of columns) {
        const v = c.get(r, ctx);
        out[c.key] = v === undefined ? '' : typeof v === 'boolean' ? (v ? 'yes' : 'no') : v;
      }
      return out;
    }),
  });
}

/** Rows of a layer, once per network version. */
const rowsCache = new WeakMap<object, Map<string, readonly unknown[]>>();
export function layerRows<R>(layer: TableLayer<R>, data: NetworkSnapshot): readonly R[] {
  const source = data[layer.collection] as object;
  let byLayer = rowsCache.get(source);
  if (!byLayer) {
    byLayer = new Map();
    rowsCache.set(source, byLayer);
  }
  let rows = byLayer.get(layer.id) as readonly R[] | undefined;
  if (!rows) {
    rows = layer.rows(data);
    byLayer.set(layer.id, rows);
  }
  return rows;
}
