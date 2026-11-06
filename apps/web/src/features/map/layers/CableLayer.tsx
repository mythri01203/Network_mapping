import { useEffect, useRef } from 'react';
import L from 'leaflet';

import type { Cable } from '@fibergis/shared';

import { useMapStore } from '../../../stores/mapStore';
import { useTraceStore } from '../../../stores/traceStore';
import { useUiStore } from '../../../stores/uiStore';
import { cableStyle } from '../../../theme/network';
import { cableLayerKey } from '../layerFilters';
import { selectFeatureOnClick } from '../leaflet/featureClick';
import { PANES } from '../leaflet/panes';
import { useLayerGroup } from '../leaflet/useLayerGroup';
import { formatDistance, tooltipHtml } from '../markerIcons';

type HaloKind = 'traced' | 'selected' | null;

interface CableEntry {
  cable: Cable;
  line: L.Polyline;
  halo: L.Polyline | null;
  haloKind: HaloKind;
  tooltip: string;
}

const TRACE_HALO = '#10b981';
const TRACE_LINE = '#059669';
const SELECT_HALO = '#3b82f6';
const SELECT_LINE = '#1d4ed8';

function lineStyle(cable: Cable, selected: boolean, traced: boolean, layerOpacity: number): L.PathOptions {
  const style = cableStyle(cable.type);
  const color = traced ? TRACE_LINE : selected ? SELECT_LINE : cable.colorHex || style.stroke;
  const weight = cable.thickness ?? (selected ? style.strokeWidth + 2 : style.strokeWidth);
  return {
    color,
    weight,
    dashArray: style.dashArray,
    opacity: (cable.status === 'Damaged' ? 0.6 : 0.95) * layerOpacity,
    lineCap: 'round',
    lineJoin: 'round',
  };
}

function createHalo(cable: Cable, kind: Exclude<HaloKind, null>): L.Polyline {
  return L.polyline(cable.coordinates, {
    pane: PANES.halo,
    interactive: false,
    color: kind === 'traced' ? TRACE_HALO : SELECT_HALO,
    weight: cableStyle(cable.type).strokeWidth + 8,
    opacity: 0.6,
    lineCap: 'round',
    lineJoin: 'round',
    className: kind === 'traced' ? 'fiber-trace-active' : '',
  });
}

function cableTooltip(cable: Cable): string {
  return tooltipHtml(cable.name, [
    cable.type,
    `${cable.fiberCount} cores · ${formatDistance(cable.lengthMeters)}`,
    cable.status !== 'Active' ? cable.status : null,
  ]);
}

export interface CableLayerProps {
  map: L.Map;
  /** Already filtered by network mode and layer toggles. */
  cables: Cable[];
}

/** Cable polylines with selection/trace halos, updated in place as the network changes. */
export function CableLayer({ map, cables }: CableLayerProps) {
  const group = useLayerGroup(map);
  const entries = useRef(new Map<string, CableEntry>());
  const selectedId = useUiStore((s) => (s.selectedObject?.type === 'cable' ? s.selectedObject.data.id : null));
  const tracedIds = useTraceStore((s) => s.cableIds);
  const layerOpacity = useMapStore((s) => s.layerOpacity);

  useEffect(() => {
    const current = entries.current;
    const traced = new Set(tracedIds);
    const seen = new Set<string>();

    for (const cable of cables) {
      seen.add(cable.id);
      const isTraced = traced.has(cable.id);
      const isSelected = cable.id === selectedId;
      const layer = cableLayerKey(cable.type);
      const style = lineStyle(cable, isSelected, isTraced, layer ? (layerOpacity[layer] ?? 1) : 1);
      const tooltip = cableTooltip(cable);

      let entry = current.get(cable.id);
      if (!entry) {
        const line = L.polyline(cable.coordinates, style);
        line.bindTooltip(tooltip, { sticky: true, opacity: 1, className: 'gis-tooltip' });
        line.on('click', (event) => {
          const latest = current.get(cable.id)?.cable;
          if (latest) selectFeatureOnClick(event, { type: 'cable', data: latest });
        });
        group.addLayer(line);
        entry = { cable, line, halo: null, haloKind: null, tooltip };
        current.set(cable.id, entry);
      } else {
        if (entry.cable.coordinates !== cable.coordinates) {
          entry.line.setLatLngs(cable.coordinates);
          entry.halo?.setLatLngs(cable.coordinates);
        }
        entry.line.setStyle(style);
        if (entry.tooltip !== tooltip) {
          entry.line.setTooltipContent(tooltip);
          entry.tooltip = tooltip;
        }
        entry.cable = cable;
      }

      // The trace class only applies when a path is created, so a halo is rebuilt when its kind changes.
      const haloKind: HaloKind = isTraced ? 'traced' : isSelected ? 'selected' : null;
      if (haloKind !== entry.haloKind) {
        if (entry.halo) group.removeLayer(entry.halo);
        entry.halo = haloKind ? createHalo(cable, haloKind) : null;
        if (entry.halo) group.addLayer(entry.halo);
        entry.haloKind = haloKind;
      }
    }

    for (const [id, entry] of current) {
      if (seen.has(id)) continue;
      group.removeLayer(entry.line);
      if (entry.halo) group.removeLayer(entry.halo);
      current.delete(id);
    }
  }, [group, cables, selectedId, tracedIds, layerOpacity]);

  return null;
}
