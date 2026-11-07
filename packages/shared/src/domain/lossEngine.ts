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
  | 'Not Assessed';

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
  classMinLossDb?: number;
  classMaxLossDb: number;
  linkVerdict: LinkVerdict;
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

  if (discrepancyDb !== undefined && discrepancyDb < -settings.measuredGapDb) {
    verdict = 'High Attenuation / Macro-bend Alert';
    verdictTitle = 'Reading is much weaker than expected';
    verdictDescription = `The measured reading is ${Math.abs(discrepancyDb).toFixed(1)} dB below what this path should give.`;
    recommendedAction = 'Check for a dirty connector, a tight bend, or the wrong path.';
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
    classMinLossDb: budget.minLossDb,
    classMaxLossDb: budget.maxLossDb,
    linkVerdict: check.verdict,
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
