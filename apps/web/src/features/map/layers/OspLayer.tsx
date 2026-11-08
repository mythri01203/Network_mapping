import { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';

import { type Duct, type Equipment, type LatLng, type SlackLoop, type Span, STRUCTURE_STATUS_LABELS } from '@fibergis/shared';

import { useMapStore } from '../../../stores/mapStore';
import { useNetworkStore } from '../../../stores/networkStore';
import { type SelectedObject, useUiStore } from '../../../stores/uiStore';
import { selectFeatureOnClick } from '../leaflet/featureClick';
import { PANES } from '../leaflet/panes';
import { useLayerGroup } from '../leaflet/useLayerGroup';
import { formatDistance, tooltipHtml } from '../markerIcons';

/**
 * Spans, ducts and slack loops. They are structures, so they never use cable colours: spans are thin
 * brown lines (dashed while only proposed), ducts are wide stone-coloured bands, and slack loops
 * are small purple rings on their cable.
 */

const SPAN = { color: '#7c2d12', selected: '#1d4ed8' };
const DUCT = { color: '#78716c', selected: '#1d4ed8' };
const SLACK = { color: '#7c3aed', selected: '#1d4ed8' };

interface Entry<T> {
  record: T;
  layer: L.Path;
  key: string;
}

function useSync<T extends { id: string }>(
  group: L.LayerGroup,
  records: readonly T[],
  build: (record: T) => { layer: L.Path; key: string } | null,
  restyle: (record: T, layer: L.Path) => void,
  toSelection: (record: T) => SelectedObject,
  deps: unknown[],
) {
  const entries = useRef(new Map<string, Entry<T>>());
  useEffect(() => {
    const current = entries.current;
    const seen = new Set<string>();
    for (const record of records) {
      const built = build(record);
      if (!built) continue;
      seen.add(record.id);
      const existing = current.get(record.id);
      if (existing && existing.key === built.key) {
        existing.record = record;
        restyle(record, existing.layer);
        continue;
      }
      if (existing) group.removeLayer(existing.layer);
      built.layer.on('click', (event) => {
        const latest = current.get(record.id)?.record;
        if (latest) selectFeatureOnClick(event as L.LeafletMouseEvent, toSelection(latest));
      });
      group.addLayer(built.layer);
      current.set(record.id, { record, layer: built.layer, key: built.key });
      restyle(record, built.layer);
    }
    for (const [id, entry] of current) {
      if (seen.has(id)) continue;
      group.removeLayer(entry.layer);
      current.delete(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group, records, ...deps]);
}

const spanTooltip = (span: Span, from: Equipment, to: Equipment) =>
  tooltipHtml(`Span ${from.name} – ${to.name}`, [
    STRUCTURE_STATUS_LABELS[span.status],
    span.basis === 'field_sequence' ? 'From the field order: not proof of a cable' : null,
    `About ${formatDistance(L.latLng(from.lat, from.lng).distanceTo([to.lat, to.lng]))} on the map`,
  ]);

export function OspLayer({ map }: { map: L.Map }) {
  const group = useLayerGroup(map);
  const spans = useNetworkStore((s) => s.spans);
  const ducts = useNetworkStore((s) => s.ducts);
  const slackLoops = useNetworkStore((s) => s.slackLoops);
  const equipment = useNetworkStore((s) => s.equipment);
  const layers = useMapStore((s) => s.layers);
  const selectedKey = useUiStore((s) => (s.selectedObject ? `${s.selectedObject.type}:${s.selectedObject.data.id}` : null));
  const byId = useMemo(() => new Map(equipment.map((e) => [e.id, e])), [equipment]);

  const visibleSpans = useMemo(() => (layers.spans === false ? [] : spans), [layers.spans, spans]);
  const visibleDucts = useMemo(() => (layers.ducts === false ? [] : ducts), [layers.ducts, ducts]);
  const visibleLoops = useMemo(() => (layers.slackLoops === false ? [] : slackLoops), [layers.slackLoops, slackLoops]);

  useSync<Span>(
    group,
    visibleSpans,
    (span) => {
      const from = byId.get(span.fromStructureId);
      const to = byId.get(span.toStructureId);
      if (!from || !to) return null;
      const points: LatLng[] = [
        [from.lat, from.lng],
        [to.lat, to.lng],
      ];
      const line = L.polyline(points, { pane: PANES.structures, lineCap: 'round', className: `osp-span osp-span--${span.status}` });
      line.bindTooltip(spanTooltip(span, from, to), { sticky: true, opacity: 1, className: 'gis-tooltip' });
      return { layer: line, key: `${from.lat},${from.lng},${to.lat},${to.lng},${span.status}` };
    },
    (span, layer) => {
      const selected = selectedKey === `span:${span.id}`;
      layer.setStyle({
        color: selected ? SPAN.selected : SPAN.color,
        weight: selected ? 6 : 3,
        opacity: 0.9,
        // Proposed spans are dashed: the order of capture is not proof that the poles are joined.
        dashArray: span.status === 'proposed' ? '6 7' : span.status === 'planned' ? '2 6' : undefined,
      });
    },
    (span) => ({ type: 'span', data: span }),
    [byId, selectedKey],
  );

  useSync<Duct>(
    group,
    visibleDucts,
    (duct) => {
      const line = L.polyline(duct.coordinates, { pane: PANES.structures, lineCap: 'butt', className: 'osp-duct' });
      line.bindTooltip(
        tooltipHtml(duct.name, [
          `Duct · ${STRUCTURE_STATUS_LABELS[duct.status]}`,
          `${duct.cableIds.length + duct.subducts.reduce((n, s) => n + s.cableIds.length, 0)} cable(s) recorded inside`,
        ]),
        { sticky: true, opacity: 1, className: 'gis-tooltip' },
      );
      return { layer: line, key: JSON.stringify(duct.coordinates) };
    },
    (duct, layer) => {
      const selected = selectedKey === `duct:${duct.id}`;
      layer.setStyle({
        color: selected ? DUCT.selected : DUCT.color,
        weight: selected ? 12 : 9,
        opacity: duct.status === 'proposed' || duct.status === 'planned' ? 0.35 : 0.55,
        dashArray: duct.status === 'proposed' || duct.status === 'planned' ? '10 6' : undefined,
      });
    },
    (duct) => ({ type: 'duct', data: duct }),
    [selectedKey],
  );

  useSync<SlackLoop>(
    group,
    visibleLoops,
    (loop) => {
      const ring = L.circleMarker([loop.lat, loop.lng], { radius: 8, fillColor: '#ffffff', fillOpacity: 1, className: 'osp-slack' });
      ring.bindTooltip(tooltipHtml(loop.name, [`${loop.lengthMeters} m of spare cable, ${loop.lengthSource === 'marks' ? 'from the cable marks' : 'as entered'}`]), {
        opacity: 1,
        className: 'gis-tooltip',
      });
      return { layer: ring, key: `${loop.lat},${loop.lng}` };
    },
    (loop, layer) => {
      const selected = selectedKey === `slackLoop:${loop.id}`;
      layer.setStyle({ color: selected ? SLACK.selected : SLACK.color, weight: selected ? 5 : 3 });
    },
    (loop) => ({ type: 'slackLoop', data: loop }),
    [selectedKey],
  );

  return null;
}
