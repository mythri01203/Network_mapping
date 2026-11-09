import { z } from 'zod';

export const USER_ROLES = [
  'Administrator',
  'Network Engineer',
  'Network Operator',
  'Field Technician',
  'Supervisor',
  /** Phase 9: a look-only account. Never writes, so it never appears in audit entries it made. */
  'Viewer',
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
    'MikroTik Router',
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
    'Ratio Coupler',
    'Outdoor Splitter',
    'Fiber Connector',
    'Fiber Splice Joint',
    'Optical Attenuator',
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
    'Fiber Slack Loop',
  ],
  'Customer Equipment': [
    'ONT',
    'ONU',
    'Wi-Fi Router',
    'Optical Modem',
    'Customer Terminal',
    'Set-Top Box',
    'Optical Instrument',
  ],
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

/** Where an optical reading came from. Only the last two may ever be called measured. */
export const RX_SOURCES = ['designed', 'calculated', 'field_measured', 'device_reported'] as const;
export const rxSourceSchema = z.enum(RX_SOURCES);
export type RxSource = z.infer<typeof rxSourceSchema>;

/**
 * How a position was captured. `gps_averaged` is several phone readings averaged; `not_placed` means
 * no usable fix was found, so the stored point is only a rough placeholder the office must replace.
 */
export const LOCATION_METHODS = ['gps', 'gps_averaged', 'map_pick', 'typed', 'not_placed', 'imported'] as const;
export const locationMethodSchema = z.enum(LOCATION_METHODS);
export type LocationMethod = z.infer<typeof locationMethodSchema>;

export const LOCATION_METHOD_LABELS: Record<LocationMethod, string> = {
  gps: 'GPS',
  gps_averaged: 'GPS, several readings averaged',
  map_pick: 'Placed on map',
  typed: 'Typed',
  not_placed: 'No GPS fix: office must place this',
  imported: 'Imported from a file (accuracy not known)',
};

/** Who owns a pole, as far as a field worker can tell. Only the kind is recorded, never the company. */
export const POLE_OWNER_TYPES = ['telecom', 'electricity', 'unknown'] as const;
export const poleOwnerTypeSchema = z.enum(POLE_OWNER_TYPES);
export type PoleOwnerType = z.infer<typeof poleOwnerTypeSchema>;

export const POLE_MATERIALS = ['concrete', 'iron', 'wood', 'unknown'] as const;
export const poleMaterialSchema = z.enum(POLE_MATERIALS);
export type PoleMaterial = z.infer<typeof poleMaterialSchema>;

/**
 * How sure we are that an outside-plant link (span, attachment, duct) exists. `proposed` is only a
 * suggestion, such as two poles captured one after the other, and must be confirmed by the office.
 */
export const STRUCTURE_STATUSES = ['proposed', 'planned', 'built', 'verified'] as const;
export const structureStatusSchema = z.enum(STRUCTURE_STATUSES);
export type StructureStatus = z.infer<typeof structureStatusSchema>;

export const STRUCTURE_STATUS_LABELS: Record<StructureStatus, string> = {
  proposed: 'Proposed, not confirmed',
  planned: 'Planned',
  built: 'Built',
  verified: 'Verified on site',
};

/** A person-confirmed attachment is never only "proposed". */
export const ATTACHMENT_STATUSES = ['planned', 'built', 'verified'] as const;
export const attachmentStatusSchema = z.enum(ATTACHMENT_STATUSES);
export type AttachmentStatus = z.infer<typeof attachmentStatusSchema>;

/** Where a link record came from. Never "near each other". */
export const LINK_BASES = [
  'field_sequence',
  'office_drawn',
  'office_confirmed',
  'route_proposal_confirmed',
  'imported',
  'inspected',
  'as_built_document',
] as const;
export const linkBasisSchema = z.enum(LINK_BASES);
export type LinkBasis = z.infer<typeof linkBasisSchema>;

export const LINK_BASIS_LABELS: Record<LinkBasis, string> = {
  field_sequence: 'Captured one after the other in the field (order only)',
  office_drawn: 'Added in the office',
  office_confirmed: 'Confirmed in the office',
  route_proposal_confirmed: 'Pole near the drawn line, confirmed by a person',
  imported: 'Imported from a file',
  inspected: 'Seen on site',
  as_built_document: 'From an as-built document',
};

