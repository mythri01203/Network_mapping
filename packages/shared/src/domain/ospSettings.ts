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
  /** Phase 4: duct fill (cable area over the way's inside area) above which a warning is shown, by cable count. */
  ductFillOneCableRatio: number;
  ductFillTwoCablesRatio: number;
  ductFillManyCablesRatio: number;
  /** Phase 4: a cable point this close to a structure's old position is offered for moving with it. */
  poleMoveVertexMeters: number;
  /** Phase 5: another cable's line this close counts as running along the same route. */
  duplicateRouteCorridorMeters: number;
  /** Phase 5: share of the shorter line inside that corridor, with the same two ends, that asks "same cable?". */
  duplicateRouteOverlapRatio: number;
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

/** Fill = total cable cross-section area over the inside area of the way (both from diameters). */
const DUCT_FILL_SOURCE =
  'NFPA 70 (NEC) Chapter 9, Table 1 conduit fill: 53% for one cable, 31% for two, 40% for three or more. Written for building wiring, used here only as a starting point: replace it with the figure from your duct maker or your contract. Warns only; never blocks.';

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
  {
    id: 'osp.duct.fillOneCablePercent',
    label: 'Warn when one cable fills a duct, sub-duct or microduct more than',
    unit: '%',
    defaultValue: 53,
    source: DUCT_FILL_SOURCE,
    check: percent,
    apply: (s, v) => {
      s.ductFillOneCableRatio = v / 100;
    },
  },
  {
    id: 'osp.duct.fillTwoCablesPercent',
    label: 'Warn when two cables fill a duct, sub-duct or microduct more than',
    unit: '%',
    defaultValue: 31,
    source: DUCT_FILL_SOURCE,
    check: percent,
    apply: (s, v) => {
      s.ductFillTwoCablesRatio = v / 100;
    },
  },
  {
    id: 'osp.duct.fillManyCablesPercent',
    label: 'Warn when three or more cables fill a duct, sub-duct or microduct more than',
    unit: '%',
    defaultValue: 40,
    source: DUCT_FILL_SOURCE,
    check: percent,
    apply: (s, v) => {
      s.ductFillManyCablesRatio = v / 100;
    },
  },
  {
    id: 'osp.poleMove.vertexMeters',
    label: 'When a pole or chamber is moved, offer to move cable points within',
    unit: 'm',
    defaultValue: 2,
    source:
      'Proposed. A point snapped to a pin sits exactly on it; 2 m allows for rounding in imported files. Points are only offered, none ticked, and nothing moves until a person ticks it.',
    check: positive,
    apply: (s, v) => {
      s.poleMoveVertexMeters = v;
    },
  },
  {
    id: 'osp.duplicateRoute.corridorMeters',
    label: '"Same cable?" check: another cable with the same two ends whose line is within',
    unit: 'm',
    defaultValue: 10,
    source:
      'Proposed for Phase 5. Two lines drawn by hand along one street rarely sit closer than a few metres; 10 m allows for phone GPS and tapping. Warns only; never blocks.',
    check: positive,
    apply: (s, v) => {
      s.duplicateRouteCorridorMeters = v;
    },
  },
  {
    id: 'osp.duplicateRoute.overlapPercent',
    label: '"Same cable?" check: share of the shorter line inside that distance',
    unit: '%',
    defaultValue: 80,
    source:
      'Proposed for Phase 5. Two cables between the same two boxes along the same street may be real (a spare, a ring), so this only asks the person. Warns only; never blocks.',
    check: percent,
    apply: (s, v) => {
      s.duplicateRouteOverlapRatio = v / 100;
    },
  },
];

const empty = (): OspSettings => ({
  duplicateRadiusMeters: 0,
  attachmentCorridorMeters: 0,
  opticalShortRatio: 0,
  opticalLongRatio: 0,
  drawnVsSheathRatio: 0,
  ductFillOneCableRatio: 0,
  ductFillTwoCablesRatio: 0,
  ductFillManyCablesRatio: 0,
  poleMoveVertexMeters: 0,
  duplicateRouteCorridorMeters: 0,
  duplicateRouteOverlapRatio: 0,
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
