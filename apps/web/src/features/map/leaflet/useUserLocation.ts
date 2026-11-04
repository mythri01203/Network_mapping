import { useCallback, useEffect, useRef, useState } from 'react';
import L from 'leaflet';

import { showToast } from '../../../stores/toastStore';
import { gpsIcon, tooltipHtml } from '../markerIcons';
import { useLayerGroup } from './useLayerGroup';

/** Readings less precise than this are flagged so field staff double-check positions. */
const LOW_ACCURACY_METERS = 80;
const LOCATE_ZOOM = 17;

const GEO_OPTIONS: PositionOptions = { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 };

function locationError(error: GeolocationPositionError): string {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return 'Location access was denied. Allow it from the address bar and try again.';
    case error.POSITION_UNAVAILABLE:
      return 'Your position is currently unavailable.';
    case error.TIMEOUT:
      return 'The location request timed out.';
    default:
      return 'Could not retrieve your location.';
  }
}

/**
 * Browser geolocation. `locate()` shows the user's position with an accuracy circle
 * and flies the map to it.
 */
export function useUserLocation(map: L.Map) {
  const group = useLayerGroup(map);
  const [isLocating, setIsLocating] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const showPosition = useCallback(
    (lat: number, lng: number, accuracy: number) => {
      group.clearLayers();
      L.circle([lat, lng], {
        radius: Math.max(accuracy, 25),
        interactive: false,
        color: '#2563eb',
        fillColor: '#3b82f6',
        fillOpacity: 0.12,
        weight: 1.5,
        dashArray: '4, 4',
      }).addTo(group);
      L.marker([lat, lng], { icon: gpsIcon(), zIndexOffset: 1500, keyboard: false })
        .bindTooltip(
          tooltipHtml('Your location', [`${lat.toFixed(6)}, ${lng.toFixed(6)}`, `±${Math.round(accuracy)} m`]),
          { direction: 'top', opacity: 1, className: 'gis-tooltip' },
        )
        .addTo(group);
    },
    [group],
  );

  const locate = useCallback(() => {
    if (!('geolocation' in navigator)) {
      showToast('error', 'Location unavailable', 'This browser does not support geolocation.');
      return;
    }
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (!mounted.current) return;
        setIsLocating(false);
        const { latitude, longitude } = coords;
        const accuracy = Math.round(coords.accuracy);
        showPosition(latitude, longitude, coords.accuracy);
        map.flyTo([latitude, longitude], LOCATE_ZOOM, { duration: 1.5 });
        if (coords.accuracy > LOW_ACCURACY_METERS) {
          showToast('warning', 'Low location accuracy', `Your position is accurate to about ±${accuracy} m.`);
        } else {
          showToast('success', 'Location found', `${latitude.toFixed(6)}, ${longitude.toFixed(6)} (±${accuracy} m)`);
        }
      },
      (error) => {
        if (!mounted.current) return;
        setIsLocating(false);
        showToast('error', 'Location error', locationError(error));
      },
      GEO_OPTIONS,
    );
  }, [map, showPosition]);

  return { locate, isLocating };
}
