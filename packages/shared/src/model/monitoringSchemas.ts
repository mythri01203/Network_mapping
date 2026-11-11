import { z } from 'zod';

/*
 * Live monitoring (Phase 7). Three collections, written only by the monitoring routes on the server
 * (file import, the push endpoint and the TEST simulator), never by an edit in the browser:
 *
 *   monitoringSources  where readings come from: a file export, a push script, or the TEST simulator
 *   onuReadings        one optical reading as the device reported it, with its own time
 *   onuStatuses        one ONU status (online, offline, LOS, dying gasp, unknown) kept as history
 *   deviceStatuses     (Phase 20) one OLT, card, PON port or uplink status, push only, kept as history
 *
 * A row is matched to an ONT only by the OLT's ONU address or the serial, exactly as written. A row
 * that matches nothing is kept with `ontId` unset and listed as "not matched"; nothing is guessed.
 * Ingest tokens are not here: the server keeps only their hash, in a table of its own.
 */

export const MONITORING_SOURCE_KINDS = ['file_import', 'push', 'test_simulator'] as const;
export const monitoringSourceKindSchema = z.enum(MONITORING_SOURCE_KINDS);
export type MonitoringSourceKind = z.infer<typeof monitoringSourceKindSchema>;
export const MONITORING_SOURCE_KIND_LABELS: Record<MonitoringSourceKind, string> = {
  file_import: 'File import (CSV or TSV export)',
  push: 'Push from a script or NMS',
  test_simulator: 'TEST simulator (not real)',
};

/** Which end of the link the light was read at. */
export const READING_DIRECTIONS = ['ont_rx', 'olt_upstream_rx'] as const;
export const readingDirectionSchema = z.enum(READING_DIRECTIONS);
export type ReadingDirection = z.infer<typeof readingDirectionSchema>;
export const READING_DIRECTION_LABELS: Record<ReadingDirection, string> = {
  ont_rx: 'ONT receive (downstream)',
  olt_upstream_rx: 'OLT receive from this ONU (upstream)',
};

export const ONU_STATES = ['online', 'offline', 'los', 'dying_gasp', 'unknown'] as const;
export const onuStateSchema = z.enum(ONU_STATES);
export type OnuState = z.infer<typeof onuStateSchema>;
export const ONU_STATE_LABELS: Record<OnuState, string> = {
  online: 'Online',
  offline: 'Offline',
  los: 'LOS (no light)',
  dying_gasp: 'Power lost (dying gasp)',
  unknown: 'Unknown',
};

/** How a row was tied to an ONT. `none`: it matched nothing and is listed, not guessed. */
export const MATCH_KINDS = ['onu_address', 'serial', 'none'] as const;
export const matchKindSchema = z.enum(MATCH_KINDS);
export type MatchKind = z.infer<typeof matchKindSchema>;

/** Column mapping for a file export, saved on the source so the next file maps the same way. */
export const columnMappingSchema = z.object({
  onuAddress: z.string().max(80).optional(),
  serial: z.string().max(80).optional(),
  deviceTime: z.string().max(80).optional(),
  ontRx: z.string().max(80).optional(),
  oltRx: z.string().max(80).optional(),
  unit: z.string().max(80).optional(),
  status: z.string().max(80).optional(),
  /** Unit when the file has no unit column. Only dBm is accepted. */
  defaultUnit: z.literal('dBm').optional(),
  /** The vendor's status words, as written, mapped to one of ours. Unmapped words are skipped. */
  statusWords: z.record(z.string().max(40), onuStateSchema).optional(),
});
export type ColumnMapping = z.infer<typeof columnMappingSchema>;

export const monitoringSourceSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  kind: monitoringSourceKindSchema,
  /** True only for the TEST simulator. Its rows and alarms are TEST everywhere. */
  isTest: z.boolean(),
  enabled: z.boolean(),
  /** What it is, as the administrator wrote it (such as "NMS export, OLT-1"). */
  description: z.string().trim().max(300).optional(),
  columnMapping: columnMappingSchema.optional(),
  /** When a push token was made; the token itself is shown once and kept only as a hash. */
  tokenCreatedAt: z.string().optional(),
  lastReceivedAt: z.string().optional(),
  createdAt: z.string(),
  createdBy: z.string().optional(),
});

const rowBase = {
  id: z.string().min(1),
  /** Set only when the address or serial matched one ONT exactly. */
  ontId: z.string().min(1).optional(),
  matchedBy: matchKindSchema,
  /** As the device wrote them. Never converted between vendor formats. */
  onuAddress: z.string().max(80).optional(),
  serial: z.string().max(64).optional(),
  origin: z.literal('device_reported'),
  sourceId: z.string().min(1),
  isTest: z.boolean(),
  /** The time the device says the value was true, with its offset. */
  deviceTime: z.string(),
  /** When this server stored it. */
  receivedAt: z.string(),
  /** Why it did not match, in plain words. */
  unmatchedReason: z.string().max(200).optional(),
};

export const onuReadingSchema = z.object({
  ...rowBase,
  direction: readingDirectionSchema,
  valueDbm: z.number().min(-60).max(15),
  unit: z.literal('dBm'),
  /** The value as it appeared in the file or message. */
  rawValue: z.string().max(40).optional(),
});

