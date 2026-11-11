import { useState } from 'react';
import { ListChecks, Pencil, Plus, RotateCcw, X } from 'lucide-react';

import {
  type EffectiveSpec,
  effectiveSpecs,
  type Equipment,
  EQUIPMENT_CONDITION_LABELS,
  EQUIPMENT_CONDITIONS,
  EQUIPMENT_STATUSES,
  type EquipmentCondition,
  isProductModel,
  type SpecLine,
} from '@fibergis/shared';

import { Button, Field, Input, Select, Textarea } from '../../components/ui';
import { updateEquipment } from '../../stores/networkActions';
import { useNetworkStore } from '../../stores/networkStore';
import { showToast } from '../../stores/toastStore';
import { InspectorSection } from './sections';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

interface DetailsDraft {
  name: string;
  catalogModelId: string;
  manufacturer: string;
  model: string;
  serialNumber: string;
  tagCode: string;
  status: Equipment['status'];
  installedDate: string;
  area: string;
  street: string;
  notes: string;
  /** Phase 3. Empty: not recorded. */
  warrantyUntil: string;
  condition: '' | EquipmentCondition;
}

const draftOf = (e: Equipment): DetailsDraft => ({
  name: e.name,
  catalogModelId: e.catalogModelId ?? '',
  manufacturer: e.manufacturer ?? '',
  model: e.model ?? '',
  serialNumber: e.serialNumber ?? '',
  tagCode: e.tagCode ?? '',
  status: e.status,
  installedDate: e.installedDate ?? '',
  area: e.area ?? '',
  street: e.street ?? '',
  notes: e.notes ?? '',
  warrantyUntil: e.warrantyUntil ?? '',
  condition: e.condition ?? '',
});

/**
 * Phase 2: the general edit form for any piece of equipment. Choosing a catalogue model fills in
 * its make and model in the form, where the person sees them before saving. It never fills a serial,
 * a tag, a place or an install date. Blank fields are saved as not recorded.
 */
