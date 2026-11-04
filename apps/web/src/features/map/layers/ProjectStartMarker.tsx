import { useMemo } from 'react';
import type L from 'leaflet';

import { useNetworkStore } from '../../../stores/networkStore';
import { type MarkerSpec, useMarkerLayer } from '../leaflet/useMarkerLayer';
import { projectStartIcon, tooltipHtml } from '../markerIcons';

/** The project's anchor point, from which feeder routes are planned. */
export function ProjectStartMarker({ map }: { map: L.Map }) {
  const point = useNetworkStore((s) => s.projectStartPoint);

  const markers = useMemo<MarkerSpec[]>(() => {
    if (!point) return [];
    const [lat, lng] = point;
    return [
      {
        id: 'project-start',
        latlng: [lat, lng],
        icon: projectStartIcon(),
        tooltip: tooltipHtml('Project start point', [`${lat.toFixed(6)}, ${lng.toFixed(6)}`]),
        label: 'Project start point',
        zIndexOffset: 600,
      },
    ];
  }, [point]);

  useMarkerLayer(map, markers, { interactive: true });
  return null;
}