export const onuStatusSchema = z.object({
  ...rowBase,
  state: onuStateSchema,
  /** The vendor's word, as written. */
  rawState: z.string().max(40).optional(),
});

export type MonitoringSource = z.infer<typeof monitoringSourceSchema>;
export type OnuReading = z.infer<typeof onuReadingSchema>;
export type OnuStatus = z.infer<typeof onuStatusSchema>;

/*
 * Network mapping Phase 20: status of the OLT itself, one of its cards, one PON port or an uplink,
 * as a push source sent it (`deviceStatuses`). Kept as history like ONU statuses, written only by
 * the push route. A row is tied to an OLT only by its record id, its serial or its management IP,
 * exactly as written on one OLT record; a port only by its address exactly as the OLT writes it (or
 * the port's record id); a card only by its slot label in the recorded chassis. Anything else is
 * kept as "not matched" with the reason. Nothing is guessed, and no status is made up from ONUs.
 */

export const DEVICE_TARGETS = ['olt', 'card', 'pon_port', 'interface'] as const;
export const deviceTargetSchema = z.enum(DEVICE_TARGETS);
export type DeviceTarget = z.infer<typeof deviceTargetSchema>;
export const DEVICE_TARGET_LABELS: Record<DeviceTarget, string> = {
  olt: 'OLT',
  card: 'Card in a slot',
  pon_port: 'PON port',
  interface: 'Uplink or other interface',
};

/** What the device said about the item. Never worked out by FiberGIS. */
export const DEVICE_STATES = ['up', 'down', 'degraded', 'unknown'] as const;
export const deviceStateSchema = z.enum(DEVICE_STATES);
export type DeviceState = z.infer<typeof deviceStateSchema>;
export const DEVICE_STATE_LABELS: Record<DeviceState, string> = {
  up: 'Up',
  down: 'Down',
  degraded: 'Degraded',
  unknown: 'Unknown',
};

/** How a row was tied to an OLT record. `none`: it matched nothing and is listed, not guessed. */
export const DEVICE_MATCH_KINDS = ['olt_id', 'olt_serial', 'olt_ip', 'none'] as const;
export const deviceMatchKindSchema = z.enum(DEVICE_MATCH_KINDS);
export type DeviceMatchKind = z.infer<typeof deviceMatchKindSchema>;

const deviceCount = z.number().int().min(0).max(100_000);

/** One OLT, card, PON port or interface row as a push script sends it. */
export const deviceIngestRowSchema = z.strictObject({
  target: deviceTargetSchema,
  /** The OLT: its FiberGIS record id, or its serial or management IP exactly as written on the OLT record. */
  oltId: z.string().trim().max(80).optional(),
  oltSerial: z.string().trim().max(64).optional(),
  oltIp: z.string().trim().max(64).optional(),
  /** PON port: its address exactly as the OLT writes it (such as "gpon 0/5/0"), or its FiberGIS port id. */
  portAddress: z.string().trim().max(80).optional(),
  /** Card: the shelf and slot labels exactly as written in the recorded chassis. */
  shelf: z.string().trim().max(20).optional(),
  slot: z.string().trim().max(20).optional(),
  /** Uplink or other interface: its name as the OLT writes it. Kept as written; no record is needed. */
  interfaceName: z.string().trim().max(80).optional(),
  /** ISO 8601 with a time zone. */
  deviceTime: z.string().trim().max(40),
  state: deviceStateSchema,
  /** The vendor's own status word, kept as written. */
  rawState: z.string().trim().max(40).optional(),
  /** Counts the device itself reported for this item at this time. Absent: not sent. */
  onuOnline: deviceCount.optional(),
  onuTotal: deviceCount.optional(),
  losCount: deviceCount.optional(),
  alarmCount: deviceCount.optional(),
});
export type DeviceIngestRow = z.infer<typeof deviceIngestRowSchema>;

export const deviceStatusSchema = z.object({
  id: z.string().min(1),
  target: deviceTargetSchema,
  /** Set only when the OLT identifier matched one OLT record exactly. */
  oltId: z.string().min(1).optional(),
  /** Set only when the port address matched one PON port of that OLT exactly. */
  ponPortId: z.string().min(1).optional(),
  /** Set only when the slot matched one slot of that OLT's recorded chassis exactly. */
  slotId: z.string().min(1).optional(),
  matchedBy: deviceMatchKindSchema,
  /** As the script wrote them. Never converted between vendor formats. */
  oltKey: z.string().max(80),
  portAddress: z.string().max(80).optional(),
  shelf: z.string().max(20).optional(),
  slot: z.string().max(20).optional(),
  interfaceName: z.string().max(80).optional(),
  origin: z.literal('device_reported'),
  sourceId: z.string().min(1),
  isTest: z.boolean(),
  deviceTime: z.string(),
  receivedAt: z.string(),
  state: deviceStateSchema,
  rawState: z.string().max(40).optional(),
  onuOnline: deviceCount.optional(),
  onuTotal: deviceCount.optional(),
  losCount: deviceCount.optional(),
  alarmCount: deviceCount.optional(),
  /** Why it (or its port or slot) did not match, in plain words. */
  unmatchedReason: z.string().max(200).optional(),
});
export type DeviceStatus = z.infer<typeof deviceStatusSchema>;
