import { useMemo, useState } from 'react';
import { PencilLine, TriangleAlert } from 'lucide-react';

import { type BulkFieldEdit, isBulkEditable } from '@fibergis/shared';

import { Button, Modal } from '../../components/ui';
import { getNetworkSnapshot } from '../../stores/networkStore';
import { showToast } from '../../stores/toastStore';
import { focusKey } from '../selection/selectionActions';
import { COLLECTION_WORDS, keyOf } from '../selection/selectionModel';
import { saveBulkEdit } from './bulkEditService';
import { tableContext,type TableLayer } from './tableLayers';
import { showCell } from './tableModel';

const field = 'h-12 w-full rounded-lg border border-slate-300 bg-white px-3 text-[14px] md:h-10 md:text-[13px]';
const label = 'mb-1 block text-[13px] font-semibold text-slate-700';

/**
 * Phase 16: change one field on every chosen item of a layer. Shows what will change first, then
 * sends it to the server as one change set: all saved, or nothing saved with the reason and item.
 */
export function BulkEditDialog({ layer, ids, onClose }: { layer: TableLayer<unknown>; ids: string[]; onClose: () => void }) {
  const editable = useMemo(() => layer.columns.filter((c) => c.edit && isBulkEditable(layer.collection, c.edit.field)), [layer]);
  const [columnKey, setColumnKey] = useState(editable[0]?.key ?? '');
  const column = editable.find((c) => c.key === columnKey);
  const [value, setValue] = useState('');
  const [clearIt, setClearIt] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refusal, setRefusal] = useState<{ message: string; recordId?: string } | null>(null);
  const words = COLLECTION_WORDS[layer.collection];

  const typed: BulkFieldEdit['value'] | null = useMemo(() => {
    if (!column?.edit) return null;
    if (clearIt) return undefined;
    const v = value.trim();
    if (!v) return null;
    if (column.type === 'number') {
      if (!/^-?\d+(\.\d+)?$/.test(v)) return null;
      return Number(v);
    }
    if (column.type === 'date' && !/^\d{4}-\d{2}-\d{2}/.test(v)) return null;
    return v;
  }, [column, value, clearIt]);

  const preview = useMemo(() => {
    if (!column?.edit) return [];
    const data = getNetworkSnapshot();
    const ctx = tableContext(data);
    const byId = new Map((data[layer.collection] as { id: string; name?: string }[]).map((r) => [r.id, r]));
    return ids.slice(0, 5).map((id) => {
      const r = byId.get(id);
      return { id, name: r?.name ?? id, now: r ? showCell(column.get(r, ctx)) : 'Not on record' };
    });
  }, [column, ids, layer.collection]);

  if (editable.length === 0) {
    return (
      <Modal open onClose={onClose} title="Nothing here can be changed together" icon={PencilLine} size="sm">
        <p className="text-[14px] text-slate-600">{layer.note ?? 'Open each item to change it.'}</p>
      </Modal>
    );
  }

  const save = async () => {
    if (!column?.edit || typed === null) return;
    setSaving(true);
    setRefusal(null);
    const outcome = await saveBulkEdit(layer.collection, ids, [{ field: column.edit.field, value: typed }]);
    setSaving(false);
    if (!outcome.ok) {
      setRefusal({ message: outcome.message, recordId: outcome.recordId });
      return;
    }
    showToast(
      'success',
      outcome.changed > 0 ? `${outcome.changed.toLocaleString()} ${outcome.changed === 1 ? words.one : words.many} changed` : 'Nothing needed changing',
      `${column.label} ${typed === undefined ? 'cleared (not recorded)' : `is now "${String(typed)}"`}.${outcome.unchanged > 0 ? ` ${outcome.unchanged} already had it.` : ''} Saved on the office server.`,
    );
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Change ${ids.length.toLocaleString()} chosen ${ids.length === 1 ? words.one : words.many}`}
      icon={PencilLine}
      size="md"
      description="All are saved together on the office server, with every rule checked. If one cannot be saved, none are."
      footer={
        <>
          <Button size="lg" onClick={onClose}>Cancel</Button>
          <Button size="lg" variant="primary" loading={saving} disabled={typed === null} onClick={() => void save()} data-testid="bulk-save">
            Save to {ids.length.toLocaleString()} {ids.length === 1 ? words.one : words.many}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className={label} htmlFor="bulk-field">What to change</label>
          <select id="bulk-field" className={field} value={columnKey} onChange={(e) => { setColumnKey(e.target.value); setValue(''); setClearIt(false); setRefusal(null); }}>
            {editable.map((c) => (
              <option key={c.key} value={c.key}>{c.label}</option>
            ))}
          </select>
        </div>
        {column && (
          <div>
            <label className={label} htmlFor="bulk-value">New value</label>
            {column.options ? (
              <select id="bulk-value" className={field} value={value} disabled={clearIt} onChange={(e) => setValue(e.target.value)}>
                <option value="">Choose…</option>
                {column.options.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            ) : (
              <input id="bulk-value" className={field} value={value} disabled={clearIt} maxLength={500} inputMode={column.type === 'number' ? 'decimal' : 'text'} placeholder={column.type === 'date' ? '2026-11-10' : ''} onChange={(e) => setValue(e.target.value)} />
            )}
            {!column.edit?.required && (
              <label className="mt-1 flex min-h-[48px] items-center gap-3 text-[14px] text-slate-700">
                <input type="checkbox" className="h-5 w-5" checked={clearIt} onChange={(e) => setClearIt(e.target.checked)} />
                Clear it (shows "Not recorded")
              </label>
            )}
          </div>
        )}
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[13px]">
          <div className="mb-1 font-semibold text-slate-700">Now</div>
          <ul className="space-y-0.5 text-slate-600">
            {preview.map((p) => (
              <li key={p.id} className="truncate">
                {p.name} ({p.id}): {p.now}
              </li>
            ))}
            {ids.length > preview.length && <li>…and {(ids.length - preview.length).toLocaleString()} more</li>}
          </ul>
        </div>
        {refusal && (
          <div role="alert" className="flex gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-900" data-testid="bulk-refused">
            <TriangleAlert size={16} className="mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <p>{refusal.message}</p>
              {refusal.recordId && (
                <button type="button" className="mt-1 min-h-[48px] font-semibold underline md:min-h-0" onClick={() => { focusKey(keyOf(layer.collection, refusal.recordId!)); onClose(); }}>
                  Show {refusal.recordId}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
