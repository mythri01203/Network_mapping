/**
 * Transitional facade over the Zustand stores in `src/stores`. It preserves the original
 * `useNetwork()` API so components can migrate to selective store hooks one at a time;
 * new code should import from `src/stores` directly.
 */
import type React from 'react';
import type { ReactNode } from 'react';
import type * as domain from '@fibergis/shared';
import type {
  AuditLog,
  Cable,
  CableType,
  CatalogComponent,
  Customer,
  Equipment,
  EquipmentImage,
  EquipmentPort,
  EquipmentType,
  Fault,
  ImageAnnotation,
  JointClosure,
  NetworkDocument,
  NetworkZone,
  SpliceRecord,
  Splitter,
  TracePathNode,
  TraceSummary,
  UserRole,
  WorkOrder,
} from '@fibergis/shared';
import type { MainView } from '../types/ui';
import { type BikerRoute, type BikerWaypoint, useBikerStore } from '../stores/bikerStore';
import { type MapTool, type TileProvider, useMapStore } from '../stores/mapStore';
import * as actions from '../stores/networkActions';
import { useNetworkStore } from '../stores/networkStore';
import { type ToastItem, useToastStore } from '../stores/toastStore';
import { useTraceStore } from '../stores/traceStore';
import {
  type NetworkMode,
  type SelectedObject,
  type SelectedObjectType,
  type UiMode,
  useUiStore,
} from '../stores/uiStore';

export type { BikerRoute, BikerWaypoint, ToastItem };

type BooleanUpdater = boolean | ((prev: boolean) => boolean);

interface NetworkContextType {
  activeMainView: MainView;
  setActiveMainView: (view: MainView) => void;

  equipments: Equipment[];
  cables: Cable[];
  splitters: Splitter[];
  closures: JointClosure[];
  customers: Customer[];
  faults: Fault[];
  workOrders: WorkOrder[];
  auditLogs: AuditLog[];
  zones: NetworkZone[];
  documents: NetworkDocument[];

  // Legacy loose typing kept for existing consumers; they move to the typed `SelectedObject` union with the store hooks.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  selectedObject: { type: SelectedObjectType; data: any } | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setSelectedObject: (obj: { type: SelectedObjectType; data: any } | null) => void;
  activeTool: MapTool;
  setActiveTool: (tool: MapTool) => void;
  selectedEquipmentTypeToAdd: EquipmentType | null;
  setSelectedEquipmentTypeToAdd: (type: EquipmentType | null) => void;
  selectedCableTypeToDraw: CableType;
  setSelectedCableTypeToDraw: (type: CableType) => void;
  activeDrawingPoints: [number, number][];
  setActiveDrawingPoints: React.Dispatch<React.SetStateAction<[number, number][]>>;
  measuringPoints: [number, number][];
  setMeasuringPoints: React.Dispatch<React.SetStateAction<[number, number][]>>;

  activeTracePath: TracePathNode[] | null;
  activeTraceCableIds: string[];
  activeTraceEquipmentIds: string[];
  activeTraceSummary: TraceSummary | null;
  traceNetworkPath: (targetId: string) => boolean;
  clearTrace: () => void;

  activeLayers: Record<string, boolean>;
  toggleLayer: (layerName: string) => void;
  layerOpacity: Record<string, number>;
  setLayerOpacity: (layer: string, opacity: number) => void;
  isLayersDrawerOpen: boolean;
  setIsLayersDrawerOpen: (open: boolean) => void;
  mapTileProvider: TileProvider;
  setMapTileProvider: (provider: TileProvider) => void;
  userRole: UserRole;
  setUserRole: (role: UserRole) => void;
  networkMode: NetworkMode;
  setNetworkMode: (mode: NetworkMode) => void;

  isLeftPanelOpen: boolean;
  setIsLeftPanelOpen: (open: BooleanUpdater) => void;
  isRightPanelOpen: boolean;
  setIsRightPanelOpen: (open: BooleanUpdater) => void;
  isBottomPanelOpen: boolean;
  setIsBottomPanelOpen: (open: BooleanUpdater) => void;
  isSidebarCollapsed: boolean;
  setIsSidebarCollapsed: (collapsed: BooleanUpdater) => void;

