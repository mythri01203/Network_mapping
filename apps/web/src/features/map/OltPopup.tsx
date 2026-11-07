import { Box, Cable, ChevronRight, type LucideIcon, Server, SlidersHorizontal, UtilityPole } from 'lucide-react';
import type L from 'leaflet';

import type { Equipment, EquipmentType } from '@fibergis/shared';

import { cn } from '../../components/ui';
import { useMapStore } from '../../stores/mapStore';
import { showToast } from '../../stores/toastStore';
import { useUiStore } from '../../stores/uiStore';
import { MapPopup } from './leaflet/MapPopup';
import { equipmentColor, equipmentMarkerSize } from './markerIcons';

/** Active / total PON ports, from the port inventory when present, else the summary counters. */
export function ponUsage(olt: Pick<Equipment, 'ponPorts' | 'usedPorts' | 'totalPorts'>): {
  used: number;
  total: number;
} {
  if (olt.ponPorts?.length) {
    return { used: olt.ponPorts.filter((port) => port.status === 'Active').length, total: olt.ponPorts.length };
  }
  return { used: olt.usedPorts ?? 0, total: olt.totalPorts ?? 0 };
}

function ActionRow({
  icon: Icon,
  title,
  description,
  onClick,
  primary = false,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group flex min-h-[48px] w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors md:min-h-0',
        primary ? 'bg-blue-600 text-white hover:bg-blue-700' : 'text-slate-700 hover:bg-slate-100',
      )}
    >
      <span
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
          primary ? 'bg-white/15' : 'bg-slate-100 text-slate-500 group-hover:bg-white group-hover:text-slate-700',
        )}
      >
        <Icon size={15} strokeWidth={2} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] font-medium leading-tight">{title}</span>
        <span className={cn('block truncate text-[11px] leading-tight', primary ? 'text-blue-100' : 'text-slate-500')}>
          {description}
        </span>
      </span>
      <ChevronRight
        size={14}
        className={cn('shrink-0', primary ? 'text-blue-200' : 'text-slate-300 group-hover:text-slate-500')}
      />
    </button>
  );
}

export interface OltPopupProps {
  map: L.Map;
  olt: Equipment;
  onClose: () => void;
}

/** Quick actions for an OLT, anchored to its marker. Detailed editing lives in the inspector. */
export function OltPopup({ map, olt, onClose }: OltPopupProps) {
  const technology = olt.technology ?? 'GPON';
  const { used, total } = ponUsage(olt);
  const percent = total > 0 ? Math.round((used / total) * 100) : 0;
  const hardware = [olt.manufacturer, olt.model].filter(Boolean).join(' ');

  const startFeeder = () => {
    const mapState = useMapStore.getState();
    mapState.setCableTypeToDraw('Main Feeder Fiber');
    mapState.setDrawingPoints([[olt.lat, olt.lng]]);
    mapState.setActiveTool('draw_cable');
    onClose();
    showToast('info', 'Drawing feeder cable', `Starting at ${olt.name}. Click along the route, then press Enter.`);
  };

  const place = (type: EquipmentType, label: string) => {
    const mapState = useMapStore.getState();
    mapState.setEquipmentTypeToAdd(type);
    mapState.setActiveTool('add_equipment');
    onClose();
    showToast('info', `Place ${label}`, 'Click on the map to place it.');
  };

  const managePorts = () => {
    const ui = useUiStore.getState();
    ui.select({ type: 'equipment', data: olt });
    ui.setPanelOpen('right', true);
    ui.setModalOpen('portManager', true);
    onClose();
  };

  return (
    <MapPopup map={map} latlng={[olt.lat, olt.lng]} onClose={onClose} offsetY={equipmentMarkerSize(olt) / 2}>
      <div className="w-[272px] text-slate-700">
        <div className="flex items-start gap-2.5 pr-6">
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-white"
            style={{ background: equipmentColor(olt) }}
          >
            <Server size={16} strokeWidth={2} />
          </span>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold leading-tight text-slate-900">{olt.name}</div>
            <div className="mt-0.5 truncate text-[11px] text-slate-500">
              {technology} OLT{hardware ? ` · ${hardware}` : ''}
            </div>
          </div>
        </div>

        {total > 0 && (
          <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2">
            <div className="flex items-baseline justify-between text-[11px]">
              <span className="font-medium text-slate-600">PON ports in use</span>
              <span className="tabular-nums text-slate-900">
                <span className="font-semibold">{used}</span>
                <span className="text-slate-400"> / {total}</span>
              </span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-200">
              <div
                className={cn(
                  'h-full rounded-full',
                  percent >= 90 ? 'bg-red-500' : percent >= 70 ? 'bg-amber-500' : 'bg-blue-600',
                )}
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
        )}

        <div className="mt-3 flex flex-col gap-0.5">
          <ActionRow
            primary
            icon={Cable}
            title="Draw feeder cable"
            description="Start a new route from this OLT"
            onClick={startFeeder}
          />
          <ActionRow
            icon={UtilityPole}
            title="Place pole"
            description="Add a telecom pole on the route"
            onClick={() => place('Telecom Pole', 'pole')}
          />
          <ActionRow
            icon={Box}
            title="Place FAT"
            description="Add a fiber access terminal"
            onClick={() => place('FAT', 'FAT')}
          />
          <ActionRow
            icon={SlidersHorizontal}
            title="Manage PON ports"
            description="Assign feeders and splitters"
            onClick={managePorts}
          />
        </div>
      </div>
    </MapPopup>
  );
}
