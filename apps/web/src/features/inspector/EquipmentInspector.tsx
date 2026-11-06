import {
  BookOpen,
  Cable as CableGlyph,
  Camera,
  FileText,
  Gauge,
  GitMerge,
  Info,
  Navigation,
  PlugZap,
  Repeat,
  Route,
  Sliders,
  Split,
  Trash2,
  Wrench,
} from 'lucide-react';

import type { Equipment } from '@fibergis/shared';

import { Button, KeyValueList } from '../../components/ui';
import { deleteEquipment } from '../../stores/networkActions';
import { useUiStore } from '../../stores/uiStore';
import { navigateToSite, startCableFrom } from './actions';
import { formatDate, formatUptime, joinPresent, presentItems } from './format';
import { OltSections } from './OltSection';
import { ActionList, ActionRow, InspectorLayout, InspectorSection, PortUsage } from './sections';

const PORT_MANAGED_TYPES = new Set<Equipment['type']>(['OLT', 'ODF', 'FDMS', 'FDT', 'FAT']);

const isTerminalBox = (type: string) => type === 'FAT' || type.includes('Terminal Box');
const isSpliceClosure = (type: string) => type.includes('Joint Closure') || type.includes('Splice');

function portCapacity(eq: Equipment): { used?: number; total: number } | null {
  if (eq.totalPorts) {
    const used = eq.usedPorts ?? (eq.availablePorts !== undefined ? eq.totalPorts - eq.availablePorts : undefined);
    return { used, total: eq.totalPorts };
  }
  if (eq.logicalPorts?.length) {
    return { used: eq.logicalPorts.filter((port) => port.status === 'Used').length, total: eq.logicalPorts.length };
  }
  return null;
}

/** Seed data stores ids like `Rack-01`; only prefix bare values such as `01`. */
const withPrefix = (prefix: string, value?: string) =>
  value && (value.toLowerCase().startsWith(prefix.toLowerCase()) ? value : `${prefix} ${value}`);

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

