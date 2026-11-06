import { z } from 'zod';

import {
  ANNOTATION_STATUSES,
  ANNOTATION_TYPES,
  AUDIT_ASSET_TYPES,
  CABLE_CATEGORIES,
  cableInstallationTypeSchema,
  cableStatusSchema,
  cableTypeSchema,
  CLOSURE_TYPES,
  coreStatusSchema,
  CUSTOMER_SERVICE_TYPES,
  CUSTOMER_STATUSES,
  DOCUMENT_CATEGORIES,
  equipmentCategorySchema,
  equipmentStatusSchema,
  equipmentTypeSchema,
  FAULT_STATUSES,
  FAULT_TYPES,
  IMAGE_CATEGORIES,
  logicalPortStatusSchema,
  PON_PORT_STATUSES,
  ponTechnologySchema,
  portTechnologySchema,
  routeStatusSchema,
  severitySchema,
  signalLevelSchema,
  spliceStatusSchema,
  SPLITTER_STATUSES,
  splitterPortStatusSchema,
  splitterRatioSchema,
  userRoleSchema,
  workOrderStatusSchema,
  workOrderTypeSchema,
  ZONE_STATUSES,
} from './enums';

const id = z.string().min(1);
/** ISO-8601 date or date-time string. Kept lenient because legacy data mixes both forms. */
const isoDate = z.string();
const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);
/** `[lat, lng]` pair, matching Leaflet's ordering. */
export const latLngSchema = z.tuple([latitude, longitude]);

export const networkZoneSchema = z.object({
  id,
  name: z.string(),
  areaCode: z.string(),
  coverageSqKm: z.number().nonnegative(),
  homePassed: z.number().int().nonnegative(),
  connectedCustomers: z.number().int().nonnegative(),
  feederCableCount: z.number().int().nonnegative(),
  fatCount: z.number().int().nonnegative(),
  penetrationRatePct: z.number().min(0).max(100),
  status: z.enum(ZONE_STATUSES),
  boundaryCoords: z.array(latLngSchema),
});

export const networkDocumentSchema = z.object({
  id,
  title: z.string(),
  category: z.enum(DOCUMENT_CATEGORIES),
  equipmentId: z.string().optional(),
  cableId: z.string().optional(),
  uploadedBy: z.string(),
  uploadDate: isoDate,
  fileSizeKb: z.number().nonnegative(),
  url: z.string().optional(),
});

export const equipmentPortSchema = z.object({
  id,
  portNumber: z.number().int(),
  portType: z.string(),
  technology: portTechnologySchema.optional(),
  /** Slot/card/port address, e.g. "0/1/1". */
  slotCardPort: z.string().optional(),
  status: logicalPortStatusSchema,
  color: z.string().optional(),
  connectedEquipmentId: z.string().optional(),
  connectedSplitterId: z.string().optional(),
  connectedCableId: z.string().optional(),
  connectedCore: z.number().int().optional(),
  customerId: z.string().optional(),
  connectedOntCount: z.number().int().optional(),
  assignedDate: isoDate.optional(),
  remarks: z.string().optional(),
});

export const opticalPowerSampleSchema = z.object({
  timestamp: isoDate,
  txPowerDbm: z.number().optional(),
  rxPowerDbm: z.number().optional(),
});

export const opticalPowerInfoSchema = z.object({
  dataSource: z.literal('simulated_sample'),
  lastUpdated: isoDate.optional(),
  txPowerDbm: z.number().optional(),
  rxPowerDbm: z.number().optional(),
  signalLevel: signalLevelSchema,
  txMinDbm: z.number(),
  txMaxDbm: z.number(),
  rxMinDbm: z.number(),
  rxWarnDbm: z.number(),
  rxCriticalDbm: z.number(),
  history: z.array(opticalPowerSampleSchema),
});

/** Equipment template shown in the "add equipment" palette. Custom entries may use free-form types. */
export const catalogComponentSchema = z.object({
  id,
  type: z.string(),
  category: z.string(),
  name: z.string(),
  description: z.string(),
  defaultPorts: z.number().int().nonnegative().optional(),
  iconBg: z.string(),
  isCustom: z.boolean().optional(),
});

