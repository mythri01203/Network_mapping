import L from 'leaflet';

import type { Equipment, PonOverview, PonSummary, SplitterSummary } from '@fibergis/shared';

import { escapeHtml } from '../markerIcons';
import { capacityTone, formatDbm, ponColor, TONE_COLORS, TRUNK_COLOR } from './ponColors';

/** Splitters in each box, nearest the OLT first. */
export function splittersByBox(overview: PonOverview): Map<string, SplitterSummary[]> {
  const out = new Map<string, SplitterSummary[]>();
  for (const s of overview.splitters.values()) out.set(s.boxId, [...(out.get(s.boxId) ?? []), s]);
  for (const list of out.values()) list.sort((a, b) => (a.stage ?? 99) - (b.stage ?? 99));
  return out;
}

const ponOf = (overview: PonOverview, key: string | undefined): PonSummary | undefined => (key ? overview.pons.find((p) => p.key === key) : undefined);

/** Lines for a box's tooltip: PON, area, splitter design, outputs and level. */
export function boxSummaryLines(eq: Pick<Equipment, 'id' | 'type'>, overview: PonOverview, byBox: Map<string, SplitterSummary[]>): string[] {
  if (eq.type === 'OLT') {
    const pons = overview.pons.filter((p) => p.oltId === eq.id);
    if (!pons.length) return [];
    const total = pons.reduce((n, p) => n + p.customers.total, 0);
    const free = pons.reduce((n, p) => n + p.accessOutputs.free, 0);
    return [`${pons.length} PON ports · ${total} customers · ${free} free outputs`];
  }
  const keys = overview.equipment.get(eq.id) ?? [];
  const pons = keys.map((k) => ponOf(overview, k)).filter((p): p is PonSummary => !!p);
  const lines: string[] = [];
  if (pons.length) lines.push(`${pons.map((p) => p.ponPortId).join(', ')} · ${[...new Set(pons.flatMap((p) => p.areas.slice(0, 1).map((a) => a.name)))].join(', ')}`);
  for (const s of byBox.get(eq.id) ?? []) {
    lines.push(
      `Splitter ${s.ratio}${s.stage ? ` (stage ${s.stage})` : ''}: ${s.outputs.used} of ${s.outputs.total} used, ${s.outputs.free} free · in ${formatDbm(s.inputDbm)}, out ${formatDbm(s.outputDbm)} (estimated)`,
    );
  }
  return lines;
}

/** Badge above a box: PON chip, splitter ratio and stage, used/free outputs, estimated level. */
export function boxBadgeIcon(splitters: SplitterSummary[], overview: PonOverview, offset: number, compact = false): L.DivIcon {
  if (compact) {
    const chips = splitters
      .map((s) => {
        const pon = ponOf(overview, s.ponKey);
        const chip = pon ? ponColor(pon.portNumber) : { hex: '#94a3b8', ink: '#0f172a' };
        const tone = TONE_COLORS[capacityTone(s.outputs.free, s.outputs.total)];
        return `<span class="gis-badge__chip" style="background:${chip.hex};color:${chip.ink}">${escapeHtml(s.ratio)}</span><span class="gis-badge__free" style="color:${tone}">${s.outputs.free}</span>`;
      })
      .join('');
    return L.divIcon({
      html: `<div class="gis-badge gis-badge--compact" style="--badge-offset:${offset}px"><div class="gis-badge__row">${chips}</div></div>`,
      className: 'gis-label-anchor',
      iconSize: [0, 0],
      iconAnchor: [0, 0],
    });
  }
  const rows = splitters
    .map((s) => {
      const pon = ponOf(overview, s.ponKey);
      const chip = pon ? ponColor(pon.portNumber) : { hex: '#94a3b8', ink: '#0f172a' };
      const tone = TONE_COLORS[capacityTone(s.outputs.free, s.outputs.total)];
      const dots = Array.from({ length: Math.min(16, s.outputs.total) }, (_, i) =>
        `<i class="gis-badge__dot" style="background:${i < s.outputs.used ? chip.hex : i < s.outputs.used + s.outputs.faulty ? '#dc2626' : '#e2e8f0'}"></i>`,
      ).join('');
      return `<div class="gis-badge__row">
        <span class="gis-badge__chip" style="background:${chip.hex};color:${chip.ink}">${escapeHtml(pon?.ponPortId ?? 'No PON')}</span>
        <span class="gis-badge__ratio">${escapeHtml(s.ratio)}${s.stage ? `<small>S${s.stage}</small>` : ''}</span>
        <span class="gis-badge__free" style="color:${tone}">${s.outputs.free} free</span>
        ${s.inputDbm !== undefined && s.outputDbm !== undefined ? `<span class="gis-badge__dbm">${escapeHtml(formatDbm(s.inputDbm).replace(' dBm', ''))} → ${escapeHtml(formatDbm(s.outputDbm))}</span>` : ''}
      </div><div class="gis-badge__dots">${dots}</div>`;
    })
    .join('');
  return L.divIcon({
    html: `<div class="gis-badge" style="--badge-offset:${offset}px">${rows}</div>`,
    className: 'gis-label-anchor',
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}

/** Badge above the OLT: make, ports, customers and free outputs. */
export function oltBadgeIcon(olt: Pick<Equipment, 'manufacturer' | 'model'>, pons: PonSummary[], offset: number): L.DivIcon {
  const total = pons.reduce((n, p) => n + p.customers.total, 0);
  const active = pons.reduce((n, p) => n + p.customers.active, 0);
  const free = pons.reduce((n, p) => n + p.accessOutputs.free, 0);
  const chips = pons.map((p) => `<i style="background:${ponColor(p.portNumber).hex}" title="${escapeHtml(p.ponPortId)}"></i>`).join('');
  return L.divIcon({
    html: `<div class="gis-badge gis-badge--olt" style="--badge-offset:${offset}px;--chip:${TRUNK_COLOR}">
      <div class="gis-badge__title">${escapeHtml([olt.manufacturer, olt.model].filter(Boolean).join(' ') || 'OLT')}</div>
      <div class="gis-badge__chips">${chips}</div>
      <div class="gis-badge__meta">${pons.length} PON · ${active}/${total} active · ${free} free</div>
    </div>`,
    className: 'gis-label-anchor',
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}
