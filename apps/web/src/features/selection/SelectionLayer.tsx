import { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';

import type { LatLng, NetworkSnapshot } from '@fibergis/shared';

import { useMapStore } from '../../stores/mapStore';
import { getNetworkSnapshot, useNetworkStore } from '../../stores/networkStore';
import { useSelectionStore } from '../../stores/selectionStore';
import { cableLayersOf, equipmentLayerOf } from '../map/layerFilters';
import { PANES } from '../map/leaflet/panes';
import { useMapView } from '../map/leaflet/useMapView';
import { selectInArea } from './selectionActions';
import { SelectionBar } from './SelectionBar';
import { SelectionDialogs } from './SelectionDialogs';
import { ContextMenu } from './SelectionMenus';
import { boxPolygon, hitTest, parseKey, recordIndex, type SelectableCollection, shapeOf } from './selectionModel';

/** At most this many selected items are outlined at once (the ones in view); the bar counts them all. */
export const MAX_DRAWN_HIGHLIGHTS = 3000;

const HIGHLIGHT = '#f59e0b';
const AREA = '#7c3aed';

/**
 * Phase 16: the selection set on the map. Outlines every selected item in view (a ring round a
 * point, a wide band under a line, an edge round a zone) on a canvas that never takes a tap, draws
 * the selection area with the box, lasso or tap-the-corners tools, and opens the right-click menu
 * for the item under the pointer.
 */
export function SelectionLayer({ map }: { map: L.Map }) {
  const keys = useSelectionStore((s) => s.keys);
  const areaTool = useSelectionStore((s) => s.areaTool);
  const areaPoints = useSelectionStore((s) => s.areaPoints);
  const view = useMapView(map);
  // Re-outline when records move or are deleted.
  const equipment = useNetworkStore((s) => s.equipment);
  const cables = useNetworkStore((s) => s.cables);

  const renderer = useMemo(() => L.canvas({ pane: PANES.halo, padding: 0.2 }), []);
  const group = useMemo(() => L.layerGroup(), []);
  const sketch = useMemo(() => L.layerGroup(), []);

  useEffect(() => {
    group.addTo(map);
    sketch.addTo(map);
    return () => {
      group.remove();
      sketch.remove();
    };
  }, [map, group, sketch]);

  // Outlines of the selected items in view.
  useEffect(() => {
    group.clearLayers();
    if (keys.size === 0) return;
    const data = getNetworkSnapshot();
    const index = recordIndex(data);
    const [w, s, e, n] = view.bbox;
    let drawn = 0;
    for (const key of keys) {
      if (drawn >= MAX_DRAWN_HIGHLIGHTS) break;
      const p = parseKey(key);
      const record = p && index.get(p.collection, p.id);
      if (!p || !record) continue;
      const shape = shapeOf(p.collection, record, index);
      if (!shape) continue;
      if (shape.kind === 'point') {
        const [lat, lng] = shape.at;
        if (lat < s || lat > n || lng < w || lng > e) continue;
        L.circleMarker(shape.at, { renderer, interactive: false, radius: 15, color: HIGHLIGHT, weight: 4, opacity: 0.95, fillColor: HIGHLIGHT, fillOpacity: 0.18 }).addTo(group);
      } else {
        if (!shape.points.some(([lat, lng]) => lat >= s && lat <= n && lng >= w && lng <= e)) continue;
        if (shape.kind === 'ring') L.polygon(shape.points, { renderer, interactive: false, color: HIGHLIGHT, weight: 4, dashArray: '8 6', fillOpacity: 0.06 }).addTo(group);
        else L.polyline(shape.points, { renderer, interactive: false, color: HIGHLIGHT, weight: 12, opacity: 0.55, lineCap: 'round', lineJoin: 'round' }).addTo(group);
      }
      drawn += 1;
    }
  }, [group, renderer, keys, view, equipment, cables]);

  // The area being drawn.
  const live = useRef<LatLng[]>([]);
  const drawSketch = (points: readonly LatLng[], closed: boolean) => {
    sketch.clearLayers();
    if (points.length === 0) return;
    const style = { pane: PANES.sketch, interactive: false, color: AREA, weight: 3, dashArray: '6 5', fillColor: AREA, fillOpacity: 0.12 };
    if (closed && points.length >= 3) L.polygon(points as LatLng[], style).addTo(sketch);
    else L.polyline(points as LatLng[], style).addTo(sketch);
    for (const p of points.length <= 60 ? points : []) L.circleMarker(p, { pane: PANES.sketch, interactive: false, radius: 5, color: AREA, fillColor: '#fff', fillOpacity: 1, weight: 2 }).addTo(sketch);
  };

  useEffect(() => {
    if (areaTool === 'polygon') drawSketch(areaPoints, true);
    else if (!areaTool) sketch.clearLayers();
  }, [areaTool, areaPoints]);

  useEffect(() => {
    if (!areaTool) return;
    const container = map.getContainer();
    container.classList.add('gis-map--drawing');
    if (areaTool === 'polygon') {
      const onClick = (e: L.LeafletMouseEvent) => useSelectionStore.getState().setAreaPoints((prev) => [...prev, [e.latlng.lat, e.latlng.lng]]);
      map.on('click', onClick);
      return () => {
        map.off('click', onClick);
        container.classList.remove('gis-map--drawing');
      };
    }
    // Box and lasso: press, drag and let go (a mouse). The map does not pan meanwhile.
    const dragging = map.dragging.enabled();
    map.dragging.disable();
    let start: LatLng | null = null;
    const onDown = (e: L.LeafletMouseEvent) => {
      start = [e.latlng.lat, e.latlng.lng];
      live.current = [start];
    };
    const onMove = (e: L.LeafletMouseEvent) => {
      if (!start) return;
      const here: LatLng = [e.latlng.lat, e.latlng.lng];
      if (areaTool === 'box') live.current = boxPolygon(start, here);
      else live.current = [...live.current, here];
      drawSketch(live.current, true);
    };
    const onUp = (e: L.LeafletMouseEvent) => {
      if (!start) return;
      const polygon = areaTool === 'box' ? boxPolygon(start, [e.latlng.lat, e.latlng.lng]) : live.current;
      start = null;
      live.current = [];
      sketch.clearLayers();
      const add = !!(e.originalEvent as MouseEvent | undefined)?.shiftKey;
      if (polygon.length >= 3) selectInArea(polygon, add ? 'add' : 'replace');
      useSelectionStore.getState().setAreaTool(null);
    };
    map.on('mousedown', onDown);
    map.on('mousemove', onMove);
    map.on('mouseup', onUp);
    return () => {
      map.off('mousedown', onDown);
      map.off('mousemove', onMove);
      map.off('mouseup', onUp);
      if (dragging) map.dragging.enable();
      container.classList.remove('gis-map--drawing');
    };
  }, [map, areaTool]);

  // Right-click: the menu for what is under the pointer.
  useEffect(() => {
    const onContext = (e: L.LeafletMouseEvent) => {
      if (useMapStore.getState().activeTool !== 'select' || useSelectionStore.getState().areaTool) return;
      const original = e.originalEvent as MouseEvent;
      original.preventDefault();
      const key = hitTestAt(map, e.containerPoint);
      useSelectionStore.getState().openMenu({ key, x: original.clientX, y: original.clientY });
    };
    map.on('contextmenu', onContext);
    return () => {
      map.off('contextmenu', onContext);
    };
  }, [map]);

  return (
    <>
      <SelectionBar map={map} />
      <ContextMenu />
      <SelectionDialogs />
    </>
  );
}

/** Only what the layer switches show can be right-clicked. */
function visibleData(data: NetworkSnapshot): Pick<NetworkSnapshot, SelectableCollection> {
  const layers = useMapStore.getState().layers;
  const on = (k: string) => layers[k] !== false;
  return {
    ...data,
    equipment: data.equipment.filter((e) => on(equipmentLayerOf(e))),
    cables: data.cables.filter((c) => cableLayersOf(c).every(on)),
    customers: on('customers') ? data.customers : [],
    faults: on('faults') ? data.faults : [],
    spans: on('spans') ? data.spans : [],
    ducts: on('ducts') ? data.ducts : [],
    slackLoops: on('slackLoops') ? data.slackLoops : [],
    zones: [],
    splitters: [],
    onts: [],
  };
}

function hitTestAt(map: L.Map, at: L.Point) {
  const pad = 24;
  const sw = map.containerPointToLatLng([at.x - pad, at.y + pad]);
  const ne = map.containerPointToLatLng([at.x + pad, at.y - pad]);
  return hitTest(
    visibleData(getNetworkSnapshot()),
    { x: at.x, y: at.y },
    ([lat, lng]) => {
      const p = map.latLngToContainerPoint([lat, lng]);
      return { x: p.x, y: p.y };
    },
    { south: sw.lat, west: sw.lng, north: ne.lat, east: ne.lng },
  );
}
