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
  LogicalPortStatus,
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
import { generateLogicalPorts, summarizePorts } from '../lib/ports';
import confetti from 'canvas-confetti';

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
  selectedObject: { type: 'equipment' | 'cable' | 'customer' | 'closure' | 'fault'; data: any } | null;
  setSelectedObject: (obj: { type: 'equipment' | 'cable' | 'customer' | 'closure' | 'fault'; data: any } | null) => void;
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
  traceNetworkPath: (targetId: string) => void;
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
  updateEquipment: (item: Equipment) => void;
  deleteEquipment: (id: string) => boolean;
  addCable: (item: Partial<Cable> & { name: string; type: CableType; coordinates: [number, number][] }) => Cable | null;
  updateCable: (item: Cable) => void;
  deleteCable: (id: string) => boolean;
  allocateFiberCore: (cableId: string, coreNumber: number, customerId?: string, equipmentId?: string, portName?: string) => boolean;
  connectCustomerToPort: (customerData: Partial<Customer>) => Customer | null;
  uploadEquipmentPhoto: (equipmentId: string, photo: Partial<EquipmentImage>) => void;
  saveImageAnnotation: (equipmentId: string, imageId: string, annotation: ImageAnnotation) => void;
  deleteImageAnnotation: (equipmentId: string, imageId: string, annotationId: string) => void;
  recordNewFault: (faultData: Partial<Fault>) => void;
  resolveExistingFault: (faultId: string) => void;
  updateWorkOrderStatus: (workOrderId: string, status: WorkOrder['status']) => void;

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
  // Primary datasets initialized with rich demonstration data
  const [equipments, setEquipments] = useState<Equipment[]>(() => {
    const saved = localStorage.getItem('fiber_gis_equipment');
    return saved ? JSON.parse(saved) : SAMPLE_EQUIPMENT;
  });

  const [cables, setCables] = useState<Cable[]>(() => {
    const saved = localStorage.getItem('fiber_gis_cables');
    return saved ? JSON.parse(saved) : SAMPLE_CABLES;
  });

  const [splitters, setSplitters] = useState<Splitter[]>(() => {
    const saved = localStorage.getItem('fiber_gis_splitters');
    return saved ? JSON.parse(saved) : SAMPLE_SPLITTERS;
  });

  const [closures, setClosures] = useState<JointClosure[]>(() => {
    const saved = localStorage.getItem('fiber_gis_closures');
    return saved ? JSON.parse(saved) : SAMPLE_JOINT_CLOSURES;
  });

  const [customers, setCustomers] = useState<Customer[]>(() => {
    const saved = localStorage.getItem('fiber_gis_customers');
    return saved ? JSON.parse(saved) : SAMPLE_CUSTOMERS;
  });

  const [faults, setFaults] = useState<Fault[]>(() => {
    const saved = localStorage.getItem('fiber_gis_faults');
    return saved ? JSON.parse(saved) : SAMPLE_FAULTS;
  });

  const [workOrders, setWorkOrders] = useState<WorkOrder[]>(() => {
    const saved = localStorage.getItem('fiber_gis_work_orders');
    return saved ? JSON.parse(saved) : SAMPLE_WORK_ORDERS;
  });

  const [auditLogs, setAuditLogs] = useState<AuditLog[]>(() => {
    const saved = localStorage.getItem('fiber_gis_audit_logs');
    return saved ? JSON.parse(saved) : SAMPLE_AUDIT_LOGS;
  });

  // Main Active View State
  const [activeMainView, setActiveMainView] = useState<MainView>('map');

  // Zones & Documents
  const [zones, setZones] = useState<NetworkZone[]>(() => {
    const saved = localStorage.getItem('fiber_gis_zones');
    return saved ? JSON.parse(saved) : SAMPLE_ZONES;
  });

  const [documents, setDocuments] = useState<NetworkDocument[]>(() => {
    const saved = localStorage.getItem('fiber_gis_documents');
    return saved ? JSON.parse(saved) : SAMPLE_DOCUMENTS;
  });

  const [isDocumentModalOpen, setIsDocumentModalOpen] = useState(false);
  const [isComponentCatalogOpen, setIsComponentCatalogOpen] = useState(false);
  const [isPortManagerOpen, setIsPortManagerOpen] = useState(false);
  const [customComponents, setCustomComponents] = useState<CatalogComponent[]>(() => {
    const saved = localStorage.getItem('fiber_gis_custom_components');
    return saved ? JSON.parse(saved) : [];
  });
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
  useEffect(() => {
    localStorage.setItem('fiber_gis_equipment', JSON.stringify(equipments));
  }, [equipments]);
  useEffect(() => {
    localStorage.setItem('fiber_gis_cables', JSON.stringify(cables));
  }, [cables]);
  useEffect(() => {
    localStorage.setItem('fiber_gis_splitters', JSON.stringify(splitters));
  }, [splitters]);
  useEffect(() => {
    localStorage.setItem('fiber_gis_customers', JSON.stringify(customers));
  }, [customers]);
  useEffect(() => {
    localStorage.setItem('fiber_gis_faults', JSON.stringify(faults));
  }, [faults]);
  useEffect(() => {
    localStorage.setItem('fiber_gis_work_orders', JSON.stringify(workOrders));
  }, [workOrders]);
  useEffect(() => {
    localStorage.setItem('fiber_gis_zones', JSON.stringify(zones));
  }, [zones]);
  useEffect(() => {
    localStorage.setItem('fiber_gis_documents', JSON.stringify(documents));
  }, [documents]);
  useEffect(() => {
    localStorage.setItem('fiber_gis_closures', JSON.stringify(closures));
  }, [closures]);
  useEffect(() => {
    localStorage.setItem('fiber_gis_custom_components', JSON.stringify(customComponents));
  }, [customComponents]);

  // Selections & Active Tool
  const [selectedObject, setSelectedObject] = useState<{ type: 'equipment' | 'cable' | 'customer' | 'closure' | 'fault'; data: any } | null>(null);
  const [activeTool, setActiveTool] = useState<'select' | 'draw_cable' | 'add_equipment' | 'measure' | 'trace'>('select');
  const [selectedEquipmentTypeToAdd, setSelectedEquipmentTypeToAdd] = useState<EquipmentType | null>(null);
  const [selectedCableTypeToDraw, setSelectedCableTypeToDraw] = useState<CableType>('Main Feeder Fiber');
  const [activeDrawingPoints, setActiveDrawingPoints] = useState<[number, number][]>([]);
  const [measuringPoints, setMeasuringPoints] = useState<[number, number][]>([]);

  // Trace State
  const [activeTracePath, setActiveTracePath] = useState<TracePathNode[] | null>(null);
  const [activeTraceCableIds, setActiveTraceCableIds] = useState<string[]>([]);
  const [activeTraceEquipmentIds, setActiveTraceEquipmentIds] = useState<string[]>([]);

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
  const [projectStartPoint, setProjectStartPointState] = useState<[number, number] | null>(() => {
    const saved = localStorage.getItem('fiber_gis_project_start');
    return saved ? JSON.parse(saved) : null;
  });

  const setProjectStartPoint = (pt: [number, number] | null) => {
    setProjectStartPointState(pt);
    if (pt) localStorage.setItem('fiber_gis_project_start', JSON.stringify(pt));
    else localStorage.removeItem('fiber_gis_project_start');
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
  const showToast = (type: ToastItem['type'], title: string, message: string) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    setToasts(prev => [...prev, { id, type, title, message }]);
    setTimeout(() => {
      removeToast(id);
    }, 5500);
  };
  const removeToast = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  // Undo/Redo stacks
  const [history, setHistory] = useState<Array<{ equipments: Equipment[]; cables: Cable[] }>>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const pushHistory = (newEquipments: Equipment[], newCables: Cable[]) => {
    const updated = history.slice(0, historyIndex + 1);
    updated.push({ equipments: newEquipments, cables: newCables });
    setHistory(updated);
    setHistoryIndex(updated.length - 1);
  };

  const undo = () => {
    if (historyIndex > 0) {
      const target = history[historyIndex - 1];
      setEquipments(target.equipments);
      setCables(target.cables);
      setHistoryIndex(historyIndex - 1);
      showToast('info', 'Undo Successful', 'Reverted network action');
    }
  };

  const redo = () => {
    if (historyIndex < history.length - 1) {
      const target = history[historyIndex + 1];
      setEquipments(target.equipments);
      setCables(target.cables);
      setHistoryIndex(historyIndex + 1);
      showToast('info', 'Redo Successful', 'Reapplied network action');
    }
  };

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;

  // Add Equipment with duplicate ID & coordinates validation
  const addEquipment = (item: Partial<Equipment> & { name: string; type: EquipmentType; lat: number; lng: number }): Equipment | null => {
    const newId = item.id || `${item.type.replace(/[^A-Za-z0-9]/g, '')}-${Date.now().toString().slice(-4)}`;
    
    // Check duplicate ID
    if (equipments.some(e => e.id.toLowerCase() === newId.toLowerCase())) {
      showToast('error', 'Duplicate ID Error', `Equipment with ID "${newId}" already exists.`);
      return null;
    }

    const newEquipment: Equipment = {
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
      totalPorts: item.totalPorts || (item.type === 'FAT' ? 8 : item.type === 'FDT' ? 48 : 24),
      usedPorts: 0,
      availablePorts: item.totalPorts || (item.type === 'FAT' ? 8 : item.type === 'FDT' ? 48 : 24),
      images: item.images || [],
      notes: item.notes || 'Created via GIS visual mapping toolbar',
      installedDate: new Date().toISOString().split('T')[0],
      logicalPorts: []
    };
    newEquipment.logicalPorts = generateLogicalPorts(newEquipment);

    const updated = [...equipments, newEquipment];
    setEquipments(updated);
    pushHistory(updated, cables);
    showToast('success', 'Equipment Placed', `Successfully mapped ${newEquipment.name} (${newEquipment.id})`);

    // Log audit
    const newLog: AuditLog = {
      id: `LOG-${Date.now()}`,
      timestamp: new Date().toLocaleString(),
      user: 'Current User',
      role: userRole,
      action: 'EQUIPMENT_CREATED',
      details: `Added new ${newEquipment.type} ${newEquipment.id} at [${newEquipment.lat.toFixed(4)}, ${newEquipment.lng.toFixed(4)}]`,
      assetId: newEquipment.id,
      assetType: 'Equipment'
    };
    setAuditLogs(prev => [newLog, ...prev]);

    return newEquipment;
  };

  const updateEquipment = (item: Equipment) => {
    const updated = equipments.map(e => e.id === item.id ? item : e);
    setEquipments(updated);
    pushHistory(updated, cables);
    if (selectedObject?.data.id === item.id) {
      setSelectedObject({ type: 'equipment', data: item });
    }
    showToast('success', 'Equipment Updated', `Saved modifications for ${item.id}`);
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
    });
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
    showToast('success', 'Splice Recorded', `${splice.inputCableId} core ${splice.inputCore} → ${splice.outputCableId} core ${splice.outputCore}`);
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
      showToast('info', 'Biker Road Route Ready', `Navigating to ${dests[dests.length - 1]?.name || dests[dests.length - 1]?.id} · ${(totalMeters / 1000).toFixed(2)} km · ~${Math.ceil(durationSeconds / 60)} min`);
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

  const addBikerWaypoint = (asset: BikerWaypoint) => {
    setBikerWaypoints(prev => prev.some(p => p.id === asset.id) ? prev : [...prev, asset]);
    const origin: BikerWaypoint = selectedObject?.data?.lat
      ? { id: selectedObject.data.id, name: selectedObject.data.name, lat: selectedObject.data.lat, lng: selectedObject.data.lng }
      : { id: 'OLT-01', name: 'Central Telco Hub OLT-01', lat: 12.9352, lng: 77.6245 };
    const next = bikerWaypoints.some(p => p.id === asset.id) ? bikerWaypoints : [...bikerWaypoints, asset];
    decodePolyline(origin, next);
  };

  const navigateToAsset = (asset: BikerWaypoint) => {
    setBikerWaypoints([asset]);
    const origin: BikerWaypoint = selectedObject?.data?.lat
      ? { id: selectedObject.data.id, name: selectedObject.data.name, lat: selectedObject.data.lat, lng: selectedObject.data.lng }
      : { id: 'OLT-01', name: 'Central Telco Hub OLT-01', lat: 12.9352, lng: 77.6245 };
    decodePolyline(origin, [asset]);
    flyToLocation(asset.lat, asset.lng, 16);
  };

  const clearBikerRoute = () => {
    setBikerWaypoints([]);
    setBikerRoute(null);
  };

  const deleteEquipment = (id: string): boolean => {
    if (!window.confirm(`Delete equipment ${id}? This cannot be undone in the prototype.`)) return false;
    // Check if cables are connected
    const connectedCables = cables.filter(c => c.startEquipmentId === id || c.endEquipmentId === id);
    if (connectedCables.length > 0) {
      showToast('error', 'Cannot Delete Equipment', `Cannot delete ${id} because it is connected to ${connectedCables.length} active cable(s) (${connectedCables.map(c => c.id).join(', ')}). Disconnect cables first.`);
      return false;
    }

    const updated = equipments.filter(e => e.id !== id);
    setEquipments(updated);
    pushHistory(updated, cables);
    if (selectedObject?.data.id === id) {
      setSelectedObject(null);
    }
    showToast('info', 'Equipment Deleted', `Removed ${id} from network infrastructure`);
    return true;
  };

  // Add Cable with automatic fiber core generation and length calculation
  const addCable = (item: Partial<Cable> & { name: string; type: CableType; coordinates: [number, number][] }): Cable | null => {
    const newId = item.id || `CBL-${Date.now().toString().slice(-5)}`;

    if (cables.some(c => c.id.toLowerCase() === newId.toLowerCase())) {
      showToast('error', 'Duplicate Cable ID', `Cable with ID "${newId}" already exists.`);
      return null;
    }

    if (!item.coordinates || item.coordinates.length < 2) {
      showToast('error', 'Invalid Route', 'Cable must have at least 2 geographic route points.');
      return null;
    }

    // Calculate approximate length in meters from lat/lng
    let totalLengthMeters = 0;
    for (let i = 0; i < item.coordinates.length - 1; i++) {
      const [lat1, lon1] = item.coordinates[i];
      const [lat2, lon2] = item.coordinates[i + 1];
      const R = 6371e3; // metres
      const φ1 = lat1 * Math.PI / 180;
      const φ2 = lat2 * Math.PI / 180;
      const Δφ = (lat2 - lat1) * Math.PI / 180;
      const Δλ = (lon2 - lon1) * Math.PI / 180;
      const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
                Math.cos(φ1) * Math.cos(φ2) *
                Math.sin(Δλ/2) * Math.sin(Δλ/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      totalLengthMeters += R * c;
    }

    const fiberCount = item.fiberCount || (item.type.includes('Feeder') ? 48 : item.type.includes('Distribution') ? 24 : 12);
    
    // Generate cores
    const cores = item.cores || Array.from({ length: fiberCount }, (_, i) => {
      const num = i + 1;
      const color = (num - 1) % 12;
      const colorNames = ['Blue', 'Orange', 'Green', 'Brown', 'Slate', 'White', 'Red', 'Black', 'Yellow', 'Violet', 'Rose', 'Aqua'];
      const colorHexes = ['#0284c7', '#ea580c', '#16a34a', '#78350f', '#64748b', '#f8fafc', '#dc2626', '#1e293b', '#eab308', '#8b5cf6', '#f43f5e', '#06b6d4'];
      return {
        coreNumber: num,
        tubeNumber: Math.floor(i / 12) + 1,
        colorName: colorNames[color],
        colorHex: colorHexes[color],
        status: 'Available' as const,
        remarks: 'Freshly installed unallocated core'
      };
    });

    const newCable: Cable = {
      id: newId,
      name: item.name,
      type: item.type,
      fiberCount,
      lengthMeters: Math.round(totalLengthMeters),
      installationType: item.installationType || (item.type.includes('Underground') ? 'Underground' : 'Aerial'),
      owner: item.owner || 'Metropolitan Fiber Corp',
      installationDate: new Date().toISOString().split('T')[0],
      status: 'Active',
      remarks: item.remarks || 'Drawn via interactive GIS route wizard',
      coordinates: item.coordinates,
      startEquipmentId: item.startEquipmentId,
      endEquipmentId: item.endEquipmentId,
      cores,
      cableCategory: item.type === 'Coaxial Cable' ? 'Coaxial' : 'Fiber'
    };

    const updated = [...cables, newCable];
    setCables(updated);
    pushHistory(equipments, updated);
    showToast('success', 'Fiber Cable Created', `Mapped ${newCable.name} (${newCable.lengthMeters}m, ${newCable.fiberCount} cores)`);
    return newCable;
  };

  const updateCable = (item: Cable) => {
    const updated = cables.map(c => c.id === item.id ? item : c);
    setCables(updated);
    pushHistory(equipments, updated);
    if (selectedObject?.data.id === item.id) {
      setSelectedObject({ type: 'cable', data: item });
    }
    showToast('success', 'Cable Updated', `Saved cable specifications for ${item.id}`);
  };

  const deleteCable = (id: string): boolean => {
    if (!window.confirm(`Delete cable ${id} and its core inventory?`)) return false;
    const updated = cables.filter(c => c.id !== id);
    setCables(updated);
    pushHistory(equipments, updated);
    if (selectedObject?.data.id === id) {
      setSelectedObject(null);
    }
    showToast('info', 'Cable Deleted', `Removed cable ${id} from map`);
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
    updateCable(updatedCable);
    showToast('success', 'Fiber Core Allocated', `Core ${coreNumber.toString().padStart(2, '0')} (${core.colorName}) allocated to ${customerId || equipmentId}`);
    return true;
  };

  // Connect customer to port with strict single physical connection enforcement
  const connectCustomerToPort = (customerData: Partial<Customer>): Customer | null => {
    const newId = customerData.id || `CUST-0${(customers.length + 1).toString().padStart(2, '0')}`;

    if (!customerData.terminalBoxId || !customerData.splitterId || !customerData.splitterOutputPort) {
      showToast('error', 'Missing Connection Target', 'Please specify Terminal Box, Splitter, and Output Port.');
      return null;
    }

    // Verify splitter port availability
    const splitter = splitters.find(s => s.id === customerData.splitterId);
    if (!splitter) {
      showToast('error', 'Splitter Not Found', `Splitter ${customerData.splitterId} does not exist.`);
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

    // Allocate port
    const updatedOutputPorts = splitter.outputPorts.map(p => {
      if (p.portNumber === customerData.splitterOutputPort) {
        return {
          ...p,
          status: 'Occupied' as const,
          connectedCustomerId: newId,
          connectedCustomerName: customerData.name || 'New Customer',
          connectedDropCableId: customerData.dropCableId || `DROP-${newId.slice(-3)}`
        };
      }
      return p;
    });

    const updatedSplitter = { ...splitter, outputPorts: updatedOutputPorts };
    setSplitters(prev => prev.map(s => s.id === splitter.id ? updatedSplitter : s));

    // Create customer record
    const newCustomer: Customer = {
      id: newId,
      name: customerData.name || 'New Subscriber',
      mobile: customerData.mobile || '+91 98000 00000',
      address: customerData.address || 'Street Address',
      area: customerData.area || 'Koramangala',
      building: customerData.building,
      flatNumber: customerData.flatNumber,
      lat: customerData.lat || 12.9360,
      lng: customerData.lng || 77.6295,
      serviceType: customerData.serviceType || 'Fiber Broadband',
      plan: customerData.plan || 'FTTH Ultra 300 Mbps',
      status: 'Active',
      installationDate: new Date().toISOString().split('T')[0],
      oltId: customerData.oltId || 'OLT-01',
      ponPort: customerData.ponPort || 'PON-01',
      feederCableId: customerData.feederCableId || 'CBL-FEEDER-01',
      distributionCableId: customerData.distributionCableId || 'CBL-DIST-01',
      terminalBoxId: customerData.terminalBoxId,
      splitterId: customerData.splitterId,
      splitterOutputPort: customerData.splitterOutputPort,
      dropCableId: customerData.dropCableId || `DROP-${newId.slice(-3)}`,
      fiberCore: customerData.fiberCore || 1,
      ontSerialNumber: customerData.ontSerialNumber || `ONT-${Date.now().toString().slice(-6)}`,
      routerModel: customerData.routerModel || 'Dual-Band Wi-Fi 6 ONT',
      ipAddress: customerData.ipAddress || `100.64.${Math.floor(Math.random() * 20) + 10}.${Math.floor(Math.random() * 250) + 2}`,
      rxOpticalPowerDbm: -(18 + +(Math.random() * 3).toFixed(1))
    };

    setCustomers(prev => [...prev, newCustomer]);
    
    // Confetti celebration!
    confetti({
      particleCount: 80,
      spread: 70,
      origin: { y: 0.6 }
    });

    showToast('success', 'Customer Connected Successfully!', `Activated ${newCustomer.name} on ${newCustomer.terminalBoxId} (Port ${newCustomer.splitterOutputPort})`);
    return newCustomer;
  };

  // Upload Photo to Equipment
  const uploadEquipmentPhoto = (equipmentId: string, photo: Partial<EquipmentImage>) => {
    const eq = equipments.find(e => e.id === equipmentId);
    if (!eq) return;

    const newPhoto: EquipmentImage = {
      id: photo.id || `IMG-${Date.now()}`,
      equipmentId,
      url: photo.url || SAMPLE_EQUIPMENT[0].images[0]?.url,
      name: photo.name || 'Terminal Box Field Photo',
      category: photo.category || 'Internal Trays',
      uploadDate: new Date().toISOString().split('T')[0],
      uploadedBy: photo.uploadedBy || `${userRole} User`,
      description: photo.description || 'Uploaded field verification photograph',
      annotations: photo.annotations || []
    };

    const updatedEq = {
      ...eq,
      images: [...eq.images, newPhoto]
    };

    updateEquipment(updatedEq);
    showToast('success', 'Photograph Uploaded', `Added ${newPhoto.name} to ${equipmentId}`);
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

    updateEquipment({ ...eq, images: updatedImages });
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

    updateEquipment({ ...eq, images: updatedImages });
    showToast('info', 'Annotation Removed', 'Deleted port mark from photograph');
  };

  // Trace Fiber Route
  const traceNetworkPath = (targetId: string) => {
    // Check if target is a Customer
    const customer = customers.find(c => c.id === targetId);
    if (customer) {
      const nodes: TracePathNode[] = [
        { type: 'OLT', id: customer.oltId, name: `Central OLT (${customer.oltId})`, details: `PON Port: ${customer.ponPort}`, status: 'Normal' },
        { type: 'PON', id: customer.ponPort, name: `PON Port ${customer.ponPort}`, details: `Tx Power: +3.2 dBm | Max Splits: 64`, status: 'Normal' },
        { type: 'ODF', id: 'ODF-01', name: 'Optical Frame ODF-01', details: 'Tray 02 / Port 04', status: 'Normal' },
        { type: 'Feeder', id: customer.feederCableId, name: `Feeder Cable (${customer.feederCableId})`, details: '96F Underground Trunk | 620m', status: 'Normal' },
        { type: 'FDMS', id: 'FDMS-01', name: 'Primary Cabinet FDMS-01', details: 'Cross-connect Port 12', status: 'Normal' },
        { type: 'Distribution', id: customer.distributionCableId, name: `Dist Cable (${customer.distributionCableId})`, details: '24F ADSS Aerial | 380m', status: 'Normal' },
        { type: 'FDT', id: 'FDT-01', name: 'Commercial FDT-01', details: 'Branch Termination Box', status: 'Normal' },
        { type: 'Splitter', id: customer.splitterId, name: `Splitter (${customer.splitterId})`, details: `Ratio: 1:8 | Port ${customer.splitterOutputPort} | Loss: 10.3 dB`, status: 'Normal' },
        { type: 'FAT', id: customer.terminalBoxId, name: `Access Terminal (${customer.terminalBoxId})`, details: 'Pole Mounted Enclosure', status: 'Normal' },
        { type: 'Drop', id: customer.dropCableId, name: `Drop Cable (${customer.dropCableId})`, details: '2F Outdoor Drop Flat Cable | 45m', status: 'Normal' },
        { type: 'ONT', id: customer.ontSerialNumber, name: `Customer ONT (${customer.ontSerialNumber})`, details: `Model: ${customer.routerModel} | Rx: ${customer.rxOpticalPowerDbm} dBm`, status: 'Normal' },
        { type: 'Customer', id: customer.id, name: customer.name, details: `${customer.serviceType} | ${customer.plan} | IP: ${customer.ipAddress}`, status: 'Normal' }
      ];

      // Check if any cable on path has active fault
      const fault = faults.find(f => f.affectedCableId === customer.distributionCableId || f.affectedEquipmentId === customer.terminalBoxId);
      if (fault) {
        nodes.forEach(n => {
          if (n.id === fault.affectedCableId || n.id === fault.affectedEquipmentId) {
            n.status = 'Faulty';
            n.details += ` [CRITICAL FAULT: ${fault.type}]`;
          }
        });
      }

      setActiveTracePath(nodes);
      setActiveTraceCableIds([customer.feederCableId, customer.distributionCableId, 'CBL-BRANCH-01', customer.dropCableId]);
      setActiveTraceEquipmentIds([customer.oltId, 'ODF-01', 'FDMS-01', 'FDT-01', customer.terminalBoxId]);
      setIsRouteTraceModalOpen(true);
      showToast('info', 'Fiber Trace Active', `Tracing complete path from ${customer.oltId} to ${customer.name}`);
      return;
    }

    // Check if target is an Equipment
    const eq = equipments.find(e => e.id === targetId);
    if (eq) {
      const connectedCables = cables.filter(c => c.startEquipmentId === eq.id || c.endEquipmentId === eq.id);
      setActiveTraceEquipmentIds([eq.id]);
      setActiveTraceCableIds(connectedCables.map(c => c.id));
      showToast('info', 'Equipment Trace', `Tracing connections for ${eq.name}`);
    }
  };

  const clearTrace = () => {
    setActiveTracePath(null);
    setActiveTraceCableIds([]);
    setActiveTraceEquipmentIds([]);
  };

  // Fault Management
  const recordNewFault = (faultData: Partial<Fault>) => {
    const newId = `FLT-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}`;
    const newFault: Fault = {
      id: newId,
      title: faultData.title || 'Fiber Network Outage Detected',
      type: faultData.type || 'Fiber Cut',
      severity: faultData.severity || 'Critical',
      status: 'Reported',
      affectedLocation: faultData.affectedLocation || { lat: 12.9365, lng: 77.6290 },
      affectedCableId: faultData.affectedCableId,
      affectedEquipmentId: faultData.affectedEquipmentId,
      affectedCustomerIds: faultData.affectedCustomerIds || [],
      affectedCores: faultData.affectedCores || [],
      affectedSplitterPorts: faultData.affectedSplitterPorts || [],
      description: faultData.description || 'Reported via field inspection',
      reportedAt: new Date().toLocaleString(),
      assignedTechnician: 'Arun Varma (Lead Splicer)',
      images: faultData.images || []
    };

    setFaults(prev => [newFault, ...prev]);
    showToast('error', 'Network Fault Logged', `Registered ${newFault.type} (${newFault.id}) with severity: ${newFault.severity}`);
  };

  const resolveExistingFault = (faultId: string) => {
    setFaults(prev => prev.map(f => f.id === faultId ? { ...f, status: 'Resolved', resolvedAt: new Date().toLocaleString() } : f));
    showToast('success', 'Fault Resolved', `Outage ${faultId} marked resolved.`);
  };

  const updateWorkOrderStatus = (workOrderId: string, status: WorkOrder['status']) => {
    setWorkOrders(prev => prev.map(w => w.id === workOrderId ? { ...w, status, completedDate: status === 'Completed' ? new Date().toISOString().split('T')[0] : w.completedDate } : w));
    showToast('success', 'Work Order Updated', `Work Order ${workOrderId} status changed to ${status}`);
  };

  // Zone Management Methods
  const addZone = (zone: Partial<NetworkZone> & { name: string; areaCode: string }): NetworkZone => {
    const newZone: NetworkZone = {
      id: zone.id || `ZONE-${Date.now().toString().slice(-4)}`,
      name: zone.name,
      areaCode: zone.areaCode,
      coverageSqKm: zone.coverageSqKm || 2.5,
      homePassed: zone.homePassed || 1200,
      connectedCustomers: zone.connectedCustomers || 0,
      feederCableCount: zone.feederCableCount || 1,
      fatCount: zone.fatCount || 4,
      penetrationRatePct: zone.penetrationRatePct || 0,
      status: zone.status || 'Expansion',
      boundaryCoords: zone.boundaryCoords || [
        [12.935, 77.625],
        [12.942, 77.625],
        [12.942, 77.632],
        [12.935, 77.632]
      ]
    };
    setZones(prev => [...prev, newZone]);
    showToast('success', 'Network Zone Added', `Created zone ${newZone.name} (${newZone.areaCode})`);
    return newZone;
  };

  const updateZone = (zone: NetworkZone) => {
    setZones(prev => prev.map(z => z.id === zone.id ? zone : z));
    showToast('success', 'Zone Updated', `Saved changes for zone ${zone.name}`);
  };

  const deleteZone = (id: string) => {
    setZones(prev => prev.filter(z => z.id !== id));
    showToast('info', 'Zone Removed', `Deleted zone ${id}`);
  };

  // Document Management Methods
  const addDocument = (doc: Partial<NetworkDocument> & { title: string; category: NetworkDocument['category'] }): NetworkDocument => {
    const newDoc: NetworkDocument = {
      id: doc.id || `DOC-${Date.now().toString().slice(-4)}`,
      title: doc.title,
      category: doc.category,
      equipmentId: doc.equipmentId,
      cableId: doc.cableId,
      uploadedBy: doc.uploadedBy || `${userRole} User`,
      uploadDate: new Date().toISOString().split('T')[0],
      fileSizeKb: doc.fileSizeKb || Math.floor(Math.random() * 2000) + 300,
      url: doc.url || '#'
    };
    setDocuments(prev => [newDoc, ...prev]);
    showToast('success', 'Document Uploaded', `Added ${newDoc.title} to repository`);
    return newDoc;
  };

  const deleteDocument = (id: string) => {
    setDocuments(prev => prev.filter(d => d.id !== id));
    showToast('info', 'Document Deleted', 'Removed document from repository');
  };

  // Backup & Restore
  const backupSystem = () => {
    const backupData = {
      version: '2.0.0',
      timestamp: new Date().toISOString(),
      equipments,
      cables,
      splitters,
      closures,
      customers,
      faults,
      workOrders,
      zones,
      documents
    };
    const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fiber_gis_backup_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('success', 'Backup Exported', 'Full network database downloaded as JSON.');
  };

  const restoreSystem = (jsonString: string): boolean => {
    try {
      const data = JSON.parse(jsonString);
      if (data.equipments) setEquipments(data.equipments);
      if (data.cables) setCables(data.cables);
      if (data.splitters) setSplitters(data.splitters);
      if (data.closures) setClosures(data.closures);
      if (data.customers) setCustomers(data.customers);
      if (data.faults) setFaults(data.faults);
      if (data.workOrders) setWorkOrders(data.workOrders);
      if (data.zones) setZones(data.zones);
      if (data.documents) setDocuments(data.documents);
      showToast('success', 'System Restored', 'Network database restored successfully!');
      return true;
    } catch (e) {
      showToast('error', 'Restore Failed', 'Invalid backup file format.');
      return false;
    }
  };

  // Google Earth KML Export
  const exportKML = () => {
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
        <name>${eq.name} (${eq.id})</name>
        <description>Type: ${eq.type} | Area: ${eq.area} | Status: ${eq.status}</description>
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
      const coordsStr = cb.coordinates.map(pt => `${pt[1]},${pt[0]},0`).join(' ');
      kml += `
      <Placemark>
        <name>${cb.name} (${cb.id})</name>
        <description>Type: ${cb.type} | Length: ${cb.lengthMeters}m | Cores: ${cb.fiberCount}</description>
        <LineString>
          <extrude>1</extrude>
          <tessellate>1</tessellate>
          <coordinates>${coordsStr}</coordinates>
        </LineString>
      </Placemark>`;
    });

    kml += `
    </Folder>
  </Document>
</kml>`;

    const blob = new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fiber_gis_network_${new Date().toISOString().split('T')[0]}.kml`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('success', 'KML Export Complete', 'Downloaded Google Earth KML file.');
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
        updateWorkOrderStatus,
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
