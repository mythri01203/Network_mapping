import { useCallback, useMemo } from 'react';
import L from 'leaflet';

import { hasRecordedLocation } from '@fibergis/shared';

import { useMapStore } from '../../../stores/mapStore';
import { useNetworkStore } from '../../../stores/networkStore';
import { useUiStore } from '../../../stores/uiStore';
import { selectFeatureOnClick } from '../leaflet/featureClick';
import { PANES } from '../leaflet/panes';
import { useClusteredPoints } from '../leaflet/useClusteredPoints';
import { type MarkerSpec, useMarkerLayer } from '../leaflet/useMarkerLayer';
import { customerMarkerIcon, tooltipHtml } from '../markerIcons';
import { formatDbm, ponColor } from '../pon/ponColors';
import { usePonMapStore } from '../pon/ponMapStore';
import { useAffectedCustomers, usePonOverview } from '../pon/usePonOverview';
import { useLayerShown } from './useVisibleNetwork';

const affectedIcon = (test: boolean) =>
  L.divIcon({ html: `<span class="gis-affected${test ? ' is-test' : ''}"></span>`, className: 'gis-label-anchor', iconSize: [0, 0], iconAnchor: [0, 0] });

/** Customer premises; hidden in the Cable TV view, which has no fiber subscribers. */
export function CustomerLayer({ map }: { map: L.Map }) {
  const customers = useNetworkStore((s) => s.customers);
  const splitters = useNetworkStore((s) => s.splitters);
  const visible = useLayerShown(map, 'customers');
  const opacity = useMapStore((s) => s.layerOpacity.customers ?? 1);
  const networkMode = useUiStore((s) => s.networkMode);
  const selectedId = useUiStore((s) => (s.selectedObject?.type === 'customer' ? s.selectedObject.data.id : null));
  const overview = usePonOverview();
  const affected = useAffectedCustomers();
  const focus = usePonMapStore((s) => s.focus);

  const byId = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);
  const splitterName = useMemo(() => new Map(splitters.map((s) => [s.id, `${s.ratio} ${s.name}`])), [splitters]);

  // Phase 9: only pins in view are drawn, and crowded areas as groups with a count.
  const placed = useMemo(
    () => (!visible || networkMode === 'CableTV' ? [] : customers.filter(hasRecordedLocation)),
    [customers, visible, networkMode],
  );
  const points = useMemo(() => placed.map((c) => ({ id: c.id, lat: c.lat, lng: c.lng })), [placed]);
  const keep = useMemo(() => new Set(selectedId ? [selectedId] : []), [selectedId]);
  const shown = useClusteredPoints(map, points, keep, 'customer');

  const markers = useMemo<MarkerSpec[]>(() => {
    return placed.filter((c) => shown.has(c.id)).map((c) => {
      const onPon = overview.customers.get(c.id);
      const pon = onPon ? overview.pons.find((p) => p.key === onPon.ponKey) : undefined;
      const hit = affected.get(c.id);
      const dimmed = !!focus && onPon?.ponKey !== focus && c.id !== selectedId;
      return {
        id: c.id,
        latlng: [c.lat, c.lng] as [number, number],
        icon: customerMarkerIcon(c.status, { selected: c.id === selectedId, traced: false }, pon ? ponColor(pon.portNumber).hex : undefined),
        tooltip: tooltipHtml(c.name, [
          `${c.status === 'Active' ? 'Active' : `Inactive: ${c.status}`} · ${c.plan || 'plan not recorded'}`,
          pon ? `${pon.ponPortId}${pon.vendorAddress ? ` (${pon.vendorAddress})` : ''} · ${c.area}` : 'PON not traced: fibers not recorded end to end',
          c.splitterId ? `Splitter ${splitterName.get(c.splitterId) ?? c.splitterId}, output ${c.splitterOutputPort}` : null,
          onPon ? `Light at ONT ${formatDbm(onPon.rxDbm)} (estimated)` : null,
          hit ? `Suspected affected: ${hit.reasons.join('; ')}` : null,
          c.id,
        ]),
        label: `Customer ${c.name}`,
        opacity: opacity * (dimmed ? 0.15 : 1),
        zIndexOffset: c.id === selectedId ? 1000 : 0,
      };
    });
  }, [placed, shown, selectedId, opacity, overview, affected, focus, splitterName]);

  const onClick = useCallback(
    (id: string, event: L.LeafletMouseEvent) => {
      const customer = byId.get(id);
      if (customer) selectFeatureOnClick(event, { type: 'customer', data: customer });
    },
    [byId],
  );

  useMarkerLayer(map, markers, { onClick });

  // Suspected service-affected customers pulse in red (TEST alarms in violet).
  const pulses = useMemo<MarkerSpec[]>(
    () =>
      placed
        .filter((c) => affected.has(c.id) && shown.has(c.id))
        .map((c) => ({ id: `affected-${c.id}`, latlng: [c.lat, c.lng] as [number, number], icon: affectedIcon(affected.get(c.id)!.test) })),
    [placed, affected, shown],
  );
  useMarkerLayer(map, pulses, { interactive: false, pane: PANES.halo });
  return null;
}
