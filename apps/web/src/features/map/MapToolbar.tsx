import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bike,
  Camera,
  Check,
  ChevronDown,
  CornerUpLeft,
  Crosshair,
  GripVertical,
  Keyboard,
  LayoutGrid,
  type LucideIcon,
  MousePointer2,
  Plus,
  Radio,
  Redo2,
  Ruler,
  Search,
  Spline,
  Trash2,
  Undo2,
  UserPlus,
  UtilityPole,
  Volume2,
  X,
} from 'lucide-react';
import { Link } from 'react-router';
import { useShallow } from 'zustand/react/shallow';

import type { CableType, CatalogComponent, EquipmentType } from '@fibergis/shared';

import { EquipmentIllustration } from '../../components/icons/EquipmentIllustration';
import { cn, Switch } from '../../components/ui';
import { useT } from '../../i18n/useT';
import { EQUIPMENT_DRAG_TYPE, isTypingTarget } from '../../lib/browser';
import { useMapStore } from '../../stores/mapStore';
import { deleteCable, deleteEquipment } from '../../stores/networkActions';
import { selectCanRedo, selectCanUndo, useNetworkStore } from '../../stores/networkStore';
import { useUiStore } from '../../stores/uiStore';
import { cableStyle } from '../../theme/network';
import { BUILT_IN_COMPONENTS } from '../catalog/componentCatalog';
import { useLearnStore } from '../learn/learnStore';
import { SelectToolsButton } from '../selection/SelectionMenus';
import { AddCustomEquipmentModal } from './EquipmentToolbox';
import { formatArea, formatDistance } from './markerIcons';
import { placementTemplate } from './placement';
import { usePlacementDialog } from './placementDialogStore';

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
        'hidden h-[18px] md:inline-flex min-w-[18px] items-center justify-center rounded px-1 font-sans text-[10px] font-semibold',
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
          'flex h-[48px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md text-[13px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-35 md:h-9',
          showLabel ? 'px-2.5' : caret ? 'pl-2 pr-1.5' : 'w-[48px] justify-center md:w-9',
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
      <div className="pointer-events-none absolute left-1/2 top-full z-[1600] mt-2 hidden -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-[11px] font-medium text-white shadow-lg md:group-hover:flex">
        {label}
        {shortcut && <Shortcut dark>{shortcut}</Shortcut>}
      </div>
    </div>
  );
}

function Divider() {
  return <div className="mx-1 h-5 w-px shrink-0 bg-slate-200" />;
}

/* ------------------------------------------------------------------ */
/* Equipment picker                                                    */
/* ------------------------------------------------------------------ */

function EquipmentPicker({
  onPick,
  onClose,
  onAddCustom,
}: {
  onPick: (c: CatalogComponent) => void;
  onClose: () => void;
  onAddCustom: () => void;
}) {
  const customComponents = useNetworkStore((s) => s.catalog);
  const { selectedEquipmentTypeToAdd, activeTool } = useMapStore(
    useShallow((s) => ({ selectedEquipmentTypeToAdd: s.equipmentTypeToAdd, activeTool: s.activeTool })),
  );
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('All');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // On a phone the keyboard would cover the list, so only focus the search on a desk.
    if (window.innerWidth >= 768) inputRef.current?.focus();
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
    <div className="animate-pop-in fixed inset-x-0 bottom-0 top-12 z-[1500] flex flex-col overflow-hidden bg-white text-slate-700 md:absolute md:inset-auto md:left-1/2 md:top-full md:mt-2 md:h-[440px] md:w-[640px] md:max-w-[calc(100vw-2rem)] md:-translate-x-1/2 md:flex-row md:rounded-xl md:border md:border-slate-200 md:shadow-[var(--shadow-overlay)]">
      <nav className="flex shrink-0 flex-row gap-0.5 overflow-x-auto border-b border-slate-100 bg-slate-50/70 p-2 md:w-48 md:flex-col md:overflow-visible md:border-b-0 md:border-r">
        <div className="hidden px-2 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 md:block">
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
                'flex min-h-[48px] shrink-0 items-center justify-between whitespace-nowrap rounded-md px-2 py-1.5 text-left text-[13px] transition-colors md:min-h-0',
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
            className="flex h-[48px] w-[48px] items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700 md:h-auto md:w-auto md:p-1"
            aria-label="Close"
          >
            <X className="h-5 w-5 md:h-4 md:w-4" />
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
                const selected = activeTool === 'add_equipment' && selectedEquipmentTypeToAdd === c.type;
                return (
                  <button
                    key={c.id}
                    type="button"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(EQUIPMENT_DRAG_TYPE, c.type);
                      e.dataTransfer.setData('text/plain', JSON.stringify({ type: c.type, ...placementTemplate(c) }));
                      e.dataTransfer.effectAllowed = 'copy';
                    }}
                    onClick={() => onPick(c)}
                    className={cn(
                      'group/item flex min-h-[52px] w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors md:min-h-0',
                      selected ? 'bg-blue-50 ring-1 ring-blue-200' : 'hover:bg-slate-50',
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1',
                        CATEGORY_TINT[c.category] ?? CATEGORY_TINT.Custom,
                      )}
                    >
                      <EquipmentIllustration type={c.type} size={30} />
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

        <div className="border-t border-slate-100 p-2">
          <button
            type="button"
            onClick={onAddCustom}
            data-testid="equipment-add-custom"
            className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 text-[13px] font-semibold text-white hover:bg-blue-500 md:min-h-10"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Add Custom Equipment
          </button>
        </div>

        <div className="hidden items-center justify-between border-t border-slate-100 bg-slate-50/60 px-3 py-2 text-[11px] text-slate-500 md:flex">
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

