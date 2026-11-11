import { z } from 'zod';

import { OPTICS_CLASSES } from '../domain/opticalSettings';
import {
  adminStatusSchema,
  alarmKindSchema,
  alarmSourceSchema,
  alarmStateSchema,
  ANNOTATION_STATUSES,
  ANNOTATION_TYPES,
  attachmentStatusSchema,
  AUDIT_ASSET_TYPES,
  buildingKindSchema,
  CABLE_CATEGORIES,
  cableEntryRoleSchema,
  cableInstallationTypeSchema,
  cableSheathSchema,
  cableStatusSchema,
  cableTypeSchema,
  checklistAnswerSchema,
  CLOSURE_TYPES,
  closureConditionSchema,
  confidenceSchema,
  coreAssignmentKindSchema,
  coreEventActionSchema,
  coreStatusSchema,
  CUSTOMER_SERVICE_TYPES,
  CUSTOMER_STATUSES,
  DOCUMENT_CATEGORIES,
  equipmentCategorySchema,
  equipmentConditionSchema,
  equipmentStatusSchema,
  type EquipmentType,
  FAULT_STATUSES,
  FAULT_TYPES,
  fiberModeSchema,
  fiberStandardSchema,
  fieldReviewStatusSchema,
  IMAGE_CATEGORIES,
  inspectionTargetSchema,
  jobEventKindSchema,
  jobPhotoKindSchema,
  lengthMarkUnitSchema,
  linkBasisSchema,
  locationMethodSchema,
  logicalPortStatusSchema,
  lossSourceSchema,
  networkElementTypeSchema,
  odfPortStatusSchema,
  ontArrangementSchema,
  ontStatusSchema,
  ontStatusSourceSchema,
  ospConditionSchema,
  permissionKindSchema,
  poleMaterialSchema,
  poleOwnerTypeSchema,
  PON_PORT_STATUSES,
  ponTechnologySchema,
  portTechnologySchema,
  rackNumberingSchema,
  routeStatusSchema,
  rxSourceSchema,
  sealStatusSchema,
  serviceKindSchema,
  serviceStatusSchema,
  severitySchema,
  signalLevelSchema,
  spliceStatusSchema,
  spliceTypeSchema,
  SPLITTER_STATUSES,
  splitterArchitectureSchema,
  splitterKindSchema,
  splitterPortStatusSchema,
  splitterRatioSchema,
  structureStatusSchema,
  syncConflictStatusSchema,
  userRoleSchema,
  verificationMethodSchema,
  wayConditionSchema,
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

/** One specification line, such as "Operating temperature: -40 to 85 °C". */
export const specLineSchema = z.object({
  key: z.string().trim().min(1).max(60),
  value: z.string().trim().max(200),
  unit: z.string().trim().max(20).optional(),
});

export const CATALOG_LIFECYCLES = ['active', 'end_of_sale', 'end_of_life'] as const;
export const catalogLifecycleSchema = z.enum(CATALOG_LIFECYCLES);

/**
 * A catalogue entry: what can be placed on the map. Older entries are just a type with a name and a
 * port count. Phase 2: an entry with a manufacturer and model is a product model, and the specs,
 * port count and connector of deployed items come from it (each item may change them for itself).
 * Every field beyond the first few is optional: absent means not recorded, never a default.
 */
export const catalogComponentSchema = z.object({
  id,
  type: z.string(),
  category: z.string(),
  name: z.string(),
  description: z.string(),
  defaultPorts: z.number().int().nonnegative().optional(),
  iconBg: z.string(),
  isCustom: z.boolean().optional(),
  manufacturer: z.string().trim().max(80).optional(),
  model: z.string().trim().max(80).optional(),
  /** The maker's product or order code. */
  productCode: z.string().trim().max(80).optional(),
  connectorType: z.string().trim().max(40).optional(),
  lifecycle: catalogLifecycleSchema.optional(),
  specs: z.array(specLineSchema).max(60).optional(),
  /** Where the specs came from, such as "Datasheet rev 3, March 2025". */
  specSource: z.string().trim().max(200).optional(),
  /** A document record holding the datasheet. */
  datasheetDocumentId: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
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

/** One line of a record's change history: what was done, when, by whom. */
export const historyEntrySchema = z.object({
  at: isoDate,
  by: z.string().optional(),
  action: z.string().min(1).max(60),
  details: z.string().max(500),
});

/** Phase 3: a plain calendar day, `YYYY-MM-DD`, for dates people record by hand. */
const calendarDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-11-10');

/** Phase 3: one piece of maintenance work on an item, as the person recorded it. */
export const maintenanceEntrySchema = z.object({
  /** The day the work was done. */
  date: calendarDay,
  /** Who did it, as written. */
  by: z.string().trim().min(1).max(80),
  /** What was done, as written. */
  what: z.string().trim().min(1).max(500),
  /** When it should be looked at again, if the person said. */
  nextDue: calendarDay.optional(),
});

export const opticsClassSchema = z.enum(OPTICS_CLASSES);

/** One level of a vendor's address, in the vendor's own words, such as { label: 'Slot', value: '5' }. */
export const addressPartSchema = z.object({
  label: z.string().trim().min(1).max(40),
  value: z.string().trim().min(1).max(40),
});

export const ponPortSchema = z.object({
  id,
  portNumber: z.number().int(),
  slotCardPort: z.string().optional(),
  /**
   * The port's address exactly as the OLT writes it, such as "gpon 0/5/0" (Huawei),
   * "gpon-olt_1/2/3" (ZTE) or "1/1/1/2" (Nokia). Never converted between vendor formats.
   */
  vendorAddress: z.string().trim().max(80).optional(),
  /** The same address split into the vendor's own levels, in order. No fixed chassis/slot shape. */
  addressParts: z.array(addressPartSchema).max(8).optional(),
  /** Optics class of the module in this port, as recorded by a person (labels on parts are unreliable). */
  opticsClass: opticsClassSchema.optional(),
  opticsClassSource: z.string().max(200).optional(),
  /** A vendor's own budget claim (such as 29.5 dB), kept apart from the ITU class. */
  vendorBudgetDb: z.number().positive().max(60).optional(),
  vendorBudgetSource: z.string().max(200).optional(),
  /** The vendor's ONU limit for this port. Not an optical limit. */
  maxOnu: z.number().int().positive().max(1024).optional(),
  adminStatus: adminStatusSchema.optional(),
  /**
   * The feeder core this port drives when it is connected straight to the cable with no ODF. With
   * an ODF, the path is recorded on the ODF port instead.
   */
  feederCore: z.number().int().positive().optional(),
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
  technology: ponTechnologySchema,
  ponPortCount: z.number().int().positive(),
  portColors: z.record(z.string(), z.string()).optional(),
  splitters: z.array(oltSplitterConfigItemSchema).optional(),
  cables: z.array(oltCableConfigItemSchema).optional(),
  description: z.string().optional(),
});

/** Phase 10: what a card in an OLT slot does. */
export const OLT_CARD_KINDS = ['pon', 'uplink', 'control', 'power', 'other'] as const;

/**
 * Phase 10: one card in an OLT slot, as written by a person. Absent fields are not recorded. Its
 * PON ports name the OLT's `ponPorts` ids; one PON port belongs to at most one card.
 */
export const oltCardSchema = z.object({
  /** Card model as printed, such as "GPHF" or "GTGH". */
  model: z.string().trim().max(80).optional(),
  kind: z.enum(OLT_CARD_KINDS).optional(),
  serialNumber: z.string().trim().max(64).optional(),
  /** Ports on the card's face, as counted by a person. */
  portCount: z.number().int().positive().max(128).optional(),
  ponPortIds: z.array(z.string().min(1)).max(128).optional(),
  notes: z.string().max(300).optional(),
});

/** Phase 10: one slot in a shelf. A slot with no card is empty, as recorded. */
export const oltSlotSchema = z.object({
  id,
  /** The slot number or name as the OLT writes it, such as "5" or "1/5". */
  label: z.string().trim().min(1).max(20),
  card: oltCardSchema.optional(),
});

export const oltShelfSchema = z.object({
  id,
  label: z.string().trim().min(1).max(20),
  slots: z.array(oltSlotSchema).max(64),
});

/**
 * Phase 10: an OLT's chassis as recorded: shelves, slots and the card in each slot. Optional; the
 * older free-text `rackNumber`, `shelfNumber`, `slotNumber` and `ponCardsCount` stay and are shown
 * "as written" when no chassis is recorded.
 */
export const oltChassisSchema = z.object({
  model: z.string().trim().max(80).optional(),
  shelves: z.array(oltShelfSchema).max(16),
  notes: z.string().max(500).optional(),
});

/**
 * Optional evidence recorded by the phone capture flow. Every field is optional so older records and
 * older clients keep working. Positions keep their method, accuracy, sample count and time together.
 */
const fieldCaptureFields = {
  locationSampleCount: z.number().int().nonnegative().optional(),
  locationCapturedAt: isoDate.optional(),
  /** No usable GPS fix: the point is a placeholder until the office places it. */
  officeMustPlace: z.boolean().optional(),
  /** When the office placed or confirmed a field position, and who did it. */
  locationCheckedAt: isoDate.optional(),
  locationCheckedBy: z.string().optional(),
  /** Photo ids stored by `/api/v1/photos/<id>`. */
  photoIds: z.array(z.string()).optional(),
  captureSource: z.literal('field_capture').optional(),
};

/**
 * Phase 19: the office review of a phone capture. Absent on older records and on items the office
 * added itself: those are normal records. Who and when are as the deciding person's app wrote them;
 * the server's own audit entry records the real account.
 */
const fieldReviewFields = {
  reviewStatus: fieldReviewStatusSchema.optional(),
  reviewedAt: isoDate.optional(),
  reviewedBy: z.string().max(120).optional(),
  /** Why it was rejected, or why it was accepted without a confirmed position. */
  reviewReason: z.string().trim().max(300).optional(),
};

/**
 * Where an imported record came from, kept exactly as the file had it. Nothing here is a fact the
 * importer worked out: a KML name or description is the file author's text.
 */
export const importInfoSchema = z.object({
  importId: z.string().min(1),
  fileName: z.string(),
  importedAt: isoDate,
  /** Folder path inside the file, such as "Route A / Poles". */
  folderPath: z.string().optional(),
  styleId: z.string().optional(),
  originalName: z.string().optional(),
  description: z.string().optional(),
  extendedData: z.record(z.string(), z.string()).optional(),
});

/**
 * Pole and structure details the office records. All optional: a blank one shows "Not recorded".
 * The owner's pole number is what the owner (such as a DISCOM) painted on the pole; it may be
 * absent, repeated or repainted, so it is never used as the key.
 */
const structureDetailFields = {
  heightMeters: z.number().positive().max(100).optional(),
  /** Owner as written by the office, such as "BESCOM", "Own", "BBMP". */
  ownerName: z.string().trim().max(120).optional(),
  ownerPoleNumber: z.string().trim().max(64).optional(),
  /**
   * Network mapping Phase 18: how many cables the owner allows on this pole, as written on the
   * permission or agreement, and where that figure came from. Absent: not recorded, and the pole's
   * spare room is "not known", never assumed.
   */
  attachmentCapacity: z.number().int().positive().max(100).optional(),
  attachmentCapacitySource: z.string().trim().max(200).optional(),
  importInfo: importInfoSchema.optional(),
};

/** One adapter on an ODF panel: the front takes a patch cord, the back holds a feeder core. */
export const odfPortSchema = z.object({
  id,
  number: z.number().int().positive(),
  label: z.string().max(40).optional(),
  connectorType: z.string().max(20).optional(),
  status: odfPortStatusSchema,
  /** Rear: the cable and core terminated behind this adapter. */
  feederCableId: z.string().min(1).optional(),
  feederCore: z.number().int().positive().optional(),
  /**
   * Phase 9: the pigtail at the back, as recorded: the connector that plugs into this adapter, its
   * length and the label on it. It runs from the feeder fiber above (spliced to it) to this adapter.
   * Every field is optional; a blank one is "Not recorded".
   */
  pigtail: z
    .object({
      connectorType: z.string().trim().max(20).optional(),
      lengthMeters: z.number().positive().max(100).optional(),
      label: z.string().trim().max(60).optional(),
      notes: z.string().max(300).optional(),
    })
    .optional(),
  /** Front: the patch cord to an OLT PON port. A patch is not a splice. */
  patch: z
    .object({
      oltId: z.string().min(1),
      ponPortId: z.string().min(1),
      patchedAt: isoDate,
      patchedBy: z.string().optional(),
      cordLabel: z.string().max(60).optional(),
      /** Phase 9: the cord itself, as recorded: connector at this adapter, connector at the PON port, length. */
      cordConnectorOdf: z.string().trim().max(20).optional(),
      cordConnectorPon: z.string().trim().max(20).optional(),
      cordLengthMeters: z.number().positive().max(500).optional(),
      /** Phase 9: the adapter was marked faulty and the person patched it anyway: who, why and when. */
      override: z
        .object({
          status: odfPortStatusSchema,
          reason: z.string().trim().min(1).max(300),
          at: isoDate,
          by: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
  history: z.array(historyEntrySchema).optional(),
  notes: z.string().max(500).optional(),
});

export const odfPanelSchema = z.object({
  id,
  label: z.string().trim().min(1).max(60),
  rack: z.string().max(40).optional(),
  tray: z.string().max(40).optional(),
  connectorType: z.string().max(20).optional(),
  ports: z.array(odfPortSchema).max(288),
  notes: z.string().max(500).optional(),
});

export const equipmentSchema = z.object({
  id,
  ...fieldCaptureFields,
  ...fieldReviewFields,
  ...structureDetailFields,
  /** Unchanging short code printed on the asset's QR tag. */
  tagCode: z.string().trim().min(1).max(64).optional(),
  /** Kind of pole owner as seen in the field. The company is recorded later by the office. */
  ownerType: poleOwnerTypeSchema.optional(),
  material: poleMaterialSchema.optional(),
  /** The asset captured just before this one in the same walk. Order only: it does not mean a cable joins them. */
  previousAssetId: z.string().optional(),
  captureRunId: z.string().optional(),
  captureOrder: z.number().int().nonnegative().optional(),
  /** For a house drop: the customer the field worker said it serves. The office confirms the link. */
  customerId: z.string().optional(),
  name: z.string().min(1),
  // Not limited to EQUIPMENT_TYPES: custom catalog items carry a type name the user typed.
  type: z.string().trim().min(1) as unknown as z.ZodType<EquipmentType>,
  category: equipmentCategorySchema,
  lat: latitude,
  lng: longitude,
  locationMethod: locationMethodSchema.optional(),
  locationAccuracyMeters: z.number().nonnegative().optional(),
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
  /** Phase 2: the catalogue product model this item is. Its specs come from there. */
  catalogModelId: z.string().optional(),
  /** Spec lines changed for this one item; each replaces the model's line with the same key. */
  specOverrides: z.array(specLineSchema).max(60).optional(),
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
  /** Phase 10: OLT shelves, slots and cards as recorded. Absent: not recorded. */
  chassis: oltChassisSchema.optional(),
  /** ODF or patch panel: panels, adapters, feeder cores behind them and patches in front. */
  odfPanels: z.array(odfPanelSchema).optional(),
  firmware: z.string().max(60).optional(),
  /** Where the OLT sits, such as "CO-1 rack 3". */
  site: z.string().max(120).optional(),
  /**
   * Phase 9: the site and rack records this item sits in, and its place in the rack: the lowest
   * unit it fills and how many units tall it is, as written. The older free-text `site` and
   * `rackNumber` stay and are shown when no record is linked. Absent: not recorded.
   */
  siteId: z.string().min(1).optional(),
  rackId: z.string().min(1).optional(),
  rackUnit: z.number().int().positive().max(60).optional(),
  rackUnits: z.number().int().positive().max(60).optional(),
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
  /** Phase 3: last day of the warranty, as written on the paperwork. Absent: not recorded. */
  warrantyUntil: calendarDay.optional(),
  /** Phase 3: how the item looked when last checked. Absent: not recorded. */
  condition: equipmentConditionSchema.optional(),
  /** Phase 3: maintenance work as recorded, oldest first. Never generated. */
  maintenance: z.array(maintenanceEntrySchema).max(500).optional(),
  /** Set on records from the bundled demo network: their readings are made up. */
  isSampleData: z.boolean().optional(),
  /** Phase 23: values of the owner's own fields (`attr.equipment.*` settings), by key. */
  customAttributes: z.record(z.string(), z.union([z.string().max(500), z.number(), z.boolean()])).optional(),
});

/**
 * Who a core is given to. An assignment is never deleted: releasing it sets `releasedAt`, so the
 * core's history stays. At most one assignment per core is active (no `releasedAt`).
 */
export const coreAssignmentSchema = z.object({
  id,
  kind: coreAssignmentKindSchema,
  /** Service or use as written, such as "PON OLT-1 / PON-3" or "Customer CUST-004". */
  use: z.string().trim().min(1).max(160),
  /** What feeds this core and where it goes, as written or as worked out from linked records. */
  source: z.string().max(160).optional(),
  destination: z.string().max(160).optional(),
  customerId: z.string().optional(),
  equipmentId: z.string().optional(),
  /** OLT id and PON port id for a core that carries a PON tree. */
  oltId: z.string().optional(),
  ponPortId: z.string().optional(),
  /** Phase 9: the ODF adapter (port id) this fiber is terminated on. Set by `setOdfPortFeeder` only. */
  odfPortId: z.string().optional(),
  effectiveFrom: isoDate,
  /** Planned end, such as when a reservation lapses. Nothing is released automatically. */
  effectiveTo: isoDate.optional(),
  releasedAt: isoDate.optional(),
  releasedBy: z.string().optional(),
  releaseReason: z.string().max(300).optional(),
  createdAt: isoDate,
  createdBy: z.string().optional(),
  notes: z.string().max(500).optional(),
  /**
   * Phase 7: the core was marked Damaged or Faulty when it was given, and the person chose to use it
   * anyway. Who, why and when are kept with the assignment and in the audit trail.
   */
  override: z
    .object({
      status: coreStatusSchema,
      reason: z.string().trim().min(1).max(300),
      at: isoDate,
      by: z.string().optional(),
    })
    .optional(),
});

/**
 * One change to a core's condition (Phase 7): marked faulty, repaired, retired or brought back into
 * use, with the reason and any evidence (an OTDR reference, photo ids). Never deleted.
 */
export const coreEventSchema = z.object({
  at: isoDate,
  by: z.string().optional(),
  action: coreEventActionSchema,
  fromStatus: coreStatusSchema,
  toStatus: coreStatusSchema,
  reason: z.string().trim().min(1).max(300),
  /** OTDR file name or test reference, as written. */
  otdrRef: z.string().max(120).optional(),
  photoIds: z.array(z.string().min(1).max(80)).max(20).optional(),
});

/**
 * One buffer tube of a cable, as recorded from the drum sheet (Phase 7). Tubes may hold different
 * numbers of fibers. Numbers run 1, 2, 3 ... and the sizes must add up to the cable's fiber count.
 */
export const cableTubeSchema = z.object({
  number: z.number().int().positive().max(288),
  fiberCount: z.number().int().positive().max(288),
  /** The tube colour as written on the drum sheet. Absent: from the tube scheme, or not known. */
  colorName: z.string().trim().min(1).max(40).optional(),
});

export const fiberCoreSchema = z.object({
  coreNumber: z.number().int().positive(),
  /**
   * Older records stored a tube number and colour worked out by assuming TIA-598 with 12 per tube.
   * They are not used for identity: the tube and colour come from the cable's recorded layout.
   */
  tubeNumber: z.number().int().positive().optional(),
  colorName: z.string().optional(),
  colorHex: z.string().optional(),
  status: coreStatusSchema,
  assignments: z.array(coreAssignmentSchema).optional(),
  connectedToEquipmentId: z.string().optional(),
  connectedToEquipmentName: z.string().optional(),
  connectedPort: z.string().optional(),
  spliceTargetCableId: z.string().optional(),
  spliceTargetCore: z.number().int().optional(),
  customerId: z.string().optional(),
  customerName: z.string().optional(),
  attenuationDb: z.number().optional(),
  remarks: z.string().optional(),
  /** Phase 7: condition changes (faulty, repaired, retired), oldest first. */
  history: z.array(coreEventSchema).optional(),
});

export const cableSchema = z.object({
  id,
  name: z.string().min(1),
  type: cableTypeSchema,
  manufacturer: z.string().optional(),
  model: z.string().optional(),
  fiberCount: z.number().int().nonnegative(),
  lengthMeters: z.number().nonnegative(),
  /** Absent when nobody has recorded how the cable was installed. */
  installationType: cableInstallationTypeSchema.optional(),
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
  /** Line colour on the map. Not a fiber colour. */
  colorHex: z.string().optional(),
  thickness: z.number().positive().optional(),
  /*
   * How the fibers are identified. Absent means not known: no colour is shown, never TIA-598 by
   * default. Identity is tube and fiber number, (tube - 1) x fibersPerTube + fiber.
   */
  colorScheme: z.string().min(1).max(60).optional(),
  /** Tube colours can follow another scheme than the fibers, or none. Absent means not known. */
  tubeColorScheme: z.string().min(1).max(60).optional(),
  fibersPerTube: z.number().int().positive().max(288).optional(),
  tubeCount: z.number().int().positive().max(288).optional(),
  /**
   * Phase 7: tube records, for tubes of different sizes. When present they decide the tubes; older
   * cables without them keep working from fibersPerTube and tubeCount.
   */
  tubes: z.array(cableTubeSchema).max(288).optional(),
  /** Where the layout came from, such as "Drum sheet, STL 96F, checked 4 Nov". */
  layoutSource: z.string().max(200).optional(),
  cores: z.array(fiberCoreSchema),
  cableCategory: z.enum(CABLE_CATEGORIES),
  /*
   * Lengths are kept apart and never overwrite each other. lengthMeters is worked out from the
   * drawn line. Sheath length comes from the printed marks a person read at both ends. Optical
   * length is what an OTDR reported. Each is optional: absent means nobody has recorded it.
   */
  sheathMarkStart: z.number().nonnegative().optional(),
  sheathMarkEnd: z.number().nonnegative().optional(),
  sheathMarkUnit: lengthMarkUnitSchema.optional(),
  sheathRecordedAt: isoDate.optional(),
  opticalLengthMeters: z.number().positive().optional(),
  opticalMeasuredAt: isoDate.optional(),
  /** Free text such as "OTDR, core 1, from the OLT end". */
  opticalLengthNote: z.string().max(200).optional(),
  /** Phase 4: outside diameter as on the datasheet or measured. Used only for duct fill; absent means not recorded. */
  outerDiameterMm: z.number().positive().max(200).optional(),
  /** Phase 5: how the cable is made, as on the drum sheet or datasheet. Each absent means not recorded. */
  fiberStandard: fiberStandardSchema.optional(),
  fiberMode: fiberModeSchema.optional(),
  sheath: cableSheathSchema.optional(),
  importInfo: importInfoSchema.optional(),
  /** Phase 23: values of the owner's own fields (`attr.cables.*` settings), by key. */
  customAttributes: z.record(z.string(), z.union([z.string().max(500), z.number(), z.boolean()])).optional(),
});

export const splitterPortSchema = z.object({
  portNumber: z.number().int().positive(),
  label: z.string(),
  status: splitterPortStatusSchema,
  connectedCustomerId: z.string().optional(),
  connectedCustomerName: z.string().optional(),
  /** The cable leaving this output (a drop or a lead cable). */
  connectedDropCableId: z.string().optional(),
  /** Which core of that cable. Without it the path cannot be followed core by core. */
  connectedCore: z.number().int().positive().optional(),
  /** Box or equipment the output goes to, when recorded. */
  connectedEquipmentId: z.string().optional(),
  connectedAt: isoDate.optional(),
  /** Configured loss of this output, for unequal couplers (such as 10/90). Overrides the splitter's. */
  lossDb: z.number().nonnegative().max(40).optional(),
  attenuationDb: z.number().optional(),
  history: z.array(historyEntrySchema).optional(),
  /**
   * Phase 11: the output was marked faulty and the person connected it anyway (a drop fiber or a
   * cascade splitter): who, why and when. Without it a new connection to a faulty output is refused.
   */
  override: z
    .object({
      status: splitterPortStatusSchema,
      reason: z.string().trim().min(1).max(300),
      at: isoDate,
      by: z.string().optional(),
    })
    .optional(),
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
    /** Cascade inside one box: this input is fed straight from another splitter's output. */
    connectedSplitterId: z.string().optional(),
    connectedSplitterPort: z.number().int().positive().optional(),
    linkedAt: isoDate.optional(),
    linkedBy: z.string().optional(),
    signalLevelDbm: z.number().optional(),
  }),
  outputPorts: z.array(splitterPortSchema),
  kind: splitterKindSchema.optional(),
  /** Unequal coupler split as written, such as "90/10". Its outputs carry their own loss. */
  couplerRatio: z.string().max(20).optional(),
  manufacturer: z.string().max(80).optional(),
  model: z.string().max(80).optional(),
  /** Where the insertion loss came from, such as a datasheet or "settings default". */
  lossSource: z.string().max(200).optional(),
  /** Set when the input side is fed by two OLT ports by design (a 2:N splitter). */
  dualInput: z.boolean().optional(),
  installedAt: isoDate.optional(),
  history: z.array(historyEntrySchema).optional(),
  /**
   * Phase 11: what a person recorded about this splitter's place in the network, when it differs
   * from (or adds to) what the recorded cascade shows. Never filled in by the app; the worked-out
   * answer is shown beside it (`splitterPlace`).
   */
  architecture: z
    .object({
      value: splitterArchitectureSchema,
      /** Splitter level from the PON port: 1 is the first splitter. */
      level: z.number().int().min(1).max(20).optional(),
      reason: z.string().trim().min(1).max(300),
      at: isoDate,
      by: z.string().optional(),
    })
    .optional(),
});

export const spliceRecordSchema = z.object({
  id,
  inputCableId: z.string(),
  inputCableName: z.string(),
  inputCore: z.number().int().positive(),
  outputCableId: z.string(),
  outputCableName: z.string(),
  outputCore: z.number().int().positive(),
  /** Absent when no loss was recorded. Older records have a value but no origin. */
  spliceLossDb: z.number().nonnegative().optional(),
  lossSource: lossSourceSchema.optional(),
  status: spliceStatusSchema,
  technician: z.string(),
  date: isoDate,
  trayId: z.string().optional(),
  spliceType: spliceTypeSchema.optional(),
  /** OTDR file name or test reference, as written. */
  otdrRef: z.string().max(120).optional(),
  photoIds: z.array(z.string()).optional(),
  notes: z.string().max(500).optional(),
  /** A splice taken out of service stays on record. Re-splicing retires the old one. */
  retiredAt: isoDate.optional(),
  retiredBy: z.string().optional(),
  retiredReason: z.string().max(300).optional(),
  replacedBySpliceId: z.string().optional(),
  /** Phase 8: cassette (or sub-tray) and splice position in the tray, as printed. */
  cassette: z.string().trim().min(1).max(40).optional(),
  position: z.number().int().positive().max(999).optional(),
  /** Phase 8: the meter, OTDR or splicer the loss was read on (make, model or serial), as written. */
  lossMeter: z.string().max(120).optional(),
  /** Phase 8: splice report or job sheet number, as written. */
  reportRef: z.string().max(120).optional(),
  /**
   * Phase 8: "entered by mistake". The splice never existed. It is kept as history, never deleted:
   * `retiredAt`, `retiredBy` and `retiredReason` say when, who and why it was struck out.
   */
  enteredInError: z.boolean().optional(),
});

/**
 * Phase 8: a fiber that ends on a pigtail (a connector) inside a closure, rather than being
 * spliced to another fiber. Not a link to other equipment: what the connector plugs into is
 * written as text only.
 */
export const fiberTerminationSchema = z.object({
  id,
  cableId: z.string().min(1),
  cableName: z.string(),
  core: z.number().int().positive(),
  /** Connector on the pigtail (SC/APC, LC/UPC ...). Absent when not recorded. */
  connectorType: z.string().trim().min(1).max(20).optional(),
  /** Label on the pigtail or adapter, as written. */
  pigtailLabel: z.string().max(60).optional(),
  /** What the connector plugs into, as written. Text only, never a link. */
  connectsTo: z.string().max(120).optional(),
  trayId: z.string().optional(),
  cassette: z.string().trim().min(1).max(40).optional(),
  position: z.number().int().positive().max(999).optional(),
  technician: z.string(),
  date: isoDate,
  notes: z.string().max(500).optional(),
  photoIds: z.array(z.string()).optional(),
  /** Taken out (or entered by mistake): kept as history with when, who and why. */
  retiredAt: isoDate.optional(),
  retiredBy: z.string().optional(),
  retiredReason: z.string().max(300).optional(),
  enteredInError: z.boolean().optional(),
});

export const spliceTraySchema = z.object({
  id,
  label: z.string().trim().min(1).max(40),
  /** Splice positions on the tray, as printed. */
  capacity: z.number().int().positive().max(144).optional(),
  notes: z.string().max(300).optional(),
});

/** A cable recorded at a closure, and which port or gland it uses. */
export const cableEntrySchema = z.object({
  cableId: z.string().min(1),
  role: cableEntryRoleSchema,
  port: z.string().max(40).optional(),
  notes: z.string().max(300).optional(),
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
  /** Phase 8: fibers ending on a pigtail or connector in this closure (not splices). */
  terminations: z.array(fiberTerminationSchema).optional(),
  images: z.array(equipmentImageSchema),
  remarks: z.string().optional(),
  /** The map pin this closure record belongs to, when there is one. */
  equipmentId: z.string().optional(),
  trays: z.array(spliceTraySchema).optional(),
  cableEntries: z.array(cableEntrySchema).optional(),
  photoIds: z.array(z.string()).optional(),
  condition: closureConditionSchema.optional(),
  sealStatus: sealStatusSchema.optional(),
  lastMaintainedAt: isoDate.optional(),
  maintenanceNotes: z.string().max(1000).optional(),
  createdAt: isoDate.optional(),
  createdBy: z.string().optional(),
});

/** A connection a customer used to have, kept after a disconnect or a move to another port. */
export const customerConnectionSchema = z.object({
  kind: z.enum(['disconnected', 'moved']),
  at: isoDate,
  by: z.string().optional(),
  reason: z.string().max(300),
  oltId: z.string().optional(),
  ponPort: z.string().optional(),
  terminalBoxId: z.string().optional(),
  splitterId: z.string().optional(),
  splitterOutputPort: z.number().int().optional(),
  dropCableId: z.string().optional(),
  fiberCore: z.number().int().optional(),
  ontId: z.string().optional(),
  ontSerialNumber: z.string().optional(),
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
  /** Absent when nothing has been recorded. Values with no rxSource have unknown origin. */
  rxOpticalPowerDbm: z.number().optional(),
  rxSource: rxSourceSchema.optional(),
  rxMeasuredAt: isoDate.optional(),
  /** The recorded OLT launch power a calculated reading was worked out from. */
  rxLaunchDbm: z.number().optional(),
  /** Photo of the meter display that proves a field reading. */
  rxPhotoId: z.string().optional(),
  /** The capture that recorded the reading, so saving it twice changes nothing. */
  rxCaptureId: z.string().optional(),
  /** Set on records from the bundled demo network: their readings are made up. */
  isSampleData: z.boolean().optional(),
  locationMethod: locationMethodSchema.optional(),
  locationAccuracyMeters: z.number().nonnegative().optional(),
  /*
   * Phase 5. All optional, so older customers keep working: their ONT is read from the embedded
   * `ontSerialNumber` and `routerModel` until a person makes an ONT record for it.
   */
  /** The ONT record this customer uses. */
  ontId: z.string().min(1).optional(),
  /** The building and unit (flat, shop) this customer is in. */
  buildingId: z.string().min(1).optional(),
  unitId: z.string().min(1).optional(),
  /** Connections this customer had before a disconnect or a move. Never deleted. */
  connectionHistory: z.array(customerConnectionSchema).optional(),
  disconnectedAt: isoDate.optional(),
  disconnectReason: z.string().max(300).optional(),
  history: z.array(historyEntrySchema).optional(),
  /**
   * Phase 6. `hfc`: a Cable TV customer on a coax tap port (their path is the RF tree, not a PON
   * port). Absent means a fiber customer, as before.
   */
  accessNetwork: z.enum(['pon', 'hfc']).optional(),
  /** Phase 23: values of the owner's own fields (`attr.customers.*` settings), by key. */
  customAttributes: z.record(z.string(), z.union([z.string().max(500), z.number(), z.boolean()])).optional(),
  /**
   * Phase 12: set only on a copy the server sent to an account whose role may not see these personal
   * fields. Never stored: the server takes it off, and keeps the real values, on every write.
   */
  hiddenFields: z.array(z.enum(['name', 'address', 'gps', 'mobile'])).max(4).optional(),
});

/* ------------------------------------------------------------------ */
/* Customers and connections: ONTs, services, buildings (Phase 5)      */
/* ------------------------------------------------------------------ */

/**
 * One ONT or ONU. Separate from the customer, so a customer can move to another ONT and an ONT can
 * be swapped with its history kept. The serial is exactly as entered, never generated; the OLT's
 * address for the ONU is kept as the vendor writes it, never converted.
 */
export const ontSchema = z.object({
  id,
  serialNumber: z.string().trim().max(64).optional(),
  vendor: z.string().trim().max(80).optional(),
  model: z.string().trim().max(80).optional(),
  technology: ponTechnologySchema.optional(),
  firmware: z.string().trim().max(60).optional(),
  arrangement: ontArrangementSchema,
  status: ontStatusSchema,
  statusSource: ontStatusSourceSchema,
  statusAt: isoDate.optional(),
  /** Only from a real integration with its time. Never set by a person. */
  lastSeenAt: isoDate.optional(),
  oltId: z.string().min(1).optional(),
  ponPortId: z.string().min(1).optional(),
  /** The OLT's address for this ONU as written, such as "gpon-onu_1/2/3:5" or "0/5/0 ont 1". */
  onuAddress: z.string().trim().max(80).optional(),
  /** The splitter output and drop fiber this ONT is plugged into. */
  splitterId: z.string().min(1).optional(),
  splitterOutputPort: z.number().int().positive().optional(),
  dropCableId: z.string().min(1).optional(),
  dropCore: z.number().int().positive().optional(),
  removedAt: isoDate.optional(),
  removedReason: z.string().max(300).optional(),
  replacedByOntId: z.string().optional(),
  history: z.array(historyEntrySchema).optional(),
  createdAt: isoDate,
  createdBy: z.string().optional(),
  notes: z.string().max(1000).optional(),
});

/**
 * One service a customer takes, such as internet or TV on the same fiber. Plans and prices are not
 * modelled: `planName` is only what the office wrote. An ended service stays as history.
 */
export const serviceSchema = z.object({
  id,
  customerId: id,
  kind: serviceKindSchema,
  status: serviceStatusSchema,
  planName: z.string().trim().max(120).optional(),
  ontId: z.string().min(1).optional(),
  /** The ONT port it uses, as written, such as "LAN 1" or "CATV". */
  ontPort: z.string().trim().max(40).optional(),
  /**
   * Phase 14: the service's logical binding, only as a person wrote it (no OLT is read yet). Never
   * filled in by the app. A VLAN id is 1 to 4094: IEEE 802.1Q reserves 0 and 4095. `vlan` is a
   * single tag; `sVlan` and `cVlan` are the outer and inner tags of a double-tagged (QinQ) service.
   */
  vlan: z.number().int().min(1).max(4094).optional(),
  sVlan: z.number().int().min(1).max(4094).optional(),
  cVlan: z.number().int().min(1).max(4094).optional(),
  /** The OLT's service or line profile name, as written. */
  profileName: z.string().trim().max(80).optional(),
  /** IP address or "PPPoE"/"DHCP" note, as written. Never generated. */
  ipAddress: z.string().trim().max(64).optional(),
  /** A circuit or service id given by the office or an upstream provider, as written. */
  circuitId: z.string().trim().max(80).optional(),
  /** Who wrote the binding above, and when. */
  bindingRecordedAt: isoDate.optional(),
  bindingRecordedBy: z.string().max(120).optional(),
  startedAt: isoDate.optional(),
  endedAt: isoDate.optional(),
  endReason: z.string().max(300).optional(),
  history: z.array(historyEntrySchema).optional(),
  createdAt: isoDate,
  createdBy: z.string().optional(),
  notes: z.string().max(1000).optional(),
});

/** A box on one floor of a building, where the flats' drops start. */
export const buildingFloorBoxSchema = z.object({
  id,
  label: z.string().trim().min(1).max(60),
  /** As written, such as "3", "G" or "B1". */
  floor: z.string().trim().max(20).optional(),
  /** Its map pin, when it has one. */
  equipmentId: z.string().min(1).optional(),
  /** The splitter inside it, when there is one. */
  splitterId: z.string().min(1).optional(),
  notes: z.string().max(300).optional(),
});

/** A flat, shop or office in a building. Customers point to it; it holds no service itself. */
export const buildingUnitSchema = z.object({
  id,
  label: z.string().trim().min(1).max(40),
  floor: z.string().trim().max(20).optional(),
  floorBoxId: z.string().min(1).optional(),
  notes: z.string().max(300).optional(),
});

/**
 * A building and how fiber reaches each unit: entry point, riser, floor boxes and units. The
 * footprint is a point. Each part is optional and shown as "Not recorded" until a person adds it.
 */
export const buildingSchema = z.object({
  id,
  name: z.string().trim().min(1).max(120),
  address: z.string().trim().max(300).optional(),
  kind: buildingKindSchema,
  lat: latitude,
  lng: longitude,
  locationMethod: locationMethodSchema.optional(),
  locationAccuracyMeters: z.number().nonnegative().optional(),
  /** Phase 4: the outline drawn on the map, in addition to the point. At least 3 corners; absent means not drawn. */
  footprint: z.array(latLngSchema).min(3).max(500).optional(),
  floorsAbove: z.number().int().nonnegative().max(200).optional(),
  floorsBelow: z.number().int().nonnegative().max(20).optional(),
  /** The Building Entry Point pin (or other pin) where the street cable comes in. */
  entryEquipmentId: z.string().min(1).optional(),
  entryNote: z.string().max(300).optional(),
  /** The cable that climbs the building from the entry to the floors. */
  riserCableId: z.string().min(1).optional(),
  riserNote: z.string().max(300).optional(),
  floorBoxes: z.array(buildingFloorBoxSchema).max(500),
  units: z.array(buildingUnitSchema).max(2000),
  history: z.array(historyEntrySchema).optional(),
  createdAt: isoDate,
  createdBy: z.string().optional(),
  notes: z.string().max(2000).optional(),
});

/** A network element named by an alarm, a suspected cause or an impact question. */
export const networkElementRefSchema = z.object({
  type: networkElementTypeSchema,
  /** The record id; for a PON port the OLT, for a core the cable. */
  id: z.string().min(1),
  ponPortId: z.string().min(1).optional(),
  fiberNumber: z.number().int().positive().optional(),
});

/**
 * How a repair was checked. A light reading counts only as `field_measured` with the meter photo;
 * a photo needs the photo; an office check needs a note of what was checked. Who and when always.
 */
export const verificationSchema = z.object({
  method: verificationMethodSchema,
  at: isoDate,
  by: z.string().min(1),
  readingDbm: z.number().min(-60).max(10).optional(),
  readingOrigin: z.literal('field_measured').optional(),
  /** The house where the reading was taken. */
  customerId: z.string().min(1).optional(),
  photoId: z.string().min(1).optional(),
  note: z.string().max(1000).optional(),
  /** The job the verification came from, when it came from one. */
  workOrderId: z.string().min(1).optional(),
});

/**
 * One alarm: something a person, a field report, a TEST or (Phase 7) a monitoring source said
 * about one element. A `device_adapter` alarm is made only by the monitoring ingestion path.
 */
export const alarmSchema = z.object({
  id,
  kind: alarmKindSchema,
  source: alarmSourceSchema,
  /** A TEST event. Always shown as TEST and left out of reports unless asked for. */
  isTest: z.boolean(),
  severity: severitySchema,
  state: alarmStateSchema,
  element: networkElementRefSchema,
  firstSeenAt: isoDate,
  lastSeenAt: isoDate,
  /** The same alarm reported again while open counts here instead of making a new one. */
  occurrences: z.number().int().positive(),
  note: z.string().max(1000).optional(),
  reportedBy: z.string().optional(),
  acknowledgedAt: isoDate.optional(),
  acknowledgedBy: z.string().optional(),
  clearedAt: isoDate.optional(),
  clearedBy: z.string().optional(),
  faultId: z.string().min(1).optional(),
  history: z.array(historyEntrySchema).optional(),
  /**
   * Phase 7: a `device_adapter` alarm (or a TEST alarm from the simulator) names the monitoring
   * source and the status or reading rows behind it. A device alarm without them is refused.
   */
  monitoringSourceId: z.string().min(1).optional(),
  evidenceIds: z.array(z.string().min(1)).max(20).optional(),
});

/** What the office was told when it opened a fault from a suspected cause, kept as it was then. */
export const suspectedCauseSchema = z.object({
  element: networkElementRefSchema,
  label: z.string().max(200),
  confidence: confidenceSchema,
  evidence: z.array(z.string().max(500)).max(40),
  missing: z.array(z.string().max(500)).max(40),
  checks: z.array(z.string().max(500)).max(20),
  computedAt: isoDate,
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
  /** Reported as dangerous to people, not only to the network. */
  unsafe: z.boolean().optional(),
  locationMethod: locationMethodSchema.optional(),
  locationAccuracyMeters: z.number().nonnegative().optional(),
  ...fieldCaptureFields,
  /*
   * Phase 8. All optional, so older faults keep loading. A fault opened from alarms keeps them,
   * the suspected cause as it was shown, and who is affected from recorded paths at that time.
   */
  source: alarmSourceSchema.optional(),
  isTest: z.boolean().optional(),
  element: networkElementRefSchema.optional(),
  alarmIds: z.array(z.string().min(1)).max(2000).optional(),
  suspected: suspectedCauseSchema.optional(),
  /** Customers whose path is not fully recorded, so they may or may not be affected. */
  mayBeAffectedCustomerIds: z.array(z.string()).optional(),
  acknowledgedAt: isoDate.optional(),
  acknowledgedBy: z.string().optional(),
  repairedAt: isoDate.optional(),
  verifiedAt: isoDate.optional(),
  verifiedBy: z.string().optional(),
  verification: verificationSchema.optional(),
  closedAt: isoDate.optional(),
  closedBy: z.string().optional(),
  resolution: z.string().max(2000).optional(),
  /** The step before "On hold", so resuming returns to it. */
  heldFrom: z.enum(FAULT_STATUSES).optional(),
  history: z.array(historyEntrySchema).optional(),
});

export const jobStepSchema = z.object({
  id,
  label: z.string().trim().min(1).max(200),
  doneAt: isoDate.optional(),
  doneBy: z.string().optional(),
});

export const jobPhotoSchema = z.object({
  photoId: id,
  kind: jobPhotoKindSchema,
  at: isoDate,
  by: z.string().optional(),
  /** The phone event that added it, so Undo removes only that one. */
  eventId: z.string().optional(),
});

/** Material used, exactly as the technician entered it. Nothing is priced or counted from stock. */
export const jobMaterialSchema = z.object({
  id,
  item: z.string().trim().min(1).max(120),
  quantity: z.number().positive().max(100000),
  unit: z.string().max(20),
  at: isoDate,
  by: z.string().optional(),
});

export const jobNoteSchema = z.object({
  id,
  at: isoDate,
  by: z.string().optional(),
  text: z.string().trim().min(1).max(1000),
});

/** One thing done on the phone. Kept so a repeated save adds nothing and Undo removes only that. */
export const jobEventSchema = z.object({
  id,
  kind: jobEventKindSchema,
  at: isoDate,
  by: z.string().optional(),
  /** The photo, step, material or note it added. */
  ref: z.string().optional(),
  /** The status before it, when it changed the status. */
  previousStatus: workOrderStatusSchema.optional(),
  undoneAt: isoDate.optional(),
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
  /* Phase 8. All optional, so older work orders keep loading. */
  isTest: z.boolean().optional(),
  steps: z.array(jobStepSchema).max(50).optional(),
  photoRefs: z.array(jobPhotoSchema).max(200).optional(),
  materials: z.array(jobMaterialSchema).max(200).optional(),
  fieldNotes: z.array(jobNoteSchema).max(200).optional(),
  fieldEvents: z.array(jobEventSchema).max(1000).optional(),
  verification: verificationSchema.optional(),
  createdAt: isoDate.optional(),
  assignedAt: isoDate.optional(),
  startedAt: isoDate.optional(),
  repairedAt: isoDate.optional(),
  verifiedAt: isoDate.optional(),
  closedAt: isoDate.optional(),
  closedBy: z.string().optional(),
  heldFrom: workOrderStatusSchema.optional(),
  history: z.array(historyEntrySchema).optional(),
});

/**
 * A record two people changed at the same time, kept with both versions. `mine` is what this
 * device had, `theirs` what the server had (null when that side deleted it). Nothing is lost
 * whichever is chosen; the office sees every one.
 */
export const syncConflictSchema = z.object({
  id,
  collection: z.string().min(1).max(40),
  recordId: z.string().min(1),
  label: z.string().max(200),
  baseVersion: z.number().int().nonnegative(),
  theirVersion: z.number().int().nonnegative().nullable(),
  mine: z.record(z.string(), z.unknown()).nullable(),
  theirs: z.record(z.string(), z.unknown()).nullable(),
  changedFields: z.array(z.string().max(80)).max(300),
  detectedAt: isoDate,
  detectedBy: z.string(),
  status: syncConflictStatusSchema,
  decidedAt: isoDate.optional(),
  decidedBy: z.string().optional(),
  note: z.string().max(500).optional(),
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
  /** This hop marks a missing link rather than a real part of the path. */
  gap: z.boolean().optional(),
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

/** `[epoch ms, lat, lng, accuracy m]`, compact because a day of duty holds thousands of points. */
export const agentTrackPointSchema = z.tuple([z.number(), latitude, longitude, z.number().nonnegative()]);

/** A period with no usable location. An open gap has no end time yet. */
export const agentTrackingGapSchema = z.object({
  startTime: isoDate,
  endTime: isoDate.optional(),
  reason: z.string(),
});

/** One field agent's duty, from Start Duty to End Duty. Stops are derived from the points. */
export const agentTripSchema = z.object({
  id,
  agentName: z.string().min(1),
  status: z.enum(['active', 'completed']),
  startTime: isoDate,
  endTime: isoDate.optional(),
  /** Last time any location reading arrived, usable or not. */
  lastContactAt: isoDate,
  points: z.array(agentTrackPointSchema),
  gaps: z.array(agentTrackingGapSchema),
  /** Agent notes keyed by the stop's start time in epoch ms. */
  stopNotes: z.record(z.string(), z.string()),
});

/* ------------------------------------------------------------------ */
/* Outside plant: spans, attachments, ducts, slack loops, permissions  */
/* ------------------------------------------------------------------ */

const ospRecordFields = {
  createdAt: isoDate,
  createdBy: z.string().optional(),
  notes: z.string().max(2000).optional(),
};

/**
 * An aerial span: the stretch between two structures (usually poles). It is a structure, never a
 * cable; which cables it carries is recorded separately as attachments.
 */
export const spanSchema = z
  .object({
    id,
    name: z.string().min(1),
    fromStructureId: id,
    toStructureId: id,
    status: structureStatusSchema,
    basis: linkBasisSchema,
    /** Entered by a person (tape or wheel), never the map distance. */
    measuredLengthMeters: z.number().positive().optional(),
    roadCrossing: z.boolean().optional(),
    captureRunId: z.string().optional(),
    confirmedAt: isoDate.optional(),
    confirmedBy: z.string().optional(),
    /**
     * Phase 4: the bends between the two ends as a person drew them (a sag or a detour). The ends
     * are never stored here: they always follow the two poles. Absent means a straight line.
     */
    routePoints: z.array(latLngSchema).max(200).optional(),
    /** Phase 4: how the span looked when last checked, as set by a person. Absent means not recorded. */
    condition: ospConditionSchema.optional(),
    conditionAt: isoDate.optional(),
    ...ospRecordFields,
  })
  .refine((span) => span.fromStructureId !== span.toStructureId, {
    message: 'A span must join two different structures.',
    path: ['toStructureId'],
  });

/** One cable carried on one pole or one span. Saved only when a person confirms it. */
export const attachmentSchema = z
  .object({
    id,
    cableId: id,
    structureId: z.string().min(1).optional(),
    spanId: z.string().min(1).optional(),
    status: attachmentStatusSchema,
    basis: linkBasisSchema,
    ...ospRecordFields,
  })
  .refine((a) => (a.structureId === undefined) !== (a.spanId === undefined), {
    message: 'An attachment is on exactly one pole or one span.',
    path: ['structureId'],
  });

/** Phase 4: whether a way can still take a cable, who said so and when. */
const wayConditionFields = {
  condition: wayConditionSchema.optional(),
  conditionNote: z.string().max(300).optional(),
  conditionAt: isoDate.optional(),
};

/** Phase 4: a microduct inside a sub-duct (way), holding its own cables. */
export const microductSchema = z.object({
  id,
  /** As marked, such as "Red" or "7". */
  label: z.string().min(1).max(40),
  /** Inside diameter, used for fill. Absent means not recorded. */
  innerDiameterMm: z.number().positive().max(200).optional(),
  cableIds: z.array(z.string().min(1)),
  ...wayConditionFields,
});

export const subductSchema = z.object({
  id,
  /** As marked, such as "1", "Blue" or "40 mm left". */
  label: z.string().min(1).max(40),
  diameterMm: z.number().positive().max(500).optional(),
  /** Phase 4: inside diameter, used for fill. Absent means not recorded; the outside size above is not used for it. */
  innerDiameterMm: z.number().positive().max(500).optional(),
  cableIds: z.array(z.string().min(1)),
  /** Phase 4: microducts laid inside this way. */
  microducts: z.array(microductSchema).max(100).optional(),
  ...wayConditionFields,
});

/** An underground duct route. Occupancy lists the cables in it or in each of its sub-ducts. */
export const ductSchema = z.object({
  id,
  name: z.string().min(1),
  coordinates: z.array(latLngSchema).min(2),
  fromStructureId: z.string().min(1).optional(),
  toStructureId: z.string().min(1).optional(),
  /** Phase 4: where it enters the chamber at each end, as written ("north wall, hole 2"). Absent means not recorded. */
  startEntry: z.string().trim().min(1).max(80).optional(),
  endEntry: z.string().trim().min(1).max(80).optional(),
  status: structureStatusSchema,
  basis: linkBasisSchema,
  /** Number of ducts laid together. */
  wayCount: z.number().int().positive().max(100).optional(),
  diameterMm: z.number().positive().max(2000).optional(),
  /** Phase 4: inside diameter of the duct itself, used for fill. Absent means not recorded. */
  innerDiameterMm: z.number().positive().max(2000).optional(),
  material: z.string().max(60).optional(),
  depthObservedMeters: z.number().positive().max(20).optional(),
  permitDepthMeters: z.number().positive().max(20).optional(),
  ownerName: z.string().max(120).optional(),
  /** Cables in the duct itself, not in a sub-duct. */
  cableIds: z.array(z.string().min(1)),
  subducts: z.array(subductSchema),
  /** Phase 4: the duct's own state. Blocked here blocks every way inside it. */
  ...wayConditionFields,
  importInfo: importInfoSchema.optional(),
  ...ospRecordFields,
});

/** A coil of spare cable left at a place on the route, with the length a person recorded. */
export const slackLoopSchema = z.object({
  id,
  name: z.string().min(1),
  cableId: id,
  /** The pole, chamber or box it hangs on or lies in. */
  structureId: z.string().min(1).optional(),
  lat: latitude,
  lng: longitude,
  lengthMeters: z.number().positive().max(5000),
  /** marks: worked out from the printed marks either side of the loop. */
  lengthSource: z.enum(['entered', 'marks']),
  markBefore: z.number().nonnegative().optional(),
  markAfter: z.number().nonnegative().optional(),
  markUnit: lengthMarkUnitSchema.optional(),
  ...ospRecordFields,
});

/**
 * A permission or right-of-way record, as written on the paper. Amounts and dates are what the
 * office typed in; nothing is calculated from rate tables.
 */
export const permissionSchema = z.object({
  id,
  /** The owner or authority who gave it, such as "BESCOM" or "BBMP". */
  authority: z.string().trim().min(1).max(120),
  kind: permissionKindSchema.optional(),
  permitNumber: z.string().trim().max(80).optional(),
  structureIds: z.array(z.string().min(1)),
  cableIds: z.array(z.string().min(1)).optional(),
  issuedOn: isoDate.optional(),
  validFrom: isoDate.optional(),
  validUntil: isoDate.optional(),
  rentAmount: z.number().nonnegative().optional(),
  /** As written, such as "per pole per year". */
  rentTerms: z.string().max(120).optional(),
  documentId: z.string().optional(),
  ...ospRecordFields,
});

/**
 * Phase 4: one inspection of a pole, chamber, span or duct, as the person who did it recorded it:
 * when, who, the condition they chose, what they found and their photos. History: a new
 * inspection never changes an older one.
 */
export const inspectionSchema = z.object({
  id,
  targetType: inspectionTargetSchema,
  /** The pole or chamber (equipment), span or duct inspected. */
  targetId: id,
  /** The day of the inspection, as the person gave it (YYYY-MM-DD). */
  inspectedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-11-10.'),
  inspectedBy: z.string().trim().min(1).max(120),
  condition: ospConditionSchema,
  findings: z.string().max(2000).optional(),
  /** Photo ids stored by `/api/v1/photos/<id>`. */
  photoIds: z.array(z.string().min(1)).max(20).optional(),
  /**
   * Phase 19: the checklist answers the person gave, with each item's words as they were shown then
   * (the list in settings can change later). An item not answered is not stored: "Not recorded".
   */
  checklist: z
    .array(
      z.object({
        itemId: z.string().min(1).max(60),
        label: z.string().trim().min(1).max(120),
        answer: checklistAnswerSchema,
      }),
    )
    .max(60)
    .optional(),
  ...ospRecordFields,
});

/**
 * Phase 9: a place that holds racks, such as an exchange, central office, hub room or POP, as the
 * office names it. A map position is optional: absent is "not recorded", never guessed.
 */
export const siteSchema = z.object({
  id,
  name: z.string().trim().min(1).max(120),
  /** As written, such as "Exchange", "Hub room", "POP". */
  kind: z.string().trim().max(60).optional(),
  address: z.string().trim().max(300).optional(),
  lat: latitude.optional(),
  lng: longitude.optional(),
  notes: z.string().max(1000).optional(),
  createdAt: isoDate.optional(),
  createdBy: z.string().optional(),
  updatedAt: isoDate.optional(),
  updatedBy: z.string().optional(),
});

/**
 * Phase 9: one rack (or wall frame) at a site. Its height in units is what is written on the rack;
 * without it no elevation is drawn and no unit is called free.
 */
export const rackSchema = z.object({
  id,
  siteId: id,
  /** As painted or labelled, such as "Rack 3". */
  name: z.string().trim().min(1).max(60),
  heightUnits: z.number().int().positive().max(60).optional(),
  /** Which way the units are numbered. Absent: not recorded (drawn from the bottom, and the screen says so). */
  numbering: rackNumberingSchema.optional(),
  /** Where it stands in the room, such as "Row B, second from the door". */
  location: z.string().trim().max(120).optional(),
  notes: z.string().max(1000).optional(),
  createdAt: isoDate.optional(),
  createdBy: z.string().optional(),
  updatedAt: isoDate.optional(),
  updatedBy: z.string().optional(),
});

/**
 * Phase 6: one stretch of ONE cable, such as "on poles from P-3 to P-9" or "in duct D-2 for the
 * next 300 m". It describes the cable; it is never a cable of its own. Each end is either a recorded
 * structure (a pole, chamber or box on the cable's line) or a distance along the drawn line from
 * the cable's From end. Every other field is optional: absent means not recorded.
 */
export const cableSegmentSchema = z
  .object({
    id,
    cableId: id,
    fromStructureId: z.string().min(1).optional(),
    /** Metres along the drawn line from the cable's From end. The drawn line is an estimate. */
    fromMeters: z.number().nonnegative().max(1_000_000).optional(),
    toStructureId: z.string().min(1).optional(),
    toMeters: z.number().nonnegative().max(1_000_000).optional(),
    /** How this stretch is installed. Absent: not recorded (the cable's own method may still say). */
    installMethod: cableInstallationTypeSchema.optional(),
    /** The duct this stretch runs in. */
    ductId: z.string().min(1).optional(),
    /** The sub-duct (way) or microduct inside that duct, by its id. */
    ductWayId: z.string().min(1).optional(),
    /** The aerial spans this stretch hangs on. */
    spanIds: z.array(z.string().min(1)).max(500).optional(),
    /** Entered by a person (tape, wheel, cable marks), never the map distance. */
    measuredLengthMeters: z.number().positive().max(100_000).optional(),
    /** How it was measured, as written, such as "marks 1200 to 1450". */
    lengthNote: z.string().trim().max(200).optional(),
    status: structureStatusSchema.optional(),
    updatedAt: isoDate.optional(),
    updatedBy: z.string().optional(),
    ...ospRecordFields,
  })
  .superRefine((s, ctx) => {
    for (const end of ['from', 'to'] as const) {
      const structure = s[`${end}StructureId`] !== undefined;
      const meters = s[`${end}Meters`] !== undefined;
      if (structure === meters) {
        ctx.addIssue({ code: 'custom', path: [`${end}StructureId`], message: `The ${end === 'from' ? 'start' : 'end'} of a stretch is one structure or one distance along the cable.` });
      }
    }
    if (s.ductWayId !== undefined && s.ductId === undefined) {
      ctx.addIssue({ code: 'custom', path: ['ductWayId'], message: 'A way is inside a duct: choose the duct too.' });
    }
  });

/**
 * One operator override of an application setting, keyed by the setting's id. A value with no record
 * uses its documented default, so an empty collection means "all defaults".
 */
export const settingSchema = z.object({
  id,
  value: z.union([z.number(), z.string(), z.boolean()]),
  /** Where the operator got this value, such as a datasheet. */
  source: z.string().optional(),
  updatedAt: isoDate.optional(),
  updatedBy: z.string().optional(),
});
