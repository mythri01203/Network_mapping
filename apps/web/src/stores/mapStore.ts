import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CableType, EquipmentType, LatLng } from '@fibergis/shared';
import { preferenceKey, preferenceStorage } from './persistStorage';

export type MapTool = 'select' | 'draw_cable' | 'add_equipment' | 'measure' | 'trace';
export type TileProvider = 'google_streets' | 'google_satellite' | 'osm';

export interface FlyToTarget {
  lat: number;
  lng: number;
  zoom?: number;
}

export const DEFAULT_FLY_TO_ZOOM = 17;

export const DEFAULT_LAYERS: Record<string, boolean> = {
  feederCable: true,
  distributionCable: true,
  dropCable: true,
  undergroundCable: true,
  aerialCable: true,
  coaxialCable: true,
  olt: true,
  odf: true,
  fdms: true,
  fdt: true,
  fat: true,
  splitters: true,
  poles: true,
  manholes: true,
  customers: true,
  cableTv: true,
  faults: true,
  labels: true,
};

export const DEFAULT_LAYER_OPACITY: Record<string, number> = {
  feederCable: 1,
  distributionCable: 1,
  dropCable: 1,
  undergroundCable: 0.9,
  aerialCable: 0.9,
  coaxialCable: 1,
  olt: 1,
  fdms: 1,
  fdt: 1,
  fat: 1,
  poles: 0.85,
  manholes: 0.85,
  customers: 1,
  cableTv: 1,
  faults: 1,
  labels: 1,
};

type PointsUpdater = LatLng[] | ((prev: LatLng[]) => LatLng[]);
const resolvePoints = (next: PointsUpdater, prev: LatLng[]) => (typeof next === 'function' ? next(prev) : next);

export interface MapState {
  activeTool: MapTool;
  equipmentTypeToAdd: EquipmentType | null;
  cableTypeToDraw: CableType;
  drawingPoints: LatLng[];
  measuringPoints: LatLng[];
  flyToTarget: FlyToTarget | null;
  isLayersDrawerOpen: boolean;
  // Preferences (persisted)
  layers: Record<string, boolean>;
  layerOpacity: Record<string, number>;
  tileProvider: TileProvider;

  setActiveTool: (tool: MapTool) => void;
  setEquipmentTypeToAdd: (type: EquipmentType | null) => void;
  setCableTypeToDraw: (type: CableType) => void;
  setDrawingPoints: (points: PointsUpdater) => void;
  setMeasuringPoints: (points: PointsUpdater) => void;
  flyTo: (lat: number, lng: number, zoom?: number) => void;
  setLayersDrawerOpen: (open: boolean) => void;
  toggleLayer: (layer: string) => void;
  setLayerOpacity: (layer: string, opacity: number) => void;
  setTileProvider: (provider: TileProvider) => void;
  /** Drops in-progress drawing and measuring (e.g. after the network is replaced). */
  resetSketches: () => void;
}

type MapPreferences = Pick<MapState, 'layers' | 'layerOpacity' | 'tileProvider'>;

export const useMapStore = create<MapState>()(
  persist(
    (set) => ({
      activeTool: 'select',
      equipmentTypeToAdd: null,
      cableTypeToDraw: 'Main Feeder Fiber',
      drawingPoints: [],
      measuringPoints: [],
      flyToTarget: null,
      isLayersDrawerOpen: false,
      layers: DEFAULT_LAYERS,
      layerOpacity: DEFAULT_LAYER_OPACITY,
      tileProvider: 'google_streets',

      setActiveTool: (activeTool) => set({ activeTool }),
      setEquipmentTypeToAdd: (equipmentTypeToAdd) => set({ equipmentTypeToAdd }),
      setCableTypeToDraw: (cableTypeToDraw) => set({ cableTypeToDraw }),
      setDrawingPoints: (points) => set((s) => ({ drawingPoints: resolvePoints(points, s.drawingPoints) })),
      setMeasuringPoints: (points) => set((s) => ({ measuringPoints: resolvePoints(points, s.measuringPoints) })),
      // A fresh object every call, so flying to the same spot twice still re-centres the map.
      flyTo: (lat, lng, zoom = DEFAULT_FLY_TO_ZOOM) => set({ flyToTarget: { lat, lng, zoom } }),
      setLayersDrawerOpen: (isLayersDrawerOpen) => set({ isLayersDrawerOpen }),
      toggleLayer: (layer) => set((s) => ({ layers: { ...s.layers, [layer]: !s.layers[layer] } })),
      setLayerOpacity: (layer, opacity) =>
        set((s) => ({ layerOpacity: { ...s.layerOpacity, [layer]: Math.min(1, Math.max(0, opacity)) } })),
      setTileProvider: (tileProvider) => set({ tileProvider }),
      resetSketches: () => set({ drawingPoints: [], measuringPoints: [] }),
    }),
    {
      name: preferenceKey('map'),
      storage: preferenceStorage,
      version: 1,
      partialize: ({ layers, layerOpacity, tileProvider }): MapPreferences => ({ layers, layerOpacity, tileProvider }),
      // Merge nested maps so layers added in later releases keep their defaults.
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<MapPreferences>;
        return {
          ...current,
          ...(saved.tileProvider ? { tileProvider: saved.tileProvider } : {}),
          layers: { ...current.layers, ...saved.layers },
          layerOpacity: { ...current.layerOpacity, ...saved.layerOpacity },
        };
      },
    },
  ),
);
