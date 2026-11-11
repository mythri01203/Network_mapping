import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  Cable as CableLucide,
  Check,
  ChevronDown,
  CircleHelp,
  Clock,
  CornerDownLeft,
  Download,
  Filter,
  GitMerge,
  Globe,
  Hexagon,
  Layers,
  type LucideIcon,
  Map as MapLucide,
  Menu,
  Plug,
  Radio,
  Redo2,
  Repeat,
  RotateCcw,
  Search,
  Split,
  TriangleAlert,
  Undo2,
  Upload,
  UserRound,
  UtilityPole,
  Waypoints,
  X,
} from 'lucide-react';
import { Link } from 'react-router';
import { useShallow } from 'zustand/react/shallow';

import {
  ACCOUNT_ROLE_LABELS,
  isFaultOpen,
  SEARCH_KIND_LABELS,
  SEARCH_MAX_LIMIT,
  type SearchHit,
  searchHitKey,
  type SearchKind,
  searchNetwork,
  type UserRole,
} from '@fibergis/shared';

import { EquipmentIllustration } from '../../components/icons/EquipmentIllustration';
import {
  cn,
  equipmentIcon,
  IconButton,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  Popover,
} from '../../components/ui';
import { selectionOwnerId, zoomToKeys } from '../../features/selection/selectionActions';
import { countByCollection, parseKey, recordIndex, selectionFor } from '../../features/selection/selectionModel';
import { layerForCollection } from '../../features/table/tableLayers';
import { currentAccount, useAuthStore } from '../../stores/authStore';
import { useMapStore } from '../../stores/mapStore';
import { backupSystem, exportKML, resetToSampleData, restoreSystem } from '../../stores/networkActions';
import { getNetworkSnapshot, selectCanRedo, selectCanUndo, useNetworkStore } from '../../stores/networkStore';
import { useSearchStore } from '../../stores/searchStore';
import { useSelectionStore } from '../../stores/selectionStore';
import { showToast } from '../../stores/toastStore';
import { useUiStore } from '../../stores/uiStore';
import { useActiveView, useOpenView, useShowOnMap, VIEW_META } from '../views';
import { MapModeSwitch } from './MapModeSwitch';
import { AreaSearchNote, SyncStatus } from './SyncStatus';

/** Phase 16: one hit of the shared search, as the search box lists it. */
interface SearchResult {
  hit: SearchHit;
  icon: LucideIcon;
  meta: string;
}

const KIND_ICON: Record<SearchKind, LucideIcon> = {
  equipment: Waypoints,
  pole: UtilityPole,
  cable: CableLucide,
  core: CableLucide,
  customer: UserRound,
  ont: Radio,
  fault: TriangleAlert,
  splitter: Split,
  closure: GitMerge,
  duct: Waypoints,
  span: Waypoints,
  zone: Hexagon,
  ponPort: Plug,
  odfPort: Plug,
  building: MapLucide,
  slackLoop: Repeat,
};

/** Hits shown in the box; "Show all" takes every hit. */
const SHOWN_HITS = 40;

const ROLES: UserRole[] = ['Administrator', 'Network Engineer', 'Network Operator', 'Field Technician', 'Supervisor'];

const NETWORK_MODES: Array<{ id: 'All' | 'Fiber' | 'CableTV'; label: string }> = [
  { id: 'All', label: 'All' },
  { id: 'Fiber', label: 'Fiber' },
  { id: 'CableTV', label: 'CATV' },
];

const roleInitials = (role: string) =>
  role
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

