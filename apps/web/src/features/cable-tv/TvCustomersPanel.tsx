import { useState } from 'react';

import { type Customer,customerRfPath, portKey, RF_KIND_INFO } from '@fibergis/shared';

import { useNetworkStore } from '../../stores/networkStore';
import { disconnectTvCustomer } from '../../stores/rfActions';
import { inputClass } from './RfFields';
import { estimateText } from './rfText';
import { TvCustomerForm } from './TvCustomerForm';
import type { RfModel } from './useRfModel';

function Disconnect({ customer }: { customer: Customer }) {
  const [reason, setReason] = useState('');
  const [open, setOpen] = useState(false);
  if (customer.status === 'Disconnected') return <span className="text-[11px] text-slate-500">Disconnected {customer.disconnectedAt?.slice(0, 10)}: {customer.disconnectReason}</span>;
  if (!open) return <button type="button" className="rounded border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700" onClick={() => setOpen(true)}>Disconnect</button>;
  return (
    <span className="flex items-center gap-1">
      <input className={`${inputClass} w-40`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why" aria-label="Why disconnected" />
      <button type="button" disabled={!reason.trim()} className="rounded bg-red-600 px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-40" onClick={() => void disconnectTvCustomer(customer.id, reason)}>
        Disconnect this customer
      </button>
    </span>
  );
}

/** Cable TV customers with the path from their box up to the headend, or the exact gap. */
export function TvCustomersPanel({ model }: { model: RfModel }) {
  const customers = useNetworkStore((s) => s.customers);
  const tv = customers.filter((c) => c.accessNetwork === 'hfc');
  const olderTv = customers.filter((c) => c.accessNetwork !== 'hfc' && c.serviceType === 'Cable TV').length;
  return (
    <div className="space-y-4">
      <TvCustomerForm model={model} />
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h4 className="mb-2 text-sm font-bold text-slate-800">Cable TV customers ({tv.length})</h4>
        {olderTv > 0 && <p className="mb-2 text-xs text-slate-600">{olderTv} older customer(s) marked Cable TV were added through the fiber form and are not on the RF tree.</p>}
        {tv.length === 0 ? (
          <p className="text-sm text-slate-600">Not recorded.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-xs" data-testid="tv-customers">
            {tv.map((c) => {
              const path = customerRfPath(model.data, c.id, model.ix);
              const input = path.device ? model.estimates.get(portKey(path.device.id, 'IN')) : undefined;
              return (
                <li key={c.id} className="py-2" data-testid="tv-customer-row">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-slate-900">{c.name}</span>
                    <span className="text-slate-500">{c.id}</span>
                    {path.device && <span className="text-slate-700">{RF_KIND_INFO[path.device.kind].label} {path.device.name}{path.device.serialNumber ? `, serial ${path.device.serialNumber}` : ', serial not recorded'}</span>}
                    {c.locationMethod === 'not_placed' && <span className="rounded bg-amber-100 px-1.5 text-[11px] font-semibold text-amber-900">House not placed</span>}
                    <span className="ml-auto"><Disconnect customer={c} /></span>
                  </div>
                  {path.trace?.complete ? (
                    <div className="text-slate-700" data-testid="tv-path">Path: {path.trace.steps.map((s) => s.element.name).join(' → ')}</div>
                  ) : (
                    c.status !== 'Disconnected' && <div className="font-semibold text-red-700" data-testid="tv-gap">Path incomplete: {path.gap}</div>
                  )}
                  {path.device && c.status !== 'Disconnected' && <div className="text-slate-600" data-testid="tv-estimate">At the box: {estimateText(input, model.rf)}</div>}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
