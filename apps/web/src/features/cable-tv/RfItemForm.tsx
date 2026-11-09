import { useState } from 'react';

import { defaultRfPorts, RF_ELEMENT_KINDS, RF_KIND_INFO, type RfElementDraft, type RfElementKind } from '@fibergis/shared';

import { useNetworkStore } from '../../stores/networkStore';
import { addRfElement } from '../../stores/rfActions';
import { SelectField, SubmitButton, TextField } from './RfFields';
import { numberOrUndefined } from './rfText';
import type { RfModel } from './useRfModel';

const KINDS = RF_ELEMENT_KINDS.filter((k) => k !== 'stb' && k !== 'cable_modem');
const PASSIVE_LOSS_KINDS: RfElementKind[] = ['rf_splitter', 'directional_coupler', 'optical_splitter', 'wdm', 'power_inserter'];

type Text = Record<string, string>;

/** Add one Cable TV item. Every number is as entered; blank stays "not recorded". */
export function RfItemForm({ model }: { model: RfModel }) {
  const equipment = useNetworkStore((s) => s.equipment);
  const [kind, setKind] = useState<RfElementKind | ''>('');
  const [t, setT] = useState<Text>({});
  const set = (key: string) => (v: string) => setT((old) => ({ ...old, [key]: v }));
  const info = kind ? RF_KIND_INFO[kind] : undefined;
  const outputs = numberOrUndefined(t.outputs ?? '');
  const ports = kind ? defaultRfPorts(kind, { outputs, wdmRole: t.wdmRole === 'combine' ? 'combine' : 'separate' }) : [];
  const hint = model.rf.splitterHintDb;

  const save = async () => {
    if (!kind) return;
    const portLosses: Record<string, number | undefined> = {};
    for (const p of ports.filter((x) => x.direction === 'out')) portLosses[p.id] = numberOrUndefined(t[`loss_${p.id}`] ?? '');
    const draft: RfElementDraft = {
      kind,
      name: t.name,
      siteEquipmentId: t.site || undefined,
      outputs,
      wdmRole: kind === 'wdm' ? (t.wdmRole as 'combine' | 'separate' | undefined) || undefined : undefined,
      powered: t.powered === 'yes' ? true : t.powered === 'no' ? false : undefined,
      powerFeed: (t.powerFeed as RfElementDraft['powerFeed']) || undefined,
      edfaKind: (t.edfaKind as RfElementDraft['edfaKind']) || undefined,
      wavelengthNm: numberOrUndefined(t.wavelength ?? ''),
      gainDb: numberOrUndefined(t.gain ?? ''),
      tiltDb: numberOrUndefined(t.tilt ?? ''),
      ratedOutputDbuv: numberOrUndefined(t.rated ?? ''),
      ratedAtInputDbm: numberOrUndefined(t.ratedAt ?? ''),
      tapValueDb: numberOrUndefined(t.tapValue ?? ''),
      throughLossDb: numberOrUndefined(t.through ?? ''),
      portLosses: PASSIVE_LOSS_KINDS.includes(kind) ? portLosses : undefined,
      valuesSource: t.source,
      vendor: t.vendor,
      model: t.model,
      serialNumber: t.serial,
    };
    const made = await addRfElement(draft);
    if (made) setT({});
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4" data-testid="rf-item-form">
      <h4 className="mb-2 text-sm font-bold text-slate-800">Add a Cable TV item</h4>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <SelectField label="What is it?" value={kind} onChange={(v) => { setKind(v); setT({}); }} testId="rf-kind" options={[{ value: '', label: 'Choose…' }, ...KINDS.map((k) => ({ value: k, label: RF_KIND_INFO[k].plain }))]} />
        <TextField label="Name on the label" value={t.name ?? ''} onChange={set('name')} testId="rf-name" hint="Blank: a number is given, such as TAP-03." />
        <SelectField label="Placed at map pin" value={t.site ?? ''} onChange={set('site')} testId="rf-site" options={[{ value: '', label: 'Not placed at a pin' }, ...equipment.map((e) => ({ value: e.id, label: `${e.name} (${e.type})` }))]} />
        {info?.outputs && <TextField label={`Number of ${info.outputs.label} ports`} value={t.outputs ?? ''} onChange={set('outputs')} testId="rf-outputs" inputMode="numeric" hint={`Blank: ${info.outputs.defaultCount}. Fixed once saved.`} />}
        {kind === 'wdm' && <SelectField label="This WDM" value={t.wdmRole ?? ''} onChange={set('wdmRole')} testId="rf-wdm-role" options={[{ value: '', label: 'Choose…' }, { value: 'separate', label: 'Takes TV and PON light apart' }, { value: 'combine', label: 'Puts TV and PON light together' }]} />}
        {info?.power === 'ask' && <SelectField label="Powered or passive (required)" value={t.powered ?? ''} onChange={set('powered')} testId="rf-powered" options={[{ value: '', label: 'Choose…' }, { value: 'yes', label: 'Powered' }, { value: 'no', label: 'Passive (no power)' }]} />}
        {kind === 'rf_amplifier' && <SelectField label="Power comes from" value={t.powerFeed ?? ''} onChange={set('powerFeed')} testId="rf-power-feed" options={[{ value: '', label: 'Not recorded' }, { value: 'coax', label: 'Over the coax' }, { value: 'local', label: 'Local mains' }, { value: 'unknown', label: 'Not known' }]} />}
        {kind === 'edfa' && <SelectField label="EDFA kind (required)" value={t.edfaKind ?? ''} onChange={set('edfaKind')} testId="rf-edfa-kind" options={[{ value: '', label: 'Choose…' }, { value: 'plain', label: 'Plain CATV EDFA' }, { value: 'wdm', label: 'WDM EDFA with PON pass port' }]} />}
        {kind === 'optical_transmitter' && <TextField label="Wavelength (nm)" value={t.wavelength ?? ''} onChange={set('wavelength')} testId="rf-wavelength" inputMode="numeric" />}
        {kind === 'rf_amplifier' && <TextField label="Forward gain at the high frequency (dB)" value={t.gain ?? ''} onChange={set('gain')} testId="rf-gain" inputMode="decimal" hint={`As set on site or in the design. High frequency: ${model.rf.highMhz} MHz.`} />}
        {(kind === 'rf_amplifier' || kind === 'optical_node' || kind === 'mini_node') && <TextField label="Tilt (dB)" value={t.tilt ?? ''} onChange={set('tilt')} testId="rf-tilt" inputMode="decimal" hint="Output at the high frequency minus output at the low frequency." />}
        {(kind === 'optical_node' || kind === 'mini_node') && <TextField label="Rated RF output (dBµV)" value={t.rated ?? ''} onChange={set('rated')} testId="rf-rated" inputMode="decimal" hint="From the datasheet, such as 80 dBµV at −8 dBm." />}
        {(kind === 'optical_node' || kind === 'mini_node') && <TextField label="…at optical input (dBm)" value={t.ratedAt ?? ''} onChange={set('ratedAt')} testId="rf-rated-at" inputMode="decimal" />}
        {kind === 'tap' && <TextField label="Tap value on every drop port (dB)" value={t.tapValue ?? ''} onChange={set('tapValue')} testId="rf-tap-value" inputMode="decimal" hint="Printed on the tap, such as 20." />}
        {kind === 'tap' && <TextField label="Through loss to OUT (dB)" value={t.through ?? ''} onChange={set('through')} testId="rf-through" inputMode="decimal" hint="From the tap datasheet. Through loss falls as the tap value rises." />}
        {kind && PASSIVE_LOSS_KINDS.includes(kind) && ports.filter((p) => p.direction === 'out').map((p) => (
          <TextField key={p.id} label={`Loss to ${p.label} (dB)`} value={t[`loss_${p.id}`] ?? ''} onChange={set(`loss_${p.id}`)} testId={`rf-loss-${p.id}`} inputMode="decimal" hint={kind === 'rf_splitter' ? `Typical (rule of thumb, proposed): 2-way ${hint.two}, 4-way ${hint.four}, 8-way ${hint.eight} dB. Enter the part's own value.` : undefined} />
        ))}
        {kind && <TextField label="Where these values came from" value={t.source ?? ''} onChange={set('source')} testId="rf-source" hint="Datasheet, design sheet, set on site." />}
        {kind && <TextField label="Maker" value={t.vendor ?? ''} onChange={set('vendor')} />}
        {kind && <TextField label="Model" value={t.model ?? ''} onChange={set('model')} />}
        {kind && <TextField label="Serial number (as on the label)" value={t.serial ?? ''} onChange={set('serial')} />}
      </div>
      <div className="mt-3">
        <SubmitButton onClick={() => void save()} disabled={!kind} testId="rf-item-save">Save item</SubmitButton>
      </div>
    </section>
  );
}
