import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bike,
  Check,
  ChevronDown,
  CornerUpLeft,
  Crosshair,
  GripVertical,
  LayoutGrid,
  type LucideIcon,
  MousePointer2,
  Redo2,
  Ruler,
  Search,
  Spline,
  Trash2,
  Undo2,
  UserPlus,
  UtilityPole,
  X,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import type { CableType, CatalogComponent, EquipmentType } from '@fibergis/shared';

import { cn, equipmentIcon, Switch } from '../../components/ui';
import { useMapStore } from '../../stores/mapStore';
import { deleteCable, deleteEquipment } from '../../stores/networkActions';
import { selectCanRedo, selectCanUndo, useNetworkStore } from '../../stores/networkStore';
import { useToastStore } from '../../stores/toastStore';
import { selectionLabel, useUiStore } from '../../stores/uiStore';
import { cableStyle } from '../../theme/network';
import { BUILT_IN_COMPONENTS } from '../catalog/componentCatalog';
import { formatDistance } from './markerIcons';

const CABLE_TYPES: { type: CableType; hint: string }[] = [
  { type: 'Main Feeder Fiber', hint: 'OLT → FDMS backbone' },
  { type: 'Distribution Fiber', hint: 'FDMS → FAT / splitter' },
  { type: 'Drop Fiber', hint: 'FAT → customer premises' },
  { type: 'Aerial Fiber', hint: 'Pole-mounted overhead run' },
  { type: 'Underground Fiber', hint: 'Duct / trench run' },
  { type: 'Coaxial Cable', hint: 'CATV RF distribution' },
  { type: 'Custom Cable', hint: 'Any other cable' },
];

const CATEGORY_ORDER = [
  'Central Office',
  'Fiber Distribution',
  'Supporting Infrastructure',
  'Customer Equipment',
  'Cable TV Infrastructure',
];

const CATEGORY_TINT: Record<string, string> = {
  'Central Office': 'bg-blue-50 text-blue-700 ring-blue-100',
  'Fiber Distribution': 'bg-teal-50 text-teal-700 ring-teal-100',
  'Supporting Infrastructure': 'bg-amber-50 text-amber-700 ring-amber-100',
  'Customer Equipment': 'bg-violet-50 text-violet-700 ring-violet-100',
  'Cable TV Infrastructure': 'bg-orange-50 text-orange-700 ring-orange-100',
  Custom: 'bg-slate-100 text-slate-700 ring-slate-200',
};

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return (
    !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
  );
}

function useOutsideClose(open: boolean, setOpen: (v: boolean) => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, setOpen]);
  return ref;
}

function Shortcut({ children, dark }: { children: React.ReactNode; dark?: boolean }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded px-1 font-sans text-[10px] font-semibold',
        dark ? 'bg-white/10 text-slate-300 ring-1 ring-white/15' : 'bg-slate-100 text-slate-500 ring-1 ring-slate-200',
      )}
    >
      {children}
    </kbd>
  );
}

interface ToolButtonProps {
  icon: LucideIcon;
  label: string;
  shortcut?: string;
  active?: boolean;
  disabled?: boolean;
  danger?: boolean;
  caret?: boolean;
  showLabel?: boolean;
  onClick?: () => void;
}

function ToolButton({
  icon: Icon,
  label,
  shortcut,
  active,
  disabled,
  danger,
  caret,
  showLabel,
  onClick,
}: ToolButtonProps) {
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        aria-pressed={active}
        className={cn(
          'flex h-9 items-center gap-1.5 rounded-md text-[13px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-35',
          showLabel ? 'px-2.5' : caret ? 'pl-2 pr-1.5' : 'w-9 justify-center',
          active
            ? 'bg-slate-900 text-white shadow-sm'
            : danger
              ? 'text-rose-600 hover:bg-rose-50'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
        )}
      >
        <Icon className="h-[18px] w-[18px]" strokeWidth={1.9} />
        {showLabel && <span>{label}</span>}
        {caret && <ChevronDown className={cn('h-3.5 w-3.5', active ? 'text-white/70' : 'text-slate-400')} />}
      </button>
      <div className="pointer-events-none absolute left-1/2 top-full z-[1600] mt-2 hidden -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-[11px] font-medium text-white shadow-lg group-hover:flex">
        {label}
        {shortcut && <Shortcut dark>{shortcut}</Shortcut>}
      </div>
    </div>
  );
}

