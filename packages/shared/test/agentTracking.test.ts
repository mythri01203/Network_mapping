import { describe, expect, it } from 'vitest';

import {
  type AgentReading,
  agentTripTimeline,
  detectAgentStops,
  endAgentTrip,
  findNearestAsset,
  MAX_READING_ACCURACY_M,
  openAgentGap,
  recordAgentReading,
  SILENCE_GAP_REASON,
  startAgentTrip,
  summarizeAgentTrip,
} from '../src/domain/agentTracking';
import { agentTripSchema } from '../src/model/schemas';

const T0 = Date.UTC(2026, 10, 6, 9, 0, 0);
const MINUTE = 60_000;
/** About 111 m of latitude per 0.001 degrees. */
const at = (minutes: number, lat = 12.9, lng = 77.6, accuracy = 5): AgentReading => ({
  lat,
  lng,
  accuracy,
  time: T0 + minutes * MINUTE,
});
const newTrip = () => startAgentTrip('TRIP-1', ' Ravi ', at(0));
const ride = (...readings: AgentReading[]) => readings.reduce(recordAgentReading, newTrip());

describe('recording readings', () => {
  it('creates a valid active trip with a trimmed name', () => {
    const trip = newTrip();
    expect(trip.agentName).toBe('Ravi');
    expect(agentTripSchema.safeParse(trip).success).toBe(true);
    expect(agentTripSchema.safeParse(endAgentTrip(ride(at(1, 12.901)), T0 + 2 * MINUTE)).success).toBe(true);
  });

  it('ignores readings that arrive too soon', () => {
    const trip = newTrip();
    expect(recordAgentReading(trip, { ...at(0), time: T0 + 5000 })).toBe(trip);
  });

  it('keeps contact but adds no route point for an inaccurate reading', () => {
    const trip = ride(at(0.5, 12.901, 77.6, MAX_READING_ACCURACY_M + 1));
    expect(trip.points).toHaveLength(1);
    expect(trip.lastContactAt).toBe(new Date(T0 + 0.5 * MINUTE).toISOString());
  });

  it('rejects an impossible jump and recovers on the next good reading', () => {
    const trip = ride(at(0.5, 14), at(1, 12.901));
    expect(trip.points.map((p) => p[1])).toEqual([12.9, 12.901]);
  });

  it('records silence as a GPS gap, such as a locked phone', () => {
    const trip = ride(at(0.5, 12.901), at(10, 12.91));
    expect(trip.gaps).toEqual([
      {
        startTime: new Date(T0 + 0.5 * MINUTE).toISOString(),
        endTime: new Date(T0 + 10 * MINUTE).toISOString(),
        reason: SILENCE_GAP_REASON,
      },
    ]);
  });

  it('closes a reported interruption on the next reading without adding a second gap', () => {
    let trip = openAgentGap(ride(at(0.5, 12.901)), 'GPS turned off', T0 + MINUTE);
    expect(openAgentGap(trip, 'Again', T0 + 2 * MINUTE)).toBe(trip);
    trip = recordAgentReading(trip, at(10, 12.902));
    expect(trip.gaps).toHaveLength(1);
    expect(trip.gaps[0]).toMatchObject({ reason: 'GPS turned off', endTime: new Date(T0 + 10 * MINUTE).toISOString() });
  });

  it('closes an open gap and stops accepting readings when duty ends', () => {
    const open = openAgentGap(newTrip(), 'GPS turned off', T0 + MINUTE);
    const ended = endAgentTrip(open, T0 + 5 * MINUTE);
    expect(ended.gaps[0].endTime).toBe(ended.endTime);
    expect(recordAgentReading(ended, at(10, 12.91))).toBe(ended);
  });
});

describe('stops', () => {
  it('detects a stay of two minutes or more within 30 m', () => {
    const trip = ride(at(0.5), at(1, 12.90005), at(2), at(3), at(3.5, 12.91));
    const stops = detectAgentStops(trip.points);
    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatchObject({ startMs: T0, endMs: T0 + 3 * MINUTE });
  });

  it('does not count a short pause or steady movement as a stop', () => {
    expect(detectAgentStops(ride(at(0.5), at(1), at(1.5, 12.905)).points)).toEqual([]);
    expect(detectAgentStops(ride(at(0.5, 12.902), at(1, 12.904), at(1.5, 12.906)).points)).toEqual([]);
  });
});

describe('summary', () => {
  it('splits duty time into moving, stopped and GPS gap time', () => {
    // 3 min stopped, then riding, a 5 min silent gap, more riding, ended at 12 min.
    const trip = endAgentTrip(
      ride(at(1), at(2), at(3), at(4, 12.902), at(5, 12.904), at(10, 12.906), at(11, 12.908)),
      T0 + 12 * MINUTE,
    );
    const summary = summarizeAgentTrip(trip);
    expect(summary).toMatchObject({
      durationMs: 12 * MINUTE,
      stoppedMs: 3 * MINUTE,
      gapMs: 5 * MINUTE,
      movingMs: 4 * MINUTE,
      stopCount: 1,
      gapCount: 1,
    });
    expect(summary.distanceKm).toBeCloseTo(0.89, 1);
  });

  it('does not count GPS drift as distance', () => {
    const trip = ride(at(0.5, 12.90003), at(1, 12.9), at(1.5, 12.90003), at(2, 12.9));
    expect(summarizeAgentTrip(trip).distanceKm).toBe(0);
  });

  it('does not count time twice when a stop overlaps a gap', () => {
    const trip = endAgentTrip(ride(at(1), at(5), at(6)), T0 + 6 * MINUTE);
    const summary = summarizeAgentTrip(trip);
    expect(summary.stoppedMs).toBe(6 * MINUTE);
    expect(summary.gapMs).toBe(4 * MINUTE);
    expect(summary.movingMs).toBe(0);
  });
});

describe('timeline', () => {
  const assets = [{ id: 'FAT-09', name: 'Pole FAT', lat: 12.90005, lng: 77.6 }];

  it('finds the nearest asset within 100 m only', () => {
    expect(findNearestAsset(12.9, 77.6, assets)?.id).toBe('FAT-09');
    expect(findNearestAsset(12.91, 77.6, assets)).toBeNull();
  });

  it('lists start, stop with its nearest asset and note, movement and end in time order', () => {
    const riding = ride(at(1), at(2), at(3), at(3.5, 12.902), at(4, 12.904));
    const trip = endAgentTrip({ ...riding, stopNotes: { [String(T0)]: 'Repaired box' } }, T0 + 5 * MINUTE);
    const timeline = agentTripTimeline(trip, assets);
    expect(timeline.map((e) => e.kind)).toEqual(['start', 'stop', 'move', 'end']);
    expect(timeline[1]).toMatchObject({ note: 'Repaired box', nearest: { id: 'FAT-09' } });
  });

  it('does not end a running duty', () => {
    expect(agentTripTimeline(newTrip(), []).map((e) => e.kind)).toEqual(['start']);
  });
});
