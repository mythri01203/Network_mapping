import React, { useMemo } from 'react';
import { Activity, ChevronLeft, Info, MapPin, Network, Sparkles, Tags, X, Zap } from 'lucide-react';

import { type Equipment, type PonSummary, type SplitterSummary } from '@fibergis/shared';

import { cn } from '../../../components/ui';
import { useMapStore } from '../../../stores/mapStore';
import { useNetworkStore } from '../../../stores/networkStore';
import { useUiStore } from '../../../stores/uiStore';
import { splittersByBox } from './boxBadges';
import { capacityTone, formatDbm, ponColor, TONE_COLORS } from './ponColors';
import { usePonMapStore } from './ponMapStore';
import { useAffectedCustomers, usePonOverview } from './usePonOverview';

/** Zooms the map to a PON's boxes and customers. */
function flyToPon(pon: PonSummary) {
  if (!pon.bounds) return;
  useMapStore.getState().fitBounds({ south: pon.bounds.south, west: pon.bounds.west, north: pon.bounds.north, east: pon.bounds.east });
}

function selectBox(box: Equipment | undefined) {
  if (!box) return;
  useUiStore.getState().select({ type: 'equipment', data: box });
  useUiStore.getState().setPanelOpen('right', true);
  useMapStore.getState().flyTo(box.lat, box.lng, 18);
}

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col rounded-lg bg-white/5 px-2 py-1.5">
      <span className="text-[15px] font-extrabold tabular-nums" style={tone ? { color: tone } : undefined}>
        {value}
      </span>
      <span className="truncate text-[10px] font-medium text-slate-400">{label}</span>
    </div>
  );
}

function UsageBar({ used, total, color }: { used: number; total: number; color: string }) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
      <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

function Toggle({ on, onClick, icon: Icon, label }: { on: boolean; onClick: () => void; icon: typeof Zap; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        'flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-semibold transition-colors',
        on ? 'bg-sky-500/25 text-sky-200 ring-1 ring-sky-400/50' : 'bg-white/5 text-slate-400 hover:bg-white/10',
      )}
    >
      <Icon size={12} />
      {label}
    </button>
  );
}

function PonRow({ pon, focused, affected }: { pon: PonSummary; focused: boolean; affected: number }) {
  const color = ponColor(pon.portNumber);
  const free = pon.accessOutputs.free;
  const tone = TONE_COLORS[capacityTone(free, pon.accessOutputs.total)];
  const inactive = pon.customers.total - pon.customers.active;
  const setFocus = usePonMapStore((s) => s.setFocus);
  return (
    <button
      type="button"
      onClick={() => {
        setFocus(focused ? null : pon.key);
        if (!focused) flyToPon(pon);
      }}
      className={cn(
        'group w-full rounded-xl border px-2.5 py-2 text-left transition-all duration-300',
        focused ? 'border-sky-400/70 bg-sky-500/15 shadow-[0_0_0_1px_rgb(56_189_248/0.4),0_8px_24px_rgb(14_165_233/0.25)]' : 'border-white/5 bg-white/[0.03] hover:border-white/15 hover:bg-white/[0.07]',
      )}
      data-testid={`pon-row-${pon.ponPortId}`}
    >
      <div className="flex items-center gap-2">
        <span className="rounded-md px-1.5 py-0.5 text-[11px] font-extrabold" style={{ background: color.hex, color: color.ink }}>
          {pon.ponPortId}
        </span>
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-bold text-white">{pon.areas[0]?.name ?? 'No customers yet'}</span>
        {affected > 0 && <span className="rounded bg-rose-500/25 px-1.5 text-[10px] font-bold text-rose-300">{affected} affected</span>}
        <span className="text-[11px] font-bold tabular-nums" style={{ color: tone }}>
          {free} free
        </span>
      </div>
      <div className="mt-1 truncate text-[10.5px] text-slate-400">
        {pon.vendorAddress ? `${pon.vendorAddress} · ` : ''}
        {pon.streets.slice(0, 3).join(', ') || 'Streets not recorded on its boxes'}
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <UsageBar used={pon.accessOutputs.used} total={pon.accessOutputs.total} color={color.hex} />
        <span className="shrink-0 text-[10.5px] tabular-nums text-slate-300">
          {pon.customers.active} active{inactive ? ` · ${inactive} inactive` : ''}
        </span>
      </div>
    </button>
  );
}

function SplitterLine({ s, box }: { s: SplitterSummary; box?: Equipment }) {
  const tone = TONE_COLORS[capacityTone(s.outputs.free, s.outputs.total)];
  return (
    <button
      type="button"
      onClick={() => selectBox(box)}
      className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left hover:bg-white/10"
      title="Show this box on the map"
    >
      <span className="w-7 shrink-0 rounded bg-white/10 text-center text-[9.5px] font-bold text-slate-300">S{s.stage ?? '?'}</span>
      <span className="min-w-0 flex-1 truncate text-[11px] text-slate-200">{box?.name ?? s.boxId}</span>
      <span className="text-[11px] font-bold text-white">{s.ratio}</span>
      <span className="w-[54px] text-right text-[10.5px] tabular-nums" style={{ color: tone }}>
        {s.outputs.used}/{s.outputs.total}
      </span>
      <span className="w-[62px] text-right text-[10.5px] tabular-nums text-sky-300">{s.outputDbm !== undefined ? formatDbm(s.outputDbm).replace(' dBm', '') : '—'}</span>
    </button>
  );
}

