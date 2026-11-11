import type { Setting } from '../model/types';
import { resolveOpticalSettings } from './opticalSettings';
import { type OspSettings, resolveOspSettings } from './ospSettings';

/**
 * Network mapping Phase 15: the limits the map check and the geometry rules use, as operator
 * settings with their source. Every one is a proposal, not a standard, and only warns. The ONT
 * receive levels come from the operator's optical settings, and the "same cable?" limits from the
 * routes settings, so one value is never kept in two places.
 */

export interface ValidationSettings {
  /** Two drawn points of one line closer than this: the second adds nothing. */
  minVertexSpacingMeters: number;
  /** A cable end this far from the item it says it connects to. */
  cableEndGapMeters: number;
  /** Map check: same kind of item this close is probably one item mapped twice. */
  duplicateRadiusMeters: number;
  /** Map check: pins this close cannot be tapped apart. */
  stackedRadiusMeters: number;
  /** Map check: a pole recorded as carrying a cable this far from its drawn line. */
  attachmentGapMeters: number;
  /** Map check: drawn and saved length differing by more than this share. */
  lengthDifferenceRatio: number;
  /** Map check: recorded splitter loss below the ideal by more than this (rounding allowance). */
  splitterLossToleranceDb: number;
}

export interface ValidationSettingDef {
  id: string;
  label: string;
  unit: 'm' | '%' | 'dB';
  defaultValue: number;
  source: string;
  check?: (value: number | string) => string | null;
  apply: (settings: ValidationSettings, value: number) => void;
}

const positive = (value: number | string) => (typeof value === 'number' && value > 0 ? null : 'Enter a number above 0.');
const percent = (value: number | string) => (typeof value === 'number' && value > 0 && value < 100 ? null : 'Enter a percentage between 0 and 100.');
const smallDb = (value: number | string) => (typeof value === 'number' && value >= 0 && value <= 1 ? null : 'Enter a value from 0 to 1 dB.');

export const VALIDATION_SETTING_DEFS: readonly ValidationSettingDef[] = [
  {
    id: 'validation.geometry.minVertexSpacingMeters',
    label: 'Map check: flag two points of one line closer than',
    unit: 'm',
    defaultValue: 1,
    source: 'Proposed for network mapping Phase 15. Phone GPS is good to about 5 m, so two points closer than 1 m add nothing and are usually a double tap. Warns only; nothing is removed.',
    check: positive,
    apply: (s, v) => {
      s.minVertexSpacingMeters = v;
    },
  },
  {
    id: 'validation.geometry.cableEndGapMeters',
    label: 'Map check: flag a cable end farther than this from the item it connects to',
    unit: 'm',
    defaultValue: 50,
    source: 'Proposed in the fibergis-map-check skill (rule cable-end-far). Either the line or the link is wrong. Warns only; nothing is moved or linked.',
    check: positive,
    apply: (s, v) => {
      s.cableEndGapMeters = v;
    },
  },
  {
    id: 'validation.mapCheck.duplicateRadiusMeters',
    label: 'Map check: flag two items of the same kind closer than',
    unit: 'm',
    defaultValue: 2,
    source: 'Proposed in the fibergis-map-check skill (possible-duplicate). Stricter than the 5 m "same one?" question on purpose. Warns only.',
    check: positive,
    apply: (s, v) => {
      s.duplicateRadiusMeters = v;
    },
  },
  {
    id: 'validation.mapCheck.stackedRadiusMeters',
    label: 'Map check: flag pins of different kinds closer than',
    unit: 'm',
    defaultValue: 1,
    source: 'Proposed in the fibergis-map-check skill (stacked pins): pins this close cannot be tapped apart on a phone. Warns only.',
    check: positive,
    apply: (s, v) => {
      s.stackedRadiusMeters = v;
    },
  },
  {
    id: 'validation.mapCheck.attachmentGapMeters',
    label: 'Map check: flag a pole recorded on a cable but farther than this from its line',
    unit: 'm',
    defaultValue: 30,
    source: 'Proposed in the fibergis-map-check skill (attachment-far-from-route). Either the line or the record is wrong. Warns only.',
    check: positive,
    apply: (s, v) => {
      s.attachmentGapMeters = v;
    },
  },
  {
    id: 'validation.mapCheck.lengthDifferencePercent',
    label: 'Map check: flag drawn and saved cable length differing by more than',
    unit: '%',
    defaultValue: 10,
    source: 'Proposed in the fibergis-map-check skill (cable-length-mismatch). Slack and corners make some difference normal. Warns only.',
    check: percent,
    apply: (s, v) => {
      s.lengthDifferenceRatio = v / 100;
    },
  },
  {
    id: 'validation.mapCheck.splitterLossToleranceDb',
    label: 'Map check: allowance below the ideal splitter loss before it counts as impossible',
    unit: 'dB',
    defaultValue: 0.1,
    source: 'Physics: a 1:N split loses at least 10·log10(N) dB. The 0.1 dB allowance is for rounded datasheet values (fibergis-map-check).',
    check: smallDb,
    apply: (s, v) => {
      s.splitterLossToleranceDb = v;
    },
  },
];

const empty = (): ValidationSettings => ({
  minVertexSpacingMeters: 0,
  cableEndGapMeters: 0,
  duplicateRadiusMeters: 0,
  stackedRadiusMeters: 0,
  attachmentGapMeters: 0,
  lengthDifferenceRatio: 0,
  splitterLossToleranceDb: 0,
});

/** Defaults with the operator's valid overrides. Wrong types and impossible values are ignored. */
export function resolveValidationSettings(overrides: readonly Pick<Setting, 'id' | 'value'>[] = []): ValidationSettings {
  const byId = new Map(overrides.map((o) => [o.id, o.value]));
  const settings = empty();
  for (const def of VALIDATION_SETTING_DEFS) {
    const value = byId.get(def.id);
    const usable = typeof value === 'number' && Number.isFinite(value) && !def.check?.(value);
    def.apply(settings, usable ? value : def.defaultValue);
  }
  return settings;
}

export const DEFAULT_VALIDATION_SETTINGS: ValidationSettings = resolveValidationSettings();

/** Everything one check run needs, from the operator's settings records. */
export interface CheckLimits {
  validation: ValidationSettings;
  osp: OspSettings;
  /** The limits the `fibergis-map-check` script reads, under its own names. */
  mapCheck: Record<string, number>;
}

/**
 * The operator's limits for one check run. The map check script's own defaults are used only for a
 * value no setting covers; the ONT receive levels come from the optical settings.
 */
export function checkLimitsFrom(settings: readonly Pick<Setting, 'id' | 'value'>[] = []): CheckLimits {
  const validation = resolveValidationSettings(settings);
  const optical = resolveOpticalSettings(settings);
  const osp = resolveOspSettings(settings);
  return {
    validation,
    osp,
    mapCheck: {
      splitterLossToleranceDb: validation.splitterLossToleranceDb,
      rxOverloadDbm: optical.rx.overloadDbm,
      rxLowDbm: optical.rx.sensitivityDbm,
      lengthDifferenceRatio: validation.lengthDifferenceRatio,
      cableEndGapMeters: validation.cableEndGapMeters,
      duplicateRadiusMeters: validation.duplicateRadiusMeters,
      stackedRadiusMeters: validation.stackedRadiusMeters,
      attachmentGapMeters: validation.attachmentGapMeters,
    },
  };
}
