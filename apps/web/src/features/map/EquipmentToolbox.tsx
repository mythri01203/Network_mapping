import React, { useMemo, useState } from 'react';
import {
  Boxes,
  Building2,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Cpu,
  GripVertical,
  Layers,
  MapPin,
  Network,
  Plus,
  Radio,
  Router,
  Search,
  Server,
  Sparkles,
  Split,
  UtilityPole,
  X,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import type { EquipmentCategory, EquipmentType } from '@fibergis/shared';

import { EquipmentIllustration } from '../../components/icons/EquipmentIllustration';
import { EQUIPMENT_DRAG_TYPE } from '../../lib/browser';
import { useMapStore } from '../../stores/mapStore';
import { addCatalogComponent } from '../../stores/networkActions';
import { useNetworkStore } from '../../stores/networkStore';
import { showToast } from '../../stores/toastStore';

export interface ToolboxItem {
  id: string;
  name: string;
  type: EquipmentType;
  category: EquipmentCategory;
  defaultPorts: number;
  description: string;
  icon: React.ElementType;
  iconBg: string;
  badge?: string;
  isCustom?: boolean;
}

export const DEFAULT_TOOLBOX_ITEMS: ToolboxItem[] = [
  {
    id: 'tb-olt',
    name: 'OLT (Optical Line Terminal)',
    type: 'OLT',
    category: 'Central Office',
    defaultPorts: 16,
    description: 'Chassis optical terminal (GPON/EPON/XGS)',
    icon: Server,
    iconBg: 'bg-blue-600',
    badge: '16 Ports',
  },
  {
    id: 'tb-odf',
    name: 'ODF (Distribution Frame)',
    type: 'ODF',
    category: 'Central Office',
    defaultPorts: 48,
    description: 'High-density fiber termination panel',
    icon: Network,
    iconBg: 'bg-sky-600',
    badge: '48 Ports',
  },
  {
    id: 'tb-router',
    name: 'Router (Core / Edge / MikroTik)',
    type: 'MikroTik Router',
    category: 'Central Office',
    defaultPorts: 16,
    description: 'BGP/OSPF aggregation & gateway router',
    icon: Router,
    iconBg: 'bg-indigo-600',
    badge: '16 Ports',
  },
  {
    id: 'tb-splitter',
    name: 'Optical Splitter (PLC)',
    type: 'Outdoor Splitter',
    category: 'Fiber Distribution',
    defaultPorts: 8,
    description: 'Passive optical beam splitter (1:2 to 1:32)',
    icon: Split,
    iconBg: 'bg-purple-600',
    badge: '1:8 Standard',
  },
  {
    id: 'tb-fdb',
    name: 'Fiber Distribution Box (FDB)',
    type: 'FAT',
    category: 'Fiber Distribution',
    defaultPorts: 16,
    description: 'Wall or pole-mounted customer access terminal',
    icon: Boxes,
    iconBg: 'bg-emerald-600',
    badge: '16 Ports',
  },
  {
    id: 'tb-fdh',
    name: 'Fiber Distribution Hub (FDH)',
    type: 'FDT',
    category: 'Fiber Distribution',
    defaultPorts: 48,
    description: 'Feeder to distribution optical cross-connect hub',
    icon: Layers,
    iconBg: 'bg-teal-700',
    badge: '48 Ports',
  },
  {
    id: 'tb-closure',
    name: 'Joint Closure (Dome)',
    type: 'Fiber Joint Closure',
    category: 'Fiber Distribution',
    defaultPorts: 24,
    description: 'Underground or aerial splice dome enclosure',
    icon: CircleDot,
    iconBg: 'bg-amber-600',
    badge: 'Splice Tray',
  },
  {
    id: 'tb-cabinet',
    name: 'Network Cabinet / Rack',
    type: 'FDMS',
    category: 'Fiber Distribution',
    defaultPorts: 96,
    description: 'Outdoor weatherproof street enclosure cabinet',
    icon: Building2,
    iconBg: 'bg-cyan-700',
    badge: '96 Ports',
  },
  {
    id: 'tb-pole',
    name: 'Fiber Pole (Telecom Pole)',
    type: 'Telecom Pole',
    category: 'Supporting Infrastructure',
    defaultPorts: 0,
    description: 'Aerial cable suspension pole with bracket',
    icon: UtilityPole,
    iconBg: 'bg-slate-600',
    badge: 'Infrastructure',
  },
  {
    id: 'tb-manhole',
    name: 'Manhole / Chamber',
    type: 'Manhole',
    category: 'Supporting Infrastructure',
    defaultPorts: 0,
    description: 'Subsurface duct chamber and pull vault',
    icon: CircleDot,
    iconBg: 'bg-stone-700',
    badge: 'Underground',
  },
  {
    id: 'tb-onu',
    name: 'ONU (Optical Network Unit)',
    type: 'ONU',
    category: 'Customer Equipment',
    defaultPorts: 4,
    description: 'Subscriber multi-port modem with Wi-Fi gateway',
    icon: Radio,
    iconBg: 'bg-sky-500',
    badge: 'Subscriber',
  },
  {
    id: 'tb-ont',
    name: 'ONT (Single-Port Terminal)',
    type: 'ONT',
    category: 'Customer Equipment',
    defaultPorts: 1,
    description: 'Subscriber single-family fiber terminal',
    icon: Cpu,
    iconBg: 'bg-blue-500',
    badge: 'Modem',
  },
  {
    id: 'tb-customer',
    name: 'Customer Location',
    type: 'Customer Terminal',
    category: 'Customer Equipment',
    defaultPorts: 1,
    description: 'Residential or commercial subscriber premises',
    icon: MapPin,
    iconBg: 'bg-rose-600',
    badge: 'Premises',
  },
];

export const EquipmentToolbox: React.FC = () => {
  const { setActiveTool, setEquipmentTypeToAdd, setEquipmentDraftTemplate } = useMapStore(
    useShallow((s) => ({
      setActiveTool: s.setActiveTool,
      setEquipmentTypeToAdd: s.setEquipmentTypeToAdd,
      setEquipmentDraftTemplate: s.setEquipmentDraftTemplate,
    })),
  );

  const catalog = useNetworkStore((s) => s.catalog) || [];
  const [isOpen, setIsOpen] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');

  // Custom equipment dialog state
  const [showAddCustomModal, setShowAddCustomModal] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customType, setCustomType] = useState('Custom Network Node');
  const [customCategory, setCustomCategory] = useState<EquipmentCategory>('Fiber Distribution');
  const [customPorts, setCustomPorts] = useState(8);
  const [customDescription, setCustomDescription] = useState('');
  const [customColor, setCustomColor] = useState('bg-indigo-600');

  // Merge default toolbox items with custom components from database
  const allItems = useMemo<ToolboxItem[]>(() => {
    const customItems: ToolboxItem[] = catalog.map((c) => ({
      id: c.id,
      name: c.name,
      type: (c.type as EquipmentType) || 'Outdoor Splitter',
      category: (c.category as EquipmentCategory) || 'Fiber Distribution',
      defaultPorts: c.defaultPorts ?? 8,
      description: c.description || 'Custom network equipment',
      icon: Sparkles,
      iconBg: c.iconBg || 'bg-indigo-600',
      badge: 'Custom',
      isCustom: true,
    }));
    return [...DEFAULT_TOOLBOX_ITEMS, ...customItems];
  }, [catalog]);

  const filteredItems = useMemo(() => {
    const q = search.toLowerCase().trim();
    return allItems.filter((item) => {
      const matchesSearch =
        !q ||
        item.name.toLowerCase().includes(q) ||
        item.type.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q);
      const matchesCategory = selectedCategory === 'All' || item.category === selectedCategory;
      return matchesSearch && matchesCategory;
    });
  }, [allItems, search, selectedCategory]);

  const handleDragStart = (e: React.DragEvent, item: ToolboxItem) => {
    e.dataTransfer.setData(EQUIPMENT_DRAG_TYPE, item.type);
    e.dataTransfer.setData('text/plain', JSON.stringify({ type: item.type, name: item.name, totalPorts: item.defaultPorts }));
    e.dataTransfer.effectAllowed = 'copy';
  };

  const handleClickItem = (item: ToolboxItem) => {
    setActiveTool('add_equipment');
    setEquipmentTypeToAdd(item.type);
    setEquipmentDraftTemplate({
      name: item.name,
      totalPorts: item.defaultPorts,
      category: item.category,
      notes: item.description,
    });
    showToast('info', `Click Map to Place ${item.name}`, 'Click anywhere on the GIS map canvas to place this equipment.');
  };

  const handleSaveCustomEquipment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customName.trim()) {
      showToast('warning', 'Name Required', 'Please enter a name for the custom equipment.');
      return;
    }

    const componentId = `CUSTOM-${Date.now().toString(36).toUpperCase()}`;
    addCatalogComponent({
      id: componentId,
      name: customName.trim(),
      type: customType.trim() || 'Custom Equipment',
      category: customCategory,
      defaultPorts: customPorts,
      description: customDescription || `Custom ${customPorts}-port equipment`,
      iconBg: customColor,
      isCustom: true,
    });

    setShowAddCustomModal(false);
    setCustomName('');
    setCustomDescription('');
    setCustomPorts(8);
  };

  return (
    <>
      {/* Collapsed Ribbon Pill */}
      {!isOpen && (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="absolute top-16 left-4 z-[440] bg-slate-900/95 hover:bg-slate-800 text-white px-3 py-2 rounded-xl shadow-xl border border-slate-700/80 flex items-center gap-2 text-xs font-semibold backdrop-blur-sm transition-all animate-in fade-in"
          title="Open Equipment Toolbox"
        >
          <Boxes className="w-4 h-4 text-sky-400" />
          <span>Equipment Toolbox</span>
          <ChevronRight className="w-4 h-4 text-slate-400" />
        </button>
      )}

      {/* Expanded Left Equipment Toolbox */}
      {isOpen && (
        <div className="absolute top-16 left-4 z-[440] w-80 max-w-[calc(100%-2rem)] bg-slate-900/95 backdrop-blur-md text-white rounded-2xl shadow-2xl border border-slate-700/80 overflow-hidden flex flex-col max-h-[82vh] animate-in fade-in slide-in-from-left-4 select-none">
          {/* Header */}
          <div className="px-4 py-3 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 border-b border-slate-700/80 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-sky-500/20 text-sky-400 flex items-center justify-center border border-sky-500/30">
                <Boxes className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-bold text-xs tracking-wide text-white">Equipment Toolbox</h3>
                <p className="text-[10px] text-slate-400">Drag or click to place on map</p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              title="Collapse Toolbox"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          </div>

          {/* Search & Category Filter */}
          <div className="p-3 border-b border-slate-800 space-y-2 bg-slate-950/40">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search equipment, OLT, FAT, pole..."
                className="w-full pl-8 pr-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700/80 text-xs text-white placeholder:text-slate-500 outline-none focus:border-sky-500 transition-colors"
              />
            </div>

            <div className="flex gap-1 overflow-x-auto pb-0.5 no-scrollbar text-[10px] font-medium">
              {['All', 'Central Office', 'Fiber Distribution', 'Supporting Infrastructure', 'Customer Equipment'].map(
                (cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setSelectedCategory(cat)}
                    className={`px-2 py-0.5 rounded-full whitespace-nowrap transition-colors ${
                      selectedCategory === cat
                        ? 'bg-sky-600 text-white font-bold'
                        : 'bg-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    {cat.replace(' Infrastructure', '').replace(' Equipment', '')}
                  </button>
                ),
              )}
            </div>
          </div>

          {/* Equipment List */}
          <div className="p-2.5 overflow-y-auto space-y-1.5 flex-1">
            {filteredItems.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, item)}
                  onClick={() => handleClickItem(item)}
                  className="group flex items-center gap-2.5 p-2 rounded-xl bg-slate-800/40 hover:bg-slate-800 border border-slate-700/50 hover:border-sky-500/50 cursor-pointer transition-all active:scale-[0.99]"
                  title={`Click or drag to place ${item.name}`}
                >
                  <GripVertical className="w-3.5 h-3.5 text-slate-600 group-hover:text-slate-400 shrink-0" />
                  {item.isCustom ? (
                    <div
                      className={`w-8 h-8 rounded-lg ${item.iconBg} flex items-center justify-center text-white shrink-0 shadow-xs`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                    </div>
                  ) : (
                    <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center shrink-0 shadow-xs">
                      <EquipmentIllustration type={item.type} size={28} />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-semibold text-xs text-slate-100 truncate group-hover:text-sky-300 transition-colors">
                        {item.name}
                      </span>
                      {item.badge && (
                        <span className="text-[9px] font-mono font-bold bg-slate-900/80 text-slate-300 px-1.5 py-0.2 rounded border border-slate-700/60 shrink-0">
                          {item.badge}
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-slate-400 truncate">{item.description}</p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Add Custom Equipment Footer Trigger */}
          <div className="p-3 border-t border-slate-800 bg-slate-950/60">
            <button
              type="button"
              onClick={() => setShowAddCustomModal(true)}
              className="w-full py-2 rounded-xl bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-md shadow-sky-950/40"
            >
              <Plus className="w-4 h-4" />
              <span>Add Custom Equipment</span>
            </button>
          </div>
        </div>
      )}

      {/* Add Custom Equipment Modal */}
      {showAddCustomModal && (
        <div className="fixed inset-0 z-[1250] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in select-none">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden flex flex-col text-slate-800">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-sky-100 text-sky-700 flex items-center justify-center font-bold">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900">Add Custom Equipment</h3>
                  <p className="text-xs text-slate-500">Configure and save reusable hardware template</p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowAddCustomModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveCustomEquipment} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Equipment Name *</label>
                <input
                  type="text"
                  required
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  placeholder="e.g. Cisco ASR 9000, 4-Way Outdoor Node"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs focus:border-sky-500 outline-none"
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Equipment Type</label>
                  <input
                    type="text"
                    value={customType}
                    onChange={(e) => setCustomType(e.target.value)}
                    placeholder="e.g. Switch, DWDM, Repeater"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs focus:border-sky-500 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Category</label>
                  <select
                    value={customCategory}
                    onChange={(e) => setCustomCategory(e.target.value as EquipmentCategory)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs focus:border-sky-500 outline-none bg-white"
                  >
                    <option value="Central Office">Central Office</option>
                    <option value="Fiber Distribution">Fiber Distribution</option>
                    <option value="Supporting Infrastructure">Supporting Infrastructure</option>
                    <option value="Customer Equipment">Customer Equipment</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Number of Ports</label>
                  <input
                    type="number"
                    min={0}
                    max={576}
                    value={customPorts}
                    onChange={(e) => setCustomPorts(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs focus:border-sky-500 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Icon Color</label>
                  <div className="flex gap-1.5 pt-1">
                    {[
                      { class: 'bg-blue-600', name: 'Blue' },
                      { class: 'bg-indigo-600', name: 'Indigo' },
                      { class: 'bg-purple-600', name: 'Purple' },
                      { class: 'bg-emerald-600', name: 'Green' },
                      { class: 'bg-amber-600', name: 'Amber' },
                      { class: 'bg-rose-600', name: 'Rose' },
                    ].map((col) => (
                      <button
                        key={col.class}
                        type="button"
                        onClick={() => setCustomColor(col.class)}
                        className={`w-6 h-6 rounded-full ${col.class} border-2 transition-transform ${
                          customColor === col.class ? 'border-slate-900 scale-110 shadow-sm' : 'border-transparent'
                        }`}
                        title={col.name}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Description & Specs</label>
                <textarea
                  rows={2}
                  value={customDescription}
                  onChange={(e) => setCustomDescription(e.target.value)}
                  placeholder="e.g. 10G optical edge switch with redundant power supply"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs focus:border-sky-500 outline-none resize-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddCustomModal(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold shadow-md shadow-sky-600/30"
                >
                  Save Equipment Type
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
};