export const PERMISSION_KINDS = ['pole_attachment', 'right_of_way', 'road_cutting', 'building', 'other'] as const;
export const permissionKindSchema = z.enum(PERMISSION_KINDS);
export type PermissionKind = z.infer<typeof permissionKindSchema>;

export const PERMISSION_KIND_LABELS: Record<PermissionKind, string> = {
  pole_attachment: 'Use of poles',
  right_of_way: 'Right of way',
  road_cutting: 'Road cutting',
  building: 'Building owner',
  other: 'Other',
};

/** Cable length marks are printed in metres or feet. */
export const LENGTH_MARK_UNITS = ['m', 'ft'] as const;
export const lengthMarkUnitSchema = z.enum(LENGTH_MARK_UNITS);
export type LengthMarkUnit = z.infer<typeof lengthMarkUnitSchema>;

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

/**
 * Physical and service state of one core. It never changes the core's identification colour, which
 * comes from the cable's scheme. 'In Use' and 'Reserved' follow the core's active assignment.
 */
export const CORE_STATUSES = [
  'Available',
  'In Use',
  'Reserved',
  'Spliced',
  'Damaged',
  'Dark',
  'Disconnected',
  'Under Maintenance',
  'Unverified',
  'Unknown',
] as const;
export const coreStatusSchema = z.enum(CORE_STATUSES);
export type CoreStatus = z.infer<typeof coreStatusSchema>;

export const CORE_STATUS_LABELS: Record<CoreStatus, string> = {
  Available: 'Available',
  'In Use': 'In use',
  Reserved: 'Reserved',
  Spliced: 'Spliced',
  Damaged: 'Damaged',
  Dark: 'Dark (unused)',
  Disconnected: 'Disconnected',
  'Under Maintenance': 'Under maintenance',
  Unverified: 'Not checked',
  Unknown: 'Not known',
};

/** An active assignment either carries a service or holds the core for one. */
export const CORE_ASSIGNMENT_KINDS = ['in_use', 'reserved'] as const;
export const coreAssignmentKindSchema = z.enum(CORE_ASSIGNMENT_KINDS);
export type CoreAssignmentKind = z.infer<typeof coreAssignmentKindSchema>;

export const SPLICE_TYPES = ['fusion', 'mechanical'] as const;
export const spliceTypeSchema = z.enum(SPLICE_TYPES);
export type SpliceType = z.infer<typeof spliceTypeSchema>;

/** Where a splice loss came from. Only the last two are measured. */
export const LOSS_SOURCES = ['designed', 'calculated', 'field_measured', 'device_reported'] as const;
export const lossSourceSchema = z.enum(LOSS_SOURCES);
export type LossSource = z.infer<typeof lossSourceSchema>;

export const CLOSURE_CONDITIONS = ['good', 'needs_attention', 'damaged', 'unknown'] as const;
export const closureConditionSchema = z.enum(CLOSURE_CONDITIONS);
export type ClosureCondition = z.infer<typeof closureConditionSchema>;

export const SEAL_STATUSES = ['sealed', 'open', 'unknown'] as const;
export const sealStatusSchema = z.enum(SEAL_STATUSES);
export type SealStatus = z.infer<typeof sealStatusSchema>;

/** A cable at a closure: coming in from the OLT side, going out towards customers, or passing through. */
export const CABLE_ENTRY_ROLES = ['in', 'out', 'through'] as const;
export const cableEntryRoleSchema = z.enum(CABLE_ENTRY_ROLES);
export type CableEntryRole = z.infer<typeof cableEntryRoleSchema>;

export const ODF_PORT_STATUSES = ['available', 'in_use', 'reserved', 'damaged', 'unknown'] as const;
export const odfPortStatusSchema = z.enum(ODF_PORT_STATUSES);
export type OdfPortStatus = z.infer<typeof odfPortStatusSchema>;

export const SPLITTER_KINDS = ['PLC', 'FBT', 'other'] as const;
export const splitterKindSchema = z.enum(SPLITTER_KINDS);
export type SplitterKind = z.infer<typeof splitterKindSchema>;

