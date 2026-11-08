import { ClipboardList, FileText, Info, Navigation, Network, Siren } from 'lucide-react';

import { type Fault, FAULT_STATUS_LABELS } from '@fibergis/shared';

import { Button, type KeyValueItem, KeyValueList } from '../../components/ui';
import { useNetworkStore } from '../../stores/networkStore';
import { useUiStore } from '../../stores/uiStore';
import { navigateToSite } from './actions';
import { formatDateTime, presentItems } from './format';
import { InspectorLayout, InspectorSection, Metric, RecordLink } from './sections';

const listOrUndefined = (values: readonly number[], prefix: string) =>
  values.length > 0 ? values.map((v) => `${prefix}${v}`).join(', ') : undefined;

export function FaultInspector({ fault }: { fault: Fault }) {
  const equipment = useNetworkStore((s) =>
    fault.affectedEquipmentId ? s.equipment.find((e) => e.id === fault.affectedEquipmentId) : undefined,
  );
  const cable = useNetworkStore((s) =>
    fault.affectedCableId ? s.cables.find((c) => c.id === fault.affectedCableId) : undefined,
  );
  const select = useUiStore((s) => s.select);
  const setModalOpen = useUiStore((s) => s.setModalOpen);

  const affected: KeyValueItem[] = presentItems([
    {
      label: 'Equipment',
      value: equipment ? (
        <RecordLink
          name={equipment.name}
          id={equipment.id}
          onSelect={() => select({ type: 'equipment', data: equipment })}
        />
      ) : (
        fault.affectedEquipmentId
      ),
    },
    {
      label: 'Cable',
      value: cable ? (
        <RecordLink name={cable.name} id={cable.id} onSelect={() => select({ type: 'cable', data: cable })} />
      ) : (
        fault.affectedCableId
      ),
    },
    { label: 'Fiber cores', value: listOrUndefined(fault.affectedCores, '#') },
    { label: 'Splitter ports', value: listOrUndefined(fault.affectedSplitterPorts, 'P') },
  ]);

  const timeline = presentItems([
    ...(fault.isTest ? [{ label: 'TEST', value: 'TEST event, not a real fault' }] : []),
    { label: 'Status', value: FAULT_STATUS_LABELS[fault.status] },
    { label: 'Source', value: fault.source ?? 'Not recorded' },
    { label: 'Type', value: fault.type },
    { label: 'Reported', value: formatDateTime(fault.reportedAt) },
    { label: 'Closed', value: formatDateTime(fault.closedAt ?? fault.resolvedAt) },
    { label: 'Technician', value: fault.assignedTechnician ?? 'Unassigned' },
    { label: 'Work order', value: fault.workOrderId, mono: true },
  ]);

  return (
    <InspectorLayout
      actions={
        <>
          <Button
            variant="primary"
            size="sm"
            icon={Navigation}
            onClick={() =>
              navigateToSite({ id: fault.id, name: fault.title, ...fault.affectedLocation, type: 'fault' })
            }
          >
            Navigate to site
          </Button>
          <Button size="sm" icon={ClipboardList} onClick={() => setModalOpen('faults', true)}>
            Fault desk
          </Button>
        </>
      }
    >
      <InspectorSection title="Impact" icon={Siren}>
        <div className="grid grid-cols-2 gap-2">
          <Metric label="Customers on recorded paths" value={fault.affectedCustomerIds.length} />
          <Metric label="Cores affected" value={fault.affectedCores.length} />
        </div>
      </InspectorSection>

      {affected.length > 0 && (
        <InspectorSection title="Affected network" icon={Network}>
          <KeyValueList items={affected} />
        </InspectorSection>
      )}

      <InspectorSection title="Ticket" icon={Info}>
        <KeyValueList items={timeline} />
      </InspectorSection>

      {fault.description && (
        <InspectorSection title="Description" icon={FileText}>
          <p className="whitespace-pre-line text-[13px] leading-relaxed text-slate-700">{fault.description}</p>
        </InspectorSection>
      )}
    </InspectorLayout>
  );
}
