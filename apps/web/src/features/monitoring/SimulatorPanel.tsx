import { useState } from 'react';

import { isLiveOnt, ONU_STATE_LABELS, ONU_STATES, type OnuState } from '@fibergis/shared';

import { describeApiError } from '../../api/client';
import { monitoringClient } from '../../api/monitoringClient';
import { Button } from '../../components/ui';
import { useNetworkStore } from '../../stores/networkStore';
import { showToast } from '../../stores/toastStore';
import { refreshFromServer, useMonitoringData } from './useMonitoring';

/**
 * The TEST simulator: the administrator types a status and a level for one ONT, to try the screens
 * and alarms. Every row and alarm it makes is TEST, shown as TEST, and left out of counts and reports.
 */
export function SimulatorPanel() {
  const { monitoringSources } = useMonitoringData();
  const onts = useNetworkStore((s) => s.onts).filter((o) => isLiveOnt(o) && (o.onuAddress || o.serialNumber));
  const sim = monitoringSources.find((s) => s.kind === 'test_simulator');
  const [ontId, setOntId] = useState('');
  const [state, setState] = useState<OnuState | ''>('');
  const [rx, setRx] = useState('');
  const [busy, setBusy] = useState(false);
  const ont = onts.find((o) => o.id === ontId);

  const send = async () => {
    if (!sim || !ont) return;
    setBusy(true);
    try {
      const row = {
        ...(ont.onuAddress ? { onuAddress: ont.onuAddress } : { serial: ont.serialNumber }),
        deviceTime: new Date().toISOString(),
        ...(state ? { state } : {}),
        ...(rx.trim() ? { ontRxDbm: rx.trim(), unit: 'dBm' } : {}),
      };
      const result = await monitoringClient.simulate({ sourceId: sim.id, rows: [row] });
      await refreshFromServer();
      showToast('info', 'TEST row sent', `TEST · not real: ${result.stored.statuses} status, ${result.stored.readings} reading, ${result.alarmsRaised} TEST alarm(s).${result.skipped[0] ? ` Skipped: ${result.skipped[0].reason}.` : ''}`);
    } catch (error) {
      showToast('error', 'Not sent', describeApiError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border-2 border-dashed border-violet-400 bg-violet-50 p-3 text-xs text-violet-950" data-testid="mon-sim">
      <p className="font-bold">TEST · not real. Rows made here are kept apart, marked TEST everywhere, and never counted as live.</p>
      {!sim ? (
        <p data-testid="mon-sim-none">The TEST simulator is off. Add a source of kind &quot;TEST simulator&quot; under Sources, then switch it on.</p>
      ) : !sim.enabled ? (
        <p data-testid="mon-sim-off">{sim.name} is switched off. Switch it on under Sources to use it.</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <label className="flex flex-col gap-1">
              <span className="font-semibold">ONT</span>
              <select value={ontId} onChange={(e) => setOntId(e.target.value)} className="min-h-[40px] rounded-lg border border-violet-300 px-2" data-testid="mon-sim-ont">
                <option value="">Choose…</option>
                {onts.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.id} · {o.onuAddress ?? o.serialNumber}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-semibold">TEST status</span>
              <select value={state} onChange={(e) => setState(e.target.value as OnuState | '')} className="min-h-[40px] rounded-lg border border-violet-300 px-2" data-testid="mon-sim-state">
                <option value="">None</option>
                {ONU_STATES.map((s) => (
                  <option key={s} value={s}>
                    {ONU_STATE_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-semibold">TEST receive level (dBm)</span>
              <input value={rx} onChange={(e) => setRx(e.target.value)} inputMode="decimal" className="min-h-[40px] rounded-lg border border-violet-300 px-2" data-testid="mon-sim-rx" />
            </label>
          </div>
          <Button variant="primary" disabled={busy || !ont || (!state && !rx.trim())} onClick={() => void send()} data-testid="mon-sim-send">
            Send TEST row
          </Button>
        </>
      )}
    </div>
  );
}
