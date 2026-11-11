import {
  type AuditLog,
  type DeviceIngestPlan,
  type DeviceIngestRow,
  formatLogTimestamp,
  type IngestPlan,
  type IngestRow,
  type MonitoringSource,
  type NetworkData,
  planDeviceIngest,
  planIngest,
  raiseDeviceAlarms,
  raiseMonitoringAlarms,
  randomCode,
  resolveMonitoringSettings,
  resolveOpticalSettings,
} from '@fibergis/shared';

import type { NetworkRepository } from '../db/repository';
import { HttpError } from '../lib/errors';
import { deviceStatusKey, readingKey, type RetentionLimits, rowsToPrune, statusKey } from './retention';

const DEFAULT_RETENTION: RetentionLimits = { keepDays: 90, maxRows: 200_000 };

/**
 * The one path that stores monitoring rows (Phase 7): file import, the push endpoint and the TEST
 * simulator all come here. Rows are matched and checked by the shared `planIngest` (the browser
 * preview uses the same function), alarms are raised by `raiseMonitoringAlarms`, and everything is
 * written in one change with one audit entry. Nothing is written for a dry run. Phase 20: OLT, card,
 * PON port and interface rows from a push go through `planDeviceIngest` and `raiseDeviceAlarms` in
 * the same change.
 */

export interface IngestOutcome {
  revision?: number;
  stored: { readings: number; statuses: number };
  matched: number;
  duplicates: number;
  skipped: IngestPlan['skipped'];
  unmatched: IngestPlan['unmatched'];
  alarmsRaised: number;
  isTest: boolean;
  dryRun: boolean;
  /** Phase 20: OLT, card, PON port and interface rows, when any were sent. Row numbers count within `devices`. */
  devices?: { stored: number; matched: number; duplicates: number; skipped: DeviceIngestPlan['skipped']; unmatched: DeviceIngestPlan['unmatched'] };
}

export interface IngestActor {
  /** Shown in the audit trail: the person, or the source for a push. */
  user: string;
  role: AuditLog['role'];
  actorId?: string;
}

/**
 * Ingests run one at a time in this process, so two pushes at once cannot both raise the same
 * alarm from the same stored state. (Rows themselves have content ids, so they never double.)
 */
let queue: Promise<unknown> = Promise.resolve();

export function ingestRows(...args: Parameters<typeof ingestNow>): Promise<IngestOutcome> {
  const run = queue.then(() => ingestNow(...args));
  queue = run.catch(() => undefined);
  return run;
}

