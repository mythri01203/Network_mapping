import React, { createContext, useContext, useState, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import * as domain from '@fibergis/shared';
import {
  type Equipment,
  type Cable,
  type Splitter,
  type JointClosure,
  type Customer,
  type Fault,
  type WorkOrder,
  type AuditLog,
  type UserRole,
  type EquipmentType,
  type CableType,
  type TracePathNode,
  type EquipmentImage,
  type ImageAnnotation,
  type NetworkZone,
  type NetworkDocument,
  type CatalogComponent,
  type EquipmentPort,
  type SpliceRecord,
  type TraceSummary,
  type NetworkData,
  type NetworkPatch,
  type CommandContext,
  type CommandResult,
  type CommandSuccess,
  applyPatch,
  isLatLngPair,
  isoDate,
  uniqueId,
} from '@fibergis/shared';
import type { MainView } from '../types/ui';
import { escapeXml } from '../lib/xml';
import {
  SAMPLE_EQUIPMENT,
  SAMPLE_CABLES,
  SAMPLE_SPLITTERS,
  SAMPLE_JOINT_CLOSURES,
  SAMPLE_CUSTOMERS,
  SAMPLE_FAULTS,
  SAMPLE_WORK_ORDERS,
  SAMPLE_AUDIT_LOGS,
  SAMPLE_ZONES,
  SAMPLE_DOCUMENTS,
} from '@fibergis/shared/sample';

/**
 * Bump whenever the bundled sample network changes shape so stale browser data
 * (which would otherwise shadow the fixed seed forever) is discarded once.
 */
const DATA_VERSION = '3';
const STORAGE_PREFIX = 'fiber_gis_';
const DATA_VERSION_KEY = `${STORAGE_PREFIX}data_version`;
const PERSISTED_KEYS = [
  'equipment',
  'cables',
  'splitters',
  'closures',
  'customers',
  'faults',
  'work_orders',
  'audit_logs',
  'zones',
  'documents',
  'custom_components',
  'project_start',
];
const MAX_AUDIT_LOGS = 500;
const MAX_HISTORY = 50;

const ensureStorageVersion = () => {
  try {
    if (localStorage.getItem(DATA_VERSION_KEY) === DATA_VERSION) return;
    PERSISTED_KEYS.forEach((key) => localStorage.removeItem(`${STORAGE_PREFIX}${key}`));
    localStorage.setItem(DATA_VERSION_KEY, DATA_VERSION);
  } catch {
    // Storage may be unavailable (private mode / quota); fall back to in-memory sample data.
  }
};

const loadState = <T,>(key: string, fallback: T, isValid: (value: unknown) => boolean = Array.isArray): T => {
  try {
    const saved = localStorage.getItem(`${STORAGE_PREFIX}${key}`);
    if (saved === null) return fallback;
    const parsed = JSON.parse(saved);
    return isValid(parsed) ? (parsed as T) : fallback;
  } catch {
    return fallback;
  }
};

const saveState = (key: string, value: unknown) => {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(value));
  } catch {
    // Ignore quota errors so the UI keeps working with in-memory state.
  }
};

