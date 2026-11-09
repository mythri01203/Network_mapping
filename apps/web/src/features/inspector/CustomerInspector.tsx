import {
  Activity,
  GitMerge,
  Info,
  Link2,
  LocateFixed,
  MapPin,
  Navigation,
  Route,
  TriangleAlert,
  Waypoints,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import {
  type Customer,
  findServingOlt,
  hasRecordedLocation,
  LOCATION_METHOD_LABELS,
  RX_ORIGIN_LABELS,
  rxReadingOf,
  withDeviceRx,
} from '@fibergis/shared';

import { Badge, Button, cn, KeyValueList } from '../../components/ui';
import { currentGpsPosition, gpsFailureMessage } from '../../lib/browser';
import { relinkCustomer, setCustomerLocation } from '../../stores/networkActions';
import { selectOpticalSettings, useNetworkStore } from '../../stores/networkStore';
import { showToast } from '../../stores/toastStore';
import { useUiStore } from '../../stores/uiStore';
import {
  ConnectionSection,
  CustomerHistorySection,
  CustomerPlaceSection,
  DisconnectedNotice,
  OntSection,
  RxCheckSection,
  ServicesSection,
} from '../customers/ConnectionSections';
import { LiveStatusSection } from '../monitoring/LiveStatusSection';
import { navigateToSite } from './actions';
import { formatDate, formatDateTime, formatDbm, joinPresent, orNotRecorded, presentItems, rxBudget } from './format';
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

/** Says plainly when a customer is not linked to an OLT, and offers the link once a cable reaches the box. */
function NotLinkedNotice({ customer }: { customer: Customer }) {
  const cableReady = useNetworkStore(
    (s) => !!customer.terminalBoxId && !!findServingOlt(customer.terminalBoxId, s).olt,
  );
  if (customer.oltId || customer.status === 'Disconnected') return null;
  return (
    <div role="status" className="mx-4 mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
      <p className="flex items-center gap-1.5 text-[13px] font-semibold">
        <TriangleAlert size={14} className="shrink-0 text-amber-600" />
        Not linked
      </p>
      <p className="mt-1">
        {cableReady
          ? 'A cable now reaches this box. Link this customer so they can be traced to the OLT.'
          : 'No cable connects this customer’s box to an OLT, so they cannot be traced. Draw that cable first, ending on the box.'}
      </p>
      {cableReady && (
        <Button size="sm" variant="primary" icon={Link2} className="mt-2" onClick={() => relinkCustomer(customer.id)}>
          Link to OLT
        </Button>
      )}
    </div>
  );
}

/** Says plainly when the house position is unknown, and offers the two honest ways to record it. */
function NoLocationNotice({ customer }: { customer: Customer }) {
  const setPicking = useUiStore((s) => s.setPickingOnuCustomer);
  if (hasRecordedLocation(customer)) return null;
  const captureGps = async () => {
    try {
      const { lat, lng, accuracyMeters } = await currentGpsPosition();
      setCustomerLocation(customer.id, { lat, lng, method: 'gps', accuracyMeters });
    } catch (error) {
      showToast('warning', 'No GPS position', gpsFailureMessage(error));
    }
  };
  return (
    <div role="status" className="mx-4 mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
      <p className="flex items-center gap-1.5 text-[13px] font-semibold">
        <MapPin size={14} className="shrink-0 text-amber-600" />
        House location not recorded
      </p>
      <p className="mt-1">Until it is saved, the drop cable has no route or length.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" variant="primary" icon={LocateFixed} onClick={() => void captureGps()}>
          Use my GPS
        </Button>
        <Button
          size="sm"
          icon={MapPin}
          onClick={() => {
            setPicking(customer);
            useUiStore.getState().setPanelOpen('right', false);
          }}
        >
          Pick on map
        </Button>
      </div>
    </div>
  );
}

export function CustomerInspector({ customer, detailed }: { customer: Customer; detailed: boolean }) {
  const steps = useServicePath(customer);
  const optical = useNetworkStore(selectOpticalSettings);
  // Phase 7: the newest real device reading counts as measured, with its device time (never TEST).
  const onuReadings = useNetworkStore((s) => s.onuReadings);
  const reading = rxReadingOf(withDeviceRx(customer, { onuReadings }), optical);
  const budget = rxBudget(reading.valueDbm);
  const openFiberTrace = useUiStore((s) => s.openFiberTrace);
  const openSpliceModal = useUiStore((s) => s.openSpliceModal);
  const located = hasRecordedLocation(customer);

  const details = presentItems([
    { label: 'Service', value: customer.serviceType },
    { label: 'Plan', value: orNotRecorded(customer.plan) },
    { label: 'Mobile', value: orNotRecorded(customer.mobile), mono: true },
    { label: 'Address', value: orNotRecorded(customer.address) },
    {
      label: 'Unit',
      value: joinPresent([customer.building, customer.flatNumber && `Flat ${customer.flatNumber}`], ' · '),
    },
    { label: 'Installed', value: formatDate(customer.installationDate) },
    { label: 'ONT serial', value: orNotRecorded(customer.ontSerialNumber), mono: true },
    { label: 'Router', value: orNotRecorded(customer.routerModel) },
    { label: 'IP address', value: orNotRecorded(customer.ipAddress), mono: true },
    {
      label: 'Location',
      value: located ? `${customer.lat.toFixed(5)}, ${customer.lng.toFixed(5)}` : 'Not recorded',
      mono: located,
    },
    {
      label: 'Location from',
      value:
        located && customer.locationMethod
          ? `${LOCATION_METHOD_LABELS[customer.locationMethod]}${
              customer.locationAccuracyMeters !== undefined
                ? `, within ${Math.round(customer.locationAccuracyMeters)} m`
                : ''
            }`
          : undefined,
    },
  ]);

  return (
    <InspectorLayout
      actions={
        <>
          <Button variant="primary" size="sm" icon={Route} onClick={() => openFiberTrace(customer.id)}>
            Trace service path
          </Button>
          <Button size="sm" icon={GitMerge} onClick={() => openSpliceModal(customer)}>
            Connect
          </Button>
          <Button
            size="sm"
            icon={Navigation}
            disabled={!located}
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
      <DisconnectedNotice customer={customer} />
      <NotLinkedNotice customer={customer} />
      <NoLocationNotice customer={customer} />

      {customer.status !== 'Disconnected' && (
        <InspectorSection
          title="Optical signal"
          icon={Activity}
          aside={<Badge tone={budget.tone}>{budget.label}</Badge>}
        >
          <div className="grid grid-cols-2 gap-2">
            <Metric
              label="Received power"
              value={formatDbm(reading.valueDbm) ?? RX_ORIGIN_LABELS.not_recorded}
              className={budget.text}
            />
            <Metric label="Fiber core" value={customer.fiberCore ? `Core ${customer.fiberCore}` : 'Not recorded'} />
          </div>
          <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-slate-500">
            <span className="truncate">
              {reading.measuredAt ? `Read ${formatDateTime(reading.measuredAt)}` : 'No live connection'}
            </span>
            <Badge tone={reading.isMeasured ? 'green' : 'neutral'}>{reading.originLabel}</Badge>
          </div>
        </InspectorSection>
      )}

      <LiveStatusSection customer={customer} />
      <RxCheckSection customer={customer} />

      <InspectorSection title="Service path" icon={Waypoints}>
        <ServicePath steps={steps} />
      </InspectorSection>

      <ConnectionSection customer={customer} />
      <OntSection customer={customer} />
      <ServicesSection customer={customer} />
      <CustomerPlaceSection customer={customer} />

      <InspectorSection title="Subscriber" icon={Info} defaultOpen={detailed}>
        <KeyValueList items={details} />
      </InspectorSection>

      <CustomerHistorySection customer={customer} />
    </InspectorLayout>
  );
}
