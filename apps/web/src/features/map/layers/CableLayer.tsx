import { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';

import type { Cable, CableUse, PonOverview, PonSummary } from '@fibergis/shared';

import { useMapStore } from '../../../stores/mapStore';
import { useNetworkStore } from '../../../stores/networkStore';
import { useTraceStore } from '../../../stores/traceStore';
import { useUiStore } from '../../../stores/uiStore';
import { cableStyle } from '../../../theme/network';
import { cableLayersOf } from '../layerFilters';
import { lineTouchesBox } from '../leaflet/clustering';
import { selectFeatureOnClick } from '../leaflet/featureClick';
import { PANES } from '../leaflet/panes';
import { useLayerGroup } from '../leaflet/useLayerGroup';
import { useMapZoom } from '../leaflet/useLeafletMap';
import { useMapView } from '../leaflet/useMapView';
import { type MarkerSpec, useMarkerLayer } from '../leaflet/useMarkerLayer';
import { escapeHtml, formatDistance, tooltipHtml } from '../markerIcons';
import { ponColor, TRUNK_COLOR } from '../pon/ponColors';
import { prefersReducedMotion, usePonMapStore } from '../pon/ponMapStore';
import { usePonOverview } from '../pon/usePonOverview';

type HaloKind = 'traced' | 'selected' | null;

interface CableEntry {
  cable: Cable;
  line: L.Polyline;
  casing: L.Polyline | null;
  flow: L.Polyline | null;
  halo: L.Polyline | null;
  haloKind: HaloKind;
  tooltip: string;
}

const TRACE_HALO = '#10b981';
const TRACE_LINE = '#059669';
const SELECT_HALO = '#3b82f6';
const SELECT_LINE = '#1d4ed8';
/** Light flow and casings are drawn from this zoom in; further out they only add noise. */
const FLOW_MIN_ZOOM = 14;
const CABLE_LABEL_MIN_ZOOM = 16;
const LIGHT_COLORS = new Set(['#e2e8f0', '#eab308', '#06b6d4']);

interface PonLook {
  color?: string;
  pons: PonSummary[];
  use?: CableUse;
  /** Carries light to at least one active customer. */
  lit: boolean;
  dimmed: boolean;
}

function lineStyle(cable: Cable, look: PonLook, selected: boolean, traced: boolean, layerOpacity: number): L.PathOptions {
  const style = cableStyle(cable.type);
  const color = traced ? TRACE_LINE : selected ? SELECT_LINE : cable.colorHex || look.color || style.stroke;
  const base = cable.thickness ?? style.strokeWidth;
  const weight = selected ? base + 2 : look.pons.length > 1 ? base + 1 : base;
  return {
    color,
    weight,
    dashArray: style.dashArray,
    opacity: (look.dimmed ? 0.12 : cable.status === 'Damaged' ? 0.6 : 0.95) * layerOpacity,
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

const ponList = (pons: PonSummary[]) => (pons.length === 1 ? pons[0].ponPortId : `${pons.map((p) => p.ponPortId.replace(/^PON-?/i, '')).join(', ')} (${pons.length} PONs)`);

function cableTooltip(cable: Cable, look: PonLook): string {
  const pon = look.pons.length
    ? `${look.pons.length === 1 ? '' : 'PONs '}${ponList(look.pons)} · ${[...new Set(look.pons.flatMap((p) => p.areas.slice(0, 1).map((a) => a.name)))].join(', ')}`
    : 'No PON traced on its recorded fibers';
  return tooltipHtml(cable.name, [
    pon,
    cable.type,
    `${cable.fiberCount} cores${look.use ? ` · ${look.use.coresUsed} used, ${look.use.coresFree} free` : ''} · ${formatDistance(cable.lengthMeters)}`,
    cable.status !== 'Active' ? cable.status : null,
  ]);
}

/** The point halfway along a line, for its label. */
function midpoint(points: readonly [number, number][]): [number, number] | undefined {
  if (points.length < 2) return points[0];
  const seg = points.slice(1).map((p, i) => Math.hypot(p[0] - points[i][0], p[1] - points[i][1]));
  let half = seg.reduce((a, b) => a + b, 0) / 2;
  for (let i = 0; i < seg.length; i += 1) {
    if (half <= seg[i]) {
      const t = seg[i] ? half / seg[i] : 0;
      return [points[i][0] + (points[i + 1][0] - points[i][0]) * t, points[i][1] + (points[i + 1][1] - points[i][1]) * t];
    }
    half -= seg[i];
  }
  return points[points.length - 1];
}

function cableLabelIcon(text: string, color: string, ink: string): L.DivIcon {
  return L.divIcon({
    html: `<span class="gis-cable-label" style="--chip:${color};--ink:${ink}">${escapeHtml(text)}</span>`,
    className: 'gis-label-anchor',
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}

function lookOf(cable: Cable, overview: PonOverview, focus: string | null, activeCustomerIds: ReadonlySet<string>): PonLook {
  const use = overview.cables.get(cable.id);
  const pons = (use?.ponKeys ?? []).map((k) => overview.pons.find((p) => p.key === k)).filter((p): p is PonSummary => !!p);
  const color = pons.length === 1 ? ponColor(pons[0].portNumber).hex : pons.length > 1 ? TRUNK_COLOR : undefined;
  const lit =
    pons.length > 0 &&
    (cable.type === 'Drop Fiber' ? cable.cores.some((k) => k.customerId && activeCustomerIds.has(k.customerId)) : pons.some((p) => p.customers.active > 0));
  return { color, pons, use, lit, dimmed: !!focus && !pons.some((p) => p.key === focus) };
}

export interface CableLayerProps {
  map: L.Map;
  /** Already filtered by network mode and layer toggles. */
  cables: Cable[];
}

/** Cable polylines with PON colours, light flow, selection/trace halos and labels, updated in place. */
export function CableLayer({ map, cables }: CableLayerProps) {
  const group = useLayerGroup(map);
  const entries = useRef(new Map<string, CableEntry>());
  const selectedId = useUiStore((s) => (s.selectedObject?.type === 'cable' ? s.selectedObject.data.id : null));
  const tracedIds = useTraceStore((s) => s.cableIds);
  const layerOpacity = useMapStore((s) => s.layerOpacity);
  const customers = useNetworkStore((s) => s.customers);
  const overview = usePonOverview();
  const { focus, lightFlow, colorBy, identifiers } = usePonMapStore();
  const zoom = useMapZoom(map);
  const flowOn = lightFlow && zoom >= FLOW_MIN_ZOOM && !prefersReducedMotion();
  const activeIds = useMemo(() => new Set(customers.filter((c) => c.status === 'Active').map((c) => c.id)), [customers]);
  // Phase 9: only cables passing through the view (plus a margin) are drawn; the selected or traced ones always.
  const view = useMapView(map);
  const inView = useMemo(() => {
    const keep = new Set(tracedIds);
    if (selectedId) keep.add(selectedId);
    return cables.filter((c) => keep.has(c.id) || lineTouchesBox(c.coordinates, view.bbox));
  }, [cables, view, tracedIds, selectedId]);

  const looks = useMemo(() => {
    const out = new Map<string, PonLook>();
    for (const cable of inView) {
      const look = lookOf(cable, overview, focus, activeIds);
      out.set(cable.id, colorBy === 'type' ? { ...look, color: undefined } : look);
    }
    return out;
  }, [inView, overview, focus, activeIds, colorBy]);

  useEffect(() => {
    const current = entries.current;
    const traced = new Set(tracedIds);
    const seen = new Set<string>();

    for (const cable of inView) {
      seen.add(cable.id);
      const look = looks.get(cable.id)!;
      const isTraced = traced.has(cable.id);
      const isSelected = cable.id === selectedId;
      // The faintest of its layers (role and install method), so each slider works.
      const opacity = Math.min(1, ...cableLayersOf(cable).map((layer) => layerOpacity[layer] ?? 1));
      const style = lineStyle(cable, look, isSelected, isTraced, opacity);
      const tooltip = cableTooltip(cable, look);

      let entry = current.get(cable.id);
      if (!entry) {
        const line = L.polyline(cable.coordinates, style);
        line.bindTooltip(tooltip, { sticky: true, opacity: 1, className: 'gis-tooltip' });
        line.on('click', (event) => {
          const latest = current.get(cable.id)?.cable;
          if (latest) selectFeatureOnClick(event, { type: 'cable', data: latest });
        });
        group.addLayer(line);
        entry = { cable, line, casing: null, flow: null, halo: null, haloKind: null, tooltip };
        current.set(cable.id, entry);
      } else {
        if (entry.cable.coordinates !== cable.coordinates) {
          entry.line.setLatLngs(cable.coordinates);
          entry.halo?.setLatLngs(cable.coordinates);
          entry.casing?.setLatLngs(cable.coordinates);
          entry.flow?.setLatLngs(cable.coordinates);
        }
        entry.line.setStyle(style);
        if (entry.tooltip !== tooltip) {
          entry.line.setTooltipContent(tooltip);
          entry.tooltip = tooltip;
        }
        entry.cable = cable;
      }

      // A dark casing under PON-coloured fiber, so light colours (White, Yellow) read on any base map.
      const wantCasing = zoom >= FLOW_MIN_ZOOM - 1 && !!look.color && !look.dimmed;
      if (wantCasing && !entry.casing) {
        // Light PON colours (White, Yellow, Aqua) get a strong jacket so they read on a light map.
        const light = LIGHT_COLORS.has(look.color ?? '');
        entry.casing = L.polyline(cable.coordinates, { pane: PANES.halo, interactive: false, color: light ? '#1e293b' : '#0b1220', weight: (style.weight ?? 3) + (light ? 4 : 3), opacity: (light ? 0.85 : 0.35) * opacity, lineCap: 'round', lineJoin: 'round' });
        group.addLayer(entry.casing);
      } else if (!wantCasing && entry.casing) {
        group.removeLayer(entry.casing);
        entry.casing = null;
      } else entry.casing?.setStyle({ weight: (style.weight ?? 3) + 3 });

      // Light moving away from the OLT along fibers that reach an active customer.
      const wantFlow = flowOn && look.lit && !look.dimmed;
      if (wantFlow && !entry.flow) {
        entry.flow = L.polyline(cable.coordinates, {
          pane: PANES.route,
          interactive: false,
          color: '#ffffff',
          weight: Math.max(1.5, (style.weight ?? 3) - 1.5),
          opacity: 0.9,
          dashArray: '1 16',
          lineCap: 'round',
          className: look.pons.length > 1 ? 'fiber-light-flow fiber-light-flow--trunk' : 'fiber-light-flow',
        });
        group.addLayer(entry.flow);
      } else if (!wantFlow && entry.flow) {
        group.removeLayer(entry.flow);
        entry.flow = null;
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
      for (const extra of [entry.halo, entry.casing, entry.flow]) if (extra) group.removeLayer(extra);
      current.delete(id);
    }
  }, [group, inView, looks, selectedId, tracedIds, layerOpacity, flowOn, zoom]);

  // PON identifiers on the fiber itself: which PON, how many cores, how many free.
  const labels = useMemo<MarkerSpec[]>(() => {
    if (!identifiers || zoom < CABLE_LABEL_MIN_ZOOM) return [];
    const out: MarkerSpec[] = [];
    for (const cable of inView) {
      const look = looks.get(cable.id);
      if (!look?.pons.length || look.dimmed) continue;
      // Drops are too many to label; a customer's tooltip names its PON and splitter output.
      if (cable.type === 'Drop Fiber') continue;
      const at = midpoint(cable.coordinates);
      if (!at) continue;
      const chip = look.pons.length === 1 ? ponColor(look.pons[0].portNumber) : { hex: TRUNK_COLOR, ink: '#ffffff' };
      const cores = look.use ? ` · ${cable.fiberCount}F ${look.use.coresUsed}/${cable.fiberCount} used` : ` · ${cable.fiberCount}F`;
      out.push({ id: `cbl-label-${cable.id}`, latlng: at, icon: cableLabelIcon(`${ponList(look.pons)}${cores}`, chip.hex, chip.ink) });
    }
    return out;
  }, [identifiers, zoom, inView, looks]);
  useMarkerLayer(map, labels, { interactive: false, pane: PANES.labels });

  return null;
}
