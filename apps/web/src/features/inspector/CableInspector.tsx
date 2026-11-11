import {
  ArrowDown,
  Check,
  FileText,
  Gauge,
  GitMerge,
  Info,
  Palette,
  Route,
  Table2,
  Trash2,
  Waypoints,
} from 'lucide-react';

import { type Cable, fiberLossDb, STANDARD_12_COLORS } from '@fibergis/shared';

import { Button, KeyValueList } from '../../components/ui';
import { deleteCable, traceNetworkPath, updateCable } from '../../stores/networkActions';
import { selectOpticalSettings, useNetworkStore } from '../../stores/networkStore';
import { useUiStore } from '../../stores/uiStore';
import { CableBuildSection } from '../cables/CableBuildSection';
import { CableRouteToolsSection } from '../cables/CableRouteTools';
import { CableSegmentsSection } from '../cables/CableSegmentsSection';
import { CoreSection } from '../fiber/CoreSection';
import { CablePonSection } from '../map/pon/PonSections';
import { formatDate, formatLength, joinPresent, orNotRecorded, presentItems } from './format';
import { CableDuctsSection, LengthsSection, PolesSupportingSection, SlackLoopsSection } from './osp/CableSections';
import { ImportInfoSection } from './osp/StructureSections';
import { ActionList, ActionRow, InspectorLayout, InspectorSection, RecordLink } from './sections';

function Endpoint({ label, equipmentId }: { label: string; equipmentId?: string }) {
  const equipment = useNetworkStore((s) => (equipmentId ? s.equipment.find((e) => e.id === equipmentId) : undefined));
  const select = useUiStore((s) => s.select);
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="w-10 shrink-0 text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</span>
      <span className="min-w-0 flex-1 truncate text-[13px] text-slate-900">
        {equipment ? (
          <RecordLink
            name={equipment.name}
            id={equipment.id}
            onSelect={() => select({ type: 'equipment', data: equipment })}
          />
        ) : (
          <span className="text-slate-400">{equipmentId ? `${equipmentId} (missing)` : 'Not connected'}</span>
        )}
      </span>
      {equipment && <span className="shrink-0 text-[11px] text-slate-500">{equipment.type}</span>}
    </div>
  );
}

function FiberLossSection({ lengthMeters }: { lengthMeters: number }) {
  const optical = useNetworkStore(selectOpticalSettings);
  const loss1310 = fiberLossDb(lengthMeters, 1310, optical);
  const loss1490 = fiberLossDb(lengthMeters, 1490, optical);

  return (
    <InspectorSection title="Estimated fiber loss" icon={Gauge} defaultOpen>
      <div className="space-y-2 text-xs">
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-slate-100 bg-slate-50 p-2">
            <span className="block text-[10px] uppercase text-slate-400">Loss @ 1310 nm</span>
            <span className="text-base font-bold text-slate-900">{loss1310} dB</span>
            <span className="mt-0.5 block text-[10px] text-slate-400">{optical.fiberDbPerKm[1310]} dB/km setting</span>
          </div>
          <div className="rounded-lg border border-slate-100 bg-slate-50 p-2">
            <span className="block text-[10px] uppercase text-slate-400">Loss @ 1490 nm</span>
            <span className="text-base font-bold text-slate-900">{loss1490} dB</span>
            <span className="mt-0.5 block text-[10px] text-slate-400">{optical.fiberDbPerKm[1490]} dB/km setting</span>
          </div>
        </div>
        <p className="border-t border-slate-100 pt-1 text-[11px] text-slate-500">
          Estimated from the length and the optical settings. Connectors and splices are not included.
        </p>
      </div>
    </InspectorSection>
  );
}

