import { useEffect } from 'react';
import L from 'leaflet';

import { useMapStore } from '../../../stores/mapStore';
import { useNetworkStore } from '../../../stores/networkStore';
import { PANES } from '../leaflet/panes';
import { useLayerGroup } from '../leaflet/useLayerGroup';
import { useLayerShown } from './useVisibleNetwork';

const ZONE_COLOR = '#7c3aed';

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Drawn zone boundaries, beneath the network. A zone with no drawn boundary is not shown: it has
 * no place on the map yet. The shapes never take a tap, so drawing and selecting on top still work.
 */
export function ZoneLayer({ map }: { map: L.Map }) {
  const group = useLayerGroup(map);
  const zones = useNetworkStore((s) => s.zones);
  const visible = useLayerShown(map, 'zones');
  const opacity = useMapStore((s) => s.layerOpacity.zones ?? 1);

  useEffect(() => {
    group.clearLayers();
    if (!visible) return;
    for (const zone of zones) {
      if (zone.boundaryCoords.length < 3) continue;
      const shape = L.polygon(zone.boundaryCoords, {
        pane: PANES.structures,
        interactive: false,
        color: ZONE_COLOR,
        weight: 2,
        dashArray: '8, 6',
        opacity: 0.8 * opacity,
        fillColor: ZONE_COLOR,
        fillOpacity: 0.06 * opacity,
      }).addTo(group);
      L.marker(shape.getBounds().getCenter(), {
        pane: PANES.labels,
        interactive: false,
        keyboard: false,
        icon: L.divIcon({
          className: 'gis-zone-label',
          html: `<span style="color:${ZONE_COLOR};font-weight:600;font-size:12px;text-shadow:0 0 3px #fff,0 0 3px #fff">${escapeHtml(zone.name)} (${escapeHtml(zone.areaCode)})</span>`,
          iconSize: [0, 0],
        }),
      }).addTo(group);
    }
  }, [group, zones, visible, opacity]);

  return null;
}
