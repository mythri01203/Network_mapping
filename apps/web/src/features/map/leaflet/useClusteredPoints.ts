import { useCallback, useMemo } from 'react';
import L from 'leaflet';

import { groupMarkerIcon } from '../markerIcons';
import { buildPointIndex, type MapPoint, pointsInView } from './clustering';
import { useMapView } from './useMapView';
import { type MarkerSpec, useMarkerLayer } from './useMarkerLayer';

const plural = (count: number, kind: 'equipment' | 'customer') =>
  kind === 'customer' ? `${count} customers` : `${count} network items`;

/**
 * Which of `points` to draw as their own pin in the current view, and draws the groups for the
 * rest (Phase 9). `keep` ids are always drawn as pins.
 */
export function useClusteredPoints(
  map: L.Map,
  points: readonly MapPoint[],
  keep: ReadonlySet<string>,
  kind: 'equipment' | 'customer',
): ReadonlySet<string> {
  const view = useMapView(map);
  const index = useMemo(() => buildPointIndex(points), [points]);
  const result = useMemo(() => pointsInView(index, view.bbox, view.zoom, keep), [index, view, keep]);

  const groups = useMemo<MarkerSpec[]>(
    () =>
      result.groups.map((g) => ({
        id: `${kind}:${g.key}:${g.count}`,
        latlng: [g.lat, g.lng],
        icon: groupMarkerIcon(g.count, kind),
        tooltip: `${plural(g.count, kind)} here. Tap to zoom in.`,
        label: `${plural(g.count, kind)} here. Tap to zoom in.`,
        zIndexOffset: 200,
      })),
    [result.groups, kind],
  );
  const byId = useMemo(() => new Map(groups.map((g, i) => [g.id, result.groups[i]])), [groups, result.groups]);

  const onClick = useCallback(
    (id: string, event: L.LeafletMouseEvent) => {
      const group = byId.get(id);
      if (!group) return;
      // A group is not a real place: never let its tap join a cable or place a pin.
      L.DomEvent.stopPropagation(event);
      map.setView([group.lat, group.lng], Math.max(group.expansionZoom, map.getZoom() + 1));
    },
    [byId, map],
  );
  useMarkerLayer(map, groups, { onClick });

  return useMemo(() => new Set(result.singles), [result.singles]);
}
