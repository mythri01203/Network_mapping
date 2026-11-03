import React from 'react';
import { NetworkProvider, useNetwork } from './context/NetworkContext';
import { TopNavBar } from './components/navbar/TopNavBar';
import { LeftSidebar } from './components/sidebar/LeftSidebar';
import { ComponentLibrary } from './components/panels/ComponentLibrary';
import { GISMap } from './components/gis/GISMap';
import { PropertiesPanel } from './components/panels/PropertiesPanel';
import { BottomInfoPanel } from './components/panels/BottomInfoPanel';

// Full Screen View Components
import { NetworkTopologyView } from './components/views/NetworkTopologyView';
import { OLTRackView } from './components/views/OLTRackView';
import { EquipmentInventoryView } from './components/views/EquipmentInventoryView';
import { CustomerDirectoryView } from './components/views/CustomerDirectoryView';
import { CableTVView } from './components/views/CableTVView';
import { ZoneManagementView } from './components/views/ZoneManagementView';
import { OperationsHubView } from './components/views/OperationsHubView';
import { AdminConfigView } from './components/views/AdminConfigView';
import { FieldWorkView } from './components/views/FieldWorkView';
import { CableInventoryView } from './components/views/CableInventoryView';

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
  const { activeMainView, isKnowledgeModalOpen, setIsKnowledgeModalOpen, selectedKnowledgeId } = useNetwork();

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-slate-100 font-sans">
      {/* 1. Top Navigation Bar with View Switchers, Search, and Utilities */}
      <TopNavBar />

      {/* 2. Main Middle Workspace Area */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Left Global Navigation Sidebar */}
        <LeftSidebar />

        {/* Dynamic Main View Switcher */}
        {activeMainView === 'map' ? (
          <>
            {/* Left Component Library (Collapsible) */}
            <ComponentLibrary />

            {/* Center GIS Workspace + Bottom Panel */}
            <div className="flex-1 flex flex-col h-full overflow-hidden relative">
              {/* Main Leaflet GIS Map */}
              <div className="flex-1 relative overflow-hidden">
                <GISMap />
              </div>

              {/* Bottom Information Panel (Collapsible) */}
              <BottomInfoPanel />
            </div>

            {/* Right Properties Panel (Collapsible) */}
            <PropertiesPanel />
          </>
        ) : activeMainView === 'topology' ? (
          <NetworkTopologyView />
        ) : activeMainView === 'olt_rack' ? (
          <OLTRackView />
        ) : activeMainView === 'inventory' ? (
          <EquipmentInventoryView />
        ) : activeMainView === 'customers' ? (
          <CustomerDirectoryView />
        ) : activeMainView === 'cables' ? (
          <CableInventoryView />
        ) : activeMainView === 'field' ? (
          <FieldWorkView />
        ) : activeMainView === 'cable_tv' ? (
          <CableTVView />
        ) : activeMainView === 'operations' ? (
          <OperationsHubView />
        ) : activeMainView === 'zones' ? (
          <ZoneManagementView />
        ) : (
          <AdminConfigView />
        )}
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
        onClose={() => setIsKnowledgeModalOpen(false)}
        initialEquipmentId={selectedKnowledgeId}
      />

      {/* 4. Global Alerts & Toast Notifications */}
      <ToastNotifications />
    </div>
  );
};

export default function App() {
  return (
    <NetworkProvider>
      <AppContent />
    </NetworkProvider>
  );
}
