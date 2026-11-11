import { z } from 'zod';

import { importRecordSchema } from './importSchemas';
import { linkVerificationSchema } from './linkVerificationSchemas';
import { deviceStatusSchema, monitoringSourceSchema, onuReadingSchema, onuStatusSchema } from './monitoringSchemas';
import { opticalBudgetRunSchema } from './opticalBudgetSchemas';
import { planningScenarioSchema } from './planningSchemas';
import { rfElementSchema, rfLevelSchema, rfLinkSchema } from './rfSchemas';
import { validationFindingSchema } from './validationFindingSchemas';
import {
  agentTripSchema,
  alarmSchema,
  attachmentSchema,
  auditLogSchema,
  buildingSchema,
  cableSchema,
  cableSegmentSchema,
  catalogComponentSchema,
  customerSchema,
  ductSchema,
  equipmentSchema,
  faultSchema,
  gpsRouteSchema,
  inspectionSchema,
  jointClosureSchema,
  networkDocumentSchema,
  networkZoneSchema,
  ontSchema,
  permissionSchema,
  rackSchema,
  serviceSchema,
  settingSchema,
  siteSchema,
  slackLoopSchema,
  spanSchema,
  splitterSchema,
  syncConflictSchema,
  workOrderSchema,
} from './schemas';

/**
 * Every persisted entity collection and the schema that validates one record of it.
 * The keys double as API resource names (`/api/v1/<collection>`) and storage table names.
 */
export const COLLECTION_SCHEMAS = {
  equipment: equipmentSchema,
  cables: cableSchema,
  splitters: splitterSchema,
  closures: jointClosureSchema,
  customers: customerSchema,
  faults: faultSchema,
  workOrders: workOrderSchema,
  auditLogs: auditLogSchema,
  zones: networkZoneSchema,
  documents: networkDocumentSchema,
  catalog: catalogComponentSchema,
  gpsRoutes: gpsRouteSchema,
  agentTrips: agentTripSchema,
  settings: settingSchema,
  spans: spanSchema,
  attachments: attachmentSchema,
  ducts: ductSchema,
  slackLoops: slackLoopSchema,
  permissions: permissionSchema,
  onts: ontSchema,
  services: serviceSchema,
  buildings: buildingSchema,
  alarms: alarmSchema,
  syncConflicts: syncConflictSchema,
  rfElements: rfElementSchema,
  rfLinks: rfLinkSchema,
  rfLevels: rfLevelSchema,
  monitoringSources: monitoringSourceSchema,
  onuReadings: onuReadingSchema,
  onuStatuses: onuStatusSchema,
  // Network mapping Phase 20: OLT, card, PON port and uplink status from a push source.
  deviceStatuses: deviceStatusSchema,
  inspections: inspectionSchema,
  // Phase 9: sites and racks.
  sites: siteSchema,
  racks: rackSchema,
  // Phase 6: stretches of one cable (install method, duct or spans, measured length).
  cableSegments: cableSegmentSchema,
  // Network mapping Phase 13: checks of physical links (OTDR, red light, meter, looked at it).
  linkVerifications: linkVerificationSchema,
  // Network mapping Phase 15: stored map-check findings (open, fine as it is, fixed; never deleted).
  validationFindings: validationFindingSchema,
  // Network mapping Phase 18: expansion scenarios. Plans only, never counted as the built network.
  planningScenarios: planningScenarioSchema,
  // Network mapping Phase 17: stored optical budget runs. History only; never changed, never a network record.
  opticalBudgetRuns: opticalBudgetRunSchema,
  // Network mapping Phase 21: import history (who, when, which file, what was made), for undo by import.
  imports: importRecordSchema,
} as const;

export type CollectionName = keyof typeof COLLECTION_SCHEMAS;
export const COLLECTION_NAMES = Object.keys(COLLECTION_SCHEMAS) as CollectionName[];

export type CollectionRecord<C extends CollectionName> = z.infer<(typeof COLLECTION_SCHEMAS)[C]>;

export const isCollectionName = (value: string): value is CollectionName =>
  Object.prototype.hasOwnProperty.call(COLLECTION_SCHEMAS, value);

/** The whole network as a single document: one array per collection. */
export const networkSnapshotSchema = z.object(
  Object.fromEntries(COLLECTION_NAMES.map((name) => [name, z.array(COLLECTION_SCHEMAS[name])])) as {
    [C in CollectionName]: z.ZodArray<(typeof COLLECTION_SCHEMAS)[C]>;
  },
);
export type NetworkSnapshot = { [C in CollectionName]: CollectionRecord<C>[] };