/** Annotation positioned on an equipment photo; coordinates and sizes are percentages (0-100). */
export const imageAnnotationSchema = z.object({
  id,
  type: z.enum(ANNOTATION_TYPES),
  x: z.number(),
  y: z.number(),
  width: z.number().optional(),
  height: z.number().optional(),
  label: z.string(),
  portNumber: z.number().int().optional(),
  status: z.enum(ANNOTATION_STATUSES).optional(),
  remarks: z.string().optional(),
  color: z.string().optional(),
});

export const equipmentImageSchema = z.object({
  id,
  equipmentId: z.string(),
  url: z.string(),
  name: z.string(),
  category: z.enum(IMAGE_CATEGORIES),
  uploadDate: isoDate,
  uploadedBy: z.string(),
  description: z.string(),
  annotations: z.array(imageAnnotationSchema),
});

export const ponPortSchema = z.object({
  id,
  portNumber: z.number().int(),
  slotCardPort: z.string().optional(),
  technology: ponTechnologySchema.optional(),
  status: z.enum(PON_PORT_STATUSES),
  color: z.string().optional(),
  colorName: z.string().optional(),
  connectedFeederCableId: z.string().optional(),
  connectedSplitterId: z.string().optional(),
  connectedCustomersCount: z.number().int().nonnegative(),
  connectedOntCount: z.number().int().optional(),
  signalDbm: z.number().optional(),
  txPowerDbm: z.number().optional(),
  rxPowerDbm: z.number().optional(),
  lastUpdated: isoDate.optional(),
});

export const oltSplitterConfigItemSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  ratio: splitterRatioSchema,
  inPort: z.string(),
  parentPonPort: z.string().optional(),
  outPortsCount: z.number().int().positive(),
  color: z.string().optional(),
  targetEquipmentId: z.string().optional(),
});

export const oltCableConfigItemSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  ponPort: z.string(),
  targetEquipmentId: z.string().optional(),
  targetPort: z.string().optional(),
  coreCount: z.number().int().positive().optional(),
  colorHex: z.string().optional(),
  lengthMeters: z.number().optional(),
});

export const oltConfigSchema = z.object({
  technology: z.enum(['EPON', 'GPON']),
  ponPortCount: z.number().int().positive(),
  portColors: z.record(z.string(), z.string()).optional(),
  splitters: z.array(oltSplitterConfigItemSchema).optional(),
  cables: z.array(oltCableConfigItemSchema).optional(),
  description: z.string().optional(),
});

export const equipmentSchema = z.object({
  id,
  name: z.string().min(1),
  type: equipmentTypeSchema,
  category: equipmentCategorySchema,
  lat: latitude,
  lng: longitude,
  area: z.string(),
  street: z.string(),
  poleNumber: z.string().optional(),
  buildingName: z.string().optional(),
  status: equipmentStatusSchema,
  technology: ponTechnologySchema.optional(),
  portColorMap: z.record(z.string(), z.string()).optional(),
  oltConfig: oltConfigSchema.optional(),
  manufacturer: z.string().optional(),
  model: z.string().optional(),
  serialNumber: z.string().optional(),
  ipAddress: z.string().optional(),
  totalPorts: z.number().int().nonnegative().optional(),
  usedPorts: z.number().int().nonnegative().optional(),
  availablePorts: z.number().int().nonnegative().optional(),
  rackNumber: z.string().optional(),
  shelfNumber: z.string().optional(),
  slotNumber: z.string().optional(),
  ponCardsCount: z.number().int().nonnegative().optional(),
  ponPorts: z.array(ponPortSchema).optional(),
  logicalPorts: z.array(equipmentPortSchema).optional(),
  opticalPower: opticalPowerInfoSchema.optional(),
  uptimeHours: z.number().nonnegative().optional(),
  splitterConfig: z
    .object({
      ratio: splitterRatioSchema,
      splitterCount: z.number().int().nonnegative(),
    })
    .optional(),
  /** RF output level for Cable TV nodes and amplifiers. */
  rfLevelDbf: z.number().optional(),
  images: z.array(equipmentImageSchema),
  notes: z.string().optional(),
  installedDate: isoDate,
});

export const fiberCoreSchema = z.object({
  coreNumber: z.number().int().positive(),
  tubeNumber: z.number().int().positive(),
  colorName: z.string(),
  colorHex: z.string(),
  status: coreStatusSchema,
  connectedToEquipmentId: z.string().optional(),
  connectedToEquipmentName: z.string().optional(),
  connectedPort: z.string().optional(),
  spliceTargetCableId: z.string().optional(),
  spliceTargetCore: z.number().int().optional(),
  customerId: z.string().optional(),
  customerName: z.string().optional(),
  attenuationDb: z.number().optional(),
  remarks: z.string().optional(),
});

