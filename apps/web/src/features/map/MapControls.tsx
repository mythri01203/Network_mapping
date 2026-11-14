import { useEffect, useRef, useState } from 'react';
import {
  Check,
  Globe,
  Layers,
  Loader2,
  LocateFixed,
  type LucideIcon,
  Map as MapIcon,
  Maximize,
  Minimize,
  Minus,
  Plus,
  Printer,
  Satellite,
  Scan,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { cn } from '../../components/ui';
import { useMapStore } from '../../stores/mapStore';
import type { OltFilter } from './layerFilters';

type Basemap = 'google_streets' | 'google_satellite' | 'osm';

const BASEMAPS: { id: Basemap; label: string; icon: LucideIcon; preview: string }[] = [
  {
    id: 'google_streets',
    label: 'Streets',
    icon: MapIcon,
    preview: 'bg-[linear-gradient(135deg,#e8eef3_0%,#f6f4ee_45%,#dfe9d8_100%)]',
  },
  {
    id: 'google_satellite',
    label: 'Satellite',
    icon: Satellite,
    preview: 'bg-[linear-gradient(135deg,#2f3d2b_0%,#4b5a3a_40%,#6b6f55_70%,#3a4a3c_100%)]',
  },
  {
    id: 'osm',
    label: 'OpenStreetMap',
    icon: Globe,
    preview: 'bg-[linear-gradient(135deg,#f2efe9_0%,#e6e0d4_50%,#cfe3c6_100%)]',
  },
];

const panel =
  'rounded-xl border border-slate-200/90 bg-white/95 shadow-[0_0_0_1px_rgb(15_23_42/0.03),0_1px_2px_rgb(15_23_42/0.08),0_8px_20px_-6px_rgb(15_23_42/0.28)] backdrop-blur';

function ControlButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  spinning,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  spinning?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="flex h-[48px] w-[48px] items-center justify-center text-slate-600 transition-colors hover:bg-blue-50 hover:text-blue-700 active:bg-blue-100 disabled:opacity-50 md:h-9 md:w-9"
    >
      {spinning ? (
        <Loader2 className="h-[18px] w-[18px] animate-spin" />
      ) : (
        <Icon className="h-[18px] w-[18px]" strokeWidth={1.9} />
      )}
    </button>
  );
}

