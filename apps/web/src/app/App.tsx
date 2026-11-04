import React, { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';

import { MapWorkspace } from '../features/map/MapWorkspace';
import type { MainView } from './mainView';
import { ModalHost } from './ModalHost';
import { LeftSidebar } from './shell/LeftSidebar';
import { ToastNotifications } from './shell/ToastNotifications';
import { TopNavBar } from './shell/TopNavBar';
import { useActiveView, VIEW_META } from './views';

const lazyView = <K extends string>(load: () => Promise<Record<K, React.ComponentType>>, name: K) =>
  lazy(() => load().then((m) => ({ default: m[name] })));

// Full-screen views are loaded on first visit to keep the map's initial load small.
const VIEW_COMPONENTS: Record<Exclude<MainView, 'map'>, React.ComponentType> = {
  topology: lazyView(() => import('../features/topology/NetworkTopologyView'), 'NetworkTopologyView'),
  olt_rack: lazyView(() => import('../features/olt-rack/OLTRackView'), 'OLTRackView'),
  inventory: lazyView(() => import('../features/inventory/EquipmentInventoryView'), 'EquipmentInventoryView'),
  customers: lazyView(() => import('../features/customers/CustomerDirectoryView'), 'CustomerDirectoryView'),
  cables: lazyView(() => import('../features/cables/CableInventoryView'), 'CableInventoryView'),
  field: lazyView(() => import('../features/field-work/FieldWorkView'), 'FieldWorkView'),
  cable_tv: lazyView(() => import('../features/cable-tv/CableTVView'), 'CableTVView'),
  operations: lazyView(() => import('../features/operations/OperationsHubView'), 'OperationsHubView'),
  zones: lazyView(() => import('../features/zones/ZoneManagementView'), 'ZoneManagementView'),
  admin: lazyView(() => import('../features/settings/AdminConfigView'), 'AdminConfigView'),
};

const ViewFallback: React.FC = () => (
  <div className="flex flex-1 items-center justify-center bg-slate-50" role="status" aria-label="Loading view">
    <span className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600" />
  </div>
);

const AppContent: React.FC = () => {
  const activeView = useActiveView();

  useEffect(() => {
    document.title = activeView === 'map' ? 'FiberGIS · Network Mapping' : `${VIEW_META[activeView].label} · FiberGIS`;
  }, [activeView]);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-slate-100 font-sans">
      <TopNavBar />
      <div className="relative flex flex-1 overflow-hidden">
        <LeftSidebar />
        <Suspense fallback={<ViewFallback />}>
          <Routes>
            <Route path="/" element={<MapWorkspace />} />
            {Object.entries(VIEW_COMPONENTS).map(([view, Component]) => (
              <Route key={view} path={`${VIEW_META[view as MainView].path}/*`} element={<Component />} />
            ))}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </div>
      <ModalHost />
      <ToastNotifications />
    </div>
  );
};

export default function App() {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
}
