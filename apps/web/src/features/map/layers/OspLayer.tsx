import { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';

import {
  type Building,
  type Duct,
  ductCableIds,
  type Equipment,
  OSP_CONDITION_LABELS,
  type SlackLoop,
  type Span,
  spanDrawnMeters,
  spanLine,
  STRUCTURE_STATUS_LABELS,
} from '@fibergis/shared';

import { useNetworkStore } from '../../../stores/networkStore';
import { useOspUiStore } from '../../../stores/ospUiStore';
import { type SelectedObject, useUiStore } from '../../../stores/uiStore';
import { SegmentPicker } from '../../cables/SegmentPicker';
import { OspDrawing } from '../../inspector/osp/OspDrawing';
import { PoleMoveDialog } from '../../inspector/osp/PoleMoveDialog';
import { selectFeatureOnClick } from '../leaflet/featureClick';
import { PANES } from '../leaflet/panes';
import { useLayerGroup } from '../leaflet/useLayerGroup';
import { formatDistance, tooltipHtml } from '../markerIcons';
import { usePonMapStore } from '../pon/ponMapStore';
import { useLayerShown } from './useVisibleNetwork';

/**
 * Spans, ducts, slack loops and building outlines. They are structures, so they never use cable
 * colours: spans are thin brown lines (dashed while only proposed) that follow the bends a person
 * drew, ducts are wide stone-coloured bands (amber while an underground trace shows them), slack
 * loops are small purple rings on their cable, and building outlines are thin teal shapes.
 */

const SPAN = { color: '#7c2d12', selected: '#1d4ed8' };
const DUCT = { color: '#78716c', selected: '#1d4ed8', traced: '#d97706' };
const SLACK = { color: '#7c3aed', selected: '#1d4ed8' };
const BUILDING = { color: '#0f766e', selected: '#1d4ed8' };

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
  toSelection: (record: T) => SelectedObject | null,
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
        const selection = latest ? toSelection(latest) : null;
        if (selection) selectFeatureOnClick(event as L.LeafletMouseEvent, selection);
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

const spanTooltip = (span: Span, from: Equipment, to: Equipment, meters: number) =>
  tooltipHtml(`Span ${from.name} – ${to.name}`, [
    STRUCTURE_STATUS_LABELS[span.status],
    span.basis === 'field_sequence' ? 'From the field order: not proof of a cable' : null,
    `About ${formatDistance(meters)} on the map${span.routePoints?.length ? ', as drawn' : ', straight line'}`,
    span.condition ? `Condition: ${OSP_CONDITION_LABELS[span.condition]}` : null,
  ]);

export function OspLayer({ map }: { map: L.Map }) {
  const group = useLayerGroup(map);
  const spans = useNetworkStore((s) => s.spans);
  const ducts = useNetworkStore((s) => s.ducts);
  const slackLoops = useNetworkStore((s) => s.slackLoops);
  const buildings = useNetworkStore((s) => s.buildings);
  const equipment = useNetworkStore((s) => s.equipment);
  const showSpans = useLayerShown(map, 'spans');
  const showDucts = useLayerShown(map, 'ducts');
  const showLoops = useLayerShown(map, 'slackLoops');
  const showBuildings = useLayerShown(map, 'buildings');
  const tracedDuctIds = useOspUiStore((s) => s.tracedDuctIds);
  const selectedKey = useUiStore((s) => (s.selectedObject ? `${s.selectedObject.type}:${s.selectedObject.data.id}` : null));
  const byId = useMemo(() => new Map(equipment.map((e) => [e.id, e])), [equipment]);
  const traced = useMemo(() => new Set(tracedDuctIds), [tracedDuctIds]);
  const ponFocus = usePonMapStore((s) => s.focus);

  const visibleSpans = useMemo(() => (showSpans ? spans : []), [showSpans, spans]);
  const visibleDucts = useMemo(() => (showDucts ? ducts : []), [showDucts, ducts]);
  const visibleLoops = useMemo(() => (showLoops ? slackLoops : []), [showLoops, slackLoops]);
  const outlined = useMemo(() => (showBuildings ? buildings.filter((b) => (b.footprint?.length ?? 0) >= 3) : []), [showBuildings, buildings]);

  useSync<Span>(
    group,
    visibleSpans,
    (span) => {
      const from = byId.get(span.fromStructureId);
      const to = byId.get(span.toStructureId);
      const points = spanLine(span, equipment);
      if (!from || !to || !points) return null;
      const line = L.polyline(points, { pane: PANES.structures, lineCap: 'round', className: `osp-span osp-span--${span.status}` });
      line.bindTooltip(spanTooltip(span, from, to, spanDrawnMeters(span, equipment) ?? 0), { sticky: true, opacity: 1, className: 'gis-tooltip' });
      return { layer: line, key: `${JSON.stringify(points)},${span.status},${span.condition ?? ''}` };
    },
    (span, layer) => {
      const selected = selectedKey === `span:${span.id}`;
      layer.setStyle({
        color: selected ? SPAN.selected : SPAN.color,
        weight: selected ? 6 : 3,
        // Spans sit under the cables they carry; with one PON lit up they step back with the rest.
        opacity: ponFocus ? 0.18 : 0.9,
        // Proposed spans are dashed: the order of capture is not proof that the poles are joined.
        dashArray: span.status === 'proposed' ? '6 7' : span.status === 'planned' ? '2 6' : undefined,
      });
    },
    (span) => ({ type: 'span', data: span }),
    [byId, equipment, selectedKey, ponFocus],
  );

  useSync<Duct>(
    group,
    visibleDucts,
    (duct) => {
      const line = L.polyline(duct.coordinates, { pane: PANES.structures, lineCap: 'butt', className: 'osp-duct' });
      line.bindTooltip(
        tooltipHtml(duct.name, [
          `Duct · ${STRUCTURE_STATUS_LABELS[duct.status]}`,
          `${ductCableIds(duct).length} cable(s) recorded inside`,
          duct.condition === 'blocked' ? 'Recorded as blocked' : duct.condition === 'damaged' ? 'Recorded as damaged' : null,
        ]),
        { sticky: true, opacity: 1, className: 'gis-tooltip' },
      );
      return { layer: line, key: `${JSON.stringify(duct.coordinates)},${ductCableIds(duct).length},${duct.condition ?? ''}` };
    },
    (duct, layer) => {
      const selected = selectedKey === `duct:${duct.id}`;
      const isTraced = traced.has(duct.id);
      layer.setStyle({
        color: selected ? DUCT.selected : isTraced ? DUCT.traced : DUCT.color,
        weight: selected ? 12 : isTraced ? 11 : 9,
        opacity: isTraced ? 0.85 : duct.status === 'proposed' || duct.status === 'planned' ? 0.35 : 0.55,
        dashArray: duct.status === 'proposed' || duct.status === 'planned' ? '10 6' : undefined,
      });
    },
    (duct) => ({ type: 'duct', data: duct }),
    [selectedKey, traced],
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

  // Phase 4: building outlines, in addition to the building's point. A tap opens its entry pin.
  useSync<Building>(
    group,
    outlined,
    (building) => {
      const shape = L.polygon(building.footprint ?? [], { pane: PANES.structures, className: 'osp-building' });
      shape.bindTooltip(tooltipHtml(building.name, ['Building outline, as drawn']), { sticky: true, opacity: 1, className: 'gis-tooltip' });
      return { layer: shape, key: JSON.stringify(building.footprint) };
    },
    (building, layer) => {
      const selected = !!building.entryEquipmentId && selectedKey === `equipment:${building.entryEquipmentId}`;
      layer.setStyle({ color: selected ? BUILDING.selected : BUILDING.color, weight: selected ? 3 : 2, fillColor: BUILDING.color, fillOpacity: 0.12, opacity: 0.9 });
    },
    (building) => {
      const entry = building.entryEquipmentId ? byId.get(building.entryEquipmentId) : undefined;
      return entry ? { type: 'equipment', data: entry } : null;
    },
    [byId, selectedKey],
  );

  return (
    <>
      <OspDrawing map={map} />
      {/* Network mapping Phase 6: tapping a cable stretch, and showing one. */}
      <SegmentPicker map={map} />
      <PoleMoveDialog />
    </>
  );
}
