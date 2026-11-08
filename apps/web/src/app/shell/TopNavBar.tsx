import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  Check,
  ChevronDown,
  CircleHelp,
  CornerDownLeft,
  Download,
  Globe,
  Layers,
  type LucideIcon,
  Menu,
  Redo2,
  RotateCcw,
  Search,
  TriangleAlert,
  Undo2,
  Upload,
  UserRound,
  Waypoints,
  X,
} from 'lucide-react';
import { Link } from 'react-router';
import { useShallow } from 'zustand/react/shallow';

import { isFaultOpen, type UserRole } from '@fibergis/shared';

import { EquipmentIllustration } from '../../components/icons/EquipmentIllustration';
import {
  cableColor,
  CableIcon,
  cn,
  equipmentIcon,
  IconButton,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  Popover,
} from '../../components/ui';
import { useMapStore } from '../../stores/mapStore';
import { backupSystem, exportKML, resetToSampleData, restoreSystem } from '../../stores/networkActions';
import { selectCanRedo, selectCanUndo, useNetworkStore } from '../../stores/networkStore';
import type { SelectedObject } from '../../stores/uiStore';
import { useUiStore } from '../../stores/uiStore';
import { useActiveView, useShowOnMap, VIEW_META } from '../views';
import { SyncStatus } from './SyncStatus';

type ResultKind = 'equipment' | 'cable' | 'customer' | 'fault';

interface SearchResult {
  kind: ResultKind;
  id: string;
  label: string;
  meta: string;
  icon: LucideIcon;
  color?: string;
  selection: SelectedObject;
}

const KIND_LABEL: Record<ResultKind, string> = {
  equipment: 'Equipment',
  cable: 'Cables',
  customer: 'Customers',
  fault: 'Faults',
};

const ROLES: UserRole[] = ['Administrator', 'Network Engineer', 'Network Operator', 'Field Technician', 'Supervisor'];

const NETWORK_MODES: Array<{ id: 'All' | 'Fiber' | 'CableTV'; label: string }> = [
  { id: 'All', label: 'All' },
  { id: 'Fiber', label: 'Fiber' },
  { id: 'CableTV', label: 'CATV' },
];

const matches = (value: string | undefined | null, q: string) => !!value && value.toLowerCase().includes(q);

const roleInitials = (role: string) =>
  role
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

