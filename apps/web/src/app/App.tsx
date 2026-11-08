import React, { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router';

import { AgentTrackingRuntime } from '../features/agent-tracking/AgentTrackingRuntime';
import { AuthGate, SetupBanner, ViewerBanner } from '../features/auth/AuthGate';
import { MapWorkspace } from '../features/map/MapWorkspace';
import type { MainView } from './mainView';
import { ModalHost } from './ModalHost';
import { ConfirmDialogHost } from './shell/ConfirmDialogHost';
import { ConflictChoiceHost } from './shell/ConflictChoiceHost';
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
  agent_tracking: lazyView(() => import('../features/agent-tracking/AgentTrackingView'), 'AgentTrackingView'),
  cable_tv: lazyView(() => import('../features/cable-tv/CableTVView'), 'CableTVView'),
  operations: lazyView(() => import('../features/operations/OperationsHubView'), 'OperationsHubView'),
  zones: lazyView(() => import('../features/zones/ZoneManagementView'), 'ZoneManagementView'),
  admin: lazyView(() => import('../features/settings/AdminConfigView'), 'AdminConfigView'),
};

/** The simple phone capture flow. Full screen, without the engineer shell around it. */
const CaptureApp = lazyView(() => import('../features/capture/CaptureApp'), 'CaptureApp');
export const CAPTURE_PATH = '/capture';
/** The technician's jobs (Phase 8), with the same easy phone screens. */
const JobsApp = lazyView(() => import('../features/jobs/JobsApp'), 'JobsApp');
export const JOBS_PATH = '/jobs';

const ViewFallback: React.FC = () => (
  <div className="flex flex-1 items-center justify-center bg-slate-50" role="status" aria-label="Loading view">
    <span className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600" />
  </div>
);

const AppContent: React.FC = () => {
  const activeView = useActiveView();
  const path = useLocation().pathname.toLowerCase();
  const capture = path.startsWith(CAPTURE_PATH);
  const jobs = path.startsWith(JOBS_PATH);

  useEffect(() => {
    if (capture || jobs) return;
    document.title = activeView === 'map' ? 'FiberGIS · Network Mapping' : `${VIEW_META[activeView].label} · FiberGIS`;
  }, [activeView, capture, jobs]);

  if (capture || jobs) {
    return (
      <>
        <Suspense fallback={<ViewFallback />}>{jobs ? <JobsApp /> : <CaptureApp />}</Suspense>
        <ConflictChoiceHost />
        <ConfirmDialogHost />
        <ToastNotifications />
      </>
    );
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-slate-100 font-sans">
      <TopNavBar />
      <SetupBanner />
      <ViewerBanner />
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
      <AgentTrackingRuntime />
      <ModalHost />
      <ConflictChoiceHost />
      <ConfirmDialogHost />
      <ToastNotifications />
    </div>
  );
};

export default function App() {
  return (
    <BrowserRouter>
      <AuthGate>
        <AppContent />
      </AuthGate>
    </BrowserRouter>
  );
}
