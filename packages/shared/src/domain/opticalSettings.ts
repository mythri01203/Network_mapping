import type { PonTechnology, SplitterRatio } from '../model/enums';

/**
 * The one source of optical planning numbers. Every value carries a short source note and can be
 * overridden by the operator through the `settings` collection; a datasheet for the installed part
 * overrides all of them. Sources: .claude/skills/fibergis-ftth-mapping/references/optical-values.md.
 */

export type WavelengthNm = 1310 | 1490 | 1550;

export const OPTICS_CLASSES = ['GPON B+', 'GPON C+', 'EPON PX20', 'EPON PX20+', 'XG-PON N1'] as const;
export type OpticsClass = (typeof OPTICS_CLASSES)[number];

export interface OpticsClassBudget {
  /** Lowest allowed path loss. Below it the receiver can overload. Absent when no source gives one. */
  minLossDb?: number;
  maxLossDb: number;
  /** OLT launch range. Absent when no source gives one. */
  launchMinDbm?: number;
  launchMaxDbm?: number;
}

export interface CouplerLoss {
  tapDb: number;
  throughDb: number;
}

export interface OpticalSettings {
  fiberDbPerKm: Record<WavelengthNm, number>;
  fusionSpliceDb: number;
  mechanicalSpliceDb: number;
  connectorPairDb: number;
  splitterDb: Record<SplitterRatio, number>;
  couplers: Record<string, CouplerLoss>;
  classes: Record<OpticsClass, OpticsClassBudget>;
  rx: {
    /** Above this is too much light. */
    overloadDbm: number;
    /** At or above this (up to overload) is good. */
    goodFloorDbm: number;
    /** Below this is bad. Between it and goodFloorDbm works with little repair margin. */
    sensitivityDbm: number;
  };
  /** Repair margin kept apart from the class budget. */
  marginDb: number;
  /** A measured reading this far below expected suggests a dirty connector, bend or wrong path. */
  measuredGapDb: number;
}

export type OpticalSettingGroup =
  | 'Fiber loss'
  | 'Splices and connectors'
  | 'Splitters'
  | 'Couplers'
  | 'Class budgets'
  | 'ONT receive levels'
  | 'Margins';

export interface OpticalSettingDef {
  /** Key of the override record in the `settings` collection. */
  id: string;
  group: OpticalSettingGroup;
  label: string;
  unit: 'dB/km' | 'dB' | 'dBm';
  defaultValue: number;
  source: string;
  apply: (settings: OpticalSettings, value: number) => void;
}

const SETTING_PREFIX = 'optical.';

const def = (
  key: string,
  group: OpticalSettingGroup,
  label: string,
  unit: OpticalSettingDef['unit'],
  defaultValue: number,
  source: string,
  apply: OpticalSettingDef['apply'],
): OpticalSettingDef => ({ id: `${SETTING_PREFIX}${key}`, group, label, unit, defaultValue, source, apply });

const PROPOSED_RX = 'Proposed. No standard defines this band; the OLT thresholds have the final word.';

const splitterDef = (ratio: SplitterRatio, value: number, source: string) =>
  def(`splitter.${ratio}`, 'Splitters', `PLC ${ratio}`, 'dB', value, source, (s, v) => {
    s.splitterDb[ratio] = v;
  });

const couplerDefs = (ratio: string, tap: number, through: number, source: string) => [
  def(`coupler.${ratio}.tap`, 'Couplers', `${ratio} tap port`, 'dB', tap, source, (s, v) => {
    (s.couplers[ratio] ??= { tapDb: 0, throughDb: 0 }).tapDb = v;
  }),
  def(`coupler.${ratio}.through`, 'Couplers', `${ratio} through port`, 'dB', through, source, (s, v) => {
    (s.couplers[ratio] ??= { tapDb: 0, throughDb: 0 }).throughDb = v;
  }),
];

