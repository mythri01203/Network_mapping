import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAgentTrackingStore } from './agentTrackingStore';
import { useNetworkStore } from './networkStore';

const T0 = Date.UTC(2026, 10, 6, 9, 0, 0);
type Success = (pos: unknown) => void;
type Failure = (err: unknown) => void;

const position = (lat: number, timestamp: number, accuracy = 5) => ({
  coords: { latitude: lat, longitude: 77.6, accuracy },
  timestamp,
});
const failure = (code: number) => ({ code, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });

function fakeGeolocation() {
  let onSuccess: Success | null = null;
  let onFailure: Failure | null = null;
  const gps = {
    startResult: position(12.9, T0) as unknown,
    startFails: false,
    get watching() {
      return onSuccess !== null;
    },
    emit: (lat: number, time: number) => onSuccess?.(position(lat, time)),
    fail: (code: number) => onFailure?.(failure(code)),
  };
  vi.stubGlobal('navigator', {
    geolocation: {
      getCurrentPosition: (success: Success, fail: Failure) => {
        if (gps.startFails) fail(gps.startResult);
        else success(gps.startResult);
      },
      watchPosition: (success: Success, fail: Failure) => {
        onSuccess = success;
        onFailure = fail;
        return 1;
      },
      clearWatch: () => {
        onSuccess = null;
        onFailure = null;
      },
    },
  });
  return gps;
}

const trips = () => useNetworkStore.getState().agentTrips;

beforeEach(() => {
  vi.useFakeTimers();
  useAgentTrackingStore.getState().endDuty();
  useNetworkStore.setState({ agentTrips: [] });
  useAgentTrackingStore.setState({ startError: null });
});

afterEach(() => {
  useAgentTrackingStore.getState().endDuty();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('agentTrackingStore', () => {
  it('will not start duty when location is denied, and says why', async () => {
    const gps = fakeGeolocation();
    gps.startFails = true;
    gps.startResult = failure(1);
    expect(await useAgentTrackingStore.getState().startDuty('Ravi')).toBe(false);
    expect(useAgentTrackingStore.getState().startError).toBe('denied');
    expect(trips()).toEqual([]);
    expect(gps.watching).toBe(false);
  });

  it('saves every update as it arrives', async () => {
    const gps = fakeGeolocation();
    await useAgentTrackingStore.getState().startDuty('Ravi');
    expect(trips()[0]).toMatchObject({ agentName: 'Ravi', status: 'active' });

    gps.emit(12.901, T0 + 30_000);
    expect(trips()[0].points).toHaveLength(2);
  });

  it('records lost GPS and carries on when location returns', async () => {
    const gps = fakeGeolocation();
    await useAgentTrackingStore.getState().startDuty('Ravi');
    vi.setSystemTime(T0 + 60_000);

    gps.fail(2);
    expect(trips()[0].gaps[0]).toMatchObject({ reason: 'GPS turned off or signal lost' });
    expect(trips()[0].gaps[0].endTime).toBeUndefined();
    expect(useAgentTrackingStore.getState().gpsProblem).toMatch(/restarts automatically/);

    gps.emit(12.901, T0 + 120_000);
    expect(trips()[0].gaps[0].endTime).toBeDefined();
    expect(useAgentTrackingStore.getState().gpsProblem).toBeNull();
  });

  it('does not treat a slow reading as lost GPS', async () => {
    const gps = fakeGeolocation();
    await useAgentTrackingStore.getState().startDuty('Ravi');
    gps.fail(3);
    expect(trips()[0].gaps).toEqual([]);
  });

  it('continues the same trip after a reload', async () => {
    const gps = fakeGeolocation();
    await useAgentTrackingStore.getState().startDuty('Ravi');
    const tripId = trips()[0].id;

    // A reload loses the running sensors but keeps the saved trip and its id.
    gps.emit(12.901, T0 + 30_000);
    vi.stubGlobal('navigator', { geolocation: { clearWatch: () => {} } });
    const reloaded = fakeGeolocation();
    useAgentTrackingStore.setState({ activeTripId: null });
    useAgentTrackingStore.getState().endDuty();
    useAgentTrackingStore.setState({ activeTripId: tripId });
    useAgentTrackingStore.getState().resumeDuty();

    expect(reloaded.watching).toBe(true);
    reloaded.emit(12.902, T0 + 600_000);
    expect(trips()).toHaveLength(1);
    expect(trips()[0].points).toHaveLength(3);
    expect(trips()[0].gaps).toHaveLength(1);
  });

  it('ends duty, stops GPS and allows no further recording', async () => {
    const gps = fakeGeolocation();
    await useAgentTrackingStore.getState().startDuty('Ravi');
    useAgentTrackingStore.getState().endDuty();
    expect(trips()[0].status).toBe('completed');
    expect(gps.watching).toBe(false);
    expect(useAgentTrackingStore.getState().activeTripId).toBeNull();
  });

  it('stops recording if the trip disappears, such as after a data restore', async () => {
    const gps = fakeGeolocation();
    await useAgentTrackingStore.getState().startDuty('Ravi');
    useNetworkStore.setState({ agentTrips: [] });
    gps.emit(12.901, T0 + 30_000);
    expect(useAgentTrackingStore.getState().activeTripId).toBeNull();
    expect(gps.watching).toBe(false);
  });
});
