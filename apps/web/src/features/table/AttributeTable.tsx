import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Columns3, Download, Filter, Maximize2, Minimize2, PencilLine, Search, X } from 'lucide-react';

import type { FilterCondition } from '@fibergis/shared';

import { cn } from '../../components/ui';
import { downloadFile } from '../../lib/browser';
import { readJson, writeJson } from '../../lib/storage';
import { useMayDo } from '../../stores/authStore';
import { useNetworkStore } from '../../stores/networkStore';
import { useSelectionStore } from '../../stores/selectionStore';
import { showToast } from '../../stores/toastStore';
import { useUiStore } from '../../stores/uiStore';
import { focusKey } from '../selection/selectionActions';
import { keyForSelection, keyOf } from '../selection/selectionModel';
import { BulkEditDialog } from './BulkEditDialog';
import { FilterBuilder } from './FilterBuilder';
import { layerById, TABLE_LAYERS, type TableColumn, tableContext,type TableLayer } from './tableLayers';
import { layerRows, NOT_RECORDED, orderedColumns, queryRows, rowWindow, showCell, type SortState, tableCsv } from './tableModel';

/**
 * Phase 16: the attribute table. One layer at a time (equipment kinds, cables, customers, ducts,
 * spans, splices...), sorted by any column, drawn only where it is scrolled (so 50,000 rows stay
 * quick), with columns shown, hidden and ordered per layer on this device, rows chosen together
 * with the map, a filter builder, bulk edit through the server and a CSV export.
 */

const COLUMN_PREFS_KEY = 'table_columns';
type ColumnPrefs = Record<string, { order: string[]; hidden: string[] }>;
const isPrefs = (v: unknown) => typeof v === 'object' && v !== null && !Array.isArray(v);

const CHECK_WIDTH = 52;