function CableAppearanceSection({ cable }: { cable: Cable }) {
  const currentColor = cable.colorHex || '#0284c7';
  const currentThickness = cable.thickness ?? 4;

  const setColor = (hex: string) => {
    updateCable({ ...cable, colorHex: hex });
  };

  const setThickness = (val: number) => {
    updateCable({ ...cable, thickness: val });
  };

  return (
    <InspectorSection title="Line on the map" icon={Palette} defaultOpen={false}>
      <div className="space-y-3 text-xs">
        <div>
          <span className="block text-[11px] font-semibold text-slate-700 mb-1.5">
            Line colour on the map (not a fiber colour)
          </span>
          <div className="grid grid-cols-6 gap-1.5">
            {STANDARD_12_COLORS.map((col) => {
              const isSelected = currentColor.toLowerCase() === col.hex.toLowerCase();
              return (
                <button
                  key={col.hex}
                  type="button"
                  onClick={() => setColor(col.hex)}
                  className={`group relative h-7 rounded-lg border flex items-center justify-center transition-all ${
                    isSelected
                      ? 'border-slate-900 ring-2 ring-blue-500 scale-105 shadow-sm'
                      : 'border-slate-200 hover:scale-105'
                  }`}
                  style={{ backgroundColor: col.hex }}
                  title={`${col.number}. ${col.name} (${col.hex})`}
                >
                  {isSelected && <Check className="w-3.5 h-3.5" style={{ color: col.textColor }} />}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] font-semibold text-slate-700">Cable Thickness</span>
            <span className="font-mono text-slate-500 font-bold">{currentThickness}px</span>
          </div>
          <div className="flex gap-1.5">
            {[2, 3, 4, 5, 6, 8].map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setThickness(w)}
                className={`flex-1 py-1 rounded-md text-[11px] font-medium border transition-colors ${
                  currentThickness === w
                    ? 'bg-blue-600 border-blue-600 text-white font-bold'
                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                {w}px
              </button>
            ))}
          </div>
        </div>
      </div>
    </InspectorSection>
  );
}

export function CableInspector({ cable, detailed }: { cable: Cable; detailed: boolean }) {
  const setPanelOpen = useUiStore((s) => s.setPanelOpen);
  const setModalOpen = useUiStore((s) => s.setModalOpen);
  const openCoreTable = () => setPanelOpen('bottom', true);

  const details = presentItems([
    { label: 'Category', value: cable.cableCategory },
    { label: 'Fiber count', value: cable.fiberCount > 0 ? `${cable.fiberCount} F` : 'Not recorded' },
    { label: 'Length saved with the line', value: formatLength(cable.lengthMeters) },
    { label: 'Installation', value: orNotRecorded(cable.installationType) },
    { label: 'Route status', value: cable.routeStatus },
    { label: 'Owner', value: orNotRecorded(cable.owner) },
    { label: 'Make / model', value: joinPresent([cable.manufacturer, cable.model]) },
    { label: 'Installed', value: formatDate(cable.installationDate) },
  ]);

  return (
    <InspectorLayout
      actions={
        <>
          <Button variant="primary" size="sm" icon={Route} onClick={() => traceNetworkPath(cable.id)}>
            Trace path
          </Button>
          <Button size="sm" icon={Table2} onClick={openCoreTable}>
            Core table
          </Button>
          <Button
            variant="danger"
            size="sm"
            icon={Trash2}
            className="ml-auto"
            onClick={() => void deleteCable(cable.id)}
          >
            Delete
          </Button>
        </>
      }
    >
      <CablePonSection cable={cable} />
      <InspectorSection title="Route" icon={Waypoints}>
        <div className="space-y-1">
          <Endpoint label="From" equipmentId={cable.startEquipmentId} />
          <div className="flex w-9 justify-center text-slate-300">
            <ArrowDown size={12} />
          </div>
          <Endpoint label="To" equipmentId={cable.endEquipmentId} />
        </div>
      </InspectorSection>

      <CableRouteToolsSection cable={cable} />
      <CableBuildSection cable={cable} />

      <PolesSupportingSection cable={cable} />
      <LengthsSection cable={cable} />
      <SlackLoopsSection cable={cable} />
      <CableDuctsSection cable={cable} />
      {/* Network mapping Phase 6: stretches (aerial here, in a duct there). */}
      <CableSegmentsSection cable={cable} />

      <CableAppearanceSection cable={cable} />

      <CoreSection cable={cable} />

      {cable.cableCategory !== 'Coaxial' && <FiberLossSection lengthMeters={cable.lengthMeters} />}

      <InspectorSection title="Details" icon={Info} defaultOpen={detailed}>
        <KeyValueList items={details} />
      </InspectorSection>

      <InspectorSection title="Tools" icon={GitMerge}>
        <ActionList>
          <ActionRow
            icon={Table2}
            label="Core allocation table"
            hint="Per-core status, splices and customers"
            onClick={openCoreTable}
          />
          <ActionRow
            icon={GitMerge}
            label="Splice records"
            hint="Joints along this route"
            onClick={() => setModalOpen('splicing', true)}
          />
          <ActionRow
            icon={Trash2}
            label="Delete Wire / Cable"
            hint="Remove this physical fiber line from the GIS map"
            onClick={() => {
              void deleteCable(cable.id);
              useUiStore.getState().select(null);
              useUiStore.getState().setPanelOpen('right', false);
            }}
          />
        </ActionList>
      </InspectorSection>

      {cable.importInfo && <ImportInfoSection info={cable.importInfo} />}

      {cable.remarks && (
        <InspectorSection title="Remarks" icon={FileText}>
          <p className="whitespace-pre-line text-[13px] leading-relaxed text-slate-700">{cable.remarks}</p>
        </InspectorSection>
      )}
    </InspectorLayout>
  );
}
