import { create } from 'zustand';

import { type GpsRoute, type LatLng, polylineLengthMeters } from '@fibergis/shared';

import { estimateRoadRoute, fetchRoadRoute, type RoadRoute, type RouteStop } from '../lib/routing';
import { useMapStore } from './mapStore';
import { addGpsRoute } from './networkActions';
import { showToast } from './toastStore';
import { type SelectedObject, useUiStore } from './uiStore';

export interface BikerWaypoint extends RouteStop {
  type?: string;
}

export interface BikerRoute {
  coordinates: LatLng[];
  distanceMeters: number;
  durationSeconds: number;
  steps: string[];
  profile: 'driving';
  /** Plain-language caveat shown with the route (source and accuracy). */
  limitation: string;
  /** Where the route actually starts. */
  originName: string;
}

export type GpsTrackingStatus = 'idle' | 'recording' | 'paused' | 'stopped';

export interface LiveGpsPosition {
  lat: number;
  lng: number;
  accuracy: number;
  timestamp: number;
}

export type BikerTabId = 'survey' | 'gps_track' | 'navigation';

interface BikerState {
  isBikerMode: boolean;
  activeBikerTab: BikerTabId;
  setActiveBikerTab: (tab: BikerTabId) => void;
  waypoints: BikerWaypoint[];
  route: BikerRoute | null;
  setBikerMode: (on: boolean) => void;
  /** Appends a stop and re-plans the trip through every stop. */
  addWaypoint: (stop: BikerWaypoint) => void;
  /** Plans a fresh route to a single destination and centres the map on it. */
  navigateTo: (stop: BikerWaypoint) => void;
  clearRoute: () => void;

  // Module 1: Live GPS Tracking
  trackingStatus: GpsTrackingStatus;
  livePosition: LiveGpsPosition | null;
  trackedCoordinates: LatLng[];
  distanceKm: number;
  elapsedSeconds: number;
  gpsAccuracy: number | null;
  gpsError: string | null;
  startLocationName: string;
  savedRoutesModalOpen: boolean;
  activeSavedRoute: GpsRoute | null;

  startLiveTracking: () => void;
  pauseLiveTracking: () => void;
  resumeLiveTracking: () => void;
  stopLiveTracking: () => void;
  saveLiveRoute: (name: string, notes?: string) => GpsRoute | null;
  clearLiveRoute: () => void;
  loadSavedRoute: (route: GpsRoute) => void;
  clearActiveSavedRoute: () => void;
  setSavedRoutesModalOpen: (open: boolean) => void;
}

let watchId: number | null = null;
let timerId: ReturnType<typeof setInterval> | null = null;
/** Time of the last recorded point, used to reject impossible speeds. */
let lastPointTime = 0;
/** The next point follows a pause, so the ride between them is not part of the recorded distance. */
let resumeGap = false;

/** Faster than any real ride (about 150 km/h), so such a move must be a bad GPS reading. */
const MAX_PLAUSIBLE_SPEED_MPS = 42;
const GPS_FIX_TIMEOUT_MS = 5000;
/** Also covers a location permission prompt the user never answers. */
const GPS_FIX_GIVE_UP_MS = 8000;

const stopWatchAndTimer = () => {
  if (watchId !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  if (timerId !== null) {
    clearInterval(timerId);
    timerId = null;
  }
};

const ROUTE_LIMITATIONS: Record<RoadRoute['source'], string> = {
  road: 'OSRM driving profile; not a verified motorcycle route',
  estimate: 'Estimated street-grid path (routing service unreachable). Follow local roads.',
};

/** A routable location for any selectable object (cables use their first vertex). */
function locationOf(selection: SelectedObject | null): BikerWaypoint | null {
  if (!selection) return null;
  switch (selection.type) {
    case 'equipment':
    case 'customer':
    case 'closure': {
      const { id, name, lat, lng } = selection.data;
      return { id, name: name || id, lat, lng };
    }
    case 'cable': {
      const start = selection.data.coordinates[0];
      return start
        ? { id: selection.data.id, name: selection.data.name || selection.data.id, lat: start[0], lng: start[1] }
        : null;
    }
    case 'fault': {
      const { id, title, affectedLocation } = selection.data;
      return { id, name: title || id, lat: affectedLocation.lat, lng: affectedLocation.lng };
    }
  }
}

/** A one-off reading of the device position, or null when it is unavailable or denied. */
function readDevicePosition(): Promise<{ lat: number; lng: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    const giveUp = setTimeout(() => resolve(null), GPS_FIX_GIVE_UP_MS);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(giveUp);
        resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {
        clearTimeout(giveUp);
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: GPS_FIX_TIMEOUT_MS, maximumAge: 30_000 },
    );
  });
}