export function AttributeTable() {
  const data = useNetworkStore(useCallback((s) => s, []));
  const keys = useSelectionStore((s) => s.keys);
  const request = useSelectionStore((s) => s.tableRequest);
  const tall = useSelectionStore((s) => s.tableTall);
  const focused = useUiStore((s) => s.selectedObject);
  const mayExport = useMayDo('export');
  const mayEdit = useMayDo('edit');

  const [layerId, setLayerId] = useState(TABLE_LAYERS[0].id);
  const [onlySelected, setOnlySelected] = useState(false);
  const [text, setText] = useState('');
  const [conditions, setConditions] = useState<FilterCondition[]>([]);
  const [sort, setSort] = useState<SortState | null>(null);
  const [panel, setPanel] = useState<'filters' | 'columns' | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [prefs, setPrefs] = useState<ColumnPrefs>(() => readJson<ColumnPrefs>(COLUMN_PREFS_KEY, {}, isPrefs));

  const layer = layerById(layerId) as TableLayer<unknown>;

  // "Open table" from the map or the search box (also the request that opened it, on first show).
  const [seenRequest, setSeenRequest] = useState<typeof request | undefined>(undefined);
  if (request !== seenRequest) {
    setSeenRequest(request);
    if (request?.layerId) setLayerId(layerById(request.layerId).id);
    if (request?.onlySelected !== undefined) setOnlySelected(request.onlySelected);
    if (request?.filters) setPanel('filters');
  }

  // A new layer starts with its own sort and filters.
  const changeLayer = (id: string) => {
    setLayerId(id);
    setSort(null);
    setConditions([]);
  };

  const { equipment, cables } = data;
  const ctx = useMemo(() => tableContext({ equipment, cables }), [equipment, cables]);
  const allRows = useMemo(() => layerRows(layer, data), [layer, data]);
  const columns = useMemo(() => orderedColumns(layer, prefs[layer.id]), [layer, prefs]);
  const visible = useMemo(() => columns.filter((c) => c.visible).map((c) => c.column), [columns]);
  const only = useMemo(() => {
    if (!onlySelected) return null;
    const ids = new Set<string>();
    for (const k of keys) if (k.startsWith(`${layer.collection}:`)) ids.add(k.slice(layer.collection.length + 1));
    return ids;
  }, [onlySelected, keys, layer.collection]);
  const rows = useMemo(() => queryRows(layer, allRows, ctx, { text, conditions, sort, only }, visible), [layer, allRows, ctx, text, conditions, sort, only, visible]);

  const rowKey = useCallback((r: unknown) => keyOf(layer.collection, layer.recordId(r)), [layer]);
  const selectedHere = useMemo(() => {
    let n = 0;
    const seen = new Set<string>();
    for (const r of allRows) {
      const k = rowKey(r);
      if (keys.has(k) && !seen.has(k)) {
        seen.add(k);
        n += 1;
      }
    }
    return { count: n, ids: [...seen].map((k) => k.slice(layer.collection.length + 1)) };
  }, [allRows, keys, rowKey, layer.collection]);

  // Virtual scrolling.
  const scroller = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState({ top: 0, height: 400 });
  const rowHeight = typeof window !== 'undefined' && window.innerWidth < 768 ? 52 : 36;
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setScroll({ top: el.scrollTop, height: el.clientHeight });
    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    observer?.observe(el);
    return () => observer?.disconnect();
  }, []);
  const { start, end } = rowWindow(rows.length, scroll.top, scroll.height, rowHeight);

  // The item open in the inspector is shown in the table too.
  const focusedKey = focused ? keyForSelection(focused) : null;
  const scrolledTo = useRef<string | null>(null);
  useEffect(() => {
    // Only when the focused item changes, not on every edit.
    if (!focusedKey || focusedKey === scrolledTo.current || !scroller.current) return;
    scrolledTo.current = focusedKey;
    const at = rows.findIndex((r) => rowKey(r) === focusedKey);
    if (at < 0) return;
    const el = scroller.current;
    const top = at * rowHeight;
    if (top < el.scrollTop || top > el.scrollTop + el.clientHeight - rowHeight * 2) el.scrollTop = Math.max(0, top - rowHeight * 2);
  }, [focusedKey, rows, rowKey, rowHeight]);

  const lastClicked = useRef<number | null>(null);
  const toggleRow = (index: number, shift: boolean) => {
    const store = useSelectionStore.getState();
    const key = rowKey(rows[index]);
    if (shift && lastClicked.current !== null) {
      const [a, b] = [Math.min(lastClicked.current, index), Math.max(lastClicked.current, index)];
      store.setKeys(rows.slice(a, b + 1).map(rowKey), store.keys.has(key) ? 'remove' : 'add');
    } else store.toggle(key);
    lastClicked.current = index;
  };

  const allShownChosen = rows.length > 0 && rows.every((r) => keys.has(rowKey(r)));
  const chooseShown = () => {
    const store = useSelectionStore.getState();
    store.setKeys(rows.map(rowKey), allShownChosen ? 'remove' : 'add');
  };

  const savePrefs = (next: { order: string[]; hidden: string[] }) => {
    const all = { ...prefs, [layer.id]: next };
    setPrefs(all);
    writeJson(COLUMN_PREFS_KEY, all);
  };
  const currentPrefs = { order: columns.map((c) => c.column.key), hidden: columns.filter((c) => !c.visible).map((c) => c.column.key) };

  const exportCsv = () => {
    const csv = tableCsv(rows, visible, ctx);
    downloadFile(csv, 'text/csv;charset=utf-8', `fibergis-${layer.id}-${new Date().toISOString().slice(0, 10)}.csv`);
    showToast('success', 'Spreadsheet saved', `${rows.length.toLocaleString()} row(s) of ${layer.label}, the columns shown. A blank cell means not recorded.`);
  };

  const totalWidth = CHECK_WIDTH + visible.reduce((n, c) => n + c.width, 0);
  const sortBy = (c: TableColumn<unknown>) =>
    setSort((s) => (s?.key === c.key ? (s.direction === 'asc' ? { key: c.key, direction: 'desc' } : null) : { key: c.key, direction: 'asc' }));

  const ctrl = 'flex h-[48px] shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[13px] font-medium text-slate-700 hover:bg-slate-50 md:h-8 md:px-2.5 md:text-[12px]';

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="attribute-table">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-slate-100 px-2 py-1.5">
        <select aria-label="Which items" value={layer.id} onChange={(e) => changeLayer(e.target.value)} className="h-[48px] max-w-[60vw] rounded-lg border border-slate-200 bg-white px-2 text-[13px] font-semibold text-slate-800 md:h-8 md:text-[12px]" data-testid="table-layer">
          {TABLE_LAYERS.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label} ({layerRows(l, data).length.toLocaleString()})
            </option>
          ))}
        </select>
        <div className="flex h-[48px] min-w-[140px] flex-1 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 md:h-8 md:max-w-xs">
          <Search size={14} className="text-slate-400" />
          <input aria-label="Look in this table" value={text} onChange={(e) => setText(e.target.value)} placeholder="Look in this table…" className="min-w-0 flex-1 bg-transparent text-[13px] outline-none md:text-[12px]" />
          {text && (
            <button type="button" aria-label="Clear" onClick={() => setText('')} className="text-slate-400">
              <X size={14} />
            </button>
          )}
        </div>
        <button type="button" className={cn(ctrl, (panel === 'filters' || conditions.length > 0) && 'border-blue-300 bg-blue-50 text-blue-800')} onClick={() => setPanel(panel === 'filters' ? null : 'filters')} data-testid="table-filters">
          <Filter size={14} /> Filters{conditions.length > 0 ? ` (${conditions.length})` : ''}
        </button>
        <button type="button" className={cn(ctrl, panel === 'columns' && 'border-blue-300 bg-blue-50 text-blue-800')} onClick={() => setPanel(panel === 'columns' ? null : 'columns')}>
          <Columns3 size={14} /> Columns
        </button>
        <label className={cn(ctrl, 'cursor-pointer')}>
          <input type="checkbox" className="h-5 w-5 md:h-4 md:w-4" checked={onlySelected} onChange={(e) => setOnlySelected(e.target.checked)} data-testid="table-only-selected" />
          Only chosen ({selectedHere.count.toLocaleString()})
        </label>
        {layer.editable && mayEdit && selectedHere.count > 0 && (
          <button type="button" className={cn(ctrl, 'border-amber-300 bg-amber-50 text-amber-900')} onClick={() => setBulkOpen(true)} data-testid="table-bulk-edit">
            <PencilLine size={14} /> Change {selectedHere.count.toLocaleString()} chosen
          </button>
        )}
        {mayExport && (
          <button type="button" className={ctrl} onClick={exportCsv} disabled={rows.length === 0} data-testid="table-export">
            <Download size={14} /> Spreadsheet (CSV)
          </button>
        )}
        <button type="button" aria-label={tall ? 'Make the table smaller' : 'Make the table taller'} className={cn(ctrl, 'hidden md:flex')} onClick={() => useSelectionStore.getState().setTableTall(!tall)}>
          {tall ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
        <span className="ml-auto px-1 text-[12px] text-slate-500" data-testid="table-count">
          {rows.length.toLocaleString()} of {allRows.length.toLocaleString()} shown
        </span>
      </div>

      {panel === 'filters' && <FilterBuilder layer={layer} conditions={conditions} onChange={setConditions} onClose={() => setPanel(null)} />}
      {panel === 'columns' && <ColumnPanel layer={layer} columns={columns} onChange={savePrefs} current={currentPrefs} onReset={() => { const all = { ...prefs }; delete all[layer.id]; setPrefs(all); writeJson(COLUMN_PREFS_KEY, all); }} onClose={() => setPanel(null)} />}

      <div ref={scroller} className="relative min-h-0 flex-1 overflow-auto" onScroll={(e) => setScroll({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight })}>
        <div style={{ width: totalWidth, minWidth: '100%' }}>
          <div className="sticky top-0 z-10 flex border-b border-slate-200 bg-slate-50 text-[12px] font-semibold text-slate-600" role="row">
            <div style={{ width: CHECK_WIDTH }} className="flex shrink-0 items-center justify-center">
              <input type="checkbox" aria-label={allShownChosen ? 'Take every shown row out of the choice' : 'Choose every shown row'} className="h-5 w-5 md:h-4 md:w-4" checked={allShownChosen} onChange={chooseShown} data-testid="table-choose-shown" />
            </div>
            {visible.map((c) => (
              <button key={c.key} type="button" role="columnheader" style={{ width: c.width }} onClick={() => sortBy(c)} className="flex h-[44px] shrink-0 items-center gap-1 truncate px-2 text-left hover:text-slate-900 md:h-8" aria-sort={sort?.key === c.key ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
                <span className="truncate">{c.label}</span>
                {sort?.key === c.key && (sort.direction === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
              </button>
            ))}
          </div>
          <div style={{ height: rows.length * rowHeight, position: 'relative' }}>
            {rows.slice(start, end).map((row, i) => {
              const index = start + i;
              const key = rowKey(row);
              const chosen = keys.has(key);
              return (
                <div
                  key={layer.rowId(row)}
                  role="row"
                  aria-selected={chosen}
                  style={{ position: 'absolute', top: index * rowHeight, height: rowHeight, width: '100%' }}
                  className={cn('flex border-b border-slate-100 text-[13px] md:text-[12px]', chosen ? 'bg-amber-50' : index % 2 ? 'bg-white' : 'bg-slate-50/40', key === focusedKey && 'ring-2 ring-inset ring-blue-400')}
                >
                  <div style={{ width: CHECK_WIDTH }} className="flex shrink-0 items-center justify-center">
                    <input type="checkbox" aria-label={`Choose ${layer.rowId(row)}`} className="h-5 w-5 md:h-4 md:w-4" checked={chosen} onChange={(e) => toggleRow(index, (e.nativeEvent as MouseEvent).shiftKey)} />
                  </div>
                  {visible.map((c, ci) => {
                    const value = c.get(row, ctx);
                    const shown = showCell(value);
                    const missing = shown === NOT_RECORDED;
                    const content = <span className={cn('truncate', c.mono && !missing && 'font-mono text-[12px] md:text-[11px]', missing && 'text-slate-400')}>{shown}</span>;
                    return ci === 0 ? (
                      <button key={c.key} type="button" style={{ width: c.width }} title="Show on the map" onClick={() => focusKey(key)} className="flex shrink-0 items-center truncate px-2 text-left font-medium text-blue-700 hover:underline">
                        {content}
                      </button>
                    ) : (
                      <div key={c.key} style={{ width: c.width }} className={cn('flex shrink-0 items-center px-2', c.type === 'number' && 'justify-end tabular-nums')} title={missing ? undefined : shown}>
                        {content}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
          {rows.length === 0 && <p className="px-4 py-6 text-center text-[13px] text-slate-500">{allRows.length === 0 ? `No ${layer.label.toLowerCase()} on record.` : 'No rows match. Change the filters or clear the search.'}</p>}
        </div>
      </div>
      {layer.note && <p className="shrink-0 border-t border-slate-100 px-3 py-1 text-[12px] text-slate-500">{layer.note}</p>}
      {bulkOpen && <BulkEditDialog layer={layer} ids={selectedHere.ids} onClose={() => setBulkOpen(false)} />}
    </div>
  );
}

function ColumnPanel({
  layer,
  columns,
  current,
  onChange,
  onReset,
  onClose,
}: {
  layer: TableLayer<unknown>;
  columns: { column: TableColumn<unknown>; visible: boolean }[];
  current: { order: string[]; hidden: string[] };
  onChange: (next: { order: string[]; hidden: string[] }) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const move = (key: string, by: -1 | 1) => {
    const order = [...current.order];
    const i = order.indexOf(key);
    const j = i + by;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    onChange({ ...current, order });
  };
  const toggle = (key: string, show: boolean) => onChange({ ...current, hidden: show ? current.hidden.filter((k) => k !== key) : [...current.hidden, key] });
  return (
    <div className="max-h-[45%] shrink-0 overflow-y-auto border-b border-slate-200 bg-slate-50 px-3 py-2" aria-label={`Columns of ${layer.label}`}>
      <div className="mb-1 flex items-center gap-2">
        <span className="flex-1 text-[12px] font-semibold text-slate-700">Columns: tick to show, arrows to move. Kept on this device.</span>
        <button type="button" className="h-[48px] rounded-lg px-3 text-[12px] font-medium text-slate-600 hover:bg-white md:h-7" onClick={onReset}>Reset</button>
        <button type="button" aria-label="Close columns" className="flex h-[48px] w-[48px] items-center justify-center rounded-lg text-slate-500 hover:bg-white md:h-7 md:w-7" onClick={onClose}><X size={16} /></button>
      </div>
      <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
        {columns.map(({ column, visible }, i) => (
          <li key={column.key} className="flex items-center gap-1 rounded-lg bg-white px-2 ring-1 ring-slate-200">
            <label className="flex min-h-[48px] flex-1 items-center gap-2 text-[13px] md:min-h-8 md:text-[12px]">
              <input type="checkbox" className="h-5 w-5 md:h-4 md:w-4" checked={visible} disabled={visible && columns.filter((c) => c.visible).length === 1} onChange={(e) => toggle(column.key, e.target.checked)} />
              {column.label}
            </label>
            <button type="button" aria-label={`Move ${column.label} left`} disabled={i === 0} onClick={() => move(column.key, -1)} className="flex h-[48px] w-10 items-center justify-center text-slate-500 disabled:opacity-30 md:h-8 md:w-7"><ArrowUp size={14} /></button>
            <button type="button" aria-label={`Move ${column.label} right`} disabled={i === columns.length - 1} onClick={() => move(column.key, 1)} className="flex h-[48px] w-10 items-center justify-center text-slate-500 disabled:opacity-30 md:h-8 md:w-7"><ArrowDown size={14} /></button>
          </li>
        ))}
      </ul>
    </div>
  );
}
