/**
 * Fiber identification colours. Identity is always the cable-wide fiber number, worked out as
 * `(tube - 1) x fibers per tube + fiber`. A colour is only a lookup in the cable's recorded scheme:
 * with no scheme recorded, or the "unknown" scheme, no colour is shown, because "Blue may not be
 * fiber 1". Schemes are data: the built-in ones below carry a source note, and the operator can add
 * more in the `settings` collection (`fiber.scheme.<key>`), without a code change.
 */

/** One entry of a colour sequence. */
export interface FiberColorDef {
  number: number;
  name: string;
  hex: string;
  textColor: string;
}

/** TIA-598 order. Kept for screens that pick a line colour for the map, never for core identity. */
export const STANDARD_12_COLORS: readonly FiberColorDef[] = [
  { number: 1, name: 'Blue', hex: '#0284c7', textColor: '#ffffff' },
  { number: 2, name: 'Orange', hex: '#ea580c', textColor: '#ffffff' },
  { number: 3, name: 'Green', hex: '#16a34a', textColor: '#ffffff' },
  { number: 4, name: 'Brown', hex: '#78350f', textColor: '#ffffff' },
  { number: 5, name: 'Slate', hex: '#64748b', textColor: '#ffffff' },
  { number: 6, name: 'White', hex: '#f8fafc', textColor: '#1e293b' },
  { number: 7, name: 'Red', hex: '#dc2626', textColor: '#ffffff' },
  { number: 8, name: 'Black', hex: '#1e293b', textColor: '#ffffff' },
  { number: 9, name: 'Yellow', hex: '#eab308', textColor: '#1e293b' },
  { number: 10, name: 'Violet', hex: '#8b5cf6', textColor: '#ffffff' },
  { number: 11, name: 'Rose', hex: '#f43f5e', textColor: '#ffffff' },
  { number: 12, name: 'Aqua', hex: '#06b6d4', textColor: '#ffffff' },
];

/**
 * TIA-598 colour by position, cycling every 12. Only valid for a cable recorded as TIA-598 with 12
 * per tube; use `coreIdentity` for anything that names a real cable's core.
 * @deprecated Assumes TIA-598 and 12 per tube.
 */
export function getFiberColor(coreNumber: number): FiberColorDef {
  const index = (((coreNumber - 1) % 12) + 12) % 12;
  return STANDARD_12_COLORS[index];
}

/** @deprecated Assumes 12 fibres per tube. Use `coreIdentity` with the cable's recorded layout. */
export function getTubeNumber(coreNumber: number): number {
  return Math.floor((coreNumber - 1) / 12) + 1;
}

/** @deprecated Assumes tubes follow TIA-598. Use `coreIdentity`. */
export function getTubeColor(tubeNumber: number): FiberColorDef {
  return getFiberColor(tubeNumber);
}

/* ------------------------------------------------------------------ */
/* Schemes                                                             */
/* ------------------------------------------------------------------ */

export const UNKNOWN_SCHEME_ID = 'unknown';

export interface ColorScheme {
  id: string;
  name: string;
  /** Colour names in order. Empty for the unknown scheme. */
  colors: readonly string[];
  source: string;
  builtIn: boolean;
}

/** Display swatches for colour names. Only the swatch comes from here, never the order. */
const SWATCHES: Record<string, string> = {
  blue: '#0284c7',
  orange: '#ea580c',
  green: '#16a34a',
  brown: '#78350f',
  slate: '#64748b',
  grey: '#9ca3af',
  gray: '#9ca3af',
  white: '#f8fafc',
  red: '#dc2626',
  black: '#1e293b',
  yellow: '#eab308',
  violet: '#8b5cf6',
  purple: '#8b5cf6',
  rose: '#f43f5e',
  pink: '#f472b6',
  aqua: '#06b6d4',
  turquoise: '#14b8a6',
  natural: '#e7e5e4',
};

const DARK_TEXT = new Set(['white', 'yellow', 'natural', 'grey', 'gray', 'aqua', 'pink']);

