import { useEffect, useMemo } from 'react';
import L from 'leaflet';

import { useBikerStore } from '../../../stores/bikerStore';
import { PANES } from '../leaflet/panes';
import { useLayerGroup } from '../leaflet/useLayerGroup';
import { type MarkerSpec, useMarkerLayer } from '../leaflet/useMarkerLayer';
import { formatDistance, routeStopIcon, tooltipHtml } from '../markerIcons';

const CASING = '#431407';
const ROUTE = '#f97316';

/** The technician's road route (distinct from any cable path), with origin, stops and destination. */
export function BikerRouteLayer({ map }: { map: L.Map }) {
  const isBikerMode = useBikerStore((s) => s.isBikerMode);
  const route = useBikerStore((s) => s.route);
  const waypoints = useBikerStore((s) => s.waypoints);
  const group = useLayerGroup(map);
  const active = isBikerMode && route !== null && route.coordinates.length > 1 ? route : null;

  useEffect(() => {
    group.clearLayers();
    if (!active) return;

    L.polyline(active.coordinates, {
      pane: PANES.route,
      interactive: false,
      color: CASING,
      weight: 8,
      opacity: 0.85,
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(group);

    const minutes = Math.max(1, Math.ceil(active.durationSeconds / 60));
    L.polyline(active.coordinates, {
      pane: PANES.route,
      color: ROUTE,
      weight: 4.5,
      dashArray: '10, 8',
      opacity: 1,
      lineCap: 'round',
      lineJoin: 'round',
    })
      .bindTooltip(
        tooltipHtml('Road route', [
          `${formatDistance(active.distanceMeters)} · about ${minutes} min`,
          active.limitation,
        ]),
        { sticky: true, opacity: 1, className: 'gis-tooltip' },
      )
      .addTo(group);

    map.fitBounds(L.latLngBounds(active.coordinates), { padding: [70, 70], maxZoom: 17 });
  }, [map, group, active]);

  const stops = useMemo<MarkerSpec[]>(() => {
    if (!active) return [];
    const first = active.coordinates[0];
    const last = active.coordinates[active.coordinates.length - 1];
    const destination = waypoints[waypoints.length - 1];
    return [
      {
        id: 'origin',
        latlng: first,
        icon: routeStopIcon('origin'),
        tooltip: tooltipHtml('Departure', ['Technician start point']),
        label: 'Route origin',
        zIndexOffset: 1200,
      },
      ...waypoints.slice(0, -1).map((wp, index) => ({
        id: `stop-${wp.id}-${index}`,
        latlng: [wp.lat, wp.lng] as [number, number],
        icon: routeStopIcon('stop', String(index + 1)),
        tooltip: tooltipHtml(`Stop ${index + 1}`, [wp.name || wp.id]),
        label: `Route stop ${index + 1}`,
        zIndexOffset: 1200,
      })),
      {
        id: 'destination',
        latlng: last,
        icon: routeStopIcon('destination'),
        tooltip: tooltipHtml('Destination', [destination ? destination.name || destination.id : null]),
        label: 'Route destination',
        zIndexOffset: 1200,
      },
    ];
  }, [active, waypoints]);

  useMarkerLayer(map, stops);
  return null;
}