function CablePicker({ onPick, className }: { onPick: (t: CableType) => void; className?: string }) {
  const { selectedCableTypeToDraw, activeTool } = useMapStore(
    useShallow((s) => ({ selectedCableTypeToDraw: s.cableTypeToDraw, activeTool: s.activeTool })),
  );
  return (
    <div
      className={cn(
        'animate-pop-in z-[1500] rounded-xl border border-slate-200/70 bg-white/95 p-1.5 text-slate-700 shadow-[var(--shadow-overlay)] backdrop-blur-md',
        className,
      )}
    >
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
              'flex min-h-[48px] w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors md:min-h-0',
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
    setEquipmentDraftTemplate,
    setSelectedCableTypeToDraw,
    setActiveDrawingPoints,
    setMeasuringPoints,
  } = useMapStore(
    useShallow((s) => ({
      activeTool: s.activeTool,
      setActiveTool: s.setActiveTool,
      setSelectedEquipmentTypeToAdd: s.setEquipmentTypeToAdd,
      setEquipmentDraftTemplate: s.setEquipmentDraftTemplate,
      setSelectedCableTypeToDraw: s.setCableTypeToDraw,
      setActiveDrawingPoints: s.setDrawingPoints,
      setMeasuringPoints: s.setMeasuringPoints,
    })),
  );
  const { setModalOpen, selectedObject } = useUiStore(
    useShallow((s) => ({ setModalOpen: s.setModalOpen, selectedObject: s.selectedObject })),
  );
  const { undo, redo, canUndo, canRedo } = useNetworkStore(
    useShallow((s) => ({ undo: s.undo, redo: s.redo, canUndo: selectCanUndo(s), canRedo: selectCanRedo(s) })),
  );

  const [menu, setMenu] = useState<null | 'equipment' | 'cable'>(null);
  const [addingCustom, setAddingCustom] = useState(false);
  const closeMenu = () => setMenu(null);
  const { t } = useT();
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
    setEquipmentDraftTemplate(placementTemplate(c));
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
  // Once confirmed, the store clears the selection and the domain notice explains how to undo.
  const deleteSelected = () => {
    if (selectedObject?.type === 'cable') void deleteCable(selectedObject.data.id);
    else if (selectedObject?.type === 'equipment') void deleteEquipment(selectedObject.data.id);
  };

  const handlers = useRef({ selectTool, startMeasure, deleteSelected, canDelete, setMenu });
  handlers.current = { selectTool, startMeasure, deleteSelected, canDelete, setMenu };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
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
    <div
      ref={rootRef}
      className="absolute inset-x-0 bottom-0 z-[450] md:inset-x-auto md:bottom-auto md:left-1/2 md:top-3 md:-translate-x-1/2"
    >
      <div className="no-scrollbar flex items-center gap-0.5 overflow-x-auto border-t border-slate-200 bg-white p-1 shadow-[0_-4px_16px_-6px_rgb(15_23_42/0.25)] md:overflow-visible md:rounded-xl md:border md:border-white/60 md:bg-white/90 md:shadow-[var(--shadow-overlay)] md:ring-1 md:ring-slate-900/5 md:backdrop-blur-md md:backdrop-saturate-150">
        {/* Phone only: the simple field flow for poles, boxes, drops, light levels and danger. */}
        <Link
          to="/capture"
          data-testid="open-capture"
          className="flex h-[48px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md bg-emerald-800 px-3 text-[14px] font-semibold text-white md:hidden"
        >
          <Camera className="h-5 w-5" strokeWidth={2} aria-hidden />
          Field capture
        </Link>
        {/* The on-screen guide with voice: where things are, and how to map from the OLT to a house. */}
        <button
          type="button"
          data-guide="guide-button"
          data-testid="open-guide"
          onClick={() => {
            closeMenu();
            useLearnStore.getState().openTour('choose');
          }}
          className="flex h-[48px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md bg-blue-50 px-3 text-[14px] font-bold text-blue-800 ring-1 ring-blue-200 transition-colors hover:bg-blue-100 md:h-9 md:text-[13px]"
        >
          <Volume2 className="h-5 w-5 md:h-[18px] md:w-[18px]" strokeWidth={2.2} aria-hidden />
          {t('learn.guide')}
        </button>
        <ToolButton
          icon={MousePointer2}
          label="Select"
          shortcut="V"
          active={activeTool === 'select'}
          onClick={selectTool}
        />
        {/* Phase 16: choose several (tap, box, lasso, area, zone, by a value, saved). */}
        {activeTool === 'select' && <SelectToolsButton />}

        <Divider />

        <div className="relative shrink-0">
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
        <div className="relative shrink-0">
          <ToolButton
            icon={Spline}
            label="Cable"
            shortcut="C"
            showLabel
            caret
            active={activeTool === 'draw_cable' || menu === 'cable'}
            onClick={() => setMenu((m) => (m === 'cable' ? null : 'cable'))}
          />
          {menu === 'cable' && (
            <CablePicker onPick={pickCable} className="absolute left-0 top-full mt-2 hidden w-72 md:block" />
          )}
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
        <ToolButton
          icon={Radio}
          label="ONU Fleet"
          showLabel
          onClick={() => {
            closeMenu();
            setModalOpen('onuFleet', true);
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

      {menu === 'cable' && (
        <CablePicker onPick={pickCable} className="absolute inset-x-2 bottom-full mb-2 max-h-[60vh] overflow-y-auto md:hidden" />
      )}
      {menu === 'equipment' && (
        <EquipmentPicker
          onPick={pickEquipment}
          onClose={closeMenu}
          onAddCustom={() => {
            closeMenu();
            setAddingCustom(true);
          }}
        />
      )}
      {addingCustom && <AddCustomEquipmentModal onClose={() => setAddingCustom(false)} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Contextual mode bar (draw / measure / place)                        */
/* ------------------------------------------------------------------ */

export interface MapModeBarProps {
  distanceMeters: number;
  /** Area of the closed shape (measuring with 3 or more points, or a zone boundary). */
  areaSqMeters?: number;
  snapTargetName?: string | null;
  autoPole: boolean;
  onAutoPoleChange: (v: boolean) => void;
  onAddPole: () => void;
  onFinish: () => void;
  onCancel: () => void;
}

export function MapModeBar({
  distanceMeters,
  areaSqMeters = 0,
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
    drawTarget,
  } = useMapStore(
    useShallow((s) => ({
      drawTarget: s.drawTarget,
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
  // A zone boundary needs three points to enclose anything; a line needs two.
  const minPoints = drawTarget === 'zone' ? 3 : 2;
  const keys = useRef({ onCancel, onFinish, activeTool, points: activeDrawingPoints.length, minPoints });
  keys.current = { onCancel, onFinish, activeTool, points: activeDrawingPoints.length, minPoints };

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const k = keys.current;
      if (e.key === 'Escape') {
        e.preventDefault();
        k.onCancel();
      } else if (e.key === 'Enter' && k.activeTool === 'draw_cable' && k.points >= k.minPoints) {
        e.preventDefault();
        k.onFinish();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  if (!active) return null;

  const points = activeTool === 'measure' ? measuringPoints.length : activeDrawingPoints.length;

  const undoPoint = () => {
    if (activeTool === 'measure') setMeasuringPoints(measuringPoints.slice(0, -1));
    else setActiveDrawingPoints(activeDrawingPoints.slice(0, -1));
  };

  const darkBtn =
    'flex h-[48px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 text-[13px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-40 md:h-8 md:px-2.5 md:text-[12px]';
  const isPolePlacement = activeTool === 'add_equipment' && !!selectedEquipmentTypeToAdd?.includes('Pole');

  return (
    <div className="animate-pop-in absolute inset-x-2 top-2 z-[440] md:inset-x-auto md:left-1/2 md:top-[64px] md:-translate-x-1/2">
      <div className="flex flex-col gap-2 rounded-xl bg-slate-900/90 py-1.5 pl-3 pr-1.5 text-white shadow-xl ring-1 ring-white/10 backdrop-blur-md md:flex-row md:items-center md:gap-3">
        <div className="flex items-center gap-2.5">
          {activeTool === 'draw_cable' && <CableSwatch type={selectedCableTypeToDraw} />}
          {activeTool === 'measure' && <Ruler className="h-4 w-4 text-amber-300" />}
          {activeTool === 'add_equipment' && (
            <EquipmentIllustration type={selectedEquipmentTypeToAdd} size={20} className="rounded bg-white p-px" />
          )}
          <div className="leading-tight">
            <div className="text-[13px] font-semibold">
              {activeTool === 'draw_cable' &&
                (drawTarget === 'duct'
                  ? 'Duct (underground)'
                  : drawTarget === 'zone'
                    ? 'Zone boundary'
                    : drawTarget === 'placement_line'
                      ? `Line for placing ${selectedEquipmentTypeToAdd ?? 'items'}`
                      : selectedCableTypeToDraw)}
              {activeTool === 'measure' && 'Measure distance'}
              {activeTool === 'add_equipment' && `Place ${selectedEquipmentTypeToAdd}`}
            </div>
            <div className="text-[11px] text-slate-400">
              {isPolePlacement
                ? 'Tap each place for a pole. Each gets the next number.'
                : activeTool === 'add_equipment'
                ? 'Tap the place on the map'
                : points === 0
                  ? drawTarget === 'zone' && activeTool === 'draw_cable'
                    ? 'Tap the map around the zone. The last point joins the first.'
                    : drawTarget === 'placement_line' && activeTool === 'draw_cable'
                      ? 'Tap along where the items go, then Finish. The line is not saved.'
                      : 'Tap the map to start. Tap a pin to join it.'
                  : drawTarget === 'zone' && activeTool === 'draw_cable'
                    ? `${points} point${points === 1 ? '' : 's'}${points >= 3 ? ` · area ${formatArea(areaSqMeters)}` : ' · tap at least 3'}`
                    : `${points} point${points === 1 ? '' : 's'} · ${formatDistance(distanceMeters)}${activeTool === 'measure' && points >= 3 ? ` · area ${formatArea(areaSqMeters)} (closed shape)` : ''}`}
            </div>
          </div>
        </div>

        {snapTargetName && (
          <span className="flex items-center gap-1 rounded-md bg-emerald-400/15 px-2 py-1 text-[11px] font-medium text-emerald-300">
            <Crosshair className="h-3 w-3" /> {snapTargetName}
          </span>
        )}

        <div className="no-scrollbar flex items-center gap-1 overflow-x-auto md:overflow-visible md:border-l md:border-white/10 md:pl-2">
          {activeTool === 'draw_cable' && drawTarget === 'cable' && (
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
          {activeTool === 'add_equipment' && (
            <>
              {/* Phase 3: other ways to place the chosen item. Each still asks "same one?". */}
              <button
                type="button"
                onClick={() => usePlacementDialog.getState().open({ kind: 'typed' })}
                className={cn(darkBtn, 'text-slate-200 hover:bg-white/10')}
                data-testid="place-by-typing"
              >
                <Keyboard className="h-4 w-4" /> Type position
              </button>
              <button
                type="button"
                onClick={() => usePlacementDialog.getState().open({ kind: 'structure' })}
                className={cn(darkBtn, 'text-slate-200 hover:bg-white/10')}
                data-testid="place-at-structure"
              >
                <UtilityPole className="h-4 w-4" /> At a pole
              </button>
              <button
                type="button"
                onClick={() => useMapStore.getState().startPlacementLine()}
                className={cn(darkBtn, 'text-slate-200 hover:bg-white/10')}
                data-testid="place-along-line"
              >
                <Spline className="h-4 w-4" /> Along a line
              </button>
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
              onClick={() => setActiveDrawingPoints([])}
              disabled={activeDrawingPoints.length === 0}
              className={cn(darkBtn, 'text-rose-300 hover:bg-rose-500/20 hover:text-rose-200')}
              title="Clear all points of the current drawn line"
            >
              <Trash2 className="h-4 w-4" /> {drawTarget === 'duct' || drawTarget === 'placement_line' ? 'Clear line' : drawTarget === 'zone' ? 'Clear boundary' : 'Clear wire'}
            </button>
          )}
          {activeTool === 'draw_cable' && (
            <button
              type="button"
              onClick={onFinish}
              disabled={activeDrawingPoints.length < minPoints}
              className={cn(darkBtn, 'order-first bg-blue-600 text-white hover:bg-blue-500 md:order-none')}
            >
              <Check className="h-4 w-4" /> Finish <Shortcut dark>↵</Shortcut>
            </button>
          )}
          <button type="button" onClick={onCancel} className={cn(darkBtn, 'text-slate-300 hover:bg-white/10')}>
            {activeTool === 'measure' || isPolePlacement ? 'Done' : 'Cancel'} <Shortcut dark>Esc</Shortcut>
          </button>
        </div>
      </div>
    </div>
  );
}