export const cableSchema = z.object({
  id,
  name: z.string().min(1),
  type: cableTypeSchema,
  manufacturer: z.string().optional(),
  model: z.string().optional(),
  fiberCount: z.number().int().nonnegative(),
  lengthMeters: z.number().nonnegative(),
  installationType: cableInstallationTypeSchema,
  owner: z.string(),
  installationDate: isoDate,
  status: cableStatusSchema,
  routeStatus: routeStatusSchema.optional(),
  remarks: z.string().optional(),
  coordinates: z.array(latLngSchema),
  startEquipmentId: z.string().optional(),
  endEquipmentId: z.string().optional(),
  startPortName: z.string().optional(),
  endPortName: z.string().optional(),
  colorHex: z.string().optional(),
  thickness: z.number().positive().optional(),
  cores: z.array(fiberCoreSchema),
  cableCategory: z.enum(CABLE_CATEGORIES),
});

export const splitterPortSchema = z.object({
  portNumber: z.number().int().positive(),
  label: z.string(),
  status: splitterPortStatusSchema,
  connectedCustomerId: z.string().optional(),
  connectedCustomerName: z.string().optional(),
  connectedDropCableId: z.string().optional(),
  attenuationDb: z.number().optional(),
});

export const splitterSchema = z.object({
  id,
  name: z.string().min(1),
  terminalBoxId: z.string(),
  ratio: splitterRatioSchema,
  insertionLossDb: z.number().nonnegative(),
  status: z.enum(SPLITTER_STATUSES),
  inputPort: z.object({
    id,
    connectedCableId: z.string().optional(),
    connectedCore: z.number().int().optional(),
    signalLevelDbm: z.number().optional(),
  }),
  outputPorts: z.array(splitterPortSchema),
});

export const spliceRecordSchema = z.object({
  id,
  inputCableId: z.string(),
  inputCableName: z.string(),
  inputCore: z.number().int().positive(),
  outputCableId: z.string(),
  outputCableName: z.string(),
  outputCore: z.number().int().positive(),
  spliceLossDb: z.number().nonnegative(),
  status: spliceStatusSchema,
  technician: z.string(),
  date: isoDate,
});

export const jointClosureSchema = z.object({
  id,
  name: z.string().min(1),
  closureType: z.enum(CLOSURE_TYPES),
  lat: latitude,
  lng: longitude,
  area: z.string(),
  cableAId: z.string().optional(),
  cableBId: z.string().optional(),
  entryPortsCount: z.number().int().nonnegative(),
  exitPortsCount: z.number().int().nonnegative(),
  installationDate: isoDate,
  technician: z.string(),
  splices: z.array(spliceRecordSchema),
  images: z.array(equipmentImageSchema),
  remarks: z.string().optional(),
});

export const customerSchema = z.object({
  id,
  name: z.string().min(1),
  mobile: z.string(),
  address: z.string(),
  area: z.string(),
  building: z.string().optional(),
  flatNumber: z.string().optional(),
  lat: latitude,
  lng: longitude,
  serviceType: z.enum(CUSTOMER_SERVICE_TYPES),
  plan: z.string(),
  status: z.enum(CUSTOMER_STATUSES),
  installationDate: isoDate,
  // Logical path from the OLT down to the subscriber's ONT.
  oltId: z.string(),
  ponPort: z.string(),
  feederCableId: z.string(),
  distributionCableId: z.string(),
  terminalBoxId: z.string(),
  splitterId: z.string(),
  splitterOutputPort: z.number().int(),
  dropCableId: z.string(),
  fiberCore: z.number().int(),
  ontSerialNumber: z.string(),
  routerModel: z.string(),
  ipAddress: z.string(),
  rxOpticalPowerDbm: z.number(),
});

export const faultSchema = z.object({
  id,
  title: z.string().min(1),
  type: z.enum(FAULT_TYPES),
  severity: severitySchema,
  status: z.enum(FAULT_STATUSES),
  affectedLocation: z.object({ lat: latitude, lng: longitude }),
  affectedEquipmentId: z.string().optional(),
  affectedCableId: z.string().optional(),
  affectedCustomerIds: z.array(z.string()),
  affectedCores: z.array(z.number().int()),
  affectedSplitterPorts: z.array(z.number().int()),
  description: z.string(),
  reportedAt: isoDate,
  resolvedAt: isoDate.optional(),
  assignedTechnician: z.string().optional(),
  workOrderId: z.string().optional(),
  images: z.array(z.string()),
});

