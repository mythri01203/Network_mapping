import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Eye, EyeOff, Layers, Save, Trash2, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { hasRecordedLocation, isFaultOpen, segmentInstallMethods } from '@fibergis/shared';

import { useAuthStore } from '../../stores/authStore';
import { type SavedMapView, type TileProvider, useMapStore } from '../../stores/mapStore';
import { useNetworkStore } from '../../stores/networkStore';
import { showToast } from '../../stores/toastStore';
import { cableStyle } from '../../theme/network';
import { cableLayersOf, equipmentLayerOf } from './layerFilters';
import { CUSTOMER_STATUS_COLORS, LAYER_COLORS, STATUS_COLORS } from './markerIcons';

interface LayerDef {
  key: string;
  label: string;
  /** What the swatch shows: a pin colour, or a line drawn like the map draws it. */
  swatch: { kind: 'dot'; color: string } | { kind: 'line'; color: string; dash?: string; width?: number };
}

const line = (type: string): LayerDef['swatch'] => {
  const s = cableStyle(type);
  return { kind: 'line', color: s.stroke, dash: s.dashArray, width: s.strokeWidth };
};

const CABLE_ROLES: LayerDef[] = [
  { key: 'feederCable', label: 'Feeder cables', swatch: line('Main Feeder Fiber') },
  { key: 'distributionCable', label: 'Distribution cables', swatch: line('Distribution Fiber') },
  { key: 'dropCable', label: 'Drop cables', swatch: line('Drop Fiber') },
  { key: 'coaxialCable', label: 'Coaxial cables (cable TV)', swatch: line('Coaxial Cable') },
];
// How a cable is installed does not change how it is drawn (its role does), so these have no line style.
const CABLE_INSTALL: LayerDef[] = [
  { key: 'aerialCable', label: 'Aerial (on poles or walls)', swatch: { kind: 'dot', color: '#94a3b8' } },
  { key: 'undergroundCable', label: 'Underground (duct or buried)', swatch: { kind: 'dot', color: '#94a3b8' } },
];
/** Older cable type names with their own line style. */
const OLDER_TYPES: LayerDef[] = [
  { key: 'type-aerial', label: 'Cable of type "Aerial Fiber"', swatch: line('Aerial Fiber') },
  { key: 'type-underground', label: 'Cable of type "Underground Fiber"', swatch: line('Underground Fiber') },
];
const EQUIPMENT: Record<string, LayerDef> = {
  olt: { key: 'olt', label: 'OLTs', swatch: { kind: 'dot', color: LAYER_COLORS.olt } },
  odf: { key: 'odf', label: 'ODFs and patch panels', swatch: { kind: 'dot', color: LAYER_COLORS.odf } },
  fdms: { key: 'fdms', label: 'FDMS cabinets', swatch: { kind: 'dot', color: LAYER_COLORS.fdms } },
  fdt: { key: 'fdt', label: 'FDT boxes', swatch: { kind: 'dot', color: LAYER_COLORS.fdt } },
  fat: { key: 'fat', label: 'FAT and terminal boxes', swatch: { kind: 'dot', color: LAYER_COLORS.fat } },
  splitters: { key: 'splitters', label: 'Splitter pins', swatch: { kind: 'dot', color: LAYER_COLORS.splitters } },
  cableTv: { key: 'cableTv', label: 'Cable TV equipment', swatch: { kind: 'dot', color: LAYER_COLORS.cableTv } },
  otherEquipment: { key: 'otherEquipment', label: 'Other equipment (custom types)', swatch: { kind: 'dot', color: '#64748b' } },
  poles: { key: 'poles', label: 'Poles', swatch: { kind: 'dot', color: LAYER_COLORS.poles } },
  manholes: { key: 'manholes', label: 'Manholes and chambers', swatch: { kind: 'dot', color: LAYER_COLORS.manholes } },
};
const STRUCTURES: LayerDef[] = [
  { key: 'spans', label: 'Spans between poles', swatch: { kind: 'line', color: '#7c2d12', width: 3 } },
  { key: 'ducts', label: 'Ducts', swatch: { kind: 'line', color: '#78716c', width: 5 } },
  { key: 'slackLoops', label: 'Slack loops', swatch: { kind: 'dot', color: '#7c3aed' } },
  { key: 'zones', label: 'Zone boundaries', swatch: { kind: 'line', color: '#7c3aed', dash: '8, 6', width: 2 } },
];
const PEOPLE: LayerDef[] = [
  { key: 'customers', label: 'Customers', swatch: { kind: 'dot', color: CUSTOMER_STATUS_COLORS.Active } },
  { key: 'faults', label: 'Open faults', swatch: { kind: 'dot', color: '#dc2626' } },
];

