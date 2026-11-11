import { useMemo, useState } from 'react';
import { Filter, FolderOpen, Hexagon, Trash2 } from 'lucide-react';

import { FILTER_OPERATOR_LABELS, FILTER_OPERATORS, type FilterOperator, VALUELESS_OPERATORS } from '@fibergis/shared';

import { Button, Modal } from '../../components/ui';
import { getNetworkSnapshot, useNetworkStore } from '../../stores/networkStore';
import { useSelectionStore } from '../../stores/selectionStore';
import { showToast } from '../../stores/toastStore';
import { layerById, TABLE_LAYERS, tableContext } from '../table/tableLayers';
import { layerRows, queryRows } from '../table/tableModel';
import { loadSelection, saveCurrentSelection, selectInZone, selectionOwnerId } from './selectionActions';
import { COLLECTION_WORDS, keyOf, type SelectableCollection } from './selectionModel';

/** Phase 16: choose by a value, everything in a zone, and saved selections. */

const field = 'h-12 w-full rounded-lg border border-slate-300 bg-white px-3 text-[14px] md:h-10 md:text-[13px]';
const label = 'mb-1 block text-[13px] font-semibold text-slate-700';

export function SelectionDialogs() {
  const dialog = useSelectionStore((s) => s.dialog);
  const close = () => useSelectionStore.getState().setDialog(null);
  if (dialog === 'attribute') return <ByAttributeDialog onClose={close} />;
  if (dialog === 'zone') return <ZoneDialog onClose={close} />;
  if (dialog === 'saved') return <SavedDialog onClose={close} />;
  return null;
}

