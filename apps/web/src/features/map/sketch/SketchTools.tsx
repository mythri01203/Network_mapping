import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';

import type { Equipment, LatLng } from '@fibergis/shared';

import { isTypingTarget } from '../../../lib/browser';
import { useMapStore } from '../../../stores/mapStore';
import { addEquipment, setCustomerLocation } from '../../../stores/networkActions';
import { useNetworkStore } from '../../../stores/networkStore';
import { placeEquipmentChecked } from '../../../stores/ospActions';
import { showToast } from '../../../stores/toastStore';
import { useUiStore } from '../../../stores/uiStore';
import { findSnapTarget, type SnapTarget } from '../layerFilters';
import { PANES } from '../leaflet/panes';
import { useLayerGroup } from '../leaflet/useLayerGroup';
import { MapModeBar } from '../MapToolbar';
import { categoryForType, pathLengthMeters } from '../markerIcons';
import { nextPoleName } from './poleNaming';

const DRAW = { line: '#0284c7', vertex: '#2563eb', endpoint: '#3b82f6' };
const MEASURE = { line: '#f59e0b', vertex: '#d97706' };
const SNAP = { stroke: '#10b981', fill: '#34d399' };

function placePole(lat: number, lng: number): Equipment | null {
  return addEquipment({
    name: nextPoleName(useNetworkStore.getState().equipment),
    type: 'Telecom Pole',
    lat,
    lng,
    category: 'Supporting Infrastructure',
  });
}

/** Draws the in-progress sketch (vertices, committed path and the rubber-band segment to the pointer). */
function useSketchPreview(map: L.Map, points: LatLng[], pointer: LatLng | null, mode: 'draw' | 'measure' | null) {
  const group = useLayerGroup(map);
  const rubberBand = useRef<L.Polyline | null>(null);

  useEffect(() => {
    group.clearLayers();
    rubberBand.current = null;
    if (!mode || points.length === 0) return;
    const colors = mode === 'draw' ? DRAW : MEASURE;
    const dash = mode === 'draw' ? '6, 6' : '4, 4';
    const options = { pane: PANES.sketch, interactive: false };

    L.polyline(points, { ...options, color: colors.line, weight: mode === 'draw' ? 4 : 3, dashArray: dash }).addTo(
      group,
    );
    rubberBand.current = L.polyline([], {
      ...options,
      color: colors.line,
      weight: 2,
      dashArray: dash,
      opacity: 0.6,
    }).addTo(group);
    points.forEach((point, index) => {
      const isEnd = index === 0 || index === points.length - 1;
      L.circleMarker(point, {
        ...options,
        radius: mode === 'draw' && isEnd ? 7 : 5,
        color: colors.vertex,
        fillColor: mode === 'measure' ? MEASURE.line : isEnd ? DRAW.endpoint : '#ffffff',
        fillOpacity: 1,
        weight: 2,
      }).addTo(group);
    });
  }, [group, points, mode]);

  useEffect(() => {
    const last = points[points.length - 1];
    rubberBand.current?.setLatLngs(last && pointer ? [last, pointer] : []);
  }, [points, pointer]);
}

function useSnapRing(map: L.Map, target: SnapTarget | null) {
  const group = useLayerGroup(map);
  useEffect(() => {
    group.clearLayers();
    if (!target) return;
    L.circleMarker([target.lat, target.lng], {
      pane: PANES.sketch,
      interactive: false,
      radius: 13,
      color: SNAP.stroke,
      fillColor: SNAP.fill,
      fillOpacity: 0.25,
      weight: 2.5,
    }).addTo(group);
  }, [group, target]);
}

export interface SketchToolsProps {
  map: L.Map;
  /** Equipment the pointer may snap onto (only what is visible on the map). */
  snapCandidates: Equipment[];
}

/**
 * Map interaction for the drawing, measuring and placement tools, plus click-to-deselect in select mode.
 * Renders the contextual mode bar with distance, snapping and finish/cancel controls.
 */
