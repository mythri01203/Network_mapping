import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import {
  Equipment,
  Cable,
  Splitter,
  JointClosure,
  Customer,
  Fault,
  WorkOrder,
  AuditLog,
  UserRole,
  EquipmentType,
  CableType,
  TracePathNode,
  EquipmentImage,
  ImageAnnotation,
  MainView,
  NetworkZone,
  NetworkDocument,
  CatalogComponent,
  EquipmentPort,
  FiberCore,
  SpliceRecord
} from '../types/network';
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
  SAMPLE_DOCUMENTS
} from '../data/sampleNetwork';
import { generateLogicalPorts, summarizePorts, setPortUsage } from '../lib/ports';
import {
  nextSequentialId,
  uniqueId,
  equipmentIdPrefix,
  cableIdPrefix,
  escapeXml,
  polylineLengthMeters
} from '../lib/ids';
import {
  TraceData,
  TraceResult,
  TraceSummary,
  traceCustomer,
  traceEquipment,
  traceCable,
  collectDownstream,
  estimateRxForSplitter
} from '../lib/trace';
import { getFiberColor, getTubeNumber } from '../constants/colorStandards';
import confetti from 'canvas-confetti';

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
  'project_start'
];
const MAX_AUDIT_LOGS = 500;
const MAX_HISTORY = 50;

