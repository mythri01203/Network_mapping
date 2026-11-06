/**
 * Optical Link Budget & Loss Diagnosis Engine
 * Computes end-to-end optical link attenuation, expected received power,
 * and diagnoses discrepancies against measured ONU optical power.
 */

export type WavelengthNm = 1310 | 1490 | 1550;

export type LossVerdict = 'Normal' | 'Margin Warning' | 'High Attenuation / Macro-bend Alert';

/** Attenuation coefficients per ITU-T G.652.D standard fiber (dB/km) */
export const FIBER_ATTENUATION_RATES: Record<WavelengthNm, number> = {
  1310: 0.35, // Upstream GPON/EPON
  1490: 0.25, // Downstream GPON/EPON
  1550: 0.20, // CATV / RF Video overlay or extended range
};

/** Standard PLC Splitter insertion losses (dB) per Telcordia GR-1209/1221 */
export const SPLITTER_INSERTION_LOSS: Record<string, number> = {
  '1:2': 3.5,
  '1:4': 7.2,
  '1:8': 10.5,
  '1:16': 14.0,
  '1:32': 17.5,
  '1:64': 21.0,
  '1:128': 24.5,
};

/** Unbalanced FBT ratio coupler losses (dB) */
export const RATIO_COUPLER_LOSS: Record<string, { throughputDb: number; tapDb: number }> = {
  '90/10': { throughputDb: 0.6, tapDb: 10.5 },
  '80/20': { throughputDb: 1.2, tapDb: 7.4 },
  '70/30': { throughputDb: 1.8, tapDb: 5.6 },
  '60/40': { throughputDb: 2.6, tapDb: 4.4 },
  '50/50': { throughputDb: 3.4, tapDb: 3.4 },
};

export const DEFAULT_FUSION_SPLICE_LOSS_DB = 0.1;
export const DEFAULT_CONNECTOR_LOSS_DB = 0.5;

export interface SplitterLossSpec {
  ratio: string;
  lossDb?: number;
  isTap?: boolean;
}

