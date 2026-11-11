import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  BoxSelect,
  Copy,
  Crosshair,
  Filter,
  FolderOpen,
  Hexagon,
  Lasso,
  type LucideIcon,
  MousePointerClick,
  PanelRightOpen,
  Pentagon,
  Route,
  Share2,
  SquareCheck,
  SquareMinus,
  TableProperties,
  Waypoints,
  X,
} from 'lucide-react';

import { cn } from '../../components/ui';
import { useSelectionStore } from '../../stores/selectionStore';
import { copyKeyId, focusKey, keyLabel, selectConnected, selectTraced, traceKey, zoomToKeys } from './selectionActions';
import { parseKey, type SelectionKey } from './selectionModel';

/** Phase 16: the right-click menu (a sheet on phones) and the "Choose several" tools menu. */

const isPhone = () => typeof window !== 'undefined' && window.innerWidth < 768;
/** Dragging a box or lasso needs a mouse; touch screens use "tap the corners". */
export const hasMouse = () => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: fine)').matches;

export interface MenuEntry {
  id: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  onSelect: () => void;
  active?: boolean;
  hidden?: boolean;
}

function MenuList({ entries, onDone }: { entries: MenuEntry[]; onDone: () => void }) {
  return (
    <ul className="py-1" role="menu">
      {entries
        .filter((e) => !e.hidden)
        .map((e) => (
          <li key={e.id}>
            <button
              type="button"
              role="menuitem"
              data-testid={`sel-menu-${e.id}`}
              onClick={() => {
                onDone();
                e.onSelect();
              }}
              className={cn(
                'flex min-h-[48px] w-full items-center gap-3 px-4 text-left text-[14px] text-slate-800 hover:bg-slate-100 md:min-h-[36px] md:px-3 md:text-[13px]',
                e.active && 'bg-blue-50 font-semibold text-blue-800',
              )}
            >
              <e.icon size={18} className="shrink-0 text-slate-500" />
              <span className="min-w-0 flex-1">
                {e.label}
                {e.hint && <span className="block text-[12px] font-normal text-slate-500">{e.hint}</span>}
              </span>
            </button>
          </li>
        ))}
    </ul>
  );
}

/** A floating menu at a screen point, or a sheet at the bottom on phones. Closes on outside tap or Escape. */
export function FloatingMenu({ x, y, sheet, title, onClose, children }: { x: number; y: number; sheet?: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const t = window.setTimeout(() => {
      document.addEventListener('mousedown', onDown);
      document.addEventListener('touchstart', onDown);
    }, 0);
    document.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  const asSheet = sheet || isPhone();
  const style = asSheet ? undefined : { left: Math.max(8, Math.min(x, window.innerWidth - 268)), top: Math.max(8, Math.min(y, window.innerHeight - 420)) };
  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={title}
      style={style}
      className={cn(
        'animate-pop-in fixed z-[1900] overflow-y-auto border border-slate-200 bg-white shadow-[var(--shadow-overlay)]',
        asSheet ? 'inset-x-0 bottom-0 max-h-[75vh] rounded-t-2xl pb-[env(safe-area-inset-bottom)]' : 'max-h-[420px] w-64 rounded-xl',
      )}
    >
      <div className="flex items-center gap-2 border-b border-slate-100 py-1 pl-4 pr-1 md:pl-3">
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-slate-900">{title}</span>
        <button type="button" aria-label="Close menu" onClick={onClose} className="flex h-[48px] w-[48px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 md:h-8 md:w-8">
          <X size={18} />
        </button>
      </div>
      {children}
    </div>,
    document.body,
  );
}