function Divider() {
  return <div className="mx-1 h-5 w-px bg-slate-200" />;
}

/* ------------------------------------------------------------------ */
/* Equipment picker                                                    */
/* ------------------------------------------------------------------ */

function EquipmentPicker({ onPick, onClose }: { onPick: (c: CatalogComponent) => void; onClose: () => void }) {
  const customComponents = useNetworkStore((s) => s.catalog);
  const { selectedEquipmentTypeToAdd, activeTool } = useMapStore(
    useShallow((s) => ({ selectedEquipmentTypeToAdd: s.equipmentTypeToAdd, activeTool: s.activeTool })),
  );
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('All');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const all = useMemo(
    () => [...BUILT_IN_COMPONENTS, ...customComponents.map((c) => ({ ...c, category: c.category || 'Custom' }))],
    [customComponents],
  );

  const categories = useMemo(() => {
    const present = new Set(all.map((c) => c.category));
    const ordered = CATEGORY_ORDER.filter((c) => present.has(c));
    present.forEach((c) => {
      if (!ordered.includes(c)) ordered.push(c);
    });
    return ordered;
  }, [all]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter(
      (c) =>
        (category === 'All' || c.category === category) &&
        (!q ||
          c.name.toLowerCase().includes(q) ||
          c.type.toLowerCase().includes(q) ||
          c.description.toLowerCase().includes(q)),
    );
  }, [all, category, query]);

  const grouped = useMemo(() => {
    const map = new Map<string, CatalogComponent[]>();
    filtered.forEach((c) => {
      const list = map.get(c.category) ?? [];
      list.push(c);
      map.set(c.category, list);
    });
    return categories.filter((c) => map.has(c)).map((c) => ({ category: c, items: map.get(c)! }));
  }, [filtered, categories]);

  return (
    <div className="animate-pop-in absolute left-1/2 top-full z-[1500] mt-2 flex h-[440px] w-[640px] max-w-[calc(100vw-2rem)] -translate-x-1/2 overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-700 shadow-[var(--shadow-overlay)]">
      <nav className="flex w-48 shrink-0 flex-col gap-0.5 border-r border-slate-100 bg-slate-50/70 p-2">
        <div className="px-2 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          Categories
        </div>
        {['All', ...categories].map((c) => {
          const count = c === 'All' ? all.length : all.filter((x) => x.category === c).length;
          return (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={cn(
                'flex items-center justify-between rounded-md px-2 py-1.5 text-left text-[13px] transition-colors',
                category === c
                  ? 'bg-white font-medium text-slate-900 shadow-sm ring-1 ring-slate-200'
                  : 'text-slate-600 hover:bg-white/70',
              )}
            >
              <span className="truncate">{c === 'All' ? 'All equipment' : c}</span>
              <span className="ml-2 text-[11px] tabular-nums text-slate-400">{count}</span>
            </button>
          );
        })}
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2.5">
          <Search className="h-4 w-4 text-slate-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search OLT, splitter, FAT, pole…"
            className="h-7 flex-1 bg-transparent text-[13px] text-slate-800 outline-none placeholder:text-slate-400"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && filtered[0]) onPick(filtered[0]);
            }}
          />
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-2">
          {grouped.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
              <Search className="h-5 w-5 text-slate-300" />
              <div className="text-[13px] font-medium text-slate-600">No equipment matches “{query}”</div>
              <div className="text-xs text-slate-400">Try a different name or category.</div>
            </div>
          )}
          {grouped.map((g) => (
            <section key={g.category} className="mb-2">
              {category === 'All' && (
                <div className="sticky top-0 z-10 bg-white/95 px-2 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400 backdrop-blur">
                  {g.category}
                </div>
              )}
              {g.items.map((c) => {
                const Icon = equipmentIcon(c.type);
                const selected = activeTool === 'add_equipment' && selectedEquipmentTypeToAdd === c.type;
                return (
                  <button
                    key={c.id}
                    type="button"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('application/fiber-equipment-type', c.type);
                      e.dataTransfer.effectAllowed = 'copy';
                    }}
                    onClick={() => onPick(c)}
                    className={cn(
                      'group/item flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors',
                      selected ? 'bg-blue-50 ring-1 ring-blue-200' : 'hover:bg-slate-50',
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1',
                        CATEGORY_TINT[c.category] ?? CATEGORY_TINT.Custom,
                      )}
                    >
                      <Icon className="h-[18px] w-[18px]" strokeWidth={1.8} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-[13px] font-medium text-slate-900">{c.name}</span>
                        {c.defaultPorts ? (
                          <span className="shrink-0 rounded bg-slate-100 px-1.5 py-px text-[10px] font-medium tabular-nums text-slate-500">
                            {c.defaultPorts} ports
                          </span>
                        ) : null}
                        {c.isCustom && (
                          <span className="shrink-0 rounded bg-slate-900 px-1.5 py-px text-[10px] font-medium text-white">
                            Custom
                          </span>
                        )}
                      </span>
                      <span className="block truncate text-xs text-slate-500">{c.description}</span>
                    </span>
                    {selected ? (
                      <Check className="h-4 w-4 shrink-0 text-blue-600" />
                    ) : (
                      <GripVertical className="h-4 w-4 shrink-0 text-slate-300 opacity-0 group-hover/item:opacity-100" />
                    )}
                  </button>
                );
              })}
            </section>
          ))}
        </div>

        <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/60 px-3 py-2 text-[11px] text-slate-500">
          <span>Click to place on the map, or drag an item onto it.</span>
          <span className="flex items-center gap-1">
            <Shortcut>Esc</Shortcut> close
          </span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Cable picker                                                        */