export interface OpticalLossBudgetInput {
  totalDistanceMeters: number;
  wavelengthNm?: WavelengthNm;
  splitters?: (string | SplitterLossSpec | number)[];
  splicesCount?: number;
  connectorsCount?: number;
  oltTxPowerDbm?: number;
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
  oltTxPowerDbm: number;
  expectedRxDbm: number;
  measuredRxDbm?: number;
  discrepancyDb?: number;
  verdict: LossVerdict;
  verdictTitle: string;
  verdictDescription: string;
  recommendedAction: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Resolves insertion loss for a given splitter definition or ratio string.
 */
export function resolveSplitterLoss(item: string | SplitterLossSpec | number): number {
  if (typeof item === 'number') return item;
  if (typeof item === 'string') {
    if (SPLITTER_INSERTION_LOSS[item] !== undefined) return SPLITTER_INSERTION_LOSS[item];
    if (RATIO_COUPLER_LOSS[item] !== undefined) return RATIO_COUPLER_LOSS[item].tapDb;
    const match = item.match(/1:(\d+)/);
    if (match) {
      const ports = parseInt(match[1], 10);
      if (ports > 0) return round2(10 * Math.log10(ports) + 0.5);
    }
    return 10.5; // default 1:8
  }

  if (item.lossDb !== undefined && item.lossDb > 0) return item.lossDb;
  const ratio = item.ratio;
  if (RATIO_COUPLER_LOSS[ratio]) {
    return item.isTap ? RATIO_COUPLER_LOSS[ratio].tapDb : RATIO_COUPLER_LOSS[ratio].throughputDb;
  }
  return SPLITTER_INSERTION_LOSS[ratio] ?? 10.5;
}

/**
 * Pure function computing end-to-end link attenuation and diagnosis verdict.
 */
export function calculateOpticalLossBudget(input: OpticalLossBudgetInput): OpticalLossBudgetResult {
  const wavelengthNm: WavelengthNm = input.wavelengthNm ?? 1490;
  const rate = FIBER_ATTENUATION_RATES[wavelengthNm] ?? 0.35;
  const totalDistanceMeters = Math.max(0, input.totalDistanceMeters || 0);
  const totalDistanceKm = totalDistanceMeters / 1000;

  // 1. Fiber Cable Attenuation Loss
  const fiberLossDb = round2(totalDistanceKm * rate);

  // 2. Optical Splitter Insertion Losses
  const splitters = input.splitters || [];
  const splitterLossDb = round2(
    splitters.reduce<number>((sum, s) => sum + resolveSplitterLoss(s), 0),
  );

  // 3. Fusion Splices Loss
  const splicesCount = Math.max(0, input.splicesCount ?? 2);
  const spliceLossDb = round2(splicesCount * DEFAULT_FUSION_SPLICE_LOSS_DB);

  // 4. Mated Connector Pairs Loss (OLT patch + ODF + FAT drop + ONT)
  const connectorsCount = Math.max(1, input.connectorsCount ?? 4);
  const connectorLossDb = round2(connectorsCount * DEFAULT_CONNECTOR_LOSS_DB);

  // Total Optical Loss
  const totalLossDb = round2(fiberLossDb + splitterLossDb + spliceLossDb + connectorLossDb);

  // OLT Transmit Power
  const oltTxPowerDbm = input.oltTxPowerDbm ?? 3.0; // Class B+ default (+1.5 to +5.0 dBm)
  const expectedRxDbm = round1(oltTxPowerDbm - totalLossDb);

  const measuredRxDbm = input.measuredRxDbm !== undefined ? round1(input.measuredRxDbm) : undefined;
  let discrepancyDb: number | undefined;
  let verdict: LossVerdict = 'Normal';
  let verdictTitle = 'Nominal Optical Power';
  let verdictDescription = 'Calculated link budget matches standard FTTH engineering limits.';
  let recommendedAction = 'No action required. Link is operating at optimal signal margin.';

  if (measuredRxDbm !== undefined) {
    // discrepancy = actual - expected. Negative means actual is weaker than expected.
    discrepancyDb = round1(measuredRxDbm - expectedRxDbm);

    if (discrepancyDb < -4.0) {
      verdict = 'High Attenuation / Macro-bend Alert';
      verdictTitle = 'Severe Attenuation / Macro-Bend Alert';
      verdictDescription = `Measured optical power is ${Math.abs(discrepancyDb).toFixed(1)} dB lower than theoretical link budget.`;
      recommendedAction =
        'Dispatch field technician to inspect for tight cable macro-bends, crushed distribution tubes, damaged splice trays, or contaminated connector ferrule faces.';
    } else if (discrepancyDb < -1.5) {
      verdict = 'Margin Warning';
      verdictTitle = 'Marginal Power Discrepancy';
      verdictDescription = `Measured signal shows ${Math.abs(discrepancyDb).toFixed(1)} dB excess loss beyond expected optical budget.`;
      recommendedAction =
        'Clean SC/APC adapter ferrules with optical dry-cleaner pen and verify drop cable bend radius at the terminal box.';
    } else {
      verdict = 'Normal';
      verdictTitle = 'Normal Signal & Power Budget';
      verdictDescription = `Measured Rx (${measuredRxDbm} dBm) aligns cleanly with calculated budget (${expectedRxDbm} dBm).`;
      recommendedAction = 'All optical levels within ITU-T G.984 GPON Class B+ limits.';
    }
  }

  return {
    totalDistanceMeters,
    totalDistanceKm: round2(totalDistanceKm),
    wavelengthNm,
    attenuationRateDbPerKm: rate,
    fiberLossDb,
    splitterLossDb,
    spliceLossDb,
    connectorLossDb,
    totalLossDb,
    oltTxPowerDbm,
    expectedRxDbm,
    measuredRxDbm,
    discrepancyDb,
    verdict,
    verdictTitle,
    verdictDescription,
    recommendedAction,
  };
}

