import React, { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { useShallow } from 'zustand/react/shallow';
import { useUiStore } from './stores/uiStore';
import { VIEW_META, useActiveView } from './app/views';
import type { MainView } from './types/ui';
import { TopNavBar } from './components/navbar/TopNavBar';
import { LeftSidebar } from './components/sidebar/LeftSidebar';
import { ComponentLibrary } from './components/panels/ComponentLibrary';
import { GISMap } from './components/gis/GISMap';
import { PropertiesPanel } from './components/panels/PropertiesPanel';
import { BottomInfoPanel } from './components/panels/BottomInfoPanel';

const lazyView = <K extends string>(load: () => Promise<Record<K, React.ComponentType>>, name: K) =>
  lazy(() => load().then((m) => ({ default: m[name] })));

// Full-screen views are loaded on first visit to keep the map's initial load small.
const NetworkTopologyView = lazyView(() => import('./components/views/NetworkTopologyView'), 'NetworkTopologyView');
const OLTRackView = lazyView(() => import('./components/views/OLTRackView'), 'OLTRackView');
const EquipmentInventoryView = lazyView(
  () => import('./components/views/EquipmentInventoryView'),
  'EquipmentInventoryView',
);
const CustomerDirectoryView = lazyView(
  () => import('./components/views/CustomerDirectoryView'),
  'CustomerDirectoryView',
);
const CableTVView = lazyView(() => import('./components/views/CableTVView'), 'CableTVView');
const ZoneManagementView = lazyView(() => import('./components/views/ZoneManagementView'), 'ZoneManagementView');
const OperationsHubView = lazyView(() => import('./components/views/OperationsHubView'), 'OperationsHubView');
const AdminConfigView = lazyView(() => import('./components/views/AdminConfigView'), 'AdminConfigView');
const FieldWorkView = lazyView(() => import('./components/views/FieldWorkView'), 'FieldWorkView');
const CableInventoryView = lazyView(() => import('./components/views/CableInventoryView'), 'CableInventoryView');

const VIEW_COMPONENTS: Record<Exclude<MainView, 'map'>, React.ComponentType> = {
  topology: NetworkTopologyView,
  olt_rack: OLTRackView,
  inventory: EquipmentInventoryView,
  customers: CustomerDirectoryView,
  cables: CableInventoryView,
  field: FieldWorkView,
  cable_tv: CableTVView,
  operations: OperationsHubView,
  zones: ZoneManagementView,
  admin: AdminConfigView,
};

const MapWorkspace: React.FC = () => (
  <>
    <ComponentLibrary />
    <div className="flex-1 flex flex-col h-full overflow-hidden relative">
      <div className="flex-1 relative overflow-hidden">
        <GISMap />
      </div>
      <BottomInfoPanel />
    </div>
    <PropertiesPanel />
  </>
);

const ViewFallback: React.FC = () => (
  <div className="flex flex-1 items-center justify-center bg-slate-50" role="status" aria-label="Loading view">
    <span className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600" />
  </div>
);
// Modals & Drawers
import { CableWizardModal } from './components/wizards/CableWizardModal';
import { CustomerWizardModal } from './components/wizards/CustomerWizardModal';
import { TerminalBoxModal } from './components/terminalBox/TerminalBoxModal';
import { SplitterPortModal } from './components/fiber/SplitterPortModal';
import { SplicingModal } from './components/fiber/SplicingModal';
import { RouteTraceModal } from './components/fiber/RouteTraceModal';
import { FaultManagementModal } from './components/faults/FaultManagementModal';
import { TechnicianMobileView } from './components/technician/TechnicianMobileView';
import { CapacityDashboardModal } from './components/dashboard/CapacityDashboardModal';
import { ReportsModal } from './components/reports/ReportsModal';
import { HelpModal } from './components/common/HelpModal';
import { DocumentManagerModal } from './components/documents/DocumentManagerModal';
import { AdvancedLayersDrawer } from './components/gis/AdvancedLayersDrawer';
import { ToastNotifications } from './components/common/ToastNotifications';
import { ComponentCatalogModal } from './components/catalog/ComponentCatalogModal';
import { PortManagerModal } from './components/ports/PortManagerModal';
import { EquipmentKnowledgeModal } from './components/knowledge/EquipmentKnowledgeModal';

export const AppContent: React.FC = () => {
  const { isKnowledgeModalOpen, setModalOpen, selectedKnowledgeId } = useUiStore(
    useShallow((s) => ({
      isKnowledgeModalOpen: s.modals.knowledge,
      setModalOpen: s.setModalOpen,
      selectedKnowledgeId: s.selectedKnowledgeId,
    })),
  );
  const activeView = useActiveView();

  useEffect(() => {
    document.title = activeView === 'map' ? 'FiberGIS · Network Mapping' : `${VIEW_META[activeView].label} · FiberGIS`;
  }, [activeView]);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-slate-100 font-sans">
      {/* 1. Top Navigation Bar with View Switchers, Search, and Utilities */}
      <TopNavBar />

      {/* 2. Main Middle Workspace Area */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Left Global Navigation Sidebar */}
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

      {/* 3. Specialized Guided Modals & Drawers */}
      <CableWizardModal />
      <CustomerWizardModal />
      <TerminalBoxModal />
      <SplitterPortModal />
      <SplicingModal />
      <RouteTraceModal />
      <FaultManagementModal />
      <TechnicianMobileView />
      <CapacityDashboardModal />
      <ReportsModal />
      <HelpModal />
      <DocumentManagerModal />
      <AdvancedLayersDrawer />
      <ComponentCatalogModal />
      <PortManagerModal />
      <EquipmentKnowledgeModal
        isOpen={isKnowledgeModalOpen}
        onClose={() => setModalOpen('knowledge', false)}
        initialEquipmentId={selectedKnowledgeId}
      />

      {/* 4. Global Alerts & Toast Notifications */}
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