export function SketchTools({ map, snapCandidates }: SketchToolsProps) {
  const activeTool = useMapStore((s) => s.activeTool);
  const drawingPoints = useMapStore((s) => s.drawingPoints);
  const measuringPoints = useMapStore((s) => s.measuringPoints);
  const pickingOnuCustomer = useUiStore((s) => s.pickingOnuCustomer);
  const setPickingOnuCustomer = useUiStore((s) => s.setPickingOnuCustomer);
  const wizardPicking = useUiStore((s) => s.customerWizardPicking);
  const movingId = useMapStore((s) => s.movingEquipmentId);
  const movingName = useNetworkStore((s) => (movingId ? s.equipment.find((e) => e.id === movingId)?.name : undefined));
  const [trackedPointer, setPointer] = useState<LatLng | null>(null);
  const [trackedSnap, setSnapTarget] = useState<SnapTarget | null>(null);
  const [autoPole, setAutoPole] = useState(false);

  const sketching = activeTool === 'draw_cable' || activeTool === 'measure' || activeTool === 'add_equipment';
  const mode = activeTool === 'draw_cable' ? 'draw' : activeTool === 'measure' ? 'measure' : null;
  const points = useMemo(
    () => (mode === 'draw' ? drawingPoints : mode === 'measure' ? measuringPoints : []),
    [mode, drawingPoints, measuringPoints],
  );
  // Pointer tracking only runs while sketching; outside it any stale value is ignored.
  const pointer = sketching ? trackedPointer : null;
  const snapTarget = sketching ? trackedSnap : null;

  const latest = useRef({ snapCandidates, autoPole });
  useEffect(() => {
    latest.current = { snapCandidates, autoPole };
  });

  useEffect(() => {
    const snap = (latlng: L.LatLng) => {
      const target = findSnapTarget(latest.current.snapCandidates, latlng.lat, latlng.lng);
      return { target, point: (target ? [target.lat, target.lng] : [latlng.lat, latlng.lng]) as LatLng };
    };

    const onClick = (e: L.LeafletMouseEvent) => {
      const store = useMapStore.getState();
      const ui = useUiStore.getState();

      // A tap on a pin reports the pin's position; for a house, read where the finger really was.
      const tapped = () => map.mouseEventToLatLng(e.originalEvent);

      if (ui.customerWizardPicking) {
        const { lat, lng } = tapped();
        ui.setCustomerWizardPick({ lat, lng });
        return;
      }

      if (ui.pickingOnuCustomer) {
        const cust = ui.pickingOnuCustomer;
        const { lat, lng } = tapped();
        ui.setPickingOnuCustomer(null);
        if (!setCustomerLocation(cust.id, { lat, lng, method: 'map_pick' })) return;
        // A customer already on a box is connected; only an unconnected one goes on to splicing.
        if (!cust.terminalBoxId) ui.openSpliceModal({ ...cust, lat, lng });
        return;
      }

      // While a pin is being moved, a stray tap must not clear the selection.
      if (store.movingEquipmentId) return;

      if (store.activeTool === 'select') {
        ui.select(null);
        ui.setPanelOpen('right', false);
        return;
      }

      const { target, point } = snap(e.latlng);
      // Only routes join equipment. New equipment snapping would land hidden on top of its neighbour.
      setSnapTarget(store.activeTool === 'add_equipment' ? null : target);

      if (store.activeTool === 'draw_cable') {
        store.setDrawingPoints((prev) => [...prev, point]);
        if (latest.current.autoPole && !target) placePole(point[0], point[1]);
      } else if (store.activeTool === 'measure') {
        store.setMeasuringPoints((prev) => [...prev, point]);
      } else if (store.activeTool === 'add_equipment' && store.equipmentTypeToAdd) {
        const type = store.equipmentTypeToAdd;
        const tpl = store.equipmentDraftTemplate;
        // A click on a marker reports the marker's position, so read the pointer itself.
        const { lat: placeLat, lng: placeLng } = map.mouseEventToLatLng(e.originalEvent);
        const isPole = type.includes('Pole');
        // Poles always get the next free number: a template name would give every pole the same one.
        const name = isPole
          ? nextPoleName(useNetworkStore.getState().equipment)
          : tpl?.name || (type === 'Fiber Slack Loop' ? 'Fiber Slack Loop' : `New ${type}`);
        const totalPorts = tpl?.totalPorts;

        // "Same one?" first when an item of the same kind is already this close. It never blocks.
        void placeEquipmentChecked({
          type,
          category: tpl?.category || categoryForType(type),
          totalPorts,
          availablePorts: totalPorts,
          notes: tpl?.notes,
          ...tpl,
          name,
          lat: placeLat,
          lng: placeLng,
          locationMethod: 'map_pick',
        }).then((created) => {
          if (created && isPole) {
            // Stay in the pole tool: a street of poles is one tap each until Done.
            ui.select({ type: 'equipment', data: created });
          } else if (created) {
            ui.select({ type: 'equipment', data: created });
            // On a phone the inspector would cover the map; a tap on the pin opens it.
            if (window.innerWidth >= 768) ui.setPanelOpen('right', true);
            store.setActiveTool('select');
            store.setEquipmentTypeToAdd(null);
            store.setEquipmentDraftTemplate(null);
            if (created.type === 'OLT') {
              ui.openOltConfigModal(created);
            }
          }
        });
      }
    };

    const onMouseMove = (e: L.LeafletMouseEvent) => {
      const tool = useMapStore.getState().activeTool;
      if (tool !== 'draw_cable' && tool !== 'measure' && tool !== 'add_equipment') return;
      const { target, point } = snap(e.latlng);
      setPointer(point);
      const shownTarget = tool === 'add_equipment' ? null : target;
      setSnapTarget((prev) => (prev?.id === shownTarget?.id ? prev : shownTarget));
    };

    const onMouseOut = () => setPointer(null);

    map.on('click', onClick);
    map.on('mousemove', onMouseMove);
    map.on('mouseout', onMouseOut);
    return () => {
      map.off('click', onClick);
      map.off('mousemove', onMouseMove);
      map.off('mouseout', onMouseOut);
    };
  }, [map]);

  useSketchPreview(map, points, pointer, mode);
  useSnapRing(map, snapTarget);

  const distanceMeters = useMemo(
    () => (mode ? pathLengthMeters(pointer && points.length > 0 ? [...points, pointer] : points) : 0),
    [mode, points, pointer],
  );

  const addPole = useCallback(() => {
    const store = useMapStore.getState();
    const anchor = store.drawingPoints[store.drawingPoints.length - 1] ?? pointer;
    if (!anchor) {
      showToast('warning', 'No point to place a pole', 'Click the map to start the route, then add a pole.');
      return;
    }
    if (store.drawingPoints.length === 0) store.setDrawingPoints([anchor]);
    // The last point may sit on an existing pole, so ask "same one?" before adding another there.
    void placeEquipmentChecked({
      name: nextPoleName(useNetworkStore.getState().equipment),
      type: 'Telecom Pole',
      lat: anchor[0],
      lng: anchor[1],
      category: 'Supporting Infrastructure',
    });
  }, [pointer]);

  useEffect(() => {
    if (activeTool !== 'draw_cable') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      if (e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        addPole();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeTool, addPole]);

  const finish = useCallback(() => {
    const map = useMapStore.getState();
    if (map.drawingPoints.length < 2) {
      showToast('warning', 'Route incomplete', 'Click at least two points on the map to define the route.');
      return;
    }
    // A duct is a structure with its own form; it never becomes a cable.
    useUiStore.getState().setModalOpen(map.drawTarget === 'duct' ? 'ductForm' : 'cableWizard', true);
  }, []);

  const cancel = useCallback(() => {
    const store = useMapStore.getState();
    store.resetSketches();
    store.setActiveTool('select');
    store.setEquipmentTypeToAdd(null);
    store.setEquipmentDraftTemplate(null);
  }, []);

  useEffect(() => {
    if (!movingId && !wizardPicking) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      useMapStore.getState().setMovingEquipmentId(null);
      if (useUiStore.getState().customerWizardPicking) useUiStore.getState().setCustomerWizardPicking(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [movingId, wizardPicking]);

  const banner =
    'absolute inset-x-2 top-2 z-[1000] flex flex-wrap items-center gap-3 rounded-xl border border-sky-400/50 bg-slate-900/95 px-4 py-2.5 text-white shadow-2xl backdrop-blur-sm md:inset-x-auto md:left-1/2 md:top-16 md:-translate-x-1/2';
  const bannerButton =
    'ml-auto h-[48px] rounded-md bg-white/15 px-4 text-[13px] font-semibold text-white transition-colors hover:bg-white/25 md:h-8 md:px-3 md:text-[12px]';

  return (
    <>
      {pickingOnuCustomer && (
        <div className={banner} role="status">
          <div className="text-[13px]">
            Tap the map where <strong>{pickingOnuCustomer.name}</strong> is.
          </div>
          <button type="button" onClick={() => setPickingOnuCustomer(null)} className={bannerButton}>
            Cancel
          </button>
        </div>
      )}
      {wizardPicking && (
        <div className={banner} role="status">
          <div className="text-[13px]">Tap the customer’s house on the map.</div>
          <button
            type="button"
            onClick={() => useUiStore.getState().setCustomerWizardPicking(false)}
            className={bannerButton}
          >
            Cancel
          </button>
        </div>
      )}
      {movingId && (
        <div className={banner} role="status">
          <div className="text-[13px]">
            Drag <strong>{movingName ?? movingId}</strong> to its new place. Its cable ends move with it.
          </div>
          <button
            type="button"
            onClick={() => useMapStore.getState().setMovingEquipmentId(null)}
            className={bannerButton}
          >
            Cancel move
          </button>
        </div>
      )}
      <MapModeBar
        distanceMeters={distanceMeters}
        snapTargetName={snapTarget?.name ?? null}
        autoPole={autoPole}
        onAutoPoleChange={setAutoPole}
        onAddPole={addPole}
        onFinish={finish}
        onCancel={cancel}
      />
    </>
  );
}