export function AssetEditForm({ equipment, onDone }: { equipment: Equipment; onDone: () => void }) {
  const catalog = useNetworkStore((s) => s.catalog);
  const models = catalog.filter(isProductModel);
  const [d, setD] = useState<DetailsDraft>(() => draftOf(equipment));
  const set = <K extends keyof DetailsDraft>(key: K, value: DetailsDraft[K]) => setD((prev) => ({ ...prev, [key]: value }));

  const chooseModel = (id: string) => {
    const model = models.find((m) => m.id === id);
    setD((prev) => ({ ...prev, catalogModelId: id, ...(model ? { manufacturer: model.manufacturer ?? '', model: model.model ?? '' } : {}) }));
  };

  const save = () => {
    if (!d.name.trim()) {
      showToast('error', 'Name needed', 'Give the item a name, such as "Box 12".');
      return;
    }
    if (d.installedDate && !ISO_DATE.test(d.installedDate)) {
      showToast('error', 'Install date not valid', 'Pick the date, or leave it empty if it is not known.');
      return;
    }
    if (d.warrantyUntil && !ISO_DATE.test(d.warrantyUntil)) {
      showToast('error', 'Warranty date not valid', 'Pick the last day of the warranty, or leave it empty if it is not known.');
      return;
    }
    const opt = (v: string) => (v.trim() ? v.trim() : undefined);
    const { catalogModelId: _m, manufacturer: _a, model: _b, serialNumber: _s, tagCode: _t, notes: _n, warrantyUntil: _w, condition: _c, ...rest } = equipment;
    const next: Equipment = {
      ...rest,
      name: d.name.trim(),
      status: d.status,
      installedDate: d.installedDate,
      area: d.area.trim(),
      street: d.street.trim(),
      ...(opt(d.catalogModelId) ? { catalogModelId: d.catalogModelId } : {}),
      ...(opt(d.manufacturer) ? { manufacturer: d.manufacturer.trim() } : {}),
      ...(opt(d.model) ? { model: d.model.trim() } : {}),
      ...(opt(d.serialNumber) ? { serialNumber: d.serialNumber.trim() } : {}),
      ...(opt(d.tagCode) ? { tagCode: d.tagCode.trim() } : {}),
      ...(opt(d.notes) ? { notes: d.notes.trim() } : {}),
      ...(d.warrantyUntil ? { warrantyUntil: d.warrantyUntil } : {}),
      ...(d.condition ? { condition: d.condition } : {}),
    };
    if (updateEquipment(next)) onDone();
  };

  return (
    <div className="space-y-2.5" data-testid="asset-edit-form">
      <Field label="Name" required>
        <Input value={d.name} onChange={(e) => set('name', e.target.value)} data-testid="asset-name" />
      </Field>
      <Field label="Catalogue model" hint={models.length === 0 ? 'No product models in the catalogue yet' : 'Fills in the make and model below'}>
        <Select value={d.catalogModelId} onChange={(e) => chooseModel(e.target.value)} data-testid="asset-model-pick">
          <option value="">None</option>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.manufacturer} {m.model} ({m.name})
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Manufacturer">
          <Input value={d.manufacturer} onChange={(e) => set('manufacturer', e.target.value)} placeholder="Not recorded" data-testid="asset-make" />
        </Field>
        <Field label="Model">
          <Input value={d.model} onChange={(e) => set('model', e.target.value)} placeholder="Not recorded" data-testid="asset-model" />
        </Field>
        <Field label="Serial number">
          <Input value={d.serialNumber} onChange={(e) => set('serialNumber', e.target.value)} placeholder="Not recorded" data-testid="asset-serial" />
        </Field>
        <Field label="Tag (QR or barcode)">
          <Input value={d.tagCode} onChange={(e) => set('tagCode', e.target.value)} placeholder="Not recorded" data-testid="asset-tag" />
        </Field>
        <Field label="Status">
          <Select value={d.status} onChange={(e) => set('status', e.target.value as Equipment['status'])}>
            {EQUIPMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Installed on" hint="Empty: not recorded">
          <Input type="date" value={d.installedDate} onChange={(e) => set('installedDate', e.target.value)} data-testid="asset-installed" />
        </Field>
        <Field label="Area">
          <Input value={d.area} onChange={(e) => set('area', e.target.value)} placeholder="Not recorded" />
        </Field>
        <Field label="Street">
          <Input value={d.street} onChange={(e) => set('street', e.target.value)} placeholder="Not recorded" />
        </Field>
        <Field label="Condition" hint="When someone last looked at it">
          <Select value={d.condition} onChange={(e) => set('condition', e.target.value as DetailsDraft['condition'])} data-testid="asset-condition">
            <option value="">Not recorded</option>
            {EQUIPMENT_CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {EQUIPMENT_CONDITION_LABELS[c]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Warranty until" hint="Empty: not recorded">
          <Input type="date" value={d.warrantyUntil} onChange={(e) => set('warrantyUntil', e.target.value)} data-testid="asset-warranty" />
        </Field>
      </div>
      <Field label="Notes">
        <Textarea value={d.notes} onChange={(e) => set('notes', e.target.value)} rows={2} />
      </Field>
      <p className="text-[11px] text-slate-500">The port count stays as recorded on this item. Change ports in the port manager.</p>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" onClick={save} data-testid="asset-save">
          Save details
        </Button>
      </div>
    </div>
  );
}

const ORIGIN_TEXT: Record<EffectiveSpec['origin'], string> = {
  model: 'From the model',
  changed: 'Changed for this item',
  item: 'This item only',
};

/**
 * The item's specs: its catalogue model's lines, plus what was changed or added for this one item.
 * Each line says where it came from, and a changed line shows the model's value beside it.
 */
export function AssetSpecsSection({ equipment }: { equipment: Equipment }) {
  const model = useNetworkStore((s) => (equipment.catalogModelId ? s.catalog.find((c) => c.id === equipment.catalogModelId) : undefined));
  const specs = effectiveSpecs(model, equipment);
  const [editing, setEditing] = useState<{ key: string; value: string; unit: string } | null>(null);

  const saveLine = (line: SpecLine) => {
    const others = (equipment.specOverrides ?? []).filter((s) => s.key.trim().toLowerCase() !== line.key.trim().toLowerCase());
    const next = [...others, { key: line.key.trim(), value: line.value.trim(), ...(line.unit?.trim() ? { unit: line.unit.trim() } : {}) }];
    if (updateEquipment({ ...equipment, specOverrides: next })) setEditing(null);
  };
  const resetLine = (key: string) => {
    const next = (equipment.specOverrides ?? []).filter((s) => s.key.trim().toLowerCase() !== key.trim().toLowerCase());
    const { specOverrides: _o, ...rest } = equipment;
    updateEquipment(next.length ? { ...equipment, specOverrides: next } : rest);
  };

  return (
    <InspectorSection title="Specs" icon={ListChecks} aside={specs.length ? String(specs.length) : undefined}>
      <div className="space-y-2 text-[12px]" data-testid="asset-specs">
        <p className="text-[11px] text-slate-500">
          {model
            ? `Model: ${model.manufacturer} ${model.model}${model.specSource ? `. Specs from ${model.specSource}` : '. Where its specs came from is not recorded'}.`
            : equipment.catalogModelId
              ? `The catalogue model ${equipment.catalogModelId} is not on this device.`
              : 'Not linked to a catalogue model. Choose one in Edit details, or add lines for this item.'}
        </p>
        {specs.length === 0 && <p className="text-slate-500">No specs recorded.</p>}
        {specs.map((s) => (
          <div key={s.key} className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5" data-testid="asset-spec-line">
            <div className="min-w-0 flex-1">
              <div className="text-slate-500">{s.key}</div>
              <div className="font-semibold text-slate-900">
                {s.value || 'Not recorded'}
                {s.unit ? ` ${s.unit}` : ''}
              </div>
              <div className={`text-[10px] ${s.origin === 'model' ? 'text-slate-400' : 'text-amber-700'}`} data-testid="asset-spec-origin">
                {ORIGIN_TEXT[s.origin]}
                {s.origin === 'changed' && s.modelValue ? ` (model says ${s.modelValue})` : ''}
              </div>
            </div>
            <button type="button" className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100" aria-label={`Change ${s.key} for this item`} onClick={() => setEditing({ key: s.key, value: s.value, unit: s.unit ?? '' })}>
              <Pencil className="h-3.5 w-3.5" />
            </button>
            {s.origin !== 'model' && (
              <button type="button" className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100" aria-label={s.origin === 'changed' ? `Use the model value for ${s.key}` : `Remove ${s.key}`} onClick={() => resetLine(s.key)}>
                {s.origin === 'changed' ? <RotateCcw className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
              </button>
            )}
          </div>
        ))}
        {editing ? (
          <div className="space-y-2 rounded-lg border border-blue-200 bg-blue-50/40 p-2" data-testid="asset-spec-edit">
            <Input value={editing.key} onChange={(e) => setEditing({ ...editing, key: e.target.value })} placeholder="What, e.g. Mounted on" data-testid="asset-spec-key" />
            <div className="flex gap-2">
              <Input value={editing.value} onChange={(e) => setEditing({ ...editing, value: e.target.value })} placeholder="Value" data-testid="asset-spec-value" />
              <Input value={editing.unit} onChange={(e) => setEditing({ ...editing, unit: e.target.value })} placeholder="Unit" className="max-w-24" />
            </div>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="primary"
                data-testid="asset-spec-save"
                onClick={() => {
                  if (!editing.key.trim()) {
                    showToast('error', 'Say what it is', 'Write what the spec is, such as "Mounted on".');
                    return;
                  }
                  saveLine({ key: editing.key, value: editing.value, unit: editing.unit });
                }}
              >
                Save for this item
              </Button>
            </div>
          </div>
        ) : (
          <Button size="sm" icon={Plus} onClick={() => setEditing({ key: '', value: '', unit: '' })} data-testid="asset-spec-add">
            Add a line for this item
          </Button>
        )}
      </div>
    </InspectorSection>
  );
}

/** The Details section: what is recorded, and the edit form behind one button. */
export function AssetDetailsSection({ equipment, children }: { equipment: Equipment; children: React.ReactNode }) {
  const [editing, setEditing] = useState(false);
  return (
    <InspectorSection title="Details" icon={Pencil}>
      {editing ? (
        <AssetEditForm equipment={equipment} onDone={() => setEditing(false)} />
      ) : (
        <div className="space-y-2">
          {children}
          <Button size="sm" icon={Pencil} onClick={() => setEditing(true)} data-testid="asset-edit">
            Edit details
          </Button>
        </div>
      )}
    </InspectorSection>
  );
}