async function ingestNow(
  repository: NetworkRepository,
  source: MonitoringSource,
  rows: readonly IngestRow[],
  actor: IngestActor,
  options: { dryRun?: boolean; via: string; sourcePatch?: Partial<MonitoringSource>; now?: Date; retention?: RetentionLimits; devices?: readonly DeviceIngestRow[] } = { via: 'push' },
): Promise<IngestOutcome> {
  const now = options.now ?? new Date();
  const { data } = await repository.getNetwork();
  // The stored source as it is now, so a change made meanwhile (such as Switch off) is kept.
  const current = data.monitoringSources.find((s) => s.id === source.id) ?? source;
  // Switched off while this waited its turn: store nothing.
  if (!options.dryRun && !current.enabled) throw new HttpError(409, 'source_off', `${current.name} is switched off. Nothing was stored.`);
  const settings = resolveMonitoringSettings(data.settings);
  const existingIds = new Set([...data.onuReadings.map((r) => r.id), ...data.onuStatuses.map((s) => s.id)]);
  const plan = planIngest(rows, { source, onts: data.onts, existingIds, now, settings });
  // Phase 20: OLT, card, PON port and interface rows (push only), checked the same way.
  const storedDevices = data.deviceStatuses ?? [];
  const devicePlan = options.devices?.length
    ? planDeviceIngest(options.devices, { source, equipment: data.equipment, existingIds: new Set(storedDevices.map((d) => d.id)), now, settings })
    : undefined;
  const deviceOutcome = devicePlan
    ? { devices: { stored: devicePlan.statuses.length, matched: devicePlan.matched, duplicates: devicePlan.duplicates, skipped: devicePlan.skipped.slice(0, 200), unmatched: devicePlan.unmatched.slice(0, 200) } }
    : {};
  const base = {
    matched: plan.matched,
    duplicates: plan.duplicates,
    skipped: plan.skipped.slice(0, 200),
    unmatched: plan.unmatched.slice(0, 200),
    isTest: source.isTest,
    ...deviceOutcome,
  };
  if (options.dryRun) {
    return { ...base, stored: { readings: plan.readings.length, statuses: plan.statuses.length }, alarmsRaised: 0, dryRun: true };
  }
  const alarms = raiseMonitoringAlarms(
    data as unknown as NetworkData,
    { statuses: plan.statuses, readings: plan.readings },
    source,
    { optical: resolveOpticalSettings(data.settings), settings, now },
    { now, actor: actor.user },
  );
  const deviceAlarms = devicePlan
    ? raiseDeviceAlarms(data as unknown as NetworkData, devicePlan.statuses, source, { settings, now, alarms: alarms.alarms }, { now, actor: actor.user })
    : { alarms: alarms.alarms, raised: [] };
  const raised = [...alarms.raised, ...deviceAlarms.raised];
  const newDevices = devicePlan?.statuses ?? [];
  const made = plan.readings.length + plan.statuses.length + newDevices.length;
  const changedAlarms = deviceAlarms.alarms.filter((a) => raised.some((r) => r.id === a.id));
  const limits = options.retention ?? DEFAULT_RETENTION;
  const oldReadings = rowsToPrune([...data.onuReadings, ...plan.readings], readingKey, limits, now);
  const oldStatuses = rowsToPrune([...data.onuStatuses, ...plan.statuses], statusKey, limits, now);
  const oldDevices = newDevices.length ? rowsToPrune([...storedDevices, ...newDevices], deviceStatusKey, limits, now) : [];
  const removed = oldReadings.length + oldStatuses.length + oldDevices.length;
  const audit: AuditLog = {
    id: `LOG-${randomCode(10)}`,
    timestamp: formatLogTimestamp(now),
    user: actor.user,
    role: actor.role,
    action: source.isTest ? 'TEST_MONITORING_ROWS' : 'MONITORING_ROWS',
    details: `${source.isTest ? 'TEST · not real. ' : ''}${source.name} (${source.id}) via ${options.via}: ${plan.readings.length} reading(s), ${plan.statuses.length} status(es), ${plan.matched} matched, ${plan.unmatched.length} not matched, ${plan.skipped.length} skipped, ${plan.duplicates} already stored, ${raised.length} alarm(s).${devicePlan ? ` Devices: ${newDevices.length} OLT/card/PON port row(s), ${devicePlan.matched} matched, ${devicePlan.unmatched.length} not matched, ${devicePlan.skipped.length} skipped, ${devicePlan.duplicates} already stored.` : ''}${removed ? ` ${removed} old row(s) removed (kept ${limits.keepDays} days; newest per ONT always kept).` : ''}`.slice(0, 1000),
    assetId: source.id,
    assetType: 'System',
  };
  const nextSource: MonitoringSource = { ...current, ...options.sourcePatch, ...(made > 0 ? { lastReceivedAt: now.toISOString() } : {}) };
  const result = await repository.applyChanges(
    {
      upserts: {
        onuReadings: plan.readings,
        onuStatuses: plan.statuses,
        ...(newDevices.length ? { deviceStatuses: newDevices } : {}),
        alarms: changedAlarms,
        monitoringSources: [nextSource],
        auditLogs: [audit],
      },
      ...(removed ? { deletes: { onuReadings: oldReadings, onuStatuses: oldStatuses, ...(oldDevices.length ? { deviceStatuses: oldDevices } : {}) } } : {}),
    },
    undefined,
    {
      ...(actor.actorId ? { actorId: actor.actorId } : {}),
      // Phase 23: the server's audit events name the person (file import) or the source (push).
      actor: { id: actor.actorId ?? null, name: actor.user, role: null },
      source: 'monitoring',
    },
  );
  return {
    ...base,
    revision: result.revision,
    stored: { readings: plan.readings.length, statuses: plan.statuses.length },
    alarmsRaised: raised.length,
    dryRun: false,
  };
}
