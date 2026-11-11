/**
 * Optical link budget. Adds up path loss for one direction and compares it with the class range.
 * All numbers come from `opticalSettings`. Nothing here assumes a launch power or a part count: the
 * caller states what it knows, and an expected Rx is a range unless the real launch is known.
 */
import type { SplitterRatio } from '../model/enums';
import {
  checkLinkBudget,
  DEFAULT_OPTICAL_SETTINGS,
  fiberLossDb as fiberLoss,
  type LinkVerdict,
  type OpticalSettings,
  type OpticsClass,
  type WavelengthNm,
} from './opticalSettings';

export type LossVerdict =
  | 'Normal'
  | 'Margin Warning'
  | 'Over Budget'
  | 'Too Little Loss'
  | 'High Attenuation / Macro-bend Alert'
  | 'Incomplete'
  | 'Not Assessed'
  /** Network mapping Phase 17: the optics class is not recorded, so no pass or fail is given. */
  | 'Estimated With Default Class';

/** Network mapping Phase 17: why no pass or fail is given although the parts were added up. */
export type VerdictWithheld = 'unknown_splitter' | 'default_class';

export interface SplitterLossSpec {
  ratio: string;
  lossDb?: number;
  isTap?: boolean;
}

export interface OpticalLossBudgetInput {
  totalDistanceMeters: number;
  wavelengthNm?: WavelengthNm;
  splitters?: (string | SplitterLossSpec | number)[];
  /** Mated connector pairs on the path. Counted as zero unless stated. */
  connectorsCount?: number;
  /** Splices on the path, each at the default splice loss. Counted as zero unless stated. */
  splicesCount?: number;
  /** Recorded splice loss in total. Used instead of `splicesCount` when given. */
  recordedSpliceLossDb?: number;
  opticsClass?: OpticsClass;
  /**
   * Network mapping Phase 17: `false` when the class is not recorded on the port (assumed from the
   * technology, or not given at all). Then no pass or fail is given: "Estimated with default class".
   * Left out, the class is taken as chosen, as before.
   */
  opticsClassRecorded?: boolean;
  /** The port's real launch power, only when it is on record. */
  oltTxPowerDbm?: number;
  /** A real meter or device reading. Estimates must not be passed here. */
  measuredRxDbm?: number;
}