export const workOrderSchema = z.object({
  id,
  title: z.string().min(1),
  type: workOrderTypeSchema,
  priority: severitySchema,
  status: workOrderStatusSchema,
  technicianName: z.string(),
  technicianPhone: z.string(),
  equipmentId: z.string().optional(),
  cableId: z.string().optional(),
  customerId: z.string().optional(),
  faultId: z.string().optional(),
  scheduledDate: isoDate,
  completedDate: isoDate.optional(),
  notes: z.string(),
  photos: z.array(z.string()),
});

export const auditLogSchema = z.object({
  id,
  timestamp: isoDate,
  user: z.string(),
  role: userRoleSchema,
  action: z.string(),
  details: z.string(),
  assetId: z.string(),
  assetType: z.enum(AUDIT_ASSET_TYPES),
});

/** Logical optical port schema for port-to-port optical connectivity. */
export const opticalPortSchema = z.object({
  id,
  name: z.string(),
  type: z.enum(['Inbound', 'Outbound', 'PassThrough']),
  connectorType: z.enum(['SC/APC', 'SC/UPC', 'LC/APC', 'LC/UPC']).optional(),
  status: z.enum(['Available', 'Occupied', 'Reserved', 'Faulty']),
  wavelengthNm: z.number().int().positive().optional(),
  powerLevelDbm: z.number().optional(),
  connectedEquipmentId: z.string().optional(),
  connectedPortId: z.string().optional(),
  connectedCableId: z.string().optional(),
  connectedCore: z.number().int().positive().optional(),
});

/** Logical inbound splice connection entry. */
export const spliceMatrixEntrySchema = z.object({
  id,
  targetEquipmentId: z.string(),
  upstreamEquipmentId: z.string(),
  upstreamPortId: z.string().optional(),
  upstreamPortName: z.string().optional(),
  distanceMeters: z.number().nonnegative(),
  coreNumber: z.number().int().positive(),
  coreColorName: z.string(),
  coreColorHex: z.string(),
  splicingType: z.enum(['Direct Drop', 'Loose Tube']),
  lossDb: z.number().nonnegative(),
  timestamp: isoDate,
});

/** Individual fiber core link assignment. */
export const cableCoreLinkSchema = z.object({
  cableId: z.string(),
  cableName: z.string(),
  coreNumber: z.number().int().positive(),
  tubeNumber: z.number().int().positive().optional(),
  colorName: z.string(),
  colorHex: z.string(),
  upstreamEndpointId: z.string().optional(),
  downstreamEndpointId: z.string().optional(),
  status: z.enum(['In Use', 'Available', 'Reserved', 'Damaged']),
});

/** One hop along an end-to-end traced optical path. */
export const fiberTraceHopSchema = z.object({
  index: z.number().int().nonnegative(),
  id: z.string(),
  name: z.string(),
  type: z.string(),
  status: z.enum(['Normal', 'Warning', 'Faulty']),
  lat: z.number().optional(),
  lng: z.number().optional(),
  portId: z.string().optional(),
  portName: z.string().optional(),
  coreNumber: z.number().int().positive().optional(),
  coreColorName: z.string().optional(),
  coreColorHex: z.string().optional(),
  hopDistanceMeters: z.number().nonnegative(),
  cumulativeDistanceMeters: z.number().nonnegative(),
  hopLossDb: z.number(),
  cumulativeLossDb: z.number(),
  details: z.string().optional(),
  equipmentType: z.string().optional(),
  splitRatio: z.string().optional(),
});

/** Saved live GPS tracked route from Bike Mode. */
export const gpsRouteSchema = z.object({
  id,
  name: z.string().min(1),
  travelMode: z.literal('bike'),
  startTime: isoDate,
  endTime: isoDate.optional(),
  durationSeconds: z.number().nonnegative(),
  distanceKm: z.number().nonnegative(),
  coordinates: z.array(z.tuple([latitude, longitude])),
  accuracyMeters: z.number().optional(),
  status: z.enum(['recording', 'paused', 'completed']),
  startLocationName: z.string().optional(),
  notes: z.string().optional(),
});
