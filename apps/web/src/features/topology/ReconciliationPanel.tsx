import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { reconcileNetwork } from '@fibergis/shared';

import { useShowOnMap } from '../../app/views';
import { cn } from '../../components/ui';
import { selectOpticalSettings, selectOspSettings, useNetworkStore } from '../../stores/networkStore';

/**
 * Reconciliation: predicted against measured Rx per customer, and drawn against sheath against
 * optical length per cable. Each line is a plain next action; the limits are settings.
 */
export function ReconciliationPanel() {
  const network = useNetworkStore(
    useShallow((s) => ({ equipment: s.equipment, cables: s.cables, splitters: s.splitters, closures: s.closures, customers: s.customers, slackLoops: s.slackLoops })),
  );
  const optical = useNetworkStore(selectOpticalSettings);
  const osp = useNetworkStore(selectOspSettings);
  const result = useMemo(() => reconcileNetwork(network, optical, osp), [network, optical, osp]);
  const [all, setAll] = useState(false);
  const showOnMap = useShowOnMap();
  const rx = all ? result.rx : result.rx.filter((r) => r.flagged || r.status === 'unclear' || r.status === 'no_path');
  const lengths = all ? result.lengths : result.lengths.filter((l) => l.flagged);
  const flaggedRx = result.rx.filter((r) => r.flagged).length;
  const flaggedLen = result.lengths.filter((l) => l.flagged).length;
  const select = (type: 'customer' | 'cable', id: string) => {
    const state = useNetworkStore.getState();
    if (type === 'customer') {
      const data = state.customers.find((c) => c.id === id);
      if (data) showOnMap({ type: 'customer', data });
    } else {
      const data = state.cables.find((c) => c.id === id);
      if (data) showOnMap({ type: 'cable', data });
    }
  };
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4" data-testid="reconciliation">
      <p className="mb-3 max-w-3xl text-xs text-slate-600">
        Expected light is calculated from the recorded fiber path; only a meter or OLT reading counts as measured. Without the PON port's real launch power the expected value is a range. Limits: {optical.measuredGapDb} dB below and {optical.measuredStrongGapDb} dB above expected, and the length limits in Poles and routes settings.
      </p>
      <label className="mb-3 flex items-center gap-2 text-xs text-slate-700">
        <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show every customer and cable, not only those to check
      </label>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Light readings ({flaggedRx} to check of {result.rx.length})
      </h3>
      {rx.length === 0 ? (
        <p className="mb-4 text-sm text-slate-600">Nothing to check.</p>
      ) : (
        <ul className="mb-5 space-y-2">
          {rx.map((r) => (
            <li key={r.customerId} data-testid={`recon-rx-${r.customerId}`} className={cn('rounded-md border p-2 text-[13px]', r.flagged ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white')}>
              <button type="button" className="font-medium text-blue-700 hover:underline" onClick={() => select('customer', r.customerId)}>
                {r.customerName}
              </button>
              <p className="text-xs text-slate-700">{r.finding}</p>
              <p className="text-xs font-semibold text-slate-900">{r.nextAction}</p>
            </li>
          ))}
        </ul>
      )}
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Cable lengths ({flaggedLen} to check of {result.lengths.length})
      </h3>
      {lengths.length === 0 ? (
        <p className="text-sm text-slate-600">Nothing to check.</p>
      ) : (
        <ul className="space-y-2">
          {lengths.map((l) => (
            <li key={l.cableId} data-testid={`recon-len-${l.cableId}`} className={cn('rounded-md border p-2 text-[13px]', l.flagged ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white')}>
              <button type="button" className="font-medium text-blue-700 hover:underline" onClick={() => select('cable', l.cableId)}>
                {l.cableName}
              </button>
              <p className="text-xs text-slate-700">
                Drawn {l.lengths.drawnMeters !== undefined ? `${Math.round(l.lengths.drawnMeters)} m` : 'not recorded'} · sheath {l.lengths.sheathMeters !== undefined ? `${Math.round(l.lengths.sheathMeters)} m` : 'not recorded'} · optical{' '}
                {l.lengths.opticalMeters !== undefined ? `${Math.round(l.lengths.opticalMeters)} m` : 'not recorded'}
              </p>
              <p className="text-xs text-slate-700">{l.finding}</p>
              {l.flags.map((f) => (
                <p key={f.code} className="text-xs">
                  {f.message} <span className="font-semibold text-slate-900">{f.nextAction}</span>
                </p>
              ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
