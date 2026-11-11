import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import L from 'leaflet';
import { Check, CornerUpLeft, Scissors, Undo2, X } from 'lucide-react';

import { type Equipment, type LatLng, polylineLengthMeters } from '@fibergis/shared';

import { useMapStore } from '../../../stores/mapStore';
import { useNetworkStore } from '../../../stores/networkStore';
import { useUiStore } from '../../../stores/uiStore';
import { editCableLine, editDuctLine } from '../../cables/cableRouteActions';
import { SplitCableDialog } from '../../cables/SplitCableDialog';
import { findSnapTarget, snapRadiusMeters, type SnapTarget } from '../layerFilters';
import { PANES } from '../leaflet/panes';
import { ROUTE_TOOL_HINTS, ROUTE_TOOL_LABELS, type RouteTool, useRouteEditStore } from './routeEditStore';

/**
 * Phase 5: changing a cable's or duct's line on the map, by taps only. A see-through layer takes
 * every tap on the map, so nothing else is selected by mistake; the points of the line sit above it
 * as big numbered dots. Each finished action is one undoable change. Snapping only places a point on
 * a pin; it never connects anything.
 */

const CATCH_PANE = 'route-edit-catch';
const POINT_PANE = 'route-edit-points';
const LINE = '#7c3aed';
const PICKED = '#f59e0b';

const btn =
  'flex min-h-[48px] shrink-0 items-center justify-center gap-1.5 rounded-lg px-3 text-[14px] font-semibold disabled:pointer-events-none disabled:opacity-40 md:min-h-[44px] md:text-[13px]';

function pointIcon(label: string, state: 'end' | 'inner' | 'picked'): L.DivIcon {
  const fill = state === 'picked' ? PICKED : state === 'end' ? LINE : '#ffffff';
  const text = state === 'inner' ? LINE : '#ffffff';
  // 44 px hit area around an 24 px dot, so a finger can find it.
  return L.divIcon({
    className: 'route-edit-point',
    iconSize: [44, 44],
    iconAnchor: [22, 22],
    html: `<div style="width:44px;height:44px;display:flex;align-items:center;justify-content:center"><div style="width:24px;height:24px;border-radius:9999px;border:3px solid ${state === 'picked' ? PICKED : LINE};background:${fill};color:${text};font:700 11px/18px system-ui;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.4)">${label}</div></div>`,
  });
}

