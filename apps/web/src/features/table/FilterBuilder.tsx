import { useState } from 'react';
import { Plus, Save, Trash2, X } from 'lucide-react';

import { describeConditions, FILTER_OPERATOR_LABELS, FILTER_OPERATORS, type FilterCondition, type FilterOperator, VALUELESS_OPERATORS } from '@fibergis/shared';

import { useSearchStore } from '../../stores/searchStore';
import { showToast } from '../../stores/toastStore';
import { selectionOwnerId } from '../selection/selectionActions';
import type { TableLayer } from './tableLayers';

/**
 * Phase 16: the filter builder (field, operator, value; every condition must hold), with filters
 * saved on this device per person and per layer.
 */

const input = 'h-[48px] rounded-lg border border-slate-300 bg-white px-2 text-[13px] md:h-8 md:text-[12px]';

export function FilterBuilder({ layer, conditions, onChange, onClose }: { layer: TableLayer<unknown>; conditions: FilterCondition[]; onChange: (c: FilterCondition[]) => void; onClose: () => void }) {
  const owner = selectionOwnerId();
  const saved = useSearchStore((s) => s.savedFilters).filter((f) => f.ownerId === owner && f.layerId === layer.id);
  const [name, setName] = useState('');
  const columnOf = (key: string) => layer.columns.find((c) => c.key === key);
  const labelOf = (key: string) => columnOf(key)?.label ?? key;
  const update = (i: number, patch: Partial<FilterCondition>) => onChange(conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const add = () => onChange([...conditions, { field: layer.columns[1]?.key ?? layer.columns[0].key, operator: 'equals', value: '' }]);

  const save = () => {
    const kept = conditions.filter((c) => VALUELESS_OPERATORS.has(c.operator) || (c.value ?? '').trim());
    if (!name.trim() || kept.length === 0) return;
    useSearchStore.getState().saveFilter({ id: `FLT-${Date.now().toString(36)}`, name: name.trim().slice(0, 60), ownerId: owner, layerId: layer.id, conditions: kept, createdAt: new Date().toISOString() });
    setName('');
    showToast('success', 'Filter saved on this device', `"${name.trim()}" for ${layer.label}.`);
  };

  return (
    <div className="max-h-[50%] shrink-0 overflow-y-auto border-b border-slate-200 bg-slate-50 px-3 py-2" data-testid="filter-builder">
      <div className="mb-1 flex items-center gap-2">
        <span className="flex-1 text-[12px] font-semibold text-slate-700">Show only rows where every line below is true</span>
        <button type="button" aria-label="Close filters" className="flex h-[48px] w-[48px] items-center justify-center rounded-lg text-slate-500 hover:bg-white md:h-7 md:w-7" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      <ul className="space-y-1.5">
        {conditions.map((c, i) => {
          const column = columnOf(c.field);
          return (
            <li key={i} className="flex flex-wrap items-center gap-1.5">
              <select aria-label="Field" className={input} value={c.field} onChange={(e) => update(i, { field: e.target.value, value: '' })}>
                {layer.columns.map((col) => (
                  <option key={col.key} value={col.key}>{col.label}</option>
                ))}
              </select>
              <select aria-label="Operator" className={input} value={c.operator} onChange={(e) => update(i, { operator: e.target.value as FilterOperator })}>
                {FILTER_OPERATORS.map((o) => (
                  <option key={o} value={o}>{FILTER_OPERATOR_LABELS[o]}</option>
                ))}
              </select>
              {!VALUELESS_OPERATORS.has(c.operator) &&
                (column?.options ? (
                  <select aria-label="Value" className={input} value={c.value ?? ''} onChange={(e) => update(i, { value: e.target.value })}>
                    <option value="">Choose…</option>
                    {column.options.map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                ) : (
                  <input aria-label="Value" className={`${input} min-w-[120px] flex-1`} value={c.value ?? ''} inputMode={column?.type === 'number' ? 'decimal' : 'text'} placeholder={column?.type === 'date' ? '2026-11-10' : 'Value'} onChange={(e) => update(i, { value: e.target.value })} />
                ))}
              <button type="button" aria-label="Remove this line" className="flex h-[48px] w-[48px] items-center justify-center rounded-lg text-slate-500 hover:bg-white md:h-8 md:w-8" onClick={() => onChange(conditions.filter((_, j) => j !== i))}>
                <Trash2 size={15} />
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <button type="button" className={`${input} flex items-center gap-1 font-medium`} onClick={add} data-testid="filter-add">
          <Plus size={14} /> Add a line
        </button>
        {conditions.length > 0 && (
          <button type="button" className={`${input} font-medium`} onClick={() => onChange([])}>
            Clear all
          </button>
        )}
        <input aria-label="Name for this filter" className={`${input} min-w-[140px]`} placeholder="Name to save it as" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        <button type="button" className={`${input} flex items-center gap-1 font-medium disabled:opacity-40`} disabled={!name.trim() || conditions.length === 0} onClick={save}>
          <Save size={14} /> Save
        </button>
      </div>
      {saved.length > 0 && (
        <div className="mt-2">
          <div className="mb-1 text-[12px] font-semibold text-slate-600">Saved filters for {layer.label}</div>
          <ul className="flex flex-wrap gap-1.5">
            {saved.map((f) => (
              <li key={f.id} className="flex items-center rounded-lg bg-white ring-1 ring-slate-200">
                <button type="button" className="min-h-[48px] px-3 text-left text-[12px] md:min-h-8" title={describeConditions(f.conditions, labelOf)} onClick={() => onChange(f.conditions.filter((c) => columnOf(c.field)))}>
                  <span className="font-semibold text-slate-800">{f.name}</span>
                  <span className="block text-slate-500">{describeConditions(f.conditions, labelOf)}</span>
                </button>
                <button type="button" aria-label={`Delete ${f.name}`} className="flex h-[48px] w-10 items-center justify-center text-rose-600 md:h-8" onClick={() => useSearchStore.getState().deleteFilter(f.id)}>
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
