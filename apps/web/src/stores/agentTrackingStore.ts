import { create } from 'zustand';

import {
  type AgentReading,
  type AgentTrip,
  endAgentTrip,
  MAX_READING_ACCURACY_M,
  openAgentGap,
  recordAgentReading,
  startAgentTrip,
} from '@fibergis/shared';

import { readJson, writeJson } from '../lib/storage';
import { useNetworkStore } from './networkStore';
import { showToast } from './toastStore';

/** Which duty this device is recording, so it continues after a reload. */
const ACTIVE_TRIP_KEY = 'agent_active_trip';
const POLL_INTERVAL_MS = 15_000;
const POSITION_OPTIONS: PositionOptions = { enableHighAccuracy: true, timeout: 12_000, maximumAge: 0 };

export type GpsBlockReason = 'unsupported' | 'denied' | 'unavailable';

interface AgentTrackingState {
  activeTripId: string | null;
  isStarting: boolean;
  /** Why duty could not start. */
  startError: GpsBlockReason | null;
  /** Current location problem during a duty, or null when location is working. */
  gpsProblem: string | null;
  startDuty: (agentName: string) => Promise<boolean>;
  endDuty: () => void;
  /** Continues this device's duty after a reload. */
  resumeDuty: () => void;
  setStopNote: (stopStartMs: number, note: string) => void;
}

const geolocation = () => (typeof navigator !== 'undefined' ? navigator.geolocation : undefined);

const toReading = (pos: GeolocationPosition): AgentReading => ({
  lat: pos.coords.latitude,
  lng: pos.coords.longitude,
  accuracy: pos.coords.accuracy,
  time: pos.timestamp,
});

const newTripId = () => `TRIP-${Date.now().toString(36).toUpperCase()}`;

let watchId: number | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let pollNow: (() => void) | null = null;

function stopSensors() {
  if (watchId !== null) geolocation()?.clearWatch(watchId);
  if (pollTimer !== null) clearInterval(pollTimer);
  if (pollNow && typeof document !== 'undefined') document.removeEventListener('visibilitychange', pollNow);
  watchId = null;
  pollTimer = null;
  pollNow = null;
}

export const useAgentTrackingStore = create<AgentTrackingState>()((set, get) => {
  const activeTrip = (): AgentTrip | null => {
    const id = get().activeTripId;
    return useNetworkStore.getState().agentTrips.find((t) => t.id === id && t.status === 'active') ?? null;
  };

  const save = (next: AgentTrip, current: AgentTrip) => {
    if (next !== current) useNetworkStore.getState().saveAgentTrip(next);
  };

  /** Ends local recording when the trip has gone, for example after a data restore. */
  const stopRecording = () => {
    stopSensors();
    writeJson(ACTIVE_TRIP_KEY, null);
    set({ activeTripId: null, gpsProblem: null });
  };

  const onReading = (pos: GeolocationPosition) => {
    const trip = activeTrip();
    if (!trip) {
      stopRecording();
      return;
    }
    save(recordAgentReading(trip, toReading(pos)), trip);
    set({
      gpsProblem:
        pos.coords.accuracy > MAX_READING_ACCURACY_M
          ? `Weak GPS accuracy (±${Math.round(pos.coords.accuracy)} m). Route points are not being added.`
          : null,
    });
  };

  const onError = (err: GeolocationPositionError) => {
    // A timeout only means this reading was slow. Continued silence is recorded as a gap.
    if (err.code === err.TIMEOUT) return;
    const reason = err.code === err.PERMISSION_DENIED ? 'Location permission removed' : 'GPS turned off or signal lost';
    const trip = activeTrip();
    if (!trip) return;
    const next = openAgentGap(trip, reason, Date.now());
    if (next !== trip) showToast('error', 'GPS Interrupted', `${reason}. Turn GPS back on to continue tracking.`);
    save(next, trip);
    set({ gpsProblem: `${reason}. Tracking restarts automatically when location returns.` });
  };

  const startSensors = () => {
    const geo = geolocation();
    if (!geo) return;
    stopSensors();
    watchId = geo.watchPosition(onReading, onError, POSITION_OPTIONS);
    // Some devices stop sending updates while still, which must not look like lost GPS.
    const poll = () => geo.getCurrentPosition(onReading, onError, POSITION_OPTIONS);
    pollTimer = setInterval(poll, POLL_INTERVAL_MS);
    pollNow = poll;
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', poll);
  };

  return {
    activeTripId: readJson<string | null>(ACTIVE_TRIP_KEY, null, (v) => typeof v === 'string'),
    isStarting: false,
    startError: null,
    gpsProblem: null,

    startDuty: async (agentName) => {
      const geo = geolocation();
      if (!geo) {
        set({ startError: 'unsupported' });
        return false;
      }
      set({ isStarting: true, startError: null });
      const position = await new Promise<GeolocationPosition | GeolocationPositionError>((resolve) => {
        geo.getCurrentPosition(resolve, resolve, { ...POSITION_OPTIONS, timeout: 15_000 });
      });
      if ('code' in position) {
        set({ isStarting: false, startError: position.code === position.PERMISSION_DENIED ? 'denied' : 'unavailable' });
        return false;
      }
      const trip = startAgentTrip(newTripId(), agentName, toReading(position));
      useNetworkStore.getState().saveAgentTrip(trip);
      writeJson(ACTIVE_TRIP_KEY, trip.id);
      set({ activeTripId: trip.id, isStarting: false, gpsProblem: null });
      startSensors();
      showToast('success', 'Duty Started', `Tracking ${trip.agentName} until End Duty.`);
      return true;
    },

    endDuty: () => {
      const trip = activeTrip();
      if (trip) useNetworkStore.getState().saveAgentTrip(endAgentTrip(trip, Date.now()));
      stopRecording();
      if (trip) showToast('info', 'Duty Ended', `Tracking stopped for ${trip.agentName}. The report is ready.`);
    },

    resumeDuty: () => {
      if (!get().activeTripId || watchId !== null) return;
      if (activeTrip()) startSensors();
      else stopRecording();
    },

    setStopNote: (stopStartMs, note) => {
      const trip = activeTrip();
      if (!trip) return;
      const stopNotes = { ...trip.stopNotes };
      if (note.trim()) stopNotes[String(stopStartMs)] = note;
      else delete stopNotes[String(stopStartMs)];
      useNetworkStore.getState().saveAgentTrip({ ...trip, stopNotes });
    },
  };
});
