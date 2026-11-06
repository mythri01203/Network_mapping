import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useBikerStore } from './bikerStore';
import { useMapStore } from './mapStore';
import { useNetworkStore } from './networkStore';
import { useToastStore } from './toastStore';
import { useUiStore } from './uiStore';

const destination = { id: 'DEST', name: 'Customer site', lat: 12.99, lng: 77.62 };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A controllable stand-in for the browser's geolocation API. */
function fakeGeolocation() {
  type Success = (pos: { coords: { latitude: number; longitude: number; accuracy: number }; timestamp: number }) => void;
  let listener: Success | null = null;
  const gps = {
    fix: null as { lat: number; lng: number } | null,
    get watching() {
      return listener !== null;
    },
    emit(lat: number, lng: number, timestamp: number) {
      listener?.({ coords: { latitude: lat, longitude: lng, accuracy: 5 }, timestamp });
    },
  };
  vi.stubGlobal('navigator', {
    geolocation: {
      getCurrentPosition: (success: Success, failure: () => void) => {
        if (gps.fix) success({ coords: { latitude: gps.fix.lat, longitude: gps.fix.lng, accuracy: 5 }, timestamp: 0 });
        else failure();
      },
      watchPosition: (success: Success) => {
        listener = success;
        return 1;
      },
      clearWatch: () => {
        listener = null;
      },
    },
  });
  return gps;
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Promise.reject(new Error('offline'))),
  );
  useBikerStore.getState().clearRoute();
  useBikerStore.getState().clearLiveRoute();
  useUiStore.setState({ selectedObject: null });
  useToastStore.setState({ toasts: [] });
});

afterEach(() => vi.unstubAllGlobals());

describe('bikerStore', () => {
  it('routes from the GPS position and falls back to an estimate when offline', async () => {
    const gps = fakeGeolocation();
    gps.fix = { lat: 12.91, lng: 77.6 };
    useBikerStore.getState().navigateTo(destination);
    await flush();

    const { route, waypoints } = useBikerStore.getState();
    expect(waypoints).toEqual([destination]);
    expect(route?.coordinates[0]).toEqual([12.91, 77.6]);
    expect(route?.originName).toBe('Your GPS location');
    expect(route?.coordinates.at(-1)).toEqual([destination.lat, destination.lng]);
    expect(route?.limitation).toMatch(/estimated/i);
    expect(useMapStore.getState().flyToTarget).toEqual({ lat: destination.lat, lng: destination.lng, zoom: 16 });
    expect(useToastStore.getState().toasts.at(-1)?.title).toBe('Estimated Route Ready');
  });

  it('starts from the selected asset when GPS is unavailable', async () => {
    const customer = useNetworkStore.getState().customers[0];
    useUiStore.getState().select({ type: 'customer', data: customer });
    useBikerStore.getState().navigateTo(destination);
    await flush();
    expect(useBikerStore.getState().route?.coordinates[0]).toEqual([customer.lat, customer.lng]);
    expect(useToastStore.getState().toasts.map((t) => t.title)).toContain('GPS Unavailable');
  });

  it('uses the map center, never an unrelated OLT, when nothing else is available', async () => {
    useMapStore.setState({ viewport: { ...useMapStore.getState().viewport, lat: 16.5, lng: 80.66 } });
    useBikerStore.getState().navigateTo(destination);
    await flush();
    const { route } = useBikerStore.getState();
    expect(route?.coordinates[0]).toEqual([16.5, 80.66]);
    expect(route?.originName).toBe('Map center');
  });

  it('skips a selected item that is itself the destination', async () => {
    const olt = useNetworkStore.getState().equipment.find((e) => e.type === 'OLT')!;
    useMapStore.setState({ viewport: { ...useMapStore.getState().viewport, lat: 16.5, lng: 80.66 } });
    useUiStore.getState().select({ type: 'equipment', data: olt });
    useBikerStore.getState().navigateTo({ id: olt.id, name: olt.name, lat: olt.lat, lng: olt.lng });
    await flush();
    expect(useBikerStore.getState().route?.originName).toBe('Map center');
  });

  it('collects unique waypoints', async () => {
    const { addWaypoint } = useBikerStore.getState();
    addWaypoint(destination);
    addWaypoint(destination);
    addWaypoint({ ...destination, id: 'NEXT', lat: 13 });
    await flush();
    expect(useBikerStore.getState().waypoints.map((w) => w.id)).toEqual(['DEST', 'NEXT']);
  });

  it('ignores a response that arrives after the route was cleared', async () => {
    let respond: (value: Response) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>((resolve) => (respond = resolve))),
    );
    useBikerStore.getState().navigateTo(destination);
    useBikerStore.getState().clearRoute();
    respond(Response.json({ routes: [] }));
    await flush();
    expect(useBikerStore.getState().route).toBeNull();
  });
});

describe('live GPS recording', () => {
  const start = () => {
    const gps = fakeGeolocation();
    useBikerStore.getState().startLiveTracking();
    return gps;
  };
  /** About 111 m of latitude per 0.001 degrees. */
  const points = () => useBikerStore.getState().trackedCoordinates.length;

  it('keeps recording after a signal gap longer than the old one-second assumption', () => {
    const gps = start();
    gps.emit(12.9, 77.6, 0);
    gps.emit(12.901, 77.6, 15_000); // 111 m in 15 s
    gps.emit(12.902, 77.6, 30_000);
    expect(points()).toBe(3);
    expect(useBikerStore.getState().distanceKm).toBeCloseTo(0.222, 2);
  });

  it('rejects an impossible jump and recovers on the next good reading', () => {
    const gps = start();
    gps.emit(12.9, 77.6, 0);
    gps.emit(13.9, 77.6, 1000); // 111 km in 1 s
    expect(points()).toBe(1);
    expect(useBikerStore.getState().gpsError).toMatch(/jump/i);
    gps.emit(12.901, 77.6, 10_000);
    expect(points()).toBe(2);
  });

  it('turns GPS off while paused and on again when resumed', () => {
    const gps = start();
    gps.emit(12.9, 77.6, 0);
    useBikerStore.getState().pauseLiveTracking();
    expect(gps.watching).toBe(false);

    useBikerStore.getState().resumeLiveTracking();
    expect(gps.watching).toBe(true);
    expect(useBikerStore.getState().trackingStatus).toBe('recording');
  });

  it('does not count distance travelled during a pause', () => {
    const gps = start();
    gps.emit(12.9, 77.6, 0);
    useBikerStore.getState().pauseLiveTracking();
    useBikerStore.getState().resumeLiveTracking();
    gps.emit(13.0, 77.6, 60_000); // 11 km away after the pause
    expect(points()).toBe(2);
    expect(useBikerStore.getState().distanceKm).toBe(0);
    gps.emit(13.001, 77.6, 75_000);
    expect(useBikerStore.getState().distanceKm).toBeCloseTo(0.111, 2);
  });

  it('resumes with working GPS after leaving and reopening the panel', () => {
    const gps = start();
    gps.emit(12.9, 77.6, 0);
    useBikerStore.getState().setBikerMode(false);
    expect(gps.watching).toBe(false);
    expect(useBikerStore.getState().trackingStatus).toBe('paused');

    useBikerStore.getState().setBikerMode(true);
    useBikerStore.getState().resumeLiveTracking();
    gps.emit(12.901, 77.6, 60_000);
    expect(points()).toBe(2);
  });
});