/* ------------------------------------------------------------------ */

function CableSwatch({ type }: { type: string }) {
  const style = cableStyle(type);
  return (
    <svg width="28" height="10" viewBox="0 0 28 10" className="shrink-0">
      <line
        x1="2"
        y1="5"
        x2="26"
        y2="5"
        stroke={style.stroke}
        strokeWidth={Math.min(style.strokeWidth, 4)}
        strokeDasharray={style.dashArray}
        strokeLinecap="round"
      />
    </svg>
  );
}

function CablePicker({ onPick }: { onPick: (t: CableType) => void }) {
  const { selectedCableTypeToDraw, activeTool } = useMapStore(
    useShallow((s) => ({ selectedCableTypeToDraw: s.cableTypeToDraw, activeTool: s.activeTool })),
  );
  return (
    <div className="animate-pop-in absolute left-0 top-full z-[1500] mt-2 w-72 rounded-xl border border-slate-200 bg-white p-1.5 text-slate-700 shadow-[var(--shadow-overlay)]">
      <div className="px-2 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        Draw cable route
      </div>
      {CABLE_TYPES.map(({ type, hint }) => {
        const selected = activeTool === 'draw_cable' && selectedCableTypeToDraw === type;
        return (
          <button
            key={type}
            type="button"
            onClick={() => onPick(type)}
            className={cn(
              'flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors',
              selected ? 'bg-blue-50' : 'hover:bg-slate-50',
            )}
          >
            <CableSwatch type={type} />
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium text-slate-900">{type}</span>
              <span className="block text-[11px] text-slate-500">{hint}</span>
            </span>
            {selected && <Check className="h-4 w-4 text-blue-600" />}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Toolbar                                                             */
/* ------------------------------------------------------------------ */

export interface MapToolbarProps {
  isBikerMode: boolean;
  onToggleBikerMode: () => void;
}

export function MapToolbar({ isBikerMode, onToggleBikerMode }: MapToolbarProps) {
  const {
    activeTool,
    setActiveTool,
    setSelectedEquipmentTypeToAdd,
    setSelectedCableTypeToDraw,
    setActiveDrawingPoints,
    setMeasuringPoints,
  } = useMapStore(
    useShallow((s) => ({
      activeTool: s.activeTool,
      setActiveTool: s.setActiveTool,
      setSelectedEquipmentTypeToAdd: s.setEquipmentTypeToAdd,
      setSelectedCableTypeToDraw: s.setCableTypeToDraw,
      setActiveDrawingPoints: s.setDrawingPoints,
      setMeasuringPoints: s.setMeasuringPoints,
    })),
  );
  const { setModalOpen, selectedObject, setSelectedObject } = useUiStore(
    useShallow((s) => ({
      setModalOpen: s.setModalOpen,
      selectedObject: s.selectedObject,
      setSelectedObject: s.select,
    })),
  );
  const { undo, redo, canUndo, canRedo } = useNetworkStore(
    useShallow((s) => ({ undo: s.undo, redo: s.redo, canUndo: selectCanUndo(s), canRedo: selectCanRedo(s) })),
  );
  const showToast = useToastStore((s) => s.show);

  const [menu, setMenu] = useState<null | 'equipment' | 'cable'>(null);
  const closeMenu = () => setMenu(null);
  const rootRef = useOutsideClose(menu !== null, (v) => !v && closeMenu());

  const resetDrawing = () => {
    setActiveDrawingPoints([]);
    setMeasuringPoints([]);
  };

  const selectTool = () => {
    resetDrawing();
    setActiveTool('select');
    closeMenu();
  };

  const pickEquipment = (c: CatalogComponent) => {
    resetDrawing();
    setSelectedEquipmentTypeToAdd(c.type as EquipmentType);
    setActiveTool('add_equipment');
    closeMenu();
  };

  const pickCable = (t: CableType) => {
    resetDrawing();
    setSelectedCableTypeToDraw(t);
    setActiveTool('draw_cable');
    closeMenu();
  };

  const startMeasure = () => {
    resetDrawing();
    setActiveTool('measure');
    closeMenu();
  };

  const canDelete = selectedObject?.type === 'cable' || selectedObject?.type === 'equipment';
  const deleteSelected = () => {
    if (!selectedObject) return;
    const name = selectionLabel(selectedObject);
    if (selectedObject.type === 'cable') deleteCable(selectedObject.data.id);
    else if (selectedObject.type === 'equipment') deleteEquipment(selectedObject.data.id);
    else return;
    setSelectedObject(null);
    showToast('info', 'Deleted', `${name} was removed. Press Ctrl+Z to undo.`);
  };

  const handlers = useRef({ selectTool, startMeasure, deleteSelected, canDelete, setMenu });
  handlers.current = { selectTool, startMeasure, deleteSelected, canDelete, setMenu };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      const h = handlers.current;
      const k = e.key.toLowerCase();
      if (k === 'v') h.selectTool();
      else if (k === 'e') h.setMenu((m) => (m === 'equipment' ? null : 'equipment'));
      else if (k === 'c') h.setMenu((m) => (m === 'cable' ? null : 'cable'));
      else if (k === 'm') h.startMeasure();
      else if (e.key === 'Delete' && h.canDelete) h.deleteSelected();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div ref={rootRef} className="absolute left-1/2 top-3 z-[450] -translate-x-1/2">
      <div className="flex items-center gap-0.5 rounded-lg border border-slate-200/90 bg-white/95 p-1 shadow-[0_1px_2px_rgb(15_23_42/0.06),0_8px_24px_-6px_rgb(15_23_42/0.18)] backdrop-blur">
        <ToolButton
          icon={MousePointer2}
          label="Select"
          shortcut="V"
          active={activeTool === 'select'}
          onClick={selectTool}
        />

        <Divider />

        <div className="relative">
          <ToolButton
            icon={LayoutGrid}
            label="Equipment"
            shortcut="E"
            showLabel
            caret
            active={activeTool === 'add_equipment' || menu === 'equipment'}
            onClick={() => setMenu((m) => (m === 'equipment' ? null : 'equipment'))}
          />
        </div>
        <div className="relative">
          <ToolButton
            icon={Spline}
            label="Cable"
            shortcut="C"
            showLabel
            caret
            active={activeTool === 'draw_cable' || menu === 'cable'}
            onClick={() => setMenu((m) => (m === 'cable' ? null : 'cable'))}
          />
          {menu === 'cable' && <CablePicker onPick={pickCable} />}
        </div>
        <ToolButton
          icon={UserPlus}
          label="Add customer"
          showLabel
          onClick={() => {
            closeMenu();
            setModalOpen('customerWizard', true);
          }}
        />

        <Divider />

        <ToolButton
          icon={Ruler}
          label="Measure distance"
          shortcut="M"
          active={activeTool === 'measure'}
          onClick={startMeasure}
        />
        <ToolButton
          icon={Bike}
          label={isBikerMode ? 'Exit field navigation' : 'Field navigation'}
          active={isBikerMode}
          onClick={onToggleBikerMode}
        />

        <Divider />

        <ToolButton icon={Undo2} label="Undo" shortcut="Ctrl Z" disabled={!canUndo} onClick={undo} />
        <ToolButton icon={Redo2} label="Redo" shortcut="Ctrl Y" disabled={!canRedo} onClick={redo} />
        <ToolButton
          icon={Trash2}
          label="Delete selected"
          shortcut="Del"
          danger
          disabled={!canDelete}
          onClick={deleteSelected}
        />
      </div>

      {menu === 'equipment' && <EquipmentPicker onPick={pickEquipment} onClose={closeMenu} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Contextual mode bar (draw / measure / place)                        */
/* ------------------------------------------------------------------ */

export interface MapModeBarProps {
  distanceMeters: number;
  snapTargetName?: string | null;
  autoPole: boolean;
  onAutoPoleChange: (v: boolean) => void;
  onAddPole: () => void;
  onFinish: () => void;
  onCancel: () => void;
}

export function MapModeBar({
  distanceMeters,
  snapTargetName,
  autoPole,
  onAutoPoleChange,
  onAddPole,
  onFinish,
  onCancel,
}: MapModeBarProps) {
  const {
    activeTool,
    selectedCableTypeToDraw,
    selectedEquipmentTypeToAdd,
    activeDrawingPoints,
    setActiveDrawingPoints,
    measuringPoints,
    setMeasuringPoints,
  } = useMapStore(
    useShallow((s) => ({
      activeTool: s.activeTool,
      selectedCableTypeToDraw: s.cableTypeToDraw,
      selectedEquipmentTypeToAdd: s.equipmentTypeToAdd,
      activeDrawingPoints: s.drawingPoints,
      setActiveDrawingPoints: s.setDrawingPoints,
      measuringPoints: s.measuringPoints,
      setMeasuringPoints: s.setMeasuringPoints,
    })),
  );

  const active = activeTool === 'draw_cable' || activeTool === 'measure' || activeTool === 'add_equipment';
  const keys = useRef({ onCancel, onFinish, activeTool, points: activeDrawingPoints.length });
  keys.current = { onCancel, onFinish, activeTool, points: activeDrawingPoints.length };

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const k = keys.current;
      if (e.key === 'Escape') {
        e.preventDefault();
        k.onCancel();
      } else if (e.key === 'Enter' && k.activeTool === 'draw_cable' && k.points >= 2) {
        e.preventDefault();
        k.onFinish();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  if (!active) return null;

  const EqIcon = equipmentIcon(selectedEquipmentTypeToAdd);
  const points = activeTool === 'measure' ? measuringPoints.length : activeDrawingPoints.length;

  const undoPoint = () => {
    if (activeTool === 'measure') setMeasuringPoints(measuringPoints.slice(0, -1));
    else setActiveDrawingPoints(activeDrawingPoints.slice(0, -1));
  };

  const darkBtn =
    'flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-40';

  return (
    <div className="animate-pop-in absolute left-1/2 top-[64px] z-[440] -translate-x-1/2">
      <div className="flex items-center gap-3 rounded-lg bg-slate-900/95 py-1.5 pl-3 pr-1.5 text-white shadow-xl ring-1 ring-black/10 backdrop-blur">
        <div className="flex items-center gap-2.5">
          {activeTool === 'draw_cable' && <CableSwatch type={selectedCableTypeToDraw} />}
          {activeTool === 'measure' && <Ruler className="h-4 w-4 text-amber-300" />}
          {activeTool === 'add_equipment' && <EqIcon className="h-4 w-4 text-sky-300" />}
          <div className="leading-tight">
            <div className="text-[13px] font-semibold">
              {activeTool === 'draw_cable' && selectedCableTypeToDraw}
              {activeTool === 'measure' && 'Measure distance'}
              {activeTool === 'add_equipment' && `Place ${selectedEquipmentTypeToAdd}`}
            </div>
            <div className="text-[11px] text-slate-400">
              {activeTool === 'add_equipment'
                ? 'Click anywhere on the map to drop it'
                : points === 0
                  ? 'Click on the map to start'
                  : `${points} point${points === 1 ? '' : 's'} · ${formatDistance(distanceMeters)}`}
            </div>
          </div>
        </div>

        {snapTargetName && (
          <span className="flex items-center gap-1 rounded-md bg-emerald-400/15 px-2 py-1 text-[11px] font-medium text-emerald-300">
            <Crosshair className="h-3 w-3" /> {snapTargetName}
          </span>
        )}

        <div className="flex items-center gap-1 border-l border-white/10 pl-2">
          {activeTool === 'draw_cable' && (
            <>
              <button
                type="button"
                onClick={onAddPole}
                className={cn(darkBtn, 'text-slate-200 hover:bg-white/10')}
                title="Drop a pole at the last point"
              >
                <UtilityPole className="h-4 w-4" /> Pole <Shortcut dark>P</Shortcut>
              </button>
              <label className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-[12px] text-slate-300 hover:bg-white/5">
                <Switch checked={autoPole} onChange={onAutoPoleChange} size="sm" />
                Auto-pole
              </label>
            </>
          )}
          {activeTool !== 'add_equipment' && (
            <button
              type="button"
              onClick={undoPoint}
              disabled={points === 0}
              className={cn(darkBtn, 'text-slate-200 hover:bg-white/10')}
              title="Remove last point"
            >
              <CornerUpLeft className="h-4 w-4" /> Undo point
            </button>
          )}
          {activeTool === 'draw_cable' && (
            <button
              type="button"
              onClick={onFinish}
              disabled={activeDrawingPoints.length < 2}
              className={cn(darkBtn, 'bg-blue-600 text-white hover:bg-blue-500')}
            >
              <Check className="h-4 w-4" /> Finish <Shortcut dark>↵</Shortcut>
            </button>
          )}
          <button type="button" onClick={onCancel} className={cn(darkBtn, 'text-slate-300 hover:bg-white/10')}>
            {activeTool === 'measure' ? 'Done' : 'Cancel'} <Shortcut dark>Esc</Shortcut>
          </button>
        </div>
      </div>
    </div>
  );
}
