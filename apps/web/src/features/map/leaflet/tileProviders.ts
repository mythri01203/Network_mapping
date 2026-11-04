import type { TileProvider } from '../../../stores/mapStore';

export interface TileProviderConfig {
  url: string;
  maxZoom: number;
  subdomains?: string[];
  attribution: string;
}

const GOOGLE_SUBDOMAINS = ['mt0', 'mt1', 'mt2', 'mt3'];

export const TILE_PROVIDERS: Record<TileProvider, TileProviderConfig> = {
  google_streets: {
    url: 'https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
    maxZoom: 21,
    subdomains: GOOGLE_SUBDOMAINS,
    attribution: '&copy; Google',
  },
  // Hybrid: satellite imagery with road labels.
  google_satellite: {
    url: 'https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
    maxZoom: 21,
    subdomains: GOOGLE_SUBDOMAINS,
    attribution: '&copy; Google',
  },
  osm: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  },
};