export const BUILT_IN_COLOR_SCHEMES: readonly ColorScheme[] = [
  {
    id: 'tia-598',
    name: 'TIA-598 (Blue, Orange, Green ...)',
    colors: ['Blue', 'Orange', 'Green', 'Brown', 'Slate', 'White', 'Red', 'Black', 'Yellow', 'Violet', 'Rose', 'Aqua'],
    source: 'TIA-598 order as in the fibergis-ftth-mapping reference. Common in India but not universal; one operator spec prints "pink" for rose.',
    builtIn: true,
  },
  {
    id: 'iec-60304',
    name: 'IEC 60304 / DIN (Red, Green, Blue ...)',
    colors: ['Red', 'Green', 'Blue', 'Yellow', 'White', 'Grey', 'Brown', 'Violet', 'Turquoise', 'Black', 'Orange', 'Pink'],
    source:
      'The research notes confirm only that IEC 60304 / DIN opens red, green, blue. Positions 4 to 12 are the commonly published DIN VDE 0888 order and were not checked against the standard text: compare with the drum sheet first.',
    builtIn: true,
  },
  {
    id: UNKNOWN_SCHEME_ID,
    name: 'Not known (check the drum sheet)',
    colors: [],
    source: 'No scheme recorded. Colours are not shown, because Blue may not be fiber 1.',
    builtIn: true,
  },
];

const SCHEME_SETTING_PREFIX = 'fiber.scheme.';

/** The settings record id for an operator scheme. */
export const colorSchemeSettingId = (key: string) => `${SCHEME_SETTING_PREFIX}${key}`;

/**
 * Operator schemes are stored as `fiber.scheme.<key>` with the value "Name | Colour, Colour, ...",
 * typed by the office from the drum sheet. Records that do not parse are ignored.
 */
export function parseColorSchemeSetting(id: string, value: unknown, source?: string): ColorScheme | null {
  if (!id.startsWith(SCHEME_SETTING_PREFIX) || typeof value !== 'string') return null;
  const key = id.slice(SCHEME_SETTING_PREFIX.length).trim();
  const [rawName, rawColors] = value.split('|');
  const colors = (rawColors ?? '')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
  if (!key || key === UNKNOWN_SCHEME_ID || colors.length < 2 || colors.length > 48) return null;
  return {
    id: key,
    name: rawName.trim() || key,
    colors,
    source: source?.trim() || 'Added by the operator. Source not recorded.',
    builtIn: false,
  };
}

export const formatColorSchemeSetting = (name: string, colors: readonly string[]) => `${name.trim()} | ${colors.join(', ')}`;

/** Built-in schemes plus the operator's, operator first so they can shadow nothing built in. */
export function resolveColorSchemes(settings: readonly { id: string; value: unknown; source?: string }[] = []): ColorScheme[] {
  const custom = settings
    .map((s) => parseColorSchemeSetting(s.id, s.value, s.source))
    .filter((s): s is ColorScheme => !!s && !BUILT_IN_COLOR_SCHEMES.some((b) => b.id === s.id));
  return [...BUILT_IN_COLOR_SCHEMES, ...custom];
}

export const DEFAULT_COLOR_SCHEMES: readonly ColorScheme[] = BUILT_IN_COLOR_SCHEMES;

export const findColorScheme = (id: string | undefined, schemes: readonly ColorScheme[] = DEFAULT_COLOR_SCHEMES) =>
  id ? schemes.find((s) => s.id === id) : undefined;

/** A colour from a known scheme, ready to draw. `repeat` > 0 means the sequence started again. */
export interface SchemeColor {
  name: string;
  hex: string;
  textColor: string;
  /** 0 for the first pass through the sequence, 1 for the second, and so on. */
  repeat: number;
  /** For a repeat: how the drum tells them apart is per maker (stripe, ring or binder). */
  repeatNote?: string;
}

export function schemeColorAt(scheme: ColorScheme | undefined, position: number): SchemeColor | undefined {
  if (!scheme || scheme.colors.length === 0 || !Number.isInteger(position) || position < 1) return undefined;
  const index = (position - 1) % scheme.colors.length;
  const repeat = Math.floor((position - 1) / scheme.colors.length);
  return {
    ...namedColor(scheme.colors[index]),
    repeat,
    repeatNote: repeat > 0 ? 'second set: check the stripe, ring or binder on the drum sheet' : undefined,
  };
}