const ZOOM_CHOICES = [12, 13, 14, 15, 16, 17, 18];
const BASEMAPS: { id: TileProvider; label: string }[] = [
  { id: 'google_streets', label: 'Google Maps' },
  { id: 'google_satellite', label: 'Google Satellite' },
  { id: 'osm', label: 'OpenStreetMap' },
];

function Swatch({ swatch }: { swatch: LayerDef['swatch'] }) {
  if (swatch.kind === 'dot') return <span className="h-3 w-3 shrink-0 rounded-full shadow-xs" style={{ backgroundColor: swatch.color }} />;
  return (
    <svg width="22" height="10" className="shrink-0" aria-hidden>
      <line x1="1" y1="5" x2="21" y2="5" stroke={swatch.color} strokeWidth={Math.min(5, swatch.width ?? 3)} strokeDasharray={swatch.dash} strokeLinecap="round" />
    </svg>
  );
}

/** How many records each layer holds, worked out from the records on this device. */
function useLayerCounts(): Record<string, number> {
  const { equipment, cables, spans, ducts, slackLoops, zones, customers, faults } = useNetworkStore(
    useShallow((s) => ({ equipment: s.equipment, cables: s.cables, spans: s.spans, ducts: s.ducts, slackLoops: s.slackLoops, zones: s.zones, customers: s.customers, faults: s.faults })),
  );
  // Network mapping Phase 6: a cable with stretches of different install methods counts in each install layer.
  const cableSegments = useNetworkStore((s) => s.cableSegments);
  return useMemo(() => {
    const counts: Record<string, number> = {};
    const add = (k: string) => (counts[k] = (counts[k] ?? 0) + 1);
    for (const e of equipment) add(equipmentLayerOf(e));
    const methods = segmentInstallMethods(cableSegments ?? []);
    for (const c of cables) for (const k of cableLayersOf(c, methods.get(c.id))) add(k);
    counts.spans = spans.length;
    counts.ducts = ducts.length;
    counts.slackLoops = slackLoops.length;
    counts.zones = zones.filter((z) => z.boundaryCoords.length >= 3).length;
    counts.customers = customers.filter((c) => hasRecordedLocation(c)).length;
    counts.faults = faults.filter((f) => isFaultOpen(f)).length;
    return counts;
  }, [equipment, cables, spans, ducts, slackLoops, zones, customers, faults, cableSegments]);
}

const iconBtn = 'flex h-11 w-11 items-center justify-center rounded-md transition-colors disabled:opacity-30 md:h-7 md:w-7';

