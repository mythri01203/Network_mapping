import type { ChangeSet } from '../model/api';
import type { MonitoringSource, OnuReading, OnuStatus } from '../model/monitoringSchemas';
import type { Alarm, Ont } from '../model/types';
import { MONITORING_COLLECTIONS } from './command';
import type { FiberProblem } from './fiberRules';

/**
 * Checks for live monitoring (Phase 7), run by the server on every ordinary change (`/changes`) and
 * by the map check on stored data.
 *
 * - Sources, readings and statuses are written only by the monitoring routes (file import, the
 *   push endpoint, the TEST simulator), never by an ordinary edit, in setup mode too.
 * - A device alarm is made only by that path. An ordinary edit may acknowledge or clear one, but
 *   not make one or change where it came from.
 * - A TEST row comes only from the TEST simulator, and the simulator makes only TEST rows.
 */

export interface MonitoringCheckData {
  monitoringSources?: readonly MonitoringSource[];
  onuReadings?: readonly OnuReading[];
  onuStatuses?: readonly OnuStatus[];
  onts?: readonly Ont[];
}

export const MONITORING_WRITE_REFUSED =
  'Live monitoring rows, sources and device alarms come only through Live monitoring (file import, the push endpoint or the TEST simulator). Nothing was saved.';

/** Errors and checks in stored monitoring data. Ids only, never names. */
export function findMonitoringProblems(data: MonitoringCheckData): FiberProblem[] {
  const problems: FiberProblem[] = [];
  const add = (severity: FiberProblem['severity'], code: string, key: string, message: string) => problems.push({ severity, code, key: `${code}:${key}`, message, refs: [key] });
  const sources = new Map((data.monitoringSources ?? []).map((s) => [s.id, s]));
  const onts = new Set((data.onts ?? []).map((o) => o.id));
  for (const row of [...(data.onuReadings ?? []), ...(data.onuStatuses ?? [])]) {
    const src = sources.get(row.sourceId);
    if (!src) add('error', 'monitoring_row_no_source', row.id, `Row ${row.id} names monitoring source ${row.sourceId}, which is not on record.`);
    else if (src.isTest !== row.isTest) {
      add('error', 'monitoring_test_outside_test_path', row.id, `Row ${row.id}: ${row.isTest ? 'a TEST row from a real source' : 'a real row from the TEST simulator'}. TEST rows come only from the TEST simulator.`);
    }
    if (row.ontId && !onts.has(row.ontId)) add('error', 'monitoring_unknown_ont', row.id, `Row ${row.id} is for ONT ${row.ontId}, which is not on record.`);
  }
  return problems;
}

const touchesMonitoring = (changes: ChangeSet): boolean =>
  MONITORING_COLLECTIONS.some((name) => (changes.upserts?.[name]?.length ?? 0) > 0 || (changes.deletes?.[name]?.length ?? 0) > 0);

const DEVICE_FIXED: readonly (keyof Alarm)[] = ['source', 'isTest', 'kind', 'element', 'monitoringSourceId', 'evidenceIds', 'firstSeenAt'];

/**
 * Refusals for an ordinary change (`/changes`, a browser command). The monitoring routes write
 * straight to storage and do not pass through this. `stored` gives an alarm as it is stored now.
 */
export function checkChangeSetMonitoring(changes: ChangeSet, stored: (id: string) => Alarm | undefined): FiberProblem[] {
  const problems: FiberProblem[] = [];
  if (touchesMonitoring(changes)) {
    problems.push({ severity: 'error', code: 'monitoring_write_path', key: 'monitoring_write_path', message: MONITORING_WRITE_REFUSED, refs: [] });
  }
  for (const alarm of changes.upserts?.alarms ?? []) {
    const before = stored(alarm.id);
    const fromMonitoring = (a: Alarm | undefined) => !!a && (a.source === 'device_adapter' || !!a.monitoringSourceId);
    if (!fromMonitoring(alarm) && !fromMonitoring(before)) continue;
    const same = before && DEVICE_FIXED.every((k) => JSON.stringify(before[k]) === JSON.stringify(alarm[k]));
    if (!same) {
      problems.push({ severity: 'error', code: 'monitoring_alarm_path', key: `monitoring_alarm_path:${alarm.id}`, message: `Alarm ${alarm.id}: ${MONITORING_WRITE_REFUSED}`, refs: [alarm.id] });
    }
  }
  return problems;
}

export function changeSetTouchesMonitoring(changes: ChangeSet): boolean {
  return touchesMonitoring(changes) || (changes.upserts?.alarms?.length ?? 0) > 0;
}
