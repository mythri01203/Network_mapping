import { useCallback } from 'react';
import {
  Boxes,
  Cable,
  ClipboardList,
  Cuboid,
  HardHat,
  Hexagon,
  type LucideIcon,
  Map as MapIcon,
  MapPinned,
  Network,
  Server,
  Settings2,
  Tv,
  Users,
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router';

import { useMapStore } from '../stores/mapStore';
import { type SelectedObject, useUiStore } from '../stores/uiStore';
import type { MainView } from './mainView';
import { boundsFor, focusFor } from './mapFocus';

export interface ViewMeta {
  path: string;
  label: string;
  description: string;
  icon: LucideIcon;
}

export const VIEW_META: Record<MainView, ViewMeta> = {
  map: { path: '/', label: 'Network Map', description: 'GIS workspace for the outside plant', icon: MapIcon },
  view3d: { path: '/3d', label: '3D View', description: 'Every mapped item drawn in 3D, from the same records', icon: Cuboid },
  topology: { path: '/topology', label: 'Topology', description: 'Logical OLT to ONT hierarchy', icon: Network },
  olt_rack: { path: '/olt-rack', label: 'OLT Rack', description: 'Central office chassis and PON ports', icon: Server },
  inventory: { path: '/equipment', label: 'Equipment', description: 'All network equipment', icon: Boxes },
  cables: { path: '/cables', label: 'Cables', description: 'Fiber and coaxial cable inventory', icon: Cable },
  customers: { path: '/customers', label: 'Customers', description: 'Subscribers and ONT service', icon: Users },
  cable_tv: { path: '/cable-tv', label: 'Cable TV', description: 'HFC nodes, amplifiers and taps', icon: Tv },
  zones: { path: '/zones', label: 'Zones', description: 'Service areas and coverage', icon: Hexagon },
  operations: { path: '/operations', label: 'Operations', description: 'Faults and work orders', icon: ClipboardList },
  field: { path: '/field-work', label: 'Field Work', description: 'Technician activity and navigation', icon: HardHat },
  agent_tracking: {
    path: '/agent-tracking',
    label: 'Agent Tracking',
    description: 'Duty routes, stops and GPS reports',
    icon: MapPinned,
  },
  admin: { path: '/admin', label: 'Administration', description: 'Users, configuration and data', icon: Settings2 },
};

const VIEWS = Object.keys(VIEW_META) as MainView[];

/** The view a URL path belongs to, or `null` when no view matches. */
export function viewForPath(pathname: string): MainView | null {
  const path = pathname.replace(/\/+$/, '').toLowerCase() || '/';
  if (path === '/') return 'map';
  return (
    VIEWS.find((v) => v !== 'map' && (path === VIEW_META[v].path || path.startsWith(`${VIEW_META[v].path}/`))) ?? null
  );
}

/** The main view shown for the current URL. */
export function useActiveView(): MainView {
  return viewForPath(useLocation().pathname) ?? 'map';
}

/** Returns a function that navigates to a main view, adding a history entry only when the view changes. */
export function useOpenView(): (view: MainView) => void {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  return useCallback(
    (view: MainView) => {
      if (viewForPath(pathname) !== view) navigate(VIEW_META[view].path);
    },
    [navigate, pathname],
  );
}

/**
 * Returns a function that selects an object, opens the inspector and centres the map on it,
 * switching to the map view if another view is showing.
 */
export function useShowOnMap(): (selection: SelectedObject, zoom?: number) => void {
  const openView = useOpenView();
  return useCallback(
    (selection: SelectedObject, zoom?: number) => {
      const ui = useUiStore.getState();
      ui.select(selection);
      ui.setPanelOpen('right', true);
      // A route is shown whole; a point is centred.
      const bounds = zoom === undefined ? boundsFor(selection) : null;
      const focus = focusFor(selection);
      if (bounds) useMapStore.getState().fitBounds(bounds);
      else if (focus) useMapStore.getState().flyTo(focus.lat, focus.lng, zoom ?? focus.zoom);
      openView('map');
    },
    [openView],
  );
}
