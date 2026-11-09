import { useMemo } from 'react';

import { ageText, CUSTOMER_LIVE_STATE_LABELS, CUSTOMER_LIVE_STATES, NO_LIVE_CONNECTION, summarizeMonitoring } from '@fibergis/shared';

import { selectOpticalSettings, useNetworkStore } from '../../stores/networkStore';
import { formatDateTime } from '../inspector/format';
import { useMonitoringData, useMonitoringSettings, useNow } from './useMonitoring';

const TILE: Record<string, string> = {
  online: 'border-emerald-300 bg-emerald-50 text-emerald-900',
  offline: 'border-red-300 bg-red-50 text-red-900',
  los: 'border-red-300 bg-red-50 text-red-900',
  dying_gasp: 'border-amber-300 bg-amber-50 text-amber-900',
};

/** Section 17.1, from the newest real rows only. TEST rows are counted apart and never added in. */
export function MonitoringOverview() {
  const monitoring = useMonitoringData();
  const customers = useNetworkStore((s) => s.customers);
  const onts = useNetworkStore((s) => s.onts);
  const equipment = useNetworkStore((s) => s.equipment);
  const optical = useNetworkStore(selectOpticalSettings);
  const settings = useMonitoringSettings();
  const now = useNow();
  const s = useMemo(() => summarizeMonitoring({ ...monitoring, customers, onts, equipment }, optical, settings, now), [monitoring, customers, onts, equipment, optical, settings, now]);

  return (
    <div className="space-y-4 text-xs text-slate-700">
      {s.live ? (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-emerald-900" data-testid="mon-live">
          <strong>Live</strong> · a real source sent data in the last {settings.statusStaleMinutes} min
          {s.lastReceivedAt ? ` (last received ${ageText(s.lastReceivedAt, now)}, ${formatDateTime(s.lastReceivedAt)})` : ''}.
        </div>
      ) : (
        <div className="rounded-lg border border-slate-300 bg-slate-50 p-3" data-testid="mon-no-live">
          <strong>{NO_LIVE_CONNECTION}</strong>.{' '}
          {s.realSources === 0
            ? 'No monitoring source is set up, so nothing below comes from a device. The administrator adds one under Sources.'
            : `No real source has sent anything in the last ${settings.statusStaleMinutes} min${s.lastReceivedAt ? ` (last received ${ageText(s.lastReceivedAt, now)})` : ''}. Values below are last known and shown as stale.`}
        </div>
      )}

      <div>
        <div className="mb-1 font-semibold">Customers ({s.customers}) by their ONT&apos;s newest real status</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {CUSTOMER_LIVE_STATES.map((state) => (
            <div key={state} className={`rounded-lg border p-2 ${TILE[state] ?? 'border-slate-200 bg-white'}`} data-testid={`mon-count-${state}`}>
              <div className="text-lg font-bold">{s.counts[state]}</div>
              <div className="text-[11px]">{CUSTOMER_LIVE_STATE_LABELS[state]}</div>
            </div>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-slate-500" data-testid="mon-test-note">
          Stale after {settings.statusStaleMinutes} min (Administration, Monitoring settings). TEST rows are not counted ({s.testRows} TEST row(s) kept apart). {s.unmatchedRows} real row(s) not matched to an ONT: see Not matched.
          An offline or LOS customer alone does not prove a fiber cut.
        </p>
      </div>

      <div>
        <div className="mb-1 font-semibold">PON ports</div>
        {s.ponPorts.length === 0 ? (
          <p className="text-slate-500">No ONT records yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left" data-testid="mon-pon-table">
              <thead className="text-[11px] text-slate-500">
                <tr>
                  <th className="py-1 pr-2">OLT · PON port</th>
                  <th className="py-1 pr-2">ONTs</th>
                  <th className="py-1 pr-2">Online</th>
                  <th className="py-1 pr-2">Offline / LOS</th>
                  <th className="py-1 pr-2">Stale / no data</th>
                  <th className="py-1">Weakest Rx</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {s.ponPorts.map((p) => (
                  <tr key={p.key}>
                    <td className="py-1 pr-2">{p.label}</td>
                    <td className="py-1 pr-2">{p.onts}</td>
                    <td className="py-1 pr-2">{p.counts.online ?? 0}</td>
                    <td className="py-1 pr-2">{(p.counts.offline ?? 0) + (p.counts.los ?? 0)}</td>
                    <td className="py-1 pr-2">{(p.counts.stale ?? 0) + (p.counts.no_data ?? 0)}</td>
                    <td className="py-1">{p.worstRxDbm !== undefined ? `${p.worstRxDbm.toFixed(1)} dBm` : 'Not reported'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <div className="mb-1 font-semibold">Worst light levels (outside the good band in Optical settings)</div>
        {s.worstRx.length === 0 ? (
          <p className="text-slate-500" data-testid="mon-worst-none">None reported.</p>
        ) : (
          <ul className="space-y-1" data-testid="mon-worst">
            {s.worstRx.map((w) => (
              <li key={w.ontId} className="rounded-md border border-amber-200 bg-amber-50 p-2">
                <strong>{w.reading.text}</strong> · {w.reading.bandLabel} · ONT {w.ontId}
                {w.customerIds.length ? ` · customer ${w.customerIds.join(', ')}` : ''} · {w.reading.note}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Rows that matched no ONT, kept with the reason. Nothing was guessed for them. */
export function UnmatchedList() {
  const { onuReadings, onuStatuses, monitoringSources } = useMonitoringData();
  const rows = [...onuStatuses, ...onuReadings].filter((r) => !r.ontId).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  if (rows.length === 0) return <p className="text-xs text-slate-500" data-testid="mon-unmatched-none">Every stored row matched an ONT record.</p>;
  return (
    <div className="space-y-2 text-xs">
      <p className="text-slate-600">These rows named an ONU address or serial that is not written on exactly one ONT record. They are kept but shown on nobody. Fix the ONT record (address or serial exactly as the OLT writes it); the next row will match.</p>
      <ul className="space-y-1" data-testid="mon-unmatched">
        {rows.slice(0, 200).map((r) => (
          <li key={r.id} className={`rounded-md border p-2 ${r.isTest ? 'border-violet-300 bg-violet-50' : 'border-slate-200'}`}>
            {r.isTest ? 'TEST · ' : ''}
            <span className="font-mono">{r.onuAddress ?? r.serial}</span> · {r.unmatchedReason ?? 'Not matched'} · {formatDateTime(r.deviceTime)} · {monitoringSources.find((s) => s.id === r.sourceId)?.name ?? r.sourceId}
          </li>
        ))}
      </ul>
    </div>
  );
}