export const TopNavBar: React.FC = () => {
  const { equipments, cables, customers, faults, undo, redo, canUndo, canRedo } = useNetworkStore(
    useShallow((s) => ({
      equipments: s.equipment,
      cables: s.cables,
      customers: s.customers,
      faults: s.faults,
      undo: s.undo,
      redo: s.redo,
      canUndo: selectCanUndo(s),
      canRedo: selectCanRedo(s),
    })),
  );
  const { userRole, setUserRole, networkMode, setNetworkMode, uiMode, setUiMode, setModalOpen, setMobileMenuOpen } = useUiStore(
    useShallow((s) => ({
      setMobileMenuOpen: s.setMobileMenuOpen,
      userRole: s.userRole,
      setUserRole: s.setUserRole,
      networkMode: s.networkMode,
      setNetworkMode: s.setNetworkMode,
      uiMode: s.uiMode,
      setUiMode: s.setUiMode,
      setModalOpen: s.setModalOpen,
    })),
  );
  const setIsLayersDrawerOpen = useMapStore((s) => s.setLayersDrawerOpen);

  const activeView = useActiveView();
  const showOnMap = useShowOnMap();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchBoxRef = useRef<HTMLDivElement>(null);
  const restoreInputRef = useRef<HTMLInputElement>(null);

  const results = useMemo<SearchResult[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const eq = equipments
      .filter((e) => matches(e.id, q) || matches(e.name, q) || matches(e.area, q))
      .slice(0, 5)
      .map<SearchResult>((e) => ({
        kind: 'equipment',
        id: e.id,
        label: e.name,
        meta: [e.type, e.area].filter(Boolean).join(' · '),
        icon: equipmentIcon(e.type),
        selection: { type: 'equipment', data: e },
      }));
    const cb = cables
      .filter((c) => matches(c.id, q) || matches(c.name, q))
      .slice(0, 4)
      .map<SearchResult>((c) => ({
        kind: 'cable',
        id: c.id,
        label: c.name,
        meta: `${c.type} · ${Math.round(c.lengthMeters || 0).toLocaleString()} m`,
        icon: CableIcon,
        color: cableColor(c.type),
        selection: { type: 'cable', data: c },
      }));
    const cu = customers
      .filter(
        (c) =>
          matches(c.id, q) ||
          matches(c.name, q) ||
          matches(c.ontSerialNumber, q) ||
          matches(c.ipAddress, q) ||
          matches(c.address, q),
      )
      .slice(0, 5)
      .map<SearchResult>((c) => ({
        kind: 'customer',
        id: c.id,
        label: c.name,
        meta: [c.ontSerialNumber && `ONT ${c.ontSerialNumber}`, c.plan].filter(Boolean).join(' · '),
        icon: UserRound,
        selection: { type: 'customer', data: c },
      }));
    const ft = faults
      .filter((f) => matches(f.id, q) || matches(f.title, q))
      .slice(0, 3)
      .map<SearchResult>((f) => ({
        kind: 'fault',
        id: f.id,
        label: f.title,
        meta: `${f.severity} · ${f.status}`,
        icon: TriangleAlert,
        selection: { type: 'fault', data: f },
      }));
    return [...eq, ...cb, ...cu, ...ft];
  }, [query, equipments, cables, customers, faults]);

  useEffect(() => setActiveIndex(0), [query]);

  const historyRef = useRef({ undo, redo, canUndo, canRedo });
  historyRef.current = { undo, redo, canUndo, canRedo };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        setOpen(true);
        return;
      }
      const target = e.target as HTMLElement | null;
      const editing =
        !!target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);
      if (editing) return;
      const h = historyRef.current;
      if (key === 'z' && !e.shiftKey && h.canUndo) {
        e.preventDefault();
        h.undo();
      } else if ((key === 'y' || (key === 'z' && e.shiftKey)) && h.canRedo) {
        e.preventDefault();
        h.redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const selectResult = (r: SearchResult) => {
    showOnMap(r.selection);
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  };

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      if (results.length) setActiveIndex((i) => (i + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (results.length) setActiveIndex((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      if (results[activeIndex]) selectResult(results[activeIndex]);
    } else if (e.key === 'Escape') {
      if (query) setQuery('');
      else inputRef.current?.blur();
      setOpen(false);
    }
  };

  const handleRestoreFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') void restoreSystem(reader.result);
    };
    reader.readAsText(file);
  };

  // resetToSampleData asks for confirmation itself.
  const handleReset = () => void resetToSampleData();

  const activeFaultsCount = faults.filter((f) => isFaultOpen(f) && !f.isTest).length;
  const view = VIEW_META[activeView];
  const showDropdown = open && query.trim().length > 0;

  let lastKind: ResultKind | null = null;

  return (
    <header className="relative z-[1100] flex h-12 shrink-0 items-center gap-2 border-b border-slate-950 bg-slate-900 pl-1 pr-1 text-slate-300 md:gap-3 md:pl-3 md:pr-2">
      <button
        type="button"
        aria-label="Open menu"
        onClick={() => setMobileMenuOpen(true)}
        className="flex h-[48px] w-[48px] shrink-0 items-center justify-center rounded-md text-slate-200 hover:bg-slate-800 md:hidden"
      >
        <Menu size={22} />
      </button>
      {/* Brand + breadcrumb */}
      <div className="flex min-w-0 items-center gap-3">
        <Link
          to={VIEW_META.map.path}
          className="flex shrink-0 items-center gap-2 rounded-md py-1 pr-1 text-white"
          aria-label="FiberGIS home"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-blue-600">
            <Waypoints size={16} strokeWidth={2.2} />
          </span>
          <span className="hidden text-[14px] font-semibold tracking-tight sm:inline">FiberGIS</span>
        </Link>
        <span className="hidden h-5 w-px bg-slate-700 md:block" />
        <div className="hidden min-w-0 items-center gap-2 md:flex">
          <view.icon size={15} strokeWidth={1.9} className="shrink-0 text-slate-400" />
          <span className="truncate text-[13px] font-medium text-slate-100">{view.label}</span>
          {uiMode === 'simple' && (
            <span className="rounded border border-slate-600 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-slate-400">
              Simple
            </span>
          )}
        </div>
      </div>

      {/* Global search */}
      <div ref={searchBoxRef} className="relative mx-auto w-full max-w-xl min-w-0 flex-1">
        <div
          className={cn(
            'flex h-10 items-center gap-2 rounded-md border px-2.5 transition-colors md:h-8',
            open
              ? 'border-blue-500 bg-white text-slate-900'
              : 'border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-600',
          )}
        >
          <Search size={15} strokeWidth={2} className={open ? 'text-slate-400' : 'text-slate-500'} />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={showDropdown}
            aria-controls="global-search-results"
            aria-label="Search network"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onSearchKeyDown}
            placeholder={
              uiMode === 'simple'
                ? 'Search boxes, cables, customers…'
                : 'Search equipment, cables, customers, ONT serial or IP…'
            }
            className={cn(
              'h-full min-w-0 flex-1 bg-transparent text-[13px] outline-none',
              open ? 'placeholder:text-slate-400' : 'placeholder:text-slate-500',
            )}
          />
          {query ? (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                inputRef.current?.focus();
              }}
              className="rounded p-0.5 text-slate-400 hover:text-slate-700"
              aria-label="Clear search"
            >
              <X size={14} />
            </button>
          ) : (
            <kbd
              className={cn(
                'hidden rounded border px-1.5 font-sans text-[10.5px] leading-[18px] sm:inline-block',
                open ? 'border-slate-200 text-slate-400' : 'border-slate-600 text-slate-400',
              )}
            >
              Ctrl K
            </kbd>
          )}
        </div>

        {showDropdown && (
          <div
            id="global-search-results"
            role="listbox"
            className="animate-pop-in absolute left-0 right-0 top-full mt-1.5 max-h-[70vh] overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 text-slate-700 shadow-[var(--shadow-overlay)]"
          >
            {results.length === 0 ? (
              <div className="px-4 py-6 text-center text-[13px] text-slate-500">
                No results for <span className="font-medium text-slate-800">"{query.trim()}"</span>
              </div>
            ) : (
              results.map((r, i) => {
                const header = r.kind !== lastKind ? KIND_LABEL[r.kind] : null;
                lastKind = r.kind;
                const Icon = r.icon;
                const active = i === activeIndex;
                return (
                  <React.Fragment key={`${r.kind}-${r.id}`}>
                    {header && <MenuLabel>{header}</MenuLabel>}
                    <button
                      type="button"
                      role="option"
                      aria-selected={active}
                      onMouseEnter={() => setActiveIndex(i)}
                      onClick={() => selectResult(r)}
                      className={cn('flex w-full items-center gap-3 px-3 py-1.5 text-left', active && 'bg-slate-100')}
                    >
                      <span
                        className={cn(
                          'flex h-7 w-7 shrink-0 items-center justify-center rounded-md border',
                          r.kind === 'fault'
                            ? 'border-red-200 bg-red-50 text-red-600'
                            : 'border-slate-200 bg-slate-50 text-slate-500',
                        )}
                        style={r.color ? { color: r.color } : undefined}
                      >
                        {r.selection?.type === 'equipment' ? (
                          <EquipmentIllustration type={r.selection.data.type} size={22} />
                        ) : (
                          <Icon size={15} strokeWidth={1.9} />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-[13px] font-medium text-slate-900">{r.label}</span>
                          <span className="shrink-0 font-mono text-[11px] text-slate-400">{r.id}</span>
                        </span>
                        {r.meta && <span className="block truncate text-xs text-slate-500">{r.meta}</span>}
                      </span>
                      {active && <CornerDownLeft size={13} className="shrink-0 text-slate-400" />}
                    </button>
                  </React.Fragment>
                );
              })
            )}
            {results.length > 0 && (
              <div className="mt-1 flex items-center gap-3 border-t border-slate-100 px-3 pb-0.5 pt-1.5 text-[11px] text-slate-400">
                <span>↑↓ to navigate</span>
                <span>Enter to open on map</span>
                <span>Esc to close</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Right utilities */}
      <div className="flex shrink-0 items-center gap-1">
        <div
          className="mr-1 hidden items-center rounded-md border border-slate-700 bg-slate-800 p-0.5 lg:flex"
          role="radiogroup"
          aria-label="Network layer mode"
        >
          {NETWORK_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={networkMode === m.id}
              onClick={() => setNetworkMode(m.id)}
              className={cn(
                'h-6 rounded px-2.5 text-xs font-medium transition-colors',
                networkMode === m.id ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-slate-100',
              )}
            >
              {m.label}
            </button>
          ))}
        </div>

        <SyncStatus />

        <IconButton
          icon={Undo2}
          label="Undo (Ctrl+Z)"
          variant="dark"
          size="md"
          onClick={undo}
          disabled={!canUndo}
          className="max-md:hidden"
        />
        <IconButton
          icon={Redo2}
          label="Redo (Ctrl+Y)"
          variant="dark"
          size="md"
          onClick={redo}
          disabled={!canRedo}
          className="max-md:hidden"
        />

        <span className="mx-1 hidden h-5 w-px bg-slate-700 sm:block" />

        {activeView === 'map' && (
          <IconButton
            icon={Layers}
            label="Map layers"
            variant="dark"
            onClick={() => setIsLayersDrawerOpen(true)}
            className="max-md:hidden"
          />
        )}
        <IconButton
          icon={Bell}
          label={activeFaultsCount ? `${activeFaultsCount} open faults` : 'No open faults'}
          variant="dark"
          badge={activeFaultsCount || null}
          onClick={() => setModalOpen('faults', true)}
          className="max-md:hidden"
        />
        <IconButton
          icon={CircleHelp}
          label="Help and user guide"
          variant="dark"
          onClick={() => setModalOpen('help', true)}
          className="max-md:hidden"
        />

        <Popover
          align="end"
          panelClassName="w-64"
          trigger={({ open: menuOpen, toggle }) => (
            <button
              type="button"
              onClick={toggle}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className={cn(
                'ml-1 flex h-[48px] items-center gap-2 rounded-md pl-1 pr-1.5 transition-colors md:h-8',
                menuOpen ? 'bg-slate-800' : 'hover:bg-slate-800',
              )}
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-600 text-[10.5px] font-semibold text-white">
                {roleInitials(userRole)}
              </span>
              <span className="hidden text-[13px] font-medium text-slate-200 xl:inline">{userRole}</span>
              <ChevronDown size={14} className="text-slate-500" />
            </button>
          )}
        >
          {(close) => (
            <>
              <div className="border-b border-slate-100 px-3 pb-2.5 pt-1.5">
                <div className="text-[13px] font-semibold text-slate-900">{userRole}</div>
                <div className="text-xs text-slate-500">Shared workspace · saved to the FiberGIS server</div>
              </div>
              <MenuLabel>Switch role</MenuLabel>
              {ROLES.map((role) => (
                <MenuItem
                  key={role}
                  label={role}
                  active={role === userRole}
                  icon={role === userRole ? Check : undefined}
                  onClick={() => {
                    setUserRole(role);
                    close();
                  }}
                />
              ))}
              <MenuSeparator />
              <MenuLabel>Interface</MenuLabel>
              <div className="px-3 pb-1.5">
                <div className="grid grid-cols-2 rounded-md bg-slate-100 p-0.5 text-xs font-medium">
                  {(['simple', 'pro'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setUiMode(m)}
                      className={cn(
                        'h-6 rounded',
                        uiMode === m ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800',
                      )}
                    >
                      {m === 'simple' ? 'Simple' : 'Professional'}
                    </button>
                  ))}
                </div>
              </div>
              <MenuSeparator />
              <MenuLabel>Data</MenuLabel>
              <MenuItem
                icon={Download}
                label="Export backup"
                hint=".json"
                onClick={() => {
                  backupSystem();
                  close();
                }}
              />
              <MenuItem
                icon={Upload}
                label="Restore from backup…"
                onClick={() => {
                  restoreInputRef.current?.click();
                  close();
                }}
              />
              <MenuItem
                icon={Globe}
                label="Export to Google Earth"
                hint=".kml"
                onClick={() => {
                  exportKML();
                  close();
                }}
              />
              <MenuItem
                icon={Upload}
                label="Import KML or KMZ…"
                hint="preview first"
                onClick={() => {
                  useUiStore.getState().setModalOpen('kmlImport', true);
                  close();
                }}
              />
              <MenuSeparator />
              <MenuItem
                icon={RotateCcw}
                label="Reset to sample data"
                danger
                onClick={() => {
                  close();
                  handleReset();
                }}
              />
            </>
          )}
        </Popover>
        <input
          ref={restoreInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={handleRestoreFile}
        />
      </div>
    </header>
  );
};
