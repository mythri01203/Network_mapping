import { create } from 'zustand';
import type { LatLng } from '@fibergis/shared';
import { type RoadRoute, type RouteStop, estimateRoadRoute, fetchRoadRoute } from '../lib/routing';
import { useMapStore } from './mapStore';
import { useNetworkStore } from './networkStore';
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
}

interface BikerState {
  isBikerMode: boolean;
  waypoints: BikerWaypoint[];
  route: BikerRoute | null;
  setBikerMode: (on: boolean) => void;
  /** Appends a stop and re-plans the trip through every stop. */
  addWaypoint: (stop: BikerWaypoint) => void;
  /** Plans a fresh route to a single destination and centres the map on it. */
  navigateTo: (stop: BikerWaypoint) => void;
  clearRoute: () => void;
}

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

/**
 * Route origin, first match wins: the selected object, an OLT (the usual dispatch point), any other
 * equipment, then the project start point. The destination itself is never used as its own origin.
 */
function resolveOrigin(destination: BikerWaypoint): BikerWaypoint | null {
  const { equipment, projectStartPoint } = useNetworkStore.getState();
  const hubs = [...equipment.filter((e) => e.type === 'OLT'), ...equipment.filter((e) => e.type !== 'OLT')];
  const candidates: (BikerWaypoint | null)[] = [
    locationOf(useUiStore.getState().selectedObject),
    ...hubs.map(({ id, name, lat, lng }) => ({ id, name: name || id, lat, lng })),
    projectStartPoint
      ? { id: 'PROJECT-START', name: 'Project start point', lat: projectStartPoint[0], lng: projectStartPoint[1] }
      : null,
  ];
  const isElsewhere = (c: BikerWaypoint) =>
    c.id !== destination.id && (c.lat !== destination.lat || c.lng !== destination.lng);
  return candidates.find((c): c is BikerWaypoint => c !== null && isElsewhere(c)) ?? null;
}

const formatTrip = (route: RoadRoute) =>
  `${(route.distanceMeters / 1000).toFixed(2)} km · ~${Math.max(1, Math.ceil(route.durationSeconds / 60))} min`;

export const useBikerStore = create<BikerState>()((set, get) => {
  // Each plan gets an id so a slow response can't overwrite a newer route.
  let latestRequest = 0;

  const plan = async (stops: BikerWaypoint[]) => {
    const destination = stops[stops.length - 1];
    const origin = stops[0] ? resolveOrigin(stops[0]) : null;
    if (!destination || !origin) {
      showToast('warning', 'No Route Origin', 'Select a starting asset or add an OLT before planning a route.');
      return;
    }
    const request = ++latestRequest;
    const path = [origin, ...stops];
    const route = (await fetchRoadRoute(path)) ?? estimateRoadRoute(path);
    if (request !== latestRequest) return;

    set({
      route: {
        coordinates: route.coordinates,
        distanceMeters: route.distanceMeters,
        durationSeconds: route.durationSeconds,
        steps: route.steps,
        profile: 'driving',
        limitation: ROUTE_LIMITATIONS[route.source],
      },
    });
    showToast(
      'info',
      route.source === 'road' ? 'Road Route Ready' : 'Estimated Route Ready',
      `To ${destination.name} · ${formatTrip(route)}. The dashed orange line is the road route, not a fiber cable.`,
    );
  };

  return {
    isBikerMode: false,
    waypoints: [],
    route: null,

    setBikerMode: (isBikerMode) => set({ isBikerMode }),

    addWaypoint: (stop) => {
      const current = get().waypoints;
      const waypoints = current.some((p) => p.id === stop.id) ? current : [...current, stop];
      set({ waypoints });
      void plan(waypoints);
    },

    navigateTo: (stop) => {
      set({ waypoints: [stop] });
      void plan([stop]);
      useMapStore.getState().flyTo(stop.lat, stop.lng, 16);
    },

    clearRoute: () => {
      latestRequest++;
      set({ waypoints: [], route: null });
    },
  };
});
