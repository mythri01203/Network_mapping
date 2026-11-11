import { API_PREFIX } from '../model/api';
import type { EquipmentCategory, LocationMethod, PoleMaterial, PoleOwnerType } from '../model/enums';
import type { Customer, Equipment, Fault, LatLng, Setting } from '../model/types';
import { type CommandResult, fail, type NetworkData, notice, succeed } from './command';
import { isValidCoordinate } from './defaults';
import { DEFAULT_OPTICAL_SETTINGS, type OpticalSettings, rxBandFor } from './opticalSettings';
import { fieldSequenceSpan, ospCascadeForEquipment } from './outsidePlant';
import { formatTimestamp } from './time';

/**
 * Rules for the simple phone capture flow: IDs, GPS decisions, the "same one?" check, the dBm pad
 * and the records a capture creates. Limits are proposals from `fibergis-osp-mapping` and live in the
 * `settings` collection, so the operator can change them without a code change.
 */

/* ------------------------------------------------------------------ */
/* IDs                                                                 */
/* ------------------------------------------------------------------ */

/** Crockford base32: no I, L, O or U, so a code read aloud or copied by hand is not confused. */
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** 10 characters carry 50 random bits: about one clash in 20 billion pairs. */
export const CAPTURE_CODE_LENGTH = 10;

export type RandomBytes = (bytes: Uint8Array) => Uint8Array;

/** Web Crypto, present in every supported browser and in Node 22. The shared package has no DOM types. */
const webCrypto = (globalThis as unknown as { crypto?: { getRandomValues: RandomBytes } }).crypto;

const defaultRandom: RandomBytes = (bytes) => {
  if (!webCrypto) throw new Error('Secure random numbers are not available on this device.');
  return webCrypto.getRandomValues(bytes);
};

/** A random code from the Crockford alphabet. 256 is a multiple of 32, so every letter is equally likely. */
export function randomCode(length = CAPTURE_CODE_LENGTH, random: RandomBytes = defaultRandom): string {
  const bytes = random(new Uint8Array(length));
  let code = '';
  for (let i = 0; i < length; i += 1) code += CODE_ALPHABET[bytes[i] & 31];
  return code;
}

export type CaptureKind = 'pole' | 'box' | 'drop' | 'light' | 'danger';

const ID_PREFIX: Record<CaptureKind | 'photo' | 'run', string> = {
  pole: 'POLE',
  box: 'BOX',
  drop: 'DROP',
  light: 'RX',
  danger: 'HAZ',
  photo: 'PH',
  run: 'RUN',
};

/**
 * The record's permanent ID, made when the capture starts. Two phones working offline cannot make
 * the same one, unlike the sequential "POLE-07" style, and saving it twice finds the same record.
 */
export const newCaptureId = (kind: CaptureKind | 'photo' | 'run', random?: RandomBytes): string =>
  `${ID_PREFIX[kind]}-${randomCode(CAPTURE_CODE_LENGTH, random)}`;

const CAPTURE_ID = /^[A-Z]{2,4}-[0-9A-HJKMNP-TV-Z]{10}$/;
export const isCaptureId = (value: string): boolean => CAPTURE_ID.test(value);

/** Where the server keeps a photo. Records store this, never the picture itself. */
export const photoUrl = (photoId: string): string => `${API_PREFIX}/photos/${encodeURIComponent(photoId)}`;

/** Photo ids accepted by the server: short, URL-safe, and never a path. */
export const PHOTO_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{5,63}$/;

/**
 * Next free human name such as "Pole-08". Names are for people and may repeat across offline
 * phones; the ID is what keeps records apart.
 */
