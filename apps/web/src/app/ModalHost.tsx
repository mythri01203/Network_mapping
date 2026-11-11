import React from 'react';
import { useShallow } from 'zustand/react/shallow';

import { CableWizardModal } from '../features/cables/CableWizardModal';
import { ComponentCatalogModal } from '../features/catalog/ComponentCatalogModal';
import { CustomerWizardModal } from '../features/customers/CustomerWizardModal';
import { OnuFleetModal } from '../features/customers/OnuFleetModal';
import { DocumentManagerModal } from '../features/documents/DocumentManagerModal';
import { DuctFormModal } from '../features/ducts/DuctFormModal';
import { OltConfigModal } from '../features/equipment/OltConfigModal';
import { FaultManagementModal } from '../features/faults/FaultManagementModal';
import { SavedRoutesModal } from '../features/field-work/SavedRoutesModal';
import { TechnicianMobileView } from '../features/field-work/TechnicianMobileView';
import { HelpModal } from '../features/help/HelpModal';
import { KmlImportModal } from '../features/import/KmlImportModal';
import { EquipmentKnowledgeModal } from '../features/knowledge/EquipmentKnowledgeModal';
import { AdvancedLayersDrawer } from '../features/map/AdvancedLayersDrawer';
import { MonitoringModal } from '../features/monitoring/MonitoringModal';
import { PortManagerModal } from '../features/ports/PortManagerModal';
import { SplitterPortModal } from '../features/ports/SplitterPortModal';
import { TerminalBoxModal } from '../features/ports/TerminalBoxModal';
import { CapacityDashboardModal } from '../features/reports/CapacityDashboardModal';
import { ReportsModal } from '../features/reports/ReportsModal';
import { SpliceModal } from '../features/splicing/SpliceModal';
import { SplicingModal } from '../features/splicing/SplicingModal';
import { FiberTraceModal } from '../features/trace/FiberTraceModal';
import { NetworkTraceModal } from '../features/trace/NetworkTraceModal';
import { RouteTraceModal } from '../features/trace/RouteTraceModal';
import { ValidationFindingsModal } from '../features/validation/ValidationFindingsModal';
import { useUiStore } from '../stores/uiStore';

/** Global dialogs and drawers. Each one reads its own open state from the UI store. */
export const ModalHost: React.FC = () => {
  const { isKnowledgeModalOpen, setModalOpen, selectedKnowledgeId } = useUiStore(
    useShallow((s) => ({
      isKnowledgeModalOpen: s.modals.knowledge,
      setModalOpen: s.setModalOpen,
      selectedKnowledgeId: s.selectedKnowledgeId,
    })),
  );

  return (
    <>
      <CableWizardModal />
      <CustomerWizardModal />
      <TerminalBoxModal />
      <SplitterPortModal />
      <SplicingModal />
      <SpliceModal />
      <RouteTraceModal />
      <FiberTraceModal />
      <NetworkTraceModal />
      <ValidationFindingsModal />
      <OnuFleetModal />
      <OltConfigModal />
      <FaultManagementModal />
      <TechnicianMobileView />
      <SavedRoutesModal />
      <CapacityDashboardModal />
      <MonitoringModal />
      <ReportsModal />
      <HelpModal />
      <DocumentManagerModal />
      <AdvancedLayersDrawer />
      <ComponentCatalogModal />
      <PortManagerModal />
      <KmlImportModal />
      <DuctFormModal />
      <EquipmentKnowledgeModal
        isOpen={isKnowledgeModalOpen}
        onClose={() => setModalOpen('knowledge', false)}
        initialEquipmentId={selectedKnowledgeId}
      />
    </>
  );
};