function LayerRow({ layer, count, order }: { layer: LayerDef; count: number; order?: { up: boolean; down: boolean } }) {
  const s = useMapStore(
    useShallow((st) => ({
      on: st.layers[layer.key] !== false,
      opacity: st.layerOpacity[layer.key] ?? 1,
      minZoom: st.layerMinZoom[layer.key],
      label: st.layerLabels[layer.key],
      toggleLayer: st.toggleLayer,
      setLayerOpacity: st.setLayerOpacity,
      setLayerMinZoom: st.setLayerMinZoom,
      setLayerLabel: st.setLayerLabel,
      moveEquipmentLayer: st.moveEquipmentLayer,
    })),
  );
  return (
    <div className={`rounded-xl border p-2.5 transition-all ${s.on ? 'border-slate-200 bg-white shadow-2xs' : 'border-slate-100 bg-slate-50/60 opacity-70'}`} data-testid={`layer-row-${layer.key}`}>
      <div className="flex items-center gap-2">
        <Swatch swatch={layer.swatch} />
        <span className="min-w-0 flex-1 text-xs font-semibold text-slate-800">{layer.label}</span>
        <span className="tabular-nums text-[11px] text-slate-500" data-testid={`layer-count-${layer.key}`}>
          {count}
        </span>
        {order && (
          <>
            <button type="button" className={`${iconBtn} text-slate-500 hover:bg-slate-100`} disabled={!order.up} onClick={() => s.moveEquipmentLayer(layer.key, -1)} title="Draw above the layer before it" aria-label={`Move ${layer.label} up`}>
              <ChevronUp className="h-3.5 w-3.5" />
            </button>
            <button type="button" className={`${iconBtn} text-slate-500 hover:bg-slate-100`} disabled={!order.down} onClick={() => s.moveEquipmentLayer(layer.key, 1)} title="Draw below the layer after it" aria-label={`Move ${layer.label} down`}>
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => s.toggleLayer(layer.key)}
          className={`${iconBtn} ${s.on ? 'text-blue-600 hover:bg-blue-50' : 'text-slate-400 hover:bg-slate-200'}`}
          title={s.on ? 'Hide layer' : 'Show layer'}
          aria-label={`${s.on ? 'Hide' : 'Show'} ${layer.label}`}
          aria-pressed={s.on}
          data-testid={`layer-toggle-${layer.key}`}
        >
          {s.on ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
        </button>
      </div>
      {s.on && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-slate-100 pt-2 text-[11px] text-slate-500">
          <label className="flex items-center gap-1.5">
            Opacity {Math.round(s.opacity * 100)}%
            <input type="range" min="0.2" max="1" step="0.05" value={s.opacity} onChange={(e) => s.setLayerOpacity(layer.key, parseFloat(e.target.value))} className="h-1 w-20 cursor-pointer accent-blue-600" />
          </label>
          <label className="flex items-center gap-1">
            Show
            <select
              value={s.minZoom ? s.minZoom : ''}
              onChange={(e) => s.setLayerMinZoom(layer.key, e.target.value === '' ? null : Number(e.target.value))}
              className="rounded border border-slate-200 bg-white px-1 py-0.5 text-[11px] text-slate-700"
              data-testid={`layer-minzoom-${layer.key}`}
            >
              <option value="">at every zoom</option>
              {ZOOM_CHOICES.map((z) => (
                <option key={z} value={z}>
                  from zoom {z}
                </option>
              ))}
            </select>
          </label>
          {layer.key in EQUIPMENT && (
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={s.label !== false} onChange={(e) => s.setLayerLabel(layer.key, e.target.checked)} className="accent-blue-600" data-testid={`layer-label-${layer.key}`} />
              Name labels
            </label>
          )}
        </div>
      )}
    </div>
  );
}

function Group({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{title}</h4>
      {note && <p className="text-[11px] text-slate-500">{note}</p>}
      <div className="space-y-2">{children}</div>
    </div>
  );
}

/** Saved layer choices and place, for the person signed in on this device. */
function SavedViews() {
  const ownerId = useAuthStore((s) => s.account?.id ?? '');
  const { savedViews, saveView, deleteView, applyView } = useMapStore(
    useShallow((s) => ({ savedViews: s.savedViews, saveView: s.saveView, deleteView: s.deleteView, applyView: s.applyView })),
  );
  const mine = savedViews.filter((v) => v.ownerId === ownerId);
  const [name, setName] = useState('');
  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      showToast('warning', 'Name the view', 'Give the view a name, such as "Ward 12 poles".');
      return;
    }
    const s = useMapStore.getState();
    const view: SavedMapView = {
      id: `VIEW-${Date.now().toString(36)}`,
      name: trimmed,
      ownerId,
      createdAt: new Date().toISOString(),
      viewport: s.viewport,
      layers: s.layers,
      layerOpacity: s.layerOpacity,
      layerMinZoom: s.layerMinZoom,
      layerLabels: s.layerLabels,
      labelMinZoom: s.labelMinZoom,
      equipmentOrder: s.equipmentOrder,
    };
    saveView(view);
    setName('');
    showToast('success', 'View saved', `"${trimmed}" is saved on this device.`);
  };
  return (
    <Group title="Saved views" note="Layer choices and the place on the map, saved on this device for you.">
      <div className="flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name this view" className="min-h-9 min-w-0 flex-1 rounded-lg border border-slate-200 px-2 text-xs" data-testid="view-name" />
        <button type="button" onClick={save} className="flex min-h-9 items-center gap-1 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-500" data-testid="view-save">
          <Save className="h-3.5 w-3.5" /> Save
        </button>
      </div>
      {mine.length === 0 ? (
        <p className="text-[11px] text-slate-400">No saved views yet.</p>
      ) : (
        mine.map((v) => (
          <div key={v.id} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1" data-testid="saved-view">
            <button type="button" onClick={() => applyView(v)} className="min-h-9 min-w-0 flex-1 truncate text-left text-xs font-semibold text-blue-700 hover:underline">
              {v.name}
            </button>
            <button type="button" onClick={() => deleteView(v.id)} className={`${iconBtn} text-slate-400 hover:bg-rose-50 hover:text-rose-600`} aria-label={`Delete view ${v.name}`}>
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))
      )}
    </Group>
  );
}

