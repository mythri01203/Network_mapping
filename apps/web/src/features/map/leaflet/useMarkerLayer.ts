import { useEffect, useRef } from 'react';
import L from 'leaflet';

import { useLayerGroup } from './useLayerGroup';

export interface MarkerSpec {
  id: string;
  latlng: [number, number];
  icon: L.DivIcon;
  /** Tooltip HTML; callers must escape any user-provided text. */
  tooltip?: string;
  /** Accessible name announced for the marker element. */
  label?: string;
  opacity?: number;
  zIndexOffset?: number;
  /** This one pin can be dragged. Off unless a person chose to move it. */
  draggable?: boolean;
}

export interface MarkerLayerOptions {
  /** Non-interactive markers ignore the pointer entirely (e.g. text labels). */
  interactive?: boolean;
  pane?: string;
  onClick?: (id: string, event: L.LeafletMouseEvent) => void;
  /** Called when a pin whose spec is `draggable` is dropped. */
  onDragEnd?: (id: string, latlng: L.LatLng) => void;
}

interface Entry {
  marker: L.Marker;
  spec: MarkerSpec;
}

const TOOLTIP_OPTIONS: L.TooltipOptions = { direction: 'top', opacity: 1, className: 'gis-tooltip' };

function applyLabel(marker: L.Marker, label: string | undefined) {
  const el = marker.getElement();
  if (!el) return;
  if (label) el.setAttribute('aria-label', label);
  else el.removeAttribute('aria-label');
}

/**
 * Keeps a set of Leaflet markers in sync with `specs`, updating markers in place instead of
 * rebuilding the whole layer whenever anything changes. Callers should memoise `specs`.
 */
export function useMarkerLayer(map: L.Map, specs: readonly MarkerSpec[], options: MarkerLayerOptions = {}) {
  const { interactive = true, pane } = options;
  const group = useLayerGroup(map);
  const entries = useRef(new Map<string, Entry>());
  const onClick = useRef(options.onClick);
  const onDragEnd = useRef(options.onDragEnd);

  useEffect(() => {
    onClick.current = options.onClick;
    onDragEnd.current = options.onDragEnd;
  });

  useEffect(() => {
    const current = entries.current;
    const seen = new Set<string>();

    for (const spec of specs) {
      seen.add(spec.id);
      const entry = current.get(spec.id);

      if (!entry) {
        const marker = L.marker(spec.latlng, {
          icon: spec.icon,
          opacity: spec.opacity ?? 1,
          zIndexOffset: spec.zIndexOffset ?? 0,
          interactive,
          keyboard: interactive,
          riseOnHover: interactive,
          draggable: false,
          // A tap on a pin also reaches the map, reporting the pin's own position, so drawing and
          // measuring join exactly onto it at any zoom. The select tool stops the event itself.
          bubblingMouseEvents: true,
          ...(pane ? { pane } : {}),
        });
        const created: Entry = { marker, spec };
        if (spec.tooltip) marker.bindTooltip(spec.tooltip, TOOLTIP_OPTIONS);
        marker.on('add', () => {
          applyLabel(marker, created.spec.label);
          if (created.spec.draggable) marker.dragging?.enable();
        });
        if (interactive) marker.on('click', (e) => onClick.current?.(spec.id, e));
        marker.on('dragend', () => onDragEnd.current?.(spec.id, marker.getLatLng()));
        current.set(spec.id, created);
        group.addLayer(marker);
        continue;
      }

      const { marker, spec: prev } = entry;
      entry.spec = spec;
      if (prev.latlng[0] !== spec.latlng[0] || prev.latlng[1] !== spec.latlng[1]) marker.setLatLng(spec.latlng);
      if (prev.icon !== spec.icon) {
        marker.setIcon(spec.icon);
        applyLabel(marker, spec.label);
      } else if (prev.label !== spec.label) {
        applyLabel(marker, spec.label);
      }
      if (prev.opacity !== spec.opacity) marker.setOpacity(spec.opacity ?? 1);
      if (prev.zIndexOffset !== spec.zIndexOffset) marker.setZIndexOffset(spec.zIndexOffset ?? 0);
      if (!!prev.draggable !== !!spec.draggable || prev.icon !== spec.icon) {
        if (spec.draggable) marker.dragging?.enable();
        else marker.dragging?.disable();
      }
      // A drop the command refused leaves the pin where it was dragged; put it back on its record.
      if (!spec.draggable && prev.draggable) marker.setLatLng(spec.latlng);
      if (prev.tooltip !== spec.tooltip) {
        if (!spec.tooltip) marker.unbindTooltip();
        else if (marker.getTooltip()) marker.setTooltipContent(spec.tooltip);
        else marker.bindTooltip(spec.tooltip, TOOLTIP_OPTIONS);
      }
    }

    for (const [id, { marker }] of current) {
      if (!seen.has(id)) {
        group.removeLayer(marker);
        current.delete(id);
      }
    }
  }, [group, specs, interactive, pane]);
}
