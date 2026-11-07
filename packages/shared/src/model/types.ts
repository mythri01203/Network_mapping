import type { z } from 'zod';

import type {
  agentTrackPointSchema,
  agentTripSchema,
  auditLogSchema,
  cableCoreLinkSchema,
  cableSchema,
  catalogComponentSchema,
  customerSchema,
  equipmentImageSchema,
  equipmentPortSchema,
  equipmentSchema,
  faultSchema,
  fiberCoreSchema,
  fiberTraceHopSchema,
  gpsRouteSchema,
  imageAnnotationSchema,
  jointClosureSchema,
  latLngSchema,
  networkDocumentSchema,
  networkZoneSchema,
  oltConfigSchema,
  opticalPortSchema,
  opticalPowerInfoSchema,
  opticalPowerSampleSchema,
  ponPortSchema,
  settingSchema,
  spliceMatrixEntrySchema,
  spliceRecordSchema,
  splitterPortSchema,
  splitterSchema,
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
