import {
  BookOpen,
  Cable as CableGlyph,
  Camera,
  FileText,
  Gauge,
  GitMerge,
  Info,
  Move,
  Navigation,
  PlugZap,
  Repeat,
  Route,
  Sliders,
  Split,
  Trash2,
  Wrench,
} from 'lucide-react';

import { type Equipment, LOCATION_METHOD_LABELS, RX_BAND_LABELS, rxBandFor } from '@fibergis/shared';

import { Badge, Button, KeyValueList } from '../../components/ui';
import { useMapStore } from '../../stores/mapStore';
import { deleteEquipment } from '../../stores/networkActions';
import { selectOpticalSettings, useNetworkStore } from '../../stores/networkStore';
import { useUiStore } from '../../stores/uiStore';
import { navigateToSite, startCableFrom } from './actions';
import { formatDate, formatUptime, joinPresent, orNotRecorded, presentItems } from './format';
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

/** Visible on every panel whose numbers describe a type of equipment rather than this one. */
function ExampleValuesLabel() {
  return (
    <p className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-900">
      Example values, not your network
    </p>
  );
}

function RatioCouplerLossSection() {
  const optical = useNetworkStore(selectOpticalSettings);
  const ratios = ['90/10', '80/20', '70/30', '50/50'].map((ratio) => ({
    ratio,
    throughput: `${optical.couplers[ratio].throughDb} dB`,
    tap: `${optical.couplers[ratio].tapDb} dB`,
  }));

  return (
    <InspectorSection title="Coupler Loss Specs" icon={Split} defaultOpen>
      <div className="space-y-2 text-xs">
        <p className="text-[11px] text-slate-500">
          Planning values from Optical settings. Check the datasheet of the installed part.
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
  const optical = useNetworkStore(selectOpticalSettings);
  const rxPower = equipment.opticalPower?.rxPowerDbm;
  const txPower = equipment.opticalPower?.txPowerDbm;
  const band = rxBandFor(rxPower, optical);
  const hasReading = equipment.opticalPower !== undefined && (rxPower !== undefined || txPower !== undefined);

  const statusLabel = RX_BAND_LABELS[band];
  const statusBadge =
    band === 'good'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : band === 'low_margin'
        ? 'border-amber-200 bg-amber-50 text-amber-700'
        : band === 'unknown'
          ? 'border-slate-200 bg-slate-50 text-slate-600'
          : 'border-rose-200 bg-rose-50 text-rose-700';
  const { overloadDbm, goodFloorDbm, sensitivityDbm } = optical.rx;

  return (
    <InspectorSection title="ONT Power Level" icon={Gauge} defaultOpen>
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Rx Optical Power</div>
            <div className="text-lg font-bold tracking-tight text-slate-900">
              {rxPower !== undefined ? `${rxPower.toFixed(1)} dBm` : 'Not recorded'}
            </div>
          </div>
          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusBadge}`}>
            {statusLabel}
          </span>
        </div>

        <div className="space-y-1">
          <div className="flex h-2 w-full overflow-hidden rounded-full bg-slate-200">
            <div className="w-[60%] bg-emerald-500" title={`${overloadDbm} to ${goodFloorDbm} dBm (Good)`} />
            <div className="w-[15%] bg-amber-400" title={`${goodFloorDbm} to ${sensitivityDbm} dBm (Little margin)`} />
            <div className="w-[25%] bg-rose-500" title={`Below ${sensitivityDbm} dBm (Too weak)`} />
          </div>
          <div className="flex justify-between text-[10px] text-slate-400">
            <span>{overloadDbm} dBm (High)</span>
            <span>{goodFloorDbm} dBm</span>
            <span>{sensitivityDbm} dBm (Min)</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-1 text-xs">
          <div>
            <span className="block text-[10px] text-slate-400">Upstream Tx (1310nm)</span>
            <span className="font-medium text-slate-700">
              {txPower !== undefined ? `${txPower > 0 ? '+' : ''}${txPower.toFixed(1)} dBm` : 'Not recorded'}
            </span>
          </div>
          <div>
            <span className="block text-[10px] text-slate-400">Downstream Rx (1490nm)</span>
            <span className="font-medium text-slate-700">{rxPower !== undefined ? `${rxPower.toFixed(1)} dBm` : 'Not recorded'}</span>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-1.5 text-[11px] text-slate-500">
          <span>No live connection</span>
          {hasReading && <Badge tone="neutral">Sample data</Badge>}
        </div>
      </div>
    </InspectorSection>
  );
}

function NodeOpticalPowerSection({ equipment }: { equipment: Equipment }) {
  return (
    <InspectorSection title="Node Optical Power" icon={Gauge} defaultOpen>
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Optical Input Power</div>
            <div className="text-lg font-bold tracking-tight text-slate-900">Not recorded</div>
          </div>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600">
            No live connection
          </span>
        </div>

        <div className="text-xs">
          <span className="text-slate-500">RF output on record: </span>
          <span className="font-semibold text-slate-800">
            {equipment.rfLevelDbf !== undefined ? `${equipment.rfLevelDbf} (sample data)` : 'Not recorded'}
          </span>
        </div>

        <ExampleValuesLabel />

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg border border-slate-100 bg-slate-50 p-2">
            <div className="text-[10px] uppercase text-slate-400">Input Range</div>
            <div className="font-semibold text-slate-800">+2 to -8 dBm</div>
          </div>
          <div className="rounded-lg border border-slate-100 bg-slate-50 p-2">
            <div className="text-[10px] uppercase text-slate-400">RF Output Level</div>
            <div className="font-semibold text-slate-800">96 dBµV</div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-slate-100 pt-1.5 text-[11px] text-slate-500">
          <span>Forward Band: 45 - 1000 MHz</span>
          <span className="font-medium text-slate-600">CNR ≥ 51 dB</span>
        </div>
      </div>
    </InspectorSection>
  );
}

function SpliceJointSection() {
  const optical = useNetworkStore(selectOpticalSettings);
  return (
    <InspectorSection title="Fusion Splice Loss Specs" icon={GitMerge} defaultOpen>
      <ExampleValuesLabel />
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg border border-slate-100 bg-slate-50 p-2">
          <div className="text-[10px] uppercase text-slate-400">Planned Loss</div>
          <div className="font-semibold text-slate-800">{optical.fusionSpliceDb} dB</div>
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
      <ExampleValuesLabel />
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

  const isMoving = useMapStore((s) => s.movingEquipmentId === equipment.id);
  const setMovingEquipmentId = useMapStore((s) => s.setMovingEquipmentId);

  const details = presentItems([
    { label: 'Category', value: equipment.category },
    { label: 'Area', value: orNotRecorded(joinPresent([equipment.street, equipment.area], ', ')) },
    { label: 'Make / model', value: orNotRecorded(joinPresent([equipment.manufacturer, equipment.model])) },
    { label: 'Serial number', value: orNotRecorded(equipment.serialNumber), mono: true },
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
    {
      label: 'Location from',
      value: equipment.locationMethod
        ? `${equipment.officeMustPlace ? 'No GPS fix: office must place this' : LOCATION_METHOD_LABELS[equipment.locationMethod]}${
            equipment.locationAccuracyMeters !== undefined ? `, within ${Math.round(equipment.locationAccuracyMeters)} m` : ''
          }`
        : undefined,
    },
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
      {equipment.type === 'CATV Optical Node' && <NodeOpticalPowerSection equipment={equipment} />}
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
            icon={Move}
            label="Move this item"
            hint={isMoving ? 'Drag the pin, or cancel in the bar on the map' : 'Its connected cable ends move with it'}
            onClick={() => {
              setMovingEquipmentId(equipment.id);
              // On a phone the inspector covers the map, so get it out of the way.
              if (window.innerWidth < 768) useUiStore.getState().setPanelOpen('right', false);
            }}
          />
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