function PonDetail({ pon }: { pon: PonSummary }) {
  const overview = usePonOverview();
  const equipment = useNetworkStore((s) => s.equipment);
  const byId = useMemo(() => new Map(equipment.map((e) => [e.id, e])), [equipment]);
  const list = pon.splitterIds.map((id) => overview.splitters.get(id)).filter((s): s is SplitterSummary => !!s).sort((a, b) => (a.stage ?? 9) - (b.stage ?? 9) || a.name.localeCompare(b.name));
  const color = ponColor(pon.portNumber);
  const c = pon.customers;
  return (
    <div className="animate-in fade-in slide-in-from-top-2 space-y-2 rounded-xl border border-white/10 bg-slate-950/60 p-2.5">
      <div className="flex items-center gap-2">
        <span className="h-3 w-3 rounded-full ring-2 ring-white" style={{ background: color.hex }} />
        <span className="text-[13px] font-extrabold text-white">
          {pon.ponPortId} · {pon.areas.map((a) => a.name).join(', ') || 'no customers'}
        </span>
      </div>
      <div className="flex gap-1.5">
        <Stat label="Active" value={c.active} tone="#4ade80" />
        <Stat label="Inactive" value={c.total - c.active} tone={c.total - c.active ? '#fbbf24' : undefined} />
        <Stat label="Can add now" value={pon.accessOutputs.free} tone={TONE_COLORS[capacityTone(pon.accessOutputs.free, pon.accessOutputs.total)]} />
        <Stat label="Split" value={`1:${pon.maxSplitProduct || '?'}`} />
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10.5px] text-slate-400">
        <span>OLT port</span>
        <span className="text-right text-slate-200">{pon.vendorAddress ?? 'address not recorded'}</span>
        <span>Optics</span>
        <span className="text-right text-slate-200">{pon.opticsClass ?? 'class not recorded'}</span>
        <span>OLT launch (recorded)</span>
        <span className="text-right text-slate-200">{pon.txPowerDbm !== undefined ? formatDbm(pon.txPowerDbm) : 'not recorded'}</span>
        <span>ONT light (estimated)</span>
        <span className="text-right text-sky-300">{pon.rxRange ? `${formatDbm(pon.rxRange.maxDbm)} to ${formatDbm(pon.rxRange.minDbm)}` : 'needs launch power'}</span>
        <span>Outputs used / reserved / faulty</span>
        <span className="text-right text-slate-200">
          {pon.accessOutputs.used} / {pon.accessOutputs.reserved} / {pon.accessOutputs.faulty}
        </span>
      </div>
      {pon.streets.length > 0 && (
        <div>
          <div className="mb-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
            <MapPin size={10} /> Streets served
          </div>
          <div className="flex flex-wrap gap-1">
            {pon.streets.map((s) => (
              <span key={s} className="rounded-full bg-white/[0.07] px-2 py-0.5 text-[10.5px] text-slate-200">
                {s}
              </span>
            ))}
          </div>
        </div>
      )}
      <div>
        <div className="mb-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
          <Network size={10} /> Splitters <span className="ml-auto normal-case tracking-normal">used · out dBm (est.)</span>
        </div>
        <div className="max-h-[220px] overflow-y-auto pr-1">
          {list.map((s) => (
            <SplitterLine key={s.splitterId} s={s} box={byId.get(s.boxId)} />
          ))}
        </div>
      </div>
      {pon.problems.length > 0 && (
        <div className="rounded-lg bg-amber-500/10 p-2 text-[10.5px] text-amber-200">
          {pon.problems.slice(0, 3).map((p) => (
            <div key={p}>{p}</div>
          ))}
        </div>
      )}
    </div>
  );
}