  isCableWizardOpen: boolean;
  setIsCableWizardOpen: (open: boolean) => void;
  isCustomerWizardOpen: boolean;
  setIsCustomerWizardOpen: (open: boolean) => void;
  isEquipmentModalOpen: boolean;
  setIsEquipmentModalOpen: (open: boolean) => void;
  isTerminalBoxModalOpen: boolean;
  setIsTerminalBoxModalOpen: (open: boolean) => void;
  isSplitterModalOpen: boolean;
  setIsSplitterModalOpen: (open: boolean) => void;
  isSplicingModalOpen: boolean;
  setIsSplicingModalOpen: (open: boolean) => void;
  isRouteTraceModalOpen: boolean;
  setIsRouteTraceModalOpen: (open: boolean) => void;
  isFaultModalOpen: boolean;
  setIsFaultModalOpen: (open: boolean) => void;
  isTechnicianMobileOpen: boolean;
  setIsTechnicianMobileOpen: (open: boolean) => void;
  isCapacityDashboardOpen: boolean;
  setIsCapacityDashboardOpen: (open: boolean) => void;
  isReportsModalOpen: boolean;
  setIsReportsModalOpen: (open: boolean) => void;
  isHelpModalOpen: boolean;
  setIsHelpModalOpen: (open: boolean) => void;
  isDocumentModalOpen: boolean;
  setIsDocumentModalOpen: (open: boolean) => void;
  isComponentCatalogOpen: boolean;
  setIsComponentCatalogOpen: (open: boolean) => void;
  isPortManagerOpen: boolean;
  setIsPortManagerOpen: (open: boolean) => void;
  isKnowledgeModalOpen: boolean;
  setIsKnowledgeModalOpen: (open: boolean) => void;
  selectedKnowledgeId: string | null;
  setSelectedKnowledgeId: (id: string | null) => void;
  openKnowledgeForEquipment: (equipmentTypeOrId: string) => void;
  projectStartPoint: [number, number] | null;
  setProjectStartPoint: (pt: [number, number] | null) => void;

  customComponents: CatalogComponent[];
  addCustomComponent: (item: CatalogComponent) => void;
  updateEquipmentPort: (equipmentId: string, portId: string, changes: Partial<EquipmentPort>) => void;
  addSplice: (closureId: string, splice: SpliceRecord) => boolean;
  removeSplice: (closureId: string, spliceId: string) => void;
  publishState: 'draft' | 'published';
  saveDraft: () => void;
  publishNetwork: () => void;

  uiMode: UiMode;
  setUiMode: (mode: UiMode) => void;
  isBikerMode: boolean;
  setIsBikerMode: (open: boolean) => void;
  bikerWaypoints: BikerWaypoint[];
  bikerRoute: BikerRoute | null;
  addBikerWaypoint: (asset: BikerWaypoint) => void;
  navigateToAsset: (asset: BikerWaypoint) => void;
  clearBikerRoute: () => void;

  addEquipment: (item: domain.EquipmentDraft) => Equipment | null;
  updateEquipment: (item: Equipment, options?: { silent?: boolean }) => void;
  deleteEquipment: (id: string, options?: { skipConfirm?: boolean }) => boolean;
  addCable: (item: domain.CableDraft) => Cable | null;
  updateCable: (item: Cable, options?: { silent?: boolean }) => void;
  deleteCable: (id: string, options?: { skipConfirm?: boolean }) => boolean;
  allocateFiberCore: (
    cableId: string,
    coreNumber: number,
    customerId?: string,
    equipmentId?: string,
    portName?: string,
  ) => boolean;
  connectCustomerToPort: (customerData: domain.CustomerDraft) => Customer | null;
  uploadEquipmentPhoto: (equipmentId: string, photo: Partial<EquipmentImage>) => void;
  saveImageAnnotation: (equipmentId: string, imageId: string, annotation: ImageAnnotation) => void;
  deleteImageAnnotation: (equipmentId: string, imageId: string, annotationId: string) => void;
  recordNewFault: (faultData: domain.FaultDraft) => Fault | null;
  resolveExistingFault: (faultId: string) => void;
  addWorkOrder: (order: domain.WorkOrderDraft) => WorkOrder | null;
  updateWorkOrderStatus: (workOrderId: string, status: WorkOrder['status']) => void;
  logAudit: (action: string, details: string, assetId: string, assetType: AuditLog['assetType']) => void;