export const ADMIN_STATUSES = ['enabled', 'disabled', 'unknown'] as const;
export const adminStatusSchema = z.enum(ADMIN_STATUSES);
export type AdminStatus = z.infer<typeof adminStatusSchema>;

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
  /** Danger seen in the field, such as a hanging wire or a leaning pole. */
  'Safety Hazard',
] as const;
export const faultTypeSchema = z.enum(FAULT_TYPES);
export type FaultType = z.infer<typeof faultTypeSchema>;

export const SEVERITIES = ['Critical', 'High', 'Medium', 'Low'] as const;
export const severitySchema = z.enum(SEVERITIES);
export type Severity = z.infer<typeof severitySchema>;

/**
 * Fault statuses. Since Phase 8 a fault follows `FAULT_LIFECYCLE` (raised, acknowledged, assigned,
 * in repair, repaired, verified, closed, with on hold beside them). `Investigating`, `Dispatched`,
 * `In Progress` and `Resolved` are kept so older records still load; `Resolved` was written before
 * verification existed and is shown as such.
 */
export const FAULT_STATUSES = [
  'Reported',
  'Investigating',
  'Dispatched',
  'In Progress',
  'Resolved',
  'Acknowledged',
  'Assigned',
  'In Repair',
  'On Hold',
  'Repaired',
  'Verified',
  'Closed',
] as const;
export const faultStatusSchema = z.enum(FAULT_STATUSES);
export type FaultStatus = z.infer<typeof faultStatusSchema>;

/** The order a fault moves through. `On Hold` can be set from any open step and returns to it. */
export const FAULT_LIFECYCLE = ['Reported', 'Acknowledged', 'Assigned', 'In Repair', 'Repaired', 'Verified', 'Closed'] as const satisfies readonly FaultStatus[];

export const FAULT_STATUS_LABELS: Record<FaultStatus, string> = {
  Reported: 'Raised',
  Acknowledged: 'Acknowledged',
  Assigned: 'Assigned',
  'In Repair': 'In repair',
  'On Hold': 'On hold',
  Repaired: 'Repaired, not yet verified',
  Verified: 'Verified',
  Closed: 'Closed',
  Investigating: 'Acknowledged (older record)',
  Dispatched: 'Assigned (older record)',
  'In Progress': 'In repair (older record)',
  Resolved: 'Resolved before verification existed',
};

export const WORK_ORDER_TYPES = [
  'Repair',
  'Installation',
  'Inspection',
  'Maintenance',
  'Splice Verification',
  'Cut Investigation',
  'Low Light Investigation',
  'ONT Replacement',
  'Splitter Replacement',
  'Pole Repair',
  'Duct Blockage',
] as const;
export const workOrderTypeSchema = z.enum(WORK_ORDER_TYPES);
export type WorkOrderType = z.infer<typeof workOrderTypeSchema>;

/**
 * Work order statuses. Since Phase 8: new (`Pending`), assigned, accepted, in progress, on hold,
 * completed (repair done), verified, closed. `Cancelled` stays. Verified and closed need a
 * verification: a light reading measured in the field, a photo, or an office check.
 */
export const WORK_ORDER_STATUSES = ['Pending', 'Assigned', 'In Progress', 'Completed', 'Cancelled', 'Accepted', 'On Hold', 'Verified', 'Closed'] as const;
export const workOrderStatusSchema = z.enum(WORK_ORDER_STATUSES);
export type WorkOrderStatus = z.infer<typeof workOrderStatusSchema>;

export const WORK_ORDER_STATUS_LABELS: Record<WorkOrderStatus, string> = {
  Pending: 'New, not assigned',
  Assigned: 'Assigned',
  Accepted: 'Accepted by the technician',
  'In Progress': 'In progress',
  'On Hold': 'On hold',
  Completed: 'Repair done, not yet verified',
  Verified: 'Verified',
  Closed: 'Closed',
  Cancelled: 'Cancelled',
};

/* ------------------------------------------------------------------ */
/* Alarms, faults and field operations (Phase 8)                       */
/* ------------------------------------------------------------------ */