/** What the symbols mean, drawn from the same styles the map uses. */
function Legend() {
  const statusRow = (label: string, color: string) => (
    <div className="flex items-center gap-2">
      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </div>
  );
  return (
    <Group title="Legend">
      <div className="grid grid-cols-1 gap-1.5 rounded-xl border border-slate-200 bg-white p-2.5 text-[11px] text-slate-600 sm:grid-cols-2">
        {[...CABLE_ROLES, ...OLDER_TYPES].map((l) => (
          <div key={l.key} className="flex items-center gap-2">
            <Swatch swatch={l.swatch} /> {l.label}
          </div>
        ))}
        <div className="flex items-center gap-2">
          <svg width="22" height="10" aria-hidden>
            <line x1="1" y1="5" x2="21" y2="5" stroke="#1d4ed8" strokeOpacity="0.45" strokeWidth="4" strokeLinecap="round" />
          </svg>
          Faded line: cable marked damaged
        </div>
        <div className="flex items-center gap-2">
          <svg width="22" height="10" aria-hidden>
            <line x1="1" y1="5" x2="21" y2="5" stroke="#7c2d12" strokeWidth="3" strokeDasharray="6 7" />
          </svg>
          Dashed span: proposed (dotted: planned)
        </div>
        {statusRow('Pin dot: Warning', STATUS_COLORS.Warning)}
        {statusRow('Pin dot: Faulty', STATUS_COLORS.Faulty)}
        {statusRow('Pin dot: Maintenance', STATUS_COLORS.Maintenance)}
        <div className="flex items-center gap-2">
          <span className="flex h-4 w-4 items-center justify-center rounded-full border-2 border-dashed border-amber-700 bg-amber-50 text-[9px] font-bold text-amber-800">?</span>
          Position not confirmed: office must place it
        </div>
        <div className="flex items-center gap-2">
          <span className="h-4 w-4 rounded-full border-2 border-dashed border-violet-700 bg-violet-50" aria-hidden />
          Phone capture awaiting office review (Operations, Field captures)
        </div>
      </div>
    </Group>
  );
}

export const AdvancedLayersDrawer: React.FC = () => {
  const { isOpen, setOpen, tileProvider, setTileProvider, equipmentOrder, labelsOn, toggleLayer, labelMinZoom, setLabelMinZoom } = useMapStore(
    useShallow((s) => ({
      isOpen: s.isLayersDrawerOpen,
      setOpen: s.setLayersDrawerOpen,
      tileProvider: s.tileProvider,
      setTileProvider: s.setTileProvider,
      equipmentOrder: s.equipmentOrder,
      labelsOn: s.layers.labels !== false,
      toggleLayer: s.toggleLayer,
      labelMinZoom: s.labelMinZoom,
      setLabelMinZoom: s.setLabelMinZoom,
    })),
  );
  const counts = useLayerCounts();
  if (!isOpen) return null;

  const row = (l: LayerDef) => <LayerRow key={l.key} layer={l} count={counts[l.key] ?? 0} />;

  return (
    <div className="fixed inset-y-0 right-0 z-[1400] flex w-full flex-col overflow-hidden border-l border-slate-200 bg-white shadow-2xl animate-in slide-in-from-right duration-200 select-none sm:w-96" data-testid="layers-drawer">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-slate-50 px-4">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-blue-600" />
          <h3 className="text-xs font-bold text-slate-800">Map layers</h3>
        </div>
        <button type="button" onClick={() => setOpen(false)} className={`${iconBtn} text-slate-400 hover:bg-slate-200/50 hover:text-slate-700`} aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto p-4">
        <Group title="Base map">
          <div className="grid grid-cols-3 gap-2">
            {BASEMAPS.map((tile) => (
              <button
                key={tile.id}
                type="button"
                onClick={() => setTileProvider(tile.id)}
                className={`min-h-9 rounded-lg border px-2 py-1.5 text-[11px] font-semibold transition-all ${tileProvider === tile.id ? 'border-blue-600 bg-blue-600 text-white shadow-2xs' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}
              >
                {tile.label}
              </button>
            ))}
          </div>
        </Group>

        <SavedViews />

        <Group title="Cables by role">{CABLE_ROLES.map(row)}</Group>
        <Group title="Cables by how they are installed" note="From each cable's recorded installation type. A cable with none recorded is in neither.">
          {CABLE_INSTALL.map(row)}
        </Group>
        <Group title="Equipment" note="Top of the list is drawn on top where pins overlap.">
          {equipmentOrder.map((key, i) => {
            const def = EQUIPMENT[key];
            if (!def) return null;
            return <LayerRow key={key} layer={def} count={counts[key] ?? 0} order={{ up: i > 0, down: i < equipmentOrder.length - 1 }} />;
          })}
        </Group>
        <Group title="Structures and areas">{STRUCTURES.map(row)}</Group>
        <Group title="Customers and faults">{PEOPLE.map(row)}</Group>

        <Group title="Name labels">
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-2.5 text-[11px] text-slate-600">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={labelsOn} onChange={() => toggleLayer('labels')} className="accent-blue-600" data-testid="labels-master" />
              Show name labels
            </label>
            <label className="flex items-center gap-1">
              from zoom
              <select value={labelMinZoom} onChange={(e) => setLabelMinZoom(Number(e.target.value))} className="rounded border border-slate-200 bg-white px-1 py-0.5 text-[11px] text-slate-700" data-testid="labels-minzoom">
                {[14, 15, 16, 17, 18, 19].map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </Group>

        <Legend />
      </div>
    </div>
  );
};