const classDefs = (
  name: OpticsClass,
  budget: OpticsClassBudget,
  source: string,
): OpticalSettingDef[] => {
  const field = (key: keyof OpticsClassBudget, label: string, unit: OpticalSettingDef['unit'], value: number) =>
    def(`class.${name}.${key}`, 'Class budgets', `${name} ${label}`, unit, value, source, (s, v) => {
      (s.classes[name] ??= { maxLossDb: 0 })[key] = v;
    });
  return [
    ...(budget.minLossDb !== undefined ? [field('minLossDb', 'lowest path loss', 'dB', budget.minLossDb)] : []),
    field('maxLossDb', 'highest path loss', 'dB', budget.maxLossDb),
    ...(budget.launchMinDbm !== undefined ? [field('launchMinDbm', 'OLT launch, low', 'dBm', budget.launchMinDbm)] : []),
    ...(budget.launchMaxDbm !== undefined ? [field('launchMaxDbm', 'OLT launch, high', 'dBm', budget.launchMaxDbm)] : []),
  ];
};

/** Every editable optical value, with its default and where that default comes from. */
export const OPTICAL_SETTING_DEFS: readonly OpticalSettingDef[] = [
  def('fiber.1310', 'Fiber loss', 'Fiber at 1310 nm (upstream)', 'dB/km', 0.35, 'Proposed. 0.34 cabled maximum (Bharti spec); 0.4 planning (FOA).', (s, v) => {
    s.fiberDbPerKm[1310] = v;
  }),
  def('fiber.1490', 'Fiber loss', 'Fiber at 1490 nm (downstream)', 'dB/km', 0.25, 'Proposed, no direct source. 0.30 planning (vendor): also try it before signing off.', (s, v) => {
    s.fiberDbPerKm[1490] = v;
  }),
  def('fiber.1550', 'Fiber loss', 'Fiber at 1550 nm (video overlay)', 'dB/km', 0.25, 'Proposed. 0.20 cabled maximum (operator); 0.25 (FOA).', (s, v) => {
    s.fiberDbPerKm[1550] = v;
  }),
  def('splice.fusion', 'Splices and connectors', 'Fusion splice', 'dB', 0.1, 'Handbook and FOA. Reject above 0.2.', (s, v) => {
    s.fusionSpliceDb = v;
  }),
  def('splice.mechanical', 'Splices and connectors', 'Mechanical splice', 'dB', 0.5, 'Handbook.', (s, v) => {
    s.mechanicalSpliceDb = v;
  }),
  def('connector.pair', 'Splices and connectors', 'Connector pair', 'dB', 0.3, 'FOA. Reject above 0.5.', (s, v) => {
    s.connectorPairDb = v;
  }),
  splitterDef('1:2', 3.8, 'Proposed. Ideal 3.0; FOA 4.'),
  splitterDef('1:4', 7.1, 'Proposed. Ideal 6.0; FOA 7.'),
  splitterDef('1:8', 10.4, 'Proposed. Ideal 9.0; FOA 11.'),
  splitterDef('1:16', 13.5, 'Proposed. Ideal 12.0; FOA 15.'),
  splitterDef('1:32', 17.0, 'Proposed. Ideal 15.1; FOA 19.'),
  splitterDef('1:64', 20.5, 'Proposed. Ideal 18.1.'),
  ...couplerDefs('90/10', 11.3, 0.6, 'Search excerpt only. Check the part datasheet.'),
  ...couplerDefs('99/1', 23.5, 0.3, 'Search excerpt only. Check the part datasheet.'),
  ...couplerDefs('80/20', 7.4, 1.2, 'Earlier app value with no recorded source. Check the part datasheet.'),
  ...couplerDefs('70/30', 5.6, 1.8, 'Earlier app value with no recorded source. Check the part datasheet.'),
  ...couplerDefs('60/40', 4.4, 2.6, 'Earlier app value with no recorded source. Check the part datasheet.'),
  ...couplerDefs('50/50', 3.4, 3.4, 'Earlier app value with no recorded source. Check the part datasheet.'),
  ...classDefs('GPON B+', { minLossDb: 13, maxLossDb: 28, launchMinDbm: 1.5, launchMaxDbm: 5 }, 'Standard, G.984.2.'),
  ...classDefs('GPON C+', { minLossDb: 17, maxLossDb: 32, launchMinDbm: 3, launchMaxDbm: 7 }, 'Standard, G.984.2; assumes FEC.'),
  ...classDefs('EPON PX20', { maxLossDb: 24, launchMinDbm: 2, launchMaxDbm: 7 }, 'Vendor table, column order inferred.'),
  ...classDefs('EPON PX20+', { maxLossDb: 28, launchMinDbm: 2.5, launchMaxDbm: 7 }, 'Vendor table, column order inferred.'),
  ...classDefs('XG-PON N1', { minLossDb: 14, maxLossDb: 29 }, 'Search excerpt of G.987.2.'),
  def('rx.overload', 'ONT receive levels', 'Too much light above', 'dBm', -8, 'G.984.2 B+ ONU overload.', (s, v) => {
    s.rx.overloadDbm = v;
  }),
  def('rx.good', 'ONT receive levels', 'Good down to', 'dBm', -24, PROPOSED_RX, (s, v) => {
    s.rx.goodFloorDbm = v;
  }),
  def('rx.sensitivity', 'ONT receive levels', 'Works down to', 'dBm', -27, 'G.984.2 B+ ONU sensitivity.', (s, v) => {
    s.rx.sensitivityDbm = v;
  }),
  def('margin', 'Margins', 'Repair margin', 'dB', 3, 'One vendor recommends 3 to 5 dB. Not a standard.', (s, v) => {
    s.marginDb = v;
  }),
  def('measuredGap', 'Margins', 'Measured below expected', 'dB', 3, 'Proposed. Needs the OLT real launch power.', (s, v) => {
    s.measuredGapDb = v;
  }),
];