/** What an alarm says happened. Only the kinds a person or a test can report today. */
export const ALARM_KINDS = [
  'ont_los',
  'ont_offline',
  'low_power',
  'pon_port_fault',
  'olt_unreachable',
  'damage_reported',
  'hazard_reported',
  'other',
] as const;
export const alarmKindSchema = z.enum(ALARM_KINDS);
export type AlarmKind = z.infer<typeof alarmKindSchema>;
export const ALARM_KIND_LABELS: Record<AlarmKind, string> = {
  ont_los: 'Loss of signal (LOS) at the ONT',
  ont_offline: 'ONT offline',
  low_power: 'Low light level',
  pon_port_fault: 'PON port fault',
  olt_unreachable: 'OLT not reachable',
  damage_reported: 'Damage reported (cable, pole, duct or box)',
  hazard_reported: 'Danger reported',
  other: 'Other',
};

/**
 * Where an alarm came from. `device_adapter` is the place for a real OLT integration (Phase 7). It
 * is never active: the app and the server refuse to store one until monitoring exists, so no device
 * alarm is ever shown as real.
 */
export const ALARM_SOURCES = ['manual', 'field_report', 'test', 'device_adapter'] as const;
export const alarmSourceSchema = z.enum(ALARM_SOURCES);
export type AlarmSource = z.infer<typeof alarmSourceSchema>;
export const ALARM_SOURCE_LABELS: Record<AlarmSource, string> = {
  manual: 'Reported by a person at the office',
  field_report: 'Reported from the field',
  test: 'TEST event (not real)',
  device_adapter: 'OLT monitoring (not connected)',
};

export const ALARM_STATES = ['active', 'acknowledged', 'cleared'] as const;
export const alarmStateSchema = z.enum(ALARM_STATES);
export type AlarmState = z.infer<typeof alarmStateSchema>;

/** What an alarm, a suspected cause or an impact question is about. */
export const NETWORK_ELEMENT_TYPES = ['customer', 'ont', 'splitter', 'pon_port', 'olt', 'cable', 'core', 'closure', 'equipment', 'span'] as const;
export const networkElementTypeSchema = z.enum(NETWORK_ELEMENT_TYPES);
export type NetworkElementType = z.infer<typeof networkElementTypeSchema>;
export const NETWORK_ELEMENT_LABELS: Record<NetworkElementType, string> = {
  customer: 'Customer',
  ont: 'ONT',
  splitter: 'Splitter',
  pon_port: 'PON port',
  olt: 'OLT',
  cable: 'Cable',
  core: 'One fiber of a cable',
  closure: 'Joint closure',
  equipment: 'Pole, box or other pin',
  span: 'Span between two poles',
};

export const CONFIDENCE_LEVELS = ['low', 'medium', 'high'] as const;
export const confidenceSchema = z.enum(CONFIDENCE_LEVELS);
export type Confidence = z.infer<typeof confidenceSchema>;

/** How a repair was checked before the fault or job may close. */
export const VERIFICATION_METHODS = ['field_reading', 'photo', 'office_check'] as const;
export const verificationMethodSchema = z.enum(VERIFICATION_METHODS);
export type VerificationMethod = z.infer<typeof verificationMethodSchema>;
export const VERIFICATION_METHOD_LABELS: Record<VerificationMethod, string> = {
  field_reading: 'Light reading measured in the field, with the meter photo',
  photo: 'Photo of the working service',
  office_check: 'Checked by the office',
};

export const JOB_PHOTO_KINDS = ['before', 'after', 'meter', 'other'] as const;
export const jobPhotoKindSchema = z.enum(JOB_PHOTO_KINDS);
export type JobPhotoKind = z.infer<typeof jobPhotoKindSchema>;

/** What a technician did on the phone. Each is one record with a random id, so a repeated save adds nothing. */
export const JOB_EVENT_KINDS = ['start', 'photo', 'step', 'material', 'note', 'hold', 'repair_done', 'verify'] as const;
export const jobEventKindSchema = z.enum(JOB_EVENT_KINDS);
export type JobEventKind = z.infer<typeof jobEventKindSchema>;

/**
 * A record two people changed at once. `open` until the person on that device chooses; the office
 * decides the ones sent to it. Both versions are kept in every case.
 */
