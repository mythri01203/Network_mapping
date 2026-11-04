export type UserRole = 'Administrator' | 'Network Engineer' | 'Network Operator' | 'Field Technician' | 'Supervisor';

export type MainView =
  | 'map'
  | 'topology'
  | 'olt_rack'
  | 'inventory'
  | 'customers'
  | 'cables'
  | 'cable_tv'
  | 'field'
  | 'operations'
  | 'zones'
  | 'admin';

export interface NetworkZone {
  id: string;
  name: string;
  areaCode: string;
  coverageSqKm: number;
  homePassed: number;
  connectedCustomers: number;
  feederCableCount: number;
  fatCount: number;
  penetrationRatePct: number;
  status: 'Operational' | 'Expansion' | 'Planned';
  boundaryCoords: [number, number][];
}

export interface NetworkDocument {
  id: string;
  title: string;
  category: 'Datasheet' | 'OTDR Trace' | 'Inspection Report' | 'As-Built CAD' | 'Lease Agreement';
  equipmentId?: string;
  cableId?: string;
  uploadedBy: string;
  uploadDate: string;
  fileSizeKb: number;
  url?: string;
}

export type EquipmentCategory =
  | 'Central Office'
  | 'Fiber Distribution'
  | 'Supporting Infrastructure'
  | 'Customer Equipment'
  | 'Cable TV Infrastructure';

export type EquipmentType =
  // Central Office
  | 'OLT'
  | 'ODF'
  | 'Fiber Patch Panel'
  | 'Core Switch'
  | 'Router'
  | 'Firewall'
  | 'Optical Transmitter'
  | 'Headend Equipment'
  // Fiber Distribution
  | 'FDMS'
  | 'FDT'
  | 'FAT'
  | 'Fiber Distribution Cabinet'
  | 'Fiber Terminal Box'
  | 'Pole-Mounted Terminal Box'
  | 'Wall-Mounted Terminal Box'
  | 'Underground Terminal Box'
  | 'Fiber Splitter'
  | 'Fiber Joint Closure'
  | 'Splice Closure'
  | 'Distribution Point'
  // Supporting Infrastructure
  | 'Telecom Pole'
  | 'Electric Pole'
  | 'Manhole'
  | 'Handhole'
  | 'Underground Chamber'
  | 'Duct'
  | 'Microduct'
  | 'Cable Tray'
  | 'Building Entry Point'
  | 'Junction Point'
  // Customer Equipment
  | 'ONT'
  | 'ONU'
  | 'Wi-Fi Router'
  | 'Optical Modem'
  | 'Customer Terminal'
  | 'Set-Top Box'
  // Cable TV
  | 'Cable TV Headend'
  | 'CATV Optical Node'
  | 'CATV RF Amplifier'
  | 'CATV Tap-Off Box';

export type EquipmentStatus = 'Active' | 'Warning' | 'Faulty' | 'Maintenance' | 'Planned';

export type PonTechnology = 'GPON' | 'EPON' | 'Combo PON' | 'XG-PON' | 'XGS-PON' | '10G-EPON';

export type RouteStatus = 'Proposed' | 'Under Construction' | 'Active' | 'Maintenance' | 'Planned';

export type LogicalPortStatus = 'Used' | 'Available' | 'Reserved' | 'Damaged' | 'Unverified';

export interface EquipmentPort {
  id: string;
  portNumber: number;
  portType: string;
  technology?: PonTechnology | 'GE' | '10GE';
  slotCardPort?: string; // e.g. "0/1/1"
  status: LogicalPortStatus;
  connectedEquipmentId?: string;
  connectedSplitterId?: string;
  connectedCableId?: string;
  connectedCore?: number;
  customerId?: string;
  connectedOntCount?: number;
  assignedDate?: string;
  remarks?: string;
}

export interface OpticalPowerSample {
  timestamp: string;
  txPowerDbm?: number;
  rxPowerDbm?: number;
}

export interface OpticalPowerInfo {
  dataSource: 'simulated_sample';
  lastUpdated: string;
  txPowerDbm?: number;
  rxPowerDbm?: number;
  signalLevel: 'Normal' | 'Warning' | 'Critical' | 'Unavailable';
  txMinDbm: number;
  txMaxDbm: number;
  rxMinDbm: number;
  rxWarnDbm: number;
  rxCriticalDbm: number;
  history: OpticalPowerSample[];
}

