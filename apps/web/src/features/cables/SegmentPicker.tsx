import { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import L from 'leaflet';
import { CornerUpLeft, X } from 'lucide-react';

import { lineBetween, pointToLine } from '@fibergis/shared';

import { selectOspSettings, useNetworkStore } from '../../stores/networkStore';
import { showToast } from '../../stores/toastStore';
import { useUiStore } from '../../stores/uiStore';
import { PANES } from '../map/leaflet/panes';
import { useSegmentPickStore } from './segmentPickStore';

/**
 * Network mapping Phase 6: "tap two points on the cable" for a stretch, and the stretch shown on the
 * map from the cable panel. While tapping, a see-through layer takes every tap, so a tap never
 * selects another cable or pin; the map still pans and zooms. A tap away from the cable's drawn line
 * (beyond the "Poles near this line" setting) is refused with what to do. Nothing is saved here.
 */

const PICK_PANE = 'segment-pick';
const PICK = '#7c3aed';

const btn =
  'flex min-h-[48px] shrink-0 items-center justify-center gap-1.5 rounded-lg px-3 text-[14px] font-semibold disabled:pointer-events-none disabled:opacity-40 md:min-h-[40px] md:text-[13px]';

export function SegmentPicker({ map }: { map: L.Map }) {
  const job = useSegmentPickStore((s) => s.job);
  const taps = useSegmentPickStore((s) => s.taps);
  const highlight = useSegmentPickStore((s) => s.highlight);
  const cableId = job?.cableId ?? highlight?.cableId;
  const cable = useNetworkStore((s) => (cableId ? s.cables.find((c) => c.id === cableId) : undefined));
  const corridor = useNetworkStore((s) => selectOspSettings(s).attachmentCorridorMeters);

  // The cable went away (deleted, or another user's change): stop quietly.
  useEffect(() => {
    if (cableId && !cable) {
      useSegmentPickStore.getState().cancel();
      useSegmentPickStore.getState().showStretch(null);
    }
  }, [cableId, cable]);

  // Taps become distances along the drawn line.
  useEffect(() => {
    if (!job || !cable) return;
    const pane = map.getPane(PICK_PANE) ?? map.createPane(PICK_PANE);
    pane.style.zIndex = '640';
    const catcher = L.rectangle(
      [
        [-85, -180],
        [85, 180],
      ],
      { pane: PICK_PANE, stroke: false, fillColor: '#000000', fillOpacity: 0.01, interactive: true, bubblingMouseEvents: false },
    );
    catcher.on('click', (e: L.LeafletMouseEvent) => {
      const near = pointToLine([e.latlng.lat, e.latlng.lng], cable.coordinates);
      if (!near || near.distanceMeters > corridor) {
        showToast('warning', 'Tap on the cable', `That tap is ${near ? Math.round(near.distanceMeters) : '?'} m from ${cable.name}. Tap on the purple line.`);
        return;
      }
      useSegmentPickStore.getState().tap(near.alongMeters);
    });
    catcher.addTo(map);
    map.getContainer().classList.add('cursor-crosshair');
    return () => {
      catcher.remove();
      map.getContainer().classList.remove('cursor-crosshair');
    };
  }, [job, cable, corridor, map]);

  // When the second tap lands, open the cable panel again with the stretch form.
  const result = useSegmentPickStore((s) => s.result);
  useEffect(() => {
    if (!result || !cable || result.cableId !== cable.id) return;
    const ui = useUiStore.getState();
    ui.select({ type: 'cable', data: cable });
    ui.setPanelOpen('right', true);
  }, [result, cable]);

  // The cable line, the taps so far and a stretch being shown.
  const shown = useMemo(() => {
    if (!cable) return null;
    if (job) return { line: cable.coordinates, taps: taps.map((m) => lineBetween(cable.coordinates, m, m)[0]).filter(Boolean) };
    if (highlight) return { line: lineBetween(cable.coordinates, highlight.from, highlight.to), taps: [] };
    return null;
  }, [cable, job, taps, highlight]);

  useEffect(() => {
    if (!shown || shown.line.length < 2) return;
    const layers: L.Layer[] = [L.polyline(shown.line, { pane: PANES.sketch, color: PICK, weight: 8, opacity: 0.55, interactive: false })];
    for (const p of shown.taps) layers.push(L.circleMarker(p, { pane: PANES.sketch, radius: 9, color: PICK, weight: 3, fillColor: '#ffffff', fillOpacity: 1, interactive: false }));
    for (const layer of layers) layer.addTo(map);
    return () => {
      for (const layer of layers) layer.remove();
    };
  }, [shown, map]);

  if (!job || !cable) return null;

  return createPortal(
    <div className="fixed inset-x-2 bottom-[calc(env(safe-area-inset-bottom)+12px)] z-[1500] md:inset-x-auto md:left-1/2 md:w-[560px] md:-translate-x-1/2" data-testid="segment-pick-bar">
      <div className="space-y-2 rounded-xl bg-slate-900/95 p-3 text-white shadow-xl ring-1 ring-white/10">
        <div>
          <div className="text-[15px] font-semibold">Mark a stretch of {cable.name}</div>
          <div className="text-[13px] text-slate-300">
            {taps.length === 0 ? 'Tap where the stretch starts, on the purple line.' : 'Now tap where the stretch ends.'}
          </div>
          <div className="mt-1 text-[13px] text-slate-200" data-testid="segment-pick-count">
            {taps.length} of 2 points
            {taps.length === 1 ? ` · start about ${Math.round(taps[0])} m from the cable's start (on the drawn line)` : ''}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className={`${btn} bg-white/10 text-slate-100 hover:bg-white/20`} disabled={taps.length === 0} onClick={() => useSegmentPickStore.getState().undoTap()} data-testid="segment-pick-undo">
            <CornerUpLeft size={18} /> Undo point
          </button>
          <button
            type="button"
            className={`${btn} bg-white/10 text-slate-100 hover:bg-white/20`}
            onClick={() => {
              useSegmentPickStore.getState().cancel();
              const ui = useUiStore.getState();
              ui.select({ type: 'cable', data: cable });
              ui.setPanelOpen('right', true);
            }}
            data-testid="segment-pick-cancel"
          >
            <X size={18} /> Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
