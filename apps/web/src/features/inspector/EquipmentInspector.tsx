import { useState } from 'react';
import {
  BookOpen,
  Cable as CableGlyph,
  Camera,
  FileText,
  Gauge,
  GitMerge,
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
import { useShallow } from 'zustand/react/shallow';

import {
  type EffectiveSpec,
  effectiveSpecs,
  type Equipment,
  isOdfType,
  isPoleType,
  LOCATION_METHOD_LABELS,
  type RfLevel,
  RX_BAND_LABELS,
  rxBandFor,
} from '@fibergis/shared';

import { useOpenView } from '../../app/views';
import { Badge, Button, KeyValueList } from '../../components/ui';
import { useMapStore } from '../../stores/mapStore';
import { deleteEquipment } from '../../stores/networkActions';
import { selectOpticalSettings, useNetworkStore } from '../../stores/networkStore';
import { useUiStore } from '../../stores/uiStore';
import { ConnectionsPanel } from '../connections/ConnectionsPanel';
import { hostsClosure, hostsSplitters } from '../fiber/fiberUi';
import { ClosureLinkSection, OdfSection, PonPortSection, SplitterSection } from '../fiber/PlantSections';
import { BoxInspections, FieldReviewBanner } from '../field-review/ReviewOnItem';
import { SplitterDesignSection } from '../map/pon/SplitterDesignSection';
import { OltChassisSection } from '../olt-rack/OltChassisSection';
import { SiteRackSection } from '../olt-rack/SiteRackSection';
import { BuildingSection } from '../premises/BuildingSection';
import { navigateToSite, startCableFrom } from './actions';
import { AssetDetailsSection, AssetSpecsSection } from './AssetSections';
import { SLACK_LOOP_SPEC_ROWS, type SpecRowDef, SPLICE_JOINT_SPEC_ROWS, useItemTabCounts } from './assetTabData';
import { CustomersOnItemSection, DocumentsOnItemSection, HistorySection, MaintenanceSection, PlacementToolRows } from './AssetTabs';
import { formatDate, formatUptime, joinPresent, NOT_RECORDED, orNotRecorded, presentItems } from './format';
import { OltSections } from './OltSection';
import {
  CablesOnPoleSection,
  DuctsAtSection,
  ImportInfoSection,
  PermissionsSection,
  PoleDetailsSection,
  SpansSection,
} from './osp/StructureSections';
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

/** Chambers and entries where ducts start and end. */
const DUCT_ENDS = new Set(['Manhole', 'Handhole', 'Underground Chamber', 'Building Entry Point', 'Junction Point']);

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
          {/* The equipment record says nothing about where these values came from. */}
          {hasReading && <Badge tone="neutral">Origin not recorded</Badge>}
        </div>
      </div>
    </InspectorSection>
  );
}

const RF_UNIT_LABELS: Record<RfLevel['unit'], string> = { dBuV: 'dBµV', dBmV: 'dBmV', dBm: 'dBm' };
const RF_ORIGIN_LABELS: Record<RfLevel['origin'], string> = {
  designed: 'Designed',
  calculated: 'Estimated',
  field_measured: 'Measured on site',
  device_reported: 'Reported by the device',
};

/**
 * A node's levels come only from the Cable TV records (levels on items sited at this pin), each with
 * its unit and origin. No example or typical value is shown as if it were this node's.
 */