export interface CatalogComponent {
  id: string;
  type: EquipmentType | string;
  category: EquipmentCategory | string;
  name: string;
  description: string;
  defaultPorts?: number;
  iconBg: string;
  isCustom?: boolean;
}

export interface ImageAnnotation {
  id: string;
  type: 'port_circle' | 'port_box' | 'arrow' | 'label';
  x: number; // percentage 0-100
  y: number; // percentage 0-100
  width?: number; // percentage
  height?: number; // percentage
  label: string;
  portNumber?: number;
  status?: 'Available' | 'Occupied' | 'Reserved' | 'Faulty';
  remarks?: string;
  color?: string;
}

export interface EquipmentImage {
  id: string;
  equipmentId: string;
  url: string;
  name: string;
  category:
    | 'Front View'
    | 'Internal Trays'
    | 'Splitter Layout'
    | 'Port Connections'
    | 'Pole/Mount'
    | 'Maintenance'
    | 'Fault Evidence';
  uploadDate: string;
  uploadedBy: string;
  description: string;
  annotations: ImageAnnotation[];
}

export interface Equipment {
  id: string;
  name: string;
  type: EquipmentType;
  category: EquipmentCategory;
  lat: number;
  lng: number;
  area: string;
  street: string;
  poleNumber?: string;
  buildingName?: string;
  status: EquipmentStatus;
  technology?: PonTechnology;
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  ipAddress?: string;
  totalPorts?: number;
  usedPorts?: number;
  availablePorts?: number;
  rackNumber?: string;
  shelfNumber?: string;
  slotNumber?: string;
  ponCardsCount?: number;
  ponPorts?: Array<{
    id: string;
    portNumber: number;
    slotCardPort?: string;
    technology?: PonTechnology;
    status: 'Active' | 'Available' | 'Faulty' | 'Reserved';
    connectedFeederCableId?: string;
    connectedSplitterId?: string;
    connectedCustomersCount: number;
    connectedOntCount?: number;
    signalDbm?: number;
    txPowerDbm?: number;
    rxPowerDbm?: number;
    lastUpdated?: string;
  }>;
  logicalPorts?: EquipmentPort[];
  opticalPower?: OpticalPowerInfo;
  uptimeHours?: number;
  splitterConfig?: {
    ratio: '1:2' | '1:4' | '1:8' | '1:16' | '1:32' | '1:64';
    splitterCount: number;
  };
  rfLevelDbf?: number; // for Cable TV Node/Amp
  images: EquipmentImage[];
  notes?: string;
  installedDate: string;
}

export type CableType =
  | 'Main Feeder Fiber'
  | 'Distribution Fiber'
  | 'Drop Fiber'
  | 'Aerial Fiber'
  | 'Underground Fiber'
  | 'Coaxial Cable'
  | 'Custom Cable';

export type CableStatus = 'Active' | 'Maintenance' | 'Damaged' | 'Planned';

export type CoreStatus = 'Available' | 'In Use' | 'Reserved' | 'Damaged' | 'Under Maintenance' | 'Unverified';

export interface FiberCore {
  coreNumber: number;
  tubeNumber: number;
  colorName: string;
  colorHex: string;
  status: CoreStatus;
  connectedToEquipmentId?: string;
  connectedToEquipmentName?: string;
  connectedPort?: string;
  spliceTargetCableId?: string;
  spliceTargetCore?: number;
  customerId?: string;
  customerName?: string;
  attenuationDb?: number;
  remarks?: string;
}

export interface Cable {
  id: string;
  name: string;
  type: CableType;
  manufacturer?: string;
  model?: string;
  fiberCount: number;
  lengthMeters: number;
  installationType: 'Aerial' | 'Underground' | 'Duct' | 'Direct Buried' | 'Facade';
  owner: string;
  installationDate: string;
  status: CableStatus;
  routeStatus?: RouteStatus;
  remarks?: string;
  coordinates: [number, number][]; // [lat, lng]
  startEquipmentId?: string;
  endEquipmentId?: string;
  cores: FiberCore[];
  cableCategory: 'Fiber' | 'Coaxial';
}

export interface SplitterPort {
  portNumber: number;
  label: string;
  status: 'Available' | 'Occupied' | 'Reserved' | 'Faulty';
  connectedCustomerId?: string;
  connectedCustomerName?: string;
  connectedDropCableId?: string;
  attenuationDb?: number;
}