/** Route origin, first match wins: the rider's GPS position, the selected object, then the map center. */
async function resolveOrigin(destination: BikerWaypoint): Promise<{ origin: BikerWaypoint | null; usedGps: boolean }> {
  const isElsewhere = (c: BikerWaypoint) =>
    c.id !== destination.id && (c.lat !== destination.lat || c.lng !== destination.lng);

  const { trackingStatus, livePosition } = useBikerStore.getState();
  const gps = trackingStatus === 'recording' && livePosition ? livePosition : await readDevicePosition();
  if (gps) {
    const rider = { id: 'ORIGIN-GPS', name: 'Your GPS location', lat: gps.lat, lng: gps.lng };
    if (isElsewhere(rider)) return { origin: rider, usedGps: true };
  }

  const { viewport } = useMapStore.getState();
  const candidates: (BikerWaypoint | null)[] = [
    locationOf(useUiStore.getState().selectedObject),
    { id: 'ORIGIN-MAP-CENTER', name: 'Map center', lat: viewport.lat, lng: viewport.lng },
  ];
  const origin = candidates.find((c): c is BikerWaypoint => c !== null && isElsewhere(c)) ?? null;
  return { origin, usedGps: false };
}

const formatTrip = (route: RoadRoute) =>
  `${(route.distanceMeters / 1000).toFixed(2)} km · ~${Math.max(1, Math.ceil(route.durationSeconds / 60))} min`;

