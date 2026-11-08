import type { Setting } from '../model/types';

/**
 * Editable limits for grouping alarms into a suspected shared cause (Phase 8). None of them is a
 * standard: each is a proposal with its reason, and the operator changes it in the `settings`
 * collection (Administration, Fault checks) without a code change. Correlation only ever says
 * "suspected"; these numbers decide how sure the screen sounds, never what is true.
 */

export interface FaultSettings {
  /** Alarms that start within this many minutes of each other are compared as one event. */
  correlationWindowMinutes: number;
  /** At least this many customers behind one element must be reported down to suspect it. */
  minAlarmsForGroup: number;
  /** Share of recorded customers behind an element reported down for "high" confidence. */
  highShare: number;
  /** Share for "medium" confidence. Below it the suspicion is "low". */
  mediumShare: number;
  /** PON ports on one OLT reporting a fault before the OLT itself is suspected. */
  ponPortsForOlt: number;
}

export interface FaultSettingDef {
  id: string;
  label: string;
  unit: 'min' | '%' | 'count';
  defaultValue: number;
  source: string;
  check?: (value: number | string) => string | null;
  apply: (settings: FaultSettings, value: number) => void;
}

const wholeAtLeast = (min: number) => (value: number | string) =>
  typeof value === 'number' && Number.isInteger(value) && value >= min ? null : `Enter a whole number of ${min} or more.`;
const percent = (value: number | string) =>
  typeof value === 'number' && value > 0 && value <= 100 ? null : 'Enter a percentage above 0 and up to 100.';

/** Every editable fault-correlation value, with its default and where that default comes from. */
export const FAULT_SETTING_DEFS: readonly FaultSettingDef[] = [
  {
    id: 'fault.correlation.windowMinutes',
    label: 'Compare alarms that start within',
    unit: 'min',
    defaultValue: 15,
    source:
      'Proposed. A fiber cut or a splitter failure takes every customer behind it down at once, while separate house faults arrive spread out. No standard sets this; vendors and operators choose their own window. Shorten it if unrelated faults get grouped.',
    check: wholeAtLeast(1),
    apply: (s, v) => {
      s.correlationWindowMinutes = v;
    },
  },
  {
    id: 'fault.correlation.minAlarms',
    label: 'Suspect a shared element when at least this many customers behind it are down',
    unit: 'count',
    defaultValue: 2,
    source: 'Proposed. One customer down points at their own drop or ONT; two or more on one element is the first sign of a shared fault.',
    check: wholeAtLeast(2),
    apply: (s, v) => {
      s.minAlarmsForGroup = v;
    },
  },
  {
    id: 'fault.correlation.highSharePercent',
    label: '"High" confidence when this share of recorded customers behind it is down',
    unit: '%',
    defaultValue: 80,
    source:
      'Proposed. With no live OLT connection a customer with no alarm is not proven up, so even 100% is a suspicion, not proof. Raise it if crews are sent to the wrong element.',
    check: percent,
    apply: (s, v) => {
      s.highShare = v / 100;
    },
  },
  {
    id: 'fault.correlation.mediumSharePercent',
    label: '"Medium" confidence from this share; below it "low"',
    unit: '%',
    defaultValue: 50,
    source: 'Proposed. Half or more of one splitter or cable down is worth checking before the houses one by one.',
    check: percent,
    apply: (s, v) => {
      s.mediumShare = v / 100;
    },
  },
  {
    id: 'fault.correlation.ponPortsForOlt',
    label: 'Suspect the OLT itself when this many of its PON ports report a fault',
    unit: 'count',
    defaultValue: 2,
    source: 'Proposed. Several ports failing together points at the OLT card, power or uplink rather than the street.',
    check: wholeAtLeast(2),
    apply: (s, v) => {
      s.ponPortsForOlt = v;
    },
  },
];

const empty = (): FaultSettings => ({ correlationWindowMinutes: 0, minAlarmsForGroup: 0, highShare: 0, mediumShare: 0, ponPortsForOlt: 0 });

/** Defaults with the operator's valid overrides applied. Wrong types and impossible values are ignored. */
export function resolveFaultSettings(overrides: readonly Pick<Setting, 'id' | 'value'>[] = []): FaultSettings {
  const byId = new Map(overrides.map((o) => [o.id, o.value]));
  const settings = empty();
  for (const def of FAULT_SETTING_DEFS) {
    const value = byId.get(def.id);
    const usable = typeof value === 'number' && Number.isFinite(value) && !def.check?.(value);
    def.apply(settings, usable ? value : def.defaultValue);
  }
  // Medium can never be above high.
  if (settings.mediumShare > settings.highShare) settings.mediumShare = settings.highShare;
  return settings;
}

export const DEFAULT_FAULT_SETTINGS: FaultSettings = resolveFaultSettings();