export interface Splitter {
  id: string;
  name: string;
  terminalBoxId: string;
  ratio: '1:2' | '1:4' | '1:8' | '1:16' | '1:32' | '1:64';
  insertionLossDb: number;
  status: 'Active' | 'Faulty' | 'Maintenance';
  inputPort: {
    id: string;
    connectedCableId?: string;
    connectedCore?: number;
    signalLevelDbm?: number;
  };
  outputPorts: SplitterPort[];
}

export interface SpliceRecord {
  id: string;
  inputCableId: string;
  inputCableName: string;
  inputCore: number;
  outputCableId: string;
  outputCableName: string;
  outputCore: number;
  spliceLossDb: number;
  status: 'Pending' | 'Spliced' | 'Tested' | 'Failed' | 'Unused' | 'Damaged';
  technician: string;
  date: string;
}

export interface JointClosure {
  id: string;
  name: string;
  closureType: 'Dome Splice Closure' | 'Horizontal In-line' | 'Fiber Distribution Hub';
  lat: number;
  lng: number;
  area: string;
  cableAId?: string;
  cableBId?: string;
  entryPortsCount: number;
  exitPortsCount: number;
  installationDate: string;
  technician: string;
  splices: SpliceRecord[];
  images: EquipmentImage[];
  remarks?: string;
}

export interface Customer {
  id: string;
  name: string;
  mobile: string;
  address: string;
  area: string;
  building?: string;
  flatNumber?: string;
  lat: number;
  lng: number;
  serviceType: 'Fiber Broadband' | 'Triple Play' | 'Cable TV' | 'Enterprise Fiber';
  plan: string;
  status: 'Active' | 'Suspended' | 'Disconnected' | 'Pending Installation';
  installationDate: string;
  // Logical connections
  oltId: string;
  ponPort: string;
  feederCableId: string;
  distributionCableId: string;
  terminalBoxId: string;
  splitterId: string;
  splitterOutputPort: number;
  dropCableId: string;
  fiberCore: number;
  ontSerialNumber: string;
  routerModel: string;
  ipAddress: string;
  rxOpticalPowerDbm: number;
}

export interface Fault {
  id: string;
  title: string;
  type:
    | 'Fiber Cut'
    | 'Cable Damage'
    | 'High Attenuation'
    | 'Low Optical Signal'
    | 'Equipment Failure'
    | 'Splitter Failure'
    | 'Port Failure'
    | 'Power Failure'
    | 'Customer Disconnection';
  severity: 'Critical' | 'High' | 'Medium' | 'Low';
  status: 'Reported' | 'Investigating' | 'Dispatched' | 'In Progress' | 'Resolved';
  affectedLocation: { lat: number; lng: number };
  affectedEquipmentId?: string;
  affectedCableId?: string;
  affectedCustomerIds: string[];
  affectedCores: number[];
  affectedSplitterPorts: number[];
  description: string;
  reportedAt: string;
  resolvedAt?: string;
  assignedTechnician?: string;
  workOrderId?: string;
  images: string[];
}

export interface WorkOrder {
  id: string;
  title: string;
  type: 'Repair' | 'Installation' | 'Inspection' | 'Maintenance' | 'Splice Verification';
  priority: 'Critical' | 'High' | 'Medium' | 'Low';
  status: 'Pending' | 'Assigned' | 'In Progress' | 'Completed' | 'Cancelled';
  technicianName: string;
  technicianPhone: string;
  equipmentId?: string;
  cableId?: string;
  customerId?: string;
  faultId?: string;
  scheduledDate: string;
  completedDate?: string;
  notes: string;
  photos: string[];
}

export interface AuditLog {
  id: string;
  timestamp: string;
  user: string;
  role: UserRole;
  action: string;
  details: string;
  assetId: string;
  assetType:
    'Equipment' | 'Cable' | 'Core' | 'Customer' | 'Fault' | 'WorkOrder' | 'Zone' | 'Document' | 'Closure' | 'System';
}

export interface TracePathNode {
  type:
    | 'OLT'
    | 'PON'
    | 'ODF'
    | 'Feeder'
    | 'FDMS'
    | 'Distribution'
    | 'Closure'
    | 'FDT'
    | 'Splitter'
    | 'FAT'
    | 'Drop'
    | 'ONT'
    | 'Customer'
    | 'Equipment';
  id: string;
  name: string;
  details: string;
  status: 'Normal' | 'Warning' | 'Faulty';
  lat?: number;
  lng?: number;
  lengthMeters?: number;
  lossDb?: number;
  cumulativeLossDb?: number;
}
