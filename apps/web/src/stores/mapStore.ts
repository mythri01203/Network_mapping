import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { CableType, Equipment, EquipmentType, LatLng } from '@fibergis/shared';

import { preferenceKey, preferenceStorage } from './persistStorage';

export type MapTool = 'select' | 'draw_cable' | 'add_equipment' | 'measure' | 'trace';
export type TileProvider = 'google_streets' | 'google_satellite' | 'osm';

export interface FlyToTarget {
  lat: number;
  lng: number;
  zoom?: number;
}

export interface MapViewport {
  lat: number;
  lng: number;
  zoom: number;
}

export const DEFAULT_FLY_TO_ZOOM = 17;
export const DEFAULT_VIEWPORT: MapViewport = { lat: 12.9385, lng: 77.6275, zoom: 16 };

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
  spans: true,
  ducts: true,
  slackLoops: true,
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

/** Settings chosen before drawing that the cable wizard starts from. */
export interface CableDraftDefaults {
  startEquipmentId?: string;
  endEquipmentId?: string;
  startPortName?: string;
  endPortName?: string;
  fiberCount?: number;
  colorHex?: string;
}

/** What the line tool is drawing. A duct is a structure: it never becomes a cable. */
export type DrawTarget = 'cable' | 'duct';

export interface MapState {
  activeTool: MapTool;
  drawTarget: DrawTarget;
  /** The structure a person chose as the duct's start with "Start duct here". */
  ductStartId: string | null;
  cableDraftDefaults: CableDraftDefaults | null;
  equipmentTypeToAdd: EquipmentType | null;
  equipmentDraftTemplate: Partial<Equipment> | null;
  cableTypeToDraw: CableType;
  drawingPoints: LatLng[];
  measuringPoints: LatLng[];
  /** A pending camera move; the map clears it once it has flown there. */
  flyToTarget: FlyToTarget | null;
  /** Last camera position, so the map reopens where the user left it after visiting another view. */
  viewport: MapViewport;
  isLayersDrawerOpen: boolean;
  /** Equipment whose pin may be dragged right now. Pins are fixed unless a person chose "Move this item". */
  movingEquipmentId: string | null;
  // Preferences (persisted)
  layers: Record<string, boolean>;
  layerOpacity: Record<string, number>;
  tileProvider: TileProvider;

  setActiveTool: (tool: MapTool) => void;
  startDuct: (from: { id: string; lat: number; lng: number }) => void;
  setMovingEquipmentId: (id: string | null) => void;
  setEquipmentTypeToAdd: (type: EquipmentType | null) => void;
  setEquipmentDraftTemplate: (template: Partial<Equipment> | null) => void;
  setCableTypeToDraw: (type: CableType) => void;
  setCableDraftDefaults: (defaults: CableDraftDefaults | null) => void;
  setDrawingPoints: (points: PointsUpdater) => void;
  setMeasuringPoints: (points: PointsUpdater) => void;
  flyTo: (lat: number, lng: number, zoom?: number) => void;
  clearFlyTo: () => void;
  setViewport: (viewport: MapViewport) => void;
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
      drawTarget: 'cable',
      ductStartId: null,
      cableDraftDefaults: null,
      equipmentTypeToAdd: null,
      equipmentDraftTemplate: null,
      cableTypeToDraw: 'Main Feeder Fiber',
      drawingPoints: [],
      measuringPoints: [],
      flyToTarget: null,
      viewport: DEFAULT_VIEWPORT,
      isLayersDrawerOpen: false,
      movingEquipmentId: null,
      layers: DEFAULT_LAYERS,
      layerOpacity: DEFAULT_LAYER_OPACITY,
      tileProvider: 'google_streets',

      // Picking any other tool ends a move, so a pin is never left draggable by accident.
      // Leaving the line tool also forgets a duct being drawn, so the next line is a cable again.
      setActiveTool: (activeTool) =>
        set({
          activeTool,
          movingEquipmentId: null,
          ...(activeTool === 'draw_cable' ? {} : { drawTarget: 'cable' as const, ductStartId: null }),
        }),
      startDuct: (from) =>
        set({
          activeTool: 'draw_cable',
          drawTarget: 'duct',
          ductStartId: from.id,
          drawingPoints: [[from.lat, from.lng]],
          movingEquipmentId: null,
        }),
      setMovingEquipmentId: (movingEquipmentId) => set({ movingEquipmentId }),
      setEquipmentTypeToAdd: (equipmentTypeToAdd) => set({ equipmentTypeToAdd }),
      setEquipmentDraftTemplate: (equipmentDraftTemplate) => set({ equipmentDraftTemplate }),
      setCableTypeToDraw: (cableTypeToDraw) => set({ cableTypeToDraw }),
      setCableDraftDefaults: (cableDraftDefaults) => set({ cableDraftDefaults }),
      setDrawingPoints: (points) => set((s) => ({ drawingPoints: resolvePoints(points, s.drawingPoints) })),
      setMeasuringPoints: (points) => set((s) => ({ measuringPoints: resolvePoints(points, s.measuringPoints) })),
      // A fresh object every call, so flying to the same spot twice still re-centres the map.
      flyTo: (lat, lng, zoom = DEFAULT_FLY_TO_ZOOM) => set({ flyToTarget: { lat, lng, zoom } }),
      clearFlyTo: () => set({ flyToTarget: null }),
      setViewport: (viewport) => set({ viewport }),
      setLayersDrawerOpen: (isLayersDrawerOpen) => set({ isLayersDrawerOpen }),
      toggleLayer: (layer) => set((s) => ({ layers: { ...s.layers, [layer]: !s.layers[layer] } })),
      setLayerOpacity: (layer, opacity) =>
        set((s) => ({ layerOpacity: { ...s.layerOpacity, [layer]: Math.min(1, Math.max(0, opacity)) } })),
      setTileProvider: (tileProvider) => set({ tileProvider }),
      resetSketches: () =>
        set({ drawingPoints: [], measuringPoints: [], cableDraftDefaults: null, drawTarget: 'cable', ductStartId: null }),
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
