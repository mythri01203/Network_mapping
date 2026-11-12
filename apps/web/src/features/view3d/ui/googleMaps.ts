/**
 * Loads the Google Maps JavaScript API once, when the person first opens the street photo. The
 * key comes from `VITE_GOOGLE_MAPS_KEY` (apps/web/.env.local, not in git). Only the few parts of
 * the API this app uses are typed here.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

interface GPanoData {
  location?: { pano?: string; latLng?: { lat(): number; lng(): number }; description?: string };
  imageDate?: string;
}

export interface GPanorama {
  setPano(id: string): void;
  setPov(pov: { heading: number; pitch: number }): void;
  setVisible(on: boolean): void;
  setOptions(options: Record<string, unknown>): void;
}

export interface GMap {
  setCenter(at: LatLng): void;
  setStreetView(pano: GPanorama): void;
}

export interface GMarker {
  setMap(target: GMap | GPanorama | null): void;
}

export interface GoogleMapsApi {
  Map: new (el: HTMLElement, options: Record<string, unknown>) => GMap;
  StreetViewPanorama: new (el: HTMLElement, options: Record<string, unknown>) => GPanorama;
  StreetViewService: new () => {
    getPanorama(request: { location: LatLng; radius: number; preference?: string }): Promise<{ data: GPanoData }>;
  };
  Marker: new (options: Record<string, unknown>) => GMarker;
  event: { trigger(target: unknown, name: string): void };
}

export const googleMapsKey = (): string => (import.meta.env.VITE_GOOGLE_MAPS_KEY as string | undefined)?.trim() ?? '';

let loading: Promise<GoogleMapsApi> | null = null;

/** Rejects with `no-key` when no key is set, `auth` when Google refuses the key, else `load`. */
export function loadGoogleMaps(): Promise<GoogleMapsApi> {
  if (loading) return loading;
  const key = googleMapsKey();
  if (!key) return Promise.reject(new Error('no-key'));
  loading = new Promise<GoogleMapsApi>((resolve, reject) => {
    const w = window as unknown as {
      google?: { maps?: GoogleMapsApi };
      __fibergisGoogleReady?: () => void;
      gm_authFailure?: () => void;
    };
    if (w.google?.maps?.Map) {
      resolve(w.google.maps);
      return;
    }
    w.__fibergisGoogleReady = () => {
      if (w.google?.maps) resolve(w.google.maps);
      else reject(new Error('load'));
    };
    // Google calls this when the key is wrong, restricted to another site, or has no billing.
    w.gm_authFailure = () => {
      loading = null;
      reject(new Error('auth'));
    };
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&callback=__fibergisGoogleReady`;
    script.async = true;
    script.onerror = () => {
      loading = null;
      reject(new Error('load'));
    };
    document.head.appendChild(script);
  });
  return loading;
}

/** Compass heading in degrees from one point to another (0 = north, 90 = east). */
export function headingBetween(from: LatLng, to: LatLng): number {
  const rad = Math.PI / 180;
  const dLng = (to.lng - from.lng) * rad;
  const y = Math.sin(dLng) * Math.cos(to.lat * rad);
  const x =
    Math.cos(from.lat * rad) * Math.sin(to.lat * rad) -
    Math.sin(from.lat * rad) * Math.cos(to.lat * rad) * Math.cos(dLng);
  return (((Math.atan2(y, x) / rad) % 360) + 360) % 360;
}