const emptySettings = (): OpticalSettings => ({
  fiberDbPerKm: { 1310: 0, 1490: 0, 1550: 0 },
  fusionSpliceDb: 0,
  mechanicalSpliceDb: 0,
  connectorPairDb: 0,
  splitterDb: { '1:2': 0, '1:4': 0, '1:8': 0, '1:16': 0, '1:32': 0, '1:64': 0 },
  couplers: {},
  classes: {} as Record<OpticsClass, OpticsClassBudget>,
  rx: { overloadDbm: 0, goodFloorDbm: 0, sensitivityDbm: 0 },
  marginDb: 0,
  measuredGapDb: 0,
});

/** The operator's overrides as they are stored: one record per changed value. */
export interface OpticalOverride {
  id: string;
  value: unknown;
}

/** Defaults with any valid overrides applied. Unknown keys and non-numbers are ignored. */
export function resolveOpticalSettings(overrides: readonly OpticalOverride[] = []): OpticalSettings {
  const byId = new Map(overrides.map((o) => [o.id, o.value]));
  const settings = emptySettings();
  for (const setting of OPTICAL_SETTING_DEFS) {
    const value = byId.get(setting.id);
    setting.apply(settings, typeof value === 'number' && Number.isFinite(value) ? value : setting.defaultValue);
  }
  return settings;
}

export const DEFAULT_OPTICAL_SETTINGS: OpticalSettings = resolveOpticalSettings();

/** Lowest loss physics allows for a 1:N split, the ideal 10·log10(N). */
export const idealSplitterLossDb = (ratio: SplitterRatio): number => 10 * Math.log10(Number(ratio.split(':')[1]));

/**
 * Checks one proposed override. Only impossible values are refused: a splitter recording less loss
 * than physics allows (0.1 dB tolerance for rounding), negative losses, or receive levels out of order.
 */