export function RouteEditor({ map, snapCandidates }: { map: L.Map; snapCandidates: readonly Equipment[] }) {
  const target = useRouteEditStore((s) => s.target);
  const tool = useRouteEditStore((s) => s.tool);
  const picked = useRouteEditStore((s) => s.picked);
  const extendEnd = useRouteEditStore((s) => s.extendEnd);
  const extendPoints = useRouteEditStore((s) => s.extendPoints);
  const splitIndex = useRouteEditStore((s) => s.splitIndex);
  const busy = useRouteEditStore((s) => s.busy);
  const cable = useNetworkStore((s) => (target?.kind === 'cable' ? s.cables.find((c) => c.id === target.id) : undefined));
  const duct = useNetworkStore((s) => (target?.kind === 'duct' ? (s.ducts ?? []).find((d) => d.id === target.id) : undefined));
  const record = cable ?? duct;
  const line: LatLng[] = useMemo(() => record?.coordinates ?? [], [record]);
  const [snap, setSnap] = useState<SnapTarget | null>(null);

  // The record went away (deleted, undone, someone else's change): stop quietly.
  useEffect(() => {
    if (target && !record) useRouteEditStore.getState().stop();
  }, [target, record]);

  // Leaving the map screen or selecting something else ends editing.
  const selected = useUiStore((s) => s.selectedObject);
  useEffect(() => {
    if (!target || !record) return;
    if (!selected || selected.data.id !== record.id) useRouteEditStore.getState().stop();
  }, [selected, target, record]);

  // Picking a drawing or placing tool ends editing, so two tools never take the same tap.
  const activeTool = useMapStore((s) => s.activeTool);
  useEffect(() => {
    if (target && activeTool !== 'select') useRouteEditStore.getState().stop();
  }, [target, activeTool]);

  const latest = useRef({ snapCandidates, line });
  useEffect(() => {
    latest.current = { snapCandidates, line };
  });

  const apply = useCallback(
    async (edit: Parameters<typeof editCableLine>[1]) => {
      const store = useRouteEditStore.getState();
      const t = store.target;
      if (!t || store.busy) return false;
      store.setBusy(true);
      try {
        return t.kind === 'cable' ? await editCableLine(t.id, edit) : await editDuctLine(t.id, edit);
      } finally {
        useRouteEditStore.getState().setBusy(false);
      }
    },
    [],
  );

  const placeAt = useCallback(
    (latlng: L.LatLng): LatLng => {
      const radius = snapRadiusMeters(latlng.lat, map.getZoom());
      const hit = findSnapTarget(latest.current.snapCandidates, latlng.lat, latlng.lng, radius);
      setSnap(hit);
      return hit ? [hit.lat, hit.lng] : [latlng.lat, latlng.lng];
    },
    [map],
  );

  // Taps on the map (not on a point).
  useEffect(() => {
    if (!target) return;
    const pane = map.getPane(CATCH_PANE) ?? map.createPane(CATCH_PANE);
    pane.style.zIndex = '640';
    const points = map.getPane(POINT_PANE) ?? map.createPane(POINT_PANE);
    points.style.zIndex = '660';
    const catcher = L.rectangle(
      [
        [-85, -180],
        [85, 180],
      ],
      { pane: CATCH_PANE, stroke: false, fillColor: '#000000', fillOpacity: 0.01, interactive: true, bubblingMouseEvents: false, className: 'route-edit-catcher' },
    );
    catcher.on('click', (e: L.LeafletMouseEvent) => {
      const store = useRouteEditStore.getState();
      if (store.busy || store.splitIndex !== null) return;
      const point = placeAt(e.latlng);
      if (store.tool === 'move' && store.picked !== null) {
        const index = store.picked;
        void apply({ kind: 'move', index, to: point }).then((done) => done && useRouteEditStore.getState().pick(null));
      } else if (store.tool === 'insert') {
        void apply({ kind: 'insert', point });
      } else if (store.tool === 'extend' && store.extendEnd) {
        store.addExtendPoint(point);
      }
    });
    catcher.addTo(map);
    map.getContainer().classList.add('cursor-crosshair');
    return () => {
      catcher.remove();
      map.getContainer().classList.remove('cursor-crosshair');
    };
  }, [target, map, apply, placeAt]);

  // The line, the tapped extension and the numbered points.
  useEffect(() => {
    if (!target || line.length === 0) return;
    const layers: L.Layer[] = [];
    layers.push(L.polyline(line, { pane: PANES.sketch, color: LINE, weight: 6, opacity: 0.85, interactive: false }));
    if (extendEnd && extendPoints.length) {
      const from = extendEnd === 'end' ? line[line.length - 1] : line[0];
      layers.push(L.polyline([from, ...extendPoints], { pane: PANES.sketch, color: LINE, weight: 4, dashArray: '6 6', interactive: false }));
      for (const p of extendPoints) layers.push(L.circleMarker(p, { pane: PANES.sketch, radius: 6, color: LINE, weight: 2, fillColor: '#ffffff', fillOpacity: 1, interactive: false }));
    }
    line.forEach((p, index) => {
      const isEnd = index === 0 || index === line.length - 1;
      const marker = L.marker(p, {
        pane: POINT_PANE,
        icon: pointIcon(String(index + 1), picked === index ? 'picked' : isEnd ? 'end' : 'inner'),
        keyboard: false,
        bubblingMouseEvents: false,
      });
      marker.on('click', () => {
        const store = useRouteEditStore.getState();
        if (store.busy || store.splitIndex !== null) return;
        if (store.tool === 'move' || store.tool === 'trim') store.pick(store.picked === index ? null : index);
        else if (store.tool === 'remove') void apply({ kind: 'remove', index });
        else if (store.tool === 'split') store.askSplit(index);
      });
      layers.push(marker);
    });
    for (const layer of layers) layer.addTo(map);
    return () => {
      for (const layer of layers) layer.remove();
    };
  }, [target, line, picked, extendEnd, extendPoints, map, apply]);

  if (!target || !record) return null;

  const store = useRouteEditStore.getState();
  const tools: RouteTool[] = target.kind === 'cable' ? ['move', 'insert', 'remove', 'extend', 'trim', 'split'] : ['move', 'insert', 'remove', 'extend', 'trim'];
  const length = Math.round(polylineLengthMeters(line));
  const startName = cable ? cable.startEquipmentId : duct?.fromStructureId;
  const endName = cable ? cable.endEquipmentId : duct?.toStructureId;
  const equipmentName = (id: string | undefined) => (id ? (useNetworkStore.getState().equipment.find((e) => e.id === id)?.name ?? id) : 'not connected');

  let hint = ROUTE_TOOL_HINTS[tool];
  if (tool === 'move' && picked !== null) hint = `Now tap the new place for point ${picked + 1}.`;
  if (tool === 'trim' && picked !== null) hint = `Point ${picked + 1} chosen. Which end is cut off?`;
  if (tool === 'extend' && extendEnd) hint = `Tap each new point beyond the ${extendEnd === 'end' ? 'To' : 'From'} end. ${extendPoints.length} tapped.`;

  const finishExtend = async () => {
    const s = useRouteEditStore.getState();
    if (!s.extendEnd || s.extendPoints.length === 0) return;
    if (await apply({ kind: 'extend', end: s.extendEnd, points: s.extendPoints })) useRouteEditStore.getState().setExtendEnd(null);
  };

  const trim = async (remove: 'start' | 'end') => {
    const s = useRouteEditStore.getState();
    if (s.picked === null) return;
    if (await apply({ kind: 'trim', index: s.picked, remove })) useRouteEditStore.getState().pick(null);
  };

  return createPortal(
    <>
      <div className="fixed inset-x-2 bottom-[calc(env(safe-area-inset-bottom)+12px)] z-[1500] md:inset-x-auto md:left-1/2 md:w-[620px] md:-translate-x-1/2" data-testid="route-edit-bar">
        <div className="max-h-[60vh] space-y-2 overflow-y-auto rounded-xl bg-slate-900/95 p-3 text-white shadow-xl ring-1 ring-white/10">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[15px] font-semibold">Change the line of {record.name}</div>
              <div className="text-[13px] text-slate-300">
                {length.toLocaleString()} m on the map · {line.length} points · From {equipmentName(startName)} to {equipmentName(endName)}
              </div>
            </div>
            <button type="button" className={`${btn} bg-blue-600 text-white hover:bg-blue-500`} onClick={() => store.stop()} data-testid="route-edit-done">
              <Check size={18} /> Done
            </button>
          </div>

          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="What to do">
            {tools.map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={tool === t}
                onClick={() => store.setTool(t)}
                className={`${btn} ${tool === t ? 'bg-white text-slate-900' : 'bg-white/10 text-slate-100 hover:bg-white/20'}`}
                data-testid={`route-tool-${t}`}
              >
                {t === 'split' && <Scissors size={16} />}
                {ROUTE_TOOL_LABELS[t]}
              </button>
            ))}
          </div>

          <p className="text-[14px] text-slate-100" role="status" data-testid="route-edit-hint">
            {hint}
          </p>
          {snap && (tool === 'move' || tool === 'insert' || tool === 'extend') && (
            <p className="text-[13px] text-emerald-300">Last point placed on {snap.name}. It is not connected to it.</p>
          )}

          {tool === 'extend' && !extendEnd && (
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className={`${btn} bg-white/10 hover:bg-white/20`} onClick={() => store.setExtendEnd('start')} data-testid="route-extend-start">
                From end ({equipmentName(startName)})
              </button>
              <button type="button" className={`${btn} bg-white/10 hover:bg-white/20`} onClick={() => store.setExtendEnd('end')} data-testid="route-extend-end">
                To end ({equipmentName(endName)})
              </button>
            </div>
          )}
          {tool === 'extend' && extendEnd && (
            <div className="grid grid-cols-3 gap-2">
              <button type="button" className={`${btn} bg-white/10 hover:bg-white/20`} disabled={extendPoints.length === 0} onClick={() => store.undoExtendPoint()}>
                <CornerUpLeft size={18} /> Undo point
              </button>
              <button type="button" className={`${btn} bg-white/10 hover:bg-white/20`} onClick={() => store.setExtendEnd(null)}>
                <X size={18} /> Cancel
              </button>
              <button type="button" className={`${btn} bg-blue-600 hover:bg-blue-500`} disabled={extendPoints.length === 0 || busy} onClick={() => void finishExtend()} data-testid="route-extend-finish">
                <Check size={18} /> Finish
              </button>
            </div>
          )}
          {tool === 'trim' && picked !== null && (
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className={`${btn} bg-white/10 hover:bg-white/20`} disabled={picked === 0 || busy} onClick={() => void trim('start')} data-testid="route-trim-start">
                Cut off the From side
              </button>
              <button type="button" className={`${btn} bg-white/10 hover:bg-white/20`} disabled={picked === line.length - 1 || busy} onClick={() => void trim('end')} data-testid="route-trim-end">
                Cut off the To side
              </button>
            </div>
          )}

          <div className="flex items-center gap-2 border-t border-white/10 pt-2">
            <button type="button" className={`${btn} bg-white/10 text-slate-100 hover:bg-white/20`} onClick={() => useNetworkStore.getState().undo()} data-testid="route-edit-undo">
              <Undo2 size={18} /> Undo last change
            </button>
            <span className="text-[12px] text-slate-400">Each change is saved at once. Sheath and OTDR lengths never change here.</span>
          </div>
        </div>
      </div>
      {cable && splitIndex !== null && <SplitCableDialog cable={cable} index={splitIndex} onClose={() => store.askSplit(null)} />}
    </>,
    document.body,
  );
}