export const useBikerStore = create<BikerState>()((set, get) => {
  let latestRequest = 0;

  const plan = async (stops: BikerWaypoint[]) => {
    const destination = stops[stops.length - 1];
    if (!destination) return;
    const request = ++latestRequest;
    const { origin, usedGps } = await resolveOrigin(stops[0]);
    if (request !== latestRequest) return;
    if (!origin) {
      showToast('warning', 'No Route Origin', 'Turn on GPS, select a starting item, or move the map before planning.');
      return;
    }
    if (!usedGps) showToast('warning', 'GPS Unavailable', `The route starts from ${origin.name} instead of your location.`);
    const path = [origin, ...stops];
    const route = (await fetchRoadRoute(path)) ?? estimateRoadRoute(path);
    if (request !== latestRequest) return;
    if (!route) {
      showToast('warning', 'Route Not Found', 'Could not compute road directions between these points.');
      return;
    }
    set({
      route: {
        coordinates: route.coordinates,
        distanceMeters: route.distanceMeters,
        durationSeconds: route.durationSeconds,
        steps: route.steps,
        profile: 'driving',
        limitation: ROUTE_LIMITATIONS[route.source],
        originName: origin.name,
      },
    });
    showToast(
      'info',
      route.source === 'road' ? 'Road Route Planned' : 'Estimated Route Ready',
      `${formatTrip(route)} to ${destination.name}`,
    );
  };

  /** Runs the elapsed timer and GPS watch. Both run only while recording. */
  const startRecordingSensors = () => {
    stopWatchAndTimer();

    timerId = setInterval(() => {
      set((s) => ({ elapsedSeconds: s.elapsedSeconds + 1 }));
    }, 1000);

    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;

        // Always update live position marker so operator sees their location on map
        set({
          livePosition: { lat: latitude, lng: longitude, accuracy, timestamp: pos.timestamp },
          gpsAccuracy: accuracy,
          gpsError: null,
        });

        // Discard excessive noise (> 120m) for polyline route recording
        if (accuracy > 120 && get().trackedCoordinates.length > 0) {
          set({
            gpsError: `Moderate GPS accuracy (±${Math.round(accuracy)}m). Recording will refine outdoors with clear sky view.`,
          });
          return;
        }

        const currentCoords = get().trackedCoordinates;
        let addedKm = 0;
        if (currentCoords.length > 0) {
          const last = currentCoords[currentCoords.length - 1];
          const deltaMeters = polylineLengthMeters([last, [latitude, longitude]]);

          // Noise / Stationary filter: require at least 3m displacement to append a point
          if (deltaMeters < 3) return;

          if (!resumeGap) {
            // Measured from the last recorded point, so a signal gap only delays the next point.
            const secondsSinceLastPoint = Math.max(1, (pos.timestamp - lastPointTime) / 1000);
            if (deltaMeters / secondsSinceLastPoint > MAX_PLAUSIBLE_SPEED_MPS) {
              set({ gpsError: 'Ignored anomalous GPS location jump.' });
              return;
            }
            addedKm = deltaMeters / 1000;
          }
        }

        resumeGap = false;
        lastPointTime = pos.timestamp;
        set((s) => ({
          trackedCoordinates: [...currentCoords, [latitude, longitude]],
          distanceKm: s.distanceKm + addedKm,
        }));

        // Smoothly pan map to follow the rider
        useMapStore.getState().flyTo(latitude, longitude, 18);
      },
      (err) => {
        let msg = 'GPS positioning error.';
        if (err.code === err.PERMISSION_DENIED) {
          msg = 'GPS permission denied. Please enable location permissions in browser settings.';
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          msg = 'GPS signal lost or unavailable.';
        } else if (err.code === err.TIMEOUT) {
          msg = 'GPS acquisition timed out. Reconnecting...';
        }
        set({ gpsError: msg });
        showToast('error', 'GPS Signal Notice', msg);
      },
      {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 1000,
      },
    );
  };

  return {
    isBikerMode: false,
    activeBikerTab: 'survey',
    setActiveBikerTab: (activeBikerTab) => set({ activeBikerTab }),
    waypoints: [],
    route: null,

    // Module 1: Live GPS Tracking initial state
    trackingStatus: 'idle',
    livePosition: null,
    trackedCoordinates: [],
    distanceKm: 0,
    elapsedSeconds: 0,
    gpsAccuracy: null,
    gpsError: null,
    startLocationName: 'Operator Starting Point',
    savedRoutesModalOpen: false,
    activeSavedRoute: null,

    setBikerMode: (on) => {
      set({ isBikerMode: on });
      if (!on) {
        stopWatchAndTimer();
        if (get().trackingStatus === 'recording') {
          set({ trackingStatus: 'paused' });
        }
      }
    },

    addWaypoint: (stop) => {
      if (get().waypoints.some((w) => w.id === stop.id)) return;
      const next = [...get().waypoints, stop];
      set({ waypoints: next });
      void plan(next);
    },

    navigateTo: (stop) => {
      set({ waypoints: [stop], isBikerMode: true, activeBikerTab: 'navigation' });
      void plan([stop]);
      useMapStore.getState().flyTo(stop.lat, stop.lng, 16);
    },

    clearRoute: () => {
      latestRequest++;
      set({ route: null, waypoints: [] });
    },

    // Module 1: GPS Live Tracking Methods
    startLiveTracking: () => {
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        set({ gpsError: 'Geolocation API is not supported by your browser.' });
        showToast('error', 'GPS Not Supported', 'Your browser does not support Geolocation.');
        return;
      }

      set({
        trackingStatus: 'recording',
        isBikerMode: true,
        activeBikerTab: 'gps_track',
        gpsError: null,
      });
      startRecordingSensors();

      showToast('success', 'Bike Tracking Started', 'Recording actual GPS route points.');
    },

    pauseLiveTracking: () => {
      stopWatchAndTimer();
      set({ trackingStatus: 'paused' });
      showToast('info', 'GPS Tracking Paused', 'Route recording is paused.');
    },

    resumeLiveTracking: () => {
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        set({ gpsError: 'Geolocation API is not supported by your browser.' });
        showToast('error', 'GPS Not Supported', 'Your browser does not support Geolocation.');
        return;
      }
      resumeGap = true;
      set({ trackingStatus: 'recording', gpsError: null });
      startRecordingSensors();
      showToast('success', 'GPS Tracking Resumed', 'Continuing route recording.');
    },

    stopLiveTracking: () => {
      stopWatchAndTimer();
      set({ trackingStatus: 'stopped' });
      showToast('info', 'GPS Tracking Stopped', `Recorded ${get().trackedCoordinates.length} GPS points (${get().distanceKm.toFixed(2)} km).`);
    },

    saveLiveRoute: (name: string, notes?: string) => {
      const coords = get().trackedCoordinates;
      if (coords.length < 2) {
        showToast('warning', 'Route Too Short', 'Need at least 2 GPS coordinates to save a completed route.');
        return null;
      }

      const routeId = `GPS-BIKE-${Date.now().toString(36).toUpperCase()}`;
      const now = new Date().toISOString();
      const route: GpsRoute = {
        id: routeId,
        name: name.trim() || `Bike Route ${new Date().toLocaleDateString()}`,
        travelMode: 'bike',
        startTime: now,
        endTime: now,
        durationSeconds: get().elapsedSeconds,
        distanceKm: get().distanceKm,
        coordinates: coords,
        accuracyMeters: get().gpsAccuracy ?? undefined,
        status: 'completed',
        startLocationName: get().startLocationName,
        notes: notes || `Recorded via Bike Mode live GPS with ${coords.length} coordinates`,
      };

      addGpsRoute(route);
      stopWatchAndTimer();
      set({
        trackingStatus: 'idle',
        trackedCoordinates: [],
        distanceKm: 0,
        elapsedSeconds: 0,
        activeSavedRoute: route,
      });

      return route;
    },

    clearLiveRoute: () => {
      stopWatchAndTimer();
      set({
        trackingStatus: 'idle',
        livePosition: null,
        trackedCoordinates: [],
        distanceKm: 0,
        elapsedSeconds: 0,
        gpsAccuracy: null,
        gpsError: null,
        activeSavedRoute: null,
      });
      showToast('info', 'Track Cleared', 'Live GPS route track reset.');
    },

    loadSavedRoute: (route: GpsRoute) => {
      set({
        activeSavedRoute: route,
        savedRoutesModalOpen: false,
      });
      if (route.coordinates.length > 0) {
        const center = route.coordinates[Math.floor(route.coordinates.length / 2)];
        useMapStore.getState().flyTo(center[0], center[1], 16);
      }
      showToast('success', 'Loaded Route', `Displaying saved route "${route.name}".`);
    },

    clearActiveSavedRoute: () => set({ activeSavedRoute: null }),

    setSavedRoutesModalOpen: (open: boolean) => set({ savedRoutesModalOpen: open }),
  };
});
