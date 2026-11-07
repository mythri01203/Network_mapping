import { describe, expect, it } from 'vitest';

import { calculateOpticalLossBudget } from '../src/domain/lossEngine';
import {
  checkLinkBudget,
  DEFAULT_OPTICAL_SETTINGS,
  OPTICAL_SETTING_DEFS,
  opticsClassForTechnology,
  resolveOpticalSettings,
  rxBandFor,
  validateOpticalOverride,
} from '../src/domain/opticalSettings';
import { rxReadingOf } from '../src/domain/rxReading';
import { budgetStatusFor } from '../src/domain/trace';
import { customerSchema, settingSchema } from '../src/model/schemas';
import { customer } from './fixtures';

/** The worked checks in fibergis-ftth-mapping references/optical-values.md. */
describe('worked examples (B+)', () => {
  const FOUR_PAIRS = { connectorsCount: 4 };

  it.each([
    ['5 km, 1:32, 6 splices', 5000, 1310, ['1:32'], 6, 20.55, 7.45, 4.45, 'fits_with_margin'],
    ['5 km, 1:64, 6 splices', 5000, 1310, ['1:64'], 6, 24.05, 3.95, 0.95, 'fits_with_margin'],
    ['20 km, 1:64, 6 splices', 20000, 1310, ['1:64'], 6, 29.3, -1.3, -4.3, 'over_budget'],
    ['12 km, 1:4 + 1:16 down', 12000, 1490, ['1:4', '1:16'], 8, 25.6, 2.4, -0.6, 'fits_under_margin'],
    ['12 km, 1:4 + 1:16 up', 12000, 1310, ['1:4', '1:16'], 8, 26.8, 1.2, -1.8, 'fits_under_margin'],
  ] as const)('%s', (_name, meters, wavelengthNm, splitters, splicesCount, loss, left, afterMargin, verdict) => {
    const result = calculateOpticalLossBudget({
      totalDistanceMeters: meters,
      wavelengthNm,
      splitters: [...splitters],
      splicesCount,
      ...FOUR_PAIRS,
    });
    expect(result.totalLossDb).toBe(loss);
    expect(result.remainingDb).toBe(left);
    expect(result.afterMarginDb).toBe(afterMargin);
    expect(result.linkVerdict).toBe(verdict);
  });

  it('gives expected Rx -24.1 to -20.6 dBm on the 12 km path', () => {
    const result = calculateOpticalLossBudget({
      totalDistanceMeters: 12000,
      wavelengthNm: 1490,
      splitters: ['1:4', '1:16'],
      splicesCount: 8,
      connectorsCount: 4,
    });
    expect(result.expectedRxRangeDbm).toEqual({ min: -24.1, max: -20.6 });
  });

  it('uses the real launch power when it is known', () => {
    const result = calculateOpticalLossBudget({
      totalDistanceMeters: 12000,
      wavelengthNm: 1490,
      splitters: ['1:4', '1:16'],
      splicesCount: 8,
      connectorsCount: 4,
      oltTxPowerDbm: 2,
    });
    expect(result.expectedRxDbm).toBe(-23.6);
  });
});

describe('the floor: too little loss', () => {
  it('flags a short, low-split link as too much light', () => {
    const result = calculateOpticalLossBudget({
      totalDistanceMeters: 1000,
      wavelengthNm: 1490,
      splitters: ['1:2'],
      connectorsCount: 2,
    });
    expect(result.totalLossDb).toBeLessThan(13);
    expect(result.linkVerdict).toBe('too_little_loss');
    expect(result.verdict).toBe('Too Little Loss');
    expect(result.recommendedAction).toContain('missing splitter');
  });

  it('is judged per class: C+ has a higher floor', () => {
    expect(checkLinkBudget(14, 'GPON B+').verdict).not.toBe('too_little_loss');
    expect(checkLinkBudget(14, 'GPON C+').verdict).toBe('too_little_loss');
  });

  it('has no floor where no source gives one', () => {
    expect(checkLinkBudget(1, 'EPON PX20').verdict).toBe('fits_with_margin');
  });

  it('treats exactly the ceiling as fitting', () => {
    expect(checkLinkBudget(28, 'GPON B+').verdict).toBe('fits_under_margin');
    expect(checkLinkBudget(28.01, 'GPON B+').verdict).toBe('over_budget');
  });
});

describe('receive bands', () => {
  it('gives each boundary to the better band', () => {
    expect(rxBandFor(-8)).toBe('good');
    expect(rxBandFor(-7.9)).toBe('too_much_light');
    expect(rxBandFor(-24)).toBe('good');
    expect(rxBandFor(-24.1)).toBe('low_margin');
    expect(rxBandFor(-27)).toBe('low_margin');
    expect(rxBandFor(-27.1)).toBe('bad');
    expect(rxBandFor(undefined)).toBe('unknown');
  });

  it('never rates 0 dBm as a pass', () => {
    expect(budgetStatusFor(0)).toBe('Fail');
    expect(budgetStatusFor(-7)).toBe('Fail');
    expect(budgetStatusFor(-20)).toBe('Pass');
  });
});