const isRecordArray = (value: unknown): boolean =>
  Array.isArray(value) &&
  value.every((item) => item !== null && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string');

type SelectedObjectType = 'equipment' | 'cable' | 'customer' | 'closure' | 'fault';

const SELECTION_COLLECTION: Record<SelectedObjectType, keyof NetworkData> = {
  equipment: 'equipment',
  cable: 'cables',
  customer: 'customers',
  closure: 'closures',
  fault: 'faults',
};

interface CommandOptions {
  silent?: boolean;
  skipConfirm?: boolean;
}

interface HistorySnapshot {
  equipments: Equipment[];
  cables: Cable[];
  splitters: Splitter[];
  customers: Customer[];
  closures: JointClosure[];
}

export interface BikerWaypoint {
  id: string;
  name: string;
  lat: number;
  lng: number;
  type?: string;
}

export interface BikerRoute {
  coordinates: [number, number][];
  distanceMeters: number;
  durationSeconds: number;
  steps: string[];
  profile: 'driving';
  limitation: string;
}

export interface ToastItem {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message: string;
}

interface NetworkContextType {
  // Main View Navigation
  activeMainView: MainView;
  setActiveMainView: (view: MainView) => void;

  // Data
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

  // Selection & Tools
  selectedObject: { type: SelectedObjectType; data: any } | null;
  setSelectedObject: (obj: { type: SelectedObjectType; data: any } | null) => void;
  activeTool: 'select' | 'draw_cable' | 'add_equipment' | 'measure' | 'trace';
  setActiveTool: (tool: 'select' | 'draw_cable' | 'add_equipment' | 'measure' | 'trace') => void;
  selectedEquipmentTypeToAdd: EquipmentType | null;
  setSelectedEquipmentTypeToAdd: (type: EquipmentType | null) => void;
  selectedCableTypeToDraw: CableType;
  setSelectedCableTypeToDraw: (type: CableType) => void;
  activeDrawingPoints: [number, number][];
  setActiveDrawingPoints: React.Dispatch<React.SetStateAction<[number, number][]>>;
  measuringPoints: [number, number][];
  setMeasuringPoints: React.Dispatch<React.SetStateAction<[number, number][]>>;

  // Trace
  activeTracePath: TracePathNode[] | null;
  activeTraceCableIds: string[];
  activeTraceEquipmentIds: string[];
  activeTraceSummary: TraceSummary | null;
  traceNetworkPath: (targetId: string) => boolean;
  clearTrace: () => void;

  // Layers & Map Settings
  activeLayers: Record<string, boolean>;
  toggleLayer: (layerName: string) => void;
  layerOpacity: Record<string, number>;
  setLayerOpacity: (layer: string, opacity: number) => void;
  isLayersDrawerOpen: boolean;
  setIsLayersDrawerOpen: (open: boolean) => void;
  mapTileProvider: 'google_streets' | 'google_satellite' | 'osm';
  setMapTileProvider: (provider: 'google_streets' | 'google_satellite' | 'osm') => void;
  userRole: UserRole;
  setUserRole: (role: UserRole) => void;
  networkMode: 'All' | 'Fiber' | 'CableTV';
  setNetworkMode: (mode: 'All' | 'Fiber' | 'CableTV') => void;

  // Panels
  isLeftPanelOpen: boolean;
  setIsLeftPanelOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  isRightPanelOpen: boolean;
  setIsRightPanelOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  isBottomPanelOpen: boolean;
  setIsBottomPanelOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  isSidebarCollapsed: boolean;
  setIsSidebarCollapsed: (collapsed: boolean | ((prev: boolean) => boolean)) => void;

  // Modals
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

  uiMode: 'simple' | 'pro';
  setUiMode: (mode: 'simple' | 'pro') => void;
  isBikerMode: boolean;
  setIsBikerMode: (open: boolean) => void;
  bikerWaypoints: BikerWaypoint[];
  bikerRoute: BikerRoute | null;
  addBikerWaypoint: (asset: BikerWaypoint) => void;
  navigateToAsset: (asset: BikerWaypoint) => void;
  clearBikerRoute: () => void;

  // CRUD & Operations
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

  // Zone Management
  addZone: (zone: domain.ZoneDraft) => NetworkZone | null;
  updateZone: (zone: NetworkZone) => void;
  deleteZone: (id: string) => void;

  // Document Management
  addDocument: (doc: domain.DocumentDraft) => NetworkDocument | null;
  deleteDocument: (id: string) => void;

  // Backup, Restore & GIS Export
  backupSystem: () => void;
  restoreSystem: (jsonString: string) => boolean;
  resetToSampleData: () => void;
  exportKML: () => void;

  // Global search & map navigation
  mapFlyToTarget: { lat: number; lng: number; zoom?: number } | null;
  flyToLocation: (lat: number, lng: number, zoom?: number) => void;

  // Toasts
  toasts: ToastItem[];
  showToast: (type: ToastItem['type'], title: string, message: string) => void;
  removeToast: (id: string) => void;

  // History
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

const NetworkContext = createContext<NetworkContextType | undefined>(undefined);

export const NetworkProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  // Runs before any state initializer reads storage (first initializer in the component).
  useState(() => {
    ensureStorageVersion();
    return true;
  });

  // Primary datasets initialized with rich demonstration data
  const [equipments, setEquipments] = useState<Equipment[]>(() =>
    loadState('equipment', SAMPLE_EQUIPMENT, isRecordArray),
  );
  const [cables, setCables] = useState<Cable[]>(() => loadState('cables', SAMPLE_CABLES, isRecordArray));
  const [splitters, setSplitters] = useState<Splitter[]>(() => loadState('splitters', SAMPLE_SPLITTERS, isRecordArray));
  const [closures, setClosures] = useState<JointClosure[]>(() =>
    loadState('closures', SAMPLE_JOINT_CLOSURES, isRecordArray),
  );
  const [customers, setCustomers] = useState<Customer[]>(() => loadState('customers', SAMPLE_CUSTOMERS, isRecordArray));
  const [faults, setFaults] = useState<Fault[]>(() => loadState('faults', SAMPLE_FAULTS, isRecordArray));
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>(() =>
    loadState('work_orders', SAMPLE_WORK_ORDERS, isRecordArray),
  );
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>(() =>
    loadState('audit_logs', SAMPLE_AUDIT_LOGS, isRecordArray),
  );

  // Main Active View State
  const [activeMainView, setActiveMainView] = useState<MainView>('map');

  // Zones & Documents
  const [zones, setZones] = useState<NetworkZone[]>(() => loadState('zones', SAMPLE_ZONES, isRecordArray));
  const [documents, setDocuments] = useState<NetworkDocument[]>(() =>
    loadState('documents', SAMPLE_DOCUMENTS, isRecordArray),
  );

  const [isDocumentModalOpen, setIsDocumentModalOpen] = useState(false);
  const [isComponentCatalogOpen, setIsComponentCatalogOpen] = useState(false);
  const [isPortManagerOpen, setIsPortManagerOpen] = useState(false);
  const [customComponents, setCustomComponents] = useState<CatalogComponent[]>(() =>
    loadState<CatalogComponent[]>('custom_components', [], isRecordArray),
  );
  const [publishState, setPublishState] = useState<'draft' | 'published'>('draft');
  const [isBikerMode, setIsBikerMode] = useState(false);
  const [bikerWaypoints, setBikerWaypoints] = useState<BikerWaypoint[]>([]);
  const [bikerRoute, setBikerRoute] = useState<BikerRoute | null>(null);
  const [isLayersDrawerOpen, setIsLayersDrawerOpen] = useState(false);
  const [layerOpacity, setLayerOpacityState] = useState<Record<string, number>>({
    feederCable: 1.0,
    distributionCable: 1.0,
    dropCable: 1.0,
    undergroundCable: 0.9,
    aerialCable: 0.9,
    coaxialCable: 1.0,
    olt: 1.0,
    fdms: 1.0,
    fdt: 1.0,
    fat: 1.0,
    poles: 0.85,
    manholes: 0.85,
    customers: 1.0,
    cableTv: 1.0,
    faults: 1.0,
    labels: 1.0,
  });

  const setLayerOpacity = (layer: string, opacity: number) => {
    setLayerOpacityState((prev) => ({ ...prev, [layer]: opacity }));
  };

  // Persist to local storage
  useEffect(() => saveState('equipment', equipments), [equipments]);
  useEffect(() => saveState('cables', cables), [cables]);
  useEffect(() => saveState('splitters', splitters), [splitters]);
  useEffect(() => saveState('customers', customers), [customers]);
  useEffect(() => saveState('faults', faults), [faults]);
  useEffect(() => saveState('work_orders', workOrders), [workOrders]);
  useEffect(() => saveState('audit_logs', auditLogs), [auditLogs]);
  useEffect(() => saveState('zones', zones), [zones]);
  useEffect(() => saveState('documents', documents), [documents]);
  useEffect(() => saveState('closures', closures), [closures]);
  useEffect(() => saveState('custom_components', customComponents), [customComponents]);

  // Selections & Active Tool
  const [selectedObject, setSelectedObject] = useState<{ type: SelectedObjectType; data: any } | null>(null);
  const [activeTool, setActiveTool] = useState<'select' | 'draw_cable' | 'add_equipment' | 'measure' | 'trace'>(
    'select',
  );
  const [selectedEquipmentTypeToAdd, setSelectedEquipmentTypeToAdd] = useState<EquipmentType | null>(null);
  const [selectedCableTypeToDraw, setSelectedCableTypeToDraw] = useState<CableType>('Main Feeder Fiber');
  const [activeDrawingPoints, setActiveDrawingPoints] = useState<[number, number][]>([]);
  const [measuringPoints, setMeasuringPoints] = useState<[number, number][]>([]);

  // Trace State
  const [activeTracePath, setActiveTracePath] = useState<TracePathNode[] | null>(null);
  const [activeTraceCableIds, setActiveTraceCableIds] = useState<string[]>([]);
  const [activeTraceEquipmentIds, setActiveTraceEquipmentIds] = useState<string[]>([]);
  const [activeTraceSummary, setActiveTraceSummary] = useState<TraceSummary | null>(null);

  // Layers
  const [activeLayers, setActiveLayers] = useState<Record<string, boolean>>({
    feederCable: true,
    distributionCable: true,
    dropCable: true,
    undergroundCable: true,
    aerialCable: true,
    coaxialCable: true,
    olt: true,
    odf: true,
    fdms: true,
    fdt: true,
    fat: true,
    splitters: true,
    poles: true,
    manholes: true,
    customers: true,
    cableTv: true,
    faults: true,
    labels: true,
  });

  const toggleLayer = (layerName: string) => {
    setActiveLayers((prev) => ({ ...prev, [layerName]: !prev[layerName] }));
  };

  const [mapTileProvider, setMapTileProvider] = useState<'google_streets' | 'google_satellite' | 'osm'>(
    'google_streets',
  );
  const [userRole, setUserRole] = useState<UserRole>('Network Engineer');
  const [networkMode, setNetworkMode] = useState<'All' | 'Fiber' | 'CableTV'>('All');

  const [uiMode, setUiMode] = useState<'simple' | 'pro'>('simple');

  // Panels: start clean and uncrowded by default for maximum map space and simplicity
  const [isLeftPanelOpen, setIsLeftPanelOpen] = useState(false);
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(false);
  const [isBottomPanelOpen, setIsBottomPanelOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(true);

  // Modals
  const [isCableWizardOpen, setIsCableWizardOpen] = useState(false);
  const [isCustomerWizardOpen, setIsCustomerWizardOpen] = useState(false);
  const [isEquipmentModalOpen, setIsEquipmentModalOpen] = useState(false);
  const [isTerminalBoxModalOpen, setIsTerminalBoxModalOpen] = useState(false);
  const [isSplitterModalOpen, setIsSplitterModalOpen] = useState(false);
  const [isSplicingModalOpen, setIsSplicingModalOpen] = useState(false);
  const [isRouteTraceModalOpen, setIsRouteTraceModalOpen] = useState(false);
  const [isFaultModalOpen, setIsFaultModalOpen] = useState(false);
  const [isTechnicianMobileOpen, setIsTechnicianMobileOpen] = useState(false);
  const [isCapacityDashboardOpen, setIsCapacityDashboardOpen] = useState(false);
  const [isReportsModalOpen, setIsReportsModalOpen] = useState(false);
  const [isHelpModalOpen, setIsHelpModalOpen] = useState(false);
  const [isKnowledgeModalOpen, setIsKnowledgeModalOpen] = useState(false);
  const [selectedKnowledgeId, setSelectedKnowledgeId] = useState<string | null>(null);
  const [projectStartPoint, setProjectStartPointState] = useState<[number, number] | null>(() =>
    loadState<[number, number] | null>('project_start', null, isLatLngPair),
  );

  const setProjectStartPoint = (pt: [number, number] | null) => {
    setProjectStartPointState(pt);
    try {
      if (pt) localStorage.setItem(`${STORAGE_PREFIX}project_start`, JSON.stringify(pt));
      else localStorage.removeItem(`${STORAGE_PREFIX}project_start`);
    } catch {
      // Ignore storage failures; the in-memory value still applies.
    }
  };

  const openKnowledgeForEquipment = (equipmentTypeOrId: string) => {
    let key = equipmentTypeOrId.toLowerCase().replace(/\s+/g, '-');
    if (key.includes('gpon')) key = 'gpon-olt';
    else if (key.includes('epon')) key = 'epon-olt';
    else if (key.includes('olt')) key = 'olt';
    else if (key.includes('odf')) key = 'odf';
    else if (key.includes('fdms') || key.includes('distribution-cabinet')) key = 'fdms';
    else if (key.includes('fat') || key.includes('terminal-box')) key = 'fat';
    else if (key.includes('splitter')) key = 'splitter';
    else if (key.includes('closure') || key.includes('joint')) key = 'joint-closure';
    else if (key.includes('pole')) key = 'telecom-pole';
    else if (key.includes('ont') || key.includes('onu')) key = 'ont';
    else if (key.includes('receiver') || key.includes('node') || key.includes('catv')) key = 'optical-receiver';
    setSelectedKnowledgeId(key);
    setIsKnowledgeModalOpen(true);
  };

  // Map flying
  const [mapFlyToTarget, setMapFlyToTarget] = useState<{ lat: number; lng: number; zoom?: number } | null>(null);
  const flyToLocation = (lat: number, lng: number, zoom = 17) => {
    setMapFlyToTarget({ lat, lng, zoom });
  };

  // Toast notifications
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };
  const showToast = (type: ToastItem['type'], title: string, message: string) => {
    const id = uniqueId('TOAST');
    setToasts((prev) => [...prev, { id, type, title, message }]);
    setTimeout(() => {
      removeToast(id);
    }, 5500);
  };

  const logAudit = (action: string, details: string, assetId: string, assetType: AuditLog['assetType']) => {
    const entry: AuditLog = {
      id: uniqueId('LOG'),
      timestamp: new Date().toLocaleString(),
      user: `${userRole} (local session)`,
      role: userRole,
      action,
      details,
      assetId,
      assetType,
    };
    setAuditLogs((prev) => [entry, ...prev].slice(0, MAX_AUDIT_LOGS));
  };

  /** Returns a [lat, lng] for any selectable object (cables use their first vertex). */
  const getObjectLocation = (obj: { type: SelectedObjectType; data: any } | null): BikerWaypoint | null => {
    if (!obj?.data) return null;
    const { data } = obj;
    if (typeof data.lat === 'number' && typeof data.lng === 'number') {
      return { id: data.id, name: data.name || data.title || data.id, lat: data.lat, lng: data.lng };
    }
    if (Array.isArray(data.coordinates) && isLatLngPair(data.coordinates[0])) {
      const [lat, lng] = data.coordinates[0];
      return { id: data.id, name: data.name || data.id, lat, lng };
    }
    if (data.affectedLocation && typeof data.affectedLocation.lat === 'number') {
      return {
        id: data.id,
        name: data.title || data.id,
        lat: data.affectedLocation.lat,
        lng: data.affectedLocation.lng,
      };
    }
    return null;
  };

  const getDefaultOrigin = (): BikerWaypoint | null => {
    const hub = equipments.find((e) => e.type === 'OLT') || equipments[0];
    if (hub) return { id: hub.id, name: hub.name, lat: hub.lat, lng: hub.lng };
    if (projectStartPoint)
      return { id: 'PROJECT-START', name: 'Project start point', lat: projectStartPoint[0], lng: projectStartPoint[1] };
    return null;
  };

  // Undo/Redo: snapshots of the physical network, recorded automatically after every change.
  const [history, setHistory] = useState<{ stack: HistorySnapshot[]; index: number }>(() => ({
    stack: [{ equipments, cables, splitters, customers, closures }],
    index: 0,
  }));

  useEffect(() => {
    setHistory((prev) => {
      const current = prev.stack[prev.index];
      if (
        current &&
        current.equipments === equipments &&
        current.cables === cables &&
        current.splitters === splitters &&
        current.customers === customers &&
        current.closures === closures
      ) {
        return prev;
      }
      const stack = [
        ...prev.stack.slice(0, prev.index + 1),
        { equipments, cables, splitters, customers, closures },
      ].slice(-MAX_HISTORY);
      return { stack, index: stack.length - 1 };
    });
  }, [equipments, cables, splitters, customers, closures]);

  const applySnapshot = (snapshot: HistorySnapshot) => {
    setEquipments(snapshot.equipments);
    setCables(snapshot.cables);
    setSplitters(snapshot.splitters);
    setCustomers(snapshot.customers);
    setClosures(snapshot.closures);
    setSelectedObject((prev) => {
      if (!prev) return prev;
      const source: Record<string, Array<{ id: string }>> = {
        equipment: snapshot.equipments,
        cable: snapshot.cables,
        customer: snapshot.customers,
        closure: snapshot.closures,
      };
      const list = source[prev.type];
      if (!list) return prev;
      const match = list.find((item) => item.id === prev.data?.id);
      return match ? { type: prev.type, data: match } : null;
    });
    clearTrace();
  };

  const undo = () => {
    if (history.index <= 0) return;
    const nextIndex = history.index - 1;
    applySnapshot(history.stack[nextIndex]);
    setHistory((prev) => ({ ...prev, index: nextIndex }));
    showToast('info', 'Undo Successful', 'Reverted the last network change');
  };

  const redo = () => {
    if (history.index >= history.stack.length - 1) return;
    const nextIndex = history.index + 1;
    applySnapshot(history.stack[nextIndex]);
    setHistory((prev) => ({ ...prev, index: nextIndex }));
    showToast('info', 'Redo Successful', 'Reapplied the network change');
  };

  const canUndo = history.index > 0;
  const canRedo = history.index < history.stack.length - 1;

  // Network mutations are thin adapters over the pure domain commands in @fibergis/shared.
  // `latestData` lets several commands issued in one event handler see each other's changes.
  const latestData = useRef<NetworkData>({
    equipment: equipments,
    cables,
    splitters,
    closures,
    customers,
    faults,
    workOrders,
    zones,
    documents,
  });
  useLayoutEffect(() => {
    latestData.current = {
      equipment: equipments,
      cables,
      splitters,
      closures,
      customers,
      faults,
      workOrders,
      zones,
      documents,
    };
  }, [equipments, cables, splitters, closures, customers, faults, workOrders, zones, documents]);

  const commandContext = (): CommandContext => ({
    actor: `${userRole} User`,
    fallbackLocation: projectStartPoint ?? undefined,
  });

  const applyNetworkPatch = (patch: NetworkPatch) => {
    const before = latestData.current;
    latestData.current = applyPatch(before, patch);
    if (patch.equipment) setEquipments(patch.equipment);
    if (patch.cables) setCables(patch.cables);
    if (patch.splitters) setSplitters(patch.splitters);
    if (patch.closures) setClosures(patch.closures);
    if (patch.customers) setCustomers(patch.customers);
    if (patch.faults) setFaults(patch.faults);
    if (patch.workOrders) setWorkOrders(patch.workOrders);
    if (patch.zones) setZones(patch.zones);
    if (patch.documents) setDocuments(patch.documents);

    // Keep the inspector pointed at the latest version of the selected record, or clear it once deleted.
    setSelectedObject((prev) => {
      if (!prev?.data) return prev;
      const key = SELECTION_COLLECTION[prev.type];
      const next = patch[key] as Array<{ id: string }> | undefined;
      if (!next) return prev;
      const match = next.find((item) => item.id === prev.data.id);
      if (match) return match === prev.data ? prev : { type: prev.type, data: match };
      const existed = (before[key] as Array<{ id: string }>).some((item) => item.id === prev.data.id);
      return existed ? null : prev;
    });
  };

  /**
   * Runs a domain command against the latest network: failures surface as a toast, confirmations go
   * through the browser dialog, and successes patch state, notify the user, and extend the audit trail.
   */
  const runCommand = <T,>(
    command: (data: NetworkData, ctx: CommandContext) => CommandResult<T>,
    options: CommandOptions = {},
  ): CommandSuccess<T> | null => {
    const result = command(latestData.current, commandContext());
    if (!result.ok) {
      showToast(result.error.tone, result.error.title, result.error.message);
      return null;
    }
    if (result.confirm && !options.skipConfirm && !window.confirm(result.confirm)) return null;
    applyNetworkPatch(result.patch);
    if (!options.silent) {
      if (result.notice) showToast(result.notice.tone, result.notice.title, result.notice.message);
      result.audit.forEach((entry) => logAudit(entry.action, entry.details, entry.assetId, entry.assetType));
    }
    return result;
  };

  const addEquipment = (item: domain.EquipmentDraft): Equipment | null =>
    runCommand((data, ctx) => domain.createEquipment(data, item, ctx))?.value ?? null;

  const updateEquipment = (item: Equipment, options?: { silent?: boolean }) => {
    runCommand((data) => domain.updateEquipment(data, item), options);
  };

  const updateEquipmentPort = (equipmentId: string, portId: string, changes: Partial<EquipmentPort>) => {
    runCommand((data) => domain.updateEquipmentPort(data, equipmentId, portId, changes));
  };

  const addCustomComponent = (item: CatalogComponent) => {
    setCustomComponents((prev) => [...prev, item]);
    showToast('success', 'Component Type Added', `${item.name} is now in the catalog.`);
  };

  const addSplice = (closureId: string, splice: SpliceRecord): boolean =>
    runCommand((data) => domain.addSplice(data, closureId, splice)) !== null;

  const removeSplice = (closureId: string, spliceId: string) => {
    runCommand((data) => domain.removeSplice(data, closureId, spliceId));
  };

  const saveDraft = () => {
    setPublishState('draft');
    showToast(
      'info',
      'Draft Saved',
      'Changes are stored locally as a prototype draft. This is not a production database.',
    );
  };

  const publishNetwork = () => {
    setPublishState('published');
    localStorage.setItem('fiber_gis_published_at', new Date().toISOString());
    showToast(
      'success',
      'Published (prototype)',
      'A local published snapshot was stored. No live GIS or hardware sync is connected.',
    );
  };

  const decodePolyline = async (origin: BikerWaypoint, dests: BikerWaypoint[]) => {
    // Robust fallback road route generator (always produces realistic road grid path)
    const generateFallbackRoadRoute = () => {
      const allWaypoints = [origin, ...dests];
      const coords: [number, number][] = [];
      const steps: string[] = [`Depart from origin: ${origin.name || origin.id}`];
      let totalMeters = 0;

      for (let i = 0; i < allWaypoints.length - 1; i++) {
        const from = allWaypoints[i];
        const to = allWaypoints[i + 1];

        // Simulate road network Manhattan corner / utility avenue
        const midLat = (from.lat + to.lat) / 2;
        const cornerLat = from.lat;
        const cornerLng = to.lng;

        coords.push([from.lat, from.lng]);
        coords.push([from.lat, (from.lng + cornerLng) / 2]);
        coords.push([cornerLat, cornerLng]);
        coords.push([midLat, to.lng]);
        coords.push([to.lat, to.lng]);

        // Geodesic distance approximation with road curvature factor 1.28
        const dLat = (to.lat - from.lat) * 111320;
        const dLng = (to.lng - from.lng) * 111320 * Math.cos((from.lat * Math.PI) / 180);
        const segDist = Math.sqrt(dLat * dLat + dLng * dLng) * 1.28;
        totalMeters += segDist;

        steps.push(`Head along Main Utility Blvd (${Math.round(segDist * 0.45)} m)`);
        steps.push(`Turn at Telecom Intersection toward ${to.name || to.id} (${Math.round(segDist * 0.55)} m)`);
        steps.push(`Arrive at network destination: ${to.name || to.id}`);
      }

      const motorcycleSpeedMps = (30 * 1000) / 3600; // ~30 km/h city riding
      const durationSeconds = Math.max(60, Math.round(totalMeters / motorcycleSpeedMps));

      setBikerRoute({
        coordinates: coords,
        distanceMeters: Math.round(totalMeters),
        durationSeconds,
        steps,
        profile: 'driving',
        limitation: 'Road-aligned navigation path (distinct from underground/aerial fiber lines)',
      });
      showToast(
        'info',
        'Biker Road Route Ready',
        `Navigating to ${dests[dests.length - 1]?.name || dests[dests.length - 1]?.id} · ${(totalMeters / 1000).toFixed(2)} km · ~${Math.ceil(durationSeconds / 60)} min`,
      );
    };

    const points = [origin, ...dests];
    const coordStr = points.map((p) => `${p.lng},${p.lat}`).join(';');
    const url =
      dests.length > 1
        ? `https://router.project-osrm.org/trip/v1/driving/${coordStr}?overview=full&geometries=geojson&steps=true&source=first&roundtrip=false`
        : `https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=full&geometries=geojson&steps=true`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) throw new Error('Network error');
      const json = await res.json();
      const path = json.routes?.[0] || json.trips?.[0];
      if (!path || !path.geometry?.coordinates?.length) {
        generateFallbackRoadRoute();
        return;
      }
      const coords: [number, number][] = path.geometry.coordinates.map((c: number[]) => [c[1], c[0]]);
      const steps: string[] = [];
      (path.legs || []).forEach((leg: any) => {
        (leg.steps || []).forEach((s: any) => {
          if (s.maneuver?.instruction) steps.push(s.maneuver.instruction);
          else if (s.name) steps.push(`Continue on ${s.name}`);
        });
      });
      setBikerRoute({
        coordinates: coords,
        distanceMeters: path.distance,
        durationSeconds: path.duration,
        steps,
        profile: 'driving',
        limitation: 'OSRM driving profile; not a verified motorcycle route',
      });
      showToast(
        'info',
        'Road route ready',
        'Orange dashed line is road navigation. Blue/teal lines remain fiber cables.',
      );
    } catch {
      generateFallbackRoadRoute();
    }
  };

  /** Route origin: the selected object (when it is not the destination), else the first OLT. */
  const resolveRouteOrigin = (destinationId: string): BikerWaypoint => {
    const selected = getObjectLocation(selectedObject);
    if (selected && selected.id !== destinationId) return selected;
    const fallback = getDefaultOrigin();
    if (fallback && fallback.id !== destinationId) return fallback;
    return selected || fallback || { id: destinationId, name: destinationId, lat: 0, lng: 0 };
  };

  const addBikerWaypoint = (asset: BikerWaypoint) => {
    const next = bikerWaypoints.some((p) => p.id === asset.id) ? bikerWaypoints : [...bikerWaypoints, asset];
    setBikerWaypoints(next);
    decodePolyline(resolveRouteOrigin(next[0]?.id ?? asset.id), next);
  };

  const navigateToAsset = (asset: BikerWaypoint) => {
    setBikerWaypoints([asset]);
    decodePolyline(resolveRouteOrigin(asset.id), [asset]);
    flyToLocation(asset.lat, asset.lng, 16);
  };

  const clearBikerRoute = () => {
    setBikerWaypoints([]);
    setBikerRoute(null);
  };

  const deleteEquipment = (id: string, options?: { skipConfirm?: boolean }): boolean => {
    if (!runCommand((data) => domain.deleteEquipment(data, id), options)) return false;
    if (activeTraceEquipmentIds.includes(id)) clearTrace();
    return true;
  };

  const addCable = (item: domain.CableDraft): Cable | null =>
    runCommand((data, ctx) => domain.createCable(data, item, ctx))?.value ?? null;

  const updateCable = (item: Cable, options?: { silent?: boolean }) => {
    runCommand((data) => domain.updateCable(data, item), options);
  };

  const deleteCable = (id: string, options?: { skipConfirm?: boolean }): boolean => {
    if (!runCommand((data) => domain.deleteCable(data, id), options)) return false;
    if (activeTraceCableIds.includes(id)) clearTrace();
    return true;
  };

  const allocateFiberCore = (
    cableId: string,
    coreNumber: number,
    customerId?: string,
    equipmentId?: string,
    portName?: string,
  ): boolean =>
    runCommand((data, ctx) =>
      domain.allocateCore(data, { cableId, coreNumber, customerId, equipmentId, portName }, ctx),
    ) !== null;

  const connectCustomerToPort = (customerData: domain.CustomerDraft): Customer | null =>
    runCommand((data, ctx) => domain.provisionCustomer(data, customerData, ctx))?.value.customer ?? null;

  const uploadEquipmentPhoto = (equipmentId: string, photo: Partial<EquipmentImage>) => {
    runCommand((data, ctx) => domain.addEquipmentPhoto(data, equipmentId, photo, ctx));
  };

  // Annotations are stored beside the photo; the original image is never modified.
  const saveImageAnnotation = (equipmentId: string, imageId: string, annotation: ImageAnnotation) => {
    runCommand((data) => domain.saveImageAnnotation(data, equipmentId, imageId, annotation));
  };

  const deleteImageAnnotation = (equipmentId: string, imageId: string, annotationId: string) => {
    runCommand((data) => domain.deleteImageAnnotation(data, equipmentId, imageId, annotationId));
  };

  // Fiber trace (computed from the physical topology)
  const traceNetworkPath = (targetId: string): boolean => {
    const result = domain.resolveTraceTarget(targetId, latestData.current);
    if (!result || result.nodes.length === 0) {
      showToast('warning', 'Trace Not Available', `No traceable network path was found for "${targetId}".`);
      return false;
    }

    setActiveTracePath(result.nodes);
    setActiveTraceCableIds(result.cableIds);
    setActiveTraceEquipmentIds(result.equipmentIds);
    setActiveTraceSummary(result.summary);
    setIsRouteTraceModalOpen(true);

    const { summary } = result;
    const budget =
      summary.estimatedRxDbm !== undefined ? ` · est. Rx ${summary.estimatedRxDbm} dBm (${summary.budgetStatus})` : '';
    showToast(
      summary.budgetStatus === 'Fail' || summary.warnings.length > 0 ? 'warning' : 'info',
      'Fiber Trace Active',
      `${summary.targetLabel}: ${result.nodes.length} hops · ${(summary.totalLengthMeters / 1000).toFixed(2)} km${budget}`,
    );
    return true;
  };

  const clearTrace = () => {
    setActiveTracePath(null);
    setActiveTraceCableIds([]);
    setActiveTraceEquipmentIds([]);
    setActiveTraceSummary(null);
  };

  // Faults & work orders
  const recordNewFault = (faultData: domain.FaultDraft): Fault | null =>
    runCommand((data, ctx) => domain.reportFault(data, faultData, ctx))?.value ?? null;

  const resolveExistingFault = (faultId: string) => {
    runCommand((data, ctx) => domain.resolveFault(data, faultId, ctx));
  };

  const addWorkOrder = (order: domain.WorkOrderDraft): WorkOrder | null =>
    runCommand((data, ctx) => domain.createWorkOrder(data, order, ctx))?.value ?? null;

  const updateWorkOrderStatus = (workOrderId: string, status: WorkOrder['status']) => {
    runCommand((data, ctx) => domain.setWorkOrderStatus(data, workOrderId, status, ctx));
  };

  // Zones & documents
  const addZone = (zone: domain.ZoneDraft): NetworkZone | null =>
    runCommand((data, ctx) => domain.createZone(data, zone, ctx))?.value ?? null;

  const updateZone = (zone: NetworkZone) => {
    runCommand((data) => domain.updateZone(data, zone));
  };

  const deleteZone = (id: string) => {
    runCommand((data) => domain.deleteZone(data, id));
  };

  const addDocument = (doc: domain.DocumentDraft): NetworkDocument | null =>
    runCommand((data, ctx) => domain.createDocument(data, doc, ctx))?.value ?? null;

  const deleteDocument = (id: string) => {
    runCommand((data) => domain.deleteDocument(data, id));
  };

  const downloadBlob = (content: string, mime: string, filename: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // Backup & Restore
  const backupSystem = () => {
    const backupData = {
      version: '3.0.0',
      dataVersion: DATA_VERSION,
      timestamp: new Date().toISOString(),
      projectStartPoint,
      equipments,
      cables,
      splitters,
      closures,
      customers,
      faults,
      workOrders,
      zones,
      documents,
      auditLogs,
      customComponents,
    };
    downloadBlob(JSON.stringify(backupData, null, 2), 'application/json', `fiber_gis_backup_${isoDate()}.json`);
    showToast('success', 'Backup Exported', 'Full network database downloaded as JSON.');
    logAudit(
      'BACKUP_EXPORTED',
      `Exported backup (${equipments.length} equipment, ${cables.length} cables, ${customers.length} customers)`,
      'SYSTEM',
      'System',
    );
  };

  const resetTransientState = () => {
    setSelectedObject(null);
    clearTrace();
    setActiveDrawingPoints([]);
    setMeasuringPoints([]);
    setHistory({ stack: [], index: -1 });
  };

  const restoreSystem = (jsonString: string): boolean => {
    let data: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(jsonString);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
      data = parsed as Record<string, unknown>;
    } catch {
      showToast('error', 'Restore Failed', 'The selected file is not valid JSON.');
      return false;
    }

    const restored: string[] = [];
    const apply = <T,>(key: string, setter: (value: T[]) => void) => {
      const value = data[key];
      if (isRecordArray(value)) {
        setter(value as T[]);
        restored.push(key);
      }
    };
    apply<Equipment>('equipments', setEquipments);
    apply<Cable>('cables', setCables);
    apply<Splitter>('splitters', setSplitters);
    apply<JointClosure>('closures', setClosures);
    apply<Customer>('customers', setCustomers);
    apply<Fault>('faults', setFaults);
    apply<WorkOrder>('workOrders', setWorkOrders);
    apply<NetworkZone>('zones', setZones);
    apply<NetworkDocument>('documents', setDocuments);
    apply<AuditLog>('auditLogs', setAuditLogs);
    apply<CatalogComponent>('customComponents', setCustomComponents);
    if (isLatLngPair(data.projectStartPoint)) setProjectStartPoint(data.projectStartPoint);

    if (restored.length === 0) {
      showToast('error', 'Restore Failed', 'The file does not contain any FiberGIS network data.');
      return false;
    }

    resetTransientState();
    showToast('success', 'System Restored', `Restored ${restored.length} dataset(s): ${restored.join(', ')}`);
    logAudit('BACKUP_RESTORED', `Restored datasets: ${restored.join(', ')}`, 'SYSTEM', 'System');
    return true;
  };

  const resetToSampleData = () => {
    if (!window.confirm('Reset the entire network to the bundled sample dataset? All local changes will be lost.'))
      return;
    setEquipments(SAMPLE_EQUIPMENT);
    setCables(SAMPLE_CABLES);
    setSplitters(SAMPLE_SPLITTERS);
    setClosures(SAMPLE_JOINT_CLOSURES);
    setCustomers(SAMPLE_CUSTOMERS);
    setFaults(SAMPLE_FAULTS);
    setWorkOrders(SAMPLE_WORK_ORDERS);
    setZones(SAMPLE_ZONES);
    setDocuments(SAMPLE_DOCUMENTS);
    setAuditLogs(SAMPLE_AUDIT_LOGS);
    resetTransientState();
    showToast('info', 'Sample Data Restored', 'The network has been reset to the bundled sample dataset.');
  };

  // Google Earth KML Export
  const exportKML = () => {
    const x = escapeXml;
    let kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Fiber_GIS_Network_Export</name>
    <description>Exported from Complete Fiber Optic GIS Mapping Platform</description>
    <Folder>
      <name>Equipment</name>`;

    equipments.forEach((eq) => {
      kml += `
      <Placemark>
        <name>${x(eq.name)} (${x(eq.id)})</name>
        <description>Type: ${x(eq.type)} | Area: ${x(eq.area)} | Status: ${x(eq.status)}</description>
        <Point>
          <coordinates>${eq.lng},${eq.lat},0</coordinates>
        </Point>
      </Placemark>`;
    });

    kml += `
    </Folder>
    <Folder>
      <name>Cables</name>`;

    cables.forEach((cb) => {
      if (cb.coordinates.length < 2) return;
      const coordsStr = cb.coordinates.map((pt) => `${pt[1]},${pt[0]},0`).join(' ');
      kml += `
      <Placemark>
        <name>${x(cb.name)} (${x(cb.id)})</name>
        <description>Type: ${x(cb.type)} | Length: ${cb.lengthMeters}m | Cores: ${cb.fiberCount} | Status: ${x(cb.status)}</description>
        <LineString>
          <tessellate>1</tessellate>
          <coordinates>${coordsStr}</coordinates>
        </LineString>
      </Placemark>`;
    });

    kml += `
    </Folder>
    <Folder>
      <name>Customers</name>`;

    customers.forEach((c) => {
      kml += `
      <Placemark>
        <name>${x(c.name)} (${x(c.id)})</name>
        <description>Plan: ${x(c.plan)} | Status: ${x(c.status)} | FAT: ${x(c.terminalBoxId)} port ${c.splitterOutputPort}</description>
        <Point>
          <coordinates>${c.lng},${c.lat},0</coordinates>
        </Point>
      </Placemark>`;
    });

    kml += `
    </Folder>
  </Document>
</kml>`;

    downloadBlob(kml, 'application/vnd.google-earth.kml+xml', `fiber_gis_network_${isoDate()}.kml`);
    showToast(
      'success',
      'KML Export Complete',
      `Exported ${equipments.length} equipment, ${cables.length} cables and ${customers.length} customers.`,
    );
  };

  return (
    <NetworkContext.Provider
      value={{
        activeMainView,
        setActiveMainView,
        equipments,
        cables,
        splitters,
        closures,
        customers,
        faults,
        workOrders,
        auditLogs,
        zones,
        documents,
        selectedObject,
        setSelectedObject,
        activeTool,
        setActiveTool,
        selectedEquipmentTypeToAdd,
        setSelectedEquipmentTypeToAdd,
        selectedCableTypeToDraw,
        setSelectedCableTypeToDraw,
        activeDrawingPoints,
        setActiveDrawingPoints,
        measuringPoints,
        setMeasuringPoints,
        activeTracePath,
        activeTraceCableIds,
        activeTraceEquipmentIds,
        activeTraceSummary,
        traceNetworkPath,
        clearTrace,
        activeLayers,
        toggleLayer,
        layerOpacity,
        setLayerOpacity,
        isLayersDrawerOpen,
        setIsLayersDrawerOpen,
        mapTileProvider,
        setMapTileProvider,
        userRole,
        setUserRole,
        networkMode,
        setNetworkMode,
        isLeftPanelOpen,
        setIsLeftPanelOpen,
        isRightPanelOpen,
        setIsRightPanelOpen,
        isBottomPanelOpen,
        setIsBottomPanelOpen,
        isSidebarCollapsed,
        setIsSidebarCollapsed,
        isCableWizardOpen,
        setIsCableWizardOpen,
        isCustomerWizardOpen,
        setIsCustomerWizardOpen,
        isEquipmentModalOpen,
        setIsEquipmentModalOpen,
        isTerminalBoxModalOpen,
        setIsTerminalBoxModalOpen,
        isSplitterModalOpen,
        setIsSplitterModalOpen,
        isSplicingModalOpen,
        setIsSplicingModalOpen,
        isRouteTraceModalOpen,
        setIsRouteTraceModalOpen,
        isFaultModalOpen,
        setIsFaultModalOpen,
        isTechnicianMobileOpen,
        setIsTechnicianMobileOpen,
        isCapacityDashboardOpen,
        setIsCapacityDashboardOpen,
        isReportsModalOpen,
        setIsReportsModalOpen,
        isHelpModalOpen,
        setIsHelpModalOpen,
        isDocumentModalOpen,
        setIsDocumentModalOpen,
        isComponentCatalogOpen,
        setIsComponentCatalogOpen,
        isPortManagerOpen,
        setIsPortManagerOpen,
        isKnowledgeModalOpen,
        setIsKnowledgeModalOpen,
        selectedKnowledgeId,
        setSelectedKnowledgeId,
        openKnowledgeForEquipment,
        projectStartPoint,
        setProjectStartPoint,
        customComponents,
        addCustomComponent,
        updateEquipmentPort,
        addSplice,
        removeSplice,
        publishState,
        saveDraft,
        publishNetwork,
        uiMode,
        setUiMode,
        isBikerMode,
        setIsBikerMode,
        bikerWaypoints,
        bikerRoute,
        addBikerWaypoint,
        navigateToAsset,
        clearBikerRoute,
        addEquipment,
        updateEquipment,
        deleteEquipment,
        addCable,
        updateCable,
        deleteCable,
        allocateFiberCore,
        connectCustomerToPort,
        uploadEquipmentPhoto,
        saveImageAnnotation,
        deleteImageAnnotation,
        recordNewFault,
        resolveExistingFault,
        addWorkOrder,
        updateWorkOrderStatus,
        logAudit,
        resetToSampleData,
        addZone,
        updateZone,
        deleteZone,
        addDocument,
        deleteDocument,
        backupSystem,
        restoreSystem,
        exportKML,
        mapFlyToTarget,
        flyToLocation,
        toasts,
        showToast,
        removeToast,
        undo,
        redo,
        canUndo,
        canRedo,
      }}
    >
      {children}
    </NetworkContext.Provider>
  );
};

export const useNetwork = () => {
  const context = useContext(NetworkContext);
  if (!context) {
    throw new Error('useNetwork must be used within a NetworkProvider');
  }
  return context;
};