function BasemapSwitcher() {
  const { mapTileProvider, setMapTileProvider } = useMapStore(
    useShallow((s) => ({ mapTileProvider: s.tileProvider, setMapTileProvider: s.setTileProvider })),
  );
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const current = BASEMAPS.find((b) => b.id === mapTileProvider) ?? BASEMAPS[0];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Change basemap"
        className={cn(
          panel,
          'group flex h-[60px] w-[60px] flex-col overflow-hidden p-1 transition-shadow hover:shadow-lg',
          open && 'ring-2 ring-blue-500',
        )}
      >
        <span className={cn('flex flex-1 items-center justify-center rounded-[5px]', current.preview)}>
          <current.icon
            className={cn('h-4 w-4', current.id === 'google_satellite' ? 'text-white/90' : 'text-slate-600')}
          />
        </span>
        <span className="pt-0.5 text-center text-[10px] font-medium leading-tight text-slate-700">
          {current.id === 'osm' ? 'OSM' : current.label}
        </span>
      </button>

      {open && (
        <div className={cn(panel, 'animate-pop-in absolute bottom-0 right-full mr-2 flex gap-1.5 p-1.5')}>
          {BASEMAPS.map((b) => {
            const active = b.id === mapTileProvider;
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => {
                  setMapTileProvider(b.id);
                  setOpen(false);
                }}
                className={cn(
                  'flex w-[76px] flex-col gap-1 rounded-md p-1 text-left transition-colors',
                  active ? 'bg-blue-50' : 'hover:bg-slate-50',
                )}
              >
                <span
                  className={cn(
                    'relative flex h-12 items-center justify-center rounded-[5px] ring-1',
                    b.preview,
                    active ? 'ring-2 ring-blue-500' : 'ring-slate-200',
                  )}
                >
                  <b.icon className={cn('h-4 w-4', b.id === 'google_satellite' ? 'text-white/90' : 'text-slate-600')} />
                  {active && (
                    <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-blue-600 text-white">
                      <Check className="h-3 w-3" strokeWidth={3} />
                    </span>
                  )}
                </span>
                <span
                  className={cn('truncate px-0.5 text-[11px] font-medium', active ? 'text-blue-700' : 'text-slate-700')}
                >
                  {b.label}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export interface MapControlsProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onLocate: () => void;
  isLocating: boolean;
  /** Fits everything placed on the network on screen. */
  onFitNetwork: () => void;
  onPrint: () => void;
}

/** Whole-app full screen: modals and forms live outside the map, so only the whole page may go full screen. */
function useFullscreen() {
  const [on, setOn] = useState(() => typeof document !== 'undefined' && !!document.fullscreenElement);
  useEffect(() => {
    const onChange = () => setOn(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const supported = typeof document !== 'undefined' && !!document.documentElement.requestFullscreen;
  const toggle = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void document.documentElement.requestFullscreen().catch(() => {});
  };
  return { on, supported, toggle };
}

export function MapControls({ onZoomIn, onZoomOut, onLocate, isLocating, onFitNetwork, onPrint }: MapControlsProps) {
  const setIsLayersDrawerOpen = useMapStore((s) => s.setLayersDrawerOpen);
  const fullscreen = useFullscreen();
  return (
    <div data-guide="map-controls" className="gis-no-print absolute bottom-[72px] right-2 z-[400] flex flex-col items-end gap-2 md:bottom-5 md:right-4">
      <div className={cn(panel, 'flex flex-col overflow-hidden')}>
        <ControlButton icon={Layers} label="Map layers" onClick={() => setIsLayersDrawerOpen(true)} />
      </div>
      <div className={cn(panel, 'flex flex-col divide-y divide-slate-100 overflow-hidden')}>
        <ControlButton
          icon={LocateFixed}
          label="My location"
          onClick={onLocate}
          disabled={isLocating}
          spinning={isLocating}
        />
        <ControlButton icon={Scan} label="Show whole network" onClick={onFitNetwork} />
        {fullscreen.supported && (
          <span className="hidden md:block">
            <ControlButton icon={fullscreen.on ? Minimize : Maximize} label={fullscreen.on ? 'Leave full screen' : 'Full screen'} onClick={fullscreen.toggle} />
          </span>
        )}
        <span className="hidden md:block">
          <ControlButton icon={Printer} label="Print map" onClick={onPrint} />
        </span>
      </div>
      <div className={cn(panel, 'flex flex-col divide-y divide-slate-100 overflow-hidden')}>
        <ControlButton icon={Plus} label="Zoom in" onClick={onZoomIn} />
        <ControlButton icon={Minus} label="Zoom out" onClick={onZoomOut} />
      </div>
      <BasemapSwitcher />
    </div>
  );
}

export function OltFilterControl({
  value,
  onChange,
  counts,
}: {
  value: OltFilter;
  onChange: (v: OltFilter) => void;
  counts: Record<OltFilter, number>;
}) {
  if (counts.All === 0) return null;
  const options: { id: OltFilter; label: string; dot?: string }[] = [
    { id: 'All', label: 'All' },
    { id: 'GPON', label: 'GPON', dot: 'bg-blue-500' },
    { id: 'EPON', label: 'EPON', dot: 'bg-violet-500' },
  ];
  return (
    <div className="absolute bottom-5 left-4 z-[400] hidden sm:block">
      <div className={cn(panel, 'flex items-center gap-1 p-1')}>
        <span className="px-2 text-[11px] font-medium text-slate-500">OLTs</span>
        <div className="flex rounded-md bg-slate-100 p-0.5">
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => onChange(o.id)}
              className={cn(
                'flex h-7 items-center gap-1.5 rounded-[5px] px-2.5 text-[12px] font-medium transition-all',
                value === o.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800',
              )}
            >
              {o.dot && <span className={cn('h-1.5 w-1.5 rounded-full', o.dot)} />}
              {o.label}
              <span className="tabular-nums text-slate-400">{counts[o.id]}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
