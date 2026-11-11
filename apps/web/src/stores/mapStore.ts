import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { CableType, Equipment, EquipmentType, LatLng, LatLngBounds } from '@fibergis/shared';

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

/** Poles and their spans crowd the map when zoomed out, so they appear from street level in. A person can change it in Layers. */
export const DEFAULT_LAYER_MIN_ZOOM: Record<string, number> = { poles: 17, spans: 17 };

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
  otherEquipment: true,
  zones: true,
};

/** Which equipment layers show name labels. Poles and manholes are too many to label by default. */
export const DEFAULT_LAYER_LABELS: Record<string, boolean> = {
  olt: true,
  odf: true,
  fdms: true,
  fdt: true,
  fat: true,
  splitters: true,
  cableTv: true,
  otherEquipment: true,
  poles: false,
  manholes: false,
};

/** Labels appear once the map is this close, so they do not collide. */
export const DEFAULT_LABEL_MIN_ZOOM = 17;

/** Equipment pins from top to bottom where they overlap. OLTs on top, poles and manholes beneath. */
export const DEFAULT_EQUIPMENT_ORDER = ['olt', 'odf', 'fdms', 'fdt', 'fat', 'splitters', 'cableTv', 'otherEquipment', 'poles', 'manholes'];

/** A named set of layer choices and a place on the map, kept on this device for one person. */
export interface SavedMapView {
  id: string;
  name: string;
  /** The account that saved it ('' while login is off). Others on this device do not see it. */
  ownerId: string;
  createdAt: string;
  viewport: MapViewport;
  layers: Record<string, boolean>;
  layerOpacity: Record<string, number>;
  layerMinZoom: Record<string, number>;
  layerLabels: Record<string, boolean>;
  labelMinZoom: number;
  equipmentOrder: string[];
}

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

/**
 * What the line tool is drawing. A duct is a structure: it never becomes a cable. A zone is a boundary.
 * A placement line (Phase 3) only guides where a row of new items goes; it is never saved.
 */
export type DrawTarget = 'cable' | 'duct' | 'zone' | 'placement_line';

export interface MapState {
  activeTool: MapTool;
  drawTarget: DrawTarget;
  /** The structure a person chose as the duct's start with "Start duct here". */
  ductStartId: string | null;
  /** The zone whose boundary is being drawn. */
  zoneDrawId: string | null;
  /** A pending "show all of this" request; the map clears it once it has fitted the box. */
  fitBoundsTarget: LatLngBounds | null;
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
  /** A layer is drawn only from this zoom in (scale visibility). Absent: always. */
  layerMinZoom: Record<string, number>;
  layerLabels: Record<string, boolean>;
  labelMinZoom: number;
  equipmentOrder: string[];
  savedViews: SavedMapView[];
  tileProvider: TileProvider;

