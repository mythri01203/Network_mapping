import { useCallback, useMemo, useState } from 'react';
import type L from 'leaflet';

import type { Equipment } from '@fibergis/shared';

import { useMapStore } from '../../../stores/mapStore';
import { updateEquipment } from '../../../stores/networkActions';
import { showToast } from '../../../stores/toastStore';
import { useTraceStore } from '../../../stores/traceStore';
import { useUiStore } from '../../../stores/uiStore';
import { equipmentLayerKey } from '../layerFilters';
import { selectFeatureOnClick } from '../leaflet/featureClick';
import { PANES } from '../leaflet/panes';
import { useMapZoom } from '../leaflet/useLeafletMap';
import { type MarkerSpec, useMarkerLayer } from '../leaflet/useMarkerLayer';
import { equipmentMarkerIcon, equipmentMarkerSize, labelIcon, tooltipHtml } from '../markerIcons';
import { OltPopup } from '../OltPopup';

/** Labels appear once the map is close enough for them not to collide. */
export const LABEL_MIN_ZOOM = 17;

function zIndexFor(eq: Equipment, selected: boolean): number {
  if (selected) return 1000;
  if (eq.type === 'OLT') return 500;
  const layer = equipmentLayerKey(eq);
  return layer === 'poles' || layer === 'manholes' ? -100 : 0;
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
  const zoom = useMapZoom(map);
  const [oltPopupId, setOltPopupId] = useState<string | null>(null);

  const byId = useMemo(() => new Map(equipment.map((eq) => [eq.id, eq])), [equipment]);

  const markers = useMemo<MarkerSpec[]>(() => {
    const traced = new Set(tracedIds);
    return equipment.map((eq) => {
      const selected = eq.id === selectedId;
      const layer = equipmentLayerKey(eq);
      const kind = eq.type === 'OLT' ? `${eq.type} · ${eq.technology ?? 'GPON'}` : eq.type;
      return {
        id: eq.id,
        latlng: [eq.lat, eq.lng],
        icon: equipmentMarkerIcon(eq, { selected, traced: traced.has(eq.id) }),
        tooltip: tooltipHtml(eq.name, [kind, `${eq.status} · ${eq.id}`]),
        label: `${eq.type} ${eq.name}`,
        opacity: layer ? (layerOpacity[layer] ?? 1) : 1,
        zIndexOffset: zIndexFor(eq, selected),
      };
    });
  }, [equipment, selectedId, tracedIds, layerOpacity]);

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

  const onDragEnd = useCallback(
    (id: string, latlng: L.LatLng) => {
      const eq = byId.get(id);
      if (!eq) return;
      updateEquipment({ ...eq, lat: latlng.lat, lng: latlng.lng });
      showToast(
        'info',
        'Equipment Repositioned',
        `Moved ${eq.name} to [${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}].`,
      );
    },
    [byId],
  );

  useMarkerLayer(map, markers, { onClick, draggable: true, onDragEnd });

  const labels = useMemo<MarkerSpec[]>(() => {
    if (!showLabels || zoom < LABEL_MIN_ZOOM) return [];
    return equipment
      .filter((eq) => {
        const layer = equipmentLayerKey(eq);
        return layer !== 'poles' && layer !== 'manholes';
      })
      .map((eq) => ({
        id: eq.id,
        latlng: [eq.lat, eq.lng],
        icon: labelIcon(eq.name, equipmentMarkerSize(eq) / 2 + 4),
      }));
  }, [equipment, showLabels, zoom]);

  useMarkerLayer(map, labels, { interactive: false, pane: PANES.labels });

  const popupOlt = oltPopupId && oltPopupId === selectedId ? byId.get(oltPopupId) : undefined;
  return popupOlt ? <OltPopup map={map} olt={popupOlt} onClose={() => setOltPopupId(null)} /> : null;
}
