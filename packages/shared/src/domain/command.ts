import type { ColorScheme } from '../fiber/colors';
import type { NetworkSnapshot } from '../model/collections';
import type { AuditLog, LatLng } from '../model/types';
import type { OpticalSettings } from './opticalSettings';
import type { RfSettings } from './rfSettings';

/**
 * Outside-plant collections added in Phase 3 (inspections in Phase 4, cable stretches in network
 * mapping Phase 6). Optional so callers built before them keep working.
 */
export const OSP_COLLECTIONS = ['spans', 'attachments', 'ducts', 'slackLoops', 'permissions', 'inspections', 'cableSegments'] as const;
export type OspCollection = (typeof OSP_COLLECTIONS)[number];

/** Customer and connection collections added in Phase 5. Optional for the same reason. */
export const CONNECTION_COLLECTIONS = ['onts', 'services', 'buildings'] as const;
export type ConnectionCollection = (typeof CONNECTION_COLLECTIONS)[number];

/** Alarms added in Phase 8. Optional for the same reason. */
export const FAULT_COLLECTIONS = ['alarms'] as const;
export type FaultCollection = (typeof FAULT_COLLECTIONS)[number];

/** Cable TV plant added in Phase 6. Optional for the same reason. */
export const RF_COLLECTIONS = ['rfElements', 'rfLinks', 'rfLevels'] as const;
export type RfCollection = (typeof RF_COLLECTIONS)[number];

/** Live monitoring added in Phase 7, written only by the monitoring routes. Optional for the same reason. */
export const MONITORING_COLLECTIONS = ['monitoringSources', 'onuReadings', 'onuStatuses', 'deviceStatuses'] as const;
export type MonitoringCollection = (typeof MONITORING_COLLECTIONS)[number];

/** Sites and racks added in Phase 9 (ODF and patch management). Optional for the same reason. */
export const PLANT_COLLECTIONS = ['sites', 'racks'] as const;
export type PlantCollection = (typeof PLANT_COLLECTIONS)[number];

/** Checks of physical links added in network mapping Phase 13. Optional for the same reason. */
export const CHECK_COLLECTIONS = ['linkVerifications'] as const;
export type CheckCollection = (typeof CHECK_COLLECTIONS)[number];

/** Expansion scenarios added in network mapping Phase 18: plans only, never the built network. Optional for the same reason. */
export const PLANNING_COLLECTIONS = ['planningScenarios'] as const;
export type PlanningCollection = (typeof PLANNING_COLLECTIONS)[number];

/** The mutable network collections that domain commands read and patch. */
export type NetworkData = Pick<
  NetworkSnapshot,
  'equipment' | 'cables' | 'splitters' | 'closures' | 'customers' | 'faults' | 'workOrders' | 'zones' | 'documents'
> &
  Partial<Pick<NetworkSnapshot, OspCollection | ConnectionCollection | FaultCollection | RfCollection | MonitoringCollection | PlantCollection | CheckCollection>> &
  Partial<Pick<NetworkSnapshot, PlanningCollection>> &
  Partial<Pick<NetworkSnapshot, ValidationCollection>> &
  Partial<Pick<NetworkSnapshot, BudgetCollection>> &
  Partial<Pick<NetworkSnapshot, ImportCollection>>;

/** Import history added in network mapping Phase 21 (undo by import). Optional for the same reason. */
export const IMPORT_COLLECTIONS = ['imports'] as const;
export type ImportCollection = (typeof IMPORT_COLLECTIONS)[number];

/** Stored optical budget runs added in network mapping Phase 17: history only, never a network record. Optional for the same reason. */
export const BUDGET_COLLECTIONS = ['opticalBudgetRuns'] as const;
export type BudgetCollection = (typeof BUDGET_COLLECTIONS)[number];

/** Stored map-check findings added in network mapping Phase 15. Optional for the same reason. */
export const VALIDATION_COLLECTIONS = ['validationFindings'] as const;
export type ValidationCollection = (typeof VALIDATION_COLLECTIONS)[number];

/** Replacement arrays for the collections a command changed. Untouched collections are omitted. */
export type NetworkPatch = Partial<NetworkData>;

export type NoticeTone = 'success' | 'info' | 'warning' | 'error';

/** A user-facing message describing the outcome of a command. */
export interface Notice {
  tone: NoticeTone;
  title: string;
  message: string;
}

export interface AuditEntry {
  action: string;
  details: string;
  assetId: string;
  assetType: AuditLog['assetType'];
}

export interface CommandSuccess<T> {
  ok: true;
  value: T;
  patch: NetworkPatch;
  notice?: Notice;
  audit: AuditEntry[];
  /** When set, the caller must ask the user to confirm this message before applying the patch. */
  confirm?: string;
}

export interface CommandFailure {
  ok: false;
  error: Notice;
}

/**
 * Domain commands are pure: they validate against the current network, then describe the change
 * (patch + notice + audit trail) instead of performing it. The caller decides how to apply it.
 */
export type CommandResult<T> = CommandSuccess<T> | CommandFailure;

/** Ambient inputs that would otherwise make commands impure. */
export interface CommandContext {
  now?: Date;
  /** Display name of the acting user, e.g. "Planner User". */
  actor?: string;
  /** Location used when nothing in the network can anchor a new record. */
  fallbackLocation?: LatLng;
  /** Optical defaults merged with the operator's overrides. Commands use the plain defaults without it. */
  optical?: OpticalSettings;
  /** Colour schemes, built in plus the operator's. Commands use the built-in ones without it. */
  schemes?: readonly ColorScheme[];
  /** Cable TV settings (Phase 6) merged with the operator's. Commands use the defaults without it. */
  rf?: RfSettings;
}

export const fail = (title: string, message: string, tone: NoticeTone = 'error'): CommandFailure => ({
  ok: false,
  error: { tone, title, message },
});

export const succeed = <T>(
  value: T,
  patch: NetworkPatch,
  extras: { notice?: Notice; audit?: AuditEntry[]; confirm?: string } = {},
): CommandSuccess<T> => ({
  ok: true,
  value,
  patch,
  notice: extras.notice,
  audit: extras.audit ?? [],
  confirm: extras.confirm,
});

export const notice = (tone: NoticeTone, title: string, message: string): Notice => ({ tone, title, message });

/** Returns a new network with the patch applied. */
export const applyPatch = <D extends NetworkData>(data: D, patch: NetworkPatch): D => ({ ...data, ...patch });

/** Reference point for new records: the first OLT, else any equipment, else the fallback. */
export function networkAnchor(data: Pick<NetworkData, 'equipment'>, fallback?: LatLng): LatLng | undefined {
  const hub = data.equipment.find((e) => e.type === 'OLT') ?? data.equipment[0];
  if (hub) return [hub.lat, hub.lng];
  return fallback;
}

export const sameId = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Formats a short preview of IDs, e.g. "A, B, C, …". */
export const previewIds = (ids: string[], limit = 5) =>
  `${ids.slice(0, limit).join(', ')}${ids.length > limit ? ', …' : ''}`;
