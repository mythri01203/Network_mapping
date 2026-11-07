import { Activity, Network, Radio } from 'lucide-react';

import { type Equipment, opticalPowerFor, PON_TECHNOLOGIES, type PonPort, type PonTechnology } from '@fibergis/shared';

import { OltChassisIcon } from '../../components/icons/OltChassisIcon';
import { Badge, type BadgeTone, Button, cn, KeyValueList, Select, StatusBadge } from '../../components/ui';
import { traceNetworkPath, updateEquipment } from '../../stores/networkActions';
import { useUiStore } from '../../stores/uiStore';
import { formatDateTime, formatDbm, joinPresent, rxBudget, SIGNAL_TONES } from './format';
import { PON_TECHNOLOGY_SPECS } from './ponTechnology';
import { InspectorSection, Metric } from './sections';

const isPonTechnology = (value: string): value is PonTechnology =>
  (PON_TECHNOLOGIES as readonly string[]).includes(value);

const formatReading = (value: number | undefined) => (value === undefined ? '—' : value.toFixed(1));

const PON_PORT_TONES: Record<PonPort['status'], BadgeTone> = {
  Active: 'green',
  Available: 'neutral',
  Reserved: 'amber',
  Faulty: 'red',
};

/** OLT-specific sections: chassis summary, PON technology, optical power and the PON port table. */
export function OltSections({ olt, detailed }: { olt: Equipment; detailed: boolean }) {
  const ponPorts = olt.ponPorts ?? [];
  const power = opticalPowerFor(olt);
  const spec = olt.technology ? PON_TECHNOLOGY_SPECS[olt.technology] : undefined;
  const worstRx = rxBudget(power.rxPowerDbm);
  const subscribers = ponPorts.reduce((sum, port) => sum + port.connectedCustomersCount, 0);

  return (
    <>
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 bg-slate-50/50">
        <div className="flex items-center gap-3">
          <div className="flex h-14 w-24 shrink-0 items-center justify-center rounded-md bg-slate-900">
            <OltChassisIcon width={76} height={40} status={olt.status} technology={olt.technology} />
          </div>
          <div className="min-w-0 text-xs text-slate-500">
            <div className="truncate text-[13px] font-bold text-slate-900">
              {joinPresent([olt.manufacturer, olt.model]) ?? 'Model not recorded'}
            </div>
            <div className="font-medium text-slate-700">
              {ponPorts.length} PON ports · <span className="text-sky-700 font-bold">{olt.technology || 'Technology not recorded'}</span>
            </div>
            <div>{subscribers} subscribers</div>
          </div>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => useUiStore.getState().openOltConfigModal(olt)}
          className="text-xs shrink-0"
        >
          Edit Specs
        </Button>
      </div>

      <InspectorSection title="PON technology" icon={Radio}>
        <Select
          controlSize="sm"
          aria-label="PON technology"
          value={olt.technology ?? ''}
          onChange={(event) => {
            const next = event.target.value;
            if (isPonTechnology(next) && next !== olt.technology) updateEquipment({ ...olt, technology: next });
          }}
        >
          {!olt.technology && (
            <option value="" disabled>
              Not set
            </option>
          )}
          {PON_TECHNOLOGIES.map((technology) => (
            <option key={technology} value={technology}>
              {technology}
            </option>
          ))}
        </Select>
        {spec && (
          <KeyValueList
            className="mt-2"
            items={[
              { label: 'Standard', value: spec.standard },
              { label: 'Line rate', value: spec.rate },
              { label: 'Wavelengths', value: spec.wavelengths },
            ]}
          />
        )}
      </InspectorSection>

      <InspectorSection
        title="Optical power"
        icon={Activity}
        defaultOpen={detailed}
        aside={<StatusBadge status={power.signalLevel} tone={SIGNAL_TONES[power.signalLevel]} />}
      >
        <div className="grid grid-cols-2 gap-2">
          <Metric label="Average Tx" value={formatDbm(power.txPowerDbm) ?? 'Not recorded'} />
          <Metric label="Weakest Rx" value={formatDbm(power.rxPowerDbm) ?? 'Not recorded'} className={worstRx.text} />
        </div>
        <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-slate-500">
          <span className="truncate">
            {power.lastUpdated ? `Read ${formatDateTime(power.lastUpdated)}` : 'No readings on record'} · No live connection
          </span>
          {(power.txPowerDbm !== undefined || power.rxPowerDbm !== undefined) && <Badge tone="neutral">Sample data</Badge>}
        </div>
      </InspectorSection>

      <InspectorSection
        title="PON ports"
        icon={Network}
        defaultOpen={detailed}
        aside={`${ponPorts.filter((port) => port.status === 'Active').length}/${ponPorts.length} active`}
      >
        {ponPorts.length === 0 ? (
          <p className="text-xs text-slate-500">No PON ports configured.</p>
        ) : (
          <div className="-mx-2">
            <div className="grid grid-cols-[minmax(0,1fr)_4.75rem_2.5rem_2.75rem_2.75rem] gap-2 px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              <span>Port</span>
              <span>Status</span>
              <span className="text-right">Subs</span>
              <span className="text-right">Tx</span>
              <span className="text-right">Rx</span>
            </div>
            {ponPorts.map((port) => (
              <button
                key={port.id}
                type="button"
                title={`Trace ${port.slotCardPort ?? `PON ${port.portNumber}`}`}
                onClick={() => traceNetworkPath(`${olt.id}/${port.id}`)}
                className="grid w-full grid-cols-[minmax(0,1fr)_4.75rem_2.5rem_2.75rem_2.75rem] items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors hover:bg-slate-50"
              >
                <span className="truncate font-mono text-slate-800">
                  {port.slotCardPort ?? `PON ${port.portNumber}`}
                </span>
                <StatusBadge status={port.status} tone={PON_PORT_TONES[port.status]} />
                <span className="text-right tabular-nums text-slate-700">{port.connectedCustomersCount}</span>
                <span className="text-right tabular-nums text-slate-700">{formatReading(port.txPowerDbm)}</span>
                <span className={cn('text-right tabular-nums', rxBudget(port.rxPowerDbm).text)}>
                  {formatReading(port.rxPowerDbm)}
                </span>
              </button>
            ))}
            <p className="px-2 pt-1.5 text-[11px] text-slate-500">Power in dBm. Select a port to trace its path.</p>
          </div>
        )}
      </InspectorSection>
    </>
  );
}
