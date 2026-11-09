import type { Setting } from '../model/types';

/**
 * How old a monitored value may be before it is shown as stale (Phase 7). None of these is a
 * standard: OLTs and NMS platforms poll at intervals the operator chooses. Each is a proposal with
 * its reason, changed in the `settings` collection (Administration, Monitoring settings).
 */

export interface MonitoringSettings {
  /** An ONU status older than this is stale, and "Live" is shown only inside it. */
  statusStaleMinutes: number;
  /** An optical reading older than this is stale. */
  readingStaleMinutes: number;
  /** A device time further than this ahead of the server clock is refused as a wrong clock. */
  maxFutureMinutes: number;
}

export interface MonitoringSettingDef {
  id: string;
  label: string;
  unit: 'min';
  defaultValue: number;
  source: string;
  check?: (value: number | string) => string | null;
  apply: (settings: MonitoringSettings, value: number) => void;
}

const wholeAtLeast = (min: number) => (value: number | string) =>
  typeof value === 'number' && Number.isInteger(value) && value >= min ? null : `Enter a whole number of ${min} or more.`;

export const MONITORING_SETTING_DEFS: readonly MonitoringSettingDef[] = [
  {
    id: 'monitoring.statusStaleMinutes',
    label: 'An online, offline or LOS status is stale after',
    unit: 'min',
    defaultValue: 15,
    source:
      'Proposed. Set it to a little more than twice the interval at which your OLT or NMS sends status, so one missed send does not show as stale. "Live" is shown only for a real source inside this time.',
    check: wholeAtLeast(1),
    apply: (s, v) => {
      s.statusStaleMinutes = v;
    },
  },
  {
    id: 'monitoring.readingStaleMinutes',
    label: 'A light reading (Rx) is stale after',
    unit: 'min',
    defaultValue: 60,
    source: 'Proposed. Optical levels change slowly and are often polled less often than status. Match it to your export or polling interval.',
    check: wholeAtLeast(1),
    apply: (s, v) => {
      s.readingStaleMinutes = v;
    },
  },
  {
    id: 'monitoring.maxFutureMinutes',
    label: 'Refuse a device time this far ahead of the server clock',
    unit: 'min',
    defaultValue: 5,
    source: 'Proposed. A time in the future means the device or script clock is wrong; such a row is skipped with that reason instead of being shown as current.',
    check: wholeAtLeast(0),
    apply: (s, v) => {
      s.maxFutureMinutes = v;
    },
  },
];

export function resolveMonitoringSettings(overrides: readonly Pick<Setting, 'id' | 'value'>[] = []): MonitoringSettings {
  const byId = new Map(overrides.map((o) => [o.id, o.value]));
  const settings: MonitoringSettings = { statusStaleMinutes: 0, readingStaleMinutes: 0, maxFutureMinutes: 0 };
  for (const def of MONITORING_SETTING_DEFS) {
    const value = byId.get(def.id);
    const usable = typeof value === 'number' && Number.isFinite(value) && !def.check?.(value);
    def.apply(settings, usable ? value : def.defaultValue);
  }
  return settings;
}

export const DEFAULT_MONITORING_SETTINGS: MonitoringSettings = resolveMonitoringSettings();