/** What can be done with one record, in the same order everywhere. */
export function recordMenuEntries(key: SelectionKey): MenuEntry[] {
  const store = useSelectionStore.getState();
  const p = parseKey(key);
  const traceable = !!p && ['equipment', 'cables', 'customers', 'faults', 'closures', 'splitters'].includes(p.collection);
  const inSet = store.keys.has(key);
  return [
    { id: 'open', label: 'Open details', icon: PanelRightOpen, onSelect: () => focusKey(key) },
    { id: 'zoom', label: 'Zoom to it', icon: Crosshair, onSelect: () => zoomToKeys([key]) },
    { id: 'trace', label: 'Trace the path', hint: 'Shows the route back to the OLT', icon: Route, hidden: !traceable, onSelect: () => traceKey(key) },
    { id: 'connected', label: 'Select connected', hint: 'Joined by recorded links only', icon: Share2, onSelect: () => selectConnected([key]) },
    { id: 'traced', label: 'Select the traced path', icon: Waypoints, hidden: !traceable, onSelect: () => selectTraced(key) },
    inSet
      ? { id: 'remove', label: 'Take out of selection', icon: SquareMinus, onSelect: () => store.setKeys([key], 'remove') }
      : { id: 'add', label: 'Add to selection', icon: SquareCheck, onSelect: () => store.setKeys([key], 'add') },
    { id: 'copy', label: 'Copy id', hint: p?.id, icon: Copy, onSelect: () => void copyKeyId(key) },
  ];
}

/** The ways to choose several items, for the toolbar menu and an empty right-click. */
export function toolEntries(): MenuEntry[] {
  const s = useSelectionStore.getState();
  const mouse = hasMouse();
  return [
    { id: 'several', label: s.multiMode ? 'Stop choosing several' : 'Choose several (tap each)', hint: mouse ? 'Or hold Shift or Ctrl and click' : undefined, icon: MousePointerClick, active: s.multiMode, onSelect: () => s.setMultiMode(!s.multiMode) },
    { id: 'polygon', label: 'Draw an area (tap the corners)', icon: Pentagon, active: s.areaTool === 'polygon', onSelect: () => s.setAreaTool('polygon') },
    { id: 'box', label: 'Drag a box', hint: 'Hold Shift to add to what is chosen', icon: BoxSelect, hidden: !mouse, active: s.areaTool === 'box', onSelect: () => s.setAreaTool('box') },
    { id: 'lasso', label: 'Draw freehand (lasso)', icon: Lasso, hidden: !mouse, active: s.areaTool === 'lasso', onSelect: () => s.setAreaTool('lasso') },
    { id: 'zone', label: 'Everything in a zone…', icon: Hexagon, onSelect: () => s.setDialog('zone') },
    { id: 'attribute', label: 'By a value (field is…)', icon: Filter, onSelect: () => s.setDialog('attribute') },
    { id: 'saved', label: 'Saved selections…', icon: FolderOpen, onSelect: () => s.setDialog('saved') },
    { id: 'table', label: 'Open the attribute table', icon: TableProperties, onSelect: () => s.openTable({}) },
  ];
}

export function ContextMenu() {
  const menu = useSelectionStore((s) => s.menu);
  const close = useSelectionStore((s) => s.closeMenu);
  if (!menu) return null;
  const title = menu.key ? keyLabel(menu.key) : 'Choose items';
  return (
    <FloatingMenu x={menu.x} y={menu.y} sheet={menu.sheet} title={title} onClose={close}>
      <MenuList entries={menu.key ? recordMenuEntries(menu.key) : toolEntries()} onDone={close} />
    </FloatingMenu>
  );
}

/** The toolbar button: "Choose several" and every other way to select. */
export function SelectToolsButton() {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const active = useSelectionStore((s) => s.multiMode || !!s.areaTool);
  const count = useSelectionStore((s) => s.keys.size);
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        aria-label="Choose several"
        aria-pressed={active}
        aria-haspopup="menu"
        data-testid="select-tools"
        onClick={(e) => {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setAt(at ? null : { x: r.left, y: r.bottom + 8 });
        }}
        className={cn(
          'relative flex h-[48px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-[13px] font-medium transition-colors md:h-9',
          active ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
        )}
      >
        <BoxSelect className="h-[18px] w-[18px]" strokeWidth={1.9} />
        <span className="hidden lg:inline">Choose several</span>
        {count > 0 && <span className="rounded-full bg-amber-500 px-1.5 text-[11px] font-bold leading-[18px] text-white">{count > 999 ? '999+' : count}</span>}
      </button>
      {at && (
        <FloatingMenu x={at.x} y={at.y} title="Choose items" onClose={() => setAt(null)}>
          <MenuList entries={toolEntries()} onDone={() => setAt(null)} />
        </FloatingMenu>
      )}
    </div>
  );
}
