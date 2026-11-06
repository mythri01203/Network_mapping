import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';

import type { Equipment, LatLng } from '@fibergis/shared';

import { isTypingTarget } from '../../../lib/browser';
import { useMapStore } from '../../../stores/mapStore';
import { addEquipment, updateCustomer } from '../../../stores/networkActions';
import { useNetworkStore } from '../../../stores/networkStore';
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

      if (ui.pickingOnuCustomer) {
        const cust = ui.pickingOnuCustomer;
        const lat = e.latlng.lat;
        const lng = e.latlng.lng;
        updateCustomer(cust.id, { lat, lng });
        ui.setPickingOnuCustomer(null);
        showToast('success', 'ONU Location Set', `Positioned ${cust.name}'s ONU at [${lat.toFixed(4)}, ${lng.toFixed(4)}].`);
        ui.openSpliceModal({ ...cust, lat, lng });
        return;
      }

      if (store.activeTool === 'select') {
        ui.select(null);
        ui.setPanelOpen('right', false);
        return;
      }

      const { target, point } = snap(e.latlng);
      setSnapTarget(target);

      if (store.activeTool === 'draw_cable') {
        store.setDrawingPoints((prev) => [...prev, point]);
        if (latest.current.autoPole && !target) placePole(point[0], point[1]);
      } else if (store.activeTool === 'measure') {
        store.setMeasuringPoints((prev) => [...prev, point]);
      } else if (store.activeTool === 'add_equipment' && store.equipmentTypeToAdd) {
        const type = store.equipmentTypeToAdd;
        const tpl = store.equipmentDraftTemplate;
        const isPole = type.includes('Pole');
        const defaultName = isPole
          ? nextPoleName(useNetworkStore.getState().equipment)
          : type === 'Fiber Slack Loop'
            ? 'Fiber Slack Loop (20m)'
            : `New ${type}`;
        const name = tpl?.name || defaultName;
        const totalPorts = tpl?.totalPorts;

        const created = addEquipment({
          name,
          type,
          lat: point[0],
          lng: point[1],
          category: tpl?.category || categoryForType(type),
          totalPorts,
          availablePorts: totalPorts,
          notes: tpl?.notes,
          ...tpl,
        });
        if (created) {
          showToast('success', `${type} Placed`, `Added ${created.name} at [${point[0].toFixed(5)}, ${point[1].toFixed(5)}].`);
          ui.select({ type: 'equipment', data: created });
          ui.setPanelOpen('right', true);
          store.setActiveTool('select');
          store.setEquipmentTypeToAdd(null);
          store.setEquipmentDraftTemplate(null);
          if (created.type === 'OLT') {
            ui.openOltConfigModal(created);
          }
        }
      }
    };

    const onMouseMove = (e: L.LeafletMouseEvent) => {
      const tool = useMapStore.getState().activeTool;
      if (tool !== 'draw_cable' && tool !== 'measure' && tool !== 'add_equipment') return;
      const { target, point } = snap(e.latlng);
      setPointer(point);
      setSnapTarget((prev) => (prev?.id === target?.id ? prev : target));
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
    placePole(anchor[0], anchor[1]);
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
    if (useMapStore.getState().drawingPoints.length < 2) {
      showToast('warning', 'Route incomplete', 'Click at least two points on the map to define the cable route.');
      return;
    }
    useUiStore.getState().setModalOpen('cableWizard', true);
  }, []);

  const cancel = useCallback(() => {
    const store = useMapStore.getState();
    store.resetSketches();
    store.setActiveTool('select');
  }, []);

  return (
    <>
      {pickingOnuCustomer && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-[1000] bg-slate-900/95 text-white px-4 py-2.5 rounded-xl shadow-2xl border border-sky-400/50 flex items-center gap-3 backdrop-blur-sm animate-in fade-in">
          <div className="w-2.5 h-2.5 rounded-full bg-sky-400 animate-ping" />
          <div className="text-xs">
            <span className="font-semibold text-sky-300">ONU Placement Mode:</span> Click map to drop pin for{' '}
            <strong>{pickingOnuCustomer.name}</strong> ({pickingOnuCustomer.ontSerialNumber})
          </div>
          <button
            type="button"
            onClick={() => setPickingOnuCustomer(null)}
            className="ml-3 px-2 py-0.5 rounded-md bg-white/10 hover:bg-white/20 text-white text-[11px] font-medium transition-colors"
          >
            Cancel
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
