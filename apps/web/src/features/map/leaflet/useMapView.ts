import { useCallback, useRef, useSyncExternalStore } from 'react';
import type L from 'leaflet';

import { type Bbox, padBox } from './clustering';

export interface MapView {
  zoom: number;
  /** The visible area grown by half its size on each side. */
  bbox: Bbox;
}

const WORLD: Bbox = [-180, -90, 180, 90];

function readView(map: L.Map): MapView {
  try {
    const b = map.getBounds();
    return { zoom: map.getZoom(), bbox: padBox([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]) };
  } catch {
    // Before the map has a size (first render, hidden tab) everything counts as in view.
    return { zoom: map.getZoom?.() ?? 0, bbox: WORLD };
  }
}

/** The map's zoom and padded visible area, updated when a pan or zoom ends. */
export function useMapView(map: L.Map): MapView {
  const cache = useRef<{ key: string; view: MapView } | null>(null);
  const subscribe = useCallback(
    (onChange: () => void) => {
      map.on('moveend zoomend resize', onChange);
      return () => {
        map.off('moveend zoomend resize', onChange);
      };
    },
    [map],
  );
  const snapshot = useCallback(() => {
    const view = readView(map);
    const key = `${view.zoom}|${view.bbox.map((v) => v.toFixed(5)).join(',')}`;
    if (cache.current?.key !== key) cache.current = { key, view };
    return cache.current.view;
  }, [map]);
  return useSyncExternalStore(subscribe, snapshot);
}
