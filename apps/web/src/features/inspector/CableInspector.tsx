import { ArrowDown, FileText, GitMerge, Info, Layers, Route, Table2, Trash2, Waypoints } from 'lucide-react';

import type { Cable } from '@fibergis/shared';

import { Button, KeyValueList } from '../../components/ui';
import { deleteCable, traceNetworkPath } from '../../stores/networkActions';
import { useNetworkStore } from '../../stores/networkStore';
import { useUiStore } from '../../stores/uiStore';
import { formatDate, formatLength, joinPresent, presentItems } from './format';
import { ActionList, ActionRow, CoreBreakdown, InspectorLayout, InspectorSection, RecordLink } from './sections';

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

export function CableInspector({ cable, detailed }: { cable: Cable; detailed: boolean }) {
  const setPanelOpen = useUiStore((s) => s.setPanelOpen);
  const setModalOpen = useUiStore((s) => s.setModalOpen);
  const openCoreTable = () => setPanelOpen('bottom', true);

  const details = presentItems([
    { label: 'Category', value: cable.cableCategory },
    { label: 'Fiber count', value: `${cable.fiberCount} F` },
    { label: 'Length', value: formatLength(cable.lengthMeters) },
    { label: 'Installation', value: cable.installationType },
    { label: 'Route status', value: cable.routeStatus },
    { label: 'Owner', value: cable.owner },
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
          <Button variant="danger" size="sm" icon={Trash2} className="ml-auto" onClick={() => deleteCable(cable.id)}>
            Delete
          </Button>
        </>
      }
    >
      <InspectorSection title="Route" icon={Waypoints}>
        <div className="space-y-1">
          <Endpoint label="From" equipmentId={cable.startEquipmentId} />
          <div className="flex w-9 justify-center text-slate-300">
            <ArrowDown size={12} />
          </div>
          <Endpoint label="To" equipmentId={cable.endEquipmentId} />
        </div>
      </InspectorSection>

      <InspectorSection title="Fiber cores" icon={Layers} aside={`${cable.fiberCount} F`}>
        <CoreBreakdown cores={cable.cores} fiberCount={cable.fiberCount} />
      </InspectorSection>

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
        </ActionList>
      </InspectorSection>

      {cable.remarks && (
        <InspectorSection title="Remarks" icon={FileText}>
          <p className="whitespace-pre-line text-[13px] leading-relaxed text-slate-700">{cable.remarks}</p>
        </InspectorSection>
      )}
    </InspectorLayout>
  );
}