function NodeOpticalPowerSection({ equipment }: { equipment: Equipment }) {
  const openView = useOpenView();
  const levels = useNetworkStore(
    useShallow((s) => {
      const here = new Set(s.rfElements.filter((el) => el.siteEquipmentId === equipment.id).map((el) => el.id));
      return s.rfLevels.filter((l) => here.has(l.elementId));
    }),
  );
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

        {equipment.rfLevelDbf !== undefined && (
          <div className="text-xs">
            <span className="text-slate-500">Old RF output field: </span>
            <span className="font-semibold text-slate-800">{equipment.rfLevelDbf}</span>
            <span className="text-slate-500"> (unit and origin not recorded)</span>
          </div>
        )}

        <div className="text-xs">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Levels on record here</div>
          {levels.length === 0 ? (
            <div className="font-semibold text-slate-800">Not recorded</div>
          ) : (
            <ul className="space-y-1">
              {levels.map((l) => (
                <li key={l.id} className="rounded-lg border border-slate-100 bg-slate-50 px-2 py-1">
                  <span className="font-mono font-semibold text-slate-800">
                    {l.value} {RF_UNIT_LABELS[l.unit]}
                  </span>
                  <span className="text-slate-600">
                    {' · '}
                    {joinPresent([
                      RF_ORIGIN_LABELS[l.origin],
                      l.frequencyMhz !== undefined ? `${l.frequencyMhz} MHz` : undefined,
                      l.testPointOffsetDb !== undefined ? `test point −${l.testPointOffsetDb} dB` : undefined,
                      l.measuredAt ? formatDate(l.measuredAt) : undefined,
                    ], ' · ')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <Button size="sm" onClick={() => openView('cable_tv')}>
          Record and check levels on the Cable TV page
        </Button>
      </div>
    </InspectorSection>
  );
}

/**
 * Spec rows read from the item's catalogue model and its own changes (Phase 3), each matched by any
 * of the usual names for it. Absent: "Not recorded". Never a typical or example value.
 */
export function RecordedSpecRows({ specs, rows }: { specs: readonly EffectiveSpec[]; rows: readonly SpecRowDef[] }) {
  const find = (keys: string[]) => specs.find((s) => keys.includes(s.key.trim().toLowerCase()));
  return (
    <div className="space-y-1.5 text-xs" data-testid="recorded-spec-rows">
      {rows.map(({ label, keys }) => {
        const spec = find(keys);
        return (
          <div key={label} className="flex items-start justify-between gap-3 border-b border-slate-100 py-1 last:border-b-0">
            <span className="text-slate-500">{label}</span>
            <span className="text-right">
              <span className="block font-semibold text-slate-800">{spec?.value ? `${spec.value}${spec.unit ? ` ${spec.unit}` : ''}` : NOT_RECORDED}</span>
              {spec && (
                <span className="block text-[10px] text-slate-400">
                  {spec.origin === 'model' ? 'From the catalogue model' : spec.origin === 'changed' ? 'Changed for this item' : 'Recorded for this item'}
                </span>
              )}
            </span>
          </div>
        );
      })}
      <p className="pt-1 text-[11px] text-slate-500">From the item's catalogue model and its own specs. Add or change them on the Specs tab.</p>
    </div>
  );
}

/** The item's specs: its catalogue model's lines with its own changes. */
function useItemSpecs(equipment: Equipment): EffectiveSpec[] {
  const model = useNetworkStore((s) => (equipment.catalogModelId ? s.catalog.find((c) => c.id === equipment.catalogModelId) : undefined));
  return effectiveSpecs(model, equipment);
}

function SpliceJointSection({ equipment }: { equipment: Equipment }) {
  const optical = useNetworkStore(selectOpticalSettings);
  const specs = useItemSpecs(equipment);
  return (
    <InspectorSection title="Splice specs" icon={GitMerge} defaultOpen>
      <div className="mb-2 flex items-start justify-between gap-3 border-b border-slate-100 pb-1.5 text-xs">
        <span className="text-slate-500">Planning loss per fusion splice</span>
        <span className="text-right">
          <span className="block font-semibold text-slate-800">{optical.fusionSpliceDb} dB</span>
          <span className="block text-[10px] text-slate-400">Planning value from Optical settings, not a reading</span>
        </span>
      </div>
      <RecordedSpecRows specs={specs} rows={SPLICE_JOINT_SPEC_ROWS} />
    </InspectorSection>
  );
}

function SlackLoopSection({ equipment }: { equipment: Equipment }) {
  const specs = useItemSpecs(equipment);
  return (
    <InspectorSection title="Slack storage" icon={Repeat} defaultOpen>
      <RecordedSpecRows specs={specs} rows={SLACK_LOOP_SPEC_ROWS} />
    </InspectorSection>
  );
}

/** Phase 3: the inspector's tabs. Every section that existed before sits on one of them. */
const INSPECTOR_TABS = [
  { id: 'details', label: 'Details' },
  { id: 'specs', label: 'Specs' },
  { id: 'connectivity', label: 'Connectivity' },
  { id: 'customers', label: 'Customers' },
  { id: 'documents', label: 'Documents' },
  { id: 'maintenance', label: 'Maintenance' },
  { id: 'history', label: 'History' },
] as const;
type InspectorTab = (typeof INSPECTOR_TABS)[number]['id'];

/** The tab last chosen, so looking at pole after pole stays on the same tab. */
let lastTab: InspectorTab = 'details';

function InspectorTabBar({
  value,
  onChange,
  counts,
}: {
  value: InspectorTab;
  onChange: (tab: InspectorTab) => void;
  counts: Partial<Record<InspectorTab, number>>;
}) {
  return (
    <div role="tablist" aria-label="Item details" className="no-scrollbar sticky top-0 z-10 flex gap-1 overflow-x-auto border-b border-slate-200 bg-white px-2" data-testid="inspector-tabs">
      {INSPECTOR_TABS.map((t) => {
        const active = t.id === value;
        const count = counts[t.id];
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            data-testid={`inspector-tab-${t.id}`}
            onClick={() => onChange(t.id)}
            className={`-mb-px flex h-12 shrink-0 items-center gap-1 border-b-2 px-2.5 text-[13px] font-medium md:h-10 md:text-[12px] ${
              active ? 'border-blue-600 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {t.label}
            {count !== undefined && count > 0 && (
              <span className={`rounded px-1.5 text-[10px] font-semibold leading-4 tabular-nums ${active ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
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

  const [tab, setTab] = useState<InspectorTab>(lastTab);
  const chooseTab = (next: InspectorTab) => {
    lastTab = next;
    setTab(next);
  };
  const counts = useItemTabCounts(equipment);

  const isMoving = useMapStore((s) => s.movingEquipmentId === equipment.id);
  const catalogModel = useNetworkStore((s) => (equipment.catalogModelId ? s.catalog.find((c) => c.id === equipment.catalogModelId) : undefined));
  const setMovingEquipmentId = useMapStore((s) => s.setMovingEquipmentId);

  const details = presentItems([
    { label: 'Category', value: equipment.category },
    { label: 'Area', value: orNotRecorded(joinPresent([equipment.street, equipment.area], ', ')) },
    { label: 'Make / model', value: orNotRecorded(joinPresent([equipment.manufacturer, equipment.model])) },
    { label: 'Catalogue model', value: catalogModel ? catalogModel.name : equipment.catalogModelId ? `${equipment.catalogModelId} (not on this device)` : 'Not linked' },
    { label: 'Serial number', value: orNotRecorded(equipment.serialNumber), mono: true },
    { label: 'Tag', value: orNotRecorded(equipment.tagCode), mono: true },
    { label: 'Management IP', value: equipment.ipAddress, mono: true },
    {
      label: 'Rack position (as written)',
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
    { label: 'Installed', value: orNotRecorded(equipment.installedDate ? formatDate(equipment.installedDate) : undefined) },
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
      <InspectorTabBar value={tab} onChange={chooseTab} counts={counts} />

      {/* Phase 3: every earlier section is kept; each now sits on one tab. */}
      {tab === 'connectivity' && (
        <>
          {isOlt && <PonPortSection olt={equipment} />}
          {/* Phase 10: shelves, slots and cards. */}
          {isOlt && <OltChassisSection key={equipment.id} olt={equipment} />}
          {isOdfType(equipment.type) && <OdfSection odf={equipment} />}
          {/* Phase 9: site, rack and units, with the rack drawing. */}
          {(isOlt || isOdfType(equipment.type) || equipment.type === 'FDMS' || equipment.siteId || equipment.rackId || equipment.site || equipment.rackNumber) && (
            <SiteRackSection key={equipment.id} equipment={equipment} />
          )}
          {hostsClosure(equipment.type) && <ClosureLinkSection equipment={equipment} />}
          {hostsSplitters(equipment.type) && <SplitterDesignSection host={equipment} />}
          {hostsSplitters(equipment.type) && <SplitterSection host={equipment} />}
          {capacity && (
            <InspectorSection title="Capacity" icon={Gauge}>
              <PortUsage used={capacity.used} total={capacity.total} />
            </InspectorSection>
          )}
          {(equipment.type === 'ONT' || equipment.type === 'ONU' || equipment.type === 'Optical Instrument') && (
            <OntPowerLevelSection equipment={equipment} />
          )}
          {equipment.type === 'CATV Optical Node' && <NodeOpticalPowerSection equipment={equipment} />}
          {isPoleType(equipment.type) && (
            <>
              <CablesOnPoleSection equipment={equipment} />
              <SpansSection equipment={equipment} />
            </>
          )}
          {DUCT_ENDS.has(equipment.type) && <DuctsAtSection equipment={equipment} />}
          {/* Network mapping Phase 13: every recorded link of this item, with its check state. */}
          <ConnectionsPanel key={equipment.id} target={{ elementId: equipment.id }} />
          <p className="px-4 py-3 text-[12px] text-slate-500">
            Only links that are recorded are shown. Use Trace path to follow this item through the network.
          </p>
        </>
      )}

      {tab === 'customers' && (
        <>
          {equipment.type === 'Building Entry Point' && <BuildingSection equipment={equipment} />}
          <CustomersOnItemSection equipment={equipment} />
        </>
      )}

      {tab === 'documents' && (
        <>
          <DocumentsOnItemSection equipment={equipment} />
          {isPoleType(equipment.type) && <PermissionsSection equipment={equipment} />}
        </>
      )}

      {tab === 'maintenance' && (
        <>
          <MaintenanceSection equipment={equipment} />
          {/* Phase 19: boxes and closures are inspected too, with their own checklist. */}
          <BoxInspections equipment={equipment} />
        </>
      )}

      {tab === 'history' && <HistorySection equipment={equipment} />}

      {tab === 'specs' && (
        <>
          <AssetSpecsSection equipment={equipment} />
          {equipment.type === 'Ratio Coupler' && <RatioCouplerLossSection />}
          {equipment.type === 'Fiber Splice Joint' && <SpliceJointSection equipment={equipment} />}
          {equipment.type === 'Fiber Slack Loop' && <SlackLoopSection equipment={equipment} />}
        </>
      )}

      {tab === 'details' && (
        <>
          {/* Phase 19: a phone capture waiting for, or refused by, the office review. */}
          <FieldReviewBanner equipment={equipment} />
          {isOlt && <OltSections olt={equipment} detailed={detailed} />}
          {isPoleType(equipment.type) && <PoleDetailsSection equipment={equipment} />}
          {equipment.importInfo && <ImportInfoSection info={equipment.importInfo} />}

          <AssetDetailsSection equipment={equipment}>
            <KeyValueList items={details} />
          </AssetDetailsSection>

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
                  onClick={() =>
                    useUiStore.getState().openSplicing(useNetworkStore.getState().closures.find((c) => c.equipmentId === equipment.id)?.id ?? null)
                  }
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
                  label="Connect what feeds this"
                  hint="Draws a straight cable from what you choose"
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
              <PlacementToolRows equipment={equipment} />
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
        </>
      )}
    </InspectorLayout>
  );
}
