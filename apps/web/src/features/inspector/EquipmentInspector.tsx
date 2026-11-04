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
  Route,
  Split,
  Trash2,
  Wrench,
} from 'lucide-react';

import type { Equipment } from '@fibergis/shared';

import { Button, KeyValueList } from '../../components/ui';
import { deleteEquipment, traceNetworkPath } from '../../stores/networkActions';
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

export function EquipmentInspector({ equipment, detailed }: { equipment: Equipment; detailed: boolean }) {
  const setModalOpen = useUiStore((s) => s.setModalOpen);
  const openKnowledge = useUiStore((s) => s.openKnowledge);

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
          <Button variant="primary" size="sm" icon={Route} onClick={() => traceNetworkPath(equipment.id)}>
            Trace path
          </Button>
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