  setActiveTool: (tool: MapTool) => void;
  startDuct: (from: { id: string; lat: number; lng: number }) => void;
  startZoneBoundary: (zoneId: string) => void;
  /** Phase 3: draw a line to place a row of the item being added. Keeps the item and its template. */
  startPlacementLine: () => void;
  fitBounds: (bounds: LatLngBounds) => void;
  clearFitBounds: () => void;
  setLayerMinZoom: (layer: string, zoom: number | null) => void;
  setLayerLabel: (layer: string, on: boolean) => void;
  setLabelMinZoom: (zoom: number) => void;
  moveEquipmentLayer: (layer: string, direction: -1 | 1) => void;
  saveView: (view: SavedMapView) => void;
  deleteView: (id: string) => void;
  applyView: (view: SavedMapView) => void;
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

type MapPreferences = Pick<
  MapState,
  'layers' | 'layerOpacity' | 'tileProvider' | 'layerMinZoom' | 'layerLabels' | 'labelMinZoom' | 'equipmentOrder' | 'savedViews'
>;

/** The saved order, plus any layer added in a later release (in its default place). */
const completeOrder = (order: readonly string[] | undefined): string[] => {
  const known = (order ?? []).filter((k) => DEFAULT_EQUIPMENT_ORDER.includes(k));
  return [...known, ...DEFAULT_EQUIPMENT_ORDER.filter((k) => !known.includes(k))];
};

export const useMapStore = create<MapState>()(
  persist(
    (set) => ({
      activeTool: 'select',
      drawTarget: 'cable',
      ductStartId: null,
      zoneDrawId: null,
      fitBoundsTarget: null,
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
      layerMinZoom: DEFAULT_LAYER_MIN_ZOOM,
      layerLabels: DEFAULT_LAYER_LABELS,
      labelMinZoom: DEFAULT_LABEL_MIN_ZOOM,
      equipmentOrder: DEFAULT_EQUIPMENT_ORDER,
      savedViews: [],
      tileProvider: 'google_streets',

      // Picking any other tool ends a move, so a pin is never left draggable by accident.
      // Leaving the line tool also forgets a duct or zone being drawn, so the next line is a cable again.
      setActiveTool: (activeTool) =>
        set({
          activeTool,
          movingEquipmentId: null,
          ...(activeTool === 'draw_cable' ? {} : { drawTarget: 'cable' as const, ductStartId: null, zoneDrawId: null }),
        }),
      startZoneBoundary: (zoneId) =>
        set({ activeTool: 'draw_cable', drawTarget: 'zone', zoneDrawId: zoneId, ductStartId: null, drawingPoints: [], movingEquipmentId: null }),
      startPlacementLine: () =>
        set({ activeTool: 'draw_cable', drawTarget: 'placement_line', zoneDrawId: null, ductStartId: null, drawingPoints: [], movingEquipmentId: null }),
      fitBounds: (bounds) => set({ fitBoundsTarget: { ...bounds } }),
      clearFitBounds: () => set({ fitBoundsTarget: null }),
      setLayerMinZoom: (layer, zoom) =>
        set((s) => {
          const next = { ...s.layerMinZoom };
          // A layer with a default "show from" zoom keeps 0 for "always", so the default does not come back on reload.
          if (zoom === null) {
            if (layer in DEFAULT_LAYER_MIN_ZOOM) next[layer] = 0;
            else delete next[layer];
          } else next[layer] = zoom;
          return { layerMinZoom: next };
        }),
      setLayerLabel: (layer, on) => set((s) => ({ layerLabels: { ...s.layerLabels, [layer]: on } })),
      setLabelMinZoom: (labelMinZoom) => set({ labelMinZoom: Math.min(20, Math.max(12, Math.round(labelMinZoom))) }),
      moveEquipmentLayer: (layer, direction) =>
        set((s) => {
          const order = [...s.equipmentOrder];
          const i = order.indexOf(layer);
          const j = i + direction;
          if (i < 0 || j < 0 || j >= order.length) return {};
          [order[i], order[j]] = [order[j], order[i]];
          return { equipmentOrder: order };
        }),
      saveView: (view) => set((s) => ({ savedViews: [...s.savedViews.filter((v) => v.id !== view.id), view] })),
      deleteView: (id) => set((s) => ({ savedViews: s.savedViews.filter((v) => v.id !== id) })),
      applyView: (view) =>
        set({
          layers: { ...DEFAULT_LAYERS, ...view.layers },
          layerOpacity: { ...DEFAULT_LAYER_OPACITY, ...view.layerOpacity },
          layerMinZoom: { ...view.layerMinZoom },
          layerLabels: { ...DEFAULT_LAYER_LABELS, ...view.layerLabels },
          labelMinZoom: view.labelMinZoom,
          equipmentOrder: completeOrder(view.equipmentOrder),
          flyToTarget: { lat: view.viewport.lat, lng: view.viewport.lng, zoom: view.viewport.zoom },
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
        set({ drawingPoints: [], measuringPoints: [], cableDraftDefaults: null, drawTarget: 'cable', ductStartId: null, zoneDrawId: null }),
    }),
    {
      name: preferenceKey('map'),
      storage: preferenceStorage,
      version: 1,
      partialize: ({ layers, layerOpacity, tileProvider, layerMinZoom, layerLabels, labelMinZoom, equipmentOrder, savedViews }): MapPreferences => ({
        layers,
        layerOpacity,
        tileProvider,
        layerMinZoom,
        layerLabels,
        labelMinZoom,
        equipmentOrder,
        savedViews,
      }),
      // Merge nested maps so layers added in later releases keep their defaults.
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<MapPreferences>;
        return {
          ...current,
          ...(saved.tileProvider ? { tileProvider: saved.tileProvider } : {}),
          layers: { ...current.layers, ...saved.layers },
          layerOpacity: { ...current.layerOpacity, ...saved.layerOpacity },
          layerMinZoom: { ...DEFAULT_LAYER_MIN_ZOOM, ...saved.layerMinZoom },
          layerLabels: { ...current.layerLabels, ...saved.layerLabels },
          ...(typeof saved.labelMinZoom === 'number' ? { labelMinZoom: saved.labelMinZoom } : {}),
          equipmentOrder: completeOrder(saved.equipmentOrder),
          savedViews: Array.isArray(saved.savedViews) ? saved.savedViews : [],
        };
      },
    },
  ),
);