function RatioCouplerLossSection() {
  const ratios = [
    { ratio: '90/10', throughput: '0.6 dB (90%)', tap: '10.5 dB (10%)' },
    { ratio: '80/20', throughput: '1.2 dB (80%)', tap: '7.4 dB (20%)' },
    { ratio: '70/30', throughput: '1.8 dB (70%)', tap: '5.6 dB (30%)' },
    { ratio: '50/50', throughput: '3.4 dB (50%)', tap: '3.4 dB (50%)' },
  ];

  return (
    <InspectorSection title="Coupler Loss Specs" icon={Split} defaultOpen>
      <div className="space-y-2 text-xs">
        <p className="text-[11px] text-slate-500">
          Unbalanced FBT splitters equalize power across bus FTTH street cascades:
        </p>
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50/50">
          <div className="grid grid-cols-3 bg-slate-100/90 px-2.5 py-1.5 text-[11px] font-semibold text-slate-600">
            <span>Ratio</span>
            <span>Bus Thru</span>
            <span>Drop Tap</span>
          </div>
          <div className="divide-y divide-slate-100">
            {ratios.map((r) => (
              <div key={r.ratio} className="grid grid-cols-3 items-center px-2.5 py-1.5 text-[11px]">
                <span className="font-semibold text-purple-700">{r.ratio}</span>
                <span className="text-slate-700">{r.throughput}</span>
                <span className="font-medium text-emerald-700">{r.tap}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </InspectorSection>
  );
}

function OntPowerLevelSection({ equipment }: { equipment: Equipment }) {
  const rxPower = equipment.opticalPower?.rxPowerDbm ?? -19.4;
  const txPower = equipment.opticalPower?.txPowerDbm ?? 2.4;
  const isNormal = rxPower >= -24 && rxPower <= -8;
  const isWarning = (rxPower < -24 && rxPower >= -27) || (rxPower > -8 && rxPower <= -6);

  const statusLabel = isNormal ? 'Normal Signal' : isWarning ? 'Warning Level' : 'Critical (Out of Spec)';
  const statusBadge = isNormal
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : isWarning
      ? 'border-amber-200 bg-amber-50 text-amber-700'
      : 'border-rose-200 bg-rose-50 text-rose-700';

  return (
    <InspectorSection title="ONT Power Level" icon={Gauge} defaultOpen>
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Rx Optical Power</div>
            <div className="text-lg font-bold tracking-tight text-slate-900">{rxPower.toFixed(1)} dBm</div>
          </div>
          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusBadge}`}>
            {statusLabel}
          </span>
        </div>

        <div className="space-y-1">
          <div className="flex h-2 w-full overflow-hidden rounded-full bg-slate-200">
            <div className="w-[60%] bg-emerald-500" title="-8 to -24 dBm (Normal)" />
            <div className="w-[15%] bg-amber-400" title="-24 to -27 dBm (Warning)" />
            <div className="w-[25%] bg-rose-500" title="< -27 dBm (Critical)" />
          </div>
          <div className="flex justify-between text-[10px] text-slate-400">
            <span>-8 dBm (High)</span>
            <span>-24 dBm (Target)</span>
            <span>-27 dBm (Min)</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-1 text-xs">
          <div>
            <span className="block text-[10px] text-slate-400">Upstream Tx (1310nm)</span>
            <span className="font-medium text-slate-700">+{txPower.toFixed(1)} dBm</span>
          </div>
          <div>
            <span className="block text-[10px] text-slate-400">Downstream Rx (1490nm)</span>
            <span className="font-medium text-slate-700">{rxPower.toFixed(1)} dBm</span>
          </div>
        </div>
      </div>
    </InspectorSection>
  );
}

function NodeOpticalPowerSection() {
  return (
    <InspectorSection title="Node Optical Power" icon={Gauge} defaultOpen>
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Optical Input Power</div>
            <div className="text-lg font-bold tracking-tight text-slate-900">-3.2 dBm</div>
          </div>
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
            AGC Locked
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg border border-slate-100 bg-slate-50 p-2">
            <div className="text-[10px] uppercase text-slate-400">Input Range</div>
            <div className="font-semibold text-slate-800">+2 to -8 dBm</div>
          </div>
          <div className="rounded-lg border border-slate-100 bg-slate-50 p-2">
            <div className="text-[10px] uppercase text-slate-400">RF Output Level</div>
            <div className="font-semibold text-slate-800">96 dBµV (AGC)</div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-slate-100 pt-1.5 text-[11px] text-slate-500">
          <span>Forward Band: 45 - 1000 MHz</span>
          <span className="font-medium text-emerald-600">CNR ≥ 51 dB</span>
        </div>
      </div>
    </InspectorSection>
  );
}

function SpliceJointSection() {
  return (
    <InspectorSection title="Fusion Splice Loss Specs" icon={GitMerge} defaultOpen>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg border border-slate-100 bg-slate-50 p-2">
          <div className="text-[10px] uppercase text-slate-400">Typical Loss</div>
          <div className="font-semibold text-emerald-700">≤ 0.02 dB</div>
        </div>
        <div className="rounded-lg border border-slate-100 bg-slate-50 p-2">
          <div className="text-[10px] uppercase text-slate-400">Return Loss</div>
          <div className="font-semibold text-slate-800">&gt; 60 dB</div>
        </div>
        <div className="col-span-2 rounded-lg border border-slate-100 bg-slate-50 p-2">
          <div className="text-[10px] uppercase text-slate-400">Protection Sleeve</div>
          <div className="font-medium text-slate-700">60mm heat-shrink with stainless strength member</div>
        </div>
      </div>
    </InspectorSection>
  );
}

function SlackLoopSection() {
  return (
    <InspectorSection title="Fiber Slack Storage (Snowshoe)" icon={Repeat} defaultOpen>
      <div className="space-y-1.5 text-xs">
        <div className="flex justify-between border-b border-slate-100 py-1">
          <span className="text-slate-500">Reserve Loop Length</span>
          <span className="font-semibold text-slate-800">20 meters (15m–30m)</span>
        </div>
        <div className="flex justify-between border-b border-slate-100 py-1">
          <span className="text-slate-500">Minimum Bend Radius</span>
          <span className="font-semibold text-slate-800">30 mm (G.652D)</span>
        </div>
        <div className="flex justify-between py-1">
          <span className="text-slate-500">Mounting Bracket</span>
          <span className="font-medium text-slate-700">Snowshoe aerial / chamber coil</span>
        </div>
      </div>
    </InspectorSection>
  );
}

export function EquipmentInspector({ equipment, detailed }: { equipment: Equipment; detailed: boolean }) {
  const setModalOpen = useUiStore((s) => s.setModalOpen);
  const openKnowledge = useUiStore((s) => s.openKnowledge);
  const openSpliceModal = useUiStore((s) => s.openSpliceModal);
  const openFiberTrace = useUiStore((s) => s.openFiberTrace);

  const isOlt = equipment.type === 'OLT';
  const capacity = isOlt && equipment.ponPorts?.length ? null : portCapacity(equipment);
  const hasPorts = Boolean(
    equipment.totalPorts || equipment.ponPorts?.length || PORT_MANAGED_TYPES.has(equipment.type),
  );

  const details = presentItems([
    { label: 'Category', value: equipment.category },
    { label: 'Make / model', value: joinPresent([equipment.manufacturer, equipment.model]) },
    { label: 'Serial number', value: equipment.serialNumber, mono: true },
    { label: 'Management IP', value: equipment.ipAddress, mono: true },
    {
      label: 'Rack position',
      value: joinPresent(
        [
          withPrefix('Rack', equipment.rackNumber),
          withPrefix('Shelf', equipment.shelfNumber),
          withPrefix('Slot', equipment.slotNumber),
        ],
        ' · ',
      ),
    },
    { label: 'Pole', value: equipment.poleNumber, mono: true },
    { label: 'Building', value: equipment.buildingName },
    {
      label: 'Splitters',
      value: equipment.splitterConfig
        ? `${equipment.splitterConfig.splitterCount} × ${equipment.splitterConfig.ratio}`
        : undefined,
    },
    { label: 'Uptime', value: equipment.uptimeHours !== undefined ? formatUptime(equipment.uptimeHours) : undefined },
    { label: 'Installed', value: formatDate(equipment.installedDate) },
    { label: 'Coordinates', value: `${equipment.lat.toFixed(5)}, ${equipment.lng.toFixed(5)}`, mono: true },
  ]);

  return (
    <InspectorLayout
      actions={
        <>
          {isOlt ? (
            <Button
              variant="primary"
              size="sm"
              icon={Sliders}
              onClick={() => useUiStore.getState().openOltConfigModal(equipment)}
            >
              Configure OLT
            </Button>
          ) : (
            <Button variant="primary" size="sm" icon={Route} onClick={() => openFiberTrace(equipment.id)}>
              Trace path
            </Button>
          )}
          {isOlt && (
            <Button size="sm" icon={Route} onClick={() => openFiberTrace(equipment.id)}>
              Trace
            </Button>
          )}
          <Button
            size="sm"
            icon={Navigation}
            onClick={() =>
              navigateToSite({
                id: equipment.id,
                name: equipment.name,
                lat: equipment.lat,
                lng: equipment.lng,
                type: equipment.type,
              })
            }
          >
            Navigate
          </Button>
          <Button
            variant="danger"
            size="sm"
            icon={Trash2}
            className="ml-auto"
            onClick={() => void deleteEquipment(equipment.id)}
          >
            Delete
          </Button>
        </>
      }
    >
      {isOlt && <OltSections olt={equipment} detailed={detailed} />}

      {capacity && (
        <InspectorSection title="Capacity" icon={Gauge}>
          <PortUsage used={capacity.used} total={capacity.total} />
        </InspectorSection>
      )}

      {equipment.type === 'Ratio Coupler' && <RatioCouplerLossSection />}
      {(equipment.type === 'ONT' || equipment.type === 'ONU' || equipment.type === 'Optical Instrument') && (
        <OntPowerLevelSection equipment={equipment} />
      )}
      {equipment.type === 'CATV Optical Node' && <NodeOpticalPowerSection />}
      {equipment.type === 'Fiber Splice Joint' && <SpliceJointSection />}
      {equipment.type === 'Fiber Slack Loop' && <SlackLoopSection />}

      <InspectorSection title="Details" icon={Info}>
        <KeyValueList items={details} />
      </InspectorSection>

      <InspectorSection title="Tools" icon={Wrench} defaultOpen={detailed || !isOlt}>
        <ActionList>
          {hasPorts && (
            <ActionRow
              icon={PlugZap}
              label="Port manager"
              hint="Assign, reserve and audit ports"
              onClick={() => setModalOpen('portManager', true)}
            />
          )}
          {isTerminalBox(equipment.type) && (
            <ActionRow
              icon={Camera}
              label="Photos and annotations"
              hint={equipment.images.length > 0 ? plural(equipment.images.length, 'photo') : 'No photos yet'}
              onClick={() => setModalOpen('terminalBox', true)}
            />
          )}
          {isSpliceClosure(equipment.type) && (
            <ActionRow
              icon={GitMerge}
              label="Splice records"
              hint="Fusion splices inside this closure"
              onClick={() => setModalOpen('splicing', true)}
            />
          )}
          {(equipment.type.includes('Splitter') ||
            equipment.type.includes('Coupler') ||
            isTerminalBox(equipment.type) ||
            isSpliceClosure(equipment.type) ||
            equipment.type === 'FDMS' ||
            equipment.type === 'FDT' ||
            equipment.type === 'FAT' ||
            equipment.type === 'Fiber Joint Closure') && (
            <ActionRow
              icon={GitMerge}
              label="Splice (Upstream)"
              hint="Connect inbound optical feed from upstream OLT/Splitter"
              onClick={() => openSpliceModal(equipment)}
            />
          )}
          {equipment.type.includes('Splitter') && (
            <ActionRow
              icon={Split}
              label="Splitter ports"
              hint="Output port assignments"
              onClick={() => setModalOpen('splitter', true)}
            />
          )}
          <ActionRow
            icon={CableGlyph}
            label="Start cable here"
            hint="Draw a new route from this location"
            onClick={() => startCableFrom(equipment)}
          />
          <ActionRow
            icon={BookOpen}
            label="Equipment guide"
            hint={`How a ${equipment.type} is used in the network`}
            onClick={() => openKnowledge(equipment.type)}
          />
        </ActionList>
      </InspectorSection>

      {equipment.notes && (
        <InspectorSection title="Notes" icon={FileText}>
          <p className="whitespace-pre-line text-[13px] leading-relaxed text-slate-700">{equipment.notes}</p>
        </InspectorSection>
      )}
    </InspectorLayout>
  );
}
