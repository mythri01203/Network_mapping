import { type Cable, type CableInstallationType, type CableType, type Equipment, metersPerPixel } from '@fibergis/shared';

import type { NetworkMode } from '../../stores/uiStore';

export type EquipmentLayerKey = 'olt' | 'odf' | 'fdms' | 'fdt' | 'fat' | 'splitters' | 'poles' | 'manholes' | 'cableTv';

/** Layer for equipment whose type is none of the known ones (custom catalogue items), so it can be hidden too. */
export const OTHER_EQUIPMENT_LAYER = 'otherEquipment';

/** The layer toggle for a piece of equipment: a known kind, or "other". Every pin has one. */
export function equipmentLayerOf(eq: Pick<Equipment, 'type' | 'category'>): string {
  return equipmentLayerKey(eq) ?? OTHER_EQUIPMENT_LAYER;
}

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
  /** The map zoom, for layers shown only from a zoom in (scale visibility). */
  zoom?: number;
  layerMinZoom?: Record<string, number>;
}

/** False when the map is zoomed out past the layer's "show from" zoom. */
export const shownAtZoom = (layer: string, zoom: number | undefined, layerMinZoom: Record<string, number> | undefined): boolean =>
  zoom === undefined || layerMinZoom?.[layer] === undefined || zoom >= layerMinZoom[layer];

/** OLTs are grouped into the two PON families; 10G-EPON is EPON, everything else (XGS-PON, Combo) is GPON. */
export function oltFamily(eq: Pick<Equipment, 'technology'>): OltFamily {
  return (eq.technology ?? 'GPON').includes('EPON') ? 'EPON' : 'GPON';
}

export function isEquipmentVisible(eq: Equipment, { networkMode, layers, oltFilter, zoom, layerMinZoom }: LayerVisibility): boolean {
  if (networkMode === 'Fiber' && eq.category === 'Cable TV Infrastructure') return false;
  if (networkMode === 'CableTV' && eq.category === 'Central Office' && eq.type !== 'OLT') return false;
  if (eq.type === 'OLT' && oltFilter !== 'All' && oltFamily(eq) !== oltFilter) return false;
  const layer = equipmentLayerOf(eq);
  return layers[layer] !== false && shownAtZoom(layer, zoom, layerMinZoom);
}

export type CableLayerKey =
  'feederCable' | 'distributionCable' | 'dropCable' | 'undergroundCable' | 'aerialCable' | 'coaxialCable';

/** What the cable does: one toggle per role. */
const CABLE_ROLE_LAYERS: Partial<Record<CableType, CableLayerKey>> = {
  'Main Feeder Fiber': 'feederCable',
  'Distribution Fiber': 'distributionCable',
  'Drop Fiber': 'dropCable',
  'Coaxial Cable': 'coaxialCable',
};

/** The role toggle for a cable type, or null when the type names no role (such as "Aerial Fiber"). */
export function cableLayerKey(type: CableType): CableLayerKey | null {
  return CABLE_ROLE_LAYERS[type] ?? null;
}

/**
 * How the cable is installed: from its recorded installation type. Only when that is not recorded
 * does an older type name ("Aerial Fiber", "Underground Fiber") say it. Null when nothing says.
 */
export function cableInstallLayer(cable: Pick<Cable, 'type' | 'installationType'>): 'aerialCable' | 'undergroundCable' | null {
  const method = cable.installationType;
  if (method) return methodLayer(method);
  if (cable.type === 'Aerial Fiber') return 'aerialCable';
  if (cable.type === 'Underground Fiber') return 'undergroundCable';
  return null;
}

type InstallLayer = 'aerialCable' | 'undergroundCable';

function methodLayer(method: CableInstallationType): InstallLayer | null {
  if (method === 'Aerial' || method === 'Facade') return 'aerialCable';
  if (method === 'Underground' || method === 'Duct' || method === 'Direct Buried') return 'undergroundCable';
  return null;
}

/**
 * Network mapping Phase 6: every install layer a cable belongs to. Without stretch records it is the
 * one above. When its stretches record install methods, the cable is in the layer of each of them
 * and of its own method: a cable on poles for one stretch and in a duct for the next is in both the
 * aerial and the underground layer. The line is still drawn whole, once.
 */
export function cableInstallLayers(cable: Pick<Cable, 'type' | 'installationType'>, segmentMethods?: readonly CableInstallationType[]): InstallLayer[] {
  const own = cableInstallLayer(cable);
  const layers = new Set<InstallLayer>(own ? [own] : []);
  for (const method of segmentMethods ?? []) {
    const layer = methodLayer(method);
    if (layer) layers.add(layer);
  }
  return [...layers];
}

/** Every toggle that applies to a cable: its role and its install method(s). */
export function cableLayersOf(cable: Pick<Cable, 'type' | 'installationType'>, segmentMethods?: readonly CableInstallationType[]): CableLayerKey[] {
  return [cableLayerKey(cable.type), ...cableInstallLayers(cable, segmentMethods)].filter((k): k is CableLayerKey => k !== null);
}

/**
 * Hiding the role layer hides the cable. Hiding its install layer hides it too; a cable in two
 * install layers (mixed stretches) stays on the map while either of them is shown.
 */
export function isCableVisible(
  cable: Cable,
  { networkMode, layers, zoom, layerMinZoom, segmentMethods }: Omit<LayerVisibility, 'oltFilter'> & { segmentMethods?: ReadonlyMap<string, readonly CableInstallationType[]> },
): boolean {
  if (networkMode === 'Fiber' && cable.cableCategory === 'Coaxial') return false;
  if (networkMode === 'CableTV' && cable.cableCategory === 'Fiber') return false;
  const shown = (layer: string) => layers[layer] !== false && shownAtZoom(layer, zoom, layerMinZoom);
  const role = cableLayerKey(cable.type);
  if (role && !shown(role)) return false;
  const install = cableInstallLayers(cable, segmentMethods?.get(cable.id));
  return install.length === 0 || install.some(shown);
}

export interface SnapTarget {
  id: string;
  name: string;
  lat: number;
  lng: number;
  distanceMeters: number;
}

export const SNAP_RADIUS_METERS = 30;
/** How close on screen the pointer must be to snap, whatever the zoom. */
export const SNAP_RADIUS_PIXELS = 24;

/**
 * The snap distance at this zoom: about a fingertip on screen, never more than 30 m on the ground.
 * Zoomed out, a fixed 30 m would cover several poles; zoomed in it would be far too small to hit.
 */
export function snapRadiusMeters(lat: number, zoom: number): number {
  return Math.min(SNAP_RADIUS_METERS, Math.max(1, SNAP_RADIUS_PIXELS * metersPerPixel(lat, zoom)));
}

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
