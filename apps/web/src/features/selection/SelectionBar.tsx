import { useState } from 'react';
import type L from 'leaflet';
import { ArrowLeftRight, Check, Crosshair, FolderOpen, MoreHorizontal, Save, Share2, TableProperties, Undo2, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { cn } from '../../components/ui';
import { useMapStore } from '../../stores/mapStore';
import { useSelectionStore } from '../../stores/selectionStore';
import { layerForCollection } from '../table/tableLayers';
import { invertSelection, selectConnected, selectInArea, zoomToKeys } from './selectionActions';
import { FloatingMenu, type MenuEntry } from './SelectionMenus';
import { countByCollection, describeCounts } from './selectionModel';

const btn = 'flex h-[48px] shrink-0 items-center justify-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold md:h-9';

/**
 * Phase 16: the bar over the map while items are chosen, or a choosing tool is on. It says how
 * many, of what, and offers zoom, the table, more actions and clear, each a plain button (no
 * hover, long-press or drag needed).
 */
export function SelectionBar({ map: _map }: { map: L.Map }) {
  const { keys, multiMode, areaTool, areaPoints, setMultiMode, setAreaTool, setAreaPoints, clear, openTable, setDialog } = useSelectionStore(
    useShallow((s) => ({
      keys: s.keys,
      multiMode: s.multiMode,
      areaTool: s.areaTool,
      areaPoints: s.areaPoints,
      setMultiMode: s.setMultiMode,
      setAreaTool: s.setAreaTool,
      setAreaPoints: s.setAreaPoints,
      clear: s.clear,
      openTable: s.openTable,
      setDialog: s.setDialog,
    })),
  );
  const tool = useMapStore((s) => s.activeTool);
  const [more, setMore] = useState<{ x: number; y: number } | null>(null);
  const [addArea, setAddArea] = useState(false);
  if (tool !== 'select' || (keys.size === 0 && !multiMode && !areaTool)) return null;

  const counts = countByCollection(keys);
  const firstCollection = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const showTable = () => openTable({ onlySelected: true, ...(firstCollection ? { layerId: layerForCollection(firstCollection).id } : {}) });

  const moreEntries: MenuEntry[] = [
    { id: 'connected', label: 'Select connected', hint: 'Joined by recorded links only', icon: Share2, onSelect: () => selectConnected() },
    { id: 'invert', label: 'Invert', hint: 'Same kinds: chosen becomes not chosen', icon: ArrowLeftRight, onSelect: invertSelection },
    { id: 'save', label: 'Save this selection…', hint: 'Kept on this device, for you', icon: Save, onSelect: () => setDialog('saved') },
    { id: 'saved', label: 'Saved selections…', icon: FolderOpen, onSelect: () => setDialog('saved') },
    { id: 'export', label: 'Export to a spreadsheet…', hint: 'From the attribute table', icon: TableProperties, onSelect: showTable },
  ];

  return (
    <div
      className="gis-no-print absolute inset-x-2 top-[64px] z-[446] md:inset-x-auto md:bottom-4 md:left-1/2 md:top-auto md:-translate-x-1/2"
      data-testid="selection-bar"
    >
      <div className="flex flex-col gap-1.5 rounded-xl border border-amber-300 bg-white p-1.5 shadow-lg md:flex-row md:items-center">
        {areaTool ? (
          <>
            <span className="min-w-0 flex-1 px-2 text-[13px] font-semibold text-slate-900">
              {areaTool === 'polygon'
                ? areaPoints.length < 3
                  ? `Tap the corners of the area (${areaPoints.length} so far, 3 or more)`
                  : `${areaPoints.length} corners. Tap more, or choose what is inside.`
                : areaTool === 'box'
                  ? 'Press and drag on the map to draw a box'
                  : 'Press and draw round the items'}
            </span>
            <div className="flex flex-wrap gap-1.5">
              {areaTool === 'polygon' && (
                <>
                  <label className={cn(btn, 'cursor-pointer gap-2 bg-slate-50 font-medium text-slate-700')}>
                    <input type="checkbox" className="h-5 w-5" checked={addArea} onChange={(e) => setAddArea(e.target.checked)} />
                    Add to chosen
                  </label>
                  <button type="button" className={cn(btn, 'bg-slate-100 text-slate-700')} disabled={areaPoints.length === 0} onClick={() => setAreaPoints((p) => p.slice(0, -1))}>
                    <Undo2 size={16} /> Undo corner
                  </button>
                  <button
                    type="button"
                    data-testid="area-select-inside"
                    className={cn(btn, 'bg-blue-600 text-white disabled:opacity-40')}
                    disabled={areaPoints.length < 3}
                    onClick={() => {
                      selectInArea(areaPoints, addArea ? 'add' : 'replace');
                      setAreaTool(null);
                    }}
                  >
                    <Check size={16} /> Choose what is inside
                  </button>
                </>
              )}
              <button type="button" className={cn(btn, 'bg-slate-100 text-slate-700')} onClick={() => setAreaTool(null)}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <span className="min-w-0 flex-1 px-2 text-[13px] text-slate-800" data-testid="selection-count">
              {keys.size === 0 ? (
                <span className="font-semibold">Tap items on the map to choose them</span>
              ) : (
                <>
                  <span className="font-semibold">{keys.size.toLocaleString()} chosen</span>
                  <span className="text-slate-500">: {describeCounts(counts)}</span>
                </>
              )}
            </span>
            <div className="flex flex-wrap gap-1.5">
              {multiMode && (
                <button type="button" className={cn(btn, 'bg-emerald-600 text-white')} onClick={() => setMultiMode(false)}>
                  <Check size={16} /> Done
                </button>
              )}
              {keys.size > 0 && (
                <>
                  <button type="button" className={cn(btn, 'bg-slate-100 text-slate-800')} onClick={() => zoomToKeys(keys)}>
                    <Crosshair size={16} /> Zoom to
                  </button>
                  <button
                    type="button"
                    data-testid="selection-open-table"
                    className={cn(btn, 'bg-slate-100 text-slate-800')}
                    onClick={showTable}
                  >
                    <TableProperties size={16} /> Table
                  </button>
                  <button
                    type="button"
                    aria-label="More actions for the chosen items"
                    className={cn(btn, 'bg-slate-100 text-slate-800')}
                    onClick={(e) => {
                      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      setMore(more ? null : { x: r.left, y: Math.max(8, r.top - 300) });
                    }}
                  >
                    <MoreHorizontal size={16} /> More
                  </button>
                  <button type="button" data-testid="selection-clear" className={cn(btn, 'bg-white text-slate-700 ring-1 ring-slate-200')} onClick={clear}>
                    <X size={16} /> Clear
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
      {more && (
        <FloatingMenu x={more.x} y={more.y} title={`${keys.size.toLocaleString()} chosen`} onClose={() => setMore(null)}>
          <ul className="py-1">
            {moreEntries.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => {
                    setMore(null);
                    e.onSelect();
                  }}
                  className="flex min-h-[48px] w-full items-center gap-3 px-4 text-left text-[14px] text-slate-800 hover:bg-slate-100 md:min-h-[36px] md:px-3 md:text-[13px]"
                >
                  <e.icon size={18} className="shrink-0 text-slate-500" />
                  <span className="min-w-0 flex-1">
                    {e.label}
                    {e.hint && <span className="block text-[12px] text-slate-500">{e.hint}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </FloatingMenu>
      )}
    </div>
  );
}