export function nextDisplayName(prefix: string, existing: readonly { name: string }[]): string {
  const pattern = new RegExp(`^${prefix}-(\\d+)$`);
  let highest = 0;
  for (const { name } of existing) {
    const match = pattern.exec(name);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `${prefix}-${String(highest + 1).padStart(2, '0')}`;
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

export interface GpsLimits {
  /** At or under this the point is accepted: the green tick. */
  acceptMeters: number;
  /** Over accept and up to this, the point is kept but the office is asked to check it. */
  warnMeters: number;
  /** Readings averaged before the tick shows. */
  minSamples: number;
  /** Stop averaging after this long if at least one good reading came in. */
  maxAverageSeconds: number;
  /** After this long without a good reading, say "Go to open sky" and allow saving for the office to place. */
  waitSeconds: number;
}

export interface FieldCaptureSettings {
  gps: GpsLimits;
  duplicate: { factor: number; marginMeters: number };
  rx: { decimals: number; plausibleHighDbm: number; plausibleLowDbm: number };
  /** Empty when not set: the call button is hidden. */
  supervisorPhone: string;
}

export interface FieldSettingDef {
  id: string;
  label: string;
  unit: 'm' | 's' | 'readings' | 'x' | 'digits' | 'dBm' | 'phone';
  defaultValue: number | string;
  source: string;
  /** Returns a reason when the value is impossible, else null. */
  check?: (value: number | string) => string | null;
  apply: (settings: FieldCaptureSettings, value: number | string) => void;
}

const OSP = 'Proposed in fibergis-osp-mapping. Phones reach about 5 m at best under open sky.';
const positive = (value: number | string) => (typeof value === 'number' && value > 0 ? null : 'Enter a number above 0.');
const num = (v: number | string) => Number(v);

/** Every editable capture value, with its default and where the default comes from. */
export const FIELD_SETTING_DEFS: readonly FieldSettingDef[] = [
  { id: 'field.gps.acceptMeters', label: 'GPS accepted within', unit: 'm', defaultValue: 5, source: OSP, check: positive, apply: (s, v) => { s.gps.acceptMeters = num(v); } },
  { id: 'field.gps.warnMeters', label: 'GPS kept but checked by office within', unit: 'm', defaultValue: 10, source: OSP, check: positive, apply: (s, v) => { s.gps.warnMeters = num(v); } },
  { id: 'field.gps.minSamples', label: 'GPS readings to average', unit: 'readings', defaultValue: 5, source: 'Proposed. Averaging mainly removes jitter.', check: positive, apply: (s, v) => { s.gps.minSamples = Math.max(1, Math.round(num(v))); } },
  { id: 'field.gps.maxAverageSeconds', label: 'Stop averaging after', unit: 's', defaultValue: 10, source: 'Proposed.', check: positive, apply: (s, v) => { s.gps.maxAverageSeconds = num(v); } },
  { id: 'field.gps.waitSeconds', label: 'Wait for GPS before offering "office will place it"', unit: 's', defaultValue: 30, source: 'Proposed. Test on your streets.', check: positive, apply: (s, v) => { s.gps.waitSeconds = num(v); } },
  { id: 'field.duplicate.factor', label: '"Same one?" search: times GPS accuracy', unit: 'x', defaultValue: 1.5, source: 'Proposed in fibergis-osp-mapping.', check: positive, apply: (s, v) => { s.duplicate.factor = num(v); } },
  { id: 'field.duplicate.marginMeters', label: '"Same one?" search: extra margin', unit: 'm', defaultValue: 5, source: 'Proposed.', check: (v) => (typeof v === 'number' && v >= 0 ? null : 'Enter 0 or more.'), apply: (s, v) => { s.duplicate.marginMeters = num(v); } },
  { id: 'field.rx.decimals', label: 'Light meter: numbers after the dot', unit: 'digits', defaultValue: 2, source: 'Set to match your meters. Most show two.', check: (v) => (v === 1 || v === 2 ? null : 'Use 1 or 2.'), apply: (s, v) => { s.rx.decimals = num(v); } },
  { id: 'field.rx.plausibleHighDbm', label: 'Light reading: ask to check the number above', unit: 'dBm', defaultValue: -3, source: 'Proposed. An ONT reading this strong is almost always a typing slip.', apply: (s, v) => { s.rx.plausibleHighDbm = num(v); } },
  { id: 'field.rx.plausibleLowDbm', label: 'Light reading: ask to check the number below', unit: 'dBm', defaultValue: -40, source: 'Proposed. Far below any working receiver.', apply: (s, v) => { s.rx.plausibleLowDbm = num(v); } },
  {
    id: 'field.supervisorPhone',
    label: 'Supervisor phone for the "Call supervisor" button',
    unit: 'phone',
    defaultValue: '',
    source: 'Hidden until set.',
    check: (v) => (typeof v === 'string' && (v === '' || /^\+?[0-9][0-9 -]{5,19}$/.test(v)) ? null : 'Use digits, spaces, dashes and an optional + only.'),
    apply: (s, v) => { s.supervisorPhone = String(v); },
  },
];

const fieldDefaults = (): FieldCaptureSettings => ({
  gps: { acceptMeters: 0, warnMeters: 0, minSamples: 1, maxAverageSeconds: 0, waitSeconds: 0 },
  duplicate: { factor: 0, marginMeters: 0 },
  rx: { decimals: 2, plausibleHighDbm: 0, plausibleLowDbm: 0 },
  supervisorPhone: '',
});

/** Defaults with the operator's valid overrides applied. Wrong types and impossible values are ignored. */
export function resolveFieldSettings(overrides: readonly Pick<Setting, 'id' | 'value'>[] = []): FieldCaptureSettings {
  const byId = new Map(overrides.map((o) => [o.id, o.value]));
  const settings = fieldDefaults();
  for (const def of FIELD_SETTING_DEFS) {
    const value = byId.get(def.id);
    const typeOk = value !== undefined && typeof value === typeof def.defaultValue && !(typeof value === 'number' && !Number.isFinite(value));
    const usable = typeOk && !def.check?.(value as number | string);
    def.apply(settings, usable ? (value as number | string) : def.defaultValue);
  }
  if (settings.gps.warnMeters < settings.gps.acceptMeters) settings.gps.warnMeters = settings.gps.acceptMeters;
  return settings;
}

export const DEFAULT_FIELD_SETTINGS: FieldCaptureSettings = resolveFieldSettings();

/* ------------------------------------------------------------------ */
/* GPS                                                                 */
/* ------------------------------------------------------------------ */

export interface GpsSample {
  lat: number;
  lng: number;
  /** Browser accuracy in metres: a 68% radius per W3C. */
  accuracy: number;
  /** Epoch ms of the reading. */
  at: number;
}

export interface GpsFixResult {
  lat: number;
  lng: number;
  /** Median accuracy of the readings used. Averaging is not credited with more precision. */
  accuracyMeters: number;
  sampleCount: number;
  method: Extract<LocationMethod, 'gps' | 'gps_averaged'>;
  capturedAt: string;
}

/**
 * - `searching`: still waiting; show progress.
 * - `good`: within the accept limit; the green tick.
 * - `rough`: only within the warn limit after waiting; kept, and the office checks it.
 * - `no_fix`: nothing usable after waiting; say "Go to open sky" and allow saving for the office to place.
 */
export type GpsState = 'searching' | 'good' | 'rough' | 'no_fix';

export interface GpsDecision {
  state: GpsState;
  fix?: GpsFixResult;
  /** Smallest accuracy seen so far, usable or not. */
  bestAccuracy?: number;
  /** 0 to 1, for the progress ring. Never shown as a number of metres. */
  progress: number;
}

export const isUsableSample = (s: GpsSample): boolean =>
  isValidCoordinate(s.lat, s.lng) && Number.isFinite(s.accuracy) && s.accuracy >= 0 && Number.isFinite(s.at);

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** Inverse-variance weighted mean of the readings. Reported accuracy is their median, floored at 1 m. */
export function averageSamples(samples: readonly GpsSample[]): GpsFixResult | undefined {
  const usable = samples.filter(isUsableSample);
  if (usable.length === 0) return undefined;
  let wSum = 0;
  let lat = 0;
  let lng = 0;
  for (const s of usable) {
    const w = 1 / Math.max(1, s.accuracy) ** 2;
    wSum += w;
    lat += s.lat * w;
    lng += s.lng * w;
  }
  const last = Math.max(...usable.map((s) => s.at));
  return {
    lat: lat / wSum,
    lng: lng / wSum,
    accuracyMeters: Math.max(1, Math.round(median(usable.map((s) => s.accuracy)) * 10) / 10),
    sampleCount: usable.length,
    method: usable.length > 1 ? 'gps_averaged' : 'gps',
    capturedAt: new Date(last).toISOString(),
  };
}

/** What to show and store, given the readings so far and how long the phone has been trying. */
export function decideGps(
  samples: readonly GpsSample[],
  elapsedMs: number,
  limits: GpsLimits = DEFAULT_FIELD_SETTINGS.gps,
): GpsDecision {
  const usable = samples.filter(isUsableSample);
  const bestAccuracy = usable.length ? Math.min(...usable.map((s) => s.accuracy)) : undefined;
  const good = usable.filter((s) => s.accuracy <= limits.acceptMeters);
  const elapsedS = elapsedMs / 1000;
  // A phone whose latest reading is poor no longer sees the sky well, or its first answer was a
  // stale cached one. A few earlier good readings are then not enough for the tick.
  const latestPoor = (usable.at(-1)?.accuracy ?? 0) > limits.warnMeters;
  const enoughGood = good.length >= limits.minSamples || (good.length > 0 && !latestPoor);

  if (good.length >= limits.minSamples || (enoughGood && elapsedS >= limits.maxAverageSeconds)) {
    return { state: 'good', fix: averageSamples(good), bestAccuracy, progress: 1 };
  }
  if (elapsedS >= limits.waitSeconds) {
    if (enoughGood) return { state: 'good', fix: averageSamples(good), bestAccuracy, progress: 1 };
    if (latestPoor) return { state: 'no_fix', bestAccuracy, progress: 1 };
    const fair = usable.filter((s) => s.accuracy <= limits.warnMeters);
    if (fair.length > 0) return { state: 'rough', fix: averageSamples(fair), bestAccuracy, progress: 1 };
    return { state: 'no_fix', bestAccuracy, progress: 1 };
  }
  const bySamples = good.length / limits.minSamples;
  const byTime = good.length > 0 ? elapsedS / limits.maxAverageSeconds : elapsedS / limits.waitSeconds;
  return { state: 'searching', bestAccuracy, progress: Math.min(0.95, Math.max(bySamples, byTime)) };
}

/** Where a capture is stored on the map, and how much to trust it. */
export interface CaptureLocation {
  lat: number;
  lng: number;
  method: LocationMethod;
  accuracyMeters?: number;
  sampleCount?: number;
  capturedAt?: string;
  officeMustPlace: boolean;
}

/**
 * Turns the GPS outcome into a stored position. With no usable fix, the best poor reading is kept as
 * a GPS point with its real accuracy, flagged for the office. With no reading at all, the placeholder
 * (the previous capture or the network anchor) is stored as `not_placed`, never as accurate.
 */
export function captureLocation(
  decision: GpsDecision,
  samples: readonly GpsSample[],
  placeholder: LatLng | undefined,
): CaptureLocation | null {
  if ((decision.state === 'good' || decision.state === 'rough') && decision.fix) {
    const { lat, lng, method, accuracyMeters, sampleCount, capturedAt } = decision.fix;
    return { lat, lng, method, accuracyMeters, sampleCount, capturedAt, officeMustPlace: false };
  }
  const usable = samples.filter(isUsableSample);
  if (usable.length > 0) {
    const best = usable.reduce((a, b) => (b.accuracy < a.accuracy ? b : a));
    return {
      lat: best.lat,
      lng: best.lng,
      method: 'gps',
      accuracyMeters: Math.max(1, Math.round(best.accuracy)),
      sampleCount: 1,
      capturedAt: new Date(best.at).toISOString(),
      officeMustPlace: true,
    };
  }
  if (!placeholder || !isValidCoordinate(placeholder[0], placeholder[1])) return null;
  return { lat: placeholder[0], lng: placeholder[1], method: 'not_placed', officeMustPlace: true };
}

/* ------------------------------------------------------------------ */
/* "Same one?" check                                                   */
/* ------------------------------------------------------------------ */

export type CaptureAssetGroup = 'pole' | 'box' | 'drop';

/** Which "same one?" group an equipment type belongs to, or null when the check does not apply. */
export function assetGroupOf(type: string): CaptureAssetGroup | null {
  if (type === 'Building Entry Point') return 'drop';
  if (/Terminal Box|Closure|^FAT$|^FDT$|Distribution Point|Outdoor Splitter|Tap-Off|^Box\b/i.test(type)) return 'box';
  if (/Pole/i.test(type)) return 'pole';
  return null;
}

const EARTH_RADIUS_M = 6371e3;
export function distanceMeters(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dPhi = toRad(b[0] - a[0]);
  const dLambda = toRad(b[1] - a[1]);
  const h = Math.sin(dPhi / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLambda / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export const duplicateRadiusMeters = (accuracyMeters: number, settings: FieldCaptureSettings['duplicate']): number =>
  settings.factor * Math.max(0, accuracyMeters) + settings.marginMeters;

export interface NearbyAsset {
  equipment: Equipment;
  distanceMeters: number;
}

/**
 * Same-group assets within 1.5 × accuracy plus a margin (both settings), nearest first, at most
 * `limit`. A point the office has not placed is skipped, since its position means nothing. A
 * capture the office rejected (Phase 19) is skipped too; one still awaiting review counts, since
 * another worker may have captured the same pole.
 */
export function findNearbySameType(
  equipment: readonly Equipment[],
  group: CaptureAssetGroup,
  point: LatLng,
  accuracyMeters: number,
  settings: FieldCaptureSettings['duplicate'] = DEFAULT_FIELD_SETTINGS.duplicate,
  limit = 3,
): NearbyAsset[] {
  const radius = duplicateRadiusMeters(accuracyMeters, settings);
  return equipment
    .filter((e) => assetGroupOf(e.type) === group && !e.officeMustPlace && e.locationMethod !== 'not_placed' && e.reviewStatus !== 'rejected')
    .map((e) => ({ equipment: e, distanceMeters: distanceMeters(point, [e.lat, e.lng]) }))
    .filter((n) => n.distanceMeters <= radius)
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, limit);
}

/** The record a scanned tag belongs to. Tags are compared without case or surrounding spaces. */
export function findByTag<T extends { tagCode?: string }>(records: readonly T[], tag: string): T | undefined {
  const wanted = normalizeTag(tag);
  if (!wanted) return undefined;
  return records.find((r) => r.tagCode !== undefined && normalizeTag(r.tagCode) === wanted);
}

/** A scanned tag as stored: trimmed, upper case, at most 64 characters. A URL keeps its last part. */
export function normalizeTag(raw: string): string {
  let text = raw.trim();
  if (/^https?:\/\//i.test(text)) {
    const parts = text.replace(/[?#].*$/, '').split('/').filter(Boolean);
    text = parts.at(-1) ?? '';
  }
  return text.toUpperCase().slice(0, 64);
}

/* ------------------------------------------------------------------ */
/* dBm number pad                                                      */
/* ------------------------------------------------------------------ */

export type PadKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'back' | 'clear';

export const RX_PAD_MAX_DIGITS = 4;

/**
 * The digits typed so far. The worker types only the digits shown on the meter, never the minus
 * sign, the dot or the unit; leading zeros are dropped and the length is capped.
 */
export function pressPadKey(digits: string, key: PadKey, maxDigits = RX_PAD_MAX_DIGITS): string {
  if (key === 'clear') return '';
  if (key === 'back') return digits.slice(0, -1);
  if (digits.length >= maxDigits) return digits;
  if (digits === '' && key === '0') return digits;
  return digits + key;
}

/** The reading the digits stand for: always negative, with a fixed number of decimals. "1852" → -18.52. */
export function padValueDbm(digits: string, decimals: number): number | undefined {
  if (!/^\d+$/.test(digits)) return undefined;
  const value = Number(digits) / 10 ** decimals;
  return value === 0 ? undefined : -value;
}

/** Ready to show, with a real minus sign: "1852" → "−18.52". Empty digits show placeholders. */
export function formatPadValue(digits: string, decimals: number): string {
  const value = padValueDbm(digits, decimals);
  if (value === undefined) return `−__.${'_'.repeat(decimals)}`;
  return `−${Math.abs(value).toFixed(decimals)}`;
}

export type RxEntryCheck = 'ok' | 'low_margin' | 'too_much_light' | 'too_weak' | 'check_number';

/** Range check for a typed reading. Never blocks saving; the meter photo is the proof. */
export function checkRxEntry(
  valueDbm: number,
  field: FieldCaptureSettings['rx'] = DEFAULT_FIELD_SETTINGS.rx,
  optical: OpticalSettings = DEFAULT_OPTICAL_SETTINGS,
): RxEntryCheck {
  if (valueDbm > field.plausibleHighDbm || valueDbm < field.plausibleLowDbm) return 'check_number';
  switch (rxBandFor(valueDbm, optical)) {
    case 'too_much_light':
      return 'too_much_light';
    case 'bad':
      return 'too_weak';
    case 'low_margin':
      return 'low_margin';
    default:
      return 'ok';
  }
}

/* ------------------------------------------------------------------ */
/* Records                                                             */
/* ------------------------------------------------------------------ */

export type BoxKind = 'street_box' | 'joint_box' | 'unknown';

interface CapturedBase {
  id: string;
  name: string;
  photoId: string;
  location: CaptureLocation;
  now: Date;
  capturedBy: string;
  tagCode?: string;
  previousAssetId?: string;
  runId?: string;
  order?: number;
}

export type CapturedEquipmentInput =
  | (CapturedBase & { kind: 'pole'; ownerType: PoleOwnerType; material: PoleMaterial })
  | (CapturedBase & { kind: 'box'; boxKind: BoxKind })
  | (CapturedBase & { kind: 'drop'; customerId?: string });

/** Equipment type for each answer. An owner or kind nobody knows gets a plain type, never a guess. */
export function capturedEquipmentType(input: CapturedEquipmentInput): { type: string; category: EquipmentCategory } {
  switch (input.kind) {
    case 'pole':
      return {
        type: input.ownerType === 'electricity' ? 'Electric Pole' : input.ownerType === 'telecom' ? 'Telecom Pole' : 'Pole',
        category: 'Supporting Infrastructure',
      };
    case 'box':
      return {
        type: input.boxKind === 'street_box' ? 'FAT' : input.boxKind === 'joint_box' ? 'Fiber Joint Closure' : 'Box (kind not known)',
        category: 'Fiber Distribution',
      };
    case 'drop':
      return { type: 'Building Entry Point', category: 'Supporting Infrastructure' };
  }
}

const locationFields = (location: CaptureLocation) => ({
  lat: location.lat,
  lng: location.lng,
  locationMethod: location.method,
  ...(location.accuracyMeters !== undefined ? { locationAccuracyMeters: location.accuracyMeters } : {}),
  ...(location.sampleCount !== undefined ? { locationSampleCount: location.sampleCount } : {}),
  ...(location.capturedAt ? { locationCapturedAt: location.capturedAt } : {}),
  ...(location.officeMustPlace ? { officeMustPlace: true } : {}),
});

/**
 * The equipment record a capture creates. Facts the worker did not give stay empty: no installed
 * date, no ports, no maker, no street. Phase 19: it goes in as a proposal, `awaiting_review` with
 * status Planned (not yet part of the working network), and waits in the office review queue.
 * Accepting it makes it Active, as captures were before, because the item was seen standing there.
 */
export function buildCapturedEquipment(input: CapturedEquipmentInput): Equipment {
  const { type, category } = capturedEquipmentType(input);
  const uploadDate = input.now.toISOString();
  return {
    id: input.id,
    name: input.name,
    type: type as Equipment['type'],
    category,
    ...locationFields(input.location),
    area: '',
    street: '',
    status: 'Planned',
    reviewStatus: 'awaiting_review',
    images: [
      {
        id: input.photoId,
        equipmentId: input.id,
        url: photoUrl(input.photoId),
        name: 'Field photo',
        category: input.kind === 'pole' ? 'Pole/Mount' : 'Front View',
        uploadDate,
        uploadedBy: input.capturedBy,
        description: 'Taken by the phone capture flow.',
        annotations: [],
      },
    ],
    photoIds: [input.photoId],
    captureSource: 'field_capture',
    installedDate: '',
    notes: 'Added with phone capture.',
    ...(input.tagCode ? { tagCode: input.tagCode } : {}),
    ...(input.previousAssetId ? { previousAssetId: input.previousAssetId } : {}),
    ...(input.runId ? { captureRunId: input.runId } : {}),
    ...(input.order !== undefined ? { captureOrder: input.order } : {}),
    ...(input.kind === 'pole' ? { ownerType: input.ownerType, material: input.material } : {}),
    ...(input.kind === 'drop' && input.customerId ? { customerId: input.customerId } : {}),
  };
}

export interface HazardInput {
  id: string;
  photoId: string;
  location: CaptureLocation;
  now: Date;
  capturedBy: string;
}

/**
 * A danger report: a Safety Hazard fault marked unsafe, with the photo and an honest position. It is
 * marked `source: 'field_report'`, so the alarm grouping (`correlateAlarms`) lists it as evidence.
 */
export function buildHazardFault(input: HazardInput): Fault {
  const { lat, lng, ...rest } = locationFields(input.location);
  return {
    id: input.id,
    title: 'Danger reported from the field',
    type: 'Safety Hazard',
    severity: 'Critical',
    status: 'Reported',
    source: 'field_report',
    affectedLocation: { lat, lng },
    affectedCustomerIds: [],
    affectedCores: [],
    affectedSplitterPorts: [],
    description: `Reported with phone capture by ${input.capturedBy}. Look at the photo before sending anyone. ${
      input.location.officeMustPlace ? 'No GPS fix: the office must place this.' : ''
    }`.trim(),
    reportedAt: formatTimestamp(input.now),
    images: [photoUrl(input.photoId)],
    photoIds: [input.photoId],
    unsafe: true,
    captureSource: 'field_capture',
    ...rest,
  };
}

/** True when a stored record is the one this capture made, so saving again must change nothing. */
const isSameCapture = (existing: { captureSource?: string; photoIds?: string[] }, record: { photoIds?: string[] }) =>
  existing.captureSource === 'field_capture' && existing.photoIds?.[0] !== undefined && existing.photoIds[0] === record.photoIds?.[0];

/**
 * Adds a captured asset. Saving the same capture again does nothing; a different record with the ID
 * is refused. A pole captured with "Next pole" also gets a proposed span from the previous pole:
 * order only, dashed on the map, until the office confirms it. It never claims a cable.
 */
export function addCapturedEquipment(data: NetworkData, record: Equipment, now: Date = new Date()): CommandResult<{ created: boolean; spanId?: string }> {
  const existing = data.equipment.find((e) => e.id === record.id);
  if (existing) {
    if (isSameCapture(existing, record)) return succeed({ created: false }, {});
    return fail('ID clash', `Another record already uses ${record.id}. Nothing was changed.`);
  }
  if (!isValidCoordinate(record.lat, record.lng)) return fail('No position', 'This capture has no position to store.');
  const span = fieldSequenceSpan(data, record, now, record.images[0]?.uploadedBy);
  return succeed(
    { created: true, ...(span ? { spanId: span.id } : {}) },
    { equipment: [...data.equipment, record], ...(span ? { spans: [...(data.spans ?? []), span] } : {}) },
    {
      notice: notice('success', 'Saved', `${record.name} was added from the field.`),
      audit: [
        {
          action: 'FIELD_CAPTURE_ADDED',
          details: `${record.type} ${record.name} (${record.id}) by phone capture, ${
            record.officeMustPlace ? 'office must place it' : `${record.locationMethod ?? 'gps'}${record.locationAccuracyMeters !== undefined ? ` within about ${Math.round(record.locationAccuracyMeters)} m` : ''}`
          }${record.previousAssetId ? `, captured after ${record.previousAssetId} (order only${span ? `; proposed span ${span.id} for the office to confirm` : ''})` : ''}${
            record.reviewStatus === 'awaiting_review' ? '; waits for office review' : ''
          }`,
          assetId: record.id,
          assetType: 'Equipment',
        },
      ],
    },
  );
}

export function addCapturedFault(data: NetworkData, fault: Fault): CommandResult<{ created: boolean }> {
  const existing = data.faults.find((f) => f.id === fault.id);
  if (existing) {
    if (isSameCapture(existing, fault)) return succeed({ created: false }, {});
    return fail('ID clash', `Another record already uses ${fault.id}. Nothing was changed.`);
  }
  return succeed(
    { created: true },
    { faults: [fault, ...data.faults] },
    {
      notice: notice('warning', 'Danger reported', 'The office has been told.'),
      audit: [
        {
          action: 'FIELD_HAZARD_REPORTED',
          details: `Danger reported by phone capture (${fault.id})${fault.officeMustPlace ? ', no GPS fix' : ''}`,
          assetId: fault.id,
          assetType: 'Fault',
        },
      ],
    },
  );
}

/** Removes one capture again ("Undo" after saving). Missing records are already gone, which is fine. */
export function removeCapturedRecord(
  data: NetworkData,
  collection: 'equipment' | 'faults',
  id: string,
): CommandResult<{ removed: boolean }> {
  const list = data[collection] as readonly { id: string; captureSource?: string; reviewStatus?: string }[];
  const record = list.find((r) => r.id === id);
  if (!record) return succeed({ removed: false }, {});
  if (record.captureSource !== 'field_capture') return fail('Not a field capture', `${id} was not added from the phone.`);
  // Phase 19: once the office has accepted or rejected it, the record is the office's to change.
  if (record.reviewStatus === 'accepted' || record.reviewStatus === 'rejected') {
    return fail('Already checked by the office', `The office has already checked ${id}, so it was kept. Call the office if it is wrong.`);
  }
  const kept = list.filter((r) => r.id !== id);
  // Spans and records that name the pole go with it, so nothing is left pointing to nothing.
  const cascade = collection === 'equipment' ? ospCascadeForEquipment(data, id).patch : {};
  return succeed(
    { removed: true },
    collection === 'equipment' ? { ...cascade, equipment: kept as Equipment[] } : { faults: kept as Fault[] },
    {
      notice: notice('info', 'Removed', `${id} was removed.`),
      audit: [
        {
          action: 'FIELD_CAPTURE_UNDONE',
          details: `Field capture ${id} removed by the worker with Undo`,
          assetId: id,
          assetType: collection === 'equipment' ? 'Equipment' : 'Fault',
        },
      ],
    },
  );
}

/** The reading fields a field measurement replaces, kept so Undo can put them back. */
export type RxFields = Pick<Customer, 'rxOpticalPowerDbm' | 'rxSource' | 'rxMeasuredAt' | 'rxLaunchDbm' | 'rxPhotoId' | 'rxCaptureId'>;

export const rxFieldsOf = (c: Customer): RxFields => ({
  rxOpticalPowerDbm: c.rxOpticalPowerDbm,
  rxSource: c.rxSource,
  rxMeasuredAt: c.rxMeasuredAt,
  rxLaunchDbm: c.rxLaunchDbm,
  rxPhotoId: c.rxPhotoId,
  rxCaptureId: c.rxCaptureId,
});

const withRxFields = (c: Customer, fields: RxFields): Customer => {
  const next: Customer = { ...c, ...fields };
  for (const key of Object.keys(fields) as (keyof RxFields)[]) if (fields[key] === undefined) delete next[key];
  return next;
};

export interface FieldRxReading {
  customerId: string;
  captureId: string;
  valueDbm: number;
  measuredAt: string;
  photoId: string;
}

/** Stores a meter reading as field_measured. Saving the same capture twice changes nothing. */
export function recordFieldRxReading(data: NetworkData, reading: FieldRxReading): CommandResult<{ previous: RxFields; changed: boolean }> {
  const customer = data.customers.find((c) => c.id === reading.customerId);
  if (!customer) return fail('Customer missing', `Customer ${reading.customerId} was not found.`);
  if (!Number.isFinite(reading.valueDbm)) return fail('No reading', 'Type the number shown on the meter.');
  if (customer.rxCaptureId === reading.captureId) return succeed({ previous: rxFieldsOf(customer), changed: false }, {});
  const updated = withRxFields(customer, {
    rxOpticalPowerDbm: Math.round(reading.valueDbm * 100) / 100,
    rxSource: 'field_measured',
    rxMeasuredAt: reading.measuredAt,
    // Launch power belongs to a calculated reading; a meter reading has none.
    rxLaunchDbm: undefined,
    rxPhotoId: reading.photoId,
    rxCaptureId: reading.captureId,
  });
  return succeed(
    { previous: rxFieldsOf(customer), changed: true },
    { customers: data.customers.map((c) => (c.id === customer.id ? updated : c)) },
    {
      audit: [
        {
          action: 'FIELD_RX_MEASURED',
          details: `Light level ${updated.rxOpticalPowerDbm} dBm measured in the field for ${customer.name} (${customer.id}), meter photo ${reading.photoId}`,
          assetId: customer.id,
          assetType: 'Customer',
        },
      ],
    },
  );
}

/** Undo for a reading: puts the earlier values back, only if this capture's reading is still the current one. */
export function undoFieldRxReading(data: NetworkData, customerId: string, captureId: string, previous: RxFields): CommandResult<{ restored: boolean }> {
  const customer = data.customers.find((c) => c.id === customerId);
  if (!customer || customer.rxCaptureId !== captureId) return succeed({ restored: false }, {});
  const restored = withRxFields(customer, previous);
  return succeed(
    { restored: true },
    { customers: data.customers.map((c) => (c.id === customerId ? restored : c)) },
    {
      audit: [
        {
          action: 'FIELD_RX_UNDONE',
          details: `Field light reading ${captureId} removed by the worker with Undo for ${customer.id}`,
          assetId: customer.id,
          assetType: 'Customer',
        },
      ],
    },
  );
}

/* ------------------------------------------------------------------ */
/* Office follow-up                                                    */
/* ------------------------------------------------------------------ */

export type FollowUpReason = 'office_must_place' | 'rough_location';

export interface FollowUpItem {
  collection: 'equipment' | 'faults';
  id: string;
  name: string;
  type: string;
  reason: FollowUpReason;
  accuracyMeters?: number;
  capturedAt?: string;
  photoId?: string;
  lat: number;
  lng: number;
}

type Positioned = {
  captureSource?: string;
  officeMustPlace?: boolean;
  locationMethod?: LocationMethod;
  locationAccuracyMeters?: number;
  locationCheckedAt?: string;
  locationCapturedAt?: string;
  photoIds?: string[];
  reviewStatus?: string;
};

const followUpReason = (r: Positioned, limits: GpsLimits): FollowUpReason | null => {
  if (r.captureSource !== 'field_capture' || r.locationCheckedAt) return null;
  // Phase 19: a capture the office rejected is not placed or checked any more.
  if (r.reviewStatus === 'rejected') return null;
  if (r.officeMustPlace || r.locationMethod === 'not_placed') return 'office_must_place';
  if (r.locationMethod === 'map_pick') return null;
  if (r.locationAccuracyMeters === undefined || r.locationAccuracyMeters > limits.acceptMeters) return 'rough_location';
  return null;
};

/** Field captures the office must place or check, those with no position first. */
export function fieldFollowUps(data: Pick<NetworkData, 'equipment' | 'faults'>, limits: GpsLimits = DEFAULT_FIELD_SETTINGS.gps): FollowUpItem[] {
  const items: FollowUpItem[] = [];
  for (const e of data.equipment) {
    const reason = followUpReason(e, limits);
    if (reason) items.push({ collection: 'equipment', id: e.id, name: e.name, type: e.type, reason, accuracyMeters: e.locationAccuracyMeters, capturedAt: e.locationCapturedAt, photoId: e.photoIds?.[0], lat: e.lat, lng: e.lng });
  }
  for (const f of data.faults) {
    const reason = followUpReason(f, limits);
    if (reason) items.push({ collection: 'faults', id: f.id, name: f.title, type: f.type, reason, accuracyMeters: f.locationAccuracyMeters, capturedAt: f.locationCapturedAt, photoId: f.photoIds?.[0], lat: f.affectedLocation.lat, lng: f.affectedLocation.lng });
  }
  return items.sort((a, b) => (a.reason === b.reason ? 0 : a.reason === 'office_must_place' ? -1 : 1));
}

/** The office confirms a field position as good enough. Placing one on the map uses "Move this item". */
export function confirmFieldLocation(
  data: NetworkData,
  collection: 'equipment' | 'faults',
  id: string,
  by: string,
  now: Date = new Date(),
): CommandResult<{ confirmed: boolean }> {
  const list = data[collection] as readonly (Positioned & { id: string })[];
  const record = list.find((r) => r.id === id);
  if (!record) return fail('Not found', `${id} was not found.`);
  if (record.officeMustPlace || record.locationMethod === 'not_placed') {
    return fail('Place it first', 'This one has no real position yet. Show it on the map and use Move this item.', 'warning');
  }
  const updated = { ...record, locationCheckedAt: now.toISOString(), locationCheckedBy: by };
  const next = list.map((r) => (r.id === id ? updated : r));
  return succeed(
    { confirmed: true },
    collection === 'equipment' ? { equipment: next as Equipment[] } : { faults: next as Fault[] },
    {
      notice: notice('success', 'Position confirmed', `${id} no longer needs checking.`),
      audit: [{ action: 'FIELD_LOCATION_CONFIRMED', details: `Office confirmed the field position of ${id}`, assetId: id, assetType: collection === 'equipment' ? 'Equipment' : 'Fault' }],
    },
  );
}
