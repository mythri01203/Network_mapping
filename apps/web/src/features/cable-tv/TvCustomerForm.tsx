import { useState } from 'react';

import { portKey, RF_COAX_TYPES, type TvCustomerDraft } from '@fibergis/shared';

import { addTvCustomer } from '../../stores/rfActions';
import { SelectField, SubmitButton, TextField } from './RfFields';
import { numberOrUndefined } from './rfText';
import type { RfModel } from './useRfModel';

/**
 * The Cable TV customer flow, next to the fiber one (Customers, Add customer): a customer on one
 * tap drop port with a set top box or cable modem. A used tap port is refused.
 */
export function TvCustomerForm({ model }: { model: RfModel }) {
  const [t, setT] = useState<Record<string, string>>({ device: 'stb' });
  const set = (key: string) => (v: string) => setT((old) => ({ ...old, [key]: v }));
  const taps = model.data.rfElements.filter((e) => e.kind === 'tap');
  const tap = taps.find((e) => e.id === t.tap);
  const dropPorts = tap?.ports.filter((p) => p.role === 'drop') ?? [];
  const used = (portId: string) => (model.ix.outOf.get(portKey(tap?.id ?? '', portId))?.length ?? 0) > 0;
  const ready = !!t.name?.trim() && !!tap && !!t.port;

  const save = async () => {
    if (!tap || !t.port) return;
    const draft: TvCustomerDraft = {
      name: t.name ?? '',
      mobile: t.mobile,
      address: t.address,
      area: t.area,
      lat: numberOrUndefined(t.lat ?? ''),
      lng: numberOrUndefined(t.lng ?? ''),
      plan: t.plan,
      tap: { elementId: tap.id, portId: t.port },
      device: { kind: t.device === 'cable_modem' ? 'cable_modem' : 'stb', serialNumber: t.serial, model: t.model },
      drop: { coaxType: t.coax || undefined, lengthM: numberOrUndefined(t.length ?? ''), lengthSource: (t.lengthSource as TvCustomerDraft['drop']['lengthSource']) || undefined },
    };
    const made = await addTvCustomer(draft);
    if (made) setT({ device: t.device ?? 'stb' });
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4" data-testid="tv-customer-form">
      <h4 className="text-sm font-bold text-slate-800">Add a Cable TV customer</h4>
      <p className="mb-2 text-xs text-slate-600">For fiber (FTTH) customers use Customers, Add customer. A Cable TV customer is on a tap drop port, not a PON splitter.</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <TextField label="Customer name" value={t.name ?? ''} onChange={set('name')} testId="tv-name" />
        <TextField label="Mobile" value={t.mobile ?? ''} onChange={set('mobile')} inputMode="numeric" />
        <TextField label="Address" value={t.address ?? ''} onChange={set('address')} />
        <TextField label="Area" value={t.area ?? ''} onChange={set('area')} />
        <TextField label="House latitude" value={t.lat ?? ''} onChange={set('lat')} inputMode="decimal" hint="Blank: not placed. Never taken from the tap." />
        <TextField label="House longitude" value={t.lng ?? ''} onChange={set('lng')} inputMode="decimal" />
        <TextField label="Plan (as written)" value={t.plan ?? ''} onChange={set('plan')} />
        <SelectField label="Tap" value={t.tap ?? ''} onChange={(v) => setT((o) => ({ ...o, tap: v, port: '' }))} testId="tv-tap" options={[{ value: '', label: taps.length ? 'Choose…' : 'No tap recorded' }, ...taps.map((e) => ({ value: e.id, label: e.name }))]} />
        <SelectField label="Tap drop port" value={t.port ?? ''} onChange={set('port')} testId="tv-port" options={[{ value: '', label: 'Choose…' }, ...dropPorts.map((p) => ({ value: p.id, label: `${p.label}${used(p.id) ? ' (in use)' : ''}` }))]} />
        <SelectField label="At the customer" value={t.device ?? 'stb'} onChange={set('device')} testId="tv-device" options={[{ value: 'stb', label: 'Set top box' }, { value: 'cable_modem', label: 'Cable modem' }]} />
        <TextField label="Box serial (as on the label)" value={t.serial ?? ''} onChange={set('serial')} testId="tv-serial" />
        <TextField label="Box model" value={t.model ?? ''} onChange={set('model')} />
        <SelectField label="House wire coax type" value={t.coax ?? ''} onChange={set('coax')} testId="tv-coax" options={[{ value: '', label: 'Not recorded' }, ...RF_COAX_TYPES.map((c) => ({ value: c, label: c }))]} />
        <TextField label="House wire length (m)" value={t.length ?? ''} onChange={set('length')} testId="tv-length" inputMode="decimal" />
        <SelectField label="Length from" value={t.lengthSource ?? ''} onChange={set('lengthSource')} testId="tv-length-source" options={[{ value: '', label: 'Choose…' }, { value: 'sheath', label: 'Sheath marks' }, { value: 'drawn', label: 'Drawn on the map' }, { value: 'estimate', label: 'Estimate' }]} />
      </div>
      <div className="mt-3">
        <SubmitButton onClick={() => void save()} disabled={!ready} testId="tv-save">Add Cable TV customer</SubmitButton>
      </div>
    </section>
  );
}