export interface OpticalLossBudgetResult {
  totalDistanceMeters: number;
  totalDistanceKm: number;
  wavelengthNm: WavelengthNm;
  attenuationRateDbPerKm: number;
  fiberLossDb: number;
  splitterLossDb: number;
  spliceLossDb: number;
  connectorLossDb: number;
  totalLossDb: number;
  /** Splitter ratios with no known loss. They are not in the total, so the total is too low. */
  unknownSplitters: string[];
  opticsClass: OpticsClass;
  /** Network mapping Phase 17: false when the class was assumed, not recorded. */
  opticsClassRecorded: boolean;
  classMinLossDb?: number;
  classMaxLossDb: number;
  /** The comparison with the class range. Not a verdict to show when `verdictWithheld` is set. */
  linkVerdict: LinkVerdict;
  /** Network mapping Phase 17: set when no pass or fail may be shown, and why. */
  verdictWithheld?: VerdictWithheld;
  remainingDb: number;
  afterMarginDb: number;
  oltTxPowerDbm?: number;
  /** Only when the real launch power is known. */
  expectedRxDbm?: number;
  /** From the class launch range, when the source gives one. */
  expectedRxRangeDbm?: { min: number; max: number };
  measuredRxDbm?: number;
  discrepancyDb?: number;
  verdict: LossVerdict;
  verdictTitle: string;
  verdictDescription: string;
  recommendedAction: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Insertion loss for a splitter or coupler, or `undefined` when nothing on record gives it. */
export function resolveSplitterLoss(
  item: string | SplitterLossSpec | number,
  settings: OpticalSettings = DEFAULT_OPTICAL_SETTINGS,
): number | undefined {
  if (typeof item === 'number') return item;
  if (typeof item === 'string') return resolveSplitterLoss({ ratio: item, isTap: true }, settings);
  if (item.lossDb !== undefined && item.lossDb > 0) return item.lossDb;
  const coupler = settings.couplers[item.ratio];
  if (coupler) return item.isTap === false ? coupler.throughDb : coupler.tapDb;
  return settings.splitterDb[item.ratio as SplitterRatio];
}

const splitterName = (item: string | SplitterLossSpec | number) =>
  typeof item === 'number' ? `${item} dB` : typeof item === 'string' ? item : item.ratio;

/** Adds up one direction's loss and gives one of four verdicts against the class range. */
export function calculateOpticalLossBudget(
  input: OpticalLossBudgetInput,
  settings: OpticalSettings = DEFAULT_OPTICAL_SETTINGS,
): OpticalLossBudgetResult {
  const wavelengthNm: WavelengthNm = input.wavelengthNm ?? 1490;
  const totalDistanceMeters = Math.max(0, input.totalDistanceMeters || 0);
  const opticsClass = input.opticsClass ?? 'GPON B+';
  const budget = settings.classes[opticsClass];

  const fiberLossDb = fiberLoss(totalDistanceMeters, wavelengthNm, settings);

  const unknownSplitters: string[] = [];
  let splitterSum = 0;
  for (const item of input.splitters ?? []) {
    const loss = resolveSplitterLoss(item, settings);
    if (loss === undefined) unknownSplitters.push(splitterName(item));
    else splitterSum += loss;
  }
  const splitterLossDb = round2(splitterSum);

  const spliceLossDb = round2(
    input.recordedSpliceLossDb ?? Math.max(0, input.splicesCount ?? 0) * settings.fusionSpliceDb,
  );
  const connectorLossDb = round2(Math.max(0, input.connectorsCount ?? 0) * settings.connectorPairDb);
  const totalLossDb = round2(fiberLossDb + splitterLossDb + spliceLossDb + connectorLossDb);

  const check = checkLinkBudget(totalLossDb, opticsClass, settings);
  const oltTxPowerDbm = input.oltTxPowerDbm;
  const expectedRxDbm = oltTxPowerDbm !== undefined ? round1(oltTxPowerDbm - totalLossDb) : undefined;
  const expectedRxRangeDbm =
    budget.launchMinDbm !== undefined && budget.launchMaxDbm !== undefined
      ? { min: round2(budget.launchMinDbm - totalLossDb), max: round2(budget.launchMaxDbm - totalLossDb) }
      : undefined;

  const measuredRxDbm = input.measuredRxDbm !== undefined ? round1(input.measuredRxDbm) : undefined;
  const discrepancyDb =
    measuredRxDbm !== undefined && expectedRxDbm !== undefined ? round1(measuredRxDbm - expectedRxDbm) : undefined;

  let verdict: LossVerdict;
  let verdictTitle: string;
  let verdictDescription: string;
  let recommendedAction: string;
  const lossText = `Estimated loss ${totalLossDb.toFixed(2)} dB at ${wavelengthNm} nm against ${opticsClass}`;
  // Network mapping Phase 17: a class the caller says is not on record, and a splitter whose loss
  // nothing gives, both stop the pass or fail. The total is still shown, labelled estimated.
  const opticsClassRecorded = input.opticsClassRecorded ?? true;
  let verdictWithheld: VerdictWithheld | undefined;

  if (unknownSplitters.length > 0) {
    verdictWithheld = 'unknown_splitter';
    verdict = 'Incomplete';
    verdictTitle = 'Splitter loss not known';
    verdictDescription = `No loss is recorded for ${unknownSplitters.join(', ')} and no setting gives one, so it is not in the ${totalLossDb.toFixed(2)} dB total. The real loss is higher. No pass or fail is given.`;
    recommendedAction = 'Record the splitter ratio and its loss from the datasheet.';
  } else if (discrepancyDb !== undefined && discrepancyDb < -settings.measuredGapDb) {
    verdict = 'High Attenuation / Macro-bend Alert';
    verdictTitle = 'Reading is much weaker than expected';
    verdictDescription = `The measured reading is ${Math.abs(discrepancyDb).toFixed(1)} dB below what this path should give.`;
    recommendedAction = 'Check for a dirty connector, a tight bend, or the wrong path.';
  } else if (!opticsClassRecorded) {
    verdictWithheld = 'default_class';
    verdict = 'Estimated With Default Class';
    verdictTitle = 'Estimated with default class';
    verdictDescription = `${lossText} (${budget.minLossDb !== undefined ? `${budget.minLossDb} to ` : 'up to '}${budget.maxLossDb} dB). The port's optics class is not recorded, so ${opticsClass} is only assumed and no pass or fail is given.`;
    recommendedAction = 'Record the optics class on the PON port, then trace again.';
  } else if (check.verdict === 'too_little_loss') {
    verdict = 'Too Little Loss';
    verdictTitle = 'Too much light expected';
    verdictDescription = `${lossText} (lowest ${budget.minLossDb} dB).`;
    recommendedAction = 'Check for a missing splitter or wrong path. If the path is right, an attenuator may be needed.';
  } else if (check.verdict === 'over_budget') {
    verdict = 'Over Budget';
    verdictTitle = 'Over the optical budget';
    verdictDescription = `${lossText}: over by ${Math.abs(check.remainingDb).toFixed(2)} dB.`;
    recommendedAction = 'Shorten the route or use a smaller split before installing.';
  } else if (check.verdict === 'fits_under_margin') {
    verdict = 'Margin Warning';
    verdictTitle = 'Fits, but under the repair margin';
    verdictDescription = `${lossText}: ${check.remainingDb.toFixed(2)} dB left, short of the ${settings.marginDb} dB margin by ${Math.abs(check.afterMarginDb).toFixed(2)} dB.`;
    recommendedAction = 'It should work, but one later repair could push it over. Plan with care.';
  } else {
    verdict = 'Normal';
    verdictTitle = 'Estimated loss fits the budget';
    verdictDescription = `${lossText}: ${check.remainingDb.toFixed(2)} dB left, ${check.afterMarginDb.toFixed(2)} dB after the ${settings.marginDb} dB margin.`;
    recommendedAction = 'No action needed. This is a calculation; a meter reading is the real check.';
  }

  return {
    totalDistanceMeters,
    totalDistanceKm: round2(totalDistanceMeters / 1000),
    wavelengthNm,
    attenuationRateDbPerKm: settings.fiberDbPerKm[wavelengthNm],
    fiberLossDb,
    splitterLossDb,
    spliceLossDb,
    connectorLossDb,
    totalLossDb,
    unknownSplitters,
    opticsClass,
    opticsClassRecorded,
    classMinLossDb: budget.minLossDb,
    classMaxLossDb: budget.maxLossDb,
    linkVerdict: check.verdict,
    ...(verdictWithheld ? { verdictWithheld } : {}),
    remainingDb: check.remainingDb,
    afterMarginDb: check.afterMarginDb,
    oltTxPowerDbm,
    expectedRxDbm,
    expectedRxRangeDbm,
    measuredRxDbm,
    discrepancyDb,
    verdict,
    verdictTitle,
    verdictDescription,
    recommendedAction,
  };
}
