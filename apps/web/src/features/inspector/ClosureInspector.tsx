import { FileText, GitMerge, Info, Navigation } from 'lucide-react';

import type { JointClosure } from '@fibergis/shared';

import { Button, KeyValueList } from '../../components/ui';
import { useNetworkStore } from '../../stores/networkStore';
import { useUiStore } from '../../stores/uiStore';
import { navigateToSite } from './actions';
import { formatDate, presentItems } from './format';
import { InspectorLayout, InspectorSection, Metric } from './sections';

export function ClosureInspector({ closure }: { closure: JointClosure }) {
  const setModalOpen = useUiStore((s) => s.setModalOpen);
  const cables = useNetworkStore((s) => s.cables);
  const cableName = (id?: string) => (id ? (cables.find((c) => c.id === id)?.name ?? id) : undefined);
  const failedSplices = closure.splices.filter(
    (splice) => splice.status === 'Failed' || splice.status === 'Damaged',
  ).length;

  const details = presentItems([
    { label: 'Closure type', value: closure.closureType },
    { label: 'Cable A', value: cableName(closure.cableAId) },
    { label: 'Cable B', value: cableName(closure.cableBId) },
    { label: 'Entry / exit ports', value: `${closure.entryPortsCount} / ${closure.exitPortsCount}` },
    { label: 'Technician', value: closure.technician },
    { label: 'Installed', value: formatDate(closure.installationDate) },
  ]);

  return (
    <InspectorLayout
      actions={
        <>
          <Button variant="primary" size="sm" icon={GitMerge} onClick={() => setModalOpen('splicing', true)}>
            Splice records
          </Button>
          <Button
            size="sm"
            icon={Navigation}
            onClick={() =>
              navigateToSite({
                id: closure.id,
                name: closure.name,
                lat: closure.lat,
                lng: closure.lng,
                type: 'closure',
              })
            }
          >
            Navigate
          </Button>
        </>
      }
    >
      <InspectorSection title="Splices" icon={GitMerge}>
        <div className="grid grid-cols-2 gap-2">
          <Metric label="Recorded splices" value={closure.splices.length} />
          <Metric
            label="Failed or damaged"
            value={failedSplices}
            className={failedSplices > 0 ? 'text-amber-700' : undefined}
          />
        </div>
      </InspectorSection>

      <InspectorSection title="Details" icon={Info}>
        <KeyValueList items={details} />
      </InspectorSection>

      {closure.remarks && (
        <InspectorSection title="Remarks" icon={FileText}>
          <p className="whitespace-pre-line text-[13px] leading-relaxed text-slate-700">{closure.remarks}</p>
        </InspectorSection>
      )}
    </InspectorLayout>
  );
}
