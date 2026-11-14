import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import L from 'leaflet';

import { DEFAULT_FLY_TO_ZOOM, useMapStore } from '../../../stores/mapStore';
import { createPanes } from './panes';
import { TILE_PROVIDERS } from './tileProviders';

/** The map on screen, for the on-screen guide's demo, which taps it the way a person would. */
let liveMap: L.Map | null = null;
export const activeLeafletMap = () => liveMap;

/**
 * Owns the Leaflet map instance for a container element.
 *
 * The map is created and destroyed from a callback ref (not an effect) so React StrictMode's
 * simulated effect re-runs never tear down a live map.
 */
export function useLeafletMap() {
  const [map, setMap] = useState<L.Map | null>(null);
  const mapRef = useRef<L.Map | null>(null);

  const containerRef = useCallback((node: HTMLDivElement | null) => {
    if (node && !mapRef.current) {
      const { viewport } = useMapStore.getState();
      const instance = L.map(node, {
        center: [viewport.lat, viewport.lng],
        zoom: viewport.zoom,
        zoomControl: false,
        attributionControl: false,
      });
      L.control.attribution({ prefix: false, position: 'bottomright' }).addTo(instance);
      createPanes(instance);
      mapRef.current = instance;
      liveMap = instance;
      setMap(instance);
    } else if (!node && mapRef.current) {
      if (liveMap === mapRef.current) liveMap = null;
      mapRef.current.remove();
      mapRef.current = null;
      setMap(null);
    }
  }, []);

  useBaseLayer(map);
  usePersistViewport(map);
  useAutoResize(map);
  useFlyToRequests(map);
  useFitBoundsRequests(map);

  return { map, containerRef };
}

/** "Show all of this": fits a box on screen, with room around it, never closer than street level. */
function useFitBoundsRequests(map: L.Map | null) {
  const target = useMapStore((s) => s.fitBoundsTarget);
  useEffect(() => {
    if (!map || !target) return;
    const bounds = L.latLngBounds([target.south, target.west], [target.north, target.east]);
    map.flyToBounds(bounds, { padding: [48, 48], maxZoom: 18, duration: 1.2 });
    useMapStore.getState().clearFitBounds();
  }, [map, target]);
}

function useBaseLayer(map: L.Map | null) {
  const tileProvider = useMapStore((s) => s.tileProvider);
  useEffect(() => {
    if (!map) return;
    const { url, ...options } = TILE_PROVIDERS[tileProvider] ?? TILE_PROVIDERS.google_streets;
    const layer = L.tileLayer(url, options).addTo(map);
    return () => {
      layer.remove();
    };
  }, [map, tileProvider]);
}

function usePersistViewport(map: L.Map | null) {
  useEffect(() => {
    if (!map) return;
    const onMoveEnd = () => {
      const center = map.getCenter();
      useMapStore.getState().setViewport({ lat: center.lat, lng: center.lng, zoom: map.getZoom() });
    };
    map.on('moveend', onMoveEnd);
    return () => {
      map.off('moveend', onMoveEnd);
    };
  }, [map]);
}

/** Keeps Leaflet's size cache in sync when side panels open, close or resize the container. */
function useAutoResize(map: L.Map | null) {
  useEffect(() => {
    if (!map) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => map.invalidateSize({ pan: false }));
    });
    observer.observe(map.getContainer());
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [map]);
}

function useFlyToRequests(map: L.Map | null) {
  const target = useMapStore((s) => s.flyToTarget);
  useEffect(() => {
    if (!map || !target) return;
    map.flyTo([target.lat, target.lng], target.zoom ?? DEFAULT_FLY_TO_ZOOM, { duration: 1.2 });
    useMapStore.getState().clearFlyTo();
  }, [map, target]);
}

/** Current zoom level, re-rendering the caller only when it changes. */
export function useMapZoom(map: L.Map): number {
  const subscribe = useCallback(
    (onChange: () => void) => {
      map.on('zoomend', onChange);
      return () => {
        map.off('zoomend', onChange);
      };
    },
    [map],
  );
  return useSyncExternalStore(subscribe, () => map.getZoom());
}
