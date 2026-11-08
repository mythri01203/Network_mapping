import { useCallback, useMemo } from 'react';
import type L from 'leaflet';

import { FAULT_STATUS_LABELS, isFaultOpen } from '@fibergis/shared';

import { useMapStore } from '../../../stores/mapStore';
import { useNetworkStore } from '../../../stores/networkStore';
import { useUiStore } from '../../../stores/uiStore';
import { selectFeatureOnClick } from '../leaflet/featureClick';
import { type MarkerSpec, useMarkerLayer } from '../leaflet/useMarkerLayer';
import { faultMarkerIcon, tooltipHtml } from '../markerIcons';

/** Open faults at their affected location. Resolved faults stay in the fault log only. */
export function FaultLayer({ map }: { map: L.Map }) {
  const faults = useNetworkStore((s) => s.faults);
  const visible = useMapStore((s) => s.layers.faults !== false);
  const opacity = useMapStore((s) => s.layerOpacity.faults ?? 1);
  const selectedId = useUiStore((s) => (s.selectedObject?.type === 'fault' ? s.selectedObject.data.id : null));

  const byId = useMemo(() => new Map(faults.map((f) => [f.id, f])), [faults]);

  const markers = useMemo<MarkerSpec[]>(() => {
    if (!visible) return [];
    return faults
      .filter(isFaultOpen)
      .map((f) => {
        const affected = f.affectedCustomerIds.length;
        const test = f.isTest ? 'TEST (not real) · ' : '';
        return {
          id: f.id,
          latlng: [f.affectedLocation.lat, f.affectedLocation.lng],
          icon: faultMarkerIcon(f.severity, f.id === selectedId),
          tooltip: tooltipHtml(`${f.isTest && !f.title.startsWith('TEST') ? 'TEST: ' : ''}${f.title}`, [
            `${test}${f.severity} · ${FAULT_STATUS_LABELS[f.status]} · ${f.id}`,
            `${affected} customer${affected === 1 ? '' : 's'} on recorded paths${f.mayBeAffectedCustomerIds?.length ? `, ${f.mayBeAffectedCustomerIds.length} may be affected` : ''}`,
          ]),
          label: `${f.isTest ? 'TEST fault' : 'Fault'} ${f.title}`,
          opacity,
          zIndexOffset: f.id === selectedId ? 1100 : 800,
        };
      });
  }, [faults, visible, selectedId, opacity]);

  const onClick = useCallback(
    (id: string, event: L.LeafletMouseEvent) => {
      const fault = byId.get(id);
      if (fault) selectFeatureOnClick(event, { type: 'fault', data: fault });
    },
    [byId],
  );

  useMarkerLayer(map, markers, { onClick });
  return null;
}
