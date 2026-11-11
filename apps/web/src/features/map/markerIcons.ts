import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import L from 'leaflet';
import { Bike, Flag, House, type LucideIcon, TriangleAlert } from 'lucide-react';

import type { Customer, Equipment, EquipmentCategory, EquipmentStatus, EquipmentType, Fault } from '@fibergis/shared';

import { equipmentArtUrl } from '../../components/icons/equipmentArt';
import { type EquipmentLayerKey, equipmentLayerKey } from './layerFilters';

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

const CENTRAL_OFFICE_TYPES: EquipmentType[] = [
  'OLT',
  'ODF',
  'Fiber Patch Panel',
  'Core Switch',
  'Router',
  'MikroTik Router',
  'Firewall',
];
const SUPPORT_TYPES: EquipmentType[] = [
  'Manhole',
  'Handhole',
  'Underground Chamber',
  'Duct',
  'Microduct',
  'Cable Tray',
  'Building Entry Point',
  'Junction Point',
  'Fiber Slack Loop',
];
const CUSTOMER_TYPES: EquipmentType[] = [
  'ONT',
  'ONU',
  'Wi-Fi Router',
  'Optical Modem',
  'Customer Terminal',
  'Set-Top Box',
  'Optical Instrument',
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
  if (eq.type === 'OLT') return 38;
  const layer = equipmentLayerKey(eq);
  if (layer === 'poles') return 18;
  return layer === 'manholes' ? 26 : 34;
}

export function equipmentMarkerIcon(
  eq: Pick<Equipment, 'type' | 'category' | 'status' | 'technology'>,
  state: MarkerState,
): L.DivIcon {
  const layer = equipmentLayerKey(eq);
  const isMinor = layer === 'poles' || layer === 'manholes';
  const color = equipmentColor(eq);
  const key = `eq:${eq.type}:${eq.category}:${eq.technology ?? ''}:${eq.status}:${state.selected ? 1 : 0}${state.traced ? 1 : 0}`;

  return cached(key, () => {
    const size = equipmentMarkerSize(eq);
    const artSize = size - 6;
    const art = `<img src="${equipmentArtUrl(eq.type)}" width="${artSize}" height="${artSize}" alt="" draggable="false">`;
    const shape = isMinor ? 'gis-pin--minor' : '';
    const status =
      eq.status !== 'Active' && eq.status !== 'Planned'
        ? `<span class="gis-pin__status" style="background:${STATUS_COLORS[eq.status] ?? STATUS_COLORS.Active}"></span>`
        : '';
    return L.divIcon({
      html: `<div class="gis-pin gis-pin--device ${shape} ${stateClasses(state, eq.status)}" style="--pin-color:${color};width:${size}px;height:${size}px">${art}${status}</div>`,
      className: 'gis-marker gis-marker--equipment',
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
      tooltipAnchor: [0, -size / 2 - 2],
    });
  });
}

/** `ponRing`: the colour of the PON serving this customer, drawn as a ring. */
export function customerMarkerIcon(status: Customer['status'], state: MarkerState, ponRing?: string): L.DivIcon {
  const color = CUSTOMER_STATUS_COLORS[status] ?? '#dc2626';
  const inactive = status !== 'Active';
  return cached(`cust:${color}:${state.selected ? 1 : 0}${state.traced ? 1 : 0}:${ponRing ?? ''}`, () => {
    const size = 20;
    const extra = `${ponRing ? ' has-pon' : ''}${inactive ? ' is-inactive' : ''}`;
    return L.divIcon({
      html: `<div class="gis-pin gis-pin--customer ${stateClasses(state)}${extra}" style="--pin-color:${color};background:${color};width:${size}px;height:${size}px${ponRing ? `;--pon-ring:${ponRing}` : ''}">${iconSvg(House, 11, 2.5)}</div>`,
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

/**
 * A pin whose position is not confirmed (a capture with no good GPS fix, waiting for the office):
 * a dashed amber ring with a question mark, so it can never be taken for a placed pin.
 */
export function unplacedMarkerIcon(selected: boolean): L.DivIcon {
  return cached(`unplaced:${selected ? 1 : 0}`, () =>
    L.divIcon({
      html: `<div class="gis-pin-unplaced${selected ? ' is-selected' : ''}" style="width:30px;height:30px;border-radius:9999px;border:2.5px dashed #b45309;background:#fffbeb;color:#92400e;display:flex;align-items:center;justify-content:center;font:700 16px/1 system-ui,sans-serif;box-shadow:${selected ? '0 0 0 4px rgb(59 130 246 / .45)' : '0 1px 3px rgb(0 0 0 / .3)'}">?</div>`,
      className: 'gis-marker gis-marker--unplaced',
      iconSize: [30, 30],
      iconAnchor: [15, 15],
    }),
  );
}

/**
 * Phase 19: a phone capture waiting for office review. A dashed violet ring with a small clock, so
 * it never looks like a placed, accepted pin (the amber "?" stays for "office must place").
 */
export function awaitingReviewMarkerIcon(selected: boolean): L.DivIcon {
  return cached(`review:${selected ? 1 : 0}`, () =>
    L.divIcon({
      html: `<div class="gis-pin-review${selected ? ' is-selected' : ''}" style="width:30px;height:30px;border-radius:9999px;border:2.5px dashed #6d28d9;background:#f5f3ff;color:#5b21b6;display:flex;align-items:center;justify-content:center;box-shadow:${selected ? '0 0 0 4px rgb(59 130 246 / .45)' : '0 1px 3px rgb(0 0 0 / .3)'}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg></div>`,
      className: 'gis-marker gis-marker--review',
      iconSize: [30, 30],
      iconAnchor: [15, 15],
    }),
  );
}

/** Square metres under one square kilometre, then km². */
export function formatArea(sqMeters: number): string {
  if (!Number.isFinite(sqMeters) || sqMeters <= 0) return '0 m²';
  if (sqMeters < 1_000_000) return `${Math.round(sqMeters).toLocaleString('en-IN')} m²`;
  return `${(sqMeters / 1_000_000).toFixed(sqMeters < 10_000_000 ? 2 : 1)} km²`;
}

/**
 * A round marker for a group of nearby pins (Phase 9), showing how many pins it holds so no pin
 * is ever hidden. Tapping it zooms in.
 */
export function groupMarkerIcon(count: number, kind: 'equipment' | 'customer'): L.DivIcon {
  const text = count >= 10_000 ? `${Math.floor(count / 1000)}k` : count >= 1000 ? `${(count / 1000).toFixed(1)}k` : String(count);
  const size = count >= 1000 ? 48 : count >= 100 ? 42 : 36;
  const color = kind === 'customer' ? '#0f766e' : '#1d4ed8';
  return cached(`group:${kind}:${text}:${size}`, () =>
    L.divIcon({
      html: `<div class="gis-group" style="--group-color:${color};width:${size}px;height:${size}px"><span>${escapeHtml(text)}</span></div>`,
      className: 'gis-marker gis-marker--group',
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
      tooltipAnchor: [0, -size / 2 - 2],
    }),
  );
}