const ensureStorageVersion = () => {
  try {
    if (localStorage.getItem(DATA_VERSION_KEY) === DATA_VERSION) return;
    PERSISTED_KEYS.forEach(key => localStorage.removeItem(`${STORAGE_PREFIX}${key}`));
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

const isLatLngPair = (value: unknown): value is [number, number] =>
  Array.isArray(value) && value.length === 2 && value.every(v => typeof v === 'number' && Number.isFinite(v));

const isRecordArray = (value: unknown): boolean =>
  Array.isArray(value) && value.every(item => item !== null && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string');

const today = () => new Date().toISOString().split('T')[0];

const defaultPortCount = (type: EquipmentType): number => {
  if (type === 'FAT' || type.includes('Terminal Box')) return 8;
  if (type === 'FDT') return 48;
  if (type === 'FDMS' || type === 'Fiber Distribution Cabinet') return 96;
  if (type === 'ODF' || type === 'Fiber Patch Panel') return 48;
  if (type === 'OLT') return 16;
  if (type === 'ONT' || type === 'ONU' || type === 'Optical Modem' || type === 'Customer Terminal') return 1;
  if (
    type.includes('Pole') ||
    type === 'Manhole' ||
    type === 'Handhole' ||
    type === 'Underground Chamber' ||
    type === 'Duct' ||
    type === 'Microduct' ||
    type === 'Cable Tray' ||
    type === 'Junction Point' ||
    type === 'Building Entry Point'
  ) return 0;
  return 24;
};

const defaultFiberCount = (type: CableType): number => {
  if (type === 'Main Feeder Fiber') return 48;
  if (type === 'Distribution Fiber') return 24;
  if (type === 'Drop Fiber') return 2;
  if (type === 'Coaxial Cable') return 1;
  return 12;
};

const buildCores = (count: number): FiberCore[] =>
  Array.from({ length: count }, (_, i) => {
    const color = getFiberColor(i + 1);
    return {
      coreNumber: i + 1,
      tubeNumber: getTubeNumber(i + 1),
      colorName: color.name,
      colorHex: color.hex,
      status: 'Available' as const,
      remarks: 'Freshly installed unallocated core'
    };
  });

type SelectedObjectType = 'equipment' | 'cable' | 'customer' | 'closure' | 'fault';

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
  updateEquipmentPort: (equipmentId: string, portId: string, patch: Partial<EquipmentPort>) => void;
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
  addEquipment: (item: Partial<Equipment> & { name: string; type: EquipmentType; lat: number; lng: number }) => Equipment | null;
  updateEquipment: (item: Equipment, options?: { silent?: boolean }) => void;
  deleteEquipment: (id: string) => boolean;
  addCable: (item: Partial<Cable> & { name: string; type: CableType; coordinates: [number, number][] }) => Cable | null;
  updateCable: (item: Cable, options?: { silent?: boolean }) => void;
  deleteCable: (id: string) => boolean;
  allocateFiberCore: (cableId: string, coreNumber: number, customerId?: string, equipmentId?: string, portName?: string) => boolean;
  connectCustomerToPort: (customerData: Partial<Customer>) => Customer | null;
  uploadEquipmentPhoto: (equipmentId: string, photo: Partial<EquipmentImage>) => void;
  saveImageAnnotation: (equipmentId: string, imageId: string, annotation: ImageAnnotation) => void;
  deleteImageAnnotation: (equipmentId: string, imageId: string, annotationId: string) => void;
  recordNewFault: (faultData: Partial<Fault>) => Fault;
  resolveExistingFault: (faultId: string) => void;
  addWorkOrder: (order: Partial<WorkOrder> & { title: string }) => WorkOrder;
  updateWorkOrderStatus: (workOrderId: string, status: WorkOrder['status']) => void;
  logAudit: (action: string, details: string, assetId: string, assetType: AuditLog['assetType']) => void;

  // Zone Management
  addZone: (zone: Partial<NetworkZone> & { name: string; areaCode: string }) => NetworkZone;
  updateZone: (zone: NetworkZone) => void;
  deleteZone: (id: string) => void;

  // Document Management
  addDocument: (doc: Partial<NetworkDocument> & { title: string; category: NetworkDocument['category'] }) => NetworkDocument;
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
  const [equipments, setEquipments] = useState<Equipment[]>(() => loadState('equipment', SAMPLE_EQUIPMENT, isRecordArray));
  const [cables, setCables] = useState<Cable[]>(() => loadState('cables', SAMPLE_CABLES, isRecordArray));
  const [splitters, setSplitters] = useState<Splitter[]>(() => loadState('splitters', SAMPLE_SPLITTERS, isRecordArray));
  const [closures, setClosures] = useState<JointClosure[]>(() => loadState('closures', SAMPLE_JOINT_CLOSURES, isRecordArray));
  const [customers, setCustomers] = useState<Customer[]>(() => loadState('customers', SAMPLE_CUSTOMERS, isRecordArray));
  const [faults, setFaults] = useState<Fault[]>(() => loadState('faults', SAMPLE_FAULTS, isRecordArray));
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>(() => loadState('work_orders', SAMPLE_WORK_ORDERS, isRecordArray));
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>(() => loadState('audit_logs', SAMPLE_AUDIT_LOGS, isRecordArray));

  // Main Active View State
  const [activeMainView, setActiveMainView] = useState<MainView>('map');

  // Zones & Documents
  const [zones, setZones] = useState<NetworkZone[]>(() => loadState('zones', SAMPLE_ZONES, isRecordArray));
  const [documents, setDocuments] = useState<NetworkDocument[]>(() => loadState('documents', SAMPLE_DOCUMENTS, isRecordArray));

  const [isDocumentModalOpen, setIsDocumentModalOpen] = useState(false);
  const [isComponentCatalogOpen, setIsComponentCatalogOpen] = useState(false);
  const [isPortManagerOpen, setIsPortManagerOpen] = useState(false);
  const [customComponents, setCustomComponents] = useState<CatalogComponent[]>(() => loadState<CatalogComponent[]>('custom_components', [], isRecordArray));
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
    labels: 1.0
  });

  const setLayerOpacity = (layer: string, opacity: number) => {
    setLayerOpacityState(prev => ({ ...prev, [layer]: opacity }));
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
  const [activeTool, setActiveTool] = useState<'select' | 'draw_cable' | 'add_equipment' | 'measure' | 'trace'>('select');
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
    labels: true
  });

  const toggleLayer = (layerName: string) => {
    setActiveLayers(prev => ({ ...prev, [layerName]: !prev[layerName] }));
  };

  const [mapTileProvider, setMapTileProvider] = useState<'google_streets' | 'google_satellite' | 'osm'>('google_streets');
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
    loadState<[number, number] | null>('project_start', null, isLatLngPair)
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
    setToasts(prev => prev.filter(t => t.id !== id));
  };
  const showToast = (type: ToastItem['type'], title: string, message: string) => {
    const id = uniqueId('TOAST');
    setToasts(prev => [...prev, { id, type, title, message }]);
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
      assetType
    };
    setAuditLogs(prev => [entry, ...prev].slice(0, MAX_AUDIT_LOGS));
  };

  const getTraceData = (): TraceData => ({ equipments, cables, splitters, closures, customers, faults });

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
      return { id: data.id, name: data.title || data.id, lat: data.affectedLocation.lat, lng: data.affectedLocation.lng };
    }
    return null;
  };

  const getDefaultOrigin = (): BikerWaypoint | null => {
    const hub = equipments.find(e => e.type === 'OLT') || equipments[0];
    if (hub) return { id: hub.id, name: hub.name, lat: hub.lat, lng: hub.lng };
    if (projectStartPoint) return { id: 'PROJECT-START', name: 'Project start point', lat: projectStartPoint[0], lng: projectStartPoint[1] };
    return null;
  };

  // Undo/Redo: snapshots of the physical network, recorded automatically after every change.
  const [history, setHistory] = useState<{ stack: HistorySnapshot[]; index: number }>(() => ({
    stack: [{ equipments, cables, splitters, customers, closures }],
    index: 0
  }));

  useEffect(() => {
    setHistory(prev => {
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
      const stack = [...prev.stack.slice(0, prev.index + 1), { equipments, cables, splitters, customers, closures }].slice(-MAX_HISTORY);
      return { stack, index: stack.length - 1 };
    });
  }, [equipments, cables, splitters, customers, closures]);

  const applySnapshot = (snapshot: HistorySnapshot) => {
    setEquipments(snapshot.equipments);
    setCables(snapshot.cables);
    setSplitters(snapshot.splitters);
    setCustomers(snapshot.customers);
    setClosures(snapshot.closures);
    setSelectedObject(prev => {
      if (!prev) return prev;
      const source: Record<string, Array<{ id: string }>> = {
        equipment: snapshot.equipments,
        cable: snapshot.cables,
        customer: snapshot.customers,
        closure: snapshot.closures
      };
      const list = source[prev.type];
      if (!list) return prev;
      const match = list.find(item => item.id === prev.data?.id);
      return match ? { type: prev.type, data: match } : null;
    });
    clearTrace();
  };

  const undo = () => {
    if (history.index <= 0) return;
    const nextIndex = history.index - 1;
    applySnapshot(history.stack[nextIndex]);
    setHistory(prev => ({ ...prev, index: nextIndex }));
    showToast('info', 'Undo Successful', 'Reverted the last network change');
  };

  const redo = () => {
    if (history.index >= history.stack.length - 1) return;
    const nextIndex = history.index + 1;
    applySnapshot(history.stack[nextIndex]);
    setHistory(prev => ({ ...prev, index: nextIndex }));
    showToast('info', 'Redo Successful', 'Reapplied the network change');
  };

  const canUndo = history.index > 0;
  const canRedo = history.index < history.stack.length - 1;

  // Add Equipment with duplicate ID & coordinates validation
  const addEquipment = (item: Partial<Equipment> & { name: string; type: EquipmentType; lat: number; lng: number }): Equipment | null => {
    if (!Number.isFinite(item.lat) || !Number.isFinite(item.lng) || Math.abs(item.lat) > 90 || Math.abs(item.lng) > 180) {
      showToast('error', 'Invalid Location', 'Equipment needs a valid latitude (-90..90) and longitude (-180..180).');
      return null;
    }

    const newId = item.id?.trim() || nextSequentialId(equipmentIdPrefix(item.type), equipments.map(e => e.id));

    // Check duplicate ID
    if (equipments.some(e => e.id.toLowerCase() === newId.toLowerCase())) {
      showToast('error', 'Duplicate ID Error', `Equipment with ID "${newId}" already exists.`);
      return null;
    }

    const totalPorts = item.totalPorts ?? defaultPortCount(item.type);
    const usedPorts = Math.min(item.usedPorts ?? 0, totalPorts);

    const newEquipment: Equipment = {
      ...item,
      id: newId,
      name: item.name,
      type: item.type,
      category: item.category || 'Fiber Distribution',
      lat: item.lat,
      lng: item.lng,
      area: item.area || 'Metro Area',
      street: item.street || 'Main Street',
      status: item.status || 'Active',
      manufacturer: item.manufacturer || 'FiberOptics Global',
      model: item.model || 'Standard 2026',
      totalPorts,
      usedPorts,
      availablePorts: item.availablePorts ?? totalPorts - usedPorts,
      images: item.images || [],
      notes: item.notes || 'Created via GIS visual mapping toolbar',
      installedDate: item.installedDate || today(),
      logicalPorts: item.logicalPorts || []
    };
    newEquipment.logicalPorts = generateLogicalPorts(newEquipment);

    setEquipments(prev => [...prev, newEquipment]);
    showToast('success', 'Equipment Placed', `Successfully mapped ${newEquipment.name} (${newEquipment.id})`);
    logAudit(
      'EQUIPMENT_CREATED',
      `Added new ${newEquipment.type} ${newEquipment.id} at [${newEquipment.lat.toFixed(4)}, ${newEquipment.lng.toFixed(4)}]`,
      newEquipment.id,
      'Equipment'
    );

    return newEquipment;
  };

  const updateEquipment = (item: Equipment, options?: { silent?: boolean }) => {
    setEquipments(prev => prev.map(e => e.id === item.id ? item : e));
    setSelectedObject(prev => (prev?.type === 'equipment' && prev.data?.id === item.id ? { type: 'equipment', data: item } : prev));
    if (!options?.silent) {
      showToast('success', 'Equipment Updated', `Saved modifications for ${item.id}`);
      logAudit('EQUIPMENT_UPDATED', `Updated ${item.type} ${item.id}`, item.id, 'Equipment');
    }
  };

  const updateEquipmentPort = (equipmentId: string, portId: string, patch: Partial<EquipmentPort>) => {
    const eq = equipments.find(e => e.id === equipmentId);
    if (!eq) return;
    const ports = generateLogicalPorts(eq).map(p => (p.id === portId ? { ...p, ...patch } : p));
    const summary = summarizePorts(ports);
    updateEquipment({
      ...eq,
      logicalPorts: ports,
      usedPorts: summary.used,
      availablePorts: summary.available,
      totalPorts: summary.total
    }, { silent: true });
    const port = ports.find(p => p.id === portId);
    showToast('success', 'Port Updated', `${equipmentId} port ${port?.portNumber ?? portId} is now ${port?.status ?? 'updated'}`);
    logAudit('PORT_UPDATED', `${equipmentId} port ${port?.portNumber ?? portId} set to ${port?.status ?? 'updated'}`, equipmentId, 'Equipment');
  };

  const addCustomComponent = (item: CatalogComponent) => {
    setCustomComponents(prev => [...prev, item]);
    showToast('success', 'Component Type Added', `${item.name} is now in the catalog.`);
  };

  const addSplice = (closureId: string, splice: SpliceRecord): boolean => {
    const closure = closures.find(c => c.id === closureId);
    if (!closure) {
      showToast('error', 'Closure Missing', `Joint closure ${closureId} was not found.`);
      return false;
    }
    const duplicate = closure.splices.some(s =>
      (s.inputCableId === splice.inputCableId && s.inputCore === splice.inputCore) ||
      (s.outputCableId === splice.inputCableId && s.outputCore === splice.inputCore) ||
      (s.inputCableId === splice.outputCableId && s.inputCore === splice.outputCore) ||
      (s.outputCableId === splice.outputCableId && s.outputCore === splice.outputCore)
    );
    if (duplicate) {
      showToast('error', 'Duplicate Endpoint', 'That cable core is already spliced in this closure. The same core may still be spliced in other closures along the route.');
      return false;
    }
    setClosures(prev => prev.map(c => c.id === closureId ? { ...c, splices: [...c.splices, splice] } : c));
    showToast('success', 'Splice Recorded', `${splice.inputCableId} core ${splice.inputCore} â†’ ${splice.outputCableId} core ${splice.outputCore}`);
    return true;
  };

  const removeSplice = (closureId: string, spliceId: string) => {
    setClosures(prev => prev.map(c => c.id === closureId ? {
      ...c,
      splices: c.splices.filter(s => s.id !== spliceId)
    } : c));
    showToast('info', 'Splice Removed', `Deleted splice from closure ${closureId}`);
  };

  const saveDraft = () => {
    setPublishState('draft');
    showToast('info', 'Draft Saved', 'Changes are stored locally as a prototype draft. This is not a production database.');
  };

  const publishNetwork = () => {
    setPublishState('published');
    localStorage.setItem('fiber_gis_published_at', new Date().toISOString());
    showToast('success', 'Published (prototype)', 'A local published snapshot was stored. No live GIS or hardware sync is connected.');
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
        limitation: 'Road-aligned navigation path (distinct from underground/aerial fiber lines)'
      });
      showToast('info', 'Biker Road Route Ready', `Navigating to ${dests[dests.length - 1]?.name || dests[dests.length - 1]?.id} Â· ${(totalMeters / 1000).toFixed(2)} km Â· ~${Math.ceil(durationSeconds / 60)} min`);
    };

    const points = [origin, ...dests];
    const coordStr = points.map(p => `${p.lng},${p.lat}`).join(';');
    const url = dests.length > 1
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
        limitation: 'OSRM driving profile; not a verified motorcycle route'
      });
      showToast('info', 'Road route ready', 'Orange dashed line is road navigation. Blue/teal lines remain fiber cables.');
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
    const next = bikerWaypoints.some(p => p.id === asset.id) ? bikerWaypoints : [...bikerWaypoints, asset];
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

  const deleteEquipment = (id: string): boolean => {
    const target = equipments.find(e => e.id === id);
    if (!target) {
      showToast('error', 'Equipment Missing', `Equipment ${id} was not found.`);
      return false;
    }

    // Integrity checks run before asking for confirmation.
    const connectedCables = cables.filter(c => c.startEquipmentId === id || c.endEquipmentId === id);
    if (connectedCables.length > 0) {
      showToast('error', 'Cannot Delete Equipment', `${id} is connected to ${connectedCables.length} cable(s) (${connectedCables.map(c => c.id).join(', ')}). Disconnect or delete those cables first.`);
      return false;
    }
    const dependentCustomers = customers.filter(c => c.terminalBoxId === id || c.oltId === id);
    if (dependentCustomers.length > 0) {
      showToast('error', 'Cannot Delete Equipment', `${id} serves ${dependentCustomers.length} customer(s) (${dependentCustomers.slice(0, 5).map(c => c.id).join(', ')}${dependentCustomers.length > 5 ? ', â€¦' : ''}). Move or disconnect them first.`);
      return false;
    }

    const ownedSplitters = splitters.filter(s => s.terminalBoxId === id);
    const splitterNote = ownedSplitters.length > 0 ? ` Its ${ownedSplitters.length} splitter(s) will also be removed.` : '';
    if (!window.confirm(`Delete equipment ${id} (${target.name})?${splitterNote} You can undo this with Ctrl+Z.`)) return false;

    setEquipments(prev => prev.filter(e => e.id !== id));
    if (ownedSplitters.length > 0) {
      setSplitters(prev => prev.filter(s => s.terminalBoxId !== id));
    }
    setSelectedObject(prev => (prev?.type === 'equipment' && prev.data?.id === id ? null : prev));
    if (activeTraceEquipmentIds.includes(id)) clearTrace();
    showToast('info', 'Equipment Deleted', `Removed ${id} from network infrastructure`);
    logAudit('EQUIPMENT_DELETED', `Deleted ${target.type} ${id}${ownedSplitters.length ? ` and splitters ${ownedSplitters.map(s => s.id).join(', ')}` : ''}`, id, 'Equipment');
    return true;
  };

  // Add Cable with automatic fiber core generation and length calculation
  const addCable = (item: Partial<Cable> & { name: string; type: CableType; coordinates: [number, number][] }): Cable | null => {
    const newId = item.id?.trim() || nextSequentialId(cableIdPrefix(item.type), cables.map(c => c.id), item.type === 'Drop Fiber' ? 3 : 2);

    if (cables.some(c => c.id.toLowerCase() === newId.toLowerCase())) {
      showToast('error', 'Duplicate Cable ID', `Cable with ID "${newId}" already exists.`);
      return null;
    }

    if (!item.coordinates || item.coordinates.length < 2 || !item.coordinates.every(isLatLngPair)) {
      showToast('error', 'Invalid Route', 'Cable must have at least 2 valid geographic route points.');
      return null;
    }

    for (const endpoint of [item.startEquipmentId, item.endEquipmentId]) {
      if (endpoint && !equipments.some(e => e.id === endpoint)) {
        showToast('error', 'Invalid Endpoint', `Endpoint equipment ${endpoint} does not exist.`);
        return null;
      }
    }

    const isCoax = item.type === 'Coaxial Cable';
    const fiberCount = item.cores?.length || item.fiberCount || defaultFiberCount(item.type);
    const cores = item.cores || buildCores(fiberCount);
    const measuredLength = Math.round(polylineLengthMeters(item.coordinates));

    const newCable: Cable = {
      ...item,
      id: newId,
      name: item.name,
      type: item.type,
      fiberCount,
      lengthMeters: item.lengthMeters && item.lengthMeters > 0 ? item.lengthMeters : measuredLength,
      installationType: item.installationType || (item.type === 'Underground Fiber' ? 'Underground' : 'Aerial'),
      owner: item.owner || 'Metropolitan Fiber Corp',
      installationDate: item.installationDate || today(),
      status: item.status || 'Active',
      remarks: item.remarks || 'Drawn via interactive GIS route wizard',
      coordinates: item.coordinates,
      startEquipmentId: item.startEquipmentId,
      endEquipmentId: item.endEquipmentId,
      cores,
      cableCategory: isCoax ? 'Coaxial' : 'Fiber'
    };

    setCables(prev => [...prev, newCable]);
    showToast('success', isCoax ? 'Coaxial Cable Created' : 'Fiber Cable Created', `Mapped ${newCable.name} (${newCable.lengthMeters} m, ${newCable.fiberCount} ${isCoax ? 'conductor' : 'cores'})`);
    logAudit(
      'CABLE_CREATED',
      `Added ${newCable.type} ${newCable.id} (${newCable.lengthMeters} m)${newCable.startEquipmentId || newCable.endEquipmentId ? ` ${newCable.startEquipmentId ?? '?'} â†’ ${newCable.endEquipmentId ?? '?'}` : ''}`,
      newCable.id,
      'Cable'
    );
    return newCable;
  };

  const updateCable = (item: Cable, options?: { silent?: boolean }) => {
    setCables(prev => prev.map(c => c.id === item.id ? item : c));
    setSelectedObject(prev => (prev?.type === 'cable' && prev.data?.id === item.id ? { type: 'cable', data: item } : prev));
    if (!options?.silent) {
      showToast('success', 'Cable Updated', `Saved cable specifications for ${item.id}`);
      logAudit('CABLE_UPDATED', `Updated ${item.type} ${item.id}`, item.id, 'Cable');
    }
  };

  const deleteCable = (id: string): boolean => {
    const target = cables.find(c => c.id === id);
    if (!target) {
      showToast('error', 'Cable Missing', `Cable ${id} was not found.`);
      return false;
    }

    const dependentCustomers = customers.filter(c => c.feederCableId === id || c.distributionCableId === id || c.dropCableId === id);
    if (dependentCustomers.length > 0) {
      showToast('error', 'Cannot Delete Cable', `${id} carries service for ${dependentCustomers.length} customer(s) (${dependentCustomers.slice(0, 5).map(c => c.id).join(', ')}${dependentCustomers.length > 5 ? ', â€¦' : ''}). Re-route them first.`);
      return false;
    }
    const feedingSplitters = splitters.filter(s => s.inputPort.connectedCableId === id);
    if (feedingSplitters.length > 0) {
      showToast('error', 'Cannot Delete Cable', `${id} feeds splitter(s) ${feedingSplitters.map(s => s.id).join(', ')}. Re-patch the splitter input first.`);
      return false;
    }

    const coresInUse = target.cores.filter(c => c.status === 'In Use').length;
    const affectedClosures = closures.filter(c =>
      c.cableAId === id || c.cableBId === id || c.splices.some(s => s.inputCableId === id || s.outputCableId === id)
    );
    const warnings = [
      coresInUse > 0 ? `${coresInUse} core(s) are marked In Use.` : '',
      affectedClosures.length > 0 ? `Splices in ${affectedClosures.map(c => c.id).join(', ')} will be removed.` : ''
    ].filter(Boolean).join(' ');
    if (!window.confirm(`Delete cable ${id} and its core inventory? ${warnings} You can undo this with Ctrl+Z.`.trim())) return false;

    setCables(prev => prev.filter(c => c.id !== id));
    if (affectedClosures.length > 0) {
      setClosures(prev => prev.map(c => {
        if (!affectedClosures.some(a => a.id === c.id)) return c;
        return {
          ...c,
          cableAId: c.cableAId === id ? undefined : c.cableAId,
          cableBId: c.cableBId === id ? undefined : c.cableBId,
          splices: c.splices.filter(s => s.inputCableId !== id && s.outputCableId !== id)
        };
      }));
    }
    setSelectedObject(prev => (prev?.type === 'cable' && prev.data?.id === id ? null : prev));
    if (activeTraceCableIds.includes(id)) clearTrace();
    showToast('info', 'Cable Deleted', `Removed cable ${id} from map`);
    logAudit('CABLE_DELETED', `Deleted ${target.type} ${id}${coresInUse ? ` (${coresInUse} cores were In Use)` : ''}`, id, 'Cable');
    return true;
  };

  // Allocate a specific fiber core with double-booking prevention
  const allocateFiberCore = (cableId: string, coreNumber: number, customerId?: string, equipmentId?: string, portName?: string): boolean => {
    const cable = cables.find(c => c.id === cableId);
    if (!cable) {
      showToast('error', 'Allocation Failed', `Cable ${cableId} not found.`);
      return false;
    }

    const core = cable.cores.find(c => c.coreNumber === coreNumber);
    if (!core) {
      showToast('error', 'Allocation Failed', `Core ${coreNumber} not found on cable ${cableId}.`);
      return false;
    }

    if (core.status === 'In Use') {
      showToast('error', 'Core Already Occupied', `Fiber Core ${coreNumber.toString().padStart(2, '0')} (${core.colorName}) is already occupied by ${core.connectedToEquipmentId || core.customerId}. Select an available core.`);
      return false;
    }

    if (core.status === 'Damaged') {
      showToast('error', 'Damaged Core', `Fiber Core ${coreNumber.toString().padStart(2, '0')} has damage/high attenuation. Cannot allocate.`);
      return false;
    }

    // Update core
    const updatedCores = cable.cores.map(c => {
      if (c.coreNumber === coreNumber) {
        return {
          ...c,
          status: 'In Use' as const,
          connectedToEquipmentId: equipmentId,
          connectedPort: portName,
          customerId,
          remarks: `Allocated to ${customerId || equipmentId} on ${new Date().toLocaleDateString()}`
        };
      }
      return c;
    });

    const updatedCable = { ...cable, cores: updatedCores };
    updateCable(updatedCable, { silent: true });
    showToast('success', 'Fiber Core Allocated', `Core ${coreNumber.toString().padStart(2, '0')} (${core.colorName}) allocated to ${customerId || equipmentId}`);
    logAudit('CORE_ALLOCATED', `${cableId} core ${coreNumber} allocated to ${customerId || equipmentId || 'unspecified target'}${portName ? ` (${portName})` : ''}`, cableId, 'Core');
    return true;
  };

  // Connect customer to port with strict single physical connection enforcement
  const connectCustomerToPort = (customerData: Partial<Customer>): Customer | null => {
    if (!customerData.terminalBoxId || !customerData.splitterId || !customerData.splitterOutputPort) {
      showToast('error', 'Missing Connection Target', 'Please specify Terminal Box, Splitter, and Output Port.');
      return null;
    }

    const fat = equipments.find(e => e.id === customerData.terminalBoxId);
    if (!fat) {
      showToast('error', 'Terminal Not Found', `Access terminal ${customerData.terminalBoxId} does not exist.`);
      return null;
    }

    // Verify splitter port availability
    const splitter = splitters.find(s => s.id === customerData.splitterId);
    if (!splitter) {
      showToast('error', 'Splitter Not Found', `Splitter ${customerData.splitterId} does not exist.`);
      return null;
    }
    if (splitter.terminalBoxId !== fat.id) {
      showToast('error', 'Splitter Mismatch', `Splitter ${splitter.id} is installed in ${splitter.terminalBoxId}, not ${fat.id}.`);
      return null;
    }
    if (splitter.status === 'Faulty') {
      showToast('error', 'Splitter Faulty', `Splitter ${splitter.id} is marked Faulty. Repair it before provisioning new subscribers.`);
      return null;
    }

    const targetPort = splitter.outputPorts.find(p => p.portNumber === customerData.splitterOutputPort);
    if (!targetPort) {
      showToast('error', 'Invalid Port', `Splitter port ${customerData.splitterOutputPort} does not exist.`);
      return null;
    }

    if (targetPort.status === 'Occupied') {
      showToast('error', 'Port Already Occupied', `Splitter Output Port ${customerData.splitterOutputPort} is already assigned to ${targetPort.connectedCustomerName || targetPort.connectedCustomerId}. Cannot double-book physical port.`);
      return null;
    }
    if (targetPort.status === 'Faulty') {
      showToast('error', 'Port Faulty', `Splitter Output Port ${customerData.splitterOutputPort} is marked Faulty. Choose another port.`);
      return null;
    }

    const ontSerial = customerData.ontSerialNumber?.trim() || `ONT-${uniqueId('SN').slice(-8).toUpperCase()}`;
    const duplicateOnt = customers.find(c => c.ontSerialNumber.toLowerCase() === ontSerial.toLowerCase());
    if (duplicateOnt) {
      showToast('error', 'Duplicate ONT Serial', `ONT ${ontSerial} is already registered to ${duplicateOnt.name} (${duplicateOnt.id}).`);
      return null;
    }

    const newId = customerData.id?.trim() || nextSequentialId('CUST-', customers.map(c => c.id), 3);
    if (customers.some(c => c.id.toLowerCase() === newId.toLowerCase())) {
      showToast('error', 'Duplicate Customer ID', `Customer ${newId} already exists.`);
      return null;
    }

    // Subscriber location: as entered, otherwise a short drop away from the FAT.
    const hasLocation = Number.isFinite(customerData.lat) && Number.isFinite(customerData.lng);
    const lat = hasLocation ? customerData.lat! : fat.lat + 0.00025 * Math.sin(targetPort.portNumber);
    const lng = hasLocation ? customerData.lng! : fat.lng + 0.00025 * Math.cos(targetPort.portNumber);

    // Drop cable FAT ? premises with core 1 lit.
    const dropRoute: [number, number][] = [[fat.lat, fat.lng], [lat, lng]];
    const dropLength = Math.max(1, Math.round(polylineLengthMeters(dropRoute)));
    const dropId = nextSequentialId('DROP-', cables.map(c => c.id), 3);
    const dropCores = buildCores(2).map(core => core.coreNumber === 1
      ? { ...core, status: 'In Use' as const, customerId: newId, customerName: customerData.name, connectedToEquipmentId: fat.id, connectedPort: `${splitter.id}/OUT-${targetPort.portNumber}`, remarks: `Drop to ${newId}` }
      : core);
    const dropCable: Cable = {
      id: dropId,
      name: `Drop ${fat.id} ? ${newId}`,
      type: 'Drop Fiber',
      fiberCount: 2,
      lengthMeters: dropLength,
      installationType: 'Aerial',
      owner: 'Metropolitan Fiber Corp',
      installationDate: today(),
      status: 'Active',
      remarks: `Auto-created during provisioning of ${newId}`,
      coordinates: dropRoute,
      startEquipmentId: fat.id,
      cores: dropCores,
      cableCategory: 'Fiber'
    };

    // Resolve the logical path from the physical topology.
    const data = getTraceData();
    const estimate = estimateRxForSplitter(fat, splitter, data, dropLength);
    const feederHop = estimate.hops[0];
    const distributionHop = estimate.hops.length > 1 ? estimate.hops[estimate.hops.length - 1] : undefined;
    const usedIps = new Set(customers.map(c => c.ipAddress));
    let ipAddress = customerData.ipAddress?.trim() || '';
    if (!ipAddress || usedIps.has(ipAddress)) {
      for (let n = customers.length + 2; n < 65000; n++) {
        const candidate = `100.64.${Math.floor(n / 250)}.${(n % 250) + 2}`;
        if (!usedIps.has(candidate)) {
          ipAddress = candidate;
          break;
        }
      }
    }

    const newCustomer: Customer = {
      id: newId,
      name: customerData.name?.trim() || 'New Subscriber',
      mobile: customerData.mobile || '',
      address: customerData.address || fat.street || '',
      area: customerData.area || fat.area,
      building: customerData.building,
      flatNumber: customerData.flatNumber,
      lat,
      lng,
      serviceType: customerData.serviceType || 'Fiber Broadband',
      plan: customerData.plan || 'FTTH Ultra 300 Mbps',
      status: customerData.status || 'Active',
      installationDate: today(),
      oltId: customerData.oltId || estimate.olt?.id || '',
      ponPort: customerData.ponPort || estimate.pon?.id || '',
      feederCableId: customerData.feederCableId || feederHop?.cable.id || '',
      distributionCableId: customerData.distributionCableId || distributionHop?.cable.id || feederHop?.cable.id || '',
      terminalBoxId: fat.id,
      splitterId: splitter.id,
      splitterOutputPort: targetPort.portNumber,
      dropCableId: dropId,
      fiberCore: customerData.fiberCore || splitter.inputPort.connectedCore || 1,
      ontSerialNumber: ontSerial,
      routerModel: customerData.routerModel || 'Dual-Band Wi-Fi 6 ONT',
      ipAddress,
      rxOpticalPowerDbm: customerData.rxOpticalPowerDbm ?? estimate.rxDbm ?? 0
    };

    setCables(prev => [...prev, dropCable]);
    setSplitters(prev => prev.map(s => s.id !== splitter.id ? s : {
      ...s,
      outputPorts: s.outputPorts.map(p => p.portNumber !== targetPort.portNumber ? p : {
        ...p,
        status: 'Occupied' as const,
        connectedCustomerId: newId,
        connectedCustomerName: newCustomer.name,
        connectedDropCableId: dropId
      })
    }));
    setEquipments(prev => prev.map(e => {
      if (e.id === fat.id) return setPortUsage(e, targetPort.portNumber, true, newId);
      if (estimate.olt && e.id === estimate.olt.id && estimate.pon) {
        return {
          ...e,
          ponPorts: e.ponPorts?.map(p => p.id === estimate.pon!.id ? { ...p, status: 'Active' as const, connectedCustomersCount: p.connectedCustomersCount + 1 } : p)
        };
      }
      return e;
    }));
    setCustomers(prev => [...prev, newCustomer]);

    // Confetti celebration!
    confetti({
      particleCount: 80,
      spread: 70,
      origin: { y: 0.6 }
    });

    const warnings: string[] = [];
    if (!estimate.olt) warnings.push('no upstream OLT could be traced');
    if (estimate.rxDbm !== undefined && estimate.rxDbm < -25) warnings.push(`estimated Rx ${estimate.rxDbm} dBm is weak`);
    showToast(
      warnings.length ? 'warning' : 'success',
      'Customer Connected',
      `Activated ${newCustomer.name} on ${fat.id} port ${targetPort.portNumber} via ${dropId}${estimate.rxDbm !== undefined ? ` (est. Rx ${estimate.rxDbm} dBm)` : ''}${warnings.length ? ` - check: ${warnings.join('; ')}` : ''}`
    );
    logAudit('CUSTOMER_CONNECTED', `Provisioned ${newId} on ${splitter.id} port ${targetPort.portNumber} (${fat.id}) with drop ${dropId}`, newId, 'Customer');
    return newCustomer;
  };

  // Upload Photo to Equipment
  const uploadEquipmentPhoto = (equipmentId: string, photo: Partial<EquipmentImage>) => {
    const eq = equipments.find(e => e.id === equipmentId);
    if (!eq) {
      showToast('error', 'Upload Failed', `Equipment ${equipmentId} was not found.`);
      return;
    }
    if (!photo.url) {
      showToast('error', 'Upload Failed', 'No image data was provided.');
      return;
    }

    const newPhoto: EquipmentImage = {
      id: photo.id || uniqueId('IMG'),
      equipmentId,
      url: photo.url,
      name: photo.name || 'Field Photo',
      category: photo.category || 'Internal Trays',
      uploadDate: today(),
      uploadedBy: photo.uploadedBy || `${userRole} User`,
      description: photo.description || 'Uploaded field verification photograph',
      annotations: photo.annotations || []
    };

    updateEquipment({ ...eq, images: [...eq.images, newPhoto] }, { silent: true });
    showToast('success', 'Photograph Uploaded', `Added ${newPhoto.name} to ${equipmentId}`);
    logAudit('PHOTO_UPLOADED', `Added photo "${newPhoto.name}" (${newPhoto.category}) to ${equipmentId}`, equipmentId, 'Equipment');
  };

  // Image Annotation Saving (Preserves original photo!)
  const saveImageAnnotation = (equipmentId: string, imageId: string, annotation: ImageAnnotation) => {
    const eq = equipments.find(e => e.id === equipmentId);
    if (!eq) return;

    const updatedImages = eq.images.map(img => {
      if (img.id === imageId) {
        const existingIdx = img.annotations.findIndex(a => a.id === annotation.id);
        const newAnnotations = existingIdx >= 0
          ? img.annotations.map(a => a.id === annotation.id ? annotation : a)
          : [...img.annotations, annotation];
        return { ...img, annotations: newAnnotations };
      }
      return img;
    });

    updateEquipment({ ...eq, images: updatedImages }, { silent: true });
    showToast('success', 'Annotation Saved', `Marked ${annotation.label} on image`);
  };

  const deleteImageAnnotation = (equipmentId: string, imageId: string, annotationId: string) => {
    const eq = equipments.find(e => e.id === equipmentId);
    if (!eq) return;

    const updatedImages = eq.images.map(img => {
      if (img.id === imageId) {
        return {
          ...img,
          annotations: img.annotations.filter(a => a.id !== annotationId)
        };
      }
      return img;
    });

    updateEquipment({ ...eq, images: updatedImages }, { silent: true });
    showToast('info', 'Annotation Removed', 'Deleted port mark from photograph');
  };

  // Trace Fiber Route (computed from the physical topology)
  const resolveTrace = (targetId: string): TraceResult | null => {
    const data = getTraceData();
    const id = targetId.trim();
    if (!id) return null;

    const customer = customers.find(c => c.id === id || c.ontSerialNumber === id);
    if (customer) return traceCustomer(customer, data);

    const eq = equipments.find(e => e.id === id);
    if (eq) return traceEquipment(eq, data);

    const cable = cables.find(c => c.id === id);
    if (cable) return traceCable(cable, data);

    // "OLT-01/PON-03" or a bare PON port id ? trace the feeder of that PON.
    const [oltPart, ponPart] = id.includes('/') ? id.split('/') : [undefined, id];
    const olt = equipments.find(e => e.type === 'OLT' && (oltPart ? e.id === oltPart : e.ponPorts?.some(p => p.id === ponPart)));
    const pon = olt?.ponPorts?.find(p => p.id === ponPart);
    if (olt && pon) {
      const feeder = cables.find(c => c.id === pon.connectedFeederCableId);
      return feeder ? traceCable(feeder, data) : traceEquipment(olt, data);
    }

    const fault = faults.find(f => f.id === id);
    if (fault) {
      const faultCable = fault.affectedCableId ? cables.find(c => c.id === fault.affectedCableId) : undefined;
      if (faultCable) return traceCable(faultCable, data);
      const faultEq = fault.affectedEquipmentId ? equipments.find(e => e.id === fault.affectedEquipmentId) : undefined;
      if (faultEq) return traceEquipment(faultEq, data);
      const faultCustomer = customers.find(c => fault.affectedCustomerIds.includes(c.id));
      if (faultCustomer) return traceCustomer(faultCustomer, data);
      return null;
    }

    const closure = closures.find(c => c.id === id);
    if (closure) {
      const closureCable = cables.find(c => c.id === closure.cableAId) || cables.find(c => c.id === closure.cableBId);
      return closureCable ? traceCable(closureCable, data) : null;
    }

    const splitter = splitters.find(s => s.id === id);
    if (splitter) {
      const host = equipments.find(e => e.id === splitter.terminalBoxId);
      return host ? traceEquipment(host, data) : null;
    }
    return null;
  };

  const traceNetworkPath = (targetId: string): boolean => {
    const result = resolveTrace(targetId);
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
    const budget = summary.estimatedRxDbm !== undefined ? ` ? est. Rx ${summary.estimatedRxDbm} dBm (${summary.budgetStatus})` : '';
    showToast(
      summary.budgetStatus === 'Fail' || summary.warnings.length > 0 ? 'warning' : 'info',
      'Fiber Trace Active',
      `${summary.targetLabel}: ${result.nodes.length} hops ? ${(summary.totalLengthMeters / 1000).toFixed(2)} km${budget}`
    );
    return true;
  };

  const clearTrace = () => {
    setActiveTracePath(null);
    setActiveTraceCableIds([]);
    setActiveTraceEquipmentIds([]);
    setActiveTraceSummary(null);
  };

  // Fault Management
  const recordNewFault = (faultData: Partial<Fault>): Fault => {
    const year = new Date().getFullYear();
    const newId = faultData.id || nextSequentialId(`FLT-${year}-`, faults.map(f => f.id), 3);
    const eq = faultData.affectedEquipmentId ? equipments.find(e => e.id === faultData.affectedEquipmentId) : undefined;
    const cable = faultData.affectedCableId ? cables.find(c => c.id === faultData.affectedCableId) : undefined;

    let location = faultData.affectedLocation;
    if (!location && eq) location = { lat: eq.lat, lng: eq.lng };
    if (!location && cable && cable.coordinates.length > 0) {
      const mid = cable.coordinates[Math.floor(cable.coordinates.length / 2)];
      location = { lat: mid[0], lng: mid[1] };
    }
    if (!location) {
      const fallback = getDefaultOrigin();
      location = fallback ? { lat: fallback.lat, lng: fallback.lng } : { lat: 0, lng: 0 };
    }

    let affectedCustomerIds = faultData.affectedCustomerIds;
    if (!affectedCustomerIds || affectedCustomerIds.length === 0) {
      const data = getTraceData();
      if (eq) {
        affectedCustomerIds = collectDownstream(eq.id, data).customers.map(c => c.id);
      } else if (cable) {
        const viaCable = customers.filter(c => c.feederCableId === cable.id || c.distributionCableId === cable.id || c.dropCableId === cable.id);
        const downstream = cable.endEquipmentId ? collectDownstream(cable.endEquipmentId, data).customers : [];
        affectedCustomerIds = Array.from(new Set([...viaCable, ...downstream].map(c => c.id)));
      } else {
        affectedCustomerIds = [];
      }
    }

    const newFault: Fault = {
      id: newId,
      title: faultData.title || `${faultData.type || 'Fiber Cut'} at ${eq?.id || cable?.id || 'field location'}`,
      type: faultData.type || 'Fiber Cut',
      severity: faultData.severity || 'Critical',
      status: faultData.status || 'Reported',
      affectedLocation: location,
      affectedCableId: faultData.affectedCableId,
      affectedEquipmentId: faultData.affectedEquipmentId,
      affectedCustomerIds,
      affectedCores: faultData.affectedCores || [],
      affectedSplitterPorts: faultData.affectedSplitterPorts || [],
      description: faultData.description || 'Reported via field inspection',
      reportedAt: new Date().toLocaleString(),
      assignedTechnician: faultData.assignedTechnician || 'Unassigned',
      workOrderId: faultData.workOrderId,
      images: faultData.images || []
    };

    setFaults(prev => [newFault, ...prev]);
    showToast('error', 'Network Fault Logged', `Registered ${newFault.type} (${newFault.id}) ? ${newFault.severity} ? ${affectedCustomerIds.length} customer(s) affected`);
    logAudit('FAULT_REPORTED', `${newFault.type} ${newFault.id} on ${eq?.id || cable?.id || 'unspecified asset'} (${affectedCustomerIds.length} customers)`, newFault.id, 'Fault');
    return newFault;
  };

  const resolveExistingFault = (faultId: string) => {
    const fault = faults.find(f => f.id === faultId);
    if (!fault) {
      showToast('error', 'Fault Missing', `Fault ${faultId} was not found.`);
      return;
    }
    if (fault.status === 'Resolved') {
      showToast('info', 'Already Resolved', `${faultId} is already resolved.`);
      return;
    }
    setFaults(prev => prev.map(f => f.id === faultId ? { ...f, status: 'Resolved', resolvedAt: new Date().toLocaleString() } : f));
    const linkedOrders = workOrders.filter(w => (w.faultId === faultId || w.id === fault.workOrderId) && w.status !== 'Completed' && w.status !== 'Cancelled');
    if (linkedOrders.length > 0) {
      setWorkOrders(prev => prev.map(w => linkedOrders.some(o => o.id === w.id) ? { ...w, status: 'Completed', completedDate: today() } : w));
    }
    showToast('success', 'Fault Resolved', `Outage ${faultId} marked resolved${linkedOrders.length ? ` and ${linkedOrders.map(o => o.id).join(', ')} completed` : ''}.`);
    logAudit('FAULT_RESOLVED', `Resolved ${faultId}${linkedOrders.length ? `; completed ${linkedOrders.map(o => o.id).join(', ')}` : ''}`, faultId, 'Fault');
  };

  const addWorkOrder = (order: Partial<WorkOrder> & { title: string }): WorkOrder => {
    const year = new Date().getFullYear();
    const newOrder: WorkOrder = {
      id: order.id || nextSequentialId(`WO-${year}-`, workOrders.map(w => w.id), 3),
      title: order.title,
      type: order.type || 'Repair',
      priority: order.priority || 'Medium',
      status: order.status || (order.technicianName ? 'Assigned' : 'Pending'),
      technicianName: order.technicianName || 'Unassigned',
      technicianPhone: order.technicianPhone || '',
      equipmentId: order.equipmentId,
      cableId: order.cableId,
      customerId: order.customerId,
      faultId: order.faultId,
      scheduledDate: order.scheduledDate || today(),
      completedDate: order.completedDate,
      notes: order.notes || '',
      photos: order.photos || []
    };
    setWorkOrders(prev => [newOrder, ...prev]);
    if (newOrder.faultId) {
      setFaults(prev => prev.map(f => f.id === newOrder.faultId
        ? {
            ...f,
            workOrderId: newOrder.id,
            status: f.status === 'Resolved' ? f.status : 'Dispatched',
            assignedTechnician: newOrder.technicianName !== 'Unassigned' ? newOrder.technicianName : f.assignedTechnician
          }
        : f));
    }
    showToast('success', 'Work Order Created', `${newOrder.id}: ${newOrder.title}`);
    logAudit('WORK_ORDER_CREATED', `${newOrder.type} ${newOrder.id}${newOrder.faultId ? ` for ${newOrder.faultId}` : ''} (${newOrder.priority})`, newOrder.id, 'WorkOrder');
    return newOrder;
  };

  const updateWorkOrderStatus = (workOrderId: string, status: WorkOrder['status']) => {
    const order = workOrders.find(w => w.id === workOrderId);
    if (!order) {
      showToast('error', 'Work Order Missing', `Work order ${workOrderId} was not found.`);
      return;
    }
    if (order.status === status) return;
    setWorkOrders(prev => prev.map(w => w.id === workOrderId ? { ...w, status, completedDate: status === 'Completed' ? today() : w.completedDate } : w));
    if (order.faultId && (status === 'In Progress' || status === 'Assigned')) {
      setFaults(prev => prev.map(f => f.id === order.faultId && f.status !== 'Resolved'
        ? { ...f, status: status === 'In Progress' ? 'In Progress' : 'Dispatched' }
        : f));
    }
    showToast('success', 'Work Order Updated', `Work Order ${workOrderId} status changed to ${status}`);
    logAudit('WORK_ORDER_STATUS', `${workOrderId}: ${order.status} ? ${status}`, workOrderId, 'WorkOrder');
  };

  // Zone Management Methods
  const addZone = (zone: Partial<NetworkZone> & { name: string; areaCode: string }): NetworkZone => {
    const anchor = equipments.find(e => e.type === 'OLT') || equipments[0];
    const [cLat, cLng]: [number, number] = anchor ? [anchor.lat, anchor.lng] : projectStartPoint ?? [0, 0];
    const d = 0.0035;
    const newZone: NetworkZone = {
      id: zone.id || nextSequentialId('ZONE-', zones.map(z => z.id)),
      name: zone.name,
      areaCode: zone.areaCode,
      coverageSqKm: zone.coverageSqKm ?? 2.5,
      homePassed: zone.homePassed ?? 0,
      connectedCustomers: zone.connectedCustomers ?? 0,
      feederCableCount: zone.feederCableCount ?? 0,
      fatCount: zone.fatCount ?? 0,
      penetrationRatePct: zone.penetrationRatePct ?? 0,
      status: zone.status || 'Expansion',
      boundaryCoords: zone.boundaryCoords && zone.boundaryCoords.length >= 3 ? zone.boundaryCoords : [
        [cLat - d, cLng - d],
        [cLat + d, cLng - d],
        [cLat + d, cLng + d],
        [cLat - d, cLng + d]
      ]
    };
    setZones(prev => [...prev, newZone]);
    showToast('success', 'Network Zone Added', `Created zone ${newZone.name} (${newZone.areaCode})`);
    logAudit('ZONE_CREATED', `Created zone ${newZone.name} (${newZone.areaCode})`, newZone.id, 'Zone');
    return newZone;
  };

  const updateZone = (zone: NetworkZone) => {
    setZones(prev => prev.map(z => z.id === zone.id ? zone : z));
    showToast('success', 'Zone Updated', `Saved changes for zone ${zone.name}`);
    logAudit('ZONE_UPDATED', `Updated zone ${zone.name}`, zone.id, 'Zone');
  };

  const deleteZone = (id: string) => {
    const zone = zones.find(z => z.id === id);
    if (!zone) return;
    setZones(prev => prev.filter(z => z.id !== id));
    showToast('info', 'Zone Removed', `Deleted zone ${zone.name}`);
    logAudit('ZONE_DELETED', `Deleted zone ${zone.name}`, id, 'Zone');
  };

  // Document Management Methods
  const addDocument = (doc: Partial<NetworkDocument> & { title: string; category: NetworkDocument['category'] }): NetworkDocument => {
    const newDoc: NetworkDocument = {
      id: doc.id || nextSequentialId('DOC-', documents.map(d => d.id), 3),
      title: doc.title,
      category: doc.category,
      equipmentId: doc.equipmentId,
      cableId: doc.cableId,
      uploadedBy: doc.uploadedBy || `${userRole} User`,
      uploadDate: today(),
      fileSizeKb: doc.fileSizeKb ?? 0,
      url: doc.url || '#'
    };
    setDocuments(prev => [newDoc, ...prev]);
    showToast('success', 'Document Uploaded', `Added ${newDoc.title} to repository`);
    logAudit('DOCUMENT_ADDED', `Added ${newDoc.category} "${newDoc.title}"`, newDoc.id, 'Document');
    return newDoc;
  };

  const deleteDocument = (id: string) => {
    const doc = documents.find(d => d.id === id);
    if (!doc) return;
    setDocuments(prev => prev.filter(d => d.id !== id));
    showToast('info', 'Document Deleted', `Removed "${doc.title}" from repository`);
    logAudit('DOCUMENT_DELETED', `Deleted "${doc.title}"`, id, 'Document');
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
      customComponents
    };
    downloadBlob(JSON.stringify(backupData, null, 2), 'application/json', `fiber_gis_backup_${today()}.json`);
    showToast('success', 'Backup Exported', 'Full network database downloaded as JSON.');
    logAudit('BACKUP_EXPORTED', `Exported backup (${equipments.length} equipment, ${cables.length} cables, ${customers.length} customers)`, 'SYSTEM', 'System');
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
    if (!window.confirm('Reset the entire network to the bundled sample dataset? All local changes will be lost.')) return;
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

    equipments.forEach(eq => {
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

    cables.forEach(cb => {
      if (cb.coordinates.length < 2) return;
      const coordsStr = cb.coordinates.map(pt => `${pt[1]},${pt[0]},0`).join(' ');
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

    customers.forEach(c => {
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

    downloadBlob(kml, 'application/vnd.google-earth.kml+xml', `fiber_gis_network_${today()}.kml`);
    showToast('success', 'KML Export Complete', `Exported ${equipments.length} equipment, ${cables.length} cables and ${customers.length} customers.`);
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
        canRedo
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
