import { z } from 'zod';

export const USER_ROLES = [
  'Administrator',
  'Network Engineer',
  'Network Operator',
  'Field Technician',
  'Supervisor',
] as const;
export const userRoleSchema = z.enum(USER_ROLES);
export type UserRole = z.infer<typeof userRoleSchema>;

export const EQUIPMENT_CATEGORIES = [
  'Central Office',
  'Fiber Distribution',
  'Supporting Infrastructure',
  'Customer Equipment',
  'Cable TV Infrastructure',
] as const;
export const equipmentCategorySchema = z.enum(EQUIPMENT_CATEGORIES);
export type EquipmentCategory = z.infer<typeof equipmentCategorySchema>;

/** Equipment types grouped by the category they belong to. */
export const EQUIPMENT_TYPES_BY_CATEGORY = {
  'Central Office': [
    'OLT',
    'ODF',
    'Fiber Patch Panel',
    'Core Switch',
    'Router',
    'Firewall',
    'Optical Transmitter',
    'Headend Equipment',
  ],
  'Fiber Distribution': [
    'FDMS',
    'FDT',
    'FAT',
    'Fiber Distribution Cabinet',
    'Fiber Terminal Box',
    'Pole-Mounted Terminal Box',
    'Wall-Mounted Terminal Box',
    'Underground Terminal Box',
    'Fiber Splitter',
    'Fiber Joint Closure',
    'Splice Closure',
    'Distribution Point',
  ],
  'Supporting Infrastructure': [
    'Telecom Pole',
    'Electric Pole',
    'Manhole',
    'Handhole',
    'Underground Chamber',
    'Duct',
    'Microduct',
    'Cable Tray',
    'Building Entry Point',
    'Junction Point',
  ],
  'Customer Equipment': ['ONT', 'ONU', 'Wi-Fi Router', 'Optical Modem', 'Customer Terminal', 'Set-Top Box'],
  'Cable TV Infrastructure': ['Cable TV Headend', 'CATV Optical Node', 'CATV RF Amplifier', 'CATV Tap-Off Box'],
} as const satisfies Record<EquipmentCategory, readonly string[]>;

export const EQUIPMENT_TYPES = Object.values(EQUIPMENT_TYPES_BY_CATEGORY).flat() as [EquipmentType, ...EquipmentType[]];
export type EquipmentType = (typeof EQUIPMENT_TYPES_BY_CATEGORY)[EquipmentCategory][number];
export const equipmentTypeSchema = z.enum(EQUIPMENT_TYPES);

export const EQUIPMENT_STATUSES = ['Active', 'Warning', 'Faulty', 'Maintenance', 'Planned'] as const;
export const equipmentStatusSchema = z.enum(EQUIPMENT_STATUSES);
export type EquipmentStatus = z.infer<typeof equipmentStatusSchema>;

export const PON_TECHNOLOGIES = ['GPON', 'EPON', 'Combo PON', 'XG-PON', 'XGS-PON', '10G-EPON'] as const;
export const ponTechnologySchema = z.enum(PON_TECHNOLOGIES);
export type PonTechnology = z.infer<typeof ponTechnologySchema>;

export const ROUTE_STATUSES = ['Proposed', 'Under Construction', 'Active', 'Maintenance', 'Planned'] as const;
export const routeStatusSchema = z.enum(ROUTE_STATUSES);
export type RouteStatus = z.infer<typeof routeStatusSchema>;

export const LOGICAL_PORT_STATUSES = ['Used', 'Available', 'Reserved', 'Damaged', 'Unverified'] as const;
export const logicalPortStatusSchema = z.enum(LOGICAL_PORT_STATUSES);
export type LogicalPortStatus = z.infer<typeof logicalPortStatusSchema>;

export const PORT_TECHNOLOGIES = [...PON_TECHNOLOGIES, 'GE', '10GE'] as const;
export const portTechnologySchema = z.enum(PORT_TECHNOLOGIES);
export type PortTechnology = z.infer<typeof portTechnologySchema>;

export const PON_PORT_STATUSES = ['Active', 'Available', 'Faulty', 'Reserved'] as const;
export const SIGNAL_LEVELS = ['Normal', 'Warning', 'Critical', 'Unavailable'] as const;
export const signalLevelSchema = z.enum(SIGNAL_LEVELS);
export type SignalLevel = z.infer<typeof signalLevelSchema>;

export const SPLITTER_RATIOS = ['1:2', '1:4', '1:8', '1:16', '1:32', '1:64'] as const;
export const splitterRatioSchema = z.enum(SPLITTER_RATIOS);
export type SplitterRatio = z.infer<typeof splitterRatioSchema>;