export function validateOpticalOverride(id: string, value: number, current: OpticalSettings = DEFAULT_OPTICAL_SETTINGS): string | null {
  const setting = OPTICAL_SETTING_DEFS.find((d) => d.id === id);
  if (!setting) return 'This setting does not exist.';
  if (!Number.isFinite(value)) return 'Enter a number.';
  if (setting.unit !== 'dBm' && value < 0) return 'Loss cannot be negative.';
  const splitter = /^optical\.splitter\.(1:\d+)$/.exec(id);
  if (splitter) {
    const ideal = idealSplitterLossDb(splitter[1] as SplitterRatio);
    if (value < ideal - 0.1) {
      return `A ${splitter[1]} splitter cannot lose less than about ${ideal.toFixed(1)} dB.`;
    }
  }
  const next = { ...current.rx };
  if (id === 'optical.rx.overload') next.overloadDbm = value;
  if (id === 'optical.rx.good') next.goodFloorDbm = value;
  if (id === 'optical.rx.sensitivity') next.sensitivityDbm = value;
  if (id.startsWith('optical.rx.') && !(next.overloadDbm > next.goodFloorDbm && next.goodFloorDbm > next.sensitivityDbm)) {
    return 'Receive levels must run from strongest to weakest: too much light, then good, then works.';
  }
  return null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export const fiberLossDb = (
  lengthMeters: number,
  wavelengthNm: WavelengthNm,
  settings: OpticalSettings = DEFAULT_OPTICAL_SETTINGS,
): number => round2((Math.max(0, lengthMeters) / 1000) * settings.fiberDbPerKm[wavelengthNm]);

export type RxBand = 'too_much_light' | 'good' | 'low_margin' | 'bad' | 'unknown';

/** Which receive band a level falls in. Each boundary belongs to the better band. */
export function rxBandFor(rx: number | undefined | null, settings: OpticalSettings = DEFAULT_OPTICAL_SETTINGS): RxBand {
  if (rx === undefined || rx === null || !Number.isFinite(rx)) return 'unknown';
  if (rx > settings.rx.overloadDbm) return 'too_much_light';
  if (rx < settings.rx.sensitivityDbm) return 'bad';
  if (rx < settings.rx.goodFloorDbm) return 'low_margin';
  return 'good';
}

export const RX_BAND_LABELS: Record<RxBand, string> = {
  too_much_light: 'Too much light',
  good: 'Good',
  low_margin: 'Works, little margin',
  bad: 'Too weak',
  unknown: 'Not recorded',
};

export type LinkVerdict = 'too_little_loss' | 'fits_with_margin' | 'fits_under_margin' | 'over_budget';

export interface LinkCheck {
  verdict: LinkVerdict;
  /** Class ceiling minus loss. Negative means over budget. */
  remainingDb: number;
  /** Remaining after keeping the repair margin. Negative means short of it. */
  afterMarginDb: number;
}

/** Compares one direction's path loss with the class range, both ceiling and floor. */
export function checkLinkBudget(
  lossDb: number,
  opticsClass: OpticsClass,
  settings: OpticalSettings = DEFAULT_OPTICAL_SETTINGS,
): LinkCheck {
  const budget = settings.classes[opticsClass];
  const remainingDb = round2(budget.maxLossDb - lossDb);
  const afterMarginDb = round2(remainingDb - settings.marginDb);
  let verdict: LinkVerdict;
  if (budget.minLossDb !== undefined && lossDb < budget.minLossDb) verdict = 'too_little_loss';
  else if (remainingDb < 0) verdict = 'over_budget';
  else if (afterMarginDb < 0) verdict = 'fits_under_margin';
  else verdict = 'fits_with_margin';
  return { verdict, remainingDb, afterMarginDb };
}

/** The class to check a port against when none is recorded per port. */
export function opticsClassForTechnology(technology: PonTechnology | undefined): OpticsClass {
  if (technology === 'EPON') return 'EPON PX20+';
  if (technology === 'XGS-PON' || technology === '10G-EPON') return 'XG-PON N1';
  return 'GPON B+';
}
