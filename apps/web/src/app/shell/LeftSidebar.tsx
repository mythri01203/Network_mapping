import React, { useState } from 'react';
import {
  Bike,
  BookOpenText,
  Box,
  Cable,
  Camera,
  ChartColumn,
  ClipboardCheck,
  Combine,
  FileText,
  FolderOpen,
  GitBranch,
  LibraryBig,
  type LucideIcon,
  MapPinPlus,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Radio,
  Route,
  Smartphone,
  Split,
  TriangleAlert,
  Unplug,
  UserPlus,
  Wifi,
} from 'lucide-react';
import { Link } from 'react-router';
import { useShallow } from 'zustand/react/shallow';

import { isFaultOpen, isWorkOrderOpen } from '@fibergis/shared';

import { cn, MenuItem, MenuLabel, MenuSeparator, Popover } from '../../components/ui';
import { useBikerStore } from '../../stores/bikerStore';
import { useNetworkStore } from '../../stores/networkStore';
import { useTraceStore } from '../../stores/traceStore';
import { useUiStore } from '../../stores/uiStore';
import { useValidationStore } from '../../stores/validationActions';
import type { MainView } from '../mainView';
import { useActiveView, useOpenView, VIEW_META } from '../views';

interface NavEntry {
  key: string;
  label: string;
  icon: LucideIcon;
  /** Views are links; tools run onClick. */
  to?: string;
  onClick?: () => void;
  active?: boolean;
  count?: number;
  alert?: boolean;
  simple?: boolean;
}

interface NavGroup {
  label: string;
  items: NavEntry[];
}

interface TooltipState {
  label: string;
  top: number;
}

