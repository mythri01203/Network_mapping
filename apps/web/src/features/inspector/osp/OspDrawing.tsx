import { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import L from 'leaflet';
import { Check, CornerUpLeft, X } from 'lucide-react';

import { footprintProblem, type LatLng, polygonAreaSqMeters, polylineLengthMeters } from '@fibergis/shared';

import { useNetworkStore } from '../../../stores/networkStore';
import { setBuildingFootprint, setSpanRoute } from '../../../stores/ospActions';
import { useOspUiStore } from '../../../stores/ospUiStore';
import { showToast } from '../../../stores/toastStore';
import { useUiStore } from '../../../stores/uiStore';
import { PANES } from '../../map/leaflet/panes';

/**
 * Phase 4: drawing a span's bends or a building's outline. While it runs, a see-through layer over
 * the map takes every tap as a point, so a tap on a cable or a pin never selects it by mistake; the
 * map still pans and zooms. Nothing is saved until Finish.
 */

const DRAW_PANE = 'osp-draw';
const PREVIEW = '#1d4ed8';

const btn =
  'flex min-h-[48px] shrink-0 items-center justify-center gap-1.5 rounded-lg px-3 text-[14px] font-semibold disabled:pointer-events-none disabled:opacity-40 md:min-h-[40px] md:text-[13px]';

export function OspDrawing({ map }: { map: L.Map }) {
  const draw = useOspUiStore((s) => s.draw);
  const points = useOspUiStore((s) => s.points);
  const span = useNetworkStore((s) => (draw?.kind === 'spanRoute' ? s.spans.find((x) => x.id === draw.spanId) : undefined));
  const building = useNetworkStore((s) => (draw?.kind === 'footprint' ? s.buildings.find((b) => b.id === draw.buildingId) : undefined));
  const from = useNetworkStore((s) => (span ? s.equipment.find((e) => e.id === span.fromStructureId) : undefined));
  const to = useNetworkStore((s) => (span ? s.equipment.find((e) => e.id === span.toStructureId) : undefined));

  // The record went away while drawing (deleted, or another user's change): stop quietly.
  const target = draw?.kind === 'spanRoute' ? span && from && to : building;
  useEffect(() => {
    if (draw && !target) useOspUiStore.getState().stopDraw();
  }, [draw, target]);

  // Taps become points.
  useEffect(() => {
    if (!draw) return;
    const pane = map.getPane(DRAW_PANE) ?? map.createPane(DRAW_PANE);
    pane.style.zIndex = '640';
    const catcher = L.rectangle(
      [
        [-85, -180],
        [85, 180],
      ],
      { pane: DRAW_PANE, stroke: false, fillColor: '#000000', fillOpacity: 0.01, interactive: true, bubblingMouseEvents: false, className: 'osp-draw-catcher' },
    );
    catcher.on('click', (e: L.LeafletMouseEvent) => useOspUiStore.getState().addPoint([e.latlng.lat, e.latlng.lng]));
    catcher.addTo(map);
    map.getContainer().classList.add('cursor-crosshair');
    return () => {
      catcher.remove();
      map.getContainer().classList.remove('cursor-crosshair');
    };
  }, [draw, map]);

  // What will be saved, drawn as it grows.
  const shape: LatLng[] = useMemo(() => {
    if (draw?.kind === 'spanRoute' && from && to) return [[from.lat, from.lng], ...points, [to.lat, to.lng]];
    return points;
  }, [draw, from, to, points]);

  useEffect(() => {
    if (!draw || shape.length === 0) return;
    const layers: L.Layer[] = [];
    if (draw.kind === 'footprint' && shape.length >= 3) {
      layers.push(L.polygon(shape, { pane: PANES.sketch, color: PREVIEW, weight: 2, dashArray: '6 6', fillOpacity: 0.1, interactive: false }));
    } else if (shape.length >= 2) {
      layers.push(L.polyline(shape, { pane: PANES.sketch, color: PREVIEW, weight: 3, dashArray: '6 6', interactive: false }));
    }
    for (const p of points) layers.push(L.circleMarker(p, { pane: PANES.sketch, radius: 6, color: PREVIEW, weight: 2, fillColor: '#ffffff', fillOpacity: 1, interactive: false }));
    for (const layer of layers) layer.addTo(map);
    return () => {
      for (const layer of layers) layer.remove();
    };
  }, [draw, shape, points, map]);

  if (!draw || !target) return null;

  const isSpan = draw.kind === 'spanRoute';
  const enough = isSpan ? points.length >= 1 : points.length >= 3;
  const measure = isSpan ? `about ${Math.round(polylineLengthMeters(shape))} m along the line` : points.length >= 3 ? `about ${Math.round(polygonAreaSqMeters(points))} m²` : 'tap at least 3 corners';

  const finish = () => {
    const ui = useUiStore.getState();
    if (isSpan && span) {
      if (!setSpanRoute(span.id, points)) return;
      useOspUiStore.getState().stopDraw();
      const latest = useNetworkStore.getState().spans.find((s) => s.id === span.id);
      if (latest) ui.select({ type: 'span', data: latest });
    } else if (building) {
      const problem = footprintProblem(points);
      if (problem) {
        showToast('warning', 'Outline not finished', problem);
        return;
      }
      if (!setBuildingFootprint(building.id, points)) return;
      useOspUiStore.getState().stopDraw();
      const entry = building.entryEquipmentId ? useNetworkStore.getState().equipment.find((e) => e.id === building.entryEquipmentId) : undefined;
      if (entry) ui.select({ type: 'equipment', data: entry });
    }
    if (window.innerWidth >= 768) ui.setPanelOpen('right', true);
  };

  return createPortal(
    <div className="fixed inset-x-2 bottom-[calc(env(safe-area-inset-bottom)+12px)] z-[1500] md:inset-x-auto md:left-1/2 md:w-[560px] md:-translate-x-1/2" data-testid="osp-draw-bar">
      <div className="space-y-2 rounded-xl bg-slate-900/95 p-3 text-white shadow-xl ring-1 ring-white/10">
        <div>
          <div className="text-[15px] font-semibold">{isSpan ? `Draw the line of span ${span?.name}` : `Draw the outline of ${building?.name}`}</div>
          <div className="text-[13px] text-slate-300">
            {isSpan
              ? `Tap each bend between ${from?.name} and ${to?.name}, in order. The two ends stay on the poles.`
              : 'Tap each corner of the building, going round it. The last corner joins the first.'}
          </div>
          <div className="mt-1 text-[13px] text-slate-200" data-testid="osp-draw-count">
            {points.length} point{points.length === 1 ? '' : 's'} · {measure}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <button type="button" className={`${btn} bg-white/10 text-slate-100 hover:bg-white/20`} disabled={points.length === 0} onClick={() => useOspUiStore.getState().undoPoint()} data-testid="osp-draw-undo">
            <CornerUpLeft size={18} /> Undo point
          </button>
          <button type="button" className={`${btn} bg-white/10 text-slate-100 hover:bg-white/20`} onClick={() => useOspUiStore.getState().stopDraw()} data-testid="osp-draw-cancel">
            <X size={18} /> Cancel
          </button>
          <button type="button" className={`${btn} bg-blue-600 text-white hover:bg-blue-500`} disabled={!enough} onClick={finish} data-testid="osp-draw-finish">
            <Check size={18} /> Finish
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
