import type { Setting } from '../model/types';

/**
 * Cable TV level settings (Phase 6). **Every value here is proposed: check with your operators.**
 * The plan asked for 5 to 10 cable operator interviews before these were fixed; they have not
 * happened. The numbers come from `.claude/skills/fibergis-cable-tv-mapping/references/rf-values.md`
 * (seller listings, one datasheet, field posters and rules of thumb), each with its grade in the
 * source note. The operator changes them in the `settings` collection (Administration, Cable TV
 * settings) without a code change. Only dBµV = dBmV + 60 is a true constant (`rfUnits.ts`).
 */

export const RF_PROPOSED = 'Proposed: check with your operators.';

export const RF_PROFILE_IDS = ['indian_stb', 'docsis30', 'docsis31'] as const;
export type RfProfileId = (typeof RF_PROFILE_IDS)[number];

/** A window for the level at a customer's set top box or modem. Stored in its own unit. */
export interface RfLevelProfile {
  id: RfProfileId;
  label: string;
  unit: 'dBuV' | 'dBmV';
  /** Minimum up to `splitMhz`, and above it. Equal when the profile has one minimum. */
  minLow: number;
  minHigh: number;
  splitMhz: number;
  max: number;
  source: string;
}

export interface RfSettings {
  activeProfile: RfProfileId;
  profiles: Record<RfProfileId, RfLevelProfile>;
  /** The two frequencies levels are estimated at. */
  lowMhz: number;
  highMhz: number;
  /** Coax loss per 100 m at 750 MHz, by coax type key. Scaled by √(f / 750) for other frequencies. */
  coaxLossPer100mAt750: Record<string, number>;
  /** Amplifiers in one cascade before a warning. */
  cascadeLimit: number;
  /** A reading this far above the estimate is flagged: passive parts cannot add signal. */
  aboveEstimateDb: number;
  /** Rule-of-thumb splitter losses, shown only as a hint in the form. Never used as a recorded loss. */
  splitterHintDb: { two: number; four: number; eight: number };
}

export interface RfSettingDef {
  id: string;
  label: string;
  unit: string;
  defaultValue: number | string;
  source: string;
  check?: (value: number | string) => string | null;
  apply: (settings: RfSettings, value: number | string) => void;
}

const between = (min: number, max: number) => (value: number | string) =>
  typeof value === 'number' && value >= min && value <= max ? null : `Enter a number from ${min} to ${max}.`;
const wholeAtLeast = (min: number) => (value: number | string) =>
  typeof value === 'number' && Number.isInteger(value) && value >= min ? null : `Enter a whole number of ${min} or more.`;

/** Coax types the calculation knows. "other" has no loss, so a link of that type stops the estimate. */
export const RF_COAX_TYPES = ['RG6', 'RG11', 'P3 500', 'P3 625'] as const;

const STB_SOURCE =
  'Indian set top box input: 60 dBµV minimum to 300 MHz, 57 above, 77 maximum with more than 20 channels (80 with fewer). From a 2003 summary of the paywalled BIS text, before digitisation; another report says 47 dBµV. Grade: dated summary.';
const D30_SOURCE =
  'DOCSIS 3.0 downstream receive range as commonly quoted (−15 to +15 dBmV per 6 MHz channel). Not checked against the CableLabs text in this research. Grade: rule of thumb.';
const D31_SOURCE =
  'DOCSIS 3.1 OFDM average above −6 dBmV (per 6 MHz) from a field poster, not the CableLabs text. The +15 dBmV maximum is copied from DOCSIS 3.0 and was not found for 3.1. Grade: field poster.';

const p = (s: RfSettings) => s.profiles;

