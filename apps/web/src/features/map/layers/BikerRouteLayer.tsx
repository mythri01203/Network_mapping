import { useEffect, useMemo } from 'react';
import L from 'leaflet';

import { useBikerStore } from '../../../stores/bikerStore';
import { PANES } from '../leaflet/panes';
import { useLayerGroup } from '../leaflet/useLayerGroup';
import { type MarkerSpec, useMarkerLayer } from '../leaflet/useMarkerLayer';
import { formatDistance, routeStopIcon, tooltipHtml } from '../markerIcons';

const CASING = '#431407';
const ROUTE = '#f97316';
const LIVE_GPS_STROKE = '#0284c7';
const LIVE_GPS_FILL = '#38bdf8';
const SAVED_ROUTE_STROKE = '#10b981';

/** Marker icon for the live GPS bike technician */
function liveBikerIcon(_accuracy?: number) {
  return L.divIcon({
    className: 'live-gps-biker-marker',
    html: `
      <div class="relative flex items-center justify-center">
        <span class="absolute inline-flex h-8 w-8 animate-ping rounded-full bg-cyan-400 opacity-60"></span>
        <div class="relative flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-tr from-cyan-600 to-sky-400 text-white shadow-lg border-2 border-white">
          <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
            <circle cx="18.5" cy="17.5" r="3.5"/>
            <circle cx="5.5" cy="17.5" r="3.5"/>
            <circle cx="15" cy="5" r="1"/>
            <path d="M12 17.5V14l-3-3 4-3 2 3h2"/>
          </svg>
        </div>
      </div>
    `,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

/** The technician's live GPS route, saved routes, and road routes on the map canvas. */
export function BikerRouteLayer({ map }: { map: L.Map }) {
  const isBikerMode = useBikerStore((s) => s.isBikerMode);
  const route = useBikerStore((s) => s.route);
  const waypoints = useBikerStore((s) => s.waypoints);
  const livePosition = useBikerStore((s) => s.livePosition);
  const trackedCoordinates = useBikerStore((s) => s.trackedCoordinates);
  const activeSavedRoute = useBikerStore((s) => s.activeSavedRoute);
  const trackingStatus = useBikerStore((s) => s.trackingStatus);
  const distanceKm = useBikerStore((s) => s.distanceKm);

  const group = useLayerGroup(map);
  const activeRoute = isBikerMode && route !== null && route.coordinates.length > 1 ? route : null;

  useEffect(() => {
    group.clearLayers();

    // 1. Render Live GPS Tracked Path
    if (trackedCoordinates.length > 1) {
      // Glow casing
      L.polyline(trackedCoordinates, {
        pane: PANES.route,
        color: '#082f49',
        weight: 7,
        opacity: 0.7,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(group);

      // Bright live line
      L.polyline(trackedCoordinates, {
        pane: PANES.route,
        color: LIVE_GPS_STROKE,
        weight: 4,
        opacity: 1,
        lineCap: 'round',
        lineJoin: 'round',
      })
        .bindTooltip(
          tooltipHtml('Live Bike Route', [
            `Total: ${distanceKm.toFixed(2)} km`,
            `Points: ${trackedCoordinates.length} GPS coordinates`,
            `Status: ${trackingStatus}`,
          ]),
          { sticky: true, opacity: 1, className: 'gis-tooltip' },
        )
        .addTo(group);

      // Vertex dots
      trackedCoordinates.forEach((coord, i) => {
        if (i === 0 || i === trackedCoordinates.length - 1) return;
        L.circleMarker(coord, {
          pane: PANES.route,
          radius: 3,
          color: LIVE_GPS_STROKE,
          fillColor: LIVE_GPS_FILL,
          fillOpacity: 1,
          weight: 1.5,
        }).addTo(group);
      });
    }

    // 2. Render Live Rider Accuracy Ring & Location Marker
    if (livePosition && trackingStatus === 'recording') {
      if (livePosition.accuracy > 0 && livePosition.accuracy < 100) {
        L.circle([livePosition.lat, livePosition.lng], {
          pane: PANES.route,
          radius: livePosition.accuracy,
          color: '#38bdf8',
          fillColor: '#0ea5e9',
          fillOpacity: 0.12,
          weight: 1,
          dashArray: '4, 4',
        }).addTo(group);
      }

      L.marker([livePosition.lat, livePosition.lng], {
        pane: PANES.route,
        icon: liveBikerIcon(livePosition.accuracy),
        zIndexOffset: 1200,
      })
        .bindTooltip(
          tooltipHtml('Live Operator Position', [
            `Lat: ${livePosition.lat.toFixed(6)}, Lng: ${livePosition.lng.toFixed(6)}`,
            `Accuracy: ±${Math.round(livePosition.accuracy)}m`,
          ]),
          { sticky: true, opacity: 1, className: 'gis-tooltip' },
        )
        .addTo(group);
    }

    // 3. Render Loaded Previously Saved Route
    if (activeSavedRoute && activeSavedRoute.coordinates.length > 1) {
      L.polyline(activeSavedRoute.coordinates, {
        pane: PANES.route,
        color: '#064e3b',
        weight: 7,
        opacity: 0.7,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(group);

      L.polyline(activeSavedRoute.coordinates, {
        pane: PANES.route,
        color: SAVED_ROUTE_STROKE,
        weight: 4,
        dashArray: '8, 6',
        opacity: 1,
        lineCap: 'round',
        lineJoin: 'round',
      })
        .bindTooltip(
          tooltipHtml(`Saved Route: ${activeSavedRoute.name}`, [
            `Distance: ${activeSavedRoute.distanceKm.toFixed(2)} km`,
            `Duration: ${Math.round(activeSavedRoute.durationSeconds / 60)} min`,
            activeSavedRoute.notes || '',
          ]),
          { sticky: true, opacity: 1, className: 'gis-tooltip' },
        )
        .addTo(group);
    }

    // 4. Render Planned Road Navigation Route
    if (activeRoute) {
      L.polyline(activeRoute.coordinates, {
        pane: PANES.route,
        interactive: false,
        color: CASING,
        weight: 8,
        opacity: 0.85,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(group);

      const minutes = Math.max(1, Math.ceil(activeRoute.durationSeconds / 60));
      L.polyline(activeRoute.coordinates, {
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
            `${formatDistance(activeRoute.distanceMeters)} · about ${minutes} min`,
            activeRoute.limitation,
          ]),
          { sticky: true, opacity: 1, className: 'gis-tooltip' },
        )
        .addTo(group);
    }
  }, [map, group, trackedCoordinates, livePosition, trackingStatus, distanceKm, activeSavedRoute, activeRoute]);

  const stops = useMemo<MarkerSpec[]>(() => {
    if (!activeRoute) return [];
    const first = activeRoute.coordinates[0];
    const last = activeRoute.coordinates[activeRoute.coordinates.length - 1];
    return [
      { id: 'origin', latlng: first, icon: routeStopIcon('origin'), label: 'Origin' },
      ...waypoints.slice(0, -1).map((w, idx) => ({
        id: `stop-${idx}`,
        latlng: [w.lat, w.lng] as [number, number],
        icon: routeStopIcon('stop', String(idx + 1)),
        label: `Stop ${idx + 1}: ${w.name}`,
      })),
      { id: 'destination', latlng: last, icon: routeStopIcon('destination'), label: 'Destination' },
    ];
  }, [activeRoute, waypoints]);

  useMarkerLayer(map, stops, { pane: PANES.route });

  return null;
}