/**
 * A colour a person wrote down (a tube colour from the drum sheet). Only the swatch is looked up;
 * a name with no swatch is drawn grey and still shown by its name.
 */
export function namedColor(name: string): SchemeColor {
  const key = name.toLowerCase().split(/\s+/)[0];
  return {
    name,
    hex: SWATCHES[key] ?? '#cbd5e1',
    textColor: DARK_TEXT.has(key) || !SWATCHES[key] ? '#1e293b' : '#ffffff',
    repeat: 0,
  };
}

/* ------------------------------------------------------------------ */
/* Identity                                                            */
/* ------------------------------------------------------------------ */

/** The parts of a cable that decide how its fibers are identified. All optional on older records. */
export interface FiberLayout {
  fiberCount: number;
  colorScheme?: string;
  tubeColorScheme?: string;
  fibersPerTube?: number;
  tubeCount?: number;
  /** Phase 7: tube records, for tubes of different sizes. They win over fibersPerTube. */
  tubes?: readonly TubeRecord[];
}

/** One recorded tube: its number, how many fibers it holds and, if written down, its colour. */
export interface TubeRecord {
  number: number;
  fiberCount: number;
  colorName?: string;
}

/** A tube with the cable-wide fiber numbers it holds. */
export interface TubeSpan extends TubeRecord {
  firstCore: number;
  lastCore: number;
}

/**
 * Why the recorded tubes cannot be used, in plain words, or undefined when they add up. Tube
 * numbers must run 1, 2, 3 ... with no gap or repeat, each tube must hold at least one fiber, and
 * the sizes must add up to the cable's fiber count.
 */
export function tubeRecordsProblem(layout: FiberLayout): string | undefined {
  const tubes = layout.tubes;
  if (!tubes || tubes.length === 0) return undefined;
  const numbers = tubes.map((t) => t.number).sort((a, b) => a - b);
  const gap = numbers.findIndex((n, i) => n !== i + 1);
  if (gap >= 0) {
    const repeated = numbers.find((n, i) => numbers.indexOf(n) !== i);
    return repeated !== undefined ? `tube ${repeated} is listed twice` : `the tubes should be numbered 1 to ${tubes.length}, but tube ${gap + 1} is missing`;
  }
  const empty = tubes.find((t) => !Number.isInteger(t.fiberCount) || t.fiberCount < 1);
  if (empty) return `tube ${empty.number} has no fibers`;
  const sum = tubes.reduce((total, t) => total + t.fiberCount, 0);
  if (sum !== layout.fiberCount) return `the tubes hold ${sum} fibers in all, but the cable has ${layout.fiberCount}`;
  if (layout.tubeCount !== undefined && layout.tubeCount !== tubes.length) return `${tubes.length} tubes are listed, but the tube count says ${layout.tubeCount}`;
  if (layout.fibersPerTube !== undefined && tubes.some((t) => t.fiberCount !== layout.fibersPerTube)) {
    return `the tubes are of different sizes, but fibers per tube says ${layout.fibersPerTube}`;
  }
  return undefined;
}

/**
 * The cable's tubes, from tube records when present, otherwise from fibersPerTube. Undefined when
 * the tubes are not recorded or do not add up: then no tube is given, never a guess.
 */
export function tubeSpans(layout: FiberLayout): TubeSpan[] | undefined {
  let records: readonly TubeRecord[] | undefined;
  if (layout.tubes && layout.tubes.length > 0) {
    if (tubeRecordsProblem(layout)) return undefined;
    records = [...layout.tubes].sort((a, b) => a.number - b.number);
  } else {
    const fpt = usableFibersPerTube(layout);
    if (!fpt) return undefined;
    records = Array.from({ length: layout.fiberCount / fpt }, (_, i) => ({ number: i + 1, fiberCount: fpt }));
  }
  let next = 1;
  return records.map((t) => {
    const span: TubeSpan = { ...t, firstCore: next, lastCore: next + t.fiberCount - 1 };
    next += t.fiberCount;
    return span;
  });
}

