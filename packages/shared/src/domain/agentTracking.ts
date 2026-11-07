import type { AgentTrackPoint, AgentTrip, LatLng } from '../model/types';
import { polylineLengthMeters } from './geo';

/** Readings closer together than this are ignored, because several location sources feed the trip. */
export const MIN_READING_INTERVAL_MS = 10_000;
/** Silence longer than this is recorded as a gap, for example a locked phone or a closed browser. */
export const SILENCE_GAP_MS = 60_000;
/** Readings less accurate than this keep the trip alive but are not added to the route. */
export const MAX_READING_ACCURACY_M = 100;
/** Faster than any real ride (about 150 km/h), so such a move must be a bad reading. */
const MAX_PLAUSIBLE_SPEED_MPS = 42;
/** Staying within this distance for the minimum duration counts as a stop. */
export const STOP_RADIUS_M = 30;
export const STOP_MIN_DURATION_MS = 120_000;
/** Moves below this are treated as GPS drift and left out of the distance. */
const MIN_DISTANCE_STEP_M = 15;
export const NEAREST_ASSET_RADIUS_M = 100;

export const SILENCE_GAP_REASON = 'No location updates (phone locked, browser closed or weak signal)';

export interface AgentReading {
  lat: number;
  lng: number;
  accuracy: number;
  /** Epoch milliseconds. */
  time: number;
}

export interface AgentStop {
  startMs: number;
  endMs: number;
  lat: number;
  lng: number;
}

export interface AgentTripSummary {
  durationMs: number;
  movingMs: number;
  stoppedMs: number;
  gapMs: number;
  distanceKm: number;
  stopCount: number;
  gapCount: number;
}

