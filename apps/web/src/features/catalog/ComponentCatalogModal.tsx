import React, { useMemo, useState } from 'react';
import { GripVertical, Plus, Search, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import type { EquipmentCategory, EquipmentType } from '@fibergis/shared';

import { OltChassisIcon } from '../../components/icons/OltChassisIcon';
import { UtilityPoleIcon } from '../../components/icons/UtilityPoleIcon';
import { useMapStore } from '../../stores/mapStore';
import { addCatalogComponent } from '../../stores/networkActions';
import { useNetworkStore } from '../../stores/networkStore';
import { useToastStore } from '../../stores/toastStore';
import { useUiStore } from '../../stores/uiStore';
import { BUILT_IN_COMPONENTS } from './componentCatalog';

const CATEGORIES = [
  'All',
  'Central Office',
  'Fiber Distribution',
  'Supporting Infrastructure',
  'Customer Equipment',
  'Cable TV Infrastructure',
];

export const ComponentCatalogModal: React.FC = () => {
  const { isComponentCatalogOpen, setModalOpen } = useUiStore(
    useShallow((s) => ({ isComponentCatalogOpen: s.modals.componentCatalog, setModalOpen: s.setModalOpen })),
  );
  const customComponents = useNetworkStore((s) => s.catalog);
  const { setSelectedEquipmentTypeToAdd, setActiveTool } = useMapStore(
    useShallow((s) => ({ setSelectedEquipmentTypeToAdd: s.setEquipmentTypeToAdd, setActiveTool: s.setActiveTool })),
  );
  const showToast = useToastStore((s) => s.show);

  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newCategory, setNewCategory] = useState<EquipmentCategory>('Fiber Distribution');
  const [newPorts, setNewPorts] = useState(8);

  const items = useMemo(() => {
    const all = [...BUILT_IN_COMPONENTS, ...customComponents];
    return all.filter((item) => {
      const matchesCat = category === 'All' || item.category === category;
      const q = query.toLowerCase();
      const matchesQ =
        item.name.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        String(item.type).toLowerCase().includes(q);
      return matchesCat && matchesQ;
    });
  }, [customComponents, category, query]);

  if (!isComponentCatalogOpen) return null;

  const place = (type: string) => {
    setSelectedEquipmentTypeToAdd(type as EquipmentType);
    setActiveTool('add_equipment');
    setModalOpen('componentCatalog', false);
    showToast('info', 'Click Map to Place', `Click the GIS map to place ${type}.`);
  };

  const handleDragStart = (e: React.DragEvent, type: string) => {
    e.dataTransfer.setData('application/fiber-equipment-type', type);
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <div className="fixed inset-0 z-[1100] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/80">
          <div>
            <h2 className="font-bold text-sm text-slate-900">Search & Add Network Boxes</h2>
            <p className="text-[11px] text-slate-500">
              Click any box, pole, or equipment below to place it onto the GIS map.
            </p>
          </div>
          <button
            onClick={() => setModalOpen('componentCatalog', false)}
            className="p-1 text-slate-400 hover:text-slate-700 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 border-b border-slate-100 space-y-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, type, or description..."
              className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:border-blue-500"
            />
          </div>
          <div className="flex gap-1.5 overflow-x-auto">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => setCategory(cat)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap ${
                  category === cat ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'
                }`}
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
              onDragStart={(e) => handleDragStart(e, String(item.type))}
              onClick={() => place(String(item.type))}
              className="p-3 rounded-xl border border-slate-200 hover:border-blue-300 hover:bg-blue-50/40 cursor-pointer flex items-center gap-3"
            >
              {String(item.type) === 'OLT' ? (
                <OltChassisIcon width={44} height={23} className="shrink-0" />
              ) : String(item.type).includes('Pole') ? (
                <UtilityPoleIcon width={28} height={36} className="shrink-0" />
              ) : (
                <div
                  className={`w-10 h-10 rounded-lg ${item.iconBg} text-white flex items-center justify-center text-[10px] font-bold shrink-0`}
                >
                  {String(item.type).slice(0, 3).toUpperCase()}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-xs text-slate-800 truncate">{item.name}</div>
                <div className="text-[11px] text-slate-500 line-clamp-2">{item.description}</div>
                <div className="text-[10px] text-slate-400 mt-0.5">
                  {item.category}
                  {item.defaultPorts ? ` · ${item.defaultPorts} ports` : ''}
                  {item.isCustom ? ' · Custom' : ''}
                </div>
              </div>
              <GripVertical className="w-4 h-4 text-slate-300" />
            </div>
          ))}
          {items.length === 0 && (
            <div className="col-span-2 text-center text-sm text-slate-500 py-10">No components match this search.</div>
          )}
        </div>

        <div className="p-4 border-t border-slate-100 bg-slate-50">
          <div className="text-[11px] font-bold text-slate-600 mb-2">Add a custom component type</div>
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Name"
              className="sm:col-span-2 px-2 py-1.5 border border-slate-200 rounded-lg text-xs"
            />
            <select
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value as EquipmentCategory)}
              className="px-2 py-1.5 border border-slate-200 rounded-lg text-xs"
            >
              {CATEGORIES.filter((c) => c !== 'All').map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={0}
              value={newPorts}
              onChange={(e) => setNewPorts(Number(e.target.value))}
              className="px-2 py-1.5 border border-slate-200 rounded-lg text-xs"
            />
            <button
              onClick={() => {
                if (!newName.trim()) return;
                addCatalogComponent({
                  id: `custom-${Date.now()}`,
                  type: newName.trim() as EquipmentType,
                  category: newCategory,
                  name: newName.trim(),
                  description: newDesc || 'Administrator-defined component',
                  defaultPorts: newPorts,
                  iconBg: 'bg-blue-700',
                  isCustom: true,
                });
                setNewName('');
                setNewDesc('');
              }}
              className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" /> Add Type
            </button>
          </div>
          <input
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            placeholder="Description (optional)"
            className="mt-2 w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs"
          />
        </div>
      </div>
    </div>
  );
};
