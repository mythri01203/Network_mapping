import React, { useMemo, useState } from 'react';
import { GripVertical, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import {
  type CatalogComponent,
  catalogModelUsers,
  EQUIPMENT_CATEGORIES,
  EQUIPMENT_TYPES_BY_CATEGORY,
  type EquipmentCategory,
  type EquipmentType,
  isProductModel,
  newRecordId,
  type SpecLine,
} from '@fibergis/shared';

import { EquipmentIllustration } from '../../components/icons/EquipmentIllustration';
import { EQUIPMENT_DRAG_TYPE } from '../../lib/browser';
import { useMapStore } from '../../stores/mapStore';
import { addCatalogComponent, removeCatalogComponent } from '../../stores/networkActions';
import { useNetworkStore } from '../../stores/networkStore';
import { useToastStore } from '../../stores/toastStore';
import { useUiStore } from '../../stores/uiStore';
import { placementTemplate } from '../map/placement';
import { BUILT_IN_COMPONENTS } from './componentCatalog';

const CATEGORIES = ['All', ...EQUIPMENT_CATEGORIES];

const LIFECYCLE_LABELS: Record<NonNullable<CatalogComponent['lifecycle']>, string> = {
  active: 'In production',
  end_of_sale: 'No longer sold',
  end_of_life: 'No longer supported',
};

const input = 'w-full min-h-9 px-2 py-1.5 border border-slate-200 rounded-lg text-xs bg-white';
const label = 'block text-[10px] font-bold text-slate-600 mb-1';

interface Draft {
  id?: string;
  name: string;
  type: string;
  category: EquipmentCategory;
  manufacturer: string;
  model: string;
  productCode: string;
  ports: string;
  connectorType: string;
  lifecycle: '' | NonNullable<CatalogComponent['lifecycle']>;
  specs: SpecLine[];
  specSource: string;
  datasheetDocumentId: string;
  description: string;
}

const EMPTY: Draft = {
  name: '',
  type: 'FAT',
  category: 'Fiber Distribution',
  manufacturer: '',
  model: '',
  productCode: '',
  ports: '',
  connectorType: '',
  lifecycle: '',
  specs: [],
  specSource: '',
  datasheetDocumentId: '',
  description: '',
};

const toDraft = (c: CatalogComponent): Draft => ({
  id: c.id,
  name: c.name,
  type: String(c.type),
  category: (EQUIPMENT_CATEGORIES as readonly string[]).includes(c.category) ? (c.category as EquipmentCategory) : 'Fiber Distribution',
  manufacturer: c.manufacturer ?? '',
  model: c.model ?? '',
  productCode: c.productCode ?? '',
  ports: c.defaultPorts !== undefined ? String(c.defaultPorts) : '',
  connectorType: c.connectorType ?? '',
  lifecycle: c.lifecycle ?? '',
  specs: c.specs ?? [],
  specSource: c.specSource ?? '',
  datasheetDocumentId: c.datasheetDocumentId ?? '',
  description: c.description,
});

/** Only what was given. A blank field stays absent: "not recorded", never a default. */
function fromDraft(d: Draft, existing: CatalogComponent | undefined): CatalogComponent {
  const opt = (v: string) => (v.trim() ? v.trim() : undefined);
  const now = new Date().toISOString();
  const entry: CatalogComponent = {
    id: d.id ?? newRecordId('CAT-'),
    type: d.type.trim(),
    category: d.category,
    name: d.name.trim(),
    description: d.description.trim(),
    iconBg: existing?.iconBg ?? 'bg-blue-700',
    isCustom: true,
    manufacturer: opt(d.manufacturer),
    model: opt(d.model),
    productCode: opt(d.productCode),
    defaultPorts: d.ports.trim() === '' ? undefined : Number(d.ports),
    connectorType: opt(d.connectorType),
    lifecycle: d.lifecycle || undefined,
    specs: d.specs.filter((s) => s.key.trim()).map((s) => ({ key: s.key.trim(), value: s.value.trim(), ...(s.unit?.trim() ? { unit: s.unit.trim() } : {}) })),
    specSource: opt(d.specSource),
    datasheetDocumentId: opt(d.datasheetDocumentId),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  // Drop absent keys so the record holds only what is known.
  return Object.fromEntries(Object.entries(entry).filter(([, v]) => v !== undefined && !(Array.isArray(v) && v.length === 0))) as CatalogComponent;
}

function ModelForm({ draft, setDraft, onSave, onCancel }: { draft: Draft; setDraft: (d: Draft) => void; onSave: () => void; onCancel: () => void }) {
  const documents = useNetworkStore((s) => s.documents);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft({ ...draft, [key]: value });
  const types = EQUIPMENT_TYPES_BY_CATEGORY[draft.category] as readonly string[];
  return (
    <div className="space-y-3 rounded-xl border border-blue-100 bg-blue-50/40 p-3 text-xs" data-testid="catalog-form">
      <div className="font-bold text-blue-900">{draft.id ? 'Change catalogue entry' : 'Add to the catalogue'}</div>
      <p className="text-[11px] text-slate-600">
        With a manufacturer and model it is a <strong>product model</strong>: items placed from it take its make, model, ports and specs. Leave both empty for a plain kind of equipment. Blank fields are saved as not recorded.
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="sm:col-span-3">
          <label className={label}>Name shown in the catalogue *</label>
          <input className={input} value={draft.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Acme 16-port FAT" data-testid="cat-name" />
        </div>
        <div>
          <label className={label}>Group</label>
          <select className={input} value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value as EquipmentCategory, type: (EQUIPMENT_TYPES_BY_CATEGORY[e.target.value as EquipmentCategory] as readonly string[])[0] })}>
            {EQUIPMENT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={label}>Kind *</label>
          <input className={input} list="catalog-kinds" value={draft.type} onChange={(e) => set('type', e.target.value)} data-testid="cat-type" />
          <datalist id="catalog-kinds">
            {types.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </div>
        <div>
          <label className={label}>Ports</label>
          <input className={input} inputMode="numeric" value={draft.ports} onChange={(e) => set('ports', e.target.value.replace(/[^0-9]/g, ''))} placeholder="Not recorded" data-testid="cat-ports" />
        </div>
        <div>
          <label className={label}>Manufacturer</label>
          <input className={input} value={draft.manufacturer} onChange={(e) => set('manufacturer', e.target.value)} data-testid="cat-make" />
        </div>
        <div>
          <label className={label}>Model</label>
          <input className={input} value={draft.model} onChange={(e) => set('model', e.target.value)} data-testid="cat-model" />
        </div>
        <div>
          <label className={label}>Product code</label>
          <input className={input} value={draft.productCode} onChange={(e) => set('productCode', e.target.value)} />
        </div>
        <div>
          <label className={label}>Connector</label>
          <input className={input} value={draft.connectorType} onChange={(e) => set('connectorType', e.target.value)} placeholder="e.g. SC/APC" />
        </div>
        <div>
          <label className={label}>Lifecycle</label>
          <select className={input} value={draft.lifecycle} onChange={(e) => set('lifecycle', e.target.value as Draft['lifecycle'])}>
            <option value="">Not recorded</option>
            {Object.entries(LIFECYCLE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={label}>Datasheet</label>
          <select className={input} value={draft.datasheetDocumentId} onChange={(e) => set('datasheetDocumentId', e.target.value)}>
            <option value="">None linked</option>
            {documents.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-1.5">
        <div className={label}>Specs (one line each: what, value, unit)</div>
        {draft.specs.map((s, i) => (
          <div key={i} className="flex gap-1.5" data-testid="cat-spec-row">
            <input className={input} value={s.key} placeholder="e.g. Operating temperature" onChange={(e) => set('specs', draft.specs.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))} />
            <input className={input} value={s.value} placeholder="e.g. -40 to 85" onChange={(e) => set('specs', draft.specs.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
            <input className={`${input} max-w-20`} value={s.unit ?? ''} placeholder="Unit" onChange={(e) => set('specs', draft.specs.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)))} />
            <button type="button" className="min-h-9 shrink-0 rounded-lg px-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Remove this spec" onClick={() => set('specs', draft.specs.filter((_, j) => j !== i))}>
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        <button type="button" className="flex min-h-9 items-center gap-1 rounded-lg px-2 font-semibold text-blue-700 hover:bg-blue-50" onClick={() => set('specs', [...draft.specs, { key: '', value: '' }])} data-testid="cat-add-spec">
          <Plus className="h-3.5 w-3.5" /> Add a spec line
        </button>
        <div>
          <label className={label}>Where the specs came from</label>
          <input className={input} value={draft.specSource} onChange={(e) => set('specSource', e.target.value)} placeholder="e.g. Datasheet rev 3, March 2025" data-testid="cat-spec-source" />
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="min-h-9 rounded-lg px-3 font-semibold text-slate-600 hover:bg-slate-200/50">
          Cancel
        </button>
        <button type="button" onClick={onSave} className="min-h-9 rounded-lg bg-blue-600 px-4 font-semibold text-white hover:bg-blue-500" data-testid="cat-save">
          Save
        </button>
      </div>
    </div>
  );
}

function ProductModels() {
  const catalog = useNetworkStore((s) => s.catalog);
  const equipment = useNetworkStore((s) => s.equipment);
  const [draft, setDraft] = useState<Draft | null>(null);

  const save = () => {
    if (!draft) return;
    const existing = catalog.find((c) => c.id === draft.id);
    if (draft.ports.trim() !== '' && !Number.isFinite(Number(draft.ports))) return;
    if (addCatalogComponent(fromDraft(draft, existing))) setDraft(null);
  };

  return (
    <div className="space-y-3 p-4">
      {draft ? (
        <ModelForm draft={draft} setDraft={setDraft} onSave={save} onCancel={() => setDraft(null)} />
      ) : (
        <button type="button" onClick={() => setDraft({ ...EMPTY })} className="flex min-h-10 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-500" data-testid="cat-new">
          <Plus className="h-4 w-4" /> Add to the catalogue
        </button>
      )}
      {catalog.length === 0 ? (
        <p className="text-xs text-slate-500">Nothing added yet. The built-in kinds are on the "Place on map" tab.</p>
      ) : (
        <div className="space-y-2">
          {catalog.map((c) => {
            const users = catalogModelUsers(equipment, c.id).length;
            return (
              <div key={c.id} className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3" data-testid="catalog-entry">
                <EquipmentIllustration type={String(c.type)} size={36} className="shrink-0" />
                <div className="min-w-0 flex-1 text-[11px] text-slate-600">
                  <div className="text-xs font-semibold text-slate-800">{c.name}</div>
                  <div>
                    {isProductModel(c) ? `${c.manufacturer} ${c.model}` : 'Plain kind (no make or model)'}
                    {c.productCode ? ` · code ${c.productCode}` : ''} · {c.type}
                  </div>
                  <div>
                    Ports: {c.defaultPorts ?? 'not recorded'} · Connector: {c.connectorType ?? 'not recorded'} · {c.lifecycle ? LIFECYCLE_LABELS[c.lifecycle] : 'Lifecycle not recorded'}
                  </div>
                  <div>
                    {(c.specs ?? []).length} spec line(s){c.specSource ? ` from ${c.specSource}` : (c.specs ?? []).length ? ', source not recorded' : ''} · {users} item(s) on the map
                  </div>
                </div>
                <button type="button" className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100" aria-label={`Change ${c.name}`} onClick={() => setDraft(toDraft(c))}>
                  <Pencil className="h-4 w-4" />
                </button>
                <button type="button" className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label={`Remove ${c.name}`} onClick={() => removeCatalogComponent(c.id)}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export const ComponentCatalogModal: React.FC = () => {
  const { isComponentCatalogOpen, setModalOpen } = useUiStore(
    useShallow((s) => ({ isComponentCatalogOpen: s.modals.componentCatalog, setModalOpen: s.setModalOpen })),
  );
  const customComponents = useNetworkStore((s) => s.catalog);
  const { setSelectedEquipmentTypeToAdd, setActiveTool, setEquipmentDraftTemplate } = useMapStore(
    useShallow((s) => ({ setSelectedEquipmentTypeToAdd: s.setEquipmentTypeToAdd, setActiveTool: s.setActiveTool, setEquipmentDraftTemplate: s.setEquipmentDraftTemplate })),
  );
  const showToast = useToastStore((s) => s.show);

  const [tab, setTab] = useState<'place' | 'models'>('place');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');

  const items = useMemo(() => {
    const all = [...BUILT_IN_COMPONENTS, ...customComponents];
    const q = query.toLowerCase();
    return all.filter((item) => {
      const matchesCat = category === 'All' || item.category === category;
      const text = [item.name, item.description, String(item.type), item.manufacturer, item.model, item.productCode].filter(Boolean).join(' ').toLowerCase();
      return matchesCat && text.includes(q);
    });
  }, [customComponents, category, query]);

  if (!isComponentCatalogOpen) return null;

  // Phase 2: places with what the entry is (its ports, and for a model its make, model and link).
  const place = (item: CatalogComponent) => {
    setSelectedEquipmentTypeToAdd(String(item.type) as EquipmentType);
    setEquipmentDraftTemplate(placementTemplate(item));
    setActiveTool('add_equipment');
    setModalOpen('componentCatalog', false);
    showToast('info', 'Tap the map to place it', `Tap the place for ${item.name}.`);
  };

  const handleDragStart = (e: React.DragEvent, item: CatalogComponent) => {
    e.dataTransfer.setData(EQUIPMENT_DRAG_TYPE, String(item.type));
    e.dataTransfer.setData('text/plain', JSON.stringify({ type: item.type, ...placementTemplate(item) }));
    e.dataTransfer.effectAllowed = 'copy';
  };

  const tabBtn = (id: 'place' | 'models', text: string) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      aria-pressed={tab === id}
      className={`min-h-9 rounded-lg px-3 text-xs font-semibold ${tab === id ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
      data-testid={`catalog-tab-${id}`}
    >
      {text}
    </button>
  );

  return (
    <div className="modal-sheet fixed inset-0 z-[1100] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3 bg-slate-50/80">
          <div className="min-w-0">
            <h2 className="font-bold text-sm text-slate-900">Equipment catalogue</h2>
            <p className="text-[11px] text-slate-500">Place equipment on the map, or keep the product models you use.</p>
          </div>
          <button onClick={() => setModalOpen('componentCatalog', false)} className="p-1 text-slate-400 hover:text-slate-700 rounded-lg" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex gap-2 border-b border-slate-100 px-4 py-2">
          {tabBtn('place', 'Place on map')}
          {tabBtn('models', `Product models and kinds (${customComponents.length})`)}
        </div>

        {tab === 'models' ? (
          <div className="flex-1 overflow-y-auto">
            <ProductModels />
          </div>
        ) : (
          <>
            <div className="p-4 border-b border-slate-100 space-y-3">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by name, kind, make, model or code..."
                  className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:border-blue-500"
                />
              </div>
              <div className="flex gap-1.5 overflow-x-auto">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setCategory(cat)}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap ${category === cat ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}
                  >
                    {cat === 'Supporting Infrastructure' ? 'Infrastructure' : cat.replace(' Infrastructure', '')}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
              {items.map((item) => (
                <div
                  key={item.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, item)}
                  onClick={() => place(item)}
                  className="p-3 rounded-xl border border-slate-200 hover:border-blue-300 hover:bg-blue-50/40 cursor-pointer flex items-center gap-3"
                  data-testid="catalog-place-item"
                >
                  <EquipmentIllustration type={String(item.type)} size={40} className="shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-xs text-slate-800 truncate">{item.name}</div>
                    <div className="text-[11px] text-slate-500 line-clamp-2">{isProductModel(item) ? `${item.manufacturer} ${item.model}` : item.description}</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">
                      {item.category}
                      {item.defaultPorts ? ` · ${item.defaultPorts} ports` : ''}
                      {isProductModel(item) ? ' · Product model' : item.isCustom ? ' · Custom kind' : ''}
                    </div>
                  </div>
                  <GripVertical className="w-4 h-4 text-slate-300" />
                </div>
              ))}
              {items.length === 0 && <div className="col-span-2 text-center text-sm text-slate-500 py-10">Nothing matches this search.</div>}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
