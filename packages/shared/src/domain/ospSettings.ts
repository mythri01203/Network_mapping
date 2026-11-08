import type { Setting } from '../model/types';

/**
 * Editable limits for poles, routes and lengths. Every one is a proposal from the
 * `fibergis-osp-mapping` skill, not a standard, and the operator can change it in the `settings`
 * collection (Administration, Routes and poles) without a code change.
 */

export interface OspSettings {
  /** Same type this close is offered as "the same one?" before a new structure is created. */
  duplicateRadiusMeters: number;
  /** A pole this close to a cable's drawn line may be offered as "on this route?". Never saved without a person. */
  attachmentCorridorMeters: number;
  /** Optical (OTDR) shorter than sheath by more than this share suggests a wrong core, wrong cable or a break. */
  opticalShortRatio: number;
  /** Optical longer than sheath by more than this share suggests unrecorded slack or a detour. */
  opticalLongRatio: number;
  /** Drawn and installed (sheath) length differing by more than this share needs review. */
  drawnVsSheathRatio: number;
}

export interface OspSettingDef {
  id: string;
  label: string;
  unit: 'm' | '%';
  defaultValue: number;
  source: string;
  check?: (value: number | string) => string | null;
  apply: (settings: OspSettings, value: number) => void;
}

const positive = (value: number | string) => (typeof value === 'number' && value > 0 ? null : 'Enter a number above 0.');
const percent = (value: number | string) =>
  typeof value === 'number' && value > 0 && value < 100 ? null : 'Enter a percentage between 0 and 100.';

/** Every editable outside-plant value, with its default and where that default comes from. */
export const OSP_SETTING_DEFS: readonly OspSettingDef[] = [
  {
    id: 'osp.duplicate.radiusMeters',
    label: '"Same one?" check before adding a pole, chamber or box: same type within',
    unit: 'm',
    defaultValue: 5,
    source:
      'Proposed in fibergis-osp-mapping. Phones reach about 5 m at best, so two of the same type closer than this are often one item mapped twice. Warns only; never blocks.',
    check: positive,
    apply: (s, v) => {
      s.duplicateRadiusMeters = v;
    },
  },
  {
    id: 'osp.attachment.corridorMeters',
    label: '"Poles near this line" suggestions: pole within',
    unit: 'm',
    defaultValue: 15,
    source:
      'Proposed. fibergis-osp-mapping accepts route points within 15 m. A suggestion is never saved until a person ticks it.',
    check: positive,
    apply: (s, v) => {
      s.attachmentCorridorMeters = v;
    },
  },
  {
    id: 'osp.length.opticalShortPercent',
    label: 'Flag optical length shorter than sheath length by more than',
    unit: '%',
    defaultValue: 1,
    source: 'Proposed in fibergis-osp-mapping: optical is normally 1 to 3% longer, because fiber is longer than the sheath.',
    check: percent,
    apply: (s, v) => {
      s.opticalShortRatio = v / 100;
    },
  },
  {
    id: 'osp.length.opticalLongPercent',
    label: 'Flag optical length longer than sheath length by more than',
    unit: '%',
    defaultValue: 5,
    source: 'Proposed in fibergis-osp-mapping: excess fiber is about 1 to 4%; more suggests unrecorded slack or a detour.',
    check: percent,
    apply: (s, v) => {
      s.opticalLongRatio = v / 100;
    },
  },
  {
    id: 'osp.length.drawnVsSheathPercent',
    label: 'Flag drawn and sheath length differing by more than',
    unit: '%',
    defaultValue: 10,
    source: 'Proposed in fibergis-osp-mapping. Slack, vertical runs and corners make the installed cable longer than the map.',
    check: percent,
    apply: (s, v) => {
      s.drawnVsSheathRatio = v / 100;
    },
  },
];

const empty = (): OspSettings => ({
  duplicateRadiusMeters: 0,
  attachmentCorridorMeters: 0,
  opticalShortRatio: 0,
  opticalLongRatio: 0,
  drawnVsSheathRatio: 0,
});

/** Defaults with the operator's valid overrides applied. Wrong types and impossible values are ignored. */
export function resolveOspSettings(overrides: readonly Pick<Setting, 'id' | 'value'>[] = []): OspSettings {
  const byId = new Map(overrides.map((o) => [o.id, o.value]));
  const settings = empty();
  for (const def of OSP_SETTING_DEFS) {
    const value = byId.get(def.id);
    const usable = typeof value === 'number' && Number.isFinite(value) && !def.check?.(value);
    def.apply(settings, usable ? value : def.defaultValue);
  }
  return settings;
}

export const DEFAULT_OSP_SETTINGS: OspSettings = resolveOspSettings();