export const TopNavBar: React.FC = () => {
  const { faults, undo, redo, canUndo, canRedo } = useNetworkStore(
    useShallow((s) => ({
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
  // Phase 9: once someone is logged in, the menu shows them instead of a role choice.
  const account = useAuthStore((s) => currentAccount(s));
  const shownName = account ? account.displayName : userRole;

  const activeView = useActiveView();
  const showOnMap = useShowOnMap();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchBoxRef = useRef<HTMLDivElement>(null);
  const restoreInputRef = useRef<HTMLInputElement>(null);

  // Phase 16: the shared search (the same as the server's GET /search) over what this device holds.
  const searchable = useNetworkStore(
    useShallow((s) => ({
      equipment: s.equipment,
      cables: s.cables,
      customers: s.customers,
      faults: s.faults,
      splitters: s.splitters,
      closures: s.closures,
      ducts: s.ducts,
      spans: s.spans,
      zones: s.zones,
      onts: s.onts,
      buildings: s.buildings,
      slackLoops: s.slackLoops,
    })),
  );
  const openView = useOpenView();
  const ownerId = selectionOwnerId();
  const allRecent = useSearchStore((s) => s.recent);
  const recent = useMemo(() => allRecent.filter((r) => r.ownerId === ownerId), [allRecent, ownerId]);
  // Typing stays quick on a big network: the search follows a moment behind.
  const deferredQuery = useDeferredValue(query);
  const found = useMemo(() => searchNetwork(searchable, deferredQuery, { limit: SHOWN_HITS }), [searchable, deferredQuery]);
  const results = useMemo<SearchResult[]>(() => {
    const byId = new Map(searchable.equipment.map((e) => [e.id, e]));
    return found.hits.map((hit) => {
      const record = hit.kind === 'equipment' ? byId.get(hit.id) : undefined;
      return {
        hit,
        icon: record ? equipmentIcon(record.type) : KIND_ICON[hit.kind],
        meta: [hit.matched.field !== 'ID' && hit.matched.field !== 'Name' ? `${hit.matched.field}: ${hit.matched.value}` : null, hit.detail].filter(Boolean).join(' · '),
      };
    });
  }, [found, searchable.equipment]);

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

  const closeSearch = () => {
    useSearchStore.getState().remember(ownerId, query);
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  };

  /** Opens one hit: its record in the inspector and on the map. A fibre opens its cable, a port its box. */
  const selectResult = (r: SearchResult) => {
    const { hit } = r;
    const data = getNetworkSnapshot();
    const index = recordIndex(data);
    const parsed = parseKey(searchHitKey(hit));
    let record = parsed ? index.get(parsed.collection, parsed.id) : undefined;
    let collection = parsed?.collection;
    if (collection === 'splitters' && record) {
      const box = index.get('equipment', (record as { id: string; terminalBoxId?: string }).terminalBoxId ?? '');
      if (box) {
        collection = 'equipment';
        record = box;
      }
    } else if (collection === 'onts') {
      const customer = data.customers.find((c) => c.ontId === hit.id);
      if (customer) {
        collection = 'customers';
        record = customer;
      }
    }
    const selection = collection && record ? selectionFor(collection, record) : null;
    if (selection) {
      showOnMap(selection);
      // A fibre: the cable's cores show below the map.
      if (hit.kind === 'core') useUiStore.getState().setPanelOpen('bottom', true);
    } else if (parsed && record) {
      useSelectionStore.getState().setKeys([searchHitKey(hit)], 'replace');
      openView('map');
      zoomToKeys([searchHitKey(hit)]);
    } else {
      showToast('info', 'No place to show', `${hit.label} has no record on the map to open.`);
    }
    closeSearch();
  };

  /** Phase 16: every hit chosen together, shown on the map and in the attribute table. */
  const showAllResults = () => {
    const all: SearchHit[] = [];
    for (let offset = 0; offset < found.total; offset += SEARCH_MAX_LIMIT) {
      all.push(...searchNetwork(searchable, query, { limit: SEARCH_MAX_LIMIT, offset }).hits);
    }
    const keys = [...new Set(all.map(searchHitKey))];
    const selection = useSelectionStore.getState();
    selection.setKeys(keys, 'replace');
    openView('map');
    zoomToKeys(keys);
    const top = [...countByCollection(keys).entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    selection.openTable({ onlySelected: true, ...(top ? { layerId: layerForCollection(top).id } : {}) });
    closeSearch();
  };

  const openFilterBuilder = () => {
    openView('map');
    useSelectionStore.getState().openTable({ filters: true, onlySelected: false });
    setOpen(false);
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
  const typing = query.trim().length > 0;
  const showDropdown = open && (typing || recent.length > 0);

  let lastKind: SearchKind | null = null;

  return (
    <header className="ui-topbar relative z-[1100] flex h-12 shrink-0 items-center gap-2 border-b border-slate-950 bg-slate-900 pl-1 pr-1 text-slate-300 md:gap-3 md:pl-3 md:pr-2">
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
          <span className="ui-brand flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600 ring-1 ring-white/15">
            <Waypoints size={16} strokeWidth={2.2} />
          </span>
          <span className="hidden text-[14px] font-semibold tracking-tight sm:inline">
            Fiber<span className="text-blue-300">GIS</span>
          </span>
        </Link>
        <span className="hidden h-5 w-px bg-white/10 md:block" />
        <div className="hidden min-w-0 items-center gap-2 md:flex">
          <view.icon size={15} strokeWidth={1.9} className="shrink-0 text-blue-300/80" />
          <span className="truncate text-[13px] font-medium text-slate-100">{view.label}</span>
          {uiMode === 'simple' && (
            <span className="rounded-md border border-blue-400/30 bg-blue-500/10 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-blue-200">
              Simple
            </span>
          )}
        </div>
      </div>

      <MapModeSwitch />

      {/* Global search */}
      <div ref={searchBoxRef} className="relative mx-auto w-full max-w-xl min-w-0 flex-1">
        <div
          className={cn(
            'flex h-10 items-center gap-2 rounded-lg border px-2.5 transition-[background-color,border-color,box-shadow] duration-150 md:h-8',
            open
              ? 'border-blue-500 bg-white text-slate-900 ring-4 ring-blue-500/20'
              : 'border-white/10 bg-white/[0.06] text-slate-300 hover:border-white/20 hover:bg-white/[0.09]',
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
                : 'Search names, ids, serial, model, tag, pole no., cable/fibre, port…'
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
            className="animate-pop-in absolute left-0 right-0 top-full mt-1.5 max-h-[70vh] overflow-y-auto rounded-xl border border-slate-200/80 bg-white py-1 text-slate-700 shadow-[var(--shadow-overlay)]"
          >
            {typing && <AreaSearchNote query={deferredQuery} />}
            {!typing ? (
              <>
                <MenuLabel>Recent searches (this device)</MenuLabel>
                {recent.map((r) => (
                  <button
                    key={r.at}
                    type="button"
                    onClick={() => {
                      setQuery(r.query);
                      inputRef.current?.focus();
                    }}
                    className="flex min-h-[44px] w-full items-center gap-3 px-3 text-left text-[13px] text-slate-700 hover:bg-slate-100 md:min-h-8"
                  >
                    <Clock size={14} className="shrink-0 text-slate-400" />
                    <span className="truncate">{r.query}</span>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => useSearchStore.getState().forgetRecent(ownerId)}
                  className="mt-1 flex min-h-[44px] w-full items-center border-t border-slate-100 px-3 text-left text-[12px] text-slate-500 hover:text-slate-800 md:min-h-8"
                >
                  Forget recent searches
                </button>
              </>
            ) : results.length === 0 ? (
              <div className="px-4 py-6 text-center text-[13px] text-slate-500">
                No results for <span className="font-medium text-slate-800">"{query.trim()}"</span>
                <button type="button" onClick={openFilterBuilder} className="mt-2 flex min-h-[44px] w-full items-center justify-center gap-2 font-medium text-blue-700">
                  <Filter size={14} /> Use the filter builder instead
                </button>
              </div>
            ) : (
              results.map((r, i) => {
                const header = r.hit.kind !== lastKind ? SEARCH_KIND_LABELS[r.hit.kind] : null;
                lastKind = r.hit.kind;
                const Icon = r.icon;
                const active = i === activeIndex;
                const record = r.hit.kind === 'equipment' ? searchable.equipment.find((e) => e.id === r.hit.id) : undefined;
                return (
                  <React.Fragment key={`${r.hit.kind}-${r.hit.id}-${r.hit.part ?? ''}`}>
                    {header && <MenuLabel>{header}</MenuLabel>}
                    <button
                      type="button"
                      role="option"
                      aria-selected={active}
                      onMouseEnter={() => setActiveIndex(i)}
                      onClick={() => selectResult(r)}
                      className={cn('flex min-h-[48px] w-full items-center gap-3 px-3 py-1.5 text-left md:min-h-0', active && 'bg-slate-100')}
                    >
                      <span
                        className={cn(
                          'flex h-7 w-7 shrink-0 items-center justify-center rounded-md border',
                          r.hit.kind === 'fault'
                            ? 'border-red-200 bg-red-50 text-red-600'
                            : 'border-slate-200 bg-slate-50 text-slate-500',
                        )}
                      >
                        {record ? (
                          <EquipmentIllustration type={record.type} size={22} />
                        ) : (
                          <Icon size={15} strokeWidth={1.9} />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-[13px] font-medium text-slate-900">{r.hit.label}</span>
                          <span className="shrink-0 font-mono text-[11px] text-slate-400">{r.hit.id}</span>
                        </span>
                        {r.meta && <span className="block truncate text-xs text-slate-500">{r.meta}</span>}
                      </span>
                      {active && <CornerDownLeft size={13} className="shrink-0 text-slate-400" />}
                    </button>
                  </React.Fragment>
                );
              })
            )}
            {typing && results.length > 0 && (
              <div className="mt-1 border-t border-slate-100">
                <button
                  type="button"
                  onClick={showAllResults}
                  data-testid="search-show-all"
                  className="flex min-h-[48px] w-full items-center gap-2 px-3 text-left text-[13px] font-semibold text-blue-700 hover:bg-blue-50 md:min-h-9"
                >
                  <Layers size={14} /> Show all {found.total.toLocaleString()} on the map and in the table
                </button>
                <button
                  type="button"
                  onClick={openFilterBuilder}
                  className="flex min-h-[48px] w-full items-center gap-2 px-3 text-left text-[13px] text-slate-600 hover:bg-slate-100 md:min-h-9"
                >
                  <Filter size={14} /> Filter builder (field, is, value)…
                </button>
                <div className="hidden items-center gap-3 px-3 pb-0.5 pt-1 text-[11px] text-slate-400 md:flex">
                  <span>{found.total > results.length ? `Best ${results.length} of ${found.total.toLocaleString()}` : `${found.total} found`}</span>
                  <span>↑↓ to navigate</span>
                  <span>Enter to open on map</span>
                  <span>Esc to close</span>
                </div>
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
                {roleInitials(shownName)}
              </span>
              <span className="hidden text-[13px] font-medium text-slate-200 xl:inline" data-testid="user-menu-name">
                {shownName}
              </span>
              <ChevronDown size={14} className="text-slate-500" />
            </button>
          )}
        >
          {(close) => (
            <>
              <div className="border-b border-slate-100 px-3 pb-2.5 pt-1.5">
                <div className="text-[13px] font-semibold text-slate-900">{shownName}</div>
                <div className="text-xs text-slate-500">
                  {account ? `${ACCOUNT_ROLE_LABELS[account.role]} · logged in as ${account.username}` : 'Login is off (setup mode) · saved to the FiberGIS server'}
                </div>
              </div>
              {account ? (
                <>
                  <MenuItem
                    label="Change my password"
                    onClick={() => {
                      useAuthStore.getState().setPasswordChangeOpen(true);
                      close();
                    }}
                  />
                  <MenuItem
                    label="Log out"
                    onClick={() => {
                      close();
                      void useAuthStore.getState().logout();
                    }}
                  />
                </>
              ) : (
                <>
                  <MenuLabel>Switch role (login is off)</MenuLabel>
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
                </>
              )}
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
                label="Import or export a map file…"
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
