import { Activity, Info, Navigation, Route, Waypoints } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import type { Customer } from '@fibergis/shared';

import { Badge, Button, cn, KeyValueList } from '../../components/ui';
import { traceNetworkPath } from '../../stores/networkActions';
import { useNetworkStore } from '../../stores/networkStore';
import { useUiStore } from '../../stores/uiStore';
import { navigateToSite } from './actions';
import { formatDate, formatDbm, joinPresent, presentItems, rxBudget } from './format';
import { InspectorLayout, InspectorSection, Metric } from './sections';

interface PathStep {
  role: string;
  name?: string;
  detail?: string;
  onSelect?: () => void;
}

function useServicePath(customer: Customer): PathStep[] {
  const { equipment, cables, splitters } = useNetworkStore(
    useShallow((s) => ({ equipment: s.equipment, cables: s.cables, splitters: s.splitters })),
  );
  const select = useUiStore((s) => s.select);

  const eq = (id: string) => equipment.find((e) => e.id === id);
  const cable = (id: string) => cables.find((c) => c.id === id);
  const olt = eq(customer.oltId);
  const pon = olt?.ponPorts?.find((p) => p.id === customer.ponPort);
  const feeder = cable(customer.feederCableId);
  const distribution = cable(customer.distributionCableId);
  const terminalBox = eq(customer.terminalBoxId);
  const splitter = splitters.find((s) => s.id === customer.splitterId);
  const drop = cable(customer.dropCableId);

  const equipmentStep = (role: string, item = olt, detail?: string): PathStep => ({
    role,
    name: item?.name,
    detail,
    onSelect: item ? () => select({ type: 'equipment', data: item }) : undefined,
  });
  const cableStep = (role: string, item: typeof feeder, detail?: string): PathStep => ({
    role,
    name: item?.name,
    detail: joinPresent([item ? `${item.fiberCount} F` : undefined, detail], ' · '),
    onSelect: item ? () => select({ type: 'cable', data: item }) : undefined,
  });

  return [
    equipmentStep('OLT', olt, pon ? (pon.slotCardPort ?? `PON ${pon.portNumber}`) : undefined),
    cableStep('Feeder', feeder),
    cableStep('Distribution', distribution),
    equipmentStep('Terminal box', terminalBox),
    {
      role: 'Splitter',
      name: splitter?.name,
      detail: splitter ? `${splitter.ratio} · output ${customer.splitterOutputPort}` : undefined,
    },
    cableStep('Drop', drop, `core ${customer.fiberCore}`),
    { role: 'ONT', name: customer.ontSerialNumber || undefined, detail: customer.routerModel || undefined },
  ];
}

function ServicePath({ steps }: { steps: PathStep[] }) {
  return (
    <ol className="relative">
      {steps.map((step, index) => {
        const last = index === steps.length - 1;
        return (
          <li key={step.role} className="relative flex gap-3 pb-3 last:pb-0">
            {!last && <span aria-hidden className="absolute top-3 left-[5px] h-full w-px bg-slate-200" />}
            <span
              aria-hidden
              className={cn(
                'relative mt-1 size-[11px] shrink-0 rounded-full border-2 bg-white',
                step.name ? 'border-blue-500' : 'border-slate-300',
              )}
            />
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">{step.role}</div>
              {step.name ? (
                step.onSelect ? (
                  <button
                    type="button"
                    onClick={step.onSelect}
                    className="block max-w-full truncate text-left text-[13px] font-medium text-slate-900 hover:text-blue-700 hover:underline"
                  >
                    {step.name}
                  </button>
                ) : (
                  <div className="truncate text-[13px] font-medium text-slate-900">{step.name}</div>
                )
              ) : (
                <div className="text-[13px] text-slate-400">Not linked</div>
              )}
              {step.detail && <div className="truncate text-xs text-slate-500">{step.detail}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function CustomerInspector({ customer, detailed }: { customer: Customer; detailed: boolean }) {
  const steps = useServicePath(customer);
  const budget = rxBudget(customer.rxOpticalPowerDbm);

  const details = presentItems([
    { label: 'Service', value: customer.serviceType },
    { label: 'Plan', value: customer.plan },
    { label: 'Mobile', value: customer.mobile, mono: true },
    { label: 'Address', value: customer.address },
    {
      label: 'Unit',
      value: joinPresent([customer.building, customer.flatNumber && `Flat ${customer.flatNumber}`], ' · '),
    },
    { label: 'Installed', value: formatDate(customer.installationDate) },
    { label: 'ONT serial', value: customer.ontSerialNumber, mono: true },
    { label: 'Router', value: customer.routerModel },
    { label: 'IP address', value: customer.ipAddress, mono: true },
  ]);

  return (
    <InspectorLayout
      actions={
        <>
          <Button variant="primary" size="sm" icon={Route} onClick={() => traceNetworkPath(customer.id)}>
            Trace service path
          </Button>
          <Button
            size="sm"
            icon={Navigation}
            onClick={() =>
              navigateToSite({
                id: customer.id,
                name: customer.name,
                lat: customer.lat,
                lng: customer.lng,
                type: 'customer',
              })
            }
          >
            Navigate
          </Button>
        </>
      }
    >
      <InspectorSection title="Optical signal" icon={Activity} aside={<Badge tone={budget.tone}>{budget.label}</Badge>}>
        <div className="grid grid-cols-2 gap-2">
          <Metric label="Received power" value={formatDbm(customer.rxOpticalPowerDbm)} className={budget.text} />
          <Metric label="Fiber core" value={`Core ${customer.fiberCore}`} />
        </div>
      </InspectorSection>

      <InspectorSection title="Service path" icon={Waypoints}>
        <ServicePath steps={steps} />
      </InspectorSection>

      <InspectorSection title="Subscriber" icon={Info} defaultOpen={detailed}>
        <KeyValueList items={details} />
      </InspectorSection>
    </InspectorLayout>
  );
}