function ByAttributeDialog({ onClose }: { onClose: () => void }) {
  const [layerId, setLayerId] = useState(TABLE_LAYERS[0].id);
  const layer = layerById(layerId);
  const [fieldKey, setFieldKey] = useState(layer.columns[1]?.key ?? 'id');
  const [operator, setOperator] = useState<FilterOperator>('equals');
  const [value, setValue] = useState('');
  const [add, setAdd] = useState(false);
  // The count follows edits to this kind of record.
  const source = useNetworkStore((s) => s[layer.collection]);
  const column = layer.columns.find((c) => c.key === fieldKey) ?? layer.columns[0];
  const matches = useMemo(() => {
    const data = getNetworkSnapshot();
    return queryRows(layer, layerRows(layer, data), tableContext(data), { conditions: [{ field: column.key, operator, value }] });
  }, [layer, column, operator, value, source]);
  const valueless = VALUELESS_OPERATORS.has(operator);
  const ready = valueless || value.trim() !== '';
  return (
    <Modal
      open
      onClose={onClose}
      title="Choose by a value"
      icon={Filter}
      size="md"
      description="For example: Status is Faulty, or Owner is not recorded."
      footer={
        <>
          <Button size="lg" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="lg"
            variant="primary"
            disabled={!ready}
            data-testid="attr-select"
            onClick={() => {
              const keys = [...new Set(matches.map((r) => keyOf(layer.collection, layer.recordId(r))))];
              useSelectionStore.getState().setKeys(keys, add ? 'add' : 'replace');
              showToast(keys.length ? 'success' : 'info', keys.length ? `${keys.length.toLocaleString()} chosen` : 'Nothing matches', `${layer.label}: ${column.label} ${FILTER_OPERATOR_LABELS[operator]}${valueless ? '' : ` "${value}"`}.`);
              onClose();
            }}
          >
            Choose {ready ? matches.length.toLocaleString() : ''} {COLLECTION_WORDS[layer.collection as SelectableCollection].many}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className={label} htmlFor="attr-layer">Which items</label>
          <select id="attr-layer" className={field} value={layerId} onChange={(e) => { setLayerId(e.target.value); setFieldKey(layerById(e.target.value).columns[1]?.key ?? 'id'); setValue(''); }}>
            {TABLE_LAYERS.map((l) => (
              <option key={l.id} value={l.id}>{l.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="attr-field">Field</label>
          <select id="attr-field" className={field} value={column.key} onChange={(e) => { setFieldKey(e.target.value); setValue(''); }}>
            {layer.columns.map((c) => (
              <option key={c.key} value={c.key}>{c.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="attr-op">Is</label>
          <select id="attr-op" className={field} value={operator} onChange={(e) => setOperator(e.target.value as FilterOperator)}>
            {FILTER_OPERATORS.map((o) => (
              <option key={o} value={o}>{FILTER_OPERATOR_LABELS[o]}</option>
            ))}
          </select>
        </div>
        {!valueless && (
          <div>
            <label className={label} htmlFor="attr-value">Value</label>
            {column.options ? (
              <select id="attr-value" className={field} value={value} onChange={(e) => setValue(e.target.value)}>
                <option value="">Choose…</option>
                {column.options.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            ) : (
              <input id="attr-value" className={field} value={value} onChange={(e) => setValue(e.target.value)} inputMode={column.type === 'number' ? 'decimal' : 'text'} placeholder={column.type === 'date' ? '2026-11-10' : ''} />
            )}
          </div>
        )}
        <label className="flex min-h-[48px] items-center gap-3 text-[14px] text-slate-700">
          <input type="checkbox" className="h-5 w-5" checked={add} onChange={(e) => setAdd(e.target.checked)} />
          Add to what is chosen now (instead of replacing it)
        </label>
      </div>
    </Modal>
  );
}

const ZONE_KINDS: SelectableCollection[] = ['equipment', 'cables', 'customers', 'closures', 'splitters', 'ducts', 'spans', 'slackLoops', 'faults', 'buildings'];

function ZoneDialog({ onClose }: { onClose: () => void }) {
  const zones = useNetworkStore((s) => s.zones);
  const [zoneId, setZoneId] = useState(zones[0]?.id ?? '');
  const [kinds, setKinds] = useState<SelectableCollection[]>(ZONE_KINDS);
  const [add, setAdd] = useState(false);
  const zone = zones.find((z) => z.id === zoneId);
  return (
    <Modal
      open
      onClose={onClose}
      title="Everything in a zone"
      icon={Hexagon}
      size="md"
      description="Items drawn inside the zone's boundary, or crossing it. Items with no place on the map are not included."
      footer={
        <>
          <Button size="lg" onClick={onClose}>Cancel</Button>
          <Button size="lg" variant="primary" disabled={!zone || kinds.length === 0} onClick={() => { selectInZone(zoneId, add ? 'add' : 'replace', kinds); onClose(); }}>
            Choose
          </Button>
        </>
      }
    >
      {zones.length === 0 ? (
        <p className="text-[14px] text-slate-600">No zones are recorded yet. Add one in Zones, or draw an area with "Draw an area (tap the corners)".</p>
      ) : (
        <div className="space-y-3">
          <div>
            <label className={label} htmlFor="zone-pick">Zone</label>
            <select id="zone-pick" className={field} value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
              {zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                  {z.boundaryCoords.length < 3 ? ' (no boundary drawn)' : ''}
                </option>
              ))}
            </select>
          </div>
          <fieldset>
            <legend className={label}>Kinds of item</legend>
            <div className="grid grid-cols-2 gap-1">
              {ZONE_KINDS.map((k) => (
                <label key={k} className="flex min-h-[48px] items-center gap-2 text-[14px] text-slate-700 md:min-h-9">
                  <input type="checkbox" className="h-5 w-5" checked={kinds.includes(k)} onChange={(e) => setKinds((prev) => (e.target.checked ? [...prev, k] : prev.filter((x) => x !== k)))} />
                  <span className="capitalize">{COLLECTION_WORDS[k].many}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="flex min-h-[48px] items-center gap-3 text-[14px] text-slate-700">
            <input type="checkbox" className="h-5 w-5" checked={add} onChange={(e) => setAdd(e.target.checked)} />
            Add to what is chosen now
          </label>
        </div>
      )}
    </Modal>
  );
}

function SavedDialog({ onClose }: { onClose: () => void }) {
  const owner = selectionOwnerId();
  const saved = useSelectionStore((s) => s.savedSelections).filter((x) => x.ownerId === owner);
  const count = useSelectionStore((s) => s.keys.size);
  const [name, setName] = useState('');
  return (
    <Modal open onClose={onClose} title="Saved selections" icon={FolderOpen} size="md" description="Kept on this device only, for you. Other people and other devices do not see them.">
      <div className="space-y-4">
        <div>
          <label className={label} htmlFor="save-name">Save what is chosen now ({count.toLocaleString()})</label>
          <div className="flex gap-2">
            <input id="save-name" className={field} value={name} maxLength={80} placeholder="Name, such as Ward 4 poles" onChange={(e) => setName(e.target.value)} />
            <Button size="lg" variant="primary" className="h-12 md:h-10" disabled={count === 0 || !name.trim()} onClick={() => { if (saveCurrentSelection(name)) setName(''); }}>
              Save
            </Button>
          </div>
        </div>
        {saved.length === 0 ? (
          <p className="text-[14px] text-slate-500">Nothing saved yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {saved.map((s) => (
              <li key={s.id} className="flex items-center gap-2 px-3 py-1.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium text-slate-900">{s.name}</span>
                  <span className="text-[12px] text-slate-500">{s.keys.length.toLocaleString()} item(s) · {new Date(s.createdAt).toLocaleString()}</span>
                </span>
                <Button size="lg" className="h-12 md:h-9" onClick={() => { loadSelection(s); onClose(); }}>Choose these</Button>
                <button type="button" aria-label={`Delete ${s.name}`} className="flex h-12 w-12 items-center justify-center rounded-lg text-rose-600 hover:bg-rose-50 md:h-9 md:w-9" onClick={() => useSelectionStore.getState().deleteSelection(s.id)}>
                  <Trash2 size={18} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