/** Every editable Cable TV value, with its default and where the default comes from. */
export const RF_SETTING_DEFS: readonly RfSettingDef[] = [
  {
    id: 'rf.profile.active',
    label: 'Level profile used for customer checks (indian_stb, docsis30 or docsis31)',
    unit: '',
    defaultValue: 'indian_stb',
    source: `${RF_PROPOSED} Indian TV set top box is the likely LCO case (an inference, not a survey); choose a DOCSIS profile for modem plant.`,
    check: (v) => (typeof v === 'string' && (RF_PROFILE_IDS as readonly string[]).includes(v) ? null : `Enter one of: ${RF_PROFILE_IDS.join(', ')}.`),
    apply: (s, v) => {
      s.activeProfile = v as RfProfileId;
    },
  },
  { id: 'rf.profile.indian_stb.minLowDbuv', label: 'Indian set top box: lowest level up to the split frequency', unit: 'dBµV', defaultValue: 60, source: `${RF_PROPOSED} ${STB_SOURCE}`, check: between(30, 100), apply: (s, v) => { p(s).indian_stb.minLow = Number(v); } },
  { id: 'rf.profile.indian_stb.minHighDbuv', label: 'Indian set top box: lowest level above the split frequency', unit: 'dBµV', defaultValue: 57, source: `${RF_PROPOSED} ${STB_SOURCE}`, check: between(30, 100), apply: (s, v) => { p(s).indian_stb.minHigh = Number(v); } },
  { id: 'rf.profile.indian_stb.splitMhz', label: 'Indian set top box: split frequency', unit: 'MHz', defaultValue: 300, source: `${RF_PROPOSED} ${STB_SOURCE}`, check: between(47, 1000), apply: (s, v) => { p(s).indian_stb.splitMhz = Number(v); } },
  { id: 'rf.profile.indian_stb.maxDbuv', label: 'Indian set top box: highest level', unit: 'dBµV', defaultValue: 77, source: `${RF_PROPOSED} ${STB_SOURCE}`, check: between(40, 120), apply: (s, v) => { p(s).indian_stb.max = Number(v); } },
  { id: 'rf.profile.docsis30.minDbmv', label: 'DOCSIS 3.0 modem: lowest downstream level', unit: 'dBmV', defaultValue: -15, source: `${RF_PROPOSED} ${D30_SOURCE}`, check: between(-30, 30), apply: (s, v) => { p(s).docsis30.minLow = Number(v); p(s).docsis30.minHigh = Number(v); } },
  { id: 'rf.profile.docsis30.maxDbmv', label: 'DOCSIS 3.0 modem: highest downstream level', unit: 'dBmV', defaultValue: 15, source: `${RF_PROPOSED} ${D30_SOURCE}`, check: between(-30, 40), apply: (s, v) => { p(s).docsis30.max = Number(v); } },
  { id: 'rf.profile.docsis31.minDbmv', label: 'DOCSIS 3.1 modem: lowest OFDM average level (per 6 MHz)', unit: 'dBmV', defaultValue: -6, source: `${RF_PROPOSED} ${D31_SOURCE}`, check: between(-30, 30), apply: (s, v) => { p(s).docsis31.minLow = Number(v); p(s).docsis31.minHigh = Number(v); } },
  { id: 'rf.profile.docsis31.maxDbmv', label: 'DOCSIS 3.1 modem: highest downstream level', unit: 'dBmV', defaultValue: 15, source: `${RF_PROPOSED} ${D31_SOURCE}`, check: between(-30, 40), apply: (s, v) => { p(s).docsis31.max = Number(v); } },
  {
    id: 'rf.calc.lowMhz',
    label: 'Low frequency levels are estimated at',
    unit: 'MHz',
    defaultValue: 47,
    source: `${RF_PROPOSED} Bottom of the 47–862 MHz range in the Indian set top box summary. Set it to your lowest carried channel.`,
    check: between(5, 1800),
    apply: (s, v) => { s.lowMhz = Number(v); },
  },
  {
    id: 'rf.calc.highMhz',
    label: 'High frequency levels are estimated at',
    unit: 'MHz',
    defaultValue: 862,
    source: `${RF_PROPOSED} Top of the 47–862 MHz range in the Indian set top box summary. Set it to your highest carried channel. Amplifier gain is taken as entered at this frequency.`,
    check: between(5, 1800),
    apply: (s, v) => { s.highMhz = Number(v); },
  },
  { id: 'rf.coax.RG6.lossPer100m', label: 'RG6 coax loss per 100 m at 750 MHz', unit: 'dB', defaultValue: 17.5, source: `${RF_PROPOSED} About 17.5 dB, low confidence. Replace with your drum datasheet.`, check: between(0.5, 60), apply: (s, v) => { s.coaxLossPer100mAt750.RG6 = Number(v); } },
  { id: 'rf.coax.RG11.lossPer100m', label: 'RG11 coax loss per 100 m at 750 MHz', unit: 'dB', defaultValue: 11.9, source: `${RF_PROPOSED} 11.90 dB maximum from one datasheet.`, check: between(0.5, 60), apply: (s, v) => { s.coaxLossPer100mAt750.RG11 = Number(v); } },
  { id: 'rf.coax.P3 500.lossPer100m', label: 'P3 500 hardline loss per 100 m at 750 MHz', unit: 'dB', defaultValue: 7.09, source: `${RF_PROPOSED} 7.09 dB (8.32 at 1002 MHz) from a search excerpt; the source PDF is unconfirmed.`, check: between(0.5, 60), apply: (s, v) => { s.coaxLossPer100mAt750['P3 500'] = Number(v); } },
  { id: 'rf.coax.P3 625.lossPer100m', label: 'P3 625 hardline loss per 100 m at 750 MHz', unit: 'dB', defaultValue: 5.84, source: `${RF_PROPOSED} 5.84 dB (6.92 at 1002 MHz) from a search excerpt.`, check: between(0.5, 60), apply: (s, v) => { s.coaxLossPer100mAt750['P3 625'] = Number(v); } },
  {
    id: 'rf.amp.cascadeLimit',
    label: 'Warn when more amplifiers than this are in one cascade',
    unit: 'count',
    defaultValue: 5,
    source: `${RF_PROPOSED} No authoritative limit was found: a glossary says 3–5, one dated paper two trunks, a bridger and three extenders.`,
    check: wholeAtLeast(1),
    apply: (s, v) => { s.cascadeLimit = Number(v); },
  },
  {
    id: 'rf.check.aboveEstimateDb',
    label: 'Flag a reading this far above the estimate',
    unit: 'dB',
    defaultValue: 3,
    source: `${RF_PROPOSED} Passive parts cannot add signal. A reading well above the level worked out from upstream points at a wrong unit (60 dB), a rating typed instead of a reading, a test point, or the meter on the wrong port.`,
    check: between(0.5, 30),
    apply: (s, v) => { s.aboveEstimateDb = Number(v); },
  },
  { id: 'rf.hint.split2Db', label: 'Hint shown for a 2-way splitter loss', unit: 'dB', defaultValue: 4, source: `${RF_PROPOSED} Rule of thumb (3.5–3.8 low band, up to 5.5 at the top). Only a hint: the loss used is the one entered for the part.`, check: between(0, 30), apply: (s, v) => { s.splitterHintDb.two = Number(v); } },
  { id: 'rf.hint.split4Db', label: 'Hint shown for a 4-way splitter loss', unit: 'dB', defaultValue: 7.5, source: `${RF_PROPOSED} Rule of thumb, 7.5–8 dB. Only a hint.`, check: between(0, 30), apply: (s, v) => { s.splitterHintDb.four = Number(v); } },
  { id: 'rf.hint.split8Db', label: 'Hint shown for an 8-way splitter loss', unit: 'dB', defaultValue: 11.5, source: `${RF_PROPOSED} Rule of thumb, 11–12 dB. Only a hint.`, check: between(0, 30), apply: (s, v) => { s.splitterHintDb.eight = Number(v); } },
];