export interface CoreIdentity {
  /** Cable-wide fiber number: the identity. */
  coreNumber: number;
  /** Absent when fibers per tube is not recorded. */
  tubeNumber?: number;
  fiberInTube?: number;
  fiberColor?: SchemeColor;
  tubeColor?: SchemeColor;
  schemeKnown: boolean;
  tubeSchemeKnown: boolean;
  layoutKnown: boolean;
  /** Whether this fiber number exists on the cable. */
  exists: boolean;
  /** "Fiber 13: tube 2 Orange, fiber 1 Blue" or "Fiber 13 (colour not known)". */
  label: string;
  /** "F13 T2/1". */
  shortLabel: string;
}

export const UNKNOWN_COLOR_MESSAGE = 'Colour not known. Blue may not be fiber 1. Check the drum.';

/** Fibers per tube recorded and consistent with the count; otherwise no tube is given. */
export function usableFibersPerTube(layout: FiberLayout): number | undefined {
  const fpt = layout.fibersPerTube;
  if (!fpt || !Number.isInteger(fpt) || fpt < 1 || layout.fiberCount < 1) return undefined;
  if (layout.fiberCount % fpt !== 0) return undefined;
  if (layout.tubeCount !== undefined && layout.tubeCount * fpt !== layout.fiberCount) return undefined;
  return fpt;
}

/** Cable-wide number from tube and fiber: `(tube - 1) x fibers per tube + fiber`. */
export const coreNumberFromTube = (tube: number, fiber: number, fibersPerTube: number) => (tube - 1) * fibersPerTube + fiber;

export function coreIdentity(
  layout: FiberLayout,
  coreNumber: number,
  schemes: readonly ColorScheme[] = DEFAULT_COLOR_SCHEMES,
): CoreIdentity {
  const exists = Number.isInteger(coreNumber) && coreNumber >= 1 && coreNumber <= layout.fiberCount;
  const spans = tubeSpans(layout);
  const tube = exists ? spans?.find((t) => coreNumber >= t.firstCore && coreNumber <= t.lastCore) : undefined;
  const tubeNumber = tube?.number;
  const fiberInTube = tube ? coreNumber - tube.firstCore + 1 : undefined;
  const scheme = findColorScheme(layout.colorScheme, schemes);
  const tubeScheme = findColorScheme(layout.tubeColorScheme, schemes);
  const schemeKnown = !!scheme && scheme.colors.length > 0;
  const tubeSchemeKnown = !!tubeScheme && tubeScheme.colors.length > 0;
  // With no tube layout the position in the colour sequence is not known (a single-tube cable is
  // itself a recorded layout), so no colour is given.
  const position = fiberInTube;
  const fiberColor = schemeKnown && position !== undefined ? schemeColorAt(scheme, position) : undefined;
  // A tube colour written on the tube record is what the drum sheet says; otherwise the tube scheme.
  const tubeColor = tube?.colorName ? namedColor(tube.colorName) : tubeSchemeKnown && tubeNumber !== undefined ? schemeColorAt(tubeScheme, tubeNumber) : undefined;

  const parts: string[] = [];
  if (tubeNumber !== undefined) parts.push(`tube ${tubeNumber}${tubeColor ? ` ${tubeColor.name}` : ''}`);
  if (fiberInTube !== undefined) parts.push(`fiber ${fiberInTube}${fiberColor ? ` ${fiberColor.name}` : ''}`);
  else if (fiberColor) parts.push(fiberColor.name);
  const colourText = fiberColor
    ? fiberColor.repeat > 0
      ? ` (${fiberColor.repeatNote})`
      : ''
    : ' (colour not known)';
  const label = !exists
    ? `Fiber ${coreNumber} (not on this cable)`
    : `Fiber ${coreNumber}${parts.length ? `: ${parts.join(', ')}` : ''}${colourText}`;
  const shortLabel = `F${coreNumber}${tubeNumber !== undefined ? ` T${tubeNumber}/${fiberInTube}` : ''}`;
  return {
    coreNumber,
    tubeNumber,
    fiberInTube,
    fiberColor,
    tubeColor,
    schemeKnown,
    tubeSchemeKnown,
    layoutKnown: spans !== undefined,
    exists,
    label,
    shortLabel,
  };
}
