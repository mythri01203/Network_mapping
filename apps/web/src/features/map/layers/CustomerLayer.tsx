import { useCallback, useMemo } from 'react';
import type L from 'leaflet';

import { hasRecordedLocation } from '@fibergis/shared';

import { useMapStore } from '../../../stores/mapStore';
import { useNetworkStore } from '../../../stores/networkStore';
import { useUiStore } from '../../../stores/uiStore';
import { selectFeatureOnClick } from '../leaflet/featureClick';
import { useClusteredPoints } from '../leaflet/useClusteredPoints';
import { type MarkerSpec, useMarkerLayer } from '../leaflet/useMarkerLayer';
import { customerMarkerIcon, tooltipHtml } from '../markerIcons';

/** Customer premises; hidden in the Cable TV view, which has no fiber subscribers. */
export function CustomerLayer({ map }: { map: L.Map }) {
  const customers = useNetworkStore((s) => s.customers);
  const visible = useMapStore((s) => s.layers.customers !== false);
  const opacity = useMapStore((s) => s.layerOpacity.customers ?? 1);
  const networkMode = useUiStore((s) => s.networkMode);
  const selectedId = useUiStore((s) => (s.selectedObject?.type === 'customer' ? s.selectedObject.data.id : null));

  const byId = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);

  // Phase 9: only pins in view are drawn, and crowded areas as groups with a count.
  const placed = useMemo(
    () => (!visible || networkMode === 'CableTV' ? [] : customers.filter(hasRecordedLocation)),
    [customers, visible, networkMode],
  );
  const points = useMemo(() => placed.map((c) => ({ id: c.id, lat: c.lat, lng: c.lng })), [placed]);
  const keep = useMemo(() => new Set(selectedId ? [selectedId] : []), [selectedId]);
  const shown = useClusteredPoints(map, points, keep, 'customer');

  const markers = useMemo<MarkerSpec[]>(() => {
    return placed.filter((c) => shown.has(c.id)).map((c) => ({
      id: c.id,
      latlng: [c.lat, c.lng],
      icon: customerMarkerIcon(c.status, { selected: c.id === selectedId, traced: false }),
      tooltip: tooltipHtml(c.name, [c.plan, `${c.status} · ${c.id}`, c.terminalBoxId && `Terminal ${c.terminalBoxId}`]),
      label: `Customer ${c.name}`,
      opacity,
      zIndexOffset: c.id === selectedId ? 1000 : 0,
    }));
  }, [placed, shown, selectedId, opacity]);

  const onClick = useCallback(
    (id: string, event: L.LeafletMouseEvent) => {
      const customer = byId.get(id);
      if (customer) selectFeatureOnClick(event, { type: 'customer', data: customer });
    },
    [byId],
  );

  useMarkerLayer(map, markers, { onClick });
  return null;
}
