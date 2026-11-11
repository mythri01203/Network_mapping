import { useCallback, useMemo, useState } from 'react';
import type L from 'leaflet';

import { type Equipment, hasPlacedPosition, hasRecordedLocation, isAwaitingReview, isRejectedCapture } from '@fibergis/shared';

import { useMapStore } from '../../../stores/mapStore';
import { moveStructureChecked } from '../../../stores/ospActions';
import { useTraceStore } from '../../../stores/traceStore';
import { useUiStore } from '../../../stores/uiStore';
import { equipmentLayerOf } from '../layerFilters';
import { selectFeatureOnClick } from '../leaflet/featureClick';
import { PANES } from '../leaflet/panes';
import { useClusteredPoints } from '../leaflet/useClusteredPoints';
import { useMapZoom } from '../leaflet/useLeafletMap';
import { type MarkerSpec, useMarkerLayer } from '../leaflet/useMarkerLayer';
import { awaitingReviewMarkerIcon, equipmentMarkerIcon, equipmentMarkerSize, labelIcon, tooltipHtml, unplacedMarkerIcon } from '../markerIcons';
import { OltPopup } from '../OltPopup';
import { boxBadgeIcon, boxSummaryLines, oltBadgeIcon, splittersByBox } from '../pon/boxBadges';
import { usePonMapStore } from '../pon/ponMapStore';
import { usePonOverview } from '../pon/usePonOverview';

/** Splitter and power badges on boxes are shown from this zoom in. */
const BADGE_MIN_ZOOM = 16;

/**
 * Where a pin sits when pins overlap: the chosen layer order, top first. The selected pin is always
 * on top, so a person sees what they picked.
 */
function zIndexFor(eq: Equipment, selected: boolean, order: readonly string[]): number {
  if (selected) return 1000;
  const rank = order.indexOf(equipmentLayerOf(eq));
  return rank < 0 ? 0 : (order.length - rank) * 50 - 300;
}

export interface EquipmentLayerProps {
  map: L.Map;
  /** Already filtered by network mode, layer toggles and the OLT filter. */
  equipment: Equipment[];
}