export const SPLITTER_STATUSES = ['Active', 'Faulty', 'Maintenance'] as const;
export const SPLITTER_PORT_STATUSES = ['Available', 'Occupied', 'Reserved', 'Faulty'] as const;
export const splitterPortStatusSchema = z.enum(SPLITTER_PORT_STATUSES);
export type SplitterPortStatus = z.infer<typeof splitterPortStatusSchema>;

export const CLOSURE_TYPES = ['Dome Splice Closure', 'Horizontal In-line', 'Fiber Distribution Hub'] as const;

export const CABLE_TYPES = [
  'Main Feeder Fiber',
  'Distribution Fiber',
  'Drop Fiber',
  'Aerial Fiber',
  'Underground Fiber',
  'Coaxial Cable',
  'Custom Cable',
] as const;
export const cableTypeSchema = z.enum(CABLE_TYPES);
export type CableType = z.infer<typeof cableTypeSchema>;

export const CABLE_STATUSES = ['Active', 'Maintenance', 'Damaged', 'Planned'] as const;
export const cableStatusSchema = z.enum(CABLE_STATUSES);
export type CableStatus = z.infer<typeof cableStatusSchema>;

export const CABLE_INSTALLATION_TYPES = ['Aerial', 'Underground', 'Duct', 'Direct Buried', 'Facade'] as const;
export const cableInstallationTypeSchema = z.enum(CABLE_INSTALLATION_TYPES);
export type CableInstallationType = z.infer<typeof cableInstallationTypeSchema>;

export const CABLE_CATEGORIES = ['Fiber', 'Coaxial'] as const;

export const CORE_STATUSES = ['Available', 'In Use', 'Reserved', 'Damaged', 'Under Maintenance', 'Unverified'] as const;
export const coreStatusSchema = z.enum(CORE_STATUSES);
export type CoreStatus = z.infer<typeof coreStatusSchema>;

export const FAULT_TYPES = [
  'Fiber Cut',
  'Cable Damage',
  'High Attenuation',
  'Low Optical Signal',
  'Equipment Failure',
  'Splitter Failure',
  'Port Failure',
  'Power Failure',
  'Customer Disconnection',
] as const;
export const faultTypeSchema = z.enum(FAULT_TYPES);
export type FaultType = z.infer<typeof faultTypeSchema>;

export const SEVERITIES = ['Critical', 'High', 'Medium', 'Low'] as const;
export const severitySchema = z.enum(SEVERITIES);
export type Severity = z.infer<typeof severitySchema>;

export const FAULT_STATUSES = ['Reported', 'Investigating', 'Dispatched', 'In Progress', 'Resolved'] as const;
export const faultStatusSchema = z.enum(FAULT_STATUSES);
export type FaultStatus = z.infer<typeof faultStatusSchema>;

export const WORK_ORDER_TYPES = ['Repair', 'Installation', 'Inspection', 'Maintenance', 'Splice Verification'] as const;
export const workOrderTypeSchema = z.enum(WORK_ORDER_TYPES);
export type WorkOrderType = z.infer<typeof workOrderTypeSchema>;

export const WORK_ORDER_STATUSES = ['Pending', 'Assigned', 'In Progress', 'Completed', 'Cancelled'] as const;
export const workOrderStatusSchema = z.enum(WORK_ORDER_STATUSES);
export type WorkOrderStatus = z.infer<typeof workOrderStatusSchema>;

export const SPLICE_STATUSES = ['Pending', 'Spliced', 'Tested', 'Failed', 'Unused', 'Damaged'] as const;
export const spliceStatusSchema = z.enum(SPLICE_STATUSES);
export type SpliceStatus = z.infer<typeof spliceStatusSchema>;

export const CUSTOMER_SERVICE_TYPES = ['Fiber Broadband', 'Triple Play', 'Cable TV', 'Enterprise Fiber'] as const;
export const CUSTOMER_STATUSES = ['Active', 'Suspended', 'Disconnected', 'Pending Installation'] as const;

export const DOCUMENT_CATEGORIES = [
  'Datasheet',
  'OTDR Trace',
  'Inspection Report',
  'As-Built CAD',
  'Lease Agreement',
] as const;

export const ZONE_STATUSES = ['Operational', 'Expansion', 'Planned'] as const;

export const IMAGE_CATEGORIES = [
  'Front View',
  'Internal Trays',
  'Splitter Layout',
  'Port Connections',
  'Pole/Mount',
  'Maintenance',
  'Fault Evidence',
] as const;

export const ANNOTATION_TYPES = ['port_circle', 'port_box', 'arrow', 'label'] as const;
export const ANNOTATION_STATUSES = ['Available', 'Occupied', 'Reserved', 'Faulty'] as const;

export const AUDIT_ASSET_TYPES = [
  'Equipment',
  'Cable',
  'Core',
  'Customer',
  'Fault',
  'WorkOrder',
  'Zone',
  'Document',
  'Closure',
  'System',
] as const;
