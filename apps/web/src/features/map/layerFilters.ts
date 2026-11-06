import type { Cable, CableType, Equipment } from '@fibergis/shared';

import type { NetworkMode } from '../../stores/uiStore';

export type EquipmentLayerKey = 'olt' | 'odf' | 'fdms' | 'fdt' | 'fat' | 'splitters' | 'poles' | 'manholes' | 'cableTv';

export function equipmentLayerKey(eq: Pick<Equipment, 'type' | 'category'>): EquipmentLayerKey | null {
  const t = eq.type;
  if (t === 'OLT' || t === 'MikroTik Router') return 'olt';
  if (eq.category === 'Cable TV Infrastructure' || t.startsWith('CATV') || t === 'Cable TV Headend') return 'cableTv';
  if (t === 'ODF' || t === 'Fiber Patch Panel') return 'odf';
  if (t === 'FDMS' || t === 'Fiber Distribution Cabinet') return 'fdms';
  if (t === 'FDT') return 'fdt';
  if (t === 'FAT' || t.includes('Terminal Box') || t === 'Distribution Point') return 'fat';
  if (t === 'Fiber Splitter' || t === 'Ratio Coupler' || t === 'Outdoor Splitter') return 'splitters';
  if (t.includes('Pole') || t === 'Fiber Slack Loop') return 'poles';
  if (t === 'Manhole' || t === 'Handhole' || t === 'Underground Chamber') return 'manholes';
  return null;
}

export type OltFilter = 'All' | 'GPON' | 'EPON';
export type OltFamily = Exclude<OltFilter, 'All'>;

export interface LayerVisibility {
  networkMode: NetworkMode;
  layers: Record<string, boolean>;
  oltFilter: OltFilter;
}

/** OLTs are grouped into the two PON families; 10G-EPON is EPON, everything else (XGS-PON, Combo) is GPON. */
export function oltFamily(eq: Pick<Equipment, 'technology'>): OltFamily {
  return (eq.technology ?? 'GPON').includes('EPON') ? 'EPON' : 'GPON';
}

export function isEquipmentVisible(eq: Equipment, { networkMode, layers, oltFilter }: LayerVisibility): boolean {
  if (networkMode === 'Fiber' && eq.category === 'Cable TV Infrastructure') return false;
  if (networkMode === 'CableTV' && eq.category === 'Central Office' && eq.type !== 'OLT') return false;
  if (eq.type === 'OLT' && oltFilter !== 'All' && oltFamily(eq) !== oltFilter) return false;
  const layer = equipmentLayerKey(eq);
  return layer === null || layers[layer] !== false;
}

export type CableLayerKey =
  'feederCable' | 'distributionCable' | 'dropCable' | 'undergroundCable' | 'aerialCable' | 'coaxialCable';

const CABLE_LAYER_KEYS: Partial<Record<CableType, CableLayerKey>> = {
  'Main Feeder Fiber': 'feederCable',
  'Distribution Fiber': 'distributionCable',
  'Drop Fiber': 'dropCable',
  'Underground Fiber': 'undergroundCable',
  'Aerial Fiber': 'aerialCable',
  'Coaxial Cable': 'coaxialCable',
};

/** The layer toggle that controls a cable type, or null for types that are always shown. */
export function cableLayerKey(type: CableType): CableLayerKey | null {
  return CABLE_LAYER_KEYS[type] ?? null;
}

export function isCableVisible(cable: Cable, { networkMode, layers }: Omit<LayerVisibility, 'oltFilter'>): boolean {
  if (networkMode === 'Fiber' && cable.cableCategory === 'Coaxial') return false;
  if (networkMode === 'CableTV' && cable.cableCategory === 'Fiber') return false;
  const layer = cableLayerKey(cable.type);
  return layer === null || layers[layer] !== false;
}

export interface SnapTarget {
  id: string;
  name: string;
  lat: number;
  lng: number;
  distanceMeters: number;
}

export const SNAP_RADIUS_METERS = 30;

/** Nearest equipment within `radiusMeters` of a point, using a local flat-earth approximation. */
export function findSnapTarget(
  equipment: readonly Pick<Equipment, 'id' | 'name' | 'lat' | 'lng'>[],
  lat: number,
  lng: number,
  radiusMeters = SNAP_RADIUS_METERS,
): SnapTarget | null {
  const metersPerDegree = 111_000;
  const lngScale = Math.cos((lat * Math.PI) / 180);
  let nearest: SnapTarget | null = null;
  for (const eq of equipment) {
    const dy = (eq.lat - lat) * metersPerDegree;
    const dx = (eq.lng - lng) * metersPerDegree * lngScale;
    const distanceMeters = Math.hypot(dx, dy);
    if (distanceMeters <= radiusMeters && (!nearest || distanceMeters < nearest.distanceMeters)) {
      nearest = { id: eq.id, name: eq.name, lat: eq.lat, lng: eq.lng, distanceMeters };
    }
  }
  return nearest;
}
