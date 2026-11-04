import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import L from 'leaflet';
import { Bike, Flag, House, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { Customer, Equipment, EquipmentCategory, EquipmentStatus, EquipmentType, Fault } from '@fibergis/shared';
import { equipmentIcon } from '../../ui/icons';

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const svgCache = new Map<string, string>();

export function iconSvg(Icon: LucideIcon, size: number, strokeWidth = 2): string {
  const key = `${Icon.displayName ?? ''}:${size}:${strokeWidth}`;
  let svg = Icon.displayName ? svgCache.get(key) : undefined;
  if (!svg) {
    svg = renderToStaticMarkup(createElement(Icon, { size, strokeWidth, 'aria-hidden': true }));
    if (Icon.displayName) svgCache.set(key, svg);
  }
  return svg;
}

/* ------------------------------------------------------------------ */
/* Equipment classification                                            */
/* ------------------------------------------------------------------ */

export type EquipmentLayerKey = 'olt' | 'odf' | 'fdms' | 'fdt' | 'fat' | 'splitters' | 'poles' | 'manholes' | 'cableTv';

export function equipmentLayerKey(eq: Pick<Equipment, 'type' | 'category'>): EquipmentLayerKey | null {
  const t = eq.type;
  if (t === 'OLT') return 'olt';
  if (eq.category === 'Cable TV Infrastructure' || t.startsWith('CATV') || t === 'Cable TV Headend') return 'cableTv';
  if (t === 'ODF' || t === 'Fiber Patch Panel') return 'odf';
  if (t === 'FDMS' || t === 'Fiber Distribution Cabinet') return 'fdms';
  if (t === 'FDT') return 'fdt';
  if (t === 'FAT' || t.includes('Terminal Box') || t === 'Distribution Point') return 'fat';
  if (t === 'Fiber Splitter') return 'splitters';
  if (t.includes('Pole')) return 'poles';
  if (t === 'Manhole' || t === 'Handhole' || t === 'Underground Chamber') return 'manholes';
  return null;
}

const CENTRAL_OFFICE_TYPES: EquipmentType[] = ['OLT', 'ODF', 'Fiber Patch Panel', 'Core Switch', 'Router', 'Firewall'];
const SUPPORT_TYPES: EquipmentType[] = [
  'Manhole',
  'Handhole',
  'Underground Chamber',
  'Duct',
  'Microduct',
  'Cable Tray',
  'Building Entry Point',
  'Junction Point',
];
const CUSTOMER_TYPES: EquipmentType[] = [
  'ONT',
  'ONU',
  'Wi-Fi Router',
  'Optical Modem',
  'Customer Terminal',
  'Set-Top Box',
];

export function categoryForType(type: EquipmentType): EquipmentCategory {
  if (
    type.startsWith('CATV') ||
    type === 'Cable TV Headend' ||
    type === 'Optical Transmitter' ||
    type === 'Headend Equipment'
  ) {
    return 'Cable TV Infrastructure';
  }
  if (CENTRAL_OFFICE_TYPES.includes(type)) return 'Central Office';
  if (type.includes('Pole') || SUPPORT_TYPES.includes(type)) return 'Supporting Infrastructure';
  if (CUSTOMER_TYPES.includes(type)) return 'Customer Equipment';
  return 'Fiber Distribution';
}

/** Marker fill per map layer. Shared with the layers drawer legend. */
export const LAYER_COLORS: Record<EquipmentLayerKey, string> = {
  olt: '#1d4ed8',
  odf: '#0369a1',
  fdms: '#4f46e5',
  fdt: '#0f766e',
  fat: '#d97706',
  splitters: '#7c3aed',
  poles: '#475569',
  manholes: '#334155',
  cableTv: '#c2410c',
};

export const EPON_COLOR = '#6d28d9';

export function equipmentColor(eq: Pick<Equipment, 'type' | 'category' | 'technology'>): string {
  if (eq.type === 'OLT') return (eq.technology || 'GPON').includes('EPON') ? EPON_COLOR : LAYER_COLORS.olt;
  const layer = equipmentLayerKey(eq);
  if (layer) return LAYER_COLORS[layer];
  if (eq.type === 'Fiber Joint Closure' || eq.type === 'Splice Closure') return '#4d7c0f';
  if (eq.category === 'Central Office') return '#0f172a';
  if (eq.category === 'Customer Equipment') return '#2563eb';
  return '#64748b';
}

export const STATUS_COLORS: Record<EquipmentStatus, string> = {
  Active: '#16a34a',
  Warning: '#f59e0b',
  Faulty: '#dc2626',
  Maintenance: '#7c3aed',
  Planned: '#64748b',
};

export const CUSTOMER_STATUS_COLORS: Record<Customer['status'], string> = {
  Active: '#2563eb',
  Suspended: '#d97706',
  'Pending Installation': '#64748b',
  Disconnected: '#dc2626',
};

/* ------------------------------------------------------------------ */
/* Marker factories                                                    */
/* ------------------------------------------------------------------ */

export interface MarkerState {
  selected: boolean;
  traced: boolean;
}

const iconCache = new Map<string, L.DivIcon>();

function cached(key: string, build: () => L.DivIcon): L.DivIcon {
  let icon = iconCache.get(key);
  if (!icon) {
    icon = build();
    iconCache.set(key, icon);
  }
  return icon;
}

function stateClasses(state: MarkerState, status?: string): string {
  return [
    state.selected ? 'is-selected' : '',
    !state.selected && state.traced ? 'is-traced' : '',
    status === 'Faulty' ? 'is-faulty' : '',
    status === 'Planned' ? 'is-planned' : '',
  ]
    .filter(Boolean)
    .join(' ');
}

export function equipmentMarkerSize(eq: Pick<Equipment, 'type' | 'category'>): number {
  if (eq.type === 'OLT') return 32;
  const layer = equipmentLayerKey(eq);
  return layer === 'poles' || layer === 'manholes' ? 20 : 28;
}

export function equipmentMarkerIcon(
  eq: Pick<Equipment, 'type' | 'category' | 'status' | 'technology'>,
  state: MarkerState,
): L.DivIcon {
  const layer = equipmentLayerKey(eq);
  const isMinor = layer === 'poles' || layer === 'manholes';
  const isOlt = eq.type === 'OLT';
  const color = equipmentColor(eq);
  const key = `eq:${eq.type}:${eq.category}:${eq.technology ?? ''}:${eq.status}:${state.selected ? 1 : 0}${state.traced ? 1 : 0}`;

  return cached(key, () => {
    const size = equipmentMarkerSize(eq);
    const glyph = iconSvg(equipmentIcon(eq.type), isOlt ? 17 : isMinor ? 11 : 15, isMinor ? 2.25 : 2);
    const shape = isOlt ? 'gis-pin--square' : isMinor ? 'gis-pin--minor' : '';
    const status =
      eq.status !== 'Active' && eq.status !== 'Planned'
        ? `<span class="gis-pin__status" style="background:${STATUS_COLORS[eq.status] ?? STATUS_COLORS.Active}"></span>`
        : '';
    const fill = isMinor ? '' : `background:${color};`;
    return L.divIcon({
      html: `<div class="gis-pin ${shape} ${stateClasses(state, eq.status)}" style="--pin-color:${color};${fill}width:${size}px;height:${size}px">${glyph}${status}</div>`,
      className: 'gis-marker',
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
      tooltipAnchor: [0, -size / 2 - 2],
    });
  });
}

export function customerMarkerIcon(status: Customer['status'], state: MarkerState): L.DivIcon {
  const color = CUSTOMER_STATUS_COLORS[status] ?? '#dc2626';
  return cached(`cust:${color}:${state.selected ? 1 : 0}${state.traced ? 1 : 0}`, () => {
    const size = 20;
    return L.divIcon({
      html: `<div class="gis-pin gis-pin--customer ${stateClasses(state)}" style="--pin-color:${color};background:${color};width:${size}px;height:${size}px">${iconSvg(House, 11, 2.5)}</div>`,
      className: 'gis-marker',
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
      tooltipAnchor: [0, -size / 2 - 2],
    });
  });
}

export function faultMarkerIcon(severity: Fault['severity'], selected: boolean): L.DivIcon {
  const color = severity === 'Critical' || severity === 'High' ? '#dc2626' : '#ea580c';
  return cached(`fault:${color}:${selected ? 1 : 0}`, () => {
    const size = 26;
    return L.divIcon({
      html: `<div class="gis-pin gis-pin--fault ${selected ? 'is-selected' : ''}" style="--pin-color:${color};background:${color};width:${size}px;height:${size}px">${iconSvg(TriangleAlert, 14, 2.25)}</div>`,
      className: 'gis-marker',
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
      tooltipAnchor: [0, -size / 2 - 2],
    });
  });
}

export function projectStartIcon(): L.DivIcon {
  return cached('project-start', () =>
    L.divIcon({
      html: `<div class="gis-pin gis-pin--square" style="--pin-color:#0f172a;background:#0f172a;width:26px;height:26px">${iconSvg(Flag, 14, 2.25)}</div>`,
      className: 'gis-marker',
      iconSize: [26, 26],
      iconAnchor: [13, 13],
      tooltipAnchor: [0, -15],
    }),
  );
}

export function gpsIcon(): L.DivIcon {
  return cached('gps', () =>
    L.divIcon({
      html: '<div class="gis-gps"><span class="gis-gps__pulse"></span><span class="gis-gps__dot"></span></div>',
      className: 'gis-marker',
      iconSize: [22, 22],
      iconAnchor: [11, 11],
      tooltipAnchor: [0, -12],
    }),
  );
}

export function routeStopIcon(kind: 'origin' | 'stop' | 'destination', label?: string): L.DivIcon {
  const color = kind === 'origin' ? '#ea580c' : kind === 'destination' ? '#16a34a' : '#0f172a';
  const size = kind === 'stop' ? 20 : 26;
  const content =
    kind === 'stop'
      ? `<span class="gis-pin__text">${escapeHtml(label ?? '')}</span>`
      : iconSvg(kind === 'origin' ? Bike : Flag, 14, 2.25);
  return L.divIcon({
    html: `<div class="gis-pin" style="--pin-color:${color};background:${color};width:${size}px;height:${size}px">${content}</div>`,
    className: 'gis-marker',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    tooltipAnchor: [0, -size / 2 - 2],
  });
}

export function labelIcon(text: string, offset: number): L.DivIcon {
  return L.divIcon({
    html: `<span class="gis-label" style="top:${offset}px">${escapeHtml(text)}</span>`,
    className: 'gis-label-anchor',
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}

/* ------------------------------------------------------------------ */
/* Tooltip content                                                     */
/* ------------------------------------------------------------------ */

export function tooltipHtml(title: string, lines: Array<string | null | undefined | false>): string {
  const body = lines
    .filter((line): line is string => typeof line === 'string' && line.length > 0)
    .map((line) => `<div class="gis-tip__meta">${escapeHtml(line)}</div>`)
    .join('');
  return `<div class="gis-tip"><div class="gis-tip__title">${escapeHtml(title)}</div>${body}</div>`;
}

/* ------------------------------------------------------------------ */
/* Geometry helpers                                                    */
/* ------------------------------------------------------------------ */

export function pathLengthMeters(points: Array<[number, number]>): number {
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    total += L.latLng(points[i][0], points[i][1]).distanceTo(L.latLng(points[i + 1][0], points[i + 1][1]));
  }
  return total;
}

export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters <= 0) return '0 m';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(meters < 10000 ? 2 : 1)} km`;
}