const empty = (): RfSettings => ({
  activeProfile: 'indian_stb',
  profiles: {
    indian_stb: { id: 'indian_stb', label: 'Indian TV set top box', unit: 'dBuV', minLow: 0, minHigh: 0, splitMhz: 0, max: 0, source: STB_SOURCE },
    docsis30: { id: 'docsis30', label: 'DOCSIS 3.0 cable modem', unit: 'dBmV', minLow: 0, minHigh: 0, splitMhz: 0, max: 0, source: D30_SOURCE },
    docsis31: { id: 'docsis31', label: 'DOCSIS 3.1 cable modem', unit: 'dBmV', minLow: 0, minHigh: 0, splitMhz: 0, max: 0, source: D31_SOURCE },
  },
  lowMhz: 0,
  highMhz: 0,
  coaxLossPer100mAt750: {},
  cascadeLimit: 0,
  aboveEstimateDb: 0,
  splitterHintDb: { two: 0, four: 0, eight: 0 },
});

/** Defaults with the operator's valid overrides applied. Wrong types and impossible values are ignored. */
export function resolveRfSettings(overrides: readonly Pick<Setting, 'id' | 'value'>[] = []): RfSettings {
  const byId = new Map(overrides.map((o) => [o.id, o.value]));
  const settings = empty();
  for (const def of RF_SETTING_DEFS) {
    const value = byId.get(def.id);
    const usable = (typeof value === 'number' ? Number.isFinite(value) : typeof value === 'string') && typeof value === typeof def.defaultValue && !def.check?.(value as number | string);
    def.apply(settings, usable ? (value as number | string) : def.defaultValue);
  }
  if (settings.highMhz <= settings.lowMhz) {
    settings.lowMhz = 47;
    settings.highMhz = 862;
  }
  return settings;
}

export const DEFAULT_RF_SETTINGS: RfSettings = resolveRfSettings();

/** The level window at the frequency, in dBµV. */
export function profileWindowDbuv(profile: RfLevelProfile, frequencyMhz: number | undefined): { min: number; max: number } {
  const offset = profile.unit === 'dBmV' ? 60 : 0;
  const min = frequencyMhz !== undefined && frequencyMhz > profile.splitMhz ? profile.minHigh : profile.minLow;
  return { min: min + offset, max: profile.max + offset };
}
