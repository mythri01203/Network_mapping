import { useState } from 'react';

import { findRfPort, portKey, RF_COAX_TYPES, RF_KIND_INFO, type RfLink } from '@fibergis/shared';

import { useNetworkStore } from '../../stores/networkStore';
import { addRfLink } from '../../stores/rfActions';
import { Field, SelectField, SubmitButton, TextField } from './RfFields';
import { numberOrUndefined } from './rfText';
import type { RfModel } from './useRfModel';

const WAVES = [1550, 1490, 1310] as const;

/** Record one link from an OUT port to an IN port. Nothing is linked because two items are near. */
export function RfLinkForm({ model }: { model: RfModel }) {
  const cables = useNetworkStore((s) => s.cables);
  const [t, setT] = useState<Record<string, string>>({});
  const [waves, setWaves] = useState<number[]>([1550]);
  const set = (key: string) => (v: string) => setT((old) => ({ ...old, [key]: v }));
  const items = model.data.rfElements;
  const fromEl = model.ix.elements.get(t.fromEl ?? '');
  const toEl = model.ix.elements.get(t.toEl ?? '');
  const fromPort = findRfPort(fromEl, t.fromPort ?? '');
  const medium = (t.medium as RfLink['medium']) || (fromPort?.signal === 'optical' ? 'fiber' : fromPort?.signal === 'power' ? 'power' : 'coax');
  const used = (id: string, port: string, dir: 'in' | 'out') => ((dir === 'out' ? model.ix.outOf : model.ix.into).get(portKey(id, port))?.length ?? 0) > 0;
  const fiberCables = cables.filter((c) => c.cableCategory !== 'Coaxial');
  const coaxCables = cables.filter((c) => c.cableCategory === 'Coaxial' || c.type === 'Coaxial Cable');

  const save = async () => {
    if (!fromEl || !toEl || !t.fromPort || !t.toPort) return;
    const made = await addRfLink({
      from: { elementId: fromEl.id, portId: t.fromPort },
      to: { elementId: toEl.id, portId: t.toPort },
      medium,
      coaxType: medium === 'coax' ? t.coaxType || undefined : undefined,
      lengthM: numberOrUndefined(t.length ?? ''),
      lengthSource: (t.lengthSource as RfLink['lengthSource']) || undefined,
      cableId: t.cable || undefined,
      fiberNumber: medium === 'fiber' ? numberOrUndefined(t.fiber ?? '') : undefined,
      wavelengthsNm: medium === 'fiber' ? waves : undefined,
    });
    if (made) setT({});
  };

  const itemOptions = [{ value: '', label: 'Choose…' }, ...items.map((e) => ({ value: e.id, label: `${e.name} (${RF_KIND_INFO[e.kind].label})` }))];
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4" data-testid="rf-link-form">
      <h4 className="mb-2 text-sm font-bold text-slate-800">Link two items</h4>
      <p className="mb-2 text-xs text-slate-600">Signal goes from an OUT port to an IN port. A port already in use is refused.</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SelectField label="From item" value={t.fromEl ?? ''} onChange={(v) => setT((o) => ({ ...o, fromEl: v, fromPort: '', medium: '' }))} options={itemOptions} testId="rf-link-from" />
        <SelectField label="From port (OUT)" value={t.fromPort ?? ''} onChange={(v) => setT((o) => ({ ...o, fromPort: v, medium: '' }))} testId="rf-link-from-port"
          options={[{ value: '', label: 'Choose…' }, ...(fromEl?.ports.filter((p) => p.direction === 'out') ?? []).map((p) => ({ value: p.id, label: `${p.label}${used(fromEl!.id, p.id, 'out') ? ' (in use)' : ''}` }))]} />
        <SelectField label="To item" value={t.toEl ?? ''} onChange={(v) => setT((o) => ({ ...o, toEl: v, toPort: '' }))} options={itemOptions} testId="rf-link-to" />
        <SelectField label="To port (IN)" value={t.toPort ?? ''} onChange={set('toPort')} testId="rf-link-to-port"
          options={[{ value: '', label: 'Choose…' }, ...(toEl?.ports.filter((p) => p.direction === 'in') ?? []).map((p) => ({ value: p.id, label: `${p.label}${used(toEl!.id, p.id, 'in') ? ' (fed)' : ''}` }))]} />
        <SelectField label="Joined by" value={medium} onChange={set('medium')} testId="rf-link-medium"
          options={[{ value: 'coax', label: 'Coax cable' }, { value: 'fiber', label: 'Fiber' }, { value: 'jumper', label: 'Short jumper (no loss counted)' }, { value: 'power', label: 'Power cable' }]} />
        {medium === 'coax' && <SelectField label="Coax type" value={t.coaxType ?? ''} onChange={set('coaxType')} testId="rf-link-coax" options={[{ value: '', label: 'Not recorded' }, ...RF_COAX_TYPES.map((c) => ({ value: c, label: c }))]} />}
        {(medium === 'coax' || medium === 'fiber') && <TextField label="Length (m)" value={t.length ?? ''} onChange={set('length')} testId="rf-link-length" inputMode="decimal" hint={medium === 'fiber' ? 'Blank: the drawn length of the cable chosen below.' : undefined} />}
        {(medium === 'coax' || medium === 'fiber') && <SelectField label="Length from" value={t.lengthSource ?? ''} onChange={set('lengthSource')} testId="rf-link-length-source" options={[{ value: '', label: 'Choose…' }, { value: 'sheath', label: 'Sheath marks' }, { value: 'drawn', label: 'Drawn on the map' }, { value: 'estimate', label: 'Estimate' }]} />}
        {(medium === 'coax' || medium === 'fiber') && (
          <SelectField label={medium === 'fiber' ? 'Fiber cable on the map' : 'Coax cable on the map'} value={t.cable ?? ''} onChange={set('cable')} testId="rf-link-cable"
            options={[{ value: '', label: 'Not drawn' }, ...(medium === 'fiber' ? fiberCables : coaxCables).map((c) => ({ value: c.id, label: `${c.name}${medium === 'fiber' ? ` (${c.fiberCount}F)` : ''}` }))]} />
        )}
        {medium === 'fiber' && <TextField label="Fiber number in that cable" value={t.fiber ?? ''} onChange={set('fiber')} testId="rf-link-fiber" inputMode="numeric" />}
        {medium === 'fiber' && (
          <Field label="Light on this fiber">
            <div className="flex gap-3 py-1">
              {WAVES.map((w) => (
                <label key={w} className="flex items-center gap-1 text-xs font-normal">
                  <input type="checkbox" checked={waves.includes(w)} onChange={(e) => setWaves((old) => (e.target.checked ? [...old, w] : old.filter((x) => x !== w)))} data-testid={`rf-link-wave-${w}`} />
                  {w} nm{w === 1550 ? ' (TV)' : ' (PON)'}
                </label>
              ))}
            </div>
          </Field>
        )}
      </div>
      <div className="mt-3">
        <SubmitButton onClick={() => void save()} disabled={!fromEl || !toEl || !t.fromPort || !t.toPort} testId="rf-link-save">Save link</SubmitButton>
      </div>
    </section>
  );
}
