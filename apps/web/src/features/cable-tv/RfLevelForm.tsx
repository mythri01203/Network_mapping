import { useState } from 'react';

import { findRfPort, RF_UNIT_LABELS, type RfLevelDraft, type RfLevelUnit } from '@fibergis/shared';

import { addRfLevel } from '../../stores/rfActions';
import { SelectField, SubmitButton, TextField } from './RfFields';
import { numberOrUndefined } from './rfText';
import type { RfModel } from './useRfModel';

/** Record one level exactly as read, with its unit. The unit is chosen first, so 60 dB is not lost. */
export function RfLevelForm({ model }: { model: RfModel }) {
  const [t, setT] = useState<Record<string, string>>({ origin: 'field_measured' });
  const set = (key: string) => (v: string) => setT((old) => ({ ...old, [key]: v }));
  const el = model.ix.elements.get(t.el ?? '');
  const port = findRfPort(el, t.port ?? '');
  const optical = port?.signal === 'optical';
  const unit: RfLevelUnit | '' = optical ? 'dBm' : ((t.unit as RfLevelUnit) || '');
  const value = numberOrUndefined(t.value ?? '');
  const ready = !!el && !!port && !!unit && value !== undefined;

  const save = async () => {
    if (!el || !port || !unit || value === undefined) return;
    const draft: RfLevelDraft = {
      elementId: el.id,
      portId: port.id,
      value,
      unit,
      origin: t.origin as RfLevelDraft['origin'],
      frequencyMhz: optical ? undefined : numberOrUndefined(t.freq ?? ''),
      testPointOffsetDb: numberOrUndefined(t.tp ?? ''),
      merDb: numberOrUndefined(t.mer ?? ''),
      technician: t.tech || undefined,
      instrument: t.meter || undefined,
      measuredAt: t.date ? new Date(t.date).toISOString() : undefined,
      source: t.source || undefined,
    };
    const made = await addRfLevel(draft);
    if (made) setT({ origin: t.origin ?? 'field_measured', el: t.el ?? '' });
  };

  const unitOptions = optical
    ? [{ value: 'dBm' as const, label: 'dBm' }]
    : [{ value: '' as const, label: 'Choose…' }, ...(['dBuV', 'dBmV', 'dBm'] as const).map((u) => ({ value: u, label: u === 'dBm' ? 'dBm (75 Ω)' : RF_UNIT_LABELS[u] }))];

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4" data-testid="rf-level-form">
      <h4 className="mb-2 text-sm font-bold text-slate-800">Record a level</h4>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SelectField label="Item" value={t.el ?? ''} onChange={(v) => setT((o) => ({ ...o, el: v, port: '' }))} testId="rf-level-item" options={[{ value: '', label: 'Choose…' }, ...model.data.rfElements.map((e) => ({ value: e.id, label: e.name }))]} />
        <SelectField label="Port read at" value={t.port ?? ''} onChange={set('port')} testId="rf-level-port" options={[{ value: '', label: 'Choose…' }, ...(el?.ports.filter((p) => p.signal !== 'power') ?? []).map((p) => ({ value: p.id, label: `${p.label} (${p.signal === 'optical' ? 'light' : 'TV signal'})` }))]} />
        <SelectField label="Unit on the meter" value={unit} onChange={set('unit')} testId="rf-level-unit" hint={optical ? 'Light is always dBm.' : 'dBµV = dBmV + 60.'} options={unitOptions} />
        <TextField label="Level as read" value={t.value ?? ''} onChange={set('value')} testId="rf-level-value" inputMode="decimal" />
        <SelectField label="Where it came from" value={t.origin ?? ''} onChange={set('origin')} testId="rf-level-origin"
          options={[{ value: 'field_measured', label: 'Measured with a meter' }, { value: 'designed', label: 'Designed (from the plan)' }, { value: 'device_reported', label: 'Shown by the device itself' }]} />
        {!optical && <TextField label="Frequency (MHz)" value={t.freq ?? ''} onChange={set('freq')} testId="rf-level-freq" inputMode="decimal" />}
        {!optical && <TextField label="Read at a test point (dB below the port)" value={t.tp ?? ''} onChange={set('tp')} testId="rf-level-tp" inputMode="decimal" hint="Such as 20 for a −20 dB test point. Blank: read on the port itself." />}
        {!optical && <TextField label="MER (dB)" value={t.mer ?? ''} onChange={set('mer')} inputMode="decimal" />}
        <TextField label="Read by" value={t.tech ?? ''} onChange={set('tech')} testId="rf-level-tech" />
        <TextField label="Meter" value={t.meter ?? ''} onChange={set('meter')} testId="rf-level-meter" />
        <TextField label="Date read (YYYY-MM-DD)" value={t.date ?? ''} onChange={set('date')} />
        <TextField label="Source (design sheet, device page)" value={t.source ?? ''} onChange={set('source')} testId="rf-level-source" />
      </div>
      <div className="mt-3">
        <SubmitButton onClick={() => void save()} disabled={!ready} testId="rf-level-save">Save level</SubmitButton>
      </div>
    </section>
  );
}