/** The network by PON port: areas, streets, customers, free outputs, splitters and estimated light. */
export function PonPanel() {
  const overview = usePonOverview();
  const affected = useAffectedCustomers();
  const { focus, setFocus, panelOpen, setPanelOpen, lightFlow, setLightFlow, identifiers, setIdentifiers, colorBy, setColorBy } = usePonMapStore();
  const equipment = useNetworkStore((s) => s.equipment);
  const byBox = useMemo(() => splittersByBox(overview), [overview]);

  const olts = useMemo(() => {
    const ids = [...new Set(overview.pons.map((p) => p.oltId))];
    return ids.map((id) => ({ olt: equipment.find((e) => e.id === id), pons: overview.pons.filter((p) => p.oltId === id) }));
  }, [overview, equipment]);
  const affectedByPon = useMemo(() => {
    const out = new Map<string, number>();
    for (const id of affected.keys()) {
      const key = overview.customers.get(id)?.ponKey;
      if (key) out.set(key, (out.get(key) ?? 0) + 1);
    }
    return out;
  }, [affected, overview]);

  if (overview.pons.length === 0) return null;
  const totals = overview.pons.reduce(
    (t, p) => ({ active: t.active + p.customers.active, inactive: t.inactive + p.customers.total - p.customers.active, free: t.free + p.accessOutputs.free }),
    { active: 0, inactive: 0, free: 0 },
  );
  const focused = focus ? overview.pons.find((p) => p.key === focus) : undefined;

  if (!panelOpen) {
    return (
      <button
        type="button"
        onClick={() => setPanelOpen(true)}
        className="gis-no-print absolute right-4 top-16 z-[430] hidden items-center gap-2 rounded-xl border border-slate-700/80 bg-slate-900/95 px-3 py-2 text-[12px] font-bold text-white shadow-xl backdrop-blur md:flex"
        data-testid="pon-panel-open"
      >
        <ChevronLeft size={14} /> <Activity size={14} className="text-sky-400" /> PON network · {overview.pons.length} PONs
      </button>
    );
  }

  return (
    <aside
      className="gis-no-print animate-in fade-in slide-in-from-right-4 absolute right-4 top-16 z-[430] hidden max-h-[calc(100%-170px)] w-[372px] flex-col overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-900/95 text-white shadow-2xl backdrop-blur-md md:flex"
      aria-label="Network by PON"
      data-testid="pon-panel"
    >
      <div className="flex items-start gap-2 border-b border-white/10 bg-gradient-to-r from-sky-900/60 to-indigo-900/40 px-3 py-2.5">
        <Activity size={18} className="mt-0.5 text-sky-400" />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-extrabold">Network by PON</div>
          {olts.map(({ olt, pons }) => (
            <div key={olt?.id ?? pons[0].oltId} className="truncate text-[10.5px] text-slate-300">
              {olt?.name ?? pons[0].oltName} · {pons.length} PON ports
            </div>
          ))}
        </div>
        <button type="button" aria-label="Hide PON panel" onClick={() => setPanelOpen(false)} className="rounded-md p-1 text-slate-400 hover:bg-white/10 hover:text-white">
          <X size={15} />
        </button>
      </div>

      <div className="space-y-2 overflow-y-auto p-2.5">
        <div className="flex gap-1.5">
          <Stat label="Active customers" value={totals.active} tone="#4ade80" />
          <Stat label="Inactive" value={totals.inactive} tone={totals.inactive ? '#fbbf24' : undefined} />
          <Stat label="New connections" value={totals.free} tone="#38bdf8" />
          <Stat label="Suspected affected" value={affected.size} tone={affected.size ? '#f87171' : undefined} />
        </div>

        <div className="flex flex-wrap gap-1">
          <Toggle on={lightFlow} onClick={() => setLightFlow(!lightFlow)} icon={Sparkles} label="Light flow" />
          <Toggle on={identifiers} onClick={() => setIdentifiers(!identifiers)} icon={Tags} label="Identifiers" />
          <Toggle on={colorBy === 'pon'} onClick={() => setColorBy(colorBy === 'pon' ? 'type' : 'pon')} icon={Zap} label={colorBy === 'pon' ? 'Colour: PON' : 'Colour: cable type'} />
          {focus && (
            <button type="button" onClick={() => setFocus(null)} className="ml-auto flex h-7 items-center gap-1 rounded-md bg-white/10 px-2 text-[11px] font-semibold text-slate-200 hover:bg-white/20">
              <X size={12} /> Show all
            </button>
          )}
        </div>

        {focused && <PonDetail pon={focused} />}

        <div className="space-y-1.5">
          {overview.pons
            .filter((p) => p.customers.total > 0 || p.splitterIds.length > 0)
            .map((p) => (
              <PonRow key={p.key} pon={p} focused={p.key === focus} affected={affectedByPon.get(p.key) ?? 0} />
            ))}
        </div>
        {overview.pons.some((p) => p.customers.total === 0 && p.splitterIds.length === 0) && (
          <div className="rounded-lg bg-white/[0.03] px-2 py-1.5 text-[10.5px] text-slate-400">
            Not in use (no splitter or customer traced):{' '}
            {overview.pons
              .filter((p) => p.customers.total === 0 && p.splitterIds.length === 0)
              .map((p) => `${olts.length > 1 ? `${p.oltName} ` : ''}${p.ponPortId}`)
              .join(', ')}
          </div>
        )}

        {overview.notTraced.length > 0 && (
          <div className="rounded-lg bg-amber-500/10 px-2 py-1.5 text-[10.5px] text-amber-200">
            {overview.notTraced.length} customers are not on any PON yet: their fibers are not recorded from the box to the OLT.
          </div>
        )}
        <div className="flex items-start gap-1 px-1 text-[10px] leading-snug text-slate-500">
          <Info size={10} className="mt-0.5 shrink-0" />
          Light levels are estimated from the recorded OLT launch power and the Optical settings, not measured. {byBox.size} boxes hold splitters.
        </div>
      </div>
    </aside>
  );
}
