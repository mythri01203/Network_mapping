import { Wifi } from 'lucide-react';

import {
  type Customer,
  latestReading,
  latestStatus,
  NO_LIVE_CONNECTION,
  ONU_STATE_LABELS,
  type ShownStatus,
  showReading,
  showStatus,
} from '@fibergis/shared';

import { Badge, type BadgeTone } from '../../components/ui';
import { selectOpticalSettings, useNetworkStore } from '../../stores/networkStore';
import { formatDateTime } from '../inspector/format';
import { InspectorSection } from '../inspector/sections';
import { useMonitoringData, useMonitoringSettings, useNow } from './useMonitoring';

const STATE_TONE: Record<string, BadgeTone> = { online: 'green', offline: 'red', los: 'red', dying_gasp: 'amber', unknown: 'neutral' };

const statusTone = (shown: ShownStatus): BadgeTone => (shown.freshness === 'test' ? 'violet' : shown.stale || !shown.state ? 'neutral' : STATE_TONE[shown.state]);

/**
 * The customer's ONT as the monitoring sources last reported it: status, measured receive levels,
 * device time, source and age. "Live" only for a real source inside the window; stale says stale;
 * TEST rows are shown apart and marked TEST. With nothing at all: "No live connection".
 */
export function LiveStatusSection({ customer }: { customer: Customer }) {
  const data = useMonitoringData();
  const settings = useMonitoringSettings();
  const optical = useNetworkStore(selectOpticalSettings);
  const now = useNow();
  if (customer.status === 'Disconnected' || customer.accessNetwork === 'hfc') return null;
  const ontId = customer.ontId;
  if (!ontId) {
    return (
      <InspectorSection title="Live status" icon={Wifi}>
        <p className="text-xs text-slate-600" data-testid="live-status">
          {NO_LIVE_CONNECTION}. This customer has no ONT record, so readings from the OLT cannot be matched to them. Make the ONT record in the ONT section.
        </p>
      </InspectorSection>
    );
  }
  const status = showStatus(latestStatus(data, ontId), data, settings, now);
  const rx = showReading(latestReading(data, ontId, 'ont_rx'), data, optical, settings, now);
  const up = showReading(latestReading(data, ontId, 'olt_upstream_rx'), data, optical, settings, now);
  const testStatus = showStatus(latestStatus(data, ontId, true), data, settings, now);
  const history = data.onuStatuses.filter((s) => s.ontId === ontId).sort((a, b) => b.deviceTime.localeCompare(a.deviceTime));

  return (
    <InspectorSection title="Live status" icon={Wifi} aside={<Badge tone={statusTone(status)}>{status.state ? status.label : NO_LIVE_CONNECTION}</Badge>}>
      <div className="space-y-2 text-xs text-slate-700" data-testid="live-status">
        <div>
          <div className="font-semibold" data-testid="live-status-state">
            {status.label}
          </div>
          <div className="text-[11px] text-slate-500" data-testid="live-status-note">
            {status.note}
            {status.at ? ` · device time ${formatDateTime(status.at)}` : ''}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          <div className="rounded-md border border-slate-200 p-2">
            <div className="text-[11px] text-slate-500">ONT receive (measured)</div>
            <div className="font-semibold" data-testid="live-rx">
              {rx.text}
            </div>
            <div className="text-[11px] text-slate-500" data-testid="live-rx-note">
              {rx.valueDbm !== undefined ? `${rx.bandLabel} · ${rx.note}${rx.at ? ` · ${formatDateTime(rx.at)}` : ''}` : 'Not reported by any source'}
            </div>
          </div>
          <div className="rounded-md border border-slate-200 p-2">
            <div className="text-[11px] text-slate-500">OLT receive from this ONU (upstream)</div>
            <div className="font-semibold">{up.text}</div>
            <div className="text-[11px] text-slate-500">{up.valueDbm !== undefined ? `${up.bandLabel} · ${up.note}` : 'Not reported by any source'}</div>
          </div>
        </div>
        {testStatus.state && (
          <p className="rounded-md border border-violet-300 bg-violet-50 p-2 text-violet-900" data-testid="live-test-status">
            {testStatus.label} · {testStatus.note}. Not counted anywhere.
          </p>
        )}
        <p className="text-[11px] text-slate-500">A status says what the OLT reported, not why. An offline customer alone does not mean a fiber cut.</p>
        {history.length > 0 && (
          <div>
            <div className="mt-1 font-semibold">Status history</div>
            <ul className="mt-1 space-y-0.5 text-[11px]" data-testid="live-status-history">
              {history.slice(0, 10).map((h) => (
                <li key={h.id} className={h.isTest ? 'text-violet-700' : 'text-slate-600'}>
                  {formatDateTime(h.deviceTime)} · {h.isTest ? 'TEST · ' : ''}
                  {ONU_STATE_LABELS[h.state]}
                  {h.rawState && h.rawState !== h.state ? ` ("${h.rawState}")` : ''} · {data.monitoringSources.find((s) => s.id === h.sourceId)?.name ?? h.sourceId}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </InspectorSection>
  );
}