export const LeftSidebar: React.FC = () => {
  const { isSidebarCollapsed, setIsSidebarCollapsed, uiMode, setModalOpen, setPanelOpen, menuOpen, setMenuOpen } = useUiStore(
    useShallow((s) => ({
      menuOpen: s.isMobileMenuOpen,
      setMenuOpen: s.setMobileMenuOpen,
      isSidebarCollapsed: s.isSidebarCollapsed,
      setIsSidebarCollapsed: s.setSidebarCollapsed,
      uiMode: s.uiMode,
      setModalOpen: s.setModalOpen,
      setPanelOpen: s.setPanelOpen,
    })),
  );
  const { equipments, cables, customers, faults, workOrders, zones, documents, closures, splitters, rfElements } = useNetworkStore(
    useShallow((s) => ({
      equipments: s.equipment,
      cables: s.cables,
      customers: s.customers,
      faults: s.faults,
      workOrders: s.workOrders,
      zones: s.zones,
      documents: s.documents,
      closures: s.closures,
      splitters: s.splitters,
      rfElements: s.rfElements,
    })),
  );
  const setIsBikerMode = useBikerStore((s) => s.setBikerMode);
  // Network mapping Phase 15: open map check findings that the last check still finds.
  const openFindings = useNetworkStore((s) => (s.validationFindings ?? []).filter((f) => f.state === 'open' && f.presence === 'found').length);

  const activeView = useActiveView();
  const openView = useOpenView();
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  // The phone menu always shows labels; the desk sidebar keeps the chosen width.
  const collapsed = isSidebarCollapsed && !menuOpen;
  const closeMenu = () => {
    if (menuOpen) setMenuOpen(false);
  };
  const simple = uiMode === 'simple';

  // TEST faults are not counted: they are drills, not real outages.
  const openFaults = faults.filter((f) => isFaultOpen(f) && !f.isTest).length;
  const openWorkOrders = workOrders.filter((w) => isWorkOrderOpen(w) && !w.isTest).length;
  const fatCount = equipments.filter((e) => /FAT|Terminal Box/i.test(String(e.type))).length;
  // Cable TV items are the Phase 6 records, not old map pins in the Cable TV category.
  const catvCount = rfElements.length;

  const view = (id: MainView, extra?: Partial<NavEntry>): NavEntry => ({
    key: id,
    label: VIEW_META[id].label,
    icon: VIEW_META[id].icon,
    to: VIEW_META[id].path,
    active: activeView === id,
    ...extra,
  });

  const tool = (
    key: string,
    label: string,
    icon: LucideIcon,
    onClick: () => void,
    extra?: Partial<NavEntry>,
  ): NavEntry => ({
    key,
    label,
    icon,
    onClick,
    ...extra,
  });

  const groups: NavGroup[] = [
    {
      label: 'Workspace',
      items: [
        view('map', { simple: true }),
        view('view3d', { simple: true }),
        view('twin', { simple: true }),
        view('topology'),
        view('olt_rack'),
        view('inventory', { count: equipments.length, simple: true }),
        view('cables', { count: cables.length, simple: true }),
        view('customers', { count: customers.length, simple: true }),
        view('cable_tv', { count: catvCount || undefined }),
        view('zones', { count: zones.length || undefined }),
      ],
    },
    {
      label: 'Operations',
      items: [
        { key: 'capture', label: 'Field capture', icon: Camera, to: '/capture', simple: true },
        view('operations', { count: openFaults + openWorkOrders || undefined, alert: openFaults > 0, simple: true }),
        view('field', { simple: true }),
        view('agent_tracking', { simple: true }),
        tool('tech', 'Technician App', Smartphone, () => setModalOpen('technicianMobile', true)),
        tool('biker', 'Ride Navigation', Bike, () => {
          openView('map');
          setIsBikerMode(true);
        }),
      ],
    },
    {
      label: 'Fiber Tools',
      items: [
        tool('onuFleet', 'ONU Fleet', Radio, () => setModalOpen('onuFleet', true), {
          count: customers.length || undefined,
          simple: true,
        }),
        tool('trace', 'Route Trace', Route, () => setModalOpen('fiberTrace', true), { simple: true }),
        // Network mapping Phase 15: the 12 traces on the one trace engine.
        tool('networkTrace', 'Network Trace', GitBranch, () => useTraceStore.getState().openPanel()),
        tool('fat', 'Terminal Boxes', Box, () => setModalOpen('terminalBox', true), {
          count: fatCount || undefined,
          simple: true,
        }),
        tool('splitter', 'Splitters', Split, () => setModalOpen('splitter', true), {
          count: splitters.length || undefined,
        }),
        tool('splice', 'Splicing', Combine, () => setModalOpen('splicing', true), {
          count: closures.length || undefined,
        }),
        tool('ports', 'Port Manager', Unplug, () => setModalOpen('portManager', true)),
      ],
    },
    {
      label: 'Insights',
      items: [
        tool('monitoring', 'Live status', Wifi, () => setModalOpen('monitoring', true), { simple: true }),
        tool('capacity', 'Capacity', ChartColumn, () => setModalOpen('capacityDashboard', true)),
        tool('reports', 'Reports', FileText, () => setModalOpen('reports', true)),
        tool('mapCheck', 'Map Check', ClipboardCheck, () => useValidationStore.getState().setOpen(true), {
          count: openFindings || undefined,
        }),
        tool('docs', 'Documents', FolderOpen, () => setModalOpen('documents', true), {
          count: documents.length || undefined,
        }),
        tool('knowledge', 'Equipment Guide', BookOpenText, () => setModalOpen('knowledge', true), { simple: true }),
        tool('catalog', 'Component Catalog', LibraryBig, () => setModalOpen('componentCatalog', true)),
      ],
    },
  ];

  const visibleGroups = groups
    .map((g) => ({ ...g, items: simple ? g.items.filter((i) => i.simple) : g.items }))
    .filter((g) => g.items.length > 0);

  const admin = view('admin');

  const showTip = (label: string) => (e: React.MouseEvent<HTMLElement> | React.FocusEvent<HTMLElement>) => {
    if (!collapsed) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setTooltip({ label, top: rect.top + rect.height / 2 });
  };
  const hideTip = () => setTooltip(null);

  const renderItem = (item: NavEntry) => {
    const Icon = item.icon;
    const shared = {
      onMouseEnter: showTip(item.count ? `${item.label} · ${item.count}` : item.label),
      onMouseLeave: hideTip,
      onFocus: showTip(item.label),
      onBlur: hideTip,
      'aria-label': collapsed ? item.label : undefined,
      className: cn(
        'group relative flex w-full items-center rounded-lg text-[13px] transition-[background-color,color,box-shadow] duration-150',
        collapsed ? 'h-9 justify-center' : 'h-[48px] gap-2.5 px-2.5 md:h-8',
        item.active
          ? 'bg-gradient-to-r from-blue-50 to-indigo-50/60 font-semibold text-blue-700 shadow-xs ring-1 ring-blue-100'
          : 'text-slate-600 hover:bg-slate-900/[0.04] hover:text-slate-900',
      ),
    };
    const content = (
      <>
        {item.active && <span className="absolute -left-2 top-1.5 bottom-1.5 w-[3px] rounded-r-full bg-gradient-to-b from-blue-500 to-indigo-600" />}
        <Icon
          size={collapsed ? 18 : 16}
          strokeWidth={1.8}
          className={cn('shrink-0', item.active ? 'text-blue-600' : 'text-slate-500 group-hover:text-slate-700')}
        />
        {!collapsed && <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>}
        {!collapsed && item.count !== undefined && (
          <span
            className={cn(
              'tabular shrink-0 rounded px-1.5 text-[11px] leading-[18px]',
              item.alert ? 'bg-red-50 font-medium text-red-600' : item.active ? 'text-blue-600' : 'text-slate-400',
            )}
          >
            {item.count}
          </span>
        )}
        {collapsed && item.alert && (
          <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-red-500 ring-2 ring-white" />
        )}
      </>
    );
    return (
      <li key={item.key}>
        {item.to ? (
          <Link to={item.to} aria-current={item.active ? 'page' : undefined} onClick={closeMenu} {...shared}>
            {content}
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => {
              closeMenu();
              item.onClick?.();
            }}
            {...shared}
          >
            {content}
          </button>
        )}
      </li>
    );
  };

  return (
    <>
      {menuOpen && (
        <button
          type="button"
          aria-label="Close menu"
          onClick={closeMenu}
          className="fixed inset-x-0 bottom-0 top-12 z-[1080] bg-slate-900/40 md:hidden"
        />
      )}
    <nav
      aria-label="Primary"
      className={cn(
        'flex-col border-r border-slate-200/80 bg-white/95 backdrop-blur-sm transition-[width] duration-150 md:relative md:z-[900] md:flex md:h-full md:shrink-0',
        menuOpen ? 'fixed bottom-0 left-0 top-12 z-[1090] flex w-72 shadow-2xl md:static md:shadow-none' : 'hidden',
        collapsed ? 'md:w-14' : 'md:w-56',
      )}
    >
      {/* Create */}
      <div className={cn('shrink-0 border-b border-slate-100', collapsed ? 'px-2 py-2.5' : 'px-3 py-3')}>
        <Popover
          align="start"
          side={collapsed ? 'right' : 'bottom'}
          panelClassName="w-56"
          trigger={({ open, toggle }) => (
            <button
              type="button"
              onClick={toggle}
              onMouseEnter={showTip('Create')}
              onMouseLeave={hideTip}
              aria-haspopup="menu"
              aria-expanded={open}
              aria-label="Create"
              className={cn(
                'ui-brand flex w-full items-center justify-center rounded-lg bg-blue-600 text-white transition-[filter,box-shadow] duration-150',
                collapsed ? 'h-9' : 'h-[48px] gap-2 text-[13px] font-semibold md:h-8',
                open && 'brightness-95',
              )}
            >
              <Plus size={collapsed ? 18 : 16} strokeWidth={2.2} />
              {!collapsed && 'Create'}
            </button>
          )}
        >
          {(close) => (
            <>
              <MenuLabel>Add to network</MenuLabel>
              <MenuItem
                icon={UserPlus}
                label="New customer connection"
                onClick={() => {
                  setModalOpen('customerWizard', true);
                  close();
                  closeMenu();
                }}
              />
              <MenuItem
                icon={Cable}
                label="New cable route"
                onClick={() => {
                  setModalOpen('cableWizard', true);
                  close();
                  closeMenu();
                }}
              />
              <MenuItem
                icon={MapPinPlus}
                label="Place equipment"
                hint="from library"
                onClick={() => {
                  openView('map');
                  setPanelOpen('left', true);
                  close();
                  closeMenu();
                }}
              />
              <MenuSeparator />
              <MenuItem
                icon={TriangleAlert}
                label="Report a fault"
                onClick={() => {
                  setModalOpen('faults', true);
                  close();
                  closeMenu();
                }}
              />
            </>
          )}
        </Popover>
      </div>

      {/* Navigation groups */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden py-2" onScroll={hideTip}>
        {visibleGroups.map((group, gi) => (
          <div key={group.label} className={cn(gi > 0 && (collapsed ? 'mt-2 border-t border-slate-100 pt-2' : 'mt-3'))}>
            {!collapsed && (
              <div className="px-5 pb-1 text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">
                {group.label}
              </div>
            )}
            <ul className={cn('space-y-px', collapsed ? 'px-2' : 'px-2.5')}>{group.items.map(renderItem)}</ul>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className={cn('shrink-0 border-t border-slate-100 py-2', collapsed ? 'px-2' : 'px-2.5')}>
        <ul className="space-y-px">{renderItem(admin)}</ul>
        <button
          type="button"
          onClick={() => {
            setIsSidebarCollapsed((c) => !c);
            setTooltip(null);
          }}
          onMouseEnter={showTip('Expand sidebar')}
          onMouseLeave={hideTip}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={cn(
            'mt-1 hidden w-full items-center rounded-md md:flex text-[13px] text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800',
            collapsed ? 'h-9 justify-center' : 'h-8 gap-2.5 px-2.5',
          )}
        >
          {collapsed ? <PanelLeftOpen size={18} strokeWidth={1.8} /> : <PanelLeftClose size={16} strokeWidth={1.8} />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>

      {collapsed && tooltip && (
        <div
          role="tooltip"
          className="animate-fade-in pointer-events-none fixed left-[60px] z-[1600] -translate-y-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white shadow-lg"
          style={{ top: tooltip.top }}
        >
          {tooltip.label}
        </div>
      )}
    </nav>
    </>
  );
};