  addZone: (zone: domain.ZoneDraft) => NetworkZone | null;
  updateZone: (zone: NetworkZone) => void;
  deleteZone: (id: string) => void;

  addDocument: (doc: domain.DocumentDraft) => NetworkDocument | null;
  deleteDocument: (id: string) => void;

  backupSystem: () => void;
  restoreSystem: (jsonString: string) => boolean;
  resetToSampleData: () => void;
  exportKML: () => void;

  mapFlyToTarget: { lat: number; lng: number; zoom?: number } | null;
  flyToLocation: (lat: number, lng: number, zoom?: number) => void;

  toasts: ToastItem[];
  showToast: (type: ToastItem['type'], title: string, message: string) => void;
  removeToast: (id: string) => void;

  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

/** State now lives in module-level stores; the provider is kept so the component tree is unchanged. */
export const NetworkProvider: React.FC<{ children: ReactNode }> = ({ children }) => children;

export const useNetwork = (): NetworkContextType => {
  const ui = useUiStore();
  const map = useMapStore();
  const network = useNetworkStore();
  const trace = useTraceStore();
  const biker = useBikerStore();
  const toast = useToastStore();

  const modal = (id: Parameters<typeof ui.setModalOpen>[0]) => (open: boolean) => ui.setModalOpen(id, open);
  const panel = (id: Parameters<typeof ui.setPanelOpen>[0]) => (open: BooleanUpdater) => ui.setPanelOpen(id, open);

  return {
    activeMainView: ui.activeMainView,
    setActiveMainView: ui.setActiveMainView,

    equipments: network.equipment,
    cables: network.cables,
    splitters: network.splitters,
    closures: network.closures,
    customers: network.customers,
    faults: network.faults,
    workOrders: network.workOrders,
    auditLogs: network.auditLogs,
    zones: network.zones,
    documents: network.documents,

    selectedObject: ui.selectedObject,
    setSelectedObject: (obj) => ui.select(obj as SelectedObject | null),
    activeTool: map.activeTool,
    setActiveTool: map.setActiveTool,
    selectedEquipmentTypeToAdd: map.equipmentTypeToAdd,
    setSelectedEquipmentTypeToAdd: map.setEquipmentTypeToAdd,
    selectedCableTypeToDraw: map.cableTypeToDraw,
    setSelectedCableTypeToDraw: map.setCableTypeToDraw,
    activeDrawingPoints: map.drawingPoints,
    setActiveDrawingPoints: map.setDrawingPoints,
    measuringPoints: map.measuringPoints,
    setMeasuringPoints: map.setMeasuringPoints,

    activeTracePath: trace.path,
    activeTraceCableIds: trace.cableIds,
    activeTraceEquipmentIds: trace.equipmentIds,
    activeTraceSummary: trace.summary,
    traceNetworkPath: actions.traceNetworkPath,
    clearTrace: trace.clear,

    activeLayers: map.layers,
    toggleLayer: map.toggleLayer,
    layerOpacity: map.layerOpacity,
    setLayerOpacity: map.setLayerOpacity,
    isLayersDrawerOpen: map.isLayersDrawerOpen,
    setIsLayersDrawerOpen: map.setLayersDrawerOpen,
    mapTileProvider: map.tileProvider,
    setMapTileProvider: map.setTileProvider,
    userRole: ui.userRole,
    setUserRole: ui.setUserRole,
    networkMode: ui.networkMode,
    setNetworkMode: ui.setNetworkMode,

    isLeftPanelOpen: ui.panels.left,
    setIsLeftPanelOpen: panel('left'),
    isRightPanelOpen: ui.panels.right,
    setIsRightPanelOpen: panel('right'),
    isBottomPanelOpen: ui.panels.bottom,
    setIsBottomPanelOpen: panel('bottom'),
    isSidebarCollapsed: ui.isSidebarCollapsed,
    setIsSidebarCollapsed: ui.setSidebarCollapsed,

    isCableWizardOpen: ui.modals.cableWizard,
    setIsCableWizardOpen: modal('cableWizard'),
    isCustomerWizardOpen: ui.modals.customerWizard,
    setIsCustomerWizardOpen: modal('customerWizard'),
    isEquipmentModalOpen: ui.modals.equipment,
    setIsEquipmentModalOpen: modal('equipment'),
    isTerminalBoxModalOpen: ui.modals.terminalBox,
    setIsTerminalBoxModalOpen: modal('terminalBox'),
    isSplitterModalOpen: ui.modals.splitter,
    setIsSplitterModalOpen: modal('splitter'),
    isSplicingModalOpen: ui.modals.splicing,
    setIsSplicingModalOpen: modal('splicing'),
    isRouteTraceModalOpen: ui.modals.routeTrace,
    setIsRouteTraceModalOpen: modal('routeTrace'),
    isFaultModalOpen: ui.modals.faults,
    setIsFaultModalOpen: modal('faults'),
    isTechnicianMobileOpen: ui.modals.technicianMobile,
    setIsTechnicianMobileOpen: modal('technicianMobile'),
    isCapacityDashboardOpen: ui.modals.capacityDashboard,
    setIsCapacityDashboardOpen: modal('capacityDashboard'),
    isReportsModalOpen: ui.modals.reports,
    setIsReportsModalOpen: modal('reports'),
    isHelpModalOpen: ui.modals.help,
    setIsHelpModalOpen: modal('help'),
    isDocumentModalOpen: ui.modals.documents,
    setIsDocumentModalOpen: modal('documents'),
    isComponentCatalogOpen: ui.modals.componentCatalog,
    setIsComponentCatalogOpen: modal('componentCatalog'),
    isPortManagerOpen: ui.modals.portManager,
    setIsPortManagerOpen: modal('portManager'),
    isKnowledgeModalOpen: ui.modals.knowledge,
    setIsKnowledgeModalOpen: modal('knowledge'),
    selectedKnowledgeId: ui.selectedKnowledgeId,
    setSelectedKnowledgeId: ui.setSelectedKnowledgeId,
    openKnowledgeForEquipment: ui.openKnowledge,
    projectStartPoint: network.projectStartPoint,
    setProjectStartPoint: network.setProjectStartPoint,

    customComponents: network.catalog,
    addCustomComponent: actions.addCatalogComponent,
    updateEquipmentPort: actions.updateEquipmentPort,
    addSplice: actions.addSplice,
    removeSplice: actions.removeSplice,
    publishState: ui.publishState,
    saveDraft: actions.saveDraft,
    publishNetwork: actions.publishNetwork,

    uiMode: ui.uiMode,
    setUiMode: ui.setUiMode,
    isBikerMode: biker.isBikerMode,
    setIsBikerMode: biker.setBikerMode,
    bikerWaypoints: biker.waypoints,
    bikerRoute: biker.route,
    addBikerWaypoint: biker.addWaypoint,
    navigateToAsset: biker.navigateTo,
    clearBikerRoute: biker.clearRoute,

    addEquipment: actions.addEquipment,
    updateEquipment: actions.updateEquipment,
    deleteEquipment: actions.deleteEquipment,
    addCable: actions.addCable,
    updateCable: actions.updateCable,
    deleteCable: actions.deleteCable,
    allocateFiberCore: actions.allocateFiberCore,
    connectCustomerToPort: actions.connectCustomerToPort,
    uploadEquipmentPhoto: actions.uploadEquipmentPhoto,
    saveImageAnnotation: actions.saveImageAnnotation,
    deleteImageAnnotation: actions.deleteImageAnnotation,
    recordNewFault: actions.recordNewFault,
    resolveExistingFault: actions.resolveExistingFault,
    addWorkOrder: actions.addWorkOrder,
    updateWorkOrderStatus: actions.updateWorkOrderStatus,
    logAudit: actions.logAudit,

    addZone: actions.addZone,
    updateZone: actions.updateZone,
    deleteZone: actions.deleteZone,
    addDocument: actions.addDocument,
    deleteDocument: actions.deleteDocument,

    backupSystem: actions.backupSystem,
    restoreSystem: actions.restoreSystem,
    resetToSampleData: actions.resetToSampleData,
    exportKML: actions.exportKML,

    mapFlyToTarget: map.flyToTarget,
    flyToLocation: map.flyTo,

    toasts: toast.toasts,
    showToast: toast.show,
    removeToast: toast.dismiss,

    undo: network.undo,
    redo: network.redo,
    canUndo: network.history.index > 0,
    canRedo: network.history.index < network.history.stack.length - 1,
  };
};