export const SYNC_CONFLICT_STATUSES = ['open', 'kept_theirs', 'kept_mine', 'office_decides', 'office_used_field', 'office_kept_office'] as const;
export const syncConflictStatusSchema = z.enum(SYNC_CONFLICT_STATUSES);
export type SyncConflictStatus = z.infer<typeof syncConflictStatusSchema>;
export const SYNC_CONFLICT_STATUS_LABELS: Record<SyncConflictStatus, string> = {
  open: 'Waiting for the person on the phone to choose',
  kept_theirs: 'Phone kept the office version',
  kept_mine: 'Phone kept its own version',
  office_decides: 'Sent to the office to decide',
  office_used_field: 'Office used the field version',
  office_kept_office: 'Office kept the office version',
};

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
  'Span',
  'Attachment',
  'Duct',
  'SlackLoop',
  'Permission',
  'Splitter',
  'Splice',
  'Patch',
  'ONT',
  'Service',
  'Building',
  'Alarm',
  'SyncConflict',
  'RfElement',
  'RfLink',
  'RfLevel',
] as const;

/* ------------------------------------------------------------------ */
/* Customers and connections (Phase 5)                                 */
/* ------------------------------------------------------------------ */

/** Where an ONT is in its life. `removed` keeps the record as history after a swap or disconnect. */
export const ONT_STATUSES = ['in_stock', 'installed', 'faulty', 'removed'] as const;
export const ontStatusSchema = z.enum(ONT_STATUSES);
export type OntStatus = z.infer<typeof ontStatusSchema>;
export const ONT_STATUS_LABELS: Record<OntStatus, string> = {
  in_stock: 'In stock',
  installed: 'Installed',
  faulty: 'Faulty',
  removed: 'Removed (history)',
};

/**
 * Who said what an ONT's status is. A person's record is not a device report, and neither is
 * proof that the ONT is online: only `device_reported` with a time from a real integration is.
 */
export const ONT_STATUS_SOURCES = ['person', 'device_reported', 'customer_record'] as const;
export const ontStatusSourceSchema = z.enum(ONT_STATUS_SOURCES);
export type OntStatusSource = z.infer<typeof ontStatusSourceSchema>;
export const ONT_STATUS_SOURCE_LABELS: Record<OntStatusSource, string> = {
  person: 'Recorded by a person',
  device_reported: 'Reported by the OLT',
  customer_record: 'Copied from the customer record',
};

/**
 * How many customers one ONT may serve. Most homes have one ONT per customer, but an MDU unit can
 * serve several flats, so the arrangement is recorded per ONT rather than assumed.
 */
export const ONT_ARRANGEMENTS = ['single', 'shared'] as const;
export const ontArrangementSchema = z.enum(ONT_ARRANGEMENTS);
export type OntArrangement = z.infer<typeof ontArrangementSchema>;
export const ONT_ARRANGEMENT_LABELS: Record<OntArrangement, string> = {
  single: 'One customer',
  shared: 'Several customers (MDU unit)',
};

/** What a service carries. Plans and prices are not modelled: a plan is kept only as written. */
export const SERVICE_KINDS = ['internet', 'iptv', 'rf_video', 'voice', 'other'] as const;
export const serviceKindSchema = z.enum(SERVICE_KINDS);
export type ServiceKind = z.infer<typeof serviceKindSchema>;
export const SERVICE_KIND_LABELS: Record<ServiceKind, string> = {
  internet: 'Internet',
  iptv: 'TV over the internet line (IPTV)',
  rf_video: 'TV on the same fiber (1550 nm overlay)',
  voice: 'Phone',
  other: 'Other',
};

export const SERVICE_STATUSES = ['planned', 'active', 'suspended', 'ended'] as const;
export const serviceStatusSchema = z.enum(SERVICE_STATUSES);
export type ServiceStatus = z.infer<typeof serviceStatusSchema>;
export const SERVICE_STATUS_LABELS: Record<ServiceStatus, string> = {
  planned: 'Planned',
  active: 'Active',
  suspended: 'Suspended',
  ended: 'Ended (history)',
};

export const BUILDING_KINDS = ['house', 'apartment', 'commercial', 'office', 'industrial', 'campus', 'other'] as const;
export const buildingKindSchema = z.enum(BUILDING_KINDS);
export type BuildingKind = z.infer<typeof buildingKindSchema>;
export const BUILDING_KIND_LABELS: Record<BuildingKind, string> = {
  house: 'House',
  apartment: 'Apartment block (MDU)',
  commercial: 'Shops',
  office: 'Office',
  industrial: 'Industrial',
  campus: 'Campus',
  other: 'Other',
};
