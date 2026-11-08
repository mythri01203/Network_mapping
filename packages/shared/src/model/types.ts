import type { z } from 'zod';

import type {
  agentTrackPointSchema,
  agentTripSchema,
  alarmSchema,
  attachmentSchema,
  auditLogSchema,
  buildingFloorBoxSchema,
  buildingSchema,
  buildingUnitSchema,
  cableCoreLinkSchema,
  cableEntrySchema,
  cableSchema,
  catalogComponentSchema,
  coreAssignmentSchema,
  customerConnectionSchema,
  customerSchema,
  ductSchema,
  equipmentImageSchema,
  equipmentPortSchema,
  equipmentSchema,
  faultSchema,
  fiberCoreSchema,
  fiberTraceHopSchema,
  gpsRouteSchema,
  historyEntrySchema,
  imageAnnotationSchema,
  importInfoSchema,
  jobEventSchema,
  jobMaterialSchema,
  jobNoteSchema,
  jobPhotoSchema,
  jobStepSchema,
  jointClosureSchema,
  latLngSchema,
  networkDocumentSchema,
  networkElementRefSchema,
  networkZoneSchema,
  odfPanelSchema,
  odfPortSchema,
  oltConfigSchema,
  ontSchema,
  opticalPortSchema,
  opticalPowerInfoSchema,
  opticalPowerSampleSchema,
  permissionSchema,
  ponPortSchema,
  serviceSchema,
  settingSchema,
  slackLoopSchema,
  spanSchema,
  spliceMatrixEntrySchema,
  spliceRecordSchema,
  spliceTraySchema,
  splitterPortSchema,
  splitterSchema,
  subductSchema,
  suspectedCauseSchema,
  syncConflictSchema,
  verificationSchema,
  workOrderSchema,
} from './schemas';

export type LatLng = z.infer<typeof latLngSchema>;
export type NetworkZone = z.infer<typeof networkZoneSchema>;
export type NetworkDocument = z.infer<typeof networkDocumentSchema>;
export type EquipmentPort = z.infer<typeof equipmentPortSchema>;
export type OpticalPowerSample = z.infer<typeof opticalPowerSampleSchema>;
export type OpticalPowerInfo = z.infer<typeof opticalPowerInfoSchema>;
export type CatalogComponent = z.infer<typeof catalogComponentSchema>;
export type ImageAnnotation = z.infer<typeof imageAnnotationSchema>;
export type EquipmentImage = z.infer<typeof equipmentImageSchema>;
export type PonPort = z.infer<typeof ponPortSchema>;
export type Equipment = z.infer<typeof equipmentSchema>;
export type FiberCore = z.infer<typeof fiberCoreSchema>;
export type Cable = z.infer<typeof cableSchema>;
export type SplitterPort = z.infer<typeof splitterPortSchema>;
export type Splitter = z.infer<typeof splitterSchema>;
export type SpliceRecord = z.infer<typeof spliceRecordSchema>;
export type JointClosure = z.infer<typeof jointClosureSchema>;
export type Customer = z.infer<typeof customerSchema>;
export type Fault = z.infer<typeof faultSchema>;
export type WorkOrder = z.infer<typeof workOrderSchema>;
export type AuditLog = z.infer<typeof auditLogSchema>;
export type OpticalPort = z.infer<typeof opticalPortSchema>;
export type SpliceMatrixEntry = z.infer<typeof spliceMatrixEntrySchema>;
export type CableCoreLink = z.infer<typeof cableCoreLinkSchema>;
export type FiberTraceHop = z.infer<typeof fiberTraceHopSchema>;
export type GpsRoute = z.infer<typeof gpsRouteSchema>;
export type AgentTrackPoint = z.infer<typeof agentTrackPointSchema>;
export type AgentTrip = z.infer<typeof agentTripSchema>;
export type Setting = z.infer<typeof settingSchema>;
export type OltConfig = z.infer<typeof oltConfigSchema>;
export type ImportInfo = z.infer<typeof importInfoSchema>;
export type Span = z.infer<typeof spanSchema>;
export type Attachment = z.infer<typeof attachmentSchema>;
export type Subduct = z.infer<typeof subductSchema>;
export type Duct = z.infer<typeof ductSchema>;
export type SlackLoop = z.infer<typeof slackLoopSchema>;
export type Permission = z.infer<typeof permissionSchema>;
export type HistoryEntry = z.infer<typeof historyEntrySchema>;
export type CoreAssignment = z.infer<typeof coreAssignmentSchema>;
export type OdfPort = z.infer<typeof odfPortSchema>;
export type OdfPanel = z.infer<typeof odfPanelSchema>;
export type SpliceTray = z.infer<typeof spliceTraySchema>;
export type CableEntry = z.infer<typeof cableEntrySchema>;
export type CustomerConnection = z.infer<typeof customerConnectionSchema>;
export type Ont = z.infer<typeof ontSchema>;
export type Service = z.infer<typeof serviceSchema>;
export type Building = z.infer<typeof buildingSchema>;
export type BuildingFloorBox = z.infer<typeof buildingFloorBoxSchema>;
export type BuildingUnit = z.infer<typeof buildingUnitSchema>;
export type NetworkElementRef = z.infer<typeof networkElementRefSchema>;
export type Verification = z.infer<typeof verificationSchema>;
export type Alarm = z.infer<typeof alarmSchema>;
export type SuspectedCause = z.infer<typeof suspectedCauseSchema>;
export type JobStep = z.infer<typeof jobStepSchema>;
export type JobPhoto = z.infer<typeof jobPhotoSchema>;
export type JobMaterial = z.infer<typeof jobMaterialSchema>;
export type JobNote = z.infer<typeof jobNoteSchema>;
export type JobEvent = z.infer<typeof jobEventSchema>;
export type SyncConflict = z.infer<typeof syncConflictSchema>;

/** One hop of a computed OLT-to-customer path. Derived at runtime, never stored. */
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