export function EquipmentLayer({ map, equipment }: EquipmentLayerProps) {
  const selectedId = useUiStore((s) => (s.selectedObject?.type === 'equipment' ? s.selectedObject.data.id : null));
  const tracedIds = useTraceStore((s) => s.equipmentIds);
  const layerOpacity = useMapStore((s) => s.layerOpacity);
  const showLabels = useMapStore((s) => s.layers.labels !== false);
  const layerLabels = useMapStore((s) => s.layerLabels);
  const labelMinZoom = useMapStore((s) => s.labelMinZoom);
  const order = useMapStore((s) => s.equipmentOrder);
  const zoom = useMapZoom(map);
  const movingId = useMapStore((s) => s.movingEquipmentId);
  const [oltPopupId, setOltPopupId] = useState<string | null>(null);
  const overview = usePonOverview();
  const focus = usePonMapStore((s) => s.focus);
  const identifiers = usePonMapStore((s) => s.identifiers);
  const byBox = useMemo(() => splittersByBox(overview), [overview]);

  // A pin stored at 0,0 has no recorded place ("not recorded"): it is not drawn off the coast of Africa.
  // Phase 19: a capture the office rejected is kept on record but not drawn, unless it is the one selected.
  const placeable = useMemo(
    () => equipment.filter((eq) => hasRecordedLocation(eq) && (!isRejectedCapture(eq) || eq.id === selectedId)),
    [equipment, selectedId],
  );
  const byId = useMemo(() => new Map(placeable.map((eq) => [eq.id, eq])), [placeable]);

  // Phase 9: only pins in view are drawn, and crowded areas as groups with a count.
  const points = useMemo(() => placeable.map((eq) => ({ id: eq.id, lat: eq.lat, lng: eq.lng })), [placeable]);
  const keep = useMemo(
    () => new Set([...tracedIds, ...(selectedId ? [selectedId] : []), ...(movingId ? [movingId] : [])]),
    [tracedIds, selectedId, movingId],
  );
  const shown = useClusteredPoints(map, points, keep, 'equipment');
  const inView = useMemo(() => placeable.filter((eq) => shown.has(eq.id)), [placeable, shown]);

  const markers = useMemo<MarkerSpec[]>(() => {
    const traced = new Set(tracedIds);
    return inView.map((eq) => {
      const selected = eq.id === selectedId;
      const layer = equipmentLayerOf(eq);
      const kind = eq.type === 'OLT' ? `${eq.type} · ${eq.technology ?? 'technology not recorded'}` : eq.type;
      // A field capture with no good GPS fix sits at a rough spot until the office places it. It must
      // never look like a placed pin.
      const unplaced = !hasPlacedPosition(eq);
      // Phase 19: a phone capture waiting for the office has its own dashed violet pin.
      const review = isAwaitingReview(eq) ? 'Awaiting office review: not yet part of the network' : isRejectedCapture(eq) ? 'Rejected by the office' : null;
      return {
        id: eq.id,
        latlng: [eq.lat, eq.lng],
        icon: unplaced ? unplacedMarkerIcon(selected) : review ? awaitingReviewMarkerIcon(selected) : equipmentMarkerIcon(eq, { selected, traced: traced.has(eq.id) }),
        tooltip: unplaced
          ? tooltipHtml(eq.name, [kind, 'Position not confirmed: the office must place this', ...(review ? [review] : []), eq.id])
          : review
            ? tooltipHtml(eq.name, [kind, review, eq.id])
            : tooltipHtml(eq.name, [kind, ...boxSummaryLines(eq, overview, byBox), `${eq.status} · ${eq.id}`]),
        label: unplaced ? `${eq.type} ${eq.name}, position not confirmed` : review ? `${eq.type} ${eq.name}, ${review.toLowerCase()}` : `${eq.type} ${eq.name}`,
        opacity: (layerOpacity[layer] ?? 1) * (focus && !selected && eq.type !== 'OLT' && !(overview.equipment.get(eq.id) ?? []).includes(focus) ? 0.18 : 1),
        zIndexOffset: zIndexFor(eq, selected, order),
        draggable: eq.id === movingId,
      };
    });
  }, [inView, selectedId, tracedIds, layerOpacity, movingId, order, overview, byBox, focus]);

  const onClick = useCallback(
    (id: string, event: L.LeafletMouseEvent) => {
      const eq = byId.get(id);
      if (!eq) return;
      if (selectFeatureOnClick(event, { type: 'equipment', data: eq })) {
        setOltPopupId(eq.type === 'OLT' ? eq.id : null);
      }
    },
    [byId],
  );

  // Moves the equipment and its cable ends as one undoable step, then fixes the pin again.
  const onDragEnd = useCallback((id: string, latlng: L.LatLng) => {
    // Phase 4: anything else at the old place (cable points, slack loops, duct ends) is shown first; only what is ticked moves.
    void moveStructureChecked(id, latlng.lat, latlng.lng);
    useMapStore.getState().setMovingEquipmentId(null);
  }, []);

  useMarkerLayer(map, markers, { onClick, onDragEnd });

  const labels = useMemo<MarkerSpec[]>(() => {
    if (!showLabels || zoom < labelMinZoom) return [];
    return inView
      .filter((eq) => layerLabels[equipmentLayerOf(eq)] !== false)
      .map((eq) => ({
        id: eq.id,
        latlng: [eq.lat, eq.lng],
        icon: labelIcon(eq.name, equipmentMarkerSize(eq) / 2 + 4),
      }));
  }, [inView, showLabels, zoom, labelMinZoom, layerLabels]);

  useMarkerLayer(map, labels, { interactive: false, pane: PANES.labels });

  // Splitter design, outputs used and free, and the calculated level, on each box; a summary on the OLT.
  const badges = useMemo<MarkerSpec[]>(() => {
    if (!identifiers || zoom < BADGE_MIN_ZOOM - 2) return [];
    const out: MarkerSpec[] = [];
    for (const eq of inView) {
      if (eq.type === 'OLT') {
        const pons = overview.pons.filter((p) => p.oltId === eq.id);
        if (pons.length) out.push({ id: `badge-${eq.id}`, latlng: [eq.lat, eq.lng], icon: oltBadgeIcon(eq, pons, equipmentMarkerSize(eq) / 2 + 6) });
        continue;
      }
      if (zoom < BADGE_MIN_ZOOM) continue;
      const list = byBox.get(eq.id);
      if (!list?.length) continue;
      if (focus && !(overview.equipment.get(eq.id) ?? []).includes(focus)) continue;
      out.push({ id: `badge-${eq.id}`, latlng: [eq.lat, eq.lng], icon: boxBadgeIcon(list, overview, equipmentMarkerSize(eq) / 2 + 6, zoom < BADGE_MIN_ZOOM + 2) });
    }
    return out;
  }, [identifiers, zoom, inView, overview, byBox, focus]);
  useMarkerLayer(map, badges, { interactive: false, pane: PANES.labels });

  const popupOlt = oltPopupId && oltPopupId === selectedId ? byId.get(oltPopupId) : undefined;
  return popupOlt ? <OltPopup map={map} olt={popupOlt} onClose={() => setOltPopupId(null)} /> : null;
}
