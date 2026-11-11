import type { Setting } from '../model/types';

/**
 * Network mapping Phase 18: when a capacity figure says "nearly full". Each level is a planning
 * proposal, not a standard, and the operator changes it in the `settings` collection (Capacity
 * dashboard, Warning levels) without a code change. They only warn: nothing is ever refused by them.
 */

export type CapacityKind = 'splitter' | 'pon_port' | 'olt_card' | 'odf' | 'cable_cores' | 'duct' | 'pole' | 'rack';

export const CAPACITY_KIND_LABELS: Record<CapacityKind, string> = {
  splitter: 'Splitter outputs',
  pon_port: 'PON port (ONTs)',
  olt_card: 'OLT card (PON ports)',
  odf: 'ODF adapters',
  cable_cores: 'Cable fibres',
  duct: 'Duct ways',
  pole: 'Pole (cables on it)',
  rack: 'Rack units',
};

export interface CapacitySettings {
  /** Share taken (0 to 1) at or above which an element is "nearly full", by kind. */
  nearlyFull: Record<CapacityKind, number>;
}

export interface CapacitySettingDef {
  id: string;
  kind: CapacityKind;
  label: string;
  unit: '%';
  defaultValue: number;
  source: string;
  check?: (value: number | string) => string | null;
}

const PLANNING_SOURCE =
  'Proposed for Phase 18, not a standard. Building more takes weeks (survey, permission, pulling, splicing), so planners often start the next build at about 80% taken. Set your own. Warns only; never blocks.';

const percent = (value: number | string) => (typeof value === 'number' && value > 0 && value <= 100 ? null : 'Enter a percentage above 0 and up to 100.');

const def = (kind: CapacityKind, label: string, defaultValue: number, source = PLANNING_SOURCE): CapacitySettingDef => ({
  id: `capacity.${kind}.nearlyFullPercent`,
  kind,
  label,
  unit: '%',
  defaultValue,
  source,
  check: percent,
});

/** Every warning level, with its default and where that default comes from. */
export const CAPACITY_SETTING_DEFS: readonly CapacitySettingDef[] = [
  def('splitter', 'Say "nearly full" when a splitter has this share of its outputs taken', 80),
  def('pon_port', 'Say "nearly full" when a PON port has this share of its recorded ONU limit taken', 80),
  def('olt_card', 'Say "nearly full" when an OLT card has this share of its PON ports taken', 80),
  def('odf', 'Say "nearly full" when an ODF has this share of its adapters taken', 80),
  def('cable_cores', 'Say "nearly full" when a cable has this share of its fibres taken', 80),
  def('duct', 'Say "nearly full" when a duct has this share of its ways taken', 75, `${PLANNING_SOURCE} Lower by default because a way, once used, is hard to win back. How full each way is (fill) has its own levels under Poles and routes settings.`),
  def(
    'pole',
    'Say "nearly full" when a pole carries this share of the cables its owner allows',
    80,
    `${PLANNING_SOURCE} It is only looked at on poles where the allowed number is recorded (from the owner's permission or agreement).`,
  ),
  def('rack', 'Say "nearly full" when a rack has this share of its units taken', 80),
];

/** Defaults with the operator's valid overrides applied. Wrong types and impossible values are ignored. */
export function resolveCapacitySettings(overrides: readonly Pick<Setting, 'id' | 'value'>[] = []): CapacitySettings {
  const byId = new Map(overrides.map((o) => [o.id, o.value]));
  const nearlyFull = {} as Record<CapacityKind, number>;
  for (const d of CAPACITY_SETTING_DEFS) {
    const value = byId.get(d.id);
    const usable = typeof value === 'number' && Number.isFinite(value) && !d.check?.(value);
    nearlyFull[d.kind] = (usable ? value : d.defaultValue) / 100;
  }
  return { nearlyFull };
}

export const DEFAULT_CAPACITY_SETTINGS: CapacitySettings = resolveCapacitySettings();

/** Where each level came from: the default, or the operator's setting with who and when. */
export function capacitySettingSources(overrides: readonly Setting[] = []): { def: CapacitySettingDef; value: number; fromSetting: boolean; text: string }[] {
  const byId = new Map(overrides.map((o) => [o.id, o]));
  return CAPACITY_SETTING_DEFS.map((d) => {
    const own = byId.get(d.id);
    const usable = !!own && typeof own.value === 'number' && Number.isFinite(own.value) && !d.check?.(own.value);
    const value = usable ? (own!.value as number) : d.defaultValue;
    const text = usable
      ? `${value}% (your setting${own!.updatedAt ? `, ${own!.updatedAt.slice(0, 10)}` : ''}${own!.updatedBy ? `, ${own!.updatedBy}` : ''}${own!.source ? `; ${own!.source}` : ''})`
      : `${value}% (default: ${d.source})`;
    return { def: d, value, fromSetting: usable, text };
  });
}
