import type { NetworkSnapshot } from '../model/collections';
import {
  SAMPLE_AUDIT_LOGS,
  SAMPLE_CABLES,
  SAMPLE_CUSTOMERS,
  SAMPLE_DOCUMENTS,
  SAMPLE_EQUIPMENT,
  SAMPLE_FAULTS,
  SAMPLE_JOINT_CLOSURES,
  SAMPLE_SPLITTERS,
  SAMPLE_WORK_ORDERS,
  SAMPLE_ZONES,
} from './sampleNetwork';

export * from './sampleNetwork';

/** A fresh, independently mutable copy of the bundled demo network, used to seed new databases. */
export function createSampleNetwork(): NetworkSnapshot {
  const snapshot: NetworkSnapshot = {
    equipment: SAMPLE_EQUIPMENT.map((item) => ({ ...item, isSampleData: true })),
    cables: SAMPLE_CABLES,
    splitters: SAMPLE_SPLITTERS,
    closures: SAMPLE_JOINT_CLOSURES,
    customers: SAMPLE_CUSTOMERS.map((customer) => ({ ...customer, isSampleData: true })),
    faults: SAMPLE_FAULTS,
    workOrders: SAMPLE_WORK_ORDERS,
    auditLogs: SAMPLE_AUDIT_LOGS,
    zones: SAMPLE_ZONES,
    documents: SAMPLE_DOCUMENTS,
    catalog: [],
    gpsRoutes: [],
    agentTrips: [],
    settings: [],
    spans: [],
    attachments: [],
    ducts: [],
    slackLoops: [],
    permissions: [],
    onts: [],
    services: [],
    buildings: [],
    alarms: [],
    syncConflicts: [],
  };
  return JSON.parse(JSON.stringify(snapshot)) as NetworkSnapshot;
}