export interface TrackedAsset {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

export interface NearestAsset extends TrackedAsset {
  distanceMeters: number;
}

export type AgentTimelineEntry =
  | { kind: 'start' | 'end'; startMs: number; endMs: number }
  | { kind: 'move'; startMs: number; endMs: number; distanceKm: number }
  | { kind: 'stop'; startMs: number; endMs: number; lat: number; lng: number; nearest: NearestAsset | null; note?: string }
  | { kind: 'gap'; startMs: number; endMs: number; reason: string };

const toPoint = (reading: AgentReading): AgentTrackPoint => [
  reading.time,
  Number(reading.lat.toFixed(6)),
  Number(reading.lng.toFixed(6)),
  Math.round(reading.accuracy),
];

const metersBetween = (a: LatLng, b: LatLng) => polylineLengthMeters([a, b]);
const pointLatLng = (point: AgentTrackPoint): LatLng => [point[1], point[2]];
const ms = (iso: string) => new Date(iso).getTime();
const iso = (time: number) => new Date(time).toISOString();

export function startAgentTrip(id: string, agentName: string, firstReading: AgentReading): AgentTrip {
  const start = iso(firstReading.time);
  return {
    id,
    agentName: agentName.trim(),
    status: 'active',
    startTime: start,
    lastContactAt: start,
    points: [toPoint(firstReading)],
    gaps: [],
    stopNotes: {},
  };
}

/**
 * Adds a location reading. Returns the same trip object when the reading changes nothing,
 * so callers can skip saving.
 */
export function recordAgentReading(trip: AgentTrip, reading: AgentReading): AgentTrip {
  const lastContact = ms(trip.lastContactAt);
  if (trip.status !== 'active' || reading.time - lastContact < MIN_READING_INTERVAL_MS) return trip;

  const openGap = trip.gaps.some((gap) => !gap.endTime);
  const contactAt = iso(reading.time);
  let gaps = trip.gaps;
  if (openGap) {
    gaps = gaps.map((gap) => (gap.endTime ? gap : { ...gap, endTime: contactAt }));
  } else if (reading.time - lastContact > SILENCE_GAP_MS) {
    gaps = [...gaps, { startTime: trip.lastContactAt, endTime: contactAt, reason: SILENCE_GAP_REASON }];
  }

  const next: AgentTrip = { ...trip, lastContactAt: contactAt, gaps };
  if (reading.accuracy > MAX_READING_ACCURACY_M) return next;

  const last = trip.points[trip.points.length - 1];
  if (last) {
    const seconds = Math.max(1, (reading.time - last[0]) / 1000);
    const meters = metersBetween(pointLatLng(last), [reading.lat, reading.lng]);
    if (meters / seconds > MAX_PLAUSIBLE_SPEED_MPS) return next;
  }
  return { ...next, points: [...trip.points, toPoint(reading)] };
}

/** Records that location stopped at `time`. The next usable contact closes the gap. */
export function openAgentGap(trip: AgentTrip, reason: string, time: number): AgentTrip {
  if (trip.status !== 'active' || trip.gaps.some((gap) => !gap.endTime)) return trip;
  return { ...trip, gaps: [...trip.gaps, { startTime: iso(time), reason }] };
}

export function endAgentTrip(trip: AgentTrip, time: number): AgentTrip {
  const end = iso(Math.max(time, ms(trip.startTime)));
  return {
    ...trip,
    status: 'completed',
    endTime: end,
    gaps: trip.gaps.map((gap) => (gap.endTime ? gap : { ...gap, endTime: end })),
  };
}

export function detectAgentStops(points: readonly AgentTrackPoint[]): AgentStop[] {
  const stops: AgentStop[] = [];
  let i = 0;
  while (i < points.length) {
    const anchor = pointLatLng(points[i]);
    let j = i;
    while (j + 1 < points.length && metersBetween(anchor, pointLatLng(points[j + 1])) <= STOP_RADIUS_M) j++;
    if (points[j][0] - points[i][0] >= STOP_MIN_DURATION_MS) {
      stops.push({ startMs: points[i][0], endMs: points[j][0], lat: anchor[0], lng: anchor[1] });
      i = j + 1;
    } else {
      i++;
    }
  }
  return stops;
}

/** Route length in km, ignoring drift by measuring only moves beyond a minimum step. */
function distanceKmOf(points: readonly AgentTrackPoint[]): number {
  if (points.length === 0) return 0;
  let meters = 0;
  let anchor = pointLatLng(points[0]);
  for (const point of points) {
    const step = metersBetween(anchor, pointLatLng(point));
    if (step >= MIN_DISTANCE_STEP_M) {
      meters += step;
      anchor = pointLatLng(point);
    }
  }
  return meters / 1000;
}

const tripEndMs = (trip: AgentTrip) => ms(trip.endTime ?? trip.lastContactAt);

const gapIntervals = (trip: AgentTrip) =>
  trip.gaps.map((gap) => ({ startMs: ms(gap.startTime), endMs: gap.endTime ? ms(gap.endTime) : tripEndMs(trip), reason: gap.reason }));

/** Total time covered by possibly overlapping intervals. */
function coveredMs(intervals: readonly { startMs: number; endMs: number }[]): number {
  let total = 0;
  let cursor = -Infinity;
  for (const { startMs, endMs } of [...intervals].sort((a, b) => a.startMs - b.startMs)) {
    const from = Math.max(startMs, cursor);
    if (endMs > from) {
      total += endMs - from;
      cursor = endMs;
    }
  }
  return total;
}

export function summarizeAgentTrip(trip: AgentTrip): AgentTripSummary {
  const stops = detectAgentStops(trip.points);
  const gaps = gapIntervals(trip);
  const durationMs = Math.max(0, tripEndMs(trip) - ms(trip.startTime));
  return {
    durationMs,
    movingMs: Math.max(0, durationMs - coveredMs([...stops, ...gaps])),
    stoppedMs: coveredMs(stops),
    gapMs: coveredMs(gaps),
    distanceKm: distanceKmOf(trip.points),
    stopCount: stops.length,
    gapCount: gaps.length,
  };
}

export function findNearestAsset(lat: number, lng: number, assets: readonly TrackedAsset[]): NearestAsset | null {
  let nearest: NearestAsset | null = null;
  for (const asset of assets) {
    const distanceMeters = metersBetween([lat, lng], [asset.lat, asset.lng]);
    if (distanceMeters <= NEAREST_ASSET_RADIUS_M && (!nearest || distanceMeters < nearest.distanceMeters)) {
      nearest = { ...asset, distanceMeters };
    }
  }
  return nearest;
}

/** Every movement, stop and GPS gap of a trip in time order. */
export function agentTripTimeline(trip: AgentTrip, assets: readonly TrackedAsset[]): AgentTimelineEntry[] {
  const startMs = ms(trip.startTime);
  const endMs = tripEndMs(trip);
  const stops: AgentTimelineEntry[] = detectAgentStops(trip.points).map((stop) => ({
    kind: 'stop',
    ...stop,
    nearest: findNearestAsset(stop.lat, stop.lng, assets),
    note: trip.stopNotes[String(stop.startMs)],
  }));
  const gaps: AgentTimelineEntry[] = gapIntervals(trip).map((gap) => ({ kind: 'gap', ...gap }));
  const blocks = [...stops, ...gaps].sort((a, b) => a.startMs - b.startMs);

  const entries: AgentTimelineEntry[] = [{ kind: 'start', startMs, endMs: startMs }];
  const addMove = (from: number, to: number) => {
    const distanceKm = distanceKmOf(trip.points.filter((p) => p[0] >= from && p[0] <= to));
    if (to > from && distanceKm > 0) entries.push({ kind: 'move', startMs: from, endMs: to, distanceKm });
  };

  let cursor = startMs;
  for (const block of blocks) {
    addMove(cursor, block.startMs);
    entries.push(block);
    cursor = Math.max(cursor, block.endMs);
  }
  addMove(cursor, endMs);
  if (trip.status === 'completed') entries.push({ kind: 'end', startMs: endMs, endMs });
  return entries;
}
