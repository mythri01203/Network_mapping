import { z } from 'zod';

import {
  agentTripSchema,
  alarmSchema,
  attachmentSchema,
  auditLogSchema,
  buildingSchema,
  cableSchema,
  catalogComponentSchema,
  customerSchema,
  ductSchema,
  equipmentSchema,
  faultSchema,
  gpsRouteSchema,
  jointClosureSchema,
  networkDocumentSchema,
  networkZoneSchema,
  ontSchema,
  permissionSchema,
  serviceSchema,
  settingSchema,
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
