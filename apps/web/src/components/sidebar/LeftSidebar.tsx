import React, { useState } from 'react';
import {
  Route,
  Combine,
  Split,
  Box,
  Unplug,
  ChartColumn,
  FileText,
  FolderOpen,
  BookOpenText,
  LibraryBig,
  Smartphone,
  Bike,
  Plus,
  UserPlus,
  Cable,
  MapPinPlus,
  TriangleAlert,
  PanelLeftClose,
  PanelLeftOpen,
  type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router';
import { useShallow } from 'zustand/react/shallow';
import { useBikerStore } from '../../stores/bikerStore';
import { useNetworkStore } from '../../stores/networkStore';
import { useUiStore } from '../../stores/uiStore';
import type { MainView } from '../../types/ui';
import { VIEW_META, useActiveView, useOpenView } from '../../app/views';
import { Popover, MenuItem, MenuLabel, MenuSeparator, cn } from '../ui';

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
  const { isSidebarCollapsed, setIsSidebarCollapsed, uiMode, setModalOpen, setPanelOpen } = useUiStore(
    useShallow((s) => ({
      isSidebarCollapsed: s.isSidebarCollapsed,
      setIsSidebarCollapsed: s.setSidebarCollapsed,
      uiMode: s.uiMode,
      setModalOpen: s.setModalOpen,
      setPanelOpen: s.setPanelOpen,
    })),
  );
  const { equipments, cables, customers, faults, workOrders, zones, documents, closures, splitters } = useNetworkStore(
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
    })),
  );
  const setIsBikerMode = useBikerStore((s) => s.setBikerMode);

  const activeView = useActiveView();
  const openView = useOpenView();
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const collapsed = isSidebarCollapsed;
  const simple = uiMode === 'simple';

  const openFaults = faults.filter((f) => f.status !== 'Resolved').length;
  const openWorkOrders = workOrders.filter((w: any) => w.status !== 'Completed' && w.status !== 'Cancelled').length;
  const fatCount = equipments.filter((e) => /FAT|Terminal Box/i.test(String(e.type))).length;
  const catvCount = equipments.filter((e) => e.category === 'Cable TV Infrastructure').length;

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
        view('operations', { count: openFaults + openWorkOrders || undefined, alert: openFaults > 0, simple: true }),
        view('field', { simple: true }),
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
        tool('trace', 'Route Trace', Route, () => setModalOpen('routeTrace', true), { simple: true }),
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
        tool('capacity', 'Capacity', ChartColumn, () => setModalOpen('capacityDashboard', true)),
        tool('reports', 'Reports', FileText, () => setModalOpen('reports', true)),
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
        'group relative flex w-full items-center rounded-md text-[13px] transition-colors',
        collapsed ? 'h-9 justify-center' : 'h-8 gap-2.5 px-2.5',
        item.active ? 'bg-blue-50 font-medium text-blue-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
      ),
    };
    const content = (
      <>
        {item.active && <span className="absolute -left-2 top-1.5 bottom-1.5 w-[3px] rounded-r bg-blue-600" />}
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
          <Link to={item.to} aria-current={item.active ? 'page' : undefined} {...shared}>
            {content}
          </Link>
        ) : (
          <button type="button" onClick={item.onClick} {...shared}>
            {content}
          </button>
        )}
      </li>
    );
  };

  return (
    <nav
      aria-label="Primary"
      className={cn(
        'relative z-[900] flex h-full shrink-0 flex-col border-r border-slate-200 bg-white transition-[width] duration-150',
        collapsed ? 'w-14' : 'w-56',
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
                'flex w-full items-center justify-center rounded-md bg-blue-600 text-white shadow-sm transition-colors hover:bg-blue-700',
                collapsed ? 'h-9' : 'h-8 gap-2 text-[13px] font-medium',
                open && 'bg-blue-700',
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
                }}
              />
              <MenuItem
                icon={Cable}
                label="New cable route"
                onClick={() => {
                  setModalOpen('cableWizard', true);
                  close();
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
                }}
              />
              <MenuSeparator />
              <MenuItem
                icon={TriangleAlert}
                label="Report a fault"
                onClick={() => {
                  setModalOpen('faults', true);
                  close();
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
            'mt-1 flex w-full items-center rounded-md text-[13px] text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800',
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
  );
};