describe('operator overrides', () => {
  it('merges over the defaults and leaves the rest alone', () => {
    const settings = resolveOpticalSettings([
      { id: 'optical.fiber.1490', value: 0.3 },
      { id: 'optical.rx.good', value: -22 },
    ]);
    expect(settings.fiberDbPerKm[1490]).toBe(0.3);
    expect(settings.fiberDbPerKm[1310]).toBe(0.35);
    expect(settings.rx.goodFloorDbm).toBe(-22);
    expect(rxBandFor(-23, settings)).toBe('low_margin');
    expect(rxBandFor(-23)).toBe('good');
  });

  it('ignores unknown keys and values that are not numbers', () => {
    const settings = resolveOpticalSettings([
      { id: 'optical.nope', value: 1 },
      { id: 'optical.connector.pair', value: 'high' },
    ]);
    expect(settings).toEqual(DEFAULT_OPTICAL_SETTINGS);
  });

  it('gives a verdict from overridden values', () => {
    const settings = resolveOpticalSettings([{ id: 'optical.fiber.1490', value: 0.3 }]);
    const parts = { totalDistanceMeters: 12000, wavelengthNm: 1490 as const, splitters: ['1:4', '1:16'], splicesCount: 8, connectorsCount: 4 };
    expect(calculateOpticalLossBudget(parts).totalLossDb).toBe(25.6);
    expect(calculateOpticalLossBudget(parts, settings).totalLossDb).toBe(26.2);
  });

  it('gives every setting a source note', () => {
    for (const setting of OPTICAL_SETTING_DEFS) expect(setting.source.length).toBeGreaterThan(3);
  });

  it('refuses only impossible values', () => {
    expect(validateOpticalOverride('optical.splitter.1:8', 8)).toMatch(/cannot lose less/);
    expect(validateOpticalOverride('optical.splitter.1:8', 9)).toBeNull();
    expect(validateOpticalOverride('optical.connector.pair', -1)).toMatch(/negative/);
    expect(validateOpticalOverride('optical.rx.good', -30)).toMatch(/strongest to weakest/);
    expect(validateOpticalOverride('optical.rx.good', -22)).toBeNull();
    expect(validateOpticalOverride('optical.nope', 1)).toMatch(/does not exist/);
  });

  it('stores an override in the generic settings collection', () => {
    expect(settingSchema.safeParse({ id: 'optical.margin', value: 4, source: 'Vendor sheet' }).success).toBe(true);
  });
});

describe('opticsClassForTechnology', () => {
  it('does not treat XGS-PON or 10G-EPON as GPON', () => {
    expect(opticsClassForTechnology('GPON')).toBe('GPON B+');
    expect(opticsClassForTechnology('XGS-PON')).toBe('XG-PON N1');
    expect(opticsClassForTechnology('10G-EPON')).toBe('XG-PON N1');
  });
});

describe('reading origin', () => {
  const base = { rxSource: undefined, rxMeasuredAt: undefined, isSampleData: undefined };

  it('shows Not recorded when absent', () => {
    expect(rxReadingOf({ ...base, rxOpticalPowerDbm: undefined })).toMatchObject({
      origin: 'not_recorded',
      text: 'Not recorded',
      isMeasured: false,
    });
  });

  it('never shows a record of unknown origin as measured', () => {
    expect(rxReadingOf({ ...base, rxOpticalPowerDbm: -20 })).toMatchObject({ originLabel: 'Estimated', isMeasured: false });
  });

  it('treats an older saved 0 dBm as never recorded', () => {
    expect(rxReadingOf({ ...base, rxOpticalPowerDbm: 0 })).toMatchObject({ origin: 'not_recorded', band: 'unknown' });
  });

  it('says Measured only for a meter or device reading', () => {
    expect(rxReadingOf({ ...base, rxOpticalPowerDbm: -20, rxSource: 'calculated' }).originLabel).toBe('Estimated');
    expect(rxReadingOf({ ...base, rxOpticalPowerDbm: -20, rxSource: 'designed' }).originLabel).toBe('Designed');
    expect(rxReadingOf({ ...base, rxOpticalPowerDbm: -20, rxSource: 'field_measured', rxMeasuredAt: '2026-11-01' })).toMatchObject({
      originLabel: 'Measured',
      measuredAt: '2026-11-01',
      isMeasured: true,
    });
    expect(rxReadingOf({ ...base, rxOpticalPowerDbm: -20, rxSource: 'device_reported' }).isMeasured).toBe(true);
  });

  it('labels sample data as sample, even with a measured source', () => {
    expect(rxReadingOf({ ...base, rxOpticalPowerDbm: -19.4, isSampleData: true, rxSource: 'field_measured' })).toMatchObject({
      originLabel: 'Sample data',
      isMeasured: false,
    });
  });

  it('keeps older customer records valid', () => {
    const { rxSource: _a, rxMeasuredAt: _b, rxLaunchDbm: _c, isSampleData: _d, ...older } = customer({ id: 'OLD' });
    expect(customerSchema.safeParse(older).success).toBe(true);
    const { rxOpticalPowerDbm: _e, ...noReading } = older;
    expect(customerSchema.safeParse(noReading).success).toBe(true);
  });
});
